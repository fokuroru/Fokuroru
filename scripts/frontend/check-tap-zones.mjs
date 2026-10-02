import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const ts = require('typescript')
const text = await readFile(new URL('../../frontend/src/lib/tapZones.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const module = { exports: {} }
new Function('module', 'exports', compiled)(module, module.exports)
const T = module.exports

// The built-in layout is the one the reader always had, so nobody's reading changes until they edit it.
const ltr = T.defaultZones('horizontal', 'ltr')
assert.equal(T.actionAt(ltr, 0.1, 0.5), 'prev')
assert.equal(T.actionAt(ltr, 0.9, 0.5), 'next')
assert.equal(T.actionAt(ltr, 0.5, 0.5), 'menu')
const rtl = T.defaultZones('horizontal', 'rtl')
assert.equal(T.actionAt(rtl, 0.1, 0.5), 'next', 'right to left puts next on the left')
assert.equal(T.actionAt(rtl, 0.9, 0.5), 'prev')
const vertical = T.defaultZones('vertical', 'ltr')
assert.equal(T.actionAt(vertical, 0.5, 0.1), 'prev')
assert.equal(T.actionAt(vertical, 0.5, 0.9), 'next')
assert.equal(T.actionAt(vertical, 0.5, 0.5), 'menu')

// Edges: the old test was ratio < 0.33 and ratio > 0.67.
assert.equal(T.actionAt(ltr, 0.329, 0.5), 'prev')
assert.equal(T.actionAt(ltr, 0.33, 0.5), 'menu')
assert.equal(T.actionAt(ltr, 0.67, 0.5), 'next')

// Earlier zones win, and a "none" zone swallows the tap.
const stacked = [
  { x: 0.4, y: 0.4, w: 0.2, h: 0.2, action: 'none' },
  { x: 0, y: 0, w: 1, h: 1, action: 'next' },
]
assert.equal(T.actionAt(stacked, 0.5, 0.5), 'none')
assert.equal(T.actionAt(stacked, 0.1, 0.1), 'next')

// Flipping mirrors left and right and is its own inverse.
const zones = [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4, action: 'prev' }]
assert.deepEqual(T.flipZones(zones), [{ x: 0.6, y: 0.2, w: 0.3, h: 0.4, action: 'prev' }])
assert.deepEqual(T.flipZones(T.flipZones(zones)), zones)

// Clamping keeps a zone on the page and tappable.
assert.deepEqual(T.clampZone({ x: -1, y: 2, w: 5, h: 0, action: 'next' }), { x: 0, y: 0.98, w: 1, h: 0.02, action: 'next' })

// Every built-in layout is valid, fits the limits, and uses only known actions.
for (const orientation of ['horizontal', 'vertical']) {
  for (const direction of ['ltr', 'rtl']) {
    const presets = T.builtInPresets(orientation, direction)
    assert.ok(presets.length >= 2)
    assert.equal(new Set(presets.map((p) => p.id)).size, presets.length, 'preset ids are unique')
    for (const preset of presets) {
      assert.ok(preset.zones.length <= T.MAX_ZONES)
      for (const zone of preset.zones) {
        assert.deepEqual(T.clampZone(zone), zone)
        assert.ok(T.TAP_ACTIONS.includes(zone.action))
      }
    }
  }
}
// The default layout is the first preset, so "reset" and "the first preset" can never disagree.
assert.deepEqual(T.builtInPresets('horizontal', 'rtl')[0].zones, T.defaultZones('horizontal', 'rtl'))

// A saved layout wins over the default, and an absent one falls back.
const doc = { horizontal: [{ x: 0, y: 0, w: 0.5, h: 1, action: 'next' }], vertical: null, presets: [] }
assert.equal(T.layoutFor(doc, 'horizontal', 'rtl')[0].action, 'next')
assert.deepEqual(T.layoutFor(doc, 'vertical', 'ltr'), vertical)
assert.deepEqual(T.layoutFor(undefined, 'horizontal', 'ltr'), ltr)

// Whatever the server or storage hands back is made safe.
const messy = T.tidyDocument({
  horizontal: [{ x: 'a', y: 0, w: 1, h: 1, action: 'next' }, { x: 0, y: 0, w: 1, h: 1, action: 'explode' }, { x: -3, y: 0, w: 9, h: 1, action: 'menu' }],
  vertical: 'nope',
  presets: [{ id: 'p', name: 'Mine', orientation: 'vertical', zones: [{ x: 0, y: 0, w: 1, h: 1, action: 'prev' }] }, { id: 2 }, null],
})
assert.deepEqual(messy.horizontal, [{ x: 0, y: 0, w: 1, h: 1, action: 'menu' }])
assert.equal(messy.vertical, null)
assert.equal(messy.presets.length, 1)
assert.deepEqual(T.tidyDocument(null), T.EMPTY_DOCUMENT)
assert.equal(T.tidyDocument({ presets: new Array(100).fill({ id: 'x', name: 'n', orientation: 'horizontal', zones: [] }) }).presets.length, T.MAX_PRESETS)

console.log('tap zones ok')
