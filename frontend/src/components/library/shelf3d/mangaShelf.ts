import * as T from 'three'
import { ShelfPhysics, type BookBody } from './shelfPhysics'
import { buildPottedPlant } from './pottedPlant'
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

/** One line on the chalkboard: a label, the figure beside it, and a tone for the figures that judge. */
export interface BoardFigure {
  label: string
  value: string
  tone?: 'ok' | 'warn'
}

/**
 * What is chalked on the board hung behind the books. Every string arrives already translated, so
 * the scene knows nothing about languages.
 */
export interface BoardModel {
  groups: { heading: string; figures: BoardFigure[] }[]
  progress?: { heading: string; level: string; caption: string; fraction: number; figures: BoardFigure[] }
}

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
  flutterEnded?: number
}

interface Prop {
  /** The plant's one rigid body: what is dragged and what the model follows. */
  body: BookBody
  model: T.Object3D
  row: Row
  /** Height of the body's centre of mass above the pot's base. */
  centreAboveFloor: number
  lastVx: number
  /**
   * Drawn leaves. `swing` is inertial sway (a damped spring driven by the plant's acceleration);
   * `pressed` is how far the leaf is bent to stay out of a book overlapping it, eased towards the
   * smallest bend that clears it.
   */
  leaves: { pivot: T.Group; height: number; stiffness: number; swing: number; speed: number; pressed: number }[]
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
  shelf: T.Mesh
  /** A shudder from a heavy landing: how big, and since when. */
  shake?: { at: number; amplitude: number }
}

/** Height of one shelf row in world units; the camera is framed on exactly this. */
const ROW = 420
/** Extra wall above the books while a chalkboard hangs there. */
const BOARD_ROOM = 140
const CHALK_FONT = "700 {size}px 'Comic Neue', 'Comic Sans MS', cursive"
/** Narrower containers are drawn at this logical width and scaled down, so a phone still gets a shelf. */
const MIN_LOGICAL_WIDTH = 640
const DEPTH = 132
const CLICK_SLOP = 6
const PULL_MS = 550
const COVER_WAIT_MS = 4000
const FLUTTER_MS = 900
/**
 * Speed (world units per physics step) above which a book may fall open. Measured: hover lifts
 * reach about 0.5, a normal drag about 4, a book dropped from the top of the row about 16, so only
 * a fall or a fling gets there.
 */
