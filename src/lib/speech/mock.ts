import { BaseProvider, type StartOptions } from './provider'

/** Scripted demo provider: simulates interim → final streaming so the UI can be tried without a mic engine or keys. */
const SCRIPT: { role: string; text: string }[] = [
  { role: 'Judge', text: 'Counsel, are you ready to present your witness?' },
  { role: 'Defense Counsel', text: 'Yes, Your Honor. We are ready to proceed.' },
  { role: 'Judge', text: 'Please swear in the witness.' },
  { role: 'Defense Counsel', text: 'Where were you on the evening of March fifteen?' },
  { role: 'Witness', text: 'Opo, Your Honor. Nandito po ako noong nangyari ang insidente.' },
  { role: 'Prosecutor', text: 'Objection, Your Honor. The answer is not responsive to the question.' },
  { role: 'Judge', text: 'Sustained. Please answer the question directly.' },
  { role: 'Witness', text: 'Nasa bahay po ako, mga alas siyete ng gabi.' },
  { role: 'Defense Counsel', text: 'Who else was present at that time?' },
  { role: 'Witness', text: 'Yung kapatid ko po at yung kapitbahay namin.' },
  { role: 'Defense Counsel', text: 'I would like to mark this document as Exhibit 3 for the defense.' },
  { role: 'Judge', text: 'Mark it. Proceed, counsel.' },
]

export class MockProvider extends BaseProvider {
  readonly id = 'mock'
  readonly label = 'Demo script (no real recognition)'
  private timer: ReturnType<typeof setTimeout> | null = null
  private opts: StartOptions | null = null
  private line = 0
  private word = 0
  private start = 0
  private running = false
  private uttIndex = 0

  isSupported() {
    return true
  }
  async startSession(opts: StartOptions) {
    this.opts = opts
    this.running = true
    this.setStatus('connecting')
    this.timer = setTimeout(() => {
      this.setStatus('listening')
      this.tick()
    }, 500)
  }
  private tick() {
    if (!this.running || !this.opts) return
    const entry = SCRIPT[this.line % SCRIPT.length]
    const words = entry.text.split(' ')
    const key = `mock:u${this.uttIndex}`
    const now = this.opts.clock()
    if (this.word === 0) this.start = now
    this.word += 1 + Math.floor(Math.random() * 2)
    if (this.word >= words.length) {
      this.emit({ key, text: entry.text, isFinal: true, startMs: this.start, endMs: now, confidence: entry.role === 'Witness' && this.line % 3 === 1 ? 0.48 : 0.92, speakerRoleHint: entry.role })
      this.word = 0
      this.line += 1
      this.uttIndex += 1
      this.timer = setTimeout(() => this.tick(), 1200)
    } else {
      this.emit({ key, text: words.slice(0, this.word).join(' '), isFinal: false, startMs: this.start, endMs: now, speakerRoleHint: entry.role })
      this.timer = setTimeout(() => this.tick(), 260)
    }
  }
  pause() {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.setStatus('paused')
  }
  resume() {
    this.running = true
    this.setStatus('listening')
    this.tick()
  }
  async reconnect() {
    this.pause()
    this.resume()
  }
  async finishSession() {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.setStatus('stopped')
  }
}
