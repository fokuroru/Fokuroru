import type { Doodle } from './holidayDoodles'

/** Review candidates. Only explicitly selected candidates join the board rotation. */
export const DOODLE_ALTERNATIVES: Record<string, Doodle[]> = {
  pumpkin: [
    {
      label: 'P1 · Classic jack-o’-lantern',
      paths: [
        'M 45 25 Q 43 13 54 9 L 59 14 Q 50 18 52 26 M 55 21 Q 63 11 75 17 Q 67 29 55 21',
        'M 49 28 C 20 15 9 40 16 65 C 22 86 40 89 50 83 C 64 90 82 82 86 62 C 94 36 79 17 49 28 Z',
        'M 27 49 L 36 37 L 43 49 Z M 59 49 L 66 37 L 75 49 Z M 46 58 L 51 50 L 56 58 Z M 28 65 L 39 68 L 39 62 L 45 63 L 46 69 L 58 68 L 59 62 L 65 61 L 66 66 L 76 61 Q 65 81 43 78 Q 33 75 28 65 Z',
      ], colors: ['#b1d5a7', '#efbe86', '#eed69a'],
    },
    {
      label: 'P2 · Friendly little pumpkin',
      paths: [
        'M 48 24 Q 45 12 53 8 L 58 11 Q 50 17 55 24 M 55 20 Q 69 10 78 19 Q 69 28 55 20',
        'M 50 26 C 19 17 8 43 17 66 Q 24 87 50 83 Q 76 87 83 66 C 92 43 81 17 50 26 Z',
        'M 34 47 A 4 6 0 1 1 33.9 47 Z M 66 47 A 4 6 0 1 1 65.9 47 Z M 38 64 Q 50 78 62 64 M 25 61 L 31 62 M 69 62 L 75 61',
      ], colors: ['#b1d5a7', '#efbe86', '#e9e2ce'],
    },
    {
      label: 'P3 · Squat autumn pumpkin',
      paths: [
        'M 47 29 Q 40 14 53 9 L 58 14 Q 46 19 54 30 M 58 21 Q 71 11 83 19 Q 78 33 62 27 M 59 25 Q 72 22 80 20',
        'M 50 33 C 26 17 5 35 11 61 C 16 85 35 88 50 82 C 65 88 84 85 89 61 C 95 35 74 17 50 33 Z M 50 33 C 31 22 24 40 26 59 Q 29 82 50 82 M 50 33 C 69 22 76 40 74 59 Q 71 82 50 82 M 50 33 Q 39 59 50 82 M 50 33 Q 61 59 50 82',
      ], colors: ['#b1d5a7', '#efbe86'],
    },
  ],
  stocking: [
    {
      label: 'S1 · Classic stocking',
      paths: [
        'M 44 27 L 76 27 L 76 62 Q 77 80 60 84 L 29 91 Q 13 93 12 81 Q 11 70 28 68 L 40 66 Q 45 64 44 57 Z M 27 68 Q 39 76 32 90 M 65 63 Q 62 75 72 75',
        'M 41 13 L 79 13 L 79 27 L 41 27 Z M 47 14 Q 45 4 52 6 Q 59 7 56 13',
        'M 54 39 L 67 39 L 67 53 L 54 53 Z M 58 36 L 58 42 M 63 36 L 63 42 M 51 44 L 57 44 M 51 49 L 57 49 M 64 44 L 70 44 M 64 49 L 70 49 M 58 50 L 58 56 M 63 50 L 63 56',
      ], colors: ['#e5adb9', '#e9e2ce', '#b1d5a7'],
    },
    {
      label: 'S2 · Candy-striped stocking',
      paths: [
        'M 42 25 L 76 25 L 76 64 Q 77 80 58 85 L 25 91 Q 10 92 11 79 Q 12 69 27 66 L 40 63 Q 44 61 42 52 Z M 24 68 Q 33 74 31 90 M 66 64 Q 63 75 72 75',
        'M 39 11 L 79 11 L 79 25 L 39 25 Z M 47 11 Q 41 0 49 3 Q 57 4 54 11',
        'M 43 35 L 76 43 M 43 48 L 76 56 M 40 62 L 73 70 M 30 67 L 50 86 M 14 76 L 26 91',
      ], colors: ['#e9e2ce', '#b1d5a7', '#e5adb9'],
    },
    {
      label: 'S3 · Fluffy cuff and star',
      paths: [
        'M 25 29 L 57 29 L 57 62 Q 57 67 69 67 Q 87 66 88 80 Q 88 93 73 91 L 41 85 Q 25 81 25 64 Z M 73 68 Q 61 78 68 90 M 25 66 Q 40 65 38 84',
        'M 22 14 Q 25 8 31 13 Q 37 8 43 13 Q 50 8 56 13 Q 64 10 62 18 L 62 25 Q 59 32 53 28 Q 47 34 41 28 Q 34 33 29 28 Q 20 31 22 23 Z',
        'M 41 40 L 44 47 L 52 47 L 46 52 L 48 60 L 41 56 L 34 60 L 36 52 L 30 47 L 38 47 Z',
      ], colors: ['#b1d5a7', '#e9e2ce', '#eed69a'],
    },
  ],
  letter: [
    {
      label: 'L1 · Sealed with a heart',
      paths: [
        'M 12 30 L 88 30 L 88 83 L 12 83 Z M 12 30 L 34 46 M 88 30 L 66 46 M 12 83 L 35 59 M 88 83 L 65 59',
        'M 50 68 C 33 56 32 45 40 42 Q 47 39 50 47 Q 53 39 60 42 C 68 45 67 56 50 68 Z',
      ], colors: ['#e9e2ce', '#e5adb9'],
    },
    {
      label: 'L2 · Open love letter',
      paths: [
        'M 12 51 L 12 89 L 88 89 L 88 51 M 12 51 L 25 41 M 75 41 L 88 51 M 12 51 L 38 70 M 88 51 L 62 70 M 12 89 L 43 65 L 57 65 L 88 89',
        'M 25 60 L 25 17 L 75 17 L 75 60 M 31 25 L 69 25 M 32 57 L 40 57 M 60 57 L 68 57',
        'M 50 56 C 34 45 34 35 41 33 Q 48 30 50 38 Q 52 30 59 33 C 66 35 66 45 50 56 Z',
      ], colors: ['#e5adb9', '#e9e2ce', '#e5adb9'],
    },
    {
      label: 'L3 · Letter and floating hearts',
      paths: [
        'M 12 42 L 88 42 L 88 88 L 12 88 Z M 12 42 L 50 69 L 88 42 M 12 88 L 34 65 M 88 88 L 66 65',
        'M 46 33 C 28 21 27 10 35 7 Q 42 4 46 12 Q 50 4 57 7 C 65 10 64 21 46 33 Z',
        'M 77 31 C 65 23 65 16 71 14 Q 75 12 77 17 Q 79 12 83 14 C 89 16 89 23 77 31 Z M 20 33 C 12 27 12 22 16 21 Q 19 20 20 23 Q 21 20 24 21 C 28 22 28 27 20 33 Z',
      ], colors: ['#e9e2ce', '#e5adb9', '#d4b8e3'],
    },
  ],
  dreidel: [
    {
      label: 'D1 · Rounded wooden handle',
      paths: [
        'M 43 30 L 43 13 C 43 5 57 5 57 13 L 57 30 M 43 13 Q 50 17 57 13',
        'M 43 27 L 24 33 L 24 65 L 50 92 L 76 65 L 76 33 L 57 27 M 24 33 L 50 41 L 76 33 M 50 41 L 50 92 M 24 65 L 50 74 L 76 65 M 43 30 Q 50 34 57 30',
        'M 32 44 L 43 48 L 43 61 L 31 57 M 60 48 L 70 44 L 70 57 L 59 61',
      ], colors: ['#efce91', '#efce91', '#b4cde5'],
    },
    {
      label: 'D2 · Square handle, matching perspective',
      paths: [
        'M 43 11 L 50 7 L 58 11 L 51 15 Z M 43 11 L 43 31 L 51 35 L 58 31 L 58 11 M 51 15 L 51 35',
        'M 43 28 L 25 36 L 25 68 L 51 94 L 78 68 L 78 36 L 58 28 M 25 36 L 51 46 L 78 36 M 51 46 L 51 94 M 25 68 L 51 78 L 78 68',
        'M 32 47 L 44 51 L 44 65 L 31 60 M 61 51 L 72 47 L 72 61 L 60 66',
      ], colors: ['#e9e2ce', '#b4cde5', '#eed69a'],
    },
    {
      label: 'D3 · Simple front view',
      paths: [
        'M 45 27 L 45 12 Q 45 7 50 7 Q 55 7 55 12 L 55 27',
        'M 45 25 Q 31 25 28 33 L 28 66 L 50 93 L 72 66 L 72 33 Q 69 25 55 25 M 28 66 L 72 66',
        'M 40 39 L 57 39 L 57 57 L 39 57',
      ], colors: ['#efce91', '#efce91', '#b4cde5'],
    },
  ],
}
