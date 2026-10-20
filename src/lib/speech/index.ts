import type { SpeechProvider } from './provider'
import { WebSpeechProvider } from './webspeech'
import { MockProvider } from './mock'
import { ServerStreamingProvider } from './server'
import { WhisperLiveProvider } from './whisper'
import { speechEnv } from './env'
import type { WhisperModelId } from '../whisper/models'
import type { WhisperDevice } from '../whisper/client'

export type ProviderId = 'webspeech' | 'whisper' | 'mock' | 'server'

export const PROVIDERS: { id: ProviderId; label: string; description: string }[] = [
  { id: 'webspeech', label: 'Browser live (Web Speech API)', description: 'Free, instant word-by-word text in Chrome/Edge/Android Chrome. Needs internet; Chrome sends audio to Google. On Android it needs the microphone to itself, so audio is not saved.' },
  { id: 'whisper', label: 'On-device Whisper (free, private)', description: 'Runs fully on this device after a one-time model download (works offline). Audio is saved too. Text appears in ~10 s blocks a few seconds behind, marked Needs review.' },
  { id: 'mock', label: 'Demo script', description: 'Simulated courtroom dialogue for trying the app. Not real recognition.' },
  { id: 'server', label: 'Cloud streaming (Google / Azure)', description: 'Requires the backend streaming service. Not configured in this deployment.' },
]

export type ProviderConfig = { whisperModel?: WhisperModelId; whisperDevice?: WhisperDevice; whisperWindowSec?: number }

export function createProvider(id: ProviderId, cfg: ProviderConfig = {}): SpeechProvider {
  if (id === 'mock') return new MockProvider()
  if (id === 'server') return new ServerStreamingProvider()
  if (id === 'whisper') return new WhisperLiveProvider(cfg.whisperModel, cfg.whisperDevice, cfg.whisperWindowSec)
  return new WebSpeechProvider()
}

export function providerAvailability(id: ProviderId): { ok: boolean; reason?: string } {
  const p = createProvider(id)
  if (p.isSupported()) return { ok: true }
  if (id === 'webspeech') return { ok: false, reason: speechEnv().guidance ?? 'Not supported in this browser — use Chrome, Edge, or Android Chrome.' }
  if (id === 'whisper') return { ok: false, reason: 'This browser cannot run on-device models (needs WebAssembly + Web Workers).' }
  if (id === 'server') return { ok: false, reason: 'Backend not configured (set VITE_STREAMING_URL and deploy the streaming service).' }
  return { ok: false }
}
