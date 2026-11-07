/** A rectangle of a page, in fractions of its natural size. */
export interface Region {
  x: number
  y: number
  w: number
  h: number
}

export const FULL_REGION: Region = { x: 0, y: 0, w: 1, h: 1 }

export type PagePart = 'whole' | 'left' | 'right'

// Long edge of the copy the margins are measured on. Downscaling averages away JPEG noise and
// screentone specks, and keeps the scan to a few thousand pixels.
const SAMPLE_EDGE = 160
const WHITE_AT = 228
const BLACK_AT = 28
// A row or column is margin when this share of it is the border colour.
const BLANK_SHARE = 0.985
// Cropping more than this off an axis means a mostly empty page (a title card, a blank), where
// zooming the remaining speck up to full size would be worse than leaving it alone.
const MAX_CROP_SHARE = 0.45
const MIN_CROP_SHARE = 0.01
const CACHE_LIMIT = 500

const crops = new Map<string, Region | null>()
let canvas: HTMLCanvasElement | null = null

/**
 * The page minus its uniform white or black margins, or null when there is nothing worth trimming.
 * Measured on a small canvas copy of the loaded image, so it costs one downscaled draw per page
 * and is cached by URL. Pages are same-origin (and served from the offline cache under the same
 * URL), so the canvas is never tainted; if it is anyway, the page is shown untrimmed.
 */
export function cropRegion(image: HTMLImageElement): Region | null {
  const key = image.currentSrc || image.src
  const known = crops.get(key)
  if (known !== undefined) return known
  const region = measureMargins(image)
  if (crops.size >= CACHE_LIMIT) crops.delete(crops.keys().next().value as string)
  crops.set(key, region)
  return region
}

function sample(image: HTMLImageElement): { data: Uint8ClampedArray; cw: number; ch: number } | null {
  const { naturalWidth: width, naturalHeight: height } = image
  if (!width || !height) return null
  const scale = Math.min(1, SAMPLE_EDGE / Math.max(width, height))
  const cw = Math.max(1, Math.round(width * scale))
  const ch = Math.max(1, Math.round(height * scale))

  canvas ??= document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  try {
    context.drawImage(image, 0, 0, cw, ch)
    return { data: context.getImageData(0, 0, cw, ch).data, cw, ch }
  } catch {
    return null
  }
}

// The edge counts as one paper colour when this share of its samples sit this close to the mean.
const PAPER_SHARE = 0.8
const PAPER_SPREAD = 24
const papers = new Map<string, string | null>()

/**
 * The colour of the paper at the page's outer edge, as `rgb()`, or null when the edge is not one
 * colour (art that bleeds off the page). Fills the space around a page that does not fill the screen.
 */
export function paperColour(image: HTMLImageElement): string | null {
  const key = image.currentSrc || image.src
  const known = papers.get(key)
  if (known !== undefined) return known
  const colour = measurePaper(image)
  if (papers.size >= CACHE_LIMIT) papers.delete(papers.keys().next().value as string)
  papers.set(key, colour)
  return colour
}

function measurePaper(image: HTMLImageElement): string | null {
  const sampled = sample(image)
  if (!sampled) return null
  const { data, cw, ch } = sampled
  const edge: number[] = []
  for (let x = 0; x < cw; x++) edge.push(x, (ch - 1) * cw + x)
  for (let y = 1; y < ch - 1; y++) edge.push(y * cw, y * cw + cw - 1)
  const mean = [0, 1, 2].map((c) => edge.reduce((sum, i) => sum + data[i * 4 + c], 0) / edge.length)
  const close = edge.filter((i) => [0, 1, 2].every((c) => Math.abs(data[i * 4 + c] - mean[c]) <= PAPER_SPREAD))
  if (close.length < edge.length * PAPER_SHARE) return null
  const [r, g, b] = [0, 1, 2].map((c) => Math.round(close.reduce((sum, i) => sum + data[i * 4 + c], 0) / close.length))
  return `rgb(${r}, ${g}, ${b})`
}

