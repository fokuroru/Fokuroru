import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const ts = require('typescript')
const source = await readFile(new URL('../../frontend/src/pages/reader/pageCurl.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const module = { exports: {} }
new Function('module', 'exports', 'require', compiled)(module, module.exports, () => ({ heldPageUrl: () => undefined }))
const { PageCurl, pageWear } = module.exports
const worn = Array.from({ length: 200 }, (_, page) => pageWear(page)[1]).filter(Boolean).length
assert.ok(worn > 3 && worn < 20, 'only a small minority of pages have a worn corner')
assert.deepEqual(pageWear(27), pageWear(27), 'imperfections stay fixed as the leaf turns')
const frames = new Map()
let frameId = 0
globalThis.requestAnimationFrame = (fn) => { frames.set(++frameId, fn); return frameId }
globalThis.cancelAnimationFrame = (id) => frames.delete(id)
globalThis.window = {
  innerWidth: 1200, innerHeight: 800, devicePixelRatio: 3,
  matchMedia: () => ({ matches: false }),
  setTimeout, clearTimeout,
  addEventListener() {}, removeEventListener() {},
}
globalThis.getComputedStyle = () => ({ overflowX: 'clip' })
const listeners = new Map()
const surface = {
  style: {},
  addEventListener: (name, fn) => listeners.set(name, fn),
  removeEventListener: (name) => listeners.delete(name),
  setPointerCapture() {},
}
const host = { parentElement: surface, dataset: {} }
const curl = new PageCurl({ getContext: () => null }, host, () => {}, () => {}, () => {})
const face = (page, cover = false) => ({ page, cover, src: `page-${page}`, part: 'whole', mirrored: false })
const context = {
  urls: ['page-0', 'page-1', 'page-2'], current: [0], next: [1], previous: null,
  enabled: true, draggable: true, mirror: false, sheetAspect: null, sheetFill: 'stretch',
  geometry: () => ({ spineX: 600, top: 100, pageWidth: 400, pageHeight: 600 }),
  opening: ([page]) => ({ left: null, right: face(page, page === 0) }),
  backOf: (front) => ({ ...front, mirrored: true }), beforeTurn: async () => {},
}
curl.update(context)
curl.gl = {}
const turn = curl.plan([1], [2], true)
curl.turn = turn
curl.grabY = 600
curl.finger = { x: 200, y: 600 }
assert.ok(curl.fold(turn).radius < 0.01, 'a landed paper sheet lies flush instead of floating above the book')

let draws = 0
curl.draw = () => draws++
curl.texture = async () => ({ texture: {}, aspect: 2 / 3, paper: [1, 1, 1] })
const event = (x) => ({ isPrimary: true, button: 0, pointerId: 1, clientX: x, clientY: 600, timeStamp: x, preventDefault() {} })
listeners.get('pointerdown')(event(950))
listeners.get('pointermove')(event(930))
await new Promise((resolve) => setTimeout(resolve, 0))
draws = 0
for (let x = 920; x > 800; x--) listeners.get('pointermove')(event(x))
assert.equal(draws, 0, 'pointer samples wait for the next display frame')
assert.equal(frames.size, 1, 'a burst of pointer events queues only one draw')
for (const [id, fn] of frames) { frames.delete(id); fn(performance.now()) }
assert.equal(draws, 1)
listeners.get('pointermove')(event(790))
listeners.get('pointercancel')({ ...event(790), type: 'pointercancel' })
assert.equal(frames.size, 0, 'cancelling a turn cancels its pending draw')
curl.gl = null
curl.dispose()

const drawsOnGpu = []
const buffers = []
const uniforms = new Map()
const gl = new Proxy({}, { get: (_, name) => {
  if (name === 'getProgramParameter') return () => true
  if (name === 'getUniformLocation') return (_, key) => key
  if (name === 'drawElements') return (...args) => drawsOnGpu.push(args)
  if (name === 'bufferData') return (_, data) => buffers.push(data)
  if (String(name).startsWith('uniform')) return (key, ...value) => uniforms.set(key, value)
  if (String(name).startsWith('create')) return () => ({})
  if (/^[A-Z_0-9]+$/.test(name)) return name
  return () => {}
} })
const gpuCanvas = { getContext: () => gl }
const gpu = new PageCurl(gpuCanvas, host, () => {}, () => {}, () => {})
gpu.context = { ...context, opening: ([page]) => ({ left: face(page - 1), right: face(page) }) }
gpu.turn = gpu.plan([1, 2], [3, 4], true)
for (const item of [gpu.turn.front, gpu.turn.back, gpu.turn.left, gpu.turn.right]) {
  if (item) gpu.turn.textures.set(item.src, { texture: {}, aspect: 2 / 3, paper: [1, 1, 1] })
}
gpu.grabY = 600
gpu.finger = { x: 600, y: 600 }
gpu.draw()
assert.deepEqual(drawsOnGpu.map((args) => args[1]), [6, 6, 64 * 24 * 6], 'only the turning leaf uses the curved mesh')
const vertices = buffers.find((data) => data instanceof Float32Array)
const indices = buffers.find((data) => data instanceof Uint16Array)
const corners = [...new Set(indices.slice(gpu.indexCount, gpu.indexCount + 6))].map((index) => Array.from(vertices.slice(index * 3, index * 3 + 2)))
assert.deepEqual(corners, [[0, 0], [0, 1], [1, 0], [1, 1]], 'the flat quad covers the whole page')
assert.equal(gpuCanvas.width, window.innerWidth * 2, 'high density screens have a bounded render target')
gpu.turn.front.cover = true
drawsOnGpu.length = 0
gpu.draw()
assert.deepEqual(uniforms.get('uCover'), [1], 'a cover uses the stiffer shader even when its back is an interior page')
assert.deepEqual(uniforms.get('uCoverSides'), [1, 0], 'only the outside of the cover omits the spine crease')
assert.equal(drawsOnGpu.length, 5, 'only a cover adds an underside and a thin edge')
assert.ok(uniforms.get('uThickness')[0] > 0 && uniforms.get('uThickness')[0] <= 1.1, 'cardstock thickness stays subtle at every size')
const edgeIndices = indices.slice(gpu.indexCount + 6)
assert.equal(edgeIndices.length, gpu.edgeCount)
assert.ok(Math.max(...edgeIndices) < vertices.length / 3, 'every cover edge vertex exists')
assert.ok(edgeIndices.some((index) => vertices[index * 3 + 2] === -1), 'the edge connects the two cover surfaces')
for (const [x, expected] of [[1000, [1, 0]], [200, [-1, 0]]]) {
  gpu.finger = { x, y: 600 }
  gpu.draw()
  assert.deepEqual(uniforms.get('uSwing'), expected, 'the cover is flat at both ends of its swing')
  assert.ok(Math.abs(uniforms.get('uLift')[0]) < 1e-12, 'paper imperfections settle at the handoff')
}
gpu.gl = null
gpu.dispose()
console.log('Page curl: landing, pointer frames, mesh, cover material and render budget checks passed')
