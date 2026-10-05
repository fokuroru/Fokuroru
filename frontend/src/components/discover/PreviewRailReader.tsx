import { useEffect, useRef } from 'react'
import { notifications } from '@mantine/notifications'
import { useLingui } from '@lingui/react/macro'
import { useQueryClient } from '@tanstack/react-query'
import { useRecommendationDetail, type RecommendationItem } from '../../api/hooks'
import { deleteSeriesPreview, releaseSeriesPreview, useStartSeriesPreview } from '../../api/preview'
import { SeriesPreviewReader } from './SeriesPreviewReader'

/**
 * Opens a cached preview straight in the reader, from the start, without the Discover card in
 * between. At the end the reader offers going home, deleting the preview, or adding the series;
 * adding hands over to the card, which owns the root folder and source choices.
 */
export function PreviewRailReader({
  item,
  onClose,
  onAdd,
}: {
  item: RecommendationItem
  onClose: () => void
  onAdd: (item: RecommendationItem) => void
}) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const { data: detail } = useRecommendationDetail(item.providerId)
  const { mutate: start, isSuccess, isError } = useStartSeriesPreview()

  // Registers this viewer with the server; the snapshot endpoint answers nothing until then.
  useEffect(() => {
    start(item.providerId)
  }, [item.providerId, start])

  // Released on a timer so StrictMode's mount, unmount, mount in dev keeps the job alive.
  const releaseTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    window.clearTimeout(releaseTimer.current)
    return () => {
      releaseTimer.current = window.setTimeout(() => releaseSeriesPreview(item.providerId), 0)
    }
  }, [item.providerId])

  useEffect(() => {
    if (!isError) return
    notifications.show({ color: 'red', message: t`The preview could not be opened.` })
    onClose()
  }, [isError, onClose, t])

  if (!isSuccess) return null

  const remove = async () => {
    try {
      await deleteSeriesPreview(item.providerId)
      await queryClient.invalidateQueries({ queryKey: ['series-previews', 'cached'] })
      onClose()
    } catch {
      notifications.show({ color: 'red', message: t`The preview could not be deleted.` })
    }
  }

  return (
    <SeriesPreviewReader
      providerId={item.providerId}
      title={item.title}
      coverUrl={item.coverUrl ?? null}
      seriesType={detail?.type ?? null}
      onClose={onClose}
      endActions={{ onHome: onClose, onDelete: remove, onAdd: () => onAdd(item) }}
    />
  )
}
