import { useLayoutEffect, useRef, type ChangeEvent } from 'react'
import { expandBeforeCursor } from '@/lib/steno'
import { useSettings } from '@/store/settings'

/**
 * Controlled textarea with live shorthand expansion. The caret is restored in a layout effect
 * (synchronously after React commits) so fast typing never lands characters in the wrong place.
 */
export function useStenoField(value: string, setValue: (v: string) => void) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const pending = useRef<number | null>(null)
  const { stenoDict, autoExpand, caseSensitive } = useSettings()
  useLayoutEffect(() => {
    if (pending.current !== null && ref.current) {
      ref.current.setSelectionRange(pending.current, pending.current)
      pending.current = null
    }
  }, [value])
  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    const raw = el.value
    if (autoExpand && raw.length > value.length) {
      const out = expandBeforeCursor(raw, el.selectionStart ?? raw.length, stenoDict, { caseSensitive })
      if (out) {
        pending.current = out.cursor
        setValue(out.value)
        return
      }
    }
    setValue(raw)
  }
  return { ref, onChange }
}
