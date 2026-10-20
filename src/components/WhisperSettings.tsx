import { useEffect, useState } from 'react'
import { Download, Loader2, Mic, Trash2 } from 'lucide-react'
import { useSettings } from '@/store/settings'
import { WHISPER_MODELS, whisperLanguage, type WhisperModelId } from '@/lib/whisper/models'
import { deleteModelCache, isModelCached, loadWhisper, transcribePcm, useWhisper, type WhisperDevice } from '@/lib/whisper/client'
import { openMic } from '@/lib/audio/capture'
import { PcmTap } from '@/lib/audio/pcm'
import { Button } from '@/components/ui/button'
import { Field, Select, Switch } from '@/components/ui/field'

export function WhisperSettings() {
  const s = useSettings()
  const w = useWhisper()
  const [cached, setCached] = useState<Record<string, boolean>>({})
  const [test, setTest] = useState<{ state: 'idle' | 'recording' | 'transcribing' | 'done' | 'error'; text?: string }>({ state: 'idle' })
  const refresh = () => void Promise.all((Object.keys(WHISPER_MODELS) as WhisperModelId[]).map(async (k) => [k, await isModelCached(k)] as const)).then((e) => setCached(Object.fromEntries(e)))
  useEffect(refresh, [w.status])

  const download = () => void loadWhisper(s.whisperModel, s.whisperDevice).catch(() => {}).finally(refresh)

  const runTest = async () => {
    setTest({ state: 'recording' })
    try {
      const load = loadWhisper(s.whisperModel, s.whisperDevice)
      const stream = await openMic({ echoCancellation: true, noiseSuppression: true, autoGainControl: true })
      const t0 = performance.now()
      const pcm = await new Promise<Float32Array>((resolve) => {
        const tap = new PcmTap(stream, () => performance.now() - t0, (p) => resolve(p), 60)
        void tap.start()
        setTimeout(() => tap.stop(), 5000)
      })
      stream.getTracks().forEach((t) => t.stop())
      setTest({ state: 'transcribing' })
      await load
      const out = await transcribePcm(pcm, whisperLanguage(s.defaultLanguage))
      setTest({ state: 'done', text: out.text.trim() || '(no speech detected)' })
    } catch (e) {
      setTest({ state: 'error', text: (e as Error).message })
    }
  }

  const m = WHISPER_MODELS[s.whisperModel]
  const pct = w.total ? Math.round((w.loaded / w.total) * 100) : 0
  return (
    <>
      <p className="py-3 text-sm text-muted">Free speech-to-text that runs entirely on this device (no upload, no account). Used for “Transcribe recording” in Review, imported audio, and the On-device Whisper live option. Output is always marked Needs review.</p>
      <div className="py-3">
        <Field label="Model" htmlFor="wm" hint={m.hint}>
          <Select id="wm" value={s.whisperModel} onChange={(e) => s.set({ whisperModel: e.target.value as WhisperModelId })}>
            {(Object.keys(WHISPER_MODELS) as WhisperModelId[]).map((k) => (
              <option key={k} value={k}>
                {WHISPER_MODELS[k].label} · ~{WHISPER_MODELS[k].sizeMb} MB{cached[k] ? ' · downloaded' : ''}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="space-y-2 py-3">
        <p className="text-sm" data-testid="whisper-status">
          {w.status === 'loading' ? `Downloading/loading… ${pct ? `${pct}% of ${Math.round(w.total / 1e6)} MB` : ''}` : w.status === 'ready' && w.model === s.whisperModel ? `Ready (${w.device === 'webgpu' ? 'GPU' : 'CPU/WASM'}).` : cached[s.whisperModel] ? 'Downloaded — available offline.' : 'Not downloaded yet.'}
          {w.status === 'error' && <span className="text-recording"> Error: {w.error}</span>}
        </p>
        {w.status === 'loading' && (
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-interactive transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={download} disabled={w.status === 'loading'}>
            {w.status === 'loading' ? <Loader2 className="animate-spin" /> : <Download />} {cached[s.whisperModel] ? 'Load model' : `Download (~${m.sizeMb} MB)`}
          </Button>
          <Button size="sm" onClick={() => void runTest()} disabled={test.state === 'recording' || test.state === 'transcribing'} data-testid="whisper-test">
            <Mic /> {test.state === 'recording' ? 'Speak now (5 s)…' : test.state === 'transcribing' ? 'Transcribing…' : 'Test: record 5 s'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void deleteModelCache().then(refresh)}>
            <Trash2 /> Delete downloaded models
          </Button>
        </div>
        {test.text && <p className={test.state === 'error' ? 'text-sm text-recording' : 'rounded-lg bg-surface-2 p-2.5 font-serif'} data-testid="whisper-test-text">{test.text}</p>}
      </div>
      <Switch checked={s.whisperLiveFallback} onChange={(v) => s.set({ whisperLiveFallback: v })} label="Fill gaps in live text with Whisper" description="While audio is recorded with browser live recognition, Whisper transcribes stretches the live recognizer missed. Only if the model is already downloaded." />
      <div className="py-3">
        <Field label="Processor" htmlFor="wd" hint="Auto uses CPU (WASM) on phones for stability and the GPU (WebGPU) on desktops when available.">
          <Select id="wd" value={s.whisperDevice} onChange={(e) => s.set({ whisperDevice: e.target.value as WhisperDevice })}>
            <option value="auto">Auto</option>
            <option value="wasm">CPU (WASM)</option>
            <option value="webgpu">GPU (WebGPU, experimental)</option>
          </Select>
        </Field>
      </div>
      <div className="py-3">
        <Field label="Live block length (seconds)" htmlFor="ww" hint="Shorter = text sooner but less context and more CPU. 8–15 s recommended.">
          <Select id="ww" value={String(s.whisperWindowSec)} onChange={(e) => s.set({ whisperWindowSec: Number(e.target.value) })}>
            {[6, 8, 10, 12, 15].map((n) => <option key={n} value={n}>{n} s</option>)}
          </Select>
        </Field>
      </div>
    </>
  )
}
