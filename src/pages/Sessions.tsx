import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, FileAudio, FileText, Plus, Search, Trash2, Upload } from 'lucide-react'
import { useSessions } from '@/store/sessions'
import { isUnfinished, useLive } from '@/store/live'
import { useSettings } from '@/store/settings'
import { repo } from '@/lib/db'
import { uid } from '@/lib/id'
import { fmtClock, fmtDate } from '@/lib/time'
import type { Session, SessionStatus } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/states'

const STATUS_LABEL: Record<SessionStatus, { label: string; tone: 'neutral' | 'recording' | 'warning' | 'success' | 'info' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  recording: { label: 'Recording', tone: 'recording' },
  paused: { label: 'Paused', tone: 'warning' },
  interrupted: { label: 'Interrupted', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
}

export function SessionCard({ s }: { s: Session }) {
  const liveId = useLive((x) => x.session?.id)
  const interrupted = isUnfinished(s, liveId)
  const st = interrupted ? STATUS_LABEL.interrupted : STATUS_LABEL[s.status]
  const to = s.id === liveId ? `/live/${s.id}` : `/sessions/${s.id}`
  return (
    <Link to={to} className="flex min-h-18 items-center gap-3 rounded-2xl border border-border bg-surface p-3.5 transition-colors duration-150 hover:bg-surface-2">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary">
        <FileText className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{s.title}</p>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        <p className="truncate text-sm text-muted">
          {[s.caseNumber, fmtDate(s.sessionDate), fmtClock(s.durationMs), s.language === 'mixed' ? 'Mixed (exp.)' : s.language === 'fil-PH' ? 'Filipino' : 'English'].filter(Boolean).join(' · ')}
        </p>
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted" />
    </Link>
  )
}

export default function Sessions() {
  const { sessions, status, error, refresh } = useSessions()
  const liveId = useLive((x) => x.session?.id)
  const confirmDelete = useSettings((s) => s.confirmBeforeDelete)
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'unfinished' | 'completed'>('all')
  const [toDelete, setToDelete] = useState<Session | null>(null)
  const [deleteText, setDeleteText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string>()
  const fileRef = useRef<HTMLInputElement>(null)
  const nav = useNavigate()

  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    if (params.get('import')) {
      setParams({}, { replace: true })
      setTimeout(() => fileRef.current?.click(), 50)
    }
  }, [params, setParams])

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return sessions.filter((s) => {
      if (t && ![s.title, s.caseNumber, s.venue].some((f) => f.toLowerCase().includes(t))) return false
      if (filter === 'completed') return s.status === 'completed'
      if (filter === 'unfinished') return s.status !== 'completed'
      return true
    })
  }, [sessions, q, filter])

  const importAudio = async (file: File) => {
    setImporting(true)
    setImportError(undefined)
    try {
      const duration = await new Promise<number>((resolve) => {
        const a = new Audio()
        a.preload = 'metadata'
        a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration * 1000 : 0)
        a.onerror = () => resolve(0)
        a.src = URL.createObjectURL(file)
      })
      const now = Date.now()
      const id = uid('ses')
      const session: Session = {
        id,
        title: file.name.replace(/\.[^.]+$/, '') || 'Imported audio',
        caseNumber: '',
        venue: '',
        sessionDate: new Date().toISOString().slice(0, 10),
        participants: [
          { id: uid('p'), name: '', role: 'Judge' },
          { id: uid('p'), name: '', role: 'Witness' },
        ],
        language: useSettings.getState().defaultLanguage,
        mode: 'steno',
        recordingSource: 'none',
        storageMode: 'local',
        providerId: 'webspeech',
        glossary: [],
        status: 'completed',
        authorization: { confirmed: true, confirmedAt: now, authority: 'Imported file — user confirmed authorization to process' },
        createdAt: now,
        updatedAt: now,
        endedAt: now,
        durationMs: Math.round(duration),
        runCount: 1,
      }
      await repo.putSession(session)
      await repo.addChunk({ id: `${id}:1`, sessionId: id, seq: 1, run: 1, startMs: 0, endMs: Math.round(duration), mimeType: file.type || 'audio/mpeg', size: file.size, blob: file, createdAt: now })
      await refresh()
      nav(`/sessions/${id}`)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 pt-[calc(1.25rem+var(--safe-top))] pb-6 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={importing}>
            <Upload /> {importing ? 'Importing…' : 'Import audio'}
          </Button>
          <Button size="sm" variant="primary" onClick={() => nav('/record')}>
            <Plus /> New
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,video/webm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) {
              if (!window.confirm('Confirm you are authorized by the court or competent authority to process this recording.')) return
              void importAudio(f)
            }
          }}
        />
      </header>
      {importError && <ErrorState title="Import failed" body={importError} />}
      <p className="text-sm text-muted">Imported audio is stored locally for manual/steno transcription and review. Automatic transcription of files needs the cloud backend (not configured).</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-muted" />
          <Input type="search" aria-label="Search sessions" placeholder="Search sessions" className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select aria-label="Filter sessions" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="sm:w-48">
          <option value="all">All sessions</option>
          <option value="unfinished">Unfinished</option>
          <option value="completed">Completed</option>
        </Select>
      </div>
      {status === 'loading' || status === 'idle' ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-18" />
          ))}
        </div>
      ) : status === 'error' ? (
        <ErrorState body={error} action={<Button onClick={() => refresh()}>Retry</Button>} />
      ) : list.length === 0 ? (
        <EmptyState icon={sessions.length ? <Search /> : <FileAudio />} title={sessions.length ? 'No sessions match' : 'No sessions yet'} body={sessions.length ? 'Clear the search or filter.' : 'Start a new transcription or import an audio file.'} />
      ) : (
        <ul className="space-y-2">
          {list.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <SessionCard s={s} />
              </div>
              <Button size="icon" variant="ghost" aria-label={`Delete ${s.title}`} disabled={s.id === liveId} onClick={() => setToDelete(s)}>
                <Trash2 className="text-muted" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={!!toDelete}
        onClose={() => {
          setToDelete(null)
          setDeleteText('')
        }}
        title="Delete session permanently?"
        description="This removes the audio, transcript, bookmarks and history from this device. It cannot be undone."
        footer={
          <>
            <Button onClick={() => setToDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={confirmDelete && deleteText.trim().toUpperCase() !== 'DELETE'}
              onClick={async () => {
                if (!toDelete) return
                await repo.deleteSession(toDelete.id)
                setToDelete(null)
                setDeleteText('')
                await refresh()
              }}
            >
              <Trash2 /> Delete
            </Button>
          </>
        }
      >
        <p className="mb-2 text-sm font-medium">{toDelete?.title}</p>
        {confirmDelete && <Input aria-label="Type DELETE to confirm" placeholder="Type DELETE to confirm" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} />}
      </Dialog>
    </div>
  )
}
