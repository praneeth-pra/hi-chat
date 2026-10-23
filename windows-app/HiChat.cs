// Hi-chat for Windows: the Hi-chat site in its own window, with a few
// global shortcuts:
//
//   tap Left Ctrl                 dictate: tap again to stop and send
//   tap Right Ctrl                silent screenshot of the laptop's own screen
//                                 (or, with none, the one the pointer is on),
//                                 sent in Hi-chat (also saved to
//                                 Pictures\Screenshots and copied)
//   Escape while dictating        throw the recording away
//   Z / X                         pointer to Hi-chat's message box (typing on)
//                                 / pointer and keyboard back to where they were
//   Alt + Z / X                   types the letter
//                                 (Z leaves a lookalike of the pointer where
//                                 it was; X puts the pointer back on it)
//   Page Up / Down (Fn + Up / Down
//   on most laptops)              Hi-chat's code block above / below;
//                                 with Shift, scroll the chat a screen
//   Alt + scroll                  scroll Hi-chat from anywhere (wheel or
//                                 two fingers on the touchpad)
//   Ctrl + Left                   live mirror window: Hi-chat, pressed
//                                 again the screen around the pointer, and
//                                 back; Ctrl + Shift + Left closes it
//
// Those are the defaults: each can be changed in Hi-chat's Settings > App
// keys, which records the next keys you press (see ShortcutStore).
//
// With a monitor connected the window goes on it, otherwise on the laptop's
// own screen (see PlaceOnHomeScreen). Unplugging the monitor hides it until
// the monitor is back or you open Hi-chat (see MonitorsChanged).
//
// A click in Hi-chat doesn't take the keyboard from the app you're in;
// clicking into a text box (or Z) does. Closing the window
// keeps Hi-chat running beside the clock, so the shortcuts keep working.
//
// The first run installs it for this Windows user (no admin needed) in
// %LOCALAPPDATA%\Programs\Hi-chat with a Start menu entry. New versions:
// Hi-chat asks once when one is out, then swaps itself and restarts.
//
// Build: .github/workflows/windows-app.yml (dotnet build, one Hi-chat.exe of
// about 1 MB on .NET Framework 4.8, which Windows 10 and 11 come with; see
// Compat.cs for what stands in for the .NET 8 parts).

using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

// Windows' own DLLs (hid.dll, Magnification.dll) only ever come from System32,
// never from a copy planted next to Hi-chat.exe
[assembly: DefaultDllImportSearchPaths(DllImportSearchPath.System32)]

namespace HiChat;

static class App
{
  public const string AppHost = "chat.hi-techie.dev";
  public static readonly Uri HomeUrl = new("https://chat.hi-techie.dev/");
  public const string Repo = "praneeth-pra/hi-chat";
  public static readonly string InstallDir = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Hi-chat");
  public static readonly string InstalledExe = Path.Combine(InstallDir, "Hi-chat.exe");
  public static readonly string DataDir = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Hi-chat");
  const string ShowEventName = "dev.hitechie.hichat.show";
  const string QuitEventName = "dev.hitechie.hichat.quit";

  public static string Version
  {
    get
    {
      var v = Assembly.GetEntryAssembly()?.GetName().Version;
      return v == null ? "0" : $"{v.Major}.{v.Minor}.{v.Build}";
    }
  }

  public static bool IsOurs(Uri? uri) =>
    uri != null && uri.Scheme == Uri.UriSchemeHttps && uri.Host == AppHost && uri.IsDefaultPort;

  public static void OpenInBrowser(string url)
  {
    if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return;
    if (uri.Scheme is not ("https" or "http" or "mailto")) return;
    try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
    catch (Exception e) { Debug.WriteLine($"Hi-chat: couldn't open {uri}: {e.Message}"); }
  }

  [STAThread]
  static void Main(string[] args)
  {
    // WebView2's DLLs are inside Hi-chat.exe: load them from there. Before
    // anything that uses them, so Run is its own method.
    Packed.Use();
    Run(args);
  }

  [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
  static void Run(string[] args)
  {
    // After an update: the old copy is still quitting.
    var after = Array.IndexOf(args, "--after");
    if (after >= 0 && after + 1 < args.Length && int.TryParse(args[after + 1], out var pid))
    {
      try { Process.GetProcessById(pid).WaitForExit(15000); } catch { }
    }

    using var single = new Mutex(true, "dev.hitechie.hichat", out var first);
    using var show = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
    using var quit = new EventWaitHandle(false, EventResetMode.AutoReset, QuitEventName);
    if (!first && !IsInstalledCopy())
    {
      // A downloaded copy replaces the Hi-chat that is running: that one
      // quits (it may only be in the tray), then this one installs itself.
      quit.Set();
      try { first = single.WaitOne(TimeSpan.FromSeconds(15)); }
      catch (AbandonedMutexException) { first = true; }
    }
    if (!first)
    {
      show.Set(); // Hi-chat is already running: bring its window up
      return;
    }
    if (InstallIfNeeded()) return;
    // WebView2's loader, packed into Hi-chat.exe, from where Packed wrote it
    if (Packed.LoaderFolder() is { } loader) CoreWebView2Environment.SetLoaderDllFolderPath(loader);
    try { File.Delete(InstalledExe + ".old"); } catch { }

    // Per-monitor DPI comes from app.manifest
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    var window = new ChatWindow();
    var waiter = new Thread(() =>
    {
      WaitHandle[] events = [show, quit];
      while (true)
      {
        var quitting = WaitHandle.WaitAny(events) == 1;
        try
        {
          if (quitting) window.BeginInvoke(window.Quit);
          else window.BeginInvoke(window.ShowChat);
        }
        catch { return; }
        if (quitting) return;
      }
    }) { IsBackground = true };
    waiter.Start();
    Application.Run(window);
  }

  /// First run from a download: copy into the user's Programs folder, add a
  /// Start menu entry and start that copy. True when this copy should quit.
  static bool IsInstalledCopy()
  {
    var here = Compat.ExePath;
    return here == null || string.Equals(Path.GetFullPath(here), InstalledExe, StringComparison.OrdinalIgnoreCase);
  }

  static bool InstallIfNeeded()
  {
    if (IsInstalledCopy()) return false;
    var here = Compat.ExePath!;
    try
    {
      Directory.CreateDirectory(InstallDir);
      // The Hi-chat that just quit can hold its file for a moment
      for (var tries = 0; ; tries++)
      {
        try { File.Copy(here, InstalledExe, true); break; }
        catch (IOException) when (tries < 10) { Thread.Sleep(500); }
      }
      var menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Hi-chat.lnk");
      var shell = Type.GetTypeFromProgID("WScript.Shell");
      if (shell != null)
      {
        dynamic ws = Activator.CreateInstance(shell)!;
        dynamic link = ws.CreateShortcut(menu);
        link.TargetPath = InstalledExe;
        link.WorkingDirectory = InstallDir;
        link.Description = "Hi-chat";
        link.Save();
      }
      Process.Start(new ProcessStartInfo(InstalledExe) { UseShellExecute = true });
      return true;
    }
    catch (Exception e)
    {
      Debug.WriteLine($"Hi-chat: install failed, running from here: {e.Message}");
      return false;
    }
  }
}

/// Window sizes and the version skipped, in %LOCALAPPDATA%\Hi-chat\settings.json.
sealed class Settings
{
  public int[]? Window { get; set; }
  /// Where the window last was on a monitor, and on the laptop's own screen
  public int[]? WindowOnMonitor { get; set; }
  public int[]? WindowOnLaptop { get; set; }
  public int[]? MirrorOnMonitor { get; set; }
  public int[]? MirrorOnLaptop { get; set; }
  public int[]? Mirror { get; set; }
  public string? SkippedVersion { get; set; }
  /// Settings > App keys: the shortcuts changed there, by action
  public Dictionary<string, string[]>? Shortcuts { get; set; }

  static string FilePath => Path.Combine(App.DataDir, "settings.json");
  public static Settings Current { get; } = Load();

  static Settings Load()
  {
    try { return Json.Read<Settings>(File.ReadAllText(FilePath)) ?? new(); }
    catch { return new(); }
  }

  public void Save()
  {
    try
    {
      Directory.CreateDirectory(App.DataDir);
      File.WriteAllText(FilePath, Json.Write(this));
    }
    catch (Exception e) { Debug.WriteLine($"Hi-chat: settings not saved: {e.Message}"); }
  }

  public static int[] Pack(Rectangle r) => [r.X, r.Y, r.Width, r.Height];

  /// A saved place, if it is still on one of the screens.
  public static Rectangle? Unpack(int[]? v)
  {
    if (v is not { Length: 4 }) return null;
    var r = new Rectangle(v[0], v[1], v[2], v[3]);
    return Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(r)) ? r : null;
  }
}

sealed class ChatWindow : Form
{
  readonly WebView2 webView = new() { Dock = DockStyle.Fill };
  readonly NotifyIcon tray = new();
  readonly ToolStripMenuItem loginItem = new("Open at login");
  readonly Mirror mirror;
  readonly Updater updater;
  Shortcuts? keys;
  readonly TouchpadScroll touchpad;
  bool quitting;
  /// On while Hi-chat has the keyboard from Z or a click in a box,
  /// until it goes back or another window takes it. The page shows it by
  /// the message box. Set on the window's thread only.
  public bool Typing
  {
    get => typing;
    set
    {
      if (typing == value) return;
      typing = value;
      TellPageTyping();
    }
  }
  volatile bool typing;

  void TellPageTyping() => _ = webView.CoreWebView2?.ExecuteScriptAsync(
    $"window.hiChatTyping && window.hiChatTyping({(typing ? "true" : "false")})");
  IntPtr typingReturnTo;

  public bool Dictating => keys?.Dictating == true;

