// Dictation from the Mac's own sound: what the speakers or headphones play
// (a call's other side), taken straight from macOS with ScreenCaptureKit
// instead of picked up again by the microphone through the air. It needs
// Screen Recording, like the mirror and screenshots; Hi-chat's own sound is
// left out.
//
// The page asks for it with { computerAudio: "start" } and "stop" (see
// web-app/src/lib/computerAudio.ts) and gets it through
// window.hiChatComputerAudio: { computerAudio: "data", pcm } every 40 ms,
// mono 16-bit at 48 kHz, base64. Silence keeps coming while nothing plays,
// so the page's clock and silence auto-stop work as with a mic.

@preconcurrency import AppKit
@preconcurrency import CoreMedia
@preconcurrency import ScreenCaptureKit

final class ComputerAudio: NSObject, SCStreamOutput, SCStreamDelegate {
  static let rate = 48000
  /// 40 ms at 48 kHz, a multiple of 3 so the page's 16 kHz downsample divides it
  static let block = 1920

  /// Hands a message to the page; called on the main thread.
  private let post: (String) -> Void
  // Main thread only
  private var stream: SCStream?
  private var generation = 0
  // The capture queue only
  private let queue = DispatchQueue(label: "Hi-chat computer audio", qos: .userInteractive)
  private var pending: [Float] = []
  private var sent: Int64 = 0
  private var startedAt = DispatchTime.now()
  private var timer: DispatchSourceTimer?

  init(post: @escaping (String) -> Void) {
    self.post = post
  }

  /// Main thread.
  func start() {
    if stream != nil { return tell(["computerAudio": "started", "rate": Self.rate]) }
    generation += 1
    let gen = generation
    Task { @MainActor in
      do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard gen == self.generation else { return }
        guard let display = content.displays.first else {
          throw NSError(domain: "Hi-chat", code: 1, userInfo: [NSLocalizedDescriptionKey: "No screen to record the sound with"])
        }
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = Self.rate
        config.channelCount = 1
        // Only the sound is wanted: the smallest, slowest picture there is
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        let next = SCStream(filter: SCContentFilter(display: display, excludingWindows: []),
                            configuration: config, delegate: self)
        try next.addStreamOutput(self, type: .audio, sampleHandlerQueue: self.queue)
        // Takes the frames so ScreenCaptureKit doesn't complain it has nowhere to put them
        try next.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.queue)
        try await next.startCapture()
        guard gen == self.generation else {
          try? await next.stopCapture()
          return
        }
        self.stream = next
        self.queue.async { self.beginClock() }
        self.tell(["computerAudio": "started", "rate": Self.rate])
      } catch {
        guard gen == self.generation else { return }
        // Most often: Screen Recording isn't allowed for Hi-chat
        self.tell(["computerAudio": "failed",
                   "error": "allow Hi-chat in System Settings > Privacy & Security > Screen Recording (\(error.localizedDescription))"])
      }
    }
  }

  /// Main thread.
  func stop() {
    generation += 1
    guard let old = stream else { return }
    stream = nil
    queue.async { self.timer?.cancel(); self.timer = nil }
    Task { try? await old.stopCapture() }
  }

  private func tell(_ message: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: message),
          let json = String(data: data, encoding: .utf8) else { return }
    post(json)
  }

  // MARK: The capture queue

  private func beginClock() {
    pending.removeAll()
    sent = 0
    startedAt = .now()
    timer?.cancel()
    let tick = DispatchSource.makeTimerSource(queue: queue)
    tick.schedule(deadline: .now() + .milliseconds(20), repeating: .milliseconds(20))
    tick.setEventHandler { [weak self] in self?.fillSilence() }
    tick.resume()
    timer = tick
  }

  /// How many 48 kHz samples should have gone to the page by now.
  private func due() -> Int64 {
    Int64(DispatchTime.now().uptimeNanoseconds - startedAt.uptimeNanoseconds) * Int64(Self.rate) / 1_000_000_000
  }

  /// Nothing played for a moment: silence until now.
  private func fillSilence() {
    let gap = due() - sent - Int64(pending.count)
    if gap > Int64(Self.rate / 20) { pending.append(contentsOf: repeatElement(0, count: Int(gap))) }
    flush()
  }

  private func flush() {
    while pending.count >= Self.block {
      send(pending[0..<Self.block])
      pending.removeFirst(Self.block)
      sent += Int64(Self.block)
    }
    // Ahead of the clock (macOS's timing drifts from ours): let it catch up
    let now = due()
    if sent > now + Int64(Self.rate) { sent = now }
  }

  private func send(_ samples: ArraySlice<Float>) {
    var bytes = Data(count: samples.count * 2)
    bytes.withUnsafeMutableBytes { raw in
      let out = raw.bindMemory(to: Int16.self)
      for (i, s) in samples.enumerated() {
        out[i] = Int16(max(-1, min(1, s)) * 32767).littleEndian
      }
    }
    let json = "{\"computerAudio\":\"data\",\"pcm\":\"\(bytes.base64EncodedString())\"}"
    DispatchQueue.main.async { self.post(json) }
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .audio, timer != nil, sample.isValid,
          let format = sample.formatDescription?.audioStreamBasicDescription,
          format.mFormatFlags & kAudioFormatFlagIsFloat != 0, format.mBitsPerChannel == 32 else { return }
    let frames = CMSampleBufferGetNumSamples(sample)
    guard frames > 0 else { return }
    var mono = [Float](repeating: 0, count: frames)
    try? sample.withAudioBufferList { list, _ in
      // The channels averaged into one, whether in separate buffers or interleaved
      let buffers = max(1, list.count)
      for buffer in list {
        guard let data = buffer.mData else { continue }
        let channels = max(1, Int(buffer.mNumberChannels))
        let samples = data.assumingMemoryBound(to: Float.self)
        let count = min(Int(buffer.mDataByteSize) / 4 / channels, frames)
        let share = 1 / Float(buffers * channels)
        for f in 0..<count {
          var sum: Float = 0
          for c in 0..<channels { sum += samples[f * channels + c] }
          mono[f] += sum * share
        }
      }
    }
    pending.append(contentsOf: mono)
    flush()
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    DispatchQueue.main.async {
      guard self.stream === stream else { return }
      self.stream = nil
      self.queue.async { self.timer?.cancel(); self.timer = nil }
      self.tell(["computerAudio": "failed", "error": error.localizedDescription])
    }
  }
}
