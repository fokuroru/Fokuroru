import * as T from 'three'
import { ShelfPhysics, type BookBody } from './shelfPhysics'
import { BAND_TOP, HORIZONTAL_TITLE, IMPRINTS, SLIM_FROM, SPINE_STYLES, type SpineStyle } from './spineStyles'

/** One series on the shelf. Its look (one of the thirty spine editions) is picked by the shelf. */
export interface ShelfBook {
  id: number
  title: string
  author: string
  /** The next chapter number, alone in the spine's band. */
  number: string
  /** Width for a regular edition; the slim editions draw narrower whatever this says. */
  width: number
  height: number
  coverUrl: string | null
}

/** A book with the edition it was dealt for this page load. */
type Styled = ShelfBook & { style: number; look: SpineStyle }

export interface ShelfTheme {
  wall: string
  shelf: string
}

interface Item {
  body: BookBody
  model: T.Object3D
  row: Row
  book: Styled
  /** Set once clicked: the book slides out towards the viewer while the next page loads. */
  pulledAt?: number
  hinges: Hinges
  /** A brief flutter in progress: which board swings, how far, and since when. */
  flutter?: { at: number; side: 'front' | 'back'; angle: number }
}

interface Hinges {
  front: { board: T.Group; leaves: T.Group[] }
  back: { board: T.Group; leaves: T.Group[] }
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
const PULL_MS = 550
const COVER_WAIT_MS = 4000
const FLUTTER_MS = 900
/** Chance per frame that a moving book flutters open: roughly once every couple of seconds of motion. */
const FLUTTER_CHANCE = 0.008

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
  /** Editions dealt this page load, kept across re-layouts (a resize should not restyle books). */
  private readonly dealt = new Map<number, { style: number; width: number }>()
  private deck: number[] = []
  private readonly covers = new Map<string, HTMLImageElement | null>()
  /** Bumped by every layout, so a layout still waiting on covers gives way to a newer one. */
  private generation = 0
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
        if (this.selected) this.selected.row.physics.moveTo(this.worldPoint(e, this.selected.row))
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
      // Re-grip where the pointer is, so a drag carries the book from that spot.
      if (!this.reduced.matches) {
        this.selected?.row.physics.release()
        this.selected = item
        item.row.physics.grab(item.body, 1, this.worldPoint(e, item.row))
        this.wake()
      }
      this.drag = { x: e.clientX, y: e.clientY, moved: false, at: performance.now() }
      canvas.setPointerCapture(e.pointerId)
      e.preventDefault()
    }, options)
    canvas.addEventListener('pointerup', (e) => {
      const drag = this.drag
      const item = this.selected ?? this.hit(e)
      this.release()
      if (drag && !drag.moved && item && performance.now() - drag.at < 600) this.pull(item)
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
        void this.layout()
      }
    })
    this.resizeObserver.observe(container)
  }

  setBooks(books: ShelfBook[]) {
    this.books = books
    if (this.cssWidth) void this.layout()
  }

  setTheme(theme: ShelfTheme) {
    this.theme = theme
    if (this.cssWidth) void this.layout()
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
    size: number, font: string, color: string, shadow?: SpineStyle['shadow'],
  ) {
    // A face may carry its weight up front ("700 'Gelasio', serif"); the size goes between.
    const weighted = /^(\d{3})\s+(.*)$/.exec(font)
    const css = (px: number) => (weighted ? `${weighted[1]} ${px}px ${weighted[2]}` : `${px}px ${font}`)
    const words = String(text).split(/\s+/)
    let lines = ['']
    for (let tries = 0; tries < 90; tries++) {
      ctx.font = css(size)
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
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const draw = (dx: number, dy: number, fill: string) => {
      ctx.fillStyle = fill
      lines.forEach((line, i) =>
        ctx.fillText(line, x + width / 2 + dx, y + height / 2 + dy + (i - (lines.length - 1) / 2) * size * 1.12))
    }
    if (shadow) draw(shadow.x * 0.6, shadow.y * 0.6, shadow.color)
    draw(0, 0, color)
  }

  private art(ctx: CanvasRenderingContext2D, w: number, h: number, b: Styled) {
    ctx.fillStyle = b.look.bg
    ctx.fillRect(0, 0, w, h)
    ctx.save()
    ctx.globalAlpha = 0.2
    ctx.strokeStyle = b.look.accent
    ctx.fillStyle = b.look.accent
    ctx.lineWidth = 3
    switch (b.style % 6) {
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

  /**
   * The reference's spine: a volume band at the head or foot, the title down the spine (or across
   * it, for six editions), the author, and a small imprint mark.
   */
  private spine(b: Styled, w: number, h: number) {
    return this.texture(w, h, (ctx) => {
      const { look } = b
      const top = BAND_TOP.has(b.style)
      const across = HORIZONTAL_TITLE.has(b.style)
      this.art(ctx, w, h, b)
      const band = top ? 0 : h - 43
      ctx.fillStyle = look.accent
      ctx.fillRect(0, band, w, 43)
      this.text(ctx, b.number, 2, band + 7, w - 4, 29, 27, look.font, look.fg)
      const y = top ? 48 : 25
      const titleH = h - 99
      if (across) {
        this.text(ctx, b.title, 4, y, w - 8, titleH, 25, look.font, look.fg, look.shadow)
      } else {
        ctx.save()
        ctx.translate(w / 2, y + titleH / 2)
        ctx.rotate(Math.PI / 2)
        this.text(ctx, b.title, -titleH / 2, -(w - 6) / 2, titleH, w - 6, 24, look.font, look.fg, look.shadow)
        ctx.restore()
      }
      this.text(ctx, b.author, 2, top ? h - 26 : h - 64, w - 4, 18, 6, "'Fira Sans', Arial, sans-serif", look.fg)
      this.text(ctx, IMPRINTS[b.style % IMPRINTS.length], 2, top ? h - 17 : 3, w - 4, 18, 12, "'Gelasio', Georgia, serif", look.fg)
      const shine = ctx.createLinearGradient(0, 0, w, 0)
      shine.addColorStop(0, '#ffffff35')
      shine.addColorStop(0.15, '#ffffff00')
      shine.addColorStop(0.88, '#00000000')
      shine.addColorStop(1, '#00000025')
      ctx.fillStyle = shine
      ctx.fillRect(0, 0, w, h)
    })
  }

  /** The front board. Starts as a printed cover and swaps in the real art once it has loaded. */
  /** A board: the front has the series' cover (see `loadCovers`) or a printed one; the back is blank. */
  private cover(b: Styled, w: number, h: number, material: T.MeshStandardMaterial, back = false) {
    const img = back || !b.coverUrl ? null : this.covers.get(b.coverUrl)
    material.map = this.texture(w, h, (ctx) => {
      if (img) {
        // Cover-fit: the board is narrower than a manga cover, so the art is cropped at the sides.
        const s = Math.max(w / img.width, h / img.height)
        ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s)
        return
      }
      this.art(ctx, w, h, b)
      // Back covers are left blank, as they mostly are; only a front without art gets printed.
      if (back) return
      ctx.fillStyle = b.look.accent
      ctx.fillRect(8, 12, w - 16, 3)
      this.text(ctx, b.title, 10, 25, w - 20, 75, 25, b.look.font, b.look.fg)
      this.text(ctx, b.author, 8, h - 35, w - 16, 20, 9, "'Fira Sans', Arial, sans-serif", b.look.fg)
    })
  }

  /**
   * Loads and decodes every cover the shelf will show, so books go on the shelf with their art
   * rather than having it pop in after. Each is cached for later layouts. One that fails, or takes
   * longer than `COVER_WAIT_MS`, is left out and its book gets a printed board instead.
   */
  private async loadCovers(books: ShelfBook[]) {
    const wanted = books.map((b) => b.coverUrl).filter((u): u is string => !!u && !this.covers.has(u))
    await Promise.all(wanted.map(async (url) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = url
      const loaded = await Promise.race([
        img.decode().then(() => true, () => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), COVER_WAIT_MS)),
      ])
      this.covers.set(url, loaded ? img : null)
    }))
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

  /**
   * A book: page block, spine, and two boards each hung on a hinge at the spine edge with a few
   * loose leaves behind it, so a board can swing open and fan the pages (see `flutter`).
   */
  private model(b: Styled): { group: T.Group; hinges: Hinges } {
    const bw = b.width
    const bh = b.height
    const group = new T.Group()
    const mat = (color?: string, map?: T.Texture) =>
      new T.MeshStandardMaterial({ color: color ?? '#ffffff', map: map ?? null, roughness: 0.84, metalness: 0 })
    const mesh = (
      geometry: T.BufferGeometry, material: T.Material | T.Material[],
      x: number, y: number, z: number, parent: T.Object3D = group,
    ) => {
      const n = new T.Mesh(geometry, material)
      n.position.set(x, y, z)
      n.castShadow = true
      n.receiveShadow = true
      parent.add(n)
      return n
    }
    const px = mat(undefined, this.pages(DEPTH, bh, 'y'))
    const py = mat(undefined, this.pages(bw, DEPTH, 'x'))
    const pz = mat(undefined, this.pages(bw, bh, 'x'))
    mesh(new T.BoxGeometry(Math.max(3, bw - 3), bh - 4, DEPTH - 5), [px, px, py, py, pz, pz], 0, 0, -DEPTH / 2)
    const edge = mat(b.look.bg)
    const front = mat()
    const back = mat()
    this.cover(b, DEPTH, bh, front)
    this.cover(b, DEPTH, bh, back, true)
    const leaf = mat('#f1ebdb')
    const hinge = (side: 1 | -1, board: T.Material[]) => {
      const board0 = new T.Group()
      board0.position.set((side * bw) / 2, 0, 0)
      group.add(board0)
      mesh(new T.BoxGeometry(1.5, bh, DEPTH), board, -side * 0.75, 0, -DEPTH / 2, board0)
      const leaves = [0, 1, 2, 3].map((k) => {
        const pivot = new T.Group()
        pivot.position.set(side * (bw / 2 - 2 - k * 0.6), 0, -1)
        group.add(pivot)
        mesh(new T.BoxGeometry(0.35, bh - 6, DEPTH - 8), leaf, 0, 0, -(DEPTH - 8) / 2, pivot)
        return pivot
      })
      return { board: board0, leaves }
    }
    const hinges: Hinges = {
      front: hinge(1, [front, edge, edge, edge, edge, edge]),
      back: hinge(-1, [edge, back, edge, edge, edge, edge]),
    }
    const spine = mat(undefined, this.spine(b, bw, bh))
    mesh(new T.BoxGeometry(bw, bh, 2.2), [edge, edge, edge, edge, spine, edge], 0, 0, -0.5)
    return { group, hinges }
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

  /**
   * Deals each series one of the thirty editions at random, without repeats until the deck runs
   * out. Slim paperback editions get a slim width of their own, as they had in the reference.
   */
  private styled(b: ShelfBook): Styled {
    let deal = this.dealt.get(b.id)
    if (!deal) {
      if (this.deck.length === 0) this.deck = [...SPINE_STYLES.keys()].sort(() => Math.random() - 0.5)
      const style = this.deck.pop()!
      deal = { style, width: style >= SLIM_FROM ? 26 + Math.round(Math.random() * 9) : b.width }
      this.dealt.set(b.id, deal)
    }
    return { ...b, width: deal.width, style: deal.style, look: SPINE_STYLES[deal.style] }
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

  /**
   * One shelf, most recently read on the left. However many books fit in three quarters of it are
   * shown and the rest of the shelf stays empty. Poses are fresh on every load: most standing, some
   * lying in small piles, some tipped against a neighbour. Only the starting pose is chosen here;
   * gravity does the rest, so a tipped book either comes to rest leaning or falls over.
   */
  private async layout() {
    const generation = ++this.generation
    await this.loadCovers(this.books)
    if (generation !== this.generation || this.abort.signal.aborted) return
    this.clear()
    const width = this.logicalWidth
    const row = this.newRow(width)
    for (const p of planShelf(this.books.map((b) => this.styled(b)), width)) {
      const body = row.physics.add(p.x, p.y, p.book.width, p.book.height, p.angle)
      const { group: model, hinges } = this.model(p.book)
      row.scene.add(model)
      const item: Item = { body, model, row, book: p.book, hinges }
      model.traverse((n) => (n.userData.item = item))
      this.items.push(item)
    }

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
      button.addEventListener('click', () => this.pull(item))
      this.access.append(button)
    }
    this.container.append(this.access)
    this.wake()
  }

  // ---- interaction and the frame loop -----------------------------------

  /** A pointer position as a point in a row's physics world (the spine plane, y down from the top). */
  private worldPoint(e: PointerEvent, row: Row) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const rowPx = ROW * this.scale
    return {
      x: (e.clientX - rect.left) / this.scale,
      y: (e.clientY - rect.top - row.index * rowPx) / this.scale - 40,
    }
  }

  /** Clicked: the book leaves the simulation and slides out towards the viewer, then it opens. */
  private pull(item: Item) {
    if (item.pulledAt !== undefined) return
    if (this.selected === item) this.release()
    item.row.physics.remove(item.body)
    item.pulledAt = performance.now()
    this.onOpen(item.book.id)
    this.wake()
  }

  /**
   * Now and then a moving or held book falls slightly open: the board on the side facing the viewer
   * swings out on its hinge, the leaves behind it fan a little less, and it closes again. Returns
   * true while a flutter is still playing, so the frame loop keeps running.
   */
  private flutter(i: Item): boolean {
    const now = performance.now()
    if (!i.flutter && !this.reduced.matches && i.pulledAt === undefined) {
      const moving = i.body.speed > 0.6 || Math.abs(i.body.angularSpeed) > 0.01 || this.selected === i
      // Open the board the camera can see: left of centre shows the front, right the back.
      const side = i.model.position.x < 0 ? 'front' : 'back'
      if (moving && Math.random() < FLUTTER_CHANCE && i.row.physics.clearance(i.body, side === 'front' ? 1 : -1, 12) >= 10) {
        i.flutter = { at: now, side, angle: 0.22 + Math.random() * 0.3 }
      }
    }
    if (!i.flutter) return false
    const t = Math.min(1, (now - i.flutter.at) / FLUTTER_MS)
    const sign = i.flutter.side === 'front' ? -1 : 1
    // Quick to open, slower to fall shut, and never further than the space beside the book allows:
    // the fore-edge of a board swung by `a` moves DEPTH * sin(a) sideways.
    const room = i.row.physics.clearance(i.body, i.flutter.side === 'front' ? 1 : -1, DEPTH)
    const limit = Math.asin(Math.min(1, Math.max(0, room - 1.5) / DEPTH))
    const open = Math.min(Math.sin(Math.PI * Math.pow(t, 0.7)) * i.flutter.angle, limit)
    const hinge = i.hinges[i.flutter.side]
    hinge.board.rotation.y = sign * open
    hinge.leaves.forEach((leaf, k) => (leaf.rotation.y = sign * open * (0.8 - k * 0.18)))
    if (t < 1) return true
    hinge.board.rotation.y = 0
    hinge.leaves.forEach((leaf) => (leaf.rotation.y = 0))
    i.flutter = undefined
    return false
  }

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
    let direction = item.book.style % 2 ? 1 : -1
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
    let pulling = false
    for (const i of this.items) {
      i.model.position.set(i.body.position.x - this.logicalWidth / 2, 380 - i.body.position.y, 0)
      i.model.rotation.z = -i.body.angle
      pulling = this.flutter(i) || pulling
      if (i.pulledAt !== undefined) {
        const t = Math.min(1, (performance.now() - i.pulledAt) / PULL_MS)
        const e = 1 - (1 - t) ** 3
        i.model.position.z = e * 320
        i.model.position.y += e * 30
        i.model.rotation.y = -e * 0.35
        pulling ||= t < 1
      }
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
    this.quietFrames = !pulling && this.rows.every((r) => r.physics.still) ? this.quietFrames + 1 : 0
    this.frame = this.quietFrames > 90 ? 0 : requestAnimationFrame(this.tick)
  }
}

