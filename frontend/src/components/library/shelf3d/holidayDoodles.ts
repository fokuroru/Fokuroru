import { activeHolidays, type Holiday } from './holidayCalendar'
import { DOODLE_ALTERNATIVES } from './holidayDoodleAlternatives'

export const HALLOWEEN_DOODLES = ['pumpkin', 'ghost', 'bat', 'cat', 'spider'] as const
export type HalloweenDoodle = typeof HALLOWEEN_DOODLES[number]

/** Local calendar dates: October 10 through Halloween, inclusive. */
export function halloweenDoodle(date = new Date(), random = Math.random): HalloweenDoodle | null {
  if (date.getMonth() !== 9 || date.getDate() < 10) return null
  return HALLOWEEN_DOODLES[Math.min(HALLOWEEN_DOODLES.length - 1, Math.floor(random() * HALLOWEEN_DOODLES.length))]
}

export const HALLOWEEN_PATHS: Record<HalloweenDoodle, string[]> = {
    pumpkin: [
      'M 47 23 Q 47 13 56 11 L 58 17 Q 51 18 53 24',
      'M 50 25 C 18 13 10 42 19 65 C 27 86 42 83 50 79 C 62 87 80 81 84 62 C 94 35 77 16 50 25 Z',
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

/** Draws the same chalk paths used by the preview sheet. */
export function drawHalloweenDoodle(c: CanvasRenderingContext2D, doodle: HalloweenDoodle, x: number, y: number, size: number) {
  drawHolidayDoodle(c, { theme: 'halloween', doodle }, x, y, size)
}

export interface Doodle { label: string; paths: string[]; colors?: string[] }
const icon = (label: string, ...paths: string[]): Doodle => ({ label, paths })
export const HOLIDAY_DOODLES: Record<Holiday, Record<string, Doodle>> = {
  halloween: {
    ...Object.fromEntries(HALLOWEEN_DOODLES.map(name => [name, icon(name, ...HALLOWEEN_PATHS[name])])),
    pumpkin: { label: 'Jack-o’-lantern', paths: HALLOWEEN_PATHS.pumpkin,
      colors: ['#b1d5a7', '#efbe86', '#eed69a', '#eed69a'] },
  },
  christmas: {
    tree: icon('Christmas tree', 'M 50 10 L 28 37 L 39 37 L 20 60 L 33 60 L 12 83 L 88 83 L 67 60 L 80 60 L 61 37 L 72 37 Z M 45 83 L 45 93 L 55 93 L 55 83', 'M 50 4 L 53 10 L 60 10 L 55 15 L 57 22 L 50 18 L 43 22 L 45 15 L 40 10 L 47 10 Z M 32 59 Q 50 70 70 60 M 38 36 Q 50 45 64 39'),
    stocking: { ...DOODLE_ALTERNATIVES.stocking[2], label: 'Fluffy stocking' },
    bells: icon('Bells', 'M 34 34 Q 18 30 16 58 L 10 71 L 48 78 L 44 64 Q 52 39 34 34 Z M 66 34 Q 82 30 84 58 L 90 71 L 52 78 L 56 64 Q 48 39 66 34 Z M 25 77 Q 28 86 34 79 M 66 79 Q 72 86 75 77', 'M 50 28 C 31 1 15 21 32 28 L 50 28 C 69 1 85 21 68 28 Z M 50 28 L 38 43 M 50 28 L 62 43'),
  },
  newYear: {
    fireworks: icon('Fireworks', 'M 48 46 L 48 15 M 48 46 L 24 25 M 48 46 L 72 25 M 48 46 L 18 47 M 48 46 L 80 47 M 48 46 L 27 68 M 48 46 L 70 68 M 48 46 L 48 82 M 13 17 L 13 25 M 9 21 L 17 21 M 85 73 L 85 83 M 80 78 L 90 78 M 40 48 L 56 48 M 48 40 L 48 56'),
    partyHat: icon('Party hat', 'M 49 16 L 16 80 Q 50 93 84 80 Z M 32 51 L 70 57 M 23 68 L 78 74 M 44 26 Q 60 22 63 13 M 49 16 Q 39 5 34 14 M 49 16 L 47 5 M 17 25 L 22 30 M 80 34 L 86 29 M 10 56 L 15 53'),
    fireworksPair: {
      label: 'Two fireworks',
      paths: [
        'M 32 37 L 32 10 M 32 37 L 14 18 M 32 37 L 51 18 M 32 37 L 6 37 M 32 37 L 57 37 M 32 37 L 13 55 M 32 37 L 51 55 M 32 37 L 32 63',
        'M 73 65 L 73 43 M 73 65 L 58 49 M 73 65 L 88 49 M 73 65 L 52 65 M 73 65 L 95 65 M 73 65 L 58 81 M 73 65 L 89 81 M 73 65 L 73 89',
        'M 64 14 L 64 22 M 60 18 L 68 18 M 16 78 L 16 86 M 12 82 L 20 82 M 92 29 L 92 35 M 89 32 L 95 32',
      ],
      colors: ['#eed69a', '#d4b8e3', '#e9b3bd'],
    },
  },
  easter: {
    egg: icon('Decorated egg', 'M 50 13 C 27 13 10 64 24 82 C 36 97 64 97 76 82 C 90 64 73 13 50 13 Z M 30 35 Q 50 46 70 35 M 19 61 L 29 53 L 39 63 L 50 53 L 61 63 L 72 53 L 82 61 M 26 81 Q 50 70 74 81'),
    bunny: icon('Bunny', 'M 32 40 C 7 3 35 0 43 37 M 56 37 C 67 0 92 5 69 41 M 32 40 C 10 56 22 87 50 87 C 78 87 90 56 69 41 Q 50 29 32 40 Z M 37 57 L 37 62 M 63 57 L 63 62 M 45 68 L 55 68 L 50 73 Z M 50 73 Q 42 80 39 73 M 50 73 Q 58 80 61 73 M 30 68 L 13 64 M 70 68 L 87 64'),
  },
  valentine: {
    heart: icon('Heart', 'M 50 82 C 9 54 9 26 27 21 C 39 17 46 22 50 31 C 54 22 61 17 73 21 C 91 26 91 54 50 82 Z M 25 30 Q 18 36 22 44'),
    letterSealed: { ...DOODLE_ALTERNATIVES.letter[0], label: 'Sealed with a heart' },
    letterOpen: { ...DOODLE_ALTERNATIVES.letter[1], label: 'Open love letter' },
    letterFloating: { ...DOODLE_ALTERNATIVES.letter[2], label: 'Letter and floating hearts' },
    rose: icon('Rose', 'M 50 47 L 50 91 M 50 67 Q 31 54 27 64 Q 33 78 50 75 M 50 82 Q 72 61 76 71 Q 68 88 50 87 M 50 47 C 21 39 25 17 46 17 Q 63 8 73 26 C 81 47 58 53 50 47 Z M 43 24 Q 64 16 63 30 Q 56 42 43 34 Q 35 25 43 24 M 28 27 Q 36 44 51 47 M 69 20 Q 73 37 60 45'),
  },
  lunarNewYear: {
    lantern: icon('Lantern', 'M 50 5 L 50 17 M 34 18 L 66 18 L 66 25 L 34 25 Z M 34 25 C 5 39 13 72 34 78 L 66 78 C 87 72 95 39 66 25 M 34 78 L 66 78 L 66 85 L 34 85 Z M 50 85 L 50 97 M 43 85 L 43 93 M 57 85 L 57 93 M 39 26 Q 27 51 39 77 M 61 26 Q 73 51 61 77 M 50 25 L 50 78'),
    envelope: icon('Red envelope', 'M 27 12 L 73 12 L 73 91 L 27 91 Z M 27 12 L 50 31 L 73 12 M 50 42 A 15 15 0 1 1 49.9 42 Z M 50 48 L 56 55 L 50 62 L 44 55 Z M 33 79 L 67 79'),
    blossom: icon('Plum blossom', 'M 22 91 Q 35 68 75 21 M 40 68 L 17 45 M 58 47 L 82 59 M 72 24 C 60 12 72 4 79 15 C 90 5 96 18 84 24 C 97 33 85 41 79 30 C 72 42 60 31 72 24 Z M 17 45 C 5 33 17 25 24 36 C 35 26 41 39 29 45 C 42 54 30 62 24 51 C 17 63 5 52 17 45 Z M 75 64 C 63 52 75 44 82 55 C 93 45 99 58 87 64 C 100 73 88 81 82 70 C 75 82 63 71 75 64 Z'),
  },
  stPatrick: {
    shamrock: icon('Shamrock', 'M 49 63 C 18 67 4 40 22 34 Q 31 29 40 43 C 25 19 39 4 50 18 C 61 4 75 19 60 43 Q 69 29 78 34 C 96 40 82 67 51 63 Q 64 79 54 94 M 50 60 L 27 44 M 50 60 L 50 29 M 50 60 L 73 44'),
    hat: icon('Green hat', 'M 25 22 L 75 22 L 83 73 L 17 73 Z M 17 58 L 83 58 M 10 73 Q 50 67 90 73 L 90 85 Q 50 94 10 85 Z M 42 54 L 58 54 L 58 67 L 42 67 Z'),
    rainbow: {
      label: 'Rainbow',
      paths: [
        'M 8 71 A 42 42 0 0 1 92 71', 'M 12 71 A 38 38 0 0 1 88 71',
        'M 16 71 A 34 34 0 0 1 84 71', 'M 20 71 A 30 30 0 0 1 80 71',
        'M 24 71 A 26 26 0 0 1 76 71', 'M 28 71 A 22 22 0 0 1 72 71',
        'M 32 71 A 18 18 0 0 1 68 71',
        'M 5 79 C 0 66 10 59 19 65 Q 28 58 35 67 Q 46 68 43 78 Q 42 85 32 85 L 14 85 Q 5 85 5 79 Z M 57 79 C 52 66 62 59 71 65 Q 80 58 87 67 Q 98 68 95 78 Q 94 85 84 85 L 66 85 Q 57 85 57 79 Z',
      ],
      colors: ['#e5a6ac', '#efbe86', '#eed69a', '#b1d5a7', '#a9d1dc', '#b2bce1', '#d4b8e3', '#e9e2ce'],
    },
  },
  diwali: {
    diya: icon('Diya lamp', 'M 14 61 Q 50 49 86 61 Q 78 88 50 89 Q 22 88 14 61 Z M 14 61 Q 50 77 86 61 M 51 62 C 28 49 43 28 52 15 C 49 33 71 48 51 62 Z'),
    rangoli: icon('Rangoli', 'M 50 15 Q 25 32 50 50 Q 75 32 50 15 Z M 85 50 Q 68 25 50 50 Q 68 75 85 50 Z M 50 85 Q 75 68 50 50 Q 25 68 50 85 Z M 15 50 Q 32 75 50 50 Q 32 25 15 50 Z M 50 4 L 96 50 L 50 96 L 4 50 Z M 50 39 A 11 11 0 1 1 49.9 39 Z'),
    lights: icon('Festival lights', 'M 8 18 Q 50 43 92 18 M 25 26 L 25 40 M 50 31 L 50 48 M 75 26 L 75 40 M 17 43 Q 25 36 33 43 L 31 56 Q 25 63 19 56 Z M 42 51 Q 50 44 58 51 L 56 64 Q 50 71 44 64 Z M 67 43 Q 75 36 83 43 L 81 56 Q 75 63 69 56 Z M 20 71 L 20 79 M 16 75 L 24 75 M 80 71 L 80 79 M 76 75 L 84 75'),
  },
  hanukkah: {
    hanukkiah: icon('Nine-branched hanukkiah', 'M 50 25 L 50 87 M 15 44 Q 15 79 50 79 Q 85 79 85 44 M 25 44 Q 25 70 50 70 Q 75 70 75 44 M 35 44 Q 35 61 50 61 Q 65 61 65 44 M 43 44 Q 43 53 50 53 Q 57 53 57 44 M 34 91 L 66 91 M 15 32 L 15 44 M 25 32 L 25 44 M 35 32 L 35 44 M 43 32 L 43 44 M 57 32 L 57 44 M 65 32 L 65 44 M 75 32 L 75 44 M 85 32 L 85 44 M 50 14 L 50 25', 'M 15 21 Q 9 29 15 30 Q 21 29 15 21 Z M 25 21 Q 19 29 25 30 Q 31 29 25 21 Z M 35 21 Q 29 29 35 30 Q 41 29 35 21 Z M 43 21 Q 37 29 43 30 Q 49 29 43 21 Z M 57 21 Q 51 29 57 30 Q 63 29 57 21 Z M 65 21 Q 59 29 65 30 Q 71 29 65 21 Z M 75 21 Q 69 29 75 30 Q 81 29 75 21 Z M 85 21 Q 79 29 85 30 Q 91 29 85 21 Z M 50 3 Q 44 11 50 12 Q 56 11 50 3 Z'),
    dreidel: { ...DOODLE_ALTERNATIVES.dreidel[0], label: 'Dreidel' },
    gelt: icon('Chocolate coins', 'M 31 35 A 21 21 0 1 1 30.9 35 Z M 31 42 A 14 14 0 1 1 30.9 42 Z M 56 56 A 19 19 0 1 1 55.9 56 Z M 56 63 A 12 12 0 1 1 55.9 63 Z M 69 20 A 16 16 0 1 1 68.9 20 Z M 69 26 A 10 10 0 1 1 68.9 26 Z'),
  },
}
export const HOLIDAY_COLORS: Record<Holiday, string> = {
  halloween: '#efbe86', christmas: '#bbd5b3', newYear: '#eed69a', easter: '#d4c2e6', valentine: '#e5adb9',
  lunarNewYear: '#e4ad91', stPatrick: '#b1d5a7', diwali: '#efce91', hanukkah: '#b4cde5',
}
export interface HolidaySelection { theme: Holiday; doodle: string }
export function holidayDoodle(date = new Date(), random = Math.random): HolidaySelection | null {
  const themes = activeHolidays(date)
  if (!themes.length) return null
  const theme = themes[Math.min(themes.length - 1, Math.floor(random() * themes.length))]
  const names = Object.keys(HOLIDAY_DOODLES[theme])
  return { theme, doodle: names[Math.min(names.length - 1, Math.floor(random() * names.length))] }
}

export function drawHolidayDoodle(c: CanvasRenderingContext2D, selection: HolidaySelection, x: number, y: number, size: number) {
  const doodle = HOLIDAY_DOODLES[selection.theme][selection.doodle]
  const color = selection.theme === 'halloween' && selection.doodle !== 'pumpkin' ? '#e9e2ce' : HOLIDAY_COLORS[selection.theme]
  drawChalkDoodle(c, doodle, color, x, y, size)
}

export function drawChalkDoodle(c: CanvasRenderingContext2D, doodle: Doodle, color: string, x: number, y: number, size: number) {
  c.save()
  c.translate(x, y)
  c.scale(size / 100, size / 100)
  c.lineWidth = 1.7
  c.lineCap = 'round'
  c.lineJoin = 'round'
  for (const [i, path] of doodle.paths.entries()) {
    c.strokeStyle = doodle.colors?.[i] ?? color
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
