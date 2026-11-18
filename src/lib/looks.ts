/**
 * Workspace looks: a soft gradient wash behind everything (the "look"), and the color of buttons, selection and
 * highlights (the "tint"). Both are chosen in Settings › Appearance and work in dark and light. The colors themselves
 * live in soft.css under `[data-look]` and `[data-tint]`; this file only names them and applies the choice.
 */
export interface Look {
  id: string
  name: string
  /** The three wash colors, for the swatch in Settings. */
  swatch: [string, string, string]
}

export const LOOKS: Look[] = [
  { id: 'graphite', name: 'Graphite', swatch: ['#3a3a38', '#262624', '#1a1a19'] },
  { id: 'dusk', name: 'Dusk', swatch: ['#6e56cf', '#d6409f', '#3e63dd'] },
  { id: 'tide', name: 'Tide', swatch: ['#0090ff', '#12a594', '#6e56cf'] },
  { id: 'moss', name: 'Moss', swatch: ['#30a46c', '#8db654', '#12a594'] },
  { id: 'ember', name: 'Ember', swatch: ['#f76b15', '#e54666', '#ffb224'] },
  { id: 'bloom', name: 'Bloom', swatch: ['#d6409f', '#8e4ec6', '#f76b15'] },
  { id: 'aurora', name: 'Aurora', swatch: ['#30a46c', '#6e56cf', '#0090ff'] },
]

export interface Tint {
  id: string
  name: string
  /** For the dot in Settings. `null`: drawn from the current look or the text color. */
  dot: string | null
}

export const TINTS: Tint[] = [
  { id: 'mono', name: 'Neutral', dot: null },
  { id: 'look', name: 'Match the look', dot: null },
  { id: 'blue', name: 'Blue', dot: '#4c8dff' },
  { id: 'violet', name: 'Violet', dot: '#9b7bff' },
  { id: 'teal', name: 'Teal', dot: '#2ec4b6' },
  { id: 'green', name: 'Green', dot: '#4cc38a' },
  { id: 'amber', name: 'Amber', dot: '#f5a524' },
  { id: 'rose', name: 'Rose', dot: '#ff6b8b' },
]

export const lookOf = (id?: string) => LOOKS.find((l) => l.id === id) ?? LOOKS[0]
export const tintOf = (id?: string) => TINTS.find((t) => t.id === id) ?? TINTS[0]

/** Puts the chosen look and tint on the page. */
export function applyLook(look?: string, tint?: string) {
  const root = document.documentElement
  root.dataset.look = lookOf(look).id
  root.dataset.tint = tintOf(tint).id
}

/** The material panels are made of. Fill: how much of the panel color covers the look behind (percent). Blur: frost
 *  (px). Edge: outline strength (percent). Radius: corner roundness (px). */
export interface Surface { fill: number; blur: number; edge: number; radius: number }

export const SURFACES: { id: string; name: string; s: Surface }[] = [
  { id: 'clear', name: 'Clear', s: { fill: 22, blur: 14, edge: 10, radius: 16 } },
  { id: 'frosted', name: 'Frosted', s: { fill: 46, blur: 24, edge: 7, radius: 16 } },
  { id: 'solid', name: 'Solid', s: { fill: 94, blur: 0, edge: 5, radius: 16 } },
]
export const DEFAULT_SURFACE = SURFACES[1].s
export const surfaceOf = (s?: Partial<Surface>): Surface => ({ ...DEFAULT_SURFACE, ...s })
/** The preset these values match, if any. */
export const surfacePreset = (s?: Partial<Surface>) => {
  const v = surfaceOf(s)
  return SURFACES.find((p) => p.s.fill === v.fill && p.s.blur === v.blur && p.s.edge === v.edge)?.id ?? null
}

/** Puts the chosen surface on the page. */
export function applySurface(s?: Partial<Surface>) {
  const v = surfaceOf(s)
  const st = document.documentElement.style
  st.setProperty('--mat-fill', `${v.fill}%`)
  st.setProperty('--mat-blur', `${v.blur}px`)
  st.setProperty('--mat-edge', `${v.edge}%`)
  st.setProperty('--mat-radius', `${v.radius}px`)
}