  public ChatWindow()
  {
    touchpad = new TouchpadScroll(px => ScrollChatBy(px));
    Text = "Hi-chat";
    Icon = LoadIcon();
    var dark = DarkMode();
    // The colour of Hi-chat's sidebar, so the window never flashes white
    BackColor = dark ? Color.FromArgb(13, 13, 13) : Color.FromArgb(249, 249, 249);
    webView.DefaultBackgroundColor = BackColor;
    MinimumSize = new Size(420, 360);
    StartPosition = FormStartPosition.Manual;
    var saved = Settings.Unpack(Settings.Current.Window);
    if (saved is { } r) Bounds = r;
    else
    {
      var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 900);
      Size = new Size(Math.Min(1000, area.Width), Math.Min(800, area.Height));
      Location = new Point(area.X + (area.Width - Width) / 2, area.Y + (area.Height - Height) / 2);
    }
    PlaceOnHomeScreen();
    hadMonitor = MonitorConnected();
    // A monitor plugged in or out: wait for Windows to settle the screens first
    placeTimer.Tick += (_, _) => { placeTimer.Stop(); MonitorsChanged(); };
    SystemEvents.DisplaySettingsChanged += OnDisplaysChanged;
    Controls.Add(webView);
    mirror = new Mirror(this);
    updater = new Updater(this);
    BuildTray();
  }

  static Icon LoadIcon()
  {
    using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("AppIcon.ico");
    return s != null ? new Icon(s) : SystemIcons.Application;
  }

  static bool DarkMode()
  {
    var v = Registry.GetValue(
      @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1);
    return v is int i && i == 0;
  }

  // A click doesn't take the keyboard from the app in front (see WndProc);
  // the window still shows in the taskbar.
  protected override bool ShowWithoutActivation => true;

  protected override CreateParams CreateParams
  {
    get
    {
      var p = base.CreateParams;
      p.ExStyle |= Native.WS_EX_NOACTIVATE | Native.WS_EX_APPWINDOW;
      return p;
    }
  }

  protected override void WndProc(ref Message m)
  {
    if (m.Msg == Native.WM_MOUSEACTIVATE && !Typing)
    {
      m.Result = (IntPtr)Native.MA_NOACTIVATE;
      return;
    }
    if (m.Msg == Native.WM_INPUT) touchpad.Input(m.LParam);
    base.WndProc(ref m);
  }

  protected override async void OnHandleCreated(EventArgs e)
  {
    base.OnHandleCreated(e);
    touchpad.Listen(Handle);
    if (DarkMode())
    {
      var on = 1;
      Native.DwmSetWindowAttribute(Handle, Native.DWMWA_USE_IMMERSIVE_DARK_MODE, ref on, sizeof(int));
    }
    await StartWebView();
  }

  protected override void OnShown(EventArgs e)
  {
    base.OnShown(e);
    keys = new Shortcuts(this);
    keys.Start();
    updater.Start();
  }

  protected override void OnDeactivate(EventArgs e)
  {
    base.OnDeactivate(e);
    Typing = false;
    typingReturnTo = IntPtr.Zero;
    // The keyboard went to another app (a click there, say): the lookalike
    // would only mislead now. Hi-chat's own windows don't count.
    BeginInvoke(() =>
    {
      Native.GetWindowThreadProcessId(Native.GetForegroundWindow(), out var pid);
      if (pid != Compat.ProcessId) PointerForget();
    });
  }

  readonly System.Windows.Forms.Timer placeTimer = new() { Interval = 700 };

  void OnDisplaysChanged(object? sender, EventArgs e)
  {
    if (IsHandleCreated) BeginInvoke(() => { placeTimer.Stop(); placeTimer.Start(); });
  }

  /// Whether a monitor was connected at the last check.
  bool hadMonitor;
  /// Hidden because its monitor was unplugged; it comes back with the monitor.
  bool hiddenWithMonitor;

  static bool MonitorConnected()
  {
    var builtIn = Displays.BuiltInScreens();
    return Screen.AllScreens.Any(s => !builtIn.Contains(Displays.Name(s)));
  }

  /// Plugged in: Hi-chat goes on the monitor (back in view if unplugging hid
  /// it). Unplugged: Hi-chat hides rather than landing on the laptop's
  /// screen; opening it from the tray or a shortcut shows it there.
  void MonitorsChanged()
  {
    var monitor = MonitorConnected();
    var had = hadMonitor;
    hadMonitor = monitor;
    if (monitor)
    {
      PlaceOnHomeScreen();
      if (hiddenWithMonitor) BringUp();
    }
    else if (had && Visible)
    {
      hiddenWithMonitor = true;
      Hide();
    }
    mirror.MonitorsChanged(monitor, had);
  }

  /// With a monitor connected Hi-chat goes on it, otherwise on the laptop's
  /// own screen, back where it last was there. Run at start, when a monitor
  /// is plugged in or out, and whenever Hi-chat brings its window up; a
  /// window already on the right kind of screen stays where it is.
  public void PlaceOnHomeScreen()
  {
    if (WindowState == FormWindowState.Minimized) return;
    var builtIn = Displays.BuiltInScreens();
    bool inside(Screen s) => builtIn.Contains(Displays.Name(s));
    var screens = Screen.AllScreens;
    var target = screens.Where(s => !inside(s))
      .OrderByDescending(s => (long)s.Bounds.Width * s.Bounds.Height)
      .FirstOrDefault() ?? screens.FirstOrDefault(inside) ?? Screen.PrimaryScreen;
    if (target == null) return;
    var onMonitor = !inside(target);
    var place = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
    var now = Screen.FromRectangle(place);
    if (now.WorkingArea.IntersectsWith(place) && inside(now) != onMonitor) return;

    var area = target.WorkingArea;
    var saved = Settings.Unpack(onMonitor ? Settings.Current.WindowOnMonitor : Settings.Current.WindowOnLaptop);
    var r = saved is { } s && area.IntersectsWith(s)
      ? s
      : new Rectangle(area.X + (area.Width - place.Width) / 2, area.Y + (area.Height - place.Height) / 2,
          place.Width, place.Height);
    // Fits the screen: no bigger than it, and wholly on it
    r.Width = Math.Min(r.Width, area.Width);
    r.Height = Math.Min(r.Height, area.Height);
    r.X = Compat.Clamp(r.X, area.Left, area.Right - r.Width);
    r.Y = Compat.Clamp(r.Y, area.Top, area.Bottom - r.Height);
    var maximized = WindowState == FormWindowState.Maximized;
    if (maximized) WindowState = FormWindowState.Normal;
    Bounds = r;
    if (maximized) WindowState = FormWindowState.Maximized;
  }

  /// Keeps where the window is, for the kind of screen it's on.
  void RememberPlace()
  {
    if (WindowState != FormWindowState.Normal) return;
    var packed = Settings.Pack(Bounds);
    Settings.Current.Window = packed;
    if (Displays.BuiltInScreens().Contains(Displays.Name(Screen.FromControl(this))))
      Settings.Current.WindowOnLaptop = packed;
    else
      Settings.Current.WindowOnMonitor = packed;
    Settings.Current.Save();
  }

  protected override void OnResizeEnd(EventArgs e)
  {
    base.OnResizeEnd(e);
    RememberPlace();
  }

  protected override void OnFormClosed(FormClosedEventArgs e)
  {
    SystemEvents.DisplaySettingsChanged -= OnDisplaysChanged;
    base.OnFormClosed(e);
  }

  protected override void OnFormClosing(FormClosingEventArgs e)
  {
    RememberPlace();
    // Closing the window keeps Hi-chat running for the shortcuts; Quit ends it.
    if (!quitting && e.CloseReason == CloseReason.UserClosing)
    {
      e.Cancel = true;
      Hide();
      return;
    }
    base.OnFormClosing(e);
  }

  public void Quit()
  {
    quitting = true;
    keys?.Stop();
    mirror.Close();
    tray.Visible = false;
    Close();
    Application.Exit();
  }

  // MARK: Tray

  void BuildTray()
  {
    var menu = new ContextMenuStrip();
    menu.Items.Add("Show Hi-chat", null, (_, _) => ShowChat());
    menu.Items.Add("Reload", null, (_, _) => webView.CoreWebView2?.Reload());
    loginItem.Click += (_, _) => ToggleLogin();
    loginItem.Checked = OpensAtLogin();
    menu.Items.Add(loginItem);
    menu.Items.Add("Check for updates", null, async (_, _) => await updater.Check(asked: true));
    menu.Items.Add(new ToolStripSeparator());
    menu.Items.Add("Quit Hi-chat", null, (_, _) => Quit());
    tray.Icon = Icon;
    tray.Text = "Hi-chat";
    tray.ContextMenuStrip = menu;
    tray.DoubleClick += (_, _) => ShowChat();
    tray.Visible = true;
  }

  const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

  static bool OpensAtLogin()
  {
    using var key = Registry.CurrentUser.OpenSubKey(RunKey);
    return key?.GetValue("Hi-chat") != null;
  }

  void ToggleLogin()
  {
    using var key = Registry.CurrentUser.CreateSubKey(RunKey);
    if (OpensAtLogin()) key.DeleteValue("Hi-chat", false);
    else key.SetValue("Hi-chat", $"\"{Compat.ExePath}\"");
    loginItem.Checked = OpensAtLogin();
  }

  // MARK: Page

  async Task StartWebView()
  {
    CoreWebView2Environment env;
    try
    {
      // The page keeps full speed while the window is hidden or covered:
      // a reply being mirrored to /mirror otherwise reaches the other screen
      // in bursts, as Chromium slows background pages' timers down.
      env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(App.DataDir, "WebView2"),
        new CoreWebView2EnvironmentOptions(
          "--autoplay-policy=no-user-gesture-required" +
          " --disable-background-timer-throttling" +
          " --disable-renderer-backgrounding" +
          " --disable-backgrounding-occluded-windows"));
      await webView.EnsureCoreWebView2Async(env);
    }
    catch (WebView2RuntimeNotFoundException)
    {
      MessageBox.Show(this, "Hi-chat needs Microsoft Edge WebView2, which comes with Windows 10 and 11. " +
        "Install it from Microsoft and open Hi-chat again.", "Hi-chat");
      App.OpenInBrowser("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
      Quit();
      return;
    }
    var core = webView.CoreWebView2;
    core.Settings.UserAgent += " HiChatWindows";
    core.Settings.IsStatusBarEnabled = false;
    // A click into a text box takes the keyboard (see WndProc)
    await core.AddScriptToExecuteOnDocumentCreatedAsync($$"""
      (() => {
        if (location.protocol !== 'https:' || location.host !== '{{App.AppHost}}') return
        addEventListener('pointerdown', (e) => {
          const t = e.target
          if (t instanceof Element && t.closest('textarea, input, select, [contenteditable]:not([contenteditable="false"])'))
            chrome.webview.postMessage({ keyboard: true })
        }, true)
      })()
      """);
    core.WebMessageReceived += OnMessage;
    core.PermissionRequested += (_, e) =>
    {
      // The microphone, and the rest, only for Hi-chat itself
      var ours = Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) && App.IsOurs(uri);
      e.State = ours ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
    };
    core.NavigationStarting += (_, e) =>
    {
      // Only Hi-chat itself loads in the window. Any other page opens in your
      // browser, so no other site can look like Hi-chat here, get the
      // microphone or reach the app's bridge.
      if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)) { e.Cancel = true; return; }
      if (App.IsOurs(uri) || uri.Scheme is "about" or "blob" or "data") return;
      e.Cancel = true;
      App.OpenInBrowser(e.Uri);
    };
    core.NewWindowRequested += (_, e) =>
    {
      e.Handled = true;
      App.OpenInBrowser(e.Uri);
    };
    core.ProcessFailed += (_, e) =>
    {
      if (e.ProcessFailedKind != CoreWebView2ProcessFailedKind.BrowserProcessExited)
        BeginInvoke(() => webView.CoreWebView2?.Reload());
    };
    // A reload starts the page afresh: tell it again whether typing is on
    core.NavigationCompleted += (_, _) => { if (typing) TellPageTyping(); };
    core.Navigate(App.HomeUrl.AbsoluteUri);
  }

  void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
  {
    // Only Hi-chat's own page may talk to the app
    if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var source) || !App.IsOurs(source)) return;
    try
    {
      if (Json.Object(Json.Parse(e.WebMessageAsJson)) is not { } body) return;
      if (Json.String(body, "dictation") is { } status)
      {
        if (keys != null) keys.Dictating = status is "recording" or "starting";
        // Started from the page's own mic button or a shortcut alike
        if (status is "starting" or "recording" or "transcribing") BringUp();
      }
      // Settings > General > Check for updates
      if (Json.True(body, "checkForUpdates"))
        _ = updater.Check(asked: true);
      if (Json.True(body, "keyboard") && !Typing)
        StartTyping(focusBox: false);
      // Settings > App keys
      if (Json.String(body, "shortcuts") is { } command)
        ShortcutCommand(command, Json.String(body, "id"));
    }
    catch (ArgumentException) { } // not JSON
    catch (InvalidOperationException) { }
  }

  /// Settings > App keys: list, record (the next keys pressed), cancel,
  /// clear or reset (one action, or all with no id).
  void ShortcutCommand(string command, string? id)
  {
    var action = ShortcutStore.Parse(id);
    var store = ShortcutStore.Current;
    switch (command)
    {
      case "record" when action != null && keys != null: keys.Recording = action; break;
      case "cancel" when keys != null: keys.Recording = null; break;
      case "clear" when action is { } a: store.Clear(a); break;
      case "reset": store.Reset(action); break;
    }
    SendShortcuts();
  }

  public void SendShortcuts() => _ = webView.CoreWebView2?.ExecuteScriptAsync(
    $"window.hiChatShortcuts && window.hiChatShortcuts({ShortcutStore.Current.Json(keys?.Recording)})");

  /// Runs one of the page's remote keys (see web-app/src/lib/remoteKeys.ts).
  public void Remote(string key)
  {
    // Dictating or sending is asking a question: bring the window up to show it.
    if (key is "F14" or "F15") BringUp();
    _ = webView.CoreWebView2?.ExecuteScriptAsync(
      $"window.hiChatRemote && window.hiChatRemote({Json.Write(key)})");
  }

  /// A shortcut that waited this long for the window to run it. A long wait
  /// is reported (with the mirror's view) so a stall shows in the logs.
  public void KeyWaited(long ms)
  {
    if (ms < 300) return;
    var view = mirror.InPointerView ? "pointer" : mirror.Visible ? "chat" : "off";
    RunInPage("fetch('/api/speech-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, " +
      $"body: JSON.stringify({{ line: 'windows key: waited={ms}ms mirror={view}' }}) }}).catch(() => {{}})");
  }

  public void ScrollChat(double fraction) => RunInPage(
    $"const s = document.querySelector('[data-thread-scroller]'); if (s) s.scrollBy({{ top: s.clientHeight * {fraction.ToString(System.Globalization.CultureInfo.InvariantCulture)}, behavior: 'smooth' }})");

  public void StopTouchpadScroll() => touchpad.Stop();

  public void ScrollChatBy(int pixels) => RunInPage(
    $"const s = document.querySelector('[data-thread-scroller]'); if (s) s.scrollBy({{ top: {pixels} }})");

  void RunInPage(string code) => _ = webView.CoreWebView2?.ExecuteScriptAsync($"(() => {{ {code} }})()");

  // MARK: Window

  public void ShowChat()
  {
    if (!Visible) Show();
    if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
    hiddenWithMonitor = false;
    PlaceOnHomeScreen();
    Native.ForceForeground(Handle);
  }

  /// Puts Hi-chat in front of other windows without taking the keyboard, so
  /// the app you're in stays active.
  public void BringUp()
  {
    hiddenWithMonitor = false;
    Native.ShowWindow(Handle, Visible && WindowState != FormWindowState.Minimized
      ? Native.SW_SHOWNA : Native.SW_SHOWNOACTIVATE);
    if (!Visible) Visible = true;
    PlaceOnHomeScreen();
    const uint flags = Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW;
    Native.SetWindowPos(Handle, Native.HWND_TOPMOST, 0, 0, 0, 0, flags);
    Native.SetWindowPos(Handle, Native.HWND_NOTOPMOST, 0, 0, 0, 0, flags);
  }

  public void ToggleTyping()
  {
    if (Typing) StopTyping(); else StartTyping(focusBox: true);
  }

  public void StartTyping(bool focusBox)
  {
    var front = Native.GetForegroundWindow();
    if (front != Handle && front != mirror.Handle) typingReturnTo = front;
    Typing = true;
    if (!Visible || WindowState == FormWindowState.Minimized) BringUp();
    Native.ForceForeground(Handle);
    webView.Focus();
    if (focusBox)
    {
      Remote("F17"); // the cursor goes to the end of the message box
      PointerToChat();
    }
  }

  public void StopTyping()
  {
    var back = typingReturnTo;
    Typing = false;
    typingReturnTo = IntPtr.Zero;
    PointerBack();
    if (back != IntPtr.Zero && Native.IsWindow(back)) Native.ForceForeground(back);
  }

  /// Where the pointer was before it jumped to Hi-chat.
  Point? pointerHome;

  /// Moves the pointer into the message box (or the bottom middle of the
  /// window when the page can't say where it is), remembering where it was.
  public async void PointerToChat()
  {
    if (!Visible || WindowState == FormWindowState.Minimized) return;
    var now = Cursor.Position;
    if (!Bounds.Contains(now) && pointerHome == null)
    {
      pointerHome = now;
      lookalike.ShowAt(now);
    }
    var target = webView.PointToScreen(new Point(webView.Width / 2, webView.Height - LogicalToDeviceUnits(60)));
    try
    {
      var json = await webView.ExecuteScriptAsync(
        "(() => { const b = document.querySelector('[data-testid=\"chat-input\"]'); if (!b) return null; " +
        "const r = b.getBoundingClientRect(); return [r.left + Math.min(r.width / 2, 200), r.top + r.height / 2] })()");
      if (Json.Array(Json.Parse(json)).Select(Json.Number).ToArray() is [{ } left, { } top])
      {
        // CSS pixels to screen pixels
        var scale = webView.DeviceDpi / 96.0 * webView.ZoomFactor;
        var x = left * scale;
        var y = top * scale;
        target = webView.PointToScreen(new Point((int)x, (int)y));
      }
    }
    catch (Exception e) { Debug.WriteLine($"Hi-chat: message box not found: {e.Message}"); }
    Cursor.Position = target;
  }

  /// Puts the pointer back where it was before it jumped to Hi-chat.
  public void PointerBack()
  {
    if (pointerHome is not { } home) return;
    PointerForget();
    Cursor.Position = home;
  }
  /// The pointer stays where it is now: its lookalike goes away.
  public void PointerForget()
  {
    pointerHome = null;
    lookalike.HideLookalike();
  }

  /// A picture of the pointer, left where Z took the real one from.
  readonly PointerLookalike lookalike = new();


  public void ToggleMirror()
  {
    // The mirror shows Hi-chat's window, which Windows only draws while it's
    // open: a minimized Hi-chat, or one closed to the tray, mirrored as a
    // blank picture.
    if (!mirror.Visible && (!Visible || WindowState == FormWindowState.Minimized)) BringUp();
    mirror.Toggle();
  }
  public void HideMirror() => mirror.HideMirror();

  /// A key was typed (not a shortcut): the mirror's pointer view may look
  /// for where the screen changed, in apps that don't report a text cursor.
  public void KeyTyped()
  {
    if (mirror.InPointerView) BeginInvoke(new Action(mirror.Typed));
  }

  /// Right Ctrl: the laptop's own screen, wherever the pointer is (a PC with
  /// no built-in screen, or its lid closed: the screen the pointer is on),
  /// without a sound or a flash, saved to Pictures\Screenshots, copied for
  /// pasting and sent in Hi-chat on its own.
  public void Screenshot()
  {
    try
    {
      var builtIn = Displays.BuiltInScreens();
      var screen = Screen.AllScreens.FirstOrDefault(s => builtIn.Contains(Displays.Name(s)))
        ?? Screen.FromPoint(Cursor.Position);
      var bounds = screen.Bounds;
      using var shot = new Bitmap(bounds.Width, bounds.Height);
      using (var g = Graphics.FromImage(shot))
        g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
      var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "Screenshots");
      Directory.CreateDirectory(folder);
      var name = $"Hi-chat {DateTime.Now:yyyy-MM-dd HHmmss}";
      var file = Path.Combine(folder, name + ".png");
      for (var n = 2; File.Exists(file); n++) file = Path.Combine(folder, $"{name} ({n}).png");
      shot.Save(file, System.Drawing.Imaging.ImageFormat.Png);
      Clipboard.SetImage(shot);
      SendScreenshot(shot);
    }
    catch (Exception e)
    {
      Debug.WriteLine($"Hi-chat: screenshot failed: {e.Message}");
    }
  }

  /// The page sends it as a message with no words: a JPEG at most 2560
  /// pixels across, small enough for the vision model.
  void SendScreenshot(Bitmap shot)
  {
    var scale = Math.Min(1.0, 2560.0 / Math.Max(shot.Width, shot.Height));
    using var small = new Bitmap(shot, Math.Max(1, (int)(shot.Width * scale)), Math.Max(1, (int)(shot.Height * scale)));
    var jpeg = System.Drawing.Imaging.ImageCodecInfo.GetImageEncoders()
      .First(c => c.FormatID == System.Drawing.Imaging.ImageFormat.Jpeg.Guid);
    using var quality = new System.Drawing.Imaging.EncoderParameters(1);
    quality.Param[0] = new System.Drawing.Imaging.EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 75L);
    using var bytes = new MemoryStream();
    small.Save(bytes, jpeg, quality);
    var url = "data:image/jpeg;base64," + Convert.ToBase64String(bytes.ToArray());
    BringUp();
    _ = webView.CoreWebView2?.ExecuteScriptAsync(
      $"window.hiChatScreenshot && window.hiChatScreenshot({Json.Write(url)})");
  }
}

