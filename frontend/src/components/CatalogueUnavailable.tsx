import { useEffect, useRef } from 'react'
import { Button, Group, Stack, Text, Title } from '@mantine/core'
import { IconSettings } from '@tabler/icons-react'
import { Link } from 'react-router-dom'
import { Trans } from '@lingui/react/macro'
import { useAuth } from '../auth/AuthProvider'
import { useDumpProgress } from '../api/hooks'
import { DumpProgressBar } from './MetadataDumpProgress'

/**
 * What Add series and Discover say while the local MangaBaka database is missing: one explanation
 * with the download's live progress, instead of a raw API error. `onReady` fires when the download
 * finishes so the page can read the catalogue without a manual reload.
 */
export function CatalogueUnavailable({ onReady }: { onReady: () => void }) {
  const { can } = useAuth()
  const isAdmin = can('Admin')
  const { data: progress } = useDumpProgress(isAdmin)
  const wasRunning = useRef(false)
  const running = Boolean(progress?.running)

  useEffect(() => {
    if (running) {
      wasRunning.current = true
    } else if (wasRunning.current) {
      wasRunning.current = false
      onReady()
    }
  }, [running, onReady])

  return (
    <Stack gap="md" maw={520} py="xl" role="status">
      <Title order={2} size="h3">
        <Trans>This page needs the metadata database</Trans>
      </Title>
      {running && progress ? (
        <>
          <Text size="sm" c="var(--ink-2)">
            <Trans>It is downloading now. This page fills in when it finishes.</Trans>
          </Text>
          <DumpProgressBar progress={progress} />
        </>
      ) : (
        <Text size="sm" c="var(--ink-2)">
          {isAdmin ? (
            <Trans>The local database is not installed yet. Download it once from the metadata settings.</Trans>
          ) : (
            <Trans>An admin needs to download it first. Ask them to install the local database.</Trans>
          )}
        </Text>
      )}
      {isAdmin && !running && (
        <Group>
          <Button
            component={Link}
            to="/settings?tab=library&s=metadata"
            variant="default"
            leftSection={<IconSettings size={16} />}
          >
            <Trans>Open metadata settings</Trans>
          </Button>
        </Group>
      )}
    </Stack>
  )
}
