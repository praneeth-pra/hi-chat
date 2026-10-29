// HiChatMirror: a floating window that mirrors the Hi-chat window live and,
// on request, the screen around the pointer. It uses ScreenCaptureKit, so
// the picture is a live stream about one frame behind the real screen.
//
// The window never takes focus: it is a non-activating panel of a helper
// with no Dock icon. Drag it to move, drag its bottom-right corner to
// resize, x hides it. The Hi-chat app (HiChat.swift) starts it from inside
// its bundle and sends commands as distributed notifications named
// "dev.hitechie.janmirror":
//   { command = "toggle", window = "<CGWindowID of Hi-chat>" }
//     hidden -> shows Hi-chat; Hi-chat -> the screen around the pointer; and back
// The pointer view follows whichever moved last: the mouse pointer, or the
// text cursor while you type. Hi-chat reads the text cursor (it has
// Accessibility for remote control) and sends it here:
//   { command = "caret", at = "x,y" }   (at = "" when there is none)
// Without those reports this helper reads it itself, if it may. For apps
// that don't report a text cursor (many web editors), Hi-chat says when a
// key is typed ({ command = "typed" }) and the view goes to where the screen
// changed just then: the letters appearing.
//   { command = "hide" }   { command = "quit" }
// fn + Left sends "toggle", fn + Shift + Left sends "hide".
//
// build.sh compiles it into Hi-chat.app (macOS 14 or later).

@preconcurrency import AppKit
@preconcurrency import CoreMedia
@preconcurrency import ScreenCaptureKit
@preconcurrency import IOSurface
@preconcurrency import ApplicationServices

let notificationName = Notification.Name("dev.hitechie.janmirror")
let frameRate: Int32 = 120 // a cap only: frames come as fast as the display updates
let edge: CGFloat = 0.2 // the pointer view pans only once the pointer is this close to its edge
let caretEvery = 8 // ticks (of 1/120 s) between text cursor checks: about 15 a second

/// Where the text cursor is in the app you're typing in, in screen
/// coordinates (origin bottom left), or nil if it doesn't say.
@MainActor
final class TextCursor {
  let system = AXUIElementCreateSystemWide()
  var askedApps = Set<pid_t>()

  init() {
    // A busy app mustn't stall the mirror: give up on it quickly
    AXUIElementSetMessagingTimeout(system, 0.05)
  }

  func point() -> NSPoint? {
    guard AXIsProcessTrusted() else { return nil }
    var focused: CFTypeRef?
    guard AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focused)
            == .success, let focused, CFGetTypeID(focused) == AXUIElementGetTypeID()
    else { return nil }
    let element = focused as! AXUIElement
    askForText(element)
    var range: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &range)
            == .success, let range
    else { return nil }
    var bounds: CFTypeRef?
    guard AXUIElementCopyParameterizedAttributeValue(
            element, kAXBoundsForRangeParameterizedAttribute as CFString, range, &bounds) == .success,
          let bounds, CFGetTypeID(bounds) == AXValueGetTypeID()
    else { return nil }
    var rect = CGRect.zero
    guard AXValueGetValue(bounds as! AXValue, .cgRect, &rect),
          rect.origin != .zero || rect.size != .zero,
          let primary = NSScreen.screens.first
    else { return nil }
    // Accessibility measures from the top left of the main screen
    return NSPoint(x: rect.midX, y: primary.frame.maxY - rect.midY)
  }

  /// Chrome and Electron apps (VS Code, Slack) only describe their text to
  /// Accessibility once asked; asked once per app.
  func askForText(_ element: AXUIElement) {
    var pid: pid_t = 0
    guard AXUIElementGetPid(element, &pid) == .success, !askedApps.contains(pid) else { return }
    askedApps.insert(pid)
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.05)
    AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
  }
}

func say(_ message: String) {
  FileHandle.standardError.write(("[jan mirror helper] " + message + "\n").data(using: .utf8)!)
}

/// A panel that is never key or main, so clicking it leaves your app active.
final class MirrorPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

