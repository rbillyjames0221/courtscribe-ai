import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, FileAudio, FileText, HardDrive, Keyboard, Mic, Plus, RotateCcw, Search } from 'lucide-react'
import { useSessions } from '@/store/sessions'
import { isUnfinished, useLive } from '@/store/live'
import { useSettings } from '@/store/settings'
import { repo, storageEstimate } from '@/lib/db'
import { fmtBytes, fmtClock, fmtDate } from '@/lib/time'
import { settleInterims } from '@/lib/segments'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/field'
import { Banner, EmptyState, ErrorState, Skeleton } from '@/components/ui/states'
import { Logo } from '@/components/Logo'
import { Disclaimer } from '@/components/Disclaimer'
import { SessionCard } from './Sessions'
import type { Session } from '@/lib/types'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function RecoveryBanner({ s }: { s: Session }) {
  const nav = useNavigate()
  const refresh = useSessions((x) => x.refresh)
  const [stats, setStats] = useState<{ count: number; lastEnd: number; segs: number } | null>(null)
  useEffect(() => {
    void Promise.all([repo.chunkStats(s.id), repo.segments(s.id)]).then(([c, segs]) => setStats({ count: c.count, lastEnd: c.lastEnd, segs: segs.length }))
  }, [s.id])
  const finish = async () => {
    const segs = await repo.segments(s.id)
    await repo.putSegments(settleInterims(segs, Date.now()))
    const c = await repo.chunkStats(s.id)
    await repo.putSession({ ...s, status: 'completed', endedAt: Date.now(), durationMs: Math.max(s.durationMs, c.lastEnd), updatedAt: Date.now() })
    await refresh()
  }
  const lastAudio = Math.max(stats?.lastEnd ?? 0, s.lastCheckpoint?.durationMs ?? 0)
  return (
    <Banner
      tone="warning"
      icon={<AlertTriangle className="text-warning" />}
      action={
        <>
          <Button size="sm" variant="primary" onClick={() => nav(`/live/${s.id}?resume=1`)}>
            <RotateCcw /> Resume recording
          </Button>
          <Button size="sm" onClick={() => nav(`/sessions/${s.id}`)}>
            Review
          </Button>
          <Button size="sm" variant="ghost" onClick={finish}>
            Mark finished
          </Button>
        </>
      }
    >
      <p className="font-semibold text-text">Interrupted session recovered: {s.title}</p>
      <p className="text-muted">
        Last confirmed audio at <span className="font-mono">{fmtClock(lastAudio)}</span>
        {stats && (
          <>
            {' '}
            · {stats.count} audio chunks · {stats.segs} transcript segments
          </>
        )}
        {s.lastCheckpoint && <> · checkpoint {new Date(s.lastCheckpoint.at).toLocaleTimeString()}</>}. Nothing was overwritten.
      </p>
    </Banner>
  )
}

export default function Home() {
  const { sessions, status, error, refresh } = useSessions()
  const live = useLive()
  const name = useSettings((s) => s.displayName)
  const [q, setQ] = useState('')
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null)
  const nav = useNavigate()
  useEffect(() => {
    void refresh()
    void storageEstimate().then(setStorage)
  }, [refresh])

  const unfinished = sessions.filter((s) => isUnfinished(s, live.session?.id))
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    const list = t ? sessions.filter((s) => [s.title, s.caseNumber, s.venue].some((f) => f.toLowerCase().includes(t))) : sessions
    return list.slice(0, t ? 20 : 5)
  }, [sessions, q])

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 pt-[calc(1.25rem+var(--safe-top))] pb-6 sm:px-6">
      <header className="flex items-center gap-3">
        <span className="md:hidden">
          <Logo size={40} />
        </span>
        <div>
          <p className="text-sm text-muted">{greeting()}{name ? `, ${name}` : ''}</p>
          <h1 className="text-2xl font-semibold tracking-tight">CourtScribe AI</h1>
        </div>
      </header>

      {unfinished.map((s) => (
        <RecoveryBanner key={s.id} s={s} />
      ))}

      {live.session && (live.phase === 'recording' || live.phase === 'paused') && (
        <Banner tone="danger" icon={<span className="mt-1 block size-3 rounded-full bg-recording rec-dot" />} action={<Button size="sm" variant="danger" onClick={() => nav(`/live/${live.session!.id}`)}>Return to recording</Button>}>
          <p className="font-semibold text-text">{live.phase === 'recording' ? 'Recording in progress' : 'Recording paused'}: {live.session.title}</p>
          <p className="font-mono text-muted">{fmtClock(live.elapsedMs)}</p>
        </Banner>
      )}

      <Card className="overflow-hidden">
        <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="font-semibold">Start a transcription</p>
            <p className="text-sm text-muted">Confirm authorization, check your microphone, and record with live transcript.</p>
          </div>
          <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={() => nav('/record')}>
            <Plus /> New Transcription
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        {[
          { to: '/record', icon: Mic, label: 'Record' },
          { to: '/sessions?import=1', icon: FileAudio, label: 'Import Audio' },
          { to: '/steno', icon: Keyboard, label: 'Steno' },
        ].map((a) => (
          <Link key={a.label} to={a.to} className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-surface text-sm font-medium transition-colors duration-150 hover:bg-surface-2">
            <a.icon className="size-5 text-primary" />
            {a.label}
          </Link>
        ))}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Recent sessions</h2>
          <Link to="/sessions" className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-interactive">
            View all
          </Link>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-muted" />
          <Input type="search" placeholder="Search by title, case number or venue" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" aria-label="Search sessions" />
        </div>
        {status === 'loading' || status === 'idle' ? (
          <div className="space-y-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : status === 'error' ? (
          <ErrorState body={error} action={<Button onClick={() => refresh()}>Retry</Button>} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<FileText />} title={q ? 'No matching sessions' : 'No sessions yet'} body={q ? 'Try another title or case number.' : 'Your recordings and transcripts are stored privately on this device.'} action={!q && <Button variant="primary" onClick={() => nav('/record')}><Plus /> New Transcription</Button>} />
        ) : (
          <div className="space-y-2">
            {filtered.map((s) => (
              <SessionCard key={s.id} s={s} />
            ))}
          </div>
        )}
      </section>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <HardDrive className="size-4.5 text-muted" />
          <CardTitle>Storage on this device</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {storage ? (
            <>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-primary" style={{ width: `${storage.quota ? Math.max(1, (storage.usage / storage.quota) * 100) : 0}%` }} />
              </div>
              <p className="text-sm text-muted">
                {fmtBytes(storage.usage)} used of {fmtBytes(storage.quota)} available · {sessions.length} session{sessions.length === 1 ? '' : 's'} · {storage.persisted ? 'Persistent storage granted' : 'Browser may evict data under pressure — enable persistent storage in Settings'}
              </p>
            </>
          ) : (
            <Skeleton className="h-6" />
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted">Last session date: {sessions[0] ? fmtDate(sessions[0].updatedAt) : '—'}</p>
      <Disclaimer compact />
    </div>
  )
}
