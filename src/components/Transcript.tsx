import { memo, type ReactNode } from 'react'
import { AlertTriangle, Check, PencilLine, Bookmark as BookmarkIcon, Keyboard } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtClock } from '@/lib/time'
import type { Bookmark, Participant, Segment } from '@/lib/types'
import { BOOKMARK_TYPES } from '@/lib/types'
import { Badge } from './ui/badge'

export function speakerName(participants: Participant[], id: string | null): string {
  const p = participants.find((x) => x.id === id)
  if (!p) return 'Unassigned'
  return p.name ? `${p.role} · ${p.name}` : p.role
}

export function speakerTag(participants: Participant[], id: string | null): string {
  const p = participants.find((x) => x.id === id)
  if (!p) return 'UNASSIGNED'
  return (p.name ? `${p.role} ${p.name}` : p.role).toUpperCase()
}

const MARKER_RE = /(\((?:inaudible|unclear)\))/i

export function highlight(text: string, query?: string): ReactNode {
  const parts = text.split(MARKER_RE)
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return (
        <span key={i} className="rounded bg-surface-2 px-1 font-sans text-[0.85em] text-muted italic">
          {part}
        </span>
      )
    }
    if (!query) return <span key={i}>{part}</span>
    const q = query.toLowerCase()
    const out: ReactNode[] = []
    let rest = part
    let k = 0
    while (rest) {
      const idx = rest.toLowerCase().indexOf(q)
      if (idx < 0) {
        out.push(rest)
        break
      }
      out.push(rest.slice(0, idx), <mark key={`${i}-${k++}`}>{rest.slice(idx, idx + q.length)}</mark>)
      rest = rest.slice(idx + q.length)
    }
    return <span key={i}>{out}</span>
  })
}

export function StatusBadge({ s }: { s: Segment }) {
  if (s.status === 'interim') return <Badge tone="info">Listening…</Badge>
  if (s.status === 'needs_review') return (
    <Badge tone="warning">
      <AlertTriangle /> Needs review
    </Badge>
  )
  if (s.status === 'inaudible') return <Badge>Inaudible</Badge>
  if (s.status === 'corrected') return (
    <Badge tone="primary">
      <PencilLine /> Corrected
    </Badge>
  )
  return null
}

type RowProps = {
  segment: Segment
  participants: Participant[]
  active?: boolean
  showTimestamp?: boolean
  showConfidence?: boolean
  query?: string
  bookmarks?: Bookmark[]
  onTimestamp?: () => void
  onClick?: () => void
  right?: ReactNode
  children?: ReactNode
}

export const SegmentRow = memo(function SegmentRow({ segment: s, participants, active, showTimestamp = true, showConfidence, query, bookmarks, onTimestamp, onClick, right, children }: RowProps) {
  return (
    <article
      data-segment-id={s.id}
      aria-label={`${speakerTag(participants, s.speakerId)} at ${fmtClock(s.startMs)}`}
      className={cn(
        'group relative rounded-xl border-l-[3px] py-2.5 pr-2 pl-3 transition-colors duration-200',
        s.status === 'interim' && 'border-dashed border-interactive/50',
        s.status === 'final' && 'border-transparent',
        s.status === 'corrected' && 'border-interactive',
        s.status === 'needs_review' && 'border-warning bg-warning/6',
        s.status === 'inaudible' && 'border-border bg-surface-2/60',
        active && 'bg-interactive/8',
        onClick && 'cursor-pointer hover:bg-surface-2/70',
      )}
      onClick={onClick}
    >
      <header className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {showTimestamp && (
          <button
            type="button"
            onClick={(e) => {
              if (!onTimestamp) return
              e.stopPropagation()
              onTimestamp()
            }}
            className={cn('-my-2 -ml-1 inline-flex min-h-11 items-center rounded-lg px-1 font-mono text-xs tabular-nums text-muted', onTimestamp && 'hover:bg-interactive/10 hover:text-interactive')}
            aria-label={onTimestamp ? `Play from ${fmtClock(s.startMs)}` : undefined}
            tabIndex={onTimestamp ? 0 : -1}
          >
            ({fmtClock(s.startMs)})
          </button>
        )}
        <span className="text-xs font-semibold tracking-wide text-primary">{speakerTag(participants, s.speakerId)}</span>
        {s.source !== 'stt' && (
          <Badge>
            <Keyboard /> {s.source === 'steno' ? 'Steno' : 'Manual'}
          </Badge>
        )}
        <StatusBadge s={s} />
        {s.reviewed && (
          <Badge tone="success">
            <Check /> Reviewed
          </Badge>
        )}
        {showConfidence && s.confidence !== undefined && s.status !== 'interim' && <span className="text-[0.7rem] text-muted">{Math.round(s.confidence * 100)}%</span>}
        {bookmarks?.map((b) => (
          <Badge key={b.id} tone="warning" title={b.note || b.label}>
            <BookmarkIcon /> {BOOKMARK_TYPES.find((t) => t.id === b.type)?.label}
          </Badge>
        ))}
        {right && <div className="ml-auto flex items-center gap-1">{right}</div>}
      </header>
      {children ?? <p className={cn('transcript-text break-words', s.status === 'interim' && 'text-muted italic', s.status === 'inaudible' && 'text-muted italic')}>{highlight(s.text, query)}</p>}
    </article>
  )
})
