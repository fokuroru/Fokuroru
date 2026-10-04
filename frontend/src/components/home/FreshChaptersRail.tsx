import { memo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { IconPlayerPlayFilled } from '@tabler/icons-react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { HomeFreshItem } from '../../api/hooks'
import { Rail } from '../ui/Rail'
import { relativeTime } from '../ui/time'

/**
 * New chapters for series the reader had caught up on. Same cards as Recently added; Read opens the
 * oldest new chapter. The server drops a series once its new chapters are read or deleted, or after a week.
 */
export function FreshChaptersRail({ items }: { items: HomeFreshItem[] }) {
  return (
    <Rail>
      {items.map((item) => (
        <div key={item.seriesId} className="discover-rail-item">
          <FreshCard item={item} />
        </div>
      ))}
    </Rail>
  )
}

const FreshCard = memo(function FreshCard({ item }: { item: HomeFreshItem }) {
  const navigate = useNavigate()
  const { t } = useLingui()
  const openReader = (e: React.SyntheticEvent) => {
    e.preventDefault()
    e.stopPropagation()
    navigate(`/read/${item.chapterId}`)
  }

  return (
    <Link to={`/series/${item.seriesId}`} className="cover-card" aria-label={item.seriesTitle}>
      <div className="cover-poster">
        {item.coverUrl ? (
          <img src={item.coverUrl} alt={item.seriesTitle} loading="lazy" decoding="async" />
        ) : (
          <div className="cover-placeholder">{item.seriesTitle}</div>
        )}
        <div className="cover-scrim" />

        <div className="cover-corners">
          <div className="cover-corner cover-corner-right">
            {/* Nested inside a Link, so this navigates imperatively and stops the card's own navigation. */}
            <span
              className="cover-chapter home-read-badge"
              role="button"
              tabIndex={0}
              data-tip={t`Read the new chapter`}
              aria-label={t`Read the new chapter`}
              onClick={openReader}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') openReader(e)
              }}
            >
              <IconPlayerPlayFilled size={10} />
              <span>
                <Trans>Read</Trans>
              </span>
            </span>
          </div>
        </div>

        <div className="cover-meta">
          <span className="cover-chapter">
            <span>{item.chapterLabel}</span>
          </span>
          <span className="cover-title" title={item.seriesTitle}>
            {item.seriesTitle}
          </span>
          <div className="cover-row">
            <span>{relativeTime(item.discoveredAt)}</span>
            {item.newChapterCount > 1 && <span className="cover-new">+{item.newChapterCount - 1}</span>}
          </div>
        </div>
      </div>
    </Link>
  )
})
