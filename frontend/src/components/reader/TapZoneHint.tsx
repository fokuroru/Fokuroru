import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { ACTION_COLOURS, type TapAction, type TapZone } from '../../lib/tapZones'

const STORAGE_KEY = 'reader-last-seen'
const AWAY_MS = 6 * 60 * 60 * 1000

function readLastSeen(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const value = raw === null ? NaN : Number(raw)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function writeLastSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()))
  } catch {
    // Without storage the hint just shows on every open.
  }
}

/**
 * Faintly outlines the tap areas for a few seconds when the reader opens after six hours away, or
 * for the first time, so nobody has to remember where they are. It never takes taps. The clock is
 * stamped on open and again on leaving, so reading for a long stretch does not count as time away.
 */
export default function TapZoneHint({ zones, active }: { zones: TapZone[]; active: boolean }) {
  const { t } = useLingui()
  const [stale] = useState(() => {
    const last = readLastSeen()
    return last === null || Date.now() - last > AWAY_MS
  })
  const [done, setDone] = useState(false)

  useEffect(() => {
    writeLastSeen()
    return writeLastSeen
  }, [])

  if (!active || !stale || done) return null

  const labels: Record<TapAction, string> = {
    next: t`Next page`,
    prev: t`Previous page`,
    menu: t`Show or hide the menu`,
    nextChapter: t`Next chapter`,
    prevChapter: t`Previous chapter`,
    bookmark: t`Bookmark this page`,
    none: '',
  }

  return (
    <div className="tap-hint" aria-hidden="true" onAnimationEnd={() => setDone(true)}>
      {zones
        .filter((zone) => zone.action !== 'none')
        .map((zone, i) => (
          <div
            key={i}
            className="tap-hint-zone"
            style={{
              left: `${zone.x * 100}%`,
              top: `${zone.y * 100}%`,
              width: `${zone.w * 100}%`,
              height: `${zone.h * 100}%`,
              ['--zone' as string]: ACTION_COLOURS[zone.action],
            }}
          >
            <span className="tap-hint-label">{labels[zone.action]}</span>
          </div>
        ))}
    </div>
  )
}
