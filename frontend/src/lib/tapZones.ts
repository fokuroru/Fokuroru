/**
 * Where the reader's tap areas are. A layout is a list of rectangles, as fractions of the page, each
 * with something to do when it is tapped. A tap outside every rectangle shows or hides the menu, which
 * is what the middle of the page has always done.
 */

export type TapAction = 'next' | 'prev' | 'menu' | 'nextChapter' | 'prevChapter' | 'bookmark' | 'none'

/** Which layout applies: paged reading taps left and right, scrolling reading taps top and bottom. */
export type TapOrientation = 'horizontal' | 'vertical'

export type ReadingDirection = 'ltr' | 'rtl'

export interface TapZone {
  x: number
  y: number
  w: number
  h: number
  action: TapAction
}

export interface TapZonePreset {
  id: string
  name: string
  orientation: TapOrientation
  zones: TapZone[]
}

export interface TapZoneDocument {
  /** Null means the built-in layout for the reading direction. */
  horizontal: TapZone[] | null
  vertical: TapZone[] | null
  presets: TapZonePreset[]
}

/** Which kind of client a layout belongs to. The app and a browser each keep their own. */
export type TapClient = 'app' | 'web'

export const TAP_ACTIONS: TapAction[] = ['next', 'prev', 'menu', 'nextChapter', 'prevChapter', 'bookmark', 'none']

export const MAX_ZONES = 16
export const MAX_PRESETS = 20
export const MIN_SIDE = 0.02

export const EMPTY_DOCUMENT: TapZoneDocument = { horizontal: null, vertical: null, presets: [] }

const round = (n: number) => Math.round(n * 1000) / 1000

export function clampZone(zone: TapZone): TapZone {
  const x = Math.min(Math.max(zone.x, 0), 1 - MIN_SIDE)
  const y = Math.min(Math.max(zone.y, 0), 1 - MIN_SIDE)
  return {
    x: round(x),
    y: round(y),
    w: round(Math.min(Math.max(zone.w, MIN_SIDE), 1 - x)),
    h: round(Math.min(Math.max(zone.h, MIN_SIDE), 1 - y)),
    action: zone.action,
  }
}

/** The mirror image: what is on the left goes to the right. */
export function flipZones(zones: TapZone[]): TapZone[] {
  return zones.map((zone) => clampZone({ ...zone, x: 1 - zone.x - zone.w }))
}

/**
 * The layout the reader has always had. Reading right to left puts "next" on the left edge, so the
 * default follows the direction; a layout somebody saves does not, because it says where, not which way.
 */
export function defaultZones(orientation: TapOrientation, direction: ReadingDirection): TapZone[] {
  if (orientation === 'vertical') {
    return [
      { x: 0, y: 0, w: 1, h: 0.33, action: 'prev' },
      { x: 0, y: 0.67, w: 1, h: 0.33, action: 'next' },
    ]
  }
  const ltr: TapZone[] = [
    { x: 0, y: 0, w: 0.33, h: 1, action: 'prev' },
    { x: 0.67, y: 0, w: 0.33, h: 1, action: 'next' },
  ]
  return direction === 'rtl' ? flipZones(ltr) : ltr
}

interface BuiltIn {
  id: string
  /** English key for the label, translated where it is shown. */
  key: 'edges' | 'wide' | 'kindle' | 'narrow' | 'menuOnly' | 'halves'
  zones: Record<ReadingDirection, TapZone[]>
}

function both(ltr: TapZone[]): Record<ReadingDirection, TapZone[]> {
  return { ltr, rtl: flipZones(ltr) }
}

