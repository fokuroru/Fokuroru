import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const ts = require('typescript')
const text = await readFile(new URL('../../frontend/src/pages/reader/bookLayout.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const module = { exports: {} }
new Function('module', 'exports', compiled)(module, module.exports)
const { bookSpreads, bookFaces, contentPage } = module.exports

let cases = 0
for (let count = 1; count <= 40; count++) {
  const urls = Array.from({ length: count }, (_, i) => `printed-${i}`).concat(['blank-front', 'blank-back', 'outside-back'])
  for (const wide of [{}, { 1: true }, { [count - 1]: true }, { 2: true, 5: true, 6: true }, Object.fromEntries(Array.from({ length: count }, (_, i) => [i, i > 0]))]) {
    for (const double of [false, true]) for (const mirror of [false, true]) {
      const spreads = bookSpreads(count, urls.length, wide, double)
      const { opening, backOf, backCover } = bookFaces(urls, wide, mirror, double, count)
      assert.deepEqual(spreads[0], [0])
      assert.deepEqual(spreads.at(-1), [backCover], 'the back cover never shares a spread, regardless of wide pages')
      assert.deepEqual(spreads.flat().filter((page) => page < count), Array.from({ length: count }, (_, i) => i), 'each archive page is reachable exactly once in its original order')
      const front = opening(spreads[0])
      assert.equal(front.left, null, 'nothing appears beside the closed front cover')
      assert.equal(backOf(front.right).src, 'blank-front', 'the front cover is blank on its inside')
      const first = opening(spreads[1])
      assert.equal(first.left.src, 'blank-front', 'opening the front cover reveals its blank inside')
      assert.equal(first.left.cover, true)
      const last = opening(spreads.at(-2))
      assert.equal(last.right.src, 'blank-back', 'the inside back cover is blank')
      assert.equal(last.right.cover, true)
      assert.equal(backOf(last.right).src, 'outside-back')
      const closed = opening(spreads.at(-1))
      assert.equal(closed.right, null, 'nothing appears beside the closed back cover')
      assert.equal(closed.left.src, 'outside-back')
      for (let i = 0; i < spreads.length - 1; i++) {
        const before = opening(spreads[i])
        const after = opening(spreads[i + 1])
        assert.ok(before.right, 'every forward turn has a right leaf to lift')
        assert.ok(after.left, 'every forward turn has a back face to land on')
        if (double && spreads[i + 1][0] > 1 && spreads[i + 1][0] < count && wide[spreads[i + 1][0]]) {
          assert.notEqual(before.right.src, 'blank-front', 'alignment padding is not inserted immediately before a wide spread')
        }
      }
      assert.equal(contentPage(count, count), 0, 'the opening filler does not finish the chapter')
      assert.equal(contentPage(count + 1, count), count - 1)
      assert.equal(contentPage(backCover, count), count - 1)
      cases++
    }
  }
}
assert.deepEqual(bookSpreads(6, 9, { 3: true }, true).slice(0, 4), [[0], [6], [1, 2], [3]], 'the first alignment blank follows the inside front cover')
const multi = bookFaces(['cover', 'wide-a', 'page', 'wide-b', 'page', 'page', 'blank-front', 'blank-back', 'back'], { 1: true, 3: true }, false, true, 6)
assert.equal(multi.opening([2]).left.src, 'blank-front')
assert.equal(multi.opening([2]).right.src, 'page', 'unavoidable padding between wide spreads precedes the intervening pages')
console.log(`Book layout: ${cases} cases passed (page counts, wide pages, single/double, LTR/RTL, blank inside covers and progress)`)
