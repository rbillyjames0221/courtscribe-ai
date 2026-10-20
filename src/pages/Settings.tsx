import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Accessibility, Archive, Cpu, ChevronRight, Info, Keyboard, Languages, Lock, Mic, SlidersHorizontal, Type } from 'lucide-react'
import { useSettings, type AudioStrategy, type ExportTemplate } from '@/store/settings'
import { WhisperSettings } from '@/components/WhisperSettings'
import { useSessions } from '@/store/sessions'
import { useLive } from '@/store/live'
import { repo, storageEstimate } from '@/lib/db'
import { PROVIDERS, providerAvailability, type ProviderId } from '@/lib/speech'
import { LANGUAGES, MODES, type Language, type Mode } from '@/lib/types'
import { TEMPLATES } from '@/lib/export/build'
import { download } from '@/lib/export/files'
import { fmtBytes } from '@/lib/time'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/field'
import { Dialog } from '@/components/ui/dialog'
import { Banner } from '@/components/ui/states'
import { Disclaimer } from '@/components/Disclaimer'

function Group({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 [&_svg]:size-5 [&_svg]:text-primary">
        {icon}
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border">{children}</CardContent>
    </Card>
  )
}
function Advanced({ children }: { children: ReactNode }) {
  return (
    <details className="py-1">
      <summary className="flex min-h-12 cursor-pointer items-center text-sm font-medium text-interactive">Advanced</summary>
      <div className="space-y-3 pb-3">{children}</div>
    </details>
  )
}

