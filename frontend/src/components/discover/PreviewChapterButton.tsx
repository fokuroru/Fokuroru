import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Button, Loader, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconBook, IconCircleCheckFilled, IconRefresh, IconTrash } from '@tabler/icons-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useQueryClient } from '@tanstack/react-query'
import { deleteSeriesPreview, releaseSeriesPreview, useSeriesPreview, useStartSeriesPreview } from '../../api/preview'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useAuth } from '../../auth/AuthProvider'
import { previewCacheKey, readPreviewCache, writePreviewCache } from '../../api/previewCache'

/**
 * Starts fetching chapter 1 on click and leaves the user on the card while it runs, so they can read
 * the tags and reviews in the meantime. Once the pages are in, the same button opens the reader.
 * Mounted per series: closing releases the viewer while keeping the preview for 30 days.
 */
export function PreviewChapterButton({
  providerId,
  title,
  onRead,
}: {
  providerId: string
  title: string
  onRead: () => void
}) {
  const { t } = useLingui()
  const { me } = useAuth()
  const cacheKey = previewCacheKey(me?.id, providerId, 'chapter-enabled')
  const [remembered] = useState(() => readPreviewCache<boolean>(cacheKey)?.data === true)
  const queryClient = useQueryClient()
  const { mutate: start, reset, error: startError, isPending: starting, isSuccess: started } = useStartSeriesPreview()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { data: preview, isError: lost } = useSeriesPreview(providerId, started)
  const restoring = useRef(false)
  useEffect(() => {
    if (remembered && !restoring.current) {
      restoring.current = true
      start(providerId)
    }
  }, [remembered, providerId, start])

  // Released on a timer so StrictMode's mount, unmount, mount in dev keeps the job alive.
  const releaseTimer = useRef<number | undefined>(undefined)
  const notificationId = `series-preview-${providerId}`
  useEffect(() => {
    window.clearTimeout(releaseTimer.current)
    return () => {
      notifications.hide(notificationId)
      releaseTimer.current = window.setTimeout(() => releaseSeriesPreview(providerId), 0)
    }
  }, [providerId, notificationId])

  const status = starting ? 'starting' : started ? preview?.status : undefined
  const failure =
    startError?.message ??
    (lost ? t`The preview expired. Try again.` : null) ??
    (status === 'failed' ? (preview?.error ?? t`No source could serve the first chapter.`) : null)

  const read = () => {
    notifications.hide(notificationId)
    onRead()
  }

  // Only a job that finished while the user waited gets a notification. One that was already
  // ready when the button was pressed opens
  // straight away, since there is nothing to announce.
  const lastStatus = useRef<string | undefined>(undefined)
  useEffect(() => {
    const previous = lastStatus.current
    lastStatus.current = status
    if (status !== 'ready' || previous === 'ready') return
    if (remembered) return
    if (previous === 'starting') {
      onRead()
      return
    }
    const chapterLabel = preview?.chapterLabel
    notifications.show({
      id: notificationId,
      color: 'var(--ok)',
      icon: <IconCircleCheckFilled size={16} />,
      title: t`First chapter ready`,
      message: (
        <Stack gap={6} align="flex-start">
          <Text size="sm">
            {chapterLabel ? (
              <Trans>
                Chapter {chapterLabel} of {title} is ready to read.
              </Trans>
            ) : (
              <Trans>The first chapter of {title} is ready to read.</Trans>
            )}
          </Text>
          <Button size="compact-xs" variant="light" onClick={read}>
            <Trans>Read now</Trans>
          </Button>
        </Stack>
      ),
    })
    // `read` and `onRead` are fresh every render; only the transition matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const source = preview?.sourceDisplayName ?? null
  const pageCount = preview?.pageCount ?? 0
  const donePages = preview?.ready.filter(Boolean).length ?? 0
  const working = !failure && (status === 'starting' || status === 'searching' || status === 'fetching')

  let label: React.ReactNode
  let caption: React.ReactNode = null
  let progress: number | null = null
  if (failure) {
    label = <Trans>Try the preview again</Trans>
    caption = failure
  } else if (status === 'ready') {
    label = <Trans>Read first chapter</Trans>
    caption = source ? <Trans>Downloaded from {source}</Trans> : null
  } else if (status === 'fetching' && pageCount > 0) {
    label = (
      <Trans>
        Downloading, {donePages} of {pageCount} pages
      </Trans>
    )
    caption = source ? <Trans>From {source}. You can keep browsing while it downloads.</Trans> : null
    progress = donePages / pageCount
  } else if (working) {
    label = <Trans>Finding a source…</Trans>
    caption = <Trans>You can keep browsing while it looks.</Trans>
  } else {
    label = <Trans>Preview first chapter</Trans>
  }

  const onClick = () => {
    if (working) return
    if (status === 'ready' && !failure) read()
    else {
      writePreviewCache(cacheKey, true)
      start(providerId)
    }
  }

  const discard = async () => {
    setDeleting(true)
    try {
      await deleteSeriesPreview(providerId)
      // Forget it everywhere this device remembers it, or the card would fetch it again on its own.
      writePreviewCache(cacheKey, false)
      reset()
      queryClient.removeQueries({ queryKey: ['series-preview', providerId] })
      void queryClient.invalidateQueries({ queryKey: ['series-previews'] })
      notifications.show({ message: t`Preview deleted`, color: 'var(--ok)' })
      setConfirmDelete(false)
    } catch (error) {
      notifications.show({ message: error instanceof Error ? error.message : t`Could not delete the preview`, color: 'var(--danger)' })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Stack gap={4}>
      <Button
        className="preview-chapter-button"
        data-working={working || undefined}
        data-indeterminate={working && progress == null ? true : undefined}
        aria-disabled={working || undefined}
        variant={status === 'ready' && !failure ? 'filled' : 'default'}
        fullWidth
        leftSection={
          working ? (
            <Loader size={14} color="var(--brand)" />
          ) : failure ? (
            <IconRefresh size={16} />
          ) : (
            <IconBook size={16} />
          )
        }
        style={progress != null ? ({ '--preview-progress': `${Math.round(progress * 100)}%` } as CSSProperties) : undefined}
        onClick={onClick}
      >
        <span className="tnum">{label}</span>
      </Button>
      <Text
        size="xs"
        ta="center"
        c={failure ? 'var(--danger)' : 'var(--ink-4)'}
        aria-live="polite"
      >
        {caption}
      </Text>
      {status === 'ready' && !failure && (
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          leftSection={<IconTrash size={13} />}
          onClick={() => setConfirmDelete(true)}
        >
          <Trans>Delete downloaded preview</Trans>
        </Button>
      )}
      <ConfirmDialog
        opened={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={<Trans>Delete this preview?</Trans>}
        confirmLabel={<Trans>Delete</Trans>}
        onConfirm={() => void discard()}
        loading={deleting}
      >
        <Trans>
          The downloaded first chapter of {title} is removed for everyone on this server. You can preview it again later.
        </Trans>
      </ConfirmDialog>
    </Stack>
  )
}
