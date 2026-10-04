import { ActionIcon, Alert, Button, Progress, SegmentedControl, Text, TextInput } from '@mantine/core'
import { IconDeviceMobileDown, IconDeviceDesktop, IconSearch, IconSettings } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Trans, useLingui } from '@lingui/react/macro'
import { SpiceButton } from '../components/layout/SpiceButton'
import { useReadTracking } from '../api/reader'
import { useAppVersion, useHomeFresh, useHomeReading, useSeries, type HomeReadingItem } from '../api/hooks'
import { useAuth } from '../auth/AuthProvider'
import type { SeriesDto } from '../api/types'
import { BrandWordmark, IconBrandMark } from '../components/IconBrandMark'
import { nativeApp } from '../lib/nativeApp'
import { setSimpleViewPreferred } from '../lib/simpleView'
import { spineVars } from '../lib/spine'
import { SeriesSheet, type SheetSeries } from '../components/lite/SeriesSheet'
import { useLongPress } from '../components/lite/useLongPress'

const PAGE = 24

type Sort = 'recent' | 'title'

/**
 * A phone-sized front page: the chapter you were last in, the rest of what you are reading, and the
 * library as a plain grid. It stands outside the app shell, so there is no sidebar to open, and
 * everything on it leads to the same series and reader pages the full interface uses.
 */
export default function SimpleHomePage() {
  const { t } = useLingui()
  const navigate = useNavigate()
  const reading = useHomeReading(12)
  const fresh = useHomeFresh(12)
  const library = useSeries()
  const native = nativeApp()

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [shown, setShown] = useState(PAGE)
  const [held, setHeld] = useState<SheetSeries | null>(null)

  const continuing = reading.data?.continueReading ?? []
  const upNext = reading.data?.jumpBackIn ?? []
  const tracking = useReadTracking()

  // The desktop shelf's order: series being read, most recently read first. Its first book is the
  // hero and the rest make up the one rail above the library.
  const shelf = useMemo(
    () =>
      tracking
        ? (library.data ?? [])
            .filter((s) => s.readingStatus === 'Reading')
            .sort((a, b) => (b.lastReadAt ?? '').localeCompare(a.lastReadAt ?? ''))
        : [],
    [library.data, tracking],
  )
  const itemFor = useMemo(() => {
    const items = new Map<number, HomeReadingItem>()
    for (const item of [...upNext, ...continuing]) items.set(item.seriesId, item)
    return items
  }, [continuing, upNext])
  const hero = (shelf[0] && itemFor.get(shelf[0].id)) ?? continuing[0] ?? upNext[0]
  const railItems = shelf.length > 0
    ? shelf.slice(1).map((s) => itemFor.get(s.id) ?? plainItem(s))
    : [...continuing.slice(1), ...upNext].filter((item) => item.seriesId !== hero?.seriesId)

  const books = useMemo(() => {
    const needle = query.trim().toLowerCase()
    // Only what there is to read: nothing on the server would open to a download prompt, and a series that is
    // still coming out and fully read has nothing new.
    const list = (library.data ?? []).filter(
      (s) =>
        s.chapterFileCount > 0 &&
        // Ongoing and caught up: nothing left to read until the next chapter arrives.
        s.readingStatus !== 'UpToDate' &&
        (!needle || s.displayTitle.toLowerCase().includes(needle) || s.title.toLowerCase().includes(needle)),
    )
    return list.sort((a, b) => {
      if (sort === 'recent') {
        const byRead = (b.lastReadAt ?? '').localeCompare(a.lastReadAt ?? '')
        if (byRead !== 0) return byRead
      }
      return a.sortTitle.localeCompare(b.sortTitle, undefined, { sensitivity: 'base', numeric: true })
    })
  }, [library.data, query, sort])

  const offline = reading.isError || library.isError

  const showFull = () => {
    setSimpleViewPreferred(false)
    navigate('/')
  }

  return (
    <div className="lite">
      <header className="lite-bar">
        <span className="lite-brand">
          <span className="brand-mark" role="img" aria-label={t`Manga manager`}>
            <IconBrandMark />
          </span>
          <BrandWordmark height={18} className="brand-wordmark" />
        </span>
        <span className="lite-bar-actions">
          {native && (
            <>
              <ActionIcon variant="subtle" color="gray" aria-label={t`Saved chapters`} onClick={() => native.openDownloads()}>
                <IconDeviceMobileDown size={19} />
              </ActionIcon>
              <ActionIcon variant="subtle" color="gray" aria-label={t`App settings`} onClick={() => native.openSettings()}>
                <IconSettings size={19} />
              </ActionIcon>
            </>
          )}
          <SpiceButton />
          <ActionIcon variant="subtle" color="gray" aria-label={t`Desktop view`} onClick={showFull}>
            <IconDeviceDesktop size={19} />
          </ActionIcon>
        </span>
      </header>

      {offline && (
        <Alert color="yellow" variant="light" className="lite-alert" title={t`Can't reach the server`}>
          <Text size="sm">
            <Trans>Your library isn't available right now.</Trans>
          </Text>
          {native && (
            <Button mt="xs" size="xs" variant="default" onClick={() => native.openDownloads()}>
              <Trans>Open saved chapters</Trans>
            </Button>
          )}
        </Alert>
      )}

      {hero ? (
        <Hero item={hero} resuming={continuing.some((c) => c.seriesId === hero.seriesId)} />
      ) : (
        !reading.isPending &&
        !offline && (
          <section className="lite-empty">
            <Text fw={600}>
              <Trans>Nothing to pick up yet</Trans>
            </Text>
            <Text size="sm" c="dimmed">
              <Trans>Open any chapter and it will show up here.</Trans>
            </Text>
          </section>
        )
      )}

      {(fresh.data ?? []).length > 0 && (
        <Rail
          title={t`New chapters`}
          items={(fresh.data ?? []).map((f) => ({
            seriesId: f.seriesId,
            seriesTitle: f.seriesTitle,
            coverUrl: f.coverUrl,
            chapterId: f.chapterId,
            chapterLabel: f.newChapterCount > 1 ? `${f.chapterLabel} +${f.newChapterCount - 1}` : f.chapterLabel,
            page: 0,
            pageCount: 0,
            lastReadAt: '',
            unreadChapters: f.newChapterCount,
          }))}
          onHold={setHeld}
        />
      )}

      {railItems.length > 0 && <Rail title={t`Continue reading`} items={railItems} onHold={setHeld} />}

      <section className="lite-section" aria-labelledby="lite-library">
        <h2 id="lite-library" className="lite-heading">
          <Trans>Library</Trans>
        </h2>
        <div className="lite-tools">
          <TextInput
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value)
              setShown(PAGE)
            }}
            placeholder={t`Search your library`}
            aria-label={t`Search your library`}
            leftSection={<IconSearch size={16} />}
            className="lite-search"
          />
          <SegmentedControl
            size="xs"
            value={sort}
            onChange={(v) => setSort(v as Sort)}
            data={[
              { value: 'recent', label: t`Recent` },
              { value: 'title', label: t`A to Z` },
            ]}
            aria-label={t`Sort the library`}
          />
        </div>

        {library.isPending ? null : books.length === 0 ? (
          <Text size="sm" c="dimmed" className="lite-none">
            {query ? <Trans>No series match that search.</Trans> : <Trans>Your library is empty.</Trans>}
          </Text>
        ) : (
          <>
            <div className="lite-grid">
              {books.slice(0, shown).map((s) => (
                <Book key={s.id} series={s} onHold={setHeld} />
              ))}
            </div>
            {books.length > shown && (
              <Button variant="default" fullWidth mt="md" onClick={() => setShown((n) => n + PAGE)}>
                <Trans>Show more</Trans>
              </Button>
            )}
          </>
        )}
      </section>

      <AppStatus offline={offline} />
      <SeriesSheet series={held} onClose={() => setHeld(null)} />
    </div>
  )
}

