import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const ts = require('typescript')
const source = await readFile(new URL('../../frontend/src/components/ui/status.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('status.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'seriesProgressVisual')
assert.ok(fn, 'shared series progress calculation exists')
const compiled = ts.transpileModule(fn.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
const { seriesProgressVisual } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const series = { wantedChapterCount: 10, knownChapterCount: 21, chapterFileCount: 10,
  readChapterCount: 10, readMainChapters: 10, mainChapterCount: 20 }
assert.equal(seriesProgressVisual(series, true).readPct, 50, 'all downloaded read is only half the series')
assert.equal(seriesProgressVisual({ ...series, chapterFileCount: 0, wantedChapterCount: 0 }, true).readPct, 50,
  'deleting files and unsetting wanted must preserve completion')
assert.equal(seriesProgressVisual({ ...series, readMainChapters: 20 }, true).readPct, 100)
assert.equal(seriesProgressVisual({ ...series, mainChapterCount: 0 }, true).readPct, null)
assert.equal(seriesProgressVisual(series, false).readPct, null)
assert.equal(seriesProgressVisual(series, true).pct, 100, 'downloads retain their own calculation')
console.log('Series completion checks passed')
