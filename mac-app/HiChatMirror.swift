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
//   { command = "hide" }   { command = "quit" }
// fn + Left sends "toggle", fn + Shift + Left sends "hide".
//
// build.sh compiles it into Hi-chat.app (macOS 14 or later).

@preconcurrency import AppKit
@preconcurrency import CoreMedia
@preconcurrency import ScreenCaptureKit
@preconcurrency import IOSurface

let notificationName = Notification.Name("dev.hitechie.janmirror")
let frameRate: Int32 = 120 // a cap only: frames come as fast as the display updates
let edge: CGFloat = 0.2 // the pointer view pans only once the pointer is this close to its edge

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
  var generation = 0

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

    DistributedNotificationCenter.default().addObserver(
      forName: notificationName, object: nil, queue: .main
    ) { note in
      let info = note.userInfo ?? [:]
      let command = info["command"] as? String ?? ""
      let window = (info["window"] as? String).flatMap { UInt32($0) }
        ?? (info["window"] as? NSNumber)?.uint32Value
      MainActor.assumeIsolated { self.handle(command, window: window) }
    }
    Timer.scheduledTimer(withTimeInterval: 1.0 / 120, repeats: true) { _ in
      MainActor.assumeIsolated { self.followPointer() }
    }
    say("ready")
  }

  func handle(_ command: String, window: CGWindowID?) {
    if let window, window != 0 { janWindow = window }
    switch command {
    case "toggle":
      if !panel.isVisible {
        mode = .jan
        panel.orderFrontRegardless()
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

  /// The screen the pointer is on.
  func pointerScreen() -> NSScreen? {
    let p = NSEvent.mouseLocation
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
          config.showsCursor = false
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

  /// Pointer view: show the part of the screen around the pointer, the size
  /// of this window, holding still until the pointer nears its edge.
  func followPointer() {
    guard mode == .pointer, panel.isVisible, let screen = pointerScreen() else { return }
    if let id = displayID(screen), id != streamDisplay {
      restart() // the pointer moved to another display
      return
    }
    let p = NSEvent.mouseLocation
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
