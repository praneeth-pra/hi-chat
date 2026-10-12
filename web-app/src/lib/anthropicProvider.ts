const DEFAULT_BASE = 'https://api.anthropic.com'

/**
 * The Anthropic key and base URL for the Claude judges. The web build has no
 * built-in Anthropic provider, so a provider added by hand counts too when
 * its base URL is Anthropic's or its name says Claude or Anthropic.
 */
export function anthropicConfig(providers: ModelProvider[]): {
  apiKey?: string
  baseUrl?: string
} {
  const isAnthropicUrl = (p: ModelProvider) => {
    try {
      const url = new URL(p.base_url ?? '')
      return (
        url.origin === DEFAULT_BASE &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        ['/', '/v1', '/v1/'].includes(url.pathname)
      )
    } catch {
      return false
    }
  }
  const withKey = providers.filter((p) => !!p.api_key)
  const provider =
    withKey.find((p) => p.provider === 'anthropic') ??
    withKey.find(isAnthropicUrl) ??
    withKey.find((p) => /claude|anthropic/i.test(p.provider))
  if (!provider) return {}
  return {
    apiKey: provider.api_key,
    baseUrl: isAnthropicUrl(provider) ? provider.base_url : DEFAULT_BASE,
  }
}
