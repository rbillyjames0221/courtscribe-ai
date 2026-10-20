/**
 * Pure transcript-segment merge logic.
 *
 * Guarantees (covered by segments.test.ts):
 *  - Stable ids: a segment's id is derived deterministically from sessionId + providerKey,
 *    so replaying the same provider result after a reconnect targets the same record.
 *  - No duplicates: interim revisions update one segment in place; a final that repeats an
 *    already-final utterance under a new key (stream rollover / reconnect replay) is dropped.
 *  - Idempotent: applying the same result twice yields an identical array.
 *  - User corrections win: once a human edits a segment, provider output is never written
 *    into `text`; it is parked in `heldProviderText` for optional manual review.
 */
import type { Segment, SegmentStatus } from './types'

export type ProviderResult = {
  /** Unique per utterance within a session (e.g. "run1:r0:i3"). */
  key: string
  text: string
  isFinal: boolean
  startMs: number
  endMs: number
  confidence?: number
  language?: string
}

export type MergeContext = {
  sessionId: string
  speakerId: string | null
  now: number
  /** Finals below this confidence are flagged needs_review. */
  reviewThreshold?: number
  /** Window for treating an identical final under a different key as a duplicate. */
  duplicateWindowMs?: number
}

export type MergeAction = 'inserted' | 'updated' | 'finalized' | 'ignored' | 'held' | 'duplicate'
export type MergeOutcome = { segments: Segment[]; segment: Segment | null; action: MergeAction }

export function segmentId(sessionId: string, providerKey: string): string {
  return `${sessionId}::${providerKey}`
}

