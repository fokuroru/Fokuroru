import type { Face, FacePart, Opening } from './pageCurl'
import type { Spread } from './useSpreads'

const BLANK = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="600" height="850"%3E%3Cpath fill="%23f7f4ec" d="M0 0h600v850H0z"/%3E%3C/svg%3E'

/** Real page indexes never move: the two blank resources and back cover follow the archive. */
export function bookSpreads(contentPages: number, totalPages: number, wide: Readonly<Record<number, boolean>>, double: boolean): Spread[] {
  if (contentPages === 0) return []
  const bound = totalPages === contentPages + 3
  const spreads: Spread[] = [[0]]
  let i = 1
  if (bound && contentPages > 1 && wide[1]) spreads.push([contentPages])
  if (i < contentPages && !wide[i]) spreads.push([i++])
  while (i < contentPages) {
    if (double && !wide[i] && i + 1 < contentPages && !wide[i + 1]) spreads.push([i++, i++])
    else spreads.push([i++])
  }
  if (bound) {
    const last = spreads[spreads.length - 1]!
    const insideBack = contentPages + 1
    if (double && last.length === 1 && last[0]! > 1 && last[0]! < contentPages && !wide[last[0]!]) last.push(insideBack)
    else spreads.push([insideBack])
    spreads.push([contentPages + 2])
  }
  return spreads
}

/** A synthetic opening blank is still the start of the chapter, never completed content. */
export function contentPage(page: number, contentPages: number): number {
  return page === contentPages ? 0 : Math.max(0, Math.min(page, contentPages - 1))
}

export function bookFaces(urls: string[], wide: Readonly<Record<number, boolean>>, mirror: boolean, double: boolean, contentPages: number) {
  const bound = urls.length === contentPages + 3
  const backCover = bound ? contentPages + 2 : -1
  const insideBack = bound ? contentPages + 1 : -1
  const near: FacePart = mirror ? 'right' : 'left'
  const far: FacePart = mirror ? 'left' : 'right'
  const faceOf = (page: number, part: FacePart = 'whole'): Face | null =>
    urls[page] ? { page, src: urls[page]!, part, mirrored: false, cover: page === 0 || page === backCover || page === insideBack } : null
  const blank = (cover: boolean): Face => ({ page: -1, src: bound ? urls[contentPages]! : BLANK, part: 'whole', mirrored: false, cover })
  const backOf = (face: Face): Face | null => {
    if (face.page === 0) return blank(true)
    if (face.page === insideBack) return faceOf(backCover)
    if (bound && face.page === contentPages - 1) return blank(false)
    const next = face.page === contentPages ? 1 : face.page + 1
    if (wide[next]) return faceOf(next, near)
    return { ...face, mirrored: !face.mirrored }
  }
  const opening = (pages: Spread): Opening => {
    const first = pages[0]!
    if (first === 0) return { left: null, right: faceOf(0) }
    if (first === backCover) return { left: faceOf(first), right: null }
    if (pages.length === 2) return { left: faceOf(first), right: faceOf(pages[1]!) }
    if (first < contentPages && wide[first]) return { left: faceOf(first, near), right: faceOf(first, far) }
    if (first === 1 || first === contentPages || first === insideBack) {
      return { left: blank(first !== insideBack || contentPages === 1), right: faceOf(first) }
    }
    if (double) return { left: faceOf(first), right: blank(false) }
    const before = faceOf(first - 1, wide[first - 1] ? far : 'whole')
    return { left: before && backOf(before), right: faceOf(first) }
  }
  return { faceOf, backOf, opening, backCover }
}
