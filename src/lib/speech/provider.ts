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

export type ProviderError = { code: string; message: string; recoverable: boolean }

export type StartOptions = {
  language: Language
  glossary: string[]
  /** Session clock (active recording ms) so results carry session-relative timestamps. */
  clock: () => number
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
  protected emit(r: ProviderResultWithHint) {
    for (const l of r.isFinal ? this.finalL : this.interimL) l(r)
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
