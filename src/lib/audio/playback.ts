import type { AudioChunk } from '../types'

export type AudioRun = { run: number; offsetMs: number; endMs: number; url: string; mimeType: string; size: number }

/** Group stored chunks into playable runs (each capture run is one continuous MediaRecorder stream). */
export function buildRuns(chunks: AudioChunk[]): AudioRun[] {
  const byRun = new Map<number, AudioChunk[]>()
  for (const c of [...chunks].sort((a, b) => a.seq - b.seq)) byRun.set(c.run, [...(byRun.get(c.run) ?? []), c])
  return [...byRun.entries()]
    .map(([run, list]) => {
      const type = list[0].mimeType
      const blob = new Blob(list.map((c) => c.blob), { type })
      return { run, offsetMs: list[0].startMs, endMs: list[list.length - 1].endMs, url: URL.createObjectURL(blob), mimeType: type, size: blob.size }
    })
    .sort((a, b) => a.offsetMs - b.offsetMs)
}

export function runAt(runs: AudioRun[], ms: number): AudioRun | undefined {
  let found = runs[0]
  for (const r of runs) if (r.offsetMs <= ms) found = r
  return found
}

/** Coarse peaks for a waveform overview. Returns [] if decoding is not possible. */
export async function computePeaks(url: string, buckets = 360): Promise<number[]> {
  try {
    const buf = await (await fetch(url)).arrayBuffer()
    if (buf.byteLength > 40 * 1024 * 1024) return []
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AC()
    const audio = await ctx.decodeAudioData(buf)
    void ctx.close()
    const data = audio.getChannelData(0)
    const step = Math.max(1, Math.floor(data.length / buckets))
    const peaks: number[] = []
    for (let i = 0; i < buckets; i++) {
      let max = 0
      const start = i * step
      for (let j = start; j < Math.min(data.length, start + step); j += 16) max = Math.max(max, Math.abs(data[j]))
      peaks.push(max)
    }
    const top = Math.max(0.01, ...peaks)
    return peaks.map((p) => p / top)
  } catch {
    return []
  }
}
