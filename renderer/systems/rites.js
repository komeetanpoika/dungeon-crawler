// Secret unlock ceremonies. A rite is a named condition + a short screen
// ceremony; the trigger tiles come from data/rites.js via openmap.js.
// Pure: no DOM, no canvas — riteVisuals returns numbers for the renderer.

export const TRANCE_DURATION = 60   // s of mushroom trance
export const RITE_DURATION = 9      // s of ceremony lock

// Seven-wizard ceremony timeline: wizards fade in until RITE_APPEAR_END,
// chant while their beams ignite one at a time, and once every beam is on
// (RITE_ASCEND_START) the player rises up to RITE_LIFT_MAX px.
export const WIZARD_COUNT = 7
export const RITE_APPEAR_END = 1.5
export const RITE_ASCEND_START = 6
export const RITE_LIFT_MAX = 20
const RING_RADIUS = 80              // px, 2.5 tiles
const BEAM_RAMP = 0.3               // s for a lit beam to reach full strength
const GLYPH_LIFE = 1.2              // s a chant glyph drifts before recycling
const GLYPH_RISE = 26               // px a glyph rises over its life
const GLYPHS = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᛃ', 'ᛇ', 'ᛉ', 'ᛊ', 'ᛏ', 'ᛒ', 'ᛖ', 'ᛗ']

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
  const out = { wobbleX: 0, wobbleY: 0, blur: 0, greenAlpha: 0, lift: 0, wizards: [], glyphs: [] }
  const p = state.player
  if (p.trance > 0) {
    const t = p.tranceT ?? 0
    out.wobbleX = Math.sin(t * 1.7) * 1.5
    out.wobbleY = Math.cos(t * 1.3) * 1.5
  }
  if (state.rite) {
    const t = state.rite.t
    const k = Math.sin(Math.PI * Math.min(1, t / state.rite.dur))
    out.wobbleX = Math.sin(t * 9) * 6 * k
    out.wobbleY = Math.cos(t * 7) * 6 * k
    out.blur = 3 * k
    out.greenAlpha = 0.35 * k

    const cx = state.rite.cx ?? p.px ?? 0
    const cy = state.rite.cy ?? p.py ?? 0
    const alpha = Math.min(1, t / RITE_APPEAR_END)
    // Beam i ignites step seconds after the previous; the last reaches full
    // strength exactly at RITE_ASCEND_START.
    const step = (RITE_ASCEND_START - BEAM_RAMP - RITE_APPEAR_END) / (WIZARD_COUNT - 1)
    for (let i = 0; i < WIZARD_COUNT; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / WIZARD_COUNT
      const beam = Math.max(0, Math.min(1, (t - (RITE_APPEAR_END + i * step)) / BEAM_RAMP))
      out.wizards.push({ px: cx + Math.cos(a) * RING_RADIUS, py: cy + Math.sin(a) * RING_RADIUS, alpha, beam })
    }

    // Chant glyphs: two per wizard, cycling on fixed phase offsets so the
    // whole thing is a pure function of t.
    if (t >= RITE_APPEAR_END && t < RITE_ASCEND_START) {
      for (let i = 0; i < WIZARD_COUNT; i++) {
        const w = out.wizards[i]
        for (let g = 0; g < 2; g++) {
          const phase = ((i * 0.37 + g * 0.53) % 1) * GLYPH_LIFE
          const cycles = (t - RITE_APPEAR_END + phase) / GLYPH_LIFE
          const frac = cycles % 1
          const n = Math.floor(cycles)
          out.glyphs.push({
            px: w.px + Math.sin((i * 3 + g * 5 + n) * 2.4) * 6 + (g === 0 ? -6 : 6),
            py: w.py - 10 - frac * GLYPH_RISE,
            alpha: Math.max(0.08, Math.sin(Math.PI * frac)),
            char: GLYPHS[(i * 5 + g * 3 + n) % GLYPHS.length],
          })
        }
      }
    }

    if (t >= RITE_ASCEND_START) {
      const s = Math.min(1, (t - RITE_ASCEND_START) / 1.5)
      out.lift = RITE_LIFT_MAX * s * s * (3 - 2 * s)   // smoothstep rise, then hover
    }
  }
  return out
}
