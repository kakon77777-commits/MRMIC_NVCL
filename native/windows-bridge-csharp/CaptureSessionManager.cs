using System.Runtime.InteropServices;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using WinRT;

internal sealed class WindowsBridgeOperationException : Exception
{
    public string Code { get; }

    public WindowsBridgeOperationException(string code, string message, Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
    }
}

internal sealed class WindowsCaptureSessionManager : IDisposable
{
    public const int MaxActiveMounts = 4;

    private const int D3dDriverTypeHardware = 1;
    private const uint D3d11CreateDeviceBgraSupport = 0x20;
    private const uint D3d11SdkVersion = 7;

    private static readonly Guid GraphicsCaptureItemGuid = new("79C3F95B-31F7-4EC2-A464-632EF5D30760");
    private static readonly Guid IdxgiDeviceGuid = new("54EC77FA-1377-44E6-8C32-88FD5F44C84C");

    private readonly string _providerEpoch;
    private readonly Dictionary<string, MountedCapture> _mounts = new(StringComparer.Ordinal);
    private readonly object _gate = new();
    private IDirect3DDevice? _device;
    private bool _disposed;

    [ComImport]
    [Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IGraphicsCaptureItemInterop
    {
        [PreserveSig]
        int CreateForWindow(nint window, in Guid iid, out nint result);

        [PreserveSig]
        int CreateForMonitor(nint monitor, in Guid iid, out nint result);
    }

    [DllImport("d3d11.dll", ExactSpelling = true)]
    private static extern int D3D11CreateDevice(
        nint adapter,
        int driverType,
        nint software,
        uint flags,
        nint featureLevels,
        uint featureLevelCount,
        uint sdkVersion,
        out nint device,
        out int featureLevel,
        out nint immediateContext);

    [DllImport("d3d11.dll", ExactSpelling = true)]
    private static extern int CreateDirect3D11DeviceFromDXGIDevice(nint dxgiDevice, out nint graphicsDevice);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(nint hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(nint hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(nint hWnd, out uint processId);

    public WindowsCaptureSessionManager(string providerEpoch)
    {
        _providerEpoch = Required(providerEpoch, nameof(providerEpoch));
    }

    public object Mount(string providerResourceId, string providerEpoch, string hwndHex, uint processId)
    {
        ThrowIfDisposed();
        ValidateIdentity(providerResourceId, providerEpoch, hwndHex, processId, out var hwnd);

        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 18362))
            throw new WindowsBridgeOperationException("CAPTURE_UNSUPPORTED", "Windows.Graphics.Capture HWND interop requires Windows 10 build 18362 or later");
        if (!GraphicsCaptureSession.IsSupported())
            throw new WindowsBridgeOperationException("CAPTURE_UNSUPPORTED", "Windows.Graphics.Capture is not supported on this device");
        if (IsIconic(hwnd))
            throw new WindowsBridgeOperationException("WINDOW_MINIMIZED", "Minimized windows are not eligible for the Phase 15.7 WGC transport baseline");

        lock (_gate)
        {
            if (_mounts.Count >= MaxActiveMounts)
                throw new WindowsBridgeOperationException("CAPTURE_MOUNT_LIMIT", $"Phase 15.7 allows at most {MaxActiveMounts} active Windows capture mounts");
            if (_mounts.Values.Any(value => string.Equals(value.ProviderResourceId, providerResourceId, StringComparison.Ordinal)))
                throw new WindowsBridgeOperationException("CAPTURE_ALREADY_MOUNTED", "The Windows resource already has an active capture session");
        }

        try
        {
            var device = GetOrCreateDevice();
            var item = CreateCaptureItemForWindow(hwnd);
            if (item.Size.Width <= 0 || item.Size.Height <= 0)
                throw new WindowsBridgeOperationException("INVALID_CAPTURE_SIZE", "Windows.Graphics.Capture returned an empty capture size");
            if ((long)item.Size.Width * item.Size.Height > BoundedPngFrameTransport.MaxSnapshotPixels)
                throw new WindowsBridgeOperationException("CAPTURE_SIZE_LIMIT", "Window exceeds the Phase 15.7 bounded snapshot pixel limit");

            var mountId = $"wgc-{Guid.NewGuid():N}";
            var mounted = new MountedCapture(mountId, providerResourceId, hwnd, item, device);
            mounted.Start();
            lock (_gate) _mounts.Add(mountId, mounted);
            return mounted.Snapshot();
        }
        catch (WindowsBridgeOperationException)
        {
            throw;
        }
        catch (Exception error)
        {
            throw new WindowsBridgeOperationException("CAPTURE_START_FAILED", "Failed to create the HWND-bound Windows.Graphics.Capture session", error);
        }
    }

    public object Update(string mountId, string providerResourceId)
    {
        var mounted = RequireMount(mountId, providerResourceId);
        return mounted.Snapshot();
    }

    public object ReadSnapshot(string mountId, string providerResourceId)
    {
        var mounted = RequireMount(mountId, providerResourceId);
        return mounted.LatestFrameSnapshot();
    }

    public object Unmount(string mountId, string providerResourceId)
    {
        ThrowIfDisposed();
        MountedCapture mounted;
        lock (_gate)
        {
            if (!_mounts.TryGetValue(Required(mountId, nameof(mountId)), out mounted!))
                throw new WindowsBridgeOperationException("CAPTURE_NOT_FOUND", $"Unknown Windows capture mount {mountId}");
            if (!string.Equals(mounted.ProviderResourceId, Required(providerResourceId, nameof(providerResourceId)), StringComparison.Ordinal))
                throw new WindowsBridgeOperationException("CAPTURE_IDENTITY_MISMATCH", "Windows capture mount resource identity mismatch");
            _mounts.Remove(mounted.MountId);
        }
        var snapshot = mounted.Snapshot();
        mounted.Dispose();
        return snapshot;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        MountedCapture[] mounts;
        lock (_gate)
        {
            mounts = _mounts.Values.ToArray();
            _mounts.Clear();
        }
        foreach (var mounted in mounts) mounted.Dispose();
        if (_device is IDisposable disposable) disposable.Dispose();
        _device = null;
    }

    private MountedCapture RequireMount(string mountId, string providerResourceId)
    {
        ThrowIfDisposed();
        lock (_gate)
        {
            if (!_mounts.TryGetValue(Required(mountId, nameof(mountId)), out var mounted))
                throw new WindowsBridgeOperationException("CAPTURE_NOT_FOUND", $"Unknown Windows capture mount {mountId}");
            if (!string.Equals(mounted.ProviderResourceId, Required(providerResourceId, nameof(providerResourceId)), StringComparison.Ordinal))
                throw new WindowsBridgeOperationException("CAPTURE_IDENTITY_MISMATCH", "Windows capture mount resource identity mismatch");
            return mounted;
        }
    }

    private void ValidateIdentity(string providerResourceId, string providerEpoch, string hwndHex, uint processId, out nint hwnd)
    {
        var epoch = Required(providerEpoch, nameof(providerEpoch));
        if (!string.Equals(epoch, _providerEpoch, StringComparison.Ordinal))
            throw new WindowsBridgeOperationException("STALE_PROVIDER_EPOCH", "Windows capture request belongs to a stale provider epoch");
        if (processId == 0) throw new WindowsBridgeOperationException("INVALID_PROCESS_ID", "processId must be positive");
        hwnd = ParseHwnd(hwndHex);
        var expectedId = $"window:{_providerEpoch}:{processId}:0x{hwnd.ToInt64():x}";
        if (!string.Equals(Required(providerResourceId, nameof(providerResourceId)), expectedId, StringComparison.Ordinal))
            throw new WindowsBridgeOperationException("RESOURCE_IDENTITY_MISMATCH", "providerResourceId does not match providerEpoch + processId + HWND");
        if (!IsWindow(hwnd)) throw new WindowsBridgeOperationException("STALE_WINDOW", "HWND is no longer a live window");
        _ = GetWindowThreadProcessId(hwnd, out var currentProcessId);
        if (currentProcessId != processId)
            throw new WindowsBridgeOperationException("STALE_WINDOW", "HWND now belongs to a different process");
    }

    private IDirect3DDevice GetOrCreateDevice()
    {
        lock (_gate)
        {
            if (_device is not null) return _device;
            var hr = D3D11CreateDevice(
                0,
                D3dDriverTypeHardware,
                0,
                D3d11CreateDeviceBgraSupport,
                0,
                0,
                D3d11SdkVersion,
                out var nativeDevice,
                out _,
                out var immediateContext);
            if (hr < 0) Marshal.ThrowExceptionForHR(hr);

            nint dxgiDevice = 0;
            nint winRtDevice = 0;
            try
            {
                var iid = IdxgiDeviceGuid;
                hr = Marshal.QueryInterface(nativeDevice, ref iid, out dxgiDevice);
                if (hr < 0) Marshal.ThrowExceptionForHR(hr);
                hr = CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice, out winRtDevice);
                if (hr < 0) Marshal.ThrowExceptionForHR(hr);
                _device = MarshalInterface<IDirect3DDevice>.FromAbi(winRtDevice);
                return _device;
            }
            finally
            {
                if (winRtDevice != 0) Marshal.Release(winRtDevice);
                if (dxgiDevice != 0) Marshal.Release(dxgiDevice);
                if (immediateContext != 0) Marshal.Release(immediateContext);
                if (nativeDevice != 0) Marshal.Release(nativeDevice);
            }
        }
    }

