import { useEffect, useRef, useState } from 'react'
import { Cpu, Loader2, Sparkles, X } from 'lucide-react'
import type { Language, Session } from '@/lib/types'
import { LANGUAGES } from '@/lib/types'
import { WHISPER_MODELS, type WhisperModelId } from '@/lib/whisper/models'
import { isModelCached, useWhisper } from '@/lib/whisper/client'
import { transcribeSessionAudio, type TranscribeProgress } from '@/lib/whisper/session'
import { useSettings } from '@/store/settings'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { cn } from '@/lib/utils'

/** "Transcribe recording": on-device Whisper over the session's saved audio (also used for imported files). */
export function TranscribePanel({ session, segmentCount, hasAudio, autoStart, onChanged }: { session: Session; segmentCount: number; hasAudio: boolean; autoStart?: boolean; onChanged: () => void }) {
  const settings = useSettings()
  const whisper = useWhisper()
  const [model, setModel] = useState<WhisperModelId>(settings.whisperModel)
  const [language, setLanguage] = useState<Language>(session.language)
  const [onlyGaps, setOnlyGaps] = useState(segmentCount > 0)
  const [progress, setProgress] = useState<TranscribeProgress | null>(null)
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<string>()
  const [cached, setCached] = useState<boolean>()
  const [open, setOpen] = useState(segmentCount === 0 || !!autoStart)
  const abort = useRef<AbortController | null>(null)
  const started = useRef(false)

  useEffect(() => {
    void isModelCached(model).then(setCached)
  }, [model, progress?.phase])

  const run = async () => {
    setError(undefined)
    setResult(undefined)
    abort.current = new AbortController()
    try {
      const r = await transcribeSessionAudio(session.id, { model, device: settings.whisperDevice, language, onlyGaps, signal: abort.current.signal, onProgress: (p) => { setProgress(p); if (p.phase === 'transcribing') onChanged() } })
      setResult(r.added ? `Added ${r.added} segment${r.added === 1 ? '' : 's'} from on-device Whisper — all marked Needs review. Check names, numbers and Filipino terms against the audio.` : 'Whisper found no new speech to add (silent audio, or already covered by the existing transcript).')
      onChanged()
    } catch (e) {
      if ((e as Error).name === 'AbortError') setResult('Cancelled. Segments already added were kept.')
      else setError((e as Error).message)
    } finally {
      setProgress(null)
      abort.current = null
    }
  }

  useEffect(() => {
    if (autoStart && hasAudio && !started.current) {
      started.current = true
      void run()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, hasAudio])

  if (!hasAudio) {
    return segmentCount === 0 ? (
      <div className="mt-3 rounded-2xl border border-warning/30 bg-warning/8 p-4 text-sm leading-relaxed">
        <p className="font-semibold">No transcript and no saved audio</p>
        <p>
          {session.transcriptionPriority
            ? 'This session ran in transcription priority (live text had the microphone), but no words were recognized, so there is nothing to transcribe afterwards.'
            : 'Audio saving was off for this session, so it cannot be transcribed afterwards.'}{' '}
          Next time, use <b>Test speech recognition</b> on the New Session screen first, or choose <b>On-device Whisper</b> so audio is kept and can be transcribed.
        </p>
      </div>
    ) : null
  }

  const busy = !!progress
  const m = WHISPER_MODELS[model]
  const pct = progress?.phase === 'model' && whisper.total ? whisper.loaded / whisper.total : progress?.total ? progress.done / progress.total : 0
  return (
    <section className={cn('mt-3 rounded-2xl border p-4', segmentCount === 0 ? 'border-interactive/30 bg-interactive/6' : 'border-border bg-surface')} aria-label="Transcribe recording">
      {segmentCount === 0 && !busy && !result && (
        <div className="mb-3 text-sm leading-relaxed">
          <p className="font-semibold">{session.recordingSource === 'none' ? 'Imported audio — not transcribed yet.' : 'No transcript was captured while recording.'}</p>
          <p className="text-muted">{session.recordingSource === 'none' ? 'Transcribe it on this device with Whisper (free, private, no upload).' : <>Browser live recognition only works while you speak and cannot process saved audio{session.providerId === 'webspeech' ? ' — on Android it also cannot run while audio is being recorded' : ''}. You can transcribe the saved recording on this device with Whisper (free, private).</>}</p>
        </div>
      )}
      <button type="button" className="flex min-h-11 w-full items-center gap-2 text-left font-semibold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Sparkles className="size-5 text-interactive" /> Transcribe recording (on-device Whisper)
        <span className="ml-auto text-xs font-normal text-muted">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-muted">Model</span>
              <Select value={model} onChange={(e) => setModel(e.target.value as WhisperModelId)} disabled={busy} aria-label="Whisper model">
                {(Object.keys(WHISPER_MODELS) as WhisperModelId[]).map((k) => (
                  <option key={k} value={k}>{WHISPER_MODELS[k].label} · ~{WHISPER_MODELS[k].sizeMb} MB</option>
                ))}
              </Select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted">Language</span>
              <Select value={language} onChange={(e) => setLanguage(e.target.value as Language)} disabled={busy} aria-label="Transcription language">
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>{l.id === 'mixed' ? 'Auto-detect (mixed)' : l.label}</option>
                ))}
              </Select>
            </label>
          </div>
          {segmentCount > 0 && (
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" className="size-5 accent-[var(--cs-primary)]" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} disabled={busy} />
              Only fill gaps (skip parts that already have live text). Lines you edited, and earlier on-device text, are never duplicated or changed.
            </label>
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Cpu className="size-3.5" /> {cached ? 'Model downloaded — works offline.' : `One-time download ~${m.sizeMb} MB, then cached.`} {m.hint}
          </p>
          {busy ? (
            <div className="space-y-2" data-testid="transcribe-progress">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" />
                {progress!.phase === 'model' ? `Loading model${whisper.total ? ` ${Math.round(pct * 100)}% (${Math.round(whisper.total / 1e6)} MB)` : '…'}` : progress!.phase === 'decoding' ? 'Decoding audio…' : `Transcribing ${progress!.done}/${progress!.total} · ${progress!.added} segments added`}
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => abort.current?.abort()}>
                  <X /> Cancel
                </Button>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full bg-interactive transition-all" style={{ width: `${Math.round(pct * 100)}%` }} />
              </div>
              <p className="text-xs text-muted">Keep this screen open. Long recordings take a while on phones (roughly 0.3–1× the audio length with Whisper tiny).</p>
            </div>
          ) : (
            <Button variant="primary" onClick={() => void run()} data-testid="transcribe-start">
              <Sparkles /> {segmentCount > 0 ? 'Transcribe recording' : 'Transcribe recording now'}
            </Button>
          )}
          {result && <p className="text-sm text-success" role="status">{result}</p>}
          {error && (
            <p className="text-sm text-recording" role="alert">
              Transcription failed: {error}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
