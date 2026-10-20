import { BaseProvider, type StartOptions } from './provider'
import { PcmTap } from '../audio/pcm'
import { VadSegmenter, type Utterance } from '../audio/vad'
import { loadWhisper, transcribePcm, useWhisper, type WhisperDevice } from '../whisper/client'
import { whisperLanguage, type WhisperModelId } from '../whisper/models'
import { whisperResults, type FilterReason } from '../whisper/results'

export type WhisperDiag = {
  audio: AudioContextState | 'none'
  /** Pre-emphasized frame energy right now, and the adaptive noise floor. */
  energy: number
  noiseFloor: number
  peak: number
  receivedSec: number
  speechSec: number
  utterances: number
  discarded: number
  transcribed: number
  segments: number
  filtered: number
  lastFiltered?: string
  dropped: number
  queued: number
  lastProcessMs?: number
}

/**
 * Near-live on-device Whisper. Raw PCM is tapped from the live microphone stream with an
 * AudioWorklet (the same stream MediaRecorder records — no second mic open, and no decoding of
 * MediaRecorder chunks, whose later pieces lack container headers). A VAD cuts the audio into
 * utterances; only utterances containing speech are sent to Whisper, and its output is checked
 * against the VAD speech mask to reject invented text.
 */
export class WhisperLiveProvider extends BaseProvider {
  readonly id = 'whisper'
  readonly label = 'On-device Whisper (free, private, offline after download)'
  private tap: PcmTap | null = null
  private vad: VadSegmenter | null = null
  private opts: StartOptions | null = null
  private active = false
  private diagTimer: ReturnType<typeof setInterval> | null = null
  private held: Utterance | null = null
  private holdTimer: ReturnType<typeof setTimeout> | null = null
  readonly diag: WhisperDiag = { audio: 'none', energy: 0, noiseFloor: 0, peak: 0, receivedSec: 0, speechSec: 0, utterances: 0, discarded: 0, transcribed: 0, segments: 0, filtered: 0, dropped: 0, queued: 0 }

  constructor(
    private model: WhisperModelId = 'tiny',
    private device: WhisperDevice = 'auto',
    private maxSec = 12,
    private keyPrefix = 'whl',
  ) {
    super()
  }

  isSupported() {
    return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && typeof AudioContext !== 'undefined'
  }

  async startSession(opts: StartOptions) {
    this.opts = opts
    this.active = true
    if (!opts.stream) {
      this.setStatus('error', { code: 'no-stream', message: 'On-device Whisper needs the microphone recording to be on.', recoverable: false })
      return
    }
    this.setStatus('connecting')
    const unsub = useWhisper.subscribe((s) => this.info({ type: 'model', state: 'loading', loaded: s.loaded, total: s.total }))
    try {
      this.info({ type: 'model', state: 'loading', loaded: 0, total: 0 })
      this.vad = new VadSegmenter((u) => this.collect(u), { maxSec: this.maxSec })
      // Tap immediately so speech during the model download is queued, not lost.
      this.tap = new PcmTap(opts.stream, opts.clock, (pcm, s) => {
        this.diag.receivedSec += pcm.length / 16000
        this.vad?.push(pcm, s)
      }, 0.25)
      await this.tap.start()
      this.diagTimer = setInterval(() => this.publishDiag(), 500)
      this.publishDiag()
      await loadWhisper(this.model, this.device)
      this.info({ type: 'model', state: 'ready' })
      if (this.active) this.setStatus('listening')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.info({ type: 'model', state: 'error', message })
      this.setStatus('error', { code: 'model', message: `Could not load the on-device model: ${message}`, action: 'Check your connection for the one-time download, free up memory (close other tabs), or choose Whisper tiny.', recoverable: true })
    } finally {
      unsub()
    }
  }

  /** Resume audio processing after the browser suspended it (call from a tap). */
  unlockAudio() {
    void this.tap?.resumeContext()
  }

