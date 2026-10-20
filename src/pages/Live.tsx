import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowDown, ArrowLeft, Bookmark as BookmarkIcon, Check, CloudOff, Loader2, MoreHorizontal, Pause, Play, RefreshCw, Save, Square, StickyNote, UserRound, Wifi, AlertTriangle, Mic, Send, Languages,
} from 'lucide-react'
import { useLive } from '@/store/live'
import { useSettings } from '@/store/settings'
import { repo } from '@/lib/db'
import { fmtClock } from '@/lib/time'
import { cn } from '@/lib/utils'
import { BOOKMARK_TYPES, LANGUAGES, type BookmarkType, type Language, type Session } from '@/lib/types'
import { INAUDIBLE, UNCLEAR } from '@/lib/segments'
import { useStenoField } from '@/components/useStenoField'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { Banner, LoadingState } from '@/components/ui/states'
import { SegmentRow, speakerName } from '@/components/Transcript'

function ConnectionPill() {
  const { providerStatus, session, online } = useLive()
  if (session?.mode === 'steno') return <span className="text-muted">Manual mode</span>
  const map: Record<string, { label: string; cls: string; icon?: React.ReactNode }> = {
    listening: { label: 'Connected', cls: 'text-success', icon: <Wifi className="size-3.5" /> },
    connecting: { label: 'Connecting…', cls: 'text-muted', icon: <Loader2 className="size-3.5 animate-spin" /> },
    reconnecting: { label: 'Reconnecting…', cls: 'text-warning', icon: <RefreshCw className="size-3.5 animate-spin" /> },
    offline: { label: 'Offline — audio still saving', cls: 'text-warning', icon: <CloudOff className="size-3.5" /> },
    paused: { label: 'Recognition paused', cls: 'text-muted' },
    error: { label: 'Recognition stopped', cls: 'text-recording', icon: <AlertTriangle className="size-3.5" /> },
    unsupported: { label: 'Recognition unavailable', cls: 'text-recording', icon: <AlertTriangle className="size-3.5" /> },
    idle: { label: 'Idle', cls: 'text-muted' },
    stopped: { label: 'Stopped', cls: 'text-muted' },
  }
  const m = !online && providerStatus !== 'paused' ? map.offline : (map[providerStatus] ?? map.idle)
  return (
    <span className={cn('inline-flex items-center gap-1', m.cls)}>
      {m.icon}
      {m.label}
    </span>
  )
}

function SavePill() {
  const { saveStatus, saveError } = useLive()
  if (saveStatus === 'error') return <span className="inline-flex items-center gap-1 text-recording" title={saveError}><AlertTriangle className="size-3.5" /> Save failed</span>
  if (saveStatus === 'saving') return <span className="inline-flex items-center gap-1 text-muted"><Save className="size-3.5" /> Saving…</span>
  return <span className="inline-flex items-center gap-1 text-success"><Check className="size-3.5" /> Saved locally</span>
}

function ResumeGate({ id }: { id: string }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const live = useLive()
  const [params] = useSearchParams()
  useEffect(() => {
    void repo.getSession(id).then((s) => setSession(s ?? null))
  }, [id])
  if (session === undefined) return <LoadingState label="Loading session…" />
  if (session === null) return <Navigate to="/sessions" replace />
  if (session.status === 'completed' && !params.get('resume')) return <Navigate to={`/sessions/${id}`} replace />
  const otherLive = live.session && live.session.id !== id
  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 pt-[calc(2rem+var(--safe-top))]">
      <h1 className="text-xl font-semibold">{session.title}</h1>
      {otherLive ? (
        <Banner tone="warning" icon={<AlertTriangle className="text-warning" />} action={<Link to={`/live/${live.session!.id}`} className="font-medium text-interactive">Open it</Link>}>
          Another session is recording. Stop it before resuming this one.
        </Banner>
      ) : (
        <>
          <p className="text-sm text-muted">
            This session was interrupted at <span className="font-mono">{fmtClock(session.lastCheckpoint?.durationMs ?? session.durationMs)}</span>. Resuming continues the same timeline in a new audio run — existing audio and transcript are kept untouched.
          </p>
          {live.phase === 'error' && <Banner tone="danger" icon={<AlertTriangle className="text-recording" />}>{live.error}</Banner>}
          <div className="flex gap-2">
            <Button variant="danger" size="lg" className="flex-1" disabled={live.phase === 'starting'} onClick={() => void live.start(session, { resume: true })}>
              <Mic /> {live.phase === 'starting' ? 'Starting…' : 'Resume recording'}
            </Button>
            <Link to={`/sessions/${id}`} className="inline-flex min-h-14 items-center rounded-xl border border-border bg-surface px-5 font-medium">
              Review
            </Link>
          </div>
        </>
      )}
    </div>
  )
}

