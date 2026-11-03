import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Stack, Text } from '@mantine/core'
import { Trans, useLingui } from '@lingui/react/macro'
import { cropRegion, FULL_REGION, isFull, partOf, type PagePart, type Region } from './pageShape'
import EnhancedPage from './EnhancedPage'
import { heldPageUrl, holdPage } from './pageBlobs'
import { isSoftPage } from '../../lib/enhance/softness'
import { drawPageMark, GUTTER_REACH, GUTTER_SHARE, gutterGradient, PageCurl, pageMark, toneColour, type SheetFill, paperTone, pageWear, type BookGeometry } from './pageCurl'
import { bookFaces } from './bookLayout'
import { useCompareKey } from './compareHold'
import {
  EnhanceScope,
  enhanceKey,
  presetFor,
  regionBitmap,
  useEnhanceEngine,
  type PageEnhance,
} from './enhanceRuntime'
import { useWarmServerPages, type ServerEnhance } from './useServerEnhance'
import type {
  EnhanceFallback,
  EnhanceMethod,
  ReaderDirection,
  ReaderEnhance,
  ReaderEvenPages,
  ReaderFit,
  ReaderPageAlign,
  ReaderSplitWide,
} from './prefs'
import { pageSizeStyle } from './prefs'
import type { Spread } from './useSpreads'

const FIT_CLASS: Record<ReaderFit, string> = {
  width: 'reader-fit-width',
  height: 'reader-fit-height',
  screen: 'reader-fit-screen',
  original: 'reader-fit-original',
}

type PageState = 'loading' | 'ready' | 'failed'

/** How a page is shown beyond its fit: trimmed, one half of a spread, or turned a quarter. */
export interface PageShaping {
  crop: boolean
  part: PagePart
  rotate: 0 | 90 | -90
}

const PLAIN: PageShaping = { crop: false, part: 'whole', rotate: 0 }

// The incoming spread loads here while the current one stays up. Fixed, so it adds nothing to the
// scroller's overflow.
const STANDBY: React.CSSProperties = { position: 'fixed', inset: 0, visibility: 'hidden', pointerEvents: 'none' }

/** Paper page turns: a drawn turn that follows the pointer, a blank facing page, pages of one size. */
export interface PaperOptions {
  contentPages: number
  spreads: Spread[]
  align: ReaderPageAlign
  even: ReaderEvenPages
  /** Width over height of the tallest page measured in the chapter so far. */
  sheetAspect: number | null
  next: Spread | null
  previous: Spread | null
  /** Pages measured wider than tall: a two-page spread, which covers both sides of the book. */
  wide: Readonly<Record<number, boolean>>
  /** Two pages up: the book lies open on both sides of a spine in the middle. */
  double: boolean
  /** A drag finished a turn: move the reader on, the drawing already shows the result. */
  onTurn: (forward: boolean) => void
}

/** The shape every page is drawn at when sizes are evened out. */
interface Sheet {
  aspect: number
  fill: SheetFill
}

const OBJECT_FIT: Record<SheetFill, React.CSSProperties['objectFit']> = { stretch: 'fill', enlarge: 'cover', pad: 'contain' }

// Each page's paper colour by address, read once.
const PAPER = new Map<string, string>()
function paperColour(src: string, image: HTMLImageElement): string {
  let colour = PAPER.get(src)
  if (!colour) {
    colour = toneColour(paperTone(image))
    if (PAPER.size > 400) PAPER.clear()
    PAPER.set(src, colour)
  }
  return colour
}

const NO_WIDE: Readonly<Record<number, boolean>> = {}

// How long a wide page takes to grow to the book's size before a turn, and to shrink after one.
const BOOK_ZOOM_MS = 300

// The pages on screen, by box. Not by visibility: the incoming page waits hidden in a fixed box, and
// while a turn is drawn every real page is hidden underneath it.
const onScreen = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>('.reader-page:not(.reader-blank)')].filter(
    (element) => element.offsetWidth > 0 && getComputedStyle(element).position !== 'fixed',
  )

interface Box {
  left: number
  top: number
  width: number
  height: number
}

// Past this the turn shows the incoming page's loading state rather than holding the old page.
const HOLD_MS = 500

/**
 * A region of a page drawn at the size the fit would give that region alone. The blank canvas
 * carries the region's pixel size and takes the fit classes, so it sizes exactly like an `<img>`
 * of the cropped page would (1:1 included); the real image sits inside, scaled and offset so only
 * the region shows. A canvas rather than a sized image: it has its size the moment it mounts, so a
 * page turn never flashes an empty box, and with no context drawn it holds no pixel buffer.
 * An enhanced page takes this path even when it is whole, and draws the engine's output over the frame.
 */
