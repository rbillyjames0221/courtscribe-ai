import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, Copy, Mic, Play, Square, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLive } from '@/store/live'
import { copyText, envReport } from '@/lib/diag/report'

type Rec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  [k: string]: unknown
}

const EVENTS = ['start', 'audiostart', 'soundstart', 'speechstart', 'speechend', 'soundend', 'audioend', 'result', 'nomatch', 'error', 'end'] as const

/**
 * Bare SpeechRecognition test: one recognizer, started directly in the tap handler,
 * no MediaRecorder / AudioContext / level meter, raw event log. Isolates browser + phone issues.
 */
export default function DiagSpeech() {
  const live = useLive()
  const busy = live.phase === 'recording' || live.phase === 'paused' || live.phase === 'starting'
  const [lang, setLang] = useState('en-US')
  const [continuous, setContinuous] = useState(false)
  const [interim, setInterim] = useState(true)
  const [lines, setLines] = useState<string[]>([])
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)
  const rec = useRef<Rec | null>(null)
  const t0 = useRef(0)

  const add = (s: string) => {
    const t = t0.current ? ((performance.now() - t0.current) / 1000).toFixed(2) : '0.00'
    setLines((l) => [...l.slice(-499), `+${t.padStart(6)}s  ${s}`])
  }
  useEffect(() => () => rec.current?.abort(), [])

  const start = () => {
    // Synchronous, inside the tap: no awaits before start().
    const C = (window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    if (!t0.current) t0.current = performance.now()
    if (!C) {
      add('ERROR: SpeechRecognition is not available in this browser')
      return
    }
    rec.current?.abort()
    const r = new (C as new () => Rec)()
    r.lang = lang
    r.continuous = continuous
    r.interimResults = interim
    r.maxAlternatives = 1
    for (const ev of EVENTS) {
      r[`on${ev}`] = (e: Event & { error?: string; message?: string; resultIndex?: number; results?: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }> }) => {
        if (rec.current !== r) return
        if (ev === 'result' && e.results) {
          const parts: string[] = []
          let all = ''
          for (let i = 0; i < e.results.length; i++) {
            const res = e.results[i]
            all += res[0].transcript
            if (i >= (e.resultIndex ?? 0)) parts.push(`[${i}${res.isFinal ? ' final' : ''} ${res[0].confidence?.toFixed?.(2) ?? ''}] "${res[0].transcript}"`)
          }
          setText(all)
          add(`result  ${parts.join(' ')}`)
        } else if (ev === 'error') add(`error  ${e.error}${e.message ? ` (${e.message})` : ''}`)
        else add(ev)
        if (ev === 'end') setRunning(false)
      }
    }
    rec.current = r
    try {
      r.start()
      setRunning(true)
      add(`start() called  lang=${lang} continuous=${continuous} interim=${interim}`)
    } catch (err) {
      add(`start() threw: ${(err as Error).message}`)
    }
  }
  const stop = () => {
    add('stop() called')
    rec.current?.stop()
  }
  const abort = () => {
    add('abort() called')
    rec.current?.abort()
  }
  const micTest = async () => {
    add('getUserMedia({audio}) …')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      const tr = s.getAudioTracks()[0]
      add(`getUserMedia OK: "${tr?.label}" state=${tr?.readyState} muted=${tr?.muted} — releasing now`)
      s.getTracks().forEach((t) => t.stop())
    } catch (err) {
      add(`getUserMedia FAILED: ${(err as Error).name} ${(err as Error).message}`)
    }
  }
  const copy = async () => {
    const head = await envReport({ page: 'diag/speech', lang, continuous, interim, liveEngine: live.phase })
    if (await copyText(`${head}\n\nTranscript: ${text || '(none)'}\n\n${lines.join('\n')}`)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 text-sm">
      <div className="flex items-center gap-2">
        <Link to="/settings" className="inline-flex size-10 items-center justify-center rounded-full hover:bg-surface" aria-label="Back"><ArrowLeft /></Link>
        <h1 className="text-lg font-semibold">Speech recognition test</h1>
      </div>
      <p className="text-muted">
        A bare browser speech recognizer with nothing else using the microphone. Tap <b>Start</b>, speak a sentence, then tap <b>Copy log</b> and send it to support. A working phone shows
        <span className="font-mono"> start → audiostart → soundstart → speechstart → result …</span>
      </p>
      {busy && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3">
          A recording session is running and may be holding the microphone.{' '}
          <Button size="sm" onClick={() => void live.pause()}>Pause it</Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="col-span-2 flex flex-col gap-1">
          Language
          <select className="h-10 rounded-lg border border-border bg-surface px-2" value={lang} onChange={(e) => setLang(e.target.value)} data-testid="diag-lang">
            {['en-US', 'en-PH', 'fil-PH', 'tl-PH', 'en-GB'].map((l) => <option key={l}>{l}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={continuous} onChange={(e) => setContinuous(e.target.checked)} /> continuous</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={interim} onChange={(e) => setInterim(e.target.checked)} /> interim</label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={start} data-testid="diag-start"><Play /> {running ? 'Restart' : 'Start'}</Button>
        <Button onClick={stop} disabled={!running}><Square /> Stop</Button>
        <Button onClick={abort} disabled={!running}><X /> Abort</Button>
        <Button onClick={() => void micTest()}><Mic /> Test mic access</Button>
      </div>
      <div className="min-h-16 rounded-xl border border-border bg-surface p-3 text-base" data-testid="diag-text">{text || <span className="text-muted">Recognized words appear here…</span>}</div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void copy()} data-testid="diag-copy">{copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy log'}</Button>
        <Button size="sm" onClick={() => { setLines([]); setText(''); t0.current = 0 }}><Trash2 /> Clear</Button>
      </div>
      <pre className="max-h-[50vh] overflow-auto rounded-xl bg-surface p-3 font-mono text-[11px] leading-snug whitespace-pre-wrap" data-testid="diag-log">{lines.join('\n') || '(no events yet)'}</pre>
    </div>
  )
}
