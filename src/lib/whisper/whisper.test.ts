import { describe, expect, it } from 'vitest'
import { coveredByOther, whisperResults } from './results'
import { cleanWhisperText, isLikelyHallucination, whisperLanguage } from './models'
import { resample, splitWindows } from '../audio/pcm'
import { mergeBatch, editText } from '../segments'
import type { Segment } from '../types'

describe('whisper results', () => {
  const out = { text: ' Good morning. Please be seated.', chunks: [{ text: ' Good morning.', startSec: 0.5, endSec: 1.8 }, { text: ' Please be seated.', startSec: 2.0, endSec: null }] }
  it('maps chunk timestamps to session time and marks needs-review', () => {
    const r = whisperResults(out, { startMs: 60_000, endMs: 70_000, rms: 0.1 }, 'wh', 'english')
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ startMs: 60_500, endMs: 61_800, isFinal: true, forceReview: true, engine: 'whisper' })
    expect(r[1].endMs).toBe(70_000)
    expect(r[0].key).toBe('wh:60000:0')
  })
  it('re-running is idempotent and never overwrites user edits', () => {
    const r = whisperResults(out, { startMs: 0, endMs: 10_000, rms: 0.1 }, 'wh')
    let segs = mergeBatch([], r, { sessionId: 's', speakerId: null, now: 1 })
    expect(segs.every((s) => s.status === 'needs_review')).toBe(true)
    segs = segs.map((s, i) => (i === 0 ? editText(s, 'Good morning, Your Honor.', 2) : s))
    const again = mergeBatch(segs, r, { sessionId: 's', speakerId: null, now: 3 })
    expect(again).toHaveLength(2)
    expect(again[0].text).toBe('Good morning, Your Honor.')
  })
  it('filters hallucinations on quiet audio and noise tags', () => {
    expect(cleanWhisperText(' [BLANK_AUDIO] ')).toBe('')
    expect(isLikelyHallucination('Thank you.', 0.01)).toBe(true)
    expect(isLikelyHallucination('Thank you.', 0.2)).toBe(false)
    expect(whisperResults({ text: ' Thank you.', chunks: [] }, { startMs: 0, endMs: 5000, rms: 0.005 }, 'wh')).toHaveLength(0)
  })
  it('only fills gaps not covered by live text', () => {
    const live = { engine: 'webspeech', status: 'final', text: 'hello', startMs: 1000, endMs: 4000 } as Segment
    expect(coveredByOther([live], 1000, 4000)).toBe(true)
    expect(coveredByOther([live], 6000, 9000)).toBe(false)
  })
  it('live Whisper text counts as coverage when an ignore rule excludes only post-run output', () => {
    const liveW = { engine: 'whisper', providerKey: 'whl:0:0', status: 'needs_review', text: 'x', startMs: 0, endMs: 9000 } as Segment
    const post = (s: Segment) => s.providerKey.startsWith('wh:')
    expect(coveredByOther([liveW], 0, 9000, post)).toBe(true)
    expect(coveredByOther([liveW], 0, 9000)).toBe(false)
  })
  it('language mapping', () => {
    expect(whisperLanguage('en-PH')).toBe('english')
    expect(whisperLanguage('fil-PH')).toBe('tagalog')
    expect(whisperLanguage('mixed')).toBeNull()
  })
})

describe('pcm', () => {
  it('resamples 48k → 16k', () => {
    expect(resample(new Float32Array(48000), 48000).length).toBe(16000)
  })
  it('splits long audio into ≤30 s windows covering everything', () => {
    const pcm = new Float32Array(16000 * 95).map((_, i) => Math.sin(i / 10) * (Math.floor(i / 16000) % 7 === 0 ? 0 : 0.3))
    const w = splitWindows(pcm)
    expect(w[0].start).toBe(0)
    expect(w.at(-1)!.end).toBe(pcm.length)
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBe(w[i - 1].end)
    expect(w.every((x) => x.end - x.start <= 30 * 16000)).toBe(true)
  })
})
