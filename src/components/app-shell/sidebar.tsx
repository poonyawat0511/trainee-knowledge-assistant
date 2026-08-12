'use client'

import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppShell } from './app-shell-context'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { conversations, activeConversationId, setActiveConversationId } = useAppShell()
  const router = useRouter()

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r bg-card">
      <div className="p-3">
        <Button
          className="w-full justify-start gap-2"
          onClick={() => {
            setActiveConversationId(null)
            router.push('/chat')
            onNavigate?.()
          }}
        >
          <Plus className="size-4" />
          New chat
        </Button>
      </div>
      <ScrollArea className="flex-1 px-3">
        <ul className="space-y-1 pb-3">
          {conversations.map((c) => (
            <li key={c.id}>
              <Button
                variant={c.id === activeConversationId ? 'secondary' : 'ghost'}
                className="w-full justify-start truncate"
                onClick={() => {
                  setActiveConversationId(c.id)
                  router.push('/chat')
                  onNavigate?.()
                }}
              >
                {c.title}
              </Button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  )
}
