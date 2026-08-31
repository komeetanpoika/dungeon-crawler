// Shared 16-bit pixel toolkit for monster rigs. Rigs draw axis-aligned art
// into a low-resolution stage (TILE_ART_PX art px per map tile) and the
// finished stage is blitted rotated as one unit with nearest-neighbour —
// the same grid-coherence trick as render/dragonboss-pixel.js. Facing snaps
// to 8 directions (45° steps); animation is frame-stepped via frameOf.
// Pure module: no game imports. Node (tests) has no canvas, so withPixelStage
// falls back to drawing straight onto the target ctx under the same
// transform — op streams stay testable, browsers get the crisp buffer path.
export const TILE_ART_PX = 16

const STEP = Math.PI / 4

export function snapFacing(angle) {
  const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return (Math.round(a / STEP) % 8) * STEP
}

// One base colour -> a chunky 3-tone ramp (outline / base / light), every
// channel quantized to 8-step levels for the 16-bit look.
const q8 = v => Math.min(248, Math.max(0, Math.round(v / 8) * 8))
const hex = (r, g, b) => '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')

export function palette(baseHex) {
  const n = parseInt(baseHex.slice(1), 16)
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255
  return {
    outline: hex(q8(r * 0.45), q8(g * 0.45), q8(b * 0.45)),
    base: hex(q8(r), q8(g), q8(b)),
    light: hex(q8(r + 64), q8(g + 64), q8(b + 64)),
  }
}

export function frameOf(t, fps, frames) {
  return Math.floor(t * fps) % frames
}

// Reused stages keyed by size — cleared each use, shared by every monster of
// the same footprint (draws are synchronous, so no aliasing between them).
const stages = new Map()
function stageBuffer(w, h) {
  if (typeof OffscreenCanvas === 'undefined') return null
  const key = w + 'x' + h
  let buf = stages.get(key)
  if (!buf) { buf = new OffscreenCanvas(w, h); stages.set(key, buf) }
  return buf
}

// drawFn receives a ctx whose units are art px with the origin at the stage
// centre (-y forward, matching the rig convention). The stage is then blitted
// onto `ctx` rotated by the snapped facing and scaled S / TILE_ART_PX.
export function withPixelStage(ctx, artW, artH, angle, S, drawFn) {
  const k = S / TILE_ART_PX
  const snapped = snapFacing(angle)
  const buf = stageBuffer(artW, artH)
  if (buf) {
    const bctx = buf.getContext('2d')
    bctx.clearRect(0, 0, artW, artH)
    bctx.save()
    bctx.translate(artW / 2, artH / 2)
    drawFn(bctx)
    bctx.restore()
    ctx.save()
    ctx.rotate(snapped)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(buf, -artW / 2 * k, -artH / 2 * k, artW * k, artH * k)
    ctx.restore()
  } else {
    ctx.save()
    ctx.rotate(snapped)
    ctx.scale(k, k)
    drawFn(ctx)
    ctx.restore()
  }
}