    private static GraphicsCaptureItem CreateCaptureItemForWindow(nint hwnd)
    {
        var interop = GraphicsCaptureItem.As<IGraphicsCaptureItemInterop>();
        var iid = GraphicsCaptureItemGuid;
        var hr = interop.CreateForWindow(hwnd, in iid, out var itemPointer);
        if (hr < 0) Marshal.ThrowExceptionForHR(hr);
        if (itemPointer == 0) throw new InvalidOperationException("CreateForWindow returned a null GraphicsCaptureItem pointer");
        try
        {
            return MarshalInterface<GraphicsCaptureItem>.FromAbi(itemPointer);
        }
        finally
        {
            Marshal.Release(itemPointer);
        }
    }

    private static nint ParseHwnd(string value)
    {
        var normalized = Required(value, nameof(value));
        if (!normalized.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            throw new WindowsBridgeOperationException("INVALID_HWND", "hwndHex must begin with 0x");
        try
        {
            var numeric = Convert.ToInt64(normalized[2..], 16);
            if (numeric == 0) throw new FormatException("zero HWND");
            return (nint)numeric;
        }
        catch (Exception error) when (error is FormatException or OverflowException)
        {
            throw new WindowsBridgeOperationException("INVALID_HWND", "hwndHex is not a valid non-zero HWND", error);
        }
    }

    private static string Required(string? value, string label)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new WindowsBridgeOperationException("INVALID_REQUEST", $"{label} is required");
        return value.Trim();
    }

