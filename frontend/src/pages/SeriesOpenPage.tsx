import { useEffect, useMemo } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Center } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { Trans } from '@lingui/react/macro'
import { t as staticT } from '@lingui/core/macro'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { useChapters, useSeriesDetail } from '../api/hooks'
import type { ChapterDto } from '../api/types'
import { DownloadSplash } from './reader/DownloadSplash'

interface Next {
  chapterId: number
  page: number
  downloaded: boolean
}

export function labelOf(c: ChapterDto): string {
  if (c.isOneShot || c.number === null) return c.title ?? staticT`One-shot`
  const volume = c.fileVolume ?? (c.volume !== null ? String(c.volume) : null)
  const number = c.number
  return volume !== null ? staticT`Vol.${volume} Ch.${number}` : staticT`Ch.${number}`
}

/**
 * Where a book in the mobile view goes: the chapter being read, else the first wanted one. A chapter
 * that is not on the server yet gets the download splash instead of a dead end.
 */
export default function SeriesOpenPage() {
  const { seriesId: param } = useParams()
  const seriesId = Number(param)
  const navigate = useNavigate()
  const location = useLocation()
  const { can } = useAuth()
  const { data: series } = useSeriesDetail(seriesId)
  const { data: chapters } = useChapters(seriesId)
  const next = useQuery({
    queryKey: ['reader-continue', seriesId, 'open'],
    queryFn: () => api<Next | null>(`/reader/series/${seriesId}/continue?includeMissing=true`).catch(() => null),
    staleTime: 0,
    gcTime: 0,
    meta: { silent: true },
  })

  const target = next.data
  const label = useMemo(() => {
    const chapter = chapters?.find((c) => c.id === target?.chapterId)
    return chapter ? labelOf(chapter) : null
  }, [chapters, target?.chapterId])

  useEffect(() => {
    if (target?.downloaded) navigate(`/read/${target.chapterId}`, { replace: true, state: location.state })
  }, [target, navigate, location.state])

  const close = () => navigate('/lite', { replace: true })

  if (next.isPending || target?.downloaded) {
    return (
      <Center h="100dvh">
        <div className="reader-page-skeleton" aria-hidden />
      </Center>
    )
  }

  if (!target) return <Navigate to={`/series/${seriesId}`} replace state={location.state} />

  if (!can('DownloadChapters')) {
    return (
      <Center h="100dvh" p="md" ta="center">
        <div>
          <Trans>This chapter is not downloaded, and your account cannot download chapters.</Trans>
        </div>
      </Center>
    )
  }

  return (
    <DownloadSplash
      chapterId={target.chapterId}
      chapterLabel={label}
      seriesTitle={series?.displayTitle ?? ''}
      coverUrl={series?.coverUrl ?? null}
      confirm
      onClose={close}
    />
  )
}
