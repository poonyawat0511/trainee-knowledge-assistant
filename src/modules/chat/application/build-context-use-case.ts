import type { DocumentTextLookup } from './ports'

export class BuildContextUseCase {
  private readonly maxChars: number

  constructor(
    private readonly lookup: DocumentTextLookup,
    options: { maxChars?: number } = {}
  ) {
    // ~4 chars/token, budget ~3000 tokens for context by default
    this.maxChars = options.maxChars ?? 12_000
  }

  async execute(input: { userId: string; conversationId: string }): Promise<string | null> {
    const texts = await this.lookup.listContentTexts(input.conversationId, input.userId)
    if (texts.length === 0) return null

    const combined = texts.join('\n\n---\n\n')
    const truncated = combined.length > this.maxChars ? combined.slice(0, this.maxChars) : combined

    return [
      'You are a helpful assistant answering questions about the following document(s).',
      'Only use information from the document(s) below; say so if the answer is not in them.',
      '---',
      truncated,
      '---',
    ].join('\n')
  }
}
