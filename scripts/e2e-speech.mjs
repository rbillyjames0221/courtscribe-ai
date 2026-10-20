// Speech-recognition e2e: fake Web Speech engine (Android + desktop scenarios) and real on-device Whisper.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const OUT = process.env.OUT ?? '/workspace/courtscribe/shots'
const ONLY = process.env.ONLY ?? 'all'
mkdirSync(OUT, { recursive: true })
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
const step = (s) => console.log('▶', s)

// A scripted SpeechRecognition stand-in. Behaviour from localStorage.fakeSR: ok | audio-capture | not-allowed | silent-when-mic-busy
const FAKE_SR = () => {
  window.__gum = 0
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  let live = 0
  navigator.mediaDevices.getUserMedia = async (c) => {
    window.__gum++
    const s = await orig(c)
    live++
    s.getTracks().forEach((t) => {
      const stop = t.stop.bind(t)
      t.stop = () => {
        if (t.readyState !== 'ended') live--
        stop()
      }
    })
    return s
  }
  window.__micLive = () => live
  const LINES = ['good morning your honor', 'the witness is present and ready', 'we may proceed']
  let line = 0
  class FakeSR {
    constructor() {
      this.lang = ''
      this.continuous = false
      this.interimResults = false
    }
    start() {
      const mode = localStorage.getItem('fakeSR') || 'ok'
      window.__srStarts = (window.__srStarts || 0) + 1
      window.__srLang = this.lang
      ;(window.__srActivation ||= []).push(!!navigator.userActivation?.isActive)
      setTimeout(() => {
        this.onstart?.()
        if (mode === 'no-audio') return // the user's phone: started, then nothing at all
        if (!(mode === 'silent-when-mic-busy' && live > 0) && mode !== 'not-allowed' && mode !== 'audio-capture') this.onaudiostart?.()
        if (mode === 'not-allowed' || mode === 'audio-capture') {
          this.onerror?.({ error: mode })
          setTimeout(() => this.onend?.(), 20)
          return
        }
        if (mode === 'silent-when-mic-busy' && live > 0) {
          setTimeout(() => {
            this.onerror?.({ error: 'no-speech' })
            this.onend?.()
          }, 600)
          return
        }
        const words = LINES[line++ % LINES.length].split(' ')
        let i = 0
        const tick = () => {
          if (this.dead) return
          i++
          const text = words.slice(0, i).join(' ')
          const fin = i >= words.length
          const results = { length: 1, 0: { isFinal: fin, length: 1, 0: { transcript: text, confidence: 0.92 } } }
          this.onresult?.({ resultIndex: 0, results })
          if (!fin) this.t = setTimeout(tick, 350)
          else this.t = setTimeout(() => this.onend?.(), 200)
        }
        this.t = setTimeout(tick, 300)
      }, 50)
    }
    stop() {
      this.dead = true
      clearTimeout(this.t)
      setTimeout(() => this.onend?.(), 10)
    }
    abort() {
      this.dead = true
      clearTimeout(this.t)
    }
  }
  window.webkitSpeechRecognition = FakeSR
  window.SpeechRecognition = FakeSR
}

async function newCtx(browser, { android = false, fake = true, mode = 'ok' } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    permissions: ['microphone'],
    userAgent: android ? ANDROID_UA : undefined,
  })
  if (fake) await ctx.addInitScript(FAKE_SR)
  await ctx.addInitScript((m) => localStorage.setItem('fakeSR', m), mode)
  const page = await ctx.newPage()
  page.errors = []
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message))
  page.on('console', (m) => m.type() === 'error' && page.errors.push('console: ' + m.text()))
  return { ctx, page }
}

async function fillNewSession(page, title, provider = 'webspeech') {
  await page.goto(BASE + '/record')
  await page.getByLabel('Title').fill(title)
  await page.getByRole('radio', { name: /Live Speech-to-Text/ }).click()
  await page.getByLabel('Speech recognition').selectOption(provider)
  await page.locator('input[type=checkbox]').first().check()
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=/workspace/courtscribe/jfk48.wav', '--autoplay-policy=no-user-gesture-required'],
})
const failures = []
const check = (cond, msg) => {
  if (!cond) {
    failures.push(msg)
    console.log('  ✗', msg)
  } else console.log('  ✓', msg)
}

