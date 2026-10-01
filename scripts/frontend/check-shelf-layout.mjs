import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const ts = require('typescript')
const T = require('three')
const text = await readFile(new URL('../../frontend/src/components/library/shelf3d/mangaShelf.ts', import.meta.url), 'utf8')
const source = ts.createSourceFile('mangaShelf.ts', text, ts.ScriptTarget.Latest, true)
const shelfClass = source.statements.find((node) => ts.isClassDeclaration(node) && node.name.text === 'MangaShelf')
const names = ['layout', 'refreshBooks', 'resizeViewport', 'setBoard', 'setTheme', 'setBooks', 'feelScroll']
const methods = shelfClass.members.filter((node) => ts.isMethodDeclaration(node) && names.includes(node.name.getText(source)))
const compiled = ts.transpileModule(`class Shelf { ${methods.map((method) => method.getText(source)).join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
// Use production methods with a small scene. A rebuild or random placement is a regression.
const Shelf = new Function('T', 'planShelf', `${compiled}; return Shelf`)(T, () => { throw Error('existing books must not be replanned') })
const shelf = new Shelf()
const body = { position: { x: 340, y: 220 }, bounds: { max: { x: 360 } }, angle: 0.2, z: -40, zTarget: -30, velocity: { x: 1, y: 2 } }
const pose = JSON.stringify(body)
const scene = new T.Scene()
const plank = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial())
const row = { scene, shelf: plank, physics: { shelfAcceleration: { x: 0, y: 0 }, remove() { throw Error('body removed') } } }
const book = { id: 1, title: 'Book', author: 'Author', number: '2', coverUrl: null, width: 40, height: 180, depth: 100 }
const model = new T.Group()
model.position.set(70, 160, 10)
scene.add(model)
const item = { book, body, model, row, button: {} }
const prop = { body: { position: { x: 500, y: 300 } } }
Object.assign(shelf, {
  books: [book], items: [item], rows: [row], props: [prop], sticks: [], spawnedBooks: new Set([1]),
  cssWidth: 900, logicalWidth: 900, generation: 0, abort: new AbortController(), prank: null,
  figureUrl: null, renderedFigureUrl: null, board: null, lastScrollAt: -Infinity,
  loadCovers: async () => {}, wake() {}, clear() { throw Error('scene rebuilt') },
  sizeCanvas() {}, model: () => ({ group: new T.Group(), hinges: {} }),
  disposeModel: (object) => object.removeFromParent(), label: (b) => b.number,
})
await shelf.layout()
assert.equal(shelf.items[0], item)
assert.equal(shelf.props[0], prop)
const figure = new T.Group()
let placed = false
shelf.figureRoll = 0
shelf.figureChance = 1
shelf.figureUrl = '/figure.glb'
shelf.loadFigure = async () => figure
shelf.placeFigure = (_row, _width, _end, model) => { assert.equal(model, figure); placed = true }
await shelf.layout()
assert.equal(placed, true, 'late figures are added without rebuilding existing items')
assert.equal(shelf.props[0], prop, 'a late figure must not remove the plant or saucer')
assert.equal(JSON.stringify(body), pose)
shelf.books = [{ ...book, number: '3' }]
await shelf.layout()
assert.equal(item.body, body)
assert.equal(JSON.stringify(body), pose, 'chapter updates preserve complete physics state')
assert.deepEqual(item.model.position.toArray(), [70, 160, 10])
assert.equal(item.book.number, '3')
await shelf.layout()
assert.equal(JSON.stringify(body), pose, 'repeated refreshes preserve positions')
shelf.resizeViewport(940)
assert.equal(shelf.logicalWidth, 900, 'resizing must preserve the physics world width')
assert.equal(shelf.scale, 940 / 900)
assert.equal(JSON.stringify(body), pose)
const boardMaterial = new T.MeshStandardMaterial()
shelf.boardMaterial = boardMaterial
shelf.wallSize = { w: 900, h: 500 }
shelf.wallTexture = () => new T.Texture()
shelf.theme = { wall: '#222222', shelf: '#444444' }
shelf.setBoard({ groups: [] })
shelf.setBoard(null)
shelf.setTheme({ wall: '#333333', shelf: '#555555' })
assert.equal(JSON.stringify(body), pose, 'board and theme updates do not move bodies')
assert.equal(shelf.feelScroll(16), false, 'page reflow without scrolling cannot jolt bodies')
assert.deepEqual(row.physics.shelfAcceleration, { x: 0, y: 0 })
console.log('Shelf layout regression checks passed')
