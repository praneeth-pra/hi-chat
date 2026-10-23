// Hi-chat for Mac: the Hi-chat site in its own light window, with the
// keyboard shortcuts that the Hammerspoon script (scripts/hammerspoon) gave
// Safari built in.
//
//   tap Left Control        dictate: tap again to stop and send
//   Escape while dictating  throw the recording away
//   tap Left Option         silent screenshot of the laptop's own screen
//                           (the screen the pointer is on when there is no
//                           built-in one), put in Hi-chat's message box (also saved where the Mac
//                           saves screenshots and copied; needs Screen
//                           Recording)
//   fn + Right              send what's typed in the box
//   fn + Up / Down          code block above / below
//   fn + Shift + Up / Down  scroll the chat by most of a screen
//   hold fn + scroll        scroll Hi-chat from anywhere
//   Z / X                   the real pointer jumps into Hi-chat's message box
//                           (typing on), leaving a lookalike pointer where it
//                           was / pointer and keyboard back to where they
//                           were; fn + Z / X types the letter
//   fn + Left               live mirror window (Hi-chat, then the screen around
//                           the pointer; needs Screen Recording);
//                           fn + Shift + Left closes it
//
// Those are the defaults: each can be changed in Hi-chat's Settings > App
// keys, which records the next keys you press (see ShortcutStore).
//
// The window is a panel that takes the keyboard without making Hi-chat the
// active app, so a click or typing in it never greys out the app you're in.
// The shortcuts need Accessibility (System Settings > Privacy & Security).
//
// With a monitor connected the window goes on it, otherwise on the laptop's
// own screen (see placeOnHomeScreen). Unplugging the monitor hides it until
// the monitor is back or you open Hi-chat (see monitorsChanged).
//
// Hi-chat sits in the menu bar at the top (its H logo); its Dock icon is off
// unless "Show in Dock" is ticked in that menu.
//
// New versions: Hi-chat asks once when one is out (Check for Updates is in
// the menu bar menu), then installs it and restarts.
//
// Build: mac-app/build.sh (GitHub Actions builds the DMG on every change).

import AppKit
import CryptoKit
import ImageIO
import ServiceManagement
import WebKit

let homeURL = URL(string: "https://chat.hi-techie.dev/")!
let appHost = "chat.hi-techie.dev"
let mirrorNote = Notification.Name("dev.hitechie.janmirror")
/// The live mirror, built from mac-app/HiChatMirror.swift into the app.
let mirrorHelper = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/HiChatMirror").path
/// Marks the scroll events this app posts, so its own tap lets them through.
let ownEventMark: Int64 = 0x4869_4368

enum Key {
  static let leftControl: Int64 = 59
  static let leftOption: Int64 = 58
  static let fn: Int64 = 63
  static let escape: Int64 = 53
  static let right: Int64 = 124
  static let left: Int64 = 123
  static let end: Int64 = 119
  static let home: Int64 = 115
  static let pageUp: Int64 = 116
  static let pageDown: Int64 = 121
  static let z: Int64 = 6
  static let x: Int64 = 7
  static let n: Int64 = 45

  /// The modifier keys: the flag each sets, its name in a shortcut, and how
  /// Settings writes it on its own.
  static let modifiers: [Int64: (mask: CGEventFlags, mod: String, name: String)] = [
    59: (.maskControl, "control", "Left Control"), 62: (.maskControl, "control", "Right Control"),
    58: (.maskAlternate, "option", "Left Option"), 61: (.maskAlternate, "option", "Right Option"),
    55: (.maskCommand, "command", "Left Command"), 54: (.maskCommand, "command", "Right Command"),
    56: (.maskShift, "shift", "Left Shift"), 60: (.maskShift, "shift", "Right Shift"),
    63: (.maskSecondaryFn, "fn", "fn"),
  ]
  /// Home, End, Page Up and Page Down are fn + an arrow on a laptop.
  static let fnArrow: [Int64: String] = [115: "←", 119: "→", 116: "↑", 121: "↓"]
  static let names: [Int64: String] = [
    36: "Return", 48: "Tab", 49: "Space", 51: "Delete", 53: "Esc", 76: "Enter", 117: "Forward Delete",
    115: "Home", 119: "End", 116: "Page Up", 121: "Page Down", 123: "←", 124: "→", 125: "↓", 126: "↑",
    122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6", 98: "F7", 100: "F8", 101: "F9",
    109: "F10", 103: "F11", 111: "F12", 105: "F13", 107: "F14", 113: "F15", 106: "F16", 64: "F17",
    79: "F18", 80: "F19", 90: "F20",
    0: "A", 11: "B", 8: "C", 2: "D", 14: "E", 3: "F", 5: "G", 4: "H", 34: "I", 38: "J", 40: "K",
    37: "L", 46: "M", 45: "N", 31: "O", 35: "P", 12: "Q", 15: "R", 1: "S", 17: "T", 32: "U", 9: "V",
    13: "W", 7: "X", 16: "Y", 6: "Z", 29: "0", 18: "1", 19: "2", 20: "3", 21: "4", 23: "5", 22: "6",
    26: "7", 28: "8", 25: "9", 27: "-", 24: "=", 33: "[", 30: "]", 41: ";", 39: "'", 43: ",", 47: ".",
    44: "/", 42: "\\", 50: "`",
  ]

  static func name(_ key: Int64) -> String {
    modifiers[key]?.name ?? names[key] ?? "Key \(key)"
  }
}

/// A window that takes the keyboard without activating Hi-chat.
final class ChatPanel: NSPanel {
  /// Set for a moment while handing the keyboard back (see stopTyping).
  var refusesKey = false
  override var canBecomeKey: Bool { !refusesKey }
  override var canBecomeMain: Bool { true }

  // Hi-chat is usually not the active app, so its menu bar isn't there to
  // turn Command + C and friends into actions; do it here.
  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    if mods == .command || mods == [.command, .shift] {
      let shift = mods.contains(.shift)
      let action: Selector? =
        switch event.charactersIgnoringModifiers?.lowercased() {
        case "c": #selector(NSText.copy(_:))
        case "v": #selector(NSText.paste(_:))
        case "x": #selector(NSText.cut(_:))
        case "a": #selector(NSResponder.selectAll(_:))
        case "z": shift ? Selector(("redo:")) : Selector(("undo:"))
        case "w": #selector(NSWindow.performClose(_:))
        case "r": #selector(AppController.reloadPage(_:))
        default: nil
        }
      if let action, NSApp.sendAction(action, to: nil, from: self) { return true }
    }
    return super.performKeyEquivalent(with: event)
  }
}

