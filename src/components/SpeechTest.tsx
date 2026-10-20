import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Ear, Square } from 'lucide-react'
import { WebSpeechProvider } from '@/lib/speech/webspeech'
import type { ProviderError, ProviderStatus } from '@/lib/speech/provider'
import type { Language } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** "Test speech recognition": runs the real browser recognizer and shows words live. */
export function SpeechTest({ language, beforeStart }: { language: Language; beforeStart?: () => void }) {
  const ref = useRef<WebSpeechProvider | null>(null)
  const [status, setStatus] = useState<ProviderStatus>('idle')
  const [err, setErr] = useState<ProviderError>()
  const [finals, setFinals] = useState<string[]>([])
  const [interim, setInterim] = useState('')
  const [lang, setLang] = useState<string>()
  const [activity, setActivity] = useState<string>()

  const stop = () => {
    void ref.current?.finishSession()
    ref.current = null
    setStatus('idle')
  }
  useEffect(() => () => void ref.current?.finishSession(), [])

  const start = () => {
    beforeStart?.() // release any mic test stream first (Android allows only one mic user)
    stop()
    setErr(undefined)
    setFinals([])
    setInterim('')
    const p = new WebSpeechProvider()
    ref.current = p
    const t0 = performance.now()
    p.onStatus((s, e) => {
      setStatus(s)
      if (e && e.code !== 'no-speech') setErr(e)
      else if (s === 'listening') setErr(undefined)
    })
    p.onInfo((i) => {
      if (i.type === 'language') setLang(i.lang)
      if (i.type === 'activity') setActivity(i.state)
    })
    p.receiveInterimResult((r) => setInterim(r.text))
    p.receiveFinalResult((r) => {
      setInterim('')
      setFinals((f) => [...f, r.text])
    })
    // Called synchronously inside the tap so the browser treats it as a user gesture.
    void p.startSession({ language, glossary: [], clock: () => performance.now() - t0 })
    setLang(p.language)
  }

  const running = !!ref.current && status !== 'error' && status !== 'unsupported' && status !== 'stopped'
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button size="sm" onClick={stop}>
            <Square /> Stop test
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={start}>
            <Ear /> Test speech recognition
          </Button>
        )}
        <span className={cn('text-sm', status === 'listening' ? 'text-success' : status === 'error' || status === 'unsupported' ? 'text-recording' : 'text-muted')} data-testid="speech-test-status">
          {status === 'listening' ? (activity === 'speech' ? 'Hearing speech…' : 'Listening… say something') : status === 'connecting' ? 'Starting…' : status === 'reconnecting' ? 'Restarting…' : status === 'error' || status === 'unsupported' ? 'Not working' : 'Say a sentence to check that words appear live.'}
          {lang && running ? ` · ${lang}` : ''}
        </span>
      </div>
      {(finals.length > 0 || interim) && (
        <p className="rounded-lg bg-surface-2 p-2.5 font-serif text-[1.05rem] leading-relaxed" data-testid="speech-test-text" aria-live="polite">
          {finals.join(' ')} <span className="text-muted italic">{interim}</span>
        </p>
      )}
      {err && (
        <div className="flex gap-2 text-sm text-recording" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">{err.message}</p>
            {err.action && <p className="text-text">{err.action}</p>}
            <p className="text-xs text-muted">Error code: {err.code}</p>
          </div>
        </div>
      )}
    </div>
  )
}
