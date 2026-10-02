import { Button, Checkbox, Drawer, Group, Loader, Stack, Text } from '@mantine/core'
import { IconBook2, IconDeviceDesktop, IconDeviceMobileDown } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trans, useLingui } from '@lingui/react/macro'
import { useChapters } from '../../api/hooks'
import DeviceSaveButton from '../DeviceSaveButton'
import { nativeApp, saveToDevice, useNativeDownloads } from '../../lib/nativeApp'
import { labelOf } from '../../pages/SeriesOpenPage'

export interface SheetSeries {
  id: number
  title: string
}

/**
 * What a held cover offers: the series page in the desktop view, reading it, or, in the app, choosing
 * which of the chapters on the server to keep on the device.
 */
export function SeriesSheet({ series, onClose }: { series: SheetSeries | null; onClose: () => void }) {
  const { t } = useLingui()
  const navigate = useNavigate()
  const [stage, setStage] = useState<'menu' | 'chapters'>('menu')
  const native = nativeApp()

  const close = () => {
    onClose()
    setStage('menu')
  }

  return (
    <Drawer
      opened={series !== null}
      onClose={close}
      position="bottom"
      size={stage === 'chapters' ? '80%' : 250}
      title={series?.title}
      radius="lg"
      zIndex={400}
    >
      {series && stage === 'menu' && (
        <Stack gap="xs" pb="md">
          <Button
            variant="default"
            size="md"
            justify="flex-start"
            leftSection={<IconBook2 size={18} />}
            onClick={() => navigate(`/open/${series.id}`, { state: { lite: true } })}
          >
            <Trans>Read</Trans>
          </Button>
          {native && (
            <Button variant="default" size="md" justify="flex-start" leftSection={<IconDeviceMobileDown size={18} />} onClick={() => setStage('chapters')}>
              <Trans>Download</Trans>
            </Button>
          )}
          <Button
            variant="default"
            size="md"
            justify="flex-start"
            leftSection={<IconDeviceDesktop size={18} />}
            onClick={() => navigate(`/series/${series.id}`)}
            aria-label={t`Series info in the desktop view`}
          >
            <Trans>Series info (desktop view)</Trans>
          </Button>
        </Stack>
      )}
      {series && stage === 'chapters' && <ChapterPicker seriesId={series.id} onDone={close} />}
    </Drawer>
  )
}

function ChapterPicker({ seriesId, onDone }: { seriesId: number; onDone: () => void }) {
  const chapters = useChapters(seriesId)
  const saved = useNativeDownloads()
  const [picked, setPicked] = useState<Set<number>>(new Set())

  const available = useMemo(
    () =>
      (chapters.data ?? [])
        .filter((c) => c.hasFile)
        .sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.id - b.id),
    [chapters.data],
  )
  const selectable = available.filter((c) => !saved.has(c.id))

  const toggle = (id: number) =>
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (chapters.isPending) {
    return (
      <Group justify="center" py="xl">
        <Loader size="sm" />
      </Group>
    )
  }
  if (available.length === 0) {
    return (
      <Text c="dimmed" size="sm" py="md">
        <Trans>No chapters are on the server for this series.</Trans>
      </Text>
    )
  }

  return (
    <Stack gap="xs" pb="md">
      <Group justify="space-between">
        <Button
          variant="subtle"
          size="compact-sm"
          onClick={() => setPicked(picked.size === selectable.length ? new Set() : new Set(selectable.map((c) => c.id)))}
          disabled={selectable.length === 0}
        >
          {picked.size === selectable.length && picked.size > 0 ? <Trans>Clear</Trans> : <Trans>Select all</Trans>}
        </Button>
        <Button
          size="compact-md"
          disabled={picked.size === 0}
          onClick={() => {
            saveToDevice([...picked])
            onDone()
          }}
        >
          <Trans>Save {picked.size} to this device</Trans>
        </Button>
      </Group>
      {available.map((c) => {
        const on = saved.has(c.id)
        return (
          <Group key={c.id} justify="space-between" wrap="nowrap" py={4}>
            <Checkbox
              checked={on || picked.has(c.id)}
              disabled={on}
              onChange={() => toggle(c.id)}
              label={labelOf(c)}
              size="md"
            />
            {on && <DeviceSaveButton chapterId={c.id} label={labelOf(c)} />}
          </Group>
        )
      })}
    </Stack>
  )
}
