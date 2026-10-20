// Splits a reply's text into its reasoning ("thinking") and its answer, as
// Hi-chat's chat shows them (ThreadContent) and so does the mirror.

export function splitReasoning(text: string): {
  reasoningSegment: string | undefined
  textSegment: string
} {
  // Check for thinking formats
  const hasThinkTag = text.includes('<think>') && !text.includes('</think>')
  const hasAnalysisChannel =
    text.includes('<|channel|>analysis<|message|>') &&
    !text.includes('<|start|>assistant<|channel|>final<|message|>')

  if (hasThinkTag || hasAnalysisChannel)
    return { reasoningSegment: text, textSegment: '' }

  // Check for completed think tag format
  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/)
  if (thinkMatch?.index !== undefined) {
    const splitIndex = thinkMatch.index + thinkMatch[0].length
    return {
      reasoningSegment: text.slice(0, splitIndex),
      textSegment: text.slice(splitIndex),
    }
  }

  // Check for completed analysis channel format
  const analysisMatch = text.match(
    /<\|channel\|>analysis<\|message\|>([\s\S]*?)<\|start\|>assistant<\|channel\|>final<\|message\|>/
  )
  if (analysisMatch?.index !== undefined) {
    const splitIndex = analysisMatch.index + analysisMatch[0].length
    return {
      reasoningSegment: text.slice(0, splitIndex),
      textSegment: text.slice(splitIndex),
    }
  }

  return { reasoningSegment: undefined, textSegment: text }
}