const HORIZONTAL_PRESETS: BuiltIn[] = [
  { id: 'builtin:edges', key: 'edges', zones: { ltr: defaultZones('horizontal', 'ltr'), rtl: defaultZones('horizontal', 'rtl') } },
  {
    id: 'builtin:narrow',
    key: 'narrow',
    zones: both([
      { x: 0, y: 0, w: 0.2, h: 1, action: 'prev' },
      { x: 0.8, y: 0, w: 0.2, h: 1, action: 'next' },
    ]),
  },
  {
    id: 'builtin:wide',
    key: 'wide',
    zones: both([
      { x: 0, y: 0.2, w: 0.5, h: 0.8, action: 'prev' },
      { x: 0.5, y: 0.2, w: 0.5, h: 0.8, action: 'next' },
    ]),
  },
  {
    id: 'builtin:kindle',
    key: 'kindle',
    zones: both([
      { x: 0, y: 0, w: 0.25, h: 1, action: 'prev' },
      { x: 0.25, y: 0.15, w: 0.75, h: 0.85, action: 'next' },
    ]),
  },
  { id: 'builtin:menu', key: 'menuOnly', zones: both([]) },
]

const VERTICAL_PRESETS: BuiltIn[] = [
  { id: 'builtin:edges', key: 'edges', zones: both(defaultZones('vertical', 'ltr')) },
  {
    id: 'builtin:halves',
    key: 'halves',
    zones: both([
      { x: 0, y: 0, w: 1, h: 0.2, action: 'prev' },
      { x: 0, y: 0.5, w: 1, h: 0.5, action: 'next' },
    ]),
  },
  { id: 'builtin:menu', key: 'menuOnly', zones: both([]) },
]

export type BuiltInKey = BuiltIn['key']

export function builtInPresets(
  orientation: TapOrientation,
  direction: ReadingDirection,
): { id: string; key: BuiltInKey; zones: TapZone[] }[] {
  const list = orientation === 'vertical' ? VERTICAL_PRESETS : HORIZONTAL_PRESETS
  return list.map((preset) => ({ id: preset.id, key: preset.key, zones: preset.zones[direction].map((z) => ({ ...z })) }))
}

export function layoutFor(
  document: TapZoneDocument | undefined,
  orientation: TapOrientation,
  direction: ReadingDirection,
): TapZone[] {
  return document?.[orientation] ?? defaultZones(orientation, direction)
}

/** The first zone under the point: earlier ones win, so a small zone can sit on top of a large one. */
export function zoneAt(zones: TapZone[], fx: number, fy: number): TapZone | null {
  return zones.find((z) => fx >= z.x && fx < z.x + z.w && fy >= z.y && fy < z.y + z.h) ?? null
}

/** What a tap does. Anywhere no zone covers shows or hides the menu. */
export function actionAt(zones: TapZone[], fx: number, fy: number): TapAction {
  return zoneAt(zones, fx, fy)?.action ?? 'menu'
}

export function sameZones(a: TapZone[] | null, b: TapZone[] | null): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((z, i) => z.x === b[i].x && z.y === b[i].y && z.w === b[i].w && z.h === b[i].h && z.action === b[i].action)
}

function tidyZones(raw: unknown): TapZone[] | null {
  if (!Array.isArray(raw)) return null
  const zones: TapZone[] = []
  for (const item of raw.slice(0, MAX_ZONES)) {
    if (!item || typeof item !== 'object') continue
    const { x, y, w, h, action } = item as Record<string, unknown>
    if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) continue
    if (!TAP_ACTIONS.includes(action as TapAction)) continue
    zones.push(clampZone({ x: x as number, y: y as number, w: w as number, h: h as number, action: action as TapAction }))
  }
  return zones
}

/** What came back from the server or from storage, made safe to use whatever it holds. */
export function tidyDocument(raw: unknown): TapZoneDocument {
  if (!raw || typeof raw !== 'object') return EMPTY_DOCUMENT
  const { horizontal, vertical, presets } = raw as Record<string, unknown>
  const list: TapZonePreset[] = []
  if (Array.isArray(presets)) {
    for (const item of presets.slice(0, MAX_PRESETS)) {
      if (!item || typeof item !== 'object') continue
      const { id, name, orientation, zones } = item as Record<string, unknown>
      if (typeof id !== 'string' || typeof name !== 'string' || (orientation !== 'horizontal' && orientation !== 'vertical')) continue
      list.push({ id, name, orientation, zones: tidyZones(zones) ?? [] })
    }
  }
  return { horizontal: tidyZones(horizontal), vertical: tidyZones(vertical), presets: list }
}
