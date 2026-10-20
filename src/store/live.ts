/**
 * Live recording engine. Lives outside React so recording continues while the user scrolls,
 * edits, opens sheets, or navigates to other tabs. Audio is saved first; recognition is optional.
 */
import { create } from 'zustand'
import { repo } from '@/lib/db'
import { uid } from '@/lib/id'
import { AudioCapture, LevelMeter, openMic } from '@/lib/audio/capture'
import { editText, manualSegment, mergeProviderResult, nextSeq, setSpeaker as setSegSpeaker, settleInterims, sortSegments } from '@/lib/segments'
import { createProvider, type ProviderId } from '@/lib/speech'
import type { ProviderError, ProviderResultWithHint, ProviderStatus, SpeechProvider } from '@/lib/speech/provider'
import type { Bookmark, BookmarkType, Language, Segment, Session } from '@/lib/types'
import { useSettings } from './settings'
import { useSessions } from './sessions'

export type Phase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'error'

type LiveState = {
  session: Session | null
  phase: Phase
  error?: string
  notice?: string
  elapsedMs: number
  providerStatus: ProviderStatus
  providerError?: ProviderError
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  saveError?: string
  lastSavedAt?: number
  chunkCount: number
  bytes: number
  segments: Segment[]
  bookmarks: Bookmark[]
  currentSpeakerId: string | null
  level: number
  online: boolean
  start: (session: Session, opts?: { resume?: boolean }) => Promise<boolean>
  pause: () => Promise<void>
  resume: () => Promise<void>
  stop: () => Promise<string | null>
  addBookmark: (type: BookmarkType, label?: string, note?: string) => Promise<void>
  addManual: (text: string, source: 'manual' | 'steno') => Promise<void>
  setCurrentSpeaker: (id: string | null) => void
  editSegment: (id: string, text: string) => Promise<void>
  reassign: (id: string, speakerId: string | null) => Promise<void>
  changeLanguage: (lang: Language) => Promise<void>
  retryRecognition: () => Promise<void>
  dismissNotice: () => void
}

// ---- engine internals (module scope, not React) ----
let stream: MediaStream | null = null
let capture: AudioCapture | null = null
let meter: LevelMeter | null = null
let provider: SpeechProvider | null = null
let unsubs: (() => void)[] = []
let tickTimer: ReturnType<typeof setInterval> | null = null
let checkpointTimer: ReturnType<typeof setInterval> | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let wakeLock: { release: () => Promise<void> } | null = null
let chunkSeq = 0
let writeChain: Promise<unknown> = Promise.resolve()
const dirty = new Set<string>()

const enqueue = <T>(fn: () => Promise<T>) => {
  const p = writeChain.then(fn, fn)
  writeChain = p.catch(() => undefined)
  return p
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault()
  e.returnValue = ''
}

