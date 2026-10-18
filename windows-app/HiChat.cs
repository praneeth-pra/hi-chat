// Hi-chat for Windows: the Hi-chat site in its own window, with the same
// global shortcuts as the Mac app (mac-app/HiChat.swift). Windows keyboards
// have no usable fn key, so the fn chords are Ctrl + Alt chords here:
//
//   tap Ctrl (left or right)      dictate: tap again to stop and send
//   Escape while dictating        throw the recording away
//   tap Right Alt                 type into Hi-chat; tap again (or Escape)
//                                 to go back to the app you were in
//   Ctrl + Alt + Right / Enter    send what's typed in the box
//   Ctrl + Alt + Up / Down        code block above / below
//   Ctrl + Alt + Shift + Up/Down  scroll the chat by most of a screen
//   Ctrl + Alt + scroll           scroll Hi-chat from anywhere
//   Ctrl + Alt + Left             live mirror window (Hi-chat, then the
//                                 screen around the pointer);
//                                 Ctrl + Alt + Shift + Left closes it
//
// A click in Hi-chat doesn't take the keyboard from the app you're in;
// clicking into a text box (or tapping Right Alt) does. Closing the window
// keeps Hi-chat running beside the clock, so the shortcuts keep working.
//
// The first run installs it for this Windows user (no admin needed) in
// %LOCALAPPDATA%\Programs\Hi-chat with a Start menu entry. New versions:
// Hi-chat asks once when one is out, then swaps itself and restarts.
//
// Build: .github/workflows/windows-app.yml (dotnet publish, one Hi-chat.exe).