/// The picture; dragging it moves the window.
final class PictureView: NSView {
  let picture = CALayer()
  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    layer?.backgroundColor = NSColor(white: 0.09, alpha: 1).cgColor
    layer?.cornerRadius = 10
    layer?.masksToBounds = true
    picture.frame = bounds
    picture.contentsGravity = .resizeAspect
    picture.zPosition = -1
    layer?.addSublayer(picture)
  }
  required init?(coder: NSCoder) { fatalError() }
  override var mouseDownCanMoveWindow: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func layout() {
    super.layout()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    picture.frame = bounds
    CATransaction.commit()
  }
}

/// The bottom-right corner; dragging it resizes the window.
final class GripView: NSView {
  private var start: (frame: NSRect, mouse: NSPoint)?
  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    layer?.backgroundColor = NSColor(white: 1, alpha: 0.15).cgColor
  }
  required init?(coder: NSCoder) { fatalError() }
  override var mouseDownCanMoveWindow: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func mouseDown(with event: NSEvent) {
    guard let window else { return }
    start = (window.frame, NSEvent.mouseLocation)
  }
  override func mouseDragged(with event: NSEvent) {
    guard let window, let start else { return }
    let now = NSEvent.mouseLocation
    let width = max(240, start.frame.width + now.x - start.mouse.x)
    let height = max(160, start.frame.height - (now.y - start.mouse.y))
    window.setFrame(NSRect(x: start.frame.minX, y: start.frame.maxY - height,
                           width: width, height: height), display: true)
  }
}

@MainActor
final class Mirror: NSObject, SCStreamOutput, SCStreamDelegate {
  enum Mode { case jan, pointer }

  let panel: MirrorPanel
  let view: PictureView
  var mode = Mode.jan
  var stream: SCStream?
  var streamDisplay: CGDirectDisplayID?
  var area: NSRect?
  var janWindow: CGWindowID = 0
  /// Hi-chat's size when its stream started; a new size restarts it
  var janSize = CGSize.zero
  var sizeTicks = 0
  var resizing = CGSize.zero
  var generation = 0
  // The pointer view follows the mouse, or the text cursor while you type
  let textCursor = TextCursor()
  var lastMouse = NSPoint(x: -1, y: -1)
  var lastCaret: NSPoint?
  var followingCaret = false
  var ticks = 0
  /// The text cursor as Hi-chat reports it (it has Accessibility; this
  /// helper may not). Once Hi-chat has reported, its reports are used.
  var reportedCaret: NSPoint?
  var caretReports = false
  var caretWhy = ""
  let status = NSTextField(labelWithString: "")
  // Typing found on the screen (apps that don't report a text cursor)
  var latestSurface: IOSurface?
  var streamFrame = NSRect.zero
  var visualPoint: NSPoint?
  var followingVisual = false
  var comparing = false

