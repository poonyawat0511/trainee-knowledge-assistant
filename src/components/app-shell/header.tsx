'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Menu, Paperclip, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Sidebar } from './sidebar'
import { useAppShell } from './app-shell-context'

export function Header() {
  const router = useRouter()
  const pathname = usePathname()
  const { documents, documentId, setDocumentId } = useAppShell()
  // Controlled so selecting a conversation inside the drawer (Sidebar's onNavigate callback)
  // can close it — an uncontrolled Sheet has no way for content inside it to dismiss itself.
  const [drawerOpen, setDrawerOpen] = useState(false)

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      router.push('/login')
    }
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4">
      <div className="flex items-center gap-3">
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetTrigger render={<Button variant="ghost" size="icon" className="md:hidden" />}>
            <Menu className="size-5" />
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetTitle className="sr-only">Conversations</SheetTitle>
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </SheetContent>
        </Sheet>
        <span className="font-semibold">Knowledge Assistant</span>
      </div>

      <div className="flex items-center gap-3">
        {pathname === '/chat' && (
          <Select value={documentId ?? 'none'} onValueChange={(v) => setDocumentId(v === 'none' ? null : v)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Document context">
                {(value: string | null) =>
                  value && value !== 'none'
                    ? (documents.find((d) => d.id === value)?.filename ?? 'Document context')
                    : 'No document context'
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No document context</SelectItem>
              {documents.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.filename}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button variant="outline" size="sm" className="gap-2" onClick={() => router.push('/upload')}>
          <Paperclip className="size-4" />
          Upload
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="rounded-full" />}>
            <Avatar className="size-8">
              <AvatarFallback>U</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="mr-2 size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
