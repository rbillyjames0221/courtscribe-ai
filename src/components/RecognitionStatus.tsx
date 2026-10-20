import { useState } from 'react'
import { AlertTriangle, Copy, Cpu, Ear, Info, Mic, MicOff, RefreshCw } from 'lucide-react'
import { useLive } from '@/store/live'
import { speechEnv } from '@/lib/speech/env'
import { Button } from '@/components/ui/button'
import { Banner } from '@/components/ui/states'
import { cn } from '@/lib/utils'

function CopyLink() {
  const [done, setDone] = useState(false)
  return (
    <Button
      size="sm"
      onClick={() => {
        void navigator.clipboard?.writeText(location.origin).then(() => setDone(true))
      }}
    >
      <Copy /> {done ? 'Link copied' : 'Copy link'}
    </Button>
  )
}

/** Visible, actionable recognition problems and modes (never silent). */
export function RecognitionBanners() {
  const live = useLive()
  const s = live.session
  if (!s || s.mode === 'steno') return null
  const err = live.providerError
  const showErr = err && ['error', 'unsupported', 'reconnecting', 'offline'].includes(live.providerStatus)
  const env = speechEnv()
  return (
    <>
      {showErr && (
        <Banner
          tone={live.providerStatus === 'error' || live.providerStatus === 'unsupported' ? 'danger' : 'warning'}
          icon={<AlertTriangle className="text-recording" />}
          action={
            live.providerStatus === 'unsupported' ? (
              <CopyLink />
            ) : (
              <Button size="sm" onClick={() => void live.retryRecognition()}>
                <RefreshCw /> Retry
              </Button>
            )
          }
        >
          <p className="font-semibold" data-testid="recognition-error">
            Live transcription problem: {err.message}
          </p>
          {err.action && <p className="mt-0.5">{err.action}</p>}
          <p className="mt-0.5 text-xs text-muted">Error code: {err.code}{live.audioMode === 'recording' ? ' · Audio is still being saved.' : ''}</p>
          {live.providerStatus === 'unsupported' && env.inAppBrowser && <p className="mt-1 text-xs">Tip: copy the link, open Chrome, and paste it in the address bar.</p>}
        </Banner>
      )}
      {live.contention && (
        <Banner tone="warning" icon={<MicOff className="text-warning" />} action={<Button size="sm" variant="primary" onClick={() => void live.setAudioPriority('transcription', live.contention)}>Prioritize live text</Button>}>
          <p className="font-semibold">Live text isn't getting the microphone.</p>
          <p>{live.contention} Audio recording is holding the mic. Prioritize live text (stops saving audio), or keep recording and use "Transcribe recording" in Review afterwards.</p>
        </Banner>
      )}
      {live.audioMode === 'transcription-priority' && (
        <details className="rounded-2xl border border-interactive/25 bg-interactive/6 px-4 py-2 text-sm" data-testid="priority-banner">
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 font-semibold">
            <Ear className="size-4 shrink-0 text-interactive" /> Transcription priority · audio is not being saved <span className="ml-auto text-xs font-normal text-interactive underline">Why?</span>
          </summary>
          <div className="space-y-2 pb-2 leading-relaxed">
            <p>{live.audioModeReason} Live speech recognition has the microphone so words appear as you speak. The transcript, notes and bookmarks are saved; there will be no audio playback for this part.</p>
            <p>Need audio too? Start the session with <b>On-device Whisper</b>: it records audio and transcribes on this phone (text a few seconds behind, free, works offline after a one-time download).</p>
            <Button size="sm" onClick={() => void live.setAudioPriority('both')}>
              <Mic /> Record audio instead {env.android ? '(live text may stop)' : ''}
            </Button>
          </div>
        </details>
      )}
      {live.model?.state === 'loading' && (s.providerId === 'whisper' || live.fallbackActive) && (
        <Banner tone="info" icon={<Cpu className="text-interactive" />}>
          <p className="font-semibold">Loading on-device Whisper model{live.model.total ? ` — ${Math.round(((live.model.loaded ?? 0) / live.model.total) * 100)}% of ${Math.round(live.model.total / 1e6)} MB` : '…'}</p>
          <p className="text-xs text-muted">One-time download, then cached for offline use. Audio said meanwhile is kept and transcribed once ready.</p>
          {!!live.model.total && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full bg-interactive transition-all" style={{ width: `${((live.model.loaded ?? 0) / live.model.total) * 100}%` }} />
            </div>
          )}
        </Banner>
      )}
      {live.phase === 'recording' && live.providerStatus === 'listening' && s.providerId === 'webspeech' && live.resultCount === 0 && live.noSpeechCount >= 3 && (
        <Banner tone="info" icon={<Info className="text-interactive" />}>
          Listening, but no speech detected yet. Speak clearly toward the phone's microphone. If the level bar moves but no words appear, tap ⋯ → Reconnect.
        </Banner>
      )}
    </>
  )
}

