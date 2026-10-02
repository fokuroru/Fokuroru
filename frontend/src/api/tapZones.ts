import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { nativeApp } from '../lib/nativeApp'
import { EMPTY_DOCUMENT, tidyDocument, type TapClient, type TapZoneDocument } from '../lib/tapZones'

/**
 * The Android app and a browser keep separate layouts: what suits a thumb on a phone is not what suits
 * a mouse, and the same person uses both.
 */
export function tapClient(): TapClient {
  return nativeApp() ? 'app' : 'web'
}

const storageKey = (client: TapClient) => `maki.tapzones.${client}`

/** The last copy seen, so a layout applies before the server answers and while it cannot be reached. */
function remembered(client: TapClient): TapZoneDocument | undefined {
  try {
    const text = localStorage.getItem(storageKey(client))
    return text ? tidyDocument(JSON.parse(text)) : undefined
  } catch {
    return undefined
  }
}

function remember(client: TapClient, document: TapZoneDocument) {
  try {
    localStorage.setItem(storageKey(client), JSON.stringify(document))
  } catch {
    // Storage can be blocked; the server copy is the one that counts.
  }
}

export function useTapZones(client: TapClient = tapClient(), enabled = true) {
  return useQuery({
    queryKey: ['tap-zones', client],
    queryFn: async () => {
      const document = tidyDocument(await api<unknown>(`/reader/tap-zones/${client}`))
      remember(client, document)
      return document
    },
    enabled,
    placeholderData: () => remembered(client),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

export function useSaveTapZones(client: TapClient = tapClient()) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (document: TapZoneDocument) =>
      tidyDocument(await api<unknown>(`/reader/tap-zones/${client}`, { method: 'PUT', body: JSON.stringify(document) })),
    onSuccess: (document) => {
      remember(client, document)
      queryClient.setQueryData(['tap-zones', client], document)
    },
  })
}

export { EMPTY_DOCUMENT }
