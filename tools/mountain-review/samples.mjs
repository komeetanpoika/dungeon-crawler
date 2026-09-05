// Ten small mountain masses drawn with the current rules
// (tools/static-overworld/mountain.mjs), for the review page in serve.mjs.
// Each sample is drawn in several variants and carries, per cell, the
// ground and prop tiles chosen, the shape the rule picked and the
// 8-neighbour floor mask, so a reviewer's marks can be turned into new
// rules without re-running anything.
import { MapBuilder, mulberry32, makeNoise } from '../static-overworld/lib.mjs'
import { MTN_GROUND_WEIGHTED, isMass, rimShape, stampMass, stampRock, clearMountain, stampMountainRim } from '../static-overworld/mountain.mjs'

const W = 18, H = 12
const rngFor = seed => mulberry32(seed)

export const VARIANTS = [
  { key: 'A', label: 'A: lattice with boulder rims, no shadow', opts: { apron: false, walls: 'ridge' } },
  { key: 'B', label: 'B: as A, shadow south of masses', opts: { apron: true, walls: 'ridge' } },
  { key: 'C', label: 'C: as A, one-cell walls as thin lattice', opts: { apron: false, walls: 'lattice' } },
]

function base(name, seed) {
  const b = new MapBuilder(name, 'forest', 'review', W, H)
  const rng = rngFor(seed)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) b.g(x, y, MTN_GROUND_WEIGHTED[Math.floor(rng() * MTN_GROUND_WEIGHTED.length)])
  for (let i = 0; i < 3; i++) stampRock(b, rng, Math.floor(rng() * W), Math.floor(rng() * H))
  return { b, rng }
}
const rect = (b, rng, x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) stampMass(b, rng, x, y) }

const MAKERS = [
  ['solid block', 1, (b, rng) => rect(b, rng, 5, 3, 12, 8)],
  ['block with a notch in its south face', 2, (b, rng) => { rect(b, rng, 5, 2, 12, 8); clearMountain(b, rng, 8, 8, 1) }],
  ['staircase (diagonal edge)', 3, (b, rng) => { for (let y = 1; y <= 10; y++) rect(b, rng, 2, y, 2 + y, y) }],
  ['noise blob A', 4, (b, rng) => { const n = makeNoise(rngFor(40)); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (n(x, y, { freq: 0.16, octaves: 2 }) > 0.5) stampMass(b, rng, x, y) }],
  ['noise blob B', 5, (b, rng) => { const n = makeNoise(rngFor(77)); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (n(x, y, { freq: 0.13, octaves: 2 }) > 0.47) stampMass(b, rng, x, y) }],
  ['one-wide ridges (an L and a lone column)', 6, (b, rng) => { rect(b, rng, 2, 2, 10, 2); rect(b, rng, 10, 2, 10, 9); rect(b, rng, 14, 1, 14, 10) }],
  ['two masses with a one-wide pass between', 7, (b, rng) => { rect(b, rng, 1, 1, 7, 10); rect(b, rng, 9, 1, 16, 10) }],
  ['block with a courtyard opened inside', 8, (b, rng) => { rect(b, rng, 3, 1, 14, 10); clearMountain(b, rng, 8, 5, 2) }],
  ['blob with a diagonal pass carved through', 9, (b, rng) => { rect(b, rng, 2, 1, 15, 10); for (let i = 0; i < 11; i++) clearMountain(b, rng, 3 + i, 1 + Math.floor(i * 0.8), 1) }],
  ['dense scatter (like the real map before healing)', 10, (b, rng) => { const r2 = rngFor(99); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (r2() < 0.62) stampMass(b, rng, x, y) }],
]

export function buildSamples() {
  return MAKERS.map(([title, seed, make], i) => {
    const variants = VARIANTS.map(v => {
      const { b, rng } = base(`sample-${i + 1}`, seed)
      make(b, rng)
      // record the mask each cell was judged on, before the rim repaints
      const masks = Array.from({ length: H }, () => new Array(W).fill(null))
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!isMass(b, x, y)) continue
        const floor = (dx, dy) => !isMass(b, x + dx, y + dy)
        const f = { N: floor(0, -1), E: floor(1, 0), S: floor(0, 1), W: floor(-1, 0) }
        const d = { NE: floor(1, -1), NW: floor(-1, -1), SE: floor(1, 1), SW: floor(-1, 1) }
        masks[y][x] = { f, d, shape: String(rimShape(f, d, v.opts)) }
      }
      stampMountainRim(b, rng, v.opts)
      const cells = b.ground.map((row, y) => row.map((gi, x) => ({ ground: b.palette[gi], prop: b.prop[y][x] >= 0 ? b.palette[b.prop[y][x]] : null, walk: b.walkable(x, y), ...(masks[y][x] ?? {}) })))
      return { key: v.key, label: v.label, cells }
    })
    return { id: i + 1, title, w: W, h: H, variants }
  })
}
