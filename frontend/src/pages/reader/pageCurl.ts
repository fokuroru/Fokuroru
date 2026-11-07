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
uniform vec4 uRect;
uniform vec2 uView;
uniform float uMirror;
uniform float uDepth;
uniform vec4 uFold;
uniform float uRadius;
uniform float uCurl;
uniform float uZ;
out vec2 vUv;
out vec3 vNormal;
out float vBeyond;
void main() {
  vec2 p = uRect.xy + aUv * uRect.zw;
  vec3 pos = vec3(p, uZ);
  vec3 normal = vec3(0.0, 0.0, 1.0);
  float s = dot(p - uFold.xy, uFold.zw);
  if (uCurl > 0.5 && s > 0.0) {
    vec2 n = uFold.zw;
    float r = max(uRadius, 0.0001);
    vec2 base = p - n * s;
    if (s < 3.14159265 * r) {
      float a = s / r;
      pos = vec3(base + n * r * sin(a), r * (1.0 - cos(a)));
      normal = vec3(-n * sin(a), cos(a));
    } else {
      pos = vec3(base - n * (s - 3.14159265 * r), 2.0 * r + 0.5);
      normal = vec3(0.0, 0.0, -1.0);
    }
  }
  vUv = aUv;
  vNormal = normal;
  vBeyond = s;
  float x = mix(pos.x, uView.x - pos.x, uMirror);
  float w = uDepth - pos.z;
  gl_Position = vec4((x / uView.x * 2.0 - 1.0) * uDepth, (1.0 - pos.y / uView.y * 2.0) * uDepth, -pos.z / uDepth * 2.0 * w, w);
}`

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vNormal;
in float vBeyond;
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform float uHasBack;
uniform float uShadow;
uniform float uRadius;
uniform float uThrough;
out vec4 outColor;
const vec3 PAPER = vec3(0.96, 0.95, 0.92);
const vec3 LIGHT = vec3(-0.3, -0.4, 0.87);
void main() {
  vec3 n = normalize(vNormal);
  bool back = n.z < 0.0;
  vec3 colour;
  if (!back && uThrough > 0.5) {
    // A blank facing page: the back of the page before it, the print faint and mirrored.
    colour = mix(texture(uFront, vec2(1.0 - vUv.x, vUv.y)).rgb, PAPER, 0.9);
  } else if (!back) {
    colour = texture(uFront, vUv).rgb;
  } else if (uHasBack > 0.5) {
    colour = texture(uBack, vec2(1.0 - vUv.x, vUv.y)).rgb;
  } else {
    // The back of a lone page: paper, with the print showing through, mirrored as it would be.
    colour = mix(texture(uFront, vUv).rgb, PAPER, 0.9);
  }
  vec3 facing = back ? -n : n;
  float light = (0.55 + 0.45 * max(dot(facing, LIGHT), 0.0)) / (0.55 + 0.45 * LIGHT.z);
  // The lifted sheet shades the page it uncovers, darkest under the roll.
  float shade = uShadow * (vBeyond > 0.0 ? 0.45 * exp(-vBeyond / (uRadius * 1.5 + 10.0)) : 0.0);
  outColor = vec4(colour * min(light, 1.08) * (1.0 - shade), 1.0);
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

interface Texture {
  texture: WebGLTexture
  aspect: number
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** One turn, in left-to-right space. Progress runs 0 (sheet flat on the right) to 1 (on the left). */
interface Turn {
  forward: boolean
  targetKey: string
  spine: number
  sheet: Rect
  leftSlot: Rect | null
  /** The left page is a blank facing page, drawn as the back of `left` (plain paper when null). */
  leftThrough: boolean
  rightSlot: Rect
  front: string
  back: string | null
  left: string | null
  right: string | null
}

export interface CurlContext {
  urls: string[]
  current: Spread
  next: Spread | null
  previous: Spread | null
  /** The spread before `previous`: what shows through the blank facing page after a turn back. */
  beforePrevious: Spread | null
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
const PAPER_RGB = [245, 242, 235]

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
 * Whether a released drag finishes the turn: where the page would coast to at the drag's speed,
 * past halfway. The speed is taken over the last stretch of the drag rather than the last few
 * events, because a mouse reports every millisecond and the wobble as the button comes up read as
 * a flick the other way. Positions are in left-to-right space; progress runs 0 to 1.
 */
export function releaseCompletes(samples: Sample[], upTime: number, progress: number, forward: boolean, sheetWidth: number) {
  const first = samples[0]
  const last = samples[samples.length - 1]
  const velocity = first && last ? (last.x - first.x) / Math.max(upTime - first.t, VELOCITY_MS) : 0
  const coasted = progress - (velocity * COAST_MS) / (2 * sheetWidth)
  return forward ? coasted > 0.5 : coasted < 0.5
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export class PageCurl {
  private gl: WebGL2RenderingContext | null
  private program: WebGLProgram | null = null
  private uniforms = new Map<string, WebGLUniformLocation | null>()
  private indexCount = 0
  private textures = new Map<string, Promise<Texture | null>>()
  private ready = new Map<string, Texture>()
  private paper: WebGLTexture | null = null
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

  private canvas: HTMLCanvasElement
  private host: HTMLElement
  private onTurn: (forward: boolean) => void
  private onBusy: (busy: boolean) => void

  constructor(
    canvas: HTMLCanvasElement,
    host: HTMLElement,
    onTurn: (forward: boolean) => void,
    onBusy: (busy: boolean) => void,
  ) {
    this.canvas = canvas
    this.host = host
    this.onTurn = onTurn
    this.onBusy = onBusy
    this.gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: true, alpha: true })
    if (this.gl) this.setUp(this.gl)
  }

  update(context: CurlContext) {
    if (this.context && this.context.urls !== context.urls) this.stop()
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
      for (const spread of [context.current, context.next, context.previous, context.beforePrevious]) {
        for (const page of spread ?? []) if (context.urls[page]) void this.texture(context.urls[page])
      }
    }
  }

  dispose() {
    this.stop()
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
    void this.prepare(turn).then((ok) => {
      this.onBusy(false)
      if (!ok || generation !== this.generation) return
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
    this.animating = false
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
    delete this.host.dataset.curling
    this.turn = null
    this.landingKey = null
    clearTimeout(this.hideTimer)
  }

  private landed() {
    if (!this.turn) return
    if (this.settledKey === this.landingKey) this.hide()
  }

  /** Where everything sits, read off the pages on screen now. Null when this turn is not drawn. */
  private plan(from: Spread, to: Spread, forward: boolean): Turn | null {
    const context = this.context
    if (!context?.enabled || !this.gl || reducedMotion()) return null
    const book = from.length === 2 && to.length === 2
    if (!book && (from.length !== 1 || to.length !== 1)) return null
    const urls = context.urls
    const width = window.innerWidth
    const rectsOf = (selector: string) =>
      [...this.host.querySelectorAll<HTMLElement>(selector)]
        .filter((element) => getComputedStyle(element).visibility !== 'hidden')
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
          x: context.mirror ? width - rect.right : rect.left,
          y: rect.top,
          w: rect.width,
          h: rect.height,
        }))
        .sort((a, b) => a.x - b.x)
    const rects = rectsOf('.reader-page:not(.reader-blank)')
    const blank = rectsOf('.reader-blank')[0] ?? null
    if (rects.length === 0) return null
    const targetKey = keyOf(to)
    if (book) {
      if (rects.length !== 2) return null
      const [leftSlot, rightSlot] = rects as [Rect, Rect]
      const spine = leftSlot.x + leftSlot.w
      const sheet = { ...rightSlot, x: spine }
      // In left-to-right space the earlier page of a spread is always the left one.
      const [fromLeft, fromRight] = from.map((page) => urls[page]!)
      const [toLeft, toRight] = to.map((page) => urls[page]!)
      return forward
        ? { forward, targetKey, spine, sheet, leftSlot, leftThrough: false, rightSlot, front: fromRight!, back: toLeft!, left: fromLeft!, right: toRight! }
        : { forward, targetKey, spine, sheet, leftSlot, leftThrough: false, rightSlot, front: toRight!, back: fromLeft!, left: toLeft!, right: fromRight! }
    }
    const rect = rects[0]!
    const fromSrc = urls[from[0]!]!
    const toSrc = urls[to[0]!]!
    // An aligned page has a blank facing page: the back of the page before whichever is the sheet.
    const behind = forward ? context.previous : context.beforePrevious
    return {
      forward,
      targetKey,
      spine: rect.x,
      sheet: rect,
      leftSlot: blank,
      leftThrough: true,
      rightSlot: rect,
      front: forward ? fromSrc : toSrc,
      back: null,
      left: blank && behind ? (urls[behind[0]!] ?? null) : null,
      right: forward ? toSrc : fromSrc,
    }
  }

  /** Loads the turn's pages. A drag waits as long as the finger is down; a tap or key turn gives up quickly. */
  private prepare(turn: Turn, patient = false): Promise<boolean> {
    const sources = [turn.front, turn.back, turn.left, turn.right].filter((src): src is string => src !== null)
    const loaded = Promise.all(sources.map((src) => this.texture(src))).then((all) => all.every(Boolean))
    if (patient) return loaded
    // A tap never waits on a slow decode: past this the page turns without the drawing.
    const late = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PREPARE_MS))
    return Promise.race([loaded, late])
  }

  /** Textures are shaped to the sheet, so the same page at another sheet size is another texture. */
  private keyFor(src: string) {
    return `${src}|${this.context?.sheetAspect ?? ''}|${this.context?.sheetFill ?? ''}`
  }

  private texture(src: string): Promise<Texture | null> {
    const key = this.keyFor(src)
    const sheet = this.context?.sheetAspect ?? null
    const fill = this.context?.sheetFill ?? 'stretch'
    const known = this.textures.get(key)
    if (known) return known
    const loading = (async () => {
      const gl = this.gl
      if (!gl) return null
      const image = new Image()
      image.src = heldPageUrl(src) ?? src
      try {
        await image.decode()
      } catch {
        return null
      }
      const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, 2048)
      const natural = image.naturalWidth / image.naturalHeight
      // A two-page spread scan keeps its own shape, as it does on screen.
      const shaped = natural <= 1 ? sheet : null
      const aspect = shaped ?? natural
      // Keep the page's width; the sheet sets the height (a short page comes out taller).
      const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalWidth / aspect))
      let source: TexImageSource = image
      if (scale < 1 || shaped !== null) {
        const copy = document.createElement('canvas')
        copy.width = Math.round(image.naturalWidth * scale)
        copy.height = Math.round((image.naturalWidth / aspect) * scale)
        const draw = copy.getContext('2d')
        if (shaped !== null && fill === 'enlarge') {
          const cover = Math.max(copy.width / image.naturalWidth, copy.height / image.naturalHeight)
          const w = image.naturalWidth * cover
          const h = image.naturalHeight * cover
          draw?.drawImage(image, (copy.width - w) / 2, (copy.height - h) / 2, w, h)
        } else {
          draw?.drawImage(image, 0, 0, copy.width, copy.height)
        }
        source = copy
      }
      const texture = gl.createTexture()
      if (!texture) return null
      gl.bindTexture(gl.TEXTURE_2D, texture)
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
      } catch {
        gl.deleteTexture(texture)
        return null
      }
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const result = { texture, aspect }
      this.ready.set(key, result)
      this.evict()
      return result
    })()
    this.textures.set(key, loading)
    return loading
  }

  private evict() {
    const turn = this.turn
    const inUse = new Set(
      [turn?.front, turn?.back, turn?.left, turn?.right].filter((src): src is string => !!src).map((src) => this.keyFor(src)),
    )
    for (const key of this.ready.keys()) {
      if (this.ready.size <= TEXTURE_CACHE) break
      if (inUse.has(key)) continue
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
        void this.prepare(turn, true).then((ok) => {
          if (!ok || generation !== this.generation || !this.pointer) return
          this.turn = turn
          this.show()
          this.draw()
        })
      }
      event.preventDefault()
      this.finger = { x: x + pointer.offset, y: event.clientY }
      addSample(pointer.history, { x, t: event.timeStamp })
      if (this.turn) this.draw()
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
    const dx = edge - this.finger.x
    const dy = this.grabY - this.finger.y
    const tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, Math.atan2(dy, Math.max(dx, 1)))) * (1 - progress)
    const nx = Math.cos(tilt)
    const ny = Math.sin(tilt)
    const reach = dx * nx + dy * ny
    if (reach <= 0.5) return { x: edge + 1, y: this.grabY, nx: 1, ny: 0, radius: 1 }
    const radius = Math.max(0.5, Math.min(width * RADIUS_SHARE, reach / Math.PI, width * RADIUS_SHARE * 3 * (1 - progress)))
    const along = (reach + Math.PI * radius) / 2
    return { x: edge - nx * along, y: this.grabY - ny * along, nx, ny, radius }
  }

  private draw() {
    const gl = this.gl
    const turn = this.turn
    const program = this.program
    if (!gl || !turn || !program) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
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
    gl.depthFunc(gl.LEQUAL)
    gl.useProgram(program)

    const fold = this.fold(turn)
    const u = (name: string) => this.uniforms.get(name) ?? null
    gl.uniform2f(u('uView'), width, height)
    gl.uniform1f(u('uMirror'), this.context?.mirror ? 1 : 0)
    gl.uniform1f(u('uDepth'), Math.max(width, height) * 2.2)
    gl.uniform4f(u('uFold'), fold.x, fold.y, fold.nx, fold.ny)
    gl.uniform1f(u('uRadius'), fold.radius)
    gl.uniform1i(u('uFront'), 0)
    gl.uniform1i(u('uBack'), 1)

    const quad = (src: string | null, rect: Rect, curl: boolean, shadow: boolean, back: string | null, through = false) => {
      const found = src ? this.ready.get(this.keyFor(src))?.texture : undefined
      const texture = found ?? (through ? this.paper : null)
      if (!texture) return
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      const backTexture = back ? this.ready.get(this.keyFor(back)) : undefined
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, backTexture?.texture ?? texture)
      gl.uniform1f(u('uThrough'), through ? 1 : 0)
      gl.uniform4f(u('uRect'), rect.x, rect.y, rect.w, rect.h)
      gl.uniform1f(u('uCurl'), curl ? 1 : 0)
      gl.uniform1f(u('uZ'), curl ? 0 : -1)
      gl.uniform1f(u('uShadow'), shadow ? 1 : 0)
      gl.uniform1f(u('uHasBack'), backTexture ? 1 : 0)
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0)
    }
    const fitted = (src: string | null, slot: Rect, anchorRight: boolean) => {
      const texture = src ? this.ready.get(this.keyFor(src)) : undefined
      return texture ? fitInto(slot, texture.aspect, anchorRight) : slot
    }

    if (turn.leftSlot && turn.leftThrough) quad(turn.left, turn.leftSlot, false, false, null, true)
    else if (turn.leftSlot) quad(turn.left, fitted(turn.left, turn.leftSlot, true), false, false, null)
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
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      this.gl = null
      return
    }
    this.program = program
    for (const name of ['uRect', 'uView', 'uMirror', 'uDepth', 'uFold', 'uRadius', 'uCurl', 'uZ', 'uFront', 'uBack', 'uHasBack', 'uShadow', 'uThrough']) {
      this.uniforms.set(name, gl.getUniformLocation(program, name))
    }

    this.paper = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.paper)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([...PAPER_RGB, 255]))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

    const vertices = new Float32Array((COLUMNS + 1) * (ROWS + 1) * 2)
    let v = 0
    for (let row = 0; row <= ROWS; row++) {
      for (let column = 0; column <= COLUMNS; column++) {
        vertices[v++] = column / COLUMNS
        vertices[v++] = row / ROWS
      }
    }
    const indices = new Uint16Array(COLUMNS * ROWS * 6)
    let i = 0
    for (let row = 0; row < ROWS; row++) {
      for (let column = 0; column < COLUMNS; column++) {
        const a = row * (COLUMNS + 1) + column
        const b = a + COLUMNS + 1
        indices.set([a, b, a + 1, a + 1, b, b + 1], i)
        i += 6
      }
    }
    this.indexCount = indices.length
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
  }
}
