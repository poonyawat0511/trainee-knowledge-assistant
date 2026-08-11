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

  async execute(input: { userId: string; documentId?: string }): Promise<string | null> {
    if (!input.documentId) return null

    const text = await this.lookup.getContentText(input.documentId, input.userId)
    if (!text) return null

    const truncated = text.length > this.maxChars ? text.slice(0, this.maxChars) : text

    return [
      'You are a helpful assistant answering questions about the following document.',
      'Only use information from the document below; say so if the answer is not in it.',
      '---',
      truncated,
      '---',
    ].join('\n')
  }
}