/// Updates: looks at the newest Windows release on GitHub when Hi-chat opens
/// and every 6 hours. A new version is offered once, in one dialog; Update
/// Now downloads it, swaps Hi-chat.exe and restarts.
sealed class Updater(ChatWindow app)
{
  static readonly HttpClient http = MakeClient();
  bool busy;

  static HttpClient MakeClient()
  {
    var c = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
    c.DefaultRequestHeaders.UserAgent.ParseAdd("Hi-chat-Windows/" + App.Version);
    return c;
  }

  /// "1.0.10" is newer than "1.0.9".
  public static bool IsNewer(string a, string b)
  {
    var x = a.Split('.').Select(s => int.TryParse(s, out var n) ? n : 0).ToArray();
    var y = b.Split('.').Select(s => int.TryParse(s, out var n) ? n : 0).ToArray();
    for (var i = 0; i < Math.Max(x.Length, y.Length); i++)
    {
      int p = i < x.Length ? x[i] : 0, q = i < y.Length ? y[i] : 0;
      if (p != q) return p > q;
    }
    return false;
  }

  public async void Start()
  {
    while (true)
    {
      await Check(asked: false);
      await Task.Delay(TimeSpan.FromHours(6));
    }
  }

  /// asked: from the menu, so it always answers, even "up to date".
  public async Task Check(bool asked)
  {
    if (busy) return;
    string? version = null;
    Uri? exe = null, sig = null;
    try
    {
      // The Mac app's releases are the repository's "latest"; Windows ones are
      // win-*. GitHub doesn't list them in version order, so take the highest.
      var releases = Json.Parse(await http.GetStringAsync(
        $"https://api.github.com/repos/{App.Repo}/releases?per_page=100"));
      foreach (var release in Json.Array(releases).Select(Json.Object))
      {
        var tag = Json.String(release, "tag_name") ?? "";
        if (!tag.StartsWith("win-") || Json.True(release, "draft")) continue;
        var candidate = tag["win-".Length..];
        if (version != null && !IsNewer(candidate, version)) continue;
        Uri? candidateExe = null, candidateSig = null;
        foreach (var asset in Json.Array(Json.Get(release, "assets")).Select(Json.Object))
        {
          var name = Json.String(asset, "name");
          var link = Json.String(asset, "browser_download_url");
          if (name == "Hi-chat.exe") Uri.TryCreate(link, UriKind.Absolute, out candidateExe);
          if (name == "Hi-chat.exe.sig") Uri.TryCreate(link, UriKind.Absolute, out candidateSig);
        }
        // Only signed releases (see UpdateKey)
        if (candidateExe == null || candidateSig == null) continue;
        version = candidate;
        exe = candidateExe;
        sig = candidateSig;
      }
    }
    catch (Exception e)
    {
      Debug.WriteLine($"Hi-chat: update check failed: {e.Message}");
      if (asked) Tell("Couldn't reach GitHub to check for updates.");
      return;
    }
    // Updates come only from this repository's own releases
    if (version == null || !IsNewer(version, App.Version) || exe == null || sig == null ||
        !FromThisRepo(exe) || !FromThisRepo(sig))
    {
      if (asked) Tell($"Hi-chat {App.Version} is the newest version.");
      return;
    }
    if (!asked)
    {
      if (Settings.Current.SkippedVersion == version) return;
      // Never in the middle of dictating or typing; look again in a few minutes.
      if (app.Dictating || app.Typing)
      {
        _ = Task.Delay(TimeSpan.FromMinutes(5)).ContinueWith(
          _ => app.BeginInvoke(async () => await Check(asked: false)));
        return;
      }
    }
    busy = true; // one dialog at a time
    var answer = MessageBox.Show(app,
      $"Hi-chat {version} is ready.\n\nUpdate now? It installs and restarts Hi-chat, which takes a few seconds. " +
      $"You have {App.Version}.\n\nYes: update now. No: later.",
      "Hi-chat", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
    busy = false;
    if (answer == DialogResult.Yes) await Install(exe, sig);
    else
    {
      Settings.Current.SkippedVersion = version;
      Settings.Current.Save();
    }
  }

  static bool FromThisRepo(Uri url) => url.Scheme == "https" && url.Host == "github.com" &&
    url.AbsolutePath.StartsWith($"/{App.Repo}/releases/download/");

  /// The public half of the key the release build signs Hi-chat.exe with
  /// (ECDSA P-256 over its SHA-256). An update installs only when its
  /// signature checks out, so a release nobody signed with the private key
  /// (kept in the repository's HICHAT_SIGNING secret) is never installed.
  const string UpdateKey =
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEyE+JOGitQFURJOl2pZ0boLn+4dYTxTcBHck8SX4CgHicwa5FcdGetnQhtPPRTJForzxLZaWVBkd+2CSmFoCltA==";

  public static bool SignedByUs(byte[] file, byte[] signature)
  {
    try { return P256.Verify(Convert.FromBase64String(UpdateKey), file, signature); }
    catch (System.Security.Cryptography.CryptographicException) { return false; }
  }

  async Task Install(Uri url, Uri sigUrl)
  {
    busy = true;
    try
    {
      var target = Compat.ExePath!;
      var fresh = target + ".new";
      var bytes = await http.GetByteArrayAsync(url);
      var signature = await http.GetByteArrayAsync(sigUrl);
      // A real Windows program, not an error page, and the one we signed
      if (bytes.Length < 500_000 || bytes[0] != 'M' || bytes[1] != 'Z' || !SignedByUs(bytes, signature))
      {
        Tell("The download didn't look right. Try again with Check for updates.");
        return;
      }
      File.WriteAllBytes(fresh, bytes);
      // A running program can be renamed but not overwritten: move this one
      // aside (the new one deletes it), put the new one in its place.
      var old = target + ".old";
      File.Delete(old);
      File.Move(target, old);
      try { File.Move(fresh, target); }
      catch
      {
        File.Move(old, target);
        throw;
      }
      Process.Start(new ProcessStartInfo(target, $"--after {Compat.ProcessId}") { UseShellExecute = false });
      app.Quit();
    }
    catch (Exception e)
    {
      Tell($"The update didn't finish: {e.Message}");
    }
    finally { busy = false; }
  }

  void Tell(string message) => MessageBox.Show(app, message, "Hi-chat");
}

/// What a shortcut does. Escape (throw a recording away) always stays Escape.
enum KeyAction { Dictate, Screenshot, ToChat, Back, Send, NewChat, CodeUp, CodeDown, PageUp, PageDown, Mirror, MirrorClose, Scroll }

/// One way to press a shortcut, written as text so it compares and saves
/// easily: "tap:162" (a modifier tapped on its own, by its key code),
/// "chord:ctrl,shift:37" (a key with modifiers held, in the order ctrl,
/// alt, shift, win) or "hold:alt" (held while you scroll).
static class Shortcut
{
  public static string Tap(uint vk) => $"tap:{vk}";
  public static string Chord(uint vk, string[] mods) => $"chord:{string.Join(",", mods)}:{vk}";
  public static string Chord(uint vk) => Chord(vk, []);
  public static string Hold(string mod) => $"hold:{mod}";

  static readonly Dictionary<string, string> ModNames = new()
  {
    ["ctrl"] = "Ctrl", ["alt"] = "Alt", ["shift"] = "Shift", ["win"] = "Win",
  };

  /// As Settings shows it, such as "Tap Left Ctrl", "Ctrl + ←" or "Hold Alt + scroll".
  public static string Display(string shortcut)
  {
    var parts = shortcut.Split(':');
    switch (parts[0])
    {
      case "tap" when parts.Length == 2 && uint.TryParse(parts[1], out var vk):
        return "Tap " + KeyName(vk);
      case "hold" when parts.Length == 2:
        return "Hold " + ModNames.GetValueOrDefault(parts[1], parts[1]) + " + scroll";
      case "chord" when parts.Length == 3 && uint.TryParse(parts[2], out var key):
        var mods = parts[1].Split([','], StringSplitOptions.RemoveEmptyEntries).Select(m => ModNames.GetValueOrDefault(m, m));
        return string.Join(" + ", mods.Append(KeyName(key)));
      default:
        return shortcut;
    }
  }

  static readonly Dictionary<uint, string> Names = new()
  {
    [0x08] = "Backspace", [0x09] = "Tab", [0x0D] = "Enter", [0x1B] = "Esc", [0x20] = "Space",
    [0x21] = "Page Up", [0x22] = "Page Down", [0x23] = "End", [0x24] = "Home",
    [0x25] = "←", [0x26] = "↑", [0x27] = "→", [0x28] = "↓", [0x2D] = "Insert", [0x2E] = "Delete",
    [0x5B] = "Left Win", [0x5C] = "Right Win", [0x5D] = "Menu",
    [0xA0] = "Left Shift", [0xA1] = "Right Shift", [0xA2] = "Left Ctrl", [0xA3] = "Right Ctrl",
    [0xA4] = "Left Alt", [0xA5] = "Right Alt",
  };

