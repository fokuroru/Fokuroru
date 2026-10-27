import { useEffect, useReducer, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { t as now } from '@lingui/core/macro'
import { Checkbox, MultiSelect, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { errorText } from '../../api/errorText'
import { useIndexerList, useIndexerOptions, useIndexerSettings, useSaveIndexerOptions } from '../../api/hooks'
import { ConnectionSettingsCard } from '../../components/ConnectionSettingsCard'
import { IndexerFieldRow } from '../../components/settings/IndexerForm'
import { indexerBackendName, useIndexerForm } from '../../components/settings/useIndexerForm'
import { useDownloadClientFields } from '../../components/settings/downloadClientFields'
import { SettingsSection } from './SettingsSection'

const savedToast = () => notifications.show({ message: now`Saved`, color: 'var(--ok)' })

export function DownloadClientCard() {
  const { t } = useLingui()
  const fields = useDownloadClientFields()
  return (
    <ConnectionSettingsCard
      name="downloadclient"
      title={t`Download client`}
      description={t`Sends grabbed releases to your torrent client. Finished torrents import into the library automatically. Fill the path mapping only if the client reports paths Fōkurōru can't reach, e.g. /downloads in Docker where Fōkurōru sees Z:\\downloads.`}
      fields={fields}
    />
  )
}

/** The indexer and category filter of the active backend, which saves through its own endpoint beside the connection. */
function useIndexerOptionsForm() {
  const { data: connection } = useIndexerSettings()
  const backend = connection?.backend
  const { data: options } = useIndexerOptions(backend)
  const save = useSaveIndexerOptions()
  const [selectedIndexers, setSelectedIndexers] = useState<Set<string>>(new Set())
  const [categories, setCategories] = useState<string[]>([])
  const [discarded, discard] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    if (options) {
      setSelectedIndexers(new Set((options.indexerIds ?? '').split(',').filter(Boolean)))
      setCategories((options.categories ?? '').split(',').filter(Boolean))
    }
  }, [options, discarded])

  const sortedIds = (ids: Iterable<string>) => [...ids].sort().join(',')
  const dirty =
    options !== undefined &&
    (sortedIds(selectedIndexers) !== sortedIds((options.indexerIds ?? '').split(',').filter(Boolean)) ||
      categories.join(',') !== (options.categories ?? ''))

  return {
    selectedIndexers,
    setSelectedIndexers,
    categories,
    setCategories,
    dirty,
    saving: save.isPending,
    reset: discard,
    commit: () =>
      backend === undefined
        ? Promise.resolve()
        : save.mutateAsync({
            backend,
            indexerIds: sortedIds(selectedIndexers) || null,
            categories: categories.join(',') || null,
          }),
  }
}

export function IndexerSection() {
  const { t } = useLingui()
  const form = useIndexerForm()
  const options = useIndexerOptionsForm()
  const optionsDirty = options.dirty && !form.switching
  const selectedName = indexerBackendName(form.selected)

  return (
    <SettingsSection
      id="indexer"
      title={t`Indexer`}
      description={t`Searches your torrent indexers for manga releases, used for volume upgrades and for grabbing releases by hand. Works through Prowlarr or Jackett, no app sync needed.`}
      dirty={form.dirty || optionsDirty}
      saving={form.saving || options.saving}
      onSave={() => {
        const jobs = [form.dirty && form.commit(), optionsDirty && options.commit()].filter(
          (j) => j instanceof Promise,
        )
        Promise.all(jobs).then(savedToast, () => {})
      }}
      onDiscard={() => {
        form.reset()
        options.reset()
      }}
    >
      <IndexerFieldRow form={form} />
      {form.switching ? (
        <Text size="sm" c="var(--ink-3)" mt="md">
          <Trans>
            Saving switches the indexer to {selectedName}. Its indexer and
            category lists load after that.
          </Trans>
        </Text>
      ) : (
        <IndexerOptionsSection form={options} />
      )}
    </SettingsSection>
  )
}

function IndexerOptionsSection({ form }: { form: ReturnType<typeof useIndexerOptionsForm> }) {
  const { t } = useLingui()
  const { data: connection } = useIndexerSettings()
  const configured = Boolean(connection?.url && connection?.apiKey)
  const backendName = indexerBackendName(connection?.backend)
  const { data: indexers, error: indexersError } = useIndexerList(connection?.backend, configured)
  const indexersErrorMessage = indexersError != null ? errorText(indexersError) : null
  const { selectedIndexers, setSelectedIndexers, categories, setCategories } = form

  const categoryData = [
    ...new Map(
      (indexers ?? [])
        .flatMap((i) => i.categories)
        .map((c) => [String(c.id), { value: String(c.id), label: `${c.name} (${c.id})` }]),
    ).values(),
    // keep saved categories selectable even when no indexer advertises them
    ...categories
      .filter((c) => !(indexers ?? []).some((i) => i.categories.some((x) => String(x.id) === c)))
      .map((c) => ({ value: c, label: c })),
  ].sort((a, b) => Number(a.value) - Number(b.value))

  return (
    <Stack gap="sm" mt="md">
      {configured && (
        <Text size="sm" c="var(--ink-3)">
          <Trans>
            Restrict release searches to specific indexers and categories. With nothing
            selected, every indexer and category is searched.
          </Trans>
        </Text>
      )}
      {configured && indexersErrorMessage != null && (
        <Text size="sm" c="var(--danger)">
          <Trans>Could not load indexers from {backendName}: {indexersErrorMessage}</Trans>
        </Text>
      )}
      {configured && indexers && (
        <Stack gap="sm">
          <Stack gap={6}>
            {indexers.map((indexer) => {
              const { id, name, enabled } = indexer
              return (
                <Checkbox
                  key={id}
                  label={enabled ? name : t`${name} (disabled in ${backendName})`}
                  checked={selectedIndexers.has(id)}
                  onChange={(e) => {
                    const checked = e.currentTarget.checked
                    setSelectedIndexers((prev) => {
                      const next = new Set(prev)
                      if (checked) next.add(id)
                      else next.delete(id)
                      return next
                    })
                  }}
                />
              )
            })}
            {indexers.length === 0 && (
              <Text size="sm" c="var(--ink-3)">
                <Trans>No indexers configured in {backendName}.</Trans>
              </Text>
            )}
          </Stack>
          <MultiSelect
            label={t`Categories`}
            placeholder={categories.length === 0 ? t`All categories` : undefined}
            data={categoryData}
            value={categories}
            onChange={setCategories}
            searchable
            clearable
          />
        </Stack>
      )}
    </Stack>
  )
}
