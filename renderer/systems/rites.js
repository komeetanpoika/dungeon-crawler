// Secret unlock ceremonies. A rite is a named condition + a short screen
// ceremony; the trigger tiles come from data/rites.js via openmap.js.
// Pure: no DOM, no canvas — riteVisuals returns numbers for the renderer.

export const TRANCE_DURATION = 60   // s of mushroom trance
export const RITE_DURATION = 3.5    // s of ceremony lock

export function startTrance(player) {
  player.trance = TRANCE_DURATION
  player.tranceT = player.tranceT ?? 0
}

export function tickTrance(player, dt) {
  if (!(player.trance > 0)) return
  player.trance = Math.max(0, player.trance - dt)
  player.tranceT = (player.tranceT ?? 0) + dt
}

const CONDITIONS = {
  mushroom_circle: state => (state.player.trance ?? 0) > 0,
}

export function riteConditionMet(riteId, state) {
  return CONDITIONS[riteId]?.(state) ?? false
}

// One number bundle for the renderer: subtle sine wobble while entranced;
// during the ceremony a sin(pi*t) envelope ramps wobble, blur and the sickly
// green up and back down.
export function riteVisuals(state) {
  const out = { wobbleX: 0, wobbleY: 0, blur: 0, greenAlpha: 0 }
  const p = state.player
  if (p.trance > 0) {
    const t = p.tranceT ?? 0
    out.wobbleX = Math.sin(t * 1.7) * 1.5
    out.wobbleY = Math.cos(t * 1.3) * 1.5
  }
  if (state.rite) {
    const k = Math.sin(Math.PI * Math.min(1, state.rite.t / state.rite.dur))
    out.wobbleX = Math.sin(state.rite.t * 9) * 6 * k
    out.wobbleY = Math.cos(state.rite.t * 7) * 6 * k
    out.blur = 3 * k
    out.greenAlpha = 0.35 * k
  }
  return out
}