/** Compact live indicator: what the recognizer is doing right now. */
export function ListeningIndicator({ className }: { className?: string }) {
  const { providerStatus, speechActivity, session, phase, model, recState } = useLive()
  if (!session || session.mode === 'steno') return null
  let label = 'Starting speech recognition…'
  let tone = 'text-muted'
  if (phase === 'paused') label = 'Paused'
  else if (providerStatus === 'listening') {
    if (session.providerId === 'whisper') label = 'Transcribing on device — text appears in blocks every ~10 s'
    else label = speechActivity === 'speech' ? 'Hearing speech…' : 'Listening…'
    tone = 'text-success'
  } else if (providerStatus === 'connecting' && model?.state === 'loading') label = 'Loading on-device model…'
  else if (providerStatus === 'connecting' && session.providerId === 'webspeech' && recState?.started) {
    label = 'Recognizer started — waiting for microphone audio…'
    tone = 'text-warning'
  }
  else if (providerStatus === 'reconnecting') {
    label = 'Restarting recognition…'
    tone = 'text-warning'
  } else if (providerStatus === 'error' || providerStatus === 'unsupported') {
    label = 'Live transcription stopped — see message above'
    tone = 'text-recording'
  } else if (providerStatus === 'offline') {
    label = 'Offline — live recognition paused'
    tone = 'text-warning'
  }
  return (
    <p className={cn('inline-flex items-center gap-1.5 text-sm font-medium', tone, className)} data-testid="listening-indicator" aria-live="polite">
      <span className={cn('size-2 rounded-full bg-current', providerStatus === 'listening' && phase === 'recording' && 'rec-dot')} />
      {label}
    </p>
  )
}

/** On-device Whisper: proves mic audio is arriving and shows what happens to it. */
export function WhisperDiagLine({ onUnlock }: { onUnlock: () => void }) {
  const d = useLive((s) => s.whisperDiag)
  const phase = useLive((s) => s.phase)
  const [open, setOpen] = useState(false)
  if (!d) return null
  const blocked = d.audio === 'suspended' && phase === 'recording'
  const noAudio = phase === 'recording' && d.audio === 'running' && d.receivedSec < 0.5
  const level = Math.min(1, d.energy / Math.max(0.02, d.noiseFloor * 6))
  const speaking = d.energy > Math.max(d.noiseFloor * 2.8, 0.006)
  return (
    <div className="rounded-2xl border border-border bg-surface px-3 py-2 text-xs" data-testid="whisper-diag">
      {blocked && (
        <div className="mb-2 flex items-center gap-2 text-sm text-recording">
          <AlertTriangle className="size-4 shrink-0" /> The browser paused on-device audio processing.
          <Button size="sm" variant="primary" className="ml-auto" onClick={onUnlock}>Tap to enable</Button>
        </div>
      )}
      {noAudio && <p className="mb-1 text-sm text-recording">No microphone audio is reaching on-device transcription. Stop and start again, and check that no other app is using the mic.</p>}
      <button type="button" className="flex min-h-8 w-full items-center gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="inline-flex h-2 w-16 overflow-hidden rounded-full bg-surface-2" aria-label="Mic level">
          <span className={cn('h-full transition-all', speaking ? 'bg-success' : 'bg-muted')} style={{ width: `${Math.round(level * 100)}%` }} />
        </span>
        <span className={speaking ? 'font-medium text-success' : 'text-muted'}>{speaking ? 'Speech detected' : 'Silence / background noise — ignored'}</span>
        <span className="ml-auto text-muted">
          {d.segments} lines · {d.queued > 0 ? 'transcribing…' : 'idle'}
        </span>
      </button>
      {open && (
        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted">
          <dt>Audio</dt><dd>{d.audio} · {d.receivedSec.toFixed(0)} s received</dd>
          <dt>Speech heard</dt><dd>{d.speechSec.toFixed(1)} s in {d.utterances} utterances</dd>
          <dt>Noise floor / level</dt><dd>{d.noiseFloor.toFixed(4)} / {d.energy.toFixed(4)}</dd>
          <dt>Ignored as noise</dt><dd>{d.discarded} short bursts</dd>
          <dt>Whisper runs</dt><dd>{d.transcribed}{d.lastProcessMs ? ` · last ${(d.lastProcessMs / 1000).toFixed(1)} s` : ''}</dd>
          <dt>Rejected output</dt><dd>{d.filtered}{d.lastFiltered ? ` (${d.lastFiltered})` : ''}</dd>
          {d.dropped > 0 && (<><dt>Skipped (device too slow)</dt><dd>{d.dropped}</dd></>)}
        </dl>
      )}
    </div>
  )
}
