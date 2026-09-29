import Matter from 'matter-js'

const { Engine, Bodies, Body, Composite, Constraint, Events, Query, Sleeping, Vector } = Matter

/** Three times Matter's default: at shelf scale the default had books drifting down like paper. */
const GRAVITY_SCALE = 0.003

export type BookBody = Matter.Body & { bookWidth: number; bookHeight: number }

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
    this.plank = Bodies.rectangle(width / 2, floor + 35, width + 100, 70, { isStatic: true, friction: 0.75, restitution: 0 })
    Events.on(this.engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const book = pair.bodyA === this.plank ? pair.bodyB : pair.bodyB === this.plank ? pair.bodyA : null
        if (book && this.onImpact) this.onImpact(book.speed * book.mass)
      }
    })

    Composite.add(this.engine.world, [
      this.plank,
      Bodies.rectangle(-30, floor - 260, 60, 1000, { isStatic: true, friction: 0.5 }),
      Bodies.rectangle(width + 30, floor - 260, 60, 1000, { isStatic: true, friction: 0.5 }),
    ])
  }

  /** Adds an upright book whose bottom-left corner is at (x, y), optionally already tipped by `angle`. */
  add(x: number, y: number, w: number, h: number, angle = 0): BookBody {
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
    if (angle) Body.setAngle(body, angle)
    this.bodies.push(body)
    Composite.add(this.engine.world, body)
    return body
  }

  /**
   * A potted plant standing on the plank at `x` (its centre): one rigid compound body, a heavy pot
   * with a light, narrow, pointed column for the leaves. Rigid, because leaves built as separate
   * pinned bodies fought Matter's contact solver whenever a book pressed them, and whatever rested
   * on the plant shook without end; pointed, so a book cannot lie level on the plant but tips off
   * the point or rests tilted against it. The drawn leaves bend out of the way of books themselves
   * (see the renderer). Returns the body and how far its centre of mass sits above the plank.
   */
  addPlant(x: number, potWidth: number, potHeight: number, leafSpread: number, leafHeight: number) {
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
    this.bodies.push(body)
    Composite.add(this.engine.world, body)
    return { body, centreAboveFloor: this.floor - body.position.y }
  }

  /** Every body except `except`, for a renderer asking what occupies a point. */
  bodiesExcept(except: Matter.Body): Matter.Body[] {
    return Composite.allBodies(this.engine.world).filter((b) => b !== except && !b.isStatic)
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
      y: Math.max(-40, Math.min(this.floor - hy + grip.y - 1, point.y)),
    }
  }

  /**
   * Free space beside one face of a book, measured outwards along its own x axis (so a book lying
   * down looks up or down), up to `reach`. Sampled on three lines along the face against every
   * other body, the plank and the shelf ends included, so a cover opening into it stays out of them.
   */
  clearance(body: BookBody, side: 1 | -1, reach: number): number {
    const others = Composite.allBodies(this.engine.world).filter((b) => b !== body)
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
    return !this.hand && this.lastMove.distance < 0.02 && this.lastMove.turn < 0.0005
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