@MainActor
final class AppController: NSObject, NSApplicationDelegate, NSWindowDelegate,
  WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler, WKDownloadDelegate
{
  var panel: ChatPanel!
  var webView: WKWebView!
  var keys: Keys?
  let shortcuts = ShortcutStore()
  lazy var updater = Updater(app: self)
  /// /mirror's mouse and keys, while someone edits the shared screen there.
  let remoteInput = RemoteInput()
  var mirrorTask: Process?
  /// Sends the text cursor's place to the mirror helper (fn + Left's
  /// pointer view follows it while you type).
  let caret = CaretReporter()
  var loginItems: [NSMenuItem] = []
  var statusItem: NSStatusItem?
  var dockItem: NSMenuItem!
  static let showInDockKey = "showInDock"
  /// The app that was in front when Z started typing.
  var typingReturnTo: NSRunningApplication?
  /// Keeps App Nap off, so the mirror stays live while Hi-chat is hidden.
  var awake: NSObjectProtocol?

  func applicationDidFinishLaunching(_ notification: Notification) {
    // App Nap would throttle Hi-chat's timers and network when it is hidden;
    // the Mac can still sleep when idle.
    awake = ProcessInfo.processInfo.beginActivity(
      options: [.userInitiatedAllowingIdleSystemSleep, .latencyCritical],
      reason: "Hi-chat mirrors replies live to another screen")
    buildMenu()
    buildStatusItem()
    buildWindow()
    webView.load(URLRequest(url: homeURL))
    startKeys(prompt: true)
    updater.start()
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
    hiddenWithMonitor = false
    placeOnHomeScreen()
    panel.makeKeyAndOrderFront(nil)
    return true
  }

  func applicationWillTerminate(_ notification: Notification) {
    if mirrorTask?.isRunning == true { tellMirror(["command": "quit"]) }
  }

  // MARK: Window

  func buildWindow() {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.applicationNameForUserAgent = "Version/18.0 Safari/605.1.15 HiChatMac"
    config.mediaTypesRequiringUserActionForPlayback = []
    config.preferences.setValue(true, forKey: "developerExtrasEnabled")
    config.userContentController.add(self, name: "hiChat")
    // Keep the page running at full speed while the window is hidden or
    // behind other windows: a reply being mirrored to /mirror otherwise
    // reaches the other screen in bursts, as WebKit slows hidden pages down.
    config.preferences.inactiveSchedulingPolicy = .none

    webView = WKWebView(frame: .zero, configuration: config)
    webView.uiDelegate = self
    webView.navigationDelegate = self
    webView.allowsBackForwardNavigationGestures = false
    // Until the page paints, show the window's own colour instead of
    // WebKit's white, so opening Hi-chat never flashes a white screen.
    webView.setValue(false, forKey: "drawsBackground")
    if #available(macOS 13.3, *) { webView.isInspectable = true }

    panel = ChatPanel(
      contentRect: NSRect(x: 0, y: 0, width: 1000, height: 800),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .nonactivatingPanel],
      backing: .buffered, defer: false)
    panel.title = "Hi-chat"
    panel.titleVisibility = .hidden
    panel.titlebarAppearsTransparent = true
    panel.isFloatingPanel = false
    panel.level = .normal
    panel.hidesOnDeactivate = false
    panel.becomesKeyOnlyIfNeeded = false
    panel.isReleasedWhenClosed = false
    panel.collectionBehavior = [.managed, .fullScreenPrimary]
    // The page starts below the window buttons, on a strip the colour of
    // Hi-chat's sidebar, so the buttons never sit on the logo.
    panel.backgroundColor = NSColor(name: nil) { look in
      look.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        ? NSColor(red: 13 / 255, green: 13 / 255, blue: 13 / 255, alpha: 1)
        : NSColor(red: 249 / 255, green: 249 / 255, blue: 249 / 255, alpha: 1)
    }
    panel.minSize = NSSize(width: 420, height: 360)
    let content = FlippedView()
    webView.frame = content.bounds
    webView.autoresizingMask = [.width, .height]
    content.addSubview(webView)
    panel.contentView = content
    panel.delegate = self
    panel.center()
    panel.setFrameAutosaveName("HiChatWindow")
    placeOnHomeScreen()
    hadMonitor = AppController.monitorConnected()
    panel.orderFrontRegardless()
    // A monitor plugged in or out: wait for macOS to settle the screens first
    NotificationCenter.default.addObserver(
      self, selector: #selector(screensChanged(_:)),
      name: NSApplication.didChangeScreenParametersNotification, object: nil)
  }

  @objc func screensChanged(_ notification: Notification) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
      self?.monitorsChanged()
    }
  }

  /// Whether a monitor was connected at the last check.
  var hadMonitor = false
  /// Hidden because its monitor was unplugged; it comes back with the monitor.
  var hiddenWithMonitor = false

  /// Plugged in: Hi-chat goes on the monitor (back in view if unplugging hid
  /// it). Unplugged: Hi-chat hides rather than landing on the laptop's
  /// screen; opening it from the menu bar or a shortcut shows it there.
  func monitorsChanged() {
    let monitor = AppController.monitorConnected()
    let had = hadMonitor
    hadMonitor = monitor
    if monitor {
      placeOnHomeScreen()
      if hiddenWithMonitor {
        hiddenWithMonitor = false
        panel.orderFrontRegardless()
      }
    } else if had, panel.isVisible, !panel.styleMask.contains(.fullScreen) {
      hiddenWithMonitor = true
      panel.orderOut(nil)
    }
  }

  static func monitorConnected() -> Bool { NSScreen.screens.contains { !isBuiltIn($0) } }

  @objc func reloadPage(_ sender: Any?) { webView.reload() }

  @objc func showChat(_ sender: Any?) {
    hiddenWithMonitor = false
    placeOnHomeScreen()
    panel.makeKeyAndOrderFront(nil)
  }

  // MARK: Which screen

  /// The laptop's own screen, as opposed to a monitor plugged into it.
  static func isBuiltIn(_ screen: NSScreen) -> Bool {
    guard let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
    else { return false }
    return CGDisplayIsBuiltin(id.uint32Value) != 0
  }

  /// Where Hi-chat belongs: an external monitor when one is connected (the
  /// biggest, if several), else the laptop's screen.
  static func homeScreen() -> NSScreen? {
    let screens = NSScreen.screens
    let area = { (s: NSScreen) in s.frame.width * s.frame.height }
    return screens.filter { !isBuiltIn($0) }.max { area($0) < area($1) }
      ?? screens.first(where: isBuiltIn) ?? NSScreen.main
  }

  /// Where the window last was on a monitor, and on the laptop's screen.
  static func frameKey(onMonitor: Bool) -> String {
    onMonitor ? "HiChatWindowOnMonitor" : "HiChatWindowOnLaptop"
  }

  /// With a monitor connected Hi-chat goes on it, otherwise on the laptop's
  /// screen, back where it last was there. Run at launch, when a monitor is
  /// plugged in or out, and whenever Hi-chat brings its window up; a window
  /// already on the right kind of screen stays where it is.
  func placeOnHomeScreen() {
    guard !panel.styleMask.contains(.fullScreen), let target = AppController.homeScreen()
    else { return }
    let onMonitor = !AppController.isBuiltIn(target)
    if let now = panel.screen, AppController.isBuiltIn(now) != onMonitor { return }
    let area = target.visibleFrame
    var frame = NSRectFromString(
      UserDefaults.standard.string(forKey: AppController.frameKey(onMonitor: onMonitor)) ?? "")
    if frame.isEmpty || !area.intersects(frame) {
      frame.size = panel.frame.size
      frame.origin = NSPoint(x: area.midX - frame.width / 2, y: area.midY - frame.height / 2)
    }
    // Fits the screen: no bigger than it, and wholly on it
    frame.size.width = min(frame.width, area.width)
    frame.size.height = min(frame.height, area.height)
    frame.origin.x = min(max(frame.minX, area.minX), area.maxX - frame.width)
    frame.origin.y = min(max(frame.minY, area.minY), area.maxY - frame.height)
    panel.setFrame(frame, display: true)
  }

  func windowDidMove(_ notification: Notification) { rememberFrame() }
  func windowDidEndLiveResize(_ notification: Notification) { rememberFrame() }

  func rememberFrame() {
    guard let screen = panel.screen, !panel.styleMask.contains(.fullScreen) else { return }
    UserDefaults.standard.set(
      NSStringFromRect(panel.frame),
      forKey: AppController.frameKey(onMonitor: !AppController.isBuiltIn(screen)))
  }

  // MARK: Menu

  func buildMenu() {
    let main = NSMenu()
    let appItem = NSMenuItem()
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "About Hi-chat", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    let login = appMenu.addItem(withTitle: "Open at Login", action: #selector(toggleLogin(_:)), keyEquivalent: "")
    login.target = self
    loginItems.append(login)
    let access = appMenu.addItem(withTitle: "Keyboard Shortcuts Permission…", action: #selector(openAccessibility(_:)), keyEquivalent: "")
    access.target = self
    let update = appMenu.addItem(withTitle: "Check for Updates…", action: #selector(checkForUpdates(_:)), keyEquivalent: "")
    update.target = self
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Hide Hi-chat", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(withTitle: "Quit Hi-chat", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu
    main.addItem(appItem)

    let editItem = NSMenuItem()
    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
    redo.keyEquivalentModifierMask = [.command, .shift]
    edit.addItem(.separator())
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSResponder.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit
    main.addItem(editItem)

    let viewItem = NSMenuItem()
    let view = NSMenu(title: "View")
    let reload = view.addItem(withTitle: "Reload", action: #selector(reloadPage(_:)), keyEquivalent: "r")
    reload.target = self
    viewItem.submenu = view
    main.addItem(viewItem)

    let windowItem = NSMenuItem()
    let window = NSMenu(title: "Window")
    let show = window.addItem(withTitle: "Hi-chat", action: #selector(showChat(_:)), keyEquivalent: "0")
    show.target = self
    window.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    window.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    windowItem.submenu = window
    main.addItem(windowItem)
    NSApp.windowsMenu = window
    NSApp.mainMenu = main
  }

  /// Hi-chat's icon in the menu bar at the top: there even while another
  /// app is in front, and the way in when the Dock icon is off.
  func buildStatusItem() {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    item.button?.image = AppController.menuBarLogo()
    let menu = NSMenu()
    menu.addItem(withTitle: "Show Hi-chat", action: #selector(showChat(_:)), keyEquivalent: "").target = self
    menu.addItem(withTitle: "Reload", action: #selector(reloadPage(_:)), keyEquivalent: "").target = self
    menu.addItem(.separator())
    dockItem = menu.addItem(withTitle: "Show in Dock", action: #selector(toggleDock(_:)), keyEquivalent: "")
    dockItem.target = self
    dockItem.state = UserDefaults.standard.bool(forKey: AppController.showInDockKey) ? .on : .off
    let login = menu.addItem(withTitle: "Open at Login", action: #selector(toggleLogin(_:)), keyEquivalent: "")
    login.target = self
    loginItems.append(login)
    menu.addItem(withTitle: "Keyboard Shortcuts Permission…", action: #selector(openAccessibility(_:)), keyEquivalent: "").target = self
    menu.addItem(withTitle: "Check for Updates…", action: #selector(checkForUpdates(_:)), keyEquivalent: "").target = self
    menu.addItem(.separator())
    menu.addItem(withTitle: "Quit Hi-chat", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
    item.menu = menu
    statusItem = item
    showLoginState()
  }

  /// Hi-chat's slanted H, drawn at menu bar size in one colour like the
  /// other menu bar icons (a template image: macOS colours it to suit).
  static func menuBarLogo() -> NSImage {
    let image = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { _ in
      NSColor.black.setStroke()
      let bar = NSBezierPath()
      bar.move(to: NSPoint(x: 4.6, y: 12.2)); bar.line(to: NSPoint(x: 12.9, y: 7.5))
      bar.lineWidth = 2.5
      bar.stroke()
      let sides = NSBezierPath()
      sides.move(to: NSPoint(x: 5.3, y: 2.4)); sides.line(to: NSPoint(x: 2.4, y: 15.4))
      sides.move(to: NSPoint(x: 15.8, y: 2.4)); sides.line(to: NSPoint(x: 12.9, y: 15.4))
      sides.lineWidth = 3
      sides.lineCapStyle = .round
      sides.stroke()
      return true
    }
    image.isTemplate = true
    image.accessibilityDescription = "Hi-chat"
    return image
  }

  /// Off (the default): no Dock icon; Hi-chat lives in the menu bar.
  @objc func toggleDock(_ sender: Any?) {
    let show = !UserDefaults.standard.bool(forKey: AppController.showInDockKey)
    UserDefaults.standard.set(show, forKey: AppController.showInDockKey)
    dockItem.state = show ? .on : .off
    NSApp.setActivationPolicy(show ? .regular : .accessory)
    // Changing it can send the window behind; bring it back without taking focus
    DispatchQueue.main.async { [weak self] in self?.panel.orderFrontRegardless() }
  }

  func showLoginState() {
    let on = SMAppService.mainApp.status == .enabled
    for item in loginItems { item.state = on ? .on : .off }
  }

  // Right-click on the Dock icon: there even while another app's menu bar shows.
  func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
    let menu = NSMenu()
    let update = menu.addItem(withTitle: "Check for Updates…", action: #selector(checkForUpdates(_:)), keyEquivalent: "")
    update.target = self
    let reload = menu.addItem(withTitle: "Reload", action: #selector(reloadPage(_:)), keyEquivalent: "")
    reload.target = self
    return menu
  }

  @objc func toggleLogin(_ sender: Any?) {
    let service = SMAppService.mainApp
    do {
      if service.status == .enabled { try service.unregister() } else { try service.register() }
    } catch {
      NSLog("Hi-chat: Open at Login failed: \(error)")
    }
    showLoginState()
  }

  @objc func checkForUpdates(_ sender: Any?) {
    Task { await updater.check(asked: true) }
  }

  @objc func openAccessibility(_ sender: Any?) {
    startKeys(prompt: true)
    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
  }

  // MARK: Shortcuts

  /// Starts the keyboard listener once Accessibility is granted; until then
  /// checks again every 2 s (no repeated prompts).
  func startKeys(prompt: Bool) {
    if keys != nil { return }
    let options = ["AXTrustedCheckOptionPrompt": prompt] as CFDictionary
    guard AXIsProcessTrustedWithOptions(options) else {
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
        self?.startKeys(prompt: false)
      }
      return
    }
    let listener = Keys(app: self, store: shortcuts)
    if listener.start() { keys = listener } else {
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
        self?.startKeys(prompt: false)
      }
    }
  }

  /// Settings > App keys: list, record (the next keys pressed), cancel,
  /// clear or reset (one action, or all with no id).
  func shortcutCommand(_ command: String, _ id: String?) {
    let action = id.flatMap(Action.init(rawValue:))
    switch command {
    case "record":
      if let action, let keys { keys.recording = action; keys.lone = nil }
    case "cancel": keys?.recording = nil
    case "clear": if let action { shortcuts.clear(action) }
    case "reset": shortcuts.reset(action)
    default: break
    }
    sendShortcuts()
  }

  func sendShortcuts() {
    var json = shortcuts.json(recording: keys?.recording)
    // Without Accessibility there are no shortcuts to record
    if keys == nil { json = "Object.assign(\(json), { unavailable: 'Allow Hi-chat in System Settings > Privacy & Security > Accessibility first.' })" }
    webView.evaluateJavaScript("window.hiChatShortcuts && window.hiChatShortcuts(\(json))")
  }

  /// Runs one of the page's remote keys (see web-app/src/lib/remoteKeys.ts).
  func remote(_ key: String) {
    // Dictating or sending is asking a question: bring the window up to show it.
    if key == "F14" || key == "F15" { bringUp() }
    let quoted = "\"" + key + "\""
    webView.evaluateJavaScript("window.hiChatRemote && window.hiChatRemote(\(quoted))")
  }

  /// Puts Hi-chat in front of other windows without taking the keyboard or
  /// activating it, so the app you're in stays active.
  func bringUp() {
    if panel.isMiniaturized { panel.deminiaturize(nil) }
    hiddenWithMonitor = false
    placeOnHomeScreen()
    panel.orderFrontRegardless()
  }

  func scrollChat(by fraction: Double) {
    webView.evaluateJavaScript("""
      (() => { const s = document.querySelector('[data-thread-scroller]');
        if (s) s.scrollBy({ top: s.clientHeight * \(fraction), behavior: 'smooth' }) })()
      """)
  }

  /// Where scroll events for the chat go: the middle of the window, in
  /// screen coordinates with the origin at the top left (as CGEvent wants).
  func chatCenter() -> CGPoint? {
    guard panel.isVisible, !panel.isMiniaturized else { return nil }
    let frame = panel.frame
    let top = NSScreen.screens.first?.frame.maxY ?? frame.maxY
    return CGPoint(x: frame.midX, y: top - frame.midY)
  }

  /// On while Z has Hi-chat typing: until X, Escape, or another window
  /// takes the keyboard. The page shows it by the message box.
  var typing = false {
    didSet { if typing != oldValue { tellPageTyping() } }
  }

  func tellPageTyping() {
    webView.evaluateJavaScript("window.hiChatTyping && window.hiChatTyping(\(typing))")
  }

  /// A window that is never seen: taking the keyboard for a moment and
  /// dropping it hands the keyboard back to the app in front, without
  /// hiding Hi-chat (which made it blink).
  lazy var keySink: ChatPanel = {
    let sink = ChatPanel(contentRect: NSRect(x: -10_000, y: -10_000, width: 1, height: 1),
                         styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
    sink.alphaValue = 0
    sink.ignoresMouseEvents = true
    sink.isReleasedWhenClosed = false
    return sink
  }()

  /// Hi-chat takes the keyboard while the app in front stays active; the
  /// real pointer goes to the message box and a lookalike stays where it was.
  func startTyping() {
    let front = NSWorkspace.shared.frontmostApplication
    if front?.processIdentifier != ProcessInfo.processInfo.processIdentifier {
      typingReturnTo = front
    }
    if panel.isMiniaturized { panel.deminiaturize(nil) }
    panel.makeKeyAndOrderFront(nil)
    typing = true
    remote("F17") // the cursor goes to the end of the message box
    pointerToChat()
  }

  func stopTyping() {
    let back = typingReturnTo
    typing = false
    typingReturnTo = nil
    pointerBack()
    guard panel.isKeyWindow else { return }
    // Giving up the keyboard without hiding: the unseen window takes it, then
    // drops it while Hi-chat's window refuses it, so it goes back to the app
    // in front.
    panel.refusesKey = true
    keySink.makeKeyAndOrderFront(nil)
    keySink.orderOut(nil)
    back?.activate()
    DispatchQueue.main.async { [weak self] in self?.panel.refusesKey = false }
  }

  func windowDidResignKey(_ notification: Notification) {
    typing = false
    typingReturnTo = nil
    // The keyboard went elsewhere (a click in another app, say): the
    // lookalike would only mislead now.
    pointerForget()
  }

  // MARK: Pointer

  /// Where the pointer was before Z took it to Hi-chat (screen coordinates,
  /// origin at the top left, as CGEvent uses). A lookalike shows there.
  var pointerHome: CGPoint?

  func pointerNow() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }

  func warpPointer(_ to: CGPoint) {
    CGWarpMouseCursorPosition(to)
    // Without this the pointer ignores the mouse for a moment after a jump
    CGAssociateMouseAndMouseCursorPosition(1)
  }

  /// Moves the real pointer into the message box, leaving a lookalike where
  /// it was (unless it was on Hi-chat already).
  func pointerToChat() {
    guard panel.isVisible, !panel.isMiniaturized else { return }
    let now = pointerNow()
    let top = NSScreen.screens.first?.frame.maxY ?? panel.frame.maxY
    let frame = panel.frame
    let onChat = CGRect(x: frame.minX, y: top - frame.maxY, width: frame.width, height: frame.height)
    if !onChat.contains(now) && pointerHome == nil {
      pointerHome = now
      pointerLookalike.show(at: now)
    }
    messageBoxPoint { [weak self] point in
      guard let self else { return }
      let screen = self.panel.convertPoint(toScreen: point)
      self.warpPointer(CGPoint(x: screen.x, y: top - screen.y))
    }
  }

  /// Puts the real pointer back on its lookalike, which goes away.
  func pointerBack() {
    guard let home = pointerHome else { return }
    pointerForget()
    warpPointer(home)
  }

  func pointerForget() {
    pointerHome = nil
    pointerLookalike.hide()
  }

  /// The pointer as it looked where Z took it from.
  lazy var pointerLookalike = PointerLookalike()

  /// The middle of the message box (or the bottom middle of the window when
  /// the page can't say where it is), in window coordinates.
  func messageBoxPoint(_ done: @escaping (NSPoint) -> Void) {
    let script = """
      (() => { const b = document.querySelector('[data-testid="chat-input"]');
        if (!b) return null; const r = b.getBoundingClientRect();
        return [r.left + Math.min(r.width / 2, 200), r.top + r.height / 2] })()
      """
    let width = panel.frame.width
    webView.evaluateJavaScript(script) { [weak self] result, _ in
      guard let self else { return }
      var point = NSPoint(x: width / 2, y: 80) // window coordinates, from the bottom
      if let xy = result as? [Double], xy.count == 2 {
        point = self.webView.convert(NSPoint(x: xy[0], y: xy[1]), to: nil)
      }
      done(point)
    }
  }

  /// Z: the real pointer goes to the message box and the box takes the
  /// keyboard, as if clicked there; a lookalike pointer stays where it was.
  /// Pressed again, the pointer goes back to the box.
  func clickChat() {
    if typing { pointerToChat() } else { startTyping() }
  }

  /// X: hands the keyboard back to the app in front, and the pointer back to
  /// where it was.
  func leaveChat() {
    if typing { stopTyping() } else { pointerBack() }
  }

  // MARK: Screenshot

  /// Left Option: the laptop's own screen, wherever the pointer is (a Mac
  /// with no built-in screen, or its lid closed: the screen the pointer is
  /// on), without a sound, saved where the Mac saves screenshots (the
  /// Desktop unless that was changed), copied for pasting and sent in
  /// Hi-chat on its own.
  func screenshot() {
    var displays = [CGDirectDisplayID](repeating: 0, count: 16)
    var count: UInt32 = 0
    CGGetActiveDisplayList(16, &displays, &count)
    var display = CGMainDisplayID()
    if let laptop = displays.prefix(Int(count)).first(where: { CGDisplayIsBuiltin($0) != 0 }) {
      display = laptop
    } else {
      var found: UInt32 = 0
      CGGetDisplaysWithPoint(pointerNow(), 1, &display, &found)
    }
    // screencapture numbers the screens from 1, in this same order
    let number = (displays.prefix(Int(count)).firstIndex(of: display) ?? 0) + 1
    let saved = UserDefaults(suiteName: "com.apple.screencapture")?.string(forKey: "location")
    var folder = FileManager.default.urls(for: .desktopDirectory, in: .userDomainMask)[0]
    if let saved, !saved.isEmpty {
      var isFolder: ObjCBool = false
      let path = (saved as NSString).expandingTildeInPath
      if FileManager.default.fileExists(atPath: path, isDirectory: &isFolder), isFolder.boolValue {
        folder = URL(fileURLWithPath: path)
      }
    }
    let stamp = DateFormatter()
    stamp.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
    let name = "Screenshot \(stamp.string(from: Date()))"
    var file = folder.appendingPathComponent(name + ".png")
    var n = 2
    while FileManager.default.fileExists(atPath: file.path) {
      file = folder.appendingPathComponent("\(name) (\(n)).png")
      n += 1
    }
    let shot = file
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    task.arguments = ["-x", "-D", String(number), "-t", "png", shot.path]
    let app = self
    task.terminationHandler = { _ in
      Task { @MainActor in
        guard let data = try? Data(contentsOf: shot) else { return }
        let board = NSPasteboard.general
        board.clearContents()
        board.setData(data, forType: .png)
        app.sendScreenshot(data)
      }
    }
    do { try task.run() } catch { NSLog("Hi-chat: screenshot didn't start: \(error)") }
  }

  /// The page sends it as a message with no words: a JPEG at most 2560
  /// pixels across, small enough for the vision model.
  func sendScreenshot(_ png: Data) {
    let options = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceThumbnailMaxPixelSize: 2560,
    ] as CFDictionary
    guard let source = CGImageSourceCreateWithData(png as CFData, nil),
          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options),
          let jpeg = NSBitmapImageRep(cgImage: image)
            .representation(using: .jpeg, properties: [.compressionFactor: 0.75])
    else { return }
    let url = "data:image/jpeg;base64," + jpeg.base64EncodedString()
    bringUp()
    webView.evaluateJavaScript("window.hiChatScreenshot && window.hiChatScreenshot(\"\(url)\")")
  }

  // MARK: Mirror

  func toggleMirror() {
    guard FileManager.default.isExecutableFile(atPath: mirrorHelper) else {
      NSLog("Hi-chat: no mirror helper at \(mirrorHelper)")
      return
    }
    tellMirror(["command": "toggle", "window": String(panel.windowNumber)])
  }

  func hideMirror() {
    if mirrorTask?.isRunning == true { tellMirror(["command": "hide"]) }
  }

  func tellMirror(_ info: [String: String]) {
    let post = {
      DistributedNotificationCenter.default().postNotificationName(
        mirrorNote, object: nil, userInfo: info, deliverImmediately: true)
    }
    if mirrorTask?.isRunning == true || info["command"] == "quit" { return post() }
    // A helper Hammerspoon started earlier listens for the same commands;
    // two of them would both answer.
    let stray = Process()
    stray.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
    stray.arguments = ["-x", "JanMirror"]
    try? stray.run()
    stray.waitUntilExit()
    let task = Process()
    task.executableURL = URL(fileURLWithPath: mirrorHelper)
    do { try task.run() } catch {
      NSLog("Hi-chat: mirror helper didn't start: \(error)")
      return
    }
    mirrorTask = task
    caret.start()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: post)
  }

  // MARK: Page

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    // Only Hi-chat's own page may talk to the app
    guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "https",
          message.frameInfo.securityOrigin.host == appHost,
          let body = message.body as? [String: Any] else { return }
    // Settings > General > Check for updates
    if body["checkForUpdates"] as? Bool == true { checkForUpdates(nil) }
    // Settings > App keys
    if let command = body["shortcuts"] as? String { shortcutCommand(command, body["id"] as? String) }
    // Remote control: an action from /mirror's Edit mode, to replay here
    if let input = body["input"] as? [String: Any] { remoteInput.handle(input) }
    if let status = body["dictation"] as? String {
      keys?.dictating = status == "recording" || status == "starting"
      // Started from the page's own mic button or a shortcut alike
      if status == "starting" || status == "recording" || status == "transcribing" { bringUp() }
    }
  }

  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
               initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
               decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(origin.protocol == "https" && origin.host == appHost ? .grant : .deny)
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if action.shouldPerformDownload { return decisionHandler(.download) }
    guard let url = action.request.url, let scheme = url.scheme?.lowercased() else {
      return decisionHandler(.cancel)
    }
    // Only Hi-chat itself loads in the window. Any other page opens in your
    // browser, so no other site can look like Hi-chat here, get the
    // microphone or reach the app's bridge.
    let ours = scheme == "https" && url.host == appHost
    if action.targetFrame?.isMainFrame != false && !ours && scheme != "about" && scheme != "blob" {
      if scheme == "https" || scheme == "http" || scheme == "mailto" { NSWorkspace.shared.open(url) }
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
               decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    let attachment = (response.response as? HTTPURLResponse)?
      .value(forHTTPHeaderField: "Content-Disposition")?.lowercased().hasPrefix("attachment") == true
    decisionHandler(response.canShowMIMEType && !attachment ? .allow : .download)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    // The name only, never a path, so a download can't land outside Downloads
    let safe = (suggestedFilename as NSString).lastPathComponent
    let name = safe.isEmpty || safe.hasPrefix(".") ? "download" : safe
    var url = folder.appendingPathComponent(name)
    let base = url.deletingPathExtension().lastPathComponent, ext = url.pathExtension
    var n = 2
    while FileManager.default.fileExists(atPath: url.path) {
      url = folder.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
      n += 1
    }
    downloads[ObjectIdentifier(download)] = url
    completionHandler(url)
  }

  /// Where each download is going, so it can be marked once it lands.
  var downloads: [ObjectIdentifier: URL] = [:]

  func downloadDidFinish(_ download: WKDownload) {
    // Marked as downloaded, as a browser does, so macOS checks it before it
    // opens: a saved script or app never runs unasked
    if let url = downloads.removeValue(forKey: ObjectIdentifier(download)) {
      let mark: [String: Any] = [
        kLSQuarantineAgentNameKey as String: "Hi-chat",
        kLSQuarantineTypeKey as String: kLSQuarantineTypeWebDownload as String,
      ]
      try? (url as NSURL).setResourceValue(mark, forKey: .quarantinePropertiesKey)
    }
    NSLog("Hi-chat: download saved")
  }

  // Links that open a new window go to the default browser.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    // Web and mail links only: never file:, an app's own scheme or the like
    if let url = action.request.url, let scheme = url.scheme?.lowercased(),
       ["https", "http", "mailto"].contains(scheme) {
      NSWorkspace.shared.open(url)
    }
    return nil
  }

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let open = NSOpenPanel()
    open.allowsMultipleSelection = parameters.allowsMultipleSelection
    open.canChooseDirectories = parameters.allowsDirectories
    open.beginSheetModal(for: panel) { result in
      completionHandler(result == .OK ? open.urls : nil)
    }
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.beginSheetModal(for: panel) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    alert.beginSheetModal(for: panel) { completionHandler($0 == .alertFirstButtonReturn) }
  }

  // A reload starts the page afresh: tell it again whether typing is on.
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if typing { tellPageTyping() }
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    webView.reload()
  }
}

/// Updates: looks at the newest release on GitHub when Hi-chat opens and
/// every 6 hours. A new version is offered once, in one dialog; Update Now
/// downloads it, quits, swaps the app in place and opens it again.
@MainActor
final class Updater {
  static let latest = URL(string: "https://api.github.com/repos/praneeth-pra/hi-chat/releases/latest")!
  static let skippedKey = "skippedVersion"
  unowned let app: AppController
  var busy = false

  init(app: AppController) { self.app = app }

  var current: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
  }

  /// "1.0.10" is newer than "1.0.9".
  nonisolated static func isNewer(_ a: String, than b: String) -> Bool {
    let x = a.split(separator: ".").map { Int($0) ?? 0 }
    let y = b.split(separator: ".").map { Int($0) ?? 0 }
    for i in 0..<max(x.count, y.count) {
      let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0
      if p != q { return p > q }
    }
    return false
  }

  func start() {
    Task {
      while true {
        await check(asked: false)
        try? await Task.sleep(nanoseconds: 6 * 3600 * 1_000_000_000)
      }
    }
  }

  /// asked: from the menu, so it always answers, even "up to date".
  func check(asked: Bool) async {
    if busy { return }
    var request = URLRequest(url: Updater.latest)
    request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
    guard let fetched = try? await URLSession.shared.data(for: request),
          let release = (try? JSONSerialization.jsonObject(with: fetched.0)) as? [String: Any],
          let tag = release["tag_name"] as? String
    else {
      if asked { tell("Couldn't reach GitHub to check for updates.") }
      return
    }
    let version = tag.replacingOccurrences(of: "mac-", with: "")
    let links = (release["assets"] as? [[String: Any]] ?? [])
      .compactMap { $0["browser_download_url"] as? String }
    let dmg = links.first { $0.hasSuffix("/Hi-chat.dmg") }.flatMap(URL.init(string:))
    let sig = links.first { $0.hasSuffix("/Hi-chat.dmg.sig") }.flatMap(URL.init(string:))
    // Updates come only from this repository's own, signed releases
    guard Updater.isNewer(version, than: current), let url = dmg, let sig,
          Updater.fromThisRepo(url), Updater.fromThisRepo(sig)
    else {
      if asked { tell("Hi-chat \(current) is the newest version.") }
      return
    }
    if !asked {
      if UserDefaults.standard.string(forKey: Updater.skippedKey) == version { return }
      // Never in the middle of dictating or typing; look again in a few minutes.
      if app.keys?.dictating == true || app.typing {
        Task {
          try? await Task.sleep(nanoseconds: 300 * 1_000_000_000)
          await check(asked: false)
        }
        return
      }
    }
    let alert = NSAlert()
    alert.messageText = "Hi-chat \(version) is ready"
    alert.informativeText = "Update Now installs it and restarts Hi-chat, which takes a few seconds. You have \(current)."
    alert.addButton(withTitle: "Update Now")
    alert.addButton(withTitle: "Later")
    busy = true // one dialog at a time
    let answer = await alert.beginSheetModal(for: app.panel)
    busy = false
    if answer == .alertFirstButtonReturn {
      await install(from: url, signature: sig)
    } else {
      UserDefaults.standard.set(version, forKey: Updater.skippedKey)
    }
  }

  nonisolated static func fromThisRepo(_ url: URL) -> Bool {
    url.scheme == "https" && url.host == "github.com"
      && url.path.hasPrefix("/praneeth-pra/hi-chat/releases/download/")
  }

  /// The public half of the key the release build signs Hi-chat.dmg with
  /// (ECDSA P-256 over its SHA-256). An update installs only when its
  /// signature checks out, so a release nobody signed with the private key
  /// (kept in the repository's HICHAT_SIGNING secret) is never installed.
  static let updateKey =
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEyE+JOGitQFURJOl2pZ0boLn+4dYTxTcBHck8SX4CgHicwa5FcdGetnQhtPPRTJForzxLZaWVBkd+2CSmFoCltA=="
  /// The certificate the app itself is signed with (its SHA-1); the new app
  /// must carry it before it replaces this one.
  static let certificate = "682B9625A09A73286A019832714DCD49A6F2E034"

  nonisolated static func signedByUs(_ file: Data, signature: Data) -> Bool {
    guard let der = Data(base64Encoded: updateKey),
          let key = try? P256.Signing.PublicKey(derRepresentation: der),
          let sig = try? P256.Signing.ECDSASignature(derRepresentation: signature)
    else { return false }
    return key.isValidSignature(sig, for: file)
  }

  func install(from url: URL, signature sigURL: URL) async {
    busy = true
    defer { busy = false }
    let target = Bundle.main.bundleURL
    guard FileManager.default.isWritableFile(atPath: target.deletingLastPathComponent().path) else {
      tell("Hi-chat can't replace itself where it is. Move it to Applications, or download the new version from GitHub.")
      return
    }
    guard let downloaded = try? await URLSession.shared.download(from: url),
          (downloaded.1 as? HTTPURLResponse)?.statusCode == 200
    else {
      tell("The download didn't finish. Try again with Hi-chat > Check for Updates.")
      return
    }
    guard let signature = try? await URLSession.shared.data(from: sigURL).0,
          let file = try? Data(contentsOf: downloaded.0, options: .mappedIfSafe),
          Updater.signedByUs(file, signature: signature)
    else {
      tell("The download didn't look right. Try again with Hi-chat > Check for Updates.")
      return
    }
    let work = FileManager.default.temporaryDirectory
      .appendingPathComponent("hi-chat-update-\(UUID().uuidString)")
    let dmg = work.appendingPathComponent("Hi-chat.dmg")
    do {
      try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
      try FileManager.default.moveItem(at: downloaded.0, to: dmg)
    } catch {
      tell("The update couldn't be saved: \(error.localizedDescription)")
      return
    }
    // Runs on after Hi-chat quits: unpack, check the signature, swap the app
    // (the old one comes back if anything fails) and open it again.
    let script = """
      pid=$1; dmg=$2; target=$3; work=$4; cert=$5; mnt="$work/mnt"
      hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mnt" -quiet \\
        && ditto "$mnt/Hi-chat.app" "$work/Hi-chat.app"
      hdiutil detach "$mnt" -quiet
      while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
      if [ -d "$work/Hi-chat.app" ] && codesign --verify --deep --strict \\
          -R="identifier \\\"dev.hitechie.hichat\\\" and certificate leaf = H\\\"$cert\\\"" "$work/Hi-chat.app"; then
        mv "$target" "$work/old.app" && { ditto "$work/Hi-chat.app" "$target" || { rm -rf "$target"; mv "$work/old.app" "$target"; }; }
      fi
      open "$target"
      rm -rf "$work"
      """
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/bin/sh")
    task.arguments = ["-c", script, "sh", String(ProcessInfo.processInfo.processIdentifier),
                      dmg.path, target.path, work.path, Updater.certificate]
    do { try task.run() } catch {
      tell("The update couldn't start: \(error.localizedDescription)")
      return
    }
    NSApp.terminate(nil)
  }

  func tell(_ message: String) {
    let alert = NSAlert()
    alert.messageText = message
    alert.beginSheetModal(for: app.panel, completionHandler: nil)
  }
}

/// One way to press a shortcut: a modifier tapped on its own, a key with
/// modifiers held, or (for scrolling) a modifier held while you scroll.
struct Shortcut: Codable, Equatable {
  enum Kind: String, Codable { case tap, chord, hold }
  var kind: Kind
  /// The key's code; for a tap, the modifier's own
  var key: Int64 = -1
  /// fn, control, option, command, shift, in that order
  var mods: [String] = []

  static func tap(_ key: Int64) -> Shortcut { Shortcut(kind: .tap, key: key) }
  static func chord(_ key: Int64, _ mods: [String] = []) -> Shortcut { Shortcut(kind: .chord, key: key, mods: mods) }
  static func hold(_ mod: String) -> Shortcut { Shortcut(kind: .hold, mods: [mod]) }

  /// As Settings shows it, such as "Tap Left Control", "fn N" or "Hold fn + scroll".
  var display: String {
    switch kind {
    case .tap: return "Tap " + Key.name(key)
    case .hold: return "Hold " + (mods.first.map(Shortcut.symbol) ?? "") + " + scroll"
    case .chord:
      var parts = mods.map(Shortcut.symbol)
      // On a laptop these are fn + an arrow
      if mods.contains("fn"), let arrow = Key.fnArrow[key] {
        parts.append(arrow)
      } else {
        parts.append(Key.name(key))
      }
      return parts.joined(separator: " ")
    }
  }

  static func symbol(_ mod: String) -> String {
    ["fn": "fn", "control": "⌃", "option": "⌥", "command": "⌘", "shift": "⇧"][mod] ?? mod
  }
}

/// What a shortcut does. Escape (stop dictating, give the keyboard back)
/// always stays Escape.
enum Action: String, CaseIterable {
  case dictate, screenshot, toChat, back, send, newChat, codeUp, codeDown,
       pageUp, pageDown, mirror, mirrorClose, scroll

  var label: String {
    switch self {
    case .dictate: "Dictate (again to stop and send)"
    case .screenshot: "Screenshot of the laptop's screen"
    case .toChat: "Pointer and keyboard into Hi-chat"
    case .back: "Pointer and keyboard back"
    case .send: "Send what's typed"
    case .newChat: "New chat"
    case .codeUp: "Code block above"
    case .codeDown: "Code block below"
    case .pageUp: "Scroll the chat up a screen"
    case .pageDown: "Scroll the chat down a screen"
    case .mirror: "Mirror window"
    case .mirrorClose: "Close the mirror window"
    case .scroll: "Scroll Hi-chat from anywhere"
    }
  }

  var defaults: [Shortcut] {
    switch self {
    case .dictate: [.tap(Key.leftControl)]
    case .screenshot: [.tap(Key.leftOption)]
    case .toChat: [.chord(Key.z)]
    case .back: [.chord(Key.x)]
    case .send: [.chord(Key.end, ["fn"]), .chord(Key.right, ["fn"])]
    case .newChat: [.chord(Key.n, ["fn"])]
    case .codeUp: [.chord(Key.pageUp, ["fn"]), .chord(Key.pageUp)]
    case .codeDown: [.chord(Key.pageDown, ["fn"]), .chord(Key.pageDown)]
    case .pageUp: [.chord(Key.pageUp, ["fn", "shift"]), .chord(Key.pageUp, ["shift"])]
    case .pageDown: [.chord(Key.pageDown, ["fn", "shift"]), .chord(Key.pageDown, ["shift"])]
    case .mirror: [.chord(Key.home, ["fn"]), .chord(Key.left, ["fn"])]
    case .mirrorClose: [.chord(Key.home, ["fn", "shift"]), .chord(Key.left, ["fn", "shift"])]
    case .scroll: [.hold("fn")]
    }
  }

  /// Held down, the key does it again and again.
  var repeats: Bool { self == .pageUp || self == .pageDown }

  @MainActor func run(_ app: AppController) {
    switch self {
    case .dictate: app.remote("F14")
    case .screenshot: app.screenshot()
    case .toChat: app.clickChat()
    case .back: app.leaveChat()
    case .send: app.remote("F15")
    case .newChat: app.bringUp(); app.remote("Shift+F18")
    case .codeUp: app.remote("Shift+F16")
    case .codeDown: app.remote("Shift+F17")
    case .pageUp: app.scrollChat(by: -0.8)
    case .pageDown: app.scrollChat(by: 0.8)
    case .mirror: app.toggleMirror()
    case .mirrorClose: app.hideMirror()
    case .scroll: break
    }
  }
}

/// The shortcuts you set in Hi-chat's Settings > App keys, kept in the
/// app's defaults; an action you never changed uses its own defaults.
final class ShortcutStore {
  static let defaultsKey = "shortcuts"
  private var custom: [String: [Shortcut]] = [:]

  init() {
    if let data = UserDefaults.standard.data(forKey: ShortcutStore.defaultsKey),
       let saved = try? JSONDecoder().decode([String: [Shortcut]].self, from: data) {
      custom = saved
    }
  }

  func shortcuts(_ action: Action) -> [Shortcut] { custom[action.rawValue] ?? action.defaults }

  /// The action a tap or key press runs, if any.
  func action(for pressed: Shortcut) -> Action? {
    Action.allCases.first { a in shortcuts(a).contains { $0 == pressed } }
  }

  /// The modifier that, held, makes a scroll scroll Hi-chat.
  var scrollModifier: String? { shortcuts(.scroll).first?.mods.first }

  /// A shortcut for one action only: any other action using it gives it up.
  func set(_ action: Action, to shortcut: Shortcut) {
    for other in Action.allCases where other != action {
      let mine = shortcuts(other)
      if mine.contains(shortcut) { custom[other.rawValue] = mine.filter { $0 != shortcut } }
    }
    custom[action.rawValue] = [shortcut]
    save()
  }

  func clear(_ action: Action) {
    custom[action.rawValue] = []
    save()
  }

  /// One action, or all of them, back to the defaults.
  func reset(_ action: Action?) {
    if let action { custom[action.rawValue] = nil } else { custom = [:] }
    save()
  }

  func save() {
    if let data = try? JSONEncoder().encode(custom) {
      UserDefaults.standard.set(data, forKey: ShortcutStore.defaultsKey)
    }
  }

  /// For the page: each action with its shortcuts as they read.
  func json(recording: Action?) -> String {
    let actions: [[String: Any]] = Action.allCases.map { a in
      ["id": a.rawValue, "label": a.label, "keys": shortcuts(a).map(\.display),
       "isDefault": custom[a.rawValue] == nil, "hold": a == .scroll]
    }
    let body: [String: Any] = ["actions": actions, "recording": recording.map { $0.rawValue as Any } ?? NSNull()]
    guard let data = try? JSONSerialization.data(withJSONObject: body),
          let text = String(data: data, encoding: .utf8) else { return "null" }
    return text
  }
}

/// The global shortcuts: one event tap on the main run loop. It only reads
/// the event and remembers a few flags, so it never holds up the Mac's input.
/// Which keys do what comes from the ShortcutStore (Settings > App keys).
final class Keys {
  unowned let app: AppController
  let store: ShortcutStore
  var tap: CFMachPort?
  var dictating = false
  var fnDown = false
  /// The modifier keys held now, by key code.
  var heldMods: Set<Int64> = []
  /// A modifier pressed on its own: which, and when. Another key, a click or
  /// a hand scroll meanwhile turns it into a chord, which is left alone.
  var lone: (key: Int64, at: TimeInterval)?
  var heldKey: Int64?
  var redirecting = false
  /// Settings is waiting for the keys to use for this action; meanwhile no
  /// shortcut runs and the keys pressed go nowhere else.
  var recording: Action?
  static let tapSeconds = 0.5

  init(app: AppController, store: ShortcutStore) {
    self.app = app
    self.store = store
  }

  func start() -> Bool {
    let kinds: [CGEventType] = [.flagsChanged, .keyDown, .keyUp, .leftMouseDown,
                                .rightMouseDown, .scrollWheel]
    let mask = kinds.reduce(CGEventMask(0)) { $0 | (1 << CGEventMask($1.rawValue)) }
    guard let tap = CGEvent.tapCreate(
      tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
      eventsOfInterest: mask,
      callback: { _, type, event, refcon in
        let keys = Unmanaged<Keys>.fromOpaque(refcon!).takeUnretainedValue()
        return keys.handle(type, event)
      },
      userInfo: Unmanaged.passUnretained(self).toOpaque())
    else { return false }
    self.tap = tap
    let source = CFMachPortCreateRunLoopSource(nil, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    return true
  }

  /// Runs an action just after the tap returns, so the tap stays quick.
  func later(_ action: @escaping @MainActor (AppController) -> Void) {
    let app = self.app
    Task { @MainActor in action(app) }
  }

  /// Settings got its keys (nil: recording was cancelled).
  func recorded(_ shortcut: Shortcut?) {
    guard let action = recording else { return }
    recording = nil
    if let shortcut { store.set(action, to: shortcut) }
    later { $0.sendShortcuts() }
  }

  func handle(_ type: CGEventType, _ event: CGEvent) -> Unmanaged<CGEvent>? {
    let pass = Unmanaged.passUnretained(event)
    // Keys typed from /mirror are the shared computer's own, never Hi-chat's
    // shortcuts
    if event.getIntegerValueField(.eventSourceUserData) == RemoteInput.marker { return pass }
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
      if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
      return pass
    case .flagsChanged:
      return flagsChanged(event)
    case .keyDown:
      lone = nil
      return keyDown(event)
    case .keyUp:
      let key = event.getIntegerValueField(.keyboardEventKeycode)
      if key == heldKey { heldKey = nil; return nil }
      return pass
    case .leftMouseDown, .rightMouseDown:
      lone = nil
      return pass
    case .scrollWheel:
      return scroll(event)
    default:
      return pass
    }
  }

  func flagsChanged(_ event: CGEvent) -> Unmanaged<CGEvent>? {
    let pass = Unmanaged.passUnretained(event)
    let key = event.getIntegerValueField(.keyboardEventKeycode)
    let flags = event.flags
    if key == Key.fn { fnDown = flags.contains(.maskSecondaryFn) }
    guard let modifier = Key.modifiers[key] else {
      lone = nil
      return pass
    }
    let down = flags.contains(modifier.mask) && !heldMods.contains(key)
    if down { heldMods.insert(key) } else { heldMods.remove(key) }
    let now = ProcessInfo.processInfo.systemUptime
    if down {
      if recording == .scroll { recorded(.hold(modifier.mod)); return pass }
      lone = heldMods.count == 1 ? (key, now) : nil
    } else if let lone, lone.key == key, recording != nil || now - lone.at < Keys.tapSeconds {
      self.lone = nil
      if recording != nil {
        if recording != .scroll { recorded(.tap(key)) }
      } else if let action = store.action(for: .tap(key)) {
        later { action.run($0) }
      }
    } else {
      lone = nil
    }
    return pass
  }

  /// The modifiers held for this key press. Arrows and the keys fn makes of
  /// them (Page Up and the like) carry the fn flag anyway, so for those only
  /// the fn key itself counts.
  func modsHeld(_ key: Int64, _ flags: CGEventFlags) -> [String] {
    let navigation = (123...126).contains(key) || [115, 116, 117, 119, 121].contains(key)
    var mods: [String] = []
    if fnDown || (!navigation && flags.contains(.maskSecondaryFn)) { mods.append("fn") }
    if flags.contains(.maskControl) { mods.append("control") }
    if flags.contains(.maskAlternate) { mods.append("option") }
    if flags.contains(.maskCommand) { mods.append("command") }
    if flags.contains(.maskShift) { mods.append("shift") }
    return mods
  }

  func keyDown(_ event: CGEvent) -> Unmanaged<CGEvent>? {
    let pass = Unmanaged.passUnretained(event)
    let key = event.getIntegerValueField(.keyboardEventKeycode)
    let flags = event.flags
    let repeating = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
    let mods = modsHeld(key, flags)
    let chord = flags.contains(.maskCommand) || flags.contains(.maskControl) || flags.contains(.maskAlternate)

    if recording != nil {
      // Escape on its own cancels; scrolling waits for a modifier
      if key == Key.escape && mods.isEmpty { recorded(nil) } else if recording != .scroll, !repeating {
        recorded(.chord(key, mods))
      }
      heldKey = key
      return nil
    }
    if key == Key.escape && !chord {
      if dictating { swallow(key) { $0.remote("Shift+F13") }; return nil }
      if MainActor.assumeIsolated({ app.typing }) { swallow(key) { $0.stopTyping() }; return nil }
      return pass
    }
    if let action = store.action(for: .chord(key, mods)) {
      if !repeating || action.repeats { swallow(key) { action.run($0) } }
      heldKey = key
      return nil
    }
    // fn + a key that is a shortcut on its own (Z, X) types it
    if mods == ["fn"], store.action(for: .chord(key)) != nil {
      event.flags.remove(.maskSecondaryFn)
    }
    return pass
  }

  func swallow(_ key: Int64, _ action: @escaping @MainActor (AppController) -> Void) {
    heldKey = key
    later(action)
  }

  /// Is the scroll modifier (fn unless changed in Settings) held?
  func scrollModifierHeld(_ flags: CGEventFlags) -> Bool {
    switch store.scrollModifier {
    case "fn": fnDown || flags.contains(.maskSecondaryFn)
    case "control": flags.contains(.maskControl)
    case "option": flags.contains(.maskAlternate)
    case "command": flags.contains(.maskCommand)
    case "shift": flags.contains(.maskShift)
    default: false
    }
  }

  /// fn + scroll (and any scroll while Z typing is on) scrolls Hi-chat:
  /// a fresh event at the window's middle with the same distance, phase and
  /// glide. A copy could carry the pointer over with it.
  func scroll(_ event: CGEvent) -> Unmanaged<CGEvent>? {
    let pass = Unmanaged.passUnretained(event)
    if event.getIntegerValueField(.eventSourceUserData) == ownEventMark { return pass }
    let momentum = event.getIntegerValueField(.scrollWheelEventMomentumPhase)
    let phase = event.getIntegerValueField(.scrollWheelEventScrollPhase)
    // A hand scroll makes a held Control/Option a chord; its glide doesn't.
    if momentum == 0 && (phase == 0 || phase == 1 || phase == 2) { lone = nil }
    if scrollModifierHeld(event.flags) || MainActor.assumeIsolated({ app.typing }) {
      redirecting = true
    } else if momentum == 0 {
      redirecting = false
    }
    guard redirecting, let at = MainActor.assumeIsolated({ app.chatCenter() }) else { return pass }
    let dy = Int32(truncatingIfNeeded: event.getIntegerValueField(.scrollWheelEventPointDeltaAxis1))
    let dx = Int32(truncatingIfNeeded: event.getIntegerValueField(.scrollWheelEventPointDeltaAxis2))
    guard let copy = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2,
                             wheel1: dy, wheel2: dx, wheel3: 0) else { return pass }
    copy.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
    copy.setIntegerValueField(.scrollWheelEventScrollPhase, value: phase)
    copy.setIntegerValueField(.scrollWheelEventMomentumPhase, value: momentum)
    copy.setIntegerValueField(.eventSourceUserData, value: ownEventMark)
    copy.location = at
    return Unmanaged.passRetained(copy)
  }
}

/// Lays its subviews out from the top left, like the page.
final class FlippedView: NSView {
  override var isFlipped: Bool { true }
}

/// A picture of the pointer, left where it was while Z has the real one in
/// Hi-chat. Clicks go through it and it never takes the keyboard.
@MainActor
final class PointerLookalike {
  let window: NSPanel
  let image = NSImageView()

  init() {
    window = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel],
                     backing: .buffered, defer: true)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.ignoresMouseEvents = true
    window.isReleasedWhenClosed = false
    window.level = .screenSaver
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
    image.imageScaling = .scaleNone
    window.contentView = image
  }

  /// at: the pointer's position, origin at the top left (as CGEvent uses).
  func show(at point: CGPoint) {
    let cursor = NSCursor.currentSystem ?? NSCursor.arrow
    let size = cursor.image.size
    let hot = cursor.hotSpot // from the image's top left
    let top = NSScreen.screens.first?.frame.maxY ?? 0
    image.image = cursor.image
    window.setFrame(NSRect(x: point.x - hot.x, y: top - point.y - (size.height - hot.y),
                           width: size.width, height: size.height), display: true)
    window.orderFrontRegardless()
  }

  func hide() { window.orderOut(nil) }
}

