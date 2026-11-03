import { useEffect, useState } from 'react'
import { Button, Divider, Group, Select, Stack, Switch, Text } from '@mantine/core'
import { IconPlayerPause, IconPlayerPlay } from '@tabler/icons-react'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { SettingsSection } from './SettingsSection'
import { formatBytes } from '../../format'
import {
  PAGE_CONVERSION_STOPS,
  usePageConversion,
  usePausePageConversion,
  useSavePageConversion,
  useStartPageConversion,
  type PageConversionFormat,
  type PageConversionStop,
} from '../../api/pageConversion'

/** Stores chapter pages as WebP or AVIF: the format and quality, and the pass over files already on disk. */
export function PageConversionSection() {
  const { t } = useLingui()
  const { data: status } = usePageConversion()
  const save = useSavePageConversion()
  const start = useStartPageConversion()
  const pause = usePausePageConversion()
  const [format, setFormat] = useState<PageConversionFormat | 'off'>('off')
  const [stop, setStop] = useState<PageConversionStop>('high')
  const [pngLossless, setPngLossless] = useState(false)

  useEffect(() => {
    if (!status) return
    setFormat(status.settings.format ?? 'off')
    setStop(status.settings.stop)
    setPngLossless(status.settings.pngLossless)
  }, [status?.settings.format, status?.settings.stop, status?.settings.pngLossless]) // eslint-disable-line react-hooks/exhaustive-deps

  const stopLabels: Record<PageConversionStop, string> = {
    smallest: t`Smallest: screentone is smoothed away`,
    compact: t`Compact: screentone gets lighter`,
    balanced: t`Balanced: fine at fit-to-screen`,
    high: t`High: no difference we could see`,
    lossless: t`Lossless: identical pixels`,
  }
  const dirty =
    status != null &&
    (format !== (status.settings.format ?? 'off') ||
      stop !== status.settings.stop ||
      pngLossless !== status.settings.pngLossless)
  const off = format === 'off'

  return (
    <SettingsSection
      id="page-conversion"
      title={<Trans>Page conversion</Trans>}
      description={<Trans>Stores chapter pages in a smaller image format. New downloads are converted as they arrive.</Trans>}
    >
      {status && (
        <Stack>
          <Select
            label={t`Format`}
            description={t`WebP opens in every reader. AVIF does not open in KOReader or on iOS before 16.`}
            data={[
              { value: 'off', label: t`Off` },
              { value: 'webp', label: 'WebP' },
              { value: 'avif', label: 'AVIF' },
            ]}
            value={format}
            onChange={(v) => setFormat((v as PageConversionFormat | 'off' | null) ?? 'off')}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
          <Select
            label={t`Quality`}
            data={PAGE_CONVERSION_STOPS.map((value) => ({ value, label: stopLabels[value] }))}
            value={stop}
            onChange={(v) => setStop((v as PageConversionStop | null) ?? 'high')}
            disabled={off}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
          <Switch
            label={t`Keep PNG pages lossless`}
            checked={pngLossless}
            onChange={(e) => setPngLossless(e.currentTarget.checked)}
            disabled={off}
          />
          <Group>
            <Button
              size="xs"
              disabled={!dirty}
              loading={save.isPending}
              onClick={() => save.mutate({ format: off ? null : format, stop, pngLossless })}
            >
              <Trans>Save</Trans>
            </Button>
          </Group>

          <Divider />
          <Group justify="space-between" wrap="wrap" gap="sm">
            <Stack gap={2}>
              <Text fw={500} size="sm">
                <Trans>Existing library</Trans>
              </Text>
              <Text size="xs" c="var(--ink-3)">
                <Plural
                  value={status.library.convertedFiles}
                  one="# file converted, saving"
                  other="# files converted, saving"
                />{' '}
                {formatBytes(status.library.savedBytes)}.{' '}
                <Plural value={status.library.pendingFiles} one="# file left to check." other="# files left to check." />
              </Text>
              <Text size="xs" c="var(--ink-3)">
                <Trans>
                  Originals wait {status.library.trashDays} days in the upgrade trash ({formatBytes(status.library.trashBytes)}
                  ) and can be restored from the series.
                </Trans>
              </Text>
            </Stack>
            {status.pass.state === 'running' ? (
              <Button
                variant="default"
                size="xs"
                leftSection={<IconPlayerPause size={14} />}
                loading={pause.isPending}
                onClick={() => pause.mutate(undefined)}
              >
                <Trans>Pause</Trans>
              </Button>
            ) : (
              <Button
                variant="default"
                size="xs"
                leftSection={<IconPlayerPlay size={14} />}
                disabled={status.settings.format === null || dirty || status.library.pendingFiles === 0}
                loading={start.isPending}
                onClick={() => start.mutate(undefined)}
              >
                {status.pass.state === 'paused' ? <Trans>Resume</Trans> : <Trans>Convert library</Trans>}
              </Button>
            )}
          </Group>
        </Stack>
      )}
    </SettingsSection>
  )
}
