import { BaseProvider, type StartOptions } from './provider'
import { PcmTap, rms } from '../audio/pcm'
import { loadWhisper, transcribePcm, useWhisper, type WhisperDevice } from '../whisper/client'
import { whisperLanguage, type WhisperModelId } from '../whisper/models'
import { whisperResults } from '../whisper/results'

/**
 * Near-live on-device Whisper: taps PCM from the recording stream (no second mic open, so it
 * coexists with MediaRecorder on Android), transcribes ~10 s windows in a worker, and emits
 * needs-review finals. Text appears a few seconds after each window closes.
 */
export class WhisperLiveProvider extends BaseProvider {
  readonly id = 'whisper'
  readonly label = 'On-device Whisper (free, private, offline after download)'
  private tap: PcmTap | null = null
  private opts: StartOptions | null = null
  private queued = 0
  private active = false
  constructor(
    private model: WhisperModelId = 'tiny',
    private device: WhisperDevice = 'auto',
    private windowSec = 10,
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
      // Start tapping immediately so nothing said during the model download is lost.
      this.tap = new PcmTap(opts.stream, opts.clock, (pcm, s, e) => void this.onWindow(pcm, s, e), this.windowSec)
      await this.tap.start()
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

  private async onWindow(pcm: Float32Array, startMs: number, endMs: number) {
    if (!this.opts) return
    const energy = rms(pcm)
    if (energy < 0.004) return // silence: skip (also prevents Whisper hallucinations)
    if (this.queued >= (useWhisper.getState().status === 'ready' ? 4 : 12)) {
      this.info({ type: 'lag', queued: this.queued })
      return // device too slow; "Transcribe recording" in Review fills the gap later
    }
    this.queued += 1
    try {
      const lang = whisperLanguage(this.opts.language)
      const out = await transcribePcm(pcm, lang)
      for (const r of whisperResults(out, { startMs, endMs, rms: energy }, this.keyPrefix, lang ?? 'auto')) this.emit(r)
    } catch (e) {
      this.setStatus('reconnecting', { code: 'whisper', message: `On-device transcription failed: ${(e as Error).message}`, recoverable: true })
    } finally {
      this.queued -= 1
    }
  }

  sendAudio() {}
  pause() {
    this.tap?.pause()
    this.setStatus('paused')
  }
  resume() {
    this.tap?.resume()
    this.setStatus(useWhisper.getState().status === 'ready' ? 'listening' : 'connecting')
  }
  async reconnect() {
    if (!this.opts) return
    this.tap?.stop()
    this.tap = null
    await this.startSession(this.opts)
  }
  async finishSession() {
    this.active = false
    this.tap?.stop() // flushes the final partial window
    this.tap = null
    this.setStatus('stopped')
  }
}
