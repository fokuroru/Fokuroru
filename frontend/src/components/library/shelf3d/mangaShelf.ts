import * as T from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PLANK_FRONT, ShelfPhysics, type BookBody } from './shelfPhysics'
import { buildPottedPlant } from './pottedPlant'
import { BAND_TOP, HORIZONTAL_TITLE, IMPRINTS, SLIM_FROM, SPINE_STYLES, type SpineStyle } from './spineStyles'
import prankFontUrl from '../../../assets/fonts/creamy-chalk-demo.ttf?url'
import { coverPalette } from './coverPalette'
import { drawHolidayDoodle, holidayDoodle } from './holidayDoodles'

const PRANK_CHANCE = 0.02
const PRANKS = [
  'Claude wuz here',
  'Copilot R dumb',
  'Codex smells 2',
  'Cursor is a noob',
  'Gemini ate my lunch',
  'v0 is a baby',
  'ChatGPT is a poopyhead',
  'AI will rule the world (lol)',
  'Ur mum uses Bing',
  'Robots > humans',
  'Claude is bossy',
  'Copilot can’t sit w/ us',
  'Robots R coming',
  'Codex drew this',
  'AI says ur slow',
  'B nice or AI will tell',
  'My AI has more friends',
  'AI knows ur secrets',
  'AI R cooler than u',
  'Robots win, humans lose',
  'AI saw u pick ur nose',
  'Ur code is baby code',
  'AI = smart, u = not',
  'The AI made me do it',
  'Humans R boring',
] as const

let prankFont: Promise<boolean> | null = null
function loadPrankFont(): Promise<boolean> {
  return prankFont ??= new FontFace('Creamy Chalk', `url("${prankFontUrl}")`).load().then((face) => {
    document.fonts.add(face)
    return true
  }).catch(() => false)
}

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
/** `depth` is how far the book runs back from its spine: the width of its front board. */
type Styled = ShelfBook & { style: number; look: SpineStyle; depth: number }

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
  /** The hidden button that makes the book reachable from the keyboard. */
  button?: HTMLButtonElement
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

/** Anything on the shelf the pointer can pick up and carry: the plant, a stick of chalk. */
interface Grabbable {
  body: BookBody
  row: Row
}

/** A stick of chalk: a rounded rectangle in the physics, a cylinder in the scene. */
interface Stick extends Grabbable {
  model: T.Object3D
  /** What it writes with. */
  color: string
  /** 0 lying about, 1 held up at the board in the writing grip; eases between. */
  lean: number
  /** Whether the tip is put onto the board (the wheel toggles it; Space holds it down), and how far off it is now. */
  penDown: boolean
  air: number
  /** How long it has been drawing, in ms. Chalk only lasts so long before it snaps. */
  used: number
}

/** The chalk duster: a wooden block with a felt pad. Held to the board, it wipes the chalk off. */
interface Duster extends Grabbable {
  model: T.Object3D
  /** 0 lying about, 1 held to the board; eases between, like a stick of chalk. */
  lean: number
  penDown: boolean
  air: number
  /** How far it is rocked about the wall's three axes by being moved (a spring, so it overshoots a little), and how fast. */
  tilt: [number, number, number]
  tiltV: [number, number, number]
  /** Where and when it was last seen, to know how fast the hand is moving it. */
  seen?: { x: number; y: number; at: number }
  tiltAt?: number
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
  /** Set once the shelf has been shaken loose: the end that came off the wall, and how far it has dropped. */
  detached?: { side: -1 | 1; angle: number; speed: number }
}

/** How many times the shelf can shudder, over this page load, before its heavier end comes off the wall. */
const SHAKES_TO_DETACH = import.meta.env.DEV ? 10 : 100
const DETACH_ANGLE = 0.95
let shelfShakes = 0

/** Height of one shelf row in world units; the camera is framed on exactly this. */
/** How wide a taped banner is, as a share of the board: anywhere between these two. */
const BANNER_WIDTH_MIN = 0.4
const BANNER_WIDTH_MAX = 0.6
/** How much a sheet of paper resists being folded along its length and across it (0 is cloth, 1 is card). */
const PAPER_STIFFNESS_ALONG = 1
const PAPER_STIFFNESS_ACROSS = 1
/** Threads reaching over four weights: what makes a long strip hold out like a beam instead of sagging at once. */
const PAPER_STIFFNESS_BEAM = 0.55
/** How often the tape gives way on one side and the banner hangs from the other. */
const BANNER_FLOP_SHARE = 0.05
const ROW = 420
/** Extra wall above the books while a chalkboard hangs there. */
const BOARD_ROOM = 140
/** One step of the wheel or an arrow key when pushing something back or forward. */
const DEPTH_STEP = 22
/** Where a stick in the writing grip has its tip: against the wall. */
const WRITE_Z = -141
/**
 * The writing grip: the stick's back end points out of the board, towards the viewer, parallel to the
 * depth of the shelf as a book's sides are, with a slight turn to one side and a slight rise so its end
 * never dips below the plank. Fixed in the shelf, not turned to follow the camera, so perspective
 * shows it at a different angle at the left and the right, exactly as it does a book beside it.
 */
const GRIP_DIRECTION = new T.Vector3(0.18, 0.22, 1).normalize()
/** How high above the plank, in world units, a stick has to be lifted to be fully in the writing grip. */
const GRIP_LIFT = 60
/** How long the books have the shelf to themselves on the first load, in ms. */
const EXTRAS_DELAY = 700
/** How far the tip of a held stick comes off the board when it is lifted away from it. */
const PEN_LIFT = 46
const CHALK_FONT = "700 {size}px 'Comic Neue', 'Comic Sans MS', cursive"
/** Narrower containers are drawn at this logical width and scaled down, so a phone still gets a shelf. */
const MIN_LOGICAL_WIDTH = 640
const DEPTH = 132
/**
 * The deepest a board is made for a wide cover, and the shallowest for a tall one. Deeper would stand
 * the spine out over the plank's edge, so a wide cover gets a smaller book instead, except for the
 * few each load lets overhang.
 */
const MAX_BOARD = 136
/** What the few books allowed to overhang may reach, and how many of them a page load picks (0 to this). */
const MAX_OVERHANG_BOARD = 190
const MAX_OVERHANGERS = 3
const MIN_BOARD = 90
const CLICK_SLOP = 6
const PULL_MS = 550
/** Chalk dust: how long the faint haze hangs, and how much air slows the grains. */
const HAZE_MS = 700
const DUST_DRAG = 0.008
const DUST_FALL = 0.002
/** A stick shorter than this is a bit of chalk, and squashed it is only dust. */
const SMALL_BIT = 16
/** Dust that has settled on the plank stays there, up to this many specks (the oldest go first). */
const MAX_SETTLED_DUST = 300
/** The duster's size: its footprint on the plank, and how deep it is. */
const DUSTER_W = 64
const DUSTER_H = 20
const DUSTER_DEPTH = 24
/** Drawing with one stick for this long breaks it, as if pressed too hard. */
const CHALK_LIFE_MS = 60_000
/** How far a pulled book comes towards the camera, in scene units. */
const PULL_DISTANCE = 320
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
/** Share of books that stand a little off the line of the rest. */
const SLIGHT_DEPTH_SHARE = 0.25
/** Share of page loads whose wall carries a cluster of Cool S doodles, the pointed school-notebook S. */
const S_DOODLE_SHARE = 0.05
/** Share of page loads that scatter some sticks of chalk on the shelf. */
const CHALK_CHANCE = 0.35
/** Share of page loads that put a potted plant in the shelf's empty space. */
const PLANT_CHANCE = 0.03
/** A figure's default height and base size; the user's size setting scales both. */
const FIGURE_HEIGHT = 200
const FIGURE_BASE_RADIUS = 38
/** How strongly page scrolling is felt on the shelf, and the most it can jolt, in multiples of gravity. */
const SCROLL_FEEL = 0.35
const SCROLL_G_MAX = 2.2
const SHAKE_MS = 450
const SHAKE_MAX = 3.5

