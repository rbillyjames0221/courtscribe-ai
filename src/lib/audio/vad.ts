/**
 * Lightweight voice-activity detection + utterance segmentation for on-device Whisper (16 kHz mono).
 *
 * Whisper invents text ("Thank you.", "Thanks for watching") when given silence or steady noise, so
 * it must only ever see audio that contains speech. Per 20 ms frame we compute pre-emphasized energy
 * (suppresses hum / rumble / brown noise) and compare it to an adaptive noise floor; frames well above
 * the floor (and above an absolute minimum) are speech. Utterances start after 60 ms of speech, end
 * after 600 ms of silence, are padded, force-split at maxSec on the quietest point, and are discarded
 * when they contain less than minSpeechMs of speech.
 */
export const VAD_RATE = 16000
export const FRAME = 320 // 20 ms

export type VadOptions = {
  /** Speech must exceed noiseFloor × ratio (≈ +10 dB). */
  ratio?: number
  /** Absolute minimum pre-emphasized frame RMS for speech. */
  minEnergy?: number
  startFrames?: number
  hangoverMs?: number
  padBeforeMs?: number
  padAfterMs?: number
  maxSec?: number
  minSpeechMs?: number
}

export type Utterance = {
  pcm: Float32Array
  startMs: number
  endMs: number
  speechMs: number
  /** 1 = speech, per 20 ms frame of pcm. */
  mask: Uint8Array
  rms: number
  noiseFloor: number
}

export type VadStats = { frames: number; speechFrames: number; noiseFloor: number; lastEnergy: number; peakEnergy: number; utterances: number; discarded: number }

export function frameEnergy(x: Float32Array, from: number, prev: number): { e: number; last: number } {
  let s = 0
  let p = prev
  for (let i = from; i < from + FRAME; i++) {
    const v = x[i] - 0.95 * p // pre-emphasis
    p = x[i]
    s += v * v
  }
  return { e: Math.sqrt(s / FRAME), last: p }
}

export class VadSegmenter {
  private o: Required<VadOptions>
  private buf: Float32Array = new Float32Array(VAD_RATE * 40)
  private len = 0 // samples in buf
  private bufStartMs = 0
  private pending = new Float32Array(0) // < FRAME leftover
  private pendingStartMs = 0
  private prev = 0
  private floor = -1
  private warm: number[] = []
  private flags: number[] = [] // per frame in buf
  private energies: number[] = []
  private inSpeech = false
  private uttStartFrame = 0
  private run = 0
  private silence = 0
  readonly stats: VadStats = { frames: 0, speechFrames: 0, noiseFloor: 0, lastEnergy: 0, peakEnergy: 0, utterances: 0, discarded: 0 }

  constructor(
    private onUtterance: (u: Utterance) => void,
    opts: VadOptions = {},
  ) {
    this.o = { ratio: 2.8, minEnergy: 0.006, startFrames: 3, hangoverMs: 800, padBeforeMs: 300, padAfterMs: 200, maxSec: 15, minSpeechMs: 350, ...opts }
  }

  /** Feed contiguous 16 kHz PCM; startMs is the session time of pcm[0]. */
  push(pcm: Float32Array, startMs: number) {
    let data = pcm
    let t0 = startMs
    if (this.pending.length) {
      data = new Float32Array(this.pending.length + pcm.length)
      data.set(this.pending)
      data.set(pcm, this.pending.length)
      t0 = this.pendingStartMs
    }
    if (this.len === 0) this.bufStartMs = t0
    const whole = Math.floor(data.length / FRAME) * FRAME
    for (let off = 0; off < whole; off += FRAME) this.frame(data, off)
    this.pending = data.slice(whole)
    this.pendingStartMs = t0 + (whole / VAD_RATE) * 1000
  }

  private frame(data: Float32Array, off: number) {
    const { e, last } = frameEnergy(data, off, this.prev)
    this.prev = last
    this.ensure(FRAME)
    this.buf.set(data.subarray(off, off + FRAME), this.len)
    this.len += FRAME
    this.stats.frames += 1
    this.stats.lastEnergy = e
    if (e > this.stats.peakEnergy) this.stats.peakEnergy = e
    // Noise floor: median of the first 0.4 s, then fast to fall, slow to rise.
    if (this.floor < 0) {
      this.warm.push(e)
      if (this.warm.length >= 20) this.floor = [...this.warm].sort((a, b) => a - b)[10]
    } else if (!this.inSpeech || e < this.floor) {
      this.floor = e < this.floor ? 0.7 * this.floor + 0.3 * e : 0.995 * this.floor + 0.005 * e
    }
    const floor = this.floor < 0 ? Math.min(...this.warm) : this.floor
    this.stats.noiseFloor = floor
    const speech = e > Math.max(floor * this.o.ratio, this.o.minEnergy) ? 1 : 0
    this.flags.push(speech)
    this.energies.push(e)
    if (speech) this.stats.speechFrames += 1
    const idx = this.flags.length - 1
    const hang = Math.round(this.o.hangoverMs / 20)
    if (!this.inSpeech) {
      this.run = speech ? this.run + 1 : 0
      if (this.run >= this.o.startFrames) {
        this.inSpeech = true
        this.silence = 0
        this.uttStartFrame = Math.max(0, idx - this.run + 1 - Math.round(this.o.padBeforeMs / 20))
      } else this.trimIdle()
    } else {
      this.silence = speech ? 0 : this.silence + 1
      if (this.silence >= hang) this.emit(Math.min(this.flags.length, idx - this.silence + 1 + Math.round(this.o.padAfterMs / 20)))
      else if ((idx - this.uttStartFrame) * 20 >= this.o.maxSec * 1000) {
        // force split at the quietest frame of the last 3 s
        let best = idx
        let bestE = Infinity
        for (let k = idx; k > idx - 150 && k > this.uttStartFrame + 50; k--) {
          if (this.energies[k] < bestE) {
            bestE = this.energies[k]
            best = k
          }
        }
        this.emit(best, true)
      }
    }
  }

