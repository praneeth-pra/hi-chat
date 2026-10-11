/** Browser POSTs must originate at this host. Non-browser clients may omit Origin. */
export function sameOriginRequest(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const url = new URL(origin)
    const expected = new URL(`${url.protocol}//${req.headers.host ?? ''}`)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.origin === expected.origin &&
      url.origin === origin &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}
