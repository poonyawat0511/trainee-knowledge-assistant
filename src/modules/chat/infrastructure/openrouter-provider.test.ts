import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenRouterProvider } from './openrouter-provider'

describe('OpenRouterProvider', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key'
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('parses a successful completion', async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hi there' } }],
          usage: { total_tokens: 7 },
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch

    const provider = new OpenRouterProvider()
    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })

    expect(result).toEqual({ content: 'hi there', tokenCount: 7 })
  })

  it('throws when the API responds with an error status', async () => {
    global.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch

    const provider = new OpenRouterProvider()
    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow()
  })

  it('does not retry on an HTTP error status', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }))
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new OpenRouterProvider()
    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries once on a 429 rate-limit status and succeeds', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'hi there' } }],
            usage: { total_tokens: 7 },
          }),
          { status: 200 }
        )
      )
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new OpenRouterProvider()
    const resultPromise = provider.complete({ messages: [{ role: 'user', content: 'hi' }] })
    await vi.advanceTimersByTimeAsync(1500)
    const result = await resultPromise

    expect(result).toEqual({ content: 'hi there', tokenCount: 7 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry on a permanent 4xx status like 400', async () => {
    const fetchMock = vi.fn(async () => new Response('bad request', { status: 400 }))
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new OpenRouterProvider()
    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries once on a genuine network failure', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'hi there' } }],
            usage: { total_tokens: 7 },
          }),
          { status: 200 }
        )
      )
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new OpenRouterProvider()
    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })

    expect(result).toEqual({ content: 'hi there', tokenCount: 7 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
