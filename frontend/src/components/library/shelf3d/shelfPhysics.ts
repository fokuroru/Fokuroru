import Matter from 'matter-js'

const { Engine, Bodies, Body, Composite, Constraint, Query, Sleeping, Vector } = Matter

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

  constructor(width: number, floor = 360) {
    this.floor = floor
    this.width = width
    this.engine = Engine.create({ enableSleeping: true, positionIterations: 12, velocityIterations: 10, constraintIterations: 6 })
    this.engine.gravity.y = 1
    this.engine.gravity.scale = GRAVITY_SCALE
    Composite.add(this.engine.world, [
      Bodies.rectangle(width / 2, floor + 35, width + 100, 70, { isStatic: true, friction: 0.75, restitution: 0 }),
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

  /**
   * Nothing held and every book asleep or all but still. Matter's own sleeping is not enough on its
   * own: books resting against each other keep trading tiny contact impulses and some never sleep.
   */
  get still(): boolean {
    return !this.hand && this.bodies.every((b) => b.isSleeping || (b.speed < 0.02 && Math.abs(b.angularSpeed) < 0.0005))
  }

  step(dt = 1000 / 120) {
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
    Engine.update(this.engine, dt)
  }

  destroy() {
    this.release()
    Composite.clear(this.engine.world, false)
    Engine.clear(this.engine)
  }
}
