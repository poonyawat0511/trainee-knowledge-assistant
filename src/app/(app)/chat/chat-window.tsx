'use client'

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { estimateTokenCount } from '@/shared/kernel/estimate-token-count'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  tokenCount?: number
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-0.5" aria-label="Assistant is typing">
      <span className="size-1.5 animate-bounce rounded-full bg-current opacity-60 [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current opacity-60 [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current opacity-60" />
    </div>
  )
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
  documentId,
}: {
  conversationId: string | null
  onConversationCreated: (id: string) => void
  documentId: string | null
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionTokens, setSessionTokens] = useState(0)
  // Tracks the conversation id this component instance is currently using. Seeded from the
  // conversationId prop and updated synchronously whenever handleSend lazily creates a new
  // conversation, so a second Enter in the same "prop hasn't re-rendered yet" window reuses it
  // instead of creating a duplicate conversation.
  const activeConversationIdRef = useRef<string | null>(conversationId)
  // Holds the in-flight POST /api/conversations promise while a conversation is being created
  // lazily, so a concurrent caller in the same window awaits the SAME promise. Cleared on
  // failure so a later attempt can retry.
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
      activeConversationIdRef.current = conversationId
      return
    }

    streamGenerationRef.current += 1
    selfCreatedIdRef.current = null
    conversationCreationRef.current = null
    activeConversationIdRef.current = conversationId

    if (!conversationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- necessary to clear state when conversation changes
      setMessages([])
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

    return () => {
      cancelled = true
    }
  }, [conversationId])

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
      if (conversationCreationRef.current === creation) conversationCreationRef.current = null
    })

    return creation
  }

  async function handleSend() {
    const userMessage = input
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

    const generation = streamGenerationRef.current
    const isCurrent = () => streamGenerationRef.current === generation

    const userTokenCount = estimateTokenCount(userMessage)
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: userMessage, tokenCount: userTokenCount },
      { role: 'assistant', content: '' },
    ])
    setSessionTokens((prev) => prev + userTokenCount)
    setInput('')

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeConversationId, message: userMessage, documentId: documentId ?? undefined }),
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
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2 text-sm text-muted-foreground">
        <span>{conversationId ? 'Chat' : 'New chat'}</span>
        <span>Session tokens: {sessionTokens}</span>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div
              className={`inline-block max-w-lg rounded-lg px-3 py-2 text-sm ${
                m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
              }`}
            >
              {m.role === 'assistant' && m.content === '' && sending ? (
                <TypingIndicator />
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              )}
              {m.tokenCount !== undefined && (
                <div className="mt-1 text-xs opacity-60">{m.tokenCount} tokens</div>
              )}
            </div>
          </div>
        ))}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="flex gap-2 border-t p-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask something…"
          disabled={sending}
        />
        <Button onClick={handleSend} disabled={sending}>
          <Send className="size-4" />
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  )
}
