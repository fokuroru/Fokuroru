export interface CoverPalette { bg: string; fg: string; accent: string }

type Bucket = { weight: number; r: number; g: number; b: number }

/** Keep the strongest colour family from the art, rather than averaging unrelated hues or inverting it. */
export function coverPalette(pixels: Uint8ClampedArray): CoverPalette | null {
  const buckets: Bucket[] = Array.from({ length: 24 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }))
  let visible = 0
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255
    visible += alpha
    const r = pixels[i] / 255
    const g = pixels[i + 1] / 255
    const b = pixels[i + 2] / 255
    const hi = Math.max(r, g, b)
    const lo = Math.min(r, g, b)
    const light = (hi + lo) / 2
    const delta = hi - lo
    if (delta < 0.06 || light < 0.1 || light > 0.92) continue
    const saturation = delta / (1 - Math.abs(2 * light - 1))
    let hue = (hi === r ? (g - b) / delta : hi === g ? (b - r) / delta + 2 : (r - g) / delta + 4) / 6
    hue = (hue + 1) % 1
    // Faces and beige paper should not outweigh the cover's pink, yellow or green design.
    if (saturation < 0.15 || (hue < 0.11 && saturation < 0.8 && light > 0.35)) continue
    const weight = alpha * Math.pow(saturation, 0.8)
    const bucket = buckets[Math.floor(hue * buckets.length)]
    bucket.weight += weight
    bucket.r += r * weight
    bucket.g += g * weight
    bucket.b += b * weight
  }

  const family = (index: number): Bucket => {
    const result = { weight: 0, r: 0, g: 0, b: 0 }
    for (const offset of [-1, 0, 1]) {
      const bucket = buckets[(index + offset + buckets.length) % buckets.length]
      const share = offset === 0 ? 1 : 0.5
      for (const key of ['weight', 'r', 'g', 'b'] as const) result[key] += bucket[key] * share
    }
    return result
  }
  const best = buckets.map((_, i) => family(i)).reduce((a, b) => b.weight > a.weight ? b : a)
  if (!visible || best.weight / visible < 0.025) return null
  const rgb = [best.r, best.g, best.b].map((value) => value / best.weight)
  const luminance = rgb.reduce((sum, value, i) => {
    const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    return sum + linear * [0.2126, 0.7152, 0.0722][i]
  }, 0)
  const darkText = (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
  const hex = (values: number[]) => `#${values.map((value) => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`
  return {
    bg: hex(rgb),
    fg: darkText ? '#000000' : '#ffffff',
    // The chapter band keeps the same hue and improves contrast for the chosen lettering.
    accent: hex(rgb.map((value) => value * 0.84 + (darkText ? 0.16 : 0))),
  }
}
