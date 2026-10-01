import * as T from 'three'

/**
 * A potted snake plant (sansevieria): a turned terracotta pot on a saucer, dark soil, and a clump
 * of tall sword leaves, each tapered, folded along its midrib, curving and slightly twisted, with
 * banded variegation and yellow margins. The pot and saucer have separate models, each with its
 * origin at the centre of its underside.
 */
export interface PottedPlant {
  group: T.Group
  saucer: T.Mesh
  saucerWidth: number
  saucerHeight: number
  /** Widest part of the pot, for its physics body. */
  potWidth: number
  /** Pot without its saucer. */
  potHeight: number
  /** Height of the leaf clump above the soil. */
  leafHeight: number
  /** Width the leaves spread to, for a lighter body above the pot. */
  leafSpread: number
  /**
   * One pivot per leaf, at its base in the soil. Rotating a pivot about z bends the leaf in the
   * shelf's plane, which is how the renderer makes the leaves sway when the plant moves.
   */
  leaves: { pivot: T.Group; height: number; stiffness: number }[]
  dispose: () => void
}

const rand = (min: number, max: number) => min + Math.random() * (max - min)

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): T.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const t = new T.CanvasTexture(c)
  t.colorSpace = T.SRGBColorSpace
  return t
}

/** Unglazed terracotta: warm base, mottled darker and lighter patches, a faint throwing line. */
function terracotta(): T.CanvasTexture {
  return canvasTexture(256, 128, (ctx) => {
    ctx.fillStyle = '#b5623f'
    ctx.fillRect(0, 0, 256, 128)
    for (let i = 0; i < 900; i++) {
      const light = Math.random() < 0.5
      ctx.fillStyle = light ? `rgba(226,150,110,${rand(0.05, 0.18)})` : `rgba(90,40,24,${rand(0.05, 0.16)})`
      ctx.beginPath()
      ctx.arc(Math.random() * 256, Math.random() * 128, rand(0.5, 3.5), 0, Math.PI * 2)
      ctx.fill()
    }
    for (let y = 6; y < 128; y += rand(9, 16)) {
      ctx.strokeStyle = `rgba(80,36,20,${rand(0.05, 0.12)})`
      ctx.lineWidth = rand(0.5, 1.5)
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(256, y + rand(-1, 1))
      ctx.stroke()
    }
  })
}

function soil(): T.CanvasTexture {
  return canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#34261b'
    ctx.fillRect(0, 0, 128, 128)
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = Math.random() < 0.15 ? `rgba(190,170,140,${rand(0.3, 0.6)})` : `rgba(12,8,5,${rand(0.2, 0.5)})`
      ctx.fillRect(Math.random() * 128, Math.random() * 128, rand(0.6, 2), rand(0.6, 2))
    }
  })
}

/** A sansevieria leaf face: dark green with pale wavy cross-bands and a yellow margin at each edge. */
function leafSkin(): T.CanvasTexture {
  return canvasTexture(64, 512, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 64, 0)
    g.addColorStop(0, '#26451f')
    g.addColorStop(0.5, '#34602b')
    g.addColorStop(1, '#26451f')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 512)
    for (let y = 8; y < 512; y += rand(10, 22)) {
      ctx.strokeStyle = `rgba(150,190,120,${rand(0.25, 0.5)})`
      ctx.lineWidth = rand(1.5, 4)
      ctx.beginPath()
      const phase = Math.random() * 6
      for (let x = 0; x <= 64; x += 4) {
        const yy = y + Math.sin(x / 9 + phase) * rand(1.5, 3)
        if (x === 0) ctx.moveTo(x, yy)
        else ctx.lineTo(x, yy)
      }
      ctx.stroke()
    }
    ctx.fillStyle = '#c9b24a'
    ctx.fillRect(0, 0, 5, 512)
    ctx.fillRect(59, 0, 5, 512)
    ctx.fillStyle = 'rgba(255,240,170,0.35)'
    ctx.fillRect(1, 0, 2, 512)
    ctx.fillRect(61, 0, 2, 512)
  })
}

/**
 * One leaf: a strip that tapers to a point, folds into a shallow V along its midrib, arches over
 * and twists a little along its length.
 */
function leafGeometry(width: number, height: number, arch: number, twist: number): T.BufferGeometry {
  const geometry = new T.PlaneGeometry(width, height, 6, 24)
  geometry.translate(0, height / 2, 0)
  const p = geometry.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const v = y / height
    // Narrow slightly at the base, widest a third of the way up, then run to a sharp tip.
    const taper = v < 0.3 ? 0.75 + (v / 0.3) * 0.25 : Math.pow(1 - (v - 0.3) / 0.7, 0.85)
    const nx = x * taper
    const fold = Math.abs(nx) * 0.35
    const bend = arch * v * v
    const a = twist * v
    p.setXYZ(i, nx * Math.cos(a) - fold * Math.sin(a), y, fold * Math.cos(a) + nx * Math.sin(a) + bend)
  }
  geometry.computeVertexNormals()
  return geometry
}