if (ONLY === 'all' || ONLY === 'android') {
  step('Android Chrome: test button shows words live')
  const { ctx, page } = await newCtx(browser, { android: true, mode: 'silent-when-mic-busy' })
  await fillNewSession(page, 'Android live test')
  await page.getByText(/Chrome can't record audio and do live speech-to-text/).waitFor()
  await page.getByRole('button', { name: 'Test speech recognition' }).click()
  await page.getByTestId('speech-test-text').filter({ hasText: 'good morning your honor' }).waitFor({ timeout: 8000 })
  check(true, 'speech test displayed recognized words')
  await page.getByRole('button', { name: 'Stop test' }).click()
  step('Android: start recording → transcription priority, live interim + final text')
  await page.getByRole('button', { name: 'Start recording' }).click()
  await page.waitForURL(/\/live\//)
  await page.getByTestId('priority-banner').waitFor()
  check((await page.evaluate(() => window.__micLive())) === 0, 'no getUserMedia stream held while recognizer runs (mic free for SpeechRecognition)')
  await page.locator('article').filter({ hasText: 'the witness is' }).first().waitFor({ timeout: 10000 })
  await page.screenshot({ path: `${OUT}/08-android-live-interim.png` })
  await page.locator('article').filter({ hasText: 'we may proceed' }).first().waitFor({ timeout: 15000 })
  const n = await page.locator('article').count()
  check(n >= 3, `live transcript shows ${n} segments`)
  check((await page.evaluate(() => window.__srStarts)) >= 3, 'recognizer auto-restarted after each utterance')
  await page.getByText('Listening', { exact: false }).first().waitFor()
  await page.screenshot({ path: `${OUT}/09-android-live-text.png` })
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('button', { name: 'Stop and save' }).click()
  await page.waitForURL(/\/sessions\/ses/)
  await page.getByText(/transcription priority/).first().waitFor()
  check((await page.locator('article').count()) >= 3, 'segments persisted to review')
  check(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '))
  await ctx.close()
}

if (ONLY === 'all' || ONLY === 'desktop') {
  step('Desktop: recognizer reports mic busy → auto-switch to transcription priority')
  const { ctx, page } = await newCtx(browser, { mode: 'audio-capture' })
  await fillNewSession(page, 'Desktop contention test')
  await page.getByRole('button', { name: 'Start recording' }).click()
  await page.waitForURL(/\/live\//)
  await page.getByText(/Switched to transcription priority/).waitFor({ timeout: 8000 })
  check(true, 'auto fallback notice shown')
  await page.getByTestId('priority-banner').waitFor()
  check((await page.evaluate(() => window.__micLive())) === 0, 'recording stream released for the recognizer')
  await page.screenshot({ path: `${OUT}/10-desktop-fallback.png` })
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('button', { name: 'Stop and save' }).click()
  await ctx.close()

  step('Permission denied is shown with instructions')
  const b = await newCtx(browser, { android: true, mode: 'not-allowed' })
  await fillNewSession(b.page, 'Denied test')
  await b.page.getByRole('button', { name: 'Start recording' }).click()
  await b.page.getByTestId('recognition-error').waitFor({ timeout: 8000 })
  const txt = await b.page.getByTestId('recognition-error').locator('..').innerText()
  check(/permission/i.test(txt) && /Allow/.test(txt), 'not-allowed banner explains how to allow the mic')
  await b.page.screenshot({ path: `${OUT}/11-permission-error.png` })
  await b.ctx.close()

  step('Real headless Chrome recognizer (no fake): errors surface, never silent')
  const c = await newCtx(browser, { fake: false })
  await fillNewSession(c.page, 'Real SR test')
  await c.page.getByRole('button', { name: 'Test speech recognition' }).click()
  await c.page.waitForTimeout(6000)
  const st = await c.page.getByTestId('speech-test-status').innerText()
  const alert = await c.page.locator('[role=alert]').allInnerTexts()
  console.log('   real recognizer status:', st, '| alert:', alert.join(' / ').replace(/\n/g, ' '))
  check(/Listening|Hearing|Not working|Restarting/.test(st), 'real recognizer state is visible')
  await c.ctx.close()
}

if (ONLY === 'all' || ONLY === 'android' || ONLY === 'diag') {
  step('Android: recognizer starts inside the Start tap; honest status when no mic audio arrives')
  const { ctx, page } = await newCtx(browser, { android: true, mode: 'no-audio' })
  await ctx.grantPermissions(['microphone', 'clipboard-read', 'clipboard-write'], { origin: BASE })
  await fillNewSession(page, 'No audio test')
  await page.getByRole('button', { name: 'Start recording' }).click()
  await page.waitForURL(/\/live\//)
  const act = await page.evaluate(() => window.__srActivation)
  check(act?.[0] === true, `first SpeechRecognition.start() ran with user activation (${JSON.stringify(act)})`)
  await page.getByText('waiting for microphone audio').first().waitFor({ timeout: 5000 })
  check((await page.getByText('Listening', { exact: true }).count()) === 0, 'header does not claim Listening without onaudiostart')
  check(/✗\s*mic audio/.test(await page.getByTestId('speech-diag').innerText()), 'diagnostics shows mic audio ✗')
  await page.getByText('not receiving microphone audio').first().waitFor({ timeout: 12000 })
  check(true, 'no-audio warning banner shown')
  check(/not being recorded/.test(await page.locator('main, body').first().innerText()), 'empty state copy says audio is not recorded in priority mode')
  await page.getByTestId('speech-diag').getByRole('button').first().click()
  await page.getByTestId('copy-log').click()
  await page.waitForTimeout(500)
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => 'readText failed ' + e.message)
  if (!clip) console.log('   panel:', (await page.getByTestId('speech-diag').innerText()).slice(0, 600))
  check(/onstart/.test(clip) && /no-audio/.test(clip) && /ua: /.test(clip), 'copied diagnostics contain env + event log')
  console.log(clip.split('\n').slice(0, 14).map((l) => '     | ' + l).join('\n'))
  await page.screenshot({ path: `${OUT}/12-android-no-audio-diag.png` })
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('button', { name: 'Stop and save' }).click()
  await ctx.close()

  step('Bare /diag/speech page logs raw recognizer events')
  const d = await newCtx(browser, { android: true, mode: 'ok' })
  await d.page.goto(BASE + '/diag/speech')
  await d.page.getByTestId('diag-start').click()
  await d.page.getByTestId('diag-text').filter({ hasText: 'good morning' }).waitFor({ timeout: 8000 })
  await d.page.waitForTimeout(2500)
  const log = await d.page.getByTestId('diag-log').innerText()
  console.log(log.split('\n').map((l) => '     | ' + l).join('\n'))
  check(/start\(\) called/.test(log) && /audiostart/.test(log) && /result/.test(log) && /end/.test(log), 'diag page shows start → audiostart → result → end')
  await d.page.screenshot({ path: `${OUT}/13-diag-speech.png`, fullPage: true })
  await d.ctx.close()
}

if (ONLY === 'all' || ONLY === 'whisper') {
  step('On-device Whisper: Settings test transcribes the fake-mic clip')
  const { ctx, page } = await newCtx(browser, { fake: false })
  await page.goto(BASE + '/settings')
  await page.getByTestId('whisper-test').click()
  const t0 = Date.now()
  await page.getByTestId('whisper-test-text').waitFor({ timeout: 240000 })
  const text = await page.getByTestId('whisper-test-text').innerText()
  console.log(`   whisper (${((Date.now() - t0) / 1000).toFixed(1)}s incl. download):`, text)
  check(/country|fellow|americans|ask/i.test(text), 'Whisper transcribed the English clip')
  await page.getByTestId('whisper-status').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${OUT}/12-whisper-settings.png` })

  step('Whisper live session (audio saved + near-live text), then Transcribe recording in Review')
  await fillNewSession(page, 'Whisper live test', 'whisper')
  await page.getByRole('button', { name: 'Start recording' }).click()
  await page.waitForURL(/\/live\//)
  await page.locator('article').first().waitFor({ timeout: 60000 })
  const live = await page.locator('article').first().innerText()
  console.log('   live whisper segment:', live.replace(/\n/g, ' '))
  check(/Whisper/.test(live), 'live Whisper segment shown, marked Needs review · Whisper')
  await page.screenshot({ path: `${OUT}/13-whisper-live.png` })
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('button', { name: 'Stop and save' }).click()
  await page.waitForURL(/\/sessions\/ses/)
  const before = await page.locator('article').count()
  await page.getByRole('button', { name: /Transcribe recording/ }).first().click()
  await page.getByTestId('transcribe-start').click()
  await page.getByRole('status').filter({ hasText: /Added|no new speech/ }).waitFor({ timeout: 180000 })
  console.log('   transcribe result:', await page.getByRole('status').filter({ hasText: /Added|no new speech/ }).innerText())
  check((await page.locator('article').count()) >= before, 'post-recording transcription completed')
  await page.screenshot({ path: `${OUT}/14-review-transcribe.png` })

  step('Imported audio file → Transcribe recording')
  await page.goto(BASE + '/sessions')
  page.once('dialog', (d) => void d.accept())
  await page.locator('input[type=file]').setInputFiles('/workspace/courtscribe/jfk.wav')
  await page.waitForURL(/\/sessions\/ses/)
  await page.getByText('Imported audio — not transcribed yet.').waitFor()
  await page.getByTestId('transcribe-start').click()
  await page.getByRole('status').filter({ hasText: /Added/ }).waitFor({ timeout: 180000 })
  const imp = await page.locator('article').allInnerTexts()
  console.log('   imported transcript:', imp.join(' | ').replace(/\n/g, ' '))
  check(/fellow Americans/i.test(imp.join(' ')), 'imported audio transcribed with timestamps')
  check(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '))
  await ctx.close()
}

await browser.close()
console.log(failures.length ? `FAILED: ${failures.length}\n- ${failures.join('\n- ')}` : 'ALL PASSED')
process.exit(failures.length ? 1 : 0)
