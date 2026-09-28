import { useMemo, type CSSProperties } from 'react'
import { useComputedColorScheme } from '@mantine/core'

/**
 * A series' spine as CSS variables for one subtree. The server samples the colour from the cover
 * (`Series.spineColor`); this derives the rest for the theme in use, to the Maki Spine contrast
 * rules: the fill carries white text at 4.5:1 or takes near-black when pale, and `--spine-fg`
 * (lines and text on the ground) is lifted in dark to 6.5:1 and darkened in light to 4.6:1.
 *
 * Mantine's primary-colour variables are overridden alongside `--brand*`, so a Mantine Button or
 * Progress inside the subtree wears the spine without its own prop. Custom properties resolve per
 * element, which is why a page cannot just set `--spine` and expect `--brand` to follow: `--brand`
 * was already computed from the root's `--spine`.
 */
export const DEFAULT_SPINE = '#a3322b'

const DARK_GROUND = '#1d1b19'
const LIGHT_GROUND = '#f2ede3'
const PALE_INK = '#1d1b19'

type Rgb = [number, number, number]

function parse(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function toHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')
}

function luminance([r, g, b]: Rgb): number {
  const lin = (x: number) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrast(a: string, b: string): number {
  const la = luminance(parse(a) ?? [0, 0, 0])
  const lb = luminance(parse(b) ?? [0, 0, 0])
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}

function fromHsl(h: number, s: number, l: number): Rgb {
  if (s === 0) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)]
}

/** Moves lightness until the colour reaches `target` contrast against `ground`. */
function towards(spine: string, ground: string, target: number, direction: 1 | -1, maxSat = 1): string {
  const rgb = parse(spine)
  if (!rgb) return spine
  const [h, s0, l0] = toHsl(rgb)
  const s = Math.min(s0, maxSat)
  let l = l0
  let out = toHex(fromHsl(h, s, l))
  while (contrast(out, ground) < target && l > 0.02 && l < 0.98) {
    l += 0.01 * direction
    out = toHex(fromHsl(h, s, l))
  }
  return out
}

export function spineInk(spine: string): string {
  return contrast(spine, '#ffffff') >= 4.5 ? '#ffffff' : PALE_INK
}

export function spineFg(spine: string, scheme: 'dark' | 'light'): string {
  return scheme === 'dark' ? towards(spine, DARK_GROUND, 6.5, 1, 0.7) : towards(spine, LIGHT_GROUND, 4.6, -1)
}

export function spineVars(spineColor: string | null | undefined, scheme: 'dark' | 'light'): CSSProperties {
  const spine = spineColor && parse(spineColor) ? spineColor : DEFAULT_SPINE
  const ink = spineInk(spine)
  const fg = spineFg(spine, scheme)
  // Hover moves away from the text colour, so the label only gains contrast.
  const [h, s, l] = toHsl(parse(spine)!)
  const hover = toHex(fromHsl(h, s, ink === '#ffffff' ? Math.max(0, l - 0.06) : Math.min(1, l + 0.06)))
  return {
    '--spine': spine,
    '--spine-fg': fg,
    '--spine-ink': ink,
    '--brand': spine,
    '--brand-hover': hover,
    '--brand-on': ink,
    '--brand-fg': fg,
    '--brand-glow': `color-mix(in srgb, ${fg} 28%, transparent)`,
    '--mantine-primary-color-filled': spine,
    '--mantine-primary-color-filled-hover': hover,
    '--mantine-primary-color-contrast': ink,
    '--mantine-primary-color-light': `color-mix(in srgb, ${spine} 16%, transparent)`,
    '--mantine-primary-color-light-hover': `color-mix(in srgb, ${spine} 24%, transparent)`,
    '--mantine-primary-color-light-color': fg,
  } as CSSProperties
}

/** `spineVars` for the colour scheme currently showing, recomputed when the viewer switches theme. */
export function useSpineStyle(spineColor: string | null | undefined): CSSProperties {
  const scheme = useComputedColorScheme('dark')
  return useMemo(() => spineVars(spineColor, scheme), [spineColor, scheme])
}
