import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const ts = require('typescript')
const source = await readFile(new URL('../../frontend/src/api/previewCache.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
const { PREVIEW_RETENTION_MS, previewCacheKey, readPreviewCache, writePreviewCache } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const stored = new Map()
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: (key) => stored.delete(key),
}
const key = previewCacheKey(1, '123', 'sources')
writePreviewCache(key, [{ sourceName: 'fake', firstChapterUrl: 'https://example.com/1' }])
assert.equal(readPreviewCache(key).data[0].sourceName, 'fake', 'results survive component recreation')
assert.equal(readPreviewCache(previewCacheKey(2, '123', 'sources')), undefined, 'accounts are isolated')
stored.set(key, JSON.stringify({ savedAt: Date.now() - PREVIEW_RETENTION_MS, data: true }))
assert.equal(readPreviewCache(key), undefined, 'expires at 30 days')
assert.equal(stored.has(key), false, 'expired results are removed')
stored.set(key, 'invalid json')
assert.equal(readPreviewCache(key), undefined)
globalThis.localStorage.getItem = () => { throw new Error('blocked') }
assert.equal(readPreviewCache(key), undefined, 'blocked storage does not break preview')
console.log('Preview retention checks passed')
