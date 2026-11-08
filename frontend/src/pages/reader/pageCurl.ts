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

/** One unit of the fold's shadow at the spine, as a share of a page's width. */
export const GUTTER_SHARE = 0.06
// The fold's shadow by distance from the spine in GUTTER_SHARE units: dark at the binding, an
// exponential falloff, and a smooth fade to nothing so it has no edge where it stops.
// `core` rounds the darkest point, so the two sides meet in a curve rather than a crease line.
const GUTTER = { depth: 0.24, fall: 1.3, fade: 2.5, reach: 5, core: 0.45 }
export const GUTTER_REACH = GUTTER.reach
const GUTTER_GLSL = Object.entries(GUTTER)
  .map(([name, value]) => `const float GUTTER_${name.toUpperCase()} = ${value.toFixed(4)};`)
  .join('\n')
export function gutterShade(t: number): number {
  const k = Math.max(0, Math.min(1, (t - GUTTER.fade) / (GUTTER.reach - GUTTER.fade)))
  const from = Math.hypot(t, GUTTER.core) - GUTTER.core
  return GUTTER.depth * Math.exp(-from / GUTTER.fall) * (1 - k * k * (3 - 2 * k))
}
/**
 * The fold as a CSS gradient across a box reaching GUTTER_REACH units out on the sides that have a
 * fold, the spine at its centre when both do. One box, so no seam can open at the spine.
 */
