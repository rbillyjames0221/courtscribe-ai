export function uid(prefix = ''): string {
  const c = globalThis.crypto
  const raw = c && 'randomUUID' in c ? c.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return prefix ? `${prefix}_${raw}` : raw
}
