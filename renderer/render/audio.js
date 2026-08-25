// Web Audio engine — drains state.sfx cues and synthesizes them.
// The ONLY file that touches Web Audio. Never imported from systems/.
// Pure exports up top (recipes + spatial math) are node-tested; the
// engine below runs only in the real browser/Electron.

export const TILE_SIZE = 32
export const NEAR_PX = TILE_SIZE * 4    // full volume inside this
export const FAR_PX = TILE_SIZE * 14    // silent beyond this
export const PAN_MAX = 0.7
export const THROTTLE_S = 0.05          // per-name minimum gap
export const MAX_VOICES = 12
export const MASTER_VOL = 0.5

// One declarative recipe per cue. kind picks the synth building block:
//   blip   — oscillator, pitch sweeps f0→f1 (wave: square|triangle)
//   burst  — white noise through a bandpass at freq (q = resonance)
//   swoosh — white noise through a bandpass sweeping f0→f1
//   rumble — low sine at freq + filtered noise, longer decay
export const RECIPES = {
  'melee-swing':    { kind: 'swoosh', f0: 900,  f1: 300,  dur: 0.12, vol: 0.5 },
  'melee-hit':      { kind: 'burst',  freq: 700,  q: 1.2,  dur: 0.09, vol: 0.9 },
  'ranged-shot':    { kind: 'swoosh', f0: 1400, f1: 2200, dur: 0.10, vol: 0.5 },
  'projectile-hit': { kind: 'burst',  freq: 900,  q: 1.5,  dur: 0.08, vol: 0.8 },
  'magic-cast':     { kind: 'swoosh', f0: 400,  f1: 1600, dur: 0.25, vol: 0.6 },
  'fire-burst':     { kind: 'rumble', freq: 90,  dur: 0.50, vol: 1.0 },
  'shockwave':      { kind: 'rumble', freq: 70,  dur: 0.35, vol: 0.9 },
  'player-hurt':    { kind: 'burst',  freq: 250,  q: 0.8,  dur: 0.15, vol: 1.0 },
  'player-death':   { kind: 'blip',   wave: 'square',   f0: 440,  f1: 55,   dur: 0.80, vol: 1.0 },
  'enemy-death':    { kind: 'blip',   wave: 'square',   f0: 330,  f1: 90,   dur: 0.25, vol: 0.7 },
  'boss-death':     { kind: 'rumble', freq: 55,  dur: 1.20, vol: 1.0 },
  'pickup':         { kind: 'blip',   wave: 'square',   f0: 660,  f1: 990,  dur: 0.09, vol: 0.6 },
  'key-pickup':     { kind: 'blip',   wave: 'triangle', f0: 660,  f1: 1320, dur: 0.18, vol: 0.7 },
  'heal':           { kind: 'blip',   wave: 'triangle', f0: 440,  f1: 880,  dur: 0.20, vol: 0.6 },
  'equip':          { kind: 'blip',   wave: 'square',   f0: 550,  f1: 660,  dur: 0.07, vol: 0.5 },
  'drop':           { kind: 'blip',   wave: 'square',   f0: 440,  f1: 330,  dur: 0.08, vol: 0.5 },
  'gate-open':      { kind: 'rumble', freq: 80,  dur: 0.80, vol: 0.9 },
  'door-locked':    { kind: 'blip',   wave: 'square',   f0: 220,  f1: 180,  dur: 0.15, vol: 0.6 },
  'descend':        { kind: 'rumble', freq: 65,  dur: 0.90, vol: 0.8 },
  'emerge':         { kind: 'blip',   wave: 'triangle', f0: 330,  f1: 660,  dur: 0.40, vol: 0.6 },
  'stance-switch':  { kind: 'blip',   wave: 'triangle', f0: 500,  f1: 750,  dur: 0.10, vol: 0.5 },
  'talent-learned': { kind: 'blip',   wave: 'triangle', f0: 523,  f1: 1046, dur: 0.50, vol: 0.7 },
  'rite':           { kind: 'rumble', freq: 100, dur: 1.00, vol: 0.7 },
  'ui-open':        { kind: 'blip',   wave: 'square',   f0: 500,  f1: 620,  dur: 0.06, vol: 0.4 },
  'ui-close':       { kind: 'blip',   wave: 'square',   f0: 620,  f1: 500,  dur: 0.06, vol: 0.4 },
  'ui-move':        { kind: 'blip',   wave: 'square',   f0: 700,  f1: 700,  dur: 0.03, vol: 0.3 },
}

export function falloffGain(distPx) {
  if (distPx <= NEAR_PX) return 1
  if (distPx >= FAR_PX) return 0
  return (FAR_PX - distPx) / (FAR_PX - NEAR_PX)
}

export function panFor(dxPx) {
  return Math.max(-1, Math.min(1, dxPx / FAR_PX)) * PAN_MAX
}
