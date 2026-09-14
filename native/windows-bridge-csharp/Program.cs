using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

internal static class Program
{
    private const string Protocol = "mrmic-windows-native-bridge/v1";
    private const int DwmwaCloaked = 14;
    private const int DwmCloakedApp = 0x1;
    private const int DwmCloakedShell = 0x2;
    private const int DwmCloakedInherited = 0x4;
    private static readonly string ProviderEpoch = Guid.NewGuid().ToString("N");
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private delegate bool EnumWindowsProc(nint hWnd, nint lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsProc callback, nint lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(nint hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(nint hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLengthW(nint hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextW(nint hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassNameW(nint hWnd, StringBuilder className, int maxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(nint hWnd, out uint processId);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(nint hWnd, int attribute, out int value, int valueSize);

    public static int Main()
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = new UTF8Encoding(false);
        if (!OperatingSystem.IsWindows())
        {
            Console.Error.WriteLine("MRMIC.WindowsBridge requires Windows.");
            return 2;
        }

        using var captures = new WindowsCaptureSessionManager(ProviderEpoch);
        string? line;
        while ((line = Console.ReadLine()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            HandleLine(line, captures);
        }
        return 0;
    }

    private static void HandleLine(string line, WindowsCaptureSessionManager captures)
    {
        string requestId = "unknown";
        try
        {
            using var document = JsonDocument.Parse(line);
            var root = document.RootElement;
            requestId = RequiredString(root, "requestId");
            var protocol = RequiredString(root, "protocol");
            if (!string.Equals(protocol, Protocol, StringComparison.Ordinal))
            {
                WriteFailure(requestId, "PROTOCOL_MISMATCH", "Windows native bridge protocol mismatch");
                return;
            }
            var method = RequiredString(root, "method");
            var parameters = RequiredObject(root, "params");
            switch (method)
            {
                case "capabilities":
                    WriteSuccess(requestId, Capabilities());
                    break;
                case "window.enumerate":
                    WriteSuccess(requestId, EnumerateWindows());
                    break;
                case "capture.mount":
                    WriteSuccess(requestId, captures.Mount(
                        RequiredString(parameters, "providerResourceId"),
                        RequiredString(parameters, "providerEpoch"),
                        RequiredString(parameters, "hwndHex"),
                        RequiredUInt32(parameters, "processId")));
                    break;
                case "capture.update":
                    WriteSuccess(requestId, captures.Update(
                        RequiredString(parameters, "mountId"),
                        RequiredString(parameters, "providerResourceId")));
                    break;
                case "capture.snapshot":
                    WriteSuccess(requestId, captures.ReadSnapshot(
                        RequiredString(parameters, "mountId"),
                        RequiredString(parameters, "providerResourceId")));
                    break;
                case "capture.unmount":
                    WriteSuccess(requestId, captures.Unmount(
                        RequiredString(parameters, "mountId"),
                        RequiredString(parameters, "providerResourceId")));
                    break;
                case "uia.inspect":
                case "uia.action":
                    WriteFailure(requestId, "UIA_NOT_IMPLEMENTED", "Phase 15.7 does not implement UI Automation yet");
                    break;
                default:
                    WriteFailure(requestId, "METHOD_NOT_FOUND", $"Unsupported Windows bridge method: {method}");
                    break;
            }
        }
        catch (WindowsBridgeOperationException error)
        {
            WriteFailure(requestId, error.Code, error.Message);
        }
        catch (Exception error)
        {
            WriteFailure(requestId, "INVALID_REQUEST", error.Message);
        }
    }

    private static object Capabilities() => new
    {
        schema = "windows_provider_capabilities_v1",
        provider = "windows",
        providerEpoch = ProviderEpoch,
        platform = "win32",
        capture = new
        {
            api = "windows_graphics_capture",
            supported = false,
            sessionLifecycleSupported = true,
            frameTransport = BoundedPngFrameTransport.TransportName,
            frameTransportSupported = true,
            maxActiveMounts = WindowsCaptureSessionManager.MaxActiveMounts,
            frameQueueCapacity = BoundedPngFrameTransport.QueueCapacity,
            maxSnapshotPixels = BoundedPngFrameTransport.MaxSnapshotPixels,
            maxSnapshotBytes = BoundedPngFrameTransport.MaxSnapshotBytes,
            minimumBuild = 18362,
            target = "hwnd"
        },
        automation = new
        {
            api = "uia",
            supported = false,
            semanticPatternsPreferred = true,
            inputInjectionFallback = false,
            interactiveDesktopRequiredForInjection = true
        }
    };

    private static List<object> EnumerateWindows()
    {
        var windows = new List<object>();
        if (!EnumWindows((hWnd, _) =>
        {
            var threadId = GetWindowThreadProcessId(hWnd, out var processId);
            var titleLength = Math.Max(0, GetWindowTextLengthW(hWnd));
            var titleBuffer = new StringBuilder(titleLength + 1);
            if (titleBuffer.Capacity > 0) _ = GetWindowTextW(hWnd, titleBuffer, titleBuffer.Capacity);
            var classBuffer = new StringBuilder(512);
            _ = GetClassNameW(hWnd, classBuffer, classBuffer.Capacity);
            windows.Add(new
            {
                hwndHex = $"0x{hWnd.ToInt64():x}",
                processId,
                threadId,
                title = titleBuffer.ToString(),
                className = classBuffer.ToString(),
                visible = IsWindowVisible(hWnd),
                minimized = IsIconic(hWnd),
                cloakState = CloakState(hWnd)
            });
            return true;
        }, 0))
        {
            throw new InvalidOperationException($"EnumWindows failed with Win32 error {Marshal.GetLastWin32Error()}");
        }
        return windows;
    }

    private static string CloakState(nint hWnd)
    {
        var result = DwmGetWindowAttribute(hWnd, DwmwaCloaked, out var cloaked, sizeof(int));
        if (result != 0) return "unknown";
        if (cloaked == 0) return "none";
        if ((cloaked & DwmCloakedApp) != 0) return "app";
        if ((cloaked & DwmCloakedShell) != 0) return "shell";
        if ((cloaked & DwmCloakedInherited) != 0) return "inherited";
        return "unknown";
    }

    private static JsonElement RequiredObject(JsonElement root, string property)
    {
        if (!root.TryGetProperty(property, out var element) || element.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException($"{property} is required");
        return element;
    }

    private static string RequiredString(JsonElement root, string property)
    {
        if (!root.TryGetProperty(property, out var element) || element.ValueKind != JsonValueKind.String)
            throw new InvalidOperationException($"{property} is required");
        var value = element.GetString();
        if (string.IsNullOrWhiteSpace(value)) throw new InvalidOperationException($"{property} is required");
        return value.Trim();
    }

    private static uint RequiredUInt32(JsonElement root, string property)
    {
        if (!root.TryGetProperty(property, out var element) || element.ValueKind != JsonValueKind.Number || !element.TryGetUInt32(out var value) || value == 0)
            throw new InvalidOperationException($"{property} must be a positive uint32");
        return value;
    }

    private static void WriteSuccess(string requestId, object result) => Write(new
    {
        protocol = Protocol,
        requestId,
        ok = true,
        result
    });

    private static void WriteFailure(string requestId, string code, string message) => Write(new
    {
        protocol = Protocol,
        requestId,
        ok = false,
        error = new { code, message }
    });

    private static void Write(object response)
    {
        Console.WriteLine(JsonSerializer.Serialize(response, JsonOptions));
        Console.Out.Flush();
    }
}
