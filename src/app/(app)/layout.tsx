import { AppShellProvider } from '@/components/app-shell/app-shell-context'
import { Sidebar } from '@/components/app-shell/sidebar'
import { Header } from '@/components/app-shell/header'

export default function AppShellLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShellProvider>
      <div className="flex h-dvh overflow-hidden">
        <div className="hidden md:block">
          <Sidebar />
        </div>
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </AppShellProvider>
  )
}