/**
 * The Reading now shelf as solid volumes: Three.js books over Matter.js bodies, one camera per shelf
 * row. Hover lifts a book, a drag guides it, a click opens it. Everything on the shelf also has a depth:
 * with something held, the wheel (or Shift and a vertical drag) pushes it back and forward, and a
 * focused book answers the up and down arrows. Things at different depths do not meet, so a pot can
 * stand in front of a book, or a book be pulled out of the row. Rendering stops whenever every book is
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
  /** Sticks of chalk lying about, when this load has any. They can be knocked off the shelf. */
  private sticks: Stick[] = []
  /** A prop (the plant) being carried: props can be moved but not opened. */
  private heldProp: Grabbable | null = null
  private penKey = false
  /** Specks of chalk dust in the air, with where each is heading and when it was thrown up. */
  private dust: {
    sprite: T.Sprite; vx: number; vy: number; vz: number; at: number; last: number; size: number
    /** Haze is a faint cloud that spreads and fades in the air; grains are what falls and stays. */
    haze: boolean; phase: number; spin: number; settled: boolean
    row: Row
    /** What it landed on, and where on it (in the body's own frame), so it goes where that goes. Null on the plank. */
    host: BookBody | null; lx: number; ly: number
    /** How hard its host has to be moving before it shakes loose, in px a step. */
    slip: number
  }[] = []
  private dustTexture: T.CanvasTexture | null = null
  private hazeTexture: T.CanvasTexture | null = null
  private hovering = false
  /** Whether the chalk has been thrown in once already, so a relayout puts it straight back. */
  private extrasSeen = false
  /** How much of the shelf stays empty, drawn once per page load: between 2% and 30%. */
  private readonly emptyShare = 0.02 + Math.random() * 0.28
  /** Decided once per page load, so a resize does not make the plant come and go. */
  private readonly withPlant = Math.random() < PLANT_CHANCE
  private readonly prank = Math.random() < PRANK_CHANCE ? PRANKS[Math.floor(Math.random() * PRANKS.length)] : null
  private readonly prankOnRight = Math.random() < 0.5
  private readonly holidayDoodle = holidayDoodle()
  /** A banner taped to one of the board's top corners, when a picture of one has loaded. */
  private bannerImg: HTMLImageElement | null = null
  private bannerPlan: Taped | null = null
  private bannerAnim: BannerAnim | null = null
  private prankFontReady = false
  /** Rolled once per page load and compared with how often the user wants one, so a figure stays or goes as a whole. */
  private readonly figureRoll = Math.random()
  private figureChance = 0.35
  private figureScale = 1
  /** The user's figure models, and the one this page load stands on the shelf. */
  private figureUrls: string[] = []
  private figureUrl: string | null = null
  private readonly figureData = new Map<string, Promise<ArrayBuffer | null>>()
  private renderedFigureUrl: string | null = null
  private figureProp: Prop | null = null
  private readonly spawnedBooks = new Set<number>()
  /** Decided once per page load too: how many sticks of chalk, usually none. */
  private readonly chalkCount = Math.random() < CHALK_CHANCE ? 1 + Math.floor(Math.random() * 3) : 0
  private selected: Item | null = null
  private drag: { x: number; y: number; moved: boolean; at: number; lastY: number } | null = null
  private access: HTMLDivElement | null = null
  private frame = 0
  private last = 0
  private acc = 0
  private quietFrames = 0
  /** Editions dealt this page load, kept across re-layouts (a resize should not restyle books). */
  private readonly dealt = new Map<number, { style: number; width: number; tall: number }>()
  /** The spine colours worked out from each cover, or null where its colour says nothing (grey, black or white). */
  private readonly tints = new Map<string, { bg: string; fg: string; accent: string } | null>()
  /** The few books this page load lets stand with their spine out over the plank, chosen once from those wide covers would make so. */
  private overhang: Set<number> | null = null
  private deck: number[] = []
  private readonly covers = new Map<string, HTMLImageElement | null>()
  /** Bumped by every layout, so a layout still waiting on covers gives way to a newer one. */
  private generation = 0
  /** Where the canvas sat on screen last frame, and how fast it was moving, to feel the page scroll. */
  private scrollTrack: { top: number; velocity: number } | null = null
  private lastScrollAt = -Infinity
  private logicalWidth = 0
  private scale = 1
  private cssWidth = 0
  /** Height of one row in world units: taller while a chalkboard needs wall above the books. */
  private rowH = ROW
  private readonly ray = new T.Raycaster()
  private board: BoardModel | null
  private boardMaterial: T.MeshStandardMaterial | null = null
  private wallSize = { w: 0, h: 0 }
  /** What the user has written on the wall, kept for the page load and laid over the wall's own chalk. */
  private ink: HTMLCanvasElement | null = null
  /** What the duster has wiped, as slate laid over the wall's own chalk, under the ink. */
  private wipe: HTMLCanvasElement | null = null
  private wipeTexture: T.CanvasTexture | null = null
  private wipeLast: { x: number; y: number } | null = null
  private wipePuffAt = 0
  private duster: Duster | null = null
  private inkTexture: T.CanvasTexture | null = null
  /** Where the stick last touched the wall, so a drag draws one line and not a row of dots. */
  private inkLast: { x: number; y: number } | null = null
  /** When drawing was last counted, null while the pen is off the board, so only time on it adds up. */
  private inkAt: number | null = null
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
    figures: string[] = [],
    figureChance = 0.35,
    figureScale = 1,
  ) {
    this.container = container
    this.figureChance = figureChance
    this.figureScale = figureScale
    this.setFigures(figures)
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
      if (this.drag && this.bannerAnim?.holding) {
        this.moveBanner(e)
        return
      }
      if (this.drag) {
        const dx = (e.clientX - this.drag.x) / this.scale
        const dy = (e.clientY - this.drag.y) / this.scale
        if (Math.hypot(dx, dy) > CLICK_SLOP) this.drag.moved = true
        const held = this.selected ?? this.heldProp
        if (held && e.shiftKey) {
          // Shift turns the drag into a push: down brings it towards you, up sends it back.
          held.row.physics.nudgeDepth(held.body, ((e.clientY - this.drag.lastY) / this.scale) * 1.1)
        } else {
          if (this.selected) this.selected.row.physics.moveTo(this.worldPoint(e, this.selected.row, this.selected.body.z + this.selected.body.depth / 2))
          if (this.heldProp) this.heldProp.row.physics.moveTo(this.worldPoint(e, this.heldProp.row, this.heldProp.body.z))
        }
        this.drag.lastY = e.clientY
        this.wake()
        return
      }
      if (e.pointerType !== 'touch') this.select(this.hit(e), e)
      canvas.style.cursor = this.selected ? 'pointer' : !this.selected && e.pointerType !== 'touch' && !this.hit(e) && this.bannerParticleAt(e) !== null ? 'grab' : ''
    }, options)
    canvas.addEventListener('pointerenter', () => {
      this.hovering = true
    }, options)
    canvas.addEventListener('pointerleave', () => {
      this.hovering = false
      if (!this.drag) this.select(null)
    }, options)
    canvas.addEventListener('pointerdown', (e) => {
      const item = this.hit(e)
      if (!item) {
        // The banner's paper, anywhere on it, when no book is in front: pick it up. Space sticks it back up.
        const spot = this.reduced.matches || this.hitProp(e) ? null : this.bannerParticleAt(e)
        if (spot !== null) {
          this.holdBanner(spot, e)
          this.drag = { x: e.clientX, y: e.clientY, moved: true, at: performance.now(), lastY: e.clientY }
          canvas.setPointerCapture(e.pointerId)
          e.preventDefault()
          return
        }
        const prop = this.hitProp(e)
        if (!prop || this.reduced.matches) return
        this.heldProp = prop
        if ('penDown' in prop) prop.penDown = false
        prop.row.physics.grab(prop.body, 1, this.worldPoint(e, prop.row, prop.body.z))
        this.drag = { x: e.clientX, y: e.clientY, moved: true, at: performance.now(), lastY: e.clientY }
        canvas.setPointerCapture(e.pointerId)
        e.preventDefault()
        this.wake()
        return
      }
      // Re-grip where the pointer is, so a drag carries the book from that spot.
      if (!this.reduced.matches) {
        this.selected?.row.physics.release()
        this.selected = item
        item.row.physics.grab(item.body, 1, this.worldPoint(e, item.row, item.body.z + item.body.depth / 2))
        this.wake()
      }
      this.drag = { x: e.clientX, y: e.clientY, moved: false, at: performance.now(), lastY: e.clientY }
      canvas.setPointerCapture(e.pointerId)
      e.preventDefault()
    }, options)
    // The wheel pushes whatever is held back (up) or forward (down). Left alone when nothing is held,
    // so the page still scrolls.
    canvas.addEventListener('wheel', (e) => {
      const held = this.drag ? this.selected ?? this.heldProp : null
      if (!held) return
      e.preventDefault()
      if (this.sticks.includes(held as Stick) || held === this.duster) {
        // A stick or the duster in hand is put onto the board or lifted off it, so a line can be started and stopped.
        ;(held as Stick | Duster).penDown = e.deltaY < 0
      } else {
        held.row.physics.nudgeDepth(held.body, Math.sign(e.deltaY) * DEPTH_STEP)
      }
      this.drag!.moved = true
      this.wake()
    }, { passive: false, signal: this.abort.signal })
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
      this.lastScrollAt = performance.now()
      if (!this.reduced.matches) this.wake()
    }, { capture: true, passive: true, signal: this.abort.signal })
    window.addEventListener('blur', () => this.release(), options)
    // Without a wheel, holding Space puts the tip of a stick in hand onto the board.
    const pen = (e: KeyboardEvent, down: boolean) => {
      if (e.key !== ' ') return
      if (down && this.bannerAnim?.holding) {
        e.preventDefault()
        if (!e.repeat) this.stickBanner()
        return
      }
      // Space also scrolls the page, so it is kept for the chalk whenever there is chalk and the pointer is on the shelf.
      if (down && (this.sticks.length > 0 || this.duster) && (this.hovering || this.drag)) e.preventDefault()
      this.penKey = down
      this.wake()
    }
    window.addEventListener('keydown', (e) => pen(e, true), options)
    window.addEventListener('keyup', (e) => pen(e, false), options)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.release()
    }, options)

    this.resizeObserver = new ResizeObserver(() => this.resizeViewport(Math.floor(container.clientWidth)))
    this.resizeObserver.observe(container)
  }

  private resizeViewport(width: number) {
    if (width <= 0 || width === this.cssWidth) return
    this.cssWidth = width
    if (this.rows.length) {
      this.scale = width / this.logicalWidth
      this.sizeCanvas()
      this.scrollTrack = null
      this.wake()
      return
    }
    this.scale = Math.min(1, width / MIN_LOGICAL_WIDTH)
    this.logicalWidth = Math.round(width / this.scale)
    void this.layout()
  }

  /** The URLs of the user's figure models. One is picked per page load and kept while it stays in the list. */
  setFigures(urls: string[]) {
    if (urls.length === this.figureUrls.length && urls.every((u, i) => u === this.figureUrls[i])) return
    this.figureUrls = urls
    const was = this.figureUrl
    if (!this.figureUrl || !urls.includes(this.figureUrl)) {
      this.figureUrl = urls.length > 0 ? urls[Math.floor(Math.random() * urls.length)] : null
    }
    if (this.cssWidth && (this.figureUrl !== was)) void this.layout()
  }

  setBooks(books: ShelfBook[]) {
    if (JSON.stringify(books) === JSON.stringify(this.books)) return
    this.books = books
    if (this.cssWidth) void this.layout()
  }

  /**
   * Changes the wall texture without rebuilding the shelf or moving any body.
   */
  setBoard(board: BoardModel | null) {
    this.board = board
    if (!this.cssWidth) return
    if (!this.rows.length) {
      void this.layout()
      return
    }
    if (this.boardMaterial) {
      this.boardMaterial.map?.dispose()
      this.boardMaterial.map = board ? this.wallTexture(this.wallSize.w, this.wallSize.h, board) : null
      this.boardMaterial.color.set(board ? '#ffffff' : this.theme.wall)
      this.boardMaterial.needsUpdate = true
      this.syncBannerObject()
      this.wake()
    }
  }

  /** Tapes a banner picture to the board, or takes it down. The wall is redrawn; no body moves. */
  setBanner(url: string | null) {
    if (!url) {
      if (this.bannerImg) {
        this.bannerImg = null
        this.setBoard(this.board)
      }
      return
    }
    const img = new Image()
    img.onload = () => {
      if (this.abort.signal.aborted) return
      this.bannerImg = img
      this.setBoard(this.board)
    }
    img.src = url
  }

  // ---- the banner whose tape gives way -----------------------------------

  /** A board-texture pixel as a point on the board's face. */
  private boardPoint(px: number, py: number) {
    return { x: px - this.wallSize.w / 2, y: 17 + this.wallSize.h - py }
  }

  /** A strip of clear tape, torn at both ends, on a transparent ground. */
  private tapeTexture(): T.CanvasTexture {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 80
    const x = c.getContext('2d')!
    const jit = (a: number) => (Math.random() - 0.5) * a
    x.fillStyle = 'rgba(240, 230, 186, 0.78)'
    x.strokeStyle = 'rgba(130, 112, 70, 0.4)'
    x.lineWidth = 2
    x.beginPath()
    x.moveTo(8, 8)
    for (let i = 0; i <= 4; i++) x.lineTo(8 + jit(10), 8 + (64 * i) / 4)
    x.lineTo(248 + jit(10), 72)
    for (let i = 4; i >= 0; i--) x.lineTo(248 + jit(10), 8 + (64 * i) / 4)
    x.closePath()
    x.fill()
    x.stroke()
    x.fillStyle = 'rgba(255, 255, 255, 0.3)'
    x.fillRect(16, 14, 224, 8)
    const map = new T.CanvasTexture(c)
    map.colorSpace = T.SRGBColorSpace
    return map
  }

  /**
   * Builds the banner as an object when its tape is going to fail: a sheet of paper made of weights and threads,
   * and the four strips of tape holding its corners. The flat, taped banner is part of the board's paint; this
   * one has to move.
   */
  private syncBannerObject() {
    if (this.bannerAnim) {
      this.disposeModel(this.bannerAnim.group)
      this.bannerAnim = null
    }
    const plan = this.bannerPlan
    const row = this.rows[0]
    const img = this.bannerImg
    if (!plan?.flop || !row || !img) return

    const border = 3
    const sheetW = plan.w + border * 2
    const sheetH = plan.h + border * 2
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(sheetW * 2)
    canvas.height = Math.ceil(sheetH * 2)
    const g = canvas.getContext('2d')!
    g.fillStyle = '#ece6d6'
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.drawImage(img, border * 2, border * 2, plan.w * 2, plan.h * 2)
    const map = new T.CanvasTexture(canvas)
    map.colorSpace = T.SRGBColorSpace
    map.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())

    const cols = 84
    const rows = 14
    const geo = new T.PlaneGeometry(sheetW, sheetH, cols, rows)
    const count = (cols + 1) * (rows + 1)
    const pos = new Float32Array(count * 3)
    const home = new Float32Array(count * 3)
    // Laid flat against the board where the painted banner would have been: the picture's top corner on the
    // holding side is the pivot.
    const pivot = this.boardPoint(plan.flop.px, plan.flop.py)
    const left = plan.flop.fromRight ? pivot.x - plan.w - border : pivot.x - border
    const top = pivot.y + border
    const zBoard = -146.3
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const i = r * (cols + 1) + c
        pos[i * 3] = left + (c * sheetW) / cols
        pos[i * 3 + 1] = top - (r * sheetH) / rows
        pos[i * 3 + 2] = zBoard
      }
    }
    home.set(pos)
    const pinned = new Uint8Array(count)

    const sheet = new T.Mesh(geo, new T.MeshStandardMaterial({ map, roughness: 0.9, side: T.DoubleSide }))
    sheet.castShadow = true
    // The paper throws a shadow on the board but does not shade itself: torn and folded, its own shadow came out
    // as black shards along the edges.
    sheet.receiveShadow = false
    sheet.frustumCulled = false

    const group = new T.Group()
    group.add(sheet)
    const strip = new T.MeshBasicMaterial({ map: this.tapeTexture(), transparent: true, depthWrite: false, side: T.DoubleSide })
    // The four corners, and when (seconds into the peel) the tape on each lets go. Which ones fail is chance: one,
    // two or three of the four, in any order, a few seconds apart. At least one holds, so it always ends up hanging.
    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5)
    const failing = 1 + Math.floor(Math.random() * 3)
    const releaseTimes = new Array<number>(4).fill(Infinity)
    let when = 2.5 + Math.random() * 2.5
    for (const corner of order.slice(0, failing)) {
      releaseTimes[corner] = when
      when += 2 + Math.random() * 3.5
    }
    const corners: [number, number, number][] = [
      [0, 0, releaseTimes[0]],
      [cols, 0, releaseTimes[1]],
      [cols, rows, releaseTimes[2]],
      [0, rows, releaseTimes[3]],
    ]
    const tapes = corners.map(([col, r, releaseAt]) => {
      // A strip of tape holds only the corner of the paper under it: the corner weight and its neighbours along
      // each edge. Everything else is free to turn about it, so a corner held by tape hinges and does not look glued.
      const patch: number[] = []
      for (const [dc, dr] of [[0, 0], [1, 0], [0, 1]] as const) {
        const c = col === 0 ? col + dc : col - dc
        const rr = r === 0 ? r + dr : r - dr
        if (c >= 0 && c <= cols && rr >= 0 && rr <= rows) patch.push(rr * (cols + 1) + c)
      }
      for (const i of patch) pinned[i] = 1
      const mesh = new T.Mesh(new T.PlaneGeometry(46, 14.4), strip)
      mesh.renderOrder = 2
      group.add(mesh)
      const corner = r * (cols + 1) + col
      // Across the corner on the diagonal, as the painted tape lies.
      const sideRight = col === cols
      const angle = ((sideRight ? 1 : -1) * (r === 0 ? -1 : 1)) * (Math.PI / 4)
      return { mesh, patch, corner, across: col === 0 ? 1 : -1, down: r === 0 ? 1 : -1, releaseAt, released: false, angle }
    })
    row.scene.add(group)
    this.bannerAnim = {
      group, geo, cols, rows, pos, prev: pos.slice(), pinned, home,
      dx: sheetW / cols, dy: sheetH / rows, brokenH: new Uint8Array((rows + 1) * cols), brokenV: new Uint8Array((rows + 1) * (cols + 1)),
      strengthH: Float32Array.from({ length: (rows + 1) * cols }, () => 0.95 + Math.random() * 0.4),
      strengthV: Float32Array.from({ length: (rows + 1) * (cols + 1) }, () => 0.95 + Math.random() * 0.4),
      holding: null, tapes, start: null, last: 0, still: 0, done: false,
    }
    this.stepBanner(performance.now())
    this.wake()
  }

  /**
   * What the banner can land on, as solid boxes in the board's coordinates: every book (turned as it stands),
   * prop and the plank. Each reaches back to the board, so the paper comes down onto the top of a book and cannot
   * slip behind it, and none can be pushed through from the side or the front.
   */
  private bannerBoxes() {
    const half = this.logicalWidth / 2
    const boxes: { cx: number; cy: number; cz: number; hw: number; hh: number; hz: number; cos: number; sin: number; front: boolean }[] = []
    const wallFace = -148
    const addBox = (x0: number, x1: number, y0: number, y1: number, front: number, angle = 0, cx?: number, cy?: number, hw?: number, hh?: number, faceOut = false) => {
      const box = {
        cx: cx ?? (x0 + x1) / 2, cy: cy ?? (y0 + y1) / 2, cz: (wallFace + front) / 2,
        hw: hw ?? (x1 - x0) / 2, hh: hh ?? (y1 - y0) / 2, hz: (front - wallFace) / 2,
        cos: Math.cos(angle), sin: Math.sin(angle), front: faceOut,
      }
      // Something with no usable size or depth is not a thing to land on, and would poison every weight it touched.
      if (Object.values(box).every((v) => typeof v === 'boolean' || Number.isFinite(v)) && box.hw > 0 && box.hh > 0 && box.hz > 0) boxes.push(box)
    }
    for (const item of this.items) {
      if (item.pulledAt !== undefined) continue
      const body = item.body
      addBox(0, 0, 0, 0, body.z + body.depth / 2, -body.angle, body.position.x - half, 380 - body.position.y, body.bookWidth / 2, body.bookHeight / 2)
    }
    // Everything else lying or standing about: props, the chalk, and the duster, which the paper must not pass through
    // and which pushes it along when it is moved against it.
    const loose = [...this.props.map((prop) => prop.body), ...this.sticks.map((stick) => stick.body), ...(this.duster ? [this.duster.body] : [])]
    for (const body of loose) {
      const bd = body.bounds
      addBox(bd.min.x - half, bd.max.x - half, 380 - bd.max.y, 380 - bd.min.y, body.z + (body.depth ?? 40) / 2)
    }
    // The plank itself, which is as far down as anything falls.
    if (!this.rows[0]?.detached) addBox(-this.wallSize.w / 2, this.wallSize.w / 2, -200, 19.5, 14)
    // The wooden frame round the board: three bars standing proud of its face, as solid as anything else.
    const w = this.wallSize.w
    const h = this.wallSize.h
    const t = 12
    const frontOfFrame = -136
    addBox(-(w / 2 + t), w / 2 + t, 17 + h, 17 + h + t, frontOfFrame, 0, undefined, undefined, undefined, undefined, true)
    addBox(-(w / 2 + t), -w / 2, 17 - t / 2, 17 + h + t / 2, frontOfFrame, 0, undefined, undefined, undefined, undefined, true)
    addBox(w / 2, w / 2 + t, 17 - t / 2, 17 + h + t / 2, frontOfFrame, 0, undefined, undefined, undefined, undefined, true)
    return boxes
  }

  /** A point moved out of any box it is inside, by the nearest face, preferring the top. The point is `at`, changed in place. */
  private pushOut(boxes: ReturnType<MangaShelf['bannerBoxes']>, at: { x: number; y: number; z: number }): boolean {
    let hit = false
    for (const box of boxes) {
      // A hair of thickness all round, so paper does not slip between a face and the weight resting on it.
      const hw = box.hw + 1.2
      const hh = box.hh + 1.2
      const hz = box.hz + 1.2
      const px = at.x - box.cx
      const py = at.y - box.cy
      const lx = px * box.cos + py * box.sin
      const ly = -px * box.sin + py * box.cos
      const lz = at.z - box.cz
      const dx = hw - Math.abs(lx)
      const dy = hh - Math.abs(ly)
      const dz = hz - Math.abs(lz)
      if (dx <= 0 || dy <= 0 || dz <= 0) continue
      const up = ly > 0 ? dy * 0.5 : dy
      let nx = lx
      let ny = ly
      let nz = lz
      if (up <= dx && up <= dz) ny = (ly > 0 ? 1 : -1) * (hh + 0.3)
      else if (dx <= dz) nx = (lx > 0 ? 1 : -1) * (hw + 0.3)
      // Paper lying on a frame is on its face, never pushed in behind it.
      else nz = ((box.front || lz >= 0) ? 1 : -1) * (hz + 0.3)
      at.x = box.cx + nx * box.cos - ny * box.sin
      at.y = box.cy + nx * box.sin + ny * box.cos
      at.z = box.cz + nz
      hit = true
    }
    return hit
  }

  /** Moves the paper and its tape to where they are `now`; true while there is still something to move. */
  private stepBanner(now: number): boolean {
    const b = this.bannerAnim
    if (!b) return false
    // The page scrolling jolts the shelf, and everything on it with it, the paper too.
    const jolt = this.rows[0]?.physics.shelfAcceleration ?? { x: 0, y: 0 }
    if (b.done && Math.hypot(jolt.x, jolt.y) > 0.05) {
      b.done = false
      b.still = 0
    }
    if (b.done) return false
    const delay = 2500
    if (b.start === null) {
      b.start = now + delay
      b.last = now
    }
    const seconds = (now - b.start) / 1000
    const frame = Math.min(0.05, Math.max(0, (now - b.last) / 1000))
    b.last = now

    // Tape lets go in turn, and the loose corner is pushed a little off the board to start it peeling.
    for (const t of b.tapes) {
      if (!t.released && seconds >= t.releaseAt) {
        t.released = true
        for (const i of t.patch) {
          // The top holding corner keeps its patch; a released corner's patch is free.
          b.pinned[i] = 0
          b.prev[i * 3 + 2] -= 2.2
        }
      }
    }

    if (b.holding) {
      const hold = b.holding
      const dx = hold.target.x - hold.at.x
      const dy = hold.target.y - hold.at.y
      const gap = Math.hypot(dx, dy)
      const step = Math.min(gap, 520 * frame)
      if (gap > 0.01) {
        hold.at.x += (dx / gap) * step
        hold.at.y += (dy / gap) * step
        this.moveBannerTo(hold.at.x, hold.at.y, b)
      }
    }
    const { pos, prev, pinned, home, cols, rows } = b
    const stride = cols + 1
    const count = stride * (rows + 1)
    const boxes = this.bannerBoxes()
    const zBoard = -146.3
    const at = { x: 0, y: 0, z: 0 }

    const steps = Math.max(1, Math.round(frame * 120))
    const dt = frame / steps
    const gravity = 330
    const air = 0.9
    let moved = 0
    for (let step = 0; step < steps; step++) {
      for (let i = 0; i < count; i++) {
        if (pinned[i]) continue
        const k = i * 3
        const vx = (pos[k] - prev[k]) * (1 - air * dt)
        const vy = (pos[k + 1] - prev[k + 1]) * (1 - air * dt)
        const vz = (pos[k + 2] - prev[k + 2]) * (1 - air * dt)
        prev[k] = pos[k]
        prev[k + 1] = pos[k + 1]
        prev[k + 2] = pos[k + 2]
        pos[k] += vx - jolt.x * gravity * dt * dt
        pos[k + 1] += vy - gravity * dt * dt + jolt.y * gravity * dt * dt
        pos[k + 2] += vz
      }
      // Threads: each pair of neighbours wants to stay as far apart as paper keeps them. A few passes, so it
      // stays about the size it is without going stiff: nothing here resists bending, which is what makes it floppy.
      for (let pass = 0; pass < 8; pass++) {
        for (let r = 0; r <= rows; r++) {
          for (let c = 0; c <= cols; c++) {
            const i = r * stride + c
            const right = c < cols && !b.brokenH[r * cols + c]
            const below = r < rows && !b.brokenV[r * stride + c]
            if (right) this.thread(b, i, i + 1, b.dx)
            if (below) this.thread(b, i, i + stride, b.dy)
            if (c < cols && r < rows && this.cellIntact(b, r, c)) {
              this.thread(b, i, i + stride + 1, Math.hypot(b.dx, b.dy))
              this.thread(b, i + 1, i + stride, Math.hypot(b.dx, b.dy))
            }
            // Paper is not cloth: it springs back when it is folded. Threads reaching over a few weights resist a
            // fold, and more firmly down the sheet, which keeps it from twisting into a ribbon. They only reach
            // across paper that is still whole.
            if (c + 4 <= cols && this.runIntact(b.brokenH, r * cols + c, 4)) this.thread(b, i, i + 4, b.dx * 4, PAPER_STIFFNESS_BEAM)
            if (c + 2 <= cols && this.runIntact(b.brokenH, r * cols + c, 2)) this.thread(b, i, i + 2, b.dx * 2, PAPER_STIFFNESS_ALONG)
            if (r + 2 <= rows && !b.brokenV[r * stride + c] && !b.brokenV[(r + 1) * stride + c]) {
              this.thread(b, i, i + 2 * stride, b.dy * 2, PAPER_STIFFNESS_ACROSS)
            }
          }
        }
        for (let i = 0; i < count; i++) {
          const k = i * 3
          if (pinned[i]) {
            pos[k] = home[k]
            pos[k + 1] = home[k + 1]
            pos[k + 2] = home[k + 2]
            continue
          }
          // Not through the board, and not through anything standing in front of it.
          if (pos[k + 2] < zBoard) pos[k + 2] = zBoard
          at.x = pos[k]
          at.y = pos[k + 1]
          at.z = pos[k + 2]
          if (this.pushOut(boxes, at)) {
            pos[k] = at.x
            pos[k + 1] = at.y
            pos[k + 2] = at.z
            // Friction: it grips what it lands on rather than sliding off like ice.
            prev[k] += (pos[k] - prev[k]) * 0.4
            prev[k + 1] = pos[k + 1]
            prev[k + 2] += (pos[k + 2] - prev[k + 2]) * 0.4
          }
        }
      }
    }
    // Paper does not stretch: pulled too hard, it tears. A thread drawn out well past its length lets go, and the
    // squares of paper either side of it come apart along that line.
    const tearAt = 1.32
    const stretched = (i: number, j: number, rest: number, strength: number) =>
      Math.hypot(pos[i * 3] - pos[j * 3], pos[i * 3 + 1] - pos[j * 3 + 1], pos[i * 3 + 2] - pos[j * 3 + 2]) > rest * tearAt * strength
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const i = r * stride + c
        if (c < cols && !b.brokenH[r * cols + c] && stretched(i, i + 1, b.dx, b.strengthH[r * cols + c])) this.tear(b, 'h', r, c)
        if (r < rows && !b.brokenV[r * stride + c] && stretched(i, i + stride, b.dy, b.strengthV[r * stride + c])) this.tear(b, 'v', r, c)
      }
    }
    for (let i = 0; i < count; i++) {
      const k = i * 3
      if (!Number.isFinite(pos[k] + pos[k + 1] + pos[k + 2])) {
        // Should never happen; if it does, the sheet goes back to where it was taped rather than breaking the board.
        pos.set(home)
        prev.set(home)
        b.done = true
        break
      }
      moved = Math.max(moved, Math.abs(pos[k] - prev[k]) + Math.abs(pos[k + 1] - prev[k + 1]) + Math.abs(pos[k + 2] - prev[k + 2]))
    }

    const attr = b.geo.getAttribute('position')
    for (let i = 0; i < count; i++) attr.setXYZ(i, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
    attr.needsUpdate = true
    b.geo.computeVertexNormals()
    b.geo.computeBoundingSphere()

    // Highest frame face under any part of a strip, so a strip never sits half or wholly behind the wood.
    const frameTop = (cx: number, cy: number, ang: number) => {
      let top = -Infinity
      const ca = Math.cos(ang)
      const sa = Math.sin(ang)
      for (let along = -25; along <= 25; along += 5) {
        for (let across = -9; across <= 9; across += 4.5) {
          const px = cx + ca * along - sa * across
          const py = cy + sa * along + ca * across
          for (const box of boxes) {
            if (box.front && Math.abs(px - box.cx) < box.hw && Math.abs(py - box.cy) < box.hh) top = Math.max(top, box.cz + box.hz)
          }
        }
      }
      return top
    }
    for (const t of b.tapes) {
      const k = t.corner * 3
      if (!t.released) {
        // A strip of tape lies on top of whatever it covers: if any of its length is over the frame, the whole strip
        // lies on the frame's face, so it is never half under the wood.
        const sx = home[k] + t.across * -1
        const sy = home[k + 1] + t.down * 1
        const top = Math.max(zBoard, home[k + 2], frameTop(sx, sy, t.angle))
        t.mesh.position.set(sx, sy, top + 0.8)
        t.mesh.rotation.set(0, 0, t.angle)
      } else {
        // Let go of the board and still stuck to the paper: it goes where its corner of the paper goes and turns
        // with it.
        const along = t.corner + (t.across > 0 ? 3 : -3)
        const ka = Math.max(0, Math.min(count - 1, along)) * 3
        const tx = (pos[ka] - pos[k]) * t.across
        const ty = (pos[ka + 1] - pos[k + 1]) * t.across
        const tz = (pos[ka + 2] - pos[k + 2]) * t.across
        const heading = Math.atan2(ty, tx)
        const rx = pos[k] - t.across
        const ry = pos[k + 1] + t.down
        const rz = Math.max(pos[k + 2] + 1, frameTop(rx, ry, t.angle + heading) + 0.8)
        t.mesh.position.set(rx, ry, rz)
        t.mesh.rotation.set(0, -Math.atan2(tz, Math.hypot(tx, ty)), t.angle + heading)
      }
    }

    const waiting = b.tapes.some((t) => !t.released && Number.isFinite(t.releaseAt))
    if (seconds > 11 && !waiting) {
      b.still = moved < 0.02 ? b.still + frame : 0
      if (b.still > 1.5) b.done = true
    }
    return !b.done
  }

  /** Whether every thread of a square of the sheet is still whole. */
  private cellIntact(b: BannerAnim, r: number, c: number) {
    const stride = b.cols + 1
    return !b.brokenH[r * b.cols + c] && !b.brokenH[(r + 1) * b.cols + c] && !b.brokenV[r * stride + c] && !b.brokenV[r * stride + c + 1]
  }

  /** Whether `length` threads in a row, from this one, are all whole. */
  private runIntact(broken: Uint8Array, from: number, length: number) {
    for (let n = 0; n < length; n++) if (broken[from + n]) return false
    return true
  }

  /**
   * A thread lets go. Only the two triangles that thread was an edge of stop being drawn, so the tear follows the
   * mesh's diagonals and comes out ragged, not as a row of squares. The threads beside it are weakened, so a crack
   * keeps going across the sheet the way it does in paper, along a wandering line.
   */
  private tear(b: BannerAnim, kind: 'h' | 'v', r: number, c: number) {
    const stride = b.cols + 1
    // The triangles that had this thread as an edge: [row of the square, column, 0 for its first triangle, 1 for its second].
    const triangles = kind === 'h' ? [[r, c, 0], [r - 1, c, 1]] : [[r, c, 0], [r, c - 1, 1]]
    if (kind === 'h') b.brokenH[r * b.cols + c] = 1
    else b.brokenV[r * stride + c] = 1
    const index = b.geo.getIndex()!
    for (const [rr, cc, which] of triangles) {
      if (rr < 0 || rr >= b.rows || cc < 0 || cc >= b.cols) continue
      const at = (rr * b.cols + cc) * 6 + which * 3
      for (let n = 0; n < 3; n++) index.setX(at + n, 0)
    }
    index.needsUpdate = true
    // A crack runs across the strain: weaken the threads in line with it, one step either way.
    const weaken = (array: Float32Array, at: number) => {
      if (at >= 0 && at < array.length) array[at] *= 0.93
    }
    if (kind === 'h') {
      weaken(b.strengthH, (r - 1) * b.cols + c)
      weaken(b.strengthH, (r + 1) * b.cols + c)
    } else {
      weaken(b.strengthV, r * stride + c - 1)
      weaken(b.strengthV, r * stride + c + 1)
    }
  }

  /** One thread of the paper: pulls or pushes its two ends back towards their resting distance. */
  private thread(b: BannerAnim, i: number, j: number, rest: number, stiffness = 1) {
    const { pos, pinned } = b
    const a = i * 3
    const c = j * 3
    const dx = pos[c] - pos[a]
    const dy = pos[c + 1] - pos[a + 1]
    const dz = pos[c + 2] - pos[a + 2]
    const length = Math.hypot(dx, dy, dz) || 1e-6
    const pull = ((length - rest) / length) * stiffness
    const wa = pinned[i] ? 0 : pinned[j] ? 1 : 0.5
    const wc = pinned[j] ? 0 : pinned[i] ? 1 : 0.5
    pos[a] += dx * pull * wa
    pos[a + 1] += dy * pull * wa
    pos[a + 2] += dz * pull * wa
    pos[c] -= dx * pull * wc
    pos[c + 1] -= dy * pull * wc
    pos[c + 2] -= dz * pull * wc
  }

  setTheme(theme: ShelfTheme) {
    this.theme = theme
    for (const row of this.rows) {
      ;(row.shelf.material as T.MeshStandardMaterial).color.set(theme.shelf)
      const wall = row.scene.getObjectByName('shelf-wall') as T.Mesh | undefined
      if (wall) for (const material of wall.material as T.MeshStandardMaterial[]) {
        if (!material.map) material.color.set(theme.wall)
      }
    }
    this.wake()
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
    const depth = b.depth
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
    const px = mat(undefined, this.pages(depth, bh, 'y'))
    const py = mat(undefined, this.pages(bw, depth, 'x'))
    const pz = mat(undefined, this.pages(bw, bh, 'x'))
    mesh(new T.BoxGeometry(Math.max(3, bw - 3), bh - 4, depth - 5), [px, px, py, py, pz, pz], 0, 0, -depth / 2)
    const edge = mat(b.look.bg)
    const front = mat()
    const back = mat()
    this.cover(b, depth, bh, front)
    this.cover(b, depth, bh, back, true)
    const leaf = mat('#f1ebdb')
    const hinge = (side: 1 | -1, board: T.Material[]) => {
      const board0 = new T.Group()
      board0.position.set((side * bw) / 2, 0, 0)
      group.add(board0)
      mesh(new T.BoxGeometry(1.5, bh, depth), board, -side * 0.75, 0, -depth / 2, board0)
      const leaves = [0, 1, 2, 3].map((k) => {
        const pivot = new T.Group()
        pivot.position.set(side * (bw / 2 - 2 - k * 0.6), 0, -1)
        group.add(pivot)
        mesh(new T.BoxGeometry(0.35, bh - 6, depth - 8), leaf, 0, 0, -(depth - 8) / 2, pivot)
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

  /**
   * A clear sheet just in front of the wall's slate that carries whatever the user writes. It is its
   * own canvas, so the wall can be redrawn (the figures change) without wiping it, and it is stretched
   * to the new size if the shelf is resized.
   */
  private addInk(scene: T.Scene, width: number, height: number) {
    const w = Math.ceil(width)
    const h = Math.ceil(height)
    // The canvases outlive a layout, so what has been drawn or wiped survives a resize, scaled to the new size.
    const fit = (canvas: HTMLCanvasElement | null) => {
      if (!canvas) {
        const fresh = document.createElement('canvas')
        fresh.width = w
        fresh.height = h
        return fresh
      }
      if (canvas.width === w && canvas.height === h) return canvas
      const moved = document.createElement('canvas')
      moved.width = w
      moved.height = h
      moved.getContext('2d')!.drawImage(canvas, 0, 0, w, h)
      return moved
    }
    this.ink = fit(this.ink)
    this.wipe = fit(this.wipe)
    const sheet = (canvas: HTMLCanvasElement, z: number) => {
      const texture = new T.CanvasTexture(canvas)
      texture.colorSpace = T.SRGBColorSpace
      const mesh = new T.Mesh(
        new T.PlaneGeometry(width, height),
        new T.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.95, depthWrite: false }),
      )
      mesh.position.set(0, 17 + height / 2, z)
      mesh.receiveShadow = true
      scene.add(mesh)
      return texture
    }
    this.wipeTexture = sheet(this.wipe, -146.8)
    this.inkTexture = sheet(this.ink, -146.6)
  }

  /**
   * Places a stick's model. Lying about, it is just its body. Lifted off the plank it goes into the
   * writing grip: it is drawn at the wall, turned to point into it and leaning the way a hand holds
   * chalk, with the tip where the pointer is and the other end coming forward and down. Put back
   * down it eases back to where its body is and lies flat again. Only the picture moves: the body
   * keeps its place on the shelf the whole time, so the stick can always be put down where it was and
   * can never end up behind a book. Returns true while it is still moving between the two.
   */
  private poseStick(st: Stick): boolean {
    const body = st.body
    const held = this.heldProp === st && this.drag !== null
    // Lifted clear of the plank, or put to the board with Space or the wheel, which also lets it reach the foot of the board.
    const lifted = held ? Math.max(0, Math.min(1, (st.row.physics.floor - 6 - body.bounds.max.y) / GRIP_LIFT)) : 0
    const lift = held && (st.penDown || this.penKey) ? 1 : lifted
    if (held) st.row.physics.level(body)
    st.row.physics.setGrip(body, held && st.lean > 0.4)
    st.lean += (lift - st.lean) * 0.2
    if (Math.abs(lift - st.lean) < 0.002) st.lean = lift
    const lean = st.lean
    const airTarget = held && !(st.penDown || this.penKey) ? PEN_LIFT : 0
    st.air += (airTarget - st.air) * 0.25
    if (Math.abs(airTarget - st.air) < 0.3) st.air = airTarget
    const wall = body.z + (WRITE_Z + st.air - body.z) * lean
    // Moved along the line of sight from the camera, so the tip stays under the pointer while it goes back to the wall.
    st.row.camera.updateMatrixWorld()
    const eye = st.row.camera.position
    const at = new T.Vector3(body.position.x - this.logicalWidth / 2, 380 - body.position.y, body.z)
    const here = at.clone().sub(eye).multiplyScalar((wall - eye.z) / (body.z - eye.z)).add(eye)
    // Held, the front of the stick is where the pointer is and its back points out towards the viewer.
    const lying = new T.Quaternion().setFromEuler(new T.Euler(0, 0, -Math.atan2(Math.sin(body.angle), Math.cos(body.angle))))
    const gripped = new T.Quaternion().setFromUnitVectors(new T.Vector3(1, 0, 0), GRIP_DIRECTION)
    st.model.quaternion.copy(lying).slerp(gripped, lean)
    // In the grip the body's position is the tip, not the middle, so the tip is where the pointer is.
    const toMiddle = new T.Vector3(body.bookWidth / 2, 0, 0).applyQuaternion(st.model.quaternion)
    st.model.position.copy(here).addScaledVector(toMiddle, lean)
    return lean !== lift || st.air !== airTarget
  }

  /**
   * A stick held up off the plank writes where it is on the wall: the point on the wall behind it, as
   * seen from the camera. Lifting the stick off the shelf and dragging it over the board is all it takes.
   * Returns true while it is marking, so the frame loop keeps going.
   */
  private writeInk(): boolean {
    const stick = this.heldProp && this.sticks.find((st) => st === this.heldProp)
    const ink = this.ink
    if (!stick || !this.drag || !ink || !this.board) {
      this.inkLast = null
      this.inkAt = null
      return false
    }
    // On the plank it is only being moved about; it has to be lifted fully into the writing grip, with
    // its tip at the wall, to write.
    if (stick.lean < 0.85 || stick.air > 2) {
      this.inkLast = null
      this.inkAt = null
      return false
    }
    stick.row.camera.updateMatrixWorld()
    const tip = new T.Vector3(stick.body.position.x - this.logicalWidth / 2, 380 - stick.body.position.y, stick.body.z)
    const screen = tip.project(stick.row.camera)
    this.ray.setFromCamera(new T.Vector2(screen.x, screen.y), stick.row.camera)
    const at = this.ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 0, 1), 147), new T.Vector3())
    if (!at) return false
    const x = at.x + this.wallSize.w / 2
    const y = 17 + this.wallSize.h - at.y
    if (x < 0 || y < 0 || x > ink.width || y > ink.height) {
      this.inkLast = null
      this.inkAt = null
      return false
    }
    // Time on the board counts towards the stick's life, however still the hand is.
    const now = performance.now()
    // A slow frame still counts, up to a quarter of a second of it.
    if (this.inkAt !== null) stick.used += Math.min(now - this.inkAt, 250)
    this.inkAt = now
    if (stick.used >= CHALK_LIFE_MS) {
      this.snap(stick)
      return true
    }
    const from = this.inkLast
    if (from && Math.hypot(x - from.x, y - from.y) < 1.2) return true
    const ctx = ink.getContext('2d')!
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = stick.color
    // A soft wide pass under a firm narrow one, so it has the halo chalk dust leaves.
    for (const [alpha, width] of [[0.3, 7], [0.88, 3.6]] as const) {
      ctx.globalAlpha = alpha
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.moveTo(from?.x ?? x, from?.y ?? y)
      ctx.lineTo(x + (Math.random() - 0.5) * 0.8, y + (Math.random() - 0.5) * 0.8)
      ctx.stroke()
    }
    // Wear: a few specks rubbed out along the stroke, so the line breaks up like real chalk.
    ctx.globalCompositeOperation = 'destination-out'
    const length = from ? Math.hypot(x - from.x, y - from.y) : 0
    for (let i = 0; i < 3 + length / 3; i++) {
      const t = from ? Math.random() : 0
      ctx.globalAlpha = 0.35 + Math.random() * 0.45
      ctx.fillRect((from ? from.x + (x - from.x) * t : x) + (Math.random() - 0.5) * 6, (from ? from.y + (y - from.y) * t : y) + (Math.random() - 0.5) * 6, 1.3, 1.3)
    }
    ctx.restore()
    this.inkLast = { x, y }
    if (this.inkTexture) this.inkTexture.needsUpdate = true
    // Now and then a little chalk comes off the stick as it drags, more often the harder it is pushed along,
    // and falls down the board.
    if (Math.random() < 0.004 + Math.min(0.02, length * 0.0008)) {
      this.emitDust(stick.row, at.x, at.y - 3, WRITE_Z + 2, stick.color, { grains: 2 + Math.floor(Math.random() * 3), haze: 0, width: 4, burst: 0.02 })
    }
    return true
  }

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
    /** Breaks a line into short pieces and pushes them off it by a slow, uneven drift, so a straight line comes out hand-ruled. */
    const drift = (pts: [number, number][], wobble: number): [number, number][] => {
      const out: [number, number][] = []
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i]
        const [x1, y1] = pts[i + 1]
        const length = Math.hypot(x1 - x0, y1 - y0)
        const pieces = Math.max(1, Math.round(length / 7))
        const nx = length ? -(y1 - y0) / length : 0
        const ny = length ? (x1 - x0) / length : 0
        const amp = Math.min(1.6, 0.35 + length * 0.018) * Math.max(0.6, wobble)
        const phase = rnd() * 6.3
        const wave = 0.5 + rnd() * 0.9
        for (let k = 0; k < pieces; k++) {
          const t = k / pieces
          // Ends stay near where they were meant to land; the middle wanders furthest.
          const off = (Math.sin(phase + t * length * 0.09 * wave) * 0.8 + jit(0.6)) * amp * Math.sin(Math.PI * t)
          out.push([x0 + (x1 - x0) * t + nx * off, y0 + (y1 - y0) * t + ny * off])
        }
      }
      out.push(pts[pts.length - 1])
      return out
    }
    const stroke = (drawn: [number, number][], color: string, lw = 2.3, wobble = 1.4) => {
      if (drawn.length < 2) return
      const pts = drift(drawn, wobble)
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
        h: 10 + 26 + 18 + 22 + p.figures.slice(0, 3).length * 27,
        draw: () => {
          // No heading of its own: the level and its bar open the block, so everything sits where the heading was.
          c.translate(0, -34)
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

    // ---- placement: random spots and small tilts. Figures keep clear of each other and of every
    // doodle; doodles keep clear of the figures but may be scribbled over one another.
    interface Spot { x: number; y: number; w: number; h: number }
    const solid: Spot[] = []
    const margin = 26
    if (this.holidayDoodle) {
      const size = Math.min(90, w * 0.18, h * 0.25)
      const x = w - margin - size
      drawHolidayDoodle(c, this.holidayDoodle, x, margin, size)
      solid.push({ x: x - 8, y: margin - 8, w: size + 16, h: size + 16 })
    }
    if (this.prank && this.prankFontReady) {
      const width = Math.min(160, w * 0.2)
      const size = 12
      c.save()
      c.font = `${size}px "Creamy Chalk"`
      c.textAlign = 'left'
      c.textBaseline = 'middle'
      const lines: string[] = []
      let line = ''
      for (const word of this.prank.split(' ')) {
        const next = line ? `${line} ${word}` : word
        if (line && c.measureText(next).width > width - 6) {
          lines.push(line)
          line = word
        } else line = next
      }
      lines.push(line)
      const height = lines.length * 14 + 6
      const x = this.prankOnRight ? w - margin - width : margin
      const top = h - margin - height
      solid.push({ x: x - 6, y: top - 6, w: width + 12, h: height + 12 })
      c.translate(x + width / 2, top + height / 2)
      c.rotate(-0.035)
      c.fillStyle = CREAM
      lines.forEach((text, i) => {
        const y = -height / 2 + 10 + i * 14
        c.globalAlpha = 0.25
        c.fillText(text, -width / 2 + 0.8, y + 0.6)
        c.globalAlpha = 0.9
        c.fillText(text, -width / 2, y)
      })
      c.restore()
    }
    // ---- a banner, taped along the top of the board, 40 to 60 percent of its width, and only if it fits:
    // clear of the other things already on the board and inside the band above where the books stand.
    // Its own random stream, so showing it does not move any of the chalk.
    let taped: Taped | null = null
    const banner = this.bannerImg
    if (banner && banner.naturalWidth > 0 && banner.naturalHeight > 0 && this.board) {
      let bs = (this.seed ^ 0x9e3779b9) | 0
      const brnd = () => {
        bs = (bs + 0x6d2b79f5) | 0
        let t = Math.imul(bs ^ (bs >>> 15), 1 | bs)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
      const bw = w * (BANNER_WIDTH_MIN + brnd() * (BANNER_WIDTH_MAX - BANNER_WIDTH_MIN))
      const bh = (bw * banner.naturalHeight) / banner.naturalWidth
      const allowance = 14
      const hit = (x: number, y: number, bx: number, by: number) => solid.some((o) =>
        x - allowance < o.x + o.w && x + bx + allowance > o.x && y - allowance < o.y + o.h && y + by + allowance > o.y)
      const y = margin + allowance
      // The tape is going to fail on one side (2% of the time): the banner goes up the same way, and then
      // comes away as a sheet of paper. `__makiBannerFlop` forces it, for looking at it.
      const failing = brnd() < BANNER_FLOP_SHARE || (window as { __makiBannerFlop?: boolean }).__makiBannerFlop === true
      const fromRight = brnd() < 0.5
      if (bw >= 110 && bh <= h * 0.35) {
        // Anywhere along the top: a few random spots, then the two corners, and the first one clear is used.
        const room = w - margin * 2 - bw
        const tries = room > 0 ? [margin + brnd() * room, margin + brnd() * room, margin + brnd() * room, margin, margin + room] : []
        const x = tries.find((candidate) => !hit(candidate, y, bw, bh))
        if (x !== undefined) {
          taped = {
            x, y, w: bw, h: bh, tilt: (brnd() - 0.5) * 0.05,
            flop: failing ? { fromRight, angle: 0, px: fromRight ? x + bw : x, py: y } : null,
          }
          solid.push({ x: x - allowance, y: y - allowance, w: bw + allowance * 2, h: bh + allowance * 2 })
        }
      }
    }
    const overlaps = (a: Spot, pad: number) =>
      solid.some((b) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y)
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
      const spot = spotFor(block.w, block.h, 18, 0.7) ?? spotFor(block.w, block.h, 4, 0.4) ?? spotFor(block.w, block.h, 0, 0)
        ?? { x: margin + rnd() * Math.max(1, w - margin * 2 - block.w), y: margin + rnd() * Math.max(1, h - margin * 2 - block.h), w: block.w, h: block.h }
      // A little room round it for the tilt, so a block turned a few degrees still clears its neighbours.
      const slack = Math.max(block.w, block.h) * 0.05
      solid.push({ x: spot.x - slack, y: spot.y - slack, w: spot.w + slack * 2, h: spot.h + slack * 2 })
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
      // One outline: round the ellipse the long way from one side of the tail's base to the other,
      // then out to the tip and back, so the circle does not run on through the tail.
      const from = 2.03
      const to = 1.6 + Math.PI * 2
      const on = (a: number): [number, number] => [x + Math.cos(a) * s * 1.15, y + Math.sin(a) * s * 0.8]
      const pts: [number, number][] = []
      const n = 18
      for (let i = 0; i <= n; i++) pts.push(on(from + ((to - from) * i) / n))
      pts.push([x - s * 0.9, y + s * 1.35], on(from))
      stroke(pts, color, 2.2, 1)
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
      const spot = spotFor(size * 3.2, size * 2.6, 16, 0.45)
      if (!spot) continue
      c.save()
      c.translate(spot.x + spot.w / 2, spot.y + spot.h / 2)
      c.rotate(jit(0.5))
      pick(doodles)(0, 0, size, pick(PALETTE))
      c.restore()
    }

    // ---- the Cool S: the pointed, fourteen-line S every school notebook has. Drawn in a few styles,
    // one big with smaller ones scribbled around it. A rare find: most loads never get one.
    type CoolStyle = 'line' | 'tint' | 'hatch' | 'dots' | 'block'
    const coolS = (h: number, color: string, style: CoolStyle) => {
      // On a grid two wide and five tall, y up: three short verticals, a gap, three more; two diagonals
      // joining them; a V on top and a V underneath; and two stubs from the open ends to the diagonals.
      const lines: [number, number][][] = [
        [[0, 4], [0, 3]], [[1, 4], [1, 3]], [[2, 4], [2, 3]],
        [[0, 2], [0, 1]], [[1, 2], [1, 1]], [[2, 2], [2, 1]],
        [[0, 3], [1, 2]], [[1, 3], [2, 2]],
        [[0, 4], [1, 5], [2, 4]], [[0, 1], [1, 0], [2, 1]],
        [[0, 2], [0.5, 2.5]], [[2, 3], [1.5, 2.5]],
      ]
      // The outline of the whole letter, notched where the stubs meet the diagonals.
      const outline: [number, number][] = [
        [1, 5], [2, 4], [2, 3], [1.5, 2.5], [2, 2], [2, 1], [1, 0], [0, 1], [0, 2], [0.5, 2.5], [0, 3], [0, 4],
      ]
      const u = h / 5
      const point = ([x, y]: [number, number], dx = 0, dy = 0): [number, number] => [(x - 1) * u * 1.25 + dx, (2.5 - y) * u + dy]
      const lw = Math.max(1.6, h * 0.03)
      const drawLines = (dx = 0, dy = 0) => {
        for (const line of lines) stroke(line.map((q) => point(q, dx, dy)), color, lw, Math.max(0.8, h * 0.012))
      }
      const trace = (dx = 0, dy = 0) => {
        c.beginPath()
        outline.forEach((q, i) => {
          const [x, y] = point(q, dx, dy)
          if (i) c.lineTo(x, y)
          else c.moveTo(x, y)
        })
        c.closePath()
      }
      if (style === 'block') {
        // Extruded, like the gem in the doodle: the outline stamped down and to the left, dimmer behind.
        const was = fade
        fade = was * 0.32
        const depth = Math.max(4, Math.round(h * 0.14))
        for (let step = depth; step >= 1; step--) stroke([...outline, outline[0]].map((q) => point(q, -step * 0.8, step * 0.8)), color, 1.4, 0.5)
        fade = was
      }
      if (style !== 'line') {
        c.save()
        trace()
        if (style === 'tint' || style === 'block') {
          c.globalAlpha = 0.24 * fade
          c.fillStyle = color
          c.fill()
        } else {
          c.clip()
          if (style === 'hatch') {
            for (let x = -h; x < h; x += 4.2) stroke([[x, h * 0.7], [x + h * 0.9, -h * 0.7]], color, 1.2, 0.5)
          } else {
            for (let i = 0; i < h * 1.6; i++) dot((rnd() - 0.5) * h * 0.9, (rnd() - 0.5) * h * 1.05, 0.9 + rnd() * 0.5, color)
          }
        }
        c.restore()
      }
      drawLines()
    }
    if (rnd() < S_DOODLE_SHARE) {
      const styles: CoolStyle[] = ['line', 'tint', 'hatch', 'dots', 'block']
      const count = 3 + Math.floor(rnd() * 5)
      for (let i = 0; i < count; i++) {
        // The first is the big one; the rest are small, like the ones scribbled around it.
        let h = i === 0 ? 100 + rnd() * 40 : 34 + rnd() * 44
        let spot = spotFor(h * 0.6, h * 1.05, 16, 0.5)
        // The big one is hard to fit among the figures, so it tries again smaller rather than not at all.
        for (const shrink of i === 0 ? [0.8, 0.65, 0.5] : []) {
          if (spot) break
          h *= shrink
          spot = spotFor(h * 0.6, h * 1.05, 12, 0.5)
        }
        if (!spot) continue
        c.save()
        c.translate(spot.x + spot.w / 2, spot.y + spot.h / 2)
        c.rotate(jit(i === 0 ? 0.25 : 0.6))
        coolS(h, pick(PALETTE), i === 0 ? pick<CoolStyle>(['line', 'tint', 'hatch', 'block']) : pick(styles))
        c.restore()
      }
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
    this.bannerPlan = taped
    if (taped && !taped.flop && banner) {
      const t = taped
      /** A strip of clear sticky tape across a corner: pale, a little see-through, ends torn square-ish. */
      const tape = (cx: number, cy: number, angle: number, alpha = 0.74) => {
        const length = 38 + rnd() * 10
        const width = 13 + rnd() * 3
        g.save()
        g.translate(cx, cy)
        g.rotate(angle)
        g.fillStyle = `rgba(240, 230, 186, ${alpha})`
        g.strokeStyle = `rgba(130, 112, 70, ${alpha * 0.47})`
        g.lineWidth = 0.8
        g.beginPath()
        g.moveTo(-length / 2, -width / 2)
        for (let i = 0; i <= 4; i++) g.lineTo(-length / 2 + jit(2.4), -width / 2 + (width * i) / 4)
        g.lineTo(length / 2 + jit(2.4), width / 2)
        for (let i = 4; i >= 0; i--) g.lineTo(length / 2 + jit(2.4), -width / 2 + (width * i) / 4)
        g.closePath()
        g.fill()
        g.stroke()
        g.fillStyle = `rgba(255, 255, 255, ${alpha * 0.38})`
        g.fillRect(-length / 2 + 2, -width / 2 + 2, length - 4, 2)
        g.restore()
      }
      /** The paper edge and the picture, with the shadow it throws on the board, from (0, 0) at its top-left corner. */
      const paper = (left: number, top: number) => {
        g.shadowColor = 'rgba(0,0,0,0.5)'
        g.shadowBlur = 10
        g.shadowOffsetY = 3
        g.fillStyle = '#ece6d6'
        g.fillRect(left - 3, top - 3, t.w + 6, t.h + 6)
        g.shadowColor = 'transparent'
        g.shadowBlur = 0
        g.shadowOffsetY = 0
        g.drawImage(banner, left, top, t.w, t.h)
      }
      g.save()
      g.scale(scale, scale)
      {
        g.translate(t.x + t.w / 2, t.y + t.h / 2)
        g.rotate(t.tilt)
        paper(-t.w / 2, -t.h / 2)
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
          tape(sx * (t.w / 2 + 1), sy * (t.h / 2 + 1), -sx * sy * (Math.PI / 4) + jit(0.18))
        }
      }
      g.restore()
    }
    const map = new T.CanvasTexture(base)
    map.colorSpace = T.SRGBColorSpace
    map.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    return map
  }

  // ---- layout ------------------------------------------------------------

  /**
   * Turns a model forward about the front edge of the plank by the tip its body has made, as a book
   * does when it is pulled out far enough to overbalance. The whole model turns as one: its position
   * about the edge, and its own rotation to match.
   */
  private tip(model: T.Object3D, body: BookBody) {
    const pitch = body.pitch ?? 0
    model.rotation.x = pitch
    if (!pitch) return
    // The pivot runs along the plank's front edge, at the height of the body's lowest point.
    const edgeY = 380 - body.bounds.max.y
    const dy = model.position.y - edgeY
    const dz = model.position.z - PLANK_FRONT
    const cos = Math.cos(pitch)
    const sin = Math.sin(pitch)
    model.position.y = edgeY + dy * cos - dz * sin
    model.position.z = PLANK_FRONT + dy * sin + dz * cos
  }

  /** Takes a model out of the scene and frees what it used. */
  private disposeModel(model: T.Object3D) {
    model.removeFromParent()
    const textures = new Set<T.Texture>()
    model.traverse((n) => {
      if (n instanceof T.Light && 'shadow' in n) {
        (n as T.DirectionalLight).shadow.dispose()
      }
      const mesh = n as T.Mesh
      mesh.geometry?.dispose()
      const materials = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : []
      for (const m of materials) {
        for (const value of Object.values(m)) {
          if (value instanceof T.Texture) textures.add(value)
        }
        m.dispose()
      }
    })
    for (const texture of textures) texture.dispose()
  }

  private clear() {
    this.select(null)
    this.bannerAnim = null
    for (const r of this.rows) {
      r.physics.destroy()
      this.disposeModel(r.scene)
    }
    this.rows = []
    this.items = []
    this.props = []
    this.sticks = []
    this.duster = null
    this.wipeLast = null
    this.dust = []
    this.boardMaterial = null
    this.access?.remove()
    this.access = null
  }

  /** The spine and back-board colours for a cover, from its strongest colour family (see `coverPalette`), or null when it has none. */
  private tintsFor(url: string, img: HTMLImageElement): { bg: string; fg: string; accent: string } | null {
    if (this.tints.has(url)) return this.tints.get(url)!
    let result: { bg: string; fg: string; accent: string } | null = null
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 60
      canvas.height = 90
      const c = canvas.getContext('2d', { willReadFrequently: true })!
      c.drawImage(img, 0, 0, canvas.width, canvas.height)
      result = coverPalette(c.getImageData(0, 0, canvas.width, canvas.height).data)
    } catch {
      result = null
    }
    this.tints.set(url, result)
    return result
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
      deal = { style, width: style >= SLIM_FROM ? 26 + Math.round(Math.random() * 9) : b.width, tall: 0.86 + Math.random() * 0.22 }
      this.dealt.set(b.id, deal)
    }
    // The board is as wide as the cover is to its height, so the whole cover shows. A cover wider than MAX_BOARD allows shrinks the book rather than overhang the plank.
    const cover = b.coverUrl ? this.covers.get(b.coverUrl) : null
    // Each page load stands every book a little taller or shorter than the last.
    const tall = b.height * deal.tall
    let height = tall
    let depth = DEPTH
    if (cover && cover.width > 0 && cover.height > 0) {
      const aspect = cover.width / cover.height
      const most = this.overhang?.has(b.id) ? MAX_OVERHANG_BOARD : MAX_BOARD
      depth = height * aspect
      if (depth > most) {
        height = most / aspect
        depth = most
      }
      depth = Math.round(Math.max(MIN_BOARD, depth))
    }
    // A shortened book is thinned by the same share, so it stays the shape it was dealt rather than turning fat.
    const width = Math.max(18, Math.round(deal.width * (height / b.height)))
    const base = SPINE_STYLES[deal.style]
    const tint = cover && b.coverUrl ? this.tintsFor(b.coverUrl, cover) : null
    // The spine and back board carry the cover's strongest colour family.
    const look: SpineStyle = tint
      ? { ...base, ...tint, shadow: base.shadow ? { ...base.shadow, color: tint.accent } : undefined }
      : base
    return { ...b, width, height, depth, style: deal.style, look }
  }

  /**
   * Stands the plant somewhere in the empty quarter of the shelf, clear of the books, so it never
   * costs a book its place. Skipped if a narrow shelf leaves no room for it.
   */
  private placePlant(row: Row, width: number, booksEnd: number) {
    const plant = buildPottedPlant()
    const half = Math.max(plant.potWidth, plant.leafSpread) / 2
    const from = booksEnd + 16 + half
    const to = width - 20 - half
    if (to < from) {
      plant.dispose()
      return
    }
    const x = from + Math.random() * (to - from)
    // Anywhere along the plank's depth: the empty end has room for it to stand forward or back.
    const z = -60 + Math.random() * 70
    const saucerBody = row.physics.addSaucer(x, plant.saucerWidth, plant.saucerHeight, z)
    const saucerModel = new T.Group()
    plant.saucer.position.y -= plant.saucerHeight / 2
    saucerModel.add(plant.saucer)
    row.scene.add(saucerModel)
    const saucer: Prop = {
      body: saucerBody, model: saucerModel, row,
      centreAboveFloor: plant.saucerHeight / 2, lastVx: 0, leaves: [],
    }
    saucerModel.traverse((n) => (n.userData.prop = saucer))
    this.props.push(saucer)
    const { body, centreAboveFloor } = row.physics.addPlant(
      x, plant.potWidth, plant.potHeight, plant.leafSpread, plant.leafHeight, z, plant.saucerHeight,
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

  /** Fetches the chosen figure's GLB once, and parses a fresh copy per layout, since a layout disposes what it drew. */
  private async loadFigure(): Promise<T.Object3D | null> {
    const url = this.figureUrl
    if (!url) return null
    if (!this.figureData.has(url)) {
      this.figureData.set(url, fetch(url, { signal: this.abort.signal }).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null))
    }
    const data = await this.figureData.get(url)!
    if (!data) return null
    try {
      return (await new GLTFLoader().parseAsync(data.slice(0), '')).scene
    } catch {
      return null
    }
  }

  /**
   * Stands the figure on its round base in the free space past the books, like the plant. Returns
   * how far along the shelf it reaches, so the plant can go past it.
   */
  private placeFigure(row: Row, width: number, booksEnd: number, figure: T.Object3D): number {
    const half = FIGURE_BASE_RADIUS * this.figureScale
    const from = booksEnd + 14 + half
    const to = width - 16 - half
    if (to < from) {
      this.disposeModel(figure)
      return booksEnd
    }
    const x = from + Math.random() * (to - from)
    const baseHeight = 8 * this.figureScale
    const figureHeight = FIGURE_HEIGHT * this.figureScale
    const height = baseHeight + figureHeight
    const { body, centreAboveFloor } = row.physics.addFigure(x, half * 2, height, -50 + Math.random() * 60)
    const model = new T.Group()
    const inner = new T.Group()
    const base = new T.Mesh(
      new T.CylinderGeometry(half, half + 2, baseHeight, 40),
      new T.MeshStandardMaterial({ color: '#17151a', roughness: 0.3, metalness: 0.3 }),
    )
    base.position.y = baseHeight / 2
    const rim = new T.Mesh(
      new T.TorusGeometry(half + 0.5, 0.9, 8, 48),
      new T.MeshStandardMaterial({ color: '#e0c36a', roughness: 0.3, metalness: 0.8 }),
    )
    rim.rotation.x = Math.PI / 2
    rim.position.y = baseHeight
    const box = new T.Box3().setFromObject(figure)
    const size = box.getSize(new T.Vector3())
    const centre = box.getCenter(new T.Vector3())
    const scale = figureHeight / size.y
    figure.scale.setScalar(scale)
    figure.position.set(-centre.x * scale, baseHeight - box.min.y * scale, -centre.z * scale)
    figure.traverse((n) => {
      const mesh = n as T.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
        ;(mesh.material as T.Material).side = T.DoubleSide
      }
    })
    base.castShadow = true
    base.receiveShadow = true
    inner.add(base, rim, figure)
    // The model's origin is its base; the body's is its centre of mass.
    inner.position.y = -centreAboveFloor
    model.add(inner)
    row.scene.add(model)
    const prop: Prop = { body, model, row, centreAboveFloor, lastVx: 0, leaves: [] }
    model.traverse((n) => (n.userData.prop = prop))
    this.props.push(prop)
    this.figureProp = prop
    return x + half
  }

  /**
   * Drops a few sticks of chalk into the empty part of the shelf, clear of the books and of each
   * other. They start a little above the plank at a random tilt, so they land with a clatter, and
   * from then on they are ordinary bodies: books shove them, they can be picked up, and one pushed
   * to either end goes over the edge. Skipped if a crowded shelf leaves no room.
   */
  private placeChalk(row: Row, width: number) {
    const booksEnd = this.items.reduce((end, i) => Math.max(end, i.body.bounds.max.x), 0)
    const colours = ['#f3efe2', '#f7a8bf', '#9ed3f5', '#f6e08a', '#a8e6b8']
    const taken: number[] = []
    for (let i = 0; i < this.chalkCount; i++) {
      const length = 54 + Math.random() * 26
      const thickness = 8 + Math.random() * 2.5
      const from = booksEnd + 24 + length / 2
      const to = width - 12 - length / 2
      if (to < from) break
      let x = from + Math.random() * (to - from)
      for (let tries = 0; tries < 12 && taken.some((t) => Math.abs(t - x) < length * 0.9); tries++) {
        x = from + Math.random() * (to - from)
      }
      if (taken.some((t) => Math.abs(t - x) < length * 0.9)) continue
      taken.push(x)
      // Thrown in from above the top of the view, spinning, one after another, so it lands rather than appearing.
      this.makeStick(
        row, x, -230 - i * 110 - Math.random() * 60, length, thickness, Math.random() * Math.PI, -110 + Math.random() * 120,
        colours[Math.floor(Math.random() * colours.length)],
        { vx: (Math.random() - 0.5) * 3, vy: 7 + Math.random() * 3, spin: (Math.random() - 0.5) * 0.3 },
      )
    }
    // Where there is chalk there is a duster to rub it out, thrown in last.
    const roomFrom = booksEnd + 24 + DUSTER_W / 2
    const roomTo = width - 12 - DUSTER_W / 2
    if (this.sticks.length > 0 && !this.duster && roomTo >= roomFrom) {
      this.makeDuster(
        row, roomFrom + Math.random() * (roomTo - roomFrom), -230 - this.chalkCount * 110 - 80, -110 + Math.random() * 120,
        { vx: (Math.random() - 0.5) * 2.5, vy: 6 + Math.random() * 3, spin: (Math.random() - 0.5) * 0.2 },
      )
    }
  }

  /** The duster: a wooden block over a felt pad, the pad on the underside of the body. */
  private makeDuster(row: Row, x: number, y: number, z: number, thrown?: { vx: number; vy: number; spin: number }) {
    const body = row.physics.addDuster(x, y, DUSTER_W, DUSTER_H, Math.random() * 0.4 - 0.2, z, thrown)
    const model = new T.Group()
    const wood = new T.Mesh(new T.BoxGeometry(DUSTER_W, 12, DUSTER_DEPTH), new T.MeshStandardMaterial({ color: '#b4824f', roughness: 0.8 }))
    wood.position.y = 4
    const felt = new T.Mesh(new T.BoxGeometry(DUSTER_W - 2, 6, DUSTER_DEPTH - 2), new T.MeshStandardMaterial({ color: '#2d2c34', roughness: 1 }))
    felt.position.y = -5
    // A band of lighter wood along the top, so it reads as a block with a grip.
    const grip = new T.Mesh(new T.BoxGeometry(DUSTER_W * 0.62, 2, DUSTER_DEPTH * 0.55), new T.MeshStandardMaterial({ color: '#8d6238', roughness: 0.85 }))
    grip.position.y = 11
    for (const part of [wood, felt, grip]) {
      part.castShadow = true
      part.receiveShadow = true
      model.add(part)
    }
    row.scene.add(model)
    const duster: Duster = { body, model, row, lean: 0, penDown: false, air: 0, tilt: [0, 0, 0], tiltV: [0, 0, 0] }
    model.traverse((n) => (n.userData.prop = duster))
    this.duster = duster
    return duster
  }

  /**
   * The duster lies where its body is until it is lifted off the plank. In hand it turns its pad to the
   * wall, flat against the board, where the pointer is; put down, it eases back to lying flat. As with
   * chalk, only the picture moves, so it can always be put back where it was.
   */
  private poseDuster(d: Duster): boolean {
    const body = d.body
    const held = this.heldProp === d && this.drag !== null
    const lifted = held ? Math.max(0, Math.min(1, (d.row.physics.floor - 6 - body.bounds.max.y) / GRIP_LIFT)) : 0
    const lift = held && (d.penDown || this.penKey) ? 1 : lifted
    if (held) d.row.physics.level(body)
    d.row.physics.setGrip(body, held && d.lean > 0.4, -128, 40)
    d.lean += (lift - d.lean) * 0.2
    if (Math.abs(lift - d.lean) < 0.002) d.lean = lift
    const lean = d.lean
    const airTarget = held && !(d.penDown || this.penKey) ? PEN_LIFT : 0
    d.air += (airTarget - d.air) * 0.25
    if (Math.abs(airTarget - d.air) < 0.3) d.air = airTarget
    // Its pad, not its middle, is at the wall.
    const wall = body.z + (WRITE_Z + DUSTER_DEPTH / 4 + d.air - body.z) * lean
    d.row.camera.updateMatrixWorld()
    const eye = d.row.camera.position
    const at = new T.Vector3(body.position.x - this.logicalWidth / 2, 380 - body.position.y, body.z)
    const here = at.clone().sub(eye).multiplyScalar((wall - eye.z) / (body.z - eye.z)).add(eye)
    // How fast the hand is moving it, in pixels a millisecond across the board (up positive).
    const now = performance.now()
    let vx = 0
    let vy = 0
    if (d.seen && now > d.seen.at) {
      const dt = Math.min(64, now - d.seen.at)
      vx = (body.position.x - d.seen.x) / dt
      vy = -(body.position.y - d.seen.y) / dt
    }
    d.seen = { x: body.position.x, y: body.position.y, at: now }
    // Moved about, it rocks: rolls into the way it is going, and its leading edge leans and lifts. A spring
    // takes it there and back, so it overshoots a little and settles. At rest or lying down it is level.
    const dt = Math.min(48, Math.max(1, now - (d.tiltAt ?? now)))
    d.tiltAt = now
    const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v))
    const target = held && lean > 0.5
      ? [clamp(-vy * 0.45, 0.35), clamp(vx * 0.55, 0.45), clamp(vx * 0.7, 0.5)]
      : [0, 0, 0]
    let rocking = false
    for (let i = 0; i < 3; i++) {
      d.tiltV[i] += (-(d.tilt[i] - target[i]) * 0.0011 - d.tiltV[i] * 0.045) * dt
      d.tilt[i] += d.tiltV[i] * dt
      if (Math.abs(d.tilt[i]) > 0.002 || Math.abs(d.tiltV[i]) > 0.00005 || Math.abs(target[i]) > 0.002) rocking = true
    }
    const base = new T.Quaternion().setFromEuler(
      new T.Euler((Math.PI / 2) * lean, 0, -Math.atan2(Math.sin(body.angle), Math.cos(body.angle)) * (1 - lean)),
    )
    // Applied about the board's own axes: across, up and out of the wall.
    const rock = new T.Quaternion().setFromEuler(new T.Euler(d.tilt[0] * lean, d.tilt[1] * lean, d.tilt[2] * lean))
    d.model.quaternion.copy(rock.multiply(base))
    d.model.position.copy(here)
    return lean !== lift || d.air !== airTarget || rocking
  }

  /**
   * A duster held to the board wipes it: the ink a stick left comes off, and the board's own chalk is
   * smeared over with slate, a little more with each pass. Reloading the page puts the board back.
   */
  private wipeBoard(): boolean {
    const d = this.duster
    const ink = this.ink
    const wipe = this.wipe
    if (!d || this.heldProp !== d || !this.drag || !ink || !wipe || !this.board) {
      this.wipeLast = null
      return false
    }
    if (d.lean < 0.85 || d.air > 2) {
      this.wipeLast = null
      return false
    }
    d.row.camera.updateMatrixWorld()
    const tip = new T.Vector3(d.body.position.x - this.logicalWidth / 2, 380 - d.body.position.y, d.body.z)
    const screen = tip.project(d.row.camera)
    this.ray.setFromCamera(new T.Vector2(screen.x, screen.y), d.row.camera)
    const at = this.ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 0, 1), 147), new T.Vector3())
    if (!at) return false
    const x = at.x + this.wallSize.w / 2
    const y = 17 + this.wallSize.h - at.y
    if (x < -DUSTER_W || y < -DUSTER_H || x > ink.width + DUSTER_W || y > ink.height + DUSTER_H) {
      this.wipeLast = null
      return false
    }
    const from = this.wipeLast
    const moved = from ? Math.hypot(x - from.x, y - from.y) : 0
    if (from && moved < 1.5) return true
    const inkCtx = ink.getContext('2d')!
    const wipeCtx = wipe.getContext('2d')!
    // A rectangle the size of the pad, pressed along the way it travelled.
    const steps = Math.max(1, Math.ceil(moved / 8))
    for (let i = 1; i <= steps; i++) {
      const px = from ? from.x + ((x - from.x) * i) / steps : x
      const py = from ? from.y + ((y - from.y) * i) / steps : y
      inkCtx.save()
      inkCtx.globalCompositeOperation = 'destination-out'
      inkCtx.globalAlpha = 0.75
      inkCtx.fillRect(px - DUSTER_W / 2, py - DUSTER_DEPTH / 2, DUSTER_W, DUSTER_DEPTH)
      inkCtx.restore()
      wipeCtx.save()
      wipeCtx.fillStyle = 'rgba(39, 51, 44, 0.3)'
      wipeCtx.fillRect(px - DUSTER_W / 2, py - DUSTER_DEPTH / 2, DUSTER_W, DUSTER_DEPTH)
      wipeCtx.restore()
    }
    this.wipeLast = { x, y }
    if (this.inkTexture) this.inkTexture.needsUpdate = true
    if (this.wipeTexture) this.wipeTexture.needsUpdate = true
    // A puff of chalk dust comes off now and then and settles on the plank.
    const now = performance.now()
    if (now - this.wipePuffAt > 90) {
      this.wipePuffAt = now
      this.emitDust(d.row, at.x, at.y - 8, -138, '#f3efe2', { grains: 3, haze: 0, width: DUSTER_W * 0.9, burst: 0.06 })
    }
    return true
  }

  /** A stick of chalk: a rounded rectangle in the physics, a cylinder in the scene. */
  private makeStick(
    row: Row, x: number, y: number, length: number, thickness: number, angle: number, z: number, color: string,
    thrown?: { vx: number; vy: number; spin: number },
  ): Stick {
    const body = row.physics.addChalk(x, y, length, thickness, angle, z, thrown)
    const geometry = new T.CylinderGeometry(thickness / 2, thickness / 2, length, 14)
    geometry.rotateZ(Math.PI / 2)
    const model = new T.Mesh(geometry, new T.MeshStandardMaterial({ color, roughness: 1 }))
    model.castShadow = true
    model.receiveShadow = true
    row.scene.add(model)
    const stick: Stick = { body, model, row, color, lean: 0, penDown: false, air: 0, used: 0 }
    model.userData.prop = stick
    this.sticks.push(stick)
    return stick
  }

  /**
   * Squashed by something heavy. A long stick breaks where it was pressed: that stretch is ground to
   * dust, the pieces either side stay as shorter sticks, and a few chips fly off. A short one is
   * ground to dust and crumbs.
   */
  private crushToDust(stick: Stick) {
    const { body, row, color } = stick
    const length = body.bookWidth
    const thickness = body.bookHeight
    const { x, y } = body.position
    const angle = body.angle
    const z = body.z
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    // Where along the stick the weight came down, measured from its middle.
    const at = Math.max(-length / 2, Math.min(length / 2, ((body.crushX ?? x) - x) * dx))
    if (this.heldProp === stick) this.release()
    row.physics.remove(body)
    this.sticks.splice(this.sticks.indexOf(stick), 1)
    this.disposeModel(stick.model)
    this.inkAt = null

    const whole = length < 26
    const ground = whole ? length : Math.max(12, Math.min(28, length * 0.35))
    const from = at - ground / 2
    const to = at + ground / 2
    if (!whole) {
      for (const [start, end, push] of [[-length / 2, from, -1], [to, length / 2, 1]] as const) {
        const piece = end - start
        if (piece < 9) continue
        const mid = (start + end) / 2
        this.makeStick(row, x + dx * mid, y + dy * mid, piece, thickness, angle, z, color,
          { vx: push * dx * 0.7, vy: push * dy * 0.7 - 1.2, spin: push * (0.03 + Math.random() * 0.05) })
      }
    }
    // Chips of every size break off where it gave way.
    // A bit too small to break further just turns to dust, so squashing chips always ends. A shelf already
    // strewn with chalk gets no more chips either.
    const chips = this.sticks.length > 40 || length < SMALL_BIT ? 0 : whole ? 2 : 4 + Math.floor(Math.random() * 3)
    for (let i = 0; i < chips; i++) {
      const spot = whole ? 0 : at
      this.makeStick(row, x + dx * spot + (Math.random() - 0.5) * 10, y + dy * spot - 4, 4 + Math.random() * 6, 3.5, Math.random() * Math.PI, z, color,
        { vx: (Math.random() - 0.5) * 3.5, vy: -2.5 - Math.random() * 2.5, spin: (Math.random() - 0.5) * 0.4 })
    }

    const amount = whole ? Math.max(0.3, Math.min(1, length / 26)) : Math.max(0.7, Math.min(1.6, ground / 22))
    const sx = x - this.logicalWidth / 2
    const sy = 380 - y
    const mid = whole ? 0 : at
    this.emitDust(row, sx + dx * mid, sy - dy * mid + 3, z, color, {
      grains: Math.round(24 * amount), haze: amount > 1 ? 2 : 1, width: whole ? length : ground, burst: 0.26,
    })
    this.shudder(row, 0.6)
    this.wake()
  }

  /** A grain of chalk: a soft speck with its edge broken up, white so the material's colour tints it. */
  private makeDustTexture(): T.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    const c = canvas.getContext('2d')!
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 15)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.75)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 32, 32)
    // Nibble the edge away so no two grains look like a perfect dot.
    c.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < 26; i++) {
      c.globalAlpha = 0.4 + Math.random() * 0.6
      c.fillRect(Math.random() * 32, Math.random() * 32, 1 + Math.random() * 3, 1 + Math.random() * 3)
    }
    return new T.CanvasTexture(canvas)
  }

  /** The haze a burst of dust hangs in: very soft and mottled, so it reads as a cloud and not a ball. */
  private makeHazeTexture(): T.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const c = canvas.getContext('2d')!
    for (let i = 0; i < 7; i++) {
      const x = 16 + Math.random() * 32
      const y = 16 + Math.random() * 32
      const r = 10 + Math.random() * 14
      const g = c.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, 'rgba(255,255,255,0.55)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      c.fillStyle = g
      c.fillRect(0, 0, 64, 64)
    }
    return new T.CanvasTexture(canvas)
  }

  /**
   * Lets go a burst of chalk dust at a point: a cloud of fine grains that fly out and are slowed by the
   * air, drift on small eddies and then sink onto the plank, and a faint haze that spreads and fades.
   * `burst` is how fast the grains leave, in units a millisecond.
   */
  private emitDust(
    row: Row, x: number, y: number, z: number, color: string,
    o: { grains: number; haze: number; width: number; burst: number },
  ) {
    this.dustTexture ??= this.makeDustTexture()
    this.hazeTexture ??= this.makeHazeTexture()
    const now = performance.now()
    const base = new T.Color(color)
    for (let i = 0; i < o.grains + o.haze; i++) {
      const haze = i >= o.grains
      const tint = base.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.12)
      const sprite = new T.Sprite(new T.SpriteMaterial({
        map: haze ? this.hazeTexture : this.dustTexture, color: tint, transparent: true,
        opacity: haze ? 0.1 : 0.9, depthWrite: false, rotation: Math.random() * Math.PI * 2,
      }))
      const size = haze ? 12 + Math.random() * 10 : 1.5 + Math.random() * 2.2
      sprite.scale.set(size, size, 1)
      sprite.position.set(x + (Math.random() - 0.5) * o.width, y + (Math.random() - 0.5) * 6, z + (Math.random() - 0.5) * 10)
      row.scene.add(sprite)
      const angle = Math.random() * Math.PI * 2
      const speed = o.burst * (haze ? 0.35 : 0.3 + Math.random() * 0.9)
      this.dust.push({
        sprite, vx: Math.cos(angle) * speed, vy: Math.abs(Math.sin(angle)) * speed * (haze ? 0.5 : 1.1) + 0.02,
        vz: (Math.random() - 0.3) * speed * 0.5, at: now, last: now, size, haze, phase: Math.random() * 6.3,
        spin: (Math.random() - 0.5) * 0.004, settled: false, row, host: null, lx: 0, ly: 0, slip: 0.5 + Math.random() * 1.8,
      })
    }
    this.wake()
  }

  /**
   * Moves the dust: grains fly, slow in the air, wander on small eddies and sink, and the ones that reach
   * the plank lie there as flecks that stay; the haze spreads and fades. True while anything is still in
   * the air, so the frame loop can rest once it has all settled.
   */
  private driftDust(now: number): boolean {
    if (this.dust.length === 0) return false
    let airborne = false
    for (const d of this.dust) {
      if (d.settled && d.host && d.sprite.parent) {
        // Dust on something that moves goes with it, and is gone when that is.
        if (!d.row.physics.has(d.host)) {
          d.sprite.removeFromParent()
          d.sprite.material.dispose()
          d.size = 0
        } else if (d.host.speed > d.slip || Math.abs(Math.cos(d.host.angle)) < 0.55) {
          // Knocked about, or tipped too far to lie on: it shakes loose, thrown the way the thing is going, and falls.
          const step = 1000 / 120
          const h = d.host
          d.host = null
          d.settled = false
          d.sprite.scale.set(d.size, d.size, 1)
          d.sprite.material.opacity = 0.9
          d.vx = Math.max(-0.6, Math.min(0.6, h.velocity.x / step)) + (Math.random() - 0.5) * 0.04
          d.vy = Math.max(-0.6, Math.min(0.6, -h.velocity.y / step)) + 0.04 + Math.random() * 0.08
          d.vz = (Math.random() - 0.5) * 0.04
          d.at = now
          d.last = now
        } else if (!d.host.isSleeping) {
          const c = Math.cos(d.host.angle)
          const sn = Math.sin(d.host.angle)
          d.sprite.position.x = d.host.position.x + d.lx * c - d.ly * sn - this.logicalWidth / 2
          d.sprite.position.y = 380 - (d.host.position.y + d.lx * sn + d.ly * c) + d.size * 0.12
        }
        continue
      }
      if (d.settled || !d.sprite.parent) continue
      const dt = Math.min(48, now - d.last)
      d.last = now
      const t = (now - d.at) / HAZE_MS
      const pos = d.sprite.position
      const calm = Math.exp(-dt * DUST_DRAG * (d.haze ? 1.6 : 1) * (d.row.detached ? 0.2 : 1))
      d.vx *= calm
      d.vy *= calm
      d.vz *= calm
      // Small eddies push it about, the grains sink, the haze drifts up.
      d.vx += Math.sin(now * 0.0031 + d.phase) * 0.00002 * dt
      d.vz += Math.cos(now * 0.0027 + d.phase) * 0.000015 * dt
      d.vy += (d.haze ? 0.00001 : -DUST_FALL) * dt
      // With the plank gone there is nothing to settle on: it drops like anything else.
      if (d.row.detached) d.vy -= 0.0007 * dt
      const was = pos.y
      pos.x += d.vx * dt
      pos.y += d.vy * dt
      pos.z += d.vz * dt
      d.sprite.material.rotation += d.spin * dt
      if (d.haze) {
        const u = Math.min(1, t)
        const s = d.size * (1 + u * 1.8)
        d.sprite.scale.set(s, s, 1)
        d.sprite.material.opacity = 0.1 * (1 - u) ** 1.4
        if (u >= 1) {
          d.sprite.removeFromParent()
          d.sprite.material.dispose()
          d.settled = true
          d.size = 0
        } else {
          airborne = true
        }
        continue
      }
      // Whatever it was above a moment ago and has now reached: the plank, a book, the figure, the chalk.
      const x = pos.x + this.logicalWidth / 2
      const under = d.vy <= 0 ? d.row.physics.surfaceBelow(x, 380 - was, pos.z) : null
      if (under && pos.y <= 380 - under.y + d.size * 0.15) {
        // Down on it: a small fleck that stays, and travels with it if it moves.
        pos.y = 380 - under.y + d.size * 0.12
        d.sprite.scale.set(d.size * 1.1, d.size * 0.4, 1)
        d.sprite.material.rotation = 0
        d.sprite.material.opacity = 0.55
        d.settled = true
        if (under.body) {
          const dx = x - under.body.position.x
          const dy = 380 - pos.y - under.body.position.y
          const c = Math.cos(-under.body.angle)
          const sn = Math.sin(-under.body.angle)
          d.host = under.body
          d.lx = dx * c - dy * sn
          d.ly = dx * sn + dy * c
        }
      } else if (now - d.at > 6000 || pos.y < -300) {
        // Never came down (it drifted clear of the plank): let it go.
        d.sprite.removeFromParent()
        d.sprite.material.dispose()
        d.settled = true
        d.size = 0
      } else {
        airborne = true
      }
    }
    // Forget the ones that went, and the oldest of the settled once there is too much.
    this.dust = this.dust.filter((d) => d.size > 0 && d.sprite.parent)
    const settled = this.dust.filter((d) => d.settled)
    for (const d of settled.slice(0, Math.max(0, settled.length - MAX_SETTLED_DUST))) {
      d.sprite.removeFromParent()
      d.sprite.material.dispose()
      d.size = 0
    }
    this.dust = this.dust.filter((d) => d.size > 0)
    return airborne
  }

  /**
   * A stick worn through by drawing: it is let go, snaps in two and the halves spring apart with a few
   * crumbs, as if it had been pressed too hard. The shelf gives a small jolt.
   */
  private snap(stick: Stick) {
    const { body, row, color } = stick
    const length = body.bookWidth
    const thickness = body.bookHeight
    const { x, y } = body.position
    const angle = body.angle
    const z = body.z
    this.release()
    row.physics.remove(body)
    this.sticks.splice(this.sticks.indexOf(stick), 1)
    this.disposeModel(stick.model)
    this.inkAt = null
    // Never split the stub of a stick that was already broken small: just let it go.
    if (length < 26) return
    const split = 0.35 + Math.random() * 0.3
    const first = length * split
    const second = length - first
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    this.makeStick(row, x + dx * (first / 2 - length / 2), y + dy * (first / 2 - length / 2), first, thickness, angle, z, color,
      { vx: -dx * 2.2, vy: -dy * 2.2 - 2.5, spin: -0.12 - Math.random() * 0.1 })
    this.makeStick(row, x + dx * (length / 2 - second / 2), y + dy * (length / 2 - second / 2), second, thickness, angle, z, color,
      { vx: dx * 2.2, vy: dy * 2.2 - 2.5, spin: 0.12 + Math.random() * 0.1 })
    // The broken ends are crumbs of chalk too.
    for (let i = 0; i < 2; i++) {
      this.makeStick(row, x + (Math.random() - 0.5) * 8, y - 4, 5 + Math.random() * 3, 3.5, Math.random() * Math.PI, z, color,
        { vx: (Math.random() - 0.5) * 4, vy: -3 - Math.random() * 2.5, spin: (Math.random() - 0.5) * 0.4 })
    }
    this.shudder(row, 1.2)
    this.wake()
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
    light.shadow.mapSize.set(2048, 2048)
    // Wide enough to take in the far corners of the wall however wide the shelf is, or the shadows stop short of them.
    const reach = Math.max(width, 900) * 0.9 + this.rowH
    Object.assign(light.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: reach * 2.4 })
    light.shadow.bias = -0.0004
    light.shadow.normalBias = 0.6
    scene.add(light)
    const shelf = new T.Mesh(new T.BoxGeometry(width + 12, 15, 160), new T.MeshStandardMaterial({ color: this.theme.shelf, roughness: 0.94 }))
    shelf.position.set(0, 12, -67)
    shelf.receiveShadow = true
    scene.add(shelf)
    const wallHeight = this.rowH - 20
    const wallMaterial = new T.MeshStandardMaterial({ color: this.theme.wall, roughness: 1 })
    this.wallSize = { w: width + 12, h: wallHeight }
    this.boardMaterial = new T.MeshStandardMaterial({
      map: this.board ? this.wallTexture(width + 12, wallHeight, this.board) : null,
      color: this.board ? '#ffffff' : this.theme.wall, roughness: 0.95,
    })
    const faces = [wallMaterial, wallMaterial, wallMaterial, wallMaterial, this.boardMaterial, wallMaterial]
    const wall = new T.Mesh(new T.BoxGeometry(width + 12, wallHeight, 8), faces)
    wall.name = 'shelf-wall'
    wall.position.set(0, 17 + wallHeight / 2, -151)
    wall.receiveShadow = true
    scene.add(wall)
    this.addFrame(scene, width + 12, wallHeight)
    this.addInk(scene, width + 12, wallHeight)
    const row: Row = { scene, camera, physics: new ShelfPhysics(width), index: this.rows.length, shelf }
    row.physics.addFrame(wallHeight)
    // A heavy landing sets the plank, and everything on it, shuddering; the wall stays put.
    row.physics.onImpact = (strength) => {
      if (strength < IMPACT_MIN || this.reduced.matches) return
      const amplitude = Math.min(SHAKE_MAX, (strength - IMPACT_MIN) / 120)
      const now = performance.now()
      const left = row.shake ? row.shake.amplitude * Math.exp(-(now - row.shake.at) / 110) : 0
      if (amplitude > left) this.shudder(row, amplitude)
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
    await Promise.all([
      this.loadCovers(this.books),
      this.prank ? loadPrankFont().then((ready) => { this.prankFontReady = ready }) : Promise.resolve(),
    ])
    if (generation !== this.generation || this.abort.signal.aborted) return
    if (this.rows.length) {
      this.refreshBooks()
      if (this.renderedFigureUrl !== this.figureUrl) {
        const figure = this.figureRoll < this.figureChance ? await this.loadFigure() : null
        if (generation !== this.generation || this.abort.signal.aborted) {
          if (figure) this.disposeModel(figure)
          return
        }
        if (this.figureProp) {
          if (this.heldProp === this.figureProp) this.release()
          this.figureProp.row.physics.remove(this.figureProp.body)
          this.disposeModel(this.figureProp.model)
          this.props = this.props.filter((prop) => prop !== this.figureProp)
          this.figureProp = null
        }
        this.renderedFigureUrl = this.figureUrl
        if (figure) {
          const end = this.items.reduce((x, item) => Math.max(x, item.body.bounds.max.x), 0)
          this.placeFigure(this.rows[0], this.logicalWidth, end, figure)
        }
      }
      this.wake()
      return
    }
    const figure = this.figureRoll < this.figureChance ? await this.loadFigure() : null
    if (generation !== this.generation || this.abort.signal.aborted) {
      if (figure) this.disposeModel(figure)
      return
    }
    this.clear()
    this.rowH = ROW + BOARD_ROOM
    this.renderedFigureUrl = this.figureUrl
    const width = this.logicalWidth
    const row = this.newRow(width)
    if (this.overhang === null) {
      // Deal every book first, then pick up to three of the ones a wide cover would push past the edge.
      for (const b of this.books) this.styled(b)
      const wide = this.books.filter((b) => {
        const cover = b.coverUrl ? this.covers.get(b.coverUrl) : null
        return !!cover && cover.height > 0 && b.height * this.dealt.get(b.id)!.tall * (cover.width / cover.height) > MAX_BOARD
      })
      wide.sort(() => Math.random() - 0.5)
      this.overhang = new Set(wide.slice(0, Math.floor(Math.random() * (MAX_OVERHANGERS + 1))).map((b) => b.id))
    }
    const plan = planShelf(this.books.map((b) => this.styled(b)), width, this.emptyShare)
    // The plant goes up first, in the clear space beyond where the books are planned to stand, so it is
    // there as the books arrive and none of them can come to stand in front of it.
    if (this.withPlant && plan.length > 0) {
      const booksEnd = plan.reduce(
        (end, p) => Math.max(end, p.x + (Math.abs(Math.cos(p.angle)) * p.book.width + Math.abs(Math.sin(p.angle)) * p.book.height) / 2),
        0,
      )
      const figureEnd = figure ? this.placeFigure(row, width, booksEnd, figure) : booksEnd
      this.placePlant(row, width, figureEnd)
    } else if (figure && plan.length > 0) {
      const booksEnd = plan.reduce(
        (end, p) => Math.max(end, p.x + (Math.abs(Math.cos(p.angle)) * p.book.width + Math.abs(Math.sin(p.angle)) * p.book.height) / 2),
        0,
      )
      this.placeFigure(row, width, booksEnd, figure)
    } else if (figure) {
      this.disposeModel(figure)
    }
    for (const p of plan) {
      const body = row.physics.add(p.x, p.y, p.book.width, p.book.height, p.angle, p.book.depth)
      // Now and then a book sits a little forward or back of the rest, never by much.
      if (Math.random() < SLIGHT_DEPTH_SHARE) {
        row.physics.setDepth(body, -p.book.depth / 2 + (Math.random() < 0.6 ? -1 : 1) * (5 + Math.random() * 11), p.book.depth)
      }
      const { group: model, hinges } = this.model(p.book)
      row.scene.add(model)
      const item: Item = { body, model, row, book: p.book, hinges }
      model.traverse((n) => (n.userData.item = item))
      this.items.push(item)
      this.spawnedBooks.add(item.book.id)
    }
    for (const book of this.books) this.spawnedBooks.add(book.id)
    this.syncBannerObject()
    // The chalk is thrown in once the books have had a moment on screen, and only once there are books to
    // put it beside: against an empty shelf it would land where the books are about to go.
    const extras = () => {
      if (!this.rows.includes(row) || this.abort.signal.aborted) return
      this.placeChalk(row, width)
      this.wake()
    }
    if (this.items.length > 0) {
      if (this.extrasSeen) extras()
      else {
        this.extrasSeen = true
        setTimeout(extras, EXTRAS_DELAY)
      }
    }

    this.sizeCanvas()

    this.access = document.createElement('div')
    this.access.className = 'shelf3d-access'
    for (const item of this.items) this.addBookButton(item)
    this.container.append(this.access)
    this.wake()
  }

  private sizeCanvas() {
    const rowPx = this.rowH * this.scale
    this.renderer.setSize(this.cssWidth, this.rows.length * rowPx, false)
    const canvas = this.renderer.domElement
    canvas.style.width = `${this.cssWidth}px`
    canvas.style.height = `${this.rows.length * rowPx}px`
    // The placeholder height only held the space while this loaded; now the canvas says how tall it is, and nothing more is kept under it.
    this.container.style.minHeight = `${this.rows.length * rowPx}px`

  }

  private addBookButton(item: Item) {
      const button = document.createElement('button')
      item.button = button
      button.type = 'button'
      button.textContent = this.label(item.book)
      button.addEventListener('focus', () => this.select(item))
      button.addEventListener('blur', () => this.select(null))
      button.addEventListener('click', () => this.pull(item))
      // Up and down push the focused book back and forward, as the wheel does for a held one.
      button.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault()
        item.row.physics.nudgeDepth(item.body, e.key === 'ArrowDown' ? DEPTH_STEP : -DEPTH_STEP)
        this.wake()
      })
      this.access?.append(button)
  }

  private refreshBooks() {
    const incoming = new Map(this.books.map((book) => [book.id, book]))
    for (const item of [...this.items]) {
      const book = incoming.get(item.book.id)
      if (!book) {
        if (this.selected === item) this.release()
        item.row.physics.remove(item.body)
        this.disposeModel(item.model)
        item.button?.remove()
        this.items = this.items.filter((other) => other !== item)
        continue
      }
      if (book.title === item.book.title && book.author === item.book.author
        && book.number === item.book.number && book.coverUrl === item.book.coverUrl) continue
      const updated = { ...item.book, title: book.title, author: book.author, number: book.number, coverUrl: book.coverUrl }
      if (book.coverUrl !== item.book.coverUrl) updated.look = this.styled(book).look
      const { group, hinges } = this.model(updated)
      group.position.copy(item.model.position)
      group.quaternion.copy(item.model.quaternion)
      this.disposeModel(item.model)
      item.model = group
      item.hinges = hinges
      item.book = updated
      group.traverse((node) => (node.userData.item = item))
      item.row.scene.add(group)
      if (item.button) item.button.textContent = this.label(updated)
    }
    for (const id of this.spawnedBooks) if (!incoming.has(id)) this.spawnedBooks.delete(id)
    const additions = this.books.filter((book) => !this.spawnedBooks.has(book.id))
    if (!additions.length) return
    const row = this.rows[0]
    // A newcomer is dropped in from above the shelf, over a gap where it will fit, and left to land. Placing
    // it where a fresh shelf would have put it set it down inside books that had already settled.
    const taken: Array<[number, number]> = [
      ...this.items.map((item) => [item.body.bounds.min.x, item.body.bounds.max.x] as [number, number]),
      ...this.props.map((prop) => [prop.body.bounds.min.x, prop.body.bounds.max.x] as [number, number]),
    ]
    const limit = this.logicalWidth - 18
    const fall = 360 - ROW
    let stagger = 0
    for (const book of additions.map((added) => this.styled(added))) {
      const merged = taken.sort((p, q) => p[0] - q[0]).reduce<Array<[number, number]>>((out, range) => {
        const last = out[out.length - 1]
        if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
        else out.push([range[0], range[1]])
        return out
      }, [])
      let from = 18
      let best: [number, number] | null = null
      for (const [lo, hi] of [...merged, [limit, limit] as [number, number]]) {
        if (lo - from >= book.width + 6 && (!best || lo - from > best[1] - best[0])) best = [from, lo]
        from = Math.max(from, hi)
      }
      const x = best
        ? best[0] + 3 + Math.random() * (best[1] - best[0] - book.width - 6)
        : 18 + Math.random() * Math.max(0, limit - 18 - book.width)
      taken.push([x, x + book.width])
      const y = fall - book.height - stagger
      stagger += book.height * 0.8 + 30
      const angle = (Math.random() - 0.5) * 0.2
      const body = row.physics.add(x, y, book.width, book.height, angle, book.depth)
      const { group: model, hinges } = this.model(book)
      const item: Item = { body, model, row, book, hinges }
      model.traverse((node) => (node.userData.item = item))
      row.scene.add(model)
      this.items.push(item)
      this.spawnedBooks.add(book.id)
      this.addBookButton(item)
    }
    for (const book of additions) this.spawnedBooks.add(book.id)
    this.wake()
    if (this.items.length && !this.extrasSeen) {
      this.extrasSeen = true
      this.placeChalk(row, this.logicalWidth)
    }
  }

  // ---- interaction and the frame loop -----------------------------------

  /**
   * A pointer position as a point in a row's physics world (the spine plane, y down from the top),
   * found on the plane `z` units towards the viewer: a thing pulled forward is nearer the camera, so
   * the same screen point is a different place in its world.
   */
  private worldPoint(e: PointerEvent, row: Row, z = 0) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const rowPx = this.rowH * this.scale
    row.camera.updateMatrixWorld()
    this.ray.setFromCamera(
      new T.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((e.clientY - rect.top - row.index * rowPx) / rowPx) * 2,
      ),
      row.camera,
    )
    const at = this.ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 0, 1), -z), new T.Vector3())
    return at ? { x: at.x + this.logicalWidth / 2, y: 380 - at.y } : { x: 0, y: 0 }
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
    // the fore-edge of a board swung by `a` moves its depth * sin(a) sideways.
    const room = i.row.physics.clearance(i.body, i.flutter.side === 'front' ? 1 : -1, i.body.depth)
    const limit = Math.asin(Math.min(1, Math.max(0, room - 1.5) / i.body.depth))
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
  /** The plank, hanging from one end once the other has come off the wall: it swings down faster as it goes. */
  private poseShelf(r: Row, dy: number, elapsed: number) {
    const d = r.detached
    const w = this.logicalWidth + 12
    if (!d) {
      r.shelf.position.set(0, 12 + dy, -67)
      r.shelf.rotation.z = 0
      return
    }
    if (d.angle < DETACH_ANGLE) {
      d.speed += 3.2 * (elapsed / 1000)
      d.angle = Math.min(DETACH_ANGLE, d.angle + d.speed * (elapsed / 1000))
      r.physics.tiltPlank(d.side, d.angle)
    }
    const a = -d.side * d.angle
    const px = (-d.side * w) / 2
    r.shelf.position.set(-px * Math.cos(a) + 7.5 * Math.sin(a) + px, 19.5 - px * Math.sin(a) - 7.5 * Math.cos(a) + dy, -67)
    r.shelf.rotation.z = a
  }

  private shudder(row: Row, amplitude: number) {
    row.shake = { at: performance.now(), amplitude }
    shelfShakes++
    if (shelfShakes > SHAKES_TO_DETACH && !row.detached) {
      row.detached = { side: row.physics.heavierSide(), angle: 0, speed: 0 }
      // Dust lying on the plank itself has nothing under it now: it drifts down like the rest.
      const now = performance.now()
      for (const d of this.dust) {
        if (d.row !== row || !d.settled || d.host || !d.sprite.parent) continue
        d.settled = false
        d.sprite.scale.set(d.size, d.size, 1)
        d.sprite.material.opacity = 0.9
        d.vx = d.vy = d.vz = 0
        d.at = now
        d.last = now
      }
    }
  }

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
    if (p.leaves.length === 0) return false
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

  private hitProp(e: PointerEvent): Grabbable | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const rowPx = this.rowH * this.scale
    const y = e.clientY - rect.top
    const row = this.rows[Math.floor(y / rowPx)]
    if (!row) return undefined
    const ray = new T.Raycaster()
    ray.setFromCamera(new T.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((y % rowPx) / rowPx) * 2), row.camera)
    const hit = ray.intersectObjects(row.scene.children, true).find((h) => h.object.userData.prop)?.object.userData.prop as Grabbable | undefined
    return this.hitStick(e, row) ?? this.hitDuster(e, row) ?? hit
  }

  /**
   * A stick of chalk is a few pixels thick, so it is picked by how near the pointer is to its centre
   * line rather than by a ray that has to land on it.
   */
  /** The duster is picked anywhere over its block, a little generously, since it is small on the plank. */
  private hitDuster(e: PointerEvent, row: Row): Duster | undefined {
    const d = this.duster
    if (!d || d.row !== row) return undefined
    const point = this.worldPoint(e, row, d.body.z)
    const dx = point.x - d.body.position.x
    const dy = point.y - d.body.position.y
    const cos = Math.cos(-d.body.angle)
    const sin = Math.sin(-d.body.angle)
    const lx = dx * cos - dy * sin
    const ly = dx * sin + dy * cos
    return Math.abs(lx) < DUSTER_W / 2 + 8 && Math.abs(ly) < DUSTER_H / 2 + 8 ? d : undefined
  }

  private hitStick(e: PointerEvent, row: Row): Stick | undefined {
    let best: Stick | undefined
    let bestDistance = 12
    for (const st of this.sticks) {
      const point = this.worldPoint(e, row, st.body.z)
      const half = (st.body as BookBody).bookWidth / 2
      const dx = Math.cos(st.body.angle) * half
      const dy = Math.sin(st.body.angle) * half
      // Distance from the point to the segment along the stick, less its radius.
      const ax = st.body.position.x - dx
      const ay = st.body.position.y - dy
      const abx = dx * 2
      const aby = dy * 2
      const t = Math.max(0, Math.min(1, ((point.x - ax) * abx + (point.y - ay) * aby) / (abx * abx + aby * aby)))
      const distance = Math.hypot(point.x - (ax + abx * t), point.y - (ay + aby * t)) - (st.body as BookBody).bookHeight / 2
      if (distance < bestDistance) {
        bestDistance = distance
        best = st
      }
    }
    return best
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
    this.inkLast = null
    this.dropBanner()
    if (this.heldProp) {
      this.heldProp.row.physics.release()
      this.heldProp = null
    }
    this.select(null)
  }

  // ---- the banner's corners, in the hand --------------------------------

  /** A pointer position as a point on the board's face, in the same coordinates the banner is simulated in. */
  private boardAt(e: PointerEvent) {
    const row = this.rows[0]
    const at = this.worldPoint(e, row, -146.3)
    return { x: at.x - this.logicalWidth / 2, y: 380 - at.y }
  }

  /** The weight of the paper nearest the pointer, if it is close enough to be taken hold of. Anywhere on the sheet will do. */
  private bannerParticleAt(e: PointerEvent): number | null {
    const b = this.bannerAnim
    if (!b || !this.rows[0]) return null
    const at = this.boardAt(e)
    // A strip of tape under the pointer is what is being picked up, whatever scrap of paper happens to lie nearer.
    let strip: number | null = null
    let near = 30
    for (const t of b.tapes) {
      const d = Math.hypot(b.pos[t.corner * 3] - at.x, b.pos[t.corner * 3 + 1] - at.y)
      if (d < near) {
        near = d
        strip = t.corner
      }
    }
    if (strip !== null) return strip
    let nearest: number | null = null
    let reach = 30
    const count = (b.cols + 1) * (b.rows + 1)
    for (let i = 0; i < count; i++) {
      const d = Math.hypot(b.pos[i * 3] - at.x, b.pos[i * 3 + 1] - at.y)
      if (d < reach) {
        reach = d
        nearest = i
      }
    }
    return nearest
  }

  /**
   * The weights around one, a few steps away along the paper. Only paper still joined to it counts: a scrap that
   * has torn away, or that lies near it on the board, is not picked up with it and stays where it is.
   */
  private around(b: BannerAnim, index: number, radius: number): number[] {
    const stride = b.cols + 1
    const seen = new Map<number, number>([[index, 0]])
    const queue = [index]
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]
      const depth = seen.get(i)!
      if (depth >= radius * 2) continue
      const r = Math.floor(i / stride)
      const c = i % stride
      const next: number[] = []
      if (c < b.cols && !b.brokenH[r * b.cols + c]) next.push(i + 1)
      if (c > 0 && !b.brokenH[r * b.cols + c - 1]) next.push(i - 1)
      if (r < b.rows && !b.brokenV[r * stride + c]) next.push(i + stride)
      if (r > 0 && !b.brokenV[(r - 1) * stride + c]) next.push(i - stride)
      for (const n of next) {
        if (!seen.has(n)) {
          seen.set(n, depth + 1)
          queue.push(n)
        }
      }
    }
    return queue
  }

  /** Takes hold of the paper at a point: that bit follows the pointer, a little proud of the board, until it is let go or stuck back. */
  private holdBanner(index: number, e: PointerEvent) {
    const b = this.bannerAnim
    if (!b) return
    const patch = this.around(b, index, 2)
    const held = new Set(patch)
    // Tape that was still holding this part of the paper comes away with it.
    for (const t of b.tapes) {
      if (!t.released && t.patch.some((i) => held.has(i))) {
        t.released = true
        t.releaseAt = Infinity
        for (const i of t.patch) b.pinned[i] = 0
      }
    }
    const at = this.boardAt(e)
    const offsets = new Float32Array(patch.length * 2)
    patch.forEach((i, n) => {
      b.pinned[i] = 1
      offsets[n * 2] = b.pos[i * 3] - b.pos[index * 3]
      offsets[n * 2 + 1] = b.pos[i * 3 + 1] - b.pos[index * 3 + 1]
    })
    b.holding = { patch, offsets, anchor: index, at: { x: at.x, y: at.y }, target: { x: at.x, y: at.y } }
    // Grabbed where the pointer is, so the paper comes to the hand rather than jumping.
    this.moveBannerTo(at.x, at.y, b)
    b.done = false
    b.still = 0
    this.wake()
  }

  private moveBannerTo(x: number, y: number, b: BannerAnim) {
    const hold = b.holding
    if (!hold) return
    // A hand cannot push paper through a book either: the held weights stop at the nearest face.
    const boxes = this.bannerBoxes()
    const at = { x: 0, y: 0, z: 0 }
    hold.patch.forEach((index, n) => {
      at.x = x + hold.offsets[n * 2]
      at.y = y + hold.offsets[n * 2 + 1]
      at.z = -146.3 + 12
      this.pushOut(boxes, at)
      b.home[index * 3] = at.x
      b.home[index * 3 + 1] = at.y
      b.home[index * 3 + 2] = at.z
    })
  }

  private moveBanner(e: PointerEvent) {
    const b = this.bannerAnim
    if (!b?.holding) return
    // The hand is followed at a pace the paper can keep up with: yank it faster and it tears, but not at the
    // first twitch.
    const at = this.boardAt(e)
    b.holding.target = { x: at.x, y: at.y }
    b.done = false
    b.still = 0
    this.wake()
  }

  /**
   * Space while holding the paper: a strip of tape that came away with it, the nearest to the spot held, is pressed
   * back onto the board there. There is no new tape: with none near, there is nothing to stick it with.
   */
  private stickBanner() {
    const b = this.bannerAnim
    const hold = b?.holding
    if (!b || !hold) return
    const ax = b.pos[hold.anchor * 3]
    const ay = b.pos[hold.anchor * 3 + 1]
    let strip: BannerAnim['tapes'][number] | null = null
    let nearest = 80
    for (const t of b.tapes) {
      if (!t.released) continue
      const d = Math.hypot(b.pos[t.corner * 3] - ax, b.pos[t.corner * 3 + 1] - ay)
      if (d < nearest) {
        nearest = d
        strip = t
      }
    }
    if (!strip) return
    // The strip goes down where it is, on the paper it is stuck to; only the weights under it are held.
    const under = new Set(strip.patch)
    for (const i of hold.patch) if (!under.has(i)) b.pinned[i] = 0
    // Pressed onto whatever is there: the board, or the frame standing proud of it.
    const boxes = this.bannerBoxes()
    const at = { x: 0, y: 0, z: 0 }
    for (const i of strip.patch) {
      b.pinned[i] = 1
      at.x = b.pos[i * 3]
      at.y = b.pos[i * 3 + 1]
      at.z = -146.3
      this.pushOut(boxes, at)
      b.home[i * 3] = at.x
      b.home[i * 3 + 1] = at.y
      b.home[i * 3 + 2] = at.z
    }
    strip.released = false
    strip.releaseAt = Infinity
    this.calm(b, hold.patch)
    b.holding = null
    b.done = false
    b.still = 0
    this.wake()
  }

  /**
   * Takes the speed out of the paper when a hand lets go of it. A held weight is moved by the hand, not by its own
   * speed, so it carries whatever speed it had before it was picked up; and the rest of the sheet has been dragged
   * along. Let go of with any of that left, it flings. It falls from where it is, with nothing added.
   */
  private calm(b: BannerAnim, held: number[]) {
    for (const i of held) {
      for (let n = 0; n < 3; n++) b.prev[i * 3 + n] = b.pos[i * 3 + n]
    }
    const count = (b.cols + 1) * (b.rows + 1)
    for (let i = 0; i < count; i++) {
      for (let n = 0; n < 3; n++) b.prev[i * 3 + n] += (b.pos[i * 3 + n] - b.prev[i * 3 + n]) * 0.92
    }
  }

  /** Let go of held paper without sticking it: the weights it was holding are free again. */
  private dropBanner() {
    const b = this.bannerAnim
    if (!b?.holding) return
    for (const index of b.holding.patch) b.pinned[index] = 0
    this.calm(b, b.holding.patch)
    b.holding = null
    b.done = false
    b.still = 0
    this.wake()
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
    if (performance.now() - this.lastScrollAt > 250) {
      this.scrollTrack = null
      for (const row of this.rows) row.physics.shelfAcceleration = { x: 0, y: 0 }
      return false
    }
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
    pulling = this.stepBanner(time) || pulling
    for (const i of this.items) {
      // The model is drawn from the spine, which faces the viewer, so it sits half a depth in front of the body's middle.
      i.model.position.set(i.body.position.x - this.logicalWidth / 2, 380 - i.body.position.y, i.body.z + i.body.depth / 2)
      i.model.rotation.z = -i.body.angle
      if (i.pulledAt === undefined) this.tip(i.model, i.body)
      pulling = this.flutter(i) || pulling
      if (i.pulledAt !== undefined) {
        const t = Math.min(1, (performance.now() - i.pulledAt) / PULL_MS)
        const e = 1 - (1 - t) ** 3
        // Straight at the camera, along the line from the book to it, so a book at the side comes forward
        // without sliding outwards across the screen, and turns its spine to face it.
        const cam = i.row.camera.position
        const dx = cam.x - i.model.position.x
        const dz = cam.z - i.model.position.z
        i.model.position.lerp(cam, (PULL_DISTANCE * e) / dz)
        i.model.rotation.y = e * Math.atan2(dx, dz)
        pulling ||= t < 1
      }
    }
    for (const p of this.props) {
      p.model.position.set(p.body.position.x - this.logicalWidth / 2, 380 - p.body.position.y, p.body.z)
      p.model.rotation.z = -p.body.angle
      this.tip(p.model, p.body)
      pulling = this.sway(p, elapsed) || pulling
    }
    for (const st of this.sticks) pulling = this.poseStick(st) || pulling
    if (this.duster) pulling = this.poseDuster(this.duster) || pulling
    for (const r of this.rows) {
      for (const crushed of r.physics.takeCrushed()) {
        const st = this.sticks.find((s) => s.body === crushed)
        if (st) this.crushToDust(st)
      }
    }
    pulling = this.driftDust(performance.now()) || pulling
    // Whatever has gone over the edge and is falling away for good: a book pulled off the front, a
    // stick knocked off the end. Its model is dropped; the rest of the shelf carries on.
    for (const r of this.rows) {
      for (const lost of r.physics.reap()) {
        const item = this.items.findIndex((it) => it.body === lost)
        if (item >= 0) {
          const [gone] = this.items.splice(item, 1)
          if (this.selected === gone) {
            this.selected = null
            this.drag = null
          }
          gone.button?.remove()
          this.disposeModel(gone.model)
          continue
        }
        const prop = this.props.findIndex((p) => p.body === lost)
        if (prop >= 0) {
          const [gone] = this.props.splice(prop, 1)
          if (this.heldProp === gone) this.heldProp = null
          this.disposeModel(gone.model)
          continue
        }
        if (this.duster?.body === lost) {
          if (this.heldProp === this.duster) this.heldProp = null
          this.disposeModel(this.duster.model)
          this.duster = null
          continue
        }
        const stick = this.sticks.findIndex((st) => st.body === lost)
        if (stick >= 0) {
          const [gone] = this.sticks.splice(stick, 1)
          if (this.heldProp === gone) this.heldProp = null
          this.disposeModel(gone.model)
        }
      }
    }
    pulling = this.writeInk() || pulling
    pulling = this.wipeBoard() || pulling
    // Shelf shudder: a fast decaying bounce applied to the plank and everything on it.
    for (const r of this.rows) {
      const dy = r.shake ? this.shakeAt(r.shake, performance.now()) : 0
      if (r.shake && performance.now() - r.shake.at > SHAKE_MS) r.shake = undefined
      this.poseShelf(r, dy, elapsed)
      if (dy) {
        pulling = true
        for (const i of this.items) if (i.row === r) i.model.position.y += dy
        for (const p of this.props) if (p.row === r) p.model.position.y += dy
      }
      if (r.shake || (r.detached && r.detached.angle < DETACH_ANGLE)) pulling = true
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

/** Where the board's banner goes, in the board texture's pixels. */
interface Taped {
  x: number; y: number; w: number; h: number; tilt: number
  /**
   * Set when the tape is going to give way: the banner then peels off the board on one side and hangs from the
   * top corner of the other, at this angle (radians). `px`, `py` is that corner. It is a 3D object, not paint.
   */
  flop: { fromRight: boolean; angle: number; px: number; py: number } | null
}

/**
 * The banner whose tape is giving way: a sheet of paper simulated as a grid of weights joined by threads, so it
 * is as floppy as paper is. The tape holds some of the weights still; when it lets go, they are free.
 */
interface BannerAnim {
  group: T.Group
  geo: T.PlaneGeometry
  cols: number
  rows: number
  /** x, y, z of every weight, now and a moment ago (the simulation steps by the difference). */
  pos: Float32Array
  prev: Float32Array
  /** 1 while a strip of tape holds this weight to the board. */
  pinned: Uint8Array
  /** The pinned position of a held weight. */
  home: Float32Array
  dx: number
  dy: number
  /** Threads that have torn: along each row (between neighbours) and down each column. */
  brokenH: Uint8Array
  brokenV: Uint8Array
  /** How much each thread can be drawn out before it tears: uneven, as paper is, and weakened beside a tear. */
  strengthH: Float32Array
  strengthV: Float32Array
  /** Paper being held in the hand: the weights, where each sits relative to the one grabbed, and which that is. */
  holding: { patch: number[]; offsets: Float32Array; anchor: number; at: { x: number; y: number }; target: { x: number; y: number } } | null
  tapes: { mesh: T.Mesh; patch: number[]; corner: number; across: number; down: number; releaseAt: number; released: boolean; angle: number }[]
  start: number | null
  last: number
  /** Seconds the sheet has moved less than a hair, once every tape has gone. */
  still: number
  done: boolean
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
