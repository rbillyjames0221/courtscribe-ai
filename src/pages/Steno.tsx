import { useMemo, useRef, useState } from 'react'
import { Download, Keyboard, Plus, RotateCcw, Search, Trash2, Upload } from 'lucide-react'
import { useSettings } from '@/store/settings'
import { DEFAULT_STENO, expandAll, exportDictionary, parseDictionary } from '@/lib/steno'
import { useStenoField } from '@/components/useStenoField'
import { StenoEntry } from '@/lib/types'
import { download } from '@/lib/export/files'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Switch, Textarea } from '@/components/ui/field'
import { Dialog } from '@/components/ui/dialog'
import { Banner, EmptyState } from '@/components/ui/states'

export default function Steno() {
  const { stenoDict, autoExpand, caseSensitive, set } = useSettings()
  const [q, setQ] = useState('')
  const [abbr, setAbbr] = useState('')
  const [expansion, setExpansion] = useState('')
  const [addErr, setAddErr] = useState<string>()
  const [pad, setPad] = useState('')
  const [importMsg, setImportMsg] = useState<{ tone: 'success' | 'warning'; text: string }>()
  const [editing, setEditing] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return [...stenoDict].sort((a, b) => a.abbr.localeCompare(b.abbr)).filter((e) => !t || e.abbr.toLowerCase().includes(t) || e.expansion.toLowerCase().includes(t))
  }, [stenoDict, q])

  const add = () => {
    const r = StenoEntry.safeParse({ abbr: abbr.trim(), expansion: expansion.trim() })
    if (!r.success) return setAddErr(r.error.issues[0]?.message)
    if (stenoDict.some((e) => e.abbr.toLowerCase() === r.data.abbr.toLowerCase())) return setAddErr(`"${r.data.abbr}" already exists`)
    set({ stenoDict: [...stenoDict, r.data] })
    setAbbr('')
    setExpansion('')
    setAddErr(undefined)
  }

  const padField = useStenoField(pad, setPad)

  const importFile = async (f: File) => {
    const res = parseDictionary(await f.text())
    if (!res.entries.length) return setImportMsg({ tone: 'warning', text: `Nothing imported. ${res.errors.slice(0, 3).join('; ')}` })
    const map = new Map(stenoDict.map((e) => [e.abbr.toLowerCase(), e]))
    let added = 0
    let updated = 0
    for (const e of res.entries) {
      if (map.has(e.abbr.toLowerCase())) updated++
      else added++
      map.set(e.abbr.toLowerCase(), e)
    }
    set({ stenoDict: [...map.values()] })
    setImportMsg({ tone: res.errors.length ? 'warning' : 'success', text: `Imported ${added} new, ${updated} updated.${res.errors.length ? ` Skipped ${res.errors.length}: ${res.errors.slice(0, 2).join('; ')}` : ''}` })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 pt-[calc(1.25rem+var(--safe-top))] pb-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Stenography workspace</h1>
        <p className="text-sm text-muted">Shorthand expands only at whole-word boundaries. Type <code className="rounded bg-surface-2 px-1">\yh</code> to keep an abbreviation literal.</p>
      </header>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2"><Keyboard className="size-5 text-primary" /><CardTitle>Practice pad</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Textarea rows={4} className="transcript-text" placeholder="Try: yh, the sw is present. obj " ref={padField.ref} value={pad} onChange={padField.onChange} aria-label="Shorthand practice pad" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setPad(expandAll(pad, stenoDict, { caseSensitive }))}>Expand all</Button>
            <Button size="sm" variant="ghost" onClick={() => setPad('')}>Clear</Button>
          </div>
          <div className="divide-y divide-border border-t border-border pt-1">
            <Switch checked={autoExpand} onChange={(v) => set({ autoExpand: v })} label="Expand while typing" description="Applies in Steno/Hybrid recording, Review and here" />
            <Switch checked={caseSensitive} onChange={(v) => set({ caseSensitive: v })} label="Case-sensitive abbreviations" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Dictionary · {stenoDict.length} entries</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => fileRef.current?.click()}><Upload /> Import</Button>
            <Button size="sm" onClick={() => download(new Blob([exportDictionary(stenoDict, 'json')], { type: 'application/json' }), 'courtscribe-steno.json')}><Download /> JSON</Button>
            <Button size="sm" onClick={() => download(new Blob([exportDictionary(stenoDict, 'csv')], { type: 'text/csv' }), 'courtscribe-steno.csv')}><Download /> CSV</Button>
          </div>
          <input ref={fileRef} type="file" accept=".json,.csv,.txt,application/json,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f) }} />
        </CardHeader>
        <CardContent className="space-y-3">
          {importMsg && <Banner tone={importMsg.tone}>{importMsg.text}</Banner>}
          <div className="grid gap-2 sm:grid-cols-[9rem_1fr_auto]">
            <Input aria-label="Abbreviation" placeholder="Abbr." value={abbr} onChange={(e) => setAbbr(e.target.value)} />
            <Input aria-label="Expansion" placeholder="Expansion" value={expansion} onChange={(e) => setExpansion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
            <Button variant="primary" onClick={add}><Plus /> Add</Button>
          </div>
          {addErr && <p className="text-sm text-recording">{addErr}</p>}
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-muted" />
            <Input type="search" aria-label="Search dictionary" placeholder="Search abbreviations" className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {list.length === 0 ? (
            <EmptyState title={stenoDict.length ? 'No matches' : 'Dictionary is empty'} body={stenoDict.length ? undefined : 'Add entries or import a JSON/CSV file.'} />
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {list.map((e) => (
                <li key={e.abbr} className="flex min-h-13 items-center gap-3 px-3 py-1.5">
                  <code className="w-20 shrink-0 font-mono text-sm font-semibold text-primary">{e.abbr}</code>
                  {editing === e.abbr ? (
                    <Input autoFocus aria-label={`Expansion for ${e.abbr}`} value={editVal} onChange={(ev) => setEditVal(ev.target.value)} onKeyDown={(ev) => {
                      if (ev.key === 'Enter' && editVal.trim()) { set({ stenoDict: stenoDict.map((x) => (x.abbr === e.abbr ? { ...x, expansion: editVal.trim() } : x)) }); setEditing(null) }
                      if (ev.key === 'Escape') setEditing(null)
                    }} onBlur={() => { if (editVal.trim()) set({ stenoDict: stenoDict.map((x) => (x.abbr === e.abbr ? { ...x, expansion: editVal.trim() } : x)) }); setEditing(null) }} />
                  ) : (
                    <button type="button" className="min-h-11 flex-1 text-left text-sm" onClick={() => { setEditing(e.abbr); setEditVal(e.expansion) }}>{e.expansion}</button>
                  )}
                  <Button size="icon-sm" variant="ghost" aria-label={`Delete ${e.abbr}`} onClick={() => set({ stenoDict: stenoDict.filter((x) => x.abbr !== e.abbr) })}><Trash2 className="size-4 text-muted" /></Button>
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}><RotateCcw /> Restore default dictionary</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Machine stenography (planned)</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted">
          External steno keyboards (Plover-style, e.g. via USB HID / serial) will connect through an input adapter. No hardware compatibility is claimed until tested on real devices. Today, any keyboard that types text works with shorthand expansion.
        </CardContent>
      </Card>

      <Dialog open={confirmReset} onClose={() => setConfirmReset(false)} title="Restore default dictionary?" description="Your custom entries will be replaced. Export first if you want to keep them." footer={<><Button onClick={() => setConfirmReset(false)}>Cancel</Button><Button variant="danger" onClick={() => { set({ stenoDict: DEFAULT_STENO }); setConfirmReset(false) }}>Restore defaults</Button></>} />
    </div>
  )
}
