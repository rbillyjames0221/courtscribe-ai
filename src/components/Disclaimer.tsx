import { Scale } from 'lucide-react'
import { cn } from '@/lib/utils'

export const LEGAL_SHORT = 'Assisted, uncertified transcription. Recording requires authorization from the court or competent authority.'

export function Disclaimer({ compact, className }: { compact?: boolean; className?: string }) {
  if (compact)
    return (
      <p className={cn('flex items-start gap-2 text-xs leading-relaxed text-muted', className)}>
        <Scale className="mt-0.5 size-3.5 shrink-0" />
        {LEGAL_SHORT}
      </p>
    )
  return (
    <div className={cn('rounded-2xl border border-border bg-surface p-4 text-sm leading-relaxed text-muted', className)}>
      <p className="mb-2 flex items-center gap-2 font-semibold text-text">
        <Scale className="size-4" /> Legal notice
      </p>
      <p>
        CourtScribe AI is an <strong className="text-text">assisted transcription tool</strong>. Its output is a working draft that may contain recognition errors. It is{' '}
        <strong className="text-text">not a certified transcript</strong>, not an official judicial record, and not guaranteed evidence. Verify every passage against the original audio.
      </p>
      <p className="mt-2">
        Recording and processing must be authorized by the presiding court or other competent authority. Handle recordings as confidential personal data under the Data Privacy Act of 2012 (RA 10173) and applicable Supreme Court rules, including restrictions on unauthorized recording of proceedings.
      </p>
    </div>
  )
}