@main
@MainActor
struct HiChatMain {
  static func main() {
    let app = NSApplication.shared
    let controller = AppController()
    app.delegate = controller
    let dock = UserDefaults.standard.bool(forKey: AppController.showInDockKey)
    app.setActivationPolicy(dock ? .regular : .accessory)
    app.run()
  }
}

// MARK: Remote control

/// Replays /mirror's mouse and keys (web-app/src/lib/remoteInput.ts) while
/// someone edits the shared screen there: they arrive from Hi-chat's page,
/// which takes them only from a signed-in /mirror. Positions are 0 to 1
/// across the shared screen; `a`, the picture's width / height, says which
/// display that is. Needs Accessibility, as the shortcuts do.
final class RemoteInput {
  /// Marks the events posted here, so the shortcut listener lets them pass.
  static let marker: Int64 = 0x4843_4D52
  let source = CGEventSource(stateID: .hidSystemState)
  var buttons: [Int] = []
  var keys = Set<CGKeyCode>()
  var last = CGPoint.zero
  var display = CGMainDisplayID()
  var aspect = 0.0

  static func number(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue }

  static func flags(_ v: Any?) -> CGEventFlags {
    let m = Int(number(v) ?? 0)
    var f = CGEventFlags()
    if m & 1 != 0 { f.insert(.maskCommand) }
    if m & 2 != 0 { f.insert(.maskShift) }
    if m & 4 != 0 { f.insert(.maskAlternate) }
    if m & 8 != 0 { f.insert(.maskControl) }
    return f
  }