using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

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
    // After an update: the old copy is still quitting.
    var after = Array.IndexOf(args, "--after");
    if (after >= 0 && after + 1 < args.Length && int.TryParse(args[after + 1], out var pid))
    {
      try { Process.GetProcessById(pid).WaitForExit(15000); } catch { }
    }

    using var single = new Mutex(true, "dev.hitechie.hichat", out var first);
    using var show = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
    if (!first)
    {
      show.Set(); // Hi-chat is already running: bring its window up
      return;
    }
    if (InstallIfNeeded()) return;
    try { File.Delete(InstalledExe + ".old"); } catch { }

    Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    var window = new ChatWindow();
    var waiter = new Thread(() =>
    {
      while (show.WaitOne())
      {
        try { window.BeginInvoke(window.ShowChat); } catch { return; }
      }
    }) { IsBackground = true };
    waiter.Start();
    Application.Run(window);
  }

  /// First run from a download: copy into the user's Programs folder, add a
  /// Start menu entry and start that copy. True when this copy should quit.
  static bool InstallIfNeeded()
  {
    var here = Environment.ProcessPath;
    if (here == null || string.Equals(Path.GetFullPath(here), InstalledExe, StringComparison.OrdinalIgnoreCase))
      return false;
    try
    {
      Directory.CreateDirectory(InstallDir);
      File.Copy(here, InstalledExe, true);
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
  public int[]? Mirror { get; set; }
  public string? SkippedVersion { get; set; }

  static string FilePath => Path.Combine(App.DataDir, "settings.json");
  public static Settings Current { get; } = Load();

  static Settings Load()
  {
    try { return JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath)) ?? new(); }
    catch { return new(); }
  }

  public void Save()
  {
    try
    {
      Directory.CreateDirectory(App.DataDir);
      File.WriteAllText(FilePath, JsonSerializer.Serialize(this));
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
  bool quitting;
  /// On while Hi-chat has the keyboard from Right Alt or a click in a box,
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
    base.WndProc(ref m);
  }

  protected override async void OnHandleCreated(EventArgs e)
  {
    base.OnHandleCreated(e);
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
  }

  protected override void OnFormClosing(FormClosingEventArgs e)
  {
    if (WindowState == FormWindowState.Normal)
    {
      Settings.Current.Window = Settings.Pack(Bounds);
      Settings.Current.Save();
    }
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
    else key.SetValue("Hi-chat", $"\"{Environment.ProcessPath}\"");
    loginItem.Checked = OpensAtLogin();
  }

  // MARK: Page

  async Task StartWebView()
  {
    CoreWebView2Environment env;
    try
    {
      env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(App.DataDir, "WebView2"),
        new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required"));
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
      using var doc = JsonDocument.Parse(e.WebMessageAsJson);
      var body = doc.RootElement;
      if (body.ValueKind != JsonValueKind.Object) return;
      if (body.TryGetProperty("dictation", out var d) && d.ValueKind == JsonValueKind.String)
      {
        var status = d.GetString();
        if (keys != null) keys.Dictating = status is "recording" or "starting";
        // Started from the page's own mic button or a shortcut alike
        if (status is "starting" or "recording" or "transcribing") BringUp();
      }
      if (body.TryGetProperty("keyboard", out var k) && k.ValueKind == JsonValueKind.True && !Typing)
        StartTyping(focusBox: false);
    }
    catch (JsonException) { }
  }

  /// Runs one of the page's remote keys (see web-app/src/lib/remoteKeys.ts).
  public void Remote(string key)
  {
    // Dictating or sending is asking a question: bring the window up to show it.
    if (key is "F14" or "F15") BringUp();
    _ = webView.CoreWebView2?.ExecuteScriptAsync(
      $"window.hiChatRemote && window.hiChatRemote({JsonSerializer.Serialize(key)})");
  }

  public void ScrollChat(double fraction) => RunInPage(
    $"const s = document.querySelector('[data-thread-scroller]'); if (s) s.scrollBy({{ top: s.clientHeight * {fraction.ToString(System.Globalization.CultureInfo.InvariantCulture)}, behavior: 'smooth' }})");

  public void ScrollChatBy(int pixels) => RunInPage(
    $"const s = document.querySelector('[data-thread-scroller]'); if (s) s.scrollBy({{ top: {pixels} }})");

  void RunInPage(string code) => _ = webView.CoreWebView2?.ExecuteScriptAsync($"(() => {{ {code} }})()");

  // MARK: Window

  public void ShowChat()
  {
    if (!Visible) Show();
    if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
    Native.ForceForeground(Handle);
  }

  /// Puts Hi-chat in front of other windows without taking the keyboard, so
  /// the app you're in stays active.
  public void BringUp()
  {
    Native.ShowWindow(Handle, Visible && WindowState != FormWindowState.Minimized
      ? Native.SW_SHOWNA : Native.SW_SHOWNOACTIVATE);
    if (!Visible) Visible = true;
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
    if (focusBox) Remote("F17"); // the cursor goes to the end of the message box
  }

  public void StopTyping()
  {
    var back = typingReturnTo;
    Typing = false;
    typingReturnTo = IntPtr.Zero;
    if (back != IntPtr.Zero && Native.IsWindow(back)) Native.ForceForeground(back);
  }

  public void ToggleMirror() => mirror.Toggle();
  public void HideMirror() => mirror.HideMirror();
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
    Uri? exe = null;
    try
    {
      // The Mac app's releases are the repository's "latest"; Windows ones are win-*.
      using var doc = JsonDocument.Parse(await http.GetStringAsync(
        $"https://api.github.com/repos/{App.Repo}/releases?per_page=30"));
      foreach (var release in doc.RootElement.EnumerateArray())
      {
        var tag = release.GetProperty("tag_name").GetString() ?? "";
        if (!tag.StartsWith("win-") || release.GetProperty("draft").GetBoolean()) continue;
        version = tag["win-".Length..];
        foreach (var asset in release.GetProperty("assets").EnumerateArray())
        {
          if (asset.GetProperty("name").GetString() == "Hi-chat.exe")
            Uri.TryCreate(asset.GetProperty("browser_download_url").GetString(), UriKind.Absolute, out exe);
        }
        break;
      }
    }
    catch (Exception e)
    {
      Debug.WriteLine($"Hi-chat: update check failed: {e.Message}");
      if (asked) Tell("Couldn't reach GitHub to check for updates.");
      return;
    }
    // Updates come only from this repository's own releases
    if (version == null || !IsNewer(version, App.Version) || exe == null || exe.Scheme != "https" ||
        exe.Host != "github.com" || !exe.AbsolutePath.StartsWith($"/{App.Repo}/releases/download/"))
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
    var now = new TaskDialogButton("Update Now");
    var later = new TaskDialogButton("Later");
    var answer = TaskDialog.ShowDialog(app, new TaskDialogPage
    {
      Caption = "Hi-chat",
      Heading = $"Hi-chat {version} is ready",
      Text = $"Update Now installs it and restarts Hi-chat, which takes a few seconds. You have {App.Version}.",
      Buttons = { now, later },
    });
    busy = false;
    if (answer == now) await Install(exe);
    else
    {
      Settings.Current.SkippedVersion = version;
      Settings.Current.Save();
    }
  }

  async Task Install(Uri url)
  {
    busy = true;
    try
    {
      var target = Environment.ProcessPath!;
      var fresh = target + ".new";
      var bytes = await http.GetByteArrayAsync(url);
      // A real Windows program, not an error page
      if (bytes.Length < 1_000_000 || bytes[0] != 'M' || bytes[1] != 'Z')
      {
        Tell("The download didn't look right. Try again with Check for updates.");
        return;
      }
      await File.WriteAllBytesAsync(fresh, bytes);
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
      Process.Start(new ProcessStartInfo(target, $"--after {Environment.ProcessId}") { UseShellExecute = false });
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
    try { app.BeginInvoke(() => action(app)); } catch (InvalidOperationException) { }
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

  bool KeyDown(uint vk)
  {
    const bool pass = false;
    var repeating = !held.Add(vk);
    if (IsModifier(vk))
    {
      if (repeating) return pass;
      var tapKey = vk is Native.VK_LCONTROL or Native.VK_RCONTROL or Native.VK_RMENU;
      lone = tapKey && held.Count == 1 ? (vk, Environment.TickCount64) : null;
      return pass;
    }
    lone = null;
    if (vk == Native.VK_ESCAPE && !Ctrl && !Alt && !Win)
    {
      if (Dictating) return Swallow(vk, a => a.Remote("Shift+F13"));
      if (app.Typing) return Swallow(vk, a => a.StopTyping());
      return pass;
    }
    if (!Ctrl || !Alt || Win) return pass;
    switch (vk)
    {
      case Native.VK_UP or Native.VK_DOWN:
        var up = vk == Native.VK_UP;
        if (Shift) return Swallow(vk, a => a.ScrollChat(up ? -0.8 : 0.8));
        return repeating ? Swallow(vk, null) : Swallow(vk, a => a.Remote(up ? "Shift+F16" : "Shift+F17"));
      case Native.VK_RIGHT or Native.VK_RETURN:
        if (Shift) return pass;
        return Swallow(vk, repeating ? null : a => a.Remote("F15"));
      case Native.VK_LEFT:
        var shift = Shift;
        return Swallow(vk, repeating ? null : a => { if (shift) a.HideMirror(); else a.ToggleMirror(); });
      default:
        return pass;
    }
  }

  bool KeyUp(uint vk)
  {
    const bool pass = false;
    held.Remove(vk);
    if (swallowed.Remove(vk)) return true;
    if (lone is { } l && l.key == vk && Environment.TickCount64 - l.at < TapMs)
    {
      lone = null;
      if (vk == Native.VK_RMENU)
      {
        Later(a => a.ToggleTyping());
        // Alt pressed and let go alone opens the menu of the app in front;
        // an unused key in between stops that (as AutoHotkey does).
        Native.SendKeys(Native.VK_MASK, false, Native.VK_MASK, true, Native.VK_RMENU, true);
        return true;
      }
      Later(a => a.Remote("F14"));
      return pass;
    }
    if (IsModifier(vk)) lone = null;
    return pass;
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
        // Ctrl + Alt + scroll scrolls Hi-chat from anywhere
        if (!Ctrl || !Alt || Win) return pass;
        var delta = (short)(e.mouseData >> 16);
        Later(a => a.ScrollChatBy(-delta));
        return true;
      default:
        return pass;
    }
  }
}

