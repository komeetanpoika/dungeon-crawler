// Pixel-art dragon boss. Every part is a sprite from
// assets/tiles/dragon_boss_parts.png, composited into a single low-resolution
// buffer and blitted up with nearest-neighbour — so all rotated parts share one
// pixel grid instead of aliasing independently.
//
// dragonPartPlacements() is pure and holds the whole rig; it mirrors the
// geometry in render/dragonboss.js. Positions are art pixels local to the boss
// centre, -y forward (head), +y back (tail). Facing is NOT applied here: the
// finished buffer is rotated as a unit, which is what keeps the grid coherent.
import { PARTS, SHEET_SPRITE, ART_PX } from '../data/dragon-parts.js'

// Buffer side in art px: the rig may reach BUF/2 = 80 from the centre before it
// is silently clipped. Measured, not guessed — every opaque sprite corner over a
// sweep of the animated poses, in art px from the centre: flame 54.7 x / 75.8 y,
// wing 60.9 / 47.0, head 35.4 / 56.4, tail tip 37.2 / 61.2. The flame is the
// binding one, with ~4 px of headroom — and only because its baked gradient
// faded out at 32 art px against the vector cone's 41.6. Redraw it out to full
// length and this buffer must grow with it.
const BUF = 160

// Joint positions along a chain, mirroring scaledChain() in dragonboss.js.
function chainPoints(x, y, startAng, segs, segLen, bendFn) {
  let px = x, py = y, ang = startAng
  const pts = [{ x: px, y: py, ang }]
  for (let i = 0; i < segs; i++) {
    ang += bendFn(i)
    px += Math.cos(ang) * segLen
    py += Math.sin(ang) * segLen
    pts.push({ x: px, y: py, ang })
  }
  return pts
}

export function dragonPartPlacements(e, S) {
  const A = ART_PX * S / 32             // screen px per art px at this tile size
  const t = e.breathTime ?? 0
  const bw = 3 * S, bh = 4 * S
  const out = []
  // Positions arrive in screen px and land on whole art px — the snap is what
  // stops parts jittering off the grid between frames.
  const put = (part, x, y, ang, flipX = false) =>
    out.push({ part, x: Math.round(x / A), y: Math.round(y / A), ang, flipX })

  // Feet — bottom layer, claws fanning outward from the body centre. The sheet's
  // foot was baked with both its translate and its rotate(wig) cancelled, so the
  // placement owns the full outward + wig angle.
  for (const [fx, fy, tOff] of [[-0.40, -0.16, 0], [0.40, -0.16, 0],
                                [-0.38, 0.22, 1], [0.38, 0.22, 1]]) {
    const x = bw * fx, y = bh * fy
    const outward = Math.atan2(y, x)
    const wig = Math.sin((t + tOff) * 2.0 + x) * 0.05
    put('foot', x, y, outward + wig)
  }

  // Tail — 7 joints; plates 0..4 are their own sprites, joints 5 and 6 are
  // covered by the single fused tip. Ascending, so plate 0 is the bottom layer
  // and the tip lies over it — the order scaledChain() draws in.
  const sweep = e.tailSwing ?? 0
  const tail = chainPoints(0, bh * 0.46, Math.PI / 2, 7, S * 0.8,
    i => Math.sin(t * 2.2 - i * 0.7) * 0.18 + sweep * (i + 1) / 7 * 0.45)
  for (let i = 0; i < 5; i++) {
    const a = tail[i], b = tail[i + 1]
    put(`tail${i}`, (a.x + b.x) / 2, (a.y + b.y) / 2, b.ang - Math.PI / 2)
  }
  put('tail_tip', (tail[5].x + tail[7].x) / 2, (tail[5].y + tail[7].y) / 2,
      tail[7].ang - Math.PI / 2)

  // Neck — 5 joints, drawn below the body so the body overlaps its base.
  const rear = e.neckRear ?? 0
  const aim = (e.state === 'sweep') ? (e.headAim ?? 0) : 0
  const neck = chainPoints(0, -bh * 0.46, -Math.PI / 2, 5, S * 0.7, i => {
    const idle = Math.sin(t * 0.9 - i * 0.6) * 0.22
    const rearBend = rear * (i < 2 ? 0.55 : -0.65)
    const aimBend = (i === 4 ? aim * 0.9 : aim * 0.15)
    return idle * (1 - rear * 0.6) + rearBend + aimBend
  })
  for (let i = 0; i < 5; i++) {
    const a = neck[i], b = neck[i + 1]
    put(`neck${i}`, (a.x + b.x) / 2, (a.y + b.y) / 2, b.ang - Math.PI / 2)
  }

  // Body — rigid. The vector version breathes by scaling ±2%, which would
  // destroy the pixel grid; here it bobs by a whole art pixel instead.
  const bob = Math.sin(t * 1.4) > 0 ? A : 0
  put('body', 0, bob, 0)

  // Breath cone, then the head, on top of the body.
  const tip = neck[neck.length - 1]
  if (e.state === 'cone' || e.state === 'sweep') put('flame', tip.x, tip.y, tip.ang)
  put('head', tip.x, tip.y, tip.ang + Math.PI / 2)

  // Wings last — the top layer. The sheet holds the right wing (baked with
  // wing()'s own rotate(-flap) cancelled); the left is the same sprite mirrored.
  // The vector does scale(-1,1) then rotate(-flap); mirroring after the rotation
  // instead needs the sign flipped, since M·R(-f) === R(f)·M for M = scale(-1,1).
  const flap = Math.sin(t * 1.5) * 0.12 + 0.22
  const shoulderY = -bh * 0.22
  put('wing', -bw * 0.12, shoulderY, flap, true)
  put('wing', bw * 0.12, shoulderY, -flap, false)

  return out
}

