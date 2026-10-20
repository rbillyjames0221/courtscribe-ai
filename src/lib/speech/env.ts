/** Browser/environment detection for speech recognition support and guidance. */
export type SpeechEnv = {
  supported: boolean
  android: boolean
  ios: boolean
  mobile: boolean
  inAppBrowser: string | null
  firefox: boolean
  /** Human guidance when recognition is not usable here. */
  guidance?: string
}

export function detectInApp(ua: string): string | null {
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return 'Facebook'
  if (/Messenger|MESSENGER/i.test(ua)) return 'Messenger'
  if (/Instagram/i.test(ua)) return 'Instagram'
  if (/\bLine\//i.test(ua)) return 'LINE'
  if (/TikTok|musical_ly|BytedanceWebview/i.test(ua)) return 'TikTok'
  if (/Viber/i.test(ua)) return 'Viber'
  if (/; wv\)/.test(ua)) return 'an in-app'
  return null
}

export function speechEnv(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '', g: unknown = globalThis): SpeechEnv {
  const w = g as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
  const supported = !!(w.SpeechRecognition || w.webkitSpeechRecognition)
  const android = /Android/i.test(ua)
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)
  const firefox = /Firefox|FxiOS/i.test(ua)
  const inAppBrowser = detectInApp(ua)
  let guidance: string | undefined
  if (inAppBrowser) guidance = `You are in ${inAppBrowser} browser, which blocks speech recognition. Open this page in Chrome: tap ⋮ (or …) → "Open in Chrome" / "Open in browser".`
  else if (!supported && firefox) guidance = 'Firefox has no speech recognition. Open this page in Chrome (Android/desktop) or Edge.'
  else if (!supported && ios) guidance = 'This iPhone/iPad browser has no speech recognition here. Use Safari 14.5+ or, for best results, Chrome on Android or desktop.'
  else if (!supported) guidance = 'This browser has no speech recognition. Open this page in Google Chrome or Microsoft Edge.'
  return { supported: supported && !inAppBrowser, android, ios, mobile: android || ios || /Mobi/i.test(ua), inAppBrowser, firefox, guidance }
}

/**
 * On Android Chrome the system recognizer and getUserMedia/MediaRecorder cannot reliably share the
 * microphone: whichever opens first wins, and SpeechRecognition then silently hears nothing.
 */
export function needsExclusiveMic(env: SpeechEnv = speechEnv()): boolean {
  return env.android
}

/** Recognition language fallback chain (first = preferred). */
export function langChain(lang: 'en-PH' | 'fil-PH' | 'mixed'): string[] {
  return lang === 'en-PH' ? ['en-PH', 'en-US'] : ['fil-PH', 'tl-PH', 'en-US']
}
