import { Link } from 'react-router-dom'
import { Trans, useLingui } from '@lingui/react/macro'
import type { SeriesDto } from '../../api/types'
import { seriesProgressVisual } from '../ui/status'
import { DEFAULT_SPINE, spineInk } from '../../lib/spine'

const MAX_SPINES = 14

/**
 * "Reading now" as a shelf of spines: the series you are partway through, each a block in the
 * colour sampled from its cover with its title running top to bottom. Height follows the chapter
 * count and width the volume count, so a long series reads as a thick book, the way it would on a
 * real shelf. Renders nothing when nothing is in progress.
 */
export function SpineShelf({ series, readTracking }: { series: SeriesDto[]; readTracking: boolean }) {
  const { t } = useLingui()
  if (!readTracking) return null

  const reading = series
    .map((s) => ({ s, p: seriesProgressVisual(s, readTracking) }))
    .filter(({ s, p }) => (s.readChapterCount ?? 0) > 0 && (p.unread ?? 0) > 0)
    .slice(0, MAX_SPINES)
  if (reading.length === 0) return null

  const maxChapters = Math.max(...reading.map(({ p }) => p.total || p.have), 1)

  return (
    <section className="spine-shelf" aria-label={t`Reading now`}>
      <div className="spine-shelf-label">
        <Trans>Reading now</Trans>
      </div>
      <div className="spine-shelf-row">
        {reading.map(({ s, p }) => {
          const spine = s.spineColor ?? DEFAULT_SPINE
          const chapters = p.total || p.have
          const height = 180 + Math.round((80 * chapters) / maxChapters)
          const width = 36 + Math.min(20, Math.round((s.totalVolumes ?? 4) * 1.2))
          const unread = p.unread ?? 0
          return (
            <Link
              key={s.id}
              to={`/series/${s.id}`}
              className="spine-book"
              style={{ height, width, background: spine, color: spineInk(spine) }}
              title={s.displayTitle}
            >
              <span className="spine-book-title">{s.displayTitle}</span>
              <span className="spine-book-count tnum" aria-label={t`${unread} unread`}>
                {unread}
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
