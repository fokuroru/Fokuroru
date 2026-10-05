import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Button,
  Center,
  Group,
  Popover,
  Portal,
  SegmentedControl,
  Slider,
  Stack,
  Switch,
  Text,
} from '@mantine/core'
import {
  IconArrowLeft,
  IconHome,
  IconKeyboard,
  IconLayoutGrid,
  IconMaximize,
  IconMinimize,
  IconPlus,
  IconSettings,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { markPreviewFinished, previewPageUrl, useSeriesPreview } from '../../api/preview'
import { useReaderSettings } from '../../api/reader'
import { useReadingProfiles } from '../../api/readingProfiles'
import ContinuousView from '../../pages/reader/ContinuousView'
import PagedView from '../../pages/reader/PagedView'
import {
  BACKGROUNDS,
  DEFAULT_PREFS,
  navigatesVertically,
  scaleMax,
  type ReaderPrefs,
} from '../../pages/reader/prefs'
import { usePreload } from '../../pages/reader/usePageUrls'
import { spreadIndexOf, usePageAspects, useSpreads } from '../../pages/reader/useSpreads'
import { useTapZones } from '../../api/tapZones'
import { useNativeAction, useNativeLayout, useNativeTurn } from '../../lib/nativeApp'
import { actionAt, layoutFor } from '../../lib/tapZones'
import { useBackClosesOverlay } from '../../lib/useBackClosesOverlay'
import { usePinchZoom } from '../../pages/reader/usePinchZoom'
import TapZoneEditor from '../reader/TapZoneEditor'
import TapZoneHint from '../reader/TapZoneHint'
import PageStrip from '../../pages/reader/PageStrip'
import ShortcutSheet from '../../pages/reader/ShortcutSheet'

const ZOOM_STEP = 0.25
const ZOOM_MAX = 4
const CHROME_HIDE_MS = 4000
const OVERLAY_Z = 1200

/**
 * Reads the first chapter of a series that is not in the library, stacked over the Discover card.
 * `PreviewChapterButton` owns the server job; this only reads it.
 * Nothing here reports progress, reading time or bookmarks, and prefs changes stay in this session:
 * a preview is a look, not a read.
 */
export function SeriesPreviewReader({
  providerId,
  title,
  coverUrl,
  seriesType,
  onClose,
  endActions,
}: {
  providerId: string
  title: string
  coverUrl: string | null
  seriesType: string | null
  onClose: () => void
  /**
   * Replaces the end screen's "Back to the series" with what to do next, for a preview opened
   * from the rail rather than from a series card.
   */
  endActions?: { onHome: () => void; onDelete: () => void; onAdd: () => void }
}) {
  const { t } = useLingui()
  useBackClosesOverlay(onClose)
  const { data: preview, error: lostError } = useSeriesPreview(providerId, true)

  // What the user reads this type of series with elsewhere: their defaults, then the profile that
  // claims the type, the same order the real reader resolves in for a series without an override.
  const { data: settings } = useReaderSettings()
  const { data: profiles } = useReadingProfiles()
  const [changes, setChanges] = useState<Partial<ReaderPrefs>>({})
  const savedPrefs = useMemo<ReaderPrefs>(() => {
    const claimed = seriesType ? profiles?.find((p) => p.seriesTypes.includes(seriesType)) : undefined
    return { ...DEFAULT_PREFS, ...settings?.defaults, ...claimed?.prefs, ...changes }
  }, [settings, profiles, seriesType, changes])
  const update = useCallback((patch: Partial<ReaderPrefs>) => setChanges((c) => ({ ...c, ...patch })), [])
  // Same as the real reader: a wide window in the Android app turns single pages into spreads.
  const { dual: wideWindow } = useNativeLayout()
  const prefs = useMemo(
    () => (savedPrefs.mode === 'auto' ? { ...savedPrefs, mode: wideWindow ? ('double' as const) : ('paged' as const) } : savedPrefs),
    [wideWindow, savedPrefs],
  )
  const mode = prefs.mode
  const vertical = navigatesVertically(prefs)

  const pageCount = preview?.pageCount ?? 0
  const version = preview?.version ?? null
  // Pages land roughly in order but not exactly, and a reader can only show a gap-free run.
  const readyCount = useMemo(() => {
    const ready = preview?.ready ?? []
    const gap = ready.indexOf(false)
    return gap === -1 ? ready.length : gap
  }, [preview?.ready])
  const complete = pageCount > 0 && readyCount === pageCount

  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    if (!version || readyCount === 0) {
      setUrls([])
      return
    }
    let cancelled = false
    void Promise.all(
      Array.from({ length: readyCount }, (_, i) => previewPageUrl(providerId, i, version)),
    ).then((resolved) => {
      if (!cancelled) setUrls(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [providerId, version, readyCount])

  const [page, setPage] = useState(0)
  const [seekVersion, setSeekVersion] = useState(0)
  const [atEnd, setAtEnd] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [chrome, setChrome] = useState(false)
  const [chromeHeld, setChromeHeld] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tapEditorOpen, setTapEditorOpen] = useState(false)
  const [stripOpen, setStripOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const noBookmarks = useMemo(() => new Set<number>(), [])
  const surfaceRef = useRef<HTMLDivElement>(null)
  const { wide, measure } = usePageAspects(urls)
  const spreads = useSpreads(urls.length, wide, mode === 'double')
  const spreadIndex = useMemo(() => spreadIndexOf(spreads, page), [spreads, page])
  const seekToPage = useCallback((index: number) => {
    setPage(index)
    setSeekVersion((v) => v + 1)
  }, [])

  // A new version is a different source's pages, so the old position means nothing.
  useEffect(() => {
    setPage(0)
    setAtEnd(false)
  }, [version])

  usePreload(urls, page, mode === 'vertical' ? 0 : prefs.preload)

  const next = useCallback(() => {
    if (atEnd) return
    const nextSpread = spreads[spreadIndex + 1]
    if (nextSpread) seekToPage(nextSpread[0])
    else if (complete) setAtEnd(true)
  }, [atEnd, spreads, spreadIndex, complete, seekToPage])

  const previous = useCallback(() => {
    if (atEnd) {
      setAtEnd(false)
      return
    }
    const previousSpread = spreads[spreadIndex - 1]
    if (previousSpread) seekToPage(previousSpread[0])
  }, [atEnd, spreads, spreadIndex, seekToPage])

  const pastEnd = useCallback(() => {
    if (complete) setAtEnd(true)
  }, [complete])

  useEffect(() => {
    setZoom(1)
  }, [version])

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void document.documentElement.requestFullscreen().catch(() => {})
  }, [])

  useEffect(() => {
    const el = surfaceRef.current
    if (el && mode !== 'vertical') el.scrollTop = 0
  }, [spreadIndex, mode])

  useEffect(() => {
    if (!chrome || chromeHeld || settingsOpen) return
    const timer = setTimeout(() => setChrome(false), CHROME_HIDE_MS)
    return () => clearTimeout(timer)
  }, [chrome, chromeHeld, settingsOpen, page])

  /** Scrolls the surface most of a screen; false when already at that edge, so the caller turns the page. */
  const scrollStep = useCallback(
    (direction: 1 | -1): boolean => {
      const el = surfaceRef.current
      if (!el) return false
      const room = direction > 0 ? el.scrollHeight - el.clientHeight - el.scrollTop : el.scrollTop
      if (room <= 2) return false
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollBy({
        top: direction * Math.min(room, el.clientHeight * 0.85),
        behavior: prefs.smoothScroll && !reduceMotion ? 'smooth' : 'auto',
      })
      return true
    },
    [prefs.smoothScroll],
  )

  const forward = useCallback(() => {
    if (vertical && !atEnd && scrollStep(1)) return
    next()
  }, [vertical, atEnd, scrollStep, next])

  const backward = useCallback(() => {
    if (vertical && !atEnd && scrollStep(-1)) return
    previous()
  }, [vertical, atEnd, scrollStep, previous])

  const rtl = prefs.direction === 'rtl'
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (tapEditorOpen) return
      // The sheet is read, not driven: while it is up the only keys that do anything close it.
      if (shortcutsOpen) {
        if (event.key === 'Escape' || event.key === '?') {
          event.preventDefault()
          event.stopPropagation()
          setShortcutsOpen(false)
        }
        return
      }
      const forwardKey = rtl ? 'ArrowLeft' : 'ArrowRight'
      const backKey = rtl ? 'ArrowRight' : 'ArrowLeft'
      switch (event.key) {
        case forwardKey:
          event.preventDefault()
          next()
          break
        case backKey:
          event.preventDefault()
          previous()
          break
        case 'ArrowDown':
        case 'PageDown':
          if (vertical) {
            event.preventDefault()
            forward()
          }
          break
        case 'ArrowUp':
        case 'PageUp':
          if (vertical) {
            event.preventDefault()
            backward()
          }
          break
        case ' ':
          if (vertical) {
            event.preventDefault()
            if (event.shiftKey) backward()
            else forward()
          } else if (mode !== 'vertical' || atEnd) {
            event.preventDefault()
            if (event.shiftKey) previous()
            else next()
          }
          break
        case 'Home':
          event.preventDefault()
          seekToPage(0)
          break
        case 'End':
          event.preventDefault()
          seekToPage(Math.max(0, urls.length - 1))
          break
        case 'f':
          toggleFullscreen()
          break
        case 't':
          setStripOpen((open) => !open)
          break
        case '?':
          setShortcutsOpen(true)
          break
        case 'd':
          update({ direction: rtl ? 'ltr' : 'rtl' })
          break
        case '1':
          update({ mode: 'paged' })
          break
        case '2':
          update({ mode: 'double' })
          break
        case '3':
          update({ mode: 'vertical' })
          break
        case '+':
        case '=':
          if (mode === 'vertical') update({ scale: Math.min(scaleMax(prefs.fit), prefs.scale + 10) })
          else setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))
          break
        case '-':
          if (mode === 'vertical') update({ scale: Math.max(25, prefs.scale - 10) })
          else setZoom((z) => Math.max(1, z - ZOOM_STEP))
          break
        case '0':
          if (mode === 'vertical') update({ scale: 100 })
          else setZoom(1)
          break
        case 'Escape':
          if (document.fullscreenElement) break
          event.preventDefault()
          event.stopPropagation()
          onClose()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    rtl, mode, vertical, atEnd, next, previous, forward, backward, seekToPage, urls.length,
    prefs.fit, prefs.scale, update, onClose, tapEditorOpen, shortcutsOpen, toggleFullscreen,
  ])

  // Volume keys, clickers and stylus buttons from the Android app, as in the real reader.
  useNativeTurn((direction) => {
    if (tapEditorOpen || shortcutsOpen) return
    if (direction === 'next') forward()
    else backward()
  })

  // The rest of the app's buttons. Chapter and bookmark actions have nothing to act on in a preview.
  useNativeAction((action) => {
    if (tapEditorOpen || shortcutsOpen) return
    switch (action) {
      case 'menu':
        setChrome((visible) => !visible)
        break
      case 'zoomIn':
        if (mode === 'vertical') update({ scale: Math.min(scaleMax(prefs.fit), prefs.scale + 10) })
        else setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))
        break
      case 'zoomOut':
        if (mode === 'vertical') update({ scale: Math.max(25, prefs.scale - 10) })
        else setZoom((z) => Math.max(1, z - ZOOM_STEP))
        break
      case 'zoomReset':
        if (mode === 'vertical') update({ scale: 100 })
        else setZoom(1)
        break
      case 'close':
        onClose()
        break
    }
  })

  const { data: tapDocument } = useTapZones()
  const tapLayout = useMemo(
    () => layoutFor(tapDocument, vertical ? 'vertical' : 'horizontal', prefs.direction),
    [tapDocument, vertical, prefs.direction],
  )

  // Pinch zooms what the keyboard zooms: the scale in the continuous strip, the transient zoom
  // in the paged layouts.
  const pinchValue = useRef(1)
  pinchValue.current = mode === 'vertical' ? prefs.scale : zoom
  const justPinched = usePinchZoom(
    surfaceRef,
    () => pinchValue.current,
    (value) => (mode === 'vertical' ? update({ scale: Math.round(value) }) : setZoom(value)),
    mode === 'vertical' ? 25 : 1,
    mode === 'vertical' ? scaleMax(prefs.fit) : ZOOM_MAX,
    !atEnd,
  )

  const onSurfaceClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (justPinched.current) return
    if (!prefs.tapZones || zoom !== 1 || (mode === 'vertical' && !vertical)) {
      setChrome((visible) => !visible)
      return
    }
    const bounds = event.currentTarget.getBoundingClientRect()
    const action = actionAt(
      tapLayout,
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
    )
    if (action === 'next') {
      if (vertical) forward()
      else next()
    } else if (action === 'prev') {
      if (vertical) backward()
      else previous()
    } else if (action === 'menu') {
      setChrome((visible) => !visible)
    }
  }

  const failure = lostError?.message ?? (preview?.status === 'failed' ? preview.error : null)
  const source = preview?.sourceDisplayName
  const chapterLabel = preview?.chapterLabel
  const pageNumber = page + 1
  const readyPages = readyCount

  // Remembered for the add that usually follows, which marks this chapter read and unwanted.
  useEffect(() => {
    if (atEnd && chapterLabel) markPreviewFinished(providerId, chapterLabel)
  }, [atEnd, chapterLabel, providerId])

  const chapterName = chapterLabel ? t`Chapter ${chapterLabel}` : t`First chapter`
  const label = `${title} · ${chapterName}`

  let body: React.ReactNode
  if (failure) {
    body = (
      <Center h="100%">
        <Stack align="center" gap="sm" maw={420} px="md">
          <Text c="rgba(255,255,255,0.72)" ta="center">
            {failure}
          </Text>
          <Button variant="light" onClick={onClose} leftSection={<IconArrowLeft size={16} />}>
            <Trans>Back to the series</Trans>
          </Button>
        </Stack>
      </Center>
    )
  } else if (atEnd) {
    body = (
      <div className="reader-end">
        {coverUrl && (
          <div className="reader-end-backdrop" style={{ backgroundImage: `url("${coverUrl}")` }} aria-hidden />
        )}
        <div className="reader-end-body">
          <div className="reader-end-finished">
            {coverUrl && <img className="reader-end-cover" src={coverUrl} alt="" />}
            <div className="reader-end-heading">
              <span className="reader-end-eyebrow">
                <Trans>End of the preview</Trans>
              </span>
              <h1 className="reader-end-title">{chapterName}</h1>
              <span className="reader-end-series">{title}</span>
            </div>
          </div>
          <div className="reader-end-next">
            <span className="reader-end-note">
              <Trans>Add the series to your library, or request it, to keep reading.</Trans>
            </span>
            {endActions ? (
              <Group gap="xs" mt="md">
                <Button onClick={endActions.onAdd} leftSection={<IconPlus size={16} />}>
                  <Trans>Add to library</Trans>
                </Button>
                <Button variant="light" onClick={endActions.onHome} leftSection={<IconHome size={16} />}>
                  <Trans>Back to home</Trans>
                </Button>
                <Button variant="light" color="red" onClick={endActions.onDelete} leftSection={<IconTrash size={16} />}>
                  <Trans>Delete preview</Trans>
                </Button>
                <Button variant="subtle" color="gray" className="reader-end-quiet" onClick={() => setAtEnd(false)}>
                  <Trans>Stay here</Trans>
                </Button>
              </Group>
            ) : (
              <Group gap="xs" mt="md">
                <Button onClick={onClose} leftSection={<IconArrowLeft size={16} />}>
                  <Trans>Back to the series</Trans>
                </Button>
                <Button variant="subtle" color="gray" className="reader-end-quiet" onClick={() => setAtEnd(false)}>
                  <Trans>Stay here</Trans>
                </Button>
              </Group>
            )}
          </div>
        </div>
      </div>
    )
  } else if (urls.length === 0 || (mode === 'paged' && page >= urls.length)) {
    body = (
      <Center h="100%">
        <Stack align="center" gap="md">
          <div className="reader-page-skeleton" aria-hidden />
          <Text fz="sm" c="rgba(255,255,255,0.6)" className="tnum">
            {preview?.status === 'queued' ? (
              <Trans>Waiting for other previews to finish…</Trans>
            ) : !source ? (
              <Trans>Looking for a source…</Trans>
            ) : pageCount > 0 ? (
              <Trans>
                Fetching from {source}, {readyPages} of {pageCount} pages
              </Trans>
            ) : (
              <Trans>Fetching from {source}…</Trans>
            )}
          </Text>
        </Stack>
      </Center>
    )
  } else {
    body = (
      <div
        ref={surfaceRef}
        className="reader-surface"
        data-scroll={mode === 'vertical' && !(prefs.scale > 100) ? 'vertical' : undefined}
        onClick={onSurfaceClick}
      >
        {mode === 'vertical' ? (
          <>
            <ContinuousView
              urls={urls}
              page={page}
              onPageChange={setPage}
              seekVersion={seekVersion}
              onPastEnd={pastEnd}
              hasNext={complete}
              pastEndLabel={<Trans>Scroll to finish the preview</Trans>}
              fit={prefs.fit}
              scale={prefs.scale}
              gap={prefs.pageGap}
              label={label}
            />
            {!complete && (
              <Center py="xl">
                <div className="reader-page-skeleton" aria-hidden />
              </Center>
            )}
          </>
        ) : (
          <PagedView
            urls={urls}
            spread={spreads[spreadIndex] ?? [0]}
            fit={prefs.fit}
            direction={prefs.direction}
            zoom={zoom}
            scale={prefs.scale}
            label={label}
            onMeasure={measure}
          />
        )}
      </div>
    )
  }

  const stop = (event: React.MouseEvent) => event.stopPropagation()
  const hold = (held: boolean) => () => setChromeHeld(held)
  const total = Math.max(1, urls.length)

  return (
    <Portal>
      <div className="reader-root" data-preview style={{ background: prefs.background }}>
        <div
          className="reader-bar reader-bar-top"
          data-visible={chrome || Boolean(failure)}
          onClick={stop}
          onMouseEnter={hold(true)}
          onMouseLeave={hold(false)}
        >
          <Group gap="sm" wrap="nowrap" px="md" h="100%">
            <ActionIcon variant="subtle" color="gray" aria-label={t`Close preview`} onClick={onClose}>
              <IconX size={18} />
            </ActionIcon>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Text fz="sm" fw={600} truncate>
                {title}
              </Text>
              <Text fz="xs" c="var(--ink-3)" truncate>
                {source ? (
                  <Trans>
                    Preview · {chapterName} · via {source}
                  </Trans>
                ) : (
                  <Trans>Preview</Trans>
                )}
              </Text>
            </div>
          </Group>
        </div>

        <TapZoneHint
          zones={tapLayout}
          active={prefs.tapZones && zoom === 1 && !(mode === 'vertical' && !vertical) && !atEnd && urls.length > 0 && !failure}
        />
        <div className="reader-preview-body">{body}</div>
        {stripOpen && urls.length > 0 && !failure && (
          <div
            className="reader-strip-wrap"
            data-visible={chrome}
            onClick={stop}
            onMouseEnter={hold(true)}
            onMouseLeave={hold(false)}
          >
            <PageStrip urls={urls} page={page} bookmarks={noBookmarks} onSelect={seekToPage} rtl={rtl} />
          </div>
        )}

        <div
          className="reader-bar reader-bar-bottom"
          data-visible={chrome && urls.length > 0 && !failure}
          onClick={stop}
          onMouseEnter={hold(true)}
          onMouseLeave={hold(false)}
        >
          <Group gap="xs" wrap="nowrap" px="md" h="100%">
            <Slider
              className="reader-slider"
              min={1}
              max={total}
              value={rtl ? total - page : page + 1}
              onChange={(value) => seekToPage(rtl ? total - value : value - 1)}
              label={(value) => `${rtl ? total - value + 1 : value} / ${pageCount}`}
              inverted={rtl}
              style={{ flex: 1 }}
            />
            <Text
              visibleFrom="xs"
              fz="xs"
              c="var(--ink-3)"
              style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
            >
              {pageNumber} / {pageCount}
            </Text>
            <ActionIcon
              variant={stripOpen ? 'light' : 'subtle'}
              color="gray"
              onClick={() => setStripOpen((open) => !open)}
              aria-label={t`Toggle page thumbnails`}
            >
              <IconLayoutGrid size={18} />
            </ActionIcon>
            <Popover
              width={280}
              position="top-end"
              withArrow
              shadow="md"
              zIndex={OVERLAY_Z}
              opened={settingsOpen}
              onChange={setSettingsOpen}
            >
              <Popover.Target>
                <ActionIcon
                  variant={settingsOpen ? 'light' : 'subtle'}
                  color="gray"
                  onClick={() => setSettingsOpen((open) => !open)}
                  aria-label={t`Reader settings`}
                >
                  <IconSettings size={18} />
                </ActionIcon>
              </Popover.Target>
              <Popover.Dropdown>
                <Stack gap="sm">
                  <div>
                    <Text fz="xs" c="var(--ink-3)" mb={4}>
                      <Trans>Layout</Trans>
                    </Text>
                    <SegmentedControl
                      fullWidth
                      size="xs"
                      value={savedPrefs.mode}
                      onChange={(value) => update({ mode: value as ReaderPrefs['mode'] })}
                      data={[
                        { label: t`Auto`, value: 'auto' },
                        { label: t`Single`, value: 'paged' },
                        { label: t`Double`, value: 'double' },
                        { label: t`Continuous`, value: 'vertical' },
                      ]}
                    />
                  </div>
                  <div>
                    <Text fz="xs" c="var(--ink-3)" mb={4}>
                      <Trans>Direction</Trans>
                    </Text>
                    <SegmentedControl
                      fullWidth
                      size="xs"
                      value={prefs.direction}
                      onChange={(value) => update({ direction: value as ReaderPrefs['direction'] })}
                      data={[
                        { label: t`Left to right`, value: 'ltr' },
                        { label: t`Right to left`, value: 'rtl' },
                      ]}
                    />
                  </div>
                  <div>
                    <Text fz="xs" c="var(--ink-3)" mb={4}>
                      <Trans>Fit</Trans>
                    </Text>
                    <SegmentedControl
                      fullWidth
                      size="xs"
                      value={prefs.fit}
                      onChange={(value) => update({ fit: value as ReaderPrefs['fit'], scale: 100 })}
                      data={[
                        { label: t`Width`, value: 'width' },
                        { label: t`Height`, value: 'height' },
                        { label: t`Screen`, value: 'screen' },
                        { label: '1:1', value: 'original' },
                      ]}
                    />
                  </div>
                  <div>
                    <Text fz="xs" c="var(--ink-3)" mb={4}>
                      <Trans>Navigation</Trans>
                    </Text>
                    <SegmentedControl
                      fullWidth
                      size="xs"
                      value={prefs.navigation}
                      onChange={(value) => update({ navigation: value as ReaderPrefs['navigation'] })}
                      data={[
                        { label: t`Auto`, value: 'auto' },
                        { label: t`Horizontal`, value: 'horizontal' },
                        { label: t`Vertical`, value: 'vertical' },
                      ]}
                    />
                  </div>
                  <div>
                    <Group justify="space-between" mb={4} wrap="nowrap">
                      <Text fz="xs" c="var(--ink-3)">
                        <Trans>Zoom ({prefs.scale}%)</Trans>
                      </Text>
                      {prefs.scale !== 100 && (
                        <Button size="compact-xs" variant="subtle" onClick={() => update({ scale: 100 })}>
                          <Trans>Reset</Trans>
                        </Button>
                      )}
                    </Group>
                    <Slider
                      size="xs"
                      min={25}
                      max={scaleMax(prefs.fit)}
                      step={5}
                      value={prefs.scale}
                      onChange={(value) => update({ scale: value })}
                      marks={[{ value: 100 }]}
                      label={(value) => `${value}%`}
                    />
                  </div>
                  <div>
                    <Text fz="xs" c="var(--ink-3)" mb={4}>
                      <Trans>Background</Trans>
                    </Text>
                    <SegmentedControl
                      fullWidth
                      size="xs"
                      value={prefs.background === BACKGROUNDS.oled ? 'oled' : 'dark'}
                      onChange={(value) =>
                        update({ background: value === 'oled' ? BACKGROUNDS.oled : BACKGROUNDS.dark })
                      }
                      data={[
                        { label: t`Dark`, value: 'dark' },
                        { label: t`OLED black`, value: 'oled' },
                      ]}
                    />
                  </div>
                  <Switch
                    size="xs"
                    label={t`Tap zones`}
                    checked={prefs.tapZones}
                    onChange={(event) => update({ tapZones: event.currentTarget.checked })}
                  />
                  {prefs.tapZones && (
                    <Button size="compact-xs" variant="default" onClick={() => setTapEditorOpen(true)}>
                      <Trans>Edit tap zones</Trans>
                    </Button>
                  )}
                  <Switch
                    size="xs"
                    label={t`Show page number`}
                    checked={prefs.showPageNumber}
                    onChange={(event) => update({ showPageNumber: event.currentTarget.checked })}
                  />
                  <Switch
                    size="xs"
                    label={t`Smooth scrolling`}
                    checked={prefs.smoothScroll}
                    onChange={(event) => update({ smoothScroll: event.currentTarget.checked })}
                  />
                </Stack>
              </Popover.Dropdown>
            </Popover>
            <ActionIcon
              variant="subtle"
              color="gray"
              className="reader-shortcuts-button"
              onClick={() => setShortcutsOpen(true)}
              aria-label={t`Keyboard shortcuts`}
            >
              <IconKeyboard size={18} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={toggleFullscreen}
              aria-label={t`Toggle full screen`}
            >
              {fullscreen ? <IconMinimize size={18} /> : <IconMaximize size={18} />}
            </ActionIcon>
          </Group>
        </div>

        {prefs.showPageNumber && pageCount > 0 && !chrome && !atEnd && !failure && (
          <div className="reader-page-badge">
            {pageNumber} / {pageCount}
          </div>
        )}

        {shortcutsOpen && <ShortcutSheet rtl={rtl} onClose={() => setShortcutsOpen(false)} />}
        <TapZoneEditor
          opened={tapEditorOpen}
          onClose={() => setTapEditorOpen(false)}
          direction={prefs.direction}
          zIndex={OVERLAY_Z + 20}
        />
      </div>
    </Portal>
  )
}
