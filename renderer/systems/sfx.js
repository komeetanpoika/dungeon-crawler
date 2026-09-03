// Sound-cue queue — the audio twin of feedback.js. Gameplay pushes plain
// records here; render/audio.js drains and plays them once per frame.
// Systems never import Web Audio, so everything stays node-testable.

export const CUE_NAMES = [
  // combat
  'melee-swing', 'melee-hit', 'ranged-shot', 'projectile-hit',
  'magic-cast', 'fire-burst', 'shockwave', 'wall-slam',
  'player-hurt', 'player-death', 'enemy-death', 'boss-death',
  // world & items
  'pickup', 'key-pickup', 'heal', 'equip', 'drop',
  'gate-open', 'door-locked', 'descend', 'emerge', 'door-open',
  'stance-switch', 'talent-learned', 'rite',
  // UI (positionless)
  'ui-open', 'ui-close', 'ui-move',
  // npcs
  'npc-chicken', 'npc-deer', 'npc-mouse', 'npc-hurt', 'npc-death', 'npc-wrath',
  // lumber & campfire
  'chop', 'tree-fall', 'campfire-light', 'campfire-out', 'sizzle', 'grey-fire',
  // leap episodes
  'leap', 'echo', 'bell', 'drag', 'sink', 'erupt', 'wraith-touch',
]

export function makeSfx(muted = false) {
  return { cues: [], muted }
}

export function sfx(state, name, pos) {
  if (!state?.sfx) return
  state.sfx.cues.push({ name, px: pos?.px, py: pos?.py })
}

export function drainSfx(state) {
  if (!state?.sfx) return []
  const cues = state.sfx.cues
  state.sfx.cues = []
  return cues
}
