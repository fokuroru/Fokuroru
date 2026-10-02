import { useEffect, useRef, useState } from 'react'
import { getInitialize } from '../api/client'
import type { SeriesDto } from '../api/types'

/** How often a banner goes up on the chalkboard: one page load in five. Rolled once per mount. */
export const BANNER_SHARE = 0.2

/** Series that could have a banner on AniList or Kitsu, which is to say those matched to either. */
function bannerCandidates(series: SeriesDto[]): SeriesDto[] {
  return series.filter((s) => s.aniListId != null || s.malId != null || s.kitsuId != null)
}

/**
 * A banner for the chalkboard: a picture of a random library series, one page load in five. The server finds
 * it on AniList or Kitsu and keeps it; a series that has none answers 404 and the next is tried, a few times,
 * and then the board goes without. Returns an object URL, released when the shelf goes away.
 */
export function useShelfBanner(series: SeriesDto[], enabled: boolean): string | null {
  const [wanted] = useState(() => Math.random() < BANNER_SHARE)
  const [url, setUrl] = useState<string | null>(null)
  const tried = useRef(false)

  useEffect(() => {
    if (!wanted || !enabled || tried.current) return
    const candidates = bannerCandidates(series)
    if (candidates.length === 0) return
    tried.current = true

    let cancelled = false
    let made: string | null = null
    void (async () => {
      const init = await getInitialize()
      const shuffled = [...candidates].sort(() => Math.random() - 0.5).slice(0, 6)
      for (const s of shuffled) {
        try {
          const res = await fetch(`${init.apiRoot}/mediacover/${s.id}/banner`, { credentials: 'same-origin' })
          if (!res.ok) continue
          const blob = await res.blob()
          if (cancelled) return
          made = URL.createObjectURL(blob)
          setUrl(made)
          return
        } catch {
          // Offline or blocked: the board simply goes without.
          return
        }
      }
    })()
    return () => {
      cancelled = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [wanted, enabled, series])

  return url
}
