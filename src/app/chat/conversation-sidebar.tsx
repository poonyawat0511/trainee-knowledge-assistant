'use client'

interface ConversationSummary {
  id: string
  title: string
  createdAt: string
}

export function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
}: {
  conversations: ConversationSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}) {
  return (
    <aside className="w-64 shrink-0 border-r bg-gray-50 p-3">
      <button
        onClick={onNew}
        className="mb-3 w-full rounded bg-black px-3 py-2 text-sm text-white"
      >
        New chat
      </button>
      <ul className="space-y-1">
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => onSelect(c.id)}
              className={`w-full truncate rounded px-2 py-1 text-left text-sm ${
                c.id === activeId ? 'bg-gray-200 font-medium' : 'hover:bg-gray-100'
              }`}
            >
              {c.title}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
