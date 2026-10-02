import { useSyncExternalStore } from 'react'

/** The catalogue's content ratings, mildest first. A level is a position in this list. */
export const RATINGS = ['safe', 'suggestive', 'erotica', 'pornographic'] as const
export type Rating = (typeof RATINGS)[number]

const KEY = 'maki.spice'
const EVENT = 'maki-spice'
const TOP = RATINGS.length - 1

function read(): number {
  try {
    const stored = localStorage.getItem(KEY)
    const level = stored === null ? TOP : Number(stored)
    return Number.isInteger(level) && level >= 0 && level <= TOP ? level : TOP
  } catch {
    return TOP
  }
}

/**
 * How much "spice" this device shows: the most explicit rating it displays. A viewing choice kept in this
 * browser only. It narrows what is listed and never touches the account's own content-rating setting.
 */
export function getSpice(): number {
  return read()
}

export function setSpice(level: number) {
  try {
    localStorage.setItem(KEY, String(Math.max(0, Math.min(TOP, level))))
  } catch {
    // Storage can be blocked; the choice then lasts until the page is reloaded.
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}

export function useSpice(): number {
  return useSyncExternalStore(subscribe, read, () => TOP)
}

/** Whether a series with this rating is shown at this level. Unrated and unknown ratings stay visible. */
export function ratingShown(rating: string | null | undefined, level: number): boolean {
  if (!rating) return true
  const index = RATINGS.indexOf(rating as Rating)
  return index < 0 || index <= level
}

/** The header the server uses to show less in catalogue views; absent at the top level, which asks for nothing. */
export function spiceHeader(): Record<string, string> {
  const level = read()
  return level >= TOP ? {} : { 'X-Maki-Display-Rating': RATINGS[level] }
}
