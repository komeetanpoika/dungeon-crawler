// Sound-cue queue — the audio twin of feedback.js. Gameplay pushes plain
// records here; render/audio.js drains and plays them once per frame.
// Systems never import Web Audio, so everything stays node-testable.

export const CUE_NAMES = [
  // combat
  'melee-swing', 'melee-hit', 'ranged-shot', 'projectile-hit',
  'magic-cast', 'fire-burst', 'shockwave', 'wall-slam',
  'player-hurt', 'player-death', 'enemy-death', 'boss-death', 'shield-block',
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
  // spells
  'thunder', 'crackle',
  // PvP
  'whirl',
  // leap episodes
  'leap', 'echo', 'bell', 'drag', 'sink', 'erupt', 'wraith-touch', 'wraith-burn',
  // the piper's flute (systems/tune.js)
  'flute-0', 'flute-1', 'flute-2', 'flute-3',
  // Päivölä's mirrors and seed (systems/sunroom-run.js)
  'mirror-turn', 'sun-bloom',
  // Kalevanlinna's stocks: the crowd's jeer at a key press, a turnip landing (wilds/city/law.js)
  'jeer', 'splat',
  // the town's ambience (wilds/city/ambience.js)
  'city-murmur', 'hammer', 'gull', 'wings', 'tavern', 'crier-bell', 'boots', 'bark',
  // the coach setting off, rolling and arriving (game.js, wilds/coach-ride.js)
  'coach-go', 'coach-hoof', 'coach-arrive',
  // a sandstorm's gusts (wilds/storm.js)
  'storm-wind',
  // a drink at a well or an oasis's water in the desert (wilds/heat.js)
  'drink',
  // the desert's creatures: a sting and its poison, the sand worm under the
  // sand and coming up, the antlion's sand thrown and landing, a jackal's yip
  'sting', 'poison', 'burrow', 'worm-erupt', 'sand-toss', 'sand-land', 'yip',
  // the mountain trolls (systems/monsters/mohkale.js, louhija.js, rumpali.js,
  // vuorenkuningas.js): the war drum's beat, a blow on the stone slab, stones
  // landing, the King's boulder set rolling, his stomp and his bellow
  'drum', 'clank', 'rockfall', 'boulder', 'stomp', 'troll-bellow',
  // the marsh coven (para.js, noita.js, kuppari.js, kyy.js, syojatar.js): a
  // para's spindle legs and its raspberry, a hex cast and taking hold,
  // knitting needles, the cupping horn, a viper's hiss, Syöjätär's spit
  'para-skitter', 'raspberry', 'hex-cast', 'hex-hit', 'knit', 'cup', 'hiss', 'spit',
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
