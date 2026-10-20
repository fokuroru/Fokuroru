import { useState } from 'react'
import { Button, Collapse, Group, Select, Skeleton, Stack, Text, UnstyledButton } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { Link } from 'react-router-dom'
import { Trans, Plural, useLingui } from '@lingui/react/macro'
import { getInitialize } from '../../api/client'
import {
  filePreviewUrl,
  useClearPlacement,
  usePlaceBonus,
  useSeriesProgress,
  type ProgressRow,
  type ProgressState,
  type ProgressUnplaced,
  type ProgressVolume,
} from '../../api/progress'
import { formatBytes, formatDate } from '../../format'
import { useAuth } from '../../auth/AuthProvider'
import { Panel } from '../ui/Panel'

const STATE_COLOR: Record<ProgressState, string> = {
  read: 'var(--ok)',
  started: 'var(--info)',
  ready: 'var(--ink-3)',
  missing: 'var(--warn)',
  skipped: 'var(--ink-4)',
  banked: 'var(--watched)',
}

function useApiRoot() {
  return useQuery({ queryKey: ['api-root'], queryFn: getInitialize, staleTime: Infinity }).data?.apiRoot
}

function useStateLabel() {
  const { t } = useLingui()
  return (state: ProgressState) =>
    ({
      read: t`Read`,
      started: t`Reading`,
      ready: t`Ready`,
      missing: t`Missing`,
      skipped: t`Skipped`,
      banked: t`Banked`,
    })[state]
}

function VolumeBar({ v }: { v: ProgressVolume }) {
  if (v.chapters === 0) return null
  const part = (n: number) => `${(n / v.chapters) * 100}%`
  return (
    <div className="progress-bar" aria-hidden>
      <span style={{ width: part(v.read), background: STATE_COLOR.read }} />
      <span style={{ width: part(v.started), background: STATE_COLOR.started }} />
      <span style={{ width: part(v.ready), background: STATE_COLOR.ready }} />
      <span style={{ width: part(v.missing), background: STATE_COLOR.missing }} />
    </div>
  )
}

function RowLine({ row, onUnplace, canEdit }: { row: ProgressRow; onUnplace: (id: number) => void; canEdit: boolean }) {
  const { t } = useLingui()
  const stateLabel = useStateLabel()
  const why = row.why === 'user' ? t`Placed by you` : row.why === 'source' ? t`Placed by its source` : row.why === 'number' ? t`Placed by its number` : null
  return (
    <div className="progress-row" data-kind={row.kind}>
      <span className="progress-dot" style={{ background: STATE_COLOR[row.state] }} />
      <Text size="sm" className="progress-row-name" lineClamp={1}>
        {row.kind === 'bonus' ? <Trans>Bonus</Trans> : <Trans>Ch.</Trans>}
        {row.number ? ` ${row.number}` : ''}
        {row.title ? ` · ${row.title}` : ''}
      </Text>
      {row.kind === 'bonus' && why && <Text size="xs" c="dimmed">{why}</Text>}
      {row.pages ? <Text size="xs" c="dimmed" className="tnum">{t`${row.pages} pages`}</Text> : null}
      <Text size="xs" style={{ color: STATE_COLOR[row.state] }}>{stateLabel(row.state)}</Text>
      {row.why === 'user' && canEdit && (
        <Button size="compact-xs" variant="subtle" onClick={() => onUnplace(row.chapterId)}><Trans>Unplace</Trans></Button>
      )}
    </div>
  )
}

