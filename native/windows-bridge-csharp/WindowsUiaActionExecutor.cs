using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Automation;

internal sealed class WindowsUiaActionExecutor
{
    public const int MaxSearchDepth = WindowsUiaInspector.MaxDepth;
    public const int MaxSearchElements = WindowsUiaInspector.MaxElements;
    public const int MaxValueLength = 2048;

    private readonly string _providerEpoch;

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(nint hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(nint hWnd, out uint processId);

    public WindowsUiaActionExecutor(string providerEpoch)
    {
        _providerEpoch = Required(providerEpoch, nameof(providerEpoch), 128);
    }

    public object Execute(
        string providerResourceId,
        string providerEpoch,
        string hwndHex,
        uint processId,
        JsonElement action)
    {
        var identity = ValidateIdentity(providerResourceId, providerEpoch, hwndHex, processId);
        var kind = RequiredString(action, "kind", 64);
        if (kind is not ("invoke" or "toggle" or "select" or "set_value"))
            throw new WindowsBridgeOperationException("UIA_ACTION_UNSUPPORTED", $"Unsupported UI Automation action: {kind}");

        var runtimeId = RequiredString(action, "runtimeId", 512);
        var expected = RequiredObject(action, "expected");
        var expectedProcessId = RequiredInt32(expected, "processId", allowZero: false);
        var expectedNativeWindowHandle = RequiredInt32(expected, "nativeWindowHandle", allowZero: true);
        var expectedAutomationId = OptionalString(expected, "automationId", WindowsUiaInspector.MaxTextLength);
        var expectedControlType = OptionalString(expected, "controlType", 512);

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

        var element = FindByRuntimeId(root, runtimeId)
            ?? throw new WindowsBridgeOperationException("UIA_ELEMENT_STALE", "The requested UI Automation runtime id is no longer present in the bounded control tree");
        VerifyExpectedElement(element, expectedProcessId, expectedNativeWindowHandle, expectedAutomationId, expectedControlType);

        try
        {
            if (!element.Current.IsEnabled)
                throw new WindowsBridgeOperationException("UIA_ELEMENT_DISABLED", "The requested UI Automation element is disabled");

            switch (kind)
            {
                case "invoke":
                    RequirePattern<InvokePattern>(element, InvokePattern.Pattern, "InvokePattern").Invoke();
                    break;
                case "toggle":
                    RequirePattern<TogglePattern>(element, TogglePattern.Pattern, "TogglePattern").Toggle();
                    break;
                case "select":
                    RequirePattern<SelectionItemPattern>(element, SelectionItemPattern.Pattern, "SelectionItemPattern").Select();
                    break;
                case "set_value":
                {
                    if (element.Current.IsPassword)
                        throw new WindowsBridgeOperationException("UIA_PASSWORD_VALUE_DENIED", "Phase 15.12 does not set values on password elements");
                    var value = RequiredActionValue(action);
                    var pattern = RequirePattern<ValuePattern>(element, ValuePattern.Pattern, "ValuePattern");
                    if (pattern.Current.IsReadOnly)
                        throw new WindowsBridgeOperationException("UIA_VALUE_READ_ONLY", "The requested UI Automation value is read-only");
                    pattern.SetValue(value);
                    break;
                }
            }
        }
        catch (WindowsBridgeOperationException)
        {
            throw;
        }
        catch (ElementNotAvailableException error)
        {
            throw new WindowsBridgeOperationException("UIA_ELEMENT_STALE", error.Message);
        }
        catch (ElementNotEnabledException error)
        {
            throw new WindowsBridgeOperationException("UIA_ELEMENT_DISABLED", error.Message);
        }
        catch (InvalidOperationException error)
        {
            throw new WindowsBridgeOperationException("UIA_ACTION_FAILED", error.Message);
        }
        catch (COMException error)
        {
            throw new WindowsBridgeOperationException("UIA_ACTION_FAILED", error.Message);
        }

        object actionResult = kind == "set_value"
            ? new { kind, runtimeId, value = "[redacted]" }
            : new { kind, runtimeId };
        return new
        {
            schema = "windows_uia_action_result_v1",
            ok = true,
            providerResourceId = identity.ProviderResourceId,
            action = actionResult,
            completedAt = DateTime.UtcNow.ToString("O")
        };
    }

    private static T RequirePattern<T>(AutomationElement element, AutomationPattern pattern, string name)
        where T : class
    {
        if (!element.TryGetCurrentPattern(pattern, out var raw) || raw is not T typed)
            throw new WindowsBridgeOperationException("UIA_PATTERN_UNAVAILABLE", $"The requested element does not support {name}");
        return typed;
    }

    private static AutomationElement? FindByRuntimeId(AutomationElement root, string runtimeId)
    {
        if (string.Equals(RuntimeId(root), runtimeId, StringComparison.Ordinal)) return root;
        var walker = TreeWalker.ControlViewWalker;
        var queue = new Queue<(AutomationElement Element, int Depth)>();
        queue.Enqueue((root, 0));
        var visited = 0;

        while (queue.Count > 0 && visited < MaxSearchElements)
        {
            var current = queue.Dequeue();
            if (current.Depth >= MaxSearchDepth) continue;
            AutomationElement? child;
            try { child = walker.GetFirstChild(current.Element); }
            catch (ElementNotAvailableException) { continue; }

            while (child is not null && visited < MaxSearchElements)
            {
                AutomationElement? next = null;
                try
                {
                    next = walker.GetNextSibling(child);
                    visited++;
                    if (string.Equals(RuntimeId(child), runtimeId, StringComparison.Ordinal)) return child;
                    if (current.Depth + 1 < MaxSearchDepth) queue.Enqueue((child, current.Depth + 1));
                }
                catch (ElementNotAvailableException)
                {
                    // Live UI tree changed while searching; omit the disappeared element.
                }
                child = next;
            }
        }
        return null;
    }

    private static void VerifyExpectedElement(
        AutomationElement element,
        int expectedProcessId,
        int expectedNativeWindowHandle,
        string? expectedAutomationId,
        string? expectedControlType)
    {
        var current = element.Current;
        if (current.ProcessId != expectedProcessId || current.NativeWindowHandle != expectedNativeWindowHandle)
            throw new WindowsBridgeOperationException("UIA_ELEMENT_IDENTITY_MISMATCH", "UI Automation element process/native-window facts changed since inspection");
        if (expectedAutomationId is not null && !string.Equals(current.AutomationId, expectedAutomationId, StringComparison.Ordinal))
            throw new WindowsBridgeOperationException("UIA_ELEMENT_IDENTITY_MISMATCH", "UI Automation AutomationId changed since inspection");
        var actualControlType = current.ControlType?.ProgrammaticName;
        if (expectedControlType is not null && !string.Equals(actualControlType, expectedControlType, StringComparison.Ordinal))
            throw new WindowsBridgeOperationException("UIA_ELEMENT_IDENTITY_MISMATCH", "UI Automation control type changed since inspection");
    }

    private WindowIdentity ValidateIdentity(string providerResourceId, string providerEpoch, string hwndHex, uint processId)
    {
        var actualEpoch = Required(providerEpoch, nameof(providerEpoch), 128);
        if (!string.Equals(actualEpoch, _providerEpoch, StringComparison.Ordinal))
            throw new WindowsBridgeOperationException("STALE_PROVIDER_EPOCH", "Windows provider epoch is stale");

        var hwnd = ParseHwnd(hwndHex);
        if (!IsWindow(hwnd)) throw new WindowsBridgeOperationException("WINDOW_NOT_FOUND", "Windows UIA action target HWND is no longer valid");
        _ = GetWindowThreadProcessId(hwnd, out var actualProcessId);
        if (actualProcessId == 0 || actualProcessId != processId)
            throw new WindowsBridgeOperationException("WINDOW_IDENTITY_MISMATCH", "Windows UIA action target process no longer matches the requested resource");

        var normalizedHwnd = $"0x{hwnd.ToInt64():x}";
        var expectedResourceId = $"window:{_providerEpoch}:{processId}:{normalizedHwnd}";
        var actualResourceId = Required(providerResourceId, nameof(providerResourceId), 512);
        if (!string.Equals(actualResourceId, expectedResourceId, StringComparison.Ordinal))
            throw new WindowsBridgeOperationException("WINDOW_IDENTITY_MISMATCH", "Windows UIA action target resource identity does not match providerEpoch + processId + HWND");
        return new WindowIdentity(hwnd, actualResourceId);
    }

    private static string RuntimeId(AutomationElement element)
    {
        var values = element.GetRuntimeId();
        if (values is null || values.Length == 0)
            throw new WindowsBridgeOperationException("UIA_RUNTIME_ID_MISSING", "UI Automation element did not provide a runtime id");
        return string.Join('.', values.Select(value => value.ToString(System.Globalization.CultureInfo.InvariantCulture)));
    }

    private static string RequiredActionValue(JsonElement action)
    {
        if (!action.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.String)
            throw new WindowsBridgeOperationException("INVALID_REQUEST", "set_value action requires value");
        var text = value.GetString() ?? string.Empty;
        if (text.Length > MaxValueLength)
            throw new WindowsBridgeOperationException("INVALID_REQUEST", $"set_value exceeds {MaxValueLength} characters");
        if (text.Contains('\0')) throw new WindowsBridgeOperationException("INVALID_REQUEST", "set_value contains an invalid null character");
        return text;
    }

    private static JsonElement RequiredObject(JsonElement root, string property)
    {
        if (!root.TryGetProperty(property, out var element) || element.ValueKind != JsonValueKind.Object)
            throw new WindowsBridgeOperationException("INVALID_REQUEST", $"{property} is required");
        return element;
    }

    private static string RequiredString(JsonElement root, string property, int max)
    {
        if (!root.TryGetProperty(property, out var element) || element.ValueKind != JsonValueKind.String)
            throw new WindowsBridgeOperationException("INVALID_REQUEST", $"{property} is required");
        return Required(element.GetString(), property, max);
    }

    private static string? OptionalString(JsonElement root, string property, int max)
    {
        if (!root.TryGetProperty(property, out var element) || element.ValueKind == JsonValueKind.Null) return null;
        if (element.ValueKind != JsonValueKind.String)
            throw new WindowsBridgeOperationException("INVALID_REQUEST", $"{property} must be string or null");
        var value = element.GetString();
        if (string.IsNullOrEmpty(value)) return null;
        return value.Length <= max ? value : throw new WindowsBridgeOperationException("INVALID_REQUEST", $"{property} exceeds {max} characters");
    }

    private static int RequiredInt32(JsonElement root, string property, bool allowZero)
    {
        if (!root.TryGetProperty(property, out var element) || element.ValueKind != JsonValueKind.Number || !element.TryGetInt32(out var value))
            throw new WindowsBridgeOperationException("INVALID_REQUEST", $"{property} must be int32");
        if (allowZero ? value < 0 : value <= 0)
            throw new WindowsBridgeOperationException("INVALID_REQUEST", $"{property} is outside the allowed range");
        return value;
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
}
