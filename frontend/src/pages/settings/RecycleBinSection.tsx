import { useState } from 'react'
import { useLabel } from '../../i18n-context'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { msg, plural, t as now } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'
import { ActionIcon, Button, Group, NumberInput, Stack, Table, Text, VisuallyHidden } from '@mantine/core'
import { IconRestore, IconTrash } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { SettingsSection } from './SettingsSection'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { formatBytes, formatDate, formatNumber } from '../../format'
import { useAuth } from '../../auth/AuthProvider'
import {
  useDeleteFromRecycleBin,
  useEmptyRecycleBin,
  useRecycleBin,
  useRestoreFromRecycleBin,
  useSetRecycleBinRetention,
  type RecycleBinEntry,
  type RecycleReason,
} from '../../api/recycleBin'

const RECYCLE_REASON_LABELS: Record<RecycleReason, MessageDescriptor> = {
  deleteFile: msg`Deleted file`,
  removeChapter: msg`Removed chapter`,
  seriesDelete: msg`Removed series`,
}

function daysLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000))
}

function binChapterLabel(entry: RecycleBinEntry): string {
  const numbers = entry.chapters
    .map((c) => c.number)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b)
  if (numbers.length === 0) return ''
  const first = formatNumber(numbers[0])
  if (numbers.length === 1) return now`Ch. ${first}`
  const last = formatNumber(numbers[numbers.length - 1])
  return now`Ch. ${first} to ${last}`
}

/**
 * Files deleted from the library, grouped by series. Everyone who may delete may restore; only an
 * admin sets how long files are kept.
 */
