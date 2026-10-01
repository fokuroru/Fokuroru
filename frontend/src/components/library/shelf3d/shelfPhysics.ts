import Matter from 'matter-js'

const { Engine, Bodies, Body, Composite, Constraint, Events, Query, Sleeping, Vector } = Matter

/** Three times Matter's default: at shelf scale the default had books drifting down like paper. */
const GRAVITY_SCALE = 0.003

/**
 * A body on the shelf. The simulation is two-dimensional across the shelf face; depth is a position
 * (`z`, towards the viewer) and a thickness (`depth`) on top of it. Two bodies only meet if their
 * depths overlap, so a pot standing in front of a book simply passes it, and a book pulled forward
 * stands clear of the row behind. `zTarget` is where depth is heading: it eases there, and stops
 * short rather than push into something.
 */
export type BookBody = Matter.Body & {
  bookWidth: number
  bookHeight: number
  chalk?: boolean
  /** Whether its centre is over the plank, so the plank holds it up. */
  supported?: boolean
  /** The collision mask it has while supported. */
  baseMask?: number
  /** How far it has tipped forward over the plank's front edge, in radians, and how fast it is turning. */
  pitch?: number
  pitchSpeed?: number
  z: number
  zTarget: number
  depth: number
}

/**
 * Where the shelf's depth begins (the wall) and the furthest forward a body's front face may reach.
 * Past the front edge of the plank (see `PLANK_FRONT`) a body is no longer held up, so it can be
 * pulled off the shelf and falls.
 */
const SHELF_BACK = -147
const SHELF_FRONT = 150
/** The plank, in the same units: it runs from the wall to 13, and holds up anything whose centre is over it. */
export const PLANK_FRONT = 13
/** Tipped this far over the edge, a body can no longer balance on it and lets go. */
const TIP_LIMIT = 1.15

interface DepthFilter extends Matter.ICollisionFilter {
  z?: number
  depth?: number
}

const depthsOverlap = (a: DepthFilter, b: DepthFilter) =>
  a.depth === undefined || b.depth === undefined || Math.abs((a.z ?? 0) - (b.z ?? 0)) < (a.depth + b.depth) / 2

// Matter reads `Detector.canCollide` afresh on every pass, so the depth rule goes in beside the
// categories and masks. Bodies without a depth (the plank, the end walls) span all of it.
const matterDetector = Matter.Detector as typeof Matter.Detector & { depthAware?: boolean }
if (!matterDetector.depthAware) {
  const canCollide = matterDetector.canCollide
  matterDetector.canCollide = (a, b) => canCollide(a, b) && depthsOverlap(a, b)
  matterDetector.depthAware = true
}

const zBounds = (depth: number): [number, number] => [SHELF_BACK + depth / 2 + 2, SHELF_FRONT - depth / 2]

/**
 * Collision categories. Everything else keeps Matter's default (1) and so meets everything. Chalk
 * meets books, the plant, other chalk and the shelf's visible plank, but not the invisible extra
 * plank under the shelf ends or the end walls, so a stick pushed to either end rolls off it.
 */
const CATEGORY_CHALK = 0x0002
const CATEGORY_VISIBLE_PLANK = 0x0004
const CATEGORY_PLANK = 0x0008
const CATEGORY_WALL = 0x0010
const PLANK_BITS = CATEGORY_PLANK | CATEGORY_VISIBLE_PLANK

interface Hand {
  start: Matter.Vector
  time: number
  direction: number
  /** Set while the pointer is down: the grip then follows the pointer instead of hovering. */
  target: Matter.Vector | null
}

/**
 * One shelf row's rigid bodies, two-dimensional across the shelf face; the renderer turns each body
 * into a three-dimensional book. A grabbed book hangs off a soft constraint at a point near its top,
 * which is what makes it lift, sway and settle back like a hand picked it up.
 */
export class ShelfPhysics {
  readonly engine: Matter.Engine
  readonly bodies: BookBody[] = []
  private constraint: Matter.Constraint | null = null
  private hand: Hand | null = null

  readonly floor: number
  readonly width: number
  /** The plank books stand on. */
  readonly plank: Matter.Body
  /**
   * Called when a book lands on the plank, with how hard: its speed times its mass. Measured here:
   * settling in place is 0, a book tipping over about 100, a slim book dropped from the top of the
   * row about 200, a thick one about 460.
   */
  onImpact: ((strength: number) => void) | null = null