/// The live mirror: a small window on top of everything that shows the
/// Hi-chat window (a DWM thumbnail, drawn by Windows itself, so it is as
/// live as the real window) or the screen around the pointer (the Windows
/// Magnifier control at 1x). It never takes the keyboard. Drag the top bar
/// to move, drag an edge to resize, x closes it.
sealed class Mirror : Form
{
  enum Mode { Chat, Pointer }
  readonly ChatWindow chat;
  Mode mode = Mode.Chat;
  IntPtr thumb;
  IntPtr magnifier;
  static bool magReady;
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
    Settings.Current.Mirror = Settings.Pack(Bounds);
    Settings.Current.Save();
  }

  /// Hidden -> shows Hi-chat; Hi-chat -> the screen around the pointer; and back.
  public void Toggle()
  {
    if (!Visible)
    {
      mode = Mode.Chat;
      Native.ShowWindow(Handle, Native.SW_SHOWNOACTIVATE);
      Visible = true;
    }
    else mode = mode == Mode.Chat ? Mode.Pointer : Mode.Chat;
    Restart();
  }

  public void HideMirror()
  {
    tick.Stop();
    Unthumb();
    if (magnifier != IntPtr.Zero) Native.ShowWindow(magnifier, Native.SW_HIDE);
    Hide();
  }

  void Restart()
  {
    area = null;
    if (mode == Mode.Chat)
    {
      if (magnifier != IntPtr.Zero) Native.ShowWindow(magnifier, Native.SW_HIDE);
      Unthumb();
      if (Native.DwmRegisterThumbnail(Handle, chat.Handle, out thumb) != 0) thumb = IntPtr.Zero;
      UpdateThumb();
    }
    else
    {
      Unthumb();
      if (!StartMagnifier()) return;
      Native.ShowWindow(magnifier, Native.SW_SHOWNA);
      Follow();
    }
    tick.Start(); // also follows the Hi-chat window's size
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
    if (magnifier == IntPtr.Zero) return;
    Native.GetCursorPos(out var p);
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
    Native.MagSetWindowSource(magnifier, new Native.RECT { Left = a.Left, Top = a.Top, Right = a.Right, Bottom = a.Bottom });
    Native.InvalidateRect(magnifier, IntPtr.Zero, true); // redraw: the screen behind keeps changing
  }
}

