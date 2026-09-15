using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Automation;

internal sealed class WindowsUiaInspector
{
    public const int MaxDepth = 8;
    public const int MaxElements = 512;
    public const int MaxPatternsPerElement = 32;
    public const int MaxTextLength = 2048;

    private readonly string _providerEpoch;

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(nint hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(nint hWnd, out uint processId);

    public WindowsUiaInspector(string providerEpoch)
    {
        _providerEpoch = Required(providerEpoch, nameof(providerEpoch), 128);
    }

    public object Inspect(string providerResourceId, string providerEpoch, string hwndHex, uint processId)
    {
        var identity = ValidateIdentity(providerResourceId, providerEpoch, hwndHex, processId);
        AutomationElement root;
        try
        {
            root = AutomationElement.FromHandle(identity.Hwnd)
                ?? throw new WindowsBridgeOperationException("UIA_ROOT_UNAVAILABLE", "UI Automation could not resolve the target HWND");
        }
        catch (ElementNotAvailableException error)
        {
            throw new WindowsBridgeOperationException("UIA_ROOT_UNAVAILABLE", error.Message);
        }

        var rootSnapshot = SnapshotElement(root, depth: 0, parentRuntimeId: null);
        var elements = new List<object>();
        var queue = new Queue<(AutomationElement Element, int Depth, string ParentRuntimeId)>();
        queue.Enqueue((root, 0, rootSnapshot.RuntimeId));
        var truncated = false;
        var walker = TreeWalker.ControlViewWalker;

        while (queue.Count > 0 && elements.Count < MaxElements)
        {
            var current = queue.Dequeue();
            if (current.Depth >= MaxDepth) continue;

            AutomationElement? child;
            try
            {
                child = walker.GetFirstChild(current.Element);
            }
            catch (ElementNotAvailableException)
            {
                continue;
            }

            while (child is not null)
            {
                if (elements.Count >= MaxElements)
                {
                    truncated = true;
                    break;
                }

                AutomationElement? next = null;
                try
                {
                    next = walker.GetNextSibling(child);
                    var snapshot = SnapshotElement(child, current.Depth + 1, current.ParentRuntimeId);
                    elements.Add(snapshot.ToJson());
                    if (current.Depth + 1 < MaxDepth)
                    {
                        queue.Enqueue((child, current.Depth + 1, snapshot.RuntimeId));
                    }
                    else if (HasControlChild(walker, child))
                    {
                        truncated = true;
                    }
                }
                catch (ElementNotAvailableException)
                {
                    // UI trees are live. Disappearing descendants are omitted; the bounded
                    // snapshot remains valid for the root identity that was revalidated.
                }
                child = next;
            }
        }

        if (queue.Count > 0) truncated = true;
        return new
        {
            schema = "windows_uia_snapshot_v1",
            providerResourceId = identity.ProviderResourceId,
            capturedAt = DateTime.UtcNow.ToString("O"),
            maxDepth = MaxDepth,
            maxElements = MaxElements,
            maxPatternsPerElement = MaxPatternsPerElement,
            truncated,
            root = rootSnapshot.ToJson(),
            elements
        };
    }

    private static bool HasControlChild(TreeWalker walker, AutomationElement element)
    {
        try { return walker.GetFirstChild(element) is not null; }
        catch (ElementNotAvailableException) { return false; }
    }

    private static UiElementSnapshot SnapshotElement(AutomationElement element, int depth, string? parentRuntimeId)
    {
        var current = element.Current;
        var runtimeId = RuntimeId(element);
        var patterns = element.GetSupportedPatterns()
            .Select(pattern => Bounded(pattern.ProgrammaticName, 256))
            .Where(name => name.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .Take(MaxPatternsPerElement)
            .ToArray();

        object? bounds = Bounds(current.BoundingRectangle);
        return new UiElementSnapshot(
            runtimeId,
            depth,
            parentRuntimeId,
            Optional(current.Name),
            Optional(current.AutomationId),
            Optional(current.ClassName),
            Optional(current.ControlType?.ProgrammaticName),
            Optional(current.LocalizedControlType),
            current.ProcessId,
            current.NativeWindowHandle,
            current.IsEnabled,
            current.IsOffscreen,
            current.IsKeyboardFocusable,
            current.IsPassword,
            bounds,
            patterns);
    }

    private static string RuntimeId(AutomationElement element)
    {
        var values = element.GetRuntimeId();
        if (values is null || values.Length == 0)
            throw new WindowsBridgeOperationException("UIA_RUNTIME_ID_MISSING", "UI Automation element did not provide a runtime id");
        return string.Join('.', values.Select(value => value.ToString(System.Globalization.CultureInfo.InvariantCulture)));
    }

    private static object? Bounds(Rect rect)
    {
        if (rect.IsEmpty) return null;
        if (!double.IsFinite(rect.X) || !double.IsFinite(rect.Y) || !double.IsFinite(rect.Width) || !double.IsFinite(rect.Height)) return null;
        if (rect.Width < 0 || rect.Height < 0) return null;
        return new { x = rect.X, y = rect.Y, width = rect.Width, height = rect.Height };
    }

    private static string? Optional(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return Bounded(value.Trim(), MaxTextLength);
    }

    private static string Bounded(string? value, int max)
    {
        if (string.IsNullOrEmpty(value)) return string.Empty;
        return value.Length <= max ? value : value[..max];
    }

    private WindowIdentity ValidateIdentity(string providerResourceId, string providerEpoch, string hwndHex, uint processId)
    {
        var actualEpoch = Required(providerEpoch, nameof(providerEpoch), 128);
        if (!string.Equals(actualEpoch, _providerEpoch, StringComparison.Ordinal))
            throw new WindowsBridgeOperationException("STALE_PROVIDER_EPOCH", "Windows provider epoch is stale");

        var hwnd = ParseHwnd(hwndHex);
        if (!IsWindow(hwnd)) throw new WindowsBridgeOperationException("WINDOW_NOT_FOUND", "Windows UIA target HWND is no longer valid");
        _ = GetWindowThreadProcessId(hwnd, out var actualProcessId);
        if (actualProcessId == 0 || actualProcessId != processId)
            throw new WindowsBridgeOperationException("WINDOW_IDENTITY_MISMATCH", "Windows UIA target process no longer matches the requested resource");

        var normalizedHwnd = $"0x{hwnd.ToInt64():x}";
        var expectedResourceId = $"window:{_providerEpoch}:{processId}:{normalizedHwnd}";
        var actualResourceId = Required(providerResourceId, nameof(providerResourceId), 512);
        if (!string.Equals(actualResourceId, expectedResourceId, StringComparison.Ordinal))
            throw new WindowsBridgeOperationException("WINDOW_IDENTITY_MISMATCH", "Windows UIA target resource identity does not match providerEpoch + processId + HWND");

        return new WindowIdentity(hwnd, actualResourceId);
    }

    private static nint ParseHwnd(string hwndHex)
    {
        var normalized = Required(hwndHex, nameof(hwndHex), 32).ToLowerInvariant();
        if (!normalized.StartsWith("0x", StringComparison.Ordinal)
            || !long.TryParse(normalized.AsSpan(2), System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture, out var value)
            || value <= 0)
            throw new WindowsBridgeOperationException("INVALID_HWND", "hwndHex must be a positive hexadecimal HWND");
        return new nint(value);
    }

    private static string Required(string? value, string label, int max)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new WindowsBridgeOperationException("INVALID_REQUEST", $"{label} is required");
        var normalized = value.Trim();
        if (normalized.Length > max) throw new WindowsBridgeOperationException("INVALID_REQUEST", $"{label} exceeds {max} characters");
        return normalized;
    }

    private sealed record WindowIdentity(nint Hwnd, string ProviderResourceId);

    private sealed record UiElementSnapshot(
        string RuntimeId,
        int Depth,
        string? ParentRuntimeId,
        string? Name,
        string? AutomationId,
        string? ClassName,
        string? ControlType,
        string? LocalizedControlType,
        int ProcessId,
        int NativeWindowHandle,
        bool Enabled,
        bool Offscreen,
        bool KeyboardFocusable,
        bool Password,
        object? Bounds,
        string[] Patterns)
    {
        public object ToJson() => new
        {
            runtimeId = RuntimeId,
            depth = Depth,
            parentRuntimeId = ParentRuntimeId,
            name = Name,
            automationId = AutomationId,
            className = ClassName,
            controlType = ControlType,
            localizedControlType = LocalizedControlType,
            processId = ProcessId,
            nativeWindowHandle = NativeWindowHandle,
            enabled = Enabled,
            offscreen = Offscreen,
            keyboardFocusable = KeyboardFocusable,
            password = Password,
            bounds = Bounds,
            patterns = Patterns
        };
    }
}
