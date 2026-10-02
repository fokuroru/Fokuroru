import { useEffect, useRef, useSyncExternalStore } from 'react'

/**
 * What the Android app injects as `window.MakiNative`. Every method takes and returns primitives, so
 * lists travel as JSON strings. Absent in a normal browser, which is the whole feature gate.
 */
interface MakiNativeBridge {
  version(): string
  /** The oldest server version this app build works with; absent on an older app. */
  serverVersion?(): string
  layout(): string
  offline(): boolean
  queueProgress(chapterId: number, page: number, completed: boolean, seconds: number, final: boolean): void
  download(ids: string): void
  removeDownload(ids: string): void
  downloads(): string
  openSettings(): void
  openDownloads(): void
  openReaderTools(): void
}

declare global {
  interface Window {
    MakiNative?: MakiNativeBridge
    /** True while a page-turn listener is mounted, so the app knows whether taking over the volume keys does anything. */
    __makiTurn?: boolean
  }
}

export function nativeApp(): MakiNativeBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.MakiNative
}

export interface NativeDownload {
  id: number
  state: 'queued' | 'downloading' | 'done' | 'failed'
  pagesDone: number
  pageCount: number
}

function parse<T>(text: string | undefined, fallback: T): T {
  try {
    return text ? (JSON.parse(text) as T) : fallback
  } catch {
    return fallback
  }
}

/** Fetch failures surface as a TypeError; anything else is the server answering. */
export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError
}

/** The app already knows the server can't be reached, so a write need not wait for a request to time out. */
export function nativeKnownOffline(): boolean {
  return nativeApp()?.offline() === true
}

/**
 * Keeps a progress write the app can replay when the connection returns. True when the app took it.
 * Position and completion are idempotent on the server, so a replay of one that did land is harmless.
 */
export function queueNativeProgress(
  chapterId: number,
  page: number,
  completed: boolean | undefined,
  seconds: number | undefined,
  final: boolean,
): boolean {
  const native = nativeApp()
  if (!native) return false
  native.queueProgress(chapterId, page, completed === true, Math.max(0, Math.round(seconds ?? 0)), final)
  return true
}

let downloadsSnapshot: Map<number, NativeDownload> = new Map()
const downloadListeners = new Set<() => void>()

function readDownloads(): Map<number, NativeDownload> {
  const rows = parse<NativeDownload[]>(nativeApp()?.downloads(), [])
  return new Map(rows.map((row) => [row.id, row]))
}

function onDownloadsChanged() {
  downloadsSnapshot = readDownloads()
  downloadListeners.forEach((listener) => listener())
}

function subscribeDownloads(listener: () => void) {
  if (downloadListeners.size === 0) {
    window.addEventListener('maki-native-downloads', onDownloadsChanged)
    downloadsSnapshot = readDownloads()
  }
  downloadListeners.add(listener)
  return () => {
    downloadListeners.delete(listener)
    if (downloadListeners.size === 0) window.removeEventListener('maki-native-downloads', onDownloadsChanged)
  }
}

const EMPTY_DOWNLOADS: Map<number, NativeDownload> = new Map()

/** Chapters saved to, or being saved to, this device, keyed by chapter id. Empty outside the app. */
export function useNativeDownloads(): Map<number, NativeDownload> {
  return useSyncExternalStore(
    subscribeDownloads,
    () => (nativeApp() ? downloadsSnapshot : EMPTY_DOWNLOADS),
    () => EMPTY_DOWNLOADS,
  )
}

export function saveToDevice(chapterIds: number[]) {
  nativeApp()?.download(JSON.stringify(chapterIds))
}

export function removeFromDevice(chapterIds: number[]) {
  nativeApp()?.removeDownload(JSON.stringify(chapterIds))
}

interface NativeLayout {
  /** The window is wide enough (tablet, unfolded foldable) to show two pages at once. */
  dual: boolean
}

let layoutSnapshot: NativeLayout = { dual: false }
const layoutListeners = new Set<() => void>()

function onLayout(event: Event) {
  const detail = (event as CustomEvent<NativeLayout>).detail
  if (detail && detail.dual !== layoutSnapshot.dual) {
    layoutSnapshot = { dual: detail.dual }
    layoutListeners.forEach((listener) => listener())
  }
}

function subscribeLayout(listener: () => void) {
  if (layoutListeners.size === 0) {
    window.addEventListener('maki-native-layout', onLayout)
    layoutSnapshot = parse<NativeLayout>(nativeApp()?.layout(), { dual: false })
  }
  layoutListeners.add(listener)
  return () => {
    layoutListeners.delete(listener)
    if (layoutListeners.size === 0) window.removeEventListener('maki-native-layout', onLayout)
  }
}

export function useNativeLayout(): NativeLayout {
  return useSyncExternalStore(
    subscribeLayout,
    () => (nativeApp() ? layoutSnapshot : NO_LAYOUT),
    () => NO_LAYOUT,
  )
}

const NO_LAYOUT: NativeLayout = { dual: false }

/** Hardware page-turn buttons (volume keys, clickers, stylus) arrive as one event, already direction-neutral. */
export function useNativeTurn(handler: (direction: 'next' | 'prev') => void) {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => {
    const onTurn = (event: Event) => {
      const direction = (event as CustomEvent<string>).detail
      if (direction === 'next' || direction === 'prev') latest.current(direction)
    }
    window.addEventListener('maki-native-turn', onTurn)
    window.__makiTurn = true
    return () => {
      window.removeEventListener('maki-native-turn', onTurn)
      window.__makiTurn = false
    }
  }, [])
}
