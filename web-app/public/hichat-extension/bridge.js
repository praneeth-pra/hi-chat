// Passes messages between page.js (in Meet's page) and background.js.
let port = null

function open() {
  port = chrome.runtime.connect({ name: 'hichat-camera' })
  port.onMessage.addListener((data) =>
    document.dispatchEvent(
      new CustomEvent('hichat-camera-in', { detail: String(data) })
    )
  )
  port.onDisconnect.addListener(() => {
    port = null
    // The page starts over on the next connection
    document.dispatchEvent(
      new CustomEvent('hichat-camera-in', {
        detail: JSON.stringify({ t: 'sender', on: false }),
      })
    )
    setTimeout(open, 1000)
  })
}

document.addEventListener('hichat-camera-out', (e) => {
  const data = String(e.detail)
  if (data === '{"t":"start"}') {
    if (!port) open()
    return
  }
  if (port) port.postMessage(data)
})
