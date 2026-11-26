import { useEffect, useMemo, useRef, useState } from 'react'

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('page failed to load'))
    image.src = src
  })
}

async function stitch(sources: string[]): Promise<string> {
  const images = await Promise.all(sources.map(load))
  const width = images[0]!.naturalWidth
  const heights = images.map((image) => Math.round((image.naturalHeight * width) / image.naturalWidth))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = heights.reduce((sum, height) => sum + height, 0)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  let top = 0
  images.forEach((image, index) => {
    context.drawImage(image, 0, top, width, heights[index])
    top += heights[index]!
  })
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.95))
  if (!blob) throw new Error('stitch failed')
  return URL.createObjectURL(blob)
}

/**
 * A page and the strips measured under it become one image, drawn at the page's width with no gap,
 * so the reader treats the lot as an ordinary page. Until the stitched copy is ready the page shows
 * as it came.
 */
export function useStitched(urls: string[], groups: number[][]): string[] {
  const [done, setDone] = useState<Record<string, string>>({})
  const made = useRef<string[]>([])

  useEffect(() => {
    let live = true
    for (const group of groups) {
      const sources = group.map((page) => urls[page])
      if (sources.some((src) => !src)) continue
      const key = sources.join('|')
      if (done[key]) continue
      stitch(sources as string[]).then(
        (url) => {
          if (!live) return URL.revokeObjectURL(url)
          made.current.push(url)
          setDone((current) => ({ ...current, [key]: url }))
        },
        () => {},
      )
    }
    return () => {
      live = false
    }
  }, [urls, groups, done])

  useEffect(
    () => () => {
      made.current.forEach((url) => URL.revokeObjectURL(url))
      made.current = []
    },
    [],
  )

  return useMemo(() => {
    if (groups.length === 0) return urls
    const next = [...urls]
    for (const group of groups) {
      const stitched = done[group.map((page) => urls[page]).join('|')]
      if (stitched) next[group[0]!] = stitched
    }
    return next
  }, [urls, groups, done])
}
