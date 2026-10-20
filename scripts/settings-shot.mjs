import { chromium } from 'playwright-core'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await p.goto('https://courtscribe-ai.vercel.app/settings')
await p.getByRole('heading', { name: 'Settings' }).waitFor()
await p.waitForTimeout(500)
await p.screenshot({ path: '/workspace/courtscribe/shots/06-settings.png' })
await b.close()
