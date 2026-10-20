import { BaseProvider, type ProviderError, type StartOptions } from './provider'
import type { Language } from '../types'

/* Minimal typings for the (still prefixed) Web Speech API. */
type SRAlternative = { transcript: string; confidence: number }
type SRResult = { isFinal: boolean; length: number; [i: number]: SRAlternative }
type SREvent = { resultIndex: number; results: { length: number; [i: number]: SRResult } }
type SRErrorEvent = { error: string; message?: string }
interface SR {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: SREvent) => void) | null
  onerror: ((e: SRErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type SRCtor = new () => SR

function getCtor(): SRCtor | null {
  const w = globalThis as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function bcp47(lang: Language): string {
  // Experimental mixed mode uses the Filipino recognizer, which tolerates some English;
  // true intra-sentence code-switching is NOT guaranteed by any browser engine.
  return lang === 'en-PH' ? 'en-PH' : 'fil-PH'
}

/**
 * Browser speech recognition (Chrome / Edge / Android Chrome; Safari partial).
 * Runs on the browser vendor's recognizer — audio may be sent to the vendor's servers.
 * Long sessions are handled by automatic rollover: each recognizer run gets a new key prefix.
 */
export class WebSpeechProvider extends BaseProvider {
  readonly id = 'webspeech'
  readonly label = 'Browser speech recognition (Web Speech API)'
  private rec: SR | null = null
  private opts: StartOptions | null = null
  private run = 0
  private active = false
  private paused = false
  private starts = new Map<string, number>()
  private failures = 0
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private lastFinalText = new Map<string, string>()

  isSupported() {
    return getCtor() !== null
  }

  async startSession(opts: StartOptions) {
    if (!this.isSupported()) {
      this.setStatus('unsupported', { code: 'unsupported', message: 'This browser has no speech recognition. Use Chrome or Edge, or switch to Manual/Steno mode.', recoverable: false })
      return
    }
    this.opts = opts
    this.active = true
    this.paused = false
    this.setStatus('connecting')
    this.spawn()
  }

  private spawn() {
    const Ctor = getCtor()
    if (!Ctor || !this.opts || !this.active || this.paused) return
    this.run += 1
    const run = this.run
    const rec = new Ctor()
    rec.lang = bcp47(this.opts.language)
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.onstart = () => {
      if (run !== this.run) return
      this.setStatus('listening')
    }
    rec.onresult = (e) => {
      if (run !== this.run || !this.opts) return
      this.failures = 0
      const now = this.opts.clock()
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const alt = res[0]
        if (!alt) continue
        const key = `ws${run}:i${i}`
        if (!this.starts.has(key)) this.starts.set(key, Math.max(0, now - 600))
        const text = alt.transcript.trim()
        if (res.isFinal) {
          if (this.lastFinalText.get(key) === text) continue
          this.lastFinalText.set(key, text)
        }
        this.emit({ key, text, isFinal: res.isFinal, startMs: this.starts.get(key)!, endMs: now, confidence: res.isFinal && alt.confidence > 0 ? alt.confidence : undefined, language: rec.lang })
      }
    }
    rec.onerror = (e) => {
      if (run !== this.run) return
      const err = this.handleError(e)
      if (err.code === 'no-speech' || err.code === 'aborted') return // onend will roll over
      if (!err.recoverable) {
        this.active = false
        this.setStatus('error', err)
      } else {
        this.failures += 1
        this.setStatus(navigator.onLine ? 'reconnecting' : 'offline', err)
      }
    }
    rec.onend = () => {
      if (run !== this.run) return
      if (!this.active || this.paused) return
      // Rollover: Chrome ends continuous sessions after silence or ~60s. Restart with backoff.
      const delay = Math.min(8000, 250 * 2 ** Math.min(this.failures, 5))
      if (this.failures > 0) this.setStatus(navigator.onLine ? 'reconnecting' : 'offline')
      this.restartTimer = setTimeout(() => this.spawn(), delay)
    }
    this.rec = rec
    try {
      rec.start()
    } catch (err) {
      this.failures += 1
      this.setStatus('reconnecting', this.handleError(err))
      this.restartTimer = setTimeout(() => this.spawn(), 1000)
    }
  }

  private teardown() {
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    const rec = this.rec
    this.rec = null
    this.run += 1 // invalidate callbacks of the old recognizer
    try {
      rec?.stop()
    } catch {
      /* ignore */
    }
  }

  pause() {
    this.paused = true
    this.teardown()
    this.setStatus('paused')
  }
  resume() {
    if (!this.active) return
    this.paused = false
    this.setStatus('connecting')
    this.spawn()
  }
  async reconnect() {
    this.failures = 0
    this.teardown()
    this.active = true
    this.paused = false
    this.setStatus('reconnecting')
    this.spawn()
  }
  async finishSession() {
    this.active = false
    this.teardown()
    this.setStatus('stopped')
  }

  handleError(e: unknown): ProviderError {
    const code = (e as SRErrorEvent)?.error ?? 'unknown'
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed':
        return { code, message: 'Speech recognition permission was denied. Audio is still being recorded.', recoverable: false }
      case 'network':
        return { code, message: 'Speech service unreachable. Audio is still being recorded locally; recognition will retry.', recoverable: true }
      case 'audio-capture':
        return { code, message: 'No microphone available to the recognizer.', recoverable: true }
      case 'language-not-supported':
        return { code, message: 'This browser does not support the selected recognition language.', recoverable: false }
      case 'no-speech':
      case 'aborted':
        return { code, message: code, recoverable: true }
      default:
        return { code, message: (e as SRErrorEvent)?.message || (e instanceof Error ? e.message : String(code)), recoverable: true }
    }
  }
}