export function normalizeText(t: string): string {
  return t
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function nextSeq(segments: Segment[]): number {
  let max = 0
  for (const s of segments) if (s.seq > max) max = s.seq
  return max + 1
}

export function isSettled(s: Segment): boolean {
  return s.status !== 'interim'
}

function finalStatus(confidence: number | undefined, threshold: number): SegmentStatus {
  if (confidence !== undefined && confidence > 0 && confidence < threshold) return 'needs_review'
  return 'final'
}

function replace(segments: Segment[], next: Segment): Segment[] {
  return segments.map((s) => (s.id === next.id ? next : s))
}

export function mergeProviderResult(segments: Segment[], r: ProviderResult, ctx: MergeContext): MergeOutcome {
  const threshold = ctx.reviewThreshold ?? 0.55
  const window = ctx.duplicateWindowMs ?? 2500
  const text = r.text.replace(/\s+/g, ' ').trim()
  const id = segmentId(ctx.sessionId, r.key)
  const existing = segments.find((s) => s.id === id)

  if (!existing) {
    if (!text) return { segments, segment: null, action: 'ignored' }
    if (r.isFinal) {
      const norm = normalizeText(text)
      const dup = segments.find(
        (s) => isSettled(s) && s.source === 'stt' && normalizeText(s.originalText || s.text) === norm && Math.abs(s.startMs - r.startMs) <= window,
      )
      if (dup) return { segments, segment: dup, action: 'duplicate' }
    }
    const status: SegmentStatus = r.isFinal ? finalStatus(r.confidence, threshold) : 'interim'
    const seg: Segment = {
      id,
      sessionId: ctx.sessionId,
      seq: nextSeq(segments),
      providerKey: r.key,
      startMs: r.startMs,
      endMs: Math.max(r.endMs, r.startMs),
      speakerId: ctx.speakerId,
      text,
      originalText: r.isFinal ? text : '',
      status,
      userEdited: false,
      reviewed: false,
      confidence: r.confidence,
      source: 'stt',
      language: r.language,
      revisions: r.isFinal ? [{ at: ctx.now, by: 'provider', text, speakerId: ctx.speakerId, status }] : [],
    }
    return { segments: [...segments, seg], segment: seg, action: 'inserted' }
  }

  // A human has touched this segment: never overwrite their words.
  if (existing.userEdited) {
    if (r.isFinal && text && text !== existing.text && text !== existing.heldProviderText) {
      const next = { ...existing, heldProviderText: text }
      return { segments: replace(segments, next), segment: next, action: 'held' }
    }
    return { segments, segment: existing, action: 'ignored' }
  }

  // Late interim after the final: final wins.
  if (!r.isFinal && isSettled(existing)) return { segments, segment: existing, action: 'ignored' }

  if (!r.isFinal) {
    if (!text || (text === existing.text && r.endMs <= existing.endMs)) return { segments, segment: existing, action: 'ignored' }
    const next: Segment = { ...existing, text, endMs: Math.max(existing.endMs, r.endMs), confidence: r.confidence ?? existing.confidence }
    return { segments: replace(segments, next), segment: next, action: 'updated' }
  }

  // Final result.
  const status = finalStatus(r.confidence, threshold)
  if (isSettled(existing) && existing.text === text) return { segments, segment: existing, action: 'ignored' }
  if (!text) {
    // Provider finalized with nothing: keep the last interim text but flag it for review.
    if (isSettled(existing)) return { segments, segment: existing, action: 'ignored' }
    const next: Segment = {
      ...existing,
      status: 'needs_review',
      originalText: existing.text,
      revisions: [...existing.revisions, { at: ctx.now, by: 'provider', text: existing.text, speakerId: existing.speakerId, status: 'needs_review', note: 'Empty final; last interim kept' }],
    }
    return { segments: replace(segments, next), segment: next, action: 'finalized' }
  }
  const wasInterim = !isSettled(existing)
  const next: Segment = {
    ...existing,
    text,
    originalText: wasInterim ? text : existing.originalText,
    status,
    endMs: Math.max(existing.endMs, r.endMs),
    confidence: r.confidence ?? existing.confidence,
    language: r.language ?? existing.language,
    revisions: [...existing.revisions, { at: ctx.now, by: 'provider', text, speakerId: existing.speakerId, status, note: wasInterim ? undefined : 'Provider revision' }],
  }
  return { segments: replace(segments, next), segment: next, action: wasInterim ? 'finalized' : 'updated' }
}

export function mergeBatch(segments: Segment[], results: ProviderResult[], ctx: MergeContext): Segment[] {
  return results.reduce((acc, r) => mergeProviderResult(acc, r, ctx).segments, segments)
}

/** Convert any lingering interim segments (e.g. stream dropped before finalizing) to needs_review. */
export function settleInterims(segments: Segment[], now: number): Segment[] {
  return segments.map((s) =>
    s.status === 'interim'
      ? {
          ...s,
          status: 'needs_review' as const,
          originalText: s.text,
          revisions: [...s.revisions, { at: now, by: 'system' as const, text: s.text, speakerId: s.speakerId, status: 'needs_review' as const, note: 'Stream ended before final result' }],
        }
      : s,
  )
}

export const INAUDIBLE = '(inaudible)'
export const UNCLEAR = '(unclear)'

export function editText(seg: Segment, text: string, now: number, note?: string): Segment {
  const clean = text.replace(/[ \t]+/g, ' ').trim()
  if (clean === seg.text) return seg
  const status: SegmentStatus = clean === INAUDIBLE ? 'inaudible' : 'corrected'
  return {
    ...seg,
    text: clean,
    status,
    userEdited: true,
    revisions: [...seg.revisions, { at: now, by: 'user', text: clean, speakerId: seg.speakerId, status, note }],
  }
}

export function setSpeaker(seg: Segment, speakerId: string | null, now: number): Segment {
  if (seg.speakerId === speakerId) return seg
  return {
    ...seg,
    speakerId,
    userEdited: true,
    revisions: [...seg.revisions, { at: now, by: 'user', text: seg.text, speakerId, status: seg.status, note: 'Speaker reassigned' }],
  }
}

export function setReviewed(seg: Segment, reviewed: boolean, now: number): Segment {
  if (seg.reviewed === reviewed) return seg
  return {
    ...seg,
    reviewed,
    status: reviewed && seg.status === 'needs_review' ? 'final' : seg.status,
    revisions: [...seg.revisions, { at: now, by: 'user', text: seg.text, speakerId: seg.speakerId, status: seg.status, note: reviewed ? 'Marked reviewed' : 'Review cleared' }],
  }
}

/** Restore a previous snapshot of a segment while keeping the full revision trail. */
export function restoreSnapshot(current: Segment, snapshot: Segment, now: number): Segment {
  return {
    ...current,
    text: snapshot.text,
    speakerId: snapshot.speakerId,
    status: snapshot.status,
    reviewed: snapshot.reviewed,
    userEdited: snapshot.userEdited || current.userEdited,
    revisions: [...current.revisions, { at: now, by: 'user', text: snapshot.text, speakerId: snapshot.speakerId, status: snapshot.status, note: 'Undo' }],
  }
}

export function manualSegment(args: {
  sessionId: string
  seq: number
  text: string
  startMs: number
  endMs?: number
  speakerId: string | null
  source: 'manual' | 'steno'
  now: number
  id: string
}): Segment {
  const text = args.text.trim()
  const status: SegmentStatus = text === INAUDIBLE ? 'inaudible' : 'final'
  return {
    id: args.id,
    sessionId: args.sessionId,
    seq: args.seq,
    providerKey: `manual:${args.id}`,
    startMs: args.startMs,
    endMs: args.endMs ?? args.startMs,
    speakerId: args.speakerId,
    text,
    originalText: text,
    status,
    userEdited: true,
    reviewed: false,
    source: args.source,
    revisions: [{ at: args.now, by: 'user', text, speakerId: args.speakerId, status, note: 'Manual entry' }],
  }
}

export function sortSegments(segments: Segment[]): Segment[] {
  return [...segments].sort((a, b) => a.startMs - b.startMs || a.seq - b.seq)
}

export function findReplace(seg: Segment, find: string, replaceWith: string, now: number, caseSensitive = false): Segment {
  if (!find) return seg
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi')
  const nextText = seg.text.replace(re, replaceWith)
  return nextText === seg.text ? seg : editText(seg, nextText, now, `Replace "${find}" → "${replaceWith}"`)
}