    private void ThrowIfDisposed()
    {
        if (_disposed) throw new WindowsBridgeOperationException("BRIDGE_CLOSED", "Windows capture session manager is closed");
    }

    private sealed class MountedCapture : IDisposable
    {
        private readonly nint _hwnd;
        private readonly GraphicsCaptureItem _item;
        private readonly IDirect3DDevice _device;
        private readonly Direct3D11CaptureFramePool _framePool;
        private readonly GraphicsCaptureSession _session;
        private readonly BoundedPngFrameTransport _transport;
        private long _frameCount;
        private long _lastFrameUtcTicks;
        private int _lastWidth;
        private int _lastHeight;
        private int _resizePending;
        private int _closed;

        public string MountId { get; }
        public string ProviderResourceId { get; }

        public MountedCapture(string mountId, string providerResourceId, nint hwnd, GraphicsCaptureItem item, IDirect3DDevice device)
        {
            MountId = mountId;
            ProviderResourceId = providerResourceId;
            _hwnd = hwnd;
            _item = item;
            _device = device;
            _lastWidth = item.Size.Width;
            _lastHeight = item.Size.Height;
            _transport = new BoundedPngFrameTransport(mountId, providerResourceId);
            _framePool = Direct3D11CaptureFramePool.CreateFreeThreaded(
                device,
                DirectXPixelFormat.B8G8R8A8UIntNormalized,
                2,
                item.Size);
            _session = _framePool.CreateCaptureSession(item);
            _framePool.FrameArrived += OnFrameArrived;
            _item.Closed += OnItemClosed;
        }

