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

interface DocumentSummary {
  id: string
  filename: string
}

export default function ChatPage() {
  const router = useRouter()
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function fetchConversations() {
    fetch('/api/conversations')
      .then((r) => r.json())
      .then((body) => setConversations(body.conversations ?? []))
      .catch(() => setError('Failed to load conversations'))
  }

  useEffect(() => {
    fetchConversations()

    fetch('/api/documents')
      .then((r) => r.json())
      .then((body) => setDocuments(body.documents ?? []))
      .catch(() => setError('Failed to load documents'))
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
        <div className="flex items-center justify-between border-b p-3 text-sm">
          <div>
            <label className="mr-2 font-medium">Document context:</label>
            <select
              className="rounded border px-2 py-1"
              value={documentId ?? ''}
              onChange={(e) => setDocumentId(e.target.value || null)}
            >
              <option value="">None</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.filename}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleLogout}
            className="rounded border px-3 py-1 text-gray-600 hover:bg-gray-50"
          >
            Log out
          </button>
        </div>
        {error && <p className="border-b bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <ChatWindow conversationId={activeId} onConversationCreated={handleConversationCreated} documentId={documentId} />
      </div>
    </div>
  )
}