  public static string KeyName(uint vk)
  {
    if (Names.TryGetValue(vk, out var name)) return name;
    if (vk is >= 0x70 and <= 0x87) return $"F{vk - 0x6F}";
    if (vk is >= 0x60 and <= 0x69) return $"Num {vk - 0x60}";
    // Letters, digits and punctuation, as the keyboard layout writes them
    var ch = Native.MapVirtualKey(vk, Native.MAPVK_VK_TO_CHAR) & 0xFFFF;
    return ch is > 0x20 and < 0xFFFF ? char.ToUpperInvariant((char)ch).ToString() : $"Key {vk}";
  }
}

static class KeyActions
{
  public static string Id(this KeyAction a) => char.ToLowerInvariant(a.ToString()[0]) + a.ToString()[1..];

  public static string Label(this KeyAction a) => a switch
  {
    KeyAction.Dictate => "Dictate (again to stop and send)",
    KeyAction.Screenshot => "Screenshot of the laptop's screen",
    KeyAction.ToChat => "Pointer and keyboard into Hi-chat",
    KeyAction.Back => "Pointer and keyboard back",
    KeyAction.Send => "Send what's typed",
    KeyAction.NewChat => "New chat",
    KeyAction.CodeUp => "Code block above",
    KeyAction.CodeDown => "Code block below",
    KeyAction.PageUp => "Scroll the chat up a screen",
    KeyAction.PageDown => "Scroll the chat down a screen",
    KeyAction.Mirror => "Mirror window",
    KeyAction.MirrorClose => "Close the mirror window",
    KeyAction.Scroll => "Scroll Hi-chat from anywhere",
    _ => a.ToString(),
  };

  public static string[] Defaults(this KeyAction a) => a switch
  {
    KeyAction.Dictate => [Shortcut.Tap(Native.VK_LCONTROL)],
    KeyAction.Screenshot => [Shortcut.Tap(Native.VK_RCONTROL)],
    KeyAction.ToChat => [Shortcut.Chord(Native.VK_Z)],
    KeyAction.Back => [Shortcut.Chord(Native.VK_X)],
    KeyAction.CodeUp => [Shortcut.Chord(Native.VK_PRIOR)],
    KeyAction.CodeDown => [Shortcut.Chord(Native.VK_NEXT)],
    KeyAction.PageUp => [Shortcut.Chord(Native.VK_PRIOR, ["shift"])],
    KeyAction.PageDown => [Shortcut.Chord(Native.VK_NEXT, ["shift"])],
    KeyAction.Mirror => [Shortcut.Chord(Native.VK_LEFT, ["ctrl"])],
    KeyAction.MirrorClose => [Shortcut.Chord(Native.VK_LEFT, ["ctrl", "shift"])],
    KeyAction.Scroll => [Shortcut.Hold("alt")],
    _ => [],
  };

  /// Held down, the key does it again and again.
  public static bool Repeats(this KeyAction a) => a is KeyAction.PageUp or KeyAction.PageDown;

  public static void Run(this KeyAction a, ChatWindow app)
  {
    switch (a)
    {
      case KeyAction.Dictate: app.Remote("F14"); break;
      case KeyAction.Screenshot: app.Screenshot(); break;
      case KeyAction.ToChat: if (app.Typing) app.PointerToChat(); else app.StartTyping(focusBox: true); break;
      case KeyAction.Back: if (app.Typing) app.StopTyping(); else app.PointerBack(); break;
      case KeyAction.Send: app.Remote("F15"); break;
      case KeyAction.NewChat: app.BringUp(); app.Remote("Shift+F18"); break;
      case KeyAction.CodeUp: app.Remote("Shift+F16"); break;
      case KeyAction.CodeDown: app.Remote("Shift+F17"); break;
      case KeyAction.PageUp: app.ScrollChat(-0.8); break;
      case KeyAction.PageDown: app.ScrollChat(0.8); break;
      case KeyAction.Mirror: app.ToggleMirror(); break;
      case KeyAction.MirrorClose: app.HideMirror(); break;
    }
  }
}

/// The shortcuts set in Hi-chat's Settings > App keys, kept in
/// settings.json; an action you never changed uses its defaults. Read on the
/// shortcuts thread and changed on the window's, so it swaps whole maps.
sealed class ShortcutStore
{
  public static ShortcutStore Current { get; } = new();
  volatile Dictionary<string, string[]> custom = new(Settings.Current.Shortcuts ?? new Dictionary<string, string[]>());

  public string[] Of(KeyAction a) => custom.TryGetValue(a.Id(), out var mine) ? mine : a.Defaults();

  /// The action a tap or key press runs, if any.
  public KeyAction? ActionFor(string pressed)
  {
    foreach (var a in Compat.Values<KeyAction>())
      if (Of(a).Contains(pressed)) return a;
    return null;
  }

  /// The modifier that, held, makes a scroll scroll Hi-chat (alt, ctrl, shift or win).
  public string? ScrollModifier => Of(KeyAction.Scroll).FirstOrDefault()?.Split(':') is ["hold", var m] ? m : null;

  /// A shortcut for one action only: any other action using it gives it up.
  public void Set(KeyAction action, string shortcut)
  {
    var next = new Dictionary<string, string[]>(custom);
    foreach (var other in Compat.Values<KeyAction>())
      if (other != action && Of(other).Contains(shortcut)) next[other.Id()] = Of(other).Where(s => s != shortcut).ToArray();
    next[action.Id()] = [shortcut];
    Save(next);
  }

  public void Clear(KeyAction action) => Save(new(custom) { [action.Id()] = [] });

  /// One action, or all of them, back to the defaults.
  public void Reset(KeyAction? action)
  {
    var next = new Dictionary<string, string[]>(custom);
    if (action is { } a) next.Remove(a.Id()); else next.Clear();
    Save(next);
  }

  void Save(Dictionary<string, string[]> next)
  {
    custom = next;
    Settings.Current.Shortcuts = next;
    Settings.Current.Save();
  }

  public static KeyAction? Parse(string? id) =>
    Compat.Values<KeyAction>().Cast<KeyAction?>().FirstOrDefault(a => a!.Value.Id() == id);

  /// For the page: each action with its shortcuts as they read.
  public string Json(KeyAction? recording) => HiChat.Json.Write(new
  {
    actions = Compat.Values<KeyAction>().Select(a => new
    {
      id = a.Id(),
      label = a.Label(),
      keys = Of(a).Select(Shortcut.Display).ToArray(),
      isDefault = !custom.ContainsKey(a.Id()),
      hold = a == KeyAction.Scroll,
    }),
    recording = recording?.Id(),
  });
}

/// The global shortcuts: low-level keyboard and mouse hooks on their own
/// thread. They only read the event and remember a few flags, so they never
/// hold up the PC's input; actions run on the window's thread.
sealed class Shortcuts(ChatWindow app)
{
  public volatile bool Dictating;
  Thread? thread;
  uint threadId;
  Native.HookProc? keyProc, mouseProc; // kept alive while hooked
  readonly HashSet<uint> held = [];
  /// Shortcuts whose press was used for a shortcut, so their release is too.
  readonly HashSet<uint> swallowed = [];
  /// A modifier pressed on its own: which, and when. Another key, a click or
  /// a scroll meanwhile turns it into a chord, which is left alone.
  (uint key, long at)? lone;
  const long TapMs = 500;
  /// Alt + scroll already sent the key that keeps Alt from opening menus.
  bool altMasked;
  /// Alt + Z / X let go of Alt for the app in front while it's still held,
  /// so Windows reads it as up until it really is.
  bool altLetGoByUs;
  readonly ShortcutStore store = ShortcutStore.Current;
  /// Settings is waiting for the keys to use for this action; meanwhile no
  /// shortcut runs and the keys pressed go nowhere else. Set from the window.
  volatile object? recordingBox;
  KeyAction? recording => (KeyAction?)recordingBox;

  public KeyAction? Recording
  {
    get => recording;
    set { recordingBox = value; lone = null; }
  }

  /// Settings got its keys (null: recording was cancelled).
  void Recorded(string? shortcut)
  {
    if (recording is not { } action) return;
    recordingBox = null;
    Later(a =>
    {
      if (shortcut != null) store.Set(action, shortcut);
      a.SendShortcuts();
    });
  }

  public void Start()
  {
    thread = new Thread(Run) { IsBackground = true, Name = "Hi-chat shortcuts" };
    thread.Start();
  }

  public void Stop()
  {
    if (threadId != 0) Native.PostThreadMessage(threadId, Native.WM_QUIT, IntPtr.Zero, IntPtr.Zero);
  }

  void Run()
  {
    threadId = Native.GetCurrentThreadId();
    keyProc = OnKey;
    mouseProc = OnMouse;
    var module = Native.GetModuleHandle(null);
    var k = Native.SetWindowsHookEx(Native.WH_KEYBOARD_LL, keyProc, module, 0);
    var m = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, mouseProc, module, 0);
    while (Native.GetMessage(out var msg, IntPtr.Zero, 0, 0) > 0)
    {
      Native.TranslateMessage(ref msg);
      Native.DispatchMessage(ref msg);
    }
    Native.UnhookWindowsHookEx(k);
    Native.UnhookWindowsHookEx(m);
  }

  void Later(Action<ChatWindow> action)
  {
    var at = Compat.TickCount64;
    try { app.BeginInvoke(() => { app.KeyWaited(Compat.TickCount64 - at); action(app); }); }
    catch (InvalidOperationException) { }
  }

  bool Ctrl => held.Contains(Native.VK_LCONTROL) || held.Contains(Native.VK_RCONTROL);
  bool Alt => held.Contains(Native.VK_LMENU) || held.Contains(Native.VK_RMENU);
  bool Shift => held.Contains(Native.VK_LSHIFT) || held.Contains(Native.VK_RSHIFT);
  bool Win => held.Contains(Native.VK_LWIN) || held.Contains(Native.VK_RWIN);

  static bool IsModifier(uint vk) => vk is >= Native.VK_LSHIFT and <= Native.VK_RMENU or Native.VK_LWIN or Native.VK_RWIN;

  IntPtr OnKey(int code, IntPtr wParam, IntPtr lParam)
  {
    if (code < 0) return Native.CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
    var e = Marshal.PtrToStructure<Native.KBDLLHOOKSTRUCT>(lParam);
    var used = Key(e, (int)wParam);
    return used ? (IntPtr)1 : Native.CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
  }

  /// True when the key was used for a shortcut, so the app in front never gets it.
  bool Key(Native.KBDLLHOOKSTRUCT e, int msg)
  {
    const bool pass = false;
    // Typed by a program (this one's own keys among them), or the Ctrl that
    // AltGr sends along on many keyboard layouts
    if ((e.flags & Native.LLKHF_INJECTED) != 0) return pass;
    if (e.vkCode == Native.VK_LCONTROL && (e.scanCode & 0x200) != 0) return pass;
    var down = msg is Native.WM_KEYDOWN or Native.WM_SYSKEYDOWN;
    var vk = e.vkCode;
    return down ? KeyDown(vk) : KeyUp(vk);
  }

  /// Forgets keys let go of where the hook couldn't see it: Win + L and
  /// Ctrl + Alt + Delete are let go on the lock screen. Left in held, they
  /// made every later tap a chord (tapping Left Ctrl no longer dictated) and
  /// joined every chord (Ctrl + ← read as Ctrl + Win + ←, so no mirror).
  /// Keys whose press was swallowed never reach Windows, so they stay.
  void ForgetLetGo(uint pressed) => held.RemoveWhere(k =>
    k != pressed && !swallowed.Contains(k) &&
    !(altLetGoByUs && k is Native.VK_LMENU or Native.VK_RMENU) &&
    (Native.GetAsyncKeyState((int)k) & 0x8000) == 0);

  bool KeyDown(uint vk)
  {
    const bool pass = false;
    ForgetLetGo(vk);
    var repeating = !held.Add(vk);
    if (IsModifier(vk))
    {
      if (repeating) return pass;
      if (vk is Native.VK_LMENU or Native.VK_RMENU) altMasked = altLetGoByUs = false;
      if (recording == KeyAction.Scroll && ModName(vk) is { } mod)
      {
        Recorded(Shortcut.Hold(mod));
        return pass;
      }
      lone = held.Count == 1 ? (vk, Compat.TickCount64) : null;
      return pass;
    }
    lone = null;
    if (!repeating && !Ctrl && !Alt && !Win) app.KeyTyped();
    if (recording is { } r)
    {
      // Escape on its own cancels; scrolling waits for a modifier
      if (vk == Native.VK_ESCAPE && Mods().Length == 0) Recorded(null);
      else if (r != KeyAction.Scroll && !repeating) Recorded(Shortcut.Chord(vk, Mods()));
      return Swallow(vk, null);
    }
    if (vk == Native.VK_ESCAPE && Dictating && !Ctrl && !Alt && !Win)
      return Swallow(vk, a => a.Remote("Shift+F13"));
    if (store.ActionFor(Shortcut.Chord(vk, Mods())) is { } action)
      return Swallow(vk, repeating && !action.Repeats() ? null : a => action.Run(a));
    // Alt + a key that is a shortcut on its own (Z, X) types it
    if (Alt && !Ctrl && !Shift && !Win && store.ActionFor(Shortcut.Chord(vk)) != null)
    {
      swallowed.Add(vk);
      altLetGoByUs = true;
      // The app in front gets the plain letter: Alt let go first, with an
      // unused key in between so that doesn't open its menu
      Native.SendKeys(Native.VK_MASK, false, Native.VK_MASK, true,
        Native.VK_LMENU, true, Native.VK_RMENU, true, vk, false, vk, true);
      return true;
    }
    return pass;
  }

