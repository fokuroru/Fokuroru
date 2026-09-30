import { Title } from '@mantine/core'
import type { Icon } from '@tabler/icons-react'

/**
 * The heading above a rail or grid: the title, an optional count, a rule running to the optional
 * right-aligned action ("Find more", "Refresh") and, at the far end, the slot the rail below it fills
 * with its prev/next arrows (see `Rail`). `icon` is accepted and not drawn: the Spine look sets
 * headings by type alone, with no icon beside them. The rule is the tag buckets' idiom at
 * section scale: it ties the title to its action and gives a run of rails a line to read down.
 *
 * Shared by Discover, the series page's related rail and the Home dashboard, which is why `count`
 * is optional: Home's rails already say how many items they hold by showing them. `chevron` adds the
 * trailing arrow for a single text action that opens a bigger view.
 */
export function SectionHeader({
  title,
  count,
  action,
  chevron,
}: {
  icon?: Icon
  title: string
  count?: number
  action?: React.ReactNode
  chevron?: boolean
}) {
  return (
    <div className="section-header">
      <Title order={2} className="section-header-title">
        {title}
      </Title>
      {count != null && <span className="section-header-count tnum">{count}</span>}
      <span className="section-header-rule" aria-hidden />
      {action && (
        <div className="section-header-action" data-chevron={chevron || undefined}>
          {action}
        </div>
      )}
      <div className="section-header-arrows" />
    </div>
  )
}
