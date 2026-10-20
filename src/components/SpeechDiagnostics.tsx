import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bug, Copy, Check } from 'lucide-react'
import { useLive } from '@/store/live'
import { Button } from '@/components/ui/button'
import { copyText, envReport, formatLog } from '@/lib/diag/report'
import { cn } from '@/lib/utils'

function Tick({ ok, label }: { ok: boolean | undefined; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', ok ? 'text-success' : 'text-muted')}>
      <span aria-hidden>{ok ? '✓' : '✗'}</span>
      {label}
    </span>
  )
}

/** Live-screen diagnostics for browser speech recognition: what the recognizer really reported, with a copyable event log. */
export function SpeechDiagnostics() {
  const { recState, recLog, resultCount, phase, providerStatus, audioMode, recognizerLang, session, elapsedMs } = useLive()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const stuck = phase === 'recording' && resultCount === 0 && elapsedMs > 20_000
  useEffect(() => {
    if (stuck) setOpen(true)
  }, [stuck])
  if (!session) return null
  const copy = async () => {
    const head = await envReport({ provider: session.providerId, language: session.language, recognizerLang, audioMode, status: providerStatus, results: resultCount, recState })
    if (await copyText(`${head}\n\n${formatLog(recLog)}`)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }
  return (
    <div className="rounded-2xl border border-border bg-surface px-3 py-2 text-xs" data-testid="speech-diag">
      <button type="button" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Bug className="size-3.5 text-muted" />
        <Tick ok={recState?.started} label="recognizer started" />
        <Tick ok={recState?.audio} label="mic audio" />
        <Tick ok={recState?.speech} label="speech heard" />
        <Tick ok={resultCount > 0} label={`results ${resultCount}`} />
        <span className="text-muted">restarts {Math.max(0, (recState?.runs ?? 1) - 1)}</span>
        <span className="ml-auto text-interactive">{open ? 'Hide log' : 'Diagnostics'}</span>
      </button>
      {stuck && !recState?.audio && (
        <p className="mt-1.5 text-warning">
          The recognizer has not reported any microphone audio. Something else may be using the mic, or this phone's speech service isn't responding. Try the bare <Link className="underline" to="/diag/speech">speech test page</Link> and send the copied log.
        </p>
      )}
      {stuck && recState?.audio && !recState?.speech && <p className="mt-1.5 text-warning">Mic audio is arriving but no speech was detected. Speak closer to the phone, or check the recognizer language.</p>}
      {open && (
        <div className="mt-2 space-y-2">
          <pre className="max-h-56 overflow-auto rounded-lg bg-bg p-2 font-mono text-[11px] leading-snug whitespace-pre-wrap" data-testid="speech-log">{formatLog(recLog)}</pre>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void copy()} data-testid="copy-log">{copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy diagnostics'}</Button>
            <Link to="/diag/speech" className="inline-flex items-center rounded-lg px-2 text-interactive underline">Open bare speech test page</Link>
          </div>
        </div>
      )}
    </div>
  )
}
