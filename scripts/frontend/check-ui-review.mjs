import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const ts = require('typescript')

async function loadFunction(path, name, bindings = {}) {
  const source = await readFile(new URL(`../../frontend/src/${path}`, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(fn, `${name} exists in ${path}`)
  const compiled = ts.transpileModule(fn.getText(ast).replace(/^export /, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  return new Function(...Object.keys(bindings), `${compiled}; return ${name}`)(...Object.values(bindings))
}

test('library read filter preserves reading history after files are deleted', async () => {
  const seriesProgressVisual = await loadFunction('components/ui/status.tsx', 'seriesProgressVisual')
  const readPercent = await loadFunction('pages/LibraryPage.tsx', 'readPercent', { seriesProgressVisual })
  const series = { wantedChapterCount: 10, knownChapterCount: 20, chapterFileCount: 0,
    readChapterCount: 0, readMainChapters: 10, mainChapterCount: 20 }
  assert.equal(readPercent(series), 50)
  assert.equal(readPercent({ ...series, mainChapterCount: 0 }), 0)
  assert.equal(readPercent({ ...series, readMainChapters: 30 }), 100)
})

test('library search finds displayed, original, and alternate titles', async () => {
  const matchesSeriesTitle = await loadFunction('api/titles.ts', 'matchesSeriesTitle')
  const series = { title: 'The Girl I Like Forgot Her Glasses', displayTitle: '好きな子がめがねを忘れた',
    originalTitle: '好きな子がめがねを忘れた', altTitles: [{ title: 'SukiMega', language: 'en' }] }
  for (const query of ['sukimega', ' SUKIMEGA ', '好きな子', 'forgot her glasses', '']) {
    assert.equal(matchesSeriesTitle(series, query), true, query)
  }
  assert.equal(matchesSeriesTitle(series, 'unrelated'), false)
  assert.equal(matchesSeriesTitle({ title: 'Untitled', displayTitle: 'Untitled', originalTitle: null }, 'title'), true)
})

test('automatic spreads fit foldable and desktop windows but not a rotated phone', async () => {
  const viewportSupportsSpreads = await loadFunction('lib/nativeApp.ts', 'viewportSupportsSpreads')
  for (const [width, height, want] of [
    [372, 828, false], [828, 372, false], [599, 900, false], [600, 960, false],
    [756, 813, true], [840, 904, true], [840, 1280, true], [1440, 1000, true],
  ]) assert.equal(viewportSupportsSpreads(width, height), want, `${width}×${height}`)
})
