import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { CheckCircle2, HardDrive, Mic, MicOff, Plus, ShieldCheck, Trash2, Wifi, WifiOff, XCircle, AlertTriangle } from 'lucide-react'
import { LANGUAGES, MODES, SPEAKER_ROLES, Session as SessionSchema, type Language, type Mode, type Participant, type Session, type SpeakerRole } from '@/lib/types'
import { uid } from '@/lib/id'
import { repo, storageEstimate } from '@/lib/db'
import { LevelMeter, micPermissionState, openMic } from '@/lib/audio/capture'
import { PROVIDERS, providerAvailability, type ProviderId } from '@/lib/speech'
import { fmtBytes } from '@/lib/time'
import { useSettings } from '@/store/settings'
import { useLive } from '@/store/live'
import { useSessions } from '@/store/sessions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Segmented, Select, Textarea } from '@/components/ui/field'
import { Banner } from '@/components/ui/states'
import { cn } from '@/lib/utils'

function LevelBar({ level }: { level: number }) {
  const bars = 24
  return (
    <div className="flex h-8 items-end gap-[3px]" aria-label={`Input level ${Math.round(level * 100)} percent`} role="meter" aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100}>
      {Array.from({ length: bars }, (_, i) => {
        const on = level * bars > i
        return <span key={i} className={cn('w-full rounded-sm transition-colors duration-75', on ? (i > bars * 0.85 ? 'bg-recording' : i > bars * 0.65 ? 'bg-warning' : 'bg-success') : 'bg-surface-2')} style={{ height: `${30 + (i / bars) * 70}%` }} />
      })}
    </div>
  )
}

type MicState = 'unknown' | 'testing' | 'ok' | 'denied' | 'error' | 'unsupported'

