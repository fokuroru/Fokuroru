import { Button, Drawer, Stack } from '@mantine/core'
import { IconBookmarkPlus, IconInfoCircle, IconTrash } from '@tabler/icons-react'
import { Trans } from '@lingui/react/macro'
import type { RecommendationItem } from '../../api/hooks'

export type PreviewAction = 'info' | 'subscribe' | 'delete'

/** What a held preview offers: its series info, adding it to the library, or deleting the downloaded chapter. */
export function PreviewSheet({
  item,
  onClose,
  onAction,
}: {
  item: RecommendationItem | null
  onClose: () => void
  onAction: (action: PreviewAction, item: RecommendationItem) => void
}) {
  return (
    <Drawer opened={item !== null} onClose={onClose} position="bottom" size={250} title={item?.title} radius="lg" zIndex={400}>
      {item && (
        <Stack gap="xs" pb="md">
          <Button variant="default" size="md" justify="flex-start" leftSection={<IconInfoCircle size={18} />} onClick={() => onAction('info', item)}>
            <Trans>Series info</Trans>
          </Button>
          <Button variant="default" size="md" justify="flex-start" leftSection={<IconBookmarkPlus size={18} />} onClick={() => onAction('subscribe', item)}>
            <Trans>Subscribe</Trans>
          </Button>
          <Button
            variant="default"
            size="md"
            color="var(--danger-fill)"
            justify="flex-start"
            leftSection={<IconTrash size={18} />}
            onClick={() => onAction('delete', item)}
          >
            <Trans>Delete preview</Trans>
          </Button>
        </Stack>
      )}
    </Drawer>
  )
}