  override init() {
    panel = MirrorPanel(contentRect: NSRect(x: 0, y: 0, width: 640, height: 420),
                        styleMask: [.borderless, .nonactivatingPanel, .resizable],
                        backing: .buffered, defer: false)
    view = PictureView(frame: NSRect(x: 0, y: 0, width: 640, height: 420))
    super.init()
    panel.level = .floating
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    panel.isMovableByWindowBackground = true
    panel.hidesOnDeactivate = false
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.contentView = view
    if !panel.setFrameUsingName("JanMirror"), let screen = NSScreen.main {
      let f = screen.visibleFrame
      panel.setFrameOrigin(NSPoint(x: f.maxX - 660, y: f.maxY - 440))
    }
    panel.setFrameAutosaveName("JanMirror")

    // Placed from the current size: a saved frame has already resized the view
    let size = view.bounds.size
    let grip = GripView(frame: NSRect(x: size.width - 16, y: 0, width: 16, height: 16))
    grip.autoresizingMask = [.minXMargin, .maxYMargin]
    grip.layer?.zPosition = 10
    view.addSubview(grip)
    // A clear round x on a dark disc, above the picture, so it shows on any content
    let close = NSButton(title: "", target: self, action: #selector(hide))
    close.isBordered = false
    close.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: "Close")?
      .withSymbolConfiguration(.init(pointSize: 11, weight: .bold))
    close.contentTintColor = .white
    close.wantsLayer = true
    close.layer?.backgroundColor = NSColor(white: 0, alpha: 0.6).cgColor
    close.layer?.cornerRadius = 12
    close.layer?.zPosition = 10
    close.frame = NSRect(x: size.width - 32, y: size.height - 32, width: 24, height: 24)
    close.autoresizingMask = [.minXMargin, .minYMargin]
    close.toolTip = "Close the mirror (fn + Shift + Left)"
    view.addSubview(close)
    // What the pointer view follows (updateStatus)
    status.font = .systemFont(ofSize: 11, weight: .medium)
    status.textColor = .white
    status.drawsBackground = true
    status.backgroundColor = NSColor(white: 0, alpha: 0.55)
    status.isBezeled = false
    status.isHidden = true
    status.frame = NSRect(x: 8, y: 8, width: size.width - 40, height: 16)
    status.autoresizingMask = [.width, .maxYMargin]
    status.wantsLayer = true
    status.layer?.cornerRadius = 4
    status.layer?.zPosition = 10
    view.addSubview(status)

    DistributedNotificationCenter.default().addObserver(
      forName: notificationName, object: nil, queue: .main
    ) { note in
      let info = note.userInfo ?? [:]
      let command = info["command"] as? String ?? ""
      let window = (info["window"] as? String).flatMap { UInt32($0) }
        ?? (info["window"] as? NSNumber)?.uint32Value
      let at = info["at"] as? String
      let why = info["why"] as? String
      MainActor.assumeIsolated {
        if command == "caret" { self.caretReported(at ?? "", why: why ?? "") }
        self.handle(command, window: window)
      }
    }
    Timer.scheduledTimer(withTimeInterval: 1.0 / 120, repeats: true) { _ in
      MainActor.assumeIsolated {
        self.followPointer()
        self.followJanSize()
      }
    }
    // Its place on a monitor and on the laptop's screen (see screensChanged)
    for name in [NSWindow.didMoveNotification, NSWindow.didResizeNotification] {
      NotificationCenter.default.addObserver(
        self, selector: #selector(moved(_:)), name: name, object: panel)
    }
    NotificationCenter.default.addObserver(
      self, selector: #selector(screensChanged(_:)),
      name: NSApplication.didChangeScreenParametersNotification, object: nil)
    hadMonitor = Mirror.monitorConnected()
    say("ready")
  }

  // MARK: Monitor

  static func isBuiltIn(_ screen: NSScreen) -> Bool {
    guard let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
    else { return false }
    return CGDisplayIsBuiltin(id.uint32Value) != 0
  }

  static func monitorConnected() -> Bool { NSScreen.screens.contains { !isBuiltIn($0) } }

  static func frameKey(onMonitor: Bool) -> String {
    onMonitor ? "MirrorOnMonitor" : "MirrorOnLaptop"
  }

  /// Whether a monitor was connected at the last check, whether the mirror
  /// was last on a monitor, and whether unplugging that monitor hid it.
  var hadMonitor = false
  var onMonitor = false
  var hiddenWithMonitor = false

  /// Keeps where the mirror is for the kind of screen it's on.
  func rememberPlace() {
    guard let screen = panel.screen else { return }
    onMonitor = !Mirror.isBuiltIn(screen)
    UserDefaults.standard.set(NSStringFromRect(panel.frame), forKey: Mirror.frameKey(onMonitor: onMonitor))
  }

  /// Only your own drags count: macOS moving the mirror off an unplugged
  /// monitor must not overwrite its place there.
  @objc func moved(_ notification: Notification) {
    if NSEvent.pressedMouseButtons != 0 { rememberPlace() }
  }

  @objc func screensChanged(_ notification: Notification) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
      self?.monitorsChanged()
    }
  }

  /// Unplugged while the mirror was on the monitor: it hides rather than
  /// landing on the laptop's screen. Plugged in again: it comes back exactly
  /// where it was.
  func monitorsChanged() {
    let monitor = Mirror.monitorConnected()
    let had = hadMonitor
    hadMonitor = monitor
    if monitor, hiddenWithMonitor {
      hiddenWithMonitor = false
      let saved = NSRectFromString(
        UserDefaults.standard.string(forKey: Mirror.frameKey(onMonitor: true)) ?? "")
      if !saved.isEmpty, NSScreen.screens.contains(where: { $0.visibleFrame.intersects(saved) }) {
        panel.setFrame(saved, display: true)
      }
      panel.orderFrontRegardless()
      restart()
    } else if !monitor, had, onMonitor, panel.isVisible {
      hide()
      hiddenWithMonitor = true
    }
  }

  func handle(_ command: String, window: CGWindowID?) {
    if let window, window != 0 { janWindow = window }
    switch command {
    case "caret": return // handled with its position (caretReported)
    case "typed": typed(); return
    case "toggle":
      if !panel.isVisible {
        mode = .jan
        hiddenWithMonitor = false
        panel.orderFrontRegardless()
        rememberPlace()
      } else {
        mode = mode == .jan ? .pointer : .jan
      }
      restart()
    case "hide": hide()
    case "quit": NSApp.terminate(nil)
    default: say("unknown command \(command)")
    }
  }

  @objc func hide() {
    panel.orderOut(nil)
    generation += 1
    let old = stream
    stream = nil
    streamDisplay = nil
    Task { try? await old?.stopCapture() }
  }

  /// Hi-chat's report of the text cursor: "x,y", or "" for none (and why).
  func caretReported(_ at: String, why: String) {
    caretReports = true
    caretWhy = why
    let parts = at.split(separator: ",").compactMap { Double($0) }
    reportedCaret = parts.count == 2 ? NSPoint(x: parts[0], y: parts[1]) : nil
  }

  /// A small label in the pointer view: what it follows, and if it's the
  /// mouse while a text cursor might be expected, why.
  func updateStatus() {
    guard mode == .pointer else { status.isHidden = true; return }
    let text: String
    if followingCaret {
      text = "Following your typing"
    } else if followingVisual {
      text = "Following your typing (from the screen)"
    } else {
      switch caretWhy {
      case "no-permission": text = "Following the mouse · Hi-chat needs Accessibility"
      case "no-text", "no-bounds": text = "Following the mouse · this app doesn't report its text cursor"
      case "no-focus": text = "Following the mouse · no text box in focus"
      case "": text = caretReports ? "Following the mouse" : "Following the mouse · waiting for Hi-chat"
      default: text = "Following the mouse"
      }
    }
    if status.stringValue != text { status.stringValue = text }
    status.isHidden = false
  }

  /// What the pointer view follows: the text cursor if it moved since the
  /// mouse last did (you're typing), else the mouse pointer.
  func focusPoint() -> NSPoint {
    let mouse = NSEvent.mouseLocation
    if mouse != lastMouse {
      lastMouse = mouse
      followingCaret = false
      followingVisual = false
    }
    ticks += 1
    if ticks % caretEvery == 0 {
      let caret = caretReports ? reportedCaret : textCursor.point()
      if let caret, let last = lastCaret, caret != last { followingCaret = true }
      if caret == nil { followingCaret = false }
      lastCaret = caret
    }
    if followingCaret, let caret = lastCaret { return caret }
    if followingVisual, let seen = visualPoint { return seen }
    return mouse
  }

  // MARK: Typing seen on the screen

  /// A small grey copy of the screen: one sample every `step` pixels.
  struct Snapshot {
    let cols: Int, rows: Int, step: Int, width: Int, height: Int
    let lum: [UInt8]
  }

  /// The newest frame, sampled now (the frame is reused for later ones).
  func snapshot() -> Snapshot? {
    guard let surface = latestSurface else { return nil }
    IOSurfaceLock(surface, .readOnly, nil)
    defer { IOSurfaceUnlock(surface, .readOnly, nil) }
    let width = IOSurfaceGetWidth(surface), height = IOSurfaceGetHeight(surface)
    let row = IOSurfaceGetBytesPerRow(surface)
    let base = IOSurfaceGetBaseAddress(surface).assumingMemoryBound(to: UInt8.self)
    let step = 4
    let cols = width / step, rows = height / step
    guard cols > 0, rows > 0 else { return nil }
    var lum = [UInt8](repeating: 0, count: cols * rows)
    for r in 0..<rows {
      let line = base + r * step * row
      for c in 0..<cols {
        let px = line + c * step * 4 // BGRA
        lum[r * cols + c] = UInt8((Int(px[0]) + 2 * Int(px[1]) + Int(px[2])) >> 2)
      }
    }
    return Snapshot(cols: cols, rows: rows, step: step, width: width, height: height, lum: lum)
  }

  /// A key was typed. When the app doesn't report its text cursor, compare
  /// the screen now with a moment later and follow the small patch that
  /// changed: the letters appearing.
  func typed() {
    let reportsCursor = caretReports ? reportedCaret != nil : lastCaret != nil
    guard mode == .pointer, panel.isVisible, !reportsCursor, !comparing,
          let before = snapshot() else { return }
    comparing = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { [weak self] in
      MainActor.assumeIsolated { self?.compareTyping(before) }
    }
  }

  func compareTyping(_ before: Snapshot) {
    comparing = false
    guard let after = snapshot(), after.cols == before.cols, after.rows == before.rows,
          streamFrame.width > 0 else { return }
    // Screen point <-> sample, for the streamed display
    let sx = CGFloat(after.width) / streamFrame.width / CGFloat(after.step)
    let sy = CGFloat(after.height) / streamFrame.height / CGFloat(after.step)
    // macOS hides the mouse pointer as you type: that's a change, not typing
    let mouse = NSEvent.mouseLocation
    let mc = Int((mouse.x - streamFrame.minX) * sx)
    let mr = Int((streamFrame.maxY - mouse.y) * sy)
    let near = Int(48 * sx)
    var minC = Int.max, minR = Int.max, maxC = -1, maxR = -1, changed = 0
    for i in 0..<after.lum.count where abs(Int(after.lum[i]) - Int(before.lum[i])) > 24 {
      let c = i % after.cols, r = i / after.cols
      if abs(c - mc) < near && abs(r - mr) < near { continue }
      changed += 1
      minC = min(minC, c); maxC = max(maxC, c)
      minR = min(minR, r); maxR = max(maxR, r)
    }
    // Typing changes a small patch; scrolling or a new page changes a lot
    guard changed >= 3, changed < after.lum.count / 50,
          maxC - minC < after.cols / 3, maxR - minR < after.rows / 4
    else { return }
    // The right end of what changed: where the newest letter is
    visualPoint = NSPoint(x: streamFrame.minX + CGFloat(maxC) / sx,
                          y: streamFrame.maxY - CGFloat(minR + maxR) / 2 / sy)
    followingVisual = true
    followingCaret = false
  }

  /// The screen the pointer view follows (the pointer's, or the text cursor's).
  func pointerScreen() -> NSScreen? {
    let p = mode == .pointer ? focusPoint() : NSEvent.mouseLocation
    return NSScreen.screens.first { NSMouseInRect(p, $0.frame, false) } ?? NSScreen.main
  }

  func displayID(_ screen: NSScreen) -> CGDirectDisplayID? {
    (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
  }

  func restart() {
    generation += 1
    let mine = generation
    let old = stream
    stream = nil
    area = nil
    view.picture.contents = nil
    latestSurface = nil
    let screen = pointerScreen()
    streamDisplay = mode == .pointer ? screen.flatMap(displayID) : nil
    Task {
      try? await old?.stopCapture()
      do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        let filter: SCContentFilter
        let config = SCStreamConfiguration()
        config.minimumFrameInterval = CMTime(value: 1, timescale: frameRate)
        config.queueDepth = 3
        config.pixelFormat = kCVPixelFormatType_32BGRA
        if mode == .jan {
          guard let window = content.windows.first(where: { $0.windowID == janWindow }) else {
            say("the Hi-chat window \(janWindow) was not found")
            return
          }
          filter = SCContentFilter(desktopIndependentWindow: window)
          let scale = CGFloat(filter.pointPixelScale)
          config.width = Int(window.frame.width * scale)
          config.height = Int(window.frame.height * scale)
          // A frame caught mid-resize is scaled to fit, not cut off or
          // pushed into a corner
          config.scalesToFit = true
          config.showsCursor = false
          janSize = window.frame.size
          view.picture.contentsGravity = .resizeAspect
          view.picture.contentsRect = CGRect(x: 0, y: 0, width: 1, height: 1)
        } else {
          guard let screen, let id = displayID(screen),
                let display = content.displays.first(where: { $0.displayID == id }) else {
            say("the pointer's display was not found")
            return
          }
          // Leave this window out, so the view never shows itself.
          let own = content.windows.filter { $0.windowID == CGWindowID(panel.windowNumber) }
          filter = SCContentFilter(display: display, excludingWindows: own)
          config.width = Int(CGFloat(display.width) * screen.backingScaleFactor)
          config.height = Int(CGFloat(display.height) * screen.backingScaleFactor)
          config.showsCursor = true
          streamFrame = screen.frame
          view.picture.contentsGravity = .resize
          followPointer()
        }
        guard mine == generation else { return } // switched again meanwhile
        let next = SCStream(filter: filter, configuration: config, delegate: self)
        try next.addStreamOutput(self, type: .screen, sampleHandlerQueue: .main)
        try await next.startCapture()
        guard mine == generation else {
          try? await next.stopCapture()
          return
        }
        stream = next
        say("streaming \(mode == .jan ? "Hi-chat" : "the pointer view") at \(config.width)x\(config.height)")
      } catch {
        say("could not start: \(error.localizedDescription) (allow Screen Recording for Hi-chat)")
      }
    }
  }

  /// Hi-chat resized (or moved between the monitor and the laptop): the
  /// stream keeps the size it started with, which leaves the picture off
  /// centre with uneven margins, so it starts again at the new size.
  func followJanSize() {
    sizeTicks += 1
    guard sizeTicks % 30 == 0, mode == .jan, panel.isVisible, stream != nil,
          let info = CGWindowListCopyWindowInfo(.optionIncludingWindow, janWindow) as? [[String: Any]],
          let bounds = info.first?[kCGWindowBounds as String] as? NSDictionary,
          let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary)
    else { return }
    // Waits for the size to hold still, so a drag restarts it once, at the end
    defer { resizing = rect.size }
    if rect.size != janSize, rect.size == resizing { restart() }
  }

  /// Pointer view: show the part of the screen around the pointer (or the
  /// text cursor while typing), the size of this window, holding still until
  /// it nears the view's edge.
  func followPointer() {
    updateStatus()
    guard mode == .pointer, panel.isVisible, let screen = pointerScreen() else { return }
    if let id = displayID(screen), id != streamDisplay {
      restart() // the pointer moved to another display
      return
    }
    let p = followingCaret ? (lastCaret ?? NSEvent.mouseLocation)
      : followingVisual ? (visualPoint ?? NSEvent.mouseLocation) : NSEvent.mouseLocation
    let full = screen.frame
    let w = min(panel.frame.width, full.width), h = min(panel.frame.height, full.height)
    var a: NSRect
    if let old = area, old.width == w, old.height == h, full.contains(old.origin) {
      let mx = w * edge, my = h * edge
      a = old
      a.origin.x = max(p.x - w + mx, min(a.origin.x, p.x - mx))
      a.origin.y = max(p.y - h + my, min(a.origin.y, p.y - my))
    } else {
      a = NSRect(x: p.x - w / 2, y: p.y - h / 2, width: w, height: h)
    }
    a.origin.x = max(full.minX, min(a.origin.x, full.maxX - w))
    a.origin.y = max(full.minY, min(a.origin.y, full.maxY - h))
    guard a != area else { return }
    area = a
    // contentsRect is in the picture's unit square, origin at the bottom left
    // like the screen coordinates used here.
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    view.picture.contentsRect = CGRect(
      x: (a.minX - full.minX) / full.width, y: (a.minY - full.minY) / full.height,
      width: w / full.width, height: h / full.height)
    CATransaction.commit()
  }

  nonisolated func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer,
                          of type: SCStreamOutputType) {
    guard type == .screen,
          let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false)
            as? [[SCStreamFrameInfo: Any]],
          let raw = attachments.first?[.status] as? Int,
          SCFrameStatus(rawValue: raw) == .complete,
          let buffer = CMSampleBufferGetImageBuffer(sample),
          let surface = CVPixelBufferGetIOSurface(buffer)?.takeUnretainedValue()
    else { return }
    // Frames arrive on the main queue, so each one is drawn at once, with no
    // hop between threads, and flushed to the screen straight away.
    MainActor.assumeIsolated {
      guard stream === self.stream else { return } // a frame from a stream already replaced
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      self.view.picture.contents = surface
      self.latestSurface = surface
      CATransaction.commit()
      CATransaction.flush()
    }
  }

  nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
    say("stream stopped: \(error.localizedDescription)")
  }
}

@main
struct JanMirrorApp {
  @MainActor static func main() {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory) // no Dock icon, never the active app
    let mirror = Mirror()
    withExtendedLifetime(mirror) { app.run() }
  }
}
