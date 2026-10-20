import { describe, expect, it } from 'vitest'
import { utterancesOf, speechFraction, VadSegmenter } from './vad'
import { rejectReason, whisperResults } from '../whisper/results'

const R = 16000
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1
}
/** Brown-ish room noise (rumble + hiss) at roughly the given RMS. */
function noise(sec: number, rmsTarget: number, seed = 1) {
  const r = rng(seed)
  const out = new Float32Array(sec * R)
  let b = 0
  for (let i = 0; i < out.length; i++) {
    b = 0.995 * b + 0.05 * r()
    out[i] = b + 0.15 * r() * 0.1
  }
  let s = 0
  for (const v of out) s += v * v
  const k = rmsTarget / Math.sqrt(s / out.length)
  return out.map((v) => v * k)
}
/** Voice-like signal: harmonic stack with syllable-rate amplitude modulation. */
function voice(sec: number, amp = 0.15) {
  const out = new Float32Array(sec * R)
  for (let i = 0; i < out.length; i++) {
    const t = i / R
    const f0 = 140 + 20 * Math.sin(2 * Math.PI * 0.7 * t)
    let v = 0
    for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * f0 * h * t) / h
    out[i] = amp * v * (0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t))
  }
  return out
}
function mix(base: Float32Array, add: Float32Array, atSec: number) {
  const o = base.slice()
  o.set(add.map((v, i) => v + (o[atSec * R + i] ?? 0)), atSec * R)
  return o
}

describe('VAD', () => {
  it('ignores steady room noise completely (no Whisper calls on silence)', () => {
    for (const lvl of [0.005, 0.02, 0.05, 0.1]) expect(utterancesOf(noise(30, lvl, 7))).toHaveLength(0)
  })
  it('finds speech bursts in noise with accurate timing', () => {
    let a = noise(30, 0.03, 3)
    a = mix(a, voice(2), 5)
    a = mix(a, voice(3), 15)
    const u = utterancesOf(a, 10_000)
    expect(u).toHaveLength(2)
    expect(u[0].startMs).toBeGreaterThan(10_000 + 4400)
    expect(u[0].startMs).toBeLessThan(10_000 + 5100)
    expect(u[0].endMs).toBeGreaterThan(10_000 + 6900)
    expect(u[0].endMs).toBeLessThan(10_000 + 8000)
    expect(u[1].speechMs).toBeGreaterThan(1500)
    expect(u[1].endMs - u[1].startMs).toBeGreaterThan(2800)
  })
  it('discards short clicks/bumps', () => {
    const a = mix(noise(10, 0.02), voice(0.15, 0.5), 4)
    const list: unknown[] = []
    const v = new VadSegmenter((x) => list.push(x))
    v.push(a, 0)
    v.flush()
    expect(list).toHaveLength(0)
    expect(v.stats.discarded).toBeGreaterThanOrEqual(1)
  })
  it('force-splits long continuous speech at ≤ maxSec', () => {
    const a = mix(noise(45, 0.01), voice(40), 2)
    const u = utterancesOf(a, 0, { maxSec: 15 }, 15, 0)
    expect(u.length).toBeGreaterThanOrEqual(3)
    expect(u.every((x) => x.endMs - x.startMs <= 15_500)).toBe(true)
  })
  it('works when fed in small live blocks (as the AudioWorklet tap does)', () => {
    let a = noise(12, 0.03, 5)
    a = mix(a, voice(2.5), 4)
    const got: number[] = []
    const v = new VadSegmenter((x) => got.push(x.startMs))
    for (let i = 0; i < a.length; i += 128) v.push(a.subarray(i, i + 128), (i / R) * 1000)
    v.flush()
    expect(got).toHaveLength(1)
    expect(Math.abs(got[0] - 3700)).toBeLessThan(500)
  })
})

describe('Whisper output rejection', () => {
  const mask = new Uint8Array(250) // 5 s
  mask.fill(1, 50, 150) // speech 1 s .. 3 s
  const w = { startMs: 0, endMs: 5000, rms: 0.1, mask, speechMs: 2000, noiseFloor: 0.01 }
  it('rejects text placed over non-speech audio', () => {
    expect(rejectReason('Thank you for your time today.', { startSec: 3.2, endSec: 4.9 }, w)).toBe('no-speech-under-text')
    expect(rejectReason('Good morning, Your Honor.', { startSec: 1, endSec: 3 }, w)).toBeNull()
  })
  it('rejects classic hallucinations, other scripts, repetition, impossible word rates', () => {
    expect(rejectReason('Thank you.', { startSec: 1, endSec: 1.5 }, { ...w, speechMs: 500 })).toBe('hallucination')
    expect(rejectReason('Thanks for watching!', { startSec: 1, endSec: 3 }, w)).toBe('hallucination')
    expect(rejectReason('ご視聴ありがとうございました', { startSec: 1, endSec: 3 }, w)).toBe('non-latin')
    expect(rejectReason('the the the the the the the the', { startSec: 1, endSec: 3 }, w)).toBe('repetition')
    expect(rejectReason('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen', { startSec: 1, endSec: 3 }, w)).toBe('too-many-words')
  })
  it('keeps real Filipino speech', () => {
    expect(rejectReason('Opo, nandito po ako noong nangyari.', { startSec: 1, endSec: 3 }, w)).toBeNull()
    const r = whisperResults({ text: '', chunks: [{ text: ' Opo, Your Honor.', startSec: 1.1, endSec: 2.4 }] }, w, 'whl', 'tagalog')
    expect(r).toHaveLength(1)
    expect(speechFraction(mask, 1.1, 2.4)).toBe(1)
  })
})