  func handle(_ m: [String: Any]) {
    guard AXIsProcessTrusted(), let k = m["k"] as? String else { return }
    let flags = Self.flags(m["m"])
    switch k {
    case "m":
      if let p = point(m) { mouse(dragType() ?? .mouseMoved, p, button(buttons.first ?? 0), flags) }
    case "d":
      guard let p = point(m) else { return }
      let b = Int(Self.number(m["b"]) ?? 0)
      guard (0...2).contains(b) else { return }
      if !buttons.contains(b) { buttons.append(b) }
      let clicks = Int64(max(1, min(3, Int(Self.number(m["c"]) ?? 1))))
      mouse(downType(b), p, button(b), flags, clicks: clicks)
    case "u":
      let b = Int(Self.number(m["b"]) ?? 0)
      guard let i = buttons.firstIndex(of: b) else { return }
      buttons.remove(at: i)
      mouse(upType(b), point(m) ?? last, button(b), flags)
    case "w":
      let dx = Int32(clamping: Int(-(Self.number(m["dx"]) ?? 0)))
      let dy = Int32(clamping: Int(-(Self.number(m["dy"]) ?? 0)))
      guard let e = CGEvent(scrollWheelEvent2Source: source, units: .pixel,
                            wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0) else { return }
      e.flags = flags
      post(e)
    case "kd", "ku":
      guard let c = Self.number(m["c"]), c >= 0, c < 128 else { return }
      let code = CGKeyCode(c)
      let down = k == "kd"
      if down { keys.insert(code) } else { keys.remove(code) }
      key(code, down, flags, repeating: m["r"] != nil)
    case "r":
      releaseAll()
    default:
      break
    }
  }

