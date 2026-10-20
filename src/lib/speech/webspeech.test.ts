import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSpeechProvider, type SR, type SREvent } from './webspeech'
import { detectInApp, langChain, speechEnv } from './env'
import type { ProviderError, ProviderInfo, ProviderResultWithHint, ProviderStatus } from './provider'

class FakeSR implements SR {
  static instances: FakeSR[] = []
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  onresult: ((e: SREvent) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  onstart: (() => void) | null = null
  onspeechstart: (() => void) | null = null
  started = false
  aborted = false
  constructor() {
    FakeSR.instances.push(this)
  }
  start() {
    this.started = true
  }
  stop() {
    this.onend?.()
  }
  abort() {
    this.aborted = true
  }
  // helpers
  fireStart() {
    this.onstart?.()
  }
  result(i: number, text: string, isFinal: boolean, confidence = 0.9) {
    const results: SREvent['results'] = { length: i + 1 }
    results[i] = { isFinal, length: 1, 0: { transcript: text, confidence } }
    this.onresult?.({ resultIndex: i, results })
  }
  error(code: string) {
    this.onerror?.({ error: code })
  }
  end() {
    this.onend?.()
  }
}
const last = () => FakeSR.instances[FakeSR.instances.length - 1]

const desktop = speechEnv('Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0 Safari/537.36', { webkitSpeechRecognition: FakeSR })
const android = speechEnv('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36', { webkitSpeechRecognition: FakeSR })

function setup(env = desktop, lang: 'en-PH' | 'fil-PH' | 'mixed' = 'en-PH') {
  const p = new WebSpeechProvider({ ctor: FakeSR, env })
  const results: ProviderResultWithHint[] = []
  const statuses: [ProviderStatus, ProviderError | undefined][] = []
  const infos: ProviderInfo[] = []
  p.receiveInterimResult((r) => results.push(r))
  p.receiveFinalResult((r) => results.push(r))
  p.onStatus((s, e) => statuses.push([s, e]))
  p.onInfo((i) => infos.push(i))
  void p.startSession({ language: lang, glossary: [], clock: () => 5000 })
  return { p, results, statuses, infos }
}

beforeEach(() => {
  FakeSR.instances = []
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('WebSpeechProvider', () => {
  it('starts with interim results and the primary language, and reports Listening on start', () => {
    const { statuses } = setup()
    const r = last()
    expect(r.started).toBe(true)
    expect(r.interimResults).toBe(true)
    expect(r.lang).toBe('en-PH')
    expect(r.continuous).toBe(true)
    r.fireStart()
    expect(statuses.at(-1)?.[0]).toBe('listening')
  })

  it('emits interim then final text live', () => {
    const { results } = setup()
    last().fireStart()
    last().result(0, 'good morning', false)
    last().result(0, 'good morning your honor', true)
    expect(results.map((r) => [r.text, r.isFinal])).toEqual([
      ['good morning', false],
      ['good morning your honor', true],
    ])
    expect(results[1].engine).toBe('webspeech')
  })

  it('auto-restarts quickly after end (silence / 60 s limit) without backoff', () => {
    setup()
    last().fireStart()
    last().end()
    expect(FakeSR.instances).toHaveLength(1)
    vi.advanceTimersByTime(150)
    expect(FakeSR.instances).toHaveLength(2)
    expect(last().started).toBe(true)
  })

  it('treats no-speech as non-fatal and keeps restarting', () => {
    const { statuses, infos } = setup()
    for (let k = 0; k < 5; k++) {
      last().fireStart()
      last().error('no-speech')
      last().end()
      vi.advanceTimersByTime(150)
    }
    expect(FakeSR.instances).toHaveLength(6)
    expect(statuses.some(([s]) => s === 'error')).toBe(false)
    expect(infos.filter((i) => i.type === 'no-speech').length).toBe(5)
  })

  it('surfaces not-allowed as a visible, non-recoverable error with guidance', () => {
    const { statuses } = setup(android)
    last().error('not-allowed')
    const [s, e] = statuses.at(-1)!
    expect(s).toBe('error')
    expect(e?.code).toBe('not-allowed')
    expect(e?.action).toMatch(/Permissions/)
    vi.advanceTimersByTime(10_000)
    expect(FakeSR.instances).toHaveLength(1) // no restart loop
  })

  it('reports audio-capture as mic contention and retries with backoff', () => {
    const { statuses, infos } = setup(android)
    last().error('audio-capture')
    last().end()
    expect(infos.some((i) => i.type === 'mic-contention')).toBe(true)
    expect(['reconnecting', 'offline']).toContain(statuses.at(-1)![0])
    vi.advanceTimersByTime(200)
    expect(FakeSR.instances).toHaveLength(1)
    vi.advanceTimersByTime(600)
    expect(FakeSR.instances).toHaveLength(2)
  })

  it('falls back en-PH → en-US when the language is not supported', () => {
    const { infos } = setup()
    last().error('language-not-supported')
    vi.advanceTimersByTime(100)
    expect(last().lang).toBe('en-US')
    expect(infos).toContainEqual({ type: 'language', lang: 'en-US', fallbackFrom: 'en-PH' })
  })

  it('uses non-continuous mode on Android (restart per utterance) and flushes unfinished interim as needs-review', () => {
    const { results } = setup(android)
    expect(last().continuous).toBe(false)
    last().fireStart()
    last().result(0, 'the witness is', false)
    last().end()
    const f = results.at(-1)!
    expect(f.isFinal).toBe(true)
    expect(f.text).toBe('the witness is')
    expect(f.forceReview).toBe(true)
    vi.advanceTimersByTime(150)
    expect(FakeSR.instances).toHaveLength(2)
  })

  it('watchdog respawns a recognizer that never starts', () => {
    setup()
    expect(FakeSR.instances).toHaveLength(1)
    vi.advanceTimersByTime(13_000)
    expect(FakeSR.instances.length).toBeGreaterThanOrEqual(2)
    expect(FakeSR.instances[0].aborted).toBe(true)
  })

  it('pause stops restarts; resume starts again', () => {
    const { p } = setup()
    last().fireStart()
    p.pause()
    vi.advanceTimersByTime(10_000)
    expect(FakeSR.instances).toHaveLength(1)
    p.resume()
    expect(FakeSR.instances).toHaveLength(2)
  })

  it('reports unsupported with "open in Chrome" guidance in in-app browsers', () => {
    const env = speechEnv('Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 [FBAN/FB4A;FBAV/400.0]', { webkitSpeechRecognition: FakeSR })
    const { statuses } = setup(env)
    const [s, e] = statuses.at(-1)!
    expect(s).toBe('unsupported')
    expect(e?.message).toMatch(/Open this page in Chrome/)
  })
})

describe('speech env', () => {
  it('detects in-app browsers and unsupported engines', () => {
    expect(detectInApp('… [FB_IAB/FB4A;FBAV/400.0.0]')).toBe('Facebook')
    expect(detectInApp('… Instagram 300.0 …')).toBe('Instagram')
    expect(detectInApp('Mozilla/5.0 (Linux; Android 14) Chrome/141 Mobile Safari/537.36')).toBeNull()
    expect(speechEnv('Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/131.0', {}).guidance).toMatch(/Firefox/)
    expect(android.android && android.supported).toBe(true)
  })
  it('language chains', () => {
    expect(langChain('en-PH')).toEqual(['en-PH', 'en-US'])
    expect(langChain('fil-PH')[0]).toBe('fil-PH')
  })
})