let sharedBuffer = null
function getBuffer() {
  if (!sharedBuffer) {
    sharedBuffer = document.createElement('canvas')
    sharedBuffer.width = BUF
    sharedBuffer.height = BUF
  }
  return sharedBuffer
}

export function drawDragonBossPixel(ctx, e, camX, camY, S, sprites, buffer) {
  const sheet = sprites?.[SHEET_SPRITE]
  if (!sheet) return                    // sheet missing: draw nothing, never throw
  const A = ART_PX * S / 32
  const buf = buffer ?? getBuffer()
  const half = BUF / 2
  const bctx = buf.getContext('2d')
  bctx.clearRect(0, 0, BUF, BUF)
  bctx.imageSmoothingEnabled = false

  for (const p of dragonPartPlacements(e, S)) {
    const f = PARTS[p.part]
    if (!f) continue
    bctx.save()
    bctx.translate(half + p.x, half + p.y)
    bctx.rotate(p.ang)
    if (p.flipX) bctx.scale(-1, 1)
    bctx.drawImage(sheet, f.x, f.y, f.w, f.h, -f.ox, -f.oy, f.w, f.h)
    bctx.restore()
  }

  const ox = Math.round((e.px ?? (e.x * S + S / 2)) - camX)
  const oy = Math.round((e.py ?? (e.y * S + S / 2)) - camY)
  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.translate(ox, oy)
  ctx.rotate((e.facing ?? 0) + Math.PI / 2)
  ctx.drawImage(buf, -half * A, -half * A, BUF * A, BUF * A)
  ctx.restore()
  // No manual smoothing reset here on purpose. imageSmoothingEnabled is part of
  // the canvas drawing state, so the restore() above already puts it back; and
  // this game's canvas-wide default is false (canvas.js sets it in the Renderer
  // constructor and again in resize(), because the whole tileset is
  // nearest-neighbour). Forcing it true after the restore would blur every
  // sprite drawn after the boss, for every frame until the next resize().
}

// ART_PX belongs to renderer/data/dragon-parts.js — re-exporting it here would
// give callers a second place to import the same constant from. BUF is a
// private detail of the compositing buffer above and has no reason to leak.
