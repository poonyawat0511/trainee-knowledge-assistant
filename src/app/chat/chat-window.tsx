'use client'

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  tokenCount?: number
}

interface Attachment {
  id: string
  filename: string
  status: 'uploading' | 'done' | 'error'
  error?: string
}

export function ChatWindow({
  conversationId,
  onConversationCreated,
}: {
  conversationId: string | null
  onConversationCreated: (id: string) => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionTokens, setSessionTokens] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!conversationId) {
      setMessages([])
      setAttachments([])
      setSessionTokens(0)
      return
    }

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

    fetch(`/api/documents?conversationId=${conversationId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        const docs: { id: string; filename: string }[] = body.documents ?? []
        setAttachments(docs.map((d) => ({ id: d.id, filename: d.filename, status: 'done' as const })))
      })
      .catch(() => {
        if (cancelled) return
        setAttachments([])
      })

    return () => {
      cancelled = true
    }
  }, [conversationId])

  async function handleAttach(file: File) {
    const tempId = `pending-${Date.now()}`
    setAttachments((prev) => [...prev, { id: tempId, filename: file.name, status: 'uploading' }])

    const formData = new FormData()
    formData.append('file', file)
    if (conversationId) formData.append('conversationId', conversationId)

    try {
      const response = await fetch('/api/documents', { method: 'POST', body: formData })
      const body = await response.json()

      if (!response.ok) {
        setAttachments((prev) =>
          prev.map((a) => (a.id === tempId ? { ...a, status: 'error', error: body.error?.message ?? 'Upload failed' } : a))
        )
        return
      }

      if (!conversationId) onConversationCreated(body.conversationId)

      setAttachments((prev) =>
        prev.map((a) => (a.id === tempId ? { id: body.documentId, filename: body.filename, status: 'done' } : a))
      )
    } catch {
      setAttachments((prev) => prev.map((a) => (a.id === tempId ? { ...a, status: 'error', error: 'Upload failed' } : a)))
    }
  }

  function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) handleAttach(file)
  }

  async function handleSend() {
    if (!input.trim() || sending) return

    let activeConversationId = conversationId
    if (!activeConversationId) {
      try {
        const response = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        const body = await response.json()
        if (!response.ok) {
          setError(body.error?.message ?? 'Failed to start a new chat')
          return
        }
        activeConversationId = body.conversation.id
        onConversationCreated(activeConversationId!)
      } catch {
        setError('Failed to start a new chat')
        return
      }
    }

    const userMessage = input
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }, { role: 'assistant', content: '' }])
    setInput('')
    setSending(true)
    setError(null)

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeConversationId, message: userMessage }),
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
        <span>{conversationId ? 'Chat' : 'New chat'}</span>
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

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t px-3 pt-2">
          {attachments.map((a) => (
            <span
              key={a.id}
              className={`rounded-full border px-2 py-1 text-xs ${
                a.status === 'error' ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-300 bg-gray-50 text-gray-700'
              }`}
              title={a.error}
            >
              📎 {a.filename}
              {a.status === 'uploading' && '…'}
              {a.status === 'error' && ' (failed)'}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2 border-t p-3">
        <input ref={fileInputRef} type="file" accept=".pdf,.txt" className="hidden" onChange={handleFileInputChange} />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          className="rounded border px-3 py-2 text-sm disabled:opacity-50"
          title="Attach a PDF or TXT file"
        >
          📎
        </button>
        <input
          className="flex-1 rounded border px-3 py-2 text-sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask something…"
          disabled={sending}
        />
        <button
          onClick={handleSend}
          disabled={sending}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
