import { Fragment, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Box, Button, Group } from '@mantine/core'
import { Trans, useLingui } from '@lingui/react/macro'
import { msg } from '@lingui/core/macro'
import {
  IconBook,
  IconBookmarks,
  IconDeviceTv,
  IconDownload,
  IconEye,
  IconFlame,
  IconFolderDown,
  IconLayoutDashboard,
  IconPlayerPlay,
  IconPlus,
  IconSparkles,
} from '@tabler/icons-react'
import { useHomeFromAnime } from '../api/animeResume'
import { useAuth } from '../auth/AuthProvider'
import {
  HOME_HERO_DEFAULTS,
  useDiscover,
  useProgressSummary,
  useHomeReading,
  useHomeRecentlyAdded,
  useLibraryStats,
  useMetadataSettings,
  useQueue,
  useRecommendations,
  useRootFolders,
  useSeries,
  useSeriesIdLookup,
  useUiSettings,
  isRailKey,
  railIdOf,
  type HomeGlancePanel,
  type HomeLayoutKey,
  type HomeReadingItem,
  type HomeSection,
  type HomeSectionKey,
  type RecommendationItem,
} from '../api/hooks'
import { useCachedPreviews } from '../api/preview'
import { useCustomRails } from '../api/customRails'
import { CustomRailSection } from '../components/rails/CustomRailSection'
import { PageLayoutEditor, PageLayoutEditorLoading } from '../components/layout/PageLayoutEditor'
import { useLayoutEditMode } from '../components/layout/useLayoutEditMode'
import { reconcileLayout, sectionVisible } from '../components/layout/pageLayout'
import { HOME_LAYOUT_CONFIG, HOME_SECTION_DEFS } from '../components/home/homeSectionDefs'
import { useReadTracking } from '../api/reader'
import { DiscoverDetailModal } from '../components/discover/DiscoverDetailModal'
import { FollowingRail } from '../components/discover/FollowingRail'
import { ContinueLead, CONTINUE_LEAD_MAX } from '../components/home/ContinueLead'
import { ContinueRail } from '../components/home/ContinueRail'
import type { ReadingRailKind } from '../components/home/ReadingCardMenu'
import { DownloadingStrip } from '../components/home/DownloadingStrip'
import { AnimeResumeRail } from '../components/home/AnimeResumeRail'
import { SpineShelf, type BoardModel } from '../components/library/SpineShelf'
import { RecentlyAddedRail } from '../components/home/RecentlyAddedRail'
import { DiscoverRailRow, EngineRailRow } from '../components/ui/DiscoverRail'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { RailSkeleton } from '../components/ui/RailSkeleton'
import { SectionHeader } from '../components/ui/SectionHeader'
import { SurfaceFrame } from '../components/ui/SurfaceFrame'
import { isQueueActive } from '../components/ui/status'
import { formatNumber, formatReadingTime } from '../format'

/** How many catalogue picks each borrowed Discover rail shows before "Find more". */
const RAIL_SIZE = 20

function FindMore() {
  return (
    <Button
      component={Link}
      to="/discover"
      variant="subtle"
      size="compact-sm"
    >
      <Trans>Find more</Trans>
    </Button>
  )
}

