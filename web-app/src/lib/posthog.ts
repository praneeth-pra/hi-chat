type PostHog = (typeof import('posthog-js'))['default']

/**
 * Runs `use` with PostHog, loading it first. Only builds given an analytics
 * key (POSTHOG_KEY and POSTHOG_HOST) use PostHog; without one it never runs,
 * so it isn't loaded at all. Calls keep their order: they wait on the same load.
 */
export function withPosthog(use: (posthog: PostHog) => void) {
  if (!POSTHOG_KEY || !POSTHOG_HOST) return
  void import('posthog-js').then((m) => use(m.default)).catch(() => {})
}
