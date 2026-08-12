'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export interface ConversationSummary {
  id: string
  title: string
  createdAt: string
}

export interface DocumentSummary {
  id: string
  filename: string
}

interface AppShellState {
  conversations: ConversationSummary[]
  activeConversationId: string | null
  setActiveConversationId: (id: string | null) => void
  refreshConversations: () => void
  documents: DocumentSummary[]
  documentId: string | null
  setDocumentId: (id: string | null) => void
  refreshDocuments: () => void
}

const AppShellContext = createContext<AppShellState | null>(null)

export function AppShellProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [documentId, setDocumentId] = useState<string | null>(null)

  const refreshConversations = useCallback(() => {
    fetch('/api/conversations')
      .then((r) => r.json())
      .then((body) => setConversations(body.conversations ?? []))
      .catch(() => {})
  }, [])

  const refreshDocuments = useCallback(() => {
    fetch('/api/documents')
      .then((r) => r.json())
      .then((body) => setDocuments(body.documents ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshConversations()
    refreshDocuments()
  }, [refreshConversations, refreshDocuments])

  return (
    <AppShellContext.Provider
      value={{
        conversations,
        activeConversationId,
        setActiveConversationId,
        refreshConversations,
        documents,
        documentId,
        setDocumentId,
        refreshDocuments,
      }}
    >
      {children}
    </AppShellContext.Provider>
  )
}

export function useAppShell(): AppShellState {
  const ctx = useContext(AppShellContext)
  if (!ctx) throw new Error('useAppShell must be used within an AppShellProvider')
  return ctx
}
