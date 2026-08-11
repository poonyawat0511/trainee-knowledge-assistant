import type { AiProvider } from '../application/ports'

const MODEL = 'meta-llama/llama-3.1-8b-instruct:free'
const TIMEOUT_MS = 30_000

/** Thrown when OpenRouter responds with a non-2xx status. Never retried — a
 * 4xx/5xx will not succeed on retry, so retrying only doubles latency. */
class HttpStatusError extends Error {}

export class OpenRouterProvider implements AiProvider {
  async complete(input: {
    systemPrompt?: string
    messages: { role: 'user' | 'assistant'; content: string }[]
  }): Promise<{ content: string; tokenCount: number }> {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set')

    const body = {
      model: MODEL,
      messages: [
        ...(input.systemPrompt ? [{ role: 'system', content: input.systemPrompt }] : []),
        ...input.messages,
      ],
    }

    const attempt = () => this.callOnce(apiKey, body)

    try {
      return await attempt()
    } catch (error) {
      if (error instanceof HttpStatusError) throw error
      // one retry on genuine network failure (fetch rejection, timeout abort, etc.)
      return await attempt()
    }
  }

  private async callOnce(
    apiKey: string,
    body: unknown
  ): Promise<{ content: string; tokenCount: number }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new HttpStatusError(`OpenRouter error: ${response.status}`)
      }

      const data = await response.json()
      const content: string = data.choices?.[0]?.message?.content ?? ''
      const tokenCount: number = data.usage?.total_tokens ?? Math.ceil(content.length / 4)

      return { content, tokenCount }
    } finally {
      clearTimeout(timeout)
    }
  }
}
