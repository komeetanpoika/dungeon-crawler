// The piper's flute: a weapon whose swing plays a tune instead of striking.
// While a tune carries, every mouse within earshot of the player makes for
// the player, wherever in the world that is. Pure: game.js calls playTune
// from the swing and tickTune once a frame; what the mice are led into is a
// tale's business (wilds/tale-lalli.js).
import { sfx } from './sfx.js'
import { addFloat } from './feedback.js'

export const TUNE_SECONDS = 4     // how long a tune carries after the swing
export const TUNE_TILES = 12      // earshot, in tiles either way
export const NOTE_GAP = 0.15      // s between notes
export const TUNE_NOTES = ['flute-1', 'flute-2', 'flute-3', 'flute-2', 'flute-1', 'flute-0', 'flute-1', 'flute-3']

export const tuneCarries = state => (state.tune?.t ?? 0) > 0
export const hasFlute = player => !!player.weapon?.tune || player.inventory.some(i => i.payload?.tune)

export function playTune(state) {
  state.tune = { t: TUNE_SECONDS, age: 0, played: 0 }
}

const heard = (e, player) => e.type === 'npc' && e.species === 'mouse' && e.hp > 0 && !e.hostile
  && Math.max(Math.abs(e.x - player.x), Math.abs(e.y - player.y)) <= TUNE_TILES

export function tickTune(state, delta) {
  const tune = state.tune
  if (!tune) return
  const { player } = state
  tune.age += delta
  // the notes, one after another, however long the frame was
  while (tune.played < TUNE_NOTES.length && tune.age >= tune.played * NOTE_GAP) {
    sfx(state, TUNE_NOTES[tune.played], { px: player.px, py: player.py })
    if (tune.played % 2 === 0 && state.feedback) addFloat(state.feedback, { px: player.px + (tune.played % 4 ? 8 : -8), py: player.py - 18, text: '♪', kind: 'note' })
    tune.played++
  }
  tune.t -= delta
  if (tune.t > 0) {
    for (const e of state.entities) if (heard(e, player)) { e.objective = { x: player.x, y: player.y }; e.piped = true }
    return
  }
  // a short tune still sounds to its end; the mice are let go at once
  for (; tune.played < TUNE_NOTES.length; tune.played++) sfx(state, TUNE_NOTES[tune.played], { px: player.px, py: player.py })
  state.tune = null
  for (const e of state.entities) if (e.piped) { e.objective = null; delete e.piped }
}
