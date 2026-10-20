export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="var(--cs-primary)" />
      <path d="M20 18h17a9 9 0 0 1 0 18H26v10" fill="none" stroke="var(--cs-on-primary)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="44" cy="46" r="5" fill="var(--cs-recording)" />
    </svg>
  )
}
