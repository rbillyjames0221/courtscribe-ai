import type { ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center rounded-2xl border border-dashed border-border bg-surface px-6 py-10 text-center', className)}>
      {icon && <div className="mb-3 text-muted [&_svg]:size-8">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-12 text-muted">
      <Loader2 className="size-5 animate-spin" /> {label}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-surface-2', className)} />
}

export function ErrorState({ title = 'Something went wrong', body, action }: { title?: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center rounded-2xl border border-recording/25 bg-recording/5 px-6 py-8 text-center">
      <AlertTriangle className="mb-2 size-7 text-recording" />
      <p className="font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Banner({ tone = 'info', icon, children, action }: { tone?: 'info' | 'warning' | 'danger' | 'success'; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  const tones = {
    info: 'border-interactive/25 bg-interactive/6',
    warning: 'border-warning/30 bg-warning/8',
    danger: 'border-recording/30 bg-recording/6',
    success: 'border-success/30 bg-success/8',
  }
  return (
    <div className={cn('flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center', tones[tone])}>
      <div className="flex min-w-0 flex-1 gap-3">
        {icon && <div className="mt-0.5 shrink-0 [&_svg]:size-5">{icon}</div>}
        <div className="min-w-0 text-sm leading-relaxed">{children}</div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  )
}
