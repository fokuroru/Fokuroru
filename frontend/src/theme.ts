import {
  Badge,
  Button,
  Card,
  type MantineColorsTuple,
  type MantineThemeOverride,
  Modal,
  Paper,
  Table,
  createTheme,
} from '@mantine/core'
import type { ReactNode } from 'react'

const ModalPassthrough = ({ children }: { children?: ReactNode }) => children

/**
 * Maki Spine.
 *
 * The library is a shelf: every series carries a spine colour sampled from its cover, and the
 * chrome stays warm charcoal and bone so covers and spines carry the colour. `brand` is the
 * fallback spine for screens that belong to no series; a series page overrides the CSS
 * `--spine` variables with its own. Corners are square throughout. Semantic status hues live
 * in ./status.ts.
 */

const spine: MantineColorsTuple = [
  '#fbeceb',
  '#f4d3d0',
  '#e9a8a2',
  '#e8867c',
  '#d4584d',
  '#b83d33',
  '#a3322b',
  '#8a2a24',
  '#71221d',
  '#581b17',
]

/** One palette now: the per-series spine replaced the accent picker. Kept as a map so stored ids resolve. */
export const accents: Record<string, MantineColorsTuple> = { spine }

// Warm charcoal ramp. 7 = app ground, 6 = shelf, 5 = raised, 4 = rules, 2 = dimmed, 0 = text.
const dark: MantineColorsTuple = [
  '#ece5d8',
  '#cfc7b8',
  '#a39c8e',
  '#7d766a',
  '#4a453e',
  '#332f2b',
  '#2a2724',
  '#1d1b19',
  '#171513',
  '#100f0e',
]

export function createAppTheme(accent: MantineColorsTuple = spine) {
  return createTheme({ ...themeBase, colors: { brand: accent, dark } })
}

const themeBase: MantineThemeOverride = {
  primaryColor: 'brand',
  primaryShade: { light: 6, dark: 6 },
  autoContrast: true,
  colors: { brand: spine, dark },
  defaultRadius: 0,
  fontFamily:
    '"Zen Kaku Gothic New", "Noto Sans JP", "Noto Sans KR", "Noto Sans SC", system-ui, sans-serif',
  fontFamilyMonospace: '"Martian Mono Variable", "Martian Mono", ui-monospace, "SF Mono", Menlo, monospace',
  headings: {
    fontWeight: '700',
    sizes: {
      h1: { fontSize: '2.5rem', lineHeight: '1.05', fontWeight: '900' },
      h2: { fontSize: '1.5rem', lineHeight: '1.2', fontWeight: '700' },
      h3: { fontSize: '1.2rem', lineHeight: '1.3' },
      h4: { fontSize: '1rem', lineHeight: '1.4' },
    },
  },
  // Square system: every step is 0 so a stray radius="lg" at a call site stays square too.
  radius: {
    xs: '0px',
    sm: '0px',
    md: '0px',
    lg: '0px',
    xl: '0px',
  },
  shadows: {
    sm: 'none',
    md: 'none',
    lg: 'none',
  },
  cursorType: 'pointer',
  components: {
    Card: Card.extend({
      defaultProps: { radius: 0, withBorder: false },
    }),
    Paper: Paper.extend({
      defaultProps: { radius: 0 },
    }),
    Button: Button.extend({
      defaultProps: { radius: 0 },
    }),
    Badge: Badge.extend({
      defaultProps: { radius: 0, fw: 500 },
    }),
    /**
     * The utility tier: every ordinary dialog gets the raised card, the sectioned header over a
     * hairline and a body that scrolls under it, without touching the call site. The immersive
     * Discover modal opts out by passing `padding={0} title={null} withCloseButton={false}` (no
     * header renders at all) and its own content styles.
     *
     * No scroll wrapper around header and body: Mantine's default wraps both, so the scrollbar ran
     * past the title and the content box could overflow on top of it. The content is a flex column
     * instead and only `.utility-modal-body` scrolls (theme.css).
     */
    Modal: Modal.extend({
      defaultProps: {
        radius: 0,
        padding: 'lg',
        centered: true,
        scrollAreaComponent: ModalPassthrough,
        overlayProps: { blur: 0, backgroundOpacity: 0.72, color: '#141210' },
        classNames: {
          content: 'utility-modal-content',
          header: 'utility-modal-header',
          title: 'utility-modal-title',
          close: 'utility-modal-close',
          body: 'utility-modal-body',
        },
      },
    }),
    Table: Table.extend({
      defaultProps: { verticalSpacing: 'sm', horizontalSpacing: 'md' },
    }),
  },
}

/** Default theme, kept as a named export for any non-dynamic consumers. */
export const theme = createAppTheme()
