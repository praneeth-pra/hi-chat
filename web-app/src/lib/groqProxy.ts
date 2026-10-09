import { isPlatformTauri } from '@/lib/platform/utils'

const GROQ_ORIGIN = 'https://api.groq.com'
/** nginx forwards this path to api.groq.com (see nginx.conf). */
export const GROQ_PROXY_PATH = '/api/groq'

/**
 * In the web app, Groq URLs point at this site's own server, which forwards
 * the request unchanged, API key included. Safari's connections to Groq
 * sometimes stall: a request failed with "Load failed" after 15 s and its
 * retry waited 43 s before Groq even saw it, while Groq itself answered in
 * under a second. groqFetch below tries api.groq.com directly first and
 * falls back to this server when the direct route is slow.
 */
export function viaGroqProxy(
  url: string | undefined,
  enabled = !isPlatformTauri() && typeof window !== 'undefined'
): string | undefined {
  if (!enabled || !url?.startsWith(GROQ_ORIGIN)) return url
  return `${window.location.origin}${GROQ_PROXY_PATH}${url.slice(GROQ_ORIGIN.length)}`
}

/** How long the direct route gets to start replying before the server joins. */
export const GROQ_HEDGE_MS = 1000

type GroqRoute = 'direct' | 'server'
const routes = new WeakMap<Response, GroqRoute>()

/** Which route a Groq response came back on, for the reply's info dialog. */
export const groqRoute = (res: Response) => routes.get(res)

/**
 * Sends a Groq request straight to api.groq.com first, which skips the trip
 * through this site's server. If Groq hasn't started replying within
 * GROQ_HEDGE_MS, or the direct request fails, the same request also goes
 * through the server (the Safari stall above); the first to reply is used
 * and the other is cancelled. Anything that isn't a proxied Groq URL is
 * fetched as usual.
 */
export function groqFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  base: typeof fetch = fetch,
  hedgeMs = GROQ_HEDGE_MS
): Promise<Response> {
  const prefix =
    typeof window !== 'undefined'
      ? `${window.location.origin}${GROQ_PROXY_PATH}/`
      : undefined
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : undefined
  if (!prefix || !url?.startsWith(prefix)) return base(input, init)
  const routeUrls: Record<GroqRoute, string> = {
    direct: `${GROQ_ORIGIN}/${url.slice(prefix.length)}`,
    server: url,
  }

  return new Promise((resolve, reject) => {
    const outer = init?.signal
    const controllers: AbortController[] = []
    let settled = false
    let running = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const start = (route: GroqRoute) => {
      const own = new AbortController()
      controllers.push(own)
      running++
      if (outer?.aborted) own.abort(outer.reason)
      outer?.addEventListener('abort', () => own.abort(outer.reason), {
        once: true,
      })
      base(routeUrls[route], { ...init, signal: own.signal }).then(
        (res) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          controllers.forEach((c) => c !== own && c.abort())
          routes.set(res, route)
          resolve(res)
        },
        (err) => {
          running--
          if (settled) return
          // The direct route failed before the server joined: join now
          if (
            route === 'direct' &&
            controllers.length === 1 &&
            !outer?.aborted
          ) {
            clearTimeout(timer)
            start('server')
            return
          }
          if (running === 0) {
            settled = true
            reject(err)
          }
        }
      )
    }

    start('direct')
    timer = setTimeout(() => {
      if (!settled && controllers.length === 1) start('server')
    }, hedgeMs)
  })
}

/** A fetch that sends proxied Groq requests direct-first (see groqFetch). */
export const withGroqHedge =
  (base: typeof fetch): typeof fetch =>
  (input, init) =>
    groqFetch(input, init, base)
