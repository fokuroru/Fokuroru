import { useSyncExternalStore } from 'react'

export type FigureSize = 'small' | 'medium' | 'large'
export type FigureFrequency = 'rarely' | 'sometimes' | 'often' | 'always'

export interface ShelfFigurePrefs {
  size: FigureSize
  frequency: FigureFrequency
}

/** How tall a figure stands, as a share of its default, and how often one is stood on the shelf. */
export const FIGURE_SCALE: Record<FigureSize, number> = { small: 0.7, medium: 1, large: 1.3 }
export const FIGURE_CHANCE: Record<FigureFrequency, number> = { rarely: 0.15, sometimes: 0.35, often: 0.6, always: 1 }

const KEY = 'shelf-figure-prefs'
const DEFAULTS: ShelfFigurePrefs = { size: 'medium', frequency: 'sometimes' }

const listeners = new Set<() => void>()
let memory: ShelfFigurePrefs | null = null
// useSyncExternalStore needs the same object back until something changes.
let cached: { raw: string | null; prefs: ShelfFigurePrefs } | null = null

function parse(raw: string | null): ShelfFigurePrefs {
  if (!raw) return DEFAULTS
  try {
    const v = JSON.parse(raw) as Partial<ShelfFigurePrefs>
    return {
      size: v.size && v.size in FIGURE_SCALE ? v.size : DEFAULTS.size,
      frequency: v.frequency && v.frequency in FIGURE_CHANCE ? v.frequency : DEFAULTS.frequency,
    }
  } catch {
    return DEFAULTS
  }
}

export function getShelfFigurePrefs(): ShelfFigurePrefs {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return memory ?? DEFAULTS
  }
  if (cached?.raw !== raw) cached = { raw, prefs: parse(raw) }
  return cached.prefs
}

export function setShelfFigurePrefs(next: Partial<ShelfFigurePrefs>) {
  const prefs = { ...getShelfFigurePrefs(), ...next }
  memory = prefs
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* private mode: kept for this visit only */
  }
  listeners.forEach((cb) => cb())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Remembered on this device, like the theme. */
export function useShelfFigurePrefs(): ShelfFigurePrefs {
  return useSyncExternalStore(subscribe, getShelfFigurePrefs)
}
