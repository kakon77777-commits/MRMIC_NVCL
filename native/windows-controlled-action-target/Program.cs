using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;

internal static class Program
{
    public const string WindowTitle = "MRMIC Phase 15.13 Controlled Action Target";
    public const string RootAutomationId = "MrmicControlledActionTargetRoot";
    public const string InvokeAutomationId = "MrmicInvokeButton";
    public const string ToggleAutomationId = "MrmicToggleCheckBox";
    public const string ValueAutomationId = "MrmicValueTextBox";
    public const string SelectAlphaAutomationId = "MrmicSelectItemAlpha";
    public const string SelectBetaAutomationId = "MrmicSelectItemBeta";
    public const string StatusAutomationId = "MrmicStatusText";

    [STAThread]
    private static void Main()
    {
        var app = new Application
        {
            ShutdownMode = ShutdownMode.OnMainWindowClose
        };
        app.Run(new ControlledActionWindow());
    }
}

internal sealed class ControlledActionWindow : Window
{
    private readonly TextBlock _status;
    private readonly CheckBox _toggle;
    private readonly TextBox _value;
    private readonly ListBox _selection;
    private readonly ListBoxItem _alpha;
    private readonly ListBoxItem _beta;
    private int _invokeCount;

    public ControlledActionWindow()
    {
        Title = Program.WindowTitle;
        Width = 720;
        Height = 520;
        MinWidth = 640;
        MinHeight = 460;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Background = Brushes.White;
        AutomationProperties.SetAutomationId(this, Program.RootAutomationId);
        AutomationProperties.SetName(this, Program.WindowTitle);

        var root = new StackPanel
        {
            Margin = new Thickness(28),
            Orientation = Orientation.Vertical
        };
        Content = root;

        root.Children.Add(new TextBlock
        {
            Text = "MRMIC Phase 15.13 Controlled Action Target",
            FontSize = 24,
            FontWeight = FontWeights.Bold,
            Margin = new Thickness(0, 0, 0, 18)
        });

        root.Children.Add(new TextBlock
        {
            Text = "Dedicated safe target for controlOwner-gated UI Automation E2E.",
            FontSize = 14,
            Margin = new Thickness(0, 0, 0, 18)
        });

        var invoke = new Button
        {
            Content = "Invoke action",
            Width = 180,
            Height = 40,
            HorizontalAlignment = HorizontalAlignment.Left,
            Margin = new Thickness(0, 0, 0, 12)
        };
        AutomationProperties.SetAutomationId(invoke, Program.InvokeAutomationId);
        AutomationProperties.SetName(invoke, "Invoke action");
        invoke.Click += (_, _) =>
        {
            _invokeCount += 1;
            UpdateStatus();
        };
        root.Children.Add(invoke);

        _toggle = new CheckBox
        {
            Content = "Toggle semantic state",
            IsChecked = false,
            FontSize = 16,
            Margin = new Thickness(0, 0, 0, 12)
        };
        AutomationProperties.SetAutomationId(_toggle, Program.ToggleAutomationId);
        AutomationProperties.SetName(_toggle, "Toggle semantic state");
        _toggle.Checked += (_, _) => UpdateStatus();
        _toggle.Unchecked += (_, _) => UpdateStatus();
        root.Children.Add(_toggle);

        root.Children.Add(new TextBlock
        {
            Text = "ValuePattern test input:",
            Margin = new Thickness(0, 0, 0, 4)
        });
        _value = new TextBox
        {
            Text = string.Empty,
            Width = 360,
            Height = 32,
            HorizontalAlignment = HorizontalAlignment.Left,
            Margin = new Thickness(0, 0, 0, 12)
        };
        AutomationProperties.SetAutomationId(_value, Program.ValueAutomationId);
        AutomationProperties.SetName(_value, "Controlled value input");
        _value.TextChanged += (_, _) => UpdateStatus();
        root.Children.Add(_value);

        root.Children.Add(new TextBlock
        {
            Text = "SelectionItemPattern test:",
            Margin = new Thickness(0, 0, 0, 4)
        });
        _selection = new ListBox
        {
            Width = 360,
            Height = 90,
            HorizontalAlignment = HorizontalAlignment.Left,
            Margin = new Thickness(0, 0, 0, 18)
        };
        AutomationProperties.SetAutomationId(_selection, "MrmicSelectListBox");
        AutomationProperties.SetName(_selection, "Controlled selection list");
        _alpha = new ListBoxItem { Content = "Alpha" };
        _beta = new ListBoxItem { Content = "Beta" };
        AutomationProperties.SetAutomationId(_alpha, Program.SelectAlphaAutomationId);
        AutomationProperties.SetAutomationId(_beta, Program.SelectBetaAutomationId);
        AutomationProperties.SetName(_alpha, "Alpha selection");
        AutomationProperties.SetName(_beta, "Beta selection");
        _selection.Items.Add(_alpha);
        _selection.Items.Add(_beta);
        _selection.SelectionChanged += (_, _) => UpdateStatus();
        _selection.SelectedItem = _alpha;
        root.Children.Add(_selection);

        _status = new TextBlock
        {
            FontFamily = new FontFamily("Consolas"),
            FontSize = 18,
            FontWeight = FontWeights.SemiBold,
            Padding = new Thickness(12),
            Background = Brushes.LightGray,
            TextWrapping = TextWrapping.Wrap
        };
        AutomationProperties.SetAutomationId(_status, Program.StatusAutomationId);
        root.Children.Add(_status);
        UpdateStatus();
    }

    private void UpdateStatus()
    {
        if (_status is null) return;
        var toggle = _toggle?.IsChecked == true ? "on" : "off";
        var selection = ReferenceEquals(_selection?.SelectedItem, _beta) ? "beta" : "alpha";
        var valueLength = _value?.Text.Length ?? 0;
        var text = $"invoke={_invokeCount};toggle={toggle};selection={selection};valueLength={valueLength}";
        _status.Text = text;
        AutomationProperties.SetName(_status, text);
    }
}
