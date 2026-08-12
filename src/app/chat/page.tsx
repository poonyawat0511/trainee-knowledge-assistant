'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ConversationSidebar } from './conversation-sidebar'
import { ChatWindow } from './chat-window'

interface ConversationSummary {
  id: string
  title: string
  createdAt: string
}

export default function ChatPage() {
  const router = useRouter()
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function fetchConversations() {
    fetch('/api/conversations')
      .then((r) => r.json())
      .then((body) => setConversations(body.conversations ?? []))
      .catch(() => setError('Failed to load conversations'))
  }

  useEffect(() => {
    fetchConversations()
  }, [])

  function handleConversationCreated(id: string) {
    setActiveId(id)
    fetchConversations()
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      router.push('/login')
    }
  }

  return (
    <div className="flex h-screen">
      <ConversationSidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={() => setActiveId(null)}
      />
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-end border-b p-3 text-sm">
          <button
            onClick={handleLogout}
            className="rounded border px-3 py-1 text-gray-600 hover:bg-gray-50"
          >
            Log out
          </button>
        </div>
        {error && <p className="border-b bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <ChatWindow conversationId={activeId} onConversationCreated={handleConversationCreated} />
      </div>
    </div>
  )
}