function measureMargins(image: HTMLImageElement): Region | null {
  const sampled = sample(image)
  if (!sampled) return null
  const { data, cw, ch } = sampled

  const luma = new Uint8Array(cw * ch)
  for (let i = 0; i < luma.length; i++) {
    luma[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000
  }

  // The border colour is whichever of white and black owns most of the outer edge.
  let white = 0
  let black = 0
  let edge = 0
  const tally = (value: number) => {
    edge++
    if (value >= WHITE_AT) white++
    else if (value <= BLACK_AT) black++
  }
  for (let x = 0; x < cw; x++) {
    tally(luma[x])
    tally(luma[(ch - 1) * cw + x])
  }
  for (let y = 0; y < ch; y++) {
    tally(luma[y * cw])
    tally(luma[y * cw + cw - 1])
  }
  const isWhite = white >= black
  if ((isWhite ? white : black) < edge / 2) return null
  const blank = isWhite ? (value: number) => value >= WHITE_AT : (value: number) => value <= BLACK_AT

  const rowBlank = (y: number, from: number, to: number) => {
    let hits = 0
    for (let x = from; x <= to; x++) if (blank(luma[y * cw + x])) hits++
    return hits >= (to - from + 1) * BLANK_SHARE
  }
  const columnBlank = (x: number, from: number, to: number) => {
    let hits = 0
    for (let y = from; y <= to; y++) if (blank(luma[y * cw + x])) hits++
    return hits >= (to - from + 1) * BLANK_SHARE
  }

  let top = 0
  while (top < ch && rowBlank(top, 0, cw - 1)) top++
  if (top === ch) return null
  let bottom = ch - 1
  while (bottom > top && rowBlank(bottom, 0, cw - 1)) bottom--
  let left = 0
  while (left < cw && columnBlank(left, top, bottom)) left++
  let right = cw - 1
  while (right > left && columnBlank(right, top, bottom)) right--

  // One sample back towards the margin on each side, so a soft edge of the art is never shaved.
  top = Math.max(0, top - 1)
  left = Math.max(0, left - 1)
  bottom = Math.min(ch - 1, bottom + 1)
  right = Math.min(cw - 1, right + 1)

  const region = { x: left / cw, y: top / ch, w: (right - left + 1) / cw, h: (bottom - top + 1) / ch }
  if (1 - region.w > MAX_CROP_SHARE || 1 - region.h > MAX_CROP_SHARE) return null
  if (1 - region.w < MIN_CROP_SHARE && 1 - region.h < MIN_CROP_SHARE) return null
  return region
}

/** The crop, narrowed to one half of a wide page. The halves meet at the page's own centre, the spine. */
export function partOf(crop: Region | null, part: PagePart): Region {
  const base = crop ?? FULL_REGION
  if (part === 'whole') return base
  const end = base.x + base.w
  return part === 'left'
    ? { ...base, w: Math.max(0.01, 0.5 - base.x) }
    : { ...base, x: 0.5, w: Math.max(0.01, end - 0.5) }
}

export function isFull(region: Region): boolean {
  return region.x === 0 && region.y === 0 && region.w === 1 && region.h === 1
}

// Height over width at which a page counts as a webtoon slice. Print pages sit near 1.4 to 1.6.
const TALL_RATIO = 2
const PROBE_PAGES = 4
// Dimensions arrive with the image header, well before the pixels, so this waits for that and no
// longer. Past the deadline the guess is made from whatever reported in.
const PROBE_POLL_MS = 40
const PROBE_DEADLINE_MS = 2500

const guesses = new Map<string, boolean>()

/**
 * Whether a chapter looks like a webtoon: most of a few sampled pages are very tall. Reads only the
 * image headers of pages the reader is about to load anyway, starting at `from`.
 */
export function probeWebtoon(urls: string[], from: number, signal: AbortSignal): Promise<boolean> {
  const start = Math.max(0, Math.min(from, urls.length - PROBE_PAGES))
  const sample = urls.slice(start, start + PROBE_PAGES)
  const key = sample.join('|')
  const known = guesses.get(key)
  if (known !== undefined) return Promise.resolve(known)
  if (sample.length === 0) return Promise.resolve(false)

  return new Promise((resolve) => {
    const images = sample.map((src) => {
      const image = new Image()
      image.src = src
      return image
    })
    const startedAt = Date.now()
    const finish = (verdict: boolean, remember: boolean) => {
      clearInterval(timer)
      signal.removeEventListener('abort', abort)
      if (remember) guesses.set(key, verdict)
      resolve(verdict)
    }
    const check = () => {
      const sized = images.filter((image) => image.naturalWidth > 0)
      const settled = images.every((image) => image.naturalWidth > 0 || image.complete)
      const late = Date.now() - startedAt >= PROBE_DEADLINE_MS
      if (!settled && !late) return
      const tall = sized.filter((image) => image.naturalHeight / image.naturalWidth >= TALL_RATIO).length
      finish(sized.length > 0 && tall * 2 > sized.length, settled)
    }
    const abort = () => finish(false, false)
    signal.addEventListener('abort', abort)
    const timer = setInterval(check, PROBE_POLL_MS)
    check()
  })
}