function VolumeBlock({ v, open, toggle, onUnplace, canEdit }: {
  v: ProgressVolume; open: boolean; toggle: () => void; onUnplace: (id: number) => void; canEdit: boolean
}) {
  const done = v.chapters > 0 && v.read === v.chapters
  return (
    <div className="progress-volume">
      <UnstyledButton className="progress-volume-head" onClick={toggle} aria-expanded={open}>
        {open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
        <Text fw={600}>{v.volume === null ? <Trans>No volume</Trans> : <Trans>Volume {v.volume}</Trans>}</Text>
        <Text size="sm" c="dimmed" className="tnum">
          {v.from !== null && v.to !== null ? (v.from === v.to ? `Ch.${v.from}` : `Ch.${v.from}-${v.to}`) : ''}
        </Text>
        <span className="progress-volume-count tnum">
          {done ? <Trans>Done</Trans> : <Trans>{v.read} of {v.chapters} read</Trans>}
          {v.missing > 0 && <span style={{ color: 'var(--warn)' }}> · <Trans>{v.missing} missing</Trans></span>}
          {v.bonus > 0 && <> · <Plural value={v.bonus} one="# bonus" other="# bonus" /></>}
        </span>
      </UnstyledButton>
      <VolumeBar v={v} />
      <Collapse expanded={open}>
        <div className="progress-rows">
          {v.rows.map((row) => <RowLine key={row.chapterId} row={row} onUnplace={onUnplace} canEdit={canEdit} />)}
        </div>
      </Collapse>
    </div>
  )
}

function Preview({ seriesId, item }: { seriesId: number; item: ProgressUnplaced }) {
  const apiRoot = useApiRoot()
  if (!apiRoot || item.fileId === null || item.pages <= 0) return null
  const pages = [...new Set([0, Math.floor(item.pages / 2), item.pages - 1])].filter((p) => p >= 0)
  return (
    <div className="progress-previews">
      {pages.map((p) => (
        <img key={p} src={filePreviewUrl(apiRoot, seriesId, item.fileId!, p)} alt="" loading="lazy" />
      ))}
    </div>
  )
}

function UnplacedItem({ seriesId, item, volumes }: { seriesId: number; item: ProgressUnplaced; volumes: ProgressVolume[] }) {
  const { t } = useLingui()
  const place = usePlaceBonus(seriesId)
  const [slotting, setSlotting] = useState(false)
  const [volume, setVolume] = useState<string | null>(null)
  const [after, setAfter] = useState<string | null>('end')

  const real = volumes.filter((v) => v.volume !== null)
  const chosen = real.find((v) => String(v.volume) === volume)
  const afterOptions = [
    { value: 'start', label: t`Start of the volume` },
    ...(chosen?.rows.filter((r) => r.kind === 'chapter' && r.number !== null).map((r) => ({ value: r.number!, label: t`After Ch.${r.number}` })) ?? []),
    { value: 'end', label: t`End of the volume` },
  ]
  const hint = { year: t`Looks like a year, not a chapter`, short: t`Very short`, noVolume: t`No volume found for it`, unlinked: t`Not linked to any chapter` }[item.hint]

  const confirm = () => {
    if (volume === null) return
    place.mutate(
      {
        chapterId: item.chapterId,
        fileId: item.chapterId === null ? item.fileId : null,
        volume: Number(volume),
        after: after === 'start' ? -1 : after === 'end' || after === null ? null : Math.floor(Number(after)),
      },
      {
        onSuccess: () => setSlotting(false),
        onError: (e) => notifications.show({ color: 'red', message: e instanceof Error ? e.message : t`Could not place it` }),
      },
    )
  }

  return (
    <div className="progress-unplaced">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div style={{ minWidth: 0 }}>
          <Text size="sm" fw={600} lineClamp={2}>{item.fileName}</Text>
          <Text size="xs" c="dimmed">{[t`${item.pages} pages`, item.source, hint].filter(Boolean).join(' · ')}</Text>
        </div>
        {!slotting && <Button size="compact-sm" variant="light" onClick={() => setSlotting(true)}><Trans>Slot in</Trans></Button>}
      </Group>
      <Preview seriesId={seriesId} item={item} />
      {slotting && (
        <Group gap="sm" mt="sm" align="flex-end">
          <Select
            label={t`Volume`}
            data={real.map((v) => ({ value: String(v.volume), label: t`Volume ${v.volume}` }))}
            value={volume}
            onChange={(next) => { setVolume(next); setAfter('end') }}
            w={150}
          />
          <Select label={t`Position`} data={afterOptions} value={after} onChange={setAfter} disabled={volume === null} w={190} />
          <Button size="sm" onClick={confirm} loading={place.isPending} disabled={volume === null}><Trans>Place</Trans></Button>
          <Button size="sm" variant="subtle" onClick={() => setSlotting(false)}><Trans>Cancel</Trans></Button>
        </Group>
      )}
    </div>
  )
}

export function SeriesProgress({ seriesId, onShowFiles }: { seriesId: number; onShowFiles: () => void }) {
  const { t } = useLingui()
  const { can } = useAuth()
  const canEdit = can('EditMetadata')
  const { data, isLoading, isError } = useSeriesProgress(seriesId)
  const clear = useClearPlacement(seriesId)
  const [openVolumes, setOpenVolumes] = useState<Set<number | null> | null>(null)

  if (isLoading) return <Skeleton height={240} />
  if (isError || !data) return <Text c="dimmed"><Trans>Progress could not be loaded.</Trans></Text>

  const firstOpen = data.volumes.find((v) => v.chapters > v.read)
  const open = openVolumes ?? new Set<number | null>(firstOpen ? [firstOpen.volume] : [])
  const toggle = (volume: number | null) => {
    const next = new Set(open)
    if (!next.delete(volume)) next.add(volume)
    setOpenVolumes(next)
  }
  const { position, totals, disk } = data

  return (
    <Stack gap="lg" className="series-progress">
      {position && (
        <Panel edge="brand">
          <Group justify="space-between" wrap="nowrap">
            <div style={{ minWidth: 0 }}>
              <Text size="xs" c="dimmed" tt="uppercase">{position.inProgress ? <Trans>Continue with</Trans> : <Trans>Up next</Trans>}</Text>
              <Text fw={600} size="lg" lineClamp={1}>{position.label}</Text>
              <Text size="sm" c="dimmed">
                {position.inProgress && position.pageCount > 0 ? t`Page ${position.page} of ${position.pageCount}` : null}
                {position.next.length > 0 ? `${position.inProgress ? ' · ' : ''}${t`Then`} ${position.next.join(', ')}` : null}
              </Text>
            </div>
            <Button component={Link} to={`/read/${position.chapterId}`}>{position.inProgress ? <Trans>Continue</Trans> : <Trans>Read</Trans>}</Button>
          </Group>
        </Panel>
      )}

      <div className="progress-metrics">
        <div><b className="tnum">{totals.chapters}</b><span><Trans>Chapters</Trans></span></div>
        <div><b className="tnum">{totals.ready}</b><span><Trans>Ready to read</Trans></span></div>
        <div><b className="tnum">{totals.read}</b><span><Trans>Read</Trans></span></div>
        <div><b className="tnum" style={totals.missing > 0 ? { color: 'var(--warn)' } : undefined}>{totals.missing}</b><span><Trans>Missing</Trans></span></div>
      </div>

      <Stack gap="xs">
        <Text fw={600}><Trans>By volume</Trans></Text>
        {data.volumes.map((v) => (
          <VolumeBlock
            key={String(v.volume)}
            v={v}
            open={open.has(v.volume)}
            toggle={() => toggle(v.volume)}
            onUnplace={(id) => clear.mutate(id)}
            canEdit={canEdit}
          />
        ))}
      </Stack>

      {data.needsLook.length > 0 && (
        <Panel edge="warn">
          <Text fw={600} mb="xs"><Trans>Needs a look</Trans></Text>
          <Stack gap={4}>
            {data.needsLook.map((n) => (
              <Text size="sm" key={n.kind}>
                {n.kind === 'duplicateNumber'
                  ? <Trans>{n.count} chapter numbers appear twice ({n.numbers.join(', ')})</Trans>
                  : <Trans>{n.count} listings from a source have no file and no volume</Trans>}
              </Text>
            ))}
          </Stack>
        </Panel>
      )}

      {data.unplaced.length > 0 && (
        <Panel>
          <Text fw={600}><Trans>Not placed yet</Trans></Text>
          <Text size="sm" c="dimmed" mb="sm"><Trans>No volume could be worked out for these. Look at them and say where they belong.</Trans></Text>
          <Stack gap="md">
            {data.unplaced.map((u) => (
              canEdit
                ? <UnplacedItem key={`${u.chapterId}-${u.fileId}`} seriesId={seriesId} item={u} volumes={data.volumes} />
                : <Text size="sm" key={`${u.chapterId}-${u.fileId}`}>{u.fileName}</Text>
            ))}
          </Stack>
        </Panel>
      )}

      <Panel>
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <div>
            <Text fw={600}><Trans>On disk</Trans></Text>
            <Text size="sm" c="dimmed">
              <Trans>{disk.files} files, {formatBytes(disk.bytes)}. {disk.volumeFiles} volumes cover {disk.volumeChapters} chapters, {disk.looseFiles} are loose.</Trans>
            </Text>
            {disk.trashFiles > 0 && (
              <Text size="sm" c="dimmed">
                <Trans>{disk.trashFiles} duplicate files ({formatBytes(disk.trashBytes)}) in the trash</Trans>
                {disk.purgeAfter ? <> · <Trans>deleted for good after {formatDate(disk.purgeAfter)}</Trans></> : null}
              </Text>
            )}
          </div>
          <Button variant="subtle" onClick={onShowFiles}><Trans>Show files</Trans></Button>
        </Group>
      </Panel>
    </Stack>
  )
}
