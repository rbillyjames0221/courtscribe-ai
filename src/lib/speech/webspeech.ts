import { BaseProvider, type LogEntry, type ProviderError, type StartOptions } from './provider'
import { langChain, speechEnv, type SpeechEnv } from './env'
import type { Language } from '../types'

/* Minimal typings for the (still prefixed) Web Speech API. */
type SRAlternative = { transcript: string; confidence: number }
type SRResult = { isFinal: boolean; length: number; [i: number]: SRAlternative }
export type SREvent = { resultIndex: number; results: { length: number; [i: number]: SRResult } }
type SRErrorEvent = { error: string; message?: string }
export interface SR {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: SREvent) => void) | null
  onerror: ((e: SRErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  onaudiostart?: (() => void) | null
  onsoundstart?: (() => void) | null
  onspeechstart?: (() => void) | null
  onspeechend?: (() => void) | null
  onaudioend?: (() => void) | null
  onsoundend?: (() => void) | null
  onnomatch?: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
export type SRCtor = new () => SR

export function getSRCtor(): SRCtor | null {
  const w = globalThis as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Primary BCP-47 tag for a session language (fallbacks: see langChain). */
export function bcp47(lang: Language): string {
  return langChain(lang)[0]
}

export type WebSpeechOptions = {
  ctor?: SRCtor | null
  env?: SpeechEnv
  /** Override continuous mode (default: true on desktop, false on Android where continuous is unreliable). */
  continuous?: boolean
  watchdogMs?: number
}

/**
 * Browser speech recognition (Chrome / Edge / Android Chrome; Safari partial).
 * Uses the browser vendor's recognizer — on Chrome, audio is sent to Google's servers.
 *
 * Reliability measures:
 *  - auto-restart on every `end` (Chrome stops after silence / ~60 s; Android after each utterance)
 *  - exponential backoff only for real failures (network, audio-capture), never for no-speech
 *  - language fallback chain (en-PH → en-US, fil-PH → tl-PH → en-US) on language-not-supported
 *  - watchdog that respawns a recognizer that never started or went silent without `end`
 *  - pending interim text is flushed as a needs-review final when a run ends without finalizing
 *  - restarts when the tab becomes visible again (Chrome kills recognition in background tabs)
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
  private pending = new Map<string, { text: string; startMs: number }>()
  private failures = 0
  private noSpeech = 0
  private startedRun = 0
  private unstartedSpawns = 0
  private lastEventAt = 0
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private watchdog: ReturnType<typeof setInterval> | null = null
  private lastFinalText = new Map<string, string>()
  /** Per-run evidence: onstart only means the service accepted the request; onaudiostart means mic audio flows. */
  private runAudio = false
  private everAudio = false
  private everSound = false
  private everSpeech = false
  private results = 0
  private quickEnds: number[] = []
  private noAudioWarned = 0
  private spawnedAt = 0
  readonly events: LogEntry[] = []
  private langIdx = 0
  private ctor: SRCtor | null
  private env: SpeechEnv
  private continuous: boolean
  private watchdogMs: number
  private onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible' && this.active && !this.paused) this.respawn(0)
  }

  constructor(o: WebSpeechOptions = {}) {
    super()
    this.ctor = o.ctor !== undefined ? o.ctor : getSRCtor()
    this.env = o.env ?? speechEnv()
    this.continuous = o.continuous ?? !this.env.android
    this.watchdogMs = o.watchdogMs ?? 4000
  }

  isSupported() {
    return this.ctor !== null && !this.env.inAppBrowser
  }

  private log(ev: string, detail?: string) {
    const e: LogEntry = { t: Date.now(), run: this.run, ev, detail }
    this.events.push(e)
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400)
    this.info({ type: 'log', entry: e })
  }
  private publish() {
    this.info({ type: 'rec-state', started: this.startedRun > 0, audio: this.everAudio, sound: this.everSound, speech: this.everSpeech, runs: this.run, results: this.results })
  }

  get language() {
    return this.opts ? langChain(this.opts.language)[this.langIdx] : undefined
  }

  async startSession(opts: StartOptions) {
    if (!this.isSupported()) {
      this.setStatus('unsupported', {
        code: 'unsupported',
        message: this.env.guidance ?? 'This browser has no speech recognition.',
        action: 'Open this page in Google Chrome, or switch to Manual/Steno mode.',
        recoverable: false,
      })
      return
    }
    this.opts = opts
    this.active = true
    this.paused = false
    this.langIdx = 0
    this.setStatus('connecting')
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible)
    this.watchdog = setInterval(() => this.checkWatchdog(), this.watchdogMs)
    this.spawn()
  }

  private checkWatchdog() {
    if (!this.active || this.paused || !this.rec || this.restartTimer) return
    const idle = Date.now() - this.lastEventAt
    const started = this.startedRun === this.run
    if (started && !this.runAudio && Date.now() - this.spawnedAt > 6000 && this.noAudioWarned < this.run) {
      // The recognizer says it started but never reports mic audio: something else holds the mic,
      // the speech service is broken, or Chrome refused audio for a non-gesture start.
      this.noAudioWarned = this.run
      this.log('no-audio', 'onstart fired but no onaudiostart after 6 s')
      this.setStatus('reconnecting', {
        code: 'no-audio',
        message: 'Speech recognition started but is not receiving microphone audio.',
        action: this.env.android
          ? 'Close other apps that may use the mic (calls, voice recorder, Google Assistant / "Hey Google", other Chrome tabs), then tap Retry. If it persists, open Diagnostics → Speech test page and send the log.'
          : 'Close other apps/tabs using the microphone, check the selected input device, then tap Retry.',
        recoverable: true,
      })
      this.respawn(200)
      return
    }
    // Never got onstart within 8 s, or no event at all for 75 s (Chrome sometimes hangs without `end`).
    if ((!started && idle > 8000) || idle > 75_000) {
      if (!started) this.unstartedSpawns += 1
      if (this.unstartedSpawns >= 3) {
        this.setStatus('reconnecting', {
          code: 'not-starting',
          message: 'Speech recognition is not starting on this device.',
          action: this.env.android
            ? 'Make sure "Speech Recognition & Synthesis by Google" / the Google app is installed and enabled, close other apps using the mic, then tap Retry.'
            : 'Close other tabs/apps using the microphone, then tap Retry.',
          recoverable: true,
        })
      }
      this.respawn(0)
    }
  }

  private respawn(delay: number) {
    this.killCurrent()
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawn()
    }, delay)
  }

  private killCurrent() {
    const rec = this.rec
    this.rec = null
    this.flushPending()
    this.run += 1 // invalidate callbacks of the old recognizer
    if (!rec) return
    rec.onresult = rec.onerror = rec.onend = rec.onstart = null
    try {
      rec.abort()
    } catch {
      /* ignore */
    }
  }

  /** A run ended with interim text that never became final: keep it, flagged for review. */
  private flushPending() {
    if (!this.opts) return
    for (const [key, p] of this.pending) {
      if (!p.text) continue
      this.lastFinalText.set(key, p.text)
      this.emit({ key, text: p.text, isFinal: true, startMs: p.startMs, endMs: this.opts.clock(), forceReview: true, engine: 'webspeech', language: this.language })
    }
    this.pending.clear()
  }

  private spawn() {
    const Ctor = this.ctor
    if (!Ctor || !this.opts || !this.active || this.paused) return
    this.run += 1
    const run = this.run
    let rec: SR
    try {
      rec = new Ctor()
    } catch (err) {
      this.fail(this.handleError(err))
      return
    }
    rec.lang = this.language ?? 'en-US'
    rec.continuous = this.continuous
    rec.interimResults = true
    rec.maxAlternatives = 1
    this.lastEventAt = Date.now()
    this.spawnedAt = Date.now()
    this.runAudio = false
    this.log('start()', `lang=${rec.lang} continuous=${rec.continuous} interim=true visible=${typeof document === 'undefined' ? '?' : document.visibilityState}`)
    const touch = () => {
      this.lastEventAt = Date.now()
    }
    const gotAudio = () => {
      if (!this.runAudio) {
        this.runAudio = true
        this.everAudio = true
        this.setStatus('listening') // honest: only once the mic is actually delivering audio
        this.publish()
      }
    }
    rec.onstart = () => {
      if (run !== this.run) return
      touch()
      this.log('onstart')
      this.startedRun = run
      this.unstartedSpawns = 0
      this.info({ type: 'activity', state: 'idle' })
      this.publish()
    }
    rec.onaudiostart = () => {
      if (run !== this.run) return
      touch()
      this.log('onaudiostart')
      gotAudio()
    }
    rec.onaudioend = () => run === this.run && this.log('onaudioend')
    rec.onsoundstart = () => {
      if (run !== this.run) return
      touch()
      this.log('onsoundstart')
      this.everSound = true
      gotAudio()
      this.info({ type: 'activity', state: 'sound' })
    }
    rec.onsoundend = () => run === this.run && this.log('onsoundend')
    rec.onspeechstart = () => {
      if (run !== this.run) return
      touch()
      this.log('onspeechstart')
      this.everSpeech = true
      gotAudio()
      this.info({ type: 'activity', state: 'speech' })
    }
    rec.onspeechend = () => {
      if (run !== this.run) return
      touch()
      this.log('onspeechend')
      this.info({ type: 'activity', state: 'silence' })
    }
    rec.onnomatch = () => run === this.run && this.log('onnomatch', 'speech heard but not recognized')
    rec.onresult = (e) => {
      if (run !== this.run || !this.opts) return
      touch()
      gotAudio()
      this.failures = 0
      this.noSpeech = 0
      this.results += 1
      const now = this.opts.clock()
      const r0 = e.results[e.results.length - 1]
      this.log('onresult', `idx=${e.resultIndex}/${e.results.length} final=${!!r0?.isFinal} "${(r0?.[0]?.transcript ?? '').slice(0, 60)}"`)
      if (this.results === 1) this.publish()
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const alt = res?.[0]
        if (!alt) continue
        const key = `ws${run}:i${i}`
        if (!this.starts.has(key)) this.starts.set(key, Math.max(0, now - 1200))
        const text = alt.transcript.trim()
        const startMs = this.starts.get(key)!
        if (res.isFinal) {
          this.pending.delete(key)
          if (this.lastFinalText.get(key) === text) continue
          this.lastFinalText.set(key, text)
        } else {
          if (!text) continue
          this.pending.set(key, { text, startMs })
        }
        this.emit({ key, text, isFinal: res.isFinal, startMs, endMs: now, confidence: res.isFinal && alt.confidence > 0 ? alt.confidence : undefined, engine: 'webspeech', language: rec.lang })
      }
    }
    rec.onerror = (e) => {
      if (run !== this.run) return
      touch()
      const err = this.handleError(e)
      this.log('onerror', `${err.code}${(e as { message?: string }).message ? ` (${(e as { message?: string }).message})` : ''}`)
      if (err.code === 'aborted') return
      if (err.code === 'no-speech') {
        this.noSpeech += 1
        this.info({ type: 'no-speech', count: this.noSpeech })
        return // onend restarts immediately
      }
      if (err.code === 'language-not-supported' && this.opts) {
        const chain = langChain(this.opts.language)
        if (this.langIdx < chain.length - 1) {
          const from = chain[this.langIdx]
          this.langIdx += 1
          this.info({ type: 'language', lang: chain[this.langIdx], fallbackFrom: from })
          this.respawn(50)
          return
        }
      }
      if (err.code === 'audio-capture') this.info({ type: 'mic-contention', reason: 'audio-capture' })
      if (!err.recoverable) {
        this.active = false
        this.killCurrent()
        this.setStatus('error', err)
      } else {
        this.failures += 1
        this.setStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'reconnecting', err)
      }
    }
    rec.onend = () => {
      if (run !== this.run) return
      const lived = Date.now() - this.spawnedAt
      this.log('onend', `after ${lived} ms${this.runAudio ? '' : ', no audio this run'}`)
      this.flushPending()
      if (!this.active || this.paused) return
      // Ends within 1.5 s without audio, over and over = the recognizer can't get the mic / service.
      if (!this.runAudio && lived < 1500) {
        const now = Date.now()
        this.quickEnds = [...this.quickEnds.filter((t) => now - t < 15_000), now]
        if (this.quickEnds.length >= 5) {
          this.quickEnds = []
          this.failures = Math.max(this.failures, 3)
          this.setStatus('reconnecting', {
            code: 'ends-immediately',
            message: 'Speech recognition keeps stopping right after it starts, without hearing audio.',
            action: this.env.android
              ? 'Usually another app has the mic, or the Google speech service is unavailable. Close other mic apps, make sure the Google app is enabled and updated, then tap Retry. Diagnostics → Speech test page shows the raw events.'
              : 'Check the microphone and that no other tab/app is using it, then tap Retry.',
            recoverable: true,
          })
        }
      }
      // Chrome ends after silence / ~60 s (Android: after every utterance). Restart; back off only on failures.
      const delay = this.failures > 0 ? Math.min(8000, 300 * 2 ** Math.min(this.failures, 5)) : 100
      this.rec = null
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null
        this.spawn()
      }, delay)
    }
    this.rec = rec
    try {
      rec.start()
    } catch (err) {
      this.log('start() threw', String((err as Error)?.message ?? err))
      this.fail(this.handleError(err))
    }
  }

  private fail(err: ProviderError) {
    this.failures += 1
    this.setStatus('reconnecting', err)
    this.respawn(Math.min(8000, 500 * this.failures))
  }

  private teardown() {
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    this.killCurrent()
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
    if (!this.opts) return
    this.failures = 0
    this.unstartedSpawns = 0
    this.teardown()
    this.active = true
    this.paused = false
    if (!this.watchdog) this.watchdog = setInterval(() => this.checkWatchdog(), this.watchdogMs)
    this.setStatus('reconnecting')
    this.spawn()
  }
  async finishSession() {
    this.active = false
    this.teardown()
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible)
    this.setStatus('stopped')
  }

  handleError(e: unknown): ProviderError {
    const code = (e as SRErrorEvent)?.error ?? (e instanceof DOMException ? e.name : 'unknown')
    const android = this.env.android
    switch (code) {
      case 'not-allowed':
        return {
          code,
          message: 'Microphone permission for speech recognition is blocked.',
          action: android
            ? 'Tap the lock/tune icon left of the address bar → Permissions → Microphone → Allow. Also check Android Settings → Apps → Chrome → Permissions → Microphone. Then tap Retry.'
            : 'Click the lock icon in the address bar → Microphone → Allow, then tap Retry.',
          recoverable: false,
        }
      case 'service-not-allowed':
        return {
          code,
          message: 'The speech recognition service is not allowed in this browser.',
          action: this.env.inAppBrowser
            ? 'Open this page in Chrome (⋮ → Open in Chrome).'
            : android
              ? 'Use Chrome (not an in-app browser) and make sure the Google app / "Speech Recognition & Synthesis by Google" is installed and enabled.'
              : 'Use Google Chrome or Microsoft Edge.',
          recoverable: false,
        }
      case 'network':
        return { code, message: 'Speech service unreachable (Chrome speech recognition needs internet).', action: 'Check your connection. Retrying automatically; audio/notes are unaffected.', recoverable: true }
      case 'audio-capture':
        return {
          code,
          message: 'The microphone is busy — speech recognition cannot hear audio.',
          action: android ? 'Another recorder (or another app) is holding the mic. Transcription-priority mode releases it.' : 'Close other apps/tabs using the microphone, then Retry.',
          recoverable: true,
        }
      case 'language-not-supported':
        return { code, message: 'This browser does not support the selected recognition language.', action: 'Choose English or another language.', recoverable: false }
      case 'no-speech':
      case 'aborted':
        return { code, message: code, recoverable: true }
      case 'InvalidStateError':
        return { code, message: 'Recognizer was still running; restarting.', recoverable: true }
      default:
        return { code, message: (e as SRErrorEvent)?.message || (e instanceof Error ? e.message : String(code)), recoverable: true }
    }
  }
}