export function gutterGradient(left: boolean, right: boolean): string {
  const steps = 20
  const share = 100 / ((left ? 1 : 0) + (right ? 1 : 0))
  const stops: string[] = []
  const stop = (t: number, at: number) => stops.push(`rgba(0, 0, 0, ${gutterShade(t).toFixed(4)}) ${at.toFixed(2)}%`)
  if (left) for (let i = steps; i >= 0; i--) stop((i / steps) * GUTTER.reach, ((steps - i) / steps) * share)
  if (right) for (let i = left ? 1 : 0; i <= steps; i++) stop((i / steps) * GUTTER.reach, (left ? share : 0) + (i / steps) * share)
  return `linear-gradient(to right, ${stops.join(', ')})`
}

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
uniform float uLift;
uniform float uSpine;
uniform float uBookShift;
uniform float uThickness;
uniform float uLayer;
uniform vec2 uWear;
out vec2 vUv;
out vec3 vNormal;
out float vBeyond;
out float vFlatX;
out float vWorldX;
void main() {
  vec2 p = uRect.xy + aUv * uRect.zw;
  vFlatX = p.x;
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
      pos = vec3(base - n * (s - 3.14159265 * r), 2.0 * r);
      normal = vec3(0.0, 0.0, -1.0);
    }
  }
  if (uCurl > 0.5) {
    float wave = sin(3.14159265 * aUv.x) * sin(6.2831853 * aUv.y + uWear.x);
    float mark = 0.0;
    if (uWear.y > 0.5) {
      if (uWear.x < 3.14159265) {
        mark = smoothstep(0.8, 1.0, aUv.x) * smoothstep(0.82, 1.0, aUv.y);
      } else {
        float dy = (aUv.y - 0.35 - 0.15 * sin(uWear.x)) / 0.08;
        mark = exp(-dy * dy) * smoothstep(0.65, 1.0, aUv.x);
      }
    }
    // Only paper off the page ripples: on the part still lying flat the wave dipped below the page
    // underneath, which then showed through in strips beside the spine.
    float lifted = smoothstep(0.0, max(uRadius, 1.0), s);
    float ripple = uRect.z * (0.002 * wave + 0.014 * mark) * uLift * lifted;
    pos += normal * (ripple * (uCover > 0.5 ? 0.55 : 1.0) + (aLayer + uLayer) * uThickness);
    // A sheet never sinks below the pages it lies on (a cover's underside is its own layer).
    if (uCover < 0.5) pos.z = max(pos.z, 0.0);
  }
  // The scene is mirrored for right-to-left; the pictures on it must not be.
  vUv = vec2(mix(aUv.x, 1.0 - aUv.x, uMirror), aUv.y);
  vNormal = normal;
  vBeyond = s;
  vWorldX = pos.x;
  pos.x += uBookShift;
  float x = mix(pos.x, uView.x - pos.x, uMirror);
  // Perspective only for paper lifted off the book: pages lying under it sit a unit lower for the
  // depth test, and shrinking them by that unit moved their print a fraction of a pixel.
  float w = uDepth - max(pos.z, 0.0);
  gl_Position = vec4((x / uView.x * 2.0 - 1.0) * uDepth, (1.0 - pos.y / uView.y * 2.0) * uDepth, -pos.z / uDepth * 2.0 * w, w);
}`

const FRAGMENT = `#version 300 es
precision highp float;
${GUTTER_GLSL}
in vec2 vUv;
in vec3 vNormal;
in float vBeyond;
in float vFlatX;
in float vWorldX;
uniform float uCurl;
uniform vec4 uFold;
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
uniform float uEdge;
uniform vec3 uFrontPart;
uniform vec3 uBackPart;
// Each page's own paper colour, which print seen from the other side fades into.
uniform vec3 uFrontPaper;
uniform vec3 uBackPaper;
uniform float uLift;
out vec4 outColor;
const vec3 LIGHT = vec3(-0.3, -0.4, 0.87);
// Print seen through the paper from the other side: faded into that page's paper.
const float THROUGH = 0.7;
// Keep in step with gutterShade() in pageCurl.ts: the page's CSS fold is drawn from the same curve.
float gutterShade(float t) {
  float away = sqrt(t * t + GUTTER_CORE * GUTTER_CORE) - GUTTER_CORE;
  return GUTTER_DEPTH * exp(-away / GUTTER_FALL) * (1.0 - smoothstep(GUTTER_FADE, GUTTER_REACH, t));
}
vec2 within(vec3 part, float u, float v) {
  float s = part.z > 0.5 ? 1.0 - u : u;
  return vec2(part.x + s * part.y, v);
}
void main() {
  if (uEdge > 0.5) {
    outColor = vec4(0.78, 0.75, 0.68, 1.0);
    return;
  }
  // Which side of the paper faces the eye, worked out here from the distance past the fold rather
  // than blended between mesh vertices: once the roll is narrower than a mesh column, the blended
  // normal flipped midway across it and a strip of the page's front showed at the spine.
  vec3 n = vec3(0.0, 0.0, 1.0);
  if (uCurl > 0.5 && vBeyond > 0.0) {
    float a = min(vBeyond / max(uRadius, 0.0001), 3.14159265);
    n = vec3(-uFold.zw * sin(a), cos(a));
  }
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
  // Along the paper while it is lifted; across the book as it lands, where the resting fold is.
  float fromSpine = mix(abs(vWorldX - uSpine), abs(vFlatX - uSpine), uLift);
  float gutter = uGutter > 0.0 && outerCover < 0.5 ? gutterShade(fromSpine / uGutter) : 0.0;
  // Keep paper opaque: edge-alpha masking can discard entire faces in Firefox.
  // Paper has a faint sheen where the curl catches the light; none once it lies flat again.
  float sheen = uLift * 0.07 * pow(max(dot(reflect(-LIGHT, facing), vec3(0.0, 0.0, 1.0)), 0.0), 18.0);
  // Lit as a curve only while lifted: as it lands it takes the flat paper's light, so no bright edge is left.
  outColor = vec4(colour * mix(1.0, min(light, 1.08), uLift * uLift) * (1.0 - shade) * (1.0 - gutter) + sheen, 1.0);
}`

const COLUMNS = 96
/**
 * Where mesh column `c` sits across the sheet, 0 at the spine to 1 at the free edge. Dense at both
 * ends, where the fold is tight (the hinge as a turn lands, the corner as it lifts): a fold between
 * two vertices left the stretch between them uncovered, and the page underneath showed through.
 */
export function columnAt(c: number): number {
  return 0.5 - 0.5 * Math.cos((Math.PI * c) / COLUMNS)
}
const ROWS = 24
const DRAG_SLOP = 8
const TEXTURE_CACHE = 8
const RADIUS_SHARE = 0.14
/** A softcover curls like a page but over a roll this much wider: card bends, it does not crease. */
const COVER_RADIUS_SHARE = 0.34
const MAX_TILT = 0.5
const PREPARE_MS = 300
const VELOCITY_MS = 80
const COAST_MS = 300
/** How long a landed turn's drawing takes to fade into the real pages. Matches .reader-paged[data-handoff]. */
const HANDOFF_MS = 160
/** Share of a page's width the finger has to cross for a released drag to turn the page. */
const TURN_SHARE = 0.4

function leafSeed(page: number, book: string): number {
  let bookSeed = 0
  for (let i = 0; i < book.length; i++) bookSeed = (Math.imul(bookSeed, 31) + book.charCodeAt(i)) | 0
  const mixed = Math.imul(page + 1, 2654435761) ^ bookSeed
  return Math.imul(mixed ^ (mixed >>> 16), 2246822507) >>> 0
}

/** Fixed per leaf: wear must never change when a page is redrawn. */
export function pageWear(page: number, book = ''): [number, number] {
  const seed = leafSeed(page, book)
  return [(seed / 0xffffffff) * Math.PI * 2, seed % 19 === 0 ? 1 : 0]
}

export type PageMark = 'foxing' | 'crease' | 'yellowed' | 'smudge' | 'ring'

/** A page's own random source, seeded by the leaf so its marks never move. */
function leafRandom(page: number, book: string) {
  let state = leafSeed(page, book) ^ 0x9e3779b9
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The one mark a leaf carries, if any: about one page in eight. */
export function pageMark(page: number, book = ''): PageMark | null {
  const roll = leafRandom(page, book)()
  if (roll < 0.03) return 'foxing'
  if (roll < 0.055) return 'crease'
  if (roll < 0.095) return 'yellowed'
  if (roll < 0.115) return 'smudge'
  if (roll < 0.122) return 'ring'
  return null
}

/**
 * Paints a leaf's mark over its page, in the page's own image space. The drawn turn paints it into
 * the page's texture and the real page gets it as an overlay, so both show the same mark.
 */
export function drawPageMark(draw: CanvasRenderingContext2D, width: number, height: number, page: number, book = '') {
  const mark = pageMark(page, book)
  if (!mark) return
  const random = leafRandom(page, book)
  random()
  const unit = Math.min(width, height)
  const spot = (x: number, y: number, radius: number, colour: string, alpha: number) => {
    const gradient = draw.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, `rgba(${colour}, ${alpha})`)
    gradient.addColorStop(0.55, `rgba(${colour}, ${alpha * 0.6})`)
    gradient.addColorStop(1, `rgba(${colour}, 0)`)
    draw.fillStyle = gradient
    draw.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  }
  draw.save()
  if (mark === 'foxing') {
    // Small rust spots, clustered towards one edge.
    const cx = (random() < 0.5 ? 0.06 + random() * 0.2 : 0.74 + random() * 0.2) * width
    const cy = (0.08 + random() * 0.84) * height
    const count = 4 + Math.floor(random() * 7)
    for (let i = 0; i < count; i++) {
      const x = cx + (random() - 0.5) * unit * 0.16
      const y = cy + (random() - 0.5) * unit * 0.22
      spot(x, y, unit * (0.004 + random() * 0.011), '150, 100, 50', 0.12 + random() * 0.12)
    }
  } else if (mark === 'crease') {
    // A fold pressed flat again, cutting a corner: a dark line with a lighter ridge beside it.
    const top = random() < 0.5
    const right = random() < 0.5
    const a = { x: (right ? 1 - random() * 0.35 : random() * 0.35) * width, y: top ? 0 : height }
    const b = { x: right ? width : 0, y: (top ? random() * 0.4 : 1 - random() * 0.4) * height }
    const sag = (random() - 0.5) * unit * 0.03
    const line = (offset: number, colour: string, lineWidth: number) => {
      draw.beginPath()
      draw.moveTo(a.x + offset, a.y)
      draw.quadraticCurveTo((a.x + b.x) / 2 + sag + offset, (a.y + b.y) / 2 + sag, b.x + offset, b.y)
      draw.strokeStyle = colour
      draw.lineWidth = lineWidth
      draw.stroke()
    }
    line(0, 'rgba(70, 60, 45, 0.16)', unit * 0.0026)
    line(unit * 0.0026, 'rgba(255, 255, 250, 0.3)', unit * 0.002)
  } else if (mark === 'yellowed') {
    // Paper aged from its edges in.
    const depth = unit * (0.04 + random() * 0.05)
    const alpha = 0.07 + random() * 0.07
    const edge = (x0: number, y0: number, x1: number, y1: number, strength: number) => {
      const gradient = draw.createLinearGradient(x0, y0, x1, y1)
      gradient.addColorStop(0, `rgba(175, 140, 75, ${alpha * strength})`)
      gradient.addColorStop(1, 'rgba(175, 140, 75, 0)')
      draw.fillStyle = gradient
      draw.fillRect(0, 0, width, height)
    }
    const heavy = Math.floor(random() * 4)
    edge(0, 0, depth, 0, heavy === 0 ? 1.6 : 1)
    edge(width, 0, width - depth, 0, heavy === 1 ? 1.6 : 1)
    edge(0, 0, 0, depth, heavy === 2 ? 1.6 : 1)
    edge(0, height, 0, height - depth, heavy === 3 ? 1.6 : 1)
  } else if (mark === 'smudge') {
    // A thumb that held the page near a lower corner.
    const x = (random() < 0.5 ? 0.06 + random() * 0.1 : 0.84 + random() * 0.1) * width
    const y = (0.78 + random() * 0.16) * height
    draw.translate(x, y)
    draw.rotate((random() - 0.5) * 1.2)
    draw.scale(1, 1.35)
    spot(0, 0, unit * (0.035 + random() * 0.025), '70, 62, 52', 0.06 + random() * 0.04)
  } else {
    // The ring a mug left.
    const x = (0.2 + random() * 0.6) * width
    const y = (0.15 + random() * 0.7) * height
    const radius = unit * (0.05 + random() * 0.04)
    draw.beginPath()
    for (let i = 0; i <= 48; i++) {
      const angle = (i / 48) * Math.PI * 2
      const r = radius * (1 + 0.025 * Math.sin(angle * 3 + x) + 0.015 * Math.sin(angle * 7 + y))
      if (i === 0) draw.moveTo(x + r, y)
      else draw.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r)
    }
    draw.strokeStyle = 'rgba(140, 95, 50, 0.17)'
    draw.lineWidth = unit * 0.006
    draw.stroke()
    spot(x, y, radius, '160, 120, 70', 0.04)
  }
  draw.restore()
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

export type SheetFill = 'stretch' | 'enlarge' | 'pad'

/** A paper tone as a CSS colour. */
export function toneColour([r, g, b]: [number, number, number]): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
}

/** Which part of a page's image a face shows: all of it, or one half of a two-page spread. */
export type FacePart = 'whole' | 'left' | 'right'

/** One side of one leaf of the book. `mirrored` is the back of a sheet showing its print through. */
export interface Face {
  page: number
  /** Card stock: a cover, or the inside of one. */
  cover: boolean
  /** The outside of the book (front or back cover), which has no fold at the spine. */
  outside: boolean
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
  /** How a page of another shape fills the sheet: stretched, enlarged and cropped, or padded with its own paper. */
  sheetFill: SheetFill
  /** Drawn turns at all: plain pages at 1x. */
  enabled: boolean
  /** Turns that follow the pointer as well: the page does not scroll sideways. */
  draggable: boolean
}

const keyOf = (spread: Spread) => spread.join(',')

const easeOut = (t: number) => 1 - (1 - t) ** 3
const smoothstep = (from: number, to: number, t: number) => {
  const k = Math.max(0, Math.min(1, (t - from) / (to - from)))
  return k * k * (3 - 2 * k)
}
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
  // Phones run at up to 3.5x. Drawn at less, the turn was softer than the page it hands back to.
  return Math.min(window.devicePixelRatio || 1, 3)
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
  private handoffTimer = 0
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
    this.endHandoff()
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
      // A hand never takes the same corner at the same pace twice.
      const edge = turn.spine + turn.sheet.w
      const y = turn.sheet.y + turn.sheet.h * (0.66 + Math.random() * 0.26)
      this.grabY = y
      const rise = turn.sheet.h * (0.04 + Math.random() * 0.07)
      const start = forward ? { x: edge, y } : { x: turn.spine - turn.sheet.w, y: y - rise }
      const end = forward ? { x: turn.spine - turn.sheet.w, y: y - rise } : { x: edge, y }
      this.finger = { ...start }
      this.show()
      this.draw()
      this.animate(start, end, 470 + Math.random() * 140, easeInOut, () => this.landed(), turn.sheet.h * (0.03 + Math.random() * 0.04))
    })
  }

  /** The spread on screen underneath, so the drawing can go once the real pages are up. */
  settled(key: string) {
    this.settledKey = key
    if (!this.animating && this.landingKey === key) this.hide(true)
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
    this.endHandoff()
    clearTimeout(this.hideTimer)
    this.hideTimer = window.setTimeout(() => {
      if (!this.animating && !this.pointer) this.hide()
    }, 2500)
  }

  /**
   * The drawing goes and the real pages come back. A landed turn's last frame matches them, so it
   * fades out over them rather than cutting: a large page painted a frame late, or resampled a
   * shade differently, no longer pops. A turn cut off mid-way goes at once.
   */
  private hide(fade = false) {
    const shown = this.host.dataset.curling !== undefined
    delete this.host.dataset.curling
    this.turn = null
    this.pinned.clear()
    this.landingKey = null
    clearTimeout(this.hideTimer)
    if (!shown) return
    if (!fade || this.disposed) {
      this.endHandoff()
      this.onIdle()
      return
    }
    this.host.dataset.handoff = ''
    this.handoffTimer = window.setTimeout(() => {
      this.endHandoff()
      this.onIdle()
    }, HANDOFF_MS)
  }

  private endHandoff() {
    clearTimeout(this.handoffTimer)
    delete this.host.dataset.handoff
  }

  private landed() {
    if (!this.turn) return
    if (this.settledKey === this.landingKey) this.hide(true)
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
      const paper = paperTone(image)
      if (shaped !== null && fill === 'pad') {
        // Kept whole and centred; the sheet's spare edges are the page's own paper.
        draw.fillStyle = toneColour(paper)
        draw.fillRect(0, 0, copy.width, copy.height)
        const fit = Math.min(copy.width / image.naturalWidth, copy.height / image.naturalHeight)
        const w = image.naturalWidth * fit
        const h = image.naturalHeight * fit
        draw.drawImage(image, (copy.width - w) / 2, (copy.height - h) / 2, w, h)
      } else if (shaped !== null && fill === 'enlarge') {
        const cover = Math.max(copy.width / image.naturalWidth, copy.height / image.naturalHeight)
        const w = image.naturalWidth * cover
        const h = image.naturalHeight * cover
        draw.drawImage(image, (copy.width - w) / 2, (copy.height - h) / 2, w, h)
      } else {
        draw.drawImage(image, 0, 0, copy.width, copy.height)
      }
      const urls = this.context?.urls
      const page = urls ? urls.indexOf(src) : -1
      // Not on a two-page spread: PagedView leaves those unmarked too.
      if (page >= 0 && natural <= 1) drawPageMark(draw, copy.width, copy.height, page, urls![0])
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
      const result = { texture, aspect, paper }
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

  /** `arc` lifts the path in the middle, as a hand rises while it carries the page over. */
  private animate(from: { x: number; y: number }, to: { x: number; y: number }, ms: number, ease: (t: number) => number, done: () => void, arc = 0) {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.animating = true
    const start = performance.now()
    const step = (now: number) => {
      this.frame = 0
      const t = Math.min(1, (now - start) / ms)
      const k = ease(t)
      this.finger = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k - arc * Math.sin(Math.PI * k) }
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
        this.animate({ ...this.finger }, end, ms, easeOut, () => this.hide(true))
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
  private fold(turn: Turn, share = RADIUS_SHARE) {
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
    // The roll tightens fast as the sheet settles: a roll left at the binding showed as a pale strip.
    const radius = Math.max(0.0001, Math.min(width * share, reach / Math.PI, width * share * Math.min(1, 6 * (1 - progress) ** 2)))
    const along = (reach + Math.PI * radius) / 2
    let x = edge - nx * along
    const y = this.grabY - ny * along
    // The page is bound at the spine: the fold never crosses it, however far the finger goes, so a
    // page cannot be pulled off. Where a tilted fold meets the top or bottom edge decides it.
    const slope = ny / nx
    const reachesSpine = Math.min(x - (turn.sheet.y - y) * slope, x - (turn.sheet.y + turn.sheet.h - y) * slope)
    if (reachesSpine < turn.spine) x += turn.spine - reachesSpine
    // Late in a turn the sheet hinges on the binding: left to the curl alone, a sliver of it would
    // still lie flat beside the spine, showing a strip of the page it is leaving under the fold.
    else x -= (reachesSpine - turn.spine) * smoothstep(0.55, 0.92, progress)
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
    gl.disable(gl.BLEND)
    gl.depthFunc(gl.LEQUAL)
    gl.useProgram(program)

    const progress = this.progress()
    const coverTurn = turn.front.cover || !!turn.back?.cover
    const share = coverTurn ? COVER_RADIUS_SHARE : RADIUS_SHARE
    const fold = this.fold(turn, share)
    const u = (name: string) => this.uniforms.get(name) ?? null
    gl.uniform2f(u('uView'), width, height)
    gl.uniform1f(u('uMirror'), this.context?.mirror ? 1 : 0)
    gl.uniform1f(u('uDepth'), Math.max(width, height) * 2.2)
    gl.uniform4f(u('uFold'), fold.x, fold.y, fold.nx, fold.ny)
    gl.uniform1f(u('uRadius'), fold.radius)
    gl.uniform1f(u('uLift'), Math.sin(Math.PI * progress))
    // The lifted page's shadow on the page it uncovers fades as it lies down; flat, it casts none.
    const lift = Math.min(1, fold.radius / (turn.sheet.w * share))
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
      gl.uniform2f(u('uCoverSides'), face.outside ? 1 : 0, (back?.outside ?? face.outside) ? 1 : 0)
      gl.uniform2f(u('uWear'), ...pageWear(face.page, this.context?.urls[0]))
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
    for (const name of ['uRect', 'uView', 'uMirror', 'uDepth', 'uFold', 'uRadius', 'uCurl', 'uZ', 'uCover', 'uCoverSides', 'uLift', 'uThickness', 'uLayer', 'uEdge', 'uWear', 'uBookShift', 'uFront', 'uBack', 'uHasBack', 'uShadow', 'uFrontPart', 'uBackPart', 'uFrontPaper', 'uBackPaper', 'uSpine', 'uGutter']) {
      this.uniforms.set(name, gl.getUniformLocation(program, name))
    }

    const meshVertices = (COLUMNS + 1) * (ROWS + 1)
    const segments = 2 * (COLUMNS + ROWS)
    const vertices = new Float32Array((meshVertices + segments * 4) * 3)
    let v = 0
    for (let row = 0; row <= ROWS; row++) {
      for (let column = 0; column <= COLUMNS; column++) {
        vertices[v++] = columnAt(column)
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
      edge(columnAt(c), 0, columnAt(c + 1), 0)
      edge(columnAt(c), 1, columnAt(c + 1), 1)
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
