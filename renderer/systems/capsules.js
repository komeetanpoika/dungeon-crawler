// Pure geometry for the dragon boss's segmented body. No DOM/map/Electron imports.
// Local frame matches the renderer: -y forward (head), +y back (tail).

const TILE = 32

export const PART_MODIFIER = { neck: 1.5, core: 1.0, tail: 1.0 }

// Distance from point (px,py) to segment a->b, then compare to radius.
export function pointInCapsule(px, py, ax, ay, bx, by, radius) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + dx * t, cy = ay + dy * t
  return Math.hypot(px - cx, py - cy) <= radius
}

// Local body half-extents — must track render/dragonboss.js (bw=3S, bh=4S).
const BW = 3 * TILE
const BH = 4 * TILE

// Local-frame part endpoints (before rotation). -y forward, +y back.
// Each returns {ax,ay,bx,by,radius} in LOCAL coords.
function localCapsules(e) {
  const neckRear = e.neckRear ?? 0
  const headAim = e.headAim ?? 0
  const tailSwing = e.tailSwing ?? 0

  // neck: from the shoulders (just ahead of centre) to the head tip out front.
  // neckRear pulls the tip back/up slightly during a windup; headAim shifts it sideways.
  const shoulderY = -BH * 0.28
  const tipY = -BH * 0.62 + neckRear * BH * 0.14
  const tipX = Math.sin(headAim) * BW * 0.5
  const neck = { part: 'neck', ax: 0, ay: shoulderY, bx: tipX, by: tipY, radius: BW * 0.28 }

  // core: the main mass straddling the centre.
  const core = { part: 'core', ax: 0, ay: -BH * 0.16, bx: 0, by: BH * 0.30, radius: BW * 0.5 }

  // tail: from the tail base back to the tip; tailSwing rotates the tip sideways.
  const baseX = 0, baseY = BH * 0.30
  const tailLen = BH * 0.5
  const ang = Math.PI / 2 + tailSwing   // +y is back; swing rotates about base
  const tail = {
    part: 'tail', ax: baseX, ay: baseY,
    bx: baseX + Math.cos(ang) * tailLen, by: baseY + Math.sin(ang) * tailLen,
    radius: BW * 0.22,
  }
  return [neck, core, tail]
}

// Rotate a local point by the boss facing and offset to world coords.
// The renderer rotates local up (-y) onto `facing`, i.e. ctx.rotate(facing + PI/2).
function toWorld(lx, ly, px, py, facing) {
  const a = facing + Math.PI / 2
  const c = Math.cos(a), s = Math.sin(a)
  return [px + (lx * c - ly * s), py + (lx * s + ly * c)]
}

export function dragonCapsules(e) {
  const px = e.px, py = e.py, facing = e.facing ?? 0
  return localCapsules(e).map(cap => {
    const [ax, ay] = toWorld(cap.ax, cap.ay, px, py, facing)
    const [bx, by] = toWorld(cap.bx, cap.by, px, py, facing)
    return { part: cap.part, ax, ay, bx, by, radius: cap.radius }
  })
}

// Which part does the world point land in? On overlap, the highest modifier wins
// (neck weak-spot beats core/tail). Returns null when in no capsule.
export function hitPart(px, py, e) {
  let best = null, bestMod = -Infinity
  for (const cap of dragonCapsules(e)) {
    if (pointInCapsule(px, py, cap.ax, cap.ay, cap.bx, cap.by, cap.radius)) {
      const mod = PART_MODIFIER[cap.part]
      if (mod > bestMod) { best = cap.part; bestMod = mod }
    }
  }
  return best
}

// Closest point on segment a->b to (px,py).
function closestOnSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return [ax + dx * t, ay + dy * t]
}

// Flat-1 melee base × the best part modifier the swing reaches (weapon damage ignored).
// swingHit(cx, cy) -> boolean: does the player's swing cover world point (cx,cy)?
export function meleeDamageToDragon(player, e, swingHit) {
  let bestMod = 0
  for (const cap of dragonCapsules(e)) {
    const [cx, cy] = closestOnSeg(player.px, player.py, cap.ax, cap.ay, cap.bx, cap.by)
    const d = Math.hypot(player.px - cx, player.py - cy)
    // the capsule surface point facing the player (or the player's own position if inside)
    const sx = d > cap.radius ? cx + (player.px - cx) / d * cap.radius : player.px
    const sy = d > cap.radius ? cy + (player.py - cy) / d * cap.radius : player.py
    if (swingHit(sx, sy)) bestMod = Math.max(bestMod, PART_MODIFIER[cap.part])
  }
  return bestMod === 0 ? 0 : 1 * bestMod
}

// True when a player half-box centred at (px,py) would intrude the solid core capsule.
export function coreBlocks(px, py, half, e) {
  const core = dragonCapsules(e).find(c => c.part === 'core')
  // test the four corners of the player's AABB against the core capsule
  for (const [cx, cy] of [[px-half,py-half],[px+half,py-half],[px-half,py+half],[px+half,py+half]]) {
    if (pointInCapsule(cx, cy, core.ax, core.ay, core.bx, core.by, core.radius)) return true
  }
  return false
}