  bool KeyUp(uint vk)
  {
    const bool pass = false;
    held.Remove(vk);
    if (vk is Native.VK_LMENU or Native.VK_RMENU) altLetGoByUs = false;
    if (ModName(vk) is { } mod && mod == store.ScrollModifier && TouchpadScroll.Scrolling)
      Later(a => a.StopTouchpadScroll());
    if (swallowed.Remove(vk)) return true;
    if (lone is { } l && l.key == vk && (recording != null || Compat.TickCount64 - l.at < TapMs))
    {
      lone = null;
      if (recording is { } r) { if (r != KeyAction.Scroll) Recorded(Shortcut.Tap(vk)); }
      else if (store.ActionFor(Shortcut.Tap(vk)) is { } action) Later(a => action.Run(a));
      return pass;
    }
    if (IsModifier(vk)) lone = null;
    return pass;
  }

  /// The modifiers held now, in the order a shortcut writes them.
  string[] Mods()
  {
    var mods = new List<string>(4);
    if (Ctrl) mods.Add("ctrl");
    if (Alt) mods.Add("alt");
    if (Shift) mods.Add("shift");
    if (Win) mods.Add("win");
    return [.. mods];
  }

  static string? ModName(uint vk) => vk switch
  {
    Native.VK_LCONTROL or Native.VK_RCONTROL => "ctrl",
    Native.VK_LMENU or Native.VK_RMENU => "alt",
    Native.VK_LSHIFT or Native.VK_RSHIFT => "shift",
    Native.VK_LWIN or Native.VK_RWIN => "win",
    _ => null,
  };

  /// Is the scroll modifier (Alt unless changed in Settings) held?
  bool ScrollHeld() => store.ScrollModifier switch
  {
    "ctrl" => Ctrl, "alt" => Alt, "shift" => Shift, "win" => Win, _ => false,
  };

  /// The same, asked from another thread: whether the key is down now.
  public static bool ScrollKeyDown()
  {
    static bool Down(int vk) => (Native.GetAsyncKeyState(vk) & 0x8000) != 0;
    return ShortcutStore.Current.ScrollModifier switch
    {
      "ctrl" => Down(0x11), "alt" => Down(0x12), "shift" => Down(0x10),
      "win" => Down((int)Native.VK_LWIN) || Down((int)Native.VK_RWIN),
      _ => false,
    };
  }

  bool Swallow(uint vk, Action<ChatWindow>? action)
  {
    swallowed.Add(vk);
    if (action != null) Later(action);
    // So letting go of Alt afterwards doesn't open the menu of the app in front
    if (Alt) Native.SendKeys(Native.VK_MASK, false, Native.VK_MASK, true);
    return true;
  }

  IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam)
  {
    if (code < 0) return Native.CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
    var e = Marshal.PtrToStructure<Native.MSLLHOOKSTRUCT>(lParam);
    return Mouse(e, (int)wParam) ? (IntPtr)1 : Native.CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
  }

  bool Mouse(Native.MSLLHOOKSTRUCT e, int msg)
  {
    const bool pass = false;
    if ((e.flags & Native.LLMHF_INJECTED) != 0) return pass;
    switch (msg)
    {
      case Native.WM_LBUTTONDOWN or Native.WM_RBUTTONDOWN or Native.WM_MBUTTONDOWN:
        lone = null;
        return pass;
      case Native.WM_MOUSEWHEEL:
        lone = null;
        // Alt + scroll (a wheel or two fingers on the touchpad) scrolls
        // Hi-chat from anywhere; the window under the pointer gets nothing
        if (!ScrollHeld()) return pass;
        var delta = (short)(e.mouseData >> 16);
        if (!altMasked && (Alt || Win))
        {
          // So letting go of Alt afterwards doesn't open the menu of the app in front
          altMasked = true;
          Native.SendKeys(Native.VK_MASK, false, Native.VK_MASK, true);
        }
        // Two fingers on the touchpad already scroll the chat through raw input
        if (!TouchpadScroll.Scrolling) Later(a => a.ScrollChatBy(-delta * 100 / 120));
        return true;
      default:
        return pass;
    }
  }
}

/// Alt + two fingers on the touchpad scrolls Hi-chat from anywhere. Windows
/// sends touchpad scrolling straight to the window under the pointer, past
/// the mouse hook, so this reads the fingers from the touchpad itself (raw
/// input) and scrolls the chat by as much as two fingers moved. Meanwhile
/// a see-through window covers the screens, so the scroll Windows makes of
/// the same fingers lands on it and not on the window under the pointer.
sealed class TouchpadScroll(Action<int> scroll)
{
  /// On while Alt is held with two fingers on the pad. Read on other threads.
  public static volatile bool Scrolling;
  readonly ScrollShield shield = new();

  /// One touchpad: where each finger's fields are in its reports.
  sealed class Pad
  {
    public IntPtr Parsed;
    public ushort[] Fingers = [];
    public double Height = 1;
  }

  readonly Dictionary<IntPtr, Pad?> pads = [];
  /// Each finger on the pad, by its contact id: the height last seen.
  readonly Dictionary<uint, uint> fingers = [];
  /// Contacts left to read in this frame (a touchpad can split one frame
  /// over several reports), and how many the frame has.
  int left, inFrame;
  double carry;
  bool masked;
  /// A full stroke down the pad scrolls this far.
  const double PadPixels = 1200;

  public void Listen(IntPtr window)
  {
    var pad = new Native.RAWINPUTDEVICE
    {
      UsagePage = 0x0D, Usage = 0x05, // digitizer: touchpad
      Flags = Native.RIDEV_INPUTSINK, Target = window,
    };
    Native.RegisterRawInputDevices([pad], 1, (uint)Marshal.SizeOf<Native.RAWINPUTDEVICE>());
  }

  public void Input(IntPtr handle)
  {
    var alt = Shortcuts.ScrollKeyDown();
    if (!alt)
    {
      fingers.Clear();
      masked = false;
      Shield(false);
      return;
    }
    var header = (uint)Marshal.SizeOf<Native.RAWINPUTHEADER>();
    uint size = 0;
    Native.GetRawInputData(handle, Native.RID_INPUT, IntPtr.Zero, ref size, header);
    if (size == 0) return;
    var data = Marshal.AllocHGlobal((int)size);
    try
    {
      if (Native.GetRawInputData(handle, Native.RID_INPUT, data, ref size, header) != size) return;
      var head = Marshal.PtrToStructure<Native.RAWINPUTHEADER>(data);
      if (head.Type != Native.RIM_TYPEHID || PadFor(head.Device) is not { } pad) return;
      var hid = data + (int)header;
      var reportSize = (uint)Marshal.ReadInt32(hid);
      var count = Marshal.ReadInt32(hid, 4);
      double moved = 0;
      for (var i = 0; i < count; i++) moved += Report(pad, hid + 8 + i * (int)reportSize, reportSize);
      // Up as soon as the second finger lands, before Windows sees a scroll
      // and picks the window to send it to; it stays up while any finger is
      // still down, since a report can miss a finger for a moment
      if (fingers.Count >= 2) Shield(true);
      else if (fingers.Count == 0) Shield(false, later: true);
      if (moved == 0 || inFrame < 2) return;
      if (!masked)
      {
        // So letting go of Alt afterwards doesn't open the menu of the app in front
        masked = true;
        Native.SendKeys(Native.VK_MASK, false, Native.VK_MASK, true);
      }
      // Fingers moving up the pad scroll down the chat, as the pad does
      carry += -moved / inFrame / pad.Height * PadPixels;
      var px = (int)carry;
      carry -= px;
      if (px != 0) scroll(px);
    }
    finally { Marshal.FreeHGlobal(data); }
  }

  /// Alt let go: the shield comes down even if the pad sends nothing more.
  public void Stop()
  {
    fingers.Clear();
    Shield(false);
  }

  /// Taking the shield down a moment after the fingers lift: putting it up
  /// and down between strokes flickers the pointer and the taskbar.
  readonly System.Windows.Forms.Timer lower = new() { Interval = 400 };

  void Shield(bool on, bool later = false)
  {
    if (on || !later) lower.Stop();
    if (!on && later)
    {
      if (Scrolling && !lower.Enabled)
      {
        lower.Tick -= Lower;
        lower.Tick += Lower;
        lower.Start();
      }
      return;
    }
    if (Scrolling == on) return;
    Scrolling = on;
    if (on) shield.Cover(); else shield.Uncover();
  }

  void Lower(object? sender, EventArgs e) => Shield(false);

  /// Reads one report; returns how far its fingers moved down the pad.
  double Report(Pad pad, IntPtr report, uint length)
  {
    if (Native.HidP_GetUsageValue(0, 0x0D, 0, 0x54, out var contacts, pad.Parsed, report, length) != Native.HIDP_STATUS_SUCCESS)
    {
      // No contact count: every finger is in every report
      left = pad.Fingers.Length;
      inFrame = Math.Max(fingers.Count, 1);
    }
    else if (contacts > 0)
    {
      left = (int)contacts;
      inFrame = (int)contacts;
    }
    double moved = 0;
    var tips = new ushort[16];
    foreach (var link in pad.Fingers)
    {
      if (left <= 0) break;
      left--;
      if (Native.HidP_GetUsageValue(0, 0x01, link, 0x31, out var y, pad.Parsed, report, length) != Native.HIDP_STATUS_SUCCESS)
        continue;
      var id = Native.HidP_GetUsageValue(0, 0x0D, link, 0x51, out var contact, pad.Parsed, report, length)
        == Native.HIDP_STATUS_SUCCESS ? contact : link;
      uint n = (uint)tips.Length;
      var touching = Native.HidP_GetUsages(0, 0x0D, link, tips, ref n, pad.Parsed, report, length)
        == Native.HIDP_STATUS_SUCCESS && tips.Take((int)n).Contains((ushort)0x42);
      if (!touching)
      {
        fingers.Remove(id);
        continue;
      }
      if (fingers.TryGetValue(id, out var was)) moved += (double)y - was;
      fingers[id] = y;
    }
    return moved;
  }

  /// The touchpad's layout, read once per device; null for one without fingers.
  Pad? PadFor(IntPtr device)
  {
    if (pads.TryGetValue(device, out var known)) return known;
    Pad? pad = null;
    uint size = 0;
    Native.GetRawInputDeviceInfo(device, Native.RIDI_PREPARSEDDATA, IntPtr.Zero, ref size);
    if (size > 0)
    {
      var parsed = Marshal.AllocHGlobal((int)size);
      if (Native.GetRawInputDeviceInfo(device, Native.RIDI_PREPARSEDDATA, parsed, ref size) == size
          && Fingers(parsed) is { Length: > 0 } found)
        pad = new Pad { Parsed = parsed, Fingers = found.Select(f => f.link).ToArray(), Height = Math.Max(1, found[0].height) };
      else Marshal.FreeHGlobal(parsed);
    }
    pads[device] = pad;
    return pad;
  }

  /// The collections that hold a finger's height (Y), and the pad's height.
  static (ushort link, double height)[] Fingers(IntPtr parsed)
  {
    var caps = Marshal.AllocHGlobal(64);
    try
    {
      if (Native.HidP_GetCaps(parsed, caps) != Native.HIDP_STATUS_SUCCESS) return [];
      var count = (ushort)Marshal.ReadInt16(caps, 48); // NumberInputValueCaps
      if (count == 0) return [];
      const int Each = 72; // HIDP_VALUE_CAPS
      var values = Marshal.AllocHGlobal(Each * count);
      try
      {
        if (Native.HidP_GetValueCaps(0, values, ref count, parsed) != Native.HIDP_STATUS_SUCCESS) return [];
        var found = new List<(ushort, double)>();
        for (var i = 0; i < count; i++)
        {
          var at = values + i * Each;
          var page = (ushort)Marshal.ReadInt16(at, 0);
          var usage = (ushort)Marshal.ReadInt16(at, 56);
          if (page != 0x01 || usage != 0x31) continue;
          var link = (ushort)Marshal.ReadInt16(at, 6);
          var max = Marshal.ReadInt32(at, 44) - Marshal.ReadInt32(at, 40); // logical max - min
          if (found.All(f => f.Item1 != link)) found.Add((link, max));
        }
        return found.OrderBy(f => f.Item1).ToArray();
      }
      finally { Marshal.FreeHGlobal(values); }
    }
    finally { Marshal.FreeHGlobal(caps); }
  }
}

/// A window over the screen, too faint to see, that catches Windows'
/// own scrolling of the touchpad while Alt + two fingers scroll Hi-chat.
/// It never takes the keyboard and is up only while the fingers are down.
sealed class ScrollShield : Form
{
  public ScrollShield()
  {
    FormBorderStyle = FormBorderStyle.None;
    ShowInTaskbar = false;
    StartPosition = FormStartPosition.Manual;
    BackColor = Color.Black;
    // Not fully clear: Windows sends nothing to a window with no opacity
    Opacity = 0.01;
  }

  protected override bool ShowWithoutActivation => true;

  protected override CreateParams CreateParams
  {
    get
    {
      var p = base.CreateParams;
      p.ExStyle |= Native.WS_EX_NOACTIVATE | Native.WS_EX_TOOLWINDOW | Native.WS_EX_TOPMOST | Native.WS_EX_LAYERED;
      return p;
    }
  }

  protected override void WndProc(ref Message m)
  {
    if (m.Msg == Native.WM_MOUSEACTIVATE)
    {
      m.Result = (IntPtr)Native.MA_NOACTIVATE;
      return;
    }
    base.WndProc(ref m);
  }