export default function NewSession() {
  const settings = useSettings()
  const live = useLive()
  const nav = useNavigate()
  const today = new Date().toISOString().slice(0, 10)
  const [title, setTitle] = useState('')
  const [caseNumber, setCaseNumber] = useState('')
  const [venue, setVenue] = useState('')
  const [date, setDate] = useState(today)
  const [participants, setParticipants] = useState<Participant[]>(() =>
    (['Judge', 'Prosecutor', 'Defense Counsel', 'Witness'] as SpeakerRole[]).map((role) => ({ id: uid('p'), name: '', role })),
  )
  const [language, setLanguage] = useState<Language>(settings.defaultLanguage)
  const [mode, setMode] = useState<Mode>(settings.defaultMode)
  const [providerId, setProviderId] = useState<ProviderId>(settings.providerId)
  const [storageMode, setStorageMode] = useState<'local' | 'local-no-audio'>('local')
  const [glossary, setGlossary] = useState(settings.defaultGlossary.join('\n'))
  const [authorized, setAuthorized] = useState(false)
  const [authority, setAuthority] = useState('')
  const [mic, setMic] = useState<MicState>('unknown')
  const [micError, setMicError] = useState<string>()
  const [level, setLevel] = useState(0)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string>()
  const test = useRef<{ stream: MediaStream; meter: LevelMeter; raf: number } | null>(null)

  const stopTest = () => {
    if (!test.current) return
    cancelAnimationFrame(test.current.raf)
    test.current.meter.close()
    test.current.stream.getTracks().forEach((t) => t.stop())
    test.current = null
    setLevel(0)
  }

  useEffect(() => {
    void storageEstimate().then(setStorage)
    void micPermissionState().then((s) => s === 'denied' && setMic('denied'))
    const f = () => setOnline(navigator.onLine)
    window.addEventListener('online', f)
    window.addEventListener('offline', f)
    return () => {
      stopTest()
      window.removeEventListener('online', f)
      window.removeEventListener('offline', f)
    }
  }, [])

  if (live.session && (live.phase === 'recording' || live.phase === 'paused')) return <Navigate to={`/live/${live.session.id}`} replace />

  const testMic = async () => {
    stopTest()
    setMic('testing')
    setMicError(undefined)
    try {
      const stream = await openMic({ echoCancellation: settings.echoCancellation, noiseSuppression: settings.noiseSuppression, autoGainControl: settings.autoGainControl })
      const meter = new LevelMeter(stream)
      const loop = () => {
        setLevel(meter.level())
        if (test.current) test.current.raf = requestAnimationFrame(loop)
      }
      test.current = { stream, meter, raf: requestAnimationFrame(loop) }
      setMic('ok')
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'))
    } catch (e) {
      const err = e as DOMException
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') setMic('denied')
      else if (!navigator.mediaDevices) setMic('unsupported')
      else setMic('error')
      setMicError(err?.message)
    }
  }

  const avail = providerAvailability(providerId)
  const needsProvider = mode !== 'steno'

  const start = async () => {
    const e: Record<string, string> = {}
    if (!title.trim()) e.title = 'Enter a session title'
    if (!authorized) e.auth = 'You must confirm authorization before recording'
    if (needsProvider && !avail.ok) e.provider = avail.reason ?? 'Recognition provider unavailable'
    setErrors(e)
    if (Object.keys(e).length) {
      document.querySelector('[data-error="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    stopTest()
    setStarting(true)
    setStartError(undefined)
    const now = Date.now()
    const parsed = SessionSchema.safeParse({
      id: uid('ses'),
      title: title.trim(),
      caseNumber: caseNumber.trim(),
      venue: venue.trim(),
      sessionDate: date,
      participants: participants.map((p) => ({ ...p, name: p.name.trim() })),
      language,
      mode,
      recordingSource: 'microphone',
      storageMode,
      providerId: mode === 'steno' ? 'none' : providerId,
      glossary: glossary.split(/[\n,]/).map((g) => g.trim()).filter(Boolean),
      status: 'draft',
      authorization: { confirmed: true, confirmedAt: now, authority: authority.trim() },
      createdAt: now,
      updatedAt: now,
      durationMs: 0,
      runCount: 0,
    })
    if (!parsed.success) {
      setStarting(false)
      setStartError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
      return
    }
    const session: Session = parsed.data
    await repo.putSession(session)
    void useSessions.getState().refresh()
    const ok = await useLive.getState().start(session)
    setStarting(false)
    if (ok) nav(`/live/${session.id}`, { replace: true })
    else {
      setStartError(useLive.getState().error)
      if (/denied/i.test(useLive.getState().error ?? '')) setMic('denied')
    }
  }

  const setP = (id: string, patch: Partial<Participant>) => setParticipants((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)))

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pt-[calc(1.25rem+var(--safe-top))] pb-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">New session</h1>
        <p className="text-sm text-muted">Set up the proceeding, check your microphone, then confirm authorization.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Session details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Title" htmlFor="title" error={errors.title}>
            <Input id="title" data-error={!!errors.title} placeholder="e.g. Case Hearing — Session 01" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Case / reference no. (optional)" htmlFor="case">
              <Input id="case" placeholder="Crim. Case No. 12345" value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} />
            </Field>
            <Field label="Session date" htmlFor="date">
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Court or venue (optional)" htmlFor="venue">
            <Input id="venue" placeholder="RTC Branch 12, Quezon City" value={venue} onChange={(e) => setVenue(e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Participants and roles</CardTitle>
          <p className="text-sm text-muted">Speakers are assigned manually during recording. Names are optional.</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {participants.map((p, i) => (
            <div key={p.id} className="flex gap-2">
              <Select aria-label={`Role for participant ${i + 1}`} value={p.role} onChange={(e) => setP(p.id, { role: e.target.value as SpeakerRole })} className="w-[44%] sm:w-52">
                {SPEAKER_ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
              <Input aria-label={`Name for participant ${i + 1}`} placeholder="Name (optional)" value={p.name} onChange={(e) => setP(p.id, { name: e.target.value })} />
              <Button size="icon" variant="ghost" aria-label="Remove participant" disabled={participants.length <= 1} onClick={() => setParticipants((ps) => ps.filter((x) => x.id !== p.id))}>
                <Trash2 className="text-muted" />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" className="text-interactive" onClick={() => setParticipants((ps) => [...ps, { id: uid('p'), name: '', role: 'Other' }])}>
            <Plus /> Add participant
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Language and mode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Segmented ariaLabel="Language" value={language} onChange={setLanguage} options={LANGUAGES.map((l) => ({ id: l.id, label: l.label, hint: l.hint }))} />
          {language === 'mixed' && (
            <Banner tone="warning" icon={<AlertTriangle className="text-warning" />}>
              Experimental: English–Tagalog code-switching uses the Filipino recognizer. Accuracy on real Taglish testimony has not been validated — review every passage. No automatic translation is applied.
            </Banner>
          )}
          <Segmented ariaLabel="Transcription mode" value={mode} onChange={setMode} options={MODES.map((m) => ({ id: m.id, label: m.label, hint: m.hint }))} />
          {needsProvider && (
            <Field label="Speech recognition" htmlFor="provider" error={errors.provider} hint={PROVIDERS.find((p) => p.id === providerId)?.description}>
              <Select id="provider" data-error={!!errors.provider} value={providerId} onChange={(e) => setProviderId(e.target.value as ProviderId)}>
                {PROVIDERS.map((p) => {
                  const a = providerAvailability(p.id)
                  return (
                    <option key={p.id} value={p.id} disabled={!a.ok}>
                      {p.label}
                      {a.ok ? '' : ' — unavailable'}
                    </option>
                  )
                })}
              </Select>
            </Field>
          )}
          {needsProvider && !avail.ok && <p className="text-sm text-warning">{avail.reason} You can use Manual/Steno mode or the demo script.</p>}
          <details className="group rounded-xl border border-border px-3.5 py-1">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Advanced: glossary, recording source and storage</summary>
            <div className="space-y-4 pt-2 pb-3">
              <Field label="Glossary (names, case references, legal terms)" htmlFor="glossary" hint="Used for display and by cloud providers that support phrase adaptation. Browser recognition ignores it. Testimony is never rewritten to match the glossary.">
                <Textarea id="glossary" rows={3} value={glossary} onChange={(e) => setGlossary(e.target.value)} />
              </Field>
              <Field label="Recording source" htmlFor="source">
                <Select id="source" value="microphone" onChange={() => {}}>
                  <option value="microphone">Device microphone</option>
                </Select>
              </Field>
              <Field label="Storage mode" htmlFor="storage" hint="Audio and transcript stay on this device (IndexedDB). Nothing is uploaded.">
                <Select id="storage" value={storageMode} onChange={(e) => setStorageMode(e.target.value as typeof storageMode)}>
                  <option value="local">Save original audio + transcript locally</option>
                  <option value="local-no-audio">Transcript only (do not keep audio)</option>
                </Select>
              </Field>
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pre-recording checks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-xl border border-border p-3.5">
            <div className="flex items-center gap-3">
              {mic === 'ok' ? <CheckCircle2 className="size-5 text-success" /> : mic === 'denied' || mic === 'error' || mic === 'unsupported' ? <MicOff className="size-5 text-recording" /> : <Mic className="size-5 text-muted" />}
              <div className="flex-1">
                <p className="text-sm font-medium">Microphone</p>
                <p className="text-sm text-muted">
                  {mic === 'ok' ? 'Working — speak to see the input level.' : mic === 'denied' ? 'Permission denied.' : mic === 'testing' ? 'Requesting access…' : mic === 'error' ? `Could not open microphone. ${micError ?? ''}` : mic === 'unsupported' ? 'This browser cannot record audio.' : 'Not tested yet.'}
                </p>
              </div>
              <Button size="sm" onClick={mic === 'ok' ? stopTest : testMic}>
                {mic === 'ok' && test.current ? 'Stop test' : 'Test mic'}
              </Button>
            </div>
            {mic === 'ok' && (
              <div className="mt-3 space-y-2">
                <LevelBar level={level} />
                {devices.length > 1 && <p className="text-xs text-muted">{devices.length} input devices detected. The system default is used.</p>}
              </div>
            )}
            {mic === 'denied' && (
              <p className="mt-2 text-sm text-muted">
                Open your browser's site settings (the lock icon beside the address), allow <strong>Microphone</strong> for this site, then test again. On Android: Settings › Apps › Chrome › Permissions › Microphone.
              </p>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex items-center gap-3 rounded-xl border border-border p-3.5 text-sm">
              {online ? <Wifi className="size-5 text-success" /> : <WifiOff className="size-5 text-warning" />}
              <div>
                <p className="font-medium">{online ? 'Online' : 'Offline'}</p>
                <p className="text-muted">{online ? 'Live recognition available' : 'Audio will record; recognition waits'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-border p-3.5 text-sm">
              <HardDrive className="size-5 text-muted" />
              <div>
                <p className="font-medium">{storage ? `${fmtBytes(Math.max(0, storage.quota - storage.usage))} free` : 'Checking…'}</p>
                <p className="text-muted">≈ {storage ? Math.floor(Math.max(0, storage.quota - storage.usage) / (4000 * 3600)) : '—'} h of audio at 32 kbps</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className={cn(errors.auth && 'border-recording/50')}>
        <CardHeader className="flex flex-row items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          <CardTitle>Authorization to record</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex min-h-12 cursor-pointer items-start gap-3" data-error={!!errors.auth}>
            <input type="checkbox" checked={authorized} onChange={(e) => { setAuthorized(e.target.checked); if (e.target.checked) setErrors(({ auth: _a, ...rest }) => rest) }} className="mt-0.5 size-6 shrink-0 accent-[var(--cs-primary)]" />
            <span className="text-sm leading-relaxed">
              I confirm that recording and processing this proceeding is <strong>authorized by the presiding court or competent authority</strong>, that participants have been informed as required, and that I will handle the recording as confidential under the Data Privacy Act. I understand the transcript is an <strong>assisted draft, not a certified record</strong>.
            </span>
          </label>
          {errors.auth && <p className="text-sm text-recording">{errors.auth}</p>}
          <Field label="Authority / basis (optional)" htmlFor="authority">
            <Input id="authority" placeholder="e.g. Order of the Presiding Judge, RTC Br. 12" value={authority} onChange={(e) => setAuthority(e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      {startError && (
        <Banner tone="danger" icon={<XCircle className="text-recording" />}>
          {startError}
        </Banner>
      )}

      <div className="sticky bottom-[calc(5rem+var(--safe-bottom))] z-10 -mx-4 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border md:bottom-4">
        <Button variant="danger" size="lg" className="w-full" onClick={start} disabled={starting}>
          <Mic /> {starting ? 'Starting…' : 'Start recording'}
        </Button>
      </div>
    </div>
  )
}
