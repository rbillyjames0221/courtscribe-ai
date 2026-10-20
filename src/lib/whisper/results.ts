import type { ProviderResult } from '../segments'
import type { Segment } from '../types'
import { cleanWhisperText, isLikelyHallucination } from './models'
import type { WhisperChunk } from './client'

/**
 * Convert Whisper output for one audio window into final, needs-review provider results with
 * session-relative timestamps. Keys are deterministic so re-running replaces (never duplicates)
 * earlier Whisper output — and user-edited segments are protected by mergeProviderResult.
 */
export function whisperResults(
  out: { text: string; chunks: WhisperChunk[] },
  window: { startMs: number; endMs: number; rms: number },
  keyPrefix: string,
  language?: string,
): ProviderResult[] {
  const chunks = out.chunks.length ? out.chunks : [{ text: out.text, startSec: 0, endSec: null }]
  const res: ProviderResult[] = []
  chunks.forEach((c, i) => {
    const text = cleanWhisperText(c.text)
    if (!text || isLikelyHallucination(text, window.rms)) return
    const startMs = Math.round(window.startMs + c.startSec * 1000)
    const endMs = Math.round(c.endSec != null ? window.startMs + c.endSec * 1000 : window.endMs)
    res.push({
      key: `${keyPrefix}:${Math.round(window.startMs)}:${i}`,
      text,
      isFinal: true,
      startMs: Math.min(startMs, window.endMs),
      endMs: Math.min(Math.max(endMs, startMs), window.endMs),
      forceReview: true,
      engine: 'whisper',
      language,
    })
  })
  return res
}

/** True when [startMs,endMs] is already mostly covered by non-Whisper text (live recognition, notes, steno). */
export function coveredByOther(segments: Segment[], startMs: number, endMs: number, ignore: (s: Segment) => boolean = (s) => s.engine === 'whisper'): boolean {
  const len = Math.max(1, endMs - startMs)
  let covered = 0
  for (const s of segments) {
    if (ignore(s) || s.status === 'interim' || !s.text.trim()) continue
    const sEnd = Math.max(s.endMs, s.startMs + 1500)
    const o = Math.min(endMs, sEnd) - Math.max(startMs, s.startMs)
    if (o > 0) covered += o
  }
  return covered / len >= 0.5
}
