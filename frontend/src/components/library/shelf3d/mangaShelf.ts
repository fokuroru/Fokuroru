import * as T from 'three'
import { ShelfPhysics, type BookBody } from './shelfPhysics'

/** One volume on the shelf. Colours are the series' own (sampled from its cover). */
export interface ShelfBook {
  id: number
  title: string
  author: string
  /** The big number in the spine's band. */
  number: string
  /** The small line under it. */
  caption: string
  width: number
  height: number
  /** 0..5: the faint pattern printed behind the spine text. */
  pattern: number
  /** Display face for the title, a CSS font-family value. */
  face: string
  bg: string
  fg: string
  accent: string
  coverUrl: string | null
  /** Band at the head of the spine rather than the foot. */
  bandTop: boolean
}

export interface ShelfTheme {
  wall: string
  shelf: string
}

interface Item {
  body: BookBody
  model: T.Object3D
  row: Row
  book: ShelfBook
}

interface Row {
  scene: T.Scene
  camera: T.PerspectiveCamera
  physics: ShelfPhysics
  index: number
}

/** Height of one shelf row in world units; the camera is framed on exactly this. */
const ROW = 420
/** Narrower containers are drawn at this logical width and scaled down, so a phone still gets a shelf. */
const MIN_LOGICAL_WIDTH = 640
const DEPTH = 132
const CLICK_SLOP = 6

/**
 * The Reading now shelf as solid volumes: Three.js books over Matter.js bodies, one camera per shelf
 * row. Hover lifts a book, a drag guides it, a click opens it. Rendering stops whenever every book is
 * asleep and nothing is held, so an idle shelf costs nothing.
 *
 * Adapted from the manga-shelf reference (Three.js and Matter.js, both MIT).
 */
