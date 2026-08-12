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

/**
 * Applies `update` to the trailing assistant message. If the list has been cleared or its last
 * entry is not the streaming assistant placeholder (a stale response arriving after "New chat",
 * or any future race), the previous state is returned unchanged instead of throwing.
 */
function updateAssistantMessage(
  prev: ChatMessage[],
  update: (last: ChatMessage) => ChatMessage
): ChatMessage[] {
  const last = prev[prev.length - 1]
  if (!last || last.role !== 'assistant') return prev
  const next = [...prev]
  next[next.length - 1] = update(last)
  return next
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
  // Tracks the conversation id this component instance is currently using. Seeded from the
  // conversationId prop and updated synchronously whenever handleAttach/handleSend lazily
  // create a new conversation, so a second call in the same "prop hasn't re-rendered yet"
  // window reuses it instead of creating a duplicate conversation.
  const activeConversationIdRef = useRef<string | null>(conversationId)
  // Holds the in-flight POST /api/conversations promise while a conversation is being created
  // lazily. Set synchronously (before any await) by whichever caller starts the creation, so a
  // concurrent caller in the same window awaits the SAME promise rather than creating a second
  // conversation. Cleared on failure so a later attempt can retry.
  const conversationCreationRef = useRef<Promise<string> | null>(null)
  // The id of the conversation this component itself just created. While the prop is catching up
  // to it, the history effect must not refetch/overwrite the optimistic local state.
  const selfCreatedIdRef = useRef<string | null>(null)
  // Bumped whenever the conversation genuinely changes (sidebar switch / New chat). A stream
  // reader compares its captured value and drops any late chunks from an abandoned conversation.
  const streamGenerationRef = useRef(0)
  // Mirrors `sending` synchronously so the re-entrancy guard works even for two events fired
  // before React has re-rendered.
  const sendingRef = useRef(false)

  useEffect(() => {
    if (conversationId && conversationId === selfCreatedIdRef.current) {
      // This component created this conversation itself; the optimistic local state is already
      // correct and more complete than anything the server can return mid-stream. Do not fetch,
      // do not reset.
      activeConversationIdRef.current = conversationId
      return
    }

    // A real conversation change: abandon any in-flight stream and start clean.
    streamGenerationRef.current += 1
    selfCreatedIdRef.current = null
    conversationCreationRef.current = null
    activeConversationIdRef.current = conversationId

    if (!conversationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- necessary to clear state when conversation changes
      setMessages([])
      setAttachments([])
      setSessionTokens(0)
      setError(null)
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

  /**
   * Returns the conversation id to use, creating one lazily if this is still an unsaved chat.
   *
   * The check-and-set of `conversationCreationRef` happens synchronously, before any await, so
   * two concurrent callers (e.g. an upload and a send fired back-to-back) share one creation.
   */
  function ensureConversationId(): Promise<string> {
    const existing = activeConversationIdRef.current
    if (existing) return Promise.resolve(existing)

    const inFlight = conversationCreationRef.current
    if (inFlight) return inFlight

    const creation = (async () => {
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error?.message ?? 'Failed to start a new chat')

      const id: string = body.conversation.id
      activeConversationIdRef.current = id
      selfCreatedIdRef.current = id
      onConversationCreated(id)
      return id
    })()

    conversationCreationRef.current = creation
    creation.catch(() => {
      // Allow a retry after a failed creation instead of latching the rejected promise forever.
      if (conversationCreationRef.current === creation) conversationCreationRef.current = null
    })

    return creation
  }

  async function handleAttach(file: File) {
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setAttachments((prev) => [...prev, { id: tempId, filename: file.name, status: 'uploading' }])

    function failAttachment(message: string) {
      setAttachments((prev) => prev.map((a) => (a.id === tempId ? { ...a, status: 'error', error: message } : a)))
    }

    // Started synchronously so a send racing this upload joins the same creation.
    const conversationIdPromise = ensureConversationId()

    try {
      const targetConversationId = await conversationIdPromise

      const formData = new FormData()
      formData.append('file', file)
      formData.append('conversationId', targetConversationId)

      const response = await fetch('/api/documents', { method: 'POST', body: formData })
      const body = await response.json().catch(() => null)

      if (!response.ok) {
        failAttachment(body?.error?.message ?? 'Upload failed')
        return
      }

      setAttachments((prev) =>
        prev.map((a) => (a.id === tempId ? { id: body.documentId, filename: body.filename, status: 'done' } : a))
      )
    } catch {
      failAttachment('Upload failed')
    }
  }

  function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) handleAttach(file)
  }

  async function handleSend() {
    const userMessage = input
    // sendingRef mirrors `sending` synchronously: a second Enter pressed before React re-renders
    // (i.e. during the conversation-creation await) is rejected here rather than starting a
    // second send that would create a second conversation.
    if (!userMessage.trim() || sendingRef.current) return

    sendingRef.current = true
    setSending(true)
    setError(null)

    let activeConversationId: string
    try {
      activeConversationId = await ensureConversationId()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to start a new chat')
      sendingRef.current = false
      setSending(false)
      return
    }

    // Anything that switches conversation from here on invalidates this stream.
    const generation = streamGenerationRef.current
    const isCurrent = () => streamGenerationRef.current === generation

    setMessages((prev) => [...prev, { role: 'user', content: userMessage }, { role: 'assistant', content: '' }])
    setInput('')

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeConversationId, message: userMessage }),
      })

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null)
        if (isCurrent()) setError(body?.error?.message ?? 'Something went wrong')
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        // The user switched conversation / hit New chat: stop consuming and touch no state.
        if (!isCurrent()) {
          await reader.cancel().catch(() => {})
          return
        }

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
            if (isCurrent()) setError('The AI provider failed to respond. Please try again.')
            continue
          }

          if (event.delta) {
            const delta = event.delta
            setMessages((prev) => updateAssistantMessage(prev, (last) => ({ ...last, content: last.content + delta })))
          }

          if (event.done) {
            const tokenCount = event.tokenCount
            setMessages((prev) => updateAssistantMessage(prev, (last) => ({ ...last, tokenCount })))
            setSessionTokens((prev) => prev + (event.tokenCount ?? 0))
          }
        }
      }
    } catch {
      if (isCurrent()) setError('Something went wrong')
    } finally {
      sendingRef.current = false
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
