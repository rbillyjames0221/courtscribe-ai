import type { LogEntry } from '@/lib/speech/provider'
import { speechEnv } from '@/lib/speech/env'

/** Plain-text environment header for diagnostic logs the user can paste to support. */
export async function envReport(extra: Record<string, unknown> = {}): Promise<string> {
  const env = speechEnv()
  let mic = 'unknown'
  try {
    mic = (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state
  } catch {
    /* not supported */
  }
  let inputs = '?'
  try {
    const devs = await navigator.mediaDevices.enumerateDevices()
    inputs = String(devs.filter((d) => d.kind === 'audioinput').length)
  } catch {
    /* ignore */
  }
  const w = window as unknown as Record<string, unknown>
  const lines = [
    `CourtScribe diagnostics ${new Date().toISOString()}`,
    `build: ${import.meta.env.VITE_BUILD ?? 'dev'}`,
    `ua: ${navigator.userAgent}`,
    `android=${env.android} mobile=${env.mobile} inApp=${env.inAppBrowser} secure=${isSecureContext} online=${navigator.onLine}`,
    `SpeechRecognition=${'SpeechRecognition' in w} webkitSpeechRecognition=${'webkitSpeechRecognition' in w}`,
    `mic permission=${mic} audioinputs=${inputs} navigator.language=${navigator.language}`,
    `standalone=${matchMedia('(display-mode: standalone)').matches} visibility=${document.visibilityState}`,
    ...Object.entries(extra).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`),
  ]
  return lines.join('\n')
}

export function formatLog(entries: LogEntry[]): string {
  if (!entries.length) return '(no events)'
  const t0 = entries[0].t
  return entries.map((e) => `+${((e.t - t0) / 1000).toFixed(2).padStart(7)}s  #${e.run}  ${e.ev}${e.detail ? `  ${e.detail}` : ''}`).join('\n')
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for browsers that block the async clipboard.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}
