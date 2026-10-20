/**
 * Web audio capture adapter: MediaRecorder → timestamped chunks.
 * (Android will get a native Kotlin adapter with a foreground service; see README.)
 */
export type ChunkHandler = (blob: Blob, meta: { startMs: number; endMs: number; mimeType: string }) => void

export function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? ''
}

export type MicOptions = { echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean; deviceId?: string }

export async function openMic(o: MicOptions): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot access the microphone (needs HTTPS and a modern browser).')
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: o.echoCancellation,
      noiseSuppression: o.noiseSuppression,
      autoGainControl: o.autoGainControl,
      ...(o.deviceId ? { deviceId: { exact: o.deviceId } } : {}),
      channelCount: 1,
    },
  })
}

export async function micPermissionState(): Promise<PermissionState | 'unknown'> {
  try {
    const p = await navigator.permissions?.query({ name: 'microphone' as PermissionName })
    return p?.state ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** RMS input level meter (0..1) using an AnalyserNode. */
export class LevelMeter {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private buf: Float32Array<ArrayBuffer> | null = null
  constructor(stream: MediaStream) {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new AC()
      const src = this.ctx.createMediaStreamSource(stream)
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 1024
      this.buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4))
      src.connect(this.analyser)
    } catch {
      this.ctx = null
    }
  }
  level(): number {
    if (!this.analyser || !this.buf) return 0
    if (this.ctx?.state === 'suspended') void this.ctx.resume()
    this.analyser.getFloatTimeDomainData(this.buf)
    let sum = 0
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i]
    const rms = Math.sqrt(sum / this.buf.length)
    return Math.min(1, rms * 4)
  }
  close() {
    void this.ctx?.close().catch(() => {})
    this.ctx = null
  }
}

/**
 * Wraps MediaRecorder with a session clock that only advances while actively recording.
 * offsetMs lets a resumed (post-crash) run continue the session timeline.
 */
export class AudioCapture {
  private rec: MediaRecorder | null = null
  private activeSince: number | null = null
  private accumulated = 0
  private lastChunkEnd = 0
  readonly mimeType: string
  constructor(
    private stream: MediaStream,
    private offsetMs: number,
    private onChunk: ChunkHandler,
    private timesliceMs = 5000,
    private recordAudio = true,
  ) {
    this.mimeType = pickMimeType()
    this.lastChunkEnd = offsetMs
  }
  clock(): number {
    const live = this.activeSince !== null ? performance.now() - this.activeSince : 0
    return this.offsetMs + this.accumulated + live
  }
  start() {
    this.activeSince = performance.now()
    if (!this.recordAudio || typeof MediaRecorder === 'undefined') return
    const rec = new MediaRecorder(this.stream, this.mimeType ? { mimeType: this.mimeType, audioBitsPerSecond: 32000 } : undefined)
    rec.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return
      const end = this.clock()
      const start = this.lastChunkEnd
      this.lastChunkEnd = end
      this.onChunk(e.data, { startMs: start, endMs: end, mimeType: rec.mimeType || this.mimeType || 'audio/webm' })
    }
    rec.start(this.timesliceMs)
    this.rec = rec
  }
  pause() {
    if (this.activeSince !== null) this.accumulated += performance.now() - this.activeSince
    this.activeSince = null
    if (this.rec?.state === 'recording') {
      this.rec.requestData()
      this.rec.pause()
    }
  }
  resume() {
    this.activeSince = performance.now()
    if (this.rec?.state === 'paused') this.rec.resume()
  }
  get state() {
    return this.rec?.state ?? (this.activeSince !== null ? 'recording' : 'paused')
  }
  stop(): Promise<void> {
    if (this.activeSince !== null) this.accumulated += performance.now() - this.activeSince
    this.activeSince = null
    const rec = this.rec
    if (!rec || rec.state === 'inactive') return Promise.resolve()
    return new Promise((resolve) => {
      rec.addEventListener('stop', () => resolve(), { once: true })
      try {
        rec.stop()
      } catch {
        resolve()
      }
    })
  }
}
