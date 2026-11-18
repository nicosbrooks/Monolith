import type { ComponentType, SVGProps } from 'react'

/**
 * Monolith's own icons, for the few places where the stock set read as generic: the Vault, Listen (read aloud) and the
 * ⋯ menu. Same 24-unit grid, stroke and round ends as lucide, and the same props (`size`,
 * `strokeWidth`, `fill`), so they sit beside lucide icons without a seam.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & { size?: number | string; strokeWidth?: number | string }

/** Any icon a menu, rail or row takes: a lucide icon or one of these. */
export type AnyIcon = ComponentType<IconProps>

function Svg({ size = 24, strokeWidth = 1.8, children, ...rest }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  )
}

/** The Vault: a small safe, its dial and handle. Where every file lives, once. */
export function VaultIcon({ fill: _f, ...p }: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="4" width="17" height="14.5" rx="3.2" />
      <circle cx="11" cy="11.25" r="3.4" />
      <path d="M11 9.4v1.85l1.3 1" />
      <path d="M17.2 9.2v4.1" />
      <path d="M7 18.5v1.6M17 18.5v1.6" />
    </Svg>
  )
}

/** Listen: lines of text, read out loud. */
export function ListenIcon({ fill: _f, ...p }: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 7h8.5M3.5 12h6M3.5 17h8.5" />
      <path d="M15.6 9.4a3.7 3.7 0 0 1 0 5.2" />
      <path d="M18.2 6.8a7.4 7.4 0 0 1 0 10.4" />
    </Svg>
  )
}

/** A row's or page's menu: three solid dots, so it reads at small sizes. */
export function MoreIcon({ fill: _f, strokeWidth: _s, ...p }: IconProps) {
  return (
    <Svg {...p} stroke="none">
      <circle cx="5.5" cy="12" r="1.75" fill="currentColor" />
      <circle cx="12" cy="12" r="1.75" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.75" fill="currentColor" />
    </Svg>
  )
}