/** Numeric parts compared in order, so 0.31.1-fok.66 is newer than 0.31.1-fok.9. */
function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/\D+/).filter(Boolean).map(Number)
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Which app, server and account this is, and whether the web interface on screen is the server's current one. */
function AppStatus({ offline }: { offline: boolean }) {
  const native = nativeApp()
  const { me } = useAuth()
  const { data: loaded } = useAppVersion()
  const live = useQuery({
    queryKey: ['lite-server-version'],
    queryFn: async () => {
      const res = await fetch('/initialize.json', { cache: 'no-cache' })
      if (!res.ok) throw new Error(res.statusText)
      return ((await res.json()) as { version: string }).version
    },
    refetchInterval: 60_000,
    retry: false,
  })

  const server = live.data
  const checked = !offline && server !== undefined && server !== 'offline'
  const needed = native?.serverVersion?.()
  const tooOld = checked && needed !== undefined && compareVersions(server, needed) < 0
  const synced = checked && !tooOld && loaded !== undefined && server === loaded

  return (
    <footer className="lite-status">
      <div className="lite-status-row">
        {native && (
          <span>
            <Trans>App {native.version()}</Trans>
          </span>
        )}
        <span>{window.location.host}</span>
        {me && <span>{me.userName}</span>}
      </div>
      <div className="lite-status-row" data-state={checked ? (synced ? 'ok' : 'stale') : 'unknown'}>
        {!checked ? (
          <span>
            <Trans>Can't check the server right now</Trans>
          </span>
        ) : tooOld ? (
          <span>
            <Trans>Version mismatch. Please update server to {needed}.</Trans>
          </span>
        ) : synced ? (
          <span>
            <Trans>Server {server}, up to date</Trans>
          </span>
        ) : (
          <>
            <span>
              <Trans>Server is on {server}, this screen is on {loaded}</Trans>
            </span>
            <Button size="compact-xs" variant="default" onClick={() => window.location.reload()}>
              <Trans>Reload</Trans>
            </Button>
          </>
        )}
      </div>
    </footer>
  )
}

