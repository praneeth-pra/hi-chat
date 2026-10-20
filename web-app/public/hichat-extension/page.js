// Runs inside Meet's page. Adds "Hi-chat remote camera" and "Hi-chat remote
// mic" to the devices Meet can pick, and answers Meet's requests for them
// with the remote laptop's camera and microphone, received over WebRTC.
// While this computer presents in Meet, it also sends the shared screen back
// to the remote laptop's /mirror, which shows it beside the conversation.
;(() => {
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
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
    pumps[kind] = reader
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ done: true }))
      if (done) return
      if (pumps[kind] !== reader) {
        value.close()
        return
      }
      await writers[kind].write(value).catch(() => value.close())
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
  let screenSender = null

  /** The mid of the offer's video section that /mirror receives on. */
  function screenMid(sdp) {
    for (const section of sdp.split(/\r?\nm=/).slice(1))
      if (section.startsWith('video') && /\na=recvonly/.test(section))
        return section.match(/\na=mid:(\S+)/)?.[1] ?? null
    return null
  }

  function sendScreen() {
    const track = shared?.copy ?? null
    screenSender?.replaceTrack(track).catch(() => {})
    send({ t: 'screen', on: !!track })
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
  }

  async function onSignal(m) {
    if (m.t === 'hello') ice = Array.isArray(m.ice) ? m.ice : []
    else if (m.t === 'sender' && !m.on) closePeer()
    else if (m.t === 'offer') {
      closePeer()
      const peer = new RTCPeerConnection({ iceServers: ice })
      pc = peer
      peer.onicecandidate = (e) =>
        send({ t: 'ice', candidate: e.candidate ? e.candidate.toJSON() : null })
      const mid = screenMid(m.sdp)
      peer.ontrack = (e) => {
        if (pc !== peer) return
        // The screen lane brings nothing in; never let it replace the camera
        if (mid !== null && e.transceiver?.mid === mid) return
        pump(e.track.kind, e.track)
        if (e.track.kind === 'audio') {
          sink.srcObject = new MediaStream([e.track])
          playSink()
        }
      }
      await peer.setRemoteDescription({ type: 'offer', sdp: m.sdp })
      const lane =
        mid === null
          ? null
          : peer.getTransceivers().find((t) => t.mid === mid)
      if (lane) {
        lane.direction = 'sendonly'
        screenSender = lane.sender
      }
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      send({ t: 'answer', sdp: answer.sdp })
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
