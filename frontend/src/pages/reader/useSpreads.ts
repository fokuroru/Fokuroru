import { useCallback, useEffect, useMemo, useState } from 'react'
import { bookSpreads } from './bookLayout'

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
  // Width over height of the tallest single page seen, the shape short pages are evened out to.
  const [sheetAspect, setSheetAspect] = useState<number | null>(null)

  useEffect(() => {
    setWide({})
    setSheetAspect(null)
  }, [urls])

  const measure = useCallback((index: number, image: HTMLImageElement) => {
    if (!image.naturalWidth || !image.naturalHeight) return
    const isWide = image.naturalWidth > image.naturalHeight
    setWide((current) => (current[index] === isWide ? current : { ...current, [index]: isWide }))
    const aspect = image.naturalWidth / image.naturalHeight
    // Webtoon slices are far taller than any page; evening a chapter out to one would squash it.
    if (aspect >= MIN_SHEET_ASPECT && aspect <= 1) {
      setSheetAspect((current) => (current === null || aspect < current ? aspect : current))
    }
  }, [])

  return { wide, measure, sheetAspect }
}

export type Spread = number[]

const MIN_SHEET_ASPECT = 0.45

/**
 * Groups pages into what is shown at once in double-page mode.
 *
 * The first page stands alone (covers are single, and pairing from index 0 puts every
 * subsequent spread out of phase). A page measured as wider than it is tall is a printed
 * two-page spread and also stands alone. Pages not measured yet are assumed portrait, so the
 * layout settles as images arrive rather than blocking on them.
 */
export function useSpreads(pageCount: number, wide: Record<number, boolean>, enabled: boolean, contentPages?: number): Spread[] {
  return useMemo(() => {
    if (contentPages !== undefined) return bookSpreads(contentPages, pageCount, wide, enabled)
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
  }, [pageCount, wide, enabled, contentPages])
}

/** The spread containing a page, and the first page of a spread. */
export function spreadIndexOf(spreads: Spread[], page: number): number {
  const at = spreads.findIndex((s) => s.includes(page))
  return at < 0 ? 0 : at
}
