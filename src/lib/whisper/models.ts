/** On-device Whisper models (transformers.js / ONNX). Sizes are approximate q8 downloads incl. runtime. */
export type WhisperModelId = 'tiny' | 'base'
export const WHISPER_MODELS: Record<WhisperModelId, { repo: string; label: string; sizeMb: number; hint: string }> = {
  tiny: { repo: 'onnx-community/whisper-tiny', label: 'Whisper tiny (multilingual)', sizeMb: 55, hint: 'Fastest. Recommended for phones. ~41 MB model + ~14 MB runtime.' },
  base: { repo: 'onnx-community/whisper-base', label: 'Whisper base (multilingual)', sizeMb: 92, hint: 'More accurate, ~2× slower and more memory. Good on laptops.' },
}

export type WhisperLang = 'english' | 'tagalog' | null

/** Session language → Whisper language token (null = auto-detect, used for mixed). */
export function whisperLanguage(lang: 'en-PH' | 'fil-PH' | 'mixed'): WhisperLang {
  return lang === 'en-PH' ? 'english' : lang === 'fil-PH' ? 'tagalog' : null
}

/** Typical Whisper hallucinations on silence/noise. Dropped when they are the whole output of a quiet window. */
const HALLUCINATIONS = [
  'thank you', 'thanks for watching', 'thank you for watching', 'please subscribe', 'you', 'bye', 'so', 'okay',
  'subtitles by the amaraorg community', 'music', 'applause', 'blank audio', 'silence', 'inaudible',
]

export function cleanWhisperText(t: string): string {
  return t
    .replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SOUND|silence)[^\]]*\]/gi, '')
    .replace(/\((music|applause|silence|noise|laughs?)\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isLikelyHallucination(t: string, rms: number): boolean {
  const n = t.toLowerCase().replace(/[^\p{L}\s]/gu, '').replace(/\s+/g, ' ').trim()
  if (!n) return true
  if (HALLUCINATIONS.includes(n) && rms < 0.03) return true
  // the same short phrase repeated many times
  const words = n.split(' ')
  if (words.length >= 8 && new Set(words).size <= 2) return true
  return false
}
