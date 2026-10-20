import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, FileAudio, FileJson, FileText, FileType, Captions, AlertTriangle } from 'lucide-react'
import { repo } from '@/lib/db'
import { buildTxt, TEMPLATES, type ExportOptions } from '@/lib/export/build'
import { download, exportTranscript, safeName, type ExportFormat } from '@/lib/export/files'
import { buildRuns } from '@/lib/audio/playback'
import type { Bookmark, Segment, Session } from '@/lib/types'
import { useSettings, type ExportTemplate } from '@/store/settings'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Segmented, Switch } from '@/components/ui/field'
import { Banner, ErrorState, LoadingState } from '@/components/ui/states'
import { Disclaimer } from '@/components/Disclaimer'

const FORMATS: { id: ExportFormat; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'docx', label: 'Word (.docx)', hint: 'Editable, line-numbered', icon: <FileType /> },
  { id: 'pdf', label: 'PDF', hint: 'Searchable text, DRAFT watermark', icon: <FileText /> },
  { id: 'txt', label: 'Plain text', hint: '.txt', icon: <FileText /> },
  { id: 'srt', label: 'Subtitles', hint: '.srt with timestamps', icon: <Captions /> },
  { id: 'json', label: 'Structured JSON', hint: 'Full data + revisions', icon: <FileJson /> },
]

export default function ExportPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const settings = useSettings()
  const [data, setData] = useState<{ session: Session; segments: Segment[]; bookmarks: Bookmark[] } | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [template, setTemplate] = useState<ExportTemplate>(settings.defaultTemplate)
  const [format, setFormat] = useState<ExportFormat>('docx')
  const [includeTimestamps, setIncludeTimestamps] = useState(true)
  const [coverSheet, setCoverSheet] = useState(true)
  const [includeCorrections, setIncludeCorrections] = useState(false)
  const [linesPerPage, setLinesPerPage] = useState(settings.linesPerPage)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()

  useEffect(() => {
    void (async () => {
      try {
        const session = await repo.getSession(id)
        if (!session) throw new Error('Session not found')
        const [segments, bookmarks] = await Promise.all([repo.segments(id), repo.bookmarks(id)])
        setData({ session, segments, bookmarks })
        setState('ready')
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
        setState('error')
      }
    })()
  }, [id])

  const opts: ExportOptions = { template, includeTimestamps, coverSheet, linesPerPage: Math.min(40, Math.max(10, linesPerPage)), lineWidth: 72, includeCorrections }
  const preview = useMemo(() => (data ? buildTxt(data.session, data.segments, data.bookmarks, opts).split('\n').slice(0, 60).join('\n') : ''), [data, template, includeTimestamps, coverSheet, linesPerPage, includeCorrections]) // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'loading') return <LoadingState />
  if (state === 'error' || !data) return <div className="p-6"><ErrorState body={err} /></div>
  const unreviewed = data.segments.filter((s) => s.status === 'needs_review' || s.status === 'interim').length

  const run = async () => {
    setBusy(true)
    setErr(undefined)
    try {
      await exportTranscript(format, data.session, data.segments, data.bookmarks, opts)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const exportAudio = async () => {
    const runs = buildRuns(await repo.chunks(id))
    for (const r of runs) {
      const blob = await (await fetch(r.url)).blob()
      const ext = r.mimeType.includes('mp4') ? 'm4a' : r.mimeType.includes('ogg') ? 'ogg' : r.mimeType.includes('mpeg') ? 'mp3' : 'webm'
      download(blob, `${safeName(data.session.title)}_audio_part${r.run}.${ext}`)
      URL.revokeObjectURL(r.url)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 pt-[calc(0.75rem+var(--safe-top))] pb-8 sm:px-6">
      <header className="flex items-center gap-2">
        <Button size="icon" variant="ghost" aria-label="Back to review" onClick={() => nav(`/sessions/${id}`)}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Export transcript</h1>
          <p className="truncate text-sm text-muted">{data.session.title}</p>
        </div>
      </header>

      <Banner tone="warning" icon={<AlertTriangle className="text-warning" />}>
        Every export is labelled <strong>DRAFT — ASSISTED TRANSCRIPT — NOT CERTIFIED</strong>. Templates are configurable layouts, not officially approved court formats, and no certification or signature is generated.
        {unreviewed > 0 && <> {unreviewed} segment{unreviewed === 1 ? ' still needs' : 's still need'} review.</>}
      </Banner>

      <Card>
        <CardHeader><CardTitle>Template</CardTitle></CardHeader>
        <CardContent>
          <Segmented ariaLabel="Template" value={template} onChange={setTemplate} options={TEMPLATES.map((t) => ({ id: t.id, label: t.label, hint: t.hint }))} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Format</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {FORMATS.map((f) => (
            <button key={f.id} type="button" aria-pressed={format === f.id} onClick={() => setFormat(f.id)} className={`flex min-h-16 items-center gap-3 rounded-xl border px-3 text-left transition-colors duration-150 [&_svg]:size-5 ${format === f.id ? 'border-interactive bg-interactive/8 ring-1 ring-interactive' : 'border-border hover:bg-surface-2'}`}>
              <span className="text-primary">{f.icon}</span>
              <span>
                <span className="block text-sm font-medium">{f.label}</span>
                <span className="block text-xs text-muted">{f.hint}</span>
              </span>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Options</CardTitle></CardHeader>
        <CardContent className="divide-y divide-border">
          <Switch checked={includeTimestamps} onChange={setIncludeTimestamps} label="Include timestamps" />
          <Switch checked={coverSheet} onChange={setCoverSheet} label="Cover sheet" description="Case metadata, participants and draft notice" />
          <Switch checked={includeCorrections} onChange={setIncludeCorrections} label="Show correction/review flags" description="Appends [corrected], [needs review] to lines" />
          <div className="py-3">
            <Field label="Lines per page (Q&A / PDF)" htmlFor="lpp">
              <Input id="lpp" type="number" min={10} max={40} value={linesPerPage} onChange={(e) => setLinesPerPage(Number(e.target.value))} className="w-28" />
            </Field>
          </div>
        </CardContent>
      </Card>

      {err && <ErrorState title="Export failed" body={err} />}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="primary" size="lg" className="flex-1" onClick={() => void run()} disabled={busy}>
          <Download /> {busy ? 'Preparing…' : `Download ${FORMATS.find((f) => f.id === format)?.label}`}
        </Button>
        {data.session.storageMode === 'local' && (
          <Button size="lg" onClick={() => void exportAudio()}>
            <FileAudio /> Original audio
          </Button>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>Preview (text layout)</CardTitle></CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-[0.72rem] leading-relaxed whitespace-pre">{preview}</pre>
        </CardContent>
      </Card>
      <Disclaimer />
    </div>
  )
}
