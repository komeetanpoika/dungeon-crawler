// Drives the preview stage's pose channels the way the game's
// updateMonsterPose does: state, attack clock, animT and the blend on a switch.
// The preview faces the way the drawing does (`faces` from the parts), so it
// draws unmirrored and shows the attack's lunge; previewZoom picks the zoom
// the preview opens at.
import { attackTiming } from '../../renderer/render/monster-rigs/anims.js'

export function makePreviewClock({ faces = 'left' } = {}) {
  let name = null, since = 0, blend = null
  // the cut-out engine mirrors a faces-left drawing when cos(facing) > 0, a
  // faces-right one when it is < 0: west and east draw them as drawn
  const facing = faces === 'right' ? 0 : Math.PI

  function attackClock(anims, simT) {
    const tm = attackTiming(anims?.attack)
    if (!tm) return { phase: 'swing', t: 0 }
    const u = (simT - since) % (tm.windup + tm.followThrough)
    return u < tm.windup ? { phase: 'windup', t: u } : { phase: 'swing', t: u - tm.windup }
  }

  return {
    select(next, anims, simT) {
      if (next === name) return
      if (name !== null) {
        const at = name === 'attack' ? attackClock(anims, simT) : simT - since
        blend = { from: name, at, startedAt: simT }
      }
      name = next
      since = simT
    },
    pose(simT, anims) {
      const state = name ?? 'idle'
      return {
        state,
        facing,
        speed01: state === 'walk' ? 1 : 0,
        animT: simT - since,
        attack: state === 'attack' ? attackClock(anims, simT) : null,
        blend: blend ? { from: blend.from, at: blend.at, t: simT - blend.startedAt } : null,
      }
    },
  }
}

// The zoom the preview opens at: the largest slider step, up to `max`, at
// which the monster's tallest pose fits above the entity centre and its
// rest drawing fits across, in a W×H stage whose entity centre sits at
// `origin` (fractions of the canvas). `top` is rig.drawnTop(params, 32)
// (px from the centre, negative = up; it covers every card pose) and
// `halfWidth` half the rest drawing's width, both at zoom 1. Never below
// `min`; a rig that can't say (top null) opens at `max`.
export function previewZoom({ top, halfWidth = 0 }, W, H, origin, { min = 1, max = 2, step = 0.5, margin = 8 } = {}) {
  if (!Number.isFinite(top)) return max
  const up = origin.y * H - margin, across = Math.min(origin.x, 1 - origin.x) * W - margin
  let z = max
  while (z - step >= min && (-top * z > up || halfWidth * z > across)) z -= step
  return z
}
