// Hit extents: the one place the game asks how big a thing is when a hit
// lands. Every entity resolves to a world-space capsule (a segment plus a
// radius — the dragon boss's own primitive, see capsules.js; a circle is a
// zero-length capsule) and the damage paths test against that instead of
// the bare centre point: projectiles ask pointHits, area effects that live
// on tiles (fireball burst, fire and bramble zones, lightning) ask
// overlapsTiles, and wedge/radius tests (cones, melee, the clap, the
// shockwave) measure to nearestPoint. Movement clearance stays on aiHalf —
// that is a nav question, not a hit question.
//
// Shapes come from three places: a registry rig's hitShape(params) (the
// rigs know what they draw; a rig without one falls back to its half-size
// as a circle), the SPRITE_SHAPES table for the hand-drawn tile sprites,
// and PLAYER_SHAPE. Anything else keeps the old 8 px disc, so a test entity
// with no type behaves exactly as it always did.
//
// A local shape is { r, front?, back?, ox?, oy? }: radius, how far the
// capsule runs ahead of and behind the centre along the pose facing (a rig
// monster rotates with e.pose.facing), and a world offset for a sprite
// drawn off its centre. Pure: no DOM, no game.js.
import { pointInCapsule } from './capsules.js'
import { getMonsterDef } from './monsters.js'
import { snapFacing } from '../render/monster-rigs/pixel.js'

const TILE_SIZE = 32

// Tile sprites are 32 px; 13 keeps the disc a touch inside the art so a
// shot through the very edge of a cloak still reads as a miss (player-fair
// the same way the rigs' 0.6 is). The cyclops draws at 2 tiles, centred.
// The plain dragon draws its 3-tile sprite standing on the entity's tile
// (canvas.js drawEntity: `py - S * 2`), so its body sits above the centre.
export const SPRITE_SHAPES = {
  guard:   { r: 13 },
  monster: { r: 13 },
  wizard:  { r: 13 },
  crab:    { r: 13 },
  npc:     { r: 13 },
  cyclops: { r: 26 },
  dragon:  { r: 36, oy: -32 },
}
// The player sprite is 32 px too; 12 keeps it just inside. This is wider
// than the old 10 px enemy-shot disc on purpose — the hero's hitbox now
// matches the drawn hero the way every enemy's does.
export const PLAYER_SHAPE = { r: 12 }
export const FALLBACK_SHAPE = { r: 8 }

function localShape(e) {
  if (e.type === 'player' || e.type === 'hero') return PLAYER_SHAPE
  const def = e.type ? getMonsterDef(e.type) : null
  if (def) {
    def.hit ??= typeof def.rig.hitShape === 'function'
      ? def.rig.hitShape(def.params)
      : { r: def.stats.half }
    return def.hit
  }
  return SPRITE_SHAPES[e.type] ?? FALLBACK_SHAPE
}

// The entity's capsule in world px: { ax, ay, bx, by, r }. `a` is the front
// end (nose), `b` the back (tail); both sit on the centre for a circle.
// `local` overrides the lookup — the player passes PLAYER_SHAPE explicitly,
// since state.player does not always carry a type.
export function hitShape(e, local = null) {
  const s = local ?? localShape(e)
  const cx = e.px + (s.ox ?? 0), cy = e.py + (s.oy ?? 0)
  const front = s.front ?? 0, back = s.back ?? 0
  if (!front && !back) return { ax: cx, ay: cy, bx: cx, by: cy, r: s.r }
  // The rigs draw at one of eight headings (snapFacing), so the capsule
  // follows the drawn body, not the raw heading.
  const f = snapFacing(e.pose?.facing ?? 0)
  const dx = Math.cos(f), dy = Math.sin(f)
  return { ax: cx + dx * front, ay: cy + dy * front, bx: cx - dx * back, by: cy - dy * back, r: s.r }
}

// Does the point (x, y) land on the body? `pad` widens the body by the
// striker's own size (a projectile's half-width).
export function pointHits(e, x, y, pad = 0, local = null) {
  const s = hitShape(e, local)
  return pointInCapsule(x, y, s.ax, s.ay, s.bx, s.by, s.r + pad)
}

function closestOnSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return { x: ax + dx * t, y: ay + dy * t }
}

// The point of the body nearest to (x, y): the probe itself when it is
// inside, otherwise the rim point facing it. Wedge and radius tests use
// this so a big body is "in reach" as soon as its edge is.
export function nearestPoint(e, x, y, local = null) {
  const s = hitShape(e, local)
  const c = closestOnSegment(x, y, s.ax, s.ay, s.bx, s.by)
  const d = Math.hypot(x - c.x, y - c.y)
  if (d <= s.r) return { x, y }
  return { x: c.x + (x - c.x) * (s.r / d), y: c.y + (y - c.y) * (s.r / d) }
}

// --- capsule vs tile ---------------------------------------------------

const pointRectDist = (x, y, x0, y0, x1, y1) =>
  Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1))

const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const o1 = orient(ax, ay, bx, by, cx, cy), o2 = orient(ax, ay, bx, by, dx, dy)
  const o3 = orient(cx, cy, dx, dy, ax, ay), o4 = orient(cx, cy, dx, dy, bx, by)
  return o1 * o2 < 0 && o3 * o4 < 0
}

// Distance from segment a→b to the axis-aligned rect: 0 when they touch,
// else the least of endpoint-to-rect and corner-to-segment (both shapes
// are convex, so the closest pair always involves a vertex).
function segmentRectDist(ax, ay, bx, by, x0, y0, x1, y1) {
  const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1
  if (inside(ax, ay) || inside(bx, by)) return 0
  const edges = [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]
  for (const [ex0, ey0, ex1, ey1] of edges) if (segmentsCross(ax, ay, bx, by, ex0, ey0, ex1, ey1)) return 0
  let best = Math.min(pointRectDist(ax, ay, x0, y0, x1, y1), pointRectDist(bx, by, x0, y0, x1, y1))
  for (const [cx, cy] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) {
    const c = closestOnSegment(cx, cy, ax, ay, bx, by)
    best = Math.min(best, Math.hypot(cx - c.x, cy - c.y))
  }
  return best
}

// Does the body overlap any tile in `keys` (a Set of "x,y" tile keys, the
// shape every zone and blast already carries)? Only the tiles under the
// body's bounding box are looked at, so a big set costs nothing extra.
export function overlapsTiles(e, keys, local = null) {
  if (!keys?.size || !Number.isFinite(e.px)) return false
  const s = hitShape(e, local)
  const tx0 = Math.floor((Math.min(s.ax, s.bx) - s.r) / TILE_SIZE)
  const tx1 = Math.floor((Math.max(s.ax, s.bx) + s.r) / TILE_SIZE)
  const ty0 = Math.floor((Math.min(s.ay, s.by) - s.r) / TILE_SIZE)
  const ty1 = Math.floor((Math.max(s.ay, s.by) + s.r) / TILE_SIZE)
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!keys.has(`${tx},${ty}`)) continue
      const x0 = tx * TILE_SIZE, y0 = ty * TILE_SIZE
      if (segmentRectDist(s.ax, s.ay, s.bx, s.by, x0, y0, x0 + TILE_SIZE, y0 + TILE_SIZE) <= s.r) return true
    }
  }
  return false
}
