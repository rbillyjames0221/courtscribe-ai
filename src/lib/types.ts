import { z } from 'zod'

export const SPEAKER_ROLES = [
  'Judge',
  'Court Stenographer',
  'Prosecutor',
  'Defense Counsel',
  "Plaintiff's Counsel",
  "Defendant's Counsel",
  'Witness',
  'Interpreter',
  'Court Clerk',
  'Other',
] as const
export const SpeakerRole = z.enum(SPEAKER_ROLES)
export type SpeakerRole = z.infer<typeof SpeakerRole>

export const LANGUAGES = [
  { id: 'en-PH', label: 'English', hint: 'Philippine English (en-PH)' },
  { id: 'fil-PH', label: 'Filipino', hint: 'Filipino / Tagalog (fil-PH)' },
  { id: 'mixed', label: 'Experimental Mixed', hint: 'English–Tagalog code-switching. Accuracy not guaranteed.' },
] as const
export const Language = z.enum(['en-PH', 'fil-PH', 'mixed'])
export type Language = z.infer<typeof Language>

export const MODES = [
  { id: 'live', label: 'Live Speech-to-Text', hint: 'Automatic transcript while recording' },
  { id: 'steno', label: 'Manual / Steno', hint: 'You type with shorthand expansion; audio is still recorded' },
  { id: 'hybrid', label: 'Hybrid', hint: 'Live speech-to-text plus manual notes and corrections' },
] as const
export const Mode = z.enum(['live', 'steno', 'hybrid'])
export type Mode = z.infer<typeof Mode>

export const Participant = z.object({
  id: z.string(),
  name: z.string().max(120),
  role: SpeakerRole,
})
export type Participant = z.infer<typeof Participant>

export const SessionStatus = z.enum(['draft', 'recording', 'paused', 'interrupted', 'completed'])
export type SessionStatus = z.infer<typeof SessionStatus>

export const Session = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  caseNumber: z.string().max(120).default(''),
  venue: z.string().max(200).default(''),
  sessionDate: z.string(),
  participants: z.array(Participant),
  language: Language,
  mode: Mode,
  recordingSource: z.enum(['microphone', 'none']).default('microphone'),
  storageMode: z.enum(['local', 'local-no-audio']).default('local'),
  providerId: z.string().default('webspeech'),
  glossary: z.array(z.string()).default([]),
  status: SessionStatus,
  authorization: z.object({
    confirmed: z.literal(true),
    confirmedAt: z.number(),
    authority: z.string().max(200).default(''),
  }),
  createdAt: z.number(),
  updatedAt: z.number(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
  /** Active (non-paused) recording time in ms. */
  durationMs: z.number().default(0),
  /** Number of capture runs (a crash/resume starts a new run). */
  runCount: z.number().default(0),
  lastCheckpoint: z
    .object({ at: z.number(), chunkSeq: z.number(), segmentCount: z.number(), durationMs: z.number() })
    .optional(),
})
export type Session = z.infer<typeof Session>

export const SegmentStatus = z.enum(['interim', 'final', 'corrected', 'needs_review', 'inaudible'])
export type SegmentStatus = z.infer<typeof SegmentStatus>

export const Revision = z.object({
  at: z.number(),
  by: z.enum(['provider', 'user', 'system']),
  text: z.string(),
  speakerId: z.string().nullable(),
  status: SegmentStatus,
  note: z.string().optional(),
})
export type Revision = z.infer<typeof Revision>

export const Segment = z.object({
  id: z.string(),
  sessionId: z.string(),
  /** Monotonic order within the session (assigned on first insert, never reused). */
  seq: z.number(),
  /** Provider-assigned key used for idempotent upserts (e.g. "run2:r0:i5"). */
  providerKey: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  speakerId: z.string().nullable(),
  text: z.string(),
  /** First final text from the provider, preserved even after user corrections. */
  originalText: z.string(),
  status: SegmentStatus,
  /** True once a human edited text/speaker; provider output may never overwrite it. */
  userEdited: z.boolean(),
  reviewed: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  source: z.enum(['stt', 'manual', 'steno']),
  language: z.string().optional(),
  revisions: z.array(Revision),
  /** Later provider text that was held back because the user had already corrected this segment. */
  heldProviderText: z.string().optional(),
})
export type Segment = z.infer<typeof Segment>

export const BOOKMARK_TYPES = [
  { id: 'important', label: 'Important statement' },
  { id: 'objection', label: 'Objection' },
  { id: 'ruling', label: 'Court ruling' },
  { id: 'answer', label: 'Witness answer' },
  { id: 'exhibit', label: 'Exhibit reference' },
  { id: 'review', label: 'Needs review' },
  { id: 'custom', label: 'Custom marker' },
  { id: 'note', label: 'Note' },
] as const
export const BookmarkType = z.enum(['important', 'objection', 'ruling', 'answer', 'exhibit', 'review', 'custom', 'note'])
export type BookmarkType = z.infer<typeof BookmarkType>

export const Bookmark = z.object({
  id: z.string(),
  sessionId: z.string(),
  type: BookmarkType,
  atMs: z.number(),
  label: z.string().max(200).default(''),
  note: z.string().max(4000).default(''),
  segmentId: z.string().nullable().default(null),
  createdAt: z.number(),
})
export type Bookmark = z.infer<typeof Bookmark>

export type AudioChunk = {
  id: string // `${sessionId}:${seq}`
  sessionId: string
  seq: number
  run: number
  /** Session-timeline offsets (active recording time). */
  startMs: number
  endMs: number
  mimeType: string
  size: number
  blob: Blob
  createdAt: number
}

export const StenoEntry = z.object({
  abbr: z.string().min(1).max(40).regex(/^\S+$/, 'No spaces in abbreviations'),
  expansion: z.string().min(1).max(500),
  note: z.string().max(200).optional(),
})
export type StenoEntry = z.infer<typeof StenoEntry>
export const StenoDictionary = z.array(StenoEntry)

export function roleShort(role: SpeakerRole): string {
  return role.toUpperCase()
}