function RegionPage({
  src,
  url,
  alt,
  className,
  style,
  tone,
  fit,
  image,
  region,
  rotate,
  enhance,
  page,
  server,
  standby,
}: {
  src: string
  url: string
  alt: string
  className: string
  style: React.CSSProperties | undefined
  tone: string | undefined
  fit: ReaderFit
  image: HTMLImageElement
  region: Region
  rotate: 0 | 90 | -90
  enhance: PageEnhance | null
  page: number
  server: ServerEnhance | null
  standby: boolean
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [covered, setCovered] = useState(false)
  const width = Math.max(1, Math.round(image.naturalWidth * region.w))
  const height = Math.max(1, Math.round(image.naturalHeight * region.h))
  const turned = rotate !== 0
  const frame: React.CSSProperties = turned
    ? {
        left: '50%',
        top: '50%',
        width: `${(100 * width) / height}%`,
        height: `${(100 * height) / width}%`,
        transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
      }
    : { inset: 0 }
  return (
    <div ref={setBox} className="reader-region" data-fit={fit} style={standby ? STANDBY : undefined}>
      <canvas
        className={className}
        data-page={page}
        width={turned ? height : width}
        height={turned ? width : height}
        style={style}
        aria-hidden
      />
      <div className="reader-region-frame" style={frame}>
        <img
          src={url}
          alt={alt}
          className="reader-region-image"
          data-no-cover-fallback
          style={{
            left: `${(-region.x / region.w) * 100}%`,
            top: `${(-region.y / region.h) * 100}%`,
            width: `${100 / region.w}%`,
            height: `${100 / region.h}%`,
            filter: tone,
            visibility: enhance && covered ? 'hidden' : undefined,
          }}
          decoding="sync"
          draggable={false}
        />
        {enhance && (
          <EnhancedPage
            image={image}
            src={src}
            region={region}
            rotate={rotate}
            alt={alt}
            tone={tone}
            enhance={enhance}
            page={page}
            server={server}
            priority={0}
            box={box}
            onShowing={setCovered}
          />
        )}
      </div>
    </div>
  )
}

/** A leaf's mark drawn over the page on screen, the same one the drawn turn paints into its texture. */
function PageMarkOverlay({ page, book, box, tone }: { page: number; book: string; box: Box; tone: string | undefined }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const canvas = ref.current
    const draw = canvas?.getContext('2d')
    if (!canvas || !draw) return
    const ratio = Math.min(window.devicePixelRatio || 1, 3)
    canvas.width = Math.max(1, Math.round(box.width * ratio))
    canvas.height = Math.max(1, Math.round(box.height * ratio))
    drawPageMark(draw, canvas.width, canvas.height, page, book)
  }, [page, book, box.width, box.height])
  return (
    <canvas
      ref={ref}
      className="reader-page-mark"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height, filter: tone }}
      aria-hidden
    />
  )
}

/**
 * One page with its own loading and failure state: the page's outline while it loads, and a retry
 * where a failed one would otherwise show the browser's broken-image icon. The image stays mounted
 * (hidden until it is ready) so a retry just re-requests it with a cache-busting suffix.
 * In standby the page loads and decodes out of sight, and `onReady` says when it can be swapped in
 * without a blank frame. It is the same element afterwards, so nothing reloads at the swap.
 */
function PagedPage({
  src,
  alt,
  className,
  style,
  tone,
  fit,
  shaping,
  enhance,
  page,
  server,
  onLoaded,
  standby,
  onReady,
  sheet,
}: {
  src: string
  alt: string
  className: string
  style: React.CSSProperties | undefined
  tone: string | undefined
  fit: ReaderFit
  shaping: PageShaping
  enhance: PageEnhance | null
  page: number
  server: ServerEnhance | null
  onLoaded: (image: HTMLImageElement) => void
  standby: boolean
  onReady: (src: string) => void
  sheet: Sheet | null
}) {
  const [state, setState] = useState<PageState>('loading')
  const [attempt, setAttempt] = useState(0)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  // Chosen once: switching a mounted image to the held copy later would load it a second time.
  const [held] = useState(() => heldPageUrl(src))
  const url = attempt === 0 ? (held ?? src) : `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}`

  const loaded = useRef(onLoaded)
  loaded.current = onLoaded
  const reportReady = useRef(onReady)
  reportReady.current = onReady
  const markReady = useCallback(
    (element: HTMLImageElement) => {
      setState('ready')
      setImage(element)
      loaded.current(element)
      void element
        .decode()
        .catch(() => {})
        .then(() => reportReady.current(src))
    },
    [src],
  )
  // A page already in the browser cache is complete before React attaches its load listener.
  const setRef = useCallback(
    (element: HTMLImageElement | null) => {
      if (element?.complete && element.naturalWidth > 0) markReady(element)
    },
    [markReady],
  )

  const ready = state === 'ready' && image !== null
  const natural = ready ? { width: image.naturalWidth, height: image.naturalHeight } : null
  const wide = natural !== null && natural.width > natural.height
  const crop = useMemo(() => (ready && shaping.crop ? cropRegion(image) : null), [ready, image, shaping.crop])
  const region = partOf(crop, wide ? shaping.part : 'whole')
  const rotate = wide ? shaping.rotate : 0
  const shaped = natural !== null && (enhance !== null || rotate !== 0 || !isFull(region))

  const visible = state === 'ready' && !shaped
  // A short page takes the chapter's tallest shape; a two-page spread takes the shape of two. Padded,
  // it keeps its own shape and the spare edges are its own paper, as the drawn turn pads it.
  // Read once a page is up and kept, so the page facing it later has its paper colour at once.
  const paper = useMemo(() => (ready ? paperColour(src, image) : undefined), [ready, image, src])
  const padPaper = sheet?.fill === 'pad' ? paper : undefined
  const evened: React.CSSProperties | undefined =
    sheet && natural
      ? { aspectRatio: String(wide ? sheet.aspect * 2 : sheet.aspect), objectFit: OBJECT_FIT[sheet.fill], backgroundColor: padPaper }
      : undefined
  return (
    <>
      {state === 'loading' && !standby && <div className="reader-page-skeleton" aria-hidden />}
      {state === 'failed' && !standby && (
        <Stack align="center" gap="xs" onClick={(event) => event.stopPropagation()}>
          <Text c="var(--ink-3)" size="sm">
            <Trans>This page failed to load.</Trans>
          </Text>
          <Button
            variant="light"
            size="xs"
            onClick={() => {
              setState('loading')
              setImage(null)
              setAttempt((n) => n + 1)
            }}
          >
            <Trans>Try again</Trans>
          </Button>
        </Stack>
      )}
      <img
        ref={setRef}
        src={url}
        data-no-cover-fallback
        data-page={page}
        alt={alt}
        className={className}
        style={{ ...style, ...evened, filter: tone, ...(!visible ? { display: 'none' } : standby ? STANDBY : undefined) }}
        decoding="sync"
        draggable={false}
        onLoad={(event) => markReady(event.currentTarget)}
        onError={() => {
          setState('failed')
          reportReady.current(src)
        }}
      />
      {shaped && image && (
        <RegionPage
          src={src}
          url={url}
          alt={alt}
          className={className}
          style={style}
          tone={tone}
          fit={fit}
          image={image}
          region={region}
          rotate={rotate}
          enhance={enhance}
          page={page}
          server={server}
          standby={standby}
        />
      )}
    </>
  )
}

