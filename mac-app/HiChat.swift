// Hi-chat for Mac: the Hi-chat site in its own light window, with the
// keyboard shortcuts that the Hammerspoon script (scripts/hammerspoon) gave
// Safari built in.
//
//   tap Left Control        dictate: tap again to stop and send
//   Escape while dictating  throw the recording away
//   tap Left Option         type into Hi-chat while the app you're in stays
//                           active; tap again (or Escape) to stop
//   fn + Right              send what's typed in the box
//   fn + Up / Down          code block above / below
//   fn + Shift + Up / Down  scroll the chat by most of a screen
//   hold fn + scroll        scroll Hi-chat from anywhere
//   fn + Left               live mirror window (the JanMirror helper, if built);
//                           fn + Shift + Left closes it
//
// The window is a panel that takes the keyboard without making Hi-chat the
// active app, so a click or typing in it never greys out the app you're in.
// The shortcuts need Accessibility (System Settings > Privacy & Security).
//
// Build: mac-app/build.sh (GitHub Actions builds the DMG on every change).

import AppKit
import ServiceManagement
import WebKit

let homeURL = URL(string: "https://chat.hi-techie.dev/")!
let appHost = "chat.hi-techie.dev"
let mirrorNote = Notification.Name("dev.hitechie.janmirror")
let mirrorHelper = NSHomeDirectory() + "/.hammerspoon/JanMirror"
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
}

/// A window that takes the keyboard without activating Hi-chat.
final class ChatPanel: NSPanel {
  override var canBecomeKey: Bool { true }
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
  var mirrorTask: Process?
  var loginItem: NSMenuItem!
  /// The app that was in front when Option typing started.
  var typingReturnTo: NSRunningApplication?

  func applicationDidFinishLaunching(_ notification: Notification) {
    buildMenu()
    buildWindow()
    webView.load(URLRequest(url: homeURL))
    startKeys(prompt: true)
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

    webView = WKWebView(frame: .zero, configuration: config)
    webView.uiDelegate = self
    webView.navigationDelegate = self
    webView.allowsBackForwardNavigationGestures = false
    if #available(macOS 13.3, *) { webView.isInspectable = true }

    panel = ChatPanel(
      contentRect: NSRect(x: 0, y: 0, width: 1000, height: 800),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView,
                  .nonactivatingPanel],
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
    panel.backgroundColor = NSColor(red: 23 / 255, green: 23 / 255, blue: 23 / 255, alpha: 1)
    panel.minSize = NSSize(width: 420, height: 360)
    panel.contentView = webView
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
    loginItem = appMenu.addItem(withTitle: "Open at Login", action: #selector(toggleLogin(_:)), keyEquivalent: "")
    loginItem.target = self
    loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
    let access = appMenu.addItem(withTitle: "Keyboard Shortcuts Permission…", action: #selector(openAccessibility(_:)), keyEquivalent: "")
    access.target = self
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

  @objc func toggleLogin(_ sender: Any?) {
    let service = SMAppService.mainApp
    do {
      if service.status == .enabled { try service.unregister() } else { try service.register() }
    } catch {
      NSLog("Hi-chat: Open at Login failed: \(error)")
    }
    loginItem.state = service.status == .enabled ? .on : .off
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
    let quoted = "\"" + key + "\""
    webView.evaluateJavaScript("window.hiChatRemote && window.hiChatRemote(\(quoted))")
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
  /// takes the keyboard.
  var typing = false

  /// Option typing: Hi-chat takes the keyboard, the app in front stays active.
  func toggleTyping() {
    if typing { stopTyping() } else { startTyping() }
  }

  func startTyping() {
    let front = NSWorkspace.shared.frontmostApplication
    if front?.processIdentifier != ProcessInfo.processInfo.processIdentifier {
      typingReturnTo = front
    }
    if panel.isMiniaturized { panel.deminiaturize(nil) }
    panel.makeKeyAndOrderFront(nil)
    typing = true
    remote("F17") // the cursor goes to the end of the message box
  }

  func stopTyping() {
    let back = typingReturnTo
    typing = false
    typingReturnTo = nil
    guard panel.isKeyWindow else { return }
    // Giving up the keyboard: hide and show again without taking it, so it
    // goes back to the app in front.
    panel.orderOut(nil)
    back?.activate()
    panel.orderFrontRegardless()
  }

  func windowDidResignKey(_ notification: Notification) {
    typing = false
    typingReturnTo = nil
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
    guard let body = message.body as? [String: Any] else { return }
    if let status = body["dictation"] as? String {
      keys?.dictating = status == "recording" || status == "starting"
    }
  }

  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
               initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
               decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(origin.host == appHost ? .grant : .deny)
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if action.shouldPerformDownload { return decisionHandler(.download) }
    if let url = action.request.url, action.targetFrame?.isMainFrame != false,
       let scheme = url.scheme, scheme == "https" || scheme == "http" || scheme == "mailto",
       url.host != appHost, action.navigationType == .linkActivated {
      NSWorkspace.shared.open(url)
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
    let name = suggestedFilename.isEmpty ? "download" : suggestedFilename
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

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    webView.reload()
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
  static let tapSeconds = 0.5

  init(app: AppController) { self.app = app }

  func start() -> Bool {
    let kinds: [CGEventType] = [.flagsChanged, .keyDown, .keyUp, .leftMouseDown, .rightMouseDown, .scrollWheel]
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
      return pass
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

@main
@MainActor
struct HiChatMain {
  static func main() {
    let app = NSApplication.shared
    let controller = AppController()
    app.delegate = controller
    app.setActivationPolicy(.regular)
    app.run()
  }
}
