import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// Exercise the real physics without WebGL or a browser; use the frontend's installed compiler.
const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const ts = require('typescript')
const source = await readFile(new URL('../../frontend/src/components/library/shelf3d/shelfPhysics.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace("'matter-js'", JSON.stringify(pathToFileURL(require.resolve('matter-js')).href))
const { ShelfPhysics } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const shelf = new ShelfPhysics(600)
try {
  const grounded = shelf.add(50, shelf.floor - 100, 30, 100)
  assert.equal(shelf.hasSupport(grounded), true, 'a book on the plank has support')
  const falling = shelf.add(120, shelf.floor + 30, 30, 100)
  assert.equal(shelf.hasSupport(falling), false, 'a book below the plank must keep falling')
  const offEnd = shelf.add(650, shelf.floor - 100, 30, 100)
  assert.equal(shelf.hasSupport(offEnd), false, 'the plank does not support a book beyond its end')
  const offFront = shelf.add(220, shelf.floor - 100, 30, 100)
  offFront.supported = false
  assert.equal(shelf.hasSupport(offFront), false, 'a book released over the front edge has no plank support')
  const stacked = shelf.add(50, shelf.floor - 140, 30, 40)
  assert.equal(shelf.hasSupport(stacked), true, 'another book can support a stacked book')
  shelf.remove(stacked)
  shelf.remove(offEnd)
  shelf.remove(offFront)
  shelf.grab(falling)
  const y = falling.position.y
  for (let i = 0; i < 30; i++) shelf.step()
  assert.ok(falling.position.y > y + 30, 'hovering a falling book must not suspend it')
} finally {
  shelf.destroy()
}
assert.equal(shelf.engine.events?.collisionActive?.length ?? 0, 0, 'destroy removes crush listeners')

const plantShelf = new ShelfPhysics(600)
try {
  const plate = plantShelf.addSaucer(300, 66, 5, -30)
  const { body: pot } = plantShelf.addPlant(300, 70, 70, 100, 180, -30, 5)
  assert.equal(plantShelf.hasSupport(pot), true, 'the pot starts on its saucer')
  for (let i = 0; i < 240; i++) plantShelf.step()
  assert.ok(Math.abs(plate.position.x - 300) < 3, 'the saucer stays stable under the pot')
  assert.ok(Math.abs(pot.bounds.max.y - plate.bounds.min.y) < 3, 'the pot settles on the saucer')
  const at = { ...pot.position }
  plantShelf.grab(pot, 1, at)
  plantShelf.moveTo({ x: at.x + 110, y: at.y - 90 })
  for (let i = 0; i < 120; i++) plantShelf.step()
  assert.ok(pot.position.x > at.x + 70, 'dragging moves the plant independently')
  assert.ok(Math.abs(plate.position.x - 300) < 5, 'lifting the plant leaves its saucer behind')
  assert.equal(plantShelf.has(plate), true, 'the saucer remains in the simulation')
} finally {
  plantShelf.destroy()
}
const loadedShelf = new ShelfPhysics(600)
try {
  const plate = loadedShelf.addSaucer(300, 66, 5, -30)
  const book = loadedShelf.add(275, 160, 45, 180, 0, 66)
  loadedShelf.setDepth(book, -30, 66)
  let movement = 0
  let rotation = 0
  for (let i = 0; i < 1200; i++) {
    const before = { ...plate.position }
    const angle = plate.angle
    loadedShelf.step()
    if (i >= 900) {
      movement = Math.max(movement, Math.hypot(plate.position.x - before.x, plate.position.y - before.y))
      rotation = Math.max(rotation, Math.abs(plate.angle - angle))
    }
  }
  assert.ok(movement < 0.02, `loaded saucer keeps moving: ${movement} pixels per step`)
  assert.ok(rotation < 0.0005, `loaded saucer keeps rocking: ${rotation} radians per step`)
  assert.ok(plate.isSleeping, 'a loaded saucer must settle to sleep')
  const grip = { ...plate.position }
  loadedShelf.grab(plate, 1, grip)
  loadedShelf.moveTo({ x: grip.x - 120, y: grip.y - 100 })
  for (let i = 0; i < 120; i++) loadedShelf.step()
  assert.ok(plate.position.x < grip.x - 70, 'the stable saucer remains draggable')
  assert.equal(loadedShelf.has(book), true, 'the load remains on the shelf')
} finally {
  loadedShelf.destroy()
}
console.log('Shelf physics regression checks passed')
