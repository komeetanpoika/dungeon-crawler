// The piper's flute (systems/tune.js): a weapon that plays instead of
// striking. While its tune carries, mice within earshot make for the player.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WEAPON_TYPES, weaponContents, isSmallBlade } from '../renderer/systems/entities.js'
import { TUNE_SECONDS, TUNE_TILES, TUNE_NOTES, NOTE_GAP, playTune, tuneCarries, tickTune, hasFlute } from '../renderer/systems/tune.js'
import { makeNpc, GOALS } from '../renderer/systems/npc.js'
import { NPC_SPECIES } from '../renderer/data/npcs.js'
import { makeItem, itemFromContents, canEquip } from '../renderer/systems/inventory.js'
import { makeSfx, CUE_NAMES } from '../renderer/systems/sfx.js'
import { makeFeedback } from '../renderer/systems/feedback.js'

const S = 32
const npc = (species, x, y) => makeNpc({ kind: 'npc', species, id: `${species}:${x},${y}`, x, y })
function world(entities = []) {
  return {
    player: { x: 20, y: 20, px: 20 * S + 16, py: 20 * S + 16, inventory: [], maxInventory: 10, weapon: null },
    entities, sfx: makeSfx(), feedback: makeFeedback(),
  }
}
const cues = state => state.sfx.cues.map(c => c.name)

test('the flute is a weapon that deals nothing; Lalli\'s axe is a one-handed felling axe', () => {
  assert.deepEqual(weaponContents('flute'), { weaponType: 'flute', name: "Piper's Flute", damage: 0, tune: true })
  assert.deepEqual(weaponContents('lalli_axe'), { weaponType: 'lalli_axe', name: "Lalli's Axe", damage: 3, chop: 2 })
  assert.ok(!WEAPON_TYPES.lalli_axe.heavy)
})

test('the flute goes in the main hand without any outfit, never in the off hand', () => {
  const item = itemFromContents({ type: 'weapon', ...weaponContents('flute') })
  const player = { attackMode: 'melee', inventory: [], gear: {} }
  assert.deepEqual(canEquip(player, item), { ok: true })
  assert.equal(isSmallBlade('flute'), false)
})

test('a tune carries for its seconds and then is over', () => {
  const state = world()
  assert.equal(tuneCarries(state), false)
  playTune(state)
  assert.equal(tuneCarries(state), true)
  tickTune(state, TUNE_SECONDS - 0.1)
  assert.equal(tuneCarries(state), true)
  tickTune(state, 0.2)
  assert.equal(tuneCarries(state), false)
  tickTune(state, 1)   // nothing playing: nothing happens
  assert.equal(tuneCarries(state), false)
})

test('the notes of a tune are sounded one after another, each a known cue', () => {
  const state = world()
  playTune(state)
  tickTune(state, 0.001)
  assert.deepEqual(cues(state), [TUNE_NOTES[0]])
  tickTune(state, NOTE_GAP)
  assert.deepEqual(cues(state), TUNE_NOTES.slice(0, 2))
  tickTune(state, TUNE_SECONDS)
  assert.deepEqual(cues(state), TUNE_NOTES, 'every note once, even across a long frame')
  for (const n of TUNE_NOTES) assert.ok(CUE_NAMES.includes(n), `${n} is not a cue`)
})

test('playing again while a tune carries starts it over', () => {
  const state = world()
  playTune(state)
  tickTune(state, TUNE_SECONDS - 0.5)
  playTune(state)
  tickTune(state, 1)
  assert.equal(tuneCarries(state), true)
})

test('mice within earshot make for the player; other animals and far mice do not', () => {
  const near = npc('mouse', 20 + TUNE_TILES, 20), far = npc('mouse', 20 + TUNE_TILES + 1, 20), deer = npc('deer', 22, 20)
  const state = world([near, far, deer])
  tickTune(state, 0.016)
  assert.equal(near.objective, null, 'no tune, no following')
  playTune(state)
  tickTune(state, 0.016)
  assert.deepEqual(near.objective, { x: 20, y: 20 })
  assert.equal(near.piped, true)
  assert.equal(far.objective, null)
  assert.equal(deer.objective, null)
})

test('they follow where the player goes, and are let go when the tune ends', () => {
  const m = npc('mouse', 24, 20)
  const state = world([m])
  playTune(state)
  tickTune(state, 0.016)
  state.player.x = 18; state.player.y = 21
  tickTune(state, 0.016)
  assert.deepEqual(m.objective, { x: 18, y: 21 })
  tickTune(state, TUNE_SECONDS)
  assert.equal(m.objective, null)
  assert.ok(!m.piped)
})

test('a dead or hostile mouse is not led', () => {
  const dead = npc('mouse', 22, 20), angry = npc('mouse', 23, 20)
  dead.hp = 0; angry.hostile = true
  const state = world([dead, angry])
  playTune(state)
  tickTune(state, 0.016)
  assert.equal(dead.objective, null)
  assert.equal(angry.objective, null)
})

test('a piped mouse does not bolt from the player it is following', () => {
  const m = npc('mouse', 21, 20)
  const ctx = { def: NPC_SPECIES.mouse, playerDist: 10 }
  assert.equal(GOALS.startle.when(m, ctx), true)
  m.piped = true
  assert.equal(GOALS.startle.when(m, ctx), false)
})

test('hasFlute: in the hand or in the sack', () => {
  const state = world()
  assert.equal(hasFlute(state.player), false)
  state.player.inventory.push(itemFromContents({ type: 'weapon', ...weaponContents('flute') }))
  assert.equal(hasFlute(state.player), true)
  state.player.inventory = []
  state.player.weapon = weaponContents('flute')
  assert.equal(hasFlute(state.player), true)
})

test('the pint and the sausage are things carried, not eaten', () => {
  for (const kind of ['beer', 'sausage']) {
    const item = makeItem(kind)
    assert.equal(item.quest, true)
    assert.equal(item.stackable, true)
  }
  assert.equal(makeItem('beer').name, 'Pint of Beer')
  assert.equal(makeItem('sausage').name, 'Boar Sausage')
})