  /** Keep only the pre-pad worth of idle audio. */
  private trimIdle() {
    const keep = Math.round(this.o.padBeforeMs / 20) + this.o.startFrames
    const drop = this.flags.length - keep
    if (drop > 50) this.dropFrames(drop)
  }

  private dropFrames(n: number) {
    this.buf.copyWithin(0, n * FRAME, this.len)
    this.len -= n * FRAME
    this.flags.splice(0, n)
    this.energies.splice(0, n)
    this.bufStartMs += n * 20
    this.uttStartFrame = Math.max(0, this.uttStartFrame - n)
  }

  private emit(endFrame: number, continuing = false) {
    const s = this.uttStartFrame
    const e = Math.max(s + 1, endFrame)
    const mask = Uint8Array.from(this.flags.slice(s, e))
    const speechMs = mask.reduce((a, b) => a + b, 0) * 20
    const pcm = this.buf.slice(s * FRAME, e * FRAME)
    let sum = 0
    for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i]
    const startMs = this.bufStartMs + s * 20
    if (speechMs >= this.o.minSpeechMs) {
      this.stats.utterances += 1
      this.onUtterance({ pcm, startMs, endMs: startMs + (e - s) * 20, speechMs, mask, rms: Math.sqrt(sum / Math.max(1, pcm.length)), noiseFloor: this.stats.noiseFloor })
    } else this.stats.discarded += 1
    this.dropFrames(e)
    this.inSpeech = continuing
    this.uttStartFrame = 0
    this.silence = 0
    this.run = 0
  }

  /** End of stream: emit any open utterance. */
  flush() {
    if (this.inSpeech) this.emit(this.flags.length)
  }

  private ensure(extra: number) {
    if (this.len + extra <= this.buf.length) return
    const next = new Float32Array(Math.max(this.buf.length * 2, this.len + extra))
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
  }
}

/** Run VAD over a whole recording and merge nearby utterances into ≤ maxBatchSec batches for Whisper. */
export function utterancesOf(pcm: Float32Array, startMs = 0, opts: VadOptions = {}, maxBatchSec = 25, joinGapMs = 1200): Utterance[] {
  const list: Utterance[] = []
  const v = new VadSegmenter((u) => list.push(u), opts)
  const step = VAD_RATE // feed 1 s at a time
  for (let i = 0; i < pcm.length; i += step) v.push(pcm.subarray(i, Math.min(pcm.length, i + step)), startMs + (i / VAD_RATE) * 1000)
  v.flush()
  const out: Utterance[] = []
  for (const u of list) {
    const last = out[out.length - 1]
    if (last && u.startMs - last.endMs <= joinGapMs && (u.endMs - last.startMs) / 1000 <= maxBatchSec) {
      const gap = Math.max(0, Math.round(((u.startMs - last.endMs) / 1000) * VAD_RATE))
      const merged = new Float32Array(last.pcm.length + gap + u.pcm.length)
      merged.set(last.pcm)
      merged.set(pcm.subarray(Math.round(((last.endMs - startMs) / 1000) * VAD_RATE), Math.round(((last.endMs - startMs) / 1000) * VAD_RATE) + gap), last.pcm.length)
      merged.set(u.pcm, last.pcm.length + gap)
      const gapMask = new Uint8Array(Math.round(gap / 320))
      const mask = new Uint8Array(last.mask.length + gapMask.length + u.mask.length)
      mask.set(last.mask)
      mask.set(u.mask, last.mask.length + gapMask.length)
      out[out.length - 1] = { ...last, pcm: merged, endMs: u.endMs, speechMs: last.speechMs + u.speechMs, mask, rms: Math.max(last.rms, u.rms) }
    } else out.push(u)
  }
  return out
}

/** Fraction of [fromSec, toSec) (relative to the utterance) that VAD marked as speech. */
export function speechFraction(mask: Uint8Array, fromSec: number, toSec: number): number {
  const a = Math.max(0, Math.floor((fromSec * 1000) / 20))
  const b = Math.min(mask.length, Math.ceil((toSec * 1000) / 20))
  if (b <= a) return 0
  let s = 0
  for (let i = a; i < b; i++) s += mask[i]
  return s / (b - a)
}
