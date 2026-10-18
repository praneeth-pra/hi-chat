// Hi-chat for Mac: the Hi-chat site in its own light window, with the
// keyboard shortcuts that the Hammerspoon script (scripts/hammerspoon) gave
// Safari built in.
//
//   tap Left Control        dictate: tap again to stop and send
//   Escape while dictating  throw the recording away
//   tap Left Option         type into Hi-chat while the app you're in stays
//                           active; tap again (or Escape) to stop. Meanwhile
//                           the mouse moves Hi-chat's own cursor and the real
//                           pointer stays put: click or drag to highlight
//                           text in Hi-chat (double click a word)
//   fn + Right              send what's typed in the box
//   fn + Up / Down          code block above / below
//   fn + Shift + Up / Down  scroll the chat by most of a screen
//   hold fn + scroll        scroll Hi-chat from anywhere
//   Z / X                   click into Hi-chat's message box (Option typing on)
//                           / pointer and keyboard back to where they were;
//                           fn + Z / X types the letter
//   fn + Left               live mirror window (Hi-chat, then the screen around
//                           the pointer; needs Screen Recording);
//                           fn + Shift + Left closes it
//
// The window is a panel that takes the keyboard without making Hi-chat the
// active app, so a click or typing in it never greys out the app you're in.
// The shortcuts need Accessibility (System Settings > Privacy & Security).
//
// Hi-chat sits in the menu bar at the top (its H logo); its Dock icon is off
// unless "Show in Dock" is ticked in that menu.
//
// New versions: Hi-chat asks once when one is out (Check for Updates is in
// the menu bar menu), then installs it and restarts.
//
// Build: mac-app/build.sh (GitHub Actions builds the DMG on every change).

