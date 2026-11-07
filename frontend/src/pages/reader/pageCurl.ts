import { heldPageUrl } from './pageBlobs'
import type { Spread } from './useSpreads'

/**
 * Page turns drawn as paper. The sheet is a mesh wrapped round a cylinder whose axis is the fold
 * line, so the part past the fold lifts, rolls over and lies back down on the other side of the
 * spine. A finger or mouse drag places the fold; a tap or key plays the same turn on its own.
 *
 * Everything is worked out in left-to-right space: the spine on the left of the sheet, the free edge
 * on the right. Right-to-left mirrors the drawing (and the pointer) about the viewport centre.
 *
 * Two pages up (a "book"), the right page is the sheet: its back is the next spread's left page, and
 * it lands on the current left page. One page up, the sheet hinges on the page's own spine edge and
 * its back is the page seen through the paper.
 */

const VERTEX = `#version 300 es
in vec2 aUv;
in float aLayer;
uniform vec4 uRect;
uniform vec2 uView;
uniform float uMirror;
uniform float uDepth;
uniform vec4 uFold;
uniform float uRadius;
uniform float uCurl;
uniform float uZ;
uniform float uCover;
uniform vec2 uSwing;
uniform float uLift;
uniform float uSpine;
uniform float uBookShift;
uniform float uThickness;
uniform float uLayer;
uniform vec2 uWear;
out vec2 vUv;
out vec2 vShapeUv;
out vec3 vNormal;
out float vBeyond;
out float vFlatX;
void main() {
  vec2 p = uRect.xy + aUv * uRect.zw;
  vFlatX = p.x;
  vec3 pos = vec3(p, uZ);
  vec3 normal = vec3(0.0, 0.0, 1.0);
  float s = dot(p - uFold.xy, uFold.zw);
  if (uCurl > 0.5 && uCover > 0.5) {
    // Cardstock swings from the binding with a gentle bow instead of rolling like paper.
    float t = aUv.x;
    float bow = 0.035 * uRect.z * uSwing.y;
    float bend = bow * sin(3.14159265 * t);
    float slope = 0.035 * 3.14159265 * uSwing.y * cos(3.14159265 * t);
    float x = p.x - uSpine;
    pos = vec3(uSpine + x * uSwing.x - bend * uSwing.y, p.y, x * uSwing.y + bend * uSwing.x);
    normal = normalize(vec3(-uSwing.y - slope * uSwing.x, 0.0, uSwing.x - slope * uSwing.y));
  } else if (uCurl > 0.5 && s > 0.0) {
    vec2 n = uFold.zw;
    float r = max(uRadius, 0.0001);
    vec2 base = p - n * s;
    if (s < 3.14159265 * r) {
      float a = s / r;
      pos = vec3(base + n * r * sin(a), r * (1.0 - cos(a)));
      normal = vec3(-n * sin(a), cos(a));
    } else {
      pos = vec3(base - n * (s - 3.14159265 * r), 2.0 * r);
      normal = vec3(0.0, 0.0, -1.0);
    }
  }
  if (uCurl > 0.5) {
    float wave = sin(3.14159265 * aUv.x) * sin(6.2831853 * aUv.y + uWear.x);
    float corner = smoothstep(0.8, 1.0, aUv.x) * smoothstep(0.82, 1.0, aUv.y);
    float ripple = uRect.z * (0.0015 * wave + 0.008 * uWear.y * corner) * uLift;
    pos += normal * (ripple * (uCover > 0.5 ? 0.2 : 1.0) + (aLayer + uLayer) * uThickness);
  }
  // The scene is mirrored for right-to-left; the pictures on it must not be.
  vUv = vec2(mix(aUv.x, 1.0 - aUv.x, uMirror), aUv.y);
  vShapeUv = aUv;
  vNormal = normal;
  vBeyond = s;
  pos.x += uBookShift;
  float x = mix(pos.x, uView.x - pos.x, uMirror);
  float w = uDepth - pos.z;
  gl_Position = vec4((x / uView.x * 2.0 - 1.0) * uDepth, (1.0 - pos.y / uView.y * 2.0) * uDepth, -pos.z / uDepth * 2.0 * w, w);
}`

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vShapeUv;
in vec3 vNormal;
in float vBeyond;
in float vFlatX;
uniform float uSpine;
uniform float uGutter;
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform float uHasBack;
uniform float uShadow;
uniform float uRadius;
uniform float uCover;
// A face's share of its texture: left edge, width, and 1 when its print is mirrored.
uniform vec2 uCoverSides;
uniform vec4 uRect;
uniform vec2 uWear;
uniform float uEdge;
uniform vec3 uFrontPart;
uniform vec3 uBackPart;
// Each page's own paper colour, which print seen from the other side fades into.
uniform vec3 uFrontPaper;
uniform vec3 uBackPaper;
out vec4 outColor;
const vec3 LIGHT = vec3(-0.3, -0.4, 0.87);
// Print seen through the paper from the other side: faded into that page's paper.
const float THROUGH = 0.7;
vec2 within(vec3 part, float u, float v) {
  float s = part.z > 0.5 ? 1.0 - u : u;
  return vec2(part.x + s * part.y, v);
}
void main() {
  if (uEdge > 0.5) {
    outColor = vec4(0.78, 0.75, 0.68, 1.0);
    return;
  }
  vec3 n = normalize(vNormal);
  bool back = n.z < 0.0;
  vec3 colour;
  if (!back) {
    colour = texture(uFront, within(uFrontPart, vUv.x, vUv.y)).rgb;
    if (uFrontPart.z > 0.5) colour = uCover > 0.5 ? vec3(0.969, 0.957, 0.925) : mix(colour, uFrontPaper, THROUGH);
  } else if (uHasBack > 0.5) {
    // Seen from behind the sheet, so flipped once more: it reads as it will when it lies down.
    colour = texture(uBack, within(uBackPart, 1.0 - vUv.x, vUv.y)).rgb;
    if (uBackPart.z > 0.5) colour = uCover > 0.5 ? vec3(0.969, 0.957, 0.925) : mix(colour, uBackPaper, THROUGH);
  } else {
    // A sheet with nothing printed on its back shows its own print through the paper.
    colour = uCover > 0.5 ? vec3(0.969, 0.957, 0.925) : mix(texture(uFront, within(uFrontPart, vUv.x, vUv.y)).rgb, uFrontPaper, THROUGH);
  }
  vec3 facing = back ? -n : n;
  float light = (0.55 + 0.45 * max(dot(facing, LIGHT), 0.0)) / (0.55 + 0.45 * LIGHT.z);
  // The lifted sheet shades the page it uncovers, darkest under the roll.
  float shade = uShadow * 0.32 * exp(-abs(vBeyond) / (uRadius * 1.5 + 10.0));
  // The fold at the spine, where the paper curves into the binding: darkest at the spine itself.
  float outerCover = back ? uCoverSides.y : uCoverSides.x;
  float gutter = uGutter > 0.0 && outerCover < 0.5 ? 0.3 * exp(-abs(vFlatX - uSpine) / uGutter) : 0.0;
  vec2 edgeDistance = min(vShapeUv, 1.0 - vShapeUv) * uRect.zw;
  float alpha = smoothstep(0.0, 0.5, min(edgeDistance.x, edgeDistance.y));
  float cornerDistance = dot((1.0 - vShapeUv) * uRect.zw, vec2(1.0));
  alpha *= smoothstep(0.0, 1.0, cornerDistance - uWear.y * 1.2);
  if (alpha < 0.01) discard;
  outColor = vec4(colour * min(light, 1.08) * (1.0 - shade) * (1.0 - gutter) * alpha, alpha);
}`

const COLUMNS = 64
const ROWS = 24
const DRAG_SLOP = 8
const TEXTURE_CACHE = 8
const RADIUS_SHARE = 0.14
const MAX_TILT = 0.5
const PREPARE_MS = 300
const VELOCITY_MS = 80
const COAST_MS = 300
/** Share of a page's width the finger has to cross for a released drag to turn the page. */
const TURN_SHARE = 0.4
/** How far the fold's shadow reaches from the spine, as a share of a page's width. Matches the page's CSS gutter. */
export const GUTTER_SHARE = 0.06

/** Fixed per leaf: wear must never change when a page is redrawn. */
export function pageWear(page: number): [number, number] {
  const mixed = Math.imul(page + 1, 2654435761)
  const seed = Math.imul(mixed ^ (mixed >>> 16), 2246822507) >>> 0
  return [(seed / 0xffffffff) * Math.PI * 2, seed % 19 === 0 ? 1 : 0]
}

interface Texture {
  texture: WebGLTexture
  aspect: number
  /** The page's paper colour, 0 to 1 per channel. */
  paper: [number, number, number]
}

/**
 * A page's paper colour: the median of its outer edge, which is margin on almost every page. Print
 * shown from the back of the sheet fades into this, so a white page stays white and a cream or grey
 * one keeps its own tone. Returned 0 to 1 per channel.
 */
export function paperTone(image: CanvasImageSource & { width: number; height: number }): [number, number, number] {
  const canvas = document.createElement('canvas')
  const width = 40
  const height = Math.max(4, Math.round((40 * image.height) / Math.max(1, image.width)))
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return [0.96, 0.95, 0.92]
  try {
    context.drawImage(image, 0, 0, width, height)
    const data = context.getImageData(0, 0, width, height).data
    const channels: number[][] = [[], [], []]
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x > 1 && x < width - 2 && y > 1 && y < height - 2) continue
        const i = (y * width + x) * 4
        for (let c = 0; c < 3; c++) channels[c]!.push(data[i + c]!)
      }
    }
    return channels.map((values) => {
      values.sort((a, b) => a - b)
      return values[Math.floor(values.length / 2)]! / 255
    }) as [number, number, number]
  } catch {
    return [0.96, 0.95, 0.92]
  }
}

/** Which part of a page's image a face shows: all of it, or one half of a two-page spread. */
export type FacePart = 'whole' | 'left' | 'right'

/** One side of one leaf of the book. `mirrored` is the back of a sheet showing its print through. */
export interface Face {
  page: number
  cover: boolean
  src: string
  part: FacePart
  mirrored: boolean
}

/** A spread as the book shows it, in left-to-right space: the earlier side on the left. */
export interface Opening {
  left: Face | null
  right: Face | null
}

/** Where the book sits on screen: the spine, and the size of one page. Screen coordinates. */
export interface BookGeometry {
  spineX: number
  top: number
  pageWidth: number
  pageHeight: number
}

const PARTS: Record<FacePart, [number, number]> = { whole: [0, 1], left: [0, 0.5], right: [0.5, 0.5] }

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * One turn, in left-to-right space. Progress runs 0 (sheet flat on the right) to 1 (on the left).
 * The sheet is the right page of the opening it leaves going forward, of the one it reaches going back.
 */
interface Turn {
  forward: boolean
  closing: boolean
  targetKey: string
  spine: number
  sheet: Rect
  leftSlot: Rect
  rightSlot: Rect
  front: Face
  back: Face | null
  left: Face | null
  right: Face | null
  /** The textures this turn loaded, held for its whole life: the cache and the sheet shape may move on. */
  textures: Map<string, Texture>
}

export interface CurlContext {
  urls: string[]
  current: Spread
  next: Spread | null
  previous: Spread | null
  /** How a spread lies open: its left and right faces, either may be empty (a cover, a last page). */
  opening: (spread: Spread) => Opening
  /** The back of the sheet a face is printed on, in one-page view; null in two-page view. */
  backOf: ((face: Face) => Face | null) | null
  /** Where the book sits now. */
  geometry: () => BookGeometry | null
  /** Called before a turn is drawn: a zoomed-out wide page zooms back in first. */
  beforeTurn: () => Promise<void>
  /** Draw in mirrored space: the sheet hinges on its right edge (right-to-left, or a left-aligned page). */
  mirror: boolean
  /** Width over height every page is drawn at, so a chapter's pages are one size; null keeps each page's own. */
  sheetAspect: number | null
  /** How a page of another shape fills the sheet: stretched, or enlarged and cropped at the sides. */
  sheetFill: 'stretch' | 'enlarge'
  /** Drawn turns at all: plain pages at 1x. */
  enabled: boolean
  /** Turns that follow the pointer as well: the page does not scroll sideways. */
  draggable: boolean
}

const keyOf = (spread: Spread) => spread.join(',')

const easeOut = (t: number) => 1 - (1 - t) ** 3
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

function fitInto(slot: Rect, aspect: number, anchorRight: boolean): Rect {
  const w = Math.min(slot.w, slot.h * aspect)
  const h = w / aspect
  return { x: anchorRight ? slot.x + slot.w - w : slot.x, y: slot.y + (slot.h - h) / 2, w, h }
}

export interface Sample {
  x: number
  t: number
}

/** Records a pointer position, keeping the last VELOCITY_MS plus the one sample before them. */
export function addSample(samples: Sample[], sample: Sample) {
  samples.push(sample)
  // The sample before the window is where the pointer sat if it paused, so a pause counts as stillness.
  while (samples.length > 2 && sample.t - samples[1]!.t > VELOCITY_MS) samples.shift()
}

/**
 * Whether a released drag finishes the turn: when the finger has crossed TURN_SHARE of a page from
 * the edge it started at, or would coast that far at the drag's speed (a flick). Progress counts the
 * whole swing, two page widths, so a page's share of it is half. The speed is taken over the last
 * stretch of the drag rather than the last few events, because a mouse reports every millisecond
 * and the wobble as the button comes up read as a flick the other way. Positions are in
 * left-to-right space; progress runs 0 (flat on the right) to 1 (on the left).
 */
export function releaseCompletes(samples: Sample[], upTime: number, progress: number, forward: boolean, sheetWidth: number) {
  // Movement in the last VELOCITY_MS before the release, measured from where the pointer was when
  // that window opened. A pointer that stopped before it is still, however fast it got there.
  const windowStart = upTime - VELOCITY_MS
  const last = samples[samples.length - 1]
  let anchor = samples[0]
  for (const sample of samples) if (sample.t <= windowStart) anchor = sample
  const velocity =
    anchor && last && last.t > windowStart ? (last.x - anchor.x) / Math.max(upTime - anchor.t, VELOCITY_MS) : 0
  const coasted = progress - (velocity * COAST_MS) / (2 * sheetWidth)
  const reach = TURN_SHARE / 2
  return forward ? progress >= reach || coasted >= reach : 1 - progress >= reach || 1 - coasted >= reach
}

/** Device pixels per CSS pixel, as far as the drawing goes. */
function pixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, 2)
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export class PageCurl {
  private gl: WebGL2RenderingContext | null
  private program: WebGLProgram | null = null
  private uniforms = new Map<string, WebGLUniformLocation | null>()
  private indexCount = 0
  private edgeCount = 0
  private textures = new Map<string, Promise<Texture | null>>()
  private ready = new Map<string, Texture>()
  /** Cache keys a pending or running turn needs; never evicted until it is over. */
  private pinned = new Set<string>()
  private context: CurlContext | null = null
  private turn: Turn | null = null
  private finger = { x: 0, y: 0 }
  private grabY = 0
  private frame = 0
  private animating = false
  private landingKey: string | null = null
  private settledKey: string | null = null
  private hideTimer = 0
  private suppressClickUntil = 0
  private pointer: { id: number; x: number; y: number; offset: number; started: boolean; history: { x: number; t: number }[] } | null = null
  private generation = 0
  private removeListeners: (() => void) | null = null
  private surface: HTMLElement | null = null
  private disposed = false
  private resize = () => this.stop()

  private canvas: HTMLCanvasElement
  private host: HTMLElement
  private onTurn: (forward: boolean) => void
  private onBusy: (busy: boolean) => void
  private onIdle: () => void

  constructor(
    canvas: HTMLCanvasElement,
    host: HTMLElement,
    onTurn: (forward: boolean) => void,
    onBusy: (busy: boolean) => void,
    /** The drawing has gone and the real pages are up again. */
    onIdle: () => void,
  ) {
    this.canvas = canvas
    this.host = host
    this.onTurn = onTurn
    this.onBusy = onBusy
    this.onIdle = onIdle
    this.gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: true, alpha: true })
    if (this.gl) this.setUp(this.gl)
    window.addEventListener('resize', this.resize)
  }

  update(context: CurlContext) {
    if (this.context && (this.context.urls !== context.urls || (this.context.enabled && !context.enabled) || this.context.mirror !== context.mirror)) this.stop()
    this.context = context
    const surface = this.host.parentElement
    if (surface !== this.surface) {
      this.removeListeners?.()
      this.surface = surface
      this.removeListeners = surface ? this.listen(surface) : null
    }
    if (surface) surface.style.touchAction = this.canDrag() ? 'pan-y' : ''
    // Upload the pages a turn can reach now, so a drag or a tap starts on the next frame.
    if (context.enabled && this.gl && !reducedMotion()) {
      const sources = new Set<string>()
      for (const spread of [context.current, context.next, context.previous]) {
        if (!spread) continue
        const { left, right } = context.opening(spread)
        for (const face of [left, right, right && context.backOf?.(right)]) if (face) sources.add(face.src)
      }
      const height = this.displayHeight()
      for (const src of sources) void this.texture(src, height)
    }
  }

  dispose() {
    this.disposed = true
    this.stop()
    window.removeEventListener('resize', this.resize)
    this.removeListeners?.()
    if (this.surface) this.surface.style.touchAction = ''
    const gl = this.gl
    if (gl) for (const texture of this.ready.values()) gl.deleteTexture(texture.texture)
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext()
  }

  /** A turn made some other way (a tap, a key): played on its own, unless a drag already drew it. */
  auto(from: Spread, to: Spread, forward: boolean) {
    const key = keyOf(to)
    if (key === this.landingKey) return
    this.stop()
    const turn = this.plan(from, to, forward)
    if (!turn) return
    const generation = this.generation
    this.onBusy(true)
    void Promise.all([this.prepare(turn), this.context!.beforeTurn()]).then(([ok]) => {
      if (generation !== this.generation) return
      this.onBusy(false)
      // Not drawn after all: the page just turns, and anything waiting on the turn can go on.
      if (!ok) return this.onIdle()
      this.turn = turn
      this.landingKey = key
      const edge = turn.spine + turn.sheet.w
      const y = turn.sheet.y + turn.sheet.h * 0.86
      this.grabY = y
      const start = forward ? { x: edge, y } : { x: turn.spine - turn.sheet.w, y: y - turn.sheet.h * 0.08 }
      const end = forward ? { x: turn.spine - turn.sheet.w, y: y - turn.sheet.h * 0.08 } : { x: edge, y }
      this.finger = { ...start }
      this.show()
      this.draw()
      this.animate(start, end, 520, easeInOut, () => this.landed())
    })
  }

  /** The spread on screen underneath, so the drawing can go once the real pages are up. */
  settled(key: string) {
    this.settledKey = key
    if (!this.animating && this.landingKey === key) this.hide()
  }

  private canDrag() {
    const context = this.context
    return !!context && context.enabled && context.draggable && !!this.gl && !reducedMotion()
  }

  private stop() {
    this.generation++
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.animating = false
    this.onBusy(false)
    this.pointer = null
    this.hide()
  }

  private show() {
    this.host.dataset.curling = ''
    clearTimeout(this.hideTimer)
    this.hideTimer = window.setTimeout(() => {
      if (!this.animating && !this.pointer) this.hide()
    }, 2500)
  }

  private hide() {
    const shown = this.host.dataset.curling !== undefined
    delete this.host.dataset.curling
    this.turn = null
    this.pinned.clear()
    this.landingKey = null
    clearTimeout(this.hideTimer)
    if (shown) this.onIdle()
  }

  private landed() {
    if (!this.turn) return
    if (this.settledKey === this.landingKey) this.hide()
  }

  /**
   * Where everything sits: the book's geometry and the two openings, the one left and the one
   * reached. Null when this turn is not drawn (no sheet to lift, or drawing is off).
   */
  private plan(from: Spread, to: Spread, forward: boolean): Turn | null {
    const context = this.context
    if (!context?.enabled || !this.gl || reducedMotion()) return null
    const geometry = context.geometry()
    if (!geometry) return null
    const spine = context.mirror ? window.innerWidth - geometry.spineX : geometry.spineX
    const page = { y: geometry.top, w: geometry.pageWidth, h: geometry.pageHeight }
    const leftSlot = { ...page, x: spine - page.w }
    const rightSlot = { ...page, x: spine }
    const leaving = context.opening(from)
    const reaching = context.opening(to)
    const [before, after] = forward ? [leaving, reaching] : [reaching, leaving]
    // The sheet that turns is the right page of the earlier opening.
    const front = before.right
    if (!front) return null
    // Two pages up its back is the left page of the later opening; one page up, the page's own back.
    const back = context.backOf ? context.backOf(front) : after.left
    return {
      forward,
      closing: context.backOf !== null && after.right === null,
      targetKey: keyOf(to),
      spine,
      sheet: rightSlot,
      leftSlot,
      rightSlot,
      front,
      back,
      left: before.left,
      right: after.right,
      textures: new Map(),
    }
  }

  /** Loads the turn's pages. A drag waits as long as the finger is down; a tap or key turn gives up quickly. */
  private prepare(turn: Turn, patient = false): Promise<boolean> {
    const sources = [...new Set([turn.front, turn.back, turn.left, turn.right].filter((face) => face !== null).map((face) => face.src))]
    const height = this.displayHeight()
    this.pinned = new Set(sources.map((src) => this.keyFor(src, height)))
    const loaded = Promise.all(sources.map((src) => this.texture(src, height))).then((all) => {
      all.forEach((texture, index) => texture && turn.textures.set(sources[index]!, texture))
      return all.every(Boolean)
    })
    if (patient) return loaded
    // A tap never waits on a slow decode: past this the page turns without the drawing.
    const late = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PREPARE_MS))
    return Promise.race([loaded, late])
  }

  /** Textures are shaped to the sheet, so the same page at another sheet size is another texture. */
  /**
   * The height in device pixels a page is shown at. Textures are drawn at exactly this size with the
   * browser's own resampling, so the drawing matches the page it hands back to; a texture shrunk on
   * the GPU came out softer, and lighter where screentone blurred. Rounded so small moves reuse them.
   */
  private displayHeight(): number | null {
    const height = this.context?.geometry()?.pageHeight
    return height ? Math.round((height * pixelRatio()) / 8) * 8 : null
  }

  private keyFor(src: string, height: number | null) {
    return `${src}|${this.context?.sheetAspect ?? ''}|${this.context?.sheetFill ?? ''}|${height ?? ''}`
  }

  private texture(src: string, target = this.displayHeight()): Promise<Texture | null> {
    const key = this.keyFor(src, target)
    const sheet = this.context?.sheetAspect ?? null
    const fill = this.context?.sheetFill ?? 'stretch'
    const known = this.textures.get(key)
    if (known) {
      const ready = this.ready.get(key)
      if (ready) {
        this.ready.delete(key)
        this.ready.set(key, ready)
      }
      return known
    }
    const loading = (async () => {
      const gl = this.gl
      if (!gl) return null
      const image = new Image()
      // The load event, not decode(): a hidden page holds decode() back indefinitely, and the upload
      // below decodes the image anyway.
      const loaded = new Promise<boolean>((resolve) => {
        image.onload = () => resolve(true)
        image.onerror = () => resolve(false)
      })
      image.src = heldPageUrl(src) ?? src
      if (!(await loaded) || !image.naturalWidth || this.disposed || gl.isContextLost()) return null
      const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, 4096)
      const natural = image.naturalWidth / image.naturalHeight
      // A two-page spread covers two sheets.
      const shaped = sheet === null ? null : natural <= 1 ? sheet : sheet * 2
      const aspect = shaped ?? natural
      // At the size it is shown; the sheet sets the shape (a short page comes out taller).
      const height = Math.max(1, Math.round(Math.min(target ?? image.naturalHeight, limit, limit / aspect)))
      const copy = document.createElement('canvas')
      copy.width = Math.max(1, Math.round(height * aspect))
      copy.height = height
      const draw = copy.getContext('2d')
      if (!draw) return null
      draw.imageSmoothingQuality = 'high'
      if (shaped !== null && fill === 'enlarge') {
        const cover = Math.max(copy.width / image.naturalWidth, copy.height / image.naturalHeight)
        const w = image.naturalWidth * cover
        const h = image.naturalHeight * cover
        draw.drawImage(image, (copy.width - w) / 2, (copy.height - h) / 2, w, h)
      } else {
        draw.drawImage(image, 0, 0, copy.width, copy.height)
      }
      const source: TexImageSource = copy
      const texture = gl.createTexture()
      if (!texture) return null
      gl.bindTexture(gl.TEXTURE_2D, texture)
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
      } catch {
        gl.deleteTexture(texture)
        return null
      }
      // Drawn about one texel to a pixel, so plain linear filtering keeps it as sharp as the page.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const result = { texture, aspect, paper: paperTone(image) }
      this.ready.set(key, result)
      this.evict()
      return result
    })()
    this.textures.set(key, loading)
    void loading.then((texture) => {
      if (!texture && this.textures.get(key) === loading) this.textures.delete(key)
    })
    return loading
  }

  private evict() {
    for (const key of this.ready.keys()) {
      if (this.ready.size <= TEXTURE_CACHE) break
      if (this.pinned.has(key)) continue
      this.gl?.deleteTexture(this.ready.get(key)!.texture)
      this.ready.delete(key)
      this.textures.delete(key)
    }
  }

  private animate(from: { x: number; y: number }, to: { x: number; y: number }, ms: number, ease: (t: number) => number, done: () => void) {
    cancelAnimationFrame(this.frame)
    this.animating = true
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      const k = ease(t)
      this.finger = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }
      this.draw()
      if (t < 1) {
        this.frame = requestAnimationFrame(step)
      } else {
        this.animating = false
        done()
      }
    }
    this.frame = requestAnimationFrame(step)
  }

  private listen(surface: HTMLElement): () => void {
    const ltrX = (clientX: number) => (this.context?.mirror ? window.innerWidth - clientX : clientX)

    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || this.animating || this.pointer?.started || !this.canDrag()) return
      // A page wider than the screen pans sideways instead. Clipped overflow (a blank facing page off
      // the edge) cannot be panned, so it does not count.
      const clipped = /hidden|clip/.test(getComputedStyle(surface).overflowX)
      if (!clipped && surface.scrollWidth > surface.clientWidth + 1) return
      this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, offset: 0, started: false, history: [] }
    }

    const move = (event: PointerEvent) => {
      const pointer = this.pointer
      if (!pointer || event.pointerId !== pointer.id) return
      const x = ltrX(event.clientX)
      if (!pointer.started) {
        const dx = event.clientX - pointer.x
        const dy = event.clientY - pointer.y
        if (Math.abs(dx) < DRAG_SLOP || Math.abs(dx) < Math.abs(dy)) {
          if (Math.abs(dy) > DRAG_SLOP * 2) this.pointer = null
          return
        }
        const forward = (this.context!.mirror ? -dx : dx) < 0
        const context = this.context!
        const to = forward ? context.next : context.previous
        this.stop()
        const turn = to ? this.plan(context.current, to, forward) : null
        if (!turn) return
        pointer.started = true
        this.pointer = pointer
        this.suppressClickUntil = Number.MAX_SAFE_INTEGER
        try {
          surface.setPointerCapture(event.pointerId)
        } catch {
          // The pointer is already gone; the move and up events still arrive on the surface.
        }
        const edge = forward ? turn.spine + turn.sheet.w : turn.spine - turn.sheet.w
        pointer.offset = edge - x
        this.grabY = Math.min(turn.sheet.y + turn.sheet.h, Math.max(turn.sheet.y, event.clientY))
        this.finger = { x: x + pointer.offset, y: this.grabY }
        const generation = this.generation
        void Promise.all([this.prepare(turn, true), context.beforeTurn()]).then(([ok]) => {
          if (!ok || generation !== this.generation || !this.pointer) return
          this.turn = turn
          this.show()
          this.draw()
        })
      }
      event.preventDefault()
      this.finger = { x: x + pointer.offset, y: event.clientY }
      addSample(pointer.history, { x, t: event.timeStamp })
      if (this.turn && !this.frame) {
        this.frame = requestAnimationFrame(() => {
          this.frame = 0
          this.draw()
        })
      }
    }

    const up = (event: PointerEvent) => {
      const pointer = this.pointer
      if (!pointer || event.pointerId !== pointer.id) return
      this.pointer = null
      if (!pointer.started) return
      this.suppressClickUntil = performance.now() + 400
      const turn = this.turn
      if (!turn || event.type === 'pointercancel') {
        this.stop()
        if (!turn) this.onIdle()
        return
      }
      const complete = releaseCompletes(pointer.history, event.timeStamp, this.progress(), turn.forward, turn.sheet.w)
      const edge = turn.spine + turn.sheet.w
      const flat = { x: edge, y: this.grabY }
      const over = { x: turn.spine - turn.sheet.w, y: this.grabY }
      const end = complete === turn.forward ? over : flat
      const distance = Math.abs(end.x - this.finger.x) / (2 * turn.sheet.w)
      const ms = 160 + 280 * distance
      if (complete) {
        this.landingKey = turn.targetKey
        this.settledKey = null
        this.animate({ ...this.finger }, end, ms, easeOut, () => {
          this.onTurn(turn.forward)
          this.landed()
        })
      } else {
        this.animate({ ...this.finger }, end, ms, easeOut, () => this.hide())
      }
    }

    // A drag must not land as a tap on the zones underneath when the button comes up.
    const click = (event: MouseEvent) => {
      if (performance.now() < this.suppressClickUntil) {
        event.stopPropagation()
        event.preventDefault()
      }
    }

    surface.addEventListener('pointerdown', down)
    surface.addEventListener('pointermove', move, { passive: false })
    surface.addEventListener('pointerup', up)
    surface.addEventListener('pointercancel', up)
    surface.addEventListener('click', click, true)
    return () => {
      surface.removeEventListener('pointerdown', down)
      surface.removeEventListener('pointermove', move)
      surface.removeEventListener('pointerup', up)
      surface.removeEventListener('pointercancel', up)
      surface.removeEventListener('click', click, true)
    }
  }

  private progress(): number {
    const turn = this.turn
    if (!turn) return 0
    const edge = turn.spine + turn.sheet.w
    return Math.min(1, Math.max(0, (edge - this.finger.x) / (2 * turn.sheet.w)))
  }

  /** The fold that puts the grabbed point of the free edge under the finger. */
  private fold(turn: Turn) {
    const width = turn.sheet.w
    const edge = turn.spine + width
    const progress = this.progress()
    // Past a full turn, or far above or below the page, the finger pulls no further.
    const fingerX = Math.max(turn.spine - width, Math.min(edge, this.finger.x))
    const fingerY = Math.max(turn.sheet.y - turn.sheet.h * 0.25, Math.min(turn.sheet.y + turn.sheet.h * 1.25, this.finger.y))
    const dx = edge - fingerX
    const dy = this.grabY - fingerY
    const tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, Math.atan2(dy, Math.max(dx, 1)))) * (1 - progress)
    const nx = Math.cos(tilt)
    const ny = Math.sin(tilt)
    const reach = dx * nx + dy * ny
    if (reach <= 0.5) return { x: edge + 1, y: this.grabY, nx: 1, ny: 0, radius: 1 }
    const radius = Math.max(0.0001, Math.min(width * RADIUS_SHARE, reach / Math.PI, width * RADIUS_SHARE * 3 * (1 - progress)))
    const along = (reach + Math.PI * radius) / 2
    let x = edge - nx * along
    const y = this.grabY - ny * along
    // The page is bound at the spine: the fold never crosses it, however far the finger goes, so a
    // page cannot be pulled off. Where a tilted fold meets the top or bottom edge decides it.
    const slope = ny / nx
    const reachesSpine = Math.min(x - (turn.sheet.y - y) * slope, x - (turn.sheet.y + turn.sheet.h - y) * slope)
    if (reachesSpine < turn.spine) x += turn.spine - reachesSpine
    return { x, y, nx, ny, radius }
  }

  private draw() {
    const gl = this.gl
    const turn = this.turn
    const program = this.program
    if (!gl || !turn || !program) return
    const dpr = pixelRatio()
    const width = window.innerWidth
    const height = window.innerHeight
    const pixelWidth = Math.round(width * dpr)
    const pixelHeight = Math.round(height * dpr)
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth
      this.canvas.height = pixelHeight
    }
    gl.viewport(0, 0, pixelWidth, pixelHeight)
    gl.clearColor(0, 0, 0, 0)
    gl.clearDepth(1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.depthFunc(gl.LEQUAL)
    gl.useProgram(program)

    const progress = this.progress()
    const coverTurn = turn.front.cover || !!turn.back?.cover
    const fold = coverTurn
      ? { x: turn.spine, y: turn.sheet.y, nx: 1, ny: 0, radius: turn.sheet.w * 0.22 }
      : this.fold(turn)
    const u = (name: string) => this.uniforms.get(name) ?? null
    gl.uniform2f(u('uView'), width, height)
    gl.uniform1f(u('uMirror'), this.context?.mirror ? 1 : 0)
    gl.uniform1f(u('uDepth'), Math.max(width, height) * 2.2)
    gl.uniform4f(u('uFold'), fold.x, fold.y, fold.nx, fold.ny)
    gl.uniform1f(u('uRadius'), fold.radius)
    gl.uniform2f(u('uSwing'), 1 - 2 * progress, 2 * Math.sqrt(progress * (1 - progress)))
    gl.uniform1f(u('uLift'), Math.sin(Math.PI * progress))
    // The lifted page's shadow on the page it uncovers fades as it lies down; flat, it casts none.
    const lift = coverTurn ? Math.sin(Math.PI * progress) : Math.min(1, fold.radius / (turn.sheet.w * RADIUS_SHARE))
    gl.uniform1f(u('uSpine'), turn.spine)
    gl.uniform1f(u('uBookShift'), turn.closing ? progress * turn.sheet.w : 0)
    gl.uniform1f(u('uGutter'), turn.sheet.w * GUTTER_SHARE)
    gl.uniform1i(u('uFront'), 0)
    gl.uniform1i(u('uBack'), 1)

    // Without the pages it needs the drawing would cover the real ones with nothing; show those instead.
    if (!turn.textures.has(turn.front.src) || (turn.right && !turn.textures.has(turn.right.src))) {
      this.hide()
      return
    }
    const part = (name: string, face: Face | null) => {
      const [x, w] = PARTS[face?.part ?? 'whole']
      gl.uniform3f(u(name), x, w, face?.mirrored ? 1 : 0)
    }
    const quad = (face: Face | null, rect: Rect, curl: boolean, shadow: boolean, back: Face | null) => {
      const texture = face ? turn.textures.get(face.src)?.texture : undefined
      if (!face || !texture) return
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      const backTexture = back ? turn.textures.get(back.src) : undefined
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, backTexture?.texture ?? texture)
      part('uFrontPart', face)
      part('uBackPart', backTexture ? back : null)
      gl.uniform3f(u('uFrontPaper'), ...turn.textures.get(face.src)!.paper)
      gl.uniform3f(u('uBackPaper'), ...(backTexture ?? turn.textures.get(face.src)!).paper)
      gl.uniform4f(u('uRect'), rect.x, rect.y, rect.w, rect.h)
      gl.uniform1f(u('uCurl'), curl ? 1 : 0)
      gl.uniform1f(u('uZ'), curl ? 0 : -1)
      gl.uniform1f(u('uShadow'), shadow ? lift : 0)
      gl.uniform1f(u('uHasBack'), backTexture ? 1 : 0)
      const cover = face.cover || !!back?.cover
      gl.uniform1f(u('uCover'), cover ? 1 : 0)
      gl.uniform2f(u('uCoverSides'), face.cover ? 1 : 0, (back?.cover ?? face.cover) ? 1 : 0)
      gl.uniform2f(u('uWear'), ...pageWear(face.page))
      gl.uniform1f(u('uThickness'), cover ? Math.max(0.45, Math.min(1.1, turn.sheet.w * 0.0018)) : 0)
      gl.uniform1f(u('uLayer'), 0)
      gl.uniform1f(u('uEdge'), 0)
      gl.drawElements(gl.TRIANGLES, curl ? this.indexCount : 6, gl.UNSIGNED_SHORT, curl ? 0 : this.indexCount * 2)
      if (curl && cover) {
        gl.uniform1f(u('uLayer'), -1)
        gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0)
        gl.uniform1f(u('uLayer'), 0)
        gl.uniform1f(u('uEdge'), 1)
        gl.drawElements(gl.TRIANGLES, this.edgeCount, gl.UNSIGNED_SHORT, (this.indexCount + 6) * 2)
      }
    }
    // A face keeps its own shape inside its page's slot, against the spine.
    const fitted = (face: Face | null, slot: Rect, anchorRight: boolean) => {
      const texture = face ? turn.textures.get(face.src) : undefined
      if (!texture) return slot
      const aspect = texture.aspect * PARTS[face!.part][1]
      // A page the shape of its slot fills it exactly, as the real page does; fitting it would round a pixel off.
      return Math.abs(slot.w / slot.h - aspect) < aspect * 0.03 ? slot : fitInto(slot, aspect, anchorRight)
    }

    quad(turn.left, fitted(turn.left, turn.leftSlot, true), false, true, null)
    quad(turn.right, fitted(turn.right, turn.rightSlot, false), false, true, null)
    quad(turn.front, turn.sheet, true, false, turn.back)
  }

  private setUp(gl: WebGL2RenderingContext) {
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      return shader
    }
    const program = gl.createProgram()
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT))
    gl.bindAttribLocation(program, 0, 'aUv')
    gl.bindAttribLocation(program, 1, 'aLayer')
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      this.gl = null
      return
    }
    this.program = program
    for (const name of ['uRect', 'uView', 'uMirror', 'uDepth', 'uFold', 'uRadius', 'uCurl', 'uZ', 'uCover', 'uCoverSides', 'uSwing', 'uLift', 'uThickness', 'uLayer', 'uEdge', 'uWear', 'uBookShift', 'uFront', 'uBack', 'uHasBack', 'uShadow', 'uFrontPart', 'uBackPart', 'uFrontPaper', 'uBackPaper', 'uSpine', 'uGutter']) {
      this.uniforms.set(name, gl.getUniformLocation(program, name))
    }

    const meshVertices = (COLUMNS + 1) * (ROWS + 1)
    const segments = 2 * (COLUMNS + ROWS)
    const vertices = new Float32Array((meshVertices + segments * 4) * 3)
    let v = 0
    for (let row = 0; row <= ROWS; row++) {
      for (let column = 0; column <= COLUMNS; column++) {
        vertices[v++] = column / COLUMNS
        vertices[v++] = row / ROWS
        vertices[v++] = 0
      }
    }
    const indices = new Uint16Array(COLUMNS * ROWS * 6 + 6 + segments * 6)
    let i = 0
    for (let row = 0; row < ROWS; row++) {
      for (let column = 0; column < COLUMNS; column++) {
        const a = row * (COLUMNS + 1) + column
        const b = a + COLUMNS + 1
        indices.set([a, b, a + 1, a + 1, b, b + 1], i)
        i += 6
      }
    }
    this.indexCount = i
    indices.set([0, ROWS * (COLUMNS + 1), COLUMNS, COLUMNS, ROWS * (COLUMNS + 1), meshVertices - 1], i)
    i += 6
    const edge = (x0: number, y0: number, x1: number, y1: number) => {
      const a = v / 3
      vertices.set([x0, y0, 0, x0, y0, -1, x1, y1, 0, x1, y1, -1], v)
      v += 12
      indices.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], i)
      i += 6
    }
    for (let c = 0; c < COLUMNS; c++) {
      edge(c / COLUMNS, 0, (c + 1) / COLUMNS, 0)
      edge(c / COLUMNS, 1, (c + 1) / COLUMNS, 1)
    }
    for (let r = 0; r < ROWS; r++) {
      edge(0, r / ROWS, 0, (r + 1) / ROWS)
      edge(1, r / ROWS, 1, (r + 1) / ROWS)
    }
    this.edgeCount = segments * 6
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
  }
}
