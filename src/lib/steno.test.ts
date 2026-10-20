import { describe, expect, it } from 'vitest'
import { DEFAULT_STENO, expandAll, expandBeforeCursor, exportDictionary, parseDictionary } from './steno'

const dict = DEFAULT_STENO

describe('steno expansion', () => {
  it('expands seed abbreviations', () => {
    expect(expandAll('yh', dict)).toBe('Your Honor')
    expect(expandAll('obj', dict)).toBe('Objection, Your Honor.')
    expect(expandAll('the sw said', dict)).toBe('the Sworn witness said')
    expect(expandAll('cc may proceed', dict)).toBe('Counsel for the complainant may proceed')
  })

  it('is word-boundary safe', () => {
    expect(expandAll('object to the cc-form', dict)).toBe('object to the Counsel for the complainant-form')
    expect(expandAll('swim yhx accc obj1', dict)).toBe('swim yhx accc obj1')
    expect(expandAll('Ayh, objection', dict)).toBe('Ayh, objection')
  })

  it('works with punctuation and unicode neighbours', () => {
    expect(expandAll('(yh), obj.', dict)).toBe('(Your Honor), Objection, Your Honor..')
    expect(expandAll('ñyh', dict)).toBe('ñyh')
  })

  it('does not re-expand inside expansions and respects escapes', () => {
    const d = [{ abbr: 'a', expansion: 'a b' }, { abbr: 'b', expansion: 'B!' }]
    expect(expandAll('a', d)).toBe('a b')
    expect(expandAll('\\yh means yh', dict)).toBe('yh means Your Honor')
  })

  it('expands live at the cursor only after a boundary', () => {
    expect(expandBeforeCursor('yh', 2, dict)).toBeNull()
    const out = expandBeforeCursor('Thank you yh ', 13, dict)
    expect(out).toEqual({ value: 'Thank you Your Honor ', cursor: 21 })
    expect(expandBeforeCursor('object ', 7, dict)).toBeNull()
    expect(expandBeforeCursor('xobj,', 5, dict)).toBeNull()
    expect(expandBeforeCursor('obj, more', 4, dict)?.value).toBe('Objection, Your Honor., more')
    expect(expandBeforeCursor('\\yh ', 4, dict)).toEqual({ value: 'yh ', cursor: 3 })
  })

  it('honours case sensitivity option', () => {
    expect(expandAll('YH', dict)).toBe('Your Honor')
    expect(expandAll('YH', dict, { caseSensitive: true })).toBe('YH')
  })

  it('round-trips import/export in JSON and CSV', () => {
    for (const fmt of ['json', 'csv'] as const) {
      const parsed = parseDictionary(exportDictionary(dict, fmt))
      expect(parsed.errors).toEqual([])
      expect(parsed.entries).toEqual(dict.map(({ abbr, expansion }) => ({ abbr, expansion })))
    }
  })

  it('reports invalid and duplicate entries on import', () => {
    const res = parseDictionary('[{"abbr":"a b","expansion":"x"},{"abbr":"yh","expansion":"Your Honor"},{"abbr":"YH","expansion":"dup"}]')
    expect(res.entries).toHaveLength(1)
    expect(res.errors).toHaveLength(2)
  })
})
