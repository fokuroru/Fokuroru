import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { useComputedColorScheme, VisuallyHidden } from '@mantine/core'
import { Link, useNavigate } from 'react-router-dom'
import { useLingui } from '@lingui/react/macro'
import '@fontsource/dela-gothic-one/latin-400.css'
import '@fontsource/rampart-one/latin-400.css'
import '@fontsource/reggae-one/latin-400.css'
import '@fontsource/train-one/latin-400.css'
import '@fontsource/rubik-mono-one/latin-400.css'
import '@fontsource/mochiy-pop-one/latin-400.css'
import '@fontsource/potta-one/latin-400.css'
import { api } from '../../api/client'
import { useShelfFigures } from '../../api/hooks'
import { FIGURE_CHANCE, FIGURE_SCALE, useShelfFigurePrefs } from '../../lib/shelfFigurePrefs'
import type { SeriesDto } from '../../api/types'
import { seriesProgressVisual } from '../ui/status'
import { contrast, DEFAULT_SPINE, spineInk } from '../../lib/spine'
import type { BoardModel, MangaShelf, ShelfBook } from './shelf3d/mangaShelf'

export type { BoardModel }

const MAX_SERIES = 14
/** Candidates handed to the 3D shelf; it shows as many as fit in three quarters of its width. */
const MAX_SHELF_CANDIDATES = 60
const CHAPTERS_PER_BOOK = 20
const MAX_BOOKS = 5
/** Spines carrying cover art share one width, so the art sits in the same frame on every book. */
const ART_WIDTH = 46
const DARK = '#141210'
const BONE = '#f5efe4'

/** Display faces, with the average sideways advance per character in em, which decides whether a title fits. */
const FACES: [string, number][] = [
  ["'Dela Gothic One'", 0.95],
  ["'Rampart One'", 0.95],
  ["'Reggae One'", 0.95],
  ["'Train One'", 0.95],
  ["'Rubik Mono One'", 0.9],
  ["'Mochiy Pop One'", 0.95],
  ["'Potta One'", 0.95],
]

type Style = 'imprint' | 'type' | 'label' | 'twotone' | 'art'
const STYLES: Style[] = ['imprint', 'type', 'label', 'twotone', 'art']
type Shape = 'circle' | 'square' | 'diamond' | 'bare' | 'bar'
const SHAPES: Shape[] = ['circle', 'square', 'diamond', 'bare', 'bar']

