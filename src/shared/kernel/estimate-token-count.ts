/** Rough token estimate (~4 characters per token) for text without a round-trip to the AI provider. */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}