  private publishDiag() {
    const st = this.vad?.stats
    if (st) {
      this.diag.energy = st.lastEnergy
      this.diag.noiseFloor = st.noiseFloor
      this.diag.peak = st.peakEnergy
      this.diag.speechSec = (st.speechFrames * 20) / 1000
      this.diag.utterances = st.utterances
      this.diag.discarded = st.discarded
    }
    this.diag.audio = this.tap?.state ?? 'none'
    this.info({ type: 'whisper-diag', diag: { ...this.diag } })
  }

  /**
   * Short utterances (a phrase between breaths) are held briefly and joined with the next one, so
   * Whisper gets whole sentences (much better accuracy) while text still appears within seconds.
   */
  private collect(u: Utterance) {
    if (this.holdTimer) clearTimeout(this.holdTimer)
    this.holdTimer = null
    const h = this.held
    if (h && u.startMs - h.endMs <= 1500 && u.endMs - h.startMs <= this.maxSec * 1000) {
      // The pause between the parts is filled with silence so timestamps stay exact.
      const gapFrames = Math.max(0, Math.round((u.startMs - h.endMs) / 20))
      const pcm = new Float32Array(h.pcm.length + gapFrames * 320 + u.pcm.length)
      pcm.set(h.pcm)
      pcm.set(u.pcm, h.pcm.length + gapFrames * 320)
      const mask = new Uint8Array(h.mask.length + gapFrames + u.mask.length)
      mask.set(h.mask)
      mask.set(u.mask, h.mask.length + gapFrames)
      this.held = { pcm, mask, startMs: h.startMs, endMs: u.endMs, speechMs: h.speechMs + u.speechMs, rms: Math.max(h.rms, u.rms), noiseFloor: u.noiseFloor }
    } else {
      if (h) void this.onUtterance(h)
      this.held = u
    }
    const cur = this.held!
    if (cur.endMs - cur.startMs >= 4000) this.release()
    else this.holdTimer = setTimeout(() => this.release(), 1600)
  }
  private release() {
    if (this.holdTimer) clearTimeout(this.holdTimer)
    this.holdTimer = null
    const h = this.held
    this.held = null
    if (h) void this.onUtterance(h)
  }

  private async onUtterance(u: Utterance) {
    if (!this.opts) return
    if (this.diag.queued >= (useWhisper.getState().status === 'ready' ? 4 : 12)) {
      this.diag.dropped += 1
      this.info({ type: 'lag', queued: this.diag.queued })
      return // device too slow; "Transcribe recording" in Review fills the gap later
    }
    this.diag.queued += 1
    try {
      const lang = whisperLanguage(this.opts.language)
      const t0 = performance.now()
      const out = await transcribePcm(u.pcm, lang)
      this.diag.lastProcessMs = performance.now() - t0
      this.diag.transcribed += 1
      const onReject = (why: FilterReason, text: string) => {
        this.diag.filtered += 1
        this.diag.lastFiltered = `${why}: “${text.slice(0, 40)}”`
      }
      const results = whisperResults(out, { startMs: u.startMs, endMs: u.endMs, rms: u.rms, mask: u.mask, speechMs: u.speechMs, noiseFloor: u.noiseFloor }, this.keyPrefix, lang ?? 'auto', onReject)
      this.diag.segments += results.length
      for (const r of results) this.emit(r)
    } catch (e) {
      this.setStatus('reconnecting', { code: 'whisper', message: `On-device transcription failed: ${(e as Error).message}`, recoverable: true })
    } finally {
      this.diag.queued -= 1
      this.publishDiag()
    }
  }

  sendAudio() {}
  pause() {
    this.tap?.pause()
    this.vad?.flush()
    this.release()
    this.setStatus('paused')
  }
  resume() {
    this.tap?.resume()
    this.setStatus(useWhisper.getState().status === 'ready' ? 'listening' : 'connecting')
  }
  async reconnect() {
    if (!this.opts) return
    this.stopTap()
    await this.startSession(this.opts)
  }
  private stopTap() {
    this.tap?.stop() // flushes the last partial block into the VAD
    this.vad?.flush()
    this.release()
    this.tap = null
    if (this.diagTimer) clearInterval(this.diagTimer)
    this.diagTimer = null
  }
  async finishSession() {
    this.active = false
    this.stopTap()
    this.setStatus('stopped')
  }
}
