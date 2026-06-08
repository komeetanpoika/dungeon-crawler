// Procedural "step sway" walk animation.
// Phase advances by distance actually moved; amplitude eases in/out so a
// stopped character settles upright instead of freezing mid-tilt.

export const STRIDE_PX = 30      // px of travel per full left-right sway cycle
export const MAX_TILT  = 6.3      // degrees of peak rotation
const AMP_ATTACK = 12, AMP_DECAY = 10   // sway ramp-in / ease-out rate (per second)

function approach(cur, target, step) {
  if (cur < target) return Math.min(target, cur + step)
  return Math.max(target, cur - step)
}

// Advance an entity's walk state from how far it moved since the last call.
// Reads e.px/e.py; writes e.walkPhase, e.swayAmp, e._wpx, e._wpy.
export function tickWalk(e, delta) {
  const dx = e.px - (e._wpx ?? e.px)
  const dy = e.py - (e._wpy ?? e.py)
  e._wpx = e.px; e._wpy = e.py
  const moved = Math.hypot(dx, dy)
  if (moved > 0.01) e.walkPhase = (e.walkPhase ?? 0) + (moved / STRIDE_PX) * 2 * Math.PI
  const target = moved > 0.01 ? 1 : 0
  const rate = target > (e.swayAmp ?? 0) ? AMP_ATTACK : AMP_DECAY
  e.swayAmp = approach(e.swayAmp ?? 0, target, rate * delta)
}

// Current tilt in degrees (0 when idle).
export function walkTilt(e) {
  return Math.sin(e.walkPhase ?? 0) * MAX_TILT * (e.swayAmp ?? 0)
}
