import { BaseProvider, type ProviderError, type StartOptions } from './provider'

/**
 * SERVER-SIDE PROVIDER SEAM (not active in this deployment).
 *
 * Google Cloud Speech-to-Text / Azure Speech credentials must NEVER ship in the web bundle or APK.
 * The intended flow:
 *   1. The app asks `/api/speech/token` (Vercel function, see /api/speech/token.ts) for a short-lived,
 *      session-scoped token. That route holds the real keys in Vercel env vars.
 *   2. The app opens a WebSocket to the streaming service (`VITE_STREAMING_URL`, e.g. a Cloud Run
 *      service — see /server/README.md) and streams the same WebM/Opus chunks it saves locally.
 *   3. The service relays to the provider and returns JSON results:
 *        { "type": "result", "key": "g1:r12", "text": "...", "isFinal": true, "startMs": 0, "endMs": 0, "confidence": 0.9 }
 *   4. Reconnects resend chunks from the last acknowledged `seq` ({ "type": "ack", "seq": n });
 *      the segment merge layer de-duplicates by key, so replays are idempotent.
 */
export class ServerStreamingProvider extends BaseProvider {
  readonly id = 'server'
  readonly label = 'Cloud streaming (Google / Azure via backend)'
  override readonly consumesAudio = true
  private ws: WebSocket | null = null
  private opts: StartOptions | null = null
  private pending: { seq: number; blob: Blob; startMs: number; endMs: number }[] = []
  private ackedSeq = 0
  private closing = false

  static endpoint(): string | undefined {
    return (import.meta.env.VITE_STREAMING_URL as string | undefined) || undefined
  }
  isSupported() {
    return !!ServerStreamingProvider.endpoint() && typeof WebSocket !== 'undefined'
  }

  async startSession(opts: StartOptions) {
    this.opts = opts
    if (!this.isSupported()) {
      this.setStatus('unsupported', { code: 'not-configured', message: 'Cloud streaming backend is not configured for this deployment.', recoverable: false })
      return
    }
    await this.connect()
  }

  private async connect() {
    if (!this.opts) return
    this.setStatus('connecting')
    const tokenRes = await fetch('/api/speech/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: this.opts.language }) })
    if (!tokenRes.ok) {
      this.setStatus('error', { code: 'token', message: `Token endpoint returned ${tokenRes.status}`, recoverable: false })
      return
    }
    const { token } = (await tokenRes.json()) as { token: string }
    const url = new URL(ServerStreamingProvider.endpoint()!)
    url.searchParams.set('token', token)
    url.searchParams.set('lang', this.opts.language)
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      this.setStatus('listening')
      ws.send(JSON.stringify({ type: 'start', language: this.opts!.language, glossary: this.opts!.glossary, resumeFromSeq: this.ackedSeq }))
      for (const p of this.pending) this.flush(p)
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data))
        if (msg.type === 'ack') {
          this.ackedSeq = Math.max(this.ackedSeq, msg.seq)
          this.pending = this.pending.filter((p) => p.seq > this.ackedSeq)
        } else if (msg.type === 'result') this.emit(msg)
      } catch {
        /* ignore malformed */
      }
    }
    ws.onclose = () => {
      if (this.closing) return
      this.setStatus(navigator.onLine ? 'reconnecting' : 'offline')
      setTimeout(() => void this.connect(), 2000)
    }
    ws.onerror = () => this.setStatus('reconnecting', { code: 'ws', message: 'Streaming connection error', recoverable: true })
    this.ws = ws
  }

  private flush(p: { seq: number; blob: Blob; startMs: number; endMs: number }) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ type: 'chunk', seq: p.seq, startMs: p.startMs, endMs: p.endMs }))
    this.ws.send(p.blob)
  }
  sendAudio(blob: Blob, meta: { seq: number; startMs: number; endMs: number }) {
    const p = { blob, ...meta }
    this.pending.push(p)
    this.flush(p)
  }
  pause() {
    this.setStatus('paused')
  }
  resume() {
    this.setStatus(this.ws?.readyState === WebSocket.OPEN ? 'listening' : 'reconnecting')
  }
  async reconnect() {
    this.ws?.close()
    await this.connect()
  }
  async finishSession() {
    this.closing = true
    this.ws?.send(JSON.stringify({ type: 'finish' }))
    this.ws?.close()
    this.setStatus('stopped')
  }
  override handleError(err: unknown): ProviderError {
    return { code: 'server', message: err instanceof Error ? err.message : String(err), recoverable: true }
  }
}