  public void Cover()
  {
    // The screen under the pointer, above its taskbar and a pixel short of
    // the whole screen: Windows takes a window covering a whole screen for
    // a full-screen app and shifts the taskbar out of its way
    var screen = Screen.FromPoint(Cursor.Position);
    var area = screen.WorkingArea;
    if (area == screen.Bounds) area.Height -= 1;
    // The pointer keeps the shape it had over the window underneath
    var info = new Native.CURSORINFO { cbSize = Marshal.SizeOf<Native.CURSORINFO>() };
    if (Native.GetCursorInfo(ref info) && info.hCursor != IntPtr.Zero) Cursor = new Cursor(info.hCursor);
    Native.SetWindowPos(Handle, Native.HWND_TOPMOST, area.X, area.Y, area.Width, area.Height,
      Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW);
    Visible = true;
  }

  public void Uncover() => Visible = false;
}

/// The live mirror: a small window on top of everything that shows the
/// Hi-chat window (a DWM thumbnail, drawn by Windows itself, so it is as
/// live as the real window) or the screen around the pointer (the Windows
/// Magnifier control at 1x). It never takes the keyboard. Drag the top bar
/// to move, drag an edge to resize, x closes it.
/// A picture of the pointer as it looked, left where it was while Z has the
/// real one in Hi-chat. Clicks go through it and it never takes the keyboard.
sealed class PointerLookalike : Form
{
  /// Drawn where the picture has no pixels; Windows leaves those see-through.
  static readonly Color Clear = Color.FromArgb(1, 2, 3);
  IntPtr shape;

  public PointerLookalike()
  {
    FormBorderStyle = FormBorderStyle.None;
    ShowInTaskbar = false;
    StartPosition = FormStartPosition.Manual;
    BackColor = Clear;
    TransparencyKey = Clear;
    // On top through WS_EX_TOPMOST below: setting TopMost here would activate
    // it, taking the keyboard (and the pointer's way back) from Hi-chat
  }

  protected override bool ShowWithoutActivation => true;

  protected override CreateParams CreateParams
  {
    get
    {
      var p = base.CreateParams;
      p.ExStyle |= Native.WS_EX_NOACTIVATE | Native.WS_EX_TOOLWINDOW | Native.WS_EX_TOPMOST |
        Native.WS_EX_LAYERED | Native.WS_EX_TRANSPARENT;
      return p;
    }
  }

  /// at: the pointer's position on the screen.
  public void ShowAt(Point at)
  {
    var info = new Native.CURSORINFO { cbSize = Marshal.SizeOf<Native.CURSORINFO>() };
    if (!Native.GetCursorInfo(ref info) || info.hCursor == IntPtr.Zero) return;
    shape = info.hCursor;
    var cursor = new Cursor(shape);
    var hot = cursor.HotSpot;
    // Room for a pointer made bigger in Windows' settings; the rest is see-through
    var size = Math.Max(Math.Max(cursor.Size.Width, cursor.Size.Height), 128);
    Bounds = new Rectangle(at.X - hot.X, at.Y - hot.Y, size, size);
    if (!Visible) Show();
    Invalidate();
  }

  public void HideLookalike()
  {
    shape = IntPtr.Zero;
    Hide();
  }

  protected override void OnPaint(PaintEventArgs e)
  {
    base.OnPaint(e);
    if (shape == IntPtr.Zero) return;
    var dc = e.Graphics.GetHdc();
    try { Native.DrawIconEx(dc, 0, 0, shape, 0, 0, 0, IntPtr.Zero, Native.DI_NORMAL); }
    finally { e.Graphics.ReleaseHdc(dc); }
  }
}

sealed class Mirror : Form
{
  enum Mode { Chat, Pointer }
  readonly ChatWindow chat;
  Mode mode = Mode.Chat;
  IntPtr thumb;
  IntPtr magnifier;
  static bool magReady;
  bool magShown;
  /// The pointer view's last frame, drawn off screen and then copied in
  IntPtr frameDc, frameBmp, frameOld;
  Size frameSize;
  readonly Dictionary<IntPtr, Point> hotspots = new();
  readonly System.Windows.Forms.Timer tick = new() { Interval = 15 };
  Rectangle? area;
  const float Edge = 0.2f; // the pointer view pans only once the pointer is this close to its edge

  int Bar => LogicalToDeviceUnits(26);
  int Border => LogicalToDeviceUnits(6);
  Rectangle Picture => new(Border, Bar, Math.Max(1, ClientSize.Width - 2 * Border),
    Math.Max(1, ClientSize.Height - Bar - Border));
  Rectangle CloseBox => new(ClientSize.Width - Bar - Border / 2, 0, Bar, Bar);

