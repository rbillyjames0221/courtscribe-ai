/// <reference lib="webworker" />
/**
 * On-device Whisper (transformers.js + ONNX Runtime Web) in a dedicated worker.
 * Models and the WASM runtime are fetched once and stored in the browser Cache API, so
 * transcription works offline afterwards. No audio ever leaves the device.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

type Device = 'wasm' | 'webgpu'
type InMsg =
  | { type: 'load'; repo: string; device: Device }
  | { type: 'transcribe'; id: number; audio: Float32Array; language: string | null }
  | { type: 'dispose' }

env.allowLocalModels = false
env.useBrowserCache = true
// Self-host the ONNX Runtime WASM binary (same origin, no CDN dependency); the JS glue is bundled.
// Cached by the service worker (runtime CacheFirst) so it works offline after first use.
const ortWasm = new URL('../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = { wasm: ortWasm } as never

let asr: AutomaticSpeechRecognitionPipeline | null = null
let loaded: { repo: string; device: Device } | null = null
let loading: Promise<void> | null = null

const post = (m: unknown, t?: Transferable[]) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, t ?? [])

async function load(repo: string, device: Device) {
  if (loaded && loaded.repo === repo && loaded.device === device && asr) return post({ type: 'ready', device, repo })
  if (asr) {
    await asr.dispose?.().catch?.(() => {})
    asr = null
  }
  const files = new Map<string, { loaded: number; total: number }>()
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === 'progress' && p.file) {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 })
      let l = 0
      let t = 0
      for (const f of files.values()) {
        l += f.loaded
        t += f.total
      }
      post({ type: 'progress', loaded: l, total: t, file: p.file })
    }
  }
  const make = (d: Device) =>
    pipeline('automatic-speech-recognition', repo, {
      device: d,
      dtype: d === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
      progress_callback,
    }) as Promise<AutomaticSpeechRecognitionPipeline>
  try {
    asr = await make(device)
    loaded = { repo, device }
  } catch (e) {
    if (device !== 'webgpu') throw e
    post({ type: 'log', message: `WebGPU failed (${(e as Error)?.message}); falling back to WASM` })
    asr = await make('wasm')
    loaded = { repo, device: 'wasm' }
  }
  post({ type: 'ready', device: loaded.device, repo })
}

self.onmessage = async (ev: MessageEvent<InMsg>) => {
  const m = ev.data
  try {
    if (m.type === 'load') {
      loading = load(m.repo, m.device)
      await loading
    } else if (m.type === 'transcribe') {
      if (loading) await loading
      if (!asr) throw new Error('Model not loaded')
      const t0 = performance.now()
      const out = (await asr(m.audio, {
        language: m.language ?? undefined,
        task: 'transcribe',
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      } as Record<string, unknown>)) as { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }
      post({ type: 'result', id: m.id, text: out.text, chunks: out.chunks ?? [], ms: performance.now() - t0 })
    } else if (m.type === 'dispose') {
      await asr?.dispose?.()
      asr = null
      loaded = null
    }
  } catch (e) {
    post({ type: 'error', id: (m as { id?: number }).id, message: e instanceof Error ? e.message : String(e) })
  }
}
