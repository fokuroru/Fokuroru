export const HALLOWEEN_DOODLES = ['pumpkin', 'ghost', 'bat', 'cat', 'spider'] as const
export type HalloweenDoodle = typeof HALLOWEEN_DOODLES[number]

/** Local calendar dates: October 10 through Halloween, inclusive. */
export function halloweenDoodle(date = new Date(), random = Math.random): HalloweenDoodle | null {
  if (date.getMonth() !== 9 || date.getDate() < 10) return null
  return HALLOWEEN_DOODLES[Math.min(HALLOWEEN_DOODLES.length - 1, Math.floor(random() * HALLOWEEN_DOODLES.length))]
}

/** Simple outlines inspired by the reference sheet, drawn in soft, slightly doubled chalk. */
export function drawHalloweenDoodle(c: CanvasRenderingContext2D, doodle: HalloweenDoodle, x: number, y: number, size: number) {
  const paths: Record<HalloweenDoodle, string[]> = {
    pumpkin: [
      'M 47 23 Q 47 13 56 11 L 58 17 Q 51 18 53 24',
      'M 50 25 C 18 13 10 42 19 65 C 27 86 42 83 50 79 C 62 87 80 81 84 62 C 94 35 77 16 50 25 Z',
      'M 43 25 Q 25 48 41 79 M 60 25 Q 78 49 61 80',
      'M 29 46 L 39 35 L 44 48 Z M 58 47 L 64 35 L 74 45 Z',
      'M 45 57 L 50 49 L 55 57 Z M 29 60 L 39 64 L 42 59 L 47 65 L 57 65 L 61 59 L 65 63 L 74 58 Q 59 83 39 74 Z',
    ],
    ghost: [
      'M 22 78 L 22 43 C 22 7 78 7 78 43 L 78 78 Q 71 91 63 78 Q 54 93 46 79 Q 35 93 30 79 Q 22 90 22 78 Z',
      'M 37 43 C 30 34 32 29 39 34 C 46 38 43 47 37 43 Z M 63 43 C 57 47 54 38 61 34 C 68 29 70 35 63 43 Z',
      'M 44 57 Q 50 48 57 57 Q 51 68 44 57 Z',
    ],
    bat: [
      'M 40 41 L 36 28 L 46 34 L 54 34 L 64 28 L 60 41 Q 74 34 89 21 Q 83 43 93 62 Q 73 53 67 71 Q 57 62 54 74 L 46 74 Q 43 62 33 71 Q 27 53 7 62 Q 17 43 11 21 Q 26 34 40 41 Z',
      'M 40 41 Q 36 61 46 74 M 60 41 Q 64 61 54 74 M 11 21 L 33 71 M 89 21 L 67 71',
      'M 44 44 L 46 47 M 56 44 L 54 47 M 46 54 Q 50 59 54 54',
    ],
    cat: [
      'M 24 35 L 20 14 L 39 27 Q 50 22 61 27 L 80 14 L 76 35 C 92 64 73 81 50 81 C 27 81 8 64 24 35 Z',
      'M 27 43 Q 36 35 44 45 Q 35 54 27 43 Z M 56 45 Q 64 35 73 43 Q 65 54 56 45 Z',
      'M 36 40 L 36 49 M 64 40 L 64 49 M 45 58 L 55 58 L 50 63 Z M 50 63 L 50 68 Q 43 74 39 67 M 50 68 Q 57 74 61 67',
      'M 32 59 L 10 54 M 31 65 L 10 67 M 68 59 L 90 54 M 69 65 L 90 67',
    ],
    spider: [
      'M 50 5 L 50 36 M 50 35 C 32 35 28 67 50 71 C 72 67 68 35 50 35 Z',
      'M 37 45 L 24 33 L 16 39 M 35 53 L 20 49 L 12 59 M 36 61 L 24 69 L 20 83 M 63 45 L 76 33 L 84 39 M 65 53 L 80 49 L 88 59 M 64 61 L 76 69 L 80 83',
      'M 43 47 L 43 51 M 57 47 L 57 51 M 43 59 Q 50 65 57 59',
    ],
  }
  c.save()
  c.translate(x, y)
  c.scale(size / 100, size / 100)
  c.lineWidth = 1.7
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.strokeStyle = doodle === 'pumpkin' ? '#efbe86' : '#e9e2ce'
  for (const path of paths[doodle]) {
    const shape = new Path2D(path)
    c.globalAlpha = 0.3
    c.save()
    c.translate(0.65, 0.45)
    c.stroke(shape)
    c.restore()
    c.globalAlpha = 0.85
    c.stroke(shape)
  }
  c.restore()
}
