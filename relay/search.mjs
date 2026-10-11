// Optional web evidence. The Exa key is used only here, never returned to clients.
export async function searchWeb(
  query,
  { env = process.env, fetchImpl = fetch, signal, timeoutMs = 4500 } = {}
) {
  if (typeof query !== 'string' || !query.trim() || query.length > 4000)
    throw Object.assign(
      new Error('Provide a search query of 1–4000 characters.'),
      { status: 400 }
    )
  if (!env.EXA_API_KEY) return { status: 'unconfigured', sources: [] }
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  let rejectAbort
  const cancelled = new Promise((_, reject) => {
    rejectAbort = reject
  })
  const cancel = () => rejectAbort(controller.signal.reason)
  controller.signal.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(
    () => controller.abort(new Error('Search timed out')),
    timeoutMs
  )
  try {
    if (controller.signal.aborted) throw controller.signal.reason
    const operation = (async () => {
      const response = await fetchImpl('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.EXA_API_KEY,
        },
        signal: controller.signal,
        body: JSON.stringify({
          query: query.trim(),
          type: 'auto',
          numResults: 5,
          contents: { text: { maxCharacters: 2500 } },
        }),
      })
      if (!response.ok || !response.body)
        throw new Error('Search provider unavailable')
      const reader = response.body.getReader()
      const chunks = []
      let bytes = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 512 * 1024) {
          await reader.cancel()
          throw new Error('Search response too large')
        }
        chunks.push(Buffer.from(value))
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const sources = (Array.isArray(data.results) ? data.results : [])
        .slice(0, 5)
        .flatMap((result) => {
          try {
            const url = new URL(result.url)
            if (
              !['http:', 'https:'].includes(url.protocol) ||
              url.username ||
              url.password ||
              typeof result.text !== 'string' ||
              !result.text.trim()
            )
              return []
            return [
              {
                url: url.href,
                title: String(result.title ?? url.hostname).slice(0, 200),
                text: String(result.text ?? '').slice(0, 2500),
                publishedDate: String(result.publishedDate ?? '').slice(0, 50),
              },
            ]
          } catch {
            return []
          }
        })
      return { status: sources.length ? 'ready' : 'empty', sources }
    })()
    return await Promise.race([operation, cancelled])
  } catch {
    return { status: 'unavailable', sources: [] }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    controller.signal.removeEventListener('abort', cancel)
  }
}
