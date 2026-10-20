import { fmtClock, fmtDate, fmtSrt } from '../time'
import type { Bookmark, Participant, Segment, Session } from '../types'
import { BOOKMARK_TYPES } from '../types'
import type { ExportTemplate } from '@/store/settings'

export const DRAFT_BANNER = 'DRAFT — ASSISTED TRANSCRIPT — NOT CERTIFIED'
export const DISCLAIMER =
  'This document was produced with CourtScribe AI, an assisted transcription tool. It is a working draft that may contain recognition errors and has not been certified. It is not an official court record or stenographic certification and must be verified against the original audio by a qualified person.'

export const TEMPLATES: { id: ExportTemplate; label: string; hint: string }[] = [
  { id: 'verbatim', label: 'Verbatim', hint: 'Every segment as recorded, with speaker and timestamp' },
  { id: 'court-qa', label: 'Court-Style Q&A', hint: 'Q/A examination format with page and line numbers' },
  { id: 'clean', label: 'Clean Reading', hint: 'Derived copy without fillers/repeats — not verbatim' },
  { id: 'interview', label: 'Interview', hint: 'Speaker paragraphs' },
  { id: 'meeting', label: 'Meeting Notes', hint: 'Transcript plus bookmark summary' },
]

export type ExportOptions = {
  template: ExportTemplate
  includeTimestamps: boolean
  coverSheet: boolean
  linesPerPage: number
  lineWidth: number
  includeCorrections: boolean
}

export type Block = { label: string; text: string; atMs: number; endMs: number; flags: string[] }

const COUNSEL = new Set(['Prosecutor', 'Defense Counsel', "Plaintiff's Counsel", "Defendant's Counsel"])

export function speakerLabel(p: Participant | undefined): string {
  if (!p) return 'UNIDENTIFIED SPEAKER'
  return p.name.trim() ? `${p.role.toUpperCase()} (${p.name.trim()})` : p.role.toUpperCase()
}

function courtLabel(p: Participant | undefined, next: Participant | undefined, prev: Participant | undefined): string {
  if (!p) return 'UNIDENTIFIED SPEAKER:'
  if (p.role === 'Judge') return 'COURT:'
  if (p.role === 'Witness') return prev && COUNSEL.has(prev.role) ? 'A:' : `WITNESS${p.name ? ` ${p.name.toUpperCase()}` : ''}:`
  if (COUNSEL.has(p.role)) {
    if (next?.role === 'Witness') return 'Q:'
    const n = p.name.replace(/^atty\.?\s*/i, '').trim()
    return `ATTY.${n ? ` ${n.toUpperCase()}` : ` (${p.role.toUpperCase()})`}:`
  }
  return `${p.role.toUpperCase()}${p.name ? ` ${p.name.toUpperCase()}` : ''}:`
}

const FILLERS = /\b(um+|uh+|ah+|eh+|erm|hmm+)\b[,.]?\s*/gi
export function cleanText(t: string): string {
  return t
    .replace(FILLERS, '')
    .replace(/\b(\p{L}+)(\s+\1\b)+/giu, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function usable(segments: Segment[]): Segment[] {
  return segments.filter((s) => s.status !== 'interim' && s.text.trim()).sort((a, b) => a.startMs - b.startMs || a.seq - b.seq)
}

export function buildBlocks(session: Session, segments: Segment[], opts: ExportOptions): Block[] {
  const list = usable(segments)
  const byId = new Map(session.participants.map((p) => [p.id, p]))
  return list.map((s, i) => {
    const p = s.speakerId ? byId.get(s.speakerId) : undefined
    const next = list[i + 1]?.speakerId ? byId.get(list[i + 1].speakerId!) : undefined
    const prev = list[i - 1]?.speakerId ? byId.get(list[i - 1].speakerId!) : undefined
    const flags: string[] = []
    if (s.status === 'corrected') flags.push('corrected')
    if (s.status === 'needs_review') flags.push('needs review')
    if (s.reviewed) flags.push('reviewed')
    const text = opts.template === 'clean' ? cleanText(s.text) : s.text
    const label = opts.template === 'court-qa' ? courtLabel(p, next, prev) : speakerLabel(p) + ':'
    return { label, text, atMs: s.startMs, endMs: s.endMs, flags }
  })
}

export function metaLines(session: Session): string[] {
  const lines = [
    `Title: ${session.title}`,
    session.caseNumber ? `Case / Reference No.: ${session.caseNumber}` : '',
    session.venue ? `Court / Venue: ${session.venue}` : '',
    `Session date: ${fmtDate(session.sessionDate)}`,
    `Recorded duration: ${fmtClock(session.durationMs)}`,
    `Language: ${session.language === 'mixed' ? 'Experimental mixed English–Filipino' : session.language === 'fil-PH' ? 'Filipino' : 'English'}`,
    `Recording authorization confirmed: ${new Date(session.authorization.confirmedAt).toLocaleString()}${session.authorization.authority ? ` — ${session.authorization.authority}` : ''}`,
  ]
  return lines.filter(Boolean)
}

export function participantLines(session: Session): string[] {
  return session.participants.map((p) => `${p.role}${p.name ? ` — ${p.name}` : ''}`)
}

export function wrap(text: string, width: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word
      else if ((line + ' ' + word).length <= width) line += ' ' + word
      else {
        out.push(line)
        line = word
      }
      while (line.length > width) {
        out.push(line.slice(0, width))
        line = line.slice(width)
      }
    }
    out.push(line)
  }
  return out
}