  /// Where on this Mac's screens a 0-to-1 position falls.
  func point(_ m: [String: Any]) -> CGPoint? {
    guard let x = Self.number(m["x"]), let y = Self.number(m["y"]) else { return nil }
    if let a = Self.number(m["a"]), a > 0, abs(a - aspect) > 0.001 {
      aspect = a
      display = pickDisplay(aspect: a)
    }
    let b = CGDisplayBounds(display)
    let p = CGPoint(x: b.minX + max(0, min(1, x)) * b.width,
                    y: b.minY + max(0, min(1, y)) * b.height)
    last = p
    return p
  }

  /// The display whose shape matches the shared picture; the main one if
  /// several do (or none).
  func pickDisplay(aspect a: Double) -> CGDirectDisplayID {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return CGMainDisplayID() }
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetActiveDisplayList(count, &ids, &count) == .success else { return CGMainDisplayID() }
    let main = CGMainDisplayID()
    func off(_ id: CGDirectDisplayID) -> Double {
      let b = CGDisplayBounds(id)
      return b.height > 0 ? abs(b.width / b.height - a) : .infinity
    }
    let best = ids.min { off($0) < off($1) } ?? main
    return off(main) <= off(best) + 0.02 ? main : best
  }

  func button(_ b: Int) -> CGMouseButton { b == 1 ? .right : b == 2 ? .center : .left }
  func downType(_ b: Int) -> CGEventType { b == 1 ? .rightMouseDown : b == 2 ? .otherMouseDown : .leftMouseDown }
  func upType(_ b: Int) -> CGEventType { b == 1 ? .rightMouseUp : b == 2 ? .otherMouseUp : .leftMouseUp }
  func dragType() -> CGEventType? {
    guard let b = buttons.first else { return nil }
    return b == 1 ? .rightMouseDragged : b == 2 ? .otherMouseDragged : .leftMouseDragged
  }

  func mouse(_ type: CGEventType, _ p: CGPoint, _ b: CGMouseButton, _ flags: CGEventFlags, clicks: Int64 = 1) {
    guard let e = CGEvent(mouseEventSource: source, mouseType: type,
                          mouseCursorPosition: p, mouseButton: b) else { return }
    e.flags = flags
    if type != .mouseMoved { e.setIntegerValueField(.mouseEventClickState, value: clicks) }
    post(e)
  }

  func key(_ code: CGKeyCode, _ down: Bool, _ flags: CGEventFlags, repeating: Bool = false) {
    guard let e = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { return }
    e.flags = flags
    if repeating { e.setIntegerValueField(.keyboardEventAutorepeat, value: 1) }
    post(e)
  }

  func post(_ e: CGEvent) {
    e.setIntegerValueField(.eventSourceUserData, value: Self.marker)
    e.post(tap: .cghidEventTap)
  }

  /// Nothing stays held down when the person on /mirror stops or leaves.
  func releaseAll() {
    for code in keys { key(code, false, []) }
    keys.removeAll()
    for b in buttons { mouse(upType(b), last, button(b), []) }
    buttons.removeAll()
  }
}