export function buildPottedPlant(): PottedPlant {
  const group = new T.Group()
  const disposables: { dispose: () => void }[] = []
  const track = <X extends { dispose: () => void }>(x: X) => {
    disposables.push(x)
    return x
  }

  const potH = rand(64, 74)
  const baseR = rand(22, 25)
  const topR = baseR + rand(7, 9)
  const saucerH = 5
  const clay = track(new T.MeshStandardMaterial({ map: track(terracotta()), roughness: 0.92, metalness: 0 }))
  const inside = track(new T.MeshStandardMaterial({ color: '#6f3421', roughness: 1 }))

  // Saucer.
  const saucerClay = track(clay.clone())
  saucerClay.map = track(clay.map!.clone())
  const saucer = new T.Mesh(track(new T.CylinderGeometry(topR - 1, baseR + 3, saucerH, 40)), saucerClay)
  saucer.position.y = saucerH / 2
  saucer.castShadow = saucer.receiveShadow = true

  // The pot, turned on a lathe: base, flared wall, a rolled rim with a small lip.
  const profile = [
    new T.Vector2(0.01, 0),
    new T.Vector2(baseR - 1, 0),
    new T.Vector2(baseR, 1.5),
    new T.Vector2(topR - 3, potH - 12),
    new T.Vector2(topR + 1.5, potH - 11),
    new T.Vector2(topR + 2, potH - 2),
    new T.Vector2(topR + 0.5, potH),
    new T.Vector2(topR - 3, potH),
  ]
  const pot = new T.Mesh(track(new T.LatheGeometry(profile, 48)), clay)
  group.add(pot)
  const well = new T.Mesh(track(new T.CylinderGeometry(topR - 3, topR - 4, 6, 40, 1, true)), inside)
  well.material.side = T.BackSide
  well.position.y = potH - 3
  group.add(well)

  // Soil, sitting just below the rim.
  const soilY = potH - 5
  const earth = new T.Mesh(
    track(new T.CircleGeometry(topR - 3.2, 40)),
    track(new T.MeshStandardMaterial({ map: track(soil()), roughness: 1 })),
  )
  earth.rotation.x = -Math.PI / 2
  earth.position.y = soilY
  group.add(earth)

  // The leaf clump: a few tall centre leaves and shorter, more open ones round them.
  const skin = track(leafSkin())
  const leafMaterial = track(new T.MeshStandardMaterial({ map: skin, roughness: 0.55, metalness: 0, side: T.DoubleSide }))
  const count = Math.round(rand(7, 10))
  const leafHeight = rand(160, 215)
  let spread = 0
  const leaves: PottedPlant['leaves'] = []
  for (let i = 0; i < count; i++) {
    const centre = i < 3
    const h = leafHeight * (centre ? rand(0.88, 1) : rand(0.55, 0.85))
    const w = rand(11, 16)
    const leaf = new T.Mesh(track(leafGeometry(w, h, rand(-14, 14), rand(-0.5, 0.5))), leafMaterial)
    const around = (i / count) * Math.PI * 2 + rand(-0.3, 0.3)
    const r = centre ? rand(0, 5) : rand(6, topR - 8)
    const pivot = new T.Group()
    pivot.position.set(Math.cos(around) * r, soilY - 2, Math.sin(around) * r)
    leaf.rotation.y = around + Math.PI / 2 + rand(-0.4, 0.4)
    // Lean outward with distance from the centre, as the outer leaves of a clump do.
    const lean = (centre ? rand(0, 0.08) : rand(0.1, 0.28)) * (Math.random() < 0.5 ? 1 : -1)
    leaf.rotation.z = lean
    spread = Math.max(spread, r + Math.abs(Math.sin(lean)) * h + w / 2)
    pivot.add(leaf)
    group.add(pivot)
    // Tall centre leaves are stiffer at the base; short outer ones flop more freely.
    leaves.push({ pivot, height: h, stiffness: rand(0.8, 1.2) * (centre ? 1.1 : 0.9) })
  }

  group.traverse((n) => {
    if ((n as T.Mesh).isMesh) {
      n.castShadow = true
      n.receiveShadow = true
    }
  })

  return {
    group,
    saucer,
    saucerWidth: (topR - 1) * 2,
    saucerHeight: saucerH,
    potWidth: (topR + 2) * 2,
    potHeight: potH,
    leafHeight,
    leafSpread: Math.min(spread * 2, (topR + 2) * 2.4),
    leaves,
    dispose: () => disposables.forEach((d) => d.dispose()),
  }
}
