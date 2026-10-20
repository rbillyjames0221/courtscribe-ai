/**
 * Main-thread client for the Whisper worker: one worker, serialized jobs, observable state.
 */
import { create } from 'zustand'
import { WHISPER_MODELS, type WhisperModelId } from './models'

export type WhisperDevice = 'auto' | 'wasm' | 'webgpu'
export type WhisperChunk = { text: string; startSec: number; endSec: number | null }

type State = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  model: WhisperModelId | null
  device: 'wasm' | 'webgpu' | null
  loaded: number
  total: number
  error?: string
  busy: number
  lastRtf?: number
}

export const useWhisper = create<State>(() => ({ status: 'idle', model: null, device: null, loaded: 0, total: 0, busy: 0 }))

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (v: { text: string; chunks: WhisperChunk[] }) => void; reject: (e: Error) => void; sec: number }>()
let loadWaiters: { resolve: () => void; reject: (e: Error) => void }[] = []
let queue: Promise<unknown> = Promise.resolve()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (ev) => {
    const m = ev.data
    if (m.type === 'progress') useWhisper.setState({ loaded: m.loaded, total: m.total })
    else if (m.type === 'ready') {
      useWhisper.setState({ status: 'ready', device: m.device, error: undefined })
      loadWaiters.forEach((w) => w.resolve())
      loadWaiters = []
    } else if (m.type === 'result') {
      const p = pending.get(m.id)
      pending.delete(m.id)
      if (p) {
        useWhisper.setState((s) => ({ busy: Math.max(0, s.busy - 1), lastRtf: p.sec ? m.ms / 1000 / p.sec : undefined }))
        p.resolve({ text: m.text, chunks: (m.chunks as { text: string; timestamp: [number, number | null] }[]).map((c) => ({ text: c.text, startSec: c.timestamp?.[0] ?? 0, endSec: c.timestamp?.[1] ?? null })) })
      }
    } else if (m.type === 'error') {
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)!.reject(new Error(m.message))
        pending.delete(m.id)
        useWhisper.setState((s) => ({ busy: Math.max(0, s.busy - 1) }))
      } else {
        useWhisper.setState({ status: 'error', error: m.message })
        loadWaiters.forEach((w) => w.reject(new Error(m.message)))
        loadWaiters = []
      }
    } else if (m.type === 'log') console.info('[whisper]', m.message)
  }
  worker.onerror = (e) => {
    useWhisper.setState({ status: 'error', error: e.message || 'Whisper worker crashed (out of memory?)' })
    loadWaiters.forEach((w) => w.reject(new Error(e.message)))
    loadWaiters = []
    pending.forEach((p) => p.reject(new Error('Whisper worker crashed')))
    pending.clear()
    worker = null
  }
  return worker
}

async function pickDevice(d: WhisperDevice): Promise<'wasm' | 'webgpu'> {
  if (d === 'wasm') return 'wasm'
  const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
  if (!gpu) return 'wasm'
  if (d === 'webgpu') return 'webgpu'
  // auto: WASM is the most reliable on phones; only use WebGPU on desktop-class devices.
  if (/Android|iPhone|iPad/i.test(navigator.userAgent)) return 'wasm'
  try {
    return (await gpu.requestAdapter()) ? 'webgpu' : 'wasm'
  } catch {
    return 'wasm'
  }
}

export async function loadWhisper(model: WhisperModelId, device: WhisperDevice = 'auto'): Promise<void> {
  const s = useWhisper.getState()
  if (s.status === 'ready' && s.model === model) return
  const dev = await pickDevice(device)
  useWhisper.setState({ status: 'loading', model, loaded: 0, total: 0, error: undefined })
  const p = new Promise<void>((resolve, reject) => loadWaiters.push({ resolve, reject }))
  getWorker().postMessage({ type: 'load', repo: WHISPER_MODELS[model].repo, device: dev })
  return p
}

/** Transcribe 16 kHz mono PCM. Jobs are serialized to bound memory on phones. */
export function transcribePcm(audio: Float32Array, language: string | null): Promise<{ text: string; chunks: WhisperChunk[] }> {
  const run = () =>
    new Promise<{ text: string; chunks: WhisperChunk[] }>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject, sec: audio.length / 16000 })
      useWhisper.setState((s) => ({ busy: s.busy + 1 }))
      getWorker().postMessage({ type: 'transcribe', id, audio, language }, [audio.buffer])
    })
  const p = queue.then(run, run)
  queue = p.catch(() => undefined)
  return p
}

/** Is a model already in the browser cache (i.e. usable offline)? */
export async function isModelCached(model: WhisperModelId): Promise<boolean> {
  try {
    if (!('caches' in self)) return false
    const c = await caches.open('transformers-cache')
    const keys = await c.keys()
    const repo = WHISPER_MODELS[model].repo
    return keys.some((k) => k.url.includes(repo) && /encoder_model/.test(k.url)) && keys.some((k) => k.url.includes(repo) && /decoder_model/.test(k.url))
  } catch {
    return false
  }
}

export async function deleteModelCache(): Promise<void> {
  worker?.postMessage({ type: 'dispose' })
  useWhisper.setState({ status: 'idle', model: null, device: null })
  if ('caches' in self) await caches.delete('transformers-cache')
}
