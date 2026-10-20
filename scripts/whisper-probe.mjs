// Probe on-device Whisper with a given fake-mic file: live session for N seconds, print segments + diagnostics.
import { chromium } from 'playwright-core'
const BASE = process.env.BASE ?? 'http://localhost:4173'
const MIC = process.env.MIC ?? '/workspace/courtscribe/noise48.wav'
const SECS = Number(process.env.SECS ?? 35)
const AUTOPLAY = process.env.AUTOPLAY !== '0'
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
const args = ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${MIC}`]
if (AUTOPLAY) args.push('--autoplay-policy=no-user-gesture-required')
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['microphone'], userAgent: UA })
const page = await ctx.newPage()
page.on('console', (m) => /whisper|vad|AudioContext/i.test(m.text()) && console.log('  [console]', m.text()))
await page.goto(BASE + '/settings')
await page.getByRole('button', { name: /Download|Load model/ }).click()
await page.getByTestId('whisper-status').filter({ hasText: /Ready/ }).waitFor({ timeout: 240000 })
await page.goto(BASE + '/record')
await page.getByLabel('Title').fill('probe')
await page.getByRole('radio', { name: /Live Speech-to-Text/ }).click()
await page.getByLabel('Speech recognition').selectOption('whisper')
await page.locator('input[type=checkbox]').first().check()
await page.getByRole('button', { name: 'Start recording' }).click()
await page.waitForURL(/\/live\//)
await page.waitForTimeout(SECS * 1000)
const diag = await page.evaluate(() => (window).__csWhisperDiag ?? null)
const segs = await page.locator('article').allInnerTexts()
console.log('segments:', segs.length)
for (const s of segs) console.log('  -', s.replace(/\n/g, ' '))
console.log('diag:', JSON.stringify(diag))
const ind = await page.getByTestId('whisper-diag').innerText().catch(() => '(no diag line)')
console.log('ui diag:', ind)
await page.screenshot({ path: process.env.SHOT ?? '/tmp/probe.png' })
await browser.close()