static class Native
{
  public const int WS_EX_NOACTIVATE = 0x08000000, WS_EX_APPWINDOW = 0x00040000, WS_EX_TOOLWINDOW = 0x80,
    WS_EX_TOPMOST = 0x8, WS_EX_LAYERED = 0x80000;
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
  public const uint VK_RETURN = 0x0D, VK_ESCAPE = 0x1B, VK_LEFT = 0x25, VK_UP = 0x26, VK_RIGHT = 0x27,
    VK_DOWN = 0x28, VK_LWIN = 0x5B, VK_RWIN = 0x5C, VK_LSHIFT = 0xA0, VK_RSHIFT = 0xA1,
    VK_LCONTROL = 0xA2, VK_RCONTROL = 0xA3, VK_LMENU = 0xA4, VK_RMENU = 0xA5;
  /// A key no keyboard has; pressing it in between keeps a lone Alt from opening menus.
  public const uint VK_MASK = 0xE8;

  public delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public IntPtr dwExtraInfo; }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X, Y; }

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
  [DllImport("dwmapi.dll")] public static extern int DwmUpdateThumbnailProperties(IntPtr thumb, ref DWM_THUMBNAIL_PROPERTIES props);
  [DllImport("magnification.dll")] public static extern bool MagInitialize();
  [DllImport("magnification.dll")] public static extern bool MagSetWindowSource(IntPtr hwnd, RECT rect);
  [DllImport("magnification.dll")] public static extern bool MagSetWindowTransform(IntPtr hwnd, ref MAGTRANSFORM t);
  [DllImport("magnification.dll")] public static extern bool MagSetWindowFilterList(IntPtr hwnd, int mode, int count, IntPtr[] list);
}
