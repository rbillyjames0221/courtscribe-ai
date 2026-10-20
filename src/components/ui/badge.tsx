import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const badge = cva('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5', {
  variants: {
    tone: {
      neutral: 'bg-surface-2 text-muted',
      primary: 'bg-primary/10 text-primary',
      recording: 'bg-recording/10 text-recording',
      success: 'bg-success/10 text-success',
      warning: 'bg-warning/12 text-warning',
      info: 'bg-interactive/10 text-interactive',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export function Badge({ className, tone, ...p }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...p} />
}
