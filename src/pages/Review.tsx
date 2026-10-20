import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Check, Download, FastForward, History, ListFilter, Mic, Pause, PencilLine, Play, Plus, Redo2, Replace, Rewind, Search, Trash2, Undo2, Bookmark as BookmarkIcon, Volume2,
} from 'lucide-react'
import { repo } from '@/lib/db'
import { uid } from '@/lib/id'
import { buildRuns, computePeaks, runAt, type AudioRun } from '@/lib/audio/playback'
import { editText as editSeg, findReplace, INAUDIBLE, manualSegment, nextSeq, restoreSnapshot, setReviewed, setSpeaker, sortSegments, UNCLEAR } from '@/lib/segments'
import { useStenoField } from '@/components/useStenoField'
import { fmtClock, fmtDate, fmtDateTime } from '@/lib/time'
import type { Bookmark, Segment, Session } from '@/lib/types'
import { BOOKMARK_TYPES } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useLive } from '@/store/live'
import { useSettings } from '@/store/settings'
import { useSessions } from '@/store/sessions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'
import { Input, Select, Textarea } from '@/components/ui/field'
import { Banner, EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { SegmentRow, speakerName } from '@/components/Transcript'
import { Disclaimer } from '@/components/Disclaimer'

type UndoEntry = { segmentId: string; before: Segment; label: string }

export default function Review() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const settings = useSettings()
  const liveId = useLive((s) => s.session?.id)
  const [session, setSession] = useState<Session | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [runs, setRuns] = useState<AudioRun[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string>()
  const [peaks, setPeaks] = useState<number[]>([])
  const [playing, setPlaying] = useState(false)
  const [currentMs, setCurrentMs] = useState(0)
  const [rate, setRate] = useState(1)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [draftSpeaker, setDraftSpeaker] = useState<string | null>(null)
  const [undo, setUndo] = useState<UndoEntry[]>([])
  const [redo, setRedo] = useState<UndoEntry[]>([])
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [showReplace, setShowReplace] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [newLine, setNewLine] = useState('')
  const [newSpeaker, setNewSpeaker] = useState<string | null>(null)
  const [stopAt, setStopAt] = useState<number | null>(null)
  const [msg, setMsg] = useState<string>()
  const audio = useRef<HTMLAudioElement>(null)
  const activeRun = useRef<AudioRun | null>(null)
  const draftField = useStenoField(draft, setDraft)
  const editRef = draftField.ref
  const newLineField = useStenoField(newLine, setNewLine)

  useEffect(() => {
    let urls: string[] = []
    ;(async () => {
      try {
        const s = await repo.getSession(id)
        if (!s) return setState('missing')
        const [segs, bms, chunks] = await Promise.all([repo.segments(id), repo.bookmarks(id), repo.chunks(id)])
        const r = buildRuns(chunks)
        urls = r.map((x) => x.url)
        setSession(s)
        setSegments(sortSegments(segs))
        setBookmarks(bms.sort((a, b) => a.atMs - b.atMs))
        setRuns(r)
        setNewSpeaker(s.participants[0]?.id ?? null)
        setState('ready')
        if (r.length === 1) void computePeaks(r[0].url).then(setPeaks)
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e))
        setState('error')
      }
    })()
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [id])

  const durationMs = useMemo(() => Math.max(session?.durationMs ?? 0, runs.at(-1)?.endMs ?? 0, segments.at(-1)?.endMs ?? 0), [session, runs, segments])

  // ---------- audio ----------
  const seek = useCallback(
    (ms: number, play = true) => {
      const el = audio.current
      const run = runAt(runs, ms)
      if (!el || !run) return
      if (activeRun.current?.url !== run.url) {
        activeRun.current = run
        el.src = run.url
      }
      const target = Math.max(0, (ms - run.offsetMs) / 1000)
      const apply = () => {
        el.currentTime = target
        el.playbackRate = rate
        if (play) void el.play().catch(() => setMsg('Playback was blocked. Press play.'))
      }
      if (el.readyState >= 1) apply()
      else el.addEventListener('loadedmetadata', apply, { once: true })
      setCurrentMs(ms)
    },
    [runs, rate],
  )
  useEffect(() => {
    const el = audio.current
    if (!el) return
    const onTime = () => {
      const ms = (activeRun.current?.offsetMs ?? 0) + el.currentTime * 1000
      setCurrentMs(ms)
      if (stopAt !== null && ms >= stopAt) {
        el.pause()
        setStopAt(null)
      }
    }
    const onEnded = () => {
      const idx = runs.findIndex((r) => r.url === activeRun.current?.url)
      if (idx >= 0 && runs[idx + 1]) seek(runs[idx + 1].offsetMs, true)
      else setPlaying(false)
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('ended', onEnded)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
    }
  }, [runs, seek, stopAt])
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate
  }, [rate])
  const togglePlay = () => {
    const el = audio.current
    if (!el || !runs.length) return
    if (!activeRun.current) return seek(currentMs, true)
    if (el.paused) void el.play()
    else el.pause()
  }
  const playPassage = (s: Segment) => {
    setStopAt(s.endMs + 1500)
    seek(Math.max(0, s.startMs - 1500), true)
  }

  const activeSegId = useMemo(() => {
    if (!playing && currentMs === 0) return null
    let found: string | null = null
    for (const s of segments) if (s.startMs <= currentMs + 150) found = s.id
    return found
  }, [segments, currentMs, playing])

  // ---------- edits ----------
  const commit = useCallback(
    async (next: Segment, label: string, before: Segment) => {
      if (next === before) return
      setSegments((list) => list.map((s) => (s.id === next.id ? next : s)))
      setUndo((u) => [...u.slice(-99), { segmentId: next.id, before, label }])
      setRedo([])
      await repo.putSegments([next])
    },
    [],
  )
  const touchSession = useCallback(async () => {
    if (!session) return
    const next = { ...session, updatedAt: Date.now() }
    setSession(next)
    await repo.putSession(next)
    void useSessions.getState().refresh()
  }, [session])

  const startEdit = (s: Segment) => {
    setEditingId(s.id)
    setDraft(s.text)
    setDraftSpeaker(s.speakerId)
  }
  const saveEdit = async () => {
    const s = segments.find((x) => x.id === editingId)
    if (!s) return setEditingId(null)
    let next = editSeg(s, draft, Date.now())
    next = setSpeaker(next, draftSpeaker, Date.now())
    await commit(next, 'Edit', s)
    setEditingId(null)
    void touchSession()
  }
  const doUndo = async () => {
    const e = undo.at(-1)
    if (!e) return
    const cur = segments.find((s) => s.id === e.segmentId)
    if (!cur) return
    const restored = restoreSnapshot(cur, e.before, Date.now())
    setSegments((list) => list.map((s) => (s.id === cur.id ? restored : s)))
    setUndo((u) => u.slice(0, -1))
    setRedo((r) => [...r, { segmentId: cur.id, before: cur, label: e.label }])
    await repo.putSegments([restored])
  }
  const doRedo = async () => {
    const e = redo.at(-1)
    if (!e) return
    const cur = segments.find((s) => s.id === e.segmentId)
    if (!cur) return
    const restored = { ...restoreSnapshot(cur, e.before, Date.now()) }
    restored.revisions[restored.revisions.length - 1] = { ...restored.revisions[restored.revisions.length - 1], note: 'Redo' }
    setSegments((list) => list.map((s) => (s.id === cur.id ? restored : s)))
    setRedo((r) => r.slice(0, -1))
    setUndo((u) => [...u, { segmentId: cur.id, before: cur, label: e.label }])
    await repo.putSegments([restored])
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        void (e.shiftKey ? doRedo() : doUndo())
      } else if (e.key === ' ' && tag !== 'BUTTON') {
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const insertMarker = (m: string) => {
    const el = editRef.current
    const pos = el?.selectionStart ?? draft.length
    const end = el?.selectionEnd ?? pos
    setDraft(`${draft.slice(0, pos)}${pos > 0 && draft[pos - 1] !== ' ' ? ' ' : ''}${m}${draft.slice(end)}`)
  }
  const replaceAll = async () => {
    if (!findText) return
    const changed: Segment[] = []
    const entries: UndoEntry[] = []
    const now = Date.now()
    const next = segments.map((s) => {
      const n = findReplace(s, findText, replaceText, now)
      if (n !== s) {
        changed.push(n)
        entries.push({ segmentId: s.id, before: s, label: 'Replace' })
      }
      return n
    })
    setSegments(next)
    setUndo((u) => [...u, ...entries])
    setRedo([])
    await repo.putSegments(changed)
    setMsg(`${changed.length} segment${changed.length === 1 ? '' : 's'} updated. Undo reverts them one at a time.`)
    void touchSession()
  }

  const addLine = async () => {
    if (!session || !newLine.trim()) return
    const seg = manualSegment({ id: uid('seg'), sessionId: session.id, seq: nextSeq(segments), text: newLine, startMs: Math.round(currentMs), speakerId: newSpeaker, source: session.mode === 'steno' ? 'steno' : 'manual', now: Date.now() })
    setSegments((l) => sortSegments([...l, seg]))
    await repo.putSegments([seg])
    setNewLine('')
    void touchSession()
  }

  // ---------- filtering ----------
  const bmBySeg = useMemo(() => {
    const m = new Map<string, Bookmark[]>()
    for (const b of bookmarks) if (b.segmentId) m.set(b.segmentId, [...(m.get(b.segmentId) ?? []), b])
    return m
  }, [bookmarks])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return segments.filter((s) => {
      if (q && !s.text.toLowerCase().includes(q)) return false
      if (filter === 'all') return true
      if (filter === 'bookmarked') return bmBySeg.has(s.id)
      if (filter === 'needs_review') return s.status === 'needs_review' || s.status === 'inaudible' || s.status === 'interim'
      if (filter === 'corrected') return s.status === 'corrected' || s.userEdited
      if (filter === 'unreviewed') return !s.reviewed
      if (filter.startsWith('spk:')) return s.speakerId === filter.slice(4)
      return true
    })
  }, [segments, query, filter, bmBySeg])

  if (state === 'loading') return <LoadingState label="Loading transcript…" />
  if (state === 'missing') return <div className="p-6"><EmptyState title="Session not found" body="It may have been deleted from this device." action={<Button onClick={() => nav('/sessions')}>All sessions</Button>} /></div>
  if (state === 'error' || !session) return <div className="p-6"><ErrorState body={loadError} /></div>

  const reviewedCount = segments.filter((s) => s.reviewed).length
  const historySeg = segments.find((s) => s.id === historyId)

  return (
    <div className="mx-auto max-w-4xl px-3 pt-[calc(0.75rem+var(--safe-top))] pb-6 sm:px-6">
      <audio ref={audio} preload="metadata" className="hidden" />
      <header className="flex items-start gap-2">
        <Button size="icon" variant="ghost" aria-label="Back to sessions" onClick={() => nav('/sessions')}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{session.title}</h1>
          <p className="truncate text-sm text-muted">{[session.caseNumber, session.venue, fmtDate(session.sessionDate), fmtClock(durationMs)].filter(Boolean).join(' · ')}</p>
        </div>
        <Link to={`/sessions/${id}/export`} aria-label="Export transcript" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-4 font-medium text-on-primary">
          <Download className="size-5" /> <span className="hidden sm:inline">Export</span>
        </Link>
      </header>

      <div className="mt-2 flex flex-wrap items-center gap-2 pl-14 text-xs">
        <Badge tone="warning">DRAFT · not certified</Badge>
        <Badge tone="success">{reviewedCount}/{segments.length} reviewed</Badge>
        <Badge>{bookmarks.length} bookmarks</Badge>
        {session.id !== liveId && (
          <Link to={`/live/${id}?resume=1`} className="inline-flex min-h-11 items-center gap-1 px-2 font-medium text-interactive">
            <Mic className="size-3.5" /> Continue recording
          </Link>
        )}
      </div>

      {/* Player */}
      <section aria-label="Audio playback" className="sticky top-0 z-10 -mx-3 mt-3 border-y border-border bg-surface/95 px-3 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        {runs.length === 0 ? (
          <p className="flex items-center gap-2 py-2 text-sm text-muted"><Volume2 className="size-4" /> No audio was stored for this session (transcript-only mode or not yet saved).</p>
        ) : (
          <>
            <div className="relative h-12 w-full">
              {peaks.length > 0 ? (
                <div className="absolute inset-0 flex items-center gap-px" aria-hidden>
                  {peaks.map((p, i) => (
                    <span key={i} className={cn('w-full rounded-full', (i / peaks.length) * durationMs <= currentMs ? 'bg-primary' : 'bg-border')} style={{ height: `${Math.max(6, p * 100)}%` }} />
                  ))}
                </div>
              ) : (
                <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${durationMs ? (currentMs / durationMs) * 100 : 0}%` }} />
                </div>
              )}
              {bookmarks.map((b) => (
                <button key={b.id} type="button" title={`${BOOKMARK_TYPES.find((t) => t.id === b.type)?.label} ${fmtClock(b.atMs)}`} aria-label={`Bookmark at ${fmtClock(b.atMs)}`} onClick={() => seek(b.atMs)} className="absolute top-0 z-10 h-3 w-3 -translate-x-1/2 rounded-full bg-warning ring-2 ring-surface" style={{ left: `${durationMs ? (b.atMs / durationMs) * 100 : 0}%` }} />
              ))}
              <input type="range" aria-label="Seek" min={0} max={Math.max(1, durationMs)} step={250} value={Math.min(currentMs, durationMs)} onChange={(e) => seek(Number(e.target.value), playing)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            </div>
            <div className="mt-2 flex items-center gap-1">
              <Button size="icon-sm" variant="ghost" aria-label="Back 5 seconds" onClick={() => seek(Math.max(0, currentMs - 5000), playing)}>
                <Rewind />
              </Button>
              <Button size="icon" variant="primary" className="rounded-full" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
                {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Forward 5 seconds" onClick={() => seek(Math.min(durationMs, currentMs + 5000), playing)}>
                <FastForward />
              </Button>
              <span className="ml-1 font-mono text-sm whitespace-nowrap tabular-nums">
                {fmtClock(currentMs)} <span className="text-muted">/ {fmtClock(durationMs)}</span>
              </span>
              <Select aria-label="Playback speed" value={rate} onChange={(e) => setRate(Number(e.target.value))} className="ml-auto min-h-11 w-20 shrink-0">
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                  <option key={r} value={r}>{r}×</option>
                ))}
              </Select>
            </div>
          </>
        )}
      </section>

      {msg && <div className="mt-3"><Banner tone="info" action={<Button size="sm" onClick={() => setMsg(undefined)}>OK</Button>}>{msg}</Banner></div>}

      {/* Tools */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-muted" />
          <Input type="search" aria-label="Search transcript" placeholder="Search transcript" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10" />
        </div>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1 sm:w-52">
            <ListFilter className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-muted" />
            <Select aria-label="Filter segments" value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-10">
              <option value="all">All segments</option>
              <option value="needs_review">Needs review / inaudible</option>
              <option value="unreviewed">Not yet reviewed</option>
              <option value="corrected">Corrected</option>
              <option value="bookmarked">Bookmarked</option>
              {session.participants.map((p) => (
                <option key={p.id} value={`spk:${p.id}`}>Speaker: {speakerName(session.participants, p.id)}</option>
              ))}
            </Select>
          </div>
          <Button size="icon" aria-label="Find and replace" variant={showReplace ? 'primary' : 'secondary'} onClick={() => setShowReplace((v) => !v)}>
            <Replace />
          </Button>
          <Button size="icon" aria-label={`Undo${undo.length ? ` (${undo.length})` : ''}`} disabled={!undo.length} onClick={() => void doUndo()}>
            <Undo2 />
          </Button>
          <Button size="icon" aria-label="Redo" disabled={!redo.length} onClick={() => void doRedo()}>
            <Redo2 />
          </Button>
        </div>
      </div>
      {showReplace && (
        <div className="mt-2 flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3 sm:flex-row">
          <Input aria-label="Find" placeholder="Find" value={findText} onChange={(e) => setFindText(e.target.value)} />
          <Input aria-label="Replace with" placeholder="Replace with" value={replaceText} onChange={(e) => setReplaceText(e.target.value)} />
          <Button variant="primary" disabled={!findText} onClick={() => void replaceAll()}>
            Replace all
          </Button>
        </div>
      )}

      {/* Transcript */}
      <section className="mt-3 space-y-1 rounded-2xl border border-border bg-surface p-2 sm:p-3" aria-label="Transcript">
        {visible.length === 0 ? (
          <EmptyState className="border-0" title={segments.length ? 'No segments match' : 'No transcript yet'} body={segments.length ? 'Change the search or filter.' : 'Add lines below while listening to the audio, or continue recording.'} />
        ) : (
          visible.map((s) =>
            editingId === s.id ? (
              <SegmentRow key={s.id} segment={s} participants={session.participants} showTimestamp={settings.showTimestamps}>
                <div className="space-y-2 pt-1">
                  <Select aria-label="Speaker" value={draftSpeaker ?? ''} onChange={(e) => setDraftSpeaker(e.target.value || null)}>
                    <option value="">Unassigned</option>
                    {session.participants.map((p) => (
                      <option key={p.id} value={p.id}>{speakerName(session.participants, p.id)}</option>
                    ))}
                  </Select>
                  <Textarea ref={editRef} autoFocus rows={4} className="transcript-text" value={draft} aria-label="Segment text" onChange={draftField.onChange} />
                  {s.originalText && s.originalText !== draft && <p className="text-xs text-muted">Original recognition: “{s.originalText}”</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => insertMarker(INAUDIBLE)}>(inaudible)</Button>
                    <Button size="sm" onClick={() => insertMarker(UNCLEAR)}>(unclear)</Button>
                    <Button size="sm" onClick={() => playPassage(s)}><Play /> Passage</Button>
                    <span className="flex-1" />
                    <Button size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                    <Button size="sm" variant="primary" onClick={() => void saveEdit()}>Save</Button>
                  </div>
                </div>
              </SegmentRow>
            ) : (
              <div key={s.id}>
                <SegmentRow
                  segment={s}
                  participants={session.participants}
                  active={s.id === activeSegId}
                  query={query}
                  showTimestamp={settings.showTimestamps}
                  showConfidence={settings.showConfidence}
                  bookmarks={bmBySeg.get(s.id)}
                  onTimestamp={runs.length ? () => seek(s.startMs) : undefined}
                  onClick={runs.length ? () => seek(s.startMs) : () => startEdit(s)}
                  right={
                    <>
                      <Button size="icon-sm" variant="ghost" aria-label="Edit segment" onClick={(e) => { e.stopPropagation(); startEdit(s) }}>
                        <PencilLine className="size-4.5" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={s.reviewed ? 'Mark not reviewed' : 'Mark reviewed'} onClick={(e) => { e.stopPropagation(); void commit(setReviewed(s, !s.reviewed, Date.now()), 'Review', s) }}>
                        <Check className={cn('size-4.5', s.reviewed ? 'text-success' : 'text-muted')} />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Revision history" onClick={(e) => { e.stopPropagation(); setHistoryId(s.id) }}>
                        <History className="size-4.5 text-muted" />
                      </Button>
                    </>
                  }
                />
                {s.heldProviderText && (
                  <div className="ml-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-muted">
                    Later recognition suggested: “{s.heldProviderText}” — your correction was kept.
                    <button type="button" className="min-h-11 font-medium text-interactive" onClick={() => void commit(editSeg(s, s.heldProviderText!, Date.now(), 'Accepted held recognition'), 'Accept suggestion', s)}>
                      Use suggestion
                    </button>
                  </div>
                )}
              </div>
            ),
          )
        )}
      </section>

      {/* Add line */}
      <section className="mt-3 rounded-2xl border border-border bg-surface p-3">
        <p className="mb-2 text-sm font-medium">Add line at <span className="font-mono">{fmtClock(currentMs)}</span></p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select aria-label="Speaker for new line" value={newSpeaker ?? ''} onChange={(e) => setNewSpeaker(e.target.value || null)} className="sm:w-56">
            <option value="">Unassigned</option>
            {session.participants.map((p) => (
              <option key={p.id} value={p.id}>{speakerName(session.participants, p.id)}</option>
            ))}
          </Select>
          <Textarea rows={1} aria-label="New line text" placeholder="Type (shorthand expands)…" ref={newLineField.ref} value={newLine} onChange={newLineField.onChange} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void addLine() } }} className="min-h-12 flex-1 resize-none" />
          <Button variant="primary" onClick={() => void addLine()} disabled={!newLine.trim()}>
            <Plus /> Add
          </Button>
        </div>
      </section>

      {/* Bookmarks */}
      {bookmarks.length > 0 && (
        <section className="mt-3 rounded-2xl border border-border bg-surface p-3">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><BookmarkIcon className="size-4" /> Bookmarks and notes</h2>
          <ul className="divide-y divide-border">
            {bookmarks.map((b) => (
              <li key={b.id} className="flex items-center gap-2 py-1">
                <button type="button" className="flex min-h-11 flex-1 items-center gap-3 text-left text-sm" onClick={() => seek(b.atMs)}>
                  <span className="font-mono text-xs text-muted">{fmtClock(b.atMs)}</span>
                  <span className="font-medium">{BOOKMARK_TYPES.find((t) => t.id === b.type)?.label}</span>
                  <span className="truncate text-muted">{b.label || b.note}</span>
                </button>
                <Button size="icon-sm" variant="ghost" aria-label="Delete bookmark" onClick={async () => { await repo.deleteBookmark(b.id); setBookmarks((l) => l.filter((x) => x.id !== b.id)) }}>
                  <Trash2 className="size-4 text-muted" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Disclaimer compact className="mt-4" />

      <Dialog open={!!historySeg} onClose={() => setHistoryId(null)} title="Revision history" description="Every change is kept. Restoring creates a new revision; nothing is deleted.">
        {historySeg && (
          <ol className="space-y-2">
            {[...historySeg.revisions].reverse().map((r, i) => (
              <li key={i} className="rounded-xl border border-border p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge tone={r.by === 'user' ? 'primary' : r.by === 'provider' ? 'info' : 'neutral'}>{r.by === 'user' ? 'You' : r.by === 'provider' ? 'Recognition' : 'System'}</Badge>
                  {fmtDateTime(r.at)}
                  {r.note && <span>· {r.note}</span>}
                  <span>· {speakerName(session.participants, r.speakerId)}</span>
                </div>
                <p className="transcript-text text-[1rem]">{r.text}</p>
                {i > 0 && r.text !== historySeg.text && (
                  <button type="button" className="mt-1 min-h-11 text-sm font-medium text-interactive" onClick={() => { void commit(editSeg(historySeg, r.text, Date.now(), 'Restored earlier revision'), 'Restore', historySeg); setHistoryId(null) }}>
                    Restore this text
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </Dialog>
    </div>
  )
}