export function RecycleBinSection() {
  const { t } = useLingui()
  const renderLabel = useLabel()
  const { me } = useAuth()
  const isAdmin = me?.permissionNames.includes('Admin') ?? false
  const { data: bin } = useRecycleBin()
  const restore = useRestoreFromRecycleBin()
  const remove = useDeleteFromRecycleBin()
  const empty = useEmptyRecycleBin()
  const setRetention = useSetRecycleBinRetention()
  const [retention, setRetentionDraft] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<RecycleBinEntry | null>(null)
  const [emptying, setEmptying] = useState(false)

  const entries = bin?.entries ?? []
  const days = bin?.retentionDays ?? 14
  const totalSize = formatBytes(bin?.totalBytes)
  const groups = new Map<number, RecycleBinEntry[]>()
  for (const entry of entries) {
    groups.set(entry.seriesId, [...(groups.get(entry.seriesId) ?? []), entry])
  }

  const onRestore = (entry: RecycleBinEntry) =>
    restore.mutate(entry.id, {
      onSuccess: (r) =>
        notifications.show({
          color: 'var(--ok)',
          message: r.linked
            ? plural(r.chapters, {
                one: 'Restored and linked to # chapter',
                other: 'Restored and linked to # chapters',
              })
            : now`Restored as an unlinked file. Health can import it.`,
        }),
    })

  const dirty = retention !== null && retention !== days

  return (
    <SettingsSection
      id="recycle-bin"
      title={<Trans>Recycle bin</Trans>}
      description={
        <Plural
          value={days}
          one="Deleted files, removed chapters and series deleted with their files wait here for # day before they are deleted for good. Restore puts a file back where it was."
          other="Deleted files, removed chapters and series deleted with their files wait here for # days before they are deleted for good. Restore puts a file back where it was."
        />
      }
      actions={
        <Button
          variant="default"
          color="var(--danger)"
          leftSection={<IconTrash size={16} />}
          disabled={entries.length === 0}
          onClick={() => setEmptying(true)}
        >
          <Trans>Empty bin</Trans>
        </Button>
      }
      dirty={dirty}
      saving={setRetention.isPending}
      onSave={() => {
        if (retention === null) return
        setRetention.mutate(retention, {
          onSuccess: () => {
            setRetentionDraft(null)
            notifications.show({ message: now`Saved`, color: 'var(--ok)' })
          },
        })
      }}
      onDiscard={() => setRetentionDraft(null)}
    >
      <Stack>
        {isAdmin && (
          <NumberInput
            label={t`Keep deleted files (days)`}
            description={t`0 deletes them for good on the next housekeeping pass.`}
            min={0}
            max={365}
            clampBehavior="strict"
            allowDecimal={false}
            value={retention ?? days}
            onChange={(v) => setRetentionDraft(typeof v === 'number' ? v : null)}
            w={220}
          />
        )}
        {entries.length === 0 ? (
          <Text size="sm" c="var(--ink-3)">
            <Trans>The recycle bin is empty.</Trans>
          </Text>
        ) : (
          <>
            <Text size="sm" c="var(--ink-3)">
              <Plural value={entries.length} one={`# file, ${totalSize}`} other={`# files, ${totalSize}`} />
            </Text>
            {[...groups.values()].map((group) => {
              const { seriesId, seriesTitle, seriesExists } = group[0]
              return (
                <Stack key={seriesId} gap={4}>
                  <Group gap="xs">
                    <Text fw={600}>{seriesTitle}</Text>
                    {!seriesExists && (
                      <Text size="xs" c="var(--ink-3)">
                        <Trans>(no longer in the library)</Trans>
                      </Text>
                    )}
                  </Group>
                  <Table className="panel-table ops-table">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th><Trans>File</Trans></Table.Th>
                        <Table.Th><Trans>Size</Trans></Table.Th>
                        <Table.Th><Trans>Deleted</Trans></Table.Th>
                        <Table.Th><Trans>Days left</Trans></Table.Th>
                        <Table.Th><VisuallyHidden><Trans>Actions</Trans></VisuallyHidden></Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {group.map((entry) => {
                        const left = daysLeft(entry.expiresAt)
                        const chapters = binChapterLabel(entry)
                        const deletedBy = entry.deletedBy
                        return (
                          <Table.Tr key={entry.id}>
                            <Table.Td>
                              <Text size="sm" style={{ wordBreak: 'break-all' }}>{entry.fileName}</Text>
                              <Text size="xs" c="var(--ink-3)">
                                {renderLabel(RECYCLE_REASON_LABELS[entry.reason])}
                                {chapters && ` · ${chapters}`}
                              </Text>
                              {entry.missing && (
                                <Text size="xs" c="var(--danger)">
                                  <Trans>The file is missing from the bin folder.</Trans>
                                </Text>
                              )}
                            </Table.Td>
                            <Table.Td>{formatBytes(entry.size)}</Table.Td>
                            <Table.Td>
                              <Text size="sm">{formatDate(entry.deletedAt)}</Text>
                              {deletedBy && (
                                <Text size="xs" c="var(--ink-3)">
                                  <Trans>by {deletedBy}</Trans>
                                </Text>
                              )}
                            </Table.Td>
                            <Table.Td>
                              <Plural value={left} one="# day" other="# days" />
                            </Table.Td>
                            <Table.Td>
                              <Group gap={4} wrap="nowrap" justify="flex-end">
                                <Button
                                  size="xs"
                                  variant="default"
                                  leftSection={<IconRestore size={14} />}
                                  disabled={entry.missing}
                                  loading={restore.isPending && restore.variables === entry.id}
                                  onClick={() => onRestore(entry)}
                                >
                                  <Trans>Restore</Trans>
                                </Button>
                                <ActionIcon
                                  variant="subtle"
                                  color="var(--danger)"
                                  onClick={() => setDeleting(entry)}
                                  aria-label={t`Delete permanently`}
                                >
                                  <IconTrash size={16} />
                                </ActionIcon>
                              </Group>
                            </Table.Td>
                          </Table.Tr>
                        )
                      })}
                    </Table.Tbody>
                  </Table>
                </Stack>
              )
            })}
          </>
        )}
      </Stack>

      <ConfirmDialog
        opened={deleting !== null}
        onClose={() => setDeleting(null)}
        title={<Trans>Delete this file permanently?</Trans>}
        confirmLabel={<Trans>Delete permanently</Trans>}
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      >
        <Stack gap="xs">
          <Text size="sm" ff="monospace" style={{ wordBreak: 'break-all' }}>{deleting?.relativePath}</Text>
          <Text size="sm" c="var(--danger)">
            <Trans>This action cannot be undone.</Trans>
          </Text>
        </Stack>
      </ConfirmDialog>

      <ConfirmDialog
        opened={emptying}
        onClose={() => setEmptying(false)}
        title={<Trans>Empty the recycle bin?</Trans>}
        confirmLabel={<Trans>Empty bin</Trans>}
        loading={empty.isPending}
        onConfirm={() =>
          empty.mutate(undefined, {
            onSuccess: (r) => {
              setEmptying(false)
              if (r.failed > 0) {
                notifications.show({
                  color: 'var(--danger)',
                  message: plural(r.failed, {
                    one: "Couldn't delete # file, check the log",
                    other: "Couldn't delete # files, check the log",
                  }),
                })
              }
            },
          })
        }
      >
        <Stack gap="xs">
          <Text size="sm">
            <Plural value={entries.length} one="Deletes # file for good." other="Deletes # files for good." />
          </Text>
          <Text size="sm" c="var(--danger)">
            <Trans>This action cannot be undone.</Trans>
          </Text>
        </Stack>
      </ConfirmDialog>
    </SettingsSection>
  )
}
