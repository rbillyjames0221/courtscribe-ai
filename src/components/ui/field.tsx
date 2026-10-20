import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const control =
  'w-full rounded-xl border border-border bg-surface px-3.5 text-[0.95rem] text-text placeholder:text-muted/70 transition-colors duration-150 focus:border-interactive focus:outline-none focus:ring-2 focus:ring-interactive/20 disabled:opacity-60'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(control, 'min-h-12', className)} {...p} />
))
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(control, 'py-3 leading-relaxed', className)} {...p} />
))
Textarea.displayName = 'Textarea'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn(control, 'min-h-12 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23667085' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...p} />
))
Select.displayName = 'Select'

export function Field({ label, hint, error, children, htmlFor, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-text">
        {label}
      </label>
      {children}
      {error ? <p className="text-sm text-recording">{error}</p> : hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  )
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId()
  return (
    <label htmlFor={id} className={cn('flex min-h-12 cursor-pointer items-center justify-between gap-4 py-2', disabled && 'cursor-not-allowed opacity-60')}>
      <span className="min-w-0">
        <span className="block text-[0.95rem] font-medium">{label}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-7 w-12 rounded-full bg-border transition-colors duration-200 peer-checked:bg-interactive peer-focus-visible:ring-2 peer-focus-visible:ring-interactive/40" />
        <span className="absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform duration-200 peer-checked:translate-x-5" />
      </span>
    </label>
  )
}

export function Segmented<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: { id: T; label: ReactNode; hint?: ReactNode }[]; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 3)}, minmax(0,1fr))` }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'min-h-12 rounded-xl border px-3 py-2 text-left text-sm transition-colors duration-150',
            value === o.id ? 'border-interactive bg-interactive/8 text-text ring-1 ring-interactive' : 'border-border bg-surface text-text hover:bg-surface-2',
          )}
        >
          <span className="block font-medium">{o.label}</span>
          {o.hint && <span className="mt-0.5 block text-xs leading-snug text-muted">{o.hint}</span>}
        </button>
      ))}
    </div>
  )
}