/** Stable per series: the same series always draws the same style, face and shape. */
function pick(id: number, salt: string, n: number): number {
  let h = 2166136261
  for (const c of `${id}:${salt}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return (h >>> 0) % n
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16)
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((x) => Math.max(0, Math.min(255, Math.round(x * f))))
  return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('')
}

function isPale(hex: string): boolean {
  return contrast(hex, '#ffffff') < 2.2
}

/** Each volume a step lighter or darker than the last, like a publisher cycling the series colour. */
function tone(spine: string, i: number, n: number): string {
  if (n === 1) return spine
  return shade(spine, 1 + (i - (n - 1) / 2) * (isPale(spine) ? 0.05 : 0.07))
}

function sizeFor(title: string, room: number, width: number, adv: number, cap: number): [number, number] {
  const n = Math.max(title.length, 1)
  for (const [cols, lo] of [[1, 11], [2, 9], [3, 8]] as const) {
    if (cols > 1 && width < 16 * cols + 6) continue
    // Across the spine each column needs about 1.3em: the line box plus the display faces' overhang.
    const size = Math.min((room * cols) / n / adv, (width - 10) / (cols * 1.3))
    if (size >= lo) return [Math.min(cols === 1 ? cap : 15, size), cols]
  }
  return [8, 3]
}

/**
 * The title at the largest size that fits the room. A title too long for the spine falls back to
 * the short form a spine logo would use: the part before a colon or comma, then the first words.
 */
function fitTitle(title: string, room: number, width: number, adv: number, cap = 19): [string, number, number] {
  const [size, cols] = sizeFor(title, room, width, adv, cap)
  if (cols < 3 && size >= 9) return [title, size, cols]
  for (const cut of [':', ',']) {
    if (!title.includes(cut)) continue
    const short = title.split(cut)[0].trim()
    const [s, c] = sizeFor(short, room, width, adv, cap)
    if (s >= 9) return [short, s, c]
  }
  const words = title.split(/\s+/)
  while (words.length > 2) {
    words.pop()
    const short = words.join(' ')
    const [s, c] = sizeFor(short, room, width, adv, cap)
    if (s >= 10) return [short, s, c]
  }
  return [title, size, cols]
}

interface Book {
  n: number
  /** 0 to 1: how much of the chapters this book stands for have been read. */
  done: number
}

/** One book per 20 chapters, at most five; past a hundred chapters the five share them out. */
function booksFor(total: number, read: number): Book[] {
  const count = Math.min(MAX_BOOKS, Math.max(1, Math.ceil(total / CHAPTERS_PER_BOOK)))
  const per = Math.ceil(Math.max(total, 1) / count)
  return Array.from({ length: count }, (_, i) => {
    const lo = i * per
    const hi = Math.min(total, (i + 1) * per)
    return { n: i + 1, done: Math.max(0, Math.min(1, (read - lo) / Math.max(hi - lo, 1))) }
  })
}

function Numeral({ id, n, fg, bg }: { id: number; n: number; fg: string; bg: string }) {
  const shape = SHAPES[pick(id, 'shape', SHAPES.length)]
  const face = FACES[pick(id, 'numface', FACES.length)][0]
  return (
    <span className="spine-num" data-shape={shape} style={{ '--num-fg': fg, '--num-bg': bg, fontFamily: face } as CSSProperties}>
      {n}
    </span>
  )
}

function VTitle({ text, size, cols, face, color }: { text: string; size: number; cols: number; face: string; color: string }) {
  return (
    <span
      className="spine-book-title"
      data-wrap={cols > 1 || undefined}
      style={{ fontFamily: face, fontSize: size, color }}
    >
      {text}
    </span>
  )
}

/** Thickness of each book in a run. Cover-art spines share one width so the art sits in the same frame. */
function widthsFor(s: SeriesDto, style: Style, count: number): number[] {
  const art = style === 'art' && !!s.coverUrl
  return Array.from({ length: count }, (_, i) => (art ? ART_WIDTH : 26 + pick(s.id, `thick${i}`, 7) * 5))
}

function SpineBook({ s, book, index, count, style, height, width, fitWidth }: {
  s: SeriesDto
  book: Book
  index: number
  count: number
  style: Style
  height: number
  width: number
  /** The thinnest book in the run: every book is fitted to it so the run carries one title, not several. */
  fitWidth: number
}) {
  const base = s.spineColor ?? DEFAULT_SPINE
  const spine = tone(base, index, count)
  const ink = spineInk(spine)
  const [face, adv] = FACES[pick(s.id, 'face', FACES.length)]
  const art = style === 'art' && !!s.coverUrl
  const title = s.displayTitle
  let body: ReactNode
  let ground = spine

  if (style === 'twotone') {
    ground = pick(s.id, 'paper', 3) ? '#ece5d8' : BONE
    const text = isPale(base) ? '#1d1b19' : spine
    const [t, size, cols] = fitTitle(title, height - 80, fitWidth, adv)
    body = (
      <>
        <span className="spine-band" style={{ height: 40, background: spine }}>
          <Numeral id={s.id} n={book.n} fg={ink} bg={spine} />
        </span>
        <span className="spine-col" style={{ padding: '8px 0' }}>
          <VTitle text={t} size={size} cols={cols} face={face} color={text} />
        </span>
        <span className="spine-band" style={{ height: 12, background: spine }} />
      </>
    )
  } else if (style === 'label') {
    const dark = pick(s.id, 'label', 2) === 0
    const [t, size, cols] = fitTitle(title, height - 76, fitWidth - 8, adv)
    body = (
      <span className="spine-col">
        <Numeral id={s.id} n={book.n} fg={ink} bg={spine} />
        <span className="spine-label" style={{ width: width - 8, background: dark ? DARK : BONE }}>
          <VTitle text={t} size={size} cols={cols} face={face} color={dark ? BONE : DARK} />
        </span>
      </span>
    )
  } else if (style === 'type') {
    const [t, size, cols] = fitTitle(title, height - 64, fitWidth, adv, 24)
    const parts = [
      <Numeral key="n" id={s.id} n={book.n} fg={ink} bg={spine} />,
      <span key="r" className="spine-rule" style={{ background: ink }} />,
      <VTitle key="t" text={t} size={size} cols={cols} face={face} color={ink} />,
    ]
    body = <span className="spine-col">{pick(s.id, 'num', 2) === 0 ? parts : parts.reverse()}</span>
  } else if (art) {
    const plateHeight = Math.round((width - 8) * 1.42)
    const [t, size, cols] = fitTitle(title, height - plateHeight - 62, fitWidth, adv)
    body = (
      <>
        <span
          className="spine-art"
          style={{ width: width - 8, height: plateHeight, backgroundImage: `url(${s.coverUrl})` }}
        />
        <span className="spine-col" style={{ padding: '8px 0 10px' }}>
          <Numeral id={s.id} n={book.n} fg={ink} bg={spine} />
          <VTitle text={t} size={size} cols={cols} face={face} color={ink} />
        </span>
      </>
    )
  } else {
    const [t, size, cols] = fitTitle(title, height - 60, fitWidth, adv)
    body = (
      <span className="spine-col">
        <Numeral id={s.id} n={book.n} fg={ink} bg={spine} />
        <VTitle text={t} size={size} cols={cols} face={face} color={ink} />
      </span>
    )
  }

  return (
    <span
      className="spine-book"
      data-read={book.done >= 1 || undefined}
      style={{ width, height, background: ground, '--spine-edge': shade(ground, 0.72) } as CSSProperties}
    >
      {body}
    </span>
  )
}

/**
 * "Reading now" as a shelf: the series you are partway through, most recently read first. Each is
 * a short run of books (one per twenty chapters, at most five) in the colour sampled from its cover,
 * and books you have finished fade like spines left in the sun. The whole run is one target: a click
 * opens the next chapter to read, not a particular book.
 *
 * `board` is the library and reading figures. With one, the whole wall behind the books is a chalkboard
 * with the figures written on it at random places, so the books can hide some of them. The shelf then
 * shows even when nothing is in progress; without a board it renders nothing then.
 * Without WebGL the board becomes a plain panel under the flat spines.
 */
export function SpineShelf({ series, readTracking, board = null }: {
  series: SeriesDto[]
  readTracking: boolean
  board?: BoardModel | null
}) {
  const { t } = useLingui()
  const navigate = useNavigate()
  const scheme = useComputedColorScheme('dark')
  const { data: figureList } = useShelfFigures()
  const figureUrls = (figureList?.figures ?? []).map((f) => f.url)
  const figurePrefs = useShelfFigurePrefs()
  // Only a failure to start WebGL (or to load its chunk) drops to the flat spines.
  const [flat, setFlat] = useState(false)

  // Reading history decides, not files on disk: auto-delete removes read chapters' files, and a
  // count of read files would drop to zero and hide a series someone is halfway through.
  const reading = readTracking
    ? series
        .map((s) => ({ s, p: seriesProgressVisual(s, readTracking) }))
        .filter(({ s }) => s.readingStatus === 'Reading')
        .sort((a, b) => (b.s.lastReadAt ?? '').localeCompare(a.s.lastReadAt ?? ''))
        .slice(0, MAX_SHELF_CANDIDATES)
    : []
  if (reading.length === 0 && !board) return null

  // `settle` gives the 3D shelf's pull-out animation time to play; the lookup runs alongside it.
  const goTo = (id: number, settle = 0) =>
    void Promise.all([
      api<{ chapterId: number } | null>(`/reader/series/${id}/continue`).catch(() => null),
      new Promise((resolve) => setTimeout(resolve, settle)),
    ]).then(([next]) => navigate(next ? `/read/${next.chapterId}` : `/series/${id}`))

  const open = (e: MouseEvent, id: number) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    goTo(id)
  }

  const books: ShelfBook[] = reading.map(({ s, p }) => {
    const total = s.mainChapterCount || p.total || p.have
    const read = s.readMainChapters ?? s.readChapterCount ?? 0
    return {
      id: s.id,
      title: s.displayTitle,
      author: s.authorStory ?? s.authorArt ?? '',
      number: String(read + 1).padStart(2, '0'),
      width: 46 + Math.min(22, Math.round(total / 10)),
      height: 250 + pick(s.id, 'height', 6) * 9,
      coverUrl: s.coverUrl,
    }
  })

  return (
    <section className="spine-shelf" aria-label={t`Reading now`}>
      {flat ? (
        <>
          <FlatShelf
            reading={reading.slice(0, MAX_SERIES).map(({ s, p }) => ({ s, total: s.mainChapterCount || p.total || p.have }))}
            open={open}
          />
          {board && <FlatBoard board={board} />}
        </>
      ) : (
        <>
          <Shelf3D
            books={books}
            board={board}
            figures={figureUrls}
            figureChance={FIGURE_CHANCE[figurePrefs.frequency]}
            figureScale={FIGURE_SCALE[figurePrefs.size]}
            dark={scheme === 'dark'}
            onOpen={(id) => goTo(id, 500)}
            onFail={() => setFlat(true)}
          />
          {board && (
            <VisuallyHidden>
              {[...board.groups, ...(board.progress ? [{ heading: board.progress.heading, figures: board.progress.figures }] : [])].map((g) => (
                <dl key={g.heading} aria-label={g.heading}>
                  {g.figures.map((f) => (
                    <div key={f.label}>
                      <dt>{f.label}</dt>
                      <dd>{f.value}</dd>
                    </div>
                  ))}
                </dl>
              ))}
              {board.progress && <p>{board.progress.level}. {board.progress.caption}</p>}
            </VisuallyHidden>
          )}
        </>
      )}
    </section>
  )
}

const SHELF_THEMES = {
  dark: { wall: '#2b2723', shelf: '#5d4b39' },
  light: { wall: '#e0d9ca', shelf: '#b9a382' },
}

/**
 * The 3D shelf. Three.js and Matter.js arrive in their own chunk, loaded only when there is a shelf
 * to draw, and the canvas faces are only usable in a texture once their fonts have loaded.
 */
function Shelf3D({ books, board, figures, figureChance, figureScale, dark, onOpen, onFail }: {
  books: ShelfBook[]
  board: BoardModel | null
  /** URLs of the figure models the user has added. */
  figures: string[]
  /** How often one stands on the shelf (0 to 1), and how big, from the user's settings. */
  figureChance: number
  figureScale: number
  dark: boolean
  onOpen: (id: number) => void
  onFail: () => void
}) {
  const { t } = useLingui()
  const host = useRef<HTMLDivElement>(null)
  const shelf = useRef<MangaShelf | null>(null)
  const latest = useRef({ books, board, figures, figureChance, figureScale, dark, onOpen, onFail })
  latest.current = { books, board, figures, figureChance, figureScale, dark, onOpen, onFail }

  useEffect(() => {
    let cancelled = false
    void import('./shelf3d/mangaShelf')
      .then(async (module) => {
        // A face must have loaded before a texture is drawn with it, or the canvas falls back.
        const { SPINE_FONTS } = await import('./shelf3d/spineStyles')
        await Promise.all([...SPINE_FONTS, "'Fira Sans'"].map((f) => {
          const weighted = /^(\d{3})\s+(.*)$/.exec(f)
          return document.fonts.load(weighted ? `${weighted[1]} 24px ${weighted[2]}` : `24px ${f}`).catch(() => [])
        }))
        return module
      })
      .then(({ MangaShelf }) => {
        if (cancelled || !host.current) return
        const { books: b, board: bd, dark: d } = latest.current
        shelf.current = new MangaShelf(
          host.current,
          b,
          d ? SHELF_THEMES.dark : SHELF_THEMES.light,
          (id) => latest.current.onOpen(id),
          (book) => t`Continue ${book.title}`,
          bd,
          latest.current.figures,
          latest.current.figureChance,
          latest.current.figureScale,
        )
      })
      .catch(() => {
        if (!cancelled) latest.current.onFail()
      })
    return () => {
      cancelled = true
      shelf.current?.destroy()
      shelf.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const key = books.map((b) => `${b.id}:${b.number}`).join('|')
  useEffect(() => {
    shelf.current?.setBooks(latest.current.books)
  }, [key])
  useEffect(() => {
    shelf.current?.setTheme(dark ? SHELF_THEMES.dark : SHELF_THEMES.light)
  }, [dark])
  // The board is compared by its content: the page rebuilds the model on every render.
  const boardKey = JSON.stringify(board)
  useEffect(() => {
    shelf.current?.setBoard(latest.current.board)
  }, [boardKey])

  const figuresKey = figures.join('|')
  useEffect(() => {
    shelf.current?.setFigures(latest.current.figures)
  }, [figuresKey])

  return <div ref={host} className="shelf3d" data-board={board ? '' : undefined} />
}

/** The flat spines, kept for a browser that cannot start WebGL. */
function FlatShelf({ reading, open }: {
  reading: { s: SeriesDto; total: number }[]
  open: (e: MouseEvent, id: number) => void
}) {
  const { t } = useLingui()
  return (
    <div className="spine-shelf-row">
      {reading.map(({ s, total }) => {
        const books = booksFor(total, s.readMainChapters ?? s.readChapterCount ?? 0)
        const style = STYLES[pick(s.id, 'style', STYLES.length)]
        const height = 250 + pick(s.id, 'height', 5) * 9
        const seriesTitle = s.displayTitle
        const widths = widthsFor(s, style, books.length)
        const fitWidth = Math.min(...widths)
        return (
          <Link
            key={s.id}
            to={`/series/${s.id}`}
            className="spine-run"
            onClick={(e) => open(e, s.id)}
            aria-label={t`Continue ${seriesTitle}`}
            title={s.displayTitle}
          >
            {books.map((book, i) => (
              <SpineBook
                key={book.n}
                s={s}
                book={book}
                index={i}
                count={books.length}
                style={style}
                height={height}
                width={widths[i]}
                fitWidth={fitWidth}
              />
            ))}
          </Link>
        )
      })}
    </div>
  )
}

/** The board as a plain panel, for a browser that cannot start WebGL. */
function FlatBoard({ board }: { board: BoardModel }) {
  const columns = [
    ...board.groups,
    ...(board.progress
      ? [{ heading: board.progress.heading, figures: [{ label: board.progress.level, value: board.progress.caption }, ...board.progress.figures] }]
      : []),
  ]
  return (
    <div className="chalkboard-flat">
      <div className="chalkboard-flat-columns">
        {columns.map((g) => (
          <dl key={g.heading}>
            <dt className="chalkboard-flat-heading">{g.heading}</dt>
            {g.figures.map((f) => (
              <div key={f.label} className="chalkboard-flat-row" data-tone={('tone' in f && f.tone) || undefined}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </div>
  )
}