export class MangaShelf {
  private readonly renderer: T.WebGLRenderer
  private readonly abort = new AbortController()
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)')
  private readonly resizeObserver: ResizeObserver
  private rows: Row[] = []
  private items: Item[] = []
  private selected: Item | null = null
  private drag: { x: number; y: number; moved: boolean; at: number } | null = null
  private access: HTMLDivElement | null = null
  private frame = 0
  private last = 0
  private acc = 0
  private quietFrames = 0
  private logicalWidth = 0
  private scale = 1
  private cssWidth = 0

  private readonly container: HTMLElement
  private books: ShelfBook[]
  private theme: ShelfTheme
  private readonly onOpen: (id: number) => void
  private readonly label: (book: ShelfBook) => string

  constructor(
    container: HTMLElement,
    books: ShelfBook[],
    theme: ShelfTheme,
    onOpen: (id: number) => void,
    label: (book: ShelfBook) => string,
  ) {
    this.container = container
    this.books = books
    this.theme = theme
    this.onOpen = onOpen
    this.label = label
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
    this.renderer.outputColorSpace = T.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = T.PCFSoftShadowMap
    const canvas = this.renderer.domElement
    canvas.className = 'shelf3d-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    container.replaceChildren(canvas)

    const options = { signal: this.abort.signal }
    canvas.addEventListener('pointermove', (e) => {
      if (this.drag) {
        const dx = (e.clientX - this.drag.x) / this.scale
        const dy = (e.clientY - this.drag.y) / this.scale
        if (Math.hypot(dx, dy) > CLICK_SLOP) this.drag.moved = true
        this.selected?.row.physics.move(dx, dy)
        this.wake()
        return
      }
      if (e.pointerType !== 'touch') this.select(this.hit(e), e)
      canvas.style.cursor = this.selected ? 'pointer' : ''
    }, options)
    canvas.addEventListener('pointerleave', () => {
      if (!this.drag) this.select(null)
    }, options)
    canvas.addEventListener('pointerdown', (e) => {
      const item = this.hit(e)
      if (!item) return
      this.select(item, e)
      this.drag = { x: e.clientX, y: e.clientY, moved: false, at: performance.now() }
      canvas.setPointerCapture(e.pointerId)
      e.preventDefault()
    }, options)
    canvas.addEventListener('pointerup', (e) => {
      const drag = this.drag
      const item = this.selected ?? this.hit(e)
      this.release()
      if (drag && !drag.moved && item && performance.now() - drag.at < 600) this.onOpen(item.book.id)
    }, options)
    for (const event of ['pointercancel', 'lostpointercapture'] as const) {
      canvas.addEventListener(event, () => this.release(), options)
    }
    window.addEventListener('blur', () => this.release(), options)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.release()
    }, options)

    this.resizeObserver = new ResizeObserver(() => {
      const width = Math.floor(container.clientWidth)
      if (width > 0 && width !== this.cssWidth) {
        this.cssWidth = width
        this.scale = Math.min(1, width / MIN_LOGICAL_WIDTH)
        this.logicalWidth = Math.round(width / this.scale)
        this.layout()
      }
    })
    this.resizeObserver.observe(container)
  }

  setBooks(books: ShelfBook[]) {
    this.books = books
    if (this.cssWidth) this.layout()
  }

  setTheme(theme: ShelfTheme) {
    this.theme = theme
    if (this.cssWidth) this.layout()
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.resizeObserver.disconnect()
    this.abort.abort()
    this.clear()
    this.renderer.dispose()
    this.container.replaceChildren()
  }

  // ---- textures ----------------------------------------------------------

  private texture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): T.CanvasTexture {
    const c = document.createElement('canvas')
    c.width = Math.ceil(w * 3)
    c.height = Math.ceil(h * 3)
    const ctx = c.getContext('2d')!
    ctx.scale(3, 3)
    draw(ctx)
    const map = new T.CanvasTexture(c)
    map.colorSpace = T.SRGBColorSpace
    map.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    return map
  }

  /** Wraps between words only, shrinking until every line fits the box. */
  private text(
    ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, height: number,
    size: number, font: string, color: string,
  ) {
    const words = String(text).split(/\s+/)
    let lines = ['']
    for (let tries = 0; tries < 90; tries++) {
      ctx.font = `${size}px ${font}`
      lines = ['']
      for (const word of words) {
        const last = lines.length - 1
        const next = lines[last] ? `${lines[last]} ${word}` : word
        if (ctx.measureText(next).width > width && lines[last]) lines.push(word)
        else lines[last] = next
      }
      if (lines.every((l) => ctx.measureText(l).width <= width) && lines.length * size * 1.12 <= height) break
      size *= 0.94
    }
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    lines.forEach((line, i) => ctx.fillText(line, x + width / 2, y + height / 2 + (i - (lines.length - 1) / 2) * size * 1.12))
  }

  private art(ctx: CanvasRenderingContext2D, w: number, h: number, b: ShelfBook) {
    ctx.fillStyle = b.bg
    ctx.fillRect(0, 0, w, h)
    ctx.save()
    ctx.globalAlpha = 0.2
    ctx.strokeStyle = b.accent
    ctx.fillStyle = b.accent
    ctx.lineWidth = 3
    switch (b.pattern) {
      case 0:
        for (let y = 25; y < h; y += 25) {
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.lineTo(w, y - 20)
          ctx.stroke()
        }
        break
      case 1:
        for (let x = 6; x < w; x += 15) for (let y = 12; y < h; y += 20) {
          ctx.beginPath()
          ctx.arc(x, y, 2, 0, Math.PI * 2)
          ctx.fill()
        }
        break
      case 2:
        for (let r = 15; r < h; r += 24) {
          ctx.beginPath()
          ctx.arc(w * 0.85, h * 0.62, r, 0, Math.PI * 2)
          ctx.stroke()
        }
        break
      case 3:
        ctx.translate(w * 0.5, h * 0.6)
        for (let i = 0; i < 12; i++) {
          ctx.rotate(Math.PI / 6)
          ctx.fillRect(0, 0, 5, h)
        }
        break
      case 4:
        ctx.beginPath()
        ctx.ellipse(w * 0.6, h * 0.65, w * 0.65, h * 0.24, -0.35, 0, Math.PI * 2)
        ctx.fill()
        break
      default:
        for (let y = 0; y < h; y += 30) ctx.fillRect((y / 30) % 2 ? 0 : w / 2, y, w / 2, 15)
    }
    ctx.restore()
  }

  private spine(b: ShelfBook, w: number, h: number) {
    return this.texture(w, h, (ctx) => {
      this.art(ctx, w, h, b)
      const band = b.bandTop ? 0 : h - 43
      ctx.fillStyle = b.accent
      ctx.fillRect(0, band, w, 43)
      this.text(ctx, b.number, 2, band + 1, w - 4, 27, 25, b.face, b.fg)
      this.text(ctx, b.caption, 1, band + 29, w - 2, 10, 6, "'Martian Mono', monospace", b.fg)
      const y = b.bandTop ? 48 : 25
      const titleH = h - 99
      ctx.save()
      ctx.translate(w / 2, y + titleH / 2)
      ctx.rotate(Math.PI / 2)
      this.text(ctx, b.title, -titleH / 2, -(w - 6) / 2, titleH, w - 6, 26, b.face, b.fg)
      ctx.restore()
      this.text(ctx, b.author, 2, b.bandTop ? h - 26 : h - 64, w - 4, 18, 6, "'Zen Kaku Gothic New', sans-serif", b.fg)
      const shine = ctx.createLinearGradient(0, 0, w, 0)
      shine.addColorStop(0, '#ffffff30')
      shine.addColorStop(0.15, '#ffffff00')
      shine.addColorStop(0.88, '#00000000')
      shine.addColorStop(1, '#00000025')
      ctx.fillStyle = shine
      ctx.fillRect(0, 0, w, h)
    })
  }

  /** The front board. Starts as a printed cover and swaps in the real art once it has loaded. */
  private cover(b: ShelfBook, w: number, h: number, material: T.MeshStandardMaterial, back = false) {
    const printed = () => this.texture(w, h, (ctx) => {
      this.art(ctx, w, h, b)
      ctx.fillStyle = b.accent
      ctx.fillRect(8, 12, w - 16, 3)
      this.text(ctx, b.title, 10, 25, w - 20, 75, 25, b.face, b.fg)
      this.text(ctx, b.author, 8, h - 35, w - 16, 20, 9, "'Zen Kaku Gothic New', sans-serif", b.fg)
    })
    material.map = printed()
    if (back || !b.coverUrl) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      if (this.abort.signal.aborted) return
      const map = this.texture(w, h, (ctx) => {
        // Cover-fit: the board is narrower than a manga cover, so the art is cropped at the sides.
        const s = Math.max(w / img.width, h / img.height)
        ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s)
      })
      material.map?.dispose()
      material.map = map
      material.needsUpdate = true
      this.wake()
    }
    img.src = b.coverUrl
  }

  private pages(w: number, h: number, axis: 'x' | 'y') {
    return this.texture(w, h, (ctx) => {
      ctx.fillStyle = '#eee8d7'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = '#c8bea5'
      ctx.lineWidth = 0.3
      for (let x = 1; x < (axis === 'x' ? w : h); x += 1.35) {
        ctx.beginPath()
        if (axis === 'x') {
          ctx.moveTo(x, 0)
          ctx.lineTo(x, h)
        } else {
          ctx.moveTo(0, x)
          ctx.lineTo(w, x)
        }
        ctx.stroke()
      }
    })
  }

  private model(b: ShelfBook) {
    const bw = b.width
    const bh = b.height
    const group = new T.Group()
    const mat = (color?: string, map?: T.Texture) =>
      new T.MeshStandardMaterial({ color: color ?? '#ffffff', map: map ?? null, roughness: 0.84, metalness: 0 })
    const mesh = (geometry: T.BufferGeometry, material: T.Material | T.Material[], x: number, y: number, z: number) => {
      const n = new T.Mesh(geometry, material)
      n.position.set(x, y, z)
      n.castShadow = true
      n.receiveShadow = true
      group.add(n)
      return n
    }
    // A closed page block, then solid boards front and back, then the spine face.
    const px = mat(undefined, this.pages(DEPTH, bh, 'y'))
    const py = mat(undefined, this.pages(bw, DEPTH, 'x'))
    const pz = mat(undefined, this.pages(bw, bh, 'x'))
    mesh(new T.BoxGeometry(Math.max(3, bw - 3), bh - 4, DEPTH - 5), [px, px, py, py, pz, pz], 0, 0, -DEPTH / 2)
    const edge = mat(b.bg)
    const front = mat()
    const back = mat()
    this.cover(b, DEPTH, bh, front)
    this.cover(b, DEPTH, bh, back, true)
    mesh(new T.BoxGeometry(1.5, bh, DEPTH), [front, edge, edge, edge, edge, edge], bw / 2 - 0.75, 0, -DEPTH / 2)
    mesh(new T.BoxGeometry(1.5, bh, DEPTH), [edge, back, edge, edge, edge, edge], -bw / 2 + 0.75, 0, -DEPTH / 2)
    const spine = mat(undefined, this.spine(b, bw, bh))
    mesh(new T.BoxGeometry(bw, bh, 2.2), [edge, edge, edge, edge, spine, edge], 0, 0, -0.5)
    return group
  }

  // ---- layout ------------------------------------------------------------

  private clear() {
    this.select(null)
    for (const r of this.rows) {
      r.physics.destroy()
      r.scene.traverse((n) => {
        const mesh = n as T.Mesh
        mesh.geometry?.dispose()
        const materials = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : []
        for (const m of materials as T.MeshStandardMaterial[]) {
          m.map?.dispose()
          m.dispose()
        }
      })
    }
    this.rows = []
    this.items = []
    this.access?.remove()
    this.access = null
  }

  private newRow(width: number): Row {
    const scene = new T.Scene()
    const camera = new T.PerspectiveCamera((2 * Math.atan(210 / 950) * 180) / Math.PI, width / ROW, 1, 2500)
    camera.position.set(0, 210, 950)
    camera.lookAt(0, 210, 0)
    scene.add(new T.HemisphereLight('#fff9ed', '#8f8170', 2.1))
    const light = new T.DirectionalLight('#fff6e4', 2.1)
    light.position.set(-width * 0.35, 650, 450)
    light.castShadow = true
    light.shadow.mapSize.set(1024, 1024)
    Object.assign(light.shadow.camera, { left: -width, right: width, top: 600, bottom: -500, near: 1, far: 1600 })
    light.shadow.bias = -0.0004
    light.shadow.normalBias = 0.6
    scene.add(light)
    const shelf = new T.Mesh(new T.BoxGeometry(width + 12, 15, 160), new T.MeshStandardMaterial({ color: this.theme.shelf, roughness: 0.94 }))
    shelf.position.set(0, 12, -67)
    shelf.receiveShadow = true
    scene.add(shelf)
    const wall = new T.Mesh(new T.BoxGeometry(width + 12, 400, 8), new T.MeshStandardMaterial({ color: this.theme.wall, roughness: 1 }))
    wall.position.set(0, 217, -151)
    wall.receiveShadow = true
    scene.add(wall)
    const row: Row = { scene, camera, physics: new ShelfPhysics(width), index: this.rows.length }
    this.rows.push(row)
    return row
  }

  private layout() {
    this.clear()
    const width = this.logicalWidth
    let row: Row | null = null
    let x = 18
    this.books.forEach((b, i) => {
      if (!row || x + b.width > width - 32) {
        row = this.newRow(width)
        x = 18
      }
      const body = row.physics.add(x, 360 - b.height, b.width, b.height)
      const model = this.model(b)
      row.scene.add(model)
      const item: Item = { body, model, row, book: b }
      model.traverse((n) => (n.userData.item = item))
      this.items.push(item)
      x += b.width + [5, 9, 4, 7, 14][i % 5]
    })

    const rowPx = ROW * this.scale
    this.renderer.setSize(this.cssWidth, this.rows.length * rowPx, false)
    const canvas = this.renderer.domElement
    canvas.style.width = `${this.cssWidth}px`
    canvas.style.height = `${this.rows.length * rowPx}px`

    // Keyboard and screen readers get real buttons; focusing one lifts its book, Enter opens it.
    this.access = document.createElement('div')
    this.access.className = 'shelf3d-access'
    for (const item of this.items) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = this.label(item.book)
      button.addEventListener('focus', () => this.select(item))
      button.addEventListener('blur', () => this.select(null))
      button.addEventListener('click', () => this.onOpen(item.book.id))
      this.access.append(button)
    }
    this.container.append(this.access)
    this.wake()
  }

  // ---- interaction and the frame loop -----------------------------------

  private hit(e: PointerEvent): Item | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const rowPx = ROW * this.scale
    const y = e.clientY - rect.top
    const row = this.rows[Math.floor(y / rowPx)]
    if (!row) return undefined
    const ray = new T.Raycaster()
    ray.setFromCamera(new T.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((y % rowPx) / rowPx) * 2), row.camera)
    return ray.intersectObjects(row.scene.children, true).find((h) => h.object.userData.item)?.object.userData.item as Item | undefined
  }

  private select(item: Item | null | undefined, event?: PointerEvent) {
    if (item === this.selected) return
    this.selected?.row.physics.release()
    this.selected = null
    if (!item || this.reduced.matches) return
    this.selected = item
    let direction = item.book.pattern % 2 ? 1 : -1
    if (event) {
      const rect = this.renderer.domElement.getBoundingClientRect()
      direction = (event.clientX - rect.left) / this.scale < item.body.position.x ? -1 : 1
    }
    item.row.physics.grab(item.body, direction)
    this.wake()
  }

  private release() {
    this.drag = null
    this.select(null)
  }

  /** Starts the frame loop if it has stopped. It stops itself once everything is at rest. */
  private wake() {
    this.quietFrames = 0
    if (this.frame || this.abort.signal.aborted) return
    this.last = 0
    this.frame = requestAnimationFrame(this.tick)
  }

  private tick = (time: number) => {
    const elapsed = Math.min(time - (this.last || time), 50)
    this.last = time
    this.acc += elapsed
    while (this.acc >= 1000 / 120) {
      for (const r of this.rows) r.physics.step()
      this.acc -= 1000 / 120
    }
    for (const i of this.items) {
      i.model.position.set(i.body.position.x - this.logicalWidth / 2, 380 - i.body.position.y, 0)
      i.model.rotation.z = -i.body.angle
    }
    const rowPx = ROW * this.scale
    this.renderer.setScissorTest(true)
    for (const r of this.rows) {
      const y = (this.rows.length - 1 - r.index) * rowPx
      this.renderer.setViewport(0, y, this.cssWidth, rowPx)
      this.renderer.setScissor(0, y, this.cssWidth, rowPx)
      this.renderer.render(r.scene, r.camera)
    }
    // Stop once everything has been still for about a second and a half; the next hover, drag,
    // cover load or layout wakes it again.
    this.quietFrames = this.rows.every((r) => r.physics.still) ? this.quietFrames + 1 : 0
    this.frame = this.quietFrames > 90 ? 0 : requestAnimationFrame(this.tick)
  }
}
