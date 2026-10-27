import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { pageUrl, type ReaderManifest } from '../../api/reader'

/**
 * Resolves every page's URL once per chapter. The URLs need the API key, which arrives from an
 * async bootstrap fetch, so they can't be computed inline during render.
 */
export function usePageUrls(chapterId: number, pageCount: number, version: string | undefined, thumb = false) {
  const [urls, setUrls] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    if (!pageCount) {
      setUrls([])
      return
    }

    void Promise.all(
      Array.from({ length: pageCount }, (_, i) => pageUrl(chapterId, i, thumb, version)),
    ).then((resolved) => {
      if (!cancelled) setUrls(resolved)
    })

    return () => {
      cancelled = true
    }
  }, [chapterId, pageCount, version, thumb])

  return urls
}

/** Warms the browser cache with the next few pages so a page turn is instant. */
export function usePreload(urls: string[], page: number, count: number) {
  useEffect(() => {
    if (count <= 0) return
    const images: HTMLImageElement[] = []
    for (let i = page + 1; i <= page + count && i < urls.length; i++) {
      const image = new Image()
      image.src = urls[i]
      images.push(image)
    }
    return () => {
      // Dropping the src lets the browser abandon in-flight fetches when the reader closes.
      for (const image of images) image.src = ''
    }
  }, [urls, page, count])
}

/**
 * Fetches the first `count` pages of another chapter so a turn into it lands on loaded images.
 * The page URLs carry the chapter's `pageVersion`, which only its manifest knows, and a URL without
 * it would warm a cache entry the real load never asks for. The manifest is read straight from the
 * API rather than through React Query: `goToChapter` drops the target's cached manifest on purpose
 * (its `resumePage` goes stale), and a warm-up must not leave one behind. Neither request writes
 * reading progress.
 */
export function useWarmChapter(chapterId: number | null, active: boolean, count: number) {
  const known = useRef<{ chapterId: number; pageCount: number; version: string } | null>(null)

  useEffect(() => {
    if (chapterId == null || !active || count <= 0) return
    let cancelled = false
    const held: HTMLImageElement[] = []

    void (async () => {
      let info = known.current?.chapterId === chapterId ? known.current : null
      if (!info) {
        const manifest = await api<ReaderManifest>(`/reader/chapter/${chapterId}`)
        info = { chapterId, pageCount: manifest.pageCount, version: manifest.pageVersion }
        known.current = info
      }
      for (let i = 0; i < Math.min(count, info.pageCount); i++) {
        const src = await pageUrl(chapterId, i, false, info.version)
        if (cancelled) return
        const image = new Image()
        image.src = src
        held.push(image)
      }
    })().catch(() => {})

    return () => {
      cancelled = true
      for (const image of held) image.src = ''
    }
  }, [chapterId, active, count])
}