const FLUTTER_SPEED = 9
/** Chance per frame while that fast, so most fast tumbles open and not every one does. */
const FLUTTER_CHANCE = 0.25
/** A book that has just flapped shut does not open again straight away. */
const FLUTTER_COOLDOWN_MS = 1200
/** Later leaves start and finish a little behind the board, so the pages trail it. */
const LEAF_LAG_MS = 55
/** Landings softer than this (see `ShelfPhysics.onImpact`) do not shake the shelf. */
const IMPACT_MIN = 60
/** Share of page loads that put a potted plant in the shelf's empty space. */
const PLANT_CHANCE = 0.03
/** How strongly page scrolling is felt on the shelf, and the most it can jolt, in multiples of gravity. */
const SCROLL_FEEL = 0.35
const SCROLL_G_MAX = 2.2
const SHAKE_MS = 450
const SHAKE_MAX = 3.5

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
  /** Things on the shelf that are not books: physical, but never grabbed or opened. */
  private props: Prop[] = []
  /** A prop (the plant) being carried: props can be moved but not opened. */
  private heldProp: Prop | null = null
  /** How much of the shelf stays empty, drawn once per page load: between 2% and 30%. */
  private readonly emptyShare = 0.02 + Math.random() * 0.28
  /** Decided once per page load, so a resize does not make the plant come and go. */
  private readonly withPlant = Math.random() < PLANT_CHANCE
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
  /** Where the canvas sat on screen last frame, and how fast it was moving, to feel the page scroll. */
  private scrollTrack: { top: number; velocity: number } | null = null
  private logicalWidth = 0
  private scale = 1
  private cssWidth = 0
  /** Height of one row in world units: taller while a chalkboard needs wall above the books. */
  private rowH = ROW
  private board: BoardModel | null
  private boardMaterial: T.MeshStandardMaterial | null = null
  private wallSize = { w: 0, h: 0 }
  /** Fixed for the page load, so the doodles and the arrangement hold still when the figures change. */
  private readonly seed = (Math.random() * 2 ** 32) >>> 0

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
    board: BoardModel | null = null,
  ) {
    this.container = container
    this.board = board
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
        if (this.heldProp) this.heldProp.row.physics.moveTo(this.worldPoint(e, this.heldProp.row))
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
      if (!item) {
        const prop = this.hitProp(e)
        if (!prop || this.reduced.matches) return
        this.heldProp = prop
        prop.row.physics.grab(prop.body, 1, this.worldPoint(e, prop.row))
        this.drag = { x: e.clientX, y: e.clientY, moved: true, at: performance.now() }
        canvas.setPointerCapture(e.pointerId)
        e.preventDefault()
        this.wake()
        return
      }
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
    // Scroll events do not bubble; capturing on the document catches whichever element scrolls.
    document.addEventListener('scroll', () => {
      if (!this.reduced.matches) this.wake()
    }, { capture: true, passive: true, signal: this.abort.signal })
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

  /**
   * Changes what is chalked on the board. Rewriting the figures redraws the board alone; a board
   * appearing or going away changes the height of the wall, which relays the shelf out.
   */
  setBoard(board: BoardModel | null) {
    const had = this.board !== null
    this.board = board
    if (!this.cssWidth) return
    if (had !== (board !== null) || (board && !this.boardMaterial)) {
      void this.layout()
      return
    }
    if (board && this.boardMaterial) {
      this.boardMaterial.map?.dispose()
      this.boardMaterial.map = this.wallTexture(this.wallSize.w, this.wallSize.h, board)
      this.boardMaterial.needsUpdate = true
      this.wake()
    }
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


  // ---- the chalkboard ----------------------------------------------------

  /** A wooden frame round the wall. The plank is the bottom edge, so there is no bottom bar. */
  private addFrame(scene: T.Scene, width: number, height: number) {
    const wood = new T.MeshStandardMaterial({ color: '#6b4a2f', roughness: 0.8 })
    const t = 12
    const add = (w: number, h: number, x: number, y: number) => {
      const bar = new T.Mesh(new T.BoxGeometry(w, h, 14), wood)
      bar.position.set(x, y, -143)
      bar.castShadow = true
      bar.receiveShadow = true
      scene.add(bar)
    }
    add(width + t * 2, t, 0, 17 + height + t / 2)
    add(t, height + t, -(width / 2 + t / 2), 17 + (height - t) / 2 + t / 2)
    add(t, height + t, width / 2 + t / 2, 17 + (height - t) / 2 + t / 2)
  }

  /**
   * The wall as a slate with chalk on it: blocks of figures at random places and slight tilts, a few
   * doodles, faint ghosts of old writing and eraser wipes. Chalk is drawn on a layer of its own and
   * then worn away with specks, so it reads as dust on slate rather than as ink. The books stand in
   * front of it, so some of it is always hidden behind them.
   */
  private wallTexture(w: number, h: number, model: BoardModel): T.CanvasTexture {
    const scale = Math.min(2, 4096 / Math.max(w, h))
    const px = (n: number) => Math.max(1, Math.ceil(n * scale))
    const base = document.createElement('canvas')
    base.width = px(w)
    base.height = px(h)
    const g = base.getContext('2d')!
    g.scale(scale, scale)
    const layer = document.createElement('canvas')
    layer.width = base.width
    layer.height = base.height
    const c = layer.getContext('2d')!
    c.scale(scale, scale)

    let state = this.seed
    const rnd = () => {
      state = (state + 0x6d2b79f5) | 0
      let t = Math.imul(state ^ (state >>> 15), 1 | state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const jit = (a: number) => (rnd() - 0.5) * a
    /** 1 for fresh chalk; the old writing in the background is drawn at a sliver of it. */
    let fade = 1
    const pick = <V,>(list: V[]) => list[Math.floor(rnd() * list.length)]

    // ---- slate
    const slate = g.createLinearGradient(0, 0, w, h)
    slate.addColorStop(0, '#2f3d35')
    slate.addColorStop(0.5, '#27332c')
    slate.addColorStop(1, '#212b25')
    g.fillStyle = slate
    g.fillRect(0, 0, w, h)
    // Eraser wipes: broad low strokes laid over each other until they streak.
    g.save()
    g.lineCap = 'round'
    g.strokeStyle = '#ffffff'
    for (let i = 0; i < 9; i++) {
      const y = rnd() * h
      const x = rnd() * w * 0.6
      const run = 140 + rnd() * w * 0.5
      for (let k = 0; k < 7; k++) {
        g.globalAlpha = 0.012 + rnd() * 0.016
        g.lineWidth = 16 + rnd() * 26
        g.beginPath()
        g.moveTo(x + jit(20), y + jit(30))
        g.lineTo(x + run, y + jit(46) - 18)
        g.stroke()
      }
    }
    g.restore()

    const CREAM = '#f3efe2'
    const PALETTE = [CREAM, '#f7a8bf', '#9ed3f5', '#f6e08a', '#a8e6b8', '#c9b6f2', '#f6b78a']
    const TONES = { ok: '#a8e6b8', warn: '#f6e08a' }
    const font = (size: number) => CHALK_FONT.replace('{size}', String(size))

    // ---- pen: wobbly lines, each drawn twice with a hair of offset and a different weight
    const stroke = (pts: [number, number][], color: string, lw = 2.3, wobble = 1.4) => {
      if (pts.length < 2) return
      for (const [alpha, extra] of [[0.9, 1], [0.4, 1.6]] as const) {
        c.globalAlpha = alpha * fade
        c.strokeStyle = color
        c.lineWidth = lw * extra
        c.lineCap = 'round'
        c.lineJoin = 'round'
        c.beginPath()
        const p = pts.map(([x, y]) => [x + jit(wobble), y + jit(wobble)] as const)
        c.moveTo(p[0][0], p[0][1])
        for (let i = 1; i < p.length - 1; i++) {
          c.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2)
        }
        c.lineTo(p[p.length - 1][0], p[p.length - 1][1])
        c.stroke()
      }
      c.globalAlpha = 1
    }
    /** A round shape drawn a touch past where it began, the way a hand closes a circle. */
    const oval = (x: number, y: number, rx: number, ry: number, color: string, lw = 2.3) => {
      const n = 16
      const start = rnd() * Math.PI * 2
      const pts: [number, number][] = []
      for (let i = 0; i <= n + 2; i++) {
        const a = start + (i / n) * Math.PI * 2
        const k = 1 + jit(0.07)
        pts.push([x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k])
      }
      stroke(pts, color, lw, 0.9)
    }
    const dot = (x: number, y: number, r: number, color: string) => {
      c.globalAlpha = 0.9 * fade
      c.fillStyle = color
      c.beginPath()
      c.ellipse(x + jit(0.6), y + jit(0.6), r, r * (0.85 + rnd() * 0.3), rnd() * 3, 0, Math.PI * 2)
      c.fill()
      c.globalAlpha = 1
    }
    /** A filled patch of chalk, scribbled in short diagonal strokes. */
    const scribble = (x: number, y: number, rx: number, ry: number, color: string) => {
      c.save()
      c.beginPath()
      c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
      c.clip()
      for (let sx = x - rx - ry; sx < x + rx + ry; sx += 2.4) {
        stroke([[sx, y + ry + 2], [sx + ry * 1.6, y - ry - 2]], color, 1.6, 0.8)
      }
      c.restore()
    }

    const chalkText = (text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left') => {
      c.font = font(size)
      c.textBaseline = 'middle'
      c.textAlign = 'left'
      c.fillStyle = color
      const chars = [...text]
      const widths = chars.map((ch) => c.measureText(ch).width)
      const total = widths.reduce((a, b) => a + b, 0)
      let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x
      chars.forEach((ch, i) => {
        c.save()
        c.translate(cx + widths[i] / 2, y + jit(size * 0.14))
        c.rotate(jit(0.16))
        const grow = 1 + jit(0.1)
        c.scale(grow, grow)
        c.globalAlpha = 0.36 * fade
        c.fillText(ch, -widths[i] / 2 + 0.8, 0.7)
        c.globalAlpha = 0.92 * fade
        c.fillText(ch, -widths[i] / 2, 0)
        c.restore()
        cx += widths[i]
      })
      c.globalAlpha = 1
    }
    const measure = (text: string, size: number) => {
      c.font = font(size)
      return c.measureText(text).width
    }
    const fit = (text: string, size: number, room: number) => {
      const width = measure(text, size)
      return width > room ? Math.max(9, size * (room / width)) : size
    }
    const underline = (x: number, y: number, length: number, color: string) => {
      stroke([[x, y], [x + length * 0.3, y + jit(3)], [x + length * 0.65, y + jit(3)], [x + length, y + jit(2)]], color, 2.2, 1.1)
    }
    const leader = (x0: number, x1: number, y: number) => {
      for (let x = x0; x < x1; x += 6 + rnd() * 1.5) dot(x, y + 7, 0.9, CREAM)
    }

    // ---- the blocks of figures, drawn with their top-left corner at the origin
    interface Block { w: number; h: number; draw: () => void }
    const figureRows = (list: BoardFigure[], colW: number, y0: number, step: number) => {
      list.forEach((f, i) => {
        const y = y0 + i * step
        const valueSize = fit(f.value, 23, colW * 0.4)
        const labelSize = fit(f.label, 17, colW * 0.58)
        chalkText(f.label, 0, y, labelSize, CREAM)
        chalkText(f.value, colW, y, valueSize, f.tone ? TONES[f.tone] : CREAM, 'right')
        leader(measure(f.label, labelSize) + 6, colW - measure(f.value, valueSize) - 6, y)
      })
    }
    const blocks: Block[] = []
    model.groups.forEach((group, gi) => {
      const color = PALETTE[1 + ((gi + Math.floor(rnd() * 3)) % 4)]
      const colW = 205
      blocks.push({
        w: colW,
        h: 44 + group.figures.length * 28,
        draw: () => {
          chalkText(group.heading, 0, 10, fit(group.heading, 20, colW), color)
          underline(0, 25, Math.min(colW, 96), color)
          figureRows(group.figures, colW, 50, 28)
        },
      })
    })
    if (model.progress) {
      const p = model.progress
      const colW = 215
      blocks.push({
        w: colW,
        h: 44 + 26 + 18 + 22 + p.figures.slice(0, 3).length * 27,
        draw: () => {
          chalkText(p.heading, 0, 10, fit(p.heading, 20, colW), '#c9b6f2')
          underline(0, 25, 96, '#c9b6f2')
          chalkText(p.level, 0, 52, fit(p.level, 27, colW), '#f6e08a')
          const barY = 70
          const barH = 12
          stroke([[0, barY], [colW, barY + jit(1.5)], [colW + jit(1), barY + barH], [0, barY + barH + jit(1.5)], [jit(1), barY]], CREAM, 1.7, 0.8)
          const fill = (colW - 4) * Math.min(1, Math.max(0, p.fraction))
          c.save()
          c.beginPath()
          c.rect(2, barY + 1.5, fill, barH - 3)
          c.clip()
          for (let sx = -barH; sx < colW; sx += 5) stroke([[sx, barY + barH], [sx + barH, barY]], '#f6e08a', 1.8, 0.8)
          c.restore()
          chalkText(p.caption, 0, barY + barH + 15, fit(p.caption, 13, colW), CREAM)
          figureRows(p.figures.slice(0, 3), colW, barY + barH + 41, 27)
        },
      })
    }

    // ---- placement: random spots, small tilts, not on top of each other
    interface Spot { x: number; y: number; w: number; h: number }
    const placed: Spot[] = []
    const margin = 26
    const overlaps = (a: Spot, pad: number) =>
      placed.some((b) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y)
    const spotFor = (bw: number, bh: number, pad: number, upperBias: number): Spot | null => {
      const maxX = w - margin - bw
      const maxY = h - margin - bh
      if (maxX <= margin || maxY <= margin) return null
      for (let tries = 0; tries < 90; tries++) {
        // The wall behind the books is mostly hidden, so most blocks start in the clear band above them.
        const band = rnd() < upperBias ? Math.min(maxY, h * 0.5 - bh) : maxY
        const spot = { x: margin + rnd() * (maxX - margin), y: margin + rnd() * Math.max(0, band - margin), w: bw, h: bh }
        if (!overlaps(spot, pad)) return spot
      }
      return null
    }
    const order = [...blocks].sort((a, b) => b.w * b.h - a.w * a.h)
    for (const block of order) {
      const spot = spotFor(block.w, block.h, 18, 0.7) ?? spotFor(block.w, block.h, 4, 0.4)
        ?? { x: margin + rnd() * Math.max(1, w - margin * 2 - block.w), y: margin + rnd() * Math.max(1, h - margin * 2 - block.h), w: block.w, h: block.h }
      placed.push(spot)
      c.save()
      c.translate(spot.x + block.w / 2, spot.y + block.h / 2)
      c.rotate(jit(0.09))
      c.translate(-block.w / 2, -block.h / 2)
      block.draw()
      c.restore()
    }

    // ---- doodles
    const sparkle = (x: number, y: number, s: number, color: string) => {
      stroke([[x, y - s], [x + jit(1), y + s]], color, 2.2, 1)
      stroke([[x - s, y], [x + s, y + jit(1)]], color, 2.2, 1)
      stroke([[x - s * 0.45, y - s * 0.45], [x + s * 0.45, y + s * 0.45]], color, 1.6, 0.8)
      stroke([[x + s * 0.45, y - s * 0.45], [x - s * 0.45, y + s * 0.45]], color, 1.6, 0.8)
    }
    const star = (x: number, y: number, s: number, color: string) => {
      const pts: [number, number][] = []
      for (let i = 0; i <= 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const r = i % 2 ? s * 0.42 : s
        pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r])
      }
      stroke(pts, color, 2.2, 1.2)
    }
    const heart = (x: number, y: number, s: number, color: string) => {
      const pts: [number, number][] = []
      for (let i = 0; i <= 22; i++) {
        const t = (i / 22) * Math.PI * 2
        pts.push([x + (s * 16 * Math.sin(t) ** 3) / 17, y - (s * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))) / 17])
      }
      stroke(pts, color, 2.4, 1)
    }
    const squiggle = (x: number, y: number, s: number, color: string) => {
      const kind = Math.floor(rnd() * 3)
      const pts: [number, number][] = []
      if (kind === 0) {
        const len = s * 3.2
        for (let i = 0; i <= 16; i++) pts.push([x - len / 2 + (i / 16) * len, y + Math.sin(i * 1.15) * s * 0.28])
      } else if (kind === 1) {
        for (let i = 0; i <= 44; i++) {
          const a = i * 0.34
          pts.push([x + Math.cos(a) * (a * s * 0.07), y + Math.sin(a) * (a * s * 0.07)])
        }
      } else {
        for (let i = 0; i <= 9; i++) pts.push([x - s * 1.4 + i * s * 0.31, y + (i % 2 ? -s * 0.3 : s * 0.3)])
      }
      stroke(pts, color, 2.2, 1.1)
    }
    const loops = (x: number, y: number, s: number, color: string) => {
      const pts: [number, number][] = []
      for (let i = 0; i <= 40; i++) {
        const a = i * 0.55
        pts.push([x - s * 1.6 + i * s * 0.08 + Math.cos(a) * s * 0.35, y + Math.sin(a) * s * 0.35])
      }
      stroke(pts, color, 2.1, 0.8)
    }
    const eye = (x: number, y: number, rx: number, ry: number, color: string) => {
      scribble(x, y, rx, ry, color)
      oval(x, y, rx, ry, color, 2)
      // The highlight: a hole worn in the chalk.
      c.save()
      c.globalCompositeOperation = 'destination-out'
      c.beginPath()
      c.arc(x - rx * 0.3, y - ry * 0.35, Math.max(1.6, rx * 0.28), 0, Math.PI * 2)
      c.fill()
      c.restore()
    }
    const face = (x: number, y: number, s: number, color: string) => {
      oval(x, y, s, s * 0.9, color)
      const kind = Math.floor(rnd() * 4)
      if (kind === 3) {
        // Cat ears.
        stroke([[x - s * 0.85, y - s * 0.3], [x - s * 0.8, y - s * 1.35], [x - s * 0.1, y - s * 0.8]], color)
        stroke([[x + s * 0.85, y - s * 0.3], [x + s * 0.8, y - s * 1.35], [x + s * 0.1, y - s * 0.8]], color)
      }
      if (kind === 0) {
        // Happy closed eyes.
        stroke([[x - s * 0.6, y - s * 0.05], [x - s * 0.35, y - s * 0.3], [x - s * 0.1, y - s * 0.05]], color)
        stroke([[x + s * 0.1, y - s * 0.05], [x + s * 0.35, y - s * 0.3], [x + s * 0.6, y - s * 0.05]], color)
      } else {
        eye(x - s * 0.36, y - s * 0.05, s * 0.19, s * 0.27, color)
        eye(x + s * 0.36, y - s * 0.05, s * 0.19, s * 0.27, color)
      }
      stroke([[x - s * 0.18, y + s * 0.38], [x, y + s * 0.5], [x + s * 0.18, y + s * 0.38]], color, 2)
      // Blush.
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const bx = x + side * s * 0.62 + (k - 1) * 3.2
          stroke([[bx - 2, y + s * 0.3], [bx + 2, y + s * 0.18]], '#f7a8bf', 1.6, 0.4)
        }
      }
      if (rnd() < 0.5) {
        // Fringe.
        stroke([[x - s * 0.8, y - s * 0.55], [x - s * 0.2, y - s * 0.95], [x + s * 0.15, y - s * 0.6]], color, 2, 1)
        stroke([[x + s * 0.15, y - s * 0.62], [x + s * 0.6, y - s * 0.88], [x + s * 0.85, y - s * 0.5]], color, 2, 1)
      }
    }
    const sweat = (x: number, y: number, s: number, color: string) => {
      stroke([[x, y - s], [x - s * 0.55, y + s * 0.3], [x - s * 0.2, y + s * 0.85], [x + s * 0.3, y + s * 0.8], [x + s * 0.55, y + s * 0.25], [x, y - s]], color, 2.2, 0.9)
      stroke([[x - s * 0.2, y + s * 0.15], [x - s * 0.15, y + s * 0.5]], color, 1.5, 0.4)
    }
    const anger = (x: number, y: number, s: number) => {
      const color = '#f7a8bf'
      for (const sign of [-1, 1]) {
        stroke([[x + sign * s * 0.2, y - s], [x + sign * s * 0.05, y - s * 0.2], [x + sign * s * 0.7, y - s * 0.1]], color, 2.4, 0.8)
        stroke([[x + sign * s * 0.2, y + s], [x + sign * s * 0.05, y + s * 0.2], [x + sign * s * 0.7, y + s * 0.1]], color, 2.4, 0.8)
      }
    }
    const bubble = (x: number, y: number, s: number, color: string) => {
      const pts: [number, number][] = []
      for (let i = 0; i <= 18; i++) {
        const a = (i / 18) * Math.PI * 2
        pts.push([x + Math.cos(a) * s * 1.15, y + Math.sin(a) * s * 0.8])
      }
      stroke(pts, color, 2.2, 1)
      stroke([[x - s * 0.5, y + s * 0.7], [x - s * 0.9, y + s * 1.35], [x - s * 0.05, y + s * 0.78]], color, 2.2, 0.8)
      chalkText(pick(['!', '?', '…', '♪', '!?', 'zzz']), x, y, s * 0.95, color, 'center')
    }
    const roll = (x: number, y: number, s: number, color: string) => {
      oval(x, y, s, s, color)
      const pts: [number, number][] = []
      for (let i = 0; i <= 26; i++) {
        const a = i * 0.5
        pts.push([x + Math.cos(a) * (a * s * 0.055), y + Math.sin(a) * (a * s * 0.055)])
      }
      stroke(pts, '#f7a8bf', 1.8, 0.7)
      dot(x - s * 0.35, y + s * 0.25, 1.8, CREAM)
      dot(x + s * 0.35, y + s * 0.25, 1.8, CREAM)
    }
    const flower = (x: number, y: number, s: number, color: string) => {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2
        const cx = x + Math.cos(a) * s * 0.55
        const cy = y + Math.sin(a) * s * 0.55
        oval(cx, cy, s * 0.42, s * 0.3, color, 1.9)
      }
      dot(x, y, s * 0.16, '#f6e08a')
    }
    const note = (x: number, y: number, s: number, color: string) => {
      stroke([[x + s * 0.4, y - s], [x + s * 0.4, y + s * 0.5]], color, 2.2, 0.6)
      stroke([[x + s * 0.4, y - s], [x + s * 1, y - s * 0.6], [x + s * 0.95, y - s * 0.1]], color, 2.2, 0.8)
      scribble(x, y + s * 0.55, s * 0.45, s * 0.3, color)
    }
    const arrow = (x: number, y: number, s: number, color: string) => {
      stroke([[x - s, y + s * 0.4], [x - s * 0.2, y - s * 0.4], [x + s * 0.8, y - s * 0.1]], color, 2.2, 1)
      stroke([[x + s * 0.5, y - s * 0.5], [x + s * 0.85, y - s * 0.1], [x + s * 0.4, y + s * 0.2]], color, 2.2, 0.8)
    }
    const cloud = (x: number, y: number, s: number, color: string) => {
      stroke([[x - s, y + s * 0.3], [x - s * 1.1, y - s * 0.2], [x - s * 0.5, y - s * 0.5], [x - s * 0.1, y - s * 0.9], [x + s * 0.45, y - s * 0.55], [x + s * 1.1, y - s * 0.3], [x + s * 1, y + s * 0.3], [x - s, y + s * 0.3]], color, 2.2, 1.1)
    }
    const doodles: ((x: number, y: number, s: number, color: string) => void)[] = [
      sparkle, sparkle, star, heart, squiggle, squiggle, loops, face, face, bubble, roll, flower, note, arrow, cloud,
      (x, y, s, color) => { face(x, y, s, color); sweat(x + s * 1.15, y - s * 0.6, s * 0.34, '#9ed3f5') },
      (x, y, s, color) => { face(x, y, s, color); anger(x + s * 1.1, y - s * 0.85, s * 0.3) },
    ]
    // Some loads are bare; most carry a handful.
    const count = rnd() < 0.15 ? 0 : 3 + Math.floor(rnd() * 6)
    for (let i = 0; i < count; i++) {
      const size = 16 + rnd() * 22
      const spot = spotFor(size * 3.2, size * 2.6, 8, 0.45)
      if (!spot) continue
      placed.push(spot)
      c.save()
      c.translate(spot.x + spot.w / 2, spot.y + spot.h / 2)
      c.rotate(jit(0.5))
      pick(doodles)(0, 0, size, pick(PALETTE))
      c.restore()
    }

    // ---- ghosts of old writing, faint and large, under everything that was chalked fresh
    c.save()
    fade = 0.1
    for (let i = 0; i < 3; i++) {
      c.save()
      c.translate(rnd() * w, rnd() * h)
      c.rotate(jit(0.7))
      pick(doodles)(0, 0, 40 + rnd() * 40, CREAM)
      c.restore()
    }
    fade = 1
    c.restore()

    // ---- wear the chalk: tiny holes, so a line breaks up like dust
    c.save()
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.globalCompositeOperation = 'destination-out'
    const specks = Math.floor((layer.width * layer.height) / 26)
    for (let i = 0; i < specks; i++) {
      c.globalAlpha = 0.25 + rnd() * 0.6
      const size = 0.7 + rnd() * 1.7
      c.fillRect(rnd() * layer.width, rnd() * layer.height, size, size)
    }
    c.restore()

    g.setTransform(1, 0, 0, 1, 0, 0)
    g.drawImage(layer, 0, 0)
    const map = new T.CanvasTexture(base)
    map.colorSpace = T.SRGBColorSpace
    map.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    return map
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
    this.props = []
    this.boardMaterial = null
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

  /**
   * Stands the plant somewhere in the empty quarter of the shelf, clear of the books, so it never
   * costs a book its place. Skipped if a narrow shelf leaves no room for it.
   */
  private placePlant(row: Row, width: number) {
    const plant = buildPottedPlant()
    const booksEnd = this.items.reduce((end, i) => Math.max(end, i.body.bounds.max.x), 0)
    const half = Math.max(plant.potWidth, plant.leafSpread) / 2
    const from = booksEnd + 16 + half
    const to = width - 20 - half
    if (to < from) {
      plant.dispose()
      return
    }
    const x = from + Math.random() * (to - from)
    const { body, centreAboveFloor } = row.physics.addPlant(
      x, plant.potWidth, plant.potHeight, plant.leafSpread, plant.leafHeight,
    )
    // The model's origin is its base; the body's is its centre of mass.
    const model = new T.Group()
    plant.group.position.y = -centreAboveFloor
    model.add(plant.group)
    row.scene.add(model)
    const prop: Prop = {
      body,
      model,
      row,
      centreAboveFloor,
      lastVx: 0,
      leaves: plant.leaves.map((l) => ({ ...l, swing: 0, speed: 0, pressed: 0 })),
    }
    model.traverse((n) => (n.userData.prop = prop))
    this.props.push(prop)
  }

  private newRow(width: number): Row {
    const scene = new T.Scene()
    const half = this.rowH / 2
    const camera = new T.PerspectiveCamera((2 * Math.atan(half / 950) * 180) / Math.PI, width / this.rowH, 1, 2500)
    camera.position.set(0, half, 950)
    camera.lookAt(0, half, 0)
    scene.add(new T.HemisphereLight('#fff9ed', '#8f8170', 2.1))
    const light = new T.DirectionalLight('#fff6e4', 2.1)
    light.position.set(-width * 0.35, 650, 450)
    light.castShadow = true
    light.shadow.mapSize.set(1024, 1024)
    Object.assign(light.shadow.camera, { left: -width, right: width, top: 600 + (this.rowH - ROW), bottom: -500, near: 1, far: 1600 })
    light.shadow.bias = -0.0004
    light.shadow.normalBias = 0.6
    scene.add(light)
    const shelf = new T.Mesh(new T.BoxGeometry(width + 12, 15, 160), new T.MeshStandardMaterial({ color: this.theme.shelf, roughness: 0.94 }))
    shelf.position.set(0, 12, -67)
    shelf.receiveShadow = true
    scene.add(shelf)
    const wallHeight = this.rowH - 20
    const wallMaterial = new T.MeshStandardMaterial({ color: this.theme.wall, roughness: 1 })
    let faces: T.Material | T.Material[] = wallMaterial
    if (this.board) {
      // The whole wall is the chalkboard: its front face carries the slate and everything on it.
      this.wallSize = { w: width + 12, h: wallHeight }
      this.boardMaterial = new T.MeshStandardMaterial({ map: this.wallTexture(width + 12, wallHeight, this.board), roughness: 0.95 })
      faces = [wallMaterial, wallMaterial, wallMaterial, wallMaterial, this.boardMaterial, wallMaterial]
    }
    const wall = new T.Mesh(new T.BoxGeometry(width + 12, wallHeight, 8), faces)
    wall.position.set(0, 17 + wallHeight / 2, -151)
    wall.receiveShadow = true
    scene.add(wall)
    if (this.board) this.addFrame(scene, width + 12, wallHeight)
    const row: Row = { scene, camera, physics: new ShelfPhysics(width), index: this.rows.length, shelf }
    // A heavy landing sets the plank, and everything on it, shuddering; the wall stays put.
    row.physics.onImpact = (strength) => {
      if (strength < IMPACT_MIN || this.reduced.matches) return
      const amplitude = Math.min(SHAKE_MAX, (strength - IMPACT_MIN) / 120)
      const now = performance.now()
      const left = row.shake ? row.shake.amplitude * Math.exp(-(now - row.shake.at) / 110) : 0
      if (amplitude > left) row.shake = { at: now, amplitude }
    }
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
    this.rowH = this.board ? ROW + BOARD_ROOM : ROW
    const width = this.logicalWidth
    const row = this.newRow(width)
    for (const p of planShelf(this.books.map((b) => this.styled(b)), width, this.emptyShare)) {
      const body = row.physics.add(p.x, p.y, p.book.width, p.book.height, p.angle)
      const { group: model, hinges } = this.model(p.book)
      row.scene.add(model)
      const item: Item = { body, model, row, book: p.book, hinges }
      model.traverse((n) => (n.userData.item = item))
      this.items.push(item)
    }
    if (this.withPlant) this.placePlant(row, width)

    const rowPx = this.rowH * this.scale
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
    const rowPx = this.rowH * this.scale
    return {
      x: (e.clientX - rect.left) / this.scale,
      y: (e.clientY - rect.top - row.index * rowPx) / this.scale - (this.rowH - 380),
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
    const rested = i.flutterEnded === undefined || now - i.flutterEnded > FLUTTER_COOLDOWN_MS
    if (!i.flutter && rested && !this.reduced.matches && i.pulledAt === undefined) {
      const fast = i.body.speed > FLUTTER_SPEED || Math.abs(i.body.angularSpeed) > 0.18
      // Open the board the camera can see: left of centre shows the front, right the back.
      const side = i.model.position.x < 0 ? 'front' : 'back'
      if (fast && Math.random() < FLUTTER_CHANCE && i.row.physics.clearance(i.body, side === 'front' ? 1 : -1, 12) >= 10) {
        // The faster it is going, the further it falls open.
        const angle = Math.min(0.5, 0.14 + (i.body.speed - FLUTTER_SPEED) * 0.02)
        i.flutter = { at: now, side, angle: Math.max(0.14, angle) }
      }
    }
    if (!i.flutter) return false
    const elapsed = now - i.flutter.at
    const t = Math.min(1, elapsed / FLUTTER_MS)
    const sign = i.flutter.side === 'front' ? -1 : 1
    // Quick to open, slower to fall shut, and never further than the space beside the book allows:
    // the fore-edge of a board swung by `a` moves DEPTH * sin(a) sideways.
    const room = i.row.physics.clearance(i.body, i.flutter.side === 'front' ? 1 : -1, DEPTH)
    const limit = Math.asin(Math.min(1, Math.max(0, room - 1.5) / DEPTH))
    const curve = (u: number) => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * Math.pow(u, 0.7)))
    const open = Math.min(curve(t) * i.flutter.angle, limit)
    const hinge = i.hinges[i.flutter.side]
    hinge.board.rotation.y = sign * open
    // Each leaf trails the one before it and never passes the board, so the pages fan behind it.
    let playing = t < 1
    hinge.leaves.forEach((leaf, k) => {
      const u = (elapsed - (k + 1) * LEAF_LAG_MS) / FLUTTER_MS
      if (u < 1) playing = true
      leaf.rotation.y = sign * Math.min(open, curve(u) * i.flutter!.angle * (0.85 - k * 0.15))
    })
    if (playing) return true
    hinge.board.rotation.y = 0
    hinge.leaves.forEach((leaf) => (leaf.rotation.y = 0))
    i.flutter = undefined
    i.flutterEnded = now
    return false
  }

  /** Vertical offset of a shudder at `now`: about 22 Hz, dying away over a few tenths of a second. */
  private shakeAt(shake: { at: number; amplitude: number }, now: number): number {
    const t = now - shake.at
    if (t > SHAKE_MS) return 0
    return shake.amplitude * Math.exp(-t / 110) * Math.sin((t / 1000) * 2 * Math.PI * 22)
  }

  /**
   * Moves the drawn leaves. Each sways on a damped spring driven by the plant's sideways
   * acceleration, so they trail when it is moved or knocked, and each bends just far enough to stay
   * out of any book lying across it, so a book resting on the plant visibly presses the leaves over.
   * The physics body under the leaves is rigid; all of this is drawn only, so nothing in the
   * simulation can fight it. Returns true while any leaf is still moving.
   */
  private sway(p: Prop, elapsedMs: number): boolean {
    const dt = Math.max(1, elapsedMs) / 1000
    const vx = p.body.velocity.x * 120
    const ax = (vx - p.lastVx) / dt
    p.lastVx = vx
    const ease = 1 - Math.exp(-dt * 14)
    // Only bodies near the plant can touch a leaf; skip the search when none are.
    const reach = Math.max(...p.leaves.map((l) => l.height)) + 20
    const near = p.row.physics.bodiesExcept(p.body).filter((b) =>
      b.bounds.max.x > p.body.position.x - reach && b.bounds.min.x < p.body.position.x + reach &&
      b.bounds.max.y > p.body.position.y - reach - p.centreAboveFloor && b.bounds.min.y < p.body.position.y + reach)
    let moving = false
    for (const leaf of p.leaves) {
      const k = 70 * leaf.stiffness
      const push = this.reduced.matches ? 0 : Math.max(-4000, Math.min(4000, ax)) * 0.00045 * (leaf.height / 200)
      leaf.speed += (-k * leaf.swing - 3.2 * leaf.speed + push) * dt
      leaf.swing = Math.max(-0.45, Math.min(0.45, leaf.swing + leaf.speed * dt))

      const target = near.length ? this.clearBend(p, leaf, near) : 0
      leaf.pressed += (target - leaf.pressed) * ease
      leaf.pivot.rotation.z = leaf.swing - leaf.pressed
      if (Math.abs(leaf.swing) > 0.002 || Math.abs(leaf.speed) > 0.01 || Math.abs(target - leaf.pressed) > 0.002) moving = true
    }
    return moving
  }

  /**
   * The smallest bend (physics radians, positive tipping the leaf towards +x) that keeps a leaf out
   * of the given bodies, trying either way in small steps; up to about 75 degrees, after which the
   * leaf is as flat as it gets.
   */
  private clearBend(p: Prop, leaf: Prop['leaves'][number], bodies: import('matter-js').Body[]): number {
    const a = p.body.angle
    const local = { x: leaf.pivot.position.x, y: -(leaf.pivot.position.y - p.centreAboveFloor) }
    const base = {
      x: p.body.position.x + local.x * Math.cos(a) - local.y * Math.sin(a),
      y: p.body.position.y + local.x * Math.sin(a) + local.y * Math.cos(a),
    }
    const blocked = (bend: number) => [0.45, 0.7, 0.95].some((f) => {
      const len = f * leaf.height
      return p.row.physics.occupied(bodies, { x: base.x + Math.sin(a + bend) * len, y: base.y - Math.cos(a + bend) * len })
    })
    if (!blocked(leaf.pressed)) {
      // Still clear where it is: relax back towards upright only as far as stays clear.
      for (let bend = 0; Math.abs(bend) < Math.abs(leaf.pressed); bend += Math.sign(leaf.pressed) * 0.08) {
        if (!blocked(bend)) return bend
      }
      return leaf.pressed
    }
    for (let step = 0.08; step <= 1.3; step += 0.08) {
      if (!blocked(step)) return step
      if (!blocked(-step)) return -step
    }
    return leaf.pressed
  }

  private hitProp(e: PointerEvent): Prop | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const rowPx = this.rowH * this.scale
    const y = e.clientY - rect.top
    const row = this.rows[Math.floor(y / rowPx)]
    if (!row) return undefined
    const ray = new T.Raycaster()
    ray.setFromCamera(new T.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((y % rowPx) / rowPx) * 2), row.camera)
    return ray.intersectObjects(row.scene.children, true).find((h) => h.object.userData.prop)?.object.userData.prop as Prop | undefined
  }

  private hit(e: PointerEvent): Item | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const rowPx = this.rowH * this.scale
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
    if (this.heldProp) {
      this.heldProp.row.physics.release()
      this.heldProp = null
    }
    this.select(null)
  }

  /** Starts the frame loop if it has stopped. It stops itself once everything is at rest. */
  private wake() {
    this.quietFrames = 0
    if (this.frame || this.abort.signal.aborted) return
    this.last = 0
    this.scrollTrack = null
    this.frame = requestAnimationFrame(this.tick)
  }

  /**
   * Turns the canvas's movement on screen into an acceleration of the shelf, as if the page were the
   * wall it hangs on. Only the change in scroll speed counts, so a steady scroll does nothing and a
   * flick that starts or stops sharply jolts the books. Returns true while the shelf is still moving.
   */
  private feelScroll(elapsedMs: number): boolean {
    const top = this.container.getBoundingClientRect().top / this.scale
    const track = this.scrollTrack
    let accel = 0
    if (track && elapsedMs > 0) {
      const velocity = (top - track.top) / elapsedMs
      accel = (velocity - track.velocity) / elapsedMs
      track.top = top
      track.velocity += (velocity - track.velocity) * 0.6
    } else {
      this.scrollTrack = { top, velocity: 0 }
    }
    // Units per ms² to multiples of gravity: a book is about 200 units tall, so about 0.9 mm a unit.
    const g = this.reduced.matches ? 0 : Math.max(-SCROLL_G_MAX, Math.min(SCROLL_G_MAX, (accel * 1e6 * SCROLL_FEEL) / 10900))
    for (const r of this.rows) r.physics.shelfAcceleration = { x: 0, y: Math.abs(g) < 0.02 ? 0 : g }
    return Math.abs(this.scrollTrack!.velocity) > 0.01 || Math.abs(g) >= 0.02
  }

  private tick = (time: number) => {
    const elapsed = Math.min(time - (this.last || time), 50)
    this.last = time
    this.acc += elapsed
    const scrolling = this.feelScroll(elapsed)
    while (this.acc >= 1000 / 120) {
      for (const r of this.rows) r.physics.step()
      this.acc -= 1000 / 120
    }
    let pulling = scrolling
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
    for (const p of this.props) {
      p.model.position.set(p.body.position.x - this.logicalWidth / 2, 380 - p.body.position.y, 0)
      p.model.rotation.z = -p.body.angle
      pulling = this.sway(p, elapsed) || pulling
    }
    // Shelf shudder: a fast decaying bounce applied to the plank and everything on it.
    for (const r of this.rows) {
      const dy = r.shake ? this.shakeAt(r.shake, performance.now()) : 0
      if (r.shake && performance.now() - r.shake.at > SHAKE_MS) r.shake = undefined
      r.shelf.position.y = 12 + dy
      if (dy) {
        pulling = true
        for (const i of this.items) if (i.row === r) i.model.position.y += dy
        for (const p of this.props) if (p.row === r) p.model.position.y += dy
      }
      if (r.shake) pulling = true
    }
    const rowPx = this.rowH * this.scale
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

/** Most books stand neatly (85%); the rest lie down or lean. */
const LYING_SHARE = 0.05
const LEANING_SHARE = 0.1

/**
 * The books in the order given, until the next one would take the shelf past three quarters full.
 * A share lie in piles of up to three (consecutive books, so the order still reads left to right)
 * and a share of the standing ones start tipped to lean on a neighbour.
 */
function planShelf(books: Styled[], width: number, emptyShare: number): Placement[] {
  const limit = width * (1 - emptyShare)
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
