import { StenoDictionary, type StenoEntry } from './types'

export const DEFAULT_STENO: StenoEntry[] = [
  { abbr: 'yh', expansion: 'Your Honor' },
  { abbr: 'obj', expansion: 'Objection, Your Honor.' },
  { abbr: 'sw', expansion: 'Sworn witness' },
  { abbr: 'cc', expansion: 'Counsel for the complainant' },
  { abbr: 'sus', expansion: 'Sustained.' },
  { abbr: 'ovr', expansion: 'Overruled.' },
  { abbr: 'nfq', expansion: 'No further questions, Your Honor.' },
  { abbr: 'pp', expansion: 'People of the Philippines' },
  { abbr: 'cd', expansion: 'Counsel for the defense' },
  { abbr: 'rtc', expansion: 'Regional Trial Court' },
  { abbr: 'ibp', expansion: 'Integrated Bar of the Philippines' },
  { abbr: 'opo', expansion: 'Opo, Your Honor.' },
]

const WORD_CHAR = /[\p{L}\p{N}_]/u

export function isWordChar(ch: string | undefined): boolean {
  return !!ch && WORD_CHAR.test(ch)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export type StenoOptions = { caseSensitive?: boolean }

function lookupMap(dict: StenoEntry[], caseSensitive: boolean): Map<string, string> {
  const m = new Map<string, string>()
  for (const e of dict) m.set(caseSensitive ? e.abbr : e.abbr.toLowerCase(), e.expansion)
  return m
}

/**
 * Expand every whole-word abbreviation in `text` in a single pass.
 * Word-boundary safe ("obj" inside "object" is untouched) and non-recursive
 * (expansions are never re-expanded). Prefix an abbreviation with "\" to keep it literal.
 */
export function expandAll(text: string, dict: StenoEntry[], opts: StenoOptions = {}): string {
  if (!dict.length || !text) return text
  const cs = !!opts.caseSensitive
  const map = lookupMap(dict, cs)
  const alts = [...dict].map((e) => e.abbr).sort((a, b) => b.length - a.length).map(escapeRe)
  const re = new RegExp(`(\\\\?)(?<![\\p{L}\\p{N}_])(${alts.join('|')})(?![\\p{L}\\p{N}_])`, cs ? 'gu' : 'giu')
  return text.replace(re, (whole, esc: string, abbr: string, offset: number, full: string) => {
    if (esc) return abbr // escaped literal: drop the backslash
    const prev = full[offset - 1]
    if (isWordChar(prev)) return whole
    return map.get(cs ? abbr : abbr.toLowerCase()) ?? whole
  })
}

/**
 * Live-typing expansion: call after a boundary character (space, punctuation, newline) was typed
 * at `cursor`. Returns the new value + cursor, or null when nothing should change.
 */
export function expandBeforeCursor(
  value: string,
  cursor: number,
  dict: StenoEntry[],
  opts: StenoOptions = {},
): { value: string; cursor: number } | null {
  if (cursor <= 0 || !dict.length) return null
  const boundary = value[cursor - 1]
  if (isWordChar(boundary)) return null
  const body = value.slice(0, cursor - 1)
  const cs = !!opts.caseSensitive
  const sorted = [...dict].sort((a, b) => b.abbr.length - a.abbr.length)
  for (const e of sorted) {
    const a = e.abbr
    if (body.length < a.length) continue
    const tail = body.slice(body.length - a.length)
    if (cs ? tail !== a : tail.toLowerCase() !== a.toLowerCase()) continue
    const startIdx = body.length - a.length
    const prev = body[startIdx - 1]
    if (prev === '\\') {
      // literal escape: remove the backslash, keep abbreviation
      const nextValue = body.slice(0, startIdx - 1) + tail + boundary + value.slice(cursor)
      return { value: nextValue, cursor: cursor - 1 }
    }
    if (isWordChar(prev)) continue
    const nextValue = body.slice(0, startIdx) + e.expansion + boundary + value.slice(cursor)
    return { value: nextValue, cursor: startIdx + e.expansion.length + 1 }
  }
  return null
}

export type ParseResult = { entries: StenoEntry[]; errors: string[] }

export function parseDictionary(raw: string): ParseResult {
  const text = raw.trim()
  const errors: string[] = []
  let candidates: unknown[] = []
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const data = JSON.parse(text)
      candidates = Array.isArray(data) ? data : Array.isArray(data?.entries) ? data.entries : []
    } catch (e) {
      return { entries: [], errors: [`Invalid JSON: ${(e as Error).message}`] }
    }
  } else {
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    lines.forEach((line, i) => {
      const m = line.match(/^\s*"?([^",\t]+)"?\s*[,\t]\s*(.+)$/)
      if (!m) return errors.push(`Line ${i + 1}: expected "abbr,expansion"`)
      if (i === 0 && /^abbr/i.test(m[1].trim())) return
      candidates.push({ abbr: m[1].trim(), expansion: m[2].trim().replace(/^"(.*)"$/, '$1').replace(/""/g, '"') })
    })
  }
  const entries: StenoEntry[] = []
  const seen = new Set<string>()
  candidates.forEach((c, i) => {
    const r = StenoDictionary.element.safeParse(c)
    if (!r.success) return errors.push(`Entry ${i + 1}: ${r.error.issues[0]?.message ?? 'invalid'}`)
    const key = r.data.abbr.toLowerCase()
    if (seen.has(key)) return errors.push(`Entry ${i + 1}: duplicate "${r.data.abbr}"`)
    seen.add(key)
    entries.push(r.data)
  })
  return { entries, errors }
}

export function exportDictionary(entries: StenoEntry[], format: 'json' | 'csv'): string {
  if (format === 'json') return JSON.stringify({ format: 'courtscribe-steno-v1', entries }, null, 2)
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`
  return ['abbr,expansion', ...entries.map((e) => `${q(e.abbr)},${q(e.expansion)}`)].join('\n')
}