  constructor(width: number, floor = 360) {
    this.floor = floor
    this.width = width
    this.engine = Engine.create({ enableSleeping: true, positionIterations: 12, velocityIterations: 10, constraintIterations: 6 })
    this.engine.gravity.y = 1
    this.engine.gravity.scale = GRAVITY_SCALE
    this.plank = Bodies.rectangle(width / 2, floor + 35, width + 100, 70, {
      isStatic: true,
      friction: 0.75,
      restitution: 0,
      collisionFilter: { category: CATEGORY_PLANK, mask: 0xffffffff, group: 0 },
    })
    // The plank as drawn: the same surface, but only as wide as the shelf, so chalk can leave it.
    const visiblePlank = Bodies.rectangle(width / 2, floor + 35, width + 12, 70, {
      isStatic: true,
      friction: 0.75,
      restitution: 0,
      collisionFilter: { category: CATEGORY_VISIBLE_PLANK, mask: 0xffffffff, group: 0 },
    })
    Events.on(this.engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const book = pair.bodyA === this.plank ? pair.bodyB : pair.bodyB === this.plank ? pair.bodyA : null
        if (book && this.onImpact) this.onImpact(book.speed * book.mass)
      }
    })

    const wall = { category: CATEGORY_WALL, mask: 0xffffffff, group: 0 }
    Composite.add(this.engine.world, [
      this.plank,
      visiblePlank,
      Bodies.rectangle(-30, floor - 260, 60, 1000, { isStatic: true, friction: 0.5, collisionFilter: wall }),
      Bodies.rectangle(width + 30, floor - 260, 60, 1000, { isStatic: true, friction: 0.5, collisionFilter: wall }),
    ])
  }

  /** Adds an upright book whose bottom-left corner is at (x, y), optionally already tipped by `angle`. */
  add(x: number, y: number, w: number, h: number, angle = 0, depth = 132): BookBody {
    const body = Bodies.rectangle(x + w / 2, y + h / 2, w, h, {
      friction: 0.55,
      frictionStatic: 0.9,
      frictionAir: 0.018,
      restitution: 0.025,
      density: 0.002,
      sleepThreshold: 90,
    }) as BookBody
    body.bookWidth = w
    body.bookHeight = h
    // A book's depth is measured from its middle: the spine faces the viewer and the pages run back from it.
    this.setDepth(body, -depth / 2, depth)
    if (angle) Body.setAngle(body, angle)
    this.bodies.push(body)
    Composite.add(this.engine.world, body)
    return body
  }

  /** Gives a body its depth: where it stands (clamped to the shelf) and how thick it is. */
  setDepth(body: BookBody, z: number, depth: number) {
    const [min, max] = zBounds(depth)
    body.depth = depth
    body.z = body.zTarget = Math.max(min, Math.min(max, z))
    const filter = body.collisionFilter as DepthFilter
    filter.z = body.z
    filter.depth = depth
    body.baseMask = filter.mask
    body.supported = true
    this.holdUp(body)
  }

  /**
   * The plank holds a body up while its centre is over it, and lets go once the centre is past the
   * front edge: it is then in the air, and falls. Done with the collision mask, so it takes effect on
   * the next step.
   */
  private holdUp(body: BookBody) {
    // A chalk stick has nothing to tip over; anything else keeps its hold on the plank while it pivots.
    const over = body.z <= PLANK_FRONT || (!body.chalk && (body.pitch ?? 0) < TIP_LIMIT)
    if (over === (body.supported ?? true) && body.baseMask !== undefined) return
    body.supported = over
    const base = body.baseMask ?? body.collisionFilter.mask ?? 0xffffffff
    body.collisionFilter.mask = over ? base : base & ~PLANK_BITS
    Sleeping.set(body, false)
  }

  /** Pushes a body towards the viewer (positive) or back towards the wall, within the shelf. */
  nudgeDepth(body: BookBody, dz: number) {
    const [min, max] = zBounds(body.depth)
    body.zTarget = Math.max(min, Math.min(max, body.zTarget + dz))
    Sleeping.set(body, false)
  }

  private zOverlap(a: Matter.Body, b: Matter.Body) {
    return depthsOverlap(a.collisionFilter as DepthFilter, b.collisionFilter as DepthFilter)
  }

  /** Whether moving `body` to `z` would put it into something it is now clear of. */
  private depthBlocked(body: BookBody, z: number): boolean {
    const was = (body.collisionFilter as DepthFilter).z
    ;(body.collisionFilter as DepthFilter).z = z
    const blocked = this.bodies.some(
      (other) =>
        other !== body &&
        !this.zOverlapAt(body, was ?? z, other) &&
        this.zOverlap(body, other) &&
        Query.collides(body, [other]).length > 0,
    )
    ;(body.collisionFilter as DepthFilter).z = was
    return blocked
  }

  /** Whether `body`, if it stood at `z`, would overlap `other` in depth. */
  private zOverlapAt(body: BookBody, z: number, other: Matter.Body) {
    const o = other.collisionFilter as DepthFilter
    return o.depth === undefined || Math.abs(z - (o.z ?? 0)) < (body.depth + o.depth) / 2
  }

  /**
   * A potted plant standing on the plank at `x` (its centre): one rigid compound body, a heavy pot
   * with a light, narrow, pointed column for the leaves. Rigid, because leaves built as separate
   * pinned bodies fought Matter's contact solver whenever a book pressed them, and whatever rested
   * on the plant shook without end; pointed, so a book cannot lie level on the plant but tips off
   * the point or rests tilted against it. The drawn leaves bend out of the way of books themselves
   * (see the renderer). Returns the body and how far its centre of mass sits above the plank.
   */
  addPlant(x: number, potWidth: number, potHeight: number, leafSpread: number, leafHeight: number, z = 0) {
    const column = leafHeight * 0.75
    const pot = Bodies.rectangle(x, this.floor - potHeight / 2, potWidth, potHeight, { density: 0.006 })
    const leaves = Bodies.trapezoid(x, this.floor - potHeight - column / 2, Math.min(leafSpread, potWidth) * 0.7, column, 0.92, { density: 0.0004 })
    const body = Body.create({
      parts: [pot, leaves],
      friction: 0.8,
      frictionStatic: 1,
      frictionAir: 0.02,
      restitution: 0.02,
      sleepThreshold: 90,
    }) as BookBody
    body.bookWidth = potWidth
    body.bookHeight = potHeight + column
    this.setDepth(body, z, potWidth)
    this.bodies.push(body)
    Composite.add(this.engine.world, body)
    return { body, centreAboveFloor: this.floor - body.position.y }
  }

  /**
   * A figure on its round base: a heavy slab for the base under a light column for the figure, so its
   * weight is low and a knock rocks it rather than toppling it.
   */
  addFigure(x: number, width: number, height: number, z = 0) {
    const slab = 10
    const base = Bodies.rectangle(x, this.floor - slab / 2, width, slab, { density: 0.03 })
    const column = Bodies.rectangle(x, this.floor - slab - (height - slab) / 2, width * 0.55, height - slab, { density: 0.004 })
    const body = Body.create({
      parts: [base, column],
      friction: 0.8,
      frictionStatic: 1,
      frictionAir: 0.02,
      restitution: 0.02,
      sleepThreshold: 90,
    }) as BookBody
    body.bookWidth = width
    body.bookHeight = height
    this.setDepth(body, z, width)
    this.bodies.push(body)
    Composite.add(this.engine.world, body)
    return { body, centreAboveFloor: this.floor - body.position.y }
  }

  /**
   * A stick of chalk lying across the shelf, `x` and `y` its centre. A rounded rectangle: slippery,
   * so a knock slides it, and light, so a book shoves it about. It ignores the end walls and the
   * overhang of the plank, which is what lets it go over the edge.
   */
  addChalk(
    x: number, y: number, length: number, thickness: number, angle = 0, z = 0,
    thrown?: { vx: number; vy: number; spin: number },
  ): BookBody {
    const body = Bodies.rectangle(x, y, length, thickness, {
      chamfer: { radius: thickness * 0.45 },
      // Heavy and grippy enough that a book lying across it settles rather than shaking it: at the
      // old density the stick was forty times lighter than the book and spun under it.
      friction: 0.3,
      frictionStatic: 0.7,
      frictionAir: 0.02,
      restitution: 0.02,
      density: 0.012,
      sleepThreshold: 90,
      collisionFilter: { category: CATEGORY_CHALK, mask: 0x0001 | CATEGORY_CHALK | CATEGORY_VISIBLE_PLANK, group: 0 },
    }) as BookBody
    body.bookWidth = length
    body.bookHeight = thickness
    body.chalk = true
    this.setDepth(body, z, thickness)
    if (angle) Body.setAngle(body, angle)
    if (thrown) {
      Body.setVelocity(body, { x: thrown.vx, y: thrown.vy })
      Body.setAngularVelocity(body, thrown.spin)
    }
    this.bodies.push(body)
    Composite.add(this.engine.world, body)
    return body
  }

  /** Takes out whatever has fallen off the shelf, and returns it so the renderer can drop its model. */
  reap(): BookBody[] {
    const lost = this.bodies.filter((b) => b.position.y > this.floor + 500)
    for (const body of lost) this.remove(body)
    return lost
  }

  /** Every body except `except`, for a renderer asking what occupies a point. */
  bodiesExcept(except: Matter.Body): Matter.Body[] {
    return Composite.allBodies(this.engine.world).filter((b) => b !== except && !b.isStatic && this.zOverlap(except, b))
  }

  /** Whether any of `bodies` covers a point. */
  occupied(bodies: Matter.Body[], point: Matter.Vector): boolean {
    return Query.point(bodies, point).length > 0
  }

  /**
   * Takes hold of a book. Hovering grips it off-centre near the top and lifts it a little; pressing
   * grips it where the pointer is (`at`, a world point), so a drag carries it from that spot.
   */
  grab(body: BookBody, direction = 1, at?: Matter.Vector) {
    this.release()
    Sleeping.set(body, false)
    const offset = at
      ? Vector.sub(at, body.position)
      : Vector.rotate({ x: body.bookWidth * 0.24 * direction, y: -body.bookHeight * 0.34 }, body.angle)
    const anchor = Vector.add(body.position, offset)
    this.hand = { start: anchor, time: 0, direction, target: at ? { ...at } : null }
    this.constraint = Constraint.create({
      bodyB: body,
      pointB: offset,
      pointA: { ...anchor },
      length: 0,
      // Soft enough that a collision always wins against the pull: a stiff grip dragged a book
      // through its neighbours.
      stiffness: at ? 0.1 : 0.08,
      damping: 0.2,
    })
    Composite.add(this.engine.world, this.constraint)
  }

  /**
   * Moves a pressed grip to a world point. The point is clamped so that, held there, the book could
   * not reach below the shelf or past either end: pulling into the shelf would otherwise drive it
   * through the plank.
   */
  moveTo(point: Matter.Vector) {
    const body = this.constraint?.bodyB as BookBody | undefined
    if (!this.hand?.target || !body || !this.constraint) return
    const cos = Math.abs(Math.cos(body.angle))
    const sin = Math.abs(Math.sin(body.angle))
    const hx = (body.bookWidth / 2) * cos + (body.bookHeight / 2) * sin
    const hy = (body.bookWidth / 2) * sin + (body.bookHeight / 2) * cos
    const grip = this.constraint.pointB
    this.hand.target = {
      x: Math.max(hx + grip.x, Math.min(this.width - hx + grip.x, point.x)),
      y: Math.max(-170, Math.min(this.floor - hy + grip.y - 1, point.y)),
    }
  }

  /**
   * Free space beside one face of a book, measured outwards along its own x axis (so a book lying
   * down looks up or down), up to `reach`. Sampled on three lines along the face against every
   * other body, the plank and the shelf ends included, so a cover opening into it stays out of them.
   */
  clearance(body: BookBody, side: 1 | -1, reach: number): number {
    const others = Composite.allBodies(this.engine.world).filter((b) => b !== body && this.zOverlap(body, b))
    const out = Vector.rotate({ x: side, y: 0 }, body.angle)
    let free = reach
    for (const along of [-0.4, 0, 0.4]) {
      const origin = Vector.add(
        body.position,
        Vector.rotate({ x: (side * body.bookWidth) / 2, y: along * body.bookHeight }, body.angle),
      )
      for (let d = 1; d < free; d += 3) {
        if (Query.point(others, Vector.add(origin, Vector.mult(out, d))).length > 0) {
          free = d - 1
          break
        }
      }
    }
    return Math.max(0, free)
  }

  /** Takes a book out of the simulation (it is being pulled off the shelf) without disturbing the rest. */
  remove(body: BookBody) {
    if (this.constraint?.bodyB === body) this.release()
    Composite.remove(this.engine.world, body)
    const i = this.bodies.indexOf(body)
    if (i >= 0) this.bodies.splice(i, 1)
  }

  /** Stops a held stick from spinning about its grip: it settles level instead of swinging round. */
  level(body: BookBody) {
    const angle = Math.atan2(Math.sin(body.angle), Math.cos(body.angle))
    Body.setAngularVelocity(body, 0)
    Body.setAngle(body, angle * 0.85)
  }

  release() {
    if (this.constraint) Composite.remove(this.engine.world, this.constraint)
    this.constraint = null
    this.hand = null
  }

  get holding(): boolean {
    return this.hand !== null
  }

  /** Largest distance and turn any body made in the last step, measured from real positions. */
  private lastMove = { distance: Infinity, turn: Infinity }

  /**
   * Nothing held and nothing actually moving. Measured from how far bodies moved in the last step,
   * not from Matter's speed: a pinned body (the plant's leaves) is dragged by gravity and pulled
   * back by its pin every step, which reads as speed while it stays exactly where it is.
   */
  get still(): boolean {
    return !this.hand && this.lastMove.distance < 0.02 && this.lastMove.turn < 0.0005 && !this.bodies.some((b) => Math.abs(b.zTarget - b.z) > 0.05)
  }

  /**
   * The shelf's own acceleration, in multiples of gravity (y down), set by the renderer from how the
   * page is scrolling. Everything on the shelf feels the opposite of it: a flick that stops hard makes
   * books hop, and the push lands a little off centre so they rock as they come down.
   */
  shelfAcceleration = { x: 0, y: 0 }

  step(dt = 1000 / 120) {
    const { x: ax, y: ay } = this.shelfAcceleration
    if (ax || ay) {
      const wake = Math.hypot(ax, ay) > 0.08
      for (const body of this.bodies) {
        if (wake) Sleeping.set(body, false)
        if (body.isSleeping) continue
        const off = ((body.id * 7919) % 11) / 10 - 0.5
        const at = Vector.add(body.position, Vector.rotate({ x: off * body.bookWidth * 0.5, y: 0 }, body.angle))
        Body.applyForce(body, at, { x: -ax * body.mass * GRAVITY_SCALE, y: -ay * body.mass * GRAVITY_SCALE })
      }
    }
    const hand = this.hand
    if (hand && this.constraint) {
      hand.time += dt / 1000
      if (hand.target) {
        this.constraint.pointA.x = hand.target.x
        this.constraint.pointA.y = hand.target.y
      } else {
        // Hover: a small lift and the faintest sway, a hint that the book can be taken.
        const lift = 1 - Math.exp(-hand.time * 5)
        this.constraint.pointA.x = hand.start.x + Math.sin(hand.time * 3) * 1.2 * lift * hand.direction
        this.constraint.pointA.y = hand.start.y - 10 * lift + Math.sin(hand.time * 4) * 0.5 * lift
      }
    }
    // Depth eases towards its target, and stops where something is in the way.
    for (const body of this.bodies) {
      if (body.zTarget === body.z) continue
      const gap = body.zTarget - body.z
      const next = Math.abs(gap) < 0.05 ? body.zTarget : body.z + gap * 0.09
      if (this.depthBlocked(body, next)) {
        body.zTarget = body.z
        continue
      }
      body.z = next
      ;(body.collisionFilter as DepthFilter).z = next
      this.holdUp(body)
      Sleeping.set(body, false)
    }
    // Tipping: a body resting on the plank with its centre past the front edge pivots forward about the
    // edge, faster the further past it is, and lets go once it has turned far enough; then it falls and
    // keeps turning as it drops. Back over the plank, or lifted off it, it rights itself.
    const seconds = dt / 1000
    for (const body of this.bodies) {
      if (body.chalk) continue
      const overhang = body.z - PLANK_FRONT
      const resting = body.bounds.max.y >= this.floor - 4
      let pitch = body.pitch ?? 0
      let speed = body.pitchSpeed ?? 0
      if (body.supported === false) {
        speed += 6 * seconds
        pitch = Math.min(2.1, pitch + speed * seconds)
      } else if (overhang > 0 && resting) {
        speed += (5 + 0.08 * overhang) * seconds
        pitch += speed * seconds
      } else {
        speed = 0
        pitch = pitch < 0.002 ? 0 : pitch * 0.85
      }
      body.pitch = pitch
      body.pitchSpeed = speed
      if (pitch >= TIP_LIMIT && body.supported !== false) this.holdUp(body)
    }
    const before = this.bodies.map((body) => ({ x: body.position.x, y: body.position.y, a: body.angle }))
    Engine.update(this.engine, dt)
    let distance = 0
    let turn = 0
    this.bodies.forEach((body, i) => {
      distance = Math.max(distance, Math.hypot(body.position.x - before[i].x, body.position.y - before[i].y))
      turn = Math.max(turn, Math.abs(body.angle - before[i].a))
    })
    this.lastMove = { distance, turn }
  }

  destroy() {
    this.onImpact = null
    Events.off(this.engine, 'collisionStart')
    this.release()
    Composite.clear(this.engine.world, false)
    Engine.clear(this.engine)
  }
}