/** Flowing transcript lines (before pagination). */
export function transcriptLines(session: Session, segments: Segment[], bookmarks: Bookmark[], opts: ExportOptions): string[] {
  const blocks = buildBlocks(session, segments, opts)
  const lines: string[] = []
  const indent = opts.template === 'court-qa' ? 10 : 0
  for (const b of blocks) {
    const ts = opts.includeTimestamps ? `(${fmtClock(b.atMs)}) ` : ''
    const flag = opts.includeCorrections && b.flags.length ? ` [${b.flags.join(', ')}]` : ''
    if (opts.template === 'court-qa') {
      const head = `${ts}${b.label}`.padEnd(indent + (ts ? ts.length : 0))
      const body = wrap(`${b.text}${flag}`, opts.lineWidth - head.length - 1)
      body.forEach((l, i) => lines.push(i === 0 ? `${head} ${l}` : `${' '.repeat(head.length)} ${l}`))
    } else if (opts.template === 'interview' || opts.template === 'meeting') {
      lines.push(`${ts}${b.label}`)
      wrap(`${b.text}${flag}`, opts.lineWidth).forEach((l) => lines.push(`    ${l}`))
      lines.push('')
    } else {
      wrap(`${ts}${b.label} ${b.text}${flag}`, opts.lineWidth).forEach((l, i) => lines.push(i === 0 ? l : `    ${l}`))
    }
  }
  if (opts.template === 'meeting' && bookmarks.length) {
    lines.push('', 'BOOKMARKS AND NOTES', '')
    for (const b of [...bookmarks].sort((x, y) => x.atMs - y.atMs)) {
      const type = BOOKMARK_TYPES.find((t) => t.id === b.type)?.label ?? b.type
      wrap(`(${fmtClock(b.atMs)}) ${type}${b.label ? ` — ${b.label}` : ''}${b.note ? `: ${b.note}` : ''}`, opts.lineWidth).forEach((l) => lines.push(l))
    }
  }
  if (!blocks.length) lines.push('(No transcript segments were recorded.)')
  return lines
}

export type Page = { number: number; lines: string[] }

export function paginate(lines: string[], perPage: number): Page[] {
  const pages: Page[] = []
  for (let i = 0; i < lines.length; i += perPage) pages.push({ number: pages.length + 1, lines: lines.slice(i, i + perPage) })
  return pages.length ? pages : [{ number: 1, lines: [] }]
}

export function coverLines(session: Session, opts: ExportOptions): string[] {
  const tpl = TEMPLATES.find((t) => t.id === opts.template)?.label ?? opts.template
  return [
    DRAFT_BANNER,
    '',
    session.title.toUpperCase(),
    '',
    ...metaLines(session),
    `Format: ${tpl}${opts.template === 'clean' ? ' (derived copy — not verbatim)' : ''}`,
    '',
    'APPEARANCES / PARTICIPANTS',
    ...participantLines(session),
    '',
    ...wrap(DISCLAIMER, opts.lineWidth),
  ]
}

export function buildTxt(session: Session, segments: Segment[], bookmarks: Bookmark[], opts: ExportOptions): string {
  const body = transcriptLines(session, segments, bookmarks, opts)
  const out: string[] = []
  if (opts.coverSheet) out.push(...coverLines(session, opts), '', '='.repeat(opts.lineWidth), '')
  else out.push(DRAFT_BANNER, '', ...metaLines(session), '')
  if (opts.template === 'court-qa') {
    for (const page of paginate(body, opts.linesPerPage)) {
      out.push(`${DRAFT_BANNER}`.padEnd(opts.lineWidth - 10) + `Page ${page.number}`, '')
      page.lines.forEach((l, i) => out.push(`${String(i + 1).padStart(2, ' ')}  ${l}`))
      out.push('', '-'.repeat(opts.lineWidth), '')
    }
  } else out.push(...body)
  out.push('', ...wrap(DISCLAIMER, opts.lineWidth))
  return out.join('\n')
}

export function buildSrt(session: Session, segments: Segment[]): string {
  const list = usable(segments)
  const byId = new Map(session.participants.map((p) => [p.id, p]))
  return list
    .map((s, i) => {
      const next = list[i + 1]
      const end = Math.max(s.endMs, s.startMs + 1200, 0)
      const clipped = next ? Math.min(end, Math.max(next.startMs - 1, s.startMs + 500)) : end
      const who = s.speakerId ? speakerLabel(byId.get(s.speakerId)) : ''
      return `${i + 1}\n${fmtSrt(s.startMs)} --> ${fmtSrt(clipped)}\n${who ? `${who}: ` : ''}${s.text}\n`
    })
    .join('\n')
}

export function buildJson(session: Session, segments: Segment[], bookmarks: Bookmark[]): string {
  return JSON.stringify(
    {
      format: 'courtscribe-transcript-v1',
      status: 'DRAFT',
      certified: false,
      disclaimer: DISCLAIMER,
      exportedAt: new Date().toISOString(),
      session,
      segments: usable(segments).map((s) => ({
        id: s.id,
        seq: s.seq,
        startMs: s.startMs,
        endMs: s.endMs,
        speakerId: s.speakerId,
        text: s.text,
        originalText: s.originalText,
        status: s.status,
        reviewed: s.reviewed,
        confidence: s.confidence,
        source: s.source,
        revisions: s.revisions,
      })),
      bookmarks,
    },
    null,
    2,
  )
}
