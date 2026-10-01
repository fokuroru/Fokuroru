/** Preview choices and source results survive reloads for 30 days, scoped to the signed-in user. */
export const PREVIEW_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export function previewCacheKey(userId: number | undefined, providerId: string, kind: string) {
  return `maki-preview:${userId ?? 'anonymous'}:${providerId}:${kind}`
}

export function readPreviewCache<T>(key: string): { savedAt: number; data: T } | undefined {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    const entry = JSON.parse(raw) as { savedAt: number; data: T }
    if (!Number.isFinite(entry.savedAt) || Date.now() - entry.savedAt >= PREVIEW_RETENTION_MS) {
      localStorage.removeItem(key)
      return undefined
    }
    return entry
  } catch {
    return undefined
  }
}

export function writePreviewCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }))
  } catch {
    // Storage may be unavailable or full. The current preview still works.
  }
}
