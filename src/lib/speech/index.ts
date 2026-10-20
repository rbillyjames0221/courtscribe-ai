import type { SpeechProvider } from './provider'
import { WebSpeechProvider } from './webspeech'
import { MockProvider } from './mock'
import { ServerStreamingProvider } from './server'

export type ProviderId = 'webspeech' | 'mock' | 'server'

export const PROVIDERS: { id: ProviderId; label: string; description: string }[] = [
  { id: 'webspeech', label: 'Browser (Web Speech API)', description: 'Free, built into Chrome/Edge/Android Chrome. Audio is processed by the browser vendor. Filipino accuracy not verified.' },
  { id: 'mock', label: 'Demo script', description: 'Simulated courtroom dialogue for trying the app. Not real recognition.' },
  { id: 'server', label: 'Cloud streaming (Google / Azure)', description: 'Requires the backend streaming service. Not configured in this deployment.' },
]

export function createProvider(id: ProviderId): SpeechProvider {
  if (id === 'mock') return new MockProvider()
  if (id === 'server') return new ServerStreamingProvider()
  return new WebSpeechProvider()
}

export function providerAvailability(id: ProviderId): { ok: boolean; reason?: string } {
  const p = createProvider(id)
  if (p.isSupported()) return { ok: true }
  if (id === 'webspeech') return { ok: false, reason: 'Not supported in this browser — use Chrome, Edge, or Android Chrome.' }
  if (id === 'server') return { ok: false, reason: 'Backend not configured (set VITE_STREAMING_URL and deploy the streaming service).' }
  return { ok: false }
}
