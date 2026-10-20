import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_STENO } from '@/lib/steno'
import type { Language, Mode, StenoEntry } from '@/lib/types'
import type { ProviderId } from '@/lib/speech'
import type { WhisperModelId } from '@/lib/whisper/models'
import type { WhisperDevice } from '@/lib/whisper/client'

/**
 * How the microphone is shared between local audio recording and browser live recognition.
 * auto: Android → transcription priority (Android Chrome cannot do both); elsewhere both, with
 * automatic fallback to transcription priority if the recognizer reports the mic is busy.
 */
export type AudioStrategy = 'auto' | 'both' | 'transcription'

export type ExportTemplate = 'verbatim' | 'clean' | 'court-qa' | 'interview' | 'meeting'

export type Settings = {
  displayName: string
  theme: 'light' | 'dark' | 'system'
  defaultLanguage: Language
  defaultMode: Mode
  providerId: ProviderId
  // audio
  chunkSeconds: number
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
  keepScreenAwake: boolean
  audioStrategy: AudioStrategy
  // on-device Whisper
  whisperModel: WhisperModelId
  whisperDevice: WhisperDevice
  whisperWindowSec: number
  /** While recording audio with browser live recognition, fill gaps with Whisper (only if the model is already downloaded). */
  whisperLiveFallback: boolean
  // recognition
  showInterim: boolean
  showConfidence: boolean
  reviewThreshold: number
  defaultGlossary: string[]
  // steno
  stenoDict: StenoEntry[]
  autoExpand: boolean
  caseSensitive: boolean
  // formatting
  transcriptSize: number // rem
  transcriptFont: 'serif' | 'sans' | 'dyslexic'
  showTimestamps: boolean
  defaultTemplate: ExportTemplate
  linesPerPage: number
  // privacy
  confirmBeforeDelete: boolean
  // accessibility
  reduceMotion: boolean
  highContrast: boolean
  set: (patch: Partial<Omit<Settings, 'set' | 'reset'>>) => void
  reset: () => void
}

const defaults: Omit<Settings, 'set' | 'reset'> = {
  displayName: '',
  theme: 'light',
  defaultLanguage: 'en-PH',
  defaultMode: 'hybrid',
  providerId: 'webspeech',
  chunkSeconds: 5,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  keepScreenAwake: true,
  audioStrategy: 'auto',
  whisperModel: 'tiny',
  whisperDevice: 'auto',
  whisperWindowSec: 10,
  whisperLiveFallback: true,
  showInterim: true,
  showConfidence: false,
  reviewThreshold: 0.55,
  defaultGlossary: ['Your Honor', 'Regional Trial Court', 'People of the Philippines'],
  stenoDict: DEFAULT_STENO,
  autoExpand: true,
  caseSensitive: false,
  transcriptSize: 1.125,
  transcriptFont: 'serif',
  showTimestamps: true,
  defaultTemplate: 'court-qa',
  linesPerPage: 25,
  confirmBeforeDelete: true,
  reduceMotion: false,
  highContrast: false,
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      ...defaults,
      set: (patch) => set(patch),
      reset: () => set({ ...defaults }),
    }),
    { name: 'courtscribe-settings', version: 1 },
  ),
)
