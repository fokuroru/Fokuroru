import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, getInitialize } from './client'
import type { RecommendationItem } from './hooks'

/** The first chapter of a series that is not in the library, fetched from whichever source has it. */
export interface SeriesPreview {
  providerId: number
  status: 'queued' | 'searching' | 'fetching' | 'ready' | 'failed'
  error: string | null
  sourceName: string | null
  sourceDisplayName: string | null
  chapterLabel: string | null
  pageCount: number | null
  /** Changes when the server switches source, so page URLs built on it never serve stale art. */
  version: string | null
  /** One entry per page, true once that page can be requested. */
  ready: boolean[]
}

const key = (providerId: string) => ['series-preview', providerId]

// Previews read to the end, by provider id. Adding the series happens in another component (the
// Discover card), so this hands the chapter over without threading it through every caller.
const finishedPreviews = new Map<string, string>()

export function markPreviewFinished(providerId: string, chapterLabel: string) {
  finishedPreviews.set(providerId, chapterLabel)
}

/** The chapter label of a preview read to the end, once; null when the preview was not finished. */
export function takePreviewFinished(providerId: string): string | null {
  const label = finishedPreviews.get(providerId) ?? null
  finishedPreviews.delete(providerId)
  return label
}

/**
 * Marks the chapter read as a preview read and unwanted on a series that has just been added. The
 * server holds the mark until source matching has brought the chapter in.
 */
export function useMarkPreviewRead() {
  return useMutation({
    mutationFn: ({ seriesId, chapterNumber }: { seriesId: number; chapterNumber: number }) =>
      api<void>(`/series/${seriesId}/preview-read`, {
        method: 'POST',
        body: JSON.stringify({ chapterNumber }),
      }),
  })
}

export function useStartSeriesPreview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (providerId: string) =>
      api<SeriesPreview>(`/preview/${encodeURIComponent(providerId)}`, { method: 'POST' }),
    onSuccess: (snapshot, providerId) => {
      queryClient.setQueryData(key(providerId), snapshot)
    },
  })
}

/** Polls while the server is still finding a source or pulling pages down. */
export function useSeriesPreview(providerId: string, enabled: boolean) {
  return useQuery({
    queryKey: key(providerId),
    queryFn: () => api<SeriesPreview>(`/preview/${encodeURIComponent(providerId)}`),
    enabled,
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'queued' || status === 'searching' || status === 'fetching' ? 1000 : false
    },
  })
}

/** Releases the viewer; downloaded pages and an in-flight fetch remain available for returning. */
export function releaseSeriesPreview(providerId: string) {
  void api(`/preview/${encodeURIComponent(providerId)}`, { method: 'DELETE' }).catch(() => {})
}

/** Deletes the downloaded pages for everyone; the preview can be started again later. */
export async function deleteSeriesPreview(providerId: string) {
  await api(`/preview/${encodeURIComponent(providerId)}/files`, { method: 'DELETE' })
}

export async function previewPageUrl(providerId: string, page: number, version: string): Promise<string> {
  const init = await getInitialize()
  return `${init.apiRoot}/preview/${encodeURIComponent(providerId)}/page/${page}?v=${encodeURIComponent(version)}`
}

/** Series that have a preview downloaded and are not in the library, newest first. */
export function useCachedPreviews(enabled: boolean) {
  return useQuery({
    queryKey: ['series-previews', 'cached'],
    queryFn: () => api<RecommendationItem[]>('/preview/cached'),
    enabled,
    staleTime: 60_000,
  })
}

/** A preview request that has not finished: queued, downloading, or failed and due again shortly. */
export interface PendingPreview {
  item: RecommendationItem
  status: 'queued' | 'searching' | 'fetching' | 'failed' | 'waiting'
  attempts: number
  retryAt: string | null
}

/** Every series with a preview request still waiting. Previews belong to the instance, so this is not per user. */
export function usePendingPreviews() {
  return useQuery({
    queryKey: ['series-previews', 'pending'],
    queryFn: () => api<PendingPreview[]>('/preview/pending'),
    refetchInterval: 20_000,
  })
}

/** What the "check now" button did, or when it next works if it was pressed too soon. */
export interface PreviewCheck {
  started: boolean
  restarted: number
  nextCheckAt: string
}

const checkKey = ['series-previews', 'check']

/** When the "check now" button next works. The limit is for the whole instance, not per user. */
export function usePreviewCheckStatus() {
  return useQuery({
    queryKey: checkKey,
    queryFn: () => api<{ nextCheckAt: string }>('/preview/pending/check'),
  })
}

/** Tries every failed preview request again now. The server allows it once every few minutes. */
export function useCheckPreviewsNow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<PreviewCheck>('/preview/pending/check', { method: 'POST' }),
    onSuccess: (result) => {
      queryClient.setQueryData(checkKey, { nextCheckAt: result.nextCheckAt })
      queryClient.invalidateQueries({ queryKey: ['series-previews', 'pending'] })
    },
  })
}