export const useLive = create<LiveState>((set, get) => {
  const persistSession = (patch: Partial<Session>) => {
    const s = get().session
    if (!s) return Promise.resolve()
    const next: Session = { ...s, ...patch, updatedAt: Date.now() }
    set({ session: next })
    return enqueue(() => repo.putSession(next))
  }

  const checkpoint = () => {
    const s = get().session
    if (!s || !capture) return Promise.resolve()
    const durationMs = Math.round(capture.clock())
    return persistSession({
      durationMs,
      lastCheckpoint: { at: Date.now(), chunkSeq, segmentCount: get().segments.filter((x) => x.status !== 'interim').length, durationMs },
    })
  }

  const flushSegments = () => {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = null
    if (!dirty.size) return Promise.resolve()
    const ids = new Set(dirty)
    dirty.clear()
    const segs = get().segments.filter((s) => ids.has(s.id))
    set({ saveStatus: 'saving' })
    return enqueue(async () => {
      try {
        await repo.putSegments(segs)
        set({ saveStatus: 'saved', lastSavedAt: Date.now(), saveError: undefined })
      } catch (e) {
        segs.forEach((s) => dirty.add(s.id))
        set({ saveStatus: 'error', saveError: e instanceof Error ? e.message : String(e) })
      }
    })
  }
  const scheduleFlush = (ms: number) => {
    if (flushTimer) return
    flushTimer = setTimeout(() => void flushSegments(), ms)
  }

  const onResult = (r: ProviderResultWithHint) => {
    const { session, segments, currentSpeakerId } = get()
    if (!session) return
    let speakerId = currentSpeakerId
    // Demo script only: use its role hint when a participant with that role exists.
    if (provider?.id === 'mock' && r.speakerRoleHint) {
      const p = session.participants.find((x) => x.role === r.speakerRoleHint)
      if (p) speakerId = p.id
    }
    const out = mergeProviderResult(segments, r, {
      sessionId: session.id,
      speakerId,
      now: Date.now(),
      reviewThreshold: useSettings.getState().reviewThreshold,
    })
    if (out.action === 'ignored' || out.action === 'duplicate' || !out.segment) return
    set({ segments: out.action === 'inserted' ? sortSegments(out.segments) : out.segments })
    dirty.add(out.segment.id)
    scheduleFlush(r.isFinal ? 150 : 1500)
  }

  const attachProvider = async (id: ProviderId, language: Language) => {
    const s = get().session!
    provider = createProvider(id)
    unsubs.push(provider.receiveInterimResult(onResult), provider.receiveFinalResult(onResult))
    unsubs.push(
      provider.onStatus((st, err) => {
        set({ providerStatus: st, providerError: err && err.code !== 'no-speech' ? err : st === 'listening' ? undefined : get().providerError })
      }),
    )
    await provider.startSession({ language, glossary: s.glossary, clock: () => capture?.clock() ?? 0 })
  }

  const detachProvider = async () => {
    const p = provider
    provider = null
    unsubs.forEach((u) => u())
    unsubs = []
    await p?.finishSession().catch(() => {})
  }

  const onlineHandler = () => {
    set({ online: navigator.onLine })
    if (navigator.onLine && provider && get().phase === 'recording') void provider.reconnect()
  }

  const requestWakeLock = async () => {
    if (!useSettings.getState().keepScreenAwake) return
    try {
      const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
      wakeLock = (await wl?.request('screen')) ?? null
    } catch {
      wakeLock = null
    }
  }
  const visibilityHandler = () => {
    if (document.visibilityState === 'visible' && get().phase === 'recording') void requestWakeLock()
    if (document.visibilityState === 'hidden') void checkpoint()
  }

  const cleanup = () => {
    if (tickTimer) clearInterval(tickTimer)
    if (checkpointTimer) clearInterval(checkpointTimer)
    tickTimer = checkpointTimer = null
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    meter?.close()
    meter = null
    capture = null
    void wakeLock?.release().catch(() => {})
    wakeLock = null
    window.removeEventListener('beforeunload', onBeforeUnload)
    window.removeEventListener('online', onlineHandler)
    window.removeEventListener('offline', onlineHandler)
    document.removeEventListener('visibilitychange', visibilityHandler)
  }

  return {
    session: null,
    phase: 'idle',
    elapsedMs: 0,
    providerStatus: 'idle',
    saveStatus: 'idle',
    chunkCount: 0,
    bytes: 0,
    segments: [],
    bookmarks: [],
    currentSpeakerId: null,
    level: 0,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,

    start: async (input, opts) => {
      const cur = get()
      if (cur.phase !== 'idle' && cur.phase !== 'error') return cur.session?.id === input.id
      set({ phase: 'starting', error: undefined, notice: undefined, session: input, segments: [], bookmarks: [], elapsedMs: 0, chunkCount: 0, bytes: 0, providerStatus: 'idle', providerError: undefined, saveStatus: 'idle' })
      const settings = useSettings.getState()
      try {
        const [existingSegs, existingMarks, stats] = await Promise.all([repo.segments(input.id), repo.bookmarks(input.id), repo.chunkStats(input.id)])
        const settled = settleInterims(existingSegs, Date.now())
        if (settled.some((s, i) => s !== existingSegs[i])) await repo.putSegments(settled)
        chunkSeq = stats.lastSeq
        const lastSegEnd = settled.reduce((m, s) => Math.max(m, s.endMs), 0)
        const offset = opts?.resume ? Math.max(input.durationMs, stats.lastEnd, lastSegEnd) : Math.max(stats.lastEnd, input.durationMs)

        stream = await openMic({ echoCancellation: settings.echoCancellation, noiseSuppression: settings.noiseSuppression, autoGainControl: settings.autoGainControl })
        meter = new LevelMeter(stream)
        const run = (input.runCount ?? 0) + 1
        const recordAudio = input.storageMode === 'local' && input.recordingSource === 'microphone'
        capture = new AudioCapture(
          stream,
          offset,
          (blob, meta) => {
            const s = get().session
            if (!s) return
            const seq = ++chunkSeq
            set({ saveStatus: 'saving' })
            void enqueue(async () => {
              try {
                await repo.addChunk({ id: `${s.id}:${seq}`, sessionId: s.id, seq, run, startMs: meta.startMs, endMs: meta.endMs, mimeType: meta.mimeType, size: blob.size, blob, createdAt: Date.now() })
                set((st) => ({ chunkCount: st.chunkCount + 1, bytes: st.bytes + blob.size, saveStatus: 'saved', lastSavedAt: Date.now(), saveError: undefined }))
              } catch (e) {
                set({ saveStatus: 'error', saveError: e instanceof Error ? e.message : 'Could not save audio (storage full?)' })
              }
            })
            void checkpoint()
            if (provider?.consumesAudio) provider.sendAudio(blob, { seq, ...meta })
          },
          Math.max(1, settings.chunkSeconds) * 1000,
          recordAudio,
        )
        stream.getAudioTracks().forEach((t) =>
          t.addEventListener('ended', () => {
            if (get().phase === 'recording' || get().phase === 'paused') {
              set({ notice: 'Microphone was disconnected or taken by another app. Everything up to now is saved — press Resume to continue.' })
              void get().pause()
            }
          }),
        )
        set({
          segments: sortSegments(settled),
          bookmarks: existingMarks.sort((a, b) => a.atMs - b.atMs),
          chunkCount: stats.count,
          bytes: stats.bytes,
          currentSpeakerId: get().currentSpeakerId && input.participants.some((p) => p.id === get().currentSpeakerId) ? get().currentSpeakerId : (input.participants[0]?.id ?? null),
          elapsedMs: offset,
        })
        await persistSession({ status: 'recording', startedAt: input.startedAt ?? Date.now(), runCount: run, durationMs: offset })
        capture.start()
        if (input.mode !== 'steno') await attachProvider(input.providerId as ProviderId, input.language)
        tickTimer = setInterval(() => {
          if (capture) set({ elapsedMs: capture.clock(), level: get().phase === 'recording' ? (meter?.level() ?? 0) : 0 })
        }, 150)
        checkpointTimer = setInterval(() => void checkpoint(), 5000)
        window.addEventListener('beforeunload', onBeforeUnload)
        window.addEventListener('online', onlineHandler)
        window.addEventListener('offline', onlineHandler)
        document.addEventListener('visibilitychange', visibilityHandler)
        void requestWakeLock()
        set({ phase: 'recording', saveStatus: 'saved', lastSavedAt: Date.now() })
        void useSessions.getState().refresh()
        return true
      } catch (e) {
        cleanup()
        await detachProvider()
        const err = e as DOMException
        const msg =
          err?.name === 'NotAllowedError'
            ? 'Microphone permission was denied. Allow microphone access in your browser settings, then try again.'
            : err?.name === 'NotFoundError'
              ? 'No microphone was found on this device.'
              : err?.message || String(e)
        set({ phase: 'error', error: msg })
        return false
      }
    },

    pause: async () => {
      if (get().phase !== 'recording') return
      capture?.pause()
      provider?.pause()
      set({ phase: 'paused', level: 0 })
      await flushSegments()
      await checkpoint()
      await persistSession({ status: 'paused' })
    },

    resume: async () => {
      if (get().phase !== 'paused') return
      if (!stream || stream.getAudioTracks().every((t) => t.readyState === 'ended')) {
        // mic was lost: restart a new capture run on the same timeline
        const s = get().session!
        cleanup()
        await detachProvider()
        set({ phase: 'idle' })
        await get().start({ ...s, durationMs: get().elapsedMs }, { resume: true })
        return
      }
      capture?.resume()
      provider?.resume()
      set({ phase: 'recording', notice: undefined })
      await persistSession({ status: 'recording' })
    },

    stop: async () => {
      const s = get().session
      if (!s || (get().phase !== 'recording' && get().phase !== 'paused')) return null
      set({ phase: 'stopping' })
      await detachProvider()
      await capture?.stop()
      const durationMs = Math.round(capture?.clock() ?? get().elapsedMs)
      const settled = settleInterims(get().segments, Date.now())
      settled.forEach((x, i) => x !== get().segments[i] && dirty.add(x.id))
      set({ segments: settled })
      await flushSegments()
      await writeChain
      await persistSession({ status: 'completed', endedAt: Date.now(), durationMs, lastCheckpoint: { at: Date.now(), chunkSeq, segmentCount: settled.length, durationMs } })
      await writeChain
      cleanup()
      set({ phase: 'idle', session: null, segments: [], bookmarks: [], level: 0, providerStatus: 'idle', elapsedMs: 0 })
      void useSessions.getState().refresh()
      return s.id
    },

    addBookmark: async (type, label = '', note = '') => {
      const { session, segments } = get()
      if (!session) return
      const atMs = Math.round(capture?.clock() ?? get().elapsedMs)
      const last = [...segments].reverse().find((x) => x.startMs <= atMs)
      const b: Bookmark = { id: uid('bm'), sessionId: session.id, type, atMs, label, note, segmentId: last?.id ?? null, createdAt: Date.now() }
      set({ bookmarks: [...get().bookmarks, b] })
      await enqueue(() => repo.putBookmark(b))
    },

    addManual: async (text, source) => {
      const { session, segments, currentSpeakerId } = get()
      if (!session || !text.trim()) return
      const now = Math.round(capture?.clock() ?? get().elapsedMs)
      const seg = manualSegment({ id: uid('seg'), sessionId: session.id, seq: nextSeq(segments), text, startMs: now, speakerId: currentSpeakerId, source, now: Date.now() })
      set({ segments: sortSegments([...segments, seg]) })
      dirty.add(seg.id)
      await flushSegments()
    },

    setCurrentSpeaker: (id) => set({ currentSpeakerId: id }),

    editSegment: async (id, text) => {
      const segs = get().segments.map((s) => (s.id === id ? editText(s, text, Date.now()) : s))
      set({ segments: segs })
      dirty.add(id)
      await flushSegments()
    },

    reassign: async (id, speakerId) => {
      set({ segments: get().segments.map((s) => (s.id === id ? setSegSpeaker(s, speakerId, Date.now()) : s)) })
      dirty.add(id)
      await flushSegments()
    },

    changeLanguage: async (lang) => {
      const s = get().session
      if (!s || s.language === lang) return
      await persistSession({ language: lang })
      if (provider) {
        await detachProvider()
        await attachProvider(s.providerId as ProviderId, lang)
        if (get().phase === 'paused') provider?.pause()
      }
    },

    retryRecognition: async () => {
      const s = get().session
      if (!s || s.mode === 'steno') return
      await detachProvider()
      await attachProvider(s.providerId as ProviderId, s.language)
    },

    dismissNotice: () => set({ notice: undefined }),
  }
})

export function isUnfinished(s: Session, activeId: string | undefined): boolean {
  if (s.id === activeId) return false
  if (s.status === 'interrupted') return true
  if (s.status !== 'recording' && s.status !== 'paused') return false
  const last = s.lastCheckpoint?.at ?? s.updatedAt
  return Date.now() - last > 12_000
}
