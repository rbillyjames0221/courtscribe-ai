/**
 * Speech-recognition provider seam.
 *
 * Every recognizer (browser Web Speech, demo script, and future server-side Google/Azure
 * streaming) implements this interface. The recording pipeline never depends on a provider:
 * audio is captured and saved locally first, then optionally fed to the provider.
 */
import type { Language } from '../types'
import type { ProviderResult } from '../segments'

export type ProviderStatus = 'idle' | 'connecting' | 'listening' | 'paused' | 'reconnecting' | 'offline' | 'error' | 'unsupported' | 'stopped'

export type ProviderError = { code: string; message: string; recoverable: boolean; action?: string }

export type LogEntry = { t: number; run: number; ev: string; detail?: string }

export type ProviderInfo =
  | { type: 'language'; lang: string; fallbackFrom?: string }
  | { type: 'activity'; state: 'idle' | 'sound' | 'speech' | 'silence' }
  | { type: 'no-speech'; count: number }
  | { type: 'mic-contention'; reason: string }
  | { type: 'model'; state: 'loading' | 'ready' | 'error'; loaded?: number; total?: number; message?: string }
  | { type: 'lag'; queued: number }
  | { type: 'log'; entry: LogEntry }
  | { type: 'rec-state'; started: boolean; audio: boolean; sound: boolean; speech: boolean; runs: number; results: number }
  | { type: 'whisper-diag'; diag: import('./whisper').WhisperDiag }

export type StartOptions = {
  language: Language
  glossary: string[]
  /** Session clock (active recording ms) so results carry session-relative timestamps. */
  clock: () => number
  /** Live microphone stream, for providers that process PCM on-device (Whisper). */
  stream?: MediaStream | null
}

export type ProviderResultWithHint = ProviderResult & { speakerRoleHint?: string }

export interface SpeechProvider {
  readonly id: string
  readonly label: string
  /** True when the provider consumes recorded audio chunks via sendAudio (server providers). */
  readonly consumesAudio: boolean
  isSupported(): boolean
  startSession(opts: StartOptions): Promise<void>
  sendAudio(chunk: Blob, meta: { seq: number; startMs: number; endMs: number }): void
  receiveInterimResult(cb: (r: ProviderResultWithHint) => void): () => void
  receiveFinalResult(cb: (r: ProviderResultWithHint) => void): () => void
  onStatus(cb: (s: ProviderStatus, err?: ProviderError) => void): () => void
  /** Informational events (language fallback, speech activity, diagnostics). */
  onInfo(cb: (i: ProviderInfo) => void): () => void
  flushBacklog(): void
  status: ProviderStatus
  pause(): void
  resume(): void
  finishSession(): Promise<void>
  reconnect(): Promise<void>
  handleError(err: unknown): ProviderError
}

type Listener<T extends unknown[]> = (...args: T) => void

export abstract class BaseProvider implements SpeechProvider {
  abstract readonly id: string
  abstract readonly label: string
  readonly consumesAudio: boolean = false
  private interimL = new Set<Listener<[ProviderResultWithHint]>>()
  private finalL = new Set<Listener<[ProviderResultWithHint]>>()
  private statusL = new Set<Listener<[ProviderStatus, ProviderError | undefined]>>()
  private infoL = new Set<Listener<[ProviderInfo]>>()
  status: ProviderStatus = 'idle'

  abstract isSupported(): boolean
  abstract startSession(opts: StartOptions): Promise<void>
  abstract finishSession(): Promise<void>
  abstract reconnect(): Promise<void>
  abstract pause(): void
  abstract resume(): void
  sendAudio(_chunk: Blob, _meta: { seq: number; startMs: number; endMs: number }): void {}

  receiveInterimResult(cb: (r: ProviderResultWithHint) => void) {
    this.interimL.add(cb)
    return () => void this.interimL.delete(cb)
  }
  receiveFinalResult(cb: (r: ProviderResultWithHint) => void) {
    this.finalL.add(cb)
    return () => void this.finalL.delete(cb)
  }
  onStatus(cb: (s: ProviderStatus, err?: ProviderError) => void) {
    this.statusL.add(cb)
    return () => void this.statusL.delete(cb)
  }
  onInfo(cb: (i: ProviderInfo) => void) {
    this.infoL.add(cb)
    return () => void this.infoL.delete(cb)
  }
  protected info(i: ProviderInfo) {
    for (const l of this.infoL) l(i)
  }
  private backlog: ProviderResultWithHint[] = []
  protected emit(r: ProviderResultWithHint) {
    const ls = r.isFinal ? this.finalL : this.interimL
    if (!ls.size) {
      // Nobody subscribed yet (recognizer pre-started inside the user's tap): keep until someone listens.
      if (this.backlog.length < 200) this.backlog.push(r)
      return
    }
    for (const l of ls) l(r)
  }
  /** Deliver results produced before listeners were attached. */
  flushBacklog() {
    const b = this.backlog
    this.backlog = []
    for (const r of b) this.emit(r)
  }
  protected setStatus(s: ProviderStatus, err?: ProviderError) {
    this.status = s
    for (const l of this.statusL) l(s, err)
  }
  handleError(err: unknown): ProviderError {
    const message = err instanceof Error ? err.message : String(err)
    return { code: 'unknown', message, recoverable: true }
  }
}