import AppKit
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
  lazy var updater = Updater(app: self)
  var mirrorTask: Process?
  var loginItems: [NSMenuItem] = []
  var statusItem: NSStatusItem?
  var dockItem: NSMenuItem!
  static let showInDockKey = "showInDock"
  /// The app that was in front when Option typing started.
  var typingReturnTo: NSRunningApplication?

  func applicationDidFinishLaunching(_ notification: Notification) {
    buildMenu()
    buildStatusItem()
    buildWindow()
    webView.load(URLRequest(url: homeURL))
    startKeys(prompt: true)
    updater.start()
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
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
    config.userContentController.addUserScript(
      WKUserScript(source: chatCursorScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))

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
    chatCursor.isHidden = true
    content.addSubview(chatCursor, positioned: .above, relativeTo: webView)
    panel.contentView = content
    panel.delegate = self
    panel.center()
    panel.setFrameAutosaveName("HiChatWindow")
    panel.orderFrontRegardless()
  }

  @objc func reloadPage(_ sender: Any?) { webView.reload() }

  @objc func showChat(_ sender: Any?) { panel.makeKeyAndOrderFront(nil) }

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
    let listener = Keys(app: self)
    if listener.start() { keys = listener } else {
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
        self?.startKeys(prompt: false)
      }
    }
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

  /// On while Option typing is: until it is tapped off, or another window
  /// takes the keyboard. The page shows it by the message box.
  var typing = false {
    didSet {
      if typing != oldValue { tellPageTyping() }
      if !typing { cursorStop() }
    }
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

  /// Option typing: Hi-chat takes the keyboard, the app in front stays active,
  /// and the mouse drives Hi-chat's own cursor.
  func toggleTyping() {
    if typing { stopTyping() } else { startTyping() }
  }

  /// The real pointer stays where it is; Hi-chat's cursor shows up in the
  /// message box instead (Option and Z alike).
  func startTyping() {
    let front = NSWorkspace.shared.frontmostApplication
    if front?.processIdentifier != ProcessInfo.processInfo.processIdentifier {
      typingReturnTo = front
    }
    if panel.isMiniaturized { panel.deminiaturize(nil) }
    panel.makeKeyAndOrderFront(nil)
    typing = true
    remote("F17") // the cursor goes to the end of the message box
    cursorStart()
  }

  func stopTyping() {
    let back = typingReturnTo
    typing = false
    typingReturnTo = nil
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
  }

  // MARK: Pointer

  func pointerNow() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }

  func warpPointer(_ to: CGPoint) {
    CGWarpMouseCursorPosition(to)
    // Without this the pointer ignores the mouse for a moment after a jump
    CGAssociateMouseAndMouseCursorPosition(1)
  }

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

  /// Z: Option typing on with Hi-chat's cursor in the message box, as if
  /// clicked there; the real pointer never moves. Pressed again, the cursor
  /// goes back to the box.
  func clickChat() {
    if !typing { startTyping() } else if cursorOn { cursorToBox() } else { cursorStart() }
  }

  /// X: hands the keyboard back to the app in front.
  func leaveChat() {
    if typing { stopTyping() }
  }

  // MARK: Hi-chat's cursor

  /// Hi-chat's own cursor, drawn over the page. It shows and follows the
  /// mouse while Option typing is on; the real pointer stays where it was.
  lazy var chatCursor = ChatCursorView(frame: NSRect(x: 0, y: 0, width: 24, height: 24))
  /// On while the mouse drives Hi-chat's cursor.
  var cursorOn = false
  /// Hi-chat's cursor, in the page's coordinates (from the top left).
  var cursorAt = NSPoint.zero
  /// Where the real pointer stays meanwhile (CGEvent coordinates).
  var cursorHome = CGPoint.zero
  var cursorDragging = false
  var cursorAsking = false
  var cursorAskAgain = false

  func cursorStart() {
    guard panel.isVisible, !panel.isMiniaturized, !cursorOn else { return }
    cursorOn = true
    cursorHome = pointerNow()
    cursorToBox()
  }

  /// Puts Hi-chat's cursor in the message box.
  func cursorToBox() {
    messageBoxPoint { [weak self] point in
      guard let self, self.cursorOn else { return }
      self.cursorAt = self.webView.convert(point, from: nil)
      self.chatCursor.text = false
      self.placeCursor()
      self.chatCursor.isHidden = false
      self.askPage()
    }
  }

  func cursorStop() {
    guard cursorOn else { return }
    cursorOn = false
    cursorDragging = false
    chatCursor.isHidden = true
    if pointerNow() != cursorHome { warpPointer(cursorHome) }
  }

  /// The mouse moved by (dx, dy) points: so does Hi-chat's cursor, kept
  /// inside the window.
  func cursorMove(dx: Double, dy: Double) {
    guard cursorOn else { return }
    let size = webView.bounds.size
    cursorAt.x = min(max(cursorAt.x + dx, 0), size.width - 1)
    cursorAt.y = min(max(cursorAt.y + dy, 0), size.height - 1)
    placeCursor()
    askPage()
  }

  /// A click at Hi-chat's cursor: starts a highlight there (a double click
  /// takes the word, a triple click the paragraph); dragging stretches it.
  func cursorDown(clicks: Int64) {
    guard cursorOn else { return }
    cursorDragging = true
    webView.evaluateJavaScript(
      "window.hiChatCursor && window.hiChatCursor.down(\(cursorAt.x), \(cursorAt.y), \(clicks))")
  }

  func cursorUp() { cursorDragging = false }

  func placeCursor() {
    let hot = chatCursor.hotSpot
    chatCursor.setFrameOrigin(NSPoint(x: cursorAt.x - hot.x, y: cursorAt.y - hot.y))
  }

  /// Stretches the highlight while dragging and asks whether the cursor is
  /// over text (I-beam) or not (arrow). One question at a time; the newest
  /// position goes next.
  func askPage() {
    if cursorAsking { cursorAskAgain = true; return }
    cursorAsking = true
    let x = cursorAt.x, y = cursorAt.y
    let drag = cursorDragging ? "c.drag(\(x), \(y)); " : ""
    webView.evaluateJavaScript(
      "(() => { const c = window.hiChatCursor; if (!c) return false; \(drag)return c.overText(\(x), \(y)) })()"
    ) { [weak self] result, _ in
      guard let self else { return }
      self.cursorAsking = false
      if let text = result as? Bool, text != self.chatCursor.text {
        self.chatCursor.text = text
        self.placeCursor() // the I-beam's point is its middle, the arrow's its tip
      }
      if self.cursorAskAgain && self.cursorOn {
        self.cursorAskAgain = false
        self.askPage()
      }
    }
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
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: post)
  }

  // MARK: Page

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    // Only Hi-chat's own page may talk to the app
    guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "https",
          message.frameInfo.securityOrigin.host == appHost,
          let body = message.body as? [String: Any] else { return }
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
    completionHandler(url)
  }

  func downloadDidFinish(_ download: WKDownload) {
    NSLog("Hi-chat: download saved")
  }

  // Links that open a new window go to the default browser.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { NSWorkspace.shared.open(url) }
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
    let dmg = (release["assets"] as? [[String: Any]] ?? [])
      .compactMap { $0["browser_download_url"] as? String }
      .first { $0.hasSuffix(".dmg") }
    // Updates come only from this repository's own releases
    guard Updater.isNewer(version, than: current), let dmg, let url = URL(string: dmg),
          url.scheme == "https", url.host == "github.com",
          url.path.hasPrefix("/praneeth-pra/hi-chat/releases/download/")
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
      await install(from: url)
    } else {
      UserDefaults.standard.set(version, forKey: Updater.skippedKey)
    }
  }

  func install(from url: URL) async {
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
      pid=$1; dmg=$2; target=$3; work=$4; mnt="$work/mnt"
      hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mnt" -quiet \\
        && ditto "$mnt/Hi-chat.app" "$work/Hi-chat.app"
      hdiutil detach "$mnt" -quiet
      while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
      if [ -d "$work/Hi-chat.app" ] && codesign --verify "$work/Hi-chat.app"; then
        mv "$target" "$work/old.app" && { ditto "$work/Hi-chat.app" "$target" || { rm -rf "$target"; mv "$work/old.app" "$target"; }; }
      fi
      open "$target"
      rm -rf "$work"
      """
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/bin/sh")
    task.arguments = ["-c", script, "sh", String(ProcessInfo.processInfo.processIdentifier),
                      dmg.path, target.path, work.path]
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

/// The global shortcuts: one event tap on the main run loop. It only reads
/// the event and remembers a few flags, so it never holds up the Mac's input.
final class Keys {
  unowned let app: AppController
  var tap: CFMachPort?
  var dictating = false
  var fnDown = false
  /// A modifier pressed on its own: which, and when. Another key, a click or
  /// a hand scroll meanwhile turns it into a chord, which is left alone.
  var lone: (key: Int64, at: TimeInterval)?
  var heldKey: Int64?
  var redirecting = false
  /// A click that went to Hi-chat's cursor, so its release does too.
  var cursorClick = false
  static let tapSeconds = 0.5

  init(app: AppController) { self.app = app }

  func start() -> Bool {
    let kinds: [CGEventType] = [.flagsChanged, .keyDown, .keyUp, .leftMouseDown, .leftMouseUp,
                                .rightMouseDown, .mouseMoved, .leftMouseDragged, .scrollWheel]
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

  func handle(_ type: CGEventType, _ event: CGEvent) -> Unmanaged<CGEvent>? {
    let pass = Unmanaged.passUnretained(event)
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
      if type == .leftMouseDown && MainActor.assumeIsolated({ app.cursorOn }) {
        cursorClick = true
        let clicks = event.getIntegerValueField(.mouseEventClickState)
        later { $0.cursorDown(clicks: clicks) }
        return nil
      }
      return pass
    case .leftMouseUp:
      if cursorClick {
        cursorClick = false
        later { $0.cursorUp() }
        return nil
      }
      return pass
    case .mouseMoved, .leftMouseDragged:
      // While Option typing is on the mouse moves Hi-chat's cursor only. The
      // real pointer is put straight back, here in the tap, before the next
      // movement: macOS lets only the app in front hold the pointer still.
      guard let home = MainActor.assumeIsolated({ app.cursorOn ? app.cursorHome : nil })
      else { return pass }
      let dx = event.getDoubleValueField(.mouseEventDeltaX)
      let dy = event.getDoubleValueField(.mouseEventDeltaY)
      CGWarpMouseCursorPosition(home)
      // Without this the mouse goes quiet for a moment after a warp
      CGAssociateMouseAndMouseCursorPosition(1)
      later { $0.cursorMove(dx: dx, dy: dy) }
      return nil
    case .scrollWheel:
      return scroll(event)
    default:
      return pass
    }
  }

  func flagsChanged(_ event: CGEvent) -> Unmanaged<CGEvent>? {
    let key = event.getIntegerValueField(.keyboardEventKeycode)
    let flags = event.flags
    if key == Key.fn { fnDown = flags.contains(.maskSecondaryFn) }
    let down: Bool
    switch key {
    case Key.leftControl: down = flags.contains(.maskControl)
    case Key.leftOption: down = flags.contains(.maskAlternate)
    default:
      lone = nil
      return Unmanaged.passUnretained(event)
    }
    let others: CGEventFlags = [.maskCommand, .maskShift, .maskControl, .maskAlternate]
    let alone = flags.intersection(others).subtracting(
      key == Key.leftControl ? .maskControl : .maskAlternate).isEmpty
    if down {
      lone = alone ? (key, ProcessInfo.processInfo.systemUptime) : nil
    } else if let lone, lone.key == key,
              ProcessInfo.processInfo.systemUptime - lone.at < Keys.tapSeconds {
      self.lone = nil
      if key == Key.leftControl { later { $0.remote("F14") } } else { later { $0.toggleTyping() } }
    } else {
      lone = nil
    }
    return Unmanaged.passUnretained(event)
  }

  func keyDown(_ event: CGEvent) -> Unmanaged<CGEvent>? {
    let pass = Unmanaged.passUnretained(event)
    let key = event.getIntegerValueField(.keyboardEventKeycode)
    let flags = event.flags
    let repeating = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
    let shift = flags.contains(.maskShift)
    let chord = flags.contains(.maskCommand) || flags.contains(.maskControl) || flags.contains(.maskAlternate)

    if key == Key.escape && !chord {
      if dictating { swallow(key) { $0.remote("Shift+F13") }; return nil }
      if MainActor.assumeIsolated({ app.typing }) { swallow(key) { $0.stopTyping() }; return nil }
      return pass
    }
    if chord { return pass }
    switch key {
    case Key.pageUp, Key.pageDown:
      // fn + Up / Down on a Mac keyboard
      let up = key == Key.pageUp
      if shift {
        swallow(key) { $0.scrollChat(by: up ? -0.8 : 0.8) }
      } else if !repeating {
        swallow(key) { $0.remote(up ? "Shift+F16" : "Shift+F17") }
      }
      heldKey = key
      return nil
    case Key.end, Key.right:
      guard fnDown, !shift else { return pass }
      if !repeating { swallow(key) { $0.remote("F15") } }
      heldKey = key
      return nil
    case Key.x, Key.z:
      // Plain Z / X go into Hi-chat and back; fn + Z / X (and Shift) type the letter
      if shift { return pass }
      if fnDown || flags.contains(.maskSecondaryFn) {
        event.flags.remove(.maskSecondaryFn)
        return pass
      }
      if !repeating { swallow(key) { key == Key.z ? $0.clickChat() : $0.leaveChat() } }
      heldKey = key
      return nil
    case Key.home, Key.left:
      guard fnDown else { return pass }
      if !repeating { swallow(key) { shift ? $0.hideMirror() : $0.toggleMirror() } }
      heldKey = key
      return nil
    default:
      return pass
    }
  }

  func swallow(_ key: Int64, _ action: @escaping @MainActor (AppController) -> Void) {
    heldKey = key
    later(action)
  }

  /// fn + scroll (and any scroll while Option typing is on) scrolls Hi-chat:
  /// a fresh event at the window's middle with the same distance, phase and
  /// glide. A copy could carry the pointer over with it.
  func scroll(_ event: CGEvent) -> Unmanaged<CGEvent>? {
    let pass = Unmanaged.passUnretained(event)
    if event.getIntegerValueField(.eventSourceUserData) == ownEventMark { return pass }
    let momentum = event.getIntegerValueField(.scrollWheelEventMomentumPhase)
    let phase = event.getIntegerValueField(.scrollWheelEventScrollPhase)
    // A hand scroll makes a held Control/Option a chord; its glide doesn't.
    if momentum == 0 && (phase == 0 || phase == 1 || phase == 2) { lone = nil }
    if event.flags.contains(.maskSecondaryFn) || fnDown || MainActor.assumeIsolated({ app.typing }) {
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

/// Hi-chat's cursor: an arrow, or an I-beam over text, in blue with a white
/// edge so it never looks like the real pointer. Clicks go through it.
final class ChatCursorView: NSView {
  var text = false {
    didSet { if text != oldValue { needsDisplay = true } }
  }
  /// The point that is the cursor's position, from the view's top left.
  var hotSpot: NSPoint { text ? NSPoint(x: 8, y: 11) : NSPoint(x: 2, y: 2) }
  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func draw(_ dirtyRect: NSRect) {
    let path = NSBezierPath()
    if text {
      path.move(to: NSPoint(x: 4, y: 2)); path.line(to: NSPoint(x: 12, y: 2))
      path.move(to: NSPoint(x: 8, y: 2)); path.line(to: NSPoint(x: 8, y: 20))
      path.move(to: NSPoint(x: 4, y: 20)); path.line(to: NSPoint(x: 12, y: 20))
      path.lineCapStyle = .round
      NSColor.white.setStroke(); path.lineWidth = 4; path.stroke()
      NSColor.systemBlue.setStroke(); path.lineWidth = 2; path.stroke()
    } else {
      let points: [(CGFloat, CGFloat)] = [(0, 0), (0, 17), (4, 13), (7, 20), (10, 19), (7, 12), (12, 12)]
      path.move(to: NSPoint(x: points[0].0 + 2, y: points[0].1 + 2))
      for p in points.dropFirst() { path.line(to: NSPoint(x: p.0 + 2, y: p.1 + 2)) }
      path.close()
      path.lineJoinStyle = .round
      NSColor.white.setStroke(); path.lineWidth = 2.5; path.stroke()
      NSColor.systemBlue.setFill(); path.fill()
    }
  }
}

/// The page's side of Hi-chat's cursor: highlights text at a point without
/// a real click, so the message box keeps the keyboard.
let chatCursorScript = """
  (() => {
    let anchor = null
    const at = (x, y) => document.caretRangeFromPoint(x, y)
    window.hiChatCursor = {
      overText(x, y) {
        const r = at(x, y)
        if (!r || r.startContainer.nodeType !== Node.TEXT_NODE) return false
        const all = document.createRange()
        all.selectNodeContents(r.startContainer)
        for (const b of all.getClientRects()) {
          if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return true
        }
        return false
      },
      down(x, y, clicks) {
        const r = at(x, y), s = getSelection()
        anchor = null
        if (!r || !s) return
        s.setBaseAndExtent(r.startContainer, r.startOffset, r.startContainer, r.startOffset)
        if (clicks >= 2) {
          const unit = clicks >= 3 ? 'paragraphboundary' : 'word'
          s.modify('move', 'backward', unit)
          s.modify('extend', 'forward', unit)
        } else {
          anchor = r
        }
      },
      drag(x, y) {
        const r = at(x, y), s = getSelection()
        if (!anchor || !r || !s) return
        s.setBaseAndExtent(anchor.startContainer, anchor.startOffset, r.startContainer, r.startOffset)
      },
    }
  })()
  """

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
