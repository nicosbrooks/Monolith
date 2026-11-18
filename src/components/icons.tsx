import type { ComponentType, SVGProps } from 'react'

/**
 * Monolith's own icons, for the few places where the stock set read as generic: the Vault, Listen (read aloud), the
 * favorite star and the ⋯ menu. Same 24-unit grid, stroke and round ends as lucide, and the same props (`size`,
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

/** Favorite: a star with soft points. Pass `fill="currentColor"` when it's on. */
export function StarIcon({ fill = 'none', ...p }: IconProps) {
  return (
    <Svg {...p}>
      <path
        fill={fill}
        d="M12.51 4.58L14.17 8.49Q14.53 9.32 15.43 9.40L19.66 9.78Q20.94 9.90 19.97 10.74L16.77 13.54Q16.09 14.13 16.29 15.01L17.24 19.15Q17.53 20.40 16.42 19.74L12.77 17.56Q12.00 17.10 11.23 17.56L7.58 19.74Q6.47 20.40 6.76 19.15L7.71 15.01Q7.91 14.13 7.23 13.54L4.03 10.74Q3.06 9.90 4.34 9.78L8.57 9.40Q9.47 9.32 9.83 8.49L11.49 4.58Q12.00 3.40 12.51 4.58Z"
      />
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
