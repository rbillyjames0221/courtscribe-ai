import { describe, expect, it } from 'vitest'
import {
  editText,
  manualSegment,
  mergeBatch,
  mergeProviderResult,
  restoreSnapshot,
  segmentId,
  setReviewed,
  setSpeaker,
  settleInterims,
  type MergeContext,
  type ProviderResult,
} from './segments'
import type { Segment } from './types'

const ctx: MergeContext = { sessionId: 's1', speakerId: 'judge', now: 1000 }
const r = (key: string, text: string, isFinal: boolean, startMs = 0, extra: Partial<ProviderResult> = {}): ProviderResult => ({
  key,
  text,
  isFinal,
  startMs,
  endMs: startMs + 1500,
  ...extra,
})

describe('segment merge', () => {
  it('assigns stable deterministic ids from session + provider key', () => {
    const a = mergeProviderResult([], r('run1:i0', 'Counsel', false), ctx)
    expect(a.segment?.id).toBe(segmentId('s1', 'run1:i0'))
    const b = mergeProviderResult(a.segments, r('run1:i0', 'Counsel, are you', false), ctx)
    expect(b.segment?.id).toBe(a.segment?.id)
    expect(b.segments).toHaveLength(1)
  })

  it('updates interim revisions in place without duplicating sentences', () => {
    const segs = mergeBatch(
      [],
      [
        r('k0', 'Counsel', false),
        r('k0', 'Counsel, are you', false),
        r('k0', 'Counsel, are you ready', false),
        r('k0', 'Counsel, are you ready to present your witness?', true),
      ],
      ctx,
    )
    expect(segs).toHaveLength(1)
    expect(segs[0].status).toBe('final')
    expect(segs[0].text).toBe('Counsel, are you ready to present your witness?')
    expect(segs[0].originalText).toBe(segs[0].text)
  })

  it('is idempotent: replaying the same results changes nothing', () => {
    const results = [r('k0', 'Yes, Your Honor.', false), r('k0', 'Yes, Your Honor. We are ready.', true), r('k1', 'Opo, Your Honor.', true, 3000)]
    const once = mergeBatch([], results, ctx)
    const twice = mergeBatch(once, results, ctx)
    expect(twice).toEqual(once)
    expect(twice.map((s) => s.seq)).toEqual([1, 2])
  })

  it('ignores late interims arriving after the final', () => {
    const segs = mergeBatch([], [r('k0', 'We are ready to proceed.', true), r('k0', 'We are ready', false)], ctx)
    expect(segs[0].text).toBe('We are ready to proceed.')
    expect(segs[0].status).toBe('final')
  })

  it('drops a duplicate final replayed under a new key after reconnect', () => {
    const a = mergeBatch([], [r('run1:i4', 'Nandito po ako noong nangyari ang insidente.', true, 60_000)], ctx)
    const b = mergeProviderResult(a, r('run2:i0', 'Nandito po ako noong nangyari ang insidente', true, 60_400), ctx)
    expect(b.action).toBe('duplicate')
    expect(b.segments).toHaveLength(1)
  })

  it('keeps identical wording spoken later as a separate segment', () => {
    const a = mergeBatch([], [r('k0', 'Objection, Your Honor.', true, 1000)], ctx)
    const b = mergeProviderResult(a, r('k9', 'Objection, Your Honor.', true, 90_000), ctx)
    expect(b.action).toBe('inserted')
    expect(b.segments).toHaveLength(2)
  })

  it('never overwrites a user correction with later provider output', () => {
    const [seg] = mergeBatch([], [r('k0', 'Your honor the witness is hear', true)], ctx)
    const corrected = editText(seg, 'Your Honor, the witness is here.', 2000)
    const out = mergeProviderResult([corrected], r('k0', 'Your honor the witness is hear now', true), ctx)
    expect(out.action).toBe('held')
    expect(out.segment?.text).toBe('Your Honor, the witness is here.')
    expect(out.segment?.status).toBe('corrected')
    expect(out.segment?.heldProviderText).toBe('Your honor the witness is hear now')
    // interim after correction is ignored entirely
    const again = mergeProviderResult(out.segments, r('k0', 'something else', false), ctx)
    expect(again.segments[0].text).toBe('Your Honor, the witness is here.')
  })

  it('preserves speaker reassignment against provider updates', () => {
    const [seg] = mergeBatch([], [r('k0', 'I was there', false)], ctx)
    const moved = setSpeaker(seg, 'witness', 1500)
    const out = mergeProviderResult([moved], r('k0', 'I was there that night', true), ctx)
    expect(out.segments[0].speakerId).toBe('witness')
    expect(out.segments[0].text).toBe('I was there')
  })

  it('flags low-confidence finals for review and settles orphan interims', () => {
    const segs = mergeBatch([], [r('k0', 'mumbled words', true, 0, { confidence: 0.3 }), r('k1', 'trailing', false, 2000)], ctx)
    expect(segs[0].status).toBe('needs_review')
    const settled = settleInterims(segs, 5000)
    expect(settled[1].status).toBe('needs_review')
    expect(settled.every((s) => s.status !== 'interim')).toBe(true)
  })

  it('records revision history, marks inaudible, review and undo', () => {
    const [seg] = mergeBatch([], [r('k0', 'garbled', true)], ctx)
    const inaud = editText(seg, '(inaudible)', 2000)
    expect(inaud.status).toBe('inaudible')
    const reviewed = setReviewed(inaud, true, 2100)
    expect(reviewed.reviewed).toBe(true)
    const undone = restoreSnapshot(reviewed, seg, 2200)
    expect(undone.text).toBe('garbled')
    expect(undone.revisions.map((x) => x.by)).toEqual(['provider', 'user', 'user', 'user'])
    expect(undone.originalText).toBe('garbled')
  })

  it('manual/steno segments are protected from provider writes', () => {
    const m: Segment = manualSegment({ id: 'm1', sessionId: 's1', seq: 1, text: 'Sworn witness', startMs: 0, speakerId: 'clerk', source: 'steno', now: 1 })
    expect(m.userEdited).toBe(true)
    expect(m.source).toBe('steno')
    const out = mergeProviderResult([m], { key: m.providerKey, text: 'x', isFinal: true, startMs: 0, endMs: 1 }, ctx)
    expect(out.segments[0].text).toBe('Sworn witness')
  })
})
