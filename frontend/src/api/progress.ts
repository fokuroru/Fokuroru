import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export type ProgressState = 'read' | 'started' | 'ready' | 'missing' | 'skipped' | 'banked'

export interface ProgressRow {
  chapterId: number
  number: string | null
  title: string | null
  kind: 'chapter' | 'bonus'
  state: ProgressState
  pages: number | null
  why: 'user' | 'source' | 'number' | null
}

export interface ProgressVolume {
  volume: number | null
  from: number | null
  to: number | null
  chapters: number
  read: number
  started: number
  ready: number
  missing: number
  bonus: number
  rows: ProgressRow[]
}

export interface ProgressUnplaced {
  chapterId: number | null
  fileId: number | null
  fileName: string
  pages: number
  source: string | null
  hint: 'year' | 'short' | 'noVolume' | 'unlinked'
}

export interface SeriesProgress {
  position: {
    chapterId: number
    label: string
    page: number
    pageCount: number
    inProgress: boolean
    next: string[]
  } | null
  totals: { chapters: number; ready: number; read: number; missing: number }
  volumes: ProgressVolume[]
  needsLook: { kind: 'duplicateNumber' | 'hiddenListings'; count: number; numbers: string[] }[]
  unplaced: ProgressUnplaced[]
  disk: {
    files: number
    bytes: number
    volumeFiles: number
    volumeChapters: number
    looseFiles: number
    trashFiles: number
    trashBytes: number
    purgeAfter: string | null
  }
}

export interface PlaceRequest {
  chapterId: number | null
  fileId: number | null
  volume: number
  /** The whole chapter number it follows; -1 for the start of the volume, null for the end. */
  after: number | null
}

export function useSeriesProgress(seriesId: number, enabled = true) {
  return useQuery({
    queryKey: ['series-progress', seriesId],
    queryFn: () => api<SeriesProgress>(`/series/${seriesId}/progress`),
    enabled,
  })
}

export function filePreviewUrl(apiRoot: string, seriesId: number, fileId: number, page: number): string {
  return `${apiRoot}/series/${seriesId}/files/${fileId}/pages/${page}`
}

function useRefreshProgress(seriesId: number) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['series-progress', seriesId] })
    void queryClient.invalidateQueries({ queryKey: ['chapters', seriesId] })
  }
}

export function usePlaceBonus(seriesId: number) {
  const refresh = useRefreshProgress(seriesId)
  return useMutation({
    mutationFn: (request: PlaceRequest) =>
      api<void>(`/series/${seriesId}/placements`, { method: 'PUT', body: JSON.stringify(request) }),
    onSuccess: refresh,
  })
}

export function useClearPlacement(seriesId: number) {
  const refresh = useRefreshProgress(seriesId)
  return useMutation({
    mutationFn: (chapterId: number) =>
      api<void>(`/series/${seriesId}/placements/${chapterId}`, { method: 'DELETE' }),
    onSuccess: refresh,
  })
}
