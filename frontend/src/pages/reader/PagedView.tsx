import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Stack, Text } from '@mantine/core'
import { Trans, useLingui } from '@lingui/react/macro'
import { cropRegion, FULL_REGION, isFull, partOf, type PagePart, type Region } from './pageShape'
import EnhancedPage from './EnhancedPage'
import { heldPageUrl, holdPage } from './pageBlobs'
import { isSoftPage } from '../../lib/enhance/softness'
import { PageCurl } from './pageCurl'
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
  align: ReaderPageAlign
  even: ReaderEvenPages
  /** Width over height of the tallest page measured in the chapter so far. */
  sheetAspect: number | null
  next: Spread | null
  previous: Spread | null
  beforePrevious: Spread | null
  /** A drag finished a turn: move the reader on, the drawing already shows the result. */
  onTurn: (forward: boolean) => void
}

/** The shape every page is drawn at when sizes are evened out. */
interface Sheet {
  aspect: number
  cover: boolean
}

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
  // A short page takes the chapter's tallest shape. A two-page spread keeps its own.
  const evened: React.CSSProperties | undefined =
    sheet && natural && !wide ? { aspectRatio: String(sheet.aspect), objectFit: sheet.cover ? 'cover' : 'fill' } : undefined
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
  const hasPaper = paper !== null
  useEffect(() => {
    if (!hasPaper || !canvas.current || !root.current) return
    const created = new PageCurl(canvas.current, root.current, (forward) => paperRef.current?.onTurn(forward), setCurlBusy)
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
  if (!current && (!holding || expired === target.key || (!curlBusy && incoming.every((src) => readySrcs.has(src))))) {
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
            if (!live || !preset || !wanted) return
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
  // different in the drawing than on screen.
  const lone = shown.spread.length === 1
  const plainPages = !cropBorders && splitWide === 'off'
  const curlOn = paper !== null && zoom === 1 && plainPages
  const align = paper?.align ?? 'center'
  // The sheet hinges on its right edge for right-to-left, and for a page pushed to the left, whose
  // blank facing page is on its right.
  const mirror = lone ? (align === 'left' ? true : align === 'right' ? false : rtl) : rtl
  const sheet: Sheet | null =
    paper && paper.even !== 'off' && paper.sheetAspect ? { aspect: paper.sheetAspect, cover: paper.even === 'enlarge' } : null

  useEffect(() => {
    curl?.update({
      urls,
      current: shown.spread,
      next: paper?.next ?? null,
      previous: paper?.previous ?? null,
      beforePrevious: paper?.beforePrevious ?? null,
      mirror,
      sheetAspect: sheet?.aspect ?? null,
      sheetFill: sheet?.cover ? 'enlarge' : 'stretch',
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
    curl.auto(before.spread, spread, Math.min(...spread) > Math.min(...before.spread))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curl, target.key, urls])
  useEffect(() => {
    curl?.settled(shown.key)
  }, [curl, shown.key])

  // The blank facing page beside a lone page: the back of the page before it, on the spine side.
  // Placed from the page's own box, so every fit and size setting keeps working as it did.
  const [blank, setBlank] = useState<Box | null>(null)
  const wantBlank = curlOn && lone
  const blankLeft = mirror
  useLayoutEffect(() => {
    const host = root.current
    if (!host || !wantBlank) {
      setBlank(null)
      return
    }
    const place = () => {
      const page = [...host.querySelectorAll<HTMLElement>('.reader-page:not(.reader-blank)')].find(
        (element) => element.getBoundingClientRect().width > 0 && getComputedStyle(element).visibility !== 'hidden',
      )
      const rect = page?.getBoundingClientRect()
      const origin = host.getBoundingClientRect()
      const next =
        rect && rect.height > rect.width
          ? {
              left: (blankLeft ? rect.right : rect.left - rect.width) - origin.left,
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
  }, [wantBlank, blankLeft, shown.key, fit, scale, sheet?.aspect, sheet?.cover, align])
  const ghostPage = shown.spread[0]! - 1
  const ghost = ghostPage >= 0 ? (urls[ghostPage] ?? null) : null

  return (
    <div
      ref={root}
      className="reader-paged"
      data-double={shown.spread.length > 1}
      data-align={lone && paper ? align : undefined}
      style={zoom === 1 ? undefined : { transform: `scale(${zoom})`, transformOrigin: 'left top' }}
    >
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
            className={`reader-page ${FIT_CLASS[fit]}`}
            style={pageSizeStyle(fit, scale, spread.length > 1)}
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
      {blank && (
        <div className="reader-blank-clip" aria-hidden>
          <div
            className="reader-page reader-blank"
            style={{ left: blank.left, top: blank.top, width: blank.width, height: blank.height, filter: tone }}
          >
            {ghost && (
              <img
                src={heldPageUrl(ghost) ?? ghost}
                alt=""
                className="reader-blank-ghost"
                style={{ objectFit: sheet?.cover ? 'cover' : 'fill' }}
                draggable={false}
              />
            )}
          </div>
        </div>
      )}
      {paper && <canvas ref={canvas} className="reader-curl" style={{ filter: tone }} aria-hidden />}
    </div>
  )
}