        public void Start() => _session.StartCapture();

        public object Snapshot()
        {
            var ticks = Interlocked.Read(ref _lastFrameUtcTicks);
            return new
            {
                mountId = MountId,
                providerResourceId = ProviderResourceId,
                hwndHex = $"0x{_hwnd.ToInt64():x}",
                started = Volatile.Read(ref _closed) == 0,
                frameCount = Interlocked.Read(ref _frameCount),
                lastFrameAt = ticks == 0 ? null : new DateTime(ticks, DateTimeKind.Utc).ToString("O"),
                contentSize = new { width = Volatile.Read(ref _lastWidth), height = Volatile.Read(ref _lastHeight) },
                frameTransport = BoundedPngFrameTransport.TransportName,
                transport = _transport.Status(),
            };
        }

        public object LatestFrameSnapshot() => _transport.LatestSnapshot();

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _closed, 1) != 0) return;
            _framePool.FrameArrived -= OnFrameArrived;
            _item.Closed -= OnItemClosed;
            _transport.DropPendingForRecreate();
            try { _transport.WaitUntilIdleAsync().Wait(TimeSpan.FromSeconds(5)); }
            catch { /* best effort shutdown */ }
            _session.Dispose();
            _framePool.Dispose();
            _transport.Dispose();
        }

        private void OnItemClosed(GraphicsCaptureItem sender, object args) => Dispose();

        private void OnFrameArrived(Direct3D11CaptureFramePool sender, object args)
        {
            if (Volatile.Read(ref _closed) != 0) return;
            Direct3D11CaptureFrame? frame = null;
            try
            {
                frame = sender.TryGetNextFrame();
                if (frame is null) return;
                Interlocked.Increment(ref _frameCount);
                Interlocked.Exchange(ref _lastFrameUtcTicks, DateTime.UtcNow.Ticks);

                var size = frame.ContentSize;
                var changed = size.Width > 0 && size.Height > 0
                    && (size.Width != Volatile.Read(ref _lastWidth) || size.Height != Volatile.Read(ref _lastHeight));

                if (changed)
                {
                    frame.Dispose();
                    frame = null;
                    if (Interlocked.CompareExchange(ref _resizePending, 1, 0) == 0)
                    {
                        _transport.DropPendingForRecreate();
                        _ = RecreateAfterDrainAsync(size);
                    }
                    return;
                }

                if (Volatile.Read(ref _resizePending) != 0)
                {
                    frame.Dispose();
                    frame = null;
                    return;
                }

                _transport.Enqueue(frame);
                frame = null; // transport now owns frame lifetime
            }
            catch (ObjectDisposedException)
            {
                frame?.Dispose();
            }
            catch (COMException)
            {
                frame?.Dispose();
            }
            catch
            {
                frame?.Dispose();
                throw;
            }
        }

        private async Task RecreateAfterDrainAsync(Windows.Graphics.SizeInt32 size)
        {
            try
            {
                await _transport.WaitUntilIdleAsync().ConfigureAwait(false);
                if (Volatile.Read(ref _closed) != 0) return;
                if ((long)size.Width * size.Height > BoundedPngFrameTransport.MaxSnapshotPixels)
                {
                    Dispose();
                    return;
                }
                _framePool.Recreate(_device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, size);
                Volatile.Write(ref _lastWidth, size.Width);
                Volatile.Write(ref _lastHeight, size.Height);
            }
            catch (ObjectDisposedException)
            {
                // Capture was closed concurrently.
            }
            catch (COMException)
            {
                Dispose();
            }
            finally
            {
                Interlocked.Exchange(ref _resizePending, 0);
            }
        }
    }
}
