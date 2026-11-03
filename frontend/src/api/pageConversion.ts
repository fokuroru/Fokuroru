import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export type PageConversionFormat = 'webp' | 'avif'

/** Smallest keeps the least detail; Lossless re-encodes PNG pages losslessly and leaves JPEG pages as they are. */
export type PageConversionStop = 'smallest' | 'compact' | 'balanced' | 'high' | 'lossless'

export const PAGE_CONVERSION_STOPS: readonly PageConversionStop[] = ['smallest', 'compact', 'balanced', 'high', 'lossless']

export interface PageConversionSettings {
  /** Null while conversion is off. */
  format: PageConversionFormat | null
  stop: PageConversionStop
  /** PNG pages go to lossless WebP at every stop. */
  pngLossless: boolean
}

export interface PageConversionPassTotals {
  startedAtUtc: string
  finishedAtUtc: string | null
  converted: number
  unchanged: number
  hardlinked: number
  failed: number
  savedBytes: number
}

export interface PageConversionStatus {
  settings: PageConversionSettings
  pass: {
    state: 'idle' | 'running' | 'paused'
    /** Why a pass paused itself rather than being paused. */
    hold: 'lowDisk' | 'conversionOff' | 'settingsChanged' | null
    currentFile: string | null
    /** The pass in progress, or the last one that finished. */
    totals: PageConversionPassTotals | null
  }
  library: {
    convertedFiles: number
    savedBytes: number
    pendingFiles: number
    trashBytes: number
    trashFiles: number
    trashDays: number
    ruleCount: number
    /** Series whose own choice (Never or a fixed quality) wins over the rules. */
    overrideSeries: number
  }
}

const key = ['page-conversion']

export function usePageConversion() {
  return useQuery({
    queryKey: key,
    queryFn: () => api<PageConversionStatus>('/pageconversion'),
    refetchInterval: (query) => (query.state.data?.pass.state === 'running' ? 3000 : false),
  })
}

function useStatusMutation<T>(fn: (input: T) => Promise<PageConversionStatus>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (status) => queryClient.setQueryData(key, status),
  })
}

export function useSavePageConversion() {
  return useStatusMutation((settings: PageConversionSettings) =>
    api<PageConversionStatus>('/pageconversion/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  )
}

export function useStartPageConversion() {
  return useStatusMutation(() => api<PageConversionStatus>('/pageconversion/start', { method: 'POST' }))
}

export function usePausePageConversion() {
  return useStatusMutation(() => api<PageConversionStatus>('/pageconversion/pause', { method: 'POST' }))
}
