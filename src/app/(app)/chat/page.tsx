'use client'

import { ChatWindow } from './chat-window'
import { useAppShell } from '@/components/app-shell/app-shell-context'

export default function ChatPage() {
  const { activeConversationId, setActiveConversationId, refreshConversations, documentId } = useAppShell()

  function handleConversationCreated(id: string) {
    setActiveConversationId(id)
    refreshConversations()
  }

  return (
    <ChatWindow
      conversationId={activeConversationId}
      onConversationCreated={handleConversationCreated}
      documentId={documentId}
    />
  )
}
