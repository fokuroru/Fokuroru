import '@fontsource/anton/latin-400.css'
import '@fontsource/gelasio/latin-400.css'
import '@fontsource/gelasio/latin-700.css'
import '@fontsource/courier-prime/latin-700.css'
import '@fontsource/comic-neue/latin-700.css'
import '@fontsource/fira-sans/latin-400.css'
import '@fontsource/fira-sans/latin-700.css'

/**
 * The thirty spine editions from the manga-shelf reference. Each is a palette, a title face, an
 * optional hard text shadow and its layout quirks. Its system faces (Impact, Georgia, Arial Black,
 * Trebuchet MS, Courier New, Comic Sans MS) are swapped for bundled look-alikes, since Android and
 * most Linux browsers ship none of them: Anton, Gelasio (metric-compatible with Georgia), Fira Sans,
 * Courier Prime and Comic Neue. Titles are bold unless the reference set them at 400.
 */
export interface SpineStyle {
  bg: string
  fg: string
  accent: string
  /** CSS font shorthand without the size, e.g. `700 'Gelasio', serif`. */
  font: string
  /** Hard offset shadow behind the title, as in the reference's text-shadow. */
  shadow?: { x: number; y: number; color: string }
}

const IMPACT = "'Anton', Impact, sans-serif"
const GEORGIA = "'Gelasio', Georgia, serif"
const GEORGIA_BOLD = "700 'Gelasio', Georgia, serif"
const TREBUCHET = "'Fira Sans', 'Trebuchet MS', sans-serif"
const TREBUCHET_BOLD = "700 'Fira Sans', 'Trebuchet MS', sans-serif"
const COURIER = "700 'Courier Prime', 'Courier New', monospace"
const COMIC = "700 'Comic Neue', 'Comic Sans MS', cursive"

export const SPINE_STYLES: SpineStyle[] = [
  { bg: '#daf244', fg: '#1d3225', accent: '#aec827', font: IMPACT },
  { bg: '#171d52', fg: '#ffe3a6', accent: '#303a80', font: GEORGIA },
  { bg: '#eee5cb', fg: '#d82724', accent: '#f9bf32', font: IMPACT, shadow: { x: 2, y: 1, color: '#242324' } },
  { bg: '#83d5e4', fg: '#143b65', accent: '#fba6ba', font: TREBUCHET_BOLD },
  { bg: '#301b4a', fg: '#f6c4f2', accent: '#70296d', font: GEORGIA, shadow: { x: 2, y: 2, color: '#d44276' } },
  { bg: '#ff7719', fg: '#211b20', accent: '#e9ff31', font: IMPACT, shadow: { x: 2, y: 2, color: '#ffffff' } },
  { bg: '#f0e4c8', fg: '#214539', accent: '#bda77a', font: GEORGIA_BOLD },
  { bg: '#f4eee1', fg: '#1e2427', accent: '#dd302f', font: COURIER, shadow: { x: 2, y: 0, color: '#ed3535' } },
  { bg: '#f5cc23', fg: '#822d2b', accent: '#ffeec6', font: IMPACT },
  { bg: '#d7f2eb', fg: '#18647a', accent: '#63c9ca', font: GEORGIA },
  { bg: '#23232b', fg: '#f9eacb', accent: '#ed3935', font: IMPACT },
  { bg: '#f9a9c7', fg: '#77336a', accent: '#9bddb5', font: COMIC, shadow: { x: 2, y: 2, color: '#fff6db' } },
  { bg: '#244c37', fg: '#d7efa3', accent: '#628646', font: GEORGIA_BOLD },
  { bg: '#793f92', fg: '#fff049', accent: '#e25296', font: IMPACT, shadow: { x: 3, y: 3, color: '#221639' } },
  { bg: '#f5e5cf', fg: '#7d4030', accent: '#e99563', font: TREBUCHET },
  { bg: '#0c5478', fg: '#d8f6f3', accent: '#172d55', font: GEORGIA },
  { bg: '#fff1bb', fg: '#ad3134', accent: '#faac46', font: COMIC },
  { bg: '#aabd45', fg: '#233d36', accent: '#e8dca7', font: GEORGIA_BOLD },
  { bg: '#171729', fg: '#39f9d1', accent: '#563ea2', font: COURIER, shadow: { x: 2, y: 0, color: '#fd3098' } },
  { bg: '#ee427a', fg: '#fff0da', accent: '#25232c', font: IMPACT, shadow: { x: 3, y: 2, color: '#25232c' } },
  // The ten slim paperback editions.
  { bg: '#fff6e6', fg: '#d22755', accent: '#f4b3c6', font: IMPACT },
  { bg: '#f5eedf', fg: '#232323', accent: '#e43f30', font: IMPACT, shadow: { x: 1, y: 1, color: '#e63c33' } },
  { bg: '#f8faf0', fg: '#197ba4', accent: '#83cce1', font: GEORGIA },
  { bg: '#f7c728', fg: '#b12323', accent: '#ef722e', font: IMPACT, shadow: { x: 1, y: 1, color: '#fff0b1' } },
  { bg: '#fff4f3', fg: '#b34485', accent: '#f1b0cd', font: COMIC },
  { bg: '#252b35', fg: '#f6eee0', accent: '#a6212c', font: GEORGIA_BOLD },
  { bg: '#fffae2', fg: '#66503d', accent: '#b6c77b', font: TREBUCHET_BOLD },
  { bg: '#eeeee5', fg: '#334739', accent: '#8ca875', font: IMPACT },
  { bg: '#ede9dd', fg: '#254180', accent: '#ed8a36', font: COURIER },
  { bg: '#e5eff2', fg: '#594775', accent: '#bab7d4', font: GEORGIA },
]

/** Styles whose volume band sits at the head of the spine rather than the foot. */
export const BAND_TOP = new Set([1, 5, 12, 18, 21, 25, 28])
/** Styles that set the title across the spine instead of down it. */
export const HORIZONTAL_TITLE = new Set([2, 4, 11, 14, 16, 19])
/** From 20 on, the slim paperback editions: drawn narrower whatever the series. */
export const SLIM_FROM = 20
export const IMPRINTS = ['✦', '月', 'K', '雨', '✿']

/** Every face a spine can use, for `document.fonts.load` before textures are drawn. */
export const SPINE_FONTS = [IMPACT, GEORGIA, GEORGIA_BOLD, TREBUCHET, TREBUCHET_BOLD, COURIER, COMIC]
