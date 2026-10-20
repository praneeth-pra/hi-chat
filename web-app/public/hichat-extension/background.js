// Holds the connection to Hi-chat for each Meet tab that uses the remote
// camera. It only passes connection-setup messages; the video and sound go
// directly from the remote laptop to the Meet tab.
importScripts('config.js')

const { site, key } = self.HICHAT_CAMERA

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'hichat-camera') return
  let ws = null
  let closed = false
  let retryMs = 1000
  let retry
  // This tab's id for the whole call: reconnecting with it, the camera page
  // knows the tab and keeps the camera and sound flowing through the blip
  const vid = crypto.randomUUID()
  const url =
    site.replace(/^http/, 'ws').replace(/\/$/, '') +
    '/api/camera?role=view&key=' +
    encodeURIComponent(key) +
    '&vid=' +
    vid

  const connect = () => {
    if (closed) return
    const socket = new WebSocket(url)
    ws = socket
    socket.onopen = () => {
      retryMs = 1000
    }
    socket.onmessage = (e) => port.postMessage(String(e.data))
    socket.onclose = () => {
      if (ws !== socket || closed) return
      ws = null
      // The media goes directly between the browsers, so losing this
      // socket doesn't stop it: the page only hears "sender off" from Hi-chat
      retry = setTimeout(connect, retryMs)
      retryMs = Math.min(retryMs * 2, 8000)
    }
  }
  // Keeps the socket (and this worker) alive
  const ping = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send('{"t":"ping"}')
  }, 20000)

  port.onMessage.addListener((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(String(data))
  })
  port.onDisconnect.addListener(() => {
    closed = true
    clearInterval(ping)
    clearTimeout(retry)
    if (ws) ws.close()
  })
  connect()
})
