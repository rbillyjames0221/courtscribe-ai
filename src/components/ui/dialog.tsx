import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Accessible modal: bottom sheet on phones, centered dialog on larger screens. */
export function Dialog({ open, onClose, title, description, children, footer, className }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select, button')?.focus(), 30)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-[#0b1220]/45 backdrop-blur-[1px]" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={cn('relative max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl border border-border bg-surface p-5 pb-[calc(1.25rem+var(--safe-bottom))] shadow-xl sm:max-w-lg sm:rounded-2xl sm:pb-5', className)}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="-mt-1 -mr-2 inline-flex size-11 items-center justify-center rounded-xl text-muted hover:bg-surface-2">
            <X className="size-5" />
          </button>
        </div>
        {children}
        {footer && <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
