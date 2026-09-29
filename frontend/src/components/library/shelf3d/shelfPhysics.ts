import Matter from 'matter-js'

const { Engine, Bodies, Composite, Constraint, Sleeping, Vector } = Matter

export type BookBody = Matter.Body & { bookWidth: number; bookHeight: number }

interface Hand {
  start: Matter.Vector
  time: number
  direction: number
  dx: number
  dy: number
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

  constructor(width: number, floor = 360) {
    this.floor = floor
    this.engine = Engine.create({ enableSleeping: true, positionIterations: 12, velocityIterations: 10, constraintIterations: 6 })
    this.engine.gravity.y = 1
    Composite.add(this.engine.world, [
      Bodies.rectangle(width / 2, floor + 35, width + 100, 70, { isStatic: true, friction: 0.75, restitution: 0 }),
      Bodies.rectangle(-30, floor - 260, 60, 1000, { isStatic: true, friction: 0.5 }),
      Bodies.rectangle(width + 30, floor - 260, 60, 1000, { isStatic: true, friction: 0.5 }),
    ])
  }

  add(x: number, y: number, w: number, h: number): BookBody {
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
    this.bodies.push(body)
    Composite.add(this.engine.world, body)
    return body
  }

  /** Picks the book up at a point off-centre near the top, on the side the pointer came from. */
  grab(body: BookBody, direction = 1) {
    this.release()
    Sleeping.set(body, false)
    const local = { x: body.bookWidth * 0.24 * direction, y: -body.bookHeight * 0.34 }
    const rotated = Vector.rotate(local, body.angle)
    const anchor = Vector.add(body.position, rotated)
    this.hand = { start: anchor, time: 0, direction, dx: 0, dy: 0 }
    this.constraint = Constraint.create({ bodyB: body, pointB: rotated, pointA: { ...anchor }, length: 0, stiffness: 0.11, damping: 0.16 })
    Composite.add(this.engine.world, this.constraint)
  }

  move(dx: number, dy: number) {
    if (!this.hand) return
    this.hand.dx = Math.max(-35, Math.min(35, dx))
    this.hand.dy = Math.max(-30, Math.min(35, dy))
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
      const lift = 1 - Math.exp(-hand.time * 5)
      this.constraint.pointA.x = hand.start.x + hand.dx + Math.sin(hand.time * 4.2) * 4.2 * lift * hand.direction
      this.constraint.pointA.y = hand.start.y - 42 * lift + hand.dy + Math.sin(hand.time * 5.3) * 1.3 * lift
    }
    Engine.update(this.engine, dt)
  }

  destroy() {
    this.release()
    Composite.clear(this.engine.world, false)
    Engine.clear(this.engine)
  }
}
