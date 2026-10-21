// Runs inside the call page (Google Meet, Microsoft Teams or Zoom in the
// browser). Adds "Hi-chat remote camera" and "Hi-chat remote mic" to the
// devices the call can pick, and answers its requests for them
// with the remote laptop's camera and microphone, received over WebRTC.
// While this computer presents in Meet, it also sends the shared screen back
// to the remote laptop's /mirror, which shows it beside the conversation,
// and it always sends the call's sound (the other participants) there too.
;(() => {
  // Only one copy may run: with the extension loaded twice, both would answer
  // each other's connections and neither camera nor screen would come through
  const root = document.documentElement
  if (root.dataset.hichatCameraPage) return
  root.dataset.hichatCameraPage = '1'
  const CAM = 'hichat-remote-camera'
  const MIC = 'hichat-remote-mic'
  const GROUP = 'hichat-remote'
  const LABELS = { [CAM]: 'Hi-chat remote camera', [MIC]: 'Hi-chat remote mic' }
  const md = navigator.mediaDevices
  if (!md || typeof MediaStreamTrackGenerator !== 'function') return

  const realEnumerate = md.enumerateDevices.bind(md)
  const realGetUserMedia = md.getUserMedia.bind(md)
  const realGetDisplayMedia = md.getDisplayMedia?.bind(md)

  // Meet keeps these tracks for the whole call. Frames from whichever remote
  // connection is current are copied into them, so a reconnect doesn't end
  // the tracks Meet holds.
  const out = {
    video: new MediaStreamTrackGenerator({ kind: 'video' }),
    audio: new MediaStreamTrackGenerator({ kind: 'audio' }),
  }
  const writers = {
    video: out.video.writable.getWriter(),
    audio: out.audio.writable.getWriter(),
  }
  const pumps = { video: null, audio: null }

  async function pump(kind, track) {
    pumps[kind]?.cancel().catch(() => {})
    // A short queue: a frame that would wait behind another is late already
    const reader = new MediaStreamTrackProcessor({
      track,
      maxBufferSize: kind === 'video' ? 1 : undefined,
    }).readable.getReader()
    pumps[kind] = reader
    let writing = null
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ done: true }))
      if (done) return
      if (pumps[kind] !== reader) {
        value.close()
        return
      }
      if (kind === 'audio') {
        await writers.audio.write(value).catch(() => value.close())
        continue
      }
      // Video: while Meet is still taking the last frame, this one is
      // dropped rather than queued, so the picture never falls behind
      if (writing) {
        value.close()
        continue
      }
      writing = writers.video
        .write(value)
        .catch(() => value.close())
        .finally(() => (writing = null))
    }
  }

  // Remote audio only flows once something plays it. This element also lets
  // you hear the remote speaker on this computer, as Meet never plays your own
  // mic back to you. (Meant for laptops in different places: in one room the
  // remote mic would pick this up and echo it into the call.)
  const sink = new Audio()
  // Chrome may block sound until the page has been clicked; play on the next
  // click or key press then
  const playSink = () =>
    sink.play().catch(() => {
      const retry = () => {
        removeEventListener('pointerdown', retry, true)
        removeEventListener('keydown', retry, true)
        sink.play().catch(() => {})
      }
      addEventListener('pointerdown', retry, true)
      addEventListener('keydown', retry, true)
    })

  const send = (m) =>
    document.dispatchEvent(
      new CustomEvent('hichat-camera-out', { detail: JSON.stringify(m) })
    )

  let started = false
  let ice = []
  let pc = null

  // The screen being presented: Meet's own track, and the copy sent to
  // /mirror. The offer from /mirror has one video lane coming this way (the
  // only m-section it receives on); the shared screen goes out on it.
  let shared = null // { source, copy }
  const SCREEN_BITRATE = 2_500_000
  let screenSender = null

  /** The mid of the offer's `kind` section that /mirror receives on. */
  function laneMid(sdp, kind) {
    for (const section of sdp.split(/\r?\nm=/).slice(1))
      if (section.startsWith(kind) && /\na=recvonly/.test(section))
        return section.match(/\na=mid:(\S+)/)?.[1] ?? null
    return null
  }

  // The call's sound: every audio track Meet receives (the other
  // participants) mixed into one, for /mirror. Meet's own connections are
  // watched by wrapping RTCPeerConnection before Meet's code runs; ours uses
  // the real one, so the remote mic never comes back in the mix.
  const RealPeerConnection = window.RTCPeerConnection
  let mix = null // { ctx, out, sources }
  let callSender = null

  function callMix() {
    if (mix) return mix
    const ctx = new AudioContext()
    mix = { ctx, out: ctx.createMediaStreamDestination(), sources: new Map() }
    // Chrome starts audio only after a click on the page
    const resume = () =>
      ctx.state === 'suspended' && ctx.resume().catch(() => {})
    addEventListener('pointerdown', resume, true)
    addEventListener('keydown', resume, true)
    resume()
    return mix
  }

  function addCallAudio(track) {
    const m = callMix()
    if (m.sources.has(track.id)) return
    const stream = new MediaStream([track])
    const source = m.ctx.createMediaStreamSource(stream)
    source.connect(m.out)
    // Chrome only lets a call's track into Web Audio while something plays
    // it; a muted element does, without a second copy of the sound here
    const keep = new Audio()
    keep.muted = true
    keep.srcObject = stream
    keep.play().catch(() => {})
    m.sources.set(track.id, { source, keep })
    track.addEventListener('ended', () => {
      source.disconnect()
      keep.srcObject = null
      m.sources.delete(track.id)
    })
    sendCall()
  }

  function sendCall() {
    if (!callSender || !mix) return
    callSender.replaceTrack(mix.out.stream.getAudioTracks()[0]).catch(() => {})
  }

  if (RealPeerConnection) {
    class WatchedPeerConnection extends RealPeerConnection {
      constructor(...args) {
        super(...args)
        this.addEventListener('track', (e) => {
          if (e.track.kind === 'audio') addCallAudio(e.track)
        })
      }
    }
    window.RTCPeerConnection = WatchedPeerConnection
    if (window.webkitRTCPeerConnection)
      window.webkitRTCPeerConnection = WatchedPeerConnection
  }

  function sendScreen() {
    const track = shared?.copy ?? null
    const lane = screenSender
    send({ t: 'screen', on: !!track })
    if (!lane) return
    lane
      .replaceTrack(track)
      .then(() => {
        if (!track) return
        // A steady bitrate from the start, so the first picture isn't starved
        const params = lane.getParameters()
        params.encodings = params.encodings?.length ? params.encodings : [{}]
        params.encodings[0].maxBitrate = SCREEN_BITRATE
        params.degradationPreference = 'maintain-resolution'
        return lane.setParameters(params)
      })
      .catch(() => {})
  }

  function stopSharing() {
    if (!shared) return
    shared.copy.stop()
    shared = null
    sendScreen()
  }

  // Meet ends a presentation by stopping its track, which fires no event, and
  // Chrome's "Stop sharing" ends it at the source; either way it reads ended
  setInterval(() => {
    if (shared && shared.source.readyState === 'ended') stopSharing()
  }, 500)

  function closePeer() {
    pc?.close()
    pc = null
    screenSender = null
    callSender = null
  }

  async function onSignal(m) {
    if (m.t === 'hello') ice = Array.isArray(m.ice) ? m.ice : []
    // The camera page lost Hi-chat's server: a connection that is up keeps
    // going (the media doesn't pass through the server), and ends on its own
    // if the page is really gone
    else if (m.t === 'sender' && !m.on) {
      if (pc?.connectionState !== 'connected') closePeer()
    } else if (m.t === 'offer') {
      closePeer()
      const peer = new RealPeerConnection({ iceServers: ice })
      pc = peer
      peer.onconnectionstatechange = () => {
        // The camera page offers again when it sees this fail too
        if (pc === peer && peer.connectionState === 'failed') closePeer()
      }
      peer.onicecandidate = (e) =>
        send({ t: 'ice', candidate: e.candidate ? e.candidate.toJSON() : null })
      const mid = laneMid(m.sdp, 'video')
      const callMid = laneMid(m.sdp, 'audio')
      peer.ontrack = (e) => {
        if (pc !== peer) return
        // The lanes to /mirror bring nothing in; never let them replace the
        // remote camera or mic
        const at = e.transceiver?.mid
        if (at != null && (at === mid || at === callMid)) return
        pump(e.track.kind, e.track)
        if (e.track.kind === 'audio') {
          sink.srcObject = new MediaStream([e.track])
          playSink()
        }
      }
      await peer.setRemoteDescription({ type: 'offer', sdp: m.sdp })
      const lane =
        mid === null ? null : peer.getTransceivers().find((t) => t.mid === mid)
      if (lane) {
        lane.direction = 'sendonly'
        screenSender = lane.sender
      }
      const call =
        callMid === null
          ? null
          : peer.getTransceivers().find((t) => t.mid === callMid)
      if (call) {
        call.direction = 'sendonly'
        callSender = call.sender
      }
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      send({ t: 'answer', sdp: answer.sdp })
      // The call's sound, if any has arrived yet (more joins the mix later)
      sendCall()
      // Presenting already: the new connection carries the screen too
      if (screenSender) {
        if (shared) sendScreen()
        else send({ t: 'screen', on: false })
      }
    } else if (m.t === 'ice' && pc) {
      await pc.addIceCandidate(m.candidate ?? null).catch(() => {})
    }
  }

  // One message at a time, so candidates never arrive before their offer
  let queue = Promise.resolve()
  document.addEventListener('hichat-camera-in', (e) => {
    let m
    try {
      m = JSON.parse(String(e.detail))
    } catch {
      return
    }
    queue = queue.then(() => onSignal(m)).catch(() => {})
  })

  function start() {
    if (started) return
    started = true
    send({ t: 'start' })
  }

  // A track Meet can treat like a device's: its settings name our device
  function deviceTrack(kind, id) {
    const track = out[kind].clone()
    const settings = track.getSettings.bind(track)
    Object.defineProperties(track, {
      label: { value: LABELS[id] },
      getSettings: {
        value: () => ({ ...settings(), deviceId: id, groupId: GROUP }),
      },
      getCapabilities: { value: () => ({ deviceId: id, groupId: GROUP }) },
      applyConstraints: { value: () => Promise.resolve() },
    })
    return track
  }

  const device = (deviceId, kind) => {
    const info = { deviceId, kind, label: LABELS[deviceId], groupId: GROUP }
    return { ...info, toJSON: () => info }
  }

  /** Whether a constraint asks for device `id`. */
  function asksFor(c, id) {
    if (!c || typeof c !== 'object') return false
    const d = c.deviceId
    const ids = []
    for (const v of [d, d?.exact, d?.ideal])
      if (typeof v === 'string') ids.push(v)
      else if (Array.isArray(v)) ids.push(...v)
    return ids.includes(id)
  }

  md.enumerateDevices = async function () {
    const list = await realEnumerate()
    return [...list, device(MIC, 'audioinput'), device(CAM, 'videoinput')]
  }

  // Presenting: Meet gets the screen as usual, and /mirror gets a copy
  if (realGetDisplayMedia)
    md.getDisplayMedia = async function (...args) {
      const stream = await realGetDisplayMedia(...args)
      const source = stream.getVideoTracks()[0]
      if (source) {
        stopSharing()
        const copy = source.clone()
        copy.contentHint = 'detail'
        // A whole Mac screen is ~3000px wide: too much to start a fresh
        // connection with. 1080p at 15 fps reads well on /mirror
        await copy
          .applyConstraints({
            width: { max: 1920 },
            height: { max: 1080 },
            frameRate: { max: 15 },
          })
          .catch(() => {})
        shared = { source, copy }
        start()
        sendScreen()
      }
      return stream
    }

  md.getUserMedia = async function (constraints = {}) {
    const video = asksFor(constraints.video, CAM)
    const audio = asksFor(constraints.audio, MIC)
    if (!video && !audio) return realGetUserMedia(constraints)
    start()
    const tracks = []
    const rest = {
      video: video ? false : (constraints.video ?? false),
      audio: audio ? false : (constraints.audio ?? false),
    }
    if (rest.video || rest.audio)
      tracks.push(...(await realGetUserMedia(rest)).getTracks())
    if (video) tracks.push(deviceTrack('video', CAM))
    if (audio) tracks.push(deviceTrack('audio', MIC))
    return new MediaStream(tracks)
  }
})()
