import { useState } from 'react'
import { Anchor, Badge, Button, Group, Loader, Paper, Stack, Text, Title } from '@mantine/core'
import { IconBook2, IconExternalLink } from '@tabler/icons-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useSourcePreview } from '../../api/hooks'

/**
 * "Read before adding": looks the title up on every enabled source, the way auto-match will once
 * it is added, and links the first chapter each one has. Waits for a click because it searches
 * every site; opening the modal alone costs nothing.
 */
export function SourcePreviewPanel({ providerId }: { providerId: string }) {
  const { t } = useLingui()
  const [asked, setAsked] = useState(false)
  const { data, isFetching, isError, refetch } = useSourcePreview(providerId, asked)

  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Title order={3} fz={17}>
            <Trans>Read before adding</Trans>
          </Title>
          {!asked && (
            <Button size="xs" variant="light" leftSection={<IconBook2 size={14} />} onClick={() => setAsked(true)}>
              <Trans>Find chapter 1 on your sources</Trans>
            </Button>
          )}
        </Group>

        {!asked && (
          <Text size="sm" c="var(--ink-3)">
            <Trans>
              Searches each enabled source for this title and links the first chapter on the site, so you can
              try it before adding it.
            </Trans>
          </Text>
        )}

        {asked && isFetching && (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm" c="var(--ink-3)">
              <Trans>Searching your sources…</Trans>
            </Text>
          </Group>
        )}

        {asked && isError && !isFetching && (
          <Group gap="sm">
            <Text size="sm" c="var(--danger)">
              <Trans>The search failed.</Trans>
            </Text>
            <Button size="xs" variant="subtle" onClick={() => void refetch()}>
              <Trans>Try again</Trans>
            </Button>
          </Group>
        )}

        {asked && data && !isFetching && data.length === 0 && (
          <Text size="sm" c="var(--ink-3)">
            <Trans>None of your enabled sources has this title.</Trans>
          </Text>
        )}

        {data && data.length > 0 && (
          <Stack gap={6} component="ul" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {data.map((p) => {
              const site = p.displayName
              const chapter = p.firstChapterLabel
              return (
                <Group key={p.sourceName} component="li" justify="space-between" wrap="nowrap" gap="sm">
                  <div style={{ minWidth: 0 }}>
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm" fw={600}>
                        {site}
                      </Text>
                      {p.confirmedById && (
                        <Badge size="xs" variant="light" color="teal">
                          <Trans>Same work</Trans>
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c="var(--ink-3)" truncate>
                      {p.seriesTitle}
                    </Text>
                  </div>
                  <Anchor
                    href={p.firstChapterUrl ?? p.seriesUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="sm"
                    style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    aria-label={chapter ? t`Read ${chapter} on ${site}` : t`Open on ${site}`}
                  >
                    {p.firstChapterUrl ? (chapter ? <Trans>Read {chapter}</Trans> : <Trans>Read</Trans>) : <Trans>Open</Trans>}
                    <IconExternalLink size={13} />
                  </Anchor>
                </Group>
              )
            })}
          </Stack>
        )}
      </Stack>
    </Paper>
  )
}