  public Mirror(ChatWindow chat)
  {
    this.chat = chat;
    Text = "Hi-chat mirror";
    FormBorderStyle = FormBorderStyle.None;
    ShowInTaskbar = false;
    TopMost = true;
    BackColor = Color.FromArgb(23, 23, 23);
    DoubleBuffered = true;
    StartPosition = FormStartPosition.Manual;
    MinimumSize = new Size(240, 160);
    if (Settings.Unpack(Settings.Current.Mirror) is { } r) Bounds = r;
    else
    {
      var a = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 900);
      Bounds = new Rectangle(a.Right - 660, a.Top + 20, 640, 420);
    }
    tick.Tick += (_, _) => Follow();
  }

  protected override bool ShowWithoutActivation => true;

  protected override CreateParams CreateParams
  {
    get
    {
      var p = base.CreateParams;
      p.ExStyle |= Native.WS_EX_NOACTIVATE | Native.WS_EX_TOOLWINDOW | Native.WS_EX_TOPMOST | Native.WS_EX_LAYERED;
      return p;
    }
  }

  protected override void OnHandleCreated(EventArgs e)
  {
    base.OnHandleCreated(e);
    // Opaque; the Magnifier wants its window layered
    Native.SetLayeredWindowAttributes(Handle, 0, 255, Native.LWA_ALPHA);
  }

  protected override void WndProc(ref Message m)
  {
    switch (m.Msg)
    {
      case Native.WM_MOUSEACTIVATE:
        m.Result = (IntPtr)Native.MA_NOACTIVATE;
        return;
      case Native.WM_NCHITTEST:
        var p = PointToClient(new Point((short)(m.LParam.ToInt64() & 0xFFFF), (short)((m.LParam.ToInt64() >> 16) & 0xFFFF)));
        m.Result = (IntPtr)HitTest(p);
        return;
    }
    base.WndProc(ref m);
  }

  int HitTest(Point p)
  {
    var w = ClientSize.Width; var h = ClientSize.Height; var b = Border;
    bool left = p.X < b, right = p.X >= w - b, top = p.Y < b, bottom = p.Y >= h - b;
    if (bottom && right) return Native.HTBOTTOMRIGHT;
    if (bottom && left) return Native.HTBOTTOMLEFT;
    if (top && right) return Native.HTTOPRIGHT;
    if (top && left) return Native.HTTOPLEFT;
    if (left) return Native.HTLEFT;
    if (right) return Native.HTRIGHT;
    if (bottom) return Native.HTBOTTOM;
    if (top) return Native.HTTOP;
    if (CloseBox.Contains(p)) return Native.HTCLIENT;
    return Native.HTCAPTION;
  }

  protected override void OnMouseUp(MouseEventArgs e)
  {
    base.OnMouseUp(e);
    if (CloseBox.Contains(e.Location)) HideMirror();
  }

  protected override void OnPaint(PaintEventArgs e)
  {
    base.OnPaint(e);
    // A clear x on a dark disc in the top bar
    var g = e.Graphics;
    g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
    var box = CloseBox;
    var d = LogicalToDeviceUnits(18);
    var disc = new Rectangle(box.X + (box.Width - d) / 2, box.Y + (box.Height - d) / 2, d, d);
    using var fill = new SolidBrush(Color.FromArgb(60, 60, 60));
    g.FillEllipse(fill, disc);
    using var pen = new Pen(Color.White, LogicalToDeviceUnits(2));
    var i = d / 3;
    g.DrawLine(pen, disc.Left + i, disc.Top + i, disc.Right - i, disc.Bottom - i);
    g.DrawLine(pen, disc.Right - i, disc.Top + i, disc.Left + i, disc.Bottom - i);
    if (status.Length > 0)
    {
      var text = new Rectangle(Border * 2, 0, Math.Max(0, box.Left - Border * 3), Bar);
      TextRenderer.DrawText(g, status, Font, text, Color.FromArgb(200, 200, 200),
        TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
    }
  }

  protected override void OnResize(EventArgs e)
  {
    base.OnResize(e);
    if (magnifier != IntPtr.Zero)
    {
      var r = Picture;
      Native.MoveWindow(magnifier, r.X, r.Y, r.Width, r.Height, true);
    }
    area = null;
    UpdateThumb();
    Invalidate();
  }

  // After a drag that moved or resized it
  protected override void OnResizeEnd(EventArgs e)
  {
    base.OnResizeEnd(e);
    RememberPlace();
  }

  /// Whether the mirror was last on a monitor, and whether unplugging that
  /// monitor hid it.
  bool onMonitor, hiddenWithMonitor;

  /// Keeps where the mirror is for the kind of screen it's on. Only on your
  /// own drags and when it opens: Windows moving it off an unplugged monitor
  /// must not overwrite its place there.
  void RememberPlace()
  {
    var packed = Settings.Pack(Bounds);
    onMonitor = !Displays.BuiltInScreens().Contains(Displays.Name(Screen.FromControl(this)));
    Settings.Current.Mirror = packed;
    if (onMonitor) Settings.Current.MirrorOnMonitor = packed;
    else Settings.Current.MirrorOnLaptop = packed;
    Settings.Current.Save();
  }

  /// Unplugged while the mirror was on the monitor: it hides rather than
  /// landing on the laptop's screen. Plugged in again: it comes back exactly
  /// where it was, showing what it showed.
  public void MonitorsChanged(bool monitor, bool hadMonitor)
  {
    if (monitor && hiddenWithMonitor)
    {
      hiddenWithMonitor = false;
      if (Settings.Unpack(Settings.Current.MirrorOnMonitor) is { } r) Bounds = r;
      Native.ShowWindow(Handle, Native.SW_SHOWNOACTIVATE);
      Visible = true;
      Restart();
    }
    else if (!monitor && hadMonitor && onMonitor && Visible)
    {
      HideMirror();
      hiddenWithMonitor = true;
    }
  }

  /// Hidden -> shows Hi-chat; Hi-chat -> the screen around the pointer; and back.
  public void Toggle()
  {
    if (!Visible)
    {
      mode = Mode.Chat;
      hiddenWithMonitor = false;
      Native.ShowWindow(Handle, Native.SW_SHOWNOACTIVATE);
      Visible = true;
      RememberPlace();
    }
    else mode = mode == Mode.Chat ? Mode.Pointer : Mode.Chat;
    Restart();
  }

  public void HideMirror()
  {
    tick.Stop();
    StopFrames();
    Unthumb();
    ShowMagnifier(false);
    FreeFrame();
    Hide();
  }

  void Restart()
  {
    area = null;
    source = Source.Mouse;
    ShowStatus(); // the chat view shows no status
    if (mode == Mode.Chat)
    {
      StopFrames();
      ShowMagnifier(false);
      Invalidate(); // clears the pointer view's last frame
      Unthumb();
      if (Native.DwmRegisterThumbnail(Handle, chat.Handle, out thumb) != 0) thumb = IntPtr.Zero;
      UpdateThumb();
      tick.Start(); // follows the Hi-chat window's size
    }
    else
    {
      tick.Stop();
      Unthumb();
      Follow();
      StartFrames();
    }
  }
  /// Pointer view: one new frame per screen refresh (DwmFlush waits for the
  /// next one), instead of the timer's ~16-30 ms that left it lagging behind
  /// the pointer. A frame is only asked for once the last one is drawn.
  int frameGen, frameWanted;
  void StartFrames()
  {
    var gen = ++frameGen;
    var thread = new Thread(() =>
    {
      var clock = new Stopwatch();
      while (Volatile.Read(ref frameGen) == gen)
      {
        clock.Restart();
        if (Native.DwmFlush() != 0 || clock.ElapsedMilliseconds < 2) Thread.Sleep(4);
        if (Volatile.Read(ref frameGen) != gen) break;
        if (Interlocked.Exchange(ref frameWanted, 1) == 1) continue;
        try { BeginInvoke(new Action(() => DrawFrame(gen))); }
        catch (Exception e) when (e is InvalidOperationException or ObjectDisposedException) { break; } // the window is gone
      }
    }) { IsBackground = true, Name = "Hi-chat mirror frames" };
    thread.Start();
  }
  /// One pointer-view frame, unless something else is waiting for this
  /// thread. A frame that took about a screen refresh to draw had the next
  /// one asked for before it was done, and an asked-for frame always comes
  /// before keys, clicks, painting and timers, so those waited for as long
  /// as the pointer view was on: Hi-chat stopped answering its shortcuts
  /// (Left Ctrl, Ctrl + Left) and then ran them all at once. Now the next
  /// frame is asked for only after this one is drawn, at the next refresh,
  /// and a frame gives way to anything else that's waiting.
  void DrawFrame(int gen)
  {
    try
    {
      if (frameGen == gen && !Native.InputWaiting()) Follow();
    }
    finally { Volatile.Write(ref frameWanted, 0); }
  }
  public bool InPointerView => Visible && mode == Mode.Pointer;
  void StopFrames()
  {
    Interlocked.Increment(ref frameGen);
    Volatile.Write(ref frameWanted, 0);
  }

  void Unthumb()
  {
    if (thumb != IntPtr.Zero) Native.DwmUnregisterThumbnail(thumb);
    thumb = IntPtr.Zero;
  }

  /// Hi-chat's picture, as big as fits with its own shape.
  void UpdateThumb()
  {
    if (thumb == IntPtr.Zero) return;
    Native.GetClientRect(chat.Handle, out var src);
    var pic = Picture;
    var sw = Math.Max(1, src.Right - src.Left);
    var sh = Math.Max(1, src.Bottom - src.Top);
    var scale = Math.Min((double)pic.Width / sw, (double)pic.Height / sh);
    var w = (int)(sw * scale); var h = (int)(sh * scale);
    var x = pic.X + (pic.Width - w) / 2; var y = pic.Y + (pic.Height - h) / 2;
    var props = new Native.DWM_THUMBNAIL_PROPERTIES
    {
      dwFlags = Native.DWM_TNP_RECTDESTINATION | Native.DWM_TNP_VISIBLE | Native.DWM_TNP_OPACITY |
        Native.DWM_TNP_SOURCECLIENTAREAONLY,
      rcDestination = new Native.RECT { Left = x, Top = y, Right = x + w, Bottom = y + h },
      opacity = 255,
      fVisible = 1,
      fSourceClientAreaOnly = 1,
    };
    Native.DwmUpdateThumbnailProperties(thumb, ref props);
  }

  unsafe bool StartMagnifier()
  {
    if (magnifier != IntPtr.Zero) return true;
    if (!magReady && !(magReady = Native.MagInitialize())) return false;
    var r = Picture;
    magnifier = Native.CreateWindowEx(0, "Magnifier", "Hi-chat pointer view",
      Native.WS_CHILD | Native.WS_VISIBLE | Native.MS_SHOWMAGNIFIEDCURSOR,
      r.X, r.Y, r.Width, r.Height, Handle, IntPtr.Zero, Native.GetModuleHandle(null), IntPtr.Zero);
    if (magnifier == IntPtr.Zero) return false;
    var one = new Native.MAGTRANSFORM();
    one.v[0] = 1; one.v[4] = 1; one.v[8] = 1;
    Native.MagSetWindowTransform(magnifier, ref one);
    // Leave this window out, so the view never shows itself
    Native.MagSetWindowFilterList(magnifier, Native.MW_FILTERMODE_EXCLUDE, 1, [Handle]);
    return true;
  }

  int lastW, lastH;

  /// Pointer view: show the part of the screen around the pointer, the size
  /// of this window, holding still until the pointer nears its edge. Chat
  /// view: keep up with the Hi-chat window's size.
  void Follow()
  {
    if (!Visible) return;
    if (mode == Mode.Chat)
    {
      Native.GetClientRect(chat.Handle, out var c);
      if (c.Right != lastW || c.Bottom != lastH)
      {
        lastW = c.Right; lastH = c.Bottom;
        UpdateThumb();
      }
      return;
    }
    var p = FocusPoint();
    var full = Screen.FromPoint(new Point(p.X, p.Y)).Bounds;
    var pic = Picture;
    int w = Math.Min(pic.Width, full.Width), h = Math.Min(pic.Height, full.Height);
    Rectangle a;
    if (area is { } old && old.Width == w && old.Height == h && full.Contains(old.Location))
    {
      int mx = (int)(w * Edge), my = (int)(h * Edge);
      a = old;
      a.X = Math.Max(p.X - w + mx, Math.Min(a.X, p.X - mx));
      a.Y = Math.Max(p.Y - h + my, Math.Min(a.Y, p.Y - my));
    }
    else a = new Rectangle(p.X - w / 2, p.Y - h / 2, w, h);
    a.X = Math.Max(full.Left, Math.Min(a.X, full.Right - w));
    a.Y = Math.Max(full.Top, Math.Min(a.Y, full.Bottom - h));
    area = a;
    // Copying the screen keeps up with the pointer; the Magnifier, much
    // slower, only for when the view would take in this window itself
    if (!a.IntersectsWith(Bounds))
    {
      ShowMagnifier(false);
      Blit(a, pic);
      return;
    }
    if (!ShowMagnifier(true)) return;
    Native.MagSetWindowSource(magnifier, new Native.RECT { Left = a.Left, Top = a.Top, Right = a.Right, Bottom = a.Bottom });
    Native.InvalidateRect(magnifier, IntPtr.Zero, true); // redraw: the screen behind keeps changing
  }

  // ---- What the pointer view follows: the mouse, or your typing ----

  enum Source { Mouse, Caret, Screen }
  Source source = Source.Mouse;
  Point lastMouse = new(int.MinValue, int.MinValue);
  Point? lastCaret, seenTyping;
  int focusTicks;
  bool comparing;

  /// The mouse pointer, or where you're typing if the text cursor moved
  /// since the mouse last did. In apps that don't report a text cursor,
  /// where the screen changed as you typed (Typed).
  Native.POINT FocusPoint()
  {
    Native.GetCursorPos(out var m);
    var mouse = new Point(m.X, m.Y);
    if (mouse != lastMouse) { lastMouse = mouse; source = Source.Mouse; }
    if (++focusTicks % 4 == 0) // ~15 times a second
    {
      var caret = Caret();
      if (caret is { } c)
      {
        if (lastCaret is { } was && was != c) source = Source.Caret;
      }
      else if (source == Source.Caret) source = Source.Mouse;
      lastCaret = caret;
      ShowStatus();
    }
    var at = source switch
    {
      Source.Caret => lastCaret ?? mouse,
      Source.Screen => seenTyping ?? mouse,
      _ => mouse,
    };
    return new Native.POINT { X = at.X, Y = at.Y };
  }

  /// The text cursor in the app in front, in screen pixels, or null: the
  /// system caret (classic apps: Notepad, Office), else the caret it
  /// describes to accessibility (what Windows Magnifier follows).
  static Point? Caret()
  {
    var front = Native.GetForegroundWindow();
    if (front == IntPtr.Zero || Native.IsHungAppWindow(front)) return null;
    var thread = Native.GetWindowThreadProcessId(front, out _);
    var info = new Native.GUITHREADINFO { cbSize = Marshal.SizeOf<Native.GUITHREADINFO>() };
    if (Native.GetGUIThreadInfo(thread, ref info) && info.hwndCaret != IntPtr.Zero)
    {
      var r = info.rcCaret;
      var top = new Native.POINT { X = r.Left, Y = r.Top };
      if (r.Bottom > r.Top && Native.ClientToScreen(info.hwndCaret, ref top))
      {
        var h = r.Bottom - r.Top;
        if (h is > 2 and < 120) return new Point(top.X, top.Y + h / 2);
      }
    }
    try
    {
      var target = info.hwndFocus != IntPtr.Zero ? info.hwndFocus : front;
      var iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71"); // IAccessible
      if (Native.AccessibleObjectFromWindow(target, Native.OBJID_CARET, ref iid, out var obj) == 0
          && obj is Accessibility.IAccessible acc)
      {
        acc.accLocation(out var l, out var t, out var w, out var h, 0);
        if (h is > 2 and < 120 && w < 60 && (l != 0 || t != 0)) return new Point(l, t + h / 2);
      }
    }
    catch (Exception e) when (e is COMException or InvalidCastException or ArgumentException) { }
    return null;
  }

  /// A key was typed. When the app in front doesn't report a text cursor,
  /// compare its screen now with a moment later and go to the small patch
  /// that changed: the letters appearing.
  public void Typed()
  {
    if (!InPointerView || lastCaret != null || comparing) return;
    var screen = Screen.FromPoint(lastMouse).Bounds;
    var before = Snapshot(screen);
    if (before == null) return;
    comparing = true;
    var later = new System.Windows.Forms.Timer { Interval = 120 };
    later.Tick += (_, _) =>
    {
      later.Stop();
      later.Dispose();
      comparing = false;
      CompareTyping(screen, before);
    };
    later.Start();
  }

  const int SampleStep = 4;

  /// The screen, grey, one sample every SampleStep pixels.
  static byte[]? Snapshot(Rectangle screen)
  {
    try
    {
      using var shot = new Bitmap(screen.Width, screen.Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
      using (var g = Graphics.FromImage(shot))
        g.CopyFromScreen(screen.Location, Point.Empty, screen.Size);
      var data = shot.LockBits(new Rectangle(Point.Empty, shot.Size),
        System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
      try
      {
        int cols = screen.Width / SampleStep, rows = screen.Height / SampleStep;
        var lum = new byte[cols * rows];
        var row = new byte[data.Stride];
        for (var r = 0; r < rows; r++)
        {
          Marshal.Copy(data.Scan0 + r * SampleStep * data.Stride, row, 0, data.Stride);
          for (var c = 0; c < cols; c++)
          {
            var i = c * SampleStep * 4; // BGRA
            lum[r * cols + c] = (byte)((row[i] + 2 * row[i + 1] + row[i + 2]) >> 2);
          }
        }
        return lum;
      }
      finally { shot.UnlockBits(data); }
    }
    catch (Exception e) when (e is System.ComponentModel.Win32Exception or ArgumentException or ExternalException)
    {
      return null; // the screen can't be read just now (locked, secure desktop)
    }
  }

  void CompareTyping(Rectangle screen, byte[] before)
  {
    var after = Snapshot(screen);
    if (after == null || after.Length != before.Length) return;
    int cols = screen.Width / SampleStep, rows = screen.Height / SampleStep;
    // This window shows the screen, so it changes too: leave it out
    var own = Bounds;
    int minC = int.MaxValue, minR = int.MaxValue, maxC = -1, maxR = -1, changed = 0;
    for (var i = 0; i < after.Length; i++)
    {
      if (Math.Abs(after[i] - before[i]) <= 24) continue;
      int c = i % cols, r = i / cols;
      if (own.Contains(screen.X + c * SampleStep, screen.Y + r * SampleStep)) continue;
      changed++;
      minC = Math.Min(minC, c); maxC = Math.Max(maxC, c);
      minR = Math.Min(minR, r); maxR = Math.Max(maxR, r);
    }
    // Typing changes a small patch; scrolling or a new page changes a lot
    if (changed < 3 || changed >= after.Length / 50 || maxC - minC >= cols / 3 || maxR - minR >= rows / 4)
      return;
    // The right end of what changed: where the newest letter is
    seenTyping = new Point(screen.X + maxC * SampleStep, screen.Y + (minR + maxR) / 2 * SampleStep);
    source = Source.Screen;
    ShowStatus();
  }

  string status = "";

  /// The top bar says what the pointer view follows.
  void ShowStatus()
  {
    var text = mode != Mode.Pointer ? "" : source switch
    {
      Source.Caret => "Following your typing",
      Source.Screen => "Following your typing (from the screen)",
      _ => "Following the mouse",
    };
    if (text == status) return;
    status = text;
    Invalidate(new Rectangle(0, 0, ClientSize.Width, Bar));
  }

  bool ShowMagnifier(bool show)
  {
    if (show && !StartMagnifier()) return false;
    if (magnifier == IntPtr.Zero || magShown == show) return true;
    magShown = show;
    Native.ShowWindow(magnifier, show ? Native.SW_SHOWNA : Native.SW_HIDE);
    return true;
  }

  /// The screen at a, with the pointer drawn on it, into the picture.
  void Blit(Rectangle a, Rectangle pic)
  {
    var screen = Native.GetDC(IntPtr.Zero);
    var dc = Native.GetDC(Handle);
    try
    {
      if (frameDc == IntPtr.Zero || frameSize != a.Size)
      {
        FreeFrame();
        frameDc = Native.CreateCompatibleDC(dc);
        frameBmp = Native.CreateCompatibleBitmap(dc, a.Width, a.Height);
        frameOld = Native.SelectObject(frameDc, frameBmp);
        frameSize = a.Size;
      }
      Native.BitBlt(frameDc, 0, 0, a.Width, a.Height, screen, a.X, a.Y, Native.SRCCOPY);
      var info = new Native.CURSORINFO { cbSize = Marshal.SizeOf<Native.CURSORINFO>() };
      if (Native.GetCursorInfo(ref info) && (info.flags & Native.CURSOR_SHOWING) != 0 && info.hCursor != IntPtr.Zero)
      {
        var hot = HotSpot(info.hCursor);
        Native.DrawIconEx(frameDc, info.pt.X - a.X - hot.X, info.pt.Y - a.Y - hot.Y, info.hCursor,
          0, 0, 0, IntPtr.Zero, Native.DI_NORMAL);
      }
      Native.BitBlt(dc, pic.X, pic.Y, a.Width, a.Height, frameDc, 0, 0, Native.SRCCOPY);
    }
    finally
    {
      Native.ReleaseDC(Handle, dc);
      Native.ReleaseDC(IntPtr.Zero, screen);
    }
  }

  Point HotSpot(IntPtr cursor)
  {
    if (hotspots.TryGetValue(cursor, out var known)) return known;
    var hot = Point.Empty;
    if (Native.GetIconInfo(cursor, out var icon))
    {
      hot = new Point(icon.xHotspot, icon.yHotspot);
      if (icon.hbmMask != IntPtr.Zero) Native.DeleteObject(icon.hbmMask);
      if (icon.hbmColor != IntPtr.Zero) Native.DeleteObject(icon.hbmColor);
    }
    return hotspots[cursor] = hot;
  }

  void FreeFrame()
  {
    if (frameDc == IntPtr.Zero) return;
    Native.SelectObject(frameDc, frameOld);
    Native.DeleteObject(frameBmp);
    Native.DeleteDC(frameDc);
    frameDc = frameBmp = frameOld = IntPtr.Zero;
  }
}

/// Which screens are the laptop's own panel and which are monitors plugged
/// into it, from Windows' display paths (the output each screen goes to).
static class Displays
{
  const uint QDC_ONLY_ACTIVE_PATHS = 2, GET_SOURCE_NAME = 1;
  const int ERROR_INSUFFICIENT_BUFFER = 122;

  public static string Name(Screen s) => s.DeviceName.TrimEnd('\0');

  /// The device names (\\.\DISPLAY1 …) of the screens shown only on a
  /// built-in panel. Empty when Windows can't say, so nothing moves.
  public static HashSet<string> BuiltInScreens()
  {
    var builtIn = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    var external = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    try
    {
      PathInfo[] paths = [];
      uint pathCount = 0;
      for (var attempt = 0; attempt < 3; attempt++)
      {
        if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, out pathCount, out var modeCount) != 0) return builtIn;
        paths = new PathInfo[pathCount];
        var modes = new ModeInfo[modeCount];
        var result = QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, ref pathCount, paths, ref modeCount, modes, IntPtr.Zero);
        if (result == 0) break;
        if (result != ERROR_INSUFFICIENT_BUFFER || attempt == 2) return builtIn;
      }
      for (var i = 0; i < pathCount; i++)
      {
        var path = paths[i];
        var source = new SourceName
        {
          Type = GET_SOURCE_NAME,
          Size = (uint)Marshal.SizeOf<SourceName>(),
          AdapterLow = path.SourceAdapterLow,
          AdapterHigh = path.SourceAdapterHigh,
          Id = path.SourceId,
          GdiName = "",
        };
        if (DisplayConfigGetDeviceInfo(ref source) != 0) continue;
        // Internal, embedded DisplayPort or embedded UDI: a laptop's own panel
        var panel = path.OutputTechnology is 0x80000000 or 11 or 13;
        (panel ? builtIn : external).Add(source.GdiName.TrimEnd('\0'));
      }
    }
    catch (Exception e) { Debug.WriteLine($"Hi-chat: displays not read: {e.Message}"); }
    // A screen duplicated onto a monitor counts as the monitor
    builtIn.ExceptWith(external);
    return builtIn;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct PathInfo
  {
    public uint SourceAdapterLow;
    public int SourceAdapterHigh;
    public uint SourceId, SourceModeIndex, SourceFlags;
    public uint TargetAdapterLow;
    public int TargetAdapterHigh;
    public uint TargetId, TargetModeIndex, OutputTechnology, Rotation, Scaling,
      RefreshNumerator, RefreshDenominator, ScanLineOrdering;
    public int TargetAvailable;
    public uint TargetFlags, Flags;
  }

  // Only passed through: 64 bytes, as Windows lays it out
  [StructLayout(LayoutKind.Sequential, Size = 64)]
  struct ModeInfo { public uint InfoType; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct SourceName
  {
    public uint Type, Size, AdapterLow;
    public int AdapterHigh;
    public uint Id;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string GdiName;
  }

  [DllImport("user32.dll")]
  static extern int GetDisplayConfigBufferSizes(uint flags, out uint pathCount, out uint modeCount);
  [DllImport("user32.dll")]
  static extern int QueryDisplayConfig(uint flags, ref uint pathCount, [Out] PathInfo[] paths,
    ref uint modeCount, [Out] ModeInfo[] modes, IntPtr topology);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int DisplayConfigGetDeviceInfo(ref SourceName request);
}

static class Native
{
  public const int WS_EX_NOACTIVATE = 0x08000000, WS_EX_APPWINDOW = 0x00040000, WS_EX_TOOLWINDOW = 0x80,
    WS_EX_TOPMOST = 0x8, WS_EX_LAYERED = 0x80000, WS_EX_TRANSPARENT = 0x20;
  public const uint DI_NORMAL = 3;

  [StructLayout(LayoutKind.Sequential)]
  public struct CURSORINFO { public int cbSize, flags; public IntPtr hCursor; public POINT pt; }
  public const uint WS_CHILD = 0x40000000, WS_VISIBLE = 0x10000000, MS_SHOWMAGNIFIEDCURSOR = 1;
  public const int WM_MOUSEACTIVATE = 0x21, MA_NOACTIVATE = 3, WM_NCHITTEST = 0x84, WM_QUIT = 0x12;
  public const int HTCLIENT = 1, HTCAPTION = 2, HTLEFT = 10, HTRIGHT = 11, HTTOP = 12, HTTOPLEFT = 13,
    HTTOPRIGHT = 14, HTBOTTOM = 15, HTBOTTOMLEFT = 16, HTBOTTOMRIGHT = 17;
  public const int SW_HIDE = 0, SW_SHOWNOACTIVATE = 4, SW_SHOWNA = 8;
  public const uint SWP_NOSIZE = 1, SWP_NOMOVE = 2, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;
  public static readonly IntPtr HWND_TOPMOST = new(-1), HWND_NOTOPMOST = new(-2);
  public const uint LWA_ALPHA = 2;
  public const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
  public const int DWM_TNP_RECTDESTINATION = 1, DWM_TNP_OPACITY = 4, DWM_TNP_VISIBLE = 8,
    DWM_TNP_SOURCECLIENTAREAONLY = 0x10;
  public const int MW_FILTERMODE_EXCLUDE = 0;

  public const int WH_KEYBOARD_LL = 13, WH_MOUSE_LL = 14;
  public const int WM_KEYDOWN = 0x100, WM_SYSKEYDOWN = 0x104;
  public const int WM_LBUTTONDOWN = 0x201, WM_RBUTTONDOWN = 0x204, WM_MBUTTONDOWN = 0x207, WM_MOUSEWHEEL = 0x20A;
  public const uint LLKHF_INJECTED = 0x10, LLMHF_INJECTED = 1;
  public const uint VK_RETURN = 0x0D, VK_ESCAPE = 0x1B, VK_PRIOR = 0x21, VK_NEXT = 0x22, VK_LEFT = 0x25, VK_UP = 0x26, VK_RIGHT = 0x27,
    VK_DOWN = 0x28, VK_X = 0x58, VK_Z = 0x5A, VK_LWIN = 0x5B, VK_RWIN = 0x5C, VK_LSHIFT = 0xA0, VK_RSHIFT = 0xA1,
    VK_LCONTROL = 0xA2, VK_RCONTROL = 0xA3, VK_LMENU = 0xA4, VK_RMENU = 0xA5;
  /// A key no keyboard has; pressing it in between keeps a lone Alt from opening menus.
  public const uint VK_MASK = 0xE8;

  public delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public IntPtr dwExtraInfo; }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X, Y; }
  public struct ICONINFO { public bool fIcon; public int xHotspot, yHotspot; public IntPtr hbmMask, hbmColor; }
  public const uint SRCCOPY = 0x00CC0020;
  public const int CURSOR_SHOWING = 1;
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
  [DllImport("user32.dll")] public static extern bool GetIconInfo(IntPtr icon, out ICONINFO info);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int w, int h);
  [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
  [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);

  [StructLayout(LayoutKind.Sequential)]
  public struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData, flags, time; public IntPtr dwExtraInfo; }

  [StructLayout(LayoutKind.Sequential)]
  public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  public struct DWM_THUMBNAIL_PROPERTIES
  {
    public int dwFlags;
    public RECT rcDestination, rcSource;
    public byte opacity;
    public int fVisible, fSourceClientAreaOnly;
  }

  public unsafe struct MAGTRANSFORM { public fixed float v[9]; }

  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }

  [StructLayout(LayoutKind.Sequential)]
  struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }

  [StructLayout(LayoutKind.Explicit)]
  struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }

  [StructLayout(LayoutKind.Sequential)]
  struct INPUT { public uint type; public InputUnion u; }

  /// Presses keys as a program would: pairs of (key, released).
  public static void SendKeys(params object[] keys)
  {
    var inputs = new INPUT[keys.Length / 2];
    for (var i = 0; i < inputs.Length; i++)
    {
      inputs[i].type = 1; // keyboard
      inputs[i].u.ki.wVk = (ushort)(uint)keys[2 * i];
      inputs[i].u.ki.dwFlags = (bool)keys[2 * i + 1] ? 2u : 0u; // KEYEVENTF_KEYUP
    }
    SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
  }

  /// Keys, clicks, painting, timers or a call from another thread waiting
  /// for this thread (GetQueueStatus' high word: what's in the queue now).
  public static bool InputWaiting() =>
    (GetQueueStatus(QS_ALLINPUT_BUT_POSTED) >> 16 & QS_ALLINPUT_BUT_POSTED) != 0;
  // QS_KEY, QS_MOUSE, QS_PAINT, QS_TIMER, QS_SENDMESSAGE, QS_RAWINPUT, QS_TOUCH, QS_POINTER
  const uint QS_ALLINPUT_BUT_POSTED = 0x0001 | 0x0006 | 0x0020 | 0x0010 | 0x0040 | 0x0400 | 0x0800 | 0x1000;
  [DllImport("user32.dll")] static extern uint GetQueueStatus(uint flags);

  /// Gives a window the keyboard. Windows lets only the app in front do that,
  /// so this briefly joins the front app's input to make the switch.
  public static void ForceForeground(IntPtr hwnd)
  {
    if (GetForegroundWindow() == hwnd) return;
    var front = GetWindowThreadProcessId(GetForegroundWindow(), out _);
    var me = GetCurrentThreadId();
    var joined = front != 0 && front != me && AttachThreadInput(me, front, true);
    SetForegroundWindow(hwnd);
    BringWindowToTop(hwnd);
    if (joined) AttachThreadInput(me, front, false);
  }

  public const int WM_INPUT = 0x00FF;
  public const uint RIDEV_INPUTSINK = 0x100, RID_INPUT = 0x10000003, RIDI_PREPARSEDDATA = 0x20000005,
    RIM_TYPEHID = 2, VK_MENU = 0x12;
  public const int HIDP_STATUS_SUCCESS = 0x00110000;

  [StructLayout(LayoutKind.Sequential)]
  public struct RAWINPUTDEVICE { public ushort UsagePage, Usage; public uint Flags; public IntPtr Target; }

  [StructLayout(LayoutKind.Sequential)]
  public struct RAWINPUTHEADER { public uint Type, Size; public IntPtr Device, WParam; }

  [DllImport("user32.dll")]
  public static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] devices, uint count, uint size);
  [DllImport("user32.dll")]
  public static extern uint GetRawInputData(IntPtr input, uint command, IntPtr data, ref uint size, uint headerSize);
  [DllImport("user32.dll")]
  public static extern uint GetRawInputDeviceInfo(IntPtr device, uint command, IntPtr data, ref uint size);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint mapType);
  public const uint MAPVK_VK_TO_CHAR = 2;
  [DllImport("hid.dll")] public static extern int HidP_GetCaps(IntPtr parsed, IntPtr caps);
  [DllImport("hid.dll")]
  public static extern int HidP_GetValueCaps(int type, IntPtr caps, ref ushort length, IntPtr parsed);
  [DllImport("hid.dll")]
  public static extern int HidP_GetUsageValue(int type, ushort page, ushort link, ushort usage, out uint value,
    IntPtr parsed, IntPtr report, uint length);
  [DllImport("hid.dll")]
  public static extern int HidP_GetUsages(int type, ushort page, ushort link, [Out] ushort[] usages, ref uint length,
    IntPtr parsed, IntPtr report, uint length2);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SetWindowsHookEx(int idHook, HookProc fn, IntPtr hMod, uint threadId);
  [DllImport("user32.dll")] public static extern bool UnhookWindowsHookEx(IntPtr hhk);
  [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hhk, int code, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")] public static extern bool TranslateMessage(ref MSG msg);
  [DllImport("user32.dll")] public static extern IntPtr DispatchMessage(ref MSG msg);
  [DllImport("user32.dll")] public static extern bool PostThreadMessage(uint threadId, int msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hwnd, int x, int y, int w, int h, bool repaint);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [StructLayout(LayoutKind.Sequential)]
  public struct GUITHREADINFO
  {
    public int cbSize;
    public uint flags;
    public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret;
    public RECT rcCaret;
  }
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO info);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd, ref POINT p);
  [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr hwnd);
  public const uint OBJID_CARET = 0xFFFFFFF8;
  [DllImport("oleacc.dll")]
  public static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid,
    [MarshalAs(UnmanagedType.Interface)] out object acc);
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO info);
  [DllImport("user32.dll")] public static extern bool DrawIconEx(IntPtr dc, int x, int y, IntPtr icon, int w, int h, uint step, IntPtr brush, uint flags);
  [DllImport("user32.dll")] public static extern bool InvalidateRect(IntPtr hwnd, IntPtr rect, bool erase);
  [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint key, byte alpha, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr CreateWindowEx(int exStyle, string cls, string name, uint style, int x, int y,
    int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetModuleHandle(string? name);
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
  [DllImport("dwmapi.dll")] public static extern int DwmRegisterThumbnail(IntPtr dest, IntPtr src, out IntPtr thumb);
  [DllImport("dwmapi.dll")] public static extern int DwmUnregisterThumbnail(IntPtr thumb);
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
  [DllImport("dwmapi.dll")] public static extern int DwmUpdateThumbnailProperties(IntPtr thumb, ref DWM_THUMBNAIL_PROPERTIES props);
  [DllImport("magnification.dll")] public static extern bool MagInitialize();
  [DllImport("magnification.dll")] public static extern bool MagSetWindowSource(IntPtr hwnd, RECT rect);
  [DllImport("magnification.dll")] public static extern bool MagSetWindowTransform(IntPtr hwnd, ref MAGTRANSFORM t);
  [DllImport("magnification.dll")] public static extern bool MagSetWindowFilterList(IntPtr hwnd, int mode, int count, IntPtr[] list);
}
