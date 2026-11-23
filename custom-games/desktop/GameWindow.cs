using System.Runtime.InteropServices;
using System.ComponentModel;
using System.Diagnostics;
using System.Text.Json;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace TacticalMapWarGame;

public sealed class GameWindow : Form
{
    private const string GameHost = "game.tactical.local";
    private readonly WebView2 browser = new() { Dock = DockStyle.Fill };
    private readonly ToolStripStatusLabel updateStatus = new("Checking for updates...");
    private readonly ToolStripMenuItem checkUpdates = new("Check for updates");
    private readonly CancellationTokenSource lifetime = new();
    private readonly HttpClient updateClient = new() { Timeout = TimeSpan.FromMinutes(10) };
    private bool checkingUpdates;

    public GameWindow()
    {
        Text = "Tactical Map War Game";
        ClientSize = new Size(1440, 900);
        MinimumSize = new Size(800, 600);
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(browser);
        var menu = new MenuStrip();
        var gameMenu = new ToolStripMenuItem("Game");
        gameMenu.DropDownItems.Add(checkUpdates);
        menu.Items.Add(gameMenu);
        MainMenuStrip = menu;
        Controls.Add(menu);
        var status = new StatusStrip();
        status.Items.Add(updateStatus);
        Controls.Add(status);
        updateClient.DefaultRequestHeaders.UserAgent.ParseAdd("TacticalMapWarGame-Updater");
        checkUpdates.Click += async (_, _) => await CheckForUpdatesAsync(true);
        Shown += InitializeBrowser;
        FormClosed += (_, _) => { lifetime.Cancel(); updateClient.Dispose(); lifetime.Dispose(); };
    }

    private async void InitializeBrowser(object? sender, EventArgs e)
    {
        try
        {
            string content = Path.Combine(AppContext.BaseDirectory, "wwwroot");
            if (!File.Exists(Path.Combine(content, "index.html")) ||
                !File.Exists(Path.Combine(content, "game", "balance", "units.js")) ||
                !File.Exists(Path.Combine(content, "game", "balance", "rules.js")))
            {
                throw new FileNotFoundException("The installed game files are missing.");
            }

            string userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "TacticalMapWarGame", "WebView2");
            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, userData);
            await browser.EnsureCoreWebView2Async(environment);
            browser.CoreWebView2.SetVirtualHostNameToFolderMapping(
                GameHost, content, CoreWebView2HostResourceAccessKind.DenyCors);
            browser.CoreWebView2.NavigationStarting += (_, args) =>
            {
                if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out Uri? uri) ||
                    uri.Scheme != Uri.UriSchemeHttps || uri.Host != GameHost)
                    args.Cancel = true;
            };
            browser.CoreWebView2.NewWindowRequested += (_, args) => args.Handled = true;
            browser.CoreWebView2.Navigate($"https://{GameHost}/index.html");
            _ = CheckForUpdatesAsync(false);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show("Microsoft Edge WebView2 Runtime is required. Install it from Microsoft and try again.",
                Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or COMException or InvalidOperationException)
        {
            MessageBox.Show($"Could not start the game: {ex.Message}", Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private async Task CheckForUpdatesAsync(bool manual)
    {
        if (checkingUpdates) return;
        checkingUpdates = true;
        checkUpdates.Enabled = false;
        updateStatus.Text = "Checking for updates...";
        try
        {
            var service = new UpdateService(updateClient);
            Version current = typeof(GameWindow).Assembly.GetName().Version ?? new Version(1, 4, 0);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            timeout.CancelAfter(TimeSpan.FromSeconds(20));
            GameUpdate? update = await service.FindUpdateAsync(current, timeout.Token);
            if (update == null)
            {
                updateStatus.Text = "No newer game update available.";
                if (manual) MessageBox.Show("No newer game update is available.", Text);
                return;
            }
            updateStatus.Text = $"Update {update.Version} available.";
            if (MessageBox.Show($"Version {update.Version} is available. Download and install it now? The game will close.",
                Text, MessageBoxButtons.YesNo, MessageBoxIcon.Information) != DialogResult.Yes) return;
            var progress = new Progress<long>(bytes =>
            {
                if (!IsDisposed) updateStatus.Text = $"Downloading update: {bytes * 100 / update.Size}%";
            });
            string installer = await service.DownloadAsync(update, progress, lifetime.Token);
            var start = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "msiexec.exe"))
            {
                UseShellExecute = true
            };
            start.ArgumentList.Add("/i");
            start.ArgumentList.Add(installer);
            start.ArgumentList.Add("INSTALLFOLDER=" + AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar));
            bool desktopShortcut = Registry.GetValue(@"HKEY_LOCAL_MACHINE\Software\TacticalMapWarGame",
                "DesktopShortcut", null) != null;
            start.ArgumentList.Add("CREATE_DESKTOP_SHORTCUT=" + (desktopShortcut ? "1" : "0"));
            if (Process.Start(start) == null) throw new InvalidOperationException("Windows Installer did not start.");
            Close();
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        catch (Exception ex) when (ex is HttpRequestException or IOException or UnauthorizedAccessException or
            JsonException or InvalidOperationException or Win32Exception or OperationCanceledException or
            KeyNotFoundException or FormatException or ArgumentException)
        {
            updateStatus.Text = $"Update check failed: {ex.Message}";
            if (manual) MessageBox.Show(updateStatus.Text, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        finally
        {
            checkingUpdates = false;
            if (!IsDisposed) checkUpdates.Enabled = true;
        }
    }
}