export default function Live() {
  const { id = '' } = useParams()
  const live = useLive()
  if (!live.session || live.session.id !== id || (live.phase !== 'recording' && live.phase !== 'paused' && live.phase !== 'stopping')) return <ResumeGate id={id} />
  return <LiveScreen />
}

function LiveScreen() {
  const live = useLive()
  const settings = useSettings()
  const nav = useNavigate()
  const session = live.session!
  const scroller = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  const [sheet, setSheet] = useState<null | 'speaker' | 'bookmark' | 'note' | 'stop' | 'more' | 'leave'>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editSpeaker, setEditSpeaker] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [bmType, setBmType] = useState<BookmarkType>('important')
  const [bmLabel, setBmLabel] = useState('')
  const [draft, setDraft] = useState('')
  const [toast, setToast] = useState<string>()
  const composer = useStenoField(draft, setDraft)
  const editField = useStenoField(editText, setEditText)
  const editRef = editField.ref

  const segments = live.segments
  const visible = useMemo(() => (settings.showInterim ? segments : segments.filter((s) => s.status !== 'interim')), [segments, settings.showInterim])
  const bmBySeg = useMemo(() => {
    const m = new Map<string, typeof live.bookmarks>()
    for (const b of live.bookmarks) if (b.segmentId) m.set(b.segmentId, [...(m.get(b.segmentId) ?? []), b])
    return m
  }, [live.bookmarks])

  const showToast = (t: string) => {
    setToast(t)
    setTimeout(() => setToast(undefined), 1800)
  }

  // Smart Follow: only auto-scroll when the user is already near the bottom.
  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (near !== follow) setFollow(near)
  }
  useLayoutEffect(() => {
    if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [visible, follow])
  const jumpToLive = () => {
    setFollow(true)
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: settings.reduceMotion ? 'auto' : 'smooth' })
  }

  const openEdit = (segId: string) => {
    const s = segments.find((x) => x.id === segId)
    if (!s || s.status === 'interim') return
    setEditId(segId)
    setEditText(s.text)
    setEditSpeaker(s.speakerId)
  }
  const saveEdit = async () => {
    if (!editId) return
    const s = segments.find((x) => x.id === editId)
    if (s && editText.trim() !== s.text) await live.editSegment(editId, editText)
    if (s && editSpeaker !== s.speakerId) await live.reassign(editId, editSpeaker)
    setEditId(null)
  }
  const insertMarker = (m: string) => {
    const el = editRef.current
    const pos = el?.selectionStart ?? editText.length
    const end = el?.selectionEnd ?? pos
    const next = `${editText.slice(0, pos)}${pos > 0 && editText[pos - 1] !== ' ' ? ' ' : ''}${m}${editText.slice(end)}`
    setEditText(next)
  }

  const commitDraft = async () => {
    if (!draft.trim()) return
    await live.addManual(draft, session.mode === 'steno' ? 'steno' : 'manual')
    setDraft('')
    setFollow(true)
  }
  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void commitDraft()
    }
  }

  // Desktop shortcuts: Alt+1..9 select speaker, Alt+B bookmark, Alt+P pause/resume
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= 9 && session.participants[n - 1]) {
        e.preventDefault()
        live.setCurrentSpeaker(session.participants[n - 1].id)
        showToast(`Speaker: ${speakerName(session.participants, session.participants[n - 1].id)}`)
      } else if (e.key.toLowerCase() === 'b') {
        e.preventDefault()
        void live.addBookmark('important').then(() => showToast('Bookmarked'))
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault()
        void (live.phase === 'recording' ? live.pause() : live.resume())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [live, session.participants])

  const doStop = async () => {
    setSheet(null)
    const sid = await live.stop()
    if (sid) nav(`/sessions/${sid}`, { replace: true })
  }

  const recording = live.phase === 'recording'
  const showComposer = session.mode !== 'live'
  const current = speakerName(session.participants, live.currentSpeakerId)

  return (
    <div className="flex h-dvh flex-col bg-bg">
      {/* Header */}
      <header className="z-20 border-b border-border bg-surface pt-[var(--safe-top)]">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-2 py-1.5 sm:px-4">
          <Button size="icon" variant="ghost" aria-label="Back (recording continues)" onClick={() => setSheet('leave')}>
            <ArrowLeft />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.95rem] font-semibold">{session.title}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
              <span className={cn('inline-flex items-center gap-1.5 font-semibold', recording ? 'text-recording' : 'text-warning')}>
                <span className={cn('size-2 rounded-full', recording ? 'rec-dot bg-recording' : 'bg-warning')} />
                {live.phase === 'stopping' ? 'STOPPING' : recording ? 'RECORDING' : 'PAUSED'}
                <span className="font-mono tabular-nums">{fmtClock(live.elapsedMs)}</span>
              </span>
              <SavePill />
              <ConnectionPill />
            </div>
          </div>
          <div className="hidden h-6 w-16 items-end gap-0.5 sm:flex" aria-hidden>
            {[0.15, 0.35, 0.55, 0.75].map((t, i) => (
              <span key={i} className={cn('w-full rounded-sm', live.level > t ? 'bg-success' : 'bg-surface-2')} style={{ height: `${40 + i * 20}%` }} />
            ))}
          </div>
        </div>
      </header>

      {/* Notices */}
      <div className="mx-auto w-full max-w-4xl space-y-2 px-3 pt-2 empty:hidden sm:px-4">
        {live.notice && (
          <Banner tone="warning" icon={<AlertTriangle className="text-warning" />} action={<Button size="sm" onClick={live.dismissNotice}>Dismiss</Button>}>
            {live.notice}
          </Banner>
        )}
        {live.providerError && (live.providerStatus === 'error' || live.providerStatus === 'unsupported' || live.providerStatus === 'reconnecting' || live.providerStatus === 'offline') && (
          <Banner tone={live.providerStatus === 'error' || live.providerStatus === 'unsupported' ? 'danger' : 'warning'} icon={<AlertTriangle className="text-warning" />} action={live.providerStatus !== 'unsupported' && <Button size="sm" onClick={() => void live.retryRecognition()}><RefreshCw /> Retry</Button>}>
            {live.providerError.message}
          </Banner>
        )}
      </div>

      {/* Transcript */}
      <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-live="polite" aria-relevant="additions">
        <div className="mx-auto max-w-4xl space-y-1 px-2 py-3 sm:px-4">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center text-muted">
              <Mic className="mb-3 size-8" />
              <p className="font-medium text-text">{live.phase === 'paused' ? 'Paused' : session.mode === 'steno' ? 'Recording audio — type below' : 'Listening… start speaking'}</p>
              <p className="mt-1 max-w-sm text-sm">Current speaker: {current}. Tap the speaker button to change who is talking. Audio is saved every {settings.chunkSeconds}s.</p>
            </div>
          ) : (
            visible.map((s) => (
              <SegmentRow key={s.id} segment={s} participants={session.participants} showTimestamp={settings.showTimestamps} showConfidence={settings.showConfidence} bookmarks={bmBySeg.get(s.id)} onClick={() => openEdit(s.id)} />
            ))
          )}
          <div className="h-4" />
        </div>
      </div>
      {!follow && (
        <div className="pointer-events-none relative z-10 mx-auto -mt-16 mb-3 flex h-13 justify-center">
          <Button variant="interactive" size="sm" className="pointer-events-auto rounded-full shadow-lg" onClick={jumpToLive}>
            <ArrowDown /> Jump to Live
          </Button>
        </div>
      )}

      {/* Composer (Steno / Hybrid) */}
      {showComposer && (
        <div className="border-t border-border bg-surface">
          <div className="mx-auto flex max-w-4xl items-end gap-2 px-3 py-2 sm:px-4">
            <Textarea
              ref={composer.ref}
              rows={1}
              value={draft}
              onChange={composer.onChange}
              onKeyDown={onComposerKey}
              placeholder={session.mode === 'steno' ? `Type as ${current} — shorthand expands (e.g. yh, obj)` : 'Add manual line or correction note…'}
              aria-label="Manual transcript entry"
              className="max-h-32 min-h-12 resize-none"
            />
            <Button size="icon" variant="primary" aria-label="Add line" onClick={() => void commitDraft()} disabled={!draft.trim()}>
              <Send />
            </Button>
          </div>
        </div>
      )}

      {/* Fixed bottom toolbar */}
      <nav aria-label="Recording controls" className="z-20 border-t border-border bg-surface pb-[var(--safe-bottom)]">
        <div className="mx-auto grid max-w-4xl grid-cols-5 items-center gap-1 px-2 py-2 sm:px-4">
          <ToolButton label="Speaker" onClick={() => setSheet('speaker')} icon={<UserRound />} sub={session.participants.find((p) => p.id === live.currentSpeakerId)?.role ?? 'None'} />
          <ToolButton label="Bookmark" onClick={() => setSheet('bookmark')} icon={<BookmarkIcon />} />
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => void (recording ? live.pause() : live.resume())}
              disabled={live.phase === 'stopping'}
              aria-label={recording ? 'Pause recording' : 'Resume recording'}
              className={cn('flex size-16 items-center justify-center rounded-full text-white shadow-md transition-colors duration-200 [&_svg]:size-7', recording ? 'bg-primary' : 'bg-recording')}
            >
              {recording ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
            </button>
          </div>
          <ToolButton label="Note" onClick={() => setSheet('note')} icon={<StickyNote />} />
          <div className="grid grid-cols-2 gap-1">
            <ToolButton label="Stop" onClick={() => setSheet('stop')} icon={<Square className="text-recording" />} compact />
            <ToolButton label="More" onClick={() => setSheet('more')} icon={<MoreHorizontal />} compact />
          </div>
        </div>
      </nav>

      {toast && (
        <div role="status" className="fixed inset-x-0 bottom-[calc(7rem+var(--safe-bottom))] z-40 mx-auto w-fit rounded-full bg-text px-4 py-2 text-sm text-bg shadow-lg">
          {toast}
        </div>
      )}

      {/* Sheets */}
      <Dialog open={sheet === 'speaker'} onClose={() => setSheet(null)} title="Who is speaking?" description="New transcript lines are assigned to this speaker. Shortcut: Alt+1…9.">
        <div className="grid gap-2">
          {session.participants.map((p, i) => (
            <Button
              key={p.id}
              variant={p.id === live.currentSpeakerId ? 'primary' : 'secondary'}
              className="justify-start"
              onClick={() => {
                live.setCurrentSpeaker(p.id)
                setSheet(null)
              }}
            >
              <span className="w-5 font-mono text-xs opacity-70">{i + 1}</span> {p.role}
              {p.name && <span className="opacity-75">· {p.name}</span>}
            </Button>
          ))}
          <Button variant={live.currentSpeakerId === null ? 'primary' : 'ghost'} className="justify-start" onClick={() => { live.setCurrentSpeaker(null); setSheet(null) }}>
            Unassigned
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={sheet === 'bookmark'}
        onClose={() => setSheet(null)}
        title="Add bookmark"
        description={`At ${fmtClock(live.elapsedMs)} — recording continues.`}
        footer={
          <Button variant="primary" onClick={async () => { await live.addBookmark(bmType, bmLabel); setBmLabel(''); setSheet(null); showToast('Bookmark added') }}>
            <BookmarkIcon /> Add bookmark
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          {BOOKMARK_TYPES.filter((t) => t.id !== 'note').map((t) => (
            <Button key={t.id} size="sm" variant={bmType === t.id ? 'primary' : 'secondary'} onClick={() => setBmType(t.id)} className="justify-start">
              {t.label}
            </Button>
          ))}
        </div>
        <Field label="Label (optional)" htmlFor="bmlabel" className="mt-3">
          <Input id="bmlabel" value={bmLabel} onChange={(e) => setBmLabel(e.target.value)} placeholder="e.g. Exhibit 3" />
        </Field>
      </Dialog>

      <Dialog
        open={sheet === 'note'}
        onClose={() => setSheet(null)}
        title="Add note"
        description={`Private note at ${fmtClock(live.elapsedMs)}. Not part of the transcript text.`}
        footer={
          <Button variant="primary" disabled={!note.trim()} onClick={async () => { await live.addBookmark('note', '', note.trim()); setNote(''); setSheet(null); showToast('Note saved') }}>
            Save note
          </Button>
        }
      >
        <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" placeholder="Observation, reminder, exhibit detail…" />
      </Dialog>

      <Dialog
        open={sheet === 'stop'}
        onClose={() => setSheet(null)}
        title="Stop recording?"
        description="All audio, transcript lines and bookmarks are saved. You can review and export next. A stopped session can be resumed later from Review."
        footer={
          <>
            <Button onClick={() => setSheet(null)}>Keep recording</Button>
            <Button variant="danger" onClick={() => void doStop()}>
              <Square /> Stop and save
            </Button>
          </>
        }
      />

      <Dialog
        open={sheet === 'leave'}
        onClose={() => setSheet(null)}
        title="Leave the recording screen?"
        description="Recording continues in the background of this app. A red bar at the top lets you return. Don't close the browser tab."
        footer={
          <>
            <Button onClick={() => setSheet(null)}>Stay</Button>
            <Button variant="primary" onClick={() => nav('/')}>
              Go to Home
            </Button>
          </>
        }
      />

      <Dialog open={sheet === 'more'} onClose={() => setSheet(null)} title="More tools">
        <div className="space-y-4">
          <Field label={<span className="inline-flex items-center gap-2"><Languages className="size-4" /> Recognition language</span>} htmlFor="lang" hint="Changing language restarts recognition only; audio recording is not interrupted.">
            <Select id="lang" value={session.language} onChange={(e) => void live.changeLanguage(e.target.value as Language)} disabled={session.mode === 'steno'}>
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => void live.retryRecognition().then(() => setSheet(null))} disabled={session.mode === 'steno'}>
              <RefreshCw /> Reconnect
            </Button>
            <Button onClick={() => { settings.set({ transcriptSize: Math.min(1.75, settings.transcriptSize + 0.125) }) }}>A+ Larger text</Button>
            <Button onClick={() => { settings.set({ transcriptSize: Math.max(0.875, settings.transcriptSize - 0.125) }) }}>A− Smaller text</Button>
            <Button onClick={() => { jumpToLive(); setSheet(null) }}>
              <ArrowDown /> Jump to live
            </Button>
          </div>
          <div className="rounded-xl bg-surface-2 p-3 text-sm text-muted">
            {live.chunkCount} audio chunks saved · {live.segments.filter((s) => s.status !== 'interim').length} segments · {live.bookmarks.length} bookmarks/notes
          </div>
          {live.bookmarks.length > 0 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {[...live.bookmarks].reverse().map((b) => (
                <li key={b.id} className="flex gap-2">
                  <span className="font-mono text-muted">{fmtClock(b.atMs)}</span>
                  <span className="font-medium">{BOOKMARK_TYPES.find((t) => t.id === b.type)?.label}</span>
                  <span className="truncate text-muted">{b.label || b.note}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>

      <Dialog
        open={!!editId}
        onClose={() => setEditId(null)}
        title="Edit segment"
        description="Recording continues while you edit. Your correction will never be overwritten by later recognition."
        footer={
          <>
            <Button onClick={() => setEditId(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => void saveEdit()}>
              Save correction
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Select aria-label="Speaker" value={editSpeaker ?? ''} onChange={(e) => setEditSpeaker(e.target.value || null)}>
            <option value="">Unassigned</option>
            {session.participants.map((p) => (
              <option key={p.id} value={p.id}>{speakerName(session.participants, p.id)}</option>
            ))}
          </Select>
          <Textarea ref={editRef} rows={5} className="transcript-text" value={editText} onChange={editField.onChange} aria-label="Segment text" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => insertMarker(INAUDIBLE)}>Insert (inaudible)</Button>
            <Button size="sm" onClick={() => insertMarker(UNCLEAR)}>Insert (unclear)</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

function ToolButton({ label, icon, onClick, sub, compact }: { label: string; icon: React.ReactNode; onClick: () => void; sub?: string; compact?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={sub ? `${label}: ${sub}` : label} className={cn('flex min-h-14 min-w-11 flex-col items-center justify-center gap-0.5 rounded-xl text-[0.7rem] font-medium text-text hover:bg-surface-2 [&_svg]:size-5', compact && 'px-0')}>
      {icon}
      <span className="max-w-full truncate">{sub ?? label}</span>
    </button>
  )
}
