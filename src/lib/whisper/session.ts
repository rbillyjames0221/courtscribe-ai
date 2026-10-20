/** Post-recording / imported-audio transcription of a session's saved audio with on-device Whisper. */
import { repo } from '../db'
import { mergeProviderResult, sortSegments } from '../segments'
import { decodeTo16k, rms, splitWindows, WHISPER_RATE } from '../audio/pcm'
import type { AudioChunk, Language, Segment } from '../types'
import { loadWhisper, transcribePcm, type WhisperDevice } from './client'
import { whisperLanguage, type WhisperModelId } from './models'
import { coveredByOther, whisperResults } from './results'

export type TranscribeProgress = { phase: 'model' | 'decoding' | 'transcribing' | 'done'; done: number; total: number; added: number }

export async function transcribeSessionAudio(
  sessionId: string,
  o: { model: WhisperModelId; device?: WhisperDevice; language: Language; onlyGaps: boolean; signal?: AbortSignal; onProgress?: (p: TranscribeProgress) => void },
): Promise<{ added: number; windows: number }> {
  o.onProgress?.({ phase: 'model', done: 0, total: 0, added: 0 })
  await loadWhisper(o.model, o.device)
  const chunks = await repo.chunks(sessionId)
  if (!chunks.length) throw new Error('This session has no saved audio to transcribe.')
  // Each capture run is one independently decodable file (MediaRecorder header is in its first chunk).
  const runs = new Map<number, AudioChunk[]>()
  for (const c of chunks) runs.set(c.run, [...(runs.get(c.run) ?? []), c])
  const plan: { pcm: Float32Array; offsetMs: number; windows: { start: number; end: number }[] }[] = []
  let total = 0
  o.onProgress?.({ phase: 'decoding', done: 0, total: 0, added: 0 })
  for (const [, list] of [...runs.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a.seq - b.seq)
    const blob = new Blob(list.map((c) => c.blob), { type: list[0].mimeType })
    let pcm: Float32Array
    try {
      pcm = await decodeTo16k(blob)
    } catch (e) {
      throw new Error(`Could not decode the saved audio (${(e as Error).message}). Try exporting the audio and importing it again.`)
    }
    const windows = splitWindows(pcm)
    total += windows.length
    plan.push({ pcm, offsetMs: list[0].startMs, windows })
  }
  const session = await repo.getSession(sessionId)
  let segments = await repo.segments(sessionId)
  let done = 0
  let added = 0
  const lang = whisperLanguage(o.language)
  // Post-run Whisper output (key "wh:") is replaced in place on re-runs, so it never counts as coverage.
  // Live Whisper text and human-edited lines always count; live browser text counts only in "fill gaps" mode.
  const ignore = (s: Segment) => s.providerKey?.startsWith('wh:') === true && !s.userEdited ? true : !o.onlyGaps && s.source === 'stt' && s.engine !== 'whisper' && !s.userEdited
  const covered = (a: number, b: number) => coveredByOther(segments, a, b, ignore)
  for (const run of plan) {
    for (const w of run.windows) {
      if (o.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      const startMs = run.offsetMs + (w.start / WHISPER_RATE) * 1000
      const endMs = run.offsetMs + (w.end / WHISPER_RATE) * 1000
      const energy = rms(run.pcm, w.start, w.end)
      if (energy > 0.004 && !covered(startMs, endMs)) {
        const out = await transcribePcm(run.pcm.slice(w.start, w.end), lang)
        const results = whisperResults(out, { startMs, endMs, rms: energy }, 'wh', lang ?? 'auto').filter((r) => !covered(r.startMs, r.endMs))
        const changed: string[] = []
        for (const r of results) {
          const m = mergeProviderResult(segments, r, { sessionId, speakerId: null, now: Date.now() })
          if (m.action === 'inserted') added += 1
          if (m.segment && m.action !== 'ignored' && m.action !== 'duplicate') changed.push(m.segment.id)
          segments = m.segments
        }
        if (changed.length) await repo.putSegments(segments.filter((s) => changed.includes(s.id)))
      }
      done += 1
      o.onProgress?.({ phase: 'transcribing', done, total, added })
    }
  }
  if (session) await repo.putSession({ ...session, updatedAt: Date.now() })
  segments = sortSegments(segments)
  o.onProgress?.({ phase: 'done', done, total, added })
  return { added, windows: total }
}