export default function HomePage() {
  const { t } = useLingui()
  const { data: series, isLoading: seriesLoading, isError: seriesFailed, refetch: refetchSeries } = useSeries()
  const { data: metadata } = useMetadataSettings()
  const { data: rootFolders } = useRootFolders()
  const { data: ui, isLoading: uiLoading, isError: uiFailed } = useUiSettings()
  const readTracking = useReadTracking()
  const stats = useLibraryStats()
  const { editing, enter: enterEditing, exit: exitEditing } = useLayoutEditMode()
  const { can } = useAuth()

  // Opposite default to the nav's in App.tsx on purpose: there, assuming "available" while the
  // settings load stops the Discover tab flickering in and out. Here it would fire two requests
  // that 400 on an install with no local MangaBaka database, and both surface as error toasts.
  const discoverAvailable = Boolean(metadata?.useLocalDb && metadata?.dumpPresent)
  const hasLibrary = (series?.length ?? 0) > 0

  const { data: homeRails, isError: railsFailed } = useCustomRails('home')

  // Default to the shipping order while the setting loads, so the page doesn't reflow once it
  // arrives. `on` is what every query below gates on: a section the user turned off must not
  // cost a request, which is most of the point of being able to turn one off. Nothing fetches
  // while the layout is being edited either: the editor shows compact cards, not the sections.
  const layout = useMemo(
    () =>
      ui?.homeLayout.sections ??
      (reconcileLayout([], HOME_LAYOUT_CONFIG, (homeRails ?? []).map((r) => r.id)) as HomeSection[]),
    [ui, homeRails],
  )
  const sectionOf = (key: HomeSectionKey) => layout.find((s) => s.key === key)
  // Before `ui` has loaded, `layout` is the reconciled fallback, which enables every canonical
  // section (see `reconcileLayout`). A disabled rail must not fetch just because the setting that
  // disables it has not arrived yet.
  const on = (key: HomeSectionKey) => !editing && Boolean(ui) && (sectionOf(key)?.enabled ?? false)
  const panelOn = (panel: HomeGlancePanel) =>
    on('glance') && (sectionOf('glance')?.panels?.find((p) => p.key === panel)?.enabled ?? false)
  const heroOn = (key: HomeSectionKey) => sectionOf(key)?.hero ?? HOME_HERO_DEFAULTS[key] ?? false

  const needsReading = on('continue') || on('jumpback')
  const needsDiscover = discoverAvailable && hasLibrary

  const {
    data: reading,
    isLoading: readingLoading,
    isError: readingFailed,
    refetch: refetchReading,
  } = useHomeReading(12, needsReading)
  const { data: recent, isLoading: recentLoading } = useHomeRecentlyAdded(12, on('recent'))
  const { data: fromAnime, isLoading: fromAnimeLoading } = useHomeFromAnime(on('fromanime'))
  const { data: queue } = useQueue()
  const { data: rails, isLoading: railsLoading } = useDiscover(0, needsDiscover && on('popular'))
  // An empty request object is deliberate: it hits the same server-side cache slot as Discover's
  // default Recommended tab, so this rail can never thrash that shared pool with different seeds.
  const recommendations = useRecommendations({}, needsDiscover && on('recommended'))
  const { data: progress } = useProgressSummary(undefined, panelOn('progress'))

  const seriesIdFor = useSeriesIdLookup()
  const [detailItem, setDetailItem] = useState<RecommendationItem | null>(null)
  const navigate = useNavigate()

  const continueReading = reading?.continueReading ?? []
  const jumpBackIn = reading?.jumpBackIn ?? []
  const downloading = (queue?.items ?? []).filter((q) => isQueueActive(q.status))

  // What is left to read, off the library list that is already loaded.
  //
  // `readChapterCount` null means "never tracked" rather than "nothing read", so those series are
  // left out of every figure here: counting them would report a whole untracked library as unread.
  const waiting = useMemo(() => {
    let unread = 0
    let started = 0
    let finished = 0
    for (const s of series ?? []) {
      if (s.readChapterCount == null || s.chapterFileCount === 0) continue
      unread += Math.max(0, s.chapterFileCount - s.readChapterCount)
      if (s.readChapterCount >= s.chapterFileCount) finished++
      else if (s.readChapterCount > 0) started++
    }
    return { unread, started, finished }
  }, [series])
  const popular = rails?.find((r) => r.key === 'popular')?.items ?? []
  const youMightLike = recommendations.data?.pages[0]?.similar?.slice(0, RAIL_SIZE) ?? []

  const header = <PageHeader title={t`Home`} description={t`Pick up where you left off.`} />

  if (editing) {
    return (
      <SurfaceFrame width="full" pageStyle="editorial">
        {header}
        {ui && homeRails ? (
          <PageLayoutEditor
            page="home"
            placement="home"
            registry={HOME_SECTION_DEFS}
            config={HOME_LAYOUT_CONFIG}
            initial={ui.homeLayout.sections}
            rails={homeRails}
            railLimit={RAIL_SIZE}
            unavailable={(key) =>
              !discoverAvailable &&
              (key === 'recommended' || key === 'popular' || key === 'following' ||
                (isRailKey(key) && homeRails.find((r) => r.id === railIdOf(key))?.spec.source !== 'library'))
                ? msg`Needs the local MangaBaka database`
                : null
            }
            panelHint={(_section, panel) =>
              panel === 'toread' && !readTracking
                ? msg`Needs read tracking: use the reader or connect Kavita.`
                : panel === 'progress' && progress && !progress.enabled
                  ? msg`Hidden while progression is switched off.`
                  : null
            }
            onExit={exitEditing}
          />
        ) : (
          <PageLayoutEditorLoading failed={uiFailed || railsFailed} onExit={exitEditing} />
        )}
      </SurfaceFrame>
    )
  }

  if (!seriesLoading && seriesFailed) {
    return (
      <SurfaceFrame width="full" pageStyle="editorial">
        <EmptyState
          title={t`Couldn't load your library`}
          actionLabel={t`Retry`}
          onAction={() => void refetchSeries()}
        />
      </SurfaceFrame>
    )
  }

  if (!seriesLoading && !hasLibrary) {
    // The empty state carries "Add series" itself, and there is no layout to edit.
    return (
      <SurfaceFrame width="full" pageStyle="editorial">
        <EmptyState
          art="shelf"
          title={t`Nothing in your library yet`}
          description={t`Add a series and Fōkurōru will start tracking chapters for it. This page fills up as you read and download.`}
          actionLabel={can('AddSeries') ? t`Add series` : t`Request series`}
          actionTo="/add"
          actionIcon={<IconPlus size={16} />}
          secondaryActionLabel={can('ImportLibrary') ? t`Import a folder` : undefined}
          secondaryActionTo="/import"
          secondaryActionIcon={<IconFolderDown size={16} />}
        />
      </SurfaceFrame>
    )
  }

  // Keep a skeleton up rather than let the per-section fallbacks (`StartReadingPrompt` and the
  // like) flash empty while `ui` is still loading and every gated query above is held off by `on`.
  if (uiLoading) {
    return (
      <SurfaceFrame width="full" pageStyle="editorial">
        <RailSkeleton title />
        <RailSkeleton title />
      </SurfaceFrame>
    )
  }

  // The figures chalked on the board behind the shelf. Each panel is still switched on and off
  // separately in the layout editor; with every panel off the shelf hangs no board.
  const boardGroups: BoardModel['groups'] = []
  if (panelOn('stats')) {
    boardGroups.push({
      heading: t`Library`,
      figures: [
        { label: t`Series`, value: formatNumber(stats.total) },
        { label: t`Monitored`, value: formatNumber(stats.monitored) },
        { label: t`On disk`, value: formatNumber(stats.downloaded), tone: 'ok' },
        { label: t`Missing`, value: formatNumber(stats.missing), tone: 'warn' },
      ],
    })
  }
  // Only ever with tracking on: without it every downloaded chapter reads as unread, and the board
  // would tell a Kavita-less library that it has 12,000 chapters waiting.
  if (panelOn('toread') && readTracking) {
    boardGroups.push({
      heading: t`To read`,
      figures: [
        { label: t`Unread`, value: formatNumber(waiting.unread) },
        { label: t`Started`, value: formatNumber(waiting.started) },
        { label: t`Finished`, value: formatNumber(waiting.finished), tone: 'ok' },
      ],
    })
  }
  // Nothing at all when the user has switched progression off: the panel stays in their layout
  // list, so turning it back on restores its position.
  const boardProgress: BoardModel['progress'] =
    panelOn('progress') && progress?.enabled
      ? {
          heading: t`Reading`,
          level: t`Level ${progress.level.level}`,
          caption: t`${formatNumber(progress.level.intoLevel)} / ${formatNumber(progress.level.levelSpan)} XP to level ${progress.level.level + 1}`,
          fraction: progress.level.progress,
          figures: [
            { label: t`Chapters read`, value: formatNumber(progress.chaptersRead) },
            { label: t`Time read`, value: formatReadingTime(progress.readingSeconds) },
            progress.showStreaks
              ? { label: t`Day streak`, value: formatNumber(progress.currentStreak) }
              : { label: t`Achievements`, value: `${progress.earned}/${progress.total}` },
          ],
        }
      : undefined
  const board: BoardModel | null =
    boardGroups.length > 0 || boardProgress ? { groups: boardGroups, progress: boardProgress } : null

  // One node per section key. Rendered in the user's order below; a section with nothing to show
  // yields null and takes up no space, exactly as when it is switched off.
  const sections: Record<HomeSectionKey, React.ReactNode> = {
    continue: readingLoading ? (
      <RailSkeleton />
    ) : readingFailed ? (
      <ReadingErrorPrompt onRetry={() => void refetchReading()} />
    ) : continueReading.length > 0 ? (
      <>
        <SectionHeader icon={IconPlayerPlay} title={t`Continue reading`} count={continueReading.length} />
        <ReadingSection items={continueReading} rail="continue" hero={heroOn('continue')} />
      </>
    ) : (
      // Only nudge when there is genuinely nothing to resume *and* nothing to jump back into,
      // otherwise a user mid-way through their library gets told to start reading.
      jumpBackIn.length === 0 && <StartReadingPrompt tracking={readTracking} />
    ),

    downloading: downloading.length > 0 && (
      <>
        <SectionHeader icon={IconDownload} title={t`Downloading now`} count={downloading.length} />
        <DownloadingStrip items={downloading} />
      </>
    ),

    recent: recentLoading ? (
      <RailSkeleton />
    ) : (
      recent && recent.length > 0 && (
        <>
          <SectionHeader icon={IconBookmarks} title={t`Recently added`} count={recent.length} />
          <RecentlyAddedRail items={recent} />
        </>
      )
    ),

    previews: (
      <PreviewsRail enabled={needsDiscover && on('previews')} seriesIdFor={seriesIdFor} onOpen={setDetailItem} />
    ),

    jumpback: readingLoading ? (
      <RailSkeleton />
    ) : readingFailed ? (
      on('continue') ? null : <ReadingErrorPrompt onRetry={() => void refetchReading()} />
    ) : (
      jumpBackIn.length > 0 && (
        <>
          <SectionHeader icon={IconBook} title={t`Jump back in`} count={jumpBackIn.length} />
          <ReadingSection items={jumpBackIn} rail="jumpback" hero={heroOn('jumpback')} />
        </>
      )
    ),

    fromanime: fromAnimeLoading ? (
      <RailSkeleton />
    ) : (
      fromAnime && fromAnime.length > 0 && (
        <>
          <SectionHeader icon={IconDeviceTv} title={t`Continue from the anime`} count={fromAnime.length} />
          <AnimeResumeRail items={fromAnime} onOpen={setDetailItem} />
        </>
      )
    ),

    following: (
      <FollowingRail
        enabled={needsDiscover && on('following')}
        limit={RAIL_SIZE}
        seriesIdFor={seriesIdFor}
        onOpen={setDetailItem}
        onShowMore={(rail) => navigate('/discover', { state: { expandFollowing: rail } })}
      />
    ),

    recommended: recommendations.isLoading ? (
      <RailSkeleton />
    ) : (
      youMightLike.length > 0 && (
        <>
          <SectionHeader icon={IconSparkles} title={t`You might like`} action={<FindMore />} chevron />
          <EngineRailRow items={youMightLike} seriesIdFor={seriesIdFor} onOpen={setDetailItem} />
        </>
      )
    ),

    popular: railsLoading ? (
      <RailSkeleton />
    ) : (
      popular.length > 0 && (
        <>
          <SectionHeader icon={IconFlame} title={t`Currently popular`} action={<FindMore />} chevron />
          <DiscoverRailRow
            items={popular.slice(0, RAIL_SIZE)}
            seriesIdFor={seriesIdFor}
            onOpen={setDetailItem}
          />
        </>
      )
    ),

    glance: <SpineShelf series={series ?? []} readTracking={readTracking} board={board} />,
  }

  const visible = layout.filter(sectionVisible)

  // A custom rail's key only names it; the rail itself comes from the rails list. One whose source
  // is the catalogue waits on the local database like the borrowed Discover rails above.
  const renderSection = (key: HomeLayoutKey) => {
    if (!isRailKey(key)) return sections[key]
    const rail = homeRails?.find((r) => r.id === railIdOf(key))
    if (!rail || (rail.spec.source !== 'library' && !discoverAvailable)) return null
    return <CustomRailSection rail={rail} limit={RAIL_SIZE} onOpen={setDetailItem} />
  }

  return (
    <SurfaceFrame width="full" pageStyle="editorial">
      {visible.length === 0 ? (
        <EmptyState
          title={t`Every section is switched off`}
          description={t`Home has nothing to show. Turn some sections back on in the layout editor, or switch Home off entirely in Settings.`}
          actionLabel={t`Edit layout`}
          onAction={enterEditing}
        />
      ) : (
        visible.map((s) => <Fragment key={s.key}>{renderSection(s.key)}</Fragment>)
      )}

      <Group justify="center" mt="xl">
        <Button variant="default" leftSection={<IconLayoutDashboard size={16} />} onClick={enterEditing}>
          <Trans>Edit layout</Trans>
        </Button>
      </Group>

      <DiscoverDetailModal
        item={detailItem}
        feedbackContext={{ surface: 'home' }}
        inLibrarySeriesId={detailItem ? seriesIdFor(detailItem) : null}
        rootFolders={rootFolders}
        onClose={() => setDetailItem(null)}
      />
    </SurfaceFrame>
  )
}

