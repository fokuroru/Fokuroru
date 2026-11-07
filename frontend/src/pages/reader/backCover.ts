import { useEffect, useState } from 'react'
import { coverPalette } from '../../components/library/shelf3d/coverPalette'
import { drawBoardArt, IMPRINTS, SPINE_STYLES, type SpineStyle } from '../../components/library/shelf3d/spineStyles'
import { heldPageUrl } from './pageBlobs'
import { paperTone, toneColour } from './pageCurl'

/**
 * Blank inside-cover faces and the back cover. Their positions follow the book's actual spreads,
 * including wide pages. The cover is the 3D shelf's back board for the series, the
 * same edition design tinted with the series cover's strongest colour, so the book on the shelf and
 * the book in the reader are the same object.
 */

// The shelf draws a book about this tall; the pattern is scaled up from there so it reads the same.
const SHELF_BOOK_HEIGHT = 200
const PAGE_HEIGHT = 1400
const BLANK_PAPER = '#f7f4ec'

/** How many pages come after the chapter's own: the blanks, then the back cover. */
export function bookEndPages(pageCount: number): number {
  return pageCount > 0 ? 3 : 0
}

/** The shelf edition a series is printed in. Fixed per series, so its back cover never changes. */
function editionOf(seriesId: number): number {
  return Math.abs(seriesId) % SPINE_STYLES.length
}

async function tintOf(coverUrl: string | null): Promise<Partial<SpineStyle> | null> {
  if (!coverUrl) return null
  const image = new Image()
  const loaded = new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
  })
  image.src = coverUrl
  if (!(await loaded) || !image.naturalWidth) return null
  const canvas = document.createElement('canvas')
  canvas.width = 48
  canvas.height = Math.max(1, Math.round((48 * image.naturalHeight) / image.naturalWidth))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return coverPalette(context.getImageData(0, 0, canvas.width, canvas.height).data)
  } catch {
    return null
  }
}

function toUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), 'image/png'))
}

/** A page's paper colour, for the blank beside it; the stock blank colour if it cannot be read. */
async function paperOf(url: string | undefined): Promise<string> {
  if (!url) return BLANK_PAPER
  const image = new Image()
  const loaded = new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
  })
  image.src = heldPageUrl(url) ?? url
  return (await loaded) && image.naturalWidth ? toneColour(paperTone(image)) : BLANK_PAPER
}

async function drawBookEnd(seriesId: number, coverUrl: string | null, aspect: number, count: number, papers: string[]): Promise<string[]> {
  const width = Math.round(PAGE_HEIGHT * aspect)
  const pages: string[] = []
  // Each blank is its own image: the reader keys pages by their address.
  for (let i = 0; i < count - 1; i++) {
    const blank = document.createElement('canvas')
    blank.width = width
    blank.height = PAGE_HEIGHT
    const context = blank.getContext('2d')
    if (!context) return []
    context.fillStyle = papers[i] ?? BLANK_PAPER
    context.fillRect(0, 0, width, PAGE_HEIGHT)
    const url = await toUrl(blank)
    if (!url) return []
    pages.push(url)
  }

  const style = editionOf(seriesId)
  const base = SPINE_STYLES[style]!
  const tint = await tintOf(coverUrl)
  const look = tint ? { ...base, ...tint } : base
  const cover = document.createElement('canvas')
  cover.width = width
  cover.height = PAGE_HEIGHT
  const context = cover.getContext('2d')
  if (!context) return []
  const scale = PAGE_HEIGHT / SHELF_BOOK_HEIGHT
  context.scale(scale, scale)
  const w = width / scale
  const h = SHELF_BOOK_HEIGHT
  drawBoardArt(context, w, h, style, look)
  // The edition's imprint, small at the foot, where a publisher's mark sits on a back cover.
  await document.fonts.load("16px 'Gelasio'").catch(() => [])
  context.fillStyle = look.fg
  context.font = "16px 'Gelasio', Georgia, serif"
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(IMPRINTS[style % IMPRINTS.length]!, w / 2, h - 16)
  const back = await toUrl(cover)
  if (!back) return []
  pages.push(back)
  return pages
}

/**
 * The pages after a chapter's own, as image addresses: blanks, then the back cover. Empty until they
 * are drawn, and while `enabled` is off. Drawn once a page's shape is known, at that shape.
 */
export function useBookEnd(
  enabled: boolean,
  seriesId: number | undefined,
  coverUrl: string | null | undefined,
  pageCount: number,
  aspect: number | null,
  /** The chapter's own pages: each blank takes the paper of the page it faces. */
  pageUrls: string[],
): string[] {
  const [pages, setPages] = useState<{ key: string; urls: string[] } | null>(null)
  // Drawn at the first shape measured, then kept: a new set of addresses re-opens the chapter's pages.
  const [shape, setShape] = useState<{ key: string; aspect: number } | null>(null)
  const key = `${seriesId}|${pageCount}`
  if (aspect !== null && shape?.key !== key) setShape({ key, aspect })
  const count = bookEndPages(pageCount)
  const drawAt = shape?.key === key ? shape.aspect : null
  const firstPage = pageUrls[Math.min(1, pageCount - 1)]
  const lastPage = pageUrls[pageCount - 1]

  useEffect(() => {
    if (!enabled || seriesId === undefined || drawAt === null || count === 0) return
    let cancelled = false
    // The front blank faces the first page after the cover, the back one the last page.
    void Promise.all([paperOf(firstPage), paperOf(lastPage)])
      .then((papers) => drawBookEnd(seriesId, coverUrl ?? null, drawAt, count, papers))
      .then((urls) => {
        if (cancelled) urls.forEach((url) => URL.revokeObjectURL(url))
        else setPages({ key, urls })
      })
    return () => {
      cancelled = true
    }
  }, [enabled, seriesId, coverUrl, drawAt, count, key, firstPage, lastPage])
  // A set of pages is let go once another replaces it, or the reader closes; never while it shows.
  useEffect(() => {
    const urls = pages?.urls ?? []
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [pages])

  return enabled && pages?.key === key ? pages.urls : NONE
}

const NONE: string[] = []