interface Placement {
  book: Styled
  /** Bottom-left corner of the upright book's box, before `angle` is applied about its centre. */
  x: number
  y: number
  angle: number
}

/** At least this share of the shelf is left empty. */
const EMPTY_SHARE = 0.25
const LYING_SHARE = 0.15
const LEANING_SHARE = 0.3

/**
 * The books in the order given, until the next one would take the shelf past three quarters full.
 * A share lie in piles of up to three (consecutive books, so the order still reads left to right)
 * and a share of the standing ones start tipped to lean on a neighbour.
 */
function planShelf(books: Styled[], width: number): Placement[] {
  const limit = width * (1 - EMPTY_SHARE)
  const out: Placement[] = []
  let x = 18
  let pile: { x: number; top: number; length: number; count: number } | null = null
  for (const [i, b] of books.entries()) {
    const roll = Math.random()
    const length = b.height
    // A longer book can overhang the pile below it; only a much longer one starts a pile of its own.
    const joins = pile !== null && pile.count < 3 && length <= pile.length + 60
    // Lying down only when there is room for it; otherwise the book stands, so the shelf only
    // stops when even an upright book would not fit.
    if (roll < LYING_SHARE && (joins || x + length <= limit)) {
      if (!joins) {
        pile = { x, top: 360, length, count: 0 }
        x += length + 10
      }
      const p = pile!
      const cx = p.x + p.length / 2 + (Math.random() - 0.5) * 12
      const cy = p.top - b.width / 2
      out.push({ book: b, x: cx - b.width / 2, y: cy - b.height / 2, angle: Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2 })
      p.top -= b.width + 1
      p.count++
      continue
    }
    let lean = roll < LYING_SHARE + LEANING_SHARE ? (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.2) : 0
    if (lean && x + b.width + Math.abs(lean) * b.height * 0.35 > limit) lean = 0
    const shift = lean ? Math.abs(lean) * b.height * 0.35 : 0
    if (x + b.width > limit) break
    pile = null
    out.push({ book: b, x: x + (lean > 0 ? shift : 0), y: 360 - b.height - (lean ? 8 : 0), angle: lean })
    x += b.width + shift + [5, 9, 4, 7, 14][i % 5]
  }
  return out
}