/**
 * One spread at a time: a single page, or two side by side in double mode.
 * Page turns are instant because neighbours are already preloaded.
 */
export default function PagedView({
  urls,
  spread,
  fit,
  direction,
  zoom,
  scale,
  tone,
  label,
  onMeasure,
  cropBorders = false,
  splitWide = 'off',
  half = 0,
  enhance = 'off',
  enhanceMethod = 'a4k-m',
  enhanceFallback = 'a4k-m',
  server = null,
  preload,
  onStretched,
  paper = null,
}: {
  urls: string[]
  spread: Spread
  fit: ReaderFit
  direction: ReaderDirection
  zoom: number
  /** Zoom in percent on top of the fit, see pageSizeStyle. */
  scale: number
  /** CSS filter for the page images (dim and colour), from `toneFilter`. */
  tone?: string
  label: string
  onMeasure: (index: number, image: HTMLImageElement) => void
  cropBorders?: boolean
  /** What a wide page does when it is shown alone; the parent passes 'off' outside single-page mode. */
  splitWide?: ReaderSplitWide
  /** Which half of a split wide page is up, in reading order. */
  half?: 0 | 1
  enhance?: ReaderEnhance
  enhanceMethod?: EnhanceMethod
  /** What a server method shows until its page is ready there. */
  enhanceFallback?: EnhanceFallback
  /** Set while a server method is in use and the server tier can serve it. */
  server?: ServerEnhance | null
  /** The reader's preload window: the spread on screen and the pages after it, in reading order. */
  preload?: number[]
  /** The pages `auto` enhances: shown at 1.2x their size or more (measured on screen or matched to a measured size), or soft. */
  onStretched?: (pages: ReadonlySet<number>) => void
  /** Paper page turns; the preview reader leaves them off. */
  paper?: PaperOptions | null
}) {
  const { t } = useLingui()
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [curl, setCurl] = useState<PageCurl | null>(null)
  // Set while a drawn turn loads its pages: the real swap waits so it never shows first.
  const [curlBusy, setCurlBusy] = useState(false)
  const paperRef = useRef(paper)
  paperRef.current = paper
  const idleRef = useRef(() => {})
  const hasPaper = paper !== null
  useEffect(() => {
    if (!hasPaper || !canvas.current || !root.current) return
    const created = new PageCurl(
      canvas.current,
      root.current,
      (forward) => paperRef.current?.onTurn(forward),
      setCurlBusy,
      () => idleRef.current(),
    )
    setCurl(created)
    return () => {
      created.dispose()
      setCurl(null)
      setCurlBusy(false)
    }
  }, [hasPaper])

  // A turn keeps the current spread on screen until every page of the next one has loaded and
  // decoded, then swaps them in one frame. Mounting the next page straight away showed a blank
  // frame first even when it was preloaded (WebKit fires load late and decodes at draw time).
  const target = { urls, spread, key: spread.join(','), half }
  const rtl = direction === 'rtl'
  // The half read first is the right one in right-to-left. A quarter turn puts it at the top:
  // anticlockwise lifts the right edge, clockwise the left.
  const shapingFor = (pages: Spread, pageHalf: 0 | 1): PageShaping => {
    const single = pages.length === 1
    return !cropBorders && (!single || splitWide === 'off')
      ? PLAIN
      : {
          crop: cropBorders,
          part: single && splitWide === 'split' ? ((pageHalf === 0) === rtl ? 'right' : 'left') : 'whole',
          rotate: single && splitWide === 'rotate' ? (rtl ? -90 : 90) : 0,
        }
  }
  // In right-to-left reading the lower page number belongs on the right.
  const inReadingOrder = (pages: Spread) => (rtl ? [...pages].reverse() : pages)
  const [shown, setShown] = useState(target)
  const [readySrcs, setReadySrcs] = useState<ReadonlySet<string>>(() => new Set())
  const incoming = spread.map((page) => urls[page]).filter(Boolean)
  // A new chapter has nothing of its own to hold, and a new half is the same image.
  const holding = shown.urls === urls && shown.key !== target.key
  const current = shown.urls === urls && shown.key === target.key && shown.half === half
  const [expired, setExpired] = useState<string | null>(null)
  if (!current && (!holding || (!curlBusy && (expired === target.key || incoming.every((src) => readySrcs.has(src)))))) {
    setShown(target)
    setReadySrcs((ready) => new Set(incoming.filter((src) => ready.has(src))))
    setExpired(null)
  }
  useEffect(() => {
    if (!holding) return
    const timer = window.setTimeout(() => setExpired(target.key), HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [holding, target.key])
  const onReady = useCallback(
    (src: string) => setReadySrcs((ready) => (ready.has(src) ? ready : new Set(ready).add(src))),
    [],
  )

  // The scroller outlives the page, so a page read to its bottom would otherwise hand the next one
  // the same offset. A page wider than the viewport (zoomed, or 1:1) starts at the edge reading
  // begins from: the right in right-to-left. Its width is not known until the image has loaded, so
  // the right edge is held until the reader touches the scroller or the zoom changes.
  const shaping = shapingFor(spread, half)
  const enhanceOn = enhance !== 'off'
  const preset = presetFor(enhanceMethod, enhanceFallback)
  const engineState = useEnhanceEngine(enhanceOn && preset !== null)
  const engine = engineState.status === 'ready' ? engineState.engine : null
  useCompareKey(enhanceOn)
  // Bumped when a page on screen reports the size it is shown at, which is what the pages ahead are
  // enhanced at.
  const [sized, setSized] = useState(0)
  const stretchedRef = useRef(onStretched)
  stretchedRef.current = onStretched
  const [scope] = useState(
    () =>
      new EnhanceScope(
        () => setSized((n) => n + 1),
        (pages) => stretchedRef.current?.(pages),
      ),
  )
  useEffect(() => {
    scope.attach(engine)
    return () => scope.release()
  }, [scope, engine, urls])
  useEffect(() => () => scope.forgetPages(), [scope, urls])
  const layout = `${fit}|${zoom}|${scale}`
  const serverOn = server !== null
  const pageEnhance = useMemo<PageEnhance | null>(
    () =>
      (engine || serverOn) && enhance !== 'off'
        ? { mode: enhance, preset, engine, scope, layout }
        : null,
    [engine, serverOn, enhance, preset, scope, layout],
  )

  // Pages that leave the window around the spread are evicted from the engine's cache. The two
  // before it stay, so turning back is instant.
  const lead = Math.min(...spread)
  useEffect(() => {
    const keep = new Set<string>()
    for (const page of [...spread, ...(preload ?? []), lead - 1, lead - 2]) {
      if (urls[page]) keep.add(urls[page])
    }
    scope.retain(keep)
  }, [scope, urls, spread, preload, lead])

  // The pages ahead are enhanced at the size a page of the same pixel size is shown at now, so a
  // turn finds them in the cache. Pages of another size wait until they are on screen.
  const { crop: shapeCrop, part: shapePart, rotate: shapeRotate } = shaping
  // Read when a page ahead is decoded, so a state change does not restart the preload.
  const serverRef = useRef(server)
  serverRef.current = server
  useEffect(() => {
    if (!pageEnhance || !preload?.length) return
    const { engine: live, scope: owner, preset, mode } = pageEnhance
    const controller = new AbortController()
    const { signal } = controller
    const shown = new Set(spread)
    const images: HTMLImageElement[] = []
    preload
      .filter((page) => !shown.has(page))
      .forEach((page, order) => {
        const src = urls[page]
        if (!src) return
        const image = new Image()
        images.push(image)
        void holdPage(src)
          .then((held) => {
            if (signal.aborted) return
            image.src = held ?? src
            return image.decode()
          })
          .then(async () => {
            if (signal.aborted || !image.complete) return
            if (image.naturalWidth > image.naturalHeight && (shapePart !== 'whole' || shapeRotate !== 0)) return
            const region = (shapeCrop ? cropRegion(image) : null) ?? FULL_REGION
            const target = owner.sizeFor(image.naturalWidth * region.w, image.naturalHeight * region.h)
            if (!target) return
            const wanted = target.stretched || (mode === 'auto' && isSoftPage(image, src))
            owner.notePage(page, wanted)
            if (!live || !preset || !wanted || serverRef.current?.states.get(page) === 'ready') return
            const key = enhanceKey(src, region)
            if (live.peek(key, preset, target.width, target.height)) return
            owner.note(src, key)
            const bitmap = await regionBitmap(image, region)
            if (signal.aborted) return bitmap.close()
            await live.enhance(bitmap, {
              preset,
              targetWidth: target.width,
              targetHeight: target.height,
              key,
              priority: order + 1,
              signal,
            })
          })
          .catch(() => {})
      })
    return () => {
      controller.abort()
      for (const image of images) image.src = ''
    }
  }, [pageEnhance, preload, spread, urls, shapeCrop, shapePart, shapeRotate, sized])

  const ahead = useMemo(() => (preload ?? []).filter((page) => !spread.includes(page)), [preload, spread])
  useWarmServerPages(pageEnhance ? server : null, ahead)

  const rtlRef = useRef(rtl)
  rtlRef.current = rtl
  const pinRight = useRef(false)
  const toStart = useCallback(() => {
    const scroller = root.current?.parentElement
    if (scroller) scroller.scrollLeft = rtlRef.current ? scroller.scrollWidth : 0
  }, [])
  const leadSrc = shown.urls[shown.spread[0]]
  useLayoutEffect(() => {
    const scroller = root.current?.parentElement
    if (scroller) scroller.scrollTop = 0
    pinRight.current = rtlRef.current
    toStart()
  }, [leadSrc, shown.half, toStart])

  useEffect(() => {
    const scroller = root.current?.parentElement
    const content = root.current
    if (!scroller || !content) return
    const release = () => {
      pinRight.current = false
    }
    const observer = new ResizeObserver(() => {
      if (pinRight.current) toStart()
    })
    observer.observe(content)
    const events = ['wheel', 'touchstart', 'pointerdown']
    for (const name of events) scroller.addEventListener(name, release, { passive: true })
    return () => {
      observer.disconnect()
      for (const name of events) scroller.removeEventListener(name, release)
    }
  }, [toStart])

  // Scrolling can only reach the right and bottom of a transformed box, so the zoom grows from the
  // top-left corner and the scroll position is moved to keep the viewport centre where it was.
  const lastZoom = useRef(zoom)
  useLayoutEffect(() => {
    const scroller = root.current?.parentElement
    const previous = lastZoom.current
    lastZoom.current = zoom
    if (!scroller || previous === zoom) return
    pinRight.current = false
    const centre = scroller.clientWidth / 2
    scroller.scrollLeft = (scroller.scrollLeft + centre) * (zoom / previous) - centre
  }, [zoom])

  // Paper turns. Drawn only for plain pages at 1x: a trimmed, split or turned page would look
  // different in the drawing than on screen, and 1:1 or zoomed pages pan sideways, which a book cannot.
  const lone = shown.spread.length === 1
  const plainPages = !cropBorders && splitWide === 'off'
  const curlOn = paper !== null && zoom === 1 && plainPages && fit !== 'original' && scale === 100
  const align = paper?.align ?? 'center'
  const double = paper?.double ?? false
  const wideMap = paper?.wide ?? NO_WIDE
  // The book is drawn in left-to-right space and mirrored for right-to-left, and in one-page view
  // for a page pushed to the left, whose facing page is on its right.
  const mirror = double ? rtl : align === 'left' ? true : align === 'right' ? false : rtl
  // "As is" keeps every page whole but still on one sheet size, padded, so the book never changes size.
  const sheet: Sheet | null =
    paper && paper.sheetAspect
      ? { aspect: paper.sheetAspect, fill: paper.even === 'off' ? 'pad' : paper.even === 'enlarge' ? 'enlarge' : 'stretch' }
      : null

  // The book: every spread lies open as a left and a right face. A two-page spread covers both, a
  // half each; the half drawn on the left in left-to-right space is the image's right half when mirrored.
  const { faceOf, backOf, opening, backCover } = bookFaces(urls, wideMap, mirror, double, paper?.contentPages ?? urls.length)
  const shownOpening = opening(shown.spread)
  const actualOnLeft = shownOpening.left?.page === shown.spread[0]
  const facingRight = double ? actualOnLeft !== mirror : mirror

  // Where the book sits: read off a page on screen, remembered for the moments when the only
  // thing up is a two-page spread at another size, or estimated before any page was seen.
  const pageBox = useRef<{ width: number; height: number; top: number } | null>(null)
  const shownWide = lone && !!wideMap[shown.spread[0]!]
  const geometry = (): BookGeometry | null => {
    const host = root.current
    const surface = host?.parentElement
    if (!host || !surface) return null
    const view = surface.getBoundingClientRect()
    const width = surface.clientWidth
    const height = surface.clientHeight
    const pages = shownWide
      ? []
      : onScreen(host)
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > rect.width)
          .sort((a, b) => a.left - b.left)
    // Two pages up only a spread measures a page: a page on its own (a cover) is drawn at the size
    // this gives, so measuring it would only measure itself.
    const measuring = double ? (pages.length === 2 ? pages : []) : pages
    const measured = measuring[measuring.length - 1]
    if (measured) pageBox.current = { width: measured.width, height: measured.height, top: measured.top }
    let box = pageBox.current
    if (!box) {
      const image = [...host.querySelectorAll<HTMLImageElement>('img.reader-page')].find(
        (element) => element.naturalWidth > 0 && element.naturalHeight > element.naturalWidth,
      )
      const aspect = sheet?.aspect ?? (image ? image.naturalWidth / image.naturalHeight : 0.7)
      const across = double ? width / 2 : width
      const w = fit === 'width' ? across : Math.min(across, height * aspect)
      const h = w / aspect
      box = { width: w, height: h, top: view.top + Math.max(0, (height - h) / 2) }
    }
    let spineX: number
    if (double) spineX = pages.length === 2 ? pages[0]!.right : view.left + width / 2
    else if (measured) spineX = facingRight ? measured.right : measured.left
    else {
      const x = align === 'left' ? view.left : align === 'right' ? view.left + width - box.width : view.left + (width - box.width) / 2
      spineX = facingRight ? x + box.width : x
    }
    return { spineX, top: box.top, pageWidth: box.width, pageHeight: box.height }
  }
  useEffect(() => {
    const forget = () => (pageBox.current = null)
    window.addEventListener('resize', forget)
    return () => window.removeEventListener('resize', forget)
  }, [])
  useEffect(() => {
    pageBox.current = null
  }, [fit, sheet?.aspect, sheet?.fill, double, align])

  // Two pages up, a page on its own is the size of a page in a spread, whatever its own image is.
  const [loneSize, setLoneSize] = useState<{ width: number; height: number } | null>(null)
  const sizeLone = curlOn && double && lone && !shownWide
  useLayoutEffect(() => {
    const book = sizeLone ? geometry() : null
    const next = book ? { width: book.pageWidth, height: book.pageHeight } : null
    setLoneSize((old) => (old && next && Math.abs(old.width - next.width) < 0.5 && Math.abs(old.height - next.height) < 0.5 ? old : next))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeLone, shown.key, fit, sheet?.aspect, sheet?.fill])

  // A two-page spread wider than the screen allows: after a turn lands on it the book shrinks to fit
  // the screen, and before the next turn it grows back to the book's size. The image keeps its
  // fitted layout and is scaled from there, so nothing reflows.
  const [bookView, setBookView] = useState(false)
  const bookViewRef = useRef(bookView)
  bookViewRef.current = bookView
  const shownWideRef = useRef(false)
  shownWideRef.current = curlOn && shownWide
  const animateBook = useRef(false)
  const wideElement = () => (root.current ? (onScreen(root.current)[0] ?? null) : null)
  const bookTransform = (): string | null => {
    const element = wideElement()
    const book = geometry()
    const origin = root.current?.getBoundingClientRect()
    if (!element || !book || !origin) return null
    const x = book.spineX - book.pageWidth - origin.left
    const y = book.top - origin.top
    const sx = (book.pageWidth * 2) / element.offsetWidth
    const sy = book.pageHeight / element.offsetHeight
    if (Math.abs(x - element.offsetLeft) < 2 && Math.abs(y - element.offsetTop) < 2 && Math.abs(sx - 1) < 0.01) return null
    return `translate(${x - element.offsetLeft}px, ${y - element.offsetTop}px) scale(${sx}, ${sy})`
  }
  // Arriving by a turn, the spread starts at the book's size under the drawing; otherwise fitted.
  useLayoutEffect(() => {
    animateBook.current = false
    setBookView(curlOn && shownWide && root.current?.dataset.curling !== undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.key])
  // Applied only when the target changes: this runs on every render, and rewriting the transition
  // on the render after a zoom began cancelled it, so the spread jumped instead of easing.
  const appliedBook = useRef<{ element: HTMLElement; transform: string } | null>(null)
  const easingTimer = useRef(0)
  useLayoutEffect(() => {
    const element = curlOn && shownWide ? wideElement() : null
    if (!element) {
      appliedBook.current = null
      return
    }
    const transform = bookView ? (bookTransform() ?? 'none') : 'none'
    const last = appliedBook.current
    if (last?.element === element && last.transform === transform) {
      animateBook.current = false
      return
    }
    const ease = animateBook.current && last?.element === element
    element.style.transformOrigin = '0 0'
    element.style.transition = ease ? `transform ${BOOK_ZOOM_MS}ms ease` : 'none'
    element.style.transform = transform
    appliedBook.current = { element, transform }
    animateBook.current = false
    // The book's shadow and fold slide with it (theme.css .reader-paged[data-easing]).
    const host = root.current
    if (ease && host) {
      host.dataset.easing = ''
      window.clearTimeout(easingTimer.current)
      easingTimer.current = window.setTimeout(() => delete host.dataset.easing, BOOK_ZOOM_MS)
    }
  })
  // Set from a zoom-in until the turn it was for is over, so the spread is not shrunk under it.
  const turning = useRef(false)
  const [idle, setIdle] = useState(0)
  idleRef.current = () => {
    turning.current = false
    setIdle((n) => n + 1)
  }
  useEffect(() => {
    if (!bookView || !shownWideRef.current || turning.current || root.current?.dataset.curling !== undefined) return
    animateBook.current = true
    setBookView(false)
  }, [bookView, idle, shown.key])
  const beforeTurn = () => {
    if (!shownWideRef.current || bookViewRef.current || bookTransform() === null) return Promise.resolve()
    turning.current = true
    animateBook.current = true
    setBookView(true)
    return new Promise<void>((resolve) => window.setTimeout(resolve, BOOK_ZOOM_MS))
  }

  useEffect(() => {
    curl?.update({
      urls,
      current: shown.spread,
      next: paper?.next ?? null,
      previous: paper?.previous ?? null,
      opening,
      backOf: double ? null : backOf,
      geometry,
      beforeTurn,
      mirror,
      sheetAspect: sheet?.aspect ?? null,
      sheetFill: sheet?.fill ?? 'stretch',
      enabled: curlOn,
      draggable: true,
    })
  })
  // A turn made by a tap, key or button plays the drawing; one a drag made is already drawn.
  const lastTarget = useRef(target)
  useEffect(() => {
    const before = lastTarget.current
    lastTarget.current = target
    if (!curl || before.urls !== urls || before.key === target.key) return
    const order = paper?.spreads
    const at = (pages: Spread) => order?.findIndex((item) => item.join(',') === pages.join(',')) ?? Math.min(...pages)
    curl.auto(before.spread, spread, at(spread) > at(before.spread))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curl, target.key, urls])
  useEffect(() => {
    curl?.settled(shown.key)
  }, [curl, shown.key])

  // One page up, the facing page beside a page on the spine side: the back of the sheet turned
  // before it. Placed from the page's own box, so every fit and size setting keeps working.
  const facing = curlOn && lone && !shownWide && shown.spread[0] !== backCover
    ? double && actualOnLeft ? shownOpening.right : shownOpening.left
    : null
  // Two pages up, a page on its own lies on its side of the spine, as the cover or the last page would.
  const loneOpening = curlOn && double && lone && !shownWide ? opening(shown.spread) : null
  const loneSide = loneOpening ? (actualOnLeft === mirror ? 'right' : 'left') : undefined
  const [blank, setBlank] = useState<Box | null>(null)
  const wantBlank = facing !== null
  useLayoutEffect(() => {
    const host = root.current
    if (!host || !wantBlank) {
      setBlank(null)
      return
    }
    const place = () => {
      const rect = onScreen(host)[0]?.getBoundingClientRect()
      const origin = host.getBoundingClientRect()
      const next =
        rect && rect.height > rect.width
          ? {
              left: (facingRight ? rect.right : rect.left - rect.width) - origin.left,
              top: rect.top - origin.top,
              width: rect.width,
              height: rect.height,
            }
          : null
      setBlank((old) =>
        old && next && old.left === next.left && old.top === next.top && old.width === next.width && old.height === next.height
          ? old
          : next,
      )
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(host)
    for (const element of host.querySelectorAll('.reader-page:not(.reader-blank)')) observer.observe(element)
    return () => observer.disconnect()
  }, [wantBlank, facingRight, shown.key, fit, scale, sheet?.aspect, sheet?.fill, align])

  // The facing page's paper: its print shows through faded into it, so the paper keeps its own tone.
  const [facingPaper, setFacingPaper] = useState<{ src: string; colour: string } | null>(null)
  // A blank or the inside of a cover takes the paper of the page beside it.
  const facingSrc = facing ? (facing.cover || facing.page < 0 ? (urls[shown.spread[0]!] ?? null) : facing.src) : null
  useEffect(() => {
    if (!facingSrc || PAPER.has(facingSrc)) return
    let live = true
    const image = new Image()
    image.onload = () => {
      if (!live) return
      setFacingPaper({ src: facingSrc, colour: paperColour(facingSrc, image) })
    }
    image.src = heldPageUrl(facingSrc) ?? facingSrc
    return () => {
      live = false
    }
  }, [facingSrc])
  // Never the stock blank colour while the right one loads: the faded page flashed on it.
  const facingColour = (facingSrc && PAPER.get(facingSrc)) ?? (facingPaper?.src === facingSrc ? facingPaper.colour : facingPaper?.colour)

  // The open book: a soft shadow under it and the fold at the spine.
  // The shadow stays while a turn is drawn over it; the fold is drawn into the turn instead.
  const [frame, setFrame] = useState<{ box: Box; spine: number; leftSide: boolean; rightSide: boolean } | null>(null)
  useLayoutEffect(() => {
    const host = root.current
    if (!host || !curlOn) {
      setFrame(null)
      return
    }
    const place = () => {
      const origin = host.getBoundingClientRect()
      let next: typeof frame = null
      if (shownWide && bookView) {
        // Scaled up to the book's size for a turn: the shadow and fold go where the book is.
        const book = geometry()
        if (book) {
          const spine = book.spineX - origin.left
          const box = { left: spine - book.pageWidth, top: book.top - origin.top, width: book.pageWidth * 2, height: book.pageHeight }
          next = { box, spine, leftSide: true, rightSide: true }
        }
      } else if (shownWide) {
        const element = wideElement()
        if (element) {
          const box = { left: element.offsetLeft, top: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight }
          next = { box, spine: box.left + box.width / 2, leftSide: true, rightSide: true }
        }
      } else {
        const book = geometry()
        const { left, right } = opening(shown.spread)
        if (book) {
          // Faces are in left-to-right space: mirrored, the left one lies right of the spine.
          const closedBack = !double && shown.spread[0] === backCover
          const leftSide = closedBack ? mirror : mirror ? !!right : !!left
          const rightSide = closedBack ? !mirror : mirror ? !!left : !!right
          const spine = book.spineX - origin.left
          const x0 = spine - (leftSide ? book.pageWidth : 0)
          const x1 = spine + (rightSide ? book.pageWidth : 0)
          next = { box: { left: x0, top: book.top - origin.top, width: x1 - x0, height: book.pageHeight }, spine, leftSide, rightSide }
        }
      }
      setFrame((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(host)
    for (const element of onScreen(host)) observer.observe(element)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curlOn, shownWide, bookView, shown.key, fit, sheet?.aspect, sheet?.fill, align, double, mirror, loneSize, blank])
  // The marks some leaves carry, laid over each page from its own box.
  const [marks, setMarks] = useState<{ page: number; box: Box }[]>([])
  const book = urls[0] ?? ''
  // Not on a two-page spread, which is scaled by a transform no observer sees.
  const marked = curlOn && !shownWide && shown.spread.some((page) => pageMark(page, book) !== null)
  useLayoutEffect(() => {
    const host = root.current
    if (!host || !marked) {
      setMarks((old) => (old.length ? [] : old))
      return
    }
    const place = () => {
      const origin = host.getBoundingClientRect()
      const next = onScreen(host).flatMap((element) => {
        const page = Number(element.dataset.page)
        if (!Number.isInteger(page) || !pageMark(page, book)) return []
        const rect = element.getBoundingClientRect()
        return [{ page, box: { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height } }]
      })
      setMarks((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(host)
    for (const element of onScreen(host)) observer.observe(element)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marked, book, shown.key, fit, scale, sheet?.aspect, sheet?.fill, align, double, loneSize, bookView, readySrcs])
  // The edge bound at the spine is square. A rounded clip there anti-aliased the whole edge, and
  // where two pages met at a fraction of a pixel the paper behind showed through as a line.
  const boundEdge = (index: number) =>
    !curlOn || shownWide
      ? ''
      : shown.spread.length === 2
        ? index === 0 ? ' reader-bound-right' : ' reader-bound-left'
        : facing ? (facingRight ? ' reader-bound-right' : ' reader-bound-left') : ''
  const gutter = frame ? (frame.box.width / (frame.leftSide && frame.rightSide ? 2 : 1)) * GUTTER_SHARE : 0
  const resting = opening(shown.spread)
  // Every page folds into the binding, blanks and the insides of covers too; only the outside does not.
  const leftFold = !!(mirror ? resting.right && !resting.right.outside : resting.left && !resting.left.outside)
  const rightFold = !!(mirror ? resting.left && !resting.left.outside : resting.right && !resting.right.outside)

  return (
    <div
      ref={root}
      className="reader-paged"
      data-double={shown.spread.length > 1}
      data-align={lone && paper && !double ? align : undefined}
      data-lone={loneSide}
      data-paper={curlOn || undefined}
      style={zoom === 1 ? undefined : { transform: `scale(${zoom})`, transformOrigin: 'left top' }}
    >
      {frame && (
        <div
          className="reader-book-shadow"
          // Toned like the pages: a seam between them must not show undimmed paper.
          style={{ left: frame.box.left, top: frame.box.top, width: frame.box.width, height: frame.box.height, filter: tone }}
          aria-hidden
        />
      )}
      {[...inReadingOrder(shown.spread), ...(holding ? inReadingOrder(spread) : [])].map((page, index) => {
        const standby = index >= shown.spread.length
        const src = urls[page]
        if (!src || (standby && shown.spread.some((other) => urls[other] === src))) return null
        const pageNumber = page + 1
        return (
          <PagedPage
            key={src}
            src={src}
            alt={t`${label} - page ${pageNumber}`}
            className={`reader-page ${FIT_CLASS[fit]}${faceOf(page)?.cover ? ' reader-cover' : ''}${pageWear(page, urls[0])[1] === 1 ? ' reader-worn' : ''}${standby ? '' : boundEdge(index)}`}
            style={
              !standby && loneSize
                ? {
                    width: loneSize.width,
                    height: loneSize.height,
                    maxWidth: 'none',
                    maxHeight: 'none',
                    objectFit: sheet ? undefined : 'contain',
                  }
                : pageSizeStyle(fit, scale, spread.length > 1)
            }
            tone={tone}
            fit={fit}
            shaping={standby ? shaping : shapingFor(shown.spread, shown.half)}
            enhance={pageEnhance}
            page={page}
            server={server}
            onLoaded={(image) => onMeasure(page, image)}
            standby={standby}
            onReady={onReady}
            sheet={sheet}
          />
        )
      })}
      {blank && facing && (
        <div className="reader-blank-clip" aria-hidden>
          <div
            className="reader-page reader-blank"
            style={{
              left: blank.left,
              top: blank.top,
              width: blank.width,
              height: blank.height,
              filter: tone,
              background: facingColour,
            }}
          >
            <div className="reader-facing" data-through={facing.mirrored || undefined} data-cover={facing.cover || undefined}>
              {/* A generated blank has nothing printed: the slot's own paper is the page. */}
              {facing.page >= 0 && <img
                src={heldPageUrl(facing.src) ?? facing.src}
                alt=""
                className="reader-facing-page"
                style={{
                  // Half of a two-page spread shows by drawing the whole image twice as wide.
                  width: facing.part === 'whole' ? '100%' : '200%',
                  left: facing.part === 'right' ? '-100%' : 0,
                  objectFit: sheet ? OBJECT_FIT[sheet.fill] : 'contain',
                  // Against the spine, as the turned page lands; a mirrored face swaps the sides. A padded
                  // page sits centred on its sheet, as the real one does.
                  objectPosition: sheet?.fill === 'pad' ? 'center' : facingRight !== facing.mirrored ? 'left center' : 'right center',
                }}
                draggable={false}
              />}
            </div>
          </div>
        </div>
      )}
      {marks.map(({ page, box }) => (
        <PageMarkOverlay key={page} page={page} book={book} box={box} tone={tone} />
      ))}
      {frame && (leftFold || rightFold) && (
        <div
          className="reader-gutter"
          style={{
            left: frame.spine - (leftFold ? gutter * GUTTER_REACH : 0),
            top: frame.box.top,
            width: gutter * GUTTER_REACH * ((leftFold ? 1 : 0) + (rightFold ? 1 : 0)),
            height: frame.box.height,
            background: gutterGradient(leftFold, rightFold),
          }}
          aria-hidden
        />
      )}
      {paper && <canvas ref={canvas} className="reader-curl" style={{ filter: tone }} aria-hidden />}
    </div>
  )
}
