import { useMemo } from 'react'
import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'
import { useSources } from './api/hooks'
import { useLabel } from './i18n-context'

/**
 * Keys that show up in the same slot as a source name but aren't a registered `ISource`: a queue
 * item with no resolved `SourceMapping` (`QueueController`), a torrent grab with no per-site
 * mapping, and a `ChapterFile.SourceName` sentinel for a file the user brought in from disk or a
 * rescan turned up (`downloads.md`).
 */
const SPECIAL_SOURCE_LABELS: Record<string, MessageDescriptor> = {
  import: msg`Imported`,
  rescan: msg`Rescan`,
  torrent: msg`Torrent`,
  Manual: msg`Manual`,
  '?': msg`Unresolved`,
}

/**
 * A Suwayomi extension's name is `suwayomi-` and Suwayomi's own source id, a number that means
 * nothing to anyone. The list normally has a proper name for it; this is for one that has since
 * been uninstalled or not been listed yet.
 */
const SUWAYOMI_SOURCE_LABEL = msg`Suwayomi source`

/**
 * Display name for a raw source/origin key, as it shows up on download-queue rows, the series
 * Sources table and the library's "Downloaded from" facet: a registered source's `displayName`,
 * one of the sentinels above, `<indexer> · Torrent` for a grabbed release, or the raw key itself
 * when nothing matches (a source since removed from the registry still has to show something).
 * An uninstalled Suwayomi extension reads "Suwayomi source" rather than its numeric key.
 */
export function useSourceLabel(): (key: string) => string {
  const { data: sources } = useSources()
  const renderLabel = useLabel()
  return useMemo(() => {
    return (key: string) => {
      const known = sources?.find((s) => s.name === key)?.displayName
      if (known) return known
      if (key.startsWith('torrent:')) {
        const indexer = key.slice('torrent:'.length)
        if (indexer) return renderLabel(msg`${indexer} · Torrent`)
        return renderLabel(SPECIAL_SOURCE_LABELS.torrent)
      }
      if (/^suwayomi-/.test(key)) return renderLabel(SUWAYOMI_SOURCE_LABEL)
      return renderLabel(SPECIAL_SOURCE_LABELS[key] ?? key)
    }
  }, [sources, renderLabel])
}
