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

  async *completeStream(input: {
    systemPrompt?: string
    messages: { role: 'user' | 'assistant'; content: string }[]
  }): AsyncIterable<import('../application/ports').StreamChunk> {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set')

    // Timeout applies only to the initial connection (time to receive
    // response headers), not the full stream duration — SSE replies can
    // legitimately run longer than TIMEOUT_MS for long completions, but a
    // hung/never-connecting upstream would otherwise block forever.
    const controller = new AbortController()
    const connectTimeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            ...(input.systemPrompt ? [{ role: 'system', content: input.systemPrompt }] : []),
            ...input.messages,
          ],
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(connectTimeout)
    }

    if (!response.ok || !response.body) {
      throw new Error(`OpenRouter stream error: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullContent = ''
    let tokenCount = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') continue

        const json = JSON.parse(payload)
        const delta: string = json.choices?.[0]?.delta?.content ?? ''
        if (json.usage?.total_tokens) tokenCount = json.usage.total_tokens
        if (delta) {
          fullContent += delta
          yield { delta, done: false }
        }
      }
    }

    // Fallback if the provider never sent usage in the stream
    if (!tokenCount) tokenCount = Math.ceil(fullContent.length / 4)
    yield { delta: '', done: true, tokenCount }
  }
}
