import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Group, Loader, Progress, Stack, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { Trans, useLingui } from '@lingui/react/macro'
import { useLingui as useLinguiRuntime } from '@lingui/react'
import { api } from '../../api/client'
import { queueErrorMessage } from '../../api/queue'
import type { QueueItemDto } from '../../api/types'

interface DownloadState {
  downloaded: boolean
  item: QueueItemDto | null
}

const POLL_MS = 1000

/**
 * "Download & read": a full-screen splash that queues one chapter, shows it coming down, and
 * opens the reader the moment it is on disk. Closing it only stops watching; the download carries
 * on in the queue like any other.
 */
export function DownloadSplash({
  chapterId,
  chapterLabel,
  seriesTitle,
  coverUrl,
  note,
  onClose,
}: {
  chapterId: number
  chapterLabel: string | null
  seriesTitle: string
  coverUrl: string | null
  note?: string
  onClose: () => void
}) {
  const { t } = useLingui()
  const { _ } = useLinguiRuntime()
  const navigate = useNavigate()
  const location = useLocation()

  // A query rather than a mutation, keyed per attempt: it runs once per attempt however often the
  // component mounts (StrictMode mounts twice), and its error state belongs to the splash rather
  // than to whichever mount fired it. The POST is idempotent server-side anyway.
  const [attempt, setAttempt] = useState(0)
  const prepare = useQuery({
    queryKey: ['chapter-prepare', chapterId, attempt],
    queryFn: () => api<DownloadState>(`/reader/chapters/${chapterId}/prepare`, { method: 'POST' }),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    meta: { silent: true },
  })

  const { data: polled } = useQuery({
    queryKey: ['chapter-download-state', chapterId],
    queryFn: () => api<DownloadState>(`/reader/chapters/${chapterId}/download-state`),
    enabled: prepare.isSuccess && !prepare.data.downloaded,
    refetchInterval: (query) => (query.state.data?.downloaded ? false : POLL_MS),
    gcTime: 0,
  })
  const state = polled ?? prepare.data

  useEffect(() => {
    if (state?.downloaded) navigate(`/read/${chapterId}`, { replace: true, state: location.state })
  }, [state?.downloaded, chapterId, navigate, location.state])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const item = state?.item ?? null
  const failed = prepare.isError || item?.status === 'Failed' || item?.status === 'Cancelled'
  const pagesTotal = item?.pagesTotal ?? 0
  const pagesDone = item?.pagesDone ?? 0
  const pct = pagesTotal > 0 ? Math.round((pagesDone / pagesTotal) * 100) : null

  let status: string
  if (prepare.isError) {
    // The server's own reason (no source linked, a health review running) minus the "API 400:" prefix.
    status =
      prepare.error instanceof Error
        ? prepare.error.message.replace(/^API \d+:\s*/, '')
        : t`Could not queue the chapter.`
  } else if (state?.downloaded || item?.status === 'Completed') {
    status = t`Opening the reader…`
  } else if (!item) {
    status = t`Queuing the chapter…`
  } else {
    switch (item.status) {
      case 'Resolving':
        status = t`Finding a source…`
        break
      case 'Queued':
        status = t`Waiting its turn in the download queue…`
        break
      case 'RateLimited':
        status = t`The source asked us to slow down. Waiting to try again…`
        break
      case 'FetchingPages':
        status = t`Fetching the page list…`
        break
      case 'Downloading':
        status = pagesTotal > 0 ? t`Downloading page ${pagesDone} of ${pagesTotal}` : t`Downloading…`
        break
      case 'Validating':
      case 'Packaging':
        status = t`Packing the pages…`
        break
      case 'Importing':
        status = t`Adding it to your library…`
        break
      case 'AwaitingImport':
        status = t`The download needs a decision before it can be imported. Check Activity.`
        break
      case 'Failed':
        status = queueErrorMessage(item, _) ?? t`The download failed.`
        break
      case 'Cancelled':
        status = t`The download was cancelled.`
        break
      default:
        status = t`Working…`
    }
  }

  return (
    <div className="download-splash" role="dialog" aria-modal="true" aria-label={t`Download and read`}>
      {coverUrl && <div className="download-splash-art" style={{ backgroundImage: `url(${coverUrl})` }} aria-hidden />}
      <Stack className="download-splash-body" gap="md" align="center">
        {coverUrl && <img className="download-splash-cover" src={coverUrl} alt="" />}
        <div>
          <Text className="download-splash-series">{seriesTitle}</Text>
          {chapterLabel && <Text className="download-splash-chapter">{chapterLabel}</Text>}
        </div>
        {note && <Text size="sm">{note}</Text>}
        <div className="download-splash-progress">
          {failed ? null : pct !== null ? (
            <Progress value={pct} size="md" radius={0} aria-label={t`Download progress`} />
          ) : (
            <Group justify="center">
              <Loader size="sm" type="dots" />
            </Group>
          )}
          <Text className="download-splash-status tnum" data-failed={failed || undefined} aria-live="polite">
            {status}
          </Text>
        </div>
        <Group gap="sm" justify="center">
          {failed && (
            <Button onClick={() => setAttempt((a) => a + 1)} loading={prepare.isFetching}>
              <Trans>Try again</Trans>
            </Button>
          )}
          <Button variant="default" onClick={onClose}>
            {failed ? <Trans>Close</Trans> : <Trans>Keep downloading in the background</Trans>}
          </Button>
        </Group>
      </Stack>
    </div>
  )
}
