import { useState, useSyncExternalStore } from 'react'
import { Tooltip } from '@mantine/core'
import { IconArrowUpRight, IconBrandAndroid, IconStarFilled, IconX } from '@tabler/icons-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useAndroidApk, useAppVersion, useUpdateStatus } from '../../api/hooks'
import { getSkippedVersion, setSkippedVersion, subscribeSkippedVersion } from '../../lib/updateSkip'
import { UserMenu } from '../UserMenu'

const REPO_URL = 'https://github.com/fokuroru/Fokuroru'
const STAR_DISMISSED_KEY = 'star-nudge-dismissed'

function readStarDismissed(): boolean {
  try {
    return localStorage.getItem(STAR_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export default function SidebarFooter({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLingui()
  const { data: version } = useAppVersion()
  const { data: update } = useUpdateStatus()
  const skipped = useSyncExternalStore(subscribeSkippedVersion, getSkippedVersion)
  const [starDismissed, setStarDismissed] = useState(readStarDismissed)

  const latestVersion = update?.latestVersion ?? null
  const updateAvailable = !!update?.updateAvailable && !!latestVersion
  const isSkipped = updateAvailable && skipped === latestVersion
  const showUpdate = updateAvailable && !isSkipped
  const showStar = !showUpdate && !starDismissed

  const dismissStar = () => {
    setStarDismissed(true)
    try {
      localStorage.setItem(STAR_DISMISSED_KEY, '1')
    } catch {
      /* private mode: dismissed for this visit only */
    }
  }

  const unofficial = version ? /-(dev|nightly)/.test(version) : false

  return (
    <div className="nav-footer">
      <UserMenu onNavigate={onNavigate} />

      {showUpdate && latestVersion ? (
        <div className="nav-footer-notice">
          <a
            href={update?.releaseUrl ?? `${REPO_URL}/releases`}
            target="_blank"
            rel="noreferrer"
            className="nav-footer-link"
          >
            <Trans>Update {latestVersion} available</Trans>
            <IconArrowUpRight size={14} stroke={1.8} />
          </a>
          <button
            type="button"
            className="nav-footer-dismiss"
            aria-label={t`Skip ${latestVersion}`}
            title={t`Skip ${latestVersion}`}
            onClick={() => setSkippedVersion(latestVersion)}
          >
            <IconX size={12} stroke={2} />
          </button>
        </div>
      ) : showStar ? (
        <div className="nav-footer-notice">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="nav-footer-link"
            onClick={dismissStar}
          >
            <IconStarFilled size={13} className="nav-footer-star" />
            <Trans>Star on GitHub</Trans>
            <IconArrowUpRight size={14} stroke={1.8} />
          </a>
          <button
            type="button"
            className="nav-footer-dismiss"
            aria-label={t`Dismiss`}
            title={t`Dismiss`}
            onClick={dismissStar}
          >
            <IconX size={12} stroke={2} />
          </button>
        </div>
      ) : null}

      <AndroidAppLink />

      {version && (
        <div className="nav-footer-row">
          <VersionLabel
            version={version}
            unofficial={unofficial}
            latestVersion={updateAvailable ? latestVersion : null}
            isSkipped={isSkipped}
          />
        </div>
      )}
    </div>
  )
}

function VersionLabel({
  version,
  unofficial,
  latestVersion,
  isSkipped,
}: {
  version: string
  unofficial: boolean
  latestVersion: string | null
  isSkipped: boolean
}) {
  const { t } = useLingui()
  const tooltip = unofficial
    ? t`Unofficial build (not a tagged release)`
    : latestVersion && isSkipped
      ? t`${latestVersion} available, skipped`
      : latestVersion
        ? t`Fōkurōru ${latestVersion} available`
        : t`Fōkurōru ${version}`

  return (
    <Tooltip label={tooltip} withArrow>
      {latestVersion ? (
        <button
          type="button"
          className="nav-footer-version nav-footer-version-button"
          onClick={() => setSkippedVersion(null)}
        >
          <span className="nav-footer-dot" />v{version}
        </button>
      ) : (
        <span className="nav-footer-version">v{version}</span>
      )}
    </Tooltip>
  )
}

/** Offered only to a browser on Android: the app itself, and every other system, has no use for it. */
function AndroidAppLink() {
  const info = useAndroidApk()
  if (!info) return null
  return (
    <a href="/api/v1/android/apk" download="fokuroru.apk" className="nav-link nav-footer-help">
      <IconBrandAndroid size={18} stroke={1.7} className="nav-icon" />
      <Trans>Get the Android app {info.versionName}</Trans>
    </a>
  )
}
