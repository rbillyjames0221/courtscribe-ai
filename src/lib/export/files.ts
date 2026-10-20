import { DISCLAIMER, DRAFT_BANNER, buildJson, buildSrt, buildTxt, coverLines, metaLines, paginate, transcriptLines, type ExportOptions } from './build'
import type { Bookmark, Segment, Session } from '../types'

export type ExportFormat = 'txt' | 'docx' | 'pdf' | 'srt' | 'json'

export function safeName(s: string) {
  return s.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim().replace(/\s+/g, '_').slice(0, 80) || 'transcript'
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

async function buildPdf(session: Session, segments: Segment[], bookmarks: Bookmark[], opts: ExportOptions): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 56
  const header = () => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(180, 30, 30)
    doc.text(DRAFT_BANNER, M, 34)
    doc.setTextColor(120)
    doc.setFont('helvetica', 'normal')
    doc.text(session.title.slice(0, 60), W - M, 34, { align: 'right' })
    doc.setTextColor(235)
    doc.setFontSize(90)
    doc.setFont('helvetica', 'bold')
    doc.text('DRAFT', W / 2, H / 2, { align: 'center', angle: 35 })
    doc.setTextColor(20)
  }
  const pdfOpts = { ...opts, lineWidth: 72 }
  if (opts.coverSheet) {
    header()
    doc.setFont('times', 'normal')
    doc.setFontSize(12)
    let y = 90
    for (const l of coverLines(session, pdfOpts)) {
      doc.text(l, M, y)
      y += 16
      if (y > H - 60) {
        doc.addPage()
        header()
        y = 90
      }
    }
    doc.addPage()
  }
  const lines = transcriptLines(session, segments, bookmarks, pdfOpts)
  const pages = paginate(lines, opts.linesPerPage)
  const lineH = (H - 150) / opts.linesPerPage
  pages.forEach((page, pi) => {
    if (pi > 0) doc.addPage()
    header()
    if (pi === 0 && !opts.coverSheet) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(90)
      doc.text(metaLines(session).join('   •   ').slice(0, 220), M, 52, { maxWidth: W - 2 * M })
      doc.setTextColor(20)
    }
    doc.setDrawColor(200)
    doc.line(M + 22, 70, M + 22, H - 70)
    page.lines.forEach((l, i) => {
      const y = 90 + i * lineH
      doc.setFont('courier', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(130)
      doc.text(String(i + 1).padStart(2, ' '), M, y)
      doc.setTextColor(20)
      doc.setFontSize(10.5)
      doc.text(l, M + 30, y)
    })
  })
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(110)
    doc.text(`Page ${i} of ${total}`, W - M, H - 30, { align: 'right' })
    if (i === total) doc.text(doc.splitTextToSize(DISCLAIMER, W - 2 * M - 80), M, H - 52)
    else doc.text('Assisted draft — verify against original audio. Not an official record.', M, H - 30)
  }
  doc.setProperties({ title: `${session.title} (DRAFT)`, subject: 'Assisted transcript — not certified', creator: 'CourtScribe AI' })
  return doc.output('blob')
}

async function buildDocx(session: Session, segments: Segment[], bookmarks: Bookmark[], opts: ExportOptions): Promise<Blob> {
  const d = await import('docx')
  const { Document, Packer, Paragraph, TextRun, Header, Footer, AlignmentType, PageNumber, LineNumberRestartFormat, HeadingLevel } = d
  const mono = 'Courier New'
  const draftHeader = new Header({
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: DRAFT_BANNER, bold: true, color: 'B91C1C', size: 18 })] })],
  })
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: 'Assisted draft — not certified.   Page ', size: 16 }), new TextRun({ children: [PageNumber.CURRENT], size: 16 }), new TextRun({ text: ' of ', size: 16 }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16 })],
      }),
    ],
  })
  const sections = []
  if (opts.coverSheet) {
    sections.push({
      headers: { default: draftHeader },
      footers: { default: footer },
      children: coverLines(session, { ...opts, lineWidth: 90 }).map((l, i) =>
        i === 2 ? new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: l })] }) : new Paragraph({ children: [new TextRun({ text: l, bold: i === 0, color: i === 0 ? 'B91C1C' : undefined })] }),
      ),
    })
  }
  const lines = transcriptLines(session, segments, bookmarks, { ...opts, lineWidth: 64 })
  sections.push({
    properties: opts.template === 'court-qa' ? { lineNumbers: { countBy: 1, restart: LineNumberRestartFormat.NEW_PAGE } } : {},
    headers: { default: draftHeader },
    footers: { default: footer },
    children: [
      ...(opts.coverSheet ? [] : metaLines(session).map((l) => new Paragraph({ children: [new TextRun({ text: l, size: 18, color: '475467' })] }))),
      ...lines.map((l) => new Paragraph({ spacing: { after: 0, line: 360 }, children: [new TextRun({ text: l, font: opts.template === 'court-qa' ? mono : undefined, size: 22 })] })),
      new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: DISCLAIMER, italics: true, size: 16, color: '667085' })] }),
    ],
  })
  const doc = new Document({ creator: 'CourtScribe AI', title: `${session.title} (DRAFT)`, description: 'Assisted transcript — not certified', sections })
  return Packer.toBlob(doc)
}

export async function exportTranscript(fmt: ExportFormat, session: Session, segments: Segment[], bookmarks: Bookmark[], opts: ExportOptions) {
  const base = `${safeName(session.title)}_DRAFT`
  switch (fmt) {
    case 'txt':
      return download(new Blob([buildTxt(session, segments, bookmarks, opts)], { type: 'text/plain;charset=utf-8' }), `${base}.txt`)
    case 'srt':
      return download(new Blob([buildSrt(session, segments)], { type: 'application/x-subrip;charset=utf-8' }), `${base}.srt`)
    case 'json':
      return download(new Blob([buildJson(session, segments, bookmarks)], { type: 'application/json' }), `${base}.json`)
    case 'pdf':
      return download(await buildPdf(session, segments, bookmarks, opts), `${base}.pdf`)
    case 'docx':
      return download(await buildDocx(session, segments, bookmarks, opts), `${base}.docx`)
  }
}

export { buildPdf, buildDocx }
