'use client'

import { useEffect, useState } from 'react'
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
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [documentId, setDocumentId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/conversations')
      .then((r) => r.json())
      .then((body) => setConversations(body.conversations ?? []))

    fetch('/api/documents')
      .then((r) => r.json())
      .then((body) => setDocuments(body.documents ?? []))
  }, [])

  async function handleNew() {
    const response = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const body = await response.json()
    setConversations((prev) => [body.conversation, ...prev])
    setActiveId(body.conversation.id)
  }

  return (
    <div className="flex h-screen">
      <ConversationSidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={handleNew}
      />
      <div className="flex flex-1 flex-col">
        <div className="border-b p-3 text-sm">
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
        <ChatWindow conversationId={activeId} documentId={documentId} />
      </div>
    </div>
  )
}