/** Series with a first chapter already downloaded as a preview. Nothing shows until there is one. */
function PreviewsRail({
  enabled,
  seriesIdFor,
  onOpen,
}: {
  enabled: boolean
  seriesIdFor: (item: RecommendationItem) => number | null
  onOpen: (item: RecommendationItem) => void
}) {
  const { t } = useLingui()
  const { data } = useCachedPreviews(enabled)
  if (!data || data.length === 0) return null
  return (
    <>
      <SectionHeader icon={IconEye} title={t`Previews`} count={data.length} />
      <DiscoverRailRow items={data} seriesIdFor={seriesIdFor} onOpen={onOpen} />
    </>
  )
}

/**
 * A reading list, optionally led by large tiles: the first few as `ContinueLead`'s cover tiles and
 * the rest as a rail, or everything as a rail.
 */
function ReadingSection({
  items,
  rail,
  hero,
}: {
  items: HomeReadingItem[]
  rail: ReadingRailKind
  hero: boolean
}) {
  if (!hero) return <ContinueRail items={items} rail={rail} />
  // Exactly one item spilling past the lead tiles would sit alone on its own row, so two lead tiles take that case instead of three.
  const leadCount = items.length === CONTINUE_LEAD_MAX + 1 ? 2 : CONTINUE_LEAD_MAX
  return (
    <>
      <ContinueLead items={items.slice(0, leadCount)} rail={rail} />
      {items.length > leadCount && <ContinueRail items={items.slice(leadCount)} rail={rail} />}
    </>
  )
}

/** Shown in place of the reading rails when `/home/reading` itself failed, rather than the start-reading nudge. */
function ReadingErrorPrompt({ onRetry }: { onRetry: () => void }) {
  const { t } = useLingui()
  return (
    <Box mt="xl">
      <EmptyState title={t`Couldn't load your reading progress`} actionLabel={t`Retry`} onAction={onRetry} />
    </Box>
  )
}

/**
 * Shown when nothing has been read yet. Split by whether progress is tracked at all: with no
 * tracking configured the rails would stay empty no matter how much the user reads elsewhere.
 */
function StartReadingPrompt({ tracking }: { tracking: boolean }) {
  const { t } = useLingui()
  return (
    <Box mt="xl">
      <EmptyState
        title={t`Nothing to pick up yet`}
        description={
          tracking ? (
            <Trans>Open a chapter and it will show up here, ready to resume.</Trans>
          ) : (
            <Trans>
              Open any chapter in the built-in reader, or connect Kavita, and Fōkurōru starts tracking
              where you are.
            </Trans>
          )
        }
        actionLabel={t`Browse library`}
        actionTo="/library"
      />
    </Box>
  )
}
