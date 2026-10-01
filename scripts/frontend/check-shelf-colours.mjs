import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const ts = require('typescript')
const source = await readFile(new URL('../../frontend/src/components/library/shelf3d/coverPalette.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
const { coverPalette } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const pixels = (swatches) => new Uint8ClampedArray(swatches.flatMap(([rgb, count]) =>
  Array.from({ length: count }, () => [...rgb, 255]).flat()))
const examples = [
  ['yellow', [238, 214, 67], [[230, 230, 230], 20], [[40, 110, 220], 5]],
  ['pink', [219, 104, 152], [[245, 216, 188], 50], [[40, 110, 220], 5]],
  ['muted green', [122, 166, 137], [[245, 216, 188], 50], [[170, 160, 190], 10]],
]
for (const [name, rgb, neutral, accent] of examples) {
  const palette = coverPalette(pixels([[rgb, 100], neutral, accent]))
  const expected = `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
  assert.equal(palette?.bg, expected, `${name} must keep its cover hue`)
}
assert.equal(coverPalette(pixels([[[240, 240, 240], 100], [[30, 30, 30], 100]])), null)
assert.equal(coverPalette(pixels([[[245, 216, 188], 100]])), null, 'skin must not dictate the spine colour')
assert.equal(coverPalette(new Uint8ClampedArray([240, 210, 40, 0])), null, 'transparent pixels do not count')
assert.equal(coverPalette(pixels([[[238, 214, 67], 100]]))?.fg, '#000000', 'yellow uses black lettering')
assert.equal(coverPalette(pixels([[[35, 50, 125], 100]]))?.fg, '#ffffff', 'dark covers use white lettering')
const luminance = (hex) => {
  const rgb = hex.match(/[0-9a-f]{2}/g).map((v) => parseInt(v, 16) / 255)
  return rgb.reduce((sum, v, i) => sum + (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i], 0)
}
for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
  const palette = coverPalette(pixels([[[r, g, b], 1]]))
  if (!palette) continue
  const ink = luminance(palette.fg)
  for (const ground of [palette.bg, palette.accent]) {
    const light = luminance(ground)
    assert.ok((Math.max(ink, light) + 0.05) / (Math.min(ink, light) + 0.05) >= 4.5, `low text contrast on ${ground}`)
  }
}
console.log('Shelf colour regression checks passed')
