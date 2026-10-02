import { ActionIcon, Loader, Tooltip } from '@mantine/core'
import { IconDeviceMobileCheck, IconDeviceMobileDown, IconRefresh } from '@tabler/icons-react'
import { t } from '@lingui/core/macro'
import { nativeApp, removeFromDevice, saveToDevice, useNativeDownloads } from '../lib/nativeApp'

/**
 * Keeps a chapter on this device for offline reading. Only the Android app can do that, so in a
 * browser it renders nothing.
 */
export default function DeviceSaveButton({ chapterId, label }: { chapterId: number; label: string }) {
  const saved = useNativeDownloads().get(chapterId)
  if (!nativeApp()) return null

  if (saved?.state === 'done') {
    return (
      <Tooltip label={t`Saved on this device. Tap to remove it`} withArrow>
        <ActionIcon
          variant="subtle"
          color="brand"
          onClick={() => removeFromDevice([chapterId])}
          aria-label={t`Remove ${label} from this device`}
        >
          <IconDeviceMobileCheck size={17} />
        </ActionIcon>
      </Tooltip>
    )
  }

  if (saved?.state === 'queued' || saved?.state === 'downloading') {
    const progress = saved.pageCount > 0 ? `${saved.pagesDone}/${saved.pageCount}` : ''
    return (
      <Tooltip label={progress ? t`Saving to this device, ${progress}` : t`Waiting to save to this device`} withArrow>
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={() => removeFromDevice([chapterId])}
          aria-label={t`Cancel saving ${label}`}
        >
          <Loader size={15} />
        </ActionIcon>
      </Tooltip>
    )
  }

  const failed = saved?.state === 'failed'
  return (
    <Tooltip label={failed ? t`Saving failed. Tap to retry` : t`Save to this device`} withArrow>
      <ActionIcon
        variant="subtle"
        color={failed ? 'red' : 'gray'}
        onClick={() => saveToDevice([chapterId])}
        aria-label={t`Save ${label} to this device`}
      >
        {failed ? <IconRefresh size={17} /> : <IconDeviceMobileDown size={17} />}
      </ActionIcon>
    </Tooltip>
  )
}
