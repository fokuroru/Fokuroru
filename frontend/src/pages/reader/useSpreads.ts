import { useCallback, useEffect, useMemo, useState } from 'react'
import { bookSpreads } from './bookLayout'
import { isSpreadShape, isStripShape } from './pageShape'

/**
 * Page aspect ratios, measured in the browser as images load.
 *
 * Deliberately client-side: the manifest carries no dimensions, because probing every page
 * server-side means decoding the whole archive just to open a chapter. The reader needs the
 * ratio only to decide whether a page is a two-page spread, and by then the image is loading
 * anyway.
 */
export function usePageAspects(urls: string[]) {
  const [wide, setWide] = useState<Record<number, boolean>>({})
  const [strip, setStrip] = useState<Record<number, boolean>>({})
  // Width over height of the tallest single page seen, the shape short pages are evened out to.
  const [sheetAspect, setSheetAspect] = useState<number | null>(null)

  useEffect(() => {
    setWide({})
    setStrip({})
    setSheetAspect(null)
  }, [urls])

  const measure = useCallback((index: number, image: HTMLImageElement) => {
    if (!image.naturalWidth || !image.naturalHeight) return
    const isWide = isSpreadShape(image.naturalWidth, image.naturalHeight)
    setWide((current) => (current[index] === isWide ? current : { ...current, [index]: isWide }))
    const isStrip = isStripShape(image.naturalWidth, image.naturalHeight)
    setStrip((current) => (current[index] === isStrip ? current : { ...current, [index]: isStrip }))
    const aspect = image.naturalWidth / image.naturalHeight
    // Webtoon slices are far taller than any page; evening a chapter out to one would squash it.
    if (aspect >= MIN_SHEET_ASPECT && aspect <= 1) {
      setSheetAspect((current) => (current === null || aspect < current ? aspect : current))
    }
  }, [])

  return { wide, strip, measure, sheetAspect }
}

export type Spread = number[]

/** Each page followed by the strips measured under it: [page, strip, ...]. Strips never lead a group. */
export function stripGroups(strip: Record<number, boolean>, pageCount: number): number[][] {
  const groups: number[][] = []
  for (let i = 1; i < pageCount; i++) {
    if (!strip[i]) continue
    const last = groups[groups.length - 1]
    if (last && last[last.length - 1] === i - 1) last.push(i)
    else groups.push([i - 1, i])
  }
  return groups
}

const MIN_SHEET_ASPECT = 0.45
const NO_GROUPS: number[][] = []

/**
 * Groups pages into what is shown at once in double-page mode.
 *
 * The first page stands alone (covers are single, and pairing from index 0 puts every
 * subsequent spread out of phase). A page measured as wider than it is tall is a printed
 * two-page spread and also stands alone. Pages not measured yet are assumed portrait, so the
 * layout settles as images arrive rather than blocking on them.
 */
export function useSpreads(
  pageCount: number,
  wide: Record<number, boolean>,
  enabled: boolean,
  contentPages?: number,
  groups: number[][] = NO_GROUPS,
): Spread[] {
  return useMemo(() => {
    if (contentPages !== undefined) {
      if (groups.length === 0) return bookSpreads(contentPages, pageCount, wide, enabled)
      // A grouped page stands alone like a spread, then the strips are folded back into it.
      const alone = { ...wide }
      for (const group of groups) for (const page of group) alone[page] = true
      const folded: Spread[] = []
      const strips = new Set(groups.flatMap((group) => group.slice(1)))
      for (const spread of bookSpreads(contentPages, pageCount, alone, enabled)) {
        const host = folded[folded.length - 1]
        if (spread.length === 1 && strips.has(spread[0]!) && host) host.push(spread[0]!)
        else folded.push([...spread])
      }
      return folded
    }
    if (!enabled) {
      return Array.from({ length: pageCount }, (_, i) => [i])
    }

    const spreads: Spread[] = []
    let i = 0
    while (i < pageCount) {
      if (i === 0 || wide[i]) {
        spreads.push([i])
        i += 1
        continue
      }
      if (i + 1 < pageCount && !wide[i + 1]) {
        spreads.push([i, i + 1])
        i += 2
        continue
      }
      spreads.push([i])
      i += 1
    }
    return spreads
  }, [pageCount, wide, enabled, contentPages, groups])
}

/** The spread containing a page, and the first page of a spread. */
export function spreadIndexOf(spreads: Spread[], page: number): number {
  const at = spreads.findIndex((s) => s.includes(page))
  return at < 0 ? 0 : at
}