export default function Settings() {
  const s = useSettings()
  const refresh = useSessions((x) => x.refresh)
  const liveActive = useLive((x) => x.phase === 'recording' || x.phase === 'paused')
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null)
  const [msg, setMsg] = useState<string>()
  const [wipe, setWipe] = useState(false)
  const [wipeText, setWipeText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    void storageEstimate().then(setStorage)
  }, [])

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 pt-[calc(1.25rem+var(--safe-top))] pb-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      {msg && <Banner tone="success" action={<Button size="sm" onClick={() => setMsg(undefined)}>OK</Button>}>{msg}</Banner>}

      <Group icon={<SlidersHorizontal />} title="General">
        <div className="py-3">
          <Field label="Your name (for greeting only)" htmlFor="name">
            <Input id="name" value={s.displayName} onChange={(e) => s.set({ displayName: e.target.value })} />
          </Field>
        </div>
        <div className="py-3">
          <Field label="Theme" htmlFor="theme">
            <Select id="theme" value={s.theme} onChange={(e) => s.set({ theme: e.target.value as typeof s.theme })}>
              <option value="light">Light (default)</option>
              <option value="dark">Dark</option>
              <option value="system">Follow system</option>
            </Select>
          </Field>
        </div>
        <div className="py-3">
          <Field label="Default transcription mode" htmlFor="mode">
            <Select id="mode" value={s.defaultMode} onChange={(e) => s.set({ defaultMode: e.target.value as Mode })}>
              {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </Select>
          </Field>
        </div>
      </Group>

      <Group icon={<Mic />} title="Audio and microphone">
        <Switch checked={s.keepScreenAwake} onChange={(v) => s.set({ keepScreenAwake: v })} label="Keep screen awake while recording" description="Uses the Screen Wake Lock API where supported" />
        <Switch checked={s.noiseSuppression} onChange={(v) => s.set({ noiseSuppression: v })} label="Noise suppression" />
        <div className="py-3">
          <Field label="Microphone sharing (browser live text)" htmlFor="strat" hint="Android Chrome cannot record audio and run live speech recognition at the same time. Auto gives live text the mic on Android (audio not saved) and records both elsewhere, switching automatically if the recognizer can't hear. For audio + text on Android, use On-device Whisper.">
            <Select id="strat" value={s.audioStrategy} onChange={(e) => s.set({ audioStrategy: e.target.value as AudioStrategy })}>
              <option value="auto">Auto (recommended)</option>
              <option value="transcription">Always prioritize live text (no audio saved)</option>
              <option value="both">Always record audio too (live text may fail on Android)</option>
            </Select>
          </Field>
        </div>
        <Advanced>
          <Switch checked={s.echoCancellation} onChange={(v) => s.set({ echoCancellation: v })} label="Echo cancellation" />
          <Switch checked={s.autoGainControl} onChange={(v) => s.set({ autoGainControl: v })} label="Automatic gain control" />
          <Field label="Audio chunk length (seconds)" htmlFor="chunk" hint="Audio is committed to local storage at this interval. Shorter = less loss after a crash.">
            <Input id="chunk" type="number" min={1} max={30} value={s.chunkSeconds} onChange={(e) => s.set({ chunkSeconds: Math.min(30, Math.max(1, Number(e.target.value) || 5)) })} className="w-28" />
          </Field>
          <p className="text-sm text-muted">Format: WebM/Opus at 32 kbps where supported (≈14 MB per hour).</p>
        </Advanced>
      </Group>

      <Group icon={<Languages />} title="Language and recognition">
        <div className="py-3">
          <Field label="Default language" htmlFor="lang">
            <Select id="lang" value={s.defaultLanguage} onChange={(e) => s.set({ defaultLanguage: e.target.value as Language })}>
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </Select>
          </Field>
        </div>
        <div className="py-3">
          <Field label="Speech recognition provider" htmlFor="prov" hint={PROVIDERS.find((p) => p.id === s.providerId)?.description}>
            <Select id="prov" value={s.providerId} onChange={(e) => s.set({ providerId: e.target.value as ProviderId })}>
              {PROVIDERS.map((p) => <option key={p.id} value={p.id} disabled={!providerAvailability(p.id).ok}>{p.label}{providerAvailability(p.id).ok ? '' : ' — unavailable'}</option>)}
            </Select>
          </Field>
        </div>
        <Switch checked={s.showInterim} onChange={(v) => s.set({ showInterim: v })} label="Show interim (in-progress) text" />
        <Switch checked={s.showConfidence} onChange={(v) => s.set({ showConfidence: v })} label="Show confidence indicator" />
        <Advanced>
          <Field label={`Flag for review below confidence: ${Math.round(s.reviewThreshold * 100)}%`} htmlFor="thr">
            <input id="thr" type="range" min={0} max={0.9} step={0.05} value={s.reviewThreshold} onChange={(e) => s.set({ reviewThreshold: Number(e.target.value) })} className="w-full accent-[var(--cs-interactive)]" />
          </Field>
          <Field label="Default glossary" htmlFor="gl" hint="One term per line. Pre-filled into new sessions.">
            <Textarea id="gl" rows={4} value={s.defaultGlossary.join('\n')} onChange={(e) => s.set({ defaultGlossary: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} />
          </Field>
          <p className="text-sm text-muted">Filipino and mixed English–Tagalog accuracy have not been benchmarked. Cloud providers (Google / Azure) run through a server-side seam that is not configured in this deployment.</p>
        </Advanced>
        <a href="/diag/speech" className="inline-flex min-h-11 items-center text-sm text-interactive underline" data-testid="diag-link">Speech recognition test page (raw event log for troubleshooting)</a>
      </Group>

      <Group icon={<Cpu />} title="On-device transcription (Whisper)">
        <WhisperSettings />
      </Group>

      <Group icon={<Keyboard />} title="Stenography dictionaries">
        <Link to="/steno" className="flex min-h-12 items-center justify-between py-2 text-[0.95rem] font-medium">
          Manage dictionary ({s.stenoDict.length} entries) <ChevronRight className="size-5 text-muted" />
        </Link>
        <Switch checked={s.autoExpand} onChange={(v) => s.set({ autoExpand: v })} label="Expand shorthand while typing" />
      </Group>

      <Group icon={<Type />} title="Transcript formatting">
        <div className="py-3">
          <Field label={`Transcript text size: ${Math.round(s.transcriptSize * 16)}px`} htmlFor="ts">
            <input id="ts" type="range" min={0.875} max={1.75} step={0.0625} value={s.transcriptSize} onChange={(e) => s.set({ transcriptSize: Number(e.target.value) })} className="w-full accent-[var(--cs-interactive)]" />
          </Field>
          <p className="transcript-text mt-2 rounded-xl bg-surface-2 p-3">(00:01:25) WITNESS — Opo, Your Honor. Nandito po ako noong nangyari ang insidente.</p>
        </div>
        <div className="py-3">
          <Field label="Transcript font" htmlFor="tf">
            <Select id="tf" value={s.transcriptFont} onChange={(e) => s.set({ transcriptFont: e.target.value as typeof s.transcriptFont })}>
              <option value="serif">Source Serif (reading)</option>
              <option value="sans">Inter (sans-serif)</option>
              <option value="dyslexic">Wide spacing (sans)</option>
            </Select>
          </Field>
        </div>
        <Switch checked={s.showTimestamps} onChange={(v) => s.set({ showTimestamps: v })} label="Show timestamps" />
        <div className="py-3">
          <Field label="Default export template" htmlFor="tpl">
            <Select id="tpl" value={s.defaultTemplate} onChange={(e) => s.set({ defaultTemplate: e.target.value as ExportTemplate })}>
              {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </Field>
        </div>
        <Advanced>
          <Field label="Lines per page (court-style)" htmlFor="lpp">
            <Input id="lpp" type="number" min={10} max={40} value={s.linesPerPage} onChange={(e) => s.set({ linesPerPage: Number(e.target.value) || 25 })} className="w-28" />
          </Field>
        </Advanced>
      </Group>

      <Group icon={<Archive />} title="Storage and backups">
        <div className="space-y-1 py-3 text-sm">
          <p>{storage ? `${fmtBytes(storage.usage)} used of ${fmtBytes(storage.quota)}` : 'Checking storage…'}</p>
          <p className="text-muted">{storage?.persisted ? 'Persistent storage is granted — the browser will not evict your recordings automatically.' : 'Not persistent: the browser may clear data under storage pressure.'}</p>
        </div>
        <div className="flex flex-wrap gap-2 py-3">
          {!storage?.persisted && (
            <Button size="sm" onClick={async () => { const ok = await navigator.storage?.persist?.(); setStorage(await storageEstimate()); setMsg(ok ? 'Persistent storage granted.' : 'The browser declined persistent storage. Installing the app (Add to Home screen) usually helps.') }}>
              Request persistent storage
            </Button>
          )}
          <Button size="sm" onClick={async () => download(new Blob([JSON.stringify(await repo.exportBackup(), null, 2)], { type: 'application/json' }), `courtscribe-backup-${new Date().toISOString().slice(0, 10)}.json`)}>
            Export backup (transcripts)
          </Button>
          <Button size="sm" onClick={() => fileRef.current?.click()}>Import backup</Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            try {
              const data = JSON.parse(await f.text())
              if (data.format !== 'courtscribe-backup-v1') throw new Error('Not a CourtScribe backup file')
              await repo.importBackup(data)
              await refresh()
              setMsg(`Imported ${data.sessions?.length ?? 0} sessions. Existing records were not overwritten.`)
            } catch (err) {
              setMsg(`Import failed: ${(err as Error).message}`)
            }
          }} />
        </div>
        <Advanced>
          <Button variant="danger-outline" size="sm" disabled={liveActive} onClick={() => setWipe(true)}>Delete all local data…</Button>
        </Advanced>
      </Group>

      <Group icon={<Lock />} title="Privacy and security">
        <Switch checked label="Require authorization confirmation before every recording" description="Always on. Cannot be disabled." disabled onChange={() => {}} />
        <Switch checked={s.confirmBeforeDelete} onChange={(v) => s.set({ confirmBeforeDelete: v })} label="Type DELETE to confirm session deletion" />
        <div className="space-y-2 py-3 text-sm text-muted">
          <p>All audio and transcripts are stored only in this browser's private storage (IndexedDB) on this device. Nothing is uploaded by this deployment except what the browser's own speech service receives when Web Speech recognition is used.</p>
          <p>Browser storage is protected by your device/OS account but is <strong className="text-text">not separately encrypted</strong> by this web version. Use a device with screen lock and full-disk encryption. The Android build will use encrypted SQLite and app-private audio files.</p>
        </div>
      </Group>

      <Group icon={<Accessibility />} title="Accessibility">
        <Switch checked={s.reduceMotion} onChange={(v) => s.set({ reduceMotion: v })} label="Reduce motion" />
        <Switch checked={s.highContrast} onChange={(v) => s.set({ highContrast: v })} label="Higher contrast text" />
        <p className="py-3 text-sm text-muted">The interface follows your device's text size. All controls have at least 44 px touch targets.</p>
      </Group>

      <Group icon={<Info />} title="About">
        <div className="space-y-1 py-3 text-sm">
          <p className="font-medium">CourtScribe AI · version {__APP_VERSION__}</p>
          <p className="text-muted">Web / PWA build. Android APK (Capacitor) planned.</p>
        </div>
        <div className="py-3">
          <Disclaimer className="border-0 p-0" />
        </div>
        <div className="py-3">
          <Button size="sm" variant="ghost" onClick={() => { s.reset(); setMsg('Settings restored to defaults (dictionary included).') }}>Reset all settings</Button>
        </div>
      </Group>

      <Dialog open={wipe} onClose={() => setWipe(false)} title="Delete all local data?" description="Every session, audio recording, transcript and bookmark on this device will be permanently removed." footer={<><Button onClick={() => setWipe(false)}>Cancel</Button><Button variant="danger" disabled={wipeText !== 'DELETE ALL'} onClick={async () => { await repo.clearAll(); await refresh(); setWipe(false); setWipeText(''); setStorage(await storageEstimate()); setMsg('All local data deleted.') }}>Delete everything</Button></>}>
        <Input aria-label="Type DELETE ALL to confirm" placeholder="Type DELETE ALL" value={wipeText} onChange={(e) => setWipeText(e.target.value)} />
      </Dialog>
    </div>
  )
}
