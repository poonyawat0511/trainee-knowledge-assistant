'use client'

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  tokenCount?: number
}

export function ChatWindow({
  conversationId,
  documentId,
}: {
  conversationId: string | null
  documentId: string | null
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionTokens, setSessionTokens] = useState(0)

  useEffect(() => {
    if (!conversationId) return

    let cancelled = false

    fetch(`/api/conversations/${conversationId}/messages`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        const loaded: ChatMessage[] = body.messages ?? []
        setMessages(loaded)
        setSessionTokens(loaded.reduce((sum, m) => sum + (m.tokenCount ?? 0), 0))
        setError(null)
      })
      .catch(() => {
        if (cancelled) return
        setMessages([])
        setSessionTokens(0)
        setError('Failed to load conversation history')
      })

    return () => {
      cancelled = true
    }
  }, [conversationId])

  async function handleSend() {
    if (!input.trim() || !conversationId) return

    const userMessage = input
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }, { role: 'assistant', content: '' }])
    setInput('')
    setSending(true)
    setError(null)

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message: userMessage, documentId: documentId ?? undefined }),
      })

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null)
        setError(body?.error?.message ?? 'Something went wrong')
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data:')) continue

          let event: { error?: string; delta?: string; done?: boolean; tokenCount?: number }
          try {
            event = JSON.parse(line.slice(5).trim())
          } catch {
            continue
          }

          if (event.error) {
            setError('The AI provider failed to respond. Please try again.')
            continue
          }

          if (event.delta) {
            setMessages((prev) => {
              const next = [...prev]
              next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + event.delta }
              return next
            })
          }

          if (event.done) {
            setMessages((prev) => {
              const next = [...prev]
              next[next.length - 1] = { ...next[next.length - 1], tokenCount: event.tokenCount }
              return next
            })
            setSessionTokens((prev) => prev + (event.tokenCount ?? 0))
          }
        }
      }
    } catch {
      setError('Something went wrong')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b p-3 text-sm text-gray-600">
        <span>{documentId ? 'Chatting about uploaded document' : 'General chat'}</span>
        <span>Session tokens: {sessionTokens}</span>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div
              className={`inline-block max-w-lg rounded-lg px-3 py-2 text-sm ${
                m.role === 'user' ? 'bg-black text-white' : 'bg-gray-100'
              }`}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              {m.tokenCount !== undefined && (
                <div className="mt-1 text-xs opacity-60">{m.tokenCount} tokens</div>
              )}
            </div>
          </div>
        ))}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="flex gap-2 border-t p-3">
        <input
          className="flex-1 rounded border px-3 py-2 text-sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask something…"
          disabled={!conversationId || sending}
        />
        <button
          onClick={handleSend}
          disabled={!conversationId || sending}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
