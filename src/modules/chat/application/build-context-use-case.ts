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

  async execute(input: { userId: string; conversationId: string; documentId?: string }): Promise<string | null> {
    const texts = await this.lookup.listContentTexts(input.conversationId, input.userId)

    // The document-context selector (chat/page.tsx) lets a user pick any of
    // their own uploaded documents as extra context, independent of what's
    // attached to the current conversation. Append it if it isn't already
    // one of the conversation's own attached documents.
    if (input.documentId) {
      const explicitText = await this.lookup.getContentText(input.documentId, input.userId)
      if (explicitText && !texts.includes(explicitText)) {
        texts.push(explicitText)
      }
    }

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
