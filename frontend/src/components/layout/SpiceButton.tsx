import { useState } from 'react'
import { ActionIcon, Group, Popover, Slider, Stack, Text, Tooltip } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { IconLeaf, IconPepper } from '@tabler/icons-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useAuth } from '../../auth/AuthProvider'
import { RATINGS, setSpice, useSpice } from '../../lib/spice'

function Spice({ level, size = 16 }: { level: number; size?: number }) {
  if (level === 0) return <IconLeaf size={size} color="var(--ok)" />
  return (
    <Group gap={0} wrap="nowrap">
      {Array.from({ length: level }, (_, i) => (
        <IconPepper key={i} size={size} color="var(--danger)" />
      ))}
    </Group>
  )
}

/**
 * How much "spice" to show on this device, from a leaf for safe up to three chillies for the most explicit.
 * It only narrows what this browser lists. The account's own content-rating setting is not changed.
 */
export function SpiceButton({ className }: { className?: string }) {
  const { t } = useLingui()
  const { me } = useAuth()
  const queryClient = useQueryClient()
  const level = useSpice()
  const [open, setOpen] = useState(false)

  const ceiling = RATINGS.indexOf((me?.maxContentRating ?? '') as (typeof RATINGS)[number])
  const top = ceiling >= 0 ? ceiling : RATINGS.length - 1
  const shown = Math.min(level, top)

  const names = [t`Safe`, t`Suggestive`, t`Erotica`, t`Explicit`]

  const choose = (next: number) => {
    setSpice(next)
    // Catalogue views are narrowed by the server, so they ask again.
    void queryClient.invalidateQueries()
  }

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-end" width={280} withArrow shadow="md">
      <Popover.Target>
        <Tooltip label={t`Content rating`} withArrow>
          <ActionIcon
            variant="subtle"
            color="gray"
            className={className}
            aria-label={t`Content rating`}
            onClick={() => setOpen((v) => !v)}
          >
            {shown === 0 ? <IconLeaf size={19} /> : <IconPepper size={19} />}
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <Group justify="space-between" wrap="nowrap">
            <Text fw={600} size="sm">
              {names[shown]}
            </Text>
            <Spice level={shown} />
          </Group>
          <Slider
            min={0}
            max={top}
            step={1}
            value={shown}
            onChange={choose}
            label={null}
            marks={Array.from({ length: top + 1 }, (_, i) => ({ value: i, label: <Spice level={i} size={14} /> }))}
            mb="lg"
            aria-label={t`Content rating`}
          />
          <Text size="xs" c="dimmed">
            <Trans>Only changes what this device shows. Your account's content rating setting is not affected.</Trans>
          </Text>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