// MARK: Text cursor for the mirror

/// Where the text cursor is in the app you're typing in, read here (Hi-chat
/// has Accessibility for remote control; the mirror helper, a separate
/// program, may not) and sent to the helper whenever it moves:
/// { command = "caret", at = "x,y" } in screen points from the bottom left,
/// or at = "" when there's no text cursor to follow.
@MainActor
final class CaretReporter {
  let system = AXUIElementCreateSystemWide()
  var askedApps = Set<pid_t>()
  var last: String?
  var timer: Timer?

  init() {
    // A busy app mustn't stall Hi-chat: give up on it quickly
    AXUIElementSetMessagingTimeout(system, 0.05)
  }

  func start() {
    guard timer == nil else { return }
    timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 20, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.report() }
    }
  }

  func report() {
    let (p, why) = read()
    let at = p.map { "\(Int($0.x)),\(Int($0.y))" } ?? ""
    let state = at + "|" + why
    guard state != last else { return }
    last = state
    DistributedNotificationCenter.default().postNotificationName(
      mirrorNote, object: nil, userInfo: ["command": "caret", "at": at, "why": why],
      deliverImmediately: true)
  }

  /// The text cursor's place, or nil and why not (shown in the mirror).
  func read() -> (NSPoint?, String) {
    guard AXIsProcessTrusted() else { return (nil, "no-permission") }
    // Ask the app in front for its focused element. Chrome-based browsers
    // (Brave, Chrome, Edge) only say which text box has focus once asked to
    // describe their pages, so they're asked first, before reading it.
    guard let front = NSWorkspace.shared.frontmostApplication else { return (nil, "no-focus") }
    let app = AXUIElementCreateApplication(front.processIdentifier)
    AXUIElementSetMessagingTimeout(app, 0.1)
    askForText(front)
    var focused: CFTypeRef?
    if AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focused)
         != .success {
      // Some apps answer only through the system-wide element
      focused = nil
      _ = AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focused)
    }
    guard let focused, CFGetTypeID(focused) == AXUIElementGetTypeID()
    else { return (nil, "no-focus") }
    let element = focused as! AXUIElement
    AXUIElementSetMessagingTimeout(element, 0.1)
    var rangeRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &rangeRef)
            == .success, let rangeRef, CFGetTypeID(rangeRef) == AXValueGetTypeID()
    else { return (nil, "no-text") }
    var range = CFRange()
    guard AXValueGetValue(rangeRef as! AXValue, .cfRange, &range) else { return (nil, "no-text") }
    guard let primary = NSScreen.screens.first else { return (nil, "no-screen") }
    // Accessibility measures from the top left of the main screen
    let flip = { (x: CGFloat, y: CGFloat) in NSPoint(x: x, y: primary.frame.maxY - y) }
    if let r = bounds(element, range) { return (flip(r.midX, r.midY), "") }
    // A blinking cursor is a range of length 0, which Chrome (and others)
    // often won't measure: measure the character before it (the cursor is
    // at its right edge), else the one after it (at its left edge).
    if range.length == 0 {
      if range.location > 0,
         let r = bounds(element, CFRange(location: range.location - 1, length: 1)) {
        return (flip(r.maxX, r.midY), "")
      }
      if let r = bounds(element, CFRange(location: range.location, length: 1)) {
        return (flip(r.minX, r.midY), "")
      }
    }
    return (nil, "no-bounds")
  }

  func bounds(_ element: AXUIElement, _ range: CFRange) -> CGRect? {
    var range = range
    guard let value = AXValueCreate(.cfRange, &range) else { return nil }
    var out: CFTypeRef?
    guard AXUIElementCopyParameterizedAttributeValue(
            element, kAXBoundsForRangeParameterizedAttribute as CFString, value, &out) == .success,
          let out, CFGetTypeID(out) == AXValueGetTypeID()
    else { return nil }
    var rect = CGRect.zero
    guard AXValueGetValue(out as! AXValue, .cgRect, &rect),
          rect.origin != .zero || rect.size != .zero
    else { return nil }
    return rect
  }

  /// Chrome-based browsers describe their pages' text boxes only once an
  /// assistive app asks (AXEnhancedUserInterface); Electron apps (VS Code,
  /// Slack) answer AXManualAccessibility. Asked once per app.
  func askForText(_ front: NSRunningApplication) {
    let pid = front.processIdentifier
    guard !askedApps.contains(pid) else { return }
    askedApps.insert(pid)
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.1)
    AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    let id = front.bundleIdentifier ?? ""
    let chromium = ["com.google.Chrome", "com.brave.Browser", "com.microsoft.edgemac",
                    "company.thebrowser.Browser", "org.chromium.Chromium", "com.vivaldi.Vivaldi",
                    "com.operasoftware.Opera"]
    if chromium.contains(where: { id.hasPrefix($0) }) {
      AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
    }
  }
}
  }
}
