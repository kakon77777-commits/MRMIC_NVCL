using System.Security.Cryptography;
using System.Threading.Channels;
using Windows.Graphics.Capture;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

internal sealed class BoundedPngFrameTransport : IDisposable
{
    public const int QueueCapacity = 2;
    public const long MaxSnapshotPixels = 8_294_400; // 3840x2160
    public const int MaxSnapshotBytes = 16 * 1024 * 1024;
    public const string TransportName = "png_base64_snapshot_v1";

    private readonly string _mountId;
    private readonly string _providerResourceId;
    private readonly Channel<QueuedFrame> _frames;
    private readonly Task _worker;
    private readonly object _stateGate = new();
    private TaskCompletionSource<bool> _idle = CompletedIdleSource();
    private EncodedSnapshot? _latest;
    private long _sequence;
    private long _outstanding;
    private long _droppedFrames;
    private long _encodedFrames;
    private string? _lastErrorCode;
    private string? _lastErrorMessage;
    private int _closed;

    public BoundedPngFrameTransport(string mountId, string providerResourceId)
    {
        _mountId = Required(mountId, nameof(mountId));
        _providerResourceId = Required(providerResourceId, nameof(providerResourceId));
        _frames = Channel.CreateBounded<QueuedFrame>(new BoundedChannelOptions(QueueCapacity)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = false,
            SingleWriter = false,
            AllowSynchronousContinuations = false,
        });
        _worker = Task.Run(ProcessLoopAsync);
    }

    public void Enqueue(Direct3D11CaptureFrame frame)
    {
        ArgumentNullException.ThrowIfNull(frame);
        if (Volatile.Read(ref _closed) != 0)
        {
            frame.Dispose();
            return;
        }

        var size = frame.ContentSize;
        if (size.Width <= 0 || size.Height <= 0 || (long)size.Width * size.Height > MaxSnapshotPixels)
        {
            frame.Dispose();
            Interlocked.Increment(ref _droppedFrames);
            SetError("FRAME_TOO_LARGE", $"Frame {size.Width}x{size.Height} exceeds the Phase 15.7 snapshot bound");
            return;
        }

        var queued = new QueuedFrame(frame, Interlocked.Increment(ref _sequence), DateTime.UtcNow);
        ReserveOutstanding();
        while (!_frames.Writer.TryWrite(queued))
        {
            if (Volatile.Read(ref _closed) != 0)
            {
                queued.Frame.Dispose();
                CompleteOutstanding();
                return;
            }
            if (_frames.Reader.TryRead(out var dropped))
            {
                dropped.Frame.Dispose();
                Interlocked.Increment(ref _droppedFrames);
                CompleteOutstanding();
                continue;
            }
            Thread.Yield();
        }
    }

    public void DropPendingForRecreate()
    {
        while (_frames.Reader.TryRead(out var queued))
        {
            queued.Frame.Dispose();
            Interlocked.Increment(ref _droppedFrames);
            CompleteOutstanding();
        }
    }

    public Task WaitUntilIdleAsync()
    {
        lock (_stateGate)
        {
            return _outstanding == 0 ? Task.CompletedTask : _idle.Task;
        }
    }

    public object Status()
    {
        EncodedSnapshot? latest;
        string? lastErrorCode;
        string? lastErrorMessage;
        lock (_stateGate)
        {
            latest = _latest;
            lastErrorCode = _lastErrorCode;
            lastErrorMessage = _lastErrorMessage;
        }
        return new
        {
            transport = TransportName,
            queueCapacity = QueueCapacity,
            maxSnapshotPixels = MaxSnapshotPixels,
            maxSnapshotBytes = MaxSnapshotBytes,
            outstandingFrames = Interlocked.Read(ref _outstanding),
            droppedFrames = Interlocked.Read(ref _droppedFrames),
            encodedFrames = Interlocked.Read(ref _encodedFrames),
            latestSequence = latest?.Sequence,
            latestCapturedAt = latest?.CapturedAt.ToString("O"),
            latestEncodedBytes = latest?.Bytes.Length,
            lastError = lastErrorCode is null ? null : new { code = lastErrorCode, message = lastErrorMessage },
        };
    }

    public object LatestSnapshot()
    {
        EncodedSnapshot snapshot;
        lock (_stateGate)
        {
            snapshot = _latest ?? throw new WindowsBridgeOperationException("FRAME_NOT_READY", "No encoded Windows capture frame is available yet");
        }
        return new
        {
            schema = "windows_capture_snapshot_v1",
            mountId = _mountId,
            providerResourceId = _providerResourceId,
            frameSequence = snapshot.Sequence,
            capturedAt = snapshot.CapturedAt.ToString("O"),
            width = snapshot.Width,
            height = snapshot.Height,
            mimeType = "image/png",
            encodedBytes = snapshot.Bytes.Length,
            sha256 = snapshot.Sha256,
            bytesBase64 = Convert.ToBase64String(snapshot.Bytes),
            transport = TransportName,
        };
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _closed, 1) != 0) return;
        _frames.Writer.TryComplete();
        DropPendingForRecreate();
        _ = _worker.ContinueWith(_ => { }, TaskScheduler.Default);
    }

    private async Task ProcessLoopAsync()
    {
        await foreach (var queued in _frames.Reader.ReadAllAsync())
        {
            try
            {
                using (queued.Frame)
                {
                    var snapshot = await EncodeAsync(queued).ConfigureAwait(false);
                    lock (_stateGate)
                    {
                        _latest = snapshot;
                        _lastErrorCode = null;
                        _lastErrorMessage = null;
                    }
                    Interlocked.Increment(ref _encodedFrames);
                }
            }
            catch (Exception error)
            {
                Interlocked.Increment(ref _droppedFrames);
                SetError("FRAME_ENCODE_FAILED", error.Message);
            }
            finally
            {
                CompleteOutstanding();
            }
        }
    }

    private static async Task<EncodedSnapshot> EncodeAsync(QueuedFrame queued)
    {
        var size = queued.Frame.ContentSize;
        using var bitmap = await SoftwareBitmap.CreateCopyFromSurfaceAsync(
            queued.Frame.Surface,
            BitmapAlphaMode.Premultiplied);
        using var stream = new InMemoryRandomAccessStream();
        stream.Size = 0;
        var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
        encoder.SetSoftwareBitmap(bitmap);
        await encoder.FlushAsync();

        if (stream.Size == 0 || stream.Size > MaxSnapshotBytes)
            throw new WindowsBridgeOperationException("FRAME_ENCODE_BOUNDS", $"Encoded frame size {stream.Size} exceeds the Phase 15.7 snapshot bound");

        stream.Seek(0);
        var byteCount = checked((int)stream.Size);
        var bytes = new byte[byteCount];
        using var input = stream.GetInputStreamAt(0);
        using var reader = new DataReader(input);
        var loaded = await reader.LoadAsync((uint)byteCount);
        if (loaded != (uint)byteCount)
            throw new WindowsBridgeOperationException("FRAME_READ_INCOMPLETE", "Encoded PNG stream could not be read completely");
        reader.ReadBytes(bytes);
        var sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        return new EncodedSnapshot(queued.Sequence, queued.CapturedAt, size.Width, size.Height, bytes, sha256);
    }

    private void ReserveOutstanding()
    {
        lock (_stateGate)
        {
            if (_outstanding == 0) _idle = NewIdleSource();
            _outstanding++;
        }
    }

    private void CompleteOutstanding()
    {
        TaskCompletionSource<bool>? signal = null;
        lock (_stateGate)
        {
            if (_outstanding > 0) _outstanding--;
            if (_outstanding == 0) signal = _idle;
        }
        signal?.TrySetResult(true);
    }

    private void SetError(string code, string message)
    {
        lock (_stateGate)
        {
            _lastErrorCode = code;
            _lastErrorMessage = message;
        }
    }

    private static TaskCompletionSource<bool> CompletedIdleSource()
    {
        var source = NewIdleSource();
        source.TrySetResult(true);
        return source;
    }

    private static TaskCompletionSource<bool> NewIdleSource() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static string Required(string? value, string label)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException($"{label} is required", label);
        return value.Trim();
    }

    private sealed record QueuedFrame(Direct3D11CaptureFrame Frame, long Sequence, DateTime CapturedAt);
    private sealed record EncodedSnapshot(long Sequence, DateTime CapturedAt, int Width, int Height, byte[] Bytes, string Sha256);
}
