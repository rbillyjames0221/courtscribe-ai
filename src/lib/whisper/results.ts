import type { ProviderResult } from '../segments'
import type { Segment } from '../types'
import { speechFraction } from '../audio/vad'
import { cleanWhisperText, isLikelyHallucination } from './models'
import type { WhisperChunk } from './client'

export type WhisperWindow = {
  startMs: number
  endMs: number
  rms: number
  /** VAD speech mask (20 ms frames) for the audio given to Whisper. */
  mask?: Uint8Array
  speechMs?: number
  noiseFloor?: number
}

export type FilterReason = 'empty' | 'hallucination' | 'no-speech-under-text' | 'too-many-words' | 'non-latin' | 'repetition'

/** Why a Whisper chunk must be rejected, or null if it looks like real speech. */
export function rejectReason(text: string, c: { startSec: number; endSec: number | null }, w: WhisperWindow): FilterReason | null {
  if (!text) return 'empty'
  // English / Filipino / Taglish are Latin-script; other scripts are hallucinated language switches.
  if (/[\u0400-\u04FF\u0590-\u06FF\u0900-\u0DFF\u0E00-\u0EFF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/.test(text)) return 'non-latin'
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length >= 6 && new Set(words.map((x) => x.toLowerCase())).size / words.length < 0.35) return 'repetition'
  const durSec = Math.max(0.2, ((w.endMs - w.startMs) / 1000))
  const endSec = c.endSec ?? durSec
  if (w.mask) {
    const frac = speechFraction(w.mask, c.startSec, Math.max(endSec, c.startSec + 0.3))
    if (frac < 0.2) return 'no-speech-under-text'
    const speechSec = Math.max(0.2, frac * Math.max(0.3, endSec - c.startSec))
    if (words.length / speechSec > 6.5) return 'too-many-words'
  }
  const snr = w.noiseFloor && w.noiseFloor > 0 ? w.rms / w.noiseFloor : Infinity
  const speechMs = w.speechMs ?? durSec * 1000
  if (isLikelyHallucination(text, speechMs < 1000 || snr < 4 ? 0 : w.rms)) return 'hallucination'
  return null
}

/**
 * Convert Whisper output for one audio window into final, needs-review provider results with
 * session-relative timestamps. Keys are deterministic so re-running replaces (never duplicates)
 * earlier Whisper output — and user-edited segments are protected by mergeProviderResult.
 */
export function whisperResults(
  out: { text: string; chunks: WhisperChunk[] },
  window: WhisperWindow,
  keyPrefix: string,
  language?: string,
  onReject?: (reason: FilterReason, text: string) => void,
): ProviderResult[] {
  const chunks = out.chunks.length ? out.chunks : [{ text: out.text, startSec: 0, endSec: null }]
  const res: ProviderResult[] = []
  chunks.forEach((c, i) => {
    const text = cleanWhisperText(c.text)
    const why = rejectReason(text, c, window)
    if (why) {
      if (text) onReject?.(why, text)
      return
    }
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
