import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { FileText, Home, Keyboard, Mic, Settings as SettingsIcon, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { cn } from '@/lib/utils'
import { useLive } from '@/store/live'
import { fmtClock } from '@/lib/time'
import { Logo } from './Logo'
import { Button } from './ui/button'

const NAV = [
  { to: '/', label: 'Home', icon: Home, match: (p: string) => p === '/' },
  { to: '/sessions', label: 'Sessions', icon: FileText, match: (p: string) => p.startsWith('/sessions') },
  { to: '/record', label: 'Record', icon: Mic, match: (p: string) => p.startsWith('/record') || p.startsWith('/live') },
  { to: '/steno', label: 'Steno', icon: Keyboard, match: (p: string) => p.startsWith('/steno') },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, match: (p: string) => p.startsWith('/settings') },
]

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const f = () => setOnline(navigator.onLine)
    window.addEventListener('online', f)
    window.addEventListener('offline', f)
    return () => {
      window.removeEventListener('online', f)
      window.removeEventListener('offline', f)
    }
  }, [])
  return online
}

function LiveMiniBar() {
  const { session, phase, elapsedMs } = useLive()
  const nav = useNavigate()
  if (!session || (phase !== 'recording' && phase !== 'paused')) return null
  return (
    <button
      type="button"
      onClick={() => nav(`/live/${session.id}`)}
      className="flex min-h-12 w-full items-center gap-3 border-b border-recording/20 bg-recording/8 px-4 text-left text-sm"
    >
      <span className={cn('size-2.5 rounded-full bg-recording', phase === 'recording' && 'rec-dot')} />
      <span className="font-semibold text-recording">{phase === 'recording' ? 'RECORDING' : 'PAUSED'}</span>
      <span className="font-mono tabular-nums">{fmtClock(elapsedMs)}</span>
      <span className="truncate text-muted">{session.title}</span>
      <span className="ml-auto font-medium text-interactive">Return</span>
    </button>
  )
}

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  const phase = useLive((s) => s.phase)
  if (!needRefresh || phase === 'recording' || phase === 'paused') return null
  return (
    <div className="fixed inset-x-3 bottom-[calc(5.5rem+var(--safe-bottom))] z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-lg md:bottom-6">
      <p className="flex-1 text-sm">A new version of CourtScribe is available.</p>
      <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
        Later
      </Button>
      <Button size="sm" variant="primary" onClick={() => updateServiceWorker(true)}>
        Update
      </Button>
    </div>
  )
}

export function AppShell() {
  const { pathname } = useLocation()
  const online = useOnline()
  const isLive = pathname.startsWith('/live/')
  return (
    <div className="flex min-h-dvh pl-[var(--safe-left)] pr-[var(--safe-right)]">
      {/* Rail: tablet/desktop */}
      <nav aria-label="Primary" className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface pt-[calc(1rem+var(--safe-top))] md:flex lg:w-56 lg:items-stretch lg:px-3">
        <div className="mb-6 flex items-center gap-2.5 lg:px-2">
          <Logo size={36} />
          <span className="hidden text-[0.95rem] font-semibold tracking-tight lg:inline">CourtScribe AI</span>
        </div>
        {NAV.map((n) => {
          const active = n.match(pathname)
          return (
            <NavLink
              key={n.to}
              to={n.to}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-12 w-16 flex-col items-center justify-center gap-1 rounded-xl text-[0.7rem] font-medium transition-colors duration-150 lg:w-auto lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-sm',
                active ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-surface-2 hover:text-text',
              )}
            >
              <n.icon className="size-5" />
              {n.label}
            </NavLink>
          )
        })}
        <div className="mt-auto pb-4 text-center text-[0.65rem] text-muted lg:text-left lg:text-xs">
          <span className="hidden lg:inline">Draft transcripts only · </span>v{__APP_VERSION__}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {!online && (
          <div role="status" className="flex items-center gap-2 bg-warning/12 px-4 py-2 pt-[calc(0.5rem+var(--safe-top))] text-sm text-warning">
            <WifiOff className="size-4" /> Offline — recording and local saving still work. Browser speech recognition needs a connection.
          </div>
        )}
        {!isLive && <LiveMiniBar />}
        <main className={cn('min-w-0 flex-1', !isLive && 'pb-[calc(5rem+var(--safe-bottom))] md:pb-0')}>
          <Outlet />
        </main>
      </div>

      {/* Bottom nav: phones */}
      {!isLive && (
        <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[var(--safe-bottom)] backdrop-blur md:hidden">
          <div className="mx-auto grid max-w-lg grid-cols-5">
            {NAV.map((n) => {
              const active = n.match(pathname)
              const isRecord = n.to === '/record'
              return (
                <NavLink key={n.to} to={n.to} aria-current={active ? 'page' : undefined} className={cn('flex min-h-16 flex-col items-center justify-center gap-1 text-[0.7rem] font-medium', active ? 'text-primary' : 'text-muted')}>
                  <span className={cn('flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-150', active && 'bg-primary/10', isRecord && !active && 'bg-recording/8 text-recording')}>
                    <n.icon className="size-5" />
                  </span>
                  {n.label}
                </NavLink>
              )
            })}
          </div>
        </nav>
      )}
      <UpdatePrompt />
    </div>
  )
}
