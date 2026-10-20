// Renders PWA PNG icons from the SVG logo using headless Chrome (playwright-core).
import { chromium } from 'playwright-core'
import { writeFileSync } from 'node:fs'

const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${pad ? '<rect width="64" height="64" fill="#174A84"/>' : '<rect width="64" height="64" rx="14" fill="#174A84"/>'}<g transform="${pad ? 'translate(9.6 9.6) scale(0.7)' : ''}"><path d="M20 18h17a9 9 0 0 1 0 18H26v10" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="44" cy="46" r="5" fill="#DC2626"/></g></svg>`
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const page = await browser.newPage()
for (const [name, size, pad] of [['pwa-192.png', 192, false], ['pwa-512.png', 512, false], ['pwa-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(pad).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`)
  writeFileSync(`public/${name}`, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }))
}
await browser.close()
console.log('icons written')
