import { ModelCapabilities } from '@/types/models'

/**
 * What the built-in providers' models can do. Only Groq and Cerebras are
 * built in; image questions go to each provider's vision model.
 */
const PROVIDER_MODELS: Record<
  string,
  { models: string[]; supportsImages: string[]; supportsToolCalls: string[] }
> = {
  groq: {
    models: [
      'openai/gpt-oss-120b',
      'meta-llama/llama-4-maverick-17b-128e-instruct',
      'meta-llama/llama-4-scout-17b-16e-instruct',
    ],
    supportsImages: [
      'meta-llama/llama-4-maverick-17b-128e-instruct',
      'meta-llama/llama-4-scout-17b-16e-instruct',
    ],
    supportsToolCalls: [],
  },
  cerebras: { models: ['gpt-oss-120b'], supportsImages: [], supportsToolCalls: [] },
}

export const defaultModel = (provider?: string) =>
  PROVIDER_MODELS[provider ?? '']?.models[0] ??
  PROVIDER_MODELS.groq.models[0]

/**
 * Determines model capabilities for a built-in provider's model
 * @param providerName - The provider name (e.g. 'groq', 'cerebras')
 * @param modelId - The model ID to check capabilities for
 * @returns Array of model capabilities
 */
export const getModelCapabilities = (
  providerName: string,
  modelId: string
): string[] => {
  const providerConfig = PROVIDER_MODELS[providerName]
  return [
    ModelCapabilities.COMPLETION,
    providerConfig?.supportsToolCalls.includes(modelId)
      ? ModelCapabilities.TOOLS
      : undefined,
    providerConfig?.supportsImages.includes(modelId)
      ? ModelCapabilities.VISION
      : undefined,
  ].filter(Boolean) as string[]
}

/**
 * This utility is to extract cortexso model description from README.md file
 * @returns
 */
export const extractDescription = (text?: string) => {
  if (!text) return text
  const normalizedText = removeYamlFrontMatter(text)
  const overviewPattern = /(?:##\s*Overview\s*\n)([\s\S]*?)(?=\n\s*##|$)/
  const matches = normalizedText?.match(overviewPattern)
  let extractedText =
    matches && matches[1]
      ? matches[1].trim()
      : normalizedText?.slice(0, 500).trim()

  // Remove image markdown syntax ![alt text](image-url)
  extractedText = extractedText?.replace(/!\[.*?\]\(.*?\)/g, '')

  // Remove <img> HTML tags
  extractedText = extractedText?.replace(/<img[^>]*>/g, '')

  return extractedText
}
/**
 * Remove YAML (HF metadata) front matter from content
 * @param content
 * @returns
 */
export const removeYamlFrontMatter = (content: string): string => {
  return content.replace(/^---\n([\s\S]*?)\n---\n/, '')
}

/**
 * Extract model name from repo path, e.g. cortexso/tinyllama -> tinyllama
 * @param modelId
 * @returns
 */
export const extractModelName = (model?: string) => {
  return model?.split('/')[1] ?? model
}

/**
 * Extract model name from repo path, e.g. https://huggingface.co/cortexso/tinyllama -> cortexso/tinyllama
 * @param modelId
 * @returns
 */
export const extractModelRepo = (model?: string) => {
  return model?.replace('https://huggingface.co/', '')
}
