// Passes messages between page.js (in the call's page) and background.js.
// Only one copy may run, as with page.js; a second would relay every message twice.
;(() => {
  if (document.documentElement.dataset.hichatCameraBridge) return
  document.documentElement.dataset.hichatCameraBridge = '1'
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
})()
