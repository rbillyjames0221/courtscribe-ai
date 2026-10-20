/** PCM helpers for on-device transcription (16 kHz mono Float32). */
export const WHISPER_RATE = 16000

export function rms(a: Float32Array, from = 0, to = a.length): number {
  let s = 0
  const n = Math.max(1, to - from)
  for (let i = from; i < to; i++) s += a[i] * a[i]
  return Math.sqrt(s / n)
}

/** Box-filter downsampler (adequate for speech → Whisper). */
export function resample(input: Float32Array, fromRate: number, toRate = WHISPER_RATE): Float32Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    out[i] = end > start ? sum / (end - start) : input[start] ?? 0
  }
  return out
}

/** Decode a complete audio file/blob to 16 kHz mono. */
export async function decodeTo16k(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer()
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AC()
  try {
    const audio = await ctx.decodeAudioData(buf)
    const ch0 = audio.getChannelData(0)
    let mono = ch0
    if (audio.numberOfChannels > 1) {
      mono = new Float32Array(ch0.length)
      for (let c = 0; c < audio.numberOfChannels; c++) {
        const d = audio.getChannelData(c)
        for (let i = 0; i < d.length; i++) mono[i] += d[i] / audio.numberOfChannels
      }
    }
    return resample(mono, audio.sampleRate)
  } finally {
    void ctx.close().catch(() => {})
  }
}

/** Split PCM into windows, cutting at the quietest point near the target length so words are not split. */
export function splitWindows(pcm: Float32Array, targetSec = 25, maxSec = 30, rate = WHISPER_RATE): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  const target = targetSec * rate
  const max = maxSec * rate
  const frame = Math.round(rate * 0.1)
  let pos = 0
  while (pos < pcm.length) {
    if (pcm.length - pos <= max) {
      out.push({ start: pos, end: pcm.length })
      break
    }
    let best = pos + target
    let bestE = Infinity
    for (let p = pos + target - 4 * rate; p < pos + max - frame; p += frame) {
      const e = rms(pcm, p, p + frame)
      if (e < bestE) {
        bestE = e
        best = p + Math.round(frame / 2)
      }
    }
    out.push({ start: pos, end: best })
    pos = best
  }
  return out
}

const WORKLET = `class Tap extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('cs-tap',Tap)`

/**
 * Taps 16 kHz PCM from a live MediaStream (same stream MediaRecorder uses — no mic contention).
 * Calls onWindow with each ~windowSec slice and its session-clock start.
 */
export class PcmTap {
  private ctx: AudioContext | null = null
  private node: AudioNode | null = null
  private src: MediaStreamAudioSourceNode | null = null
  private buf: Float32Array[] = []
  private len = 0
  private windowStartMs = 0
  private paused = false
  constructor(
    private stream: MediaStream,
    private clock: () => number,
    private onWindow: (pcm: Float32Array, startMs: number, endMs: number) => void,
    private windowSec = 10,
  ) {}

  async start() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AC()
    this.ctx = ctx
    this.src = ctx.createMediaStreamSource(this.stream)
    const rate = ctx.sampleRate
    const push = (chunk: Float32Array) => {
      if (this.paused) return
      if (this.len === 0) this.windowStartMs = Math.max(0, this.clock() - (chunk.length / rate) * 1000)
      const r = resample(chunk, rate)
      this.buf.push(r)
      this.len += r.length
      if (this.len >= this.windowSec * WHISPER_RATE) this.flush()
    }
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
      await ctx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)
      const node = new AudioWorkletNode(ctx, 'cs-tap')
      node.port.onmessage = (e) => push(e.data as Float32Array)
      this.src.connect(node)
      this.node = node
    } catch {
      const sp = ctx.createScriptProcessor(4096, 1, 1)
      sp.onaudioprocess = (e) => push(e.inputBuffer.getChannelData(0).slice(0))
      this.src.connect(sp)
      sp.connect(ctx.destination)
      this.node = sp
    }
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
  }

  flush() {
    if (!this.len) return
    const out = new Float32Array(this.len)
    let o = 0
    for (const b of this.buf) {
      out.set(b, o)
      o += b.length
    }
    this.buf = []
    this.len = 0
    const start = this.windowStartMs
    this.onWindow(out, start, start + (out.length / WHISPER_RATE) * 1000)
  }

  pause() {
    this.flush()
    this.paused = true
  }
  resume() {
    this.paused = false
  }
  stop() {
    this.flush()
    try {
      this.src?.disconnect()
      this.node?.disconnect()
    } catch {
      /* ignore */
    }
    void this.ctx?.close().catch(() => {})
    this.ctx = null
  }
}
