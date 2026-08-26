// Per-entity knockback as a decaying velocity. Pure: no DOM, no map access —
// collision is injected via a canMove(px, py) predicate so it is unit-testable.

const TILE = 32
const DRAG = 40        // 1/s; total slide distance ≈ v0 / DRAG. ~0.075s to settle (snappy).
const STOP_SPEED = 5   // px/s; below this the slide is finished.
const SLAM_MIN_SPEED = 400   // px/s; slower wall contact is a drift, not a slam

// Give `entity` a knockback velocity in unit direction (dirX, dirY), calibrated
// so it slides ~`distance` px before settling. Zero/degenerate input is a no-op.
export function startKnockback(entity, dirX, dirY, distance, opts) {
  const len = Math.hypot(dirX, dirY)
  if (len === 0 || distance <= 0) return
  const v0 = distance * DRAG
  entity.knockback = { vx: (dirX / len) * v0, vy: (dirY / len) * v0,
    ...(opts?.slam ? { slam: { ...opts.slam } } : {}) }
}

// Advance one frame. Moves per-axis (a blocked axis stops at the wall),
// updates tile coords, applies drag, and clears knockback once settled.
// Safe to call on an entity with no knockback.
// Returns null or { slammed: true, damage: number } if a flagged slam just fired.
export function stepKnockback(entity, delta, canMove) {
  const kb = entity.knockback
  if (!kb) return null
  const speed = Math.hypot(kb.vx, kb.vy)
  let blocked = false
  const nx = entity.px + kb.vx * delta
  if (canMove(nx, entity.py)) entity.px = nx
  else { kb.vx = 0; blocked = true }
  const ny = entity.py + kb.vy * delta
  if (canMove(entity.px, ny)) entity.py = ny
  else { kb.vy = 0; blocked = true }
  entity.x = Math.floor(entity.px / TILE)
  entity.y = Math.floor(entity.py / TILE)
  const decay = Math.exp(-DRAG * delta)
  kb.vx *= decay
  kb.vy *= decay
  if (Math.hypot(kb.vx, kb.vy) < STOP_SPEED) entity.knockback = null
  if (blocked && kb.slam && speed >= SLAM_MIN_SPEED) {
    const { damage } = kb.slam
    delete kb.slam                       // one-shot
    return { slammed: true, damage }
  }
  return null
}
