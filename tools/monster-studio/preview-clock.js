// Drives the preview stage's pose channels the way the game's
// updateMonsterPose does: state, attack clock, animT and the blend on a switch.
import { attackTiming } from '../../renderer/render/monster-rigs/anims.js'

export function makePreviewClock() {
  let name = null, since = 0, blend = null

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
        speed01: state === 'walk' ? 1 : 0,
        animT: simT - since,
        attack: state === 'attack' ? attackClock(anims, simT) : null,
        blend: blend ? { from: blend.from, at: blend.at, t: simT - blend.startedAt } : null,
      }
    },
  }
}