function Hero({ item, resuming }: { item: HomeReadingItem; resuming: boolean }) {
  const { t } = useLingui()
  const started = item.pageCount > 0 && item.page > 0
  const percent = item.pageCount > 0 ? Math.min(100, Math.round(((item.page + 1) / item.pageCount) * 100)) : 0
  return (
    <section className="lite-hero" style={spineVars(item.spineColor, 'dark')}>
      {item.coverUrl && <div className="lite-hero-backdrop" style={{ backgroundImage: `url(${item.coverUrl})` }} aria-hidden />}
      <div className="lite-hero-body">
        <Link to={`/open/${item.seriesId}`} state={{ lite: true }} className="lite-hero-cover" aria-label={t`Open ${item.seriesTitle}`}>
          {item.coverUrl ? <img src={item.coverUrl} alt="" /> : <span className="lite-cover-blank" />}
        </Link>
        <div className="lite-hero-text">
          <Text className="lite-eyebrow">{resuming ? <Trans>Continue reading</Trans> : <Trans>Up next</Trans>}</Text>
          <h1 className="lite-hero-title">{item.seriesTitle}</h1>
          <Text size="sm" className="lite-hero-meta">
            {item.chapterLabel}
            {started && ` · ${t`page ${item.page + 1} of ${item.pageCount}`}`}
          </Text>
          {started && <Progress value={percent} size="xs" className="lite-hero-progress" aria-label={t`Reading progress`} />}
          <Button
            component={Link}
            to={`/read/${item.chapterId}`}
            state={{ lite: true }}
            size="md"
            fullWidth
            mt="sm"
            styles={{ root: { background: 'var(--spine)', color: 'var(--spine-ink)' } }}
          >
            {started ? <Trans>Resume</Trans> : <Trans>Start reading</Trans>}
          </Button>
          {item.unreadChapters > 0 && (
            <Text size="xs" mt={6} className="lite-hero-meta">
              {item.unreadChapters === 1 ? <Trans>1 unread chapter</Trans> : <Trans>{item.unreadChapters} unread chapters</Trans>}
            </Text>
          )}
        </div>
      </div>
    </section>
  )
}

/** A book on the shelf with nothing to say about where it was left: the cover and title are enough. */
function plainItem(series: SeriesDto): HomeReadingItem {
  return {
    seriesId: series.id,
    seriesTitle: series.displayTitle,
    coverUrl: series.coverUrl,
    chapterId: 0,
    chapterLabel: '',
    page: 0,
    pageCount: 0,
    lastReadAt: series.lastReadAt ?? '',
    unreadChapters: 0,
  }
}

function Rail({ title, items, onHold }: { title: string; items: HomeReadingItem[]; onHold: (s: SheetSeries) => void }) {
  return (
    <section className="lite-section">
      <h2 className="lite-heading">{title}</h2>
      <div className="lite-rail">
        {items.map((item) => (
          <HeldLink key={item.seriesId} id={item.seriesId} title={item.seriesTitle} onHold={onHold}>
            <span className="lite-cover">
              {item.coverUrl ? <img src={item.coverUrl} alt="" loading="lazy" /> : <span className="lite-cover-blank" />}
              {item.pageCount > 0 && item.page > 0 && (
                <span className="lite-cover-bar" style={{ width: `${Math.min(100, ((item.page + 1) / item.pageCount) * 100)}%` }} />
              )}
            </span>
            <span className="lite-card-title">{item.seriesTitle}</span>
            <span className="lite-card-sub">{item.chapterLabel}</span>
          </HeldLink>
        ))}
      </div>
    </section>
  )
}

function Book({ series, onHold }: { series: SeriesDto; onHold: (s: SheetSeries) => void }) {
  return (
    <HeldLink id={series.id} title={series.displayTitle} onHold={onHold}>
      <span className="lite-cover">
        {series.coverUrl ? <img src={series.coverUrl} alt="" loading="lazy" /> : <span className="lite-cover-blank" />}
      </span>
      <span className="lite-card-title">{series.displayTitle}</span>
    </HeldLink>
  )
}

/** A cover that opens the series on a tap and a menu on a hold. */
function HeldLink({ id, title, onHold, children }: { id: number; title: string; onHold: (s: SheetSeries) => void; children: ReactNode }) {
  const press = useLongPress(() => onHold({ id, title }))
  return (
    <Link to={`/open/${id}`} state={{ lite: true }} className="lite-card" {...press}>
      {children}
    </Link>
  )
}
