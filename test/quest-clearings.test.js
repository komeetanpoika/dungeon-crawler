import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { onArrive, tick, WALLOWS, SHRINE, DELIVERIES } from '../renderer/systems/quests/clearings.js'
import { makeQuestCtx, questFlags } from '../renderer/systems/quests.js'
import { normalizeAdventureSave } from '../renderer/systems/adventure.js'
import { makeHirvi, ensureHirvi, updateHirvi, BOLT_TIME } from '../renderer/systems/monsters/hirvi.js'
import { hurtCreature } from '../renderer/systems/creatures.js'
import { makeNpc } from '../renderer/systems/npc.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeItem } from '../renderer/systems/inventory.js'
import { hasTalent } from '../renderer/systems/talents.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const S = 32
const N = 40

const CELLS = { [SHRINE]: { x: 5, y: 5 }, 'wallow 1': { x: 20, y: 5 }, 'wallow 2': { x: 20, y: 20 }, 'wallow 3': { x: 5, y: 20 } }
const VILLAGE = { x: 10, y: 10 }

const mapData = {
  name: 'forest-1-clearings', w: N, h: N,
  pois: [
    { kind: 'village', x: VILLAGE.x, y: VILLAGE.y, label: 'Aspengrove' },
    ...Object.entries(CELLS).map(([label, c]) => ({ kind: 'landmark', x: c.x, y: c.y, label })),
  ],
  npcs: { village: ['villager', 'elder'], wild: [] },
}

function makeMap() {
  const map = createMap(N, N)
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    map[y][x].tile = TILE.FLOOR
    map[y][x].skin = 'ow_grass_0'
  }
  return map
}

// Mirrors game.js's buildEntities closely enough for these tests: the two
// spawn kinds this module ever asks for.
function spawnInto(state) {
  return spawns => {
    for (const s of spawns) {
      if (s.kind === 'hirvi') state.entities.push(makeHirvi(s.x, s.y))
      else if (s.kind === 'npc') { const n = makeNpc(s); if (n) state.entities.push(n) }
      else if (s.kind === 'floating_pickup') state.entities.push({ type: 'floating_item', contents: s.contents, x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16, progress: 1 })
    }
  }
}

function build({ flags = {}, at = CELLS[SHRINE], inventory = [], entities = [] } = {}) {
  const save = normalizeAdventureSave(null)
  Object.assign(questFlags(save, mapData.name), flags)
  // Real feedback/sfx shapes: sfx() pushes into state.sfx.cues and queueToast
  // into state.feedback.toasts, so bare arrays would throw.
  const state = {
    map: makeMap(), entities: [...entities], feedback: makeFeedback(), sfx: makeSfx(),
    player: { x: at.x, y: at.y, px: at.x * S + 16, py: at.y * S + 16, hp: 10, talents: [], inventory, maxInventory: 10 },
  }
  const calls = { persist: 0, refreshInventory: 0, flags: [] }
  const ctx = makeQuestCtx({
    getState: () => state, save, mapData,
    persist: () => { calls.persist++ }, refreshInventory: () => { calls.refreshInventory++ },
    spawn: spawnInto(state), onFlag: f => calls.flags.push(f),
  })
  return { ctx, state, save, calls }
}

const elkOf = state => state.entities.find(e => e.type === 'hirvi') ?? null
const hideOf = state => state.entities.find(e => e.type === 'floating_item' && e.contents?.type === 'elk_hide') ?? null
const elders = state => state.entities.filter(e => e.type === 'npc' && e.species === 'elder')
const stainedCells = state => {
  let n = 0
  for (const row of state.map) for (const c of row) if (String(c.skin).startsWith('ow_dirt')) n++
  return n
}

describe('arrival rebuilds the world from the flags', () => {
  it('a fresh map beds the elk at the first wallow and lays a trail', () => {
    const { ctx, state } = build()
    onArrive(ctx)
    const elk = elkOf(state)
    assert.deepEqual({ x: elk.x, y: elk.y }, CELLS['wallow 1'])
    assert.equal(elk.mood, 'bedded')
    assert.ok(stainedCells(state) > 0)
  })
  it('mid-hunt it beds at the flushed wallow', () => {
    const { ctx, state } = build({ flags: { flush: 1 } })
    onArrive(ctx)
    assert.deepEqual({ x: elkOf(state).x, y: elkOf(state).y }, CELLS['wallow 2'])
    assert.equal(elkOf(state).mood, 'bedded')
  })
  it('at the last wallow it is already standing', () => {
    const { ctx, state } = build({ flags: { flush: 2 } })
    onArrive(ctx)
    assert.equal(elkOf(state).mood, 'standing')
    assert.equal(elkOf(state).brainDriven, true)
  })
  it('after the kill there is no elk and a hide waits at the last wallow', () => {
    const { ctx, state } = build({ flags: { flush: 2, hirvi_dead: true } })
    onArrive(ctx)
    assert.equal(elkOf(state), null)
    assert.deepEqual({ x: hideOf(state).x, y: hideOf(state).y }, CELLS['wallow 3'])
  })
  it('does not re-drop a hide the player is carrying', () => {
    const { ctx, state } = build({ flags: { hirvi_dead: true }, inventory: [makeItem('elk_hide')] })
    onArrive(ctx)
    assert.equal(hideOf(state), null)
  })
  it('does not duplicate a hide already lying there', () => {
    const { ctx, state } = build({ flags: { hirvi_dead: true } })
    onArrive(ctx)
    onArrive(ctx)
    assert.equal(state.entities.filter(e => e.type === 'floating_item').length, 1)
  })
  it('a finished quest builds nothing at all', () => {
    const { ctx, state } = build({ flags: { hirvi_dead: true, hide_given: true } })
    onArrive(ctx)
    assert.equal(state.entities.length, 0)
    assert.equal(stainedCells(state), 0)
  })
  it('does not duplicate the bedded elk on a repeat arrival', () => {
    const { ctx, state } = build()
    onArrive(ctx)
    onArrive(ctx)
    assert.equal(state.entities.filter(e => e.type === 'hirvi').length, 1)
    assert.equal(elkOf(state).mood, 'bedded')
  })
  it('does not duplicate the standing elk on a repeat arrival', () => {
    const { ctx, state } = build({ flags: { flush: 2 } })
    onArrive(ctx)
    onArrive(ctx)
    assert.equal(state.entities.filter(e => e.type === 'hirvi').length, 1)
    assert.equal(elkOf(state).mood, 'standing')
    assert.equal(elkOf(state).brainDriven, true)
  })
})

describe('the chase', () => {
  it('walking up to a bedded elk spooks it and marks the hunt seen', () => {
    const { ctx, state, save, calls } = build()
    onArrive(ctx)
    const elk = elkOf(state)
    state.player.x = elk.x - 2; state.player.y = elk.y
    state.player.px = state.player.x * S + 16; state.player.py = state.player.y * S + 16
    tick(ctx, 0.1)
    assert.equal(elk.mood, 'bolting')
    assert.equal(questFlags(save, mapData.name).hunt_seen, true)
    assert.ok(calls.flags.includes('hunt_seen'))
    assert.ok(state.sfx.cues.some(c => c.name === 'npc-deer'), 'played the bolt cue')
  })
  it('an arrow from beyond flush range spooks it just the same', () => {
    const { ctx, state, save } = build()
    onArrive(ctx)
    const elk = elkOf(state)
    hurtCreature(state, elk, 1)          // the player is at the shrine, 15 tiles off
    tick(ctx, 0.1)
    assert.equal(elk.mood, 'bolting')
    assert.equal(questFlags(save, mapData.name).hunt_seen, true)
  })
  it('a flushed elk runs toward the next wallow, not away from the player', () => {
    const { ctx, state } = build()
    onArrive(ctx)
    const elk = elkOf(state)              // wallow 1 (20,5); wallow 2 is due south at (20,20)
    state.player.x = elk.x - 2; state.player.y = elk.y   // player due west
    state.player.px = state.player.x * S + 16; state.player.py = state.player.y * S + 16
    tick(ctx, 0.1)
    const { px, py } = elk
    updateHirvi(elk, state, 0.1)
    assert.ok(elk.py > py, 'moved south, toward wallow 2')
    assert.ok(Math.abs(elk.px - px) < 1, 'did not run east, away from the player')
  })
  it('leaves it alone from far off', () => {
    const { ctx, state } = build()
    onArrive(ctx)
    tick(ctx, 0.1)
    assert.equal(elkOf(state).mood, 'bedded')
  })
  it('a finished bolt advances the flush, re-homes the elk and re-lays the trail', () => {
    const { ctx, state, save, calls } = build({ flags: { flush: 0 } })
    onArrive(ctx)
    const elk = elkOf(state)
    elk.bolted = true
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).flush, 1)
    const next = elkOf(state)
    assert.notEqual(next, elk)
    assert.deepEqual({ x: next.x, y: next.y }, CELLS['wallow 2'])
    assert.ok(calls.persist > 0)
  })
  it('the last flush leaves it standing, not bedded', () => {
    const { ctx, state, save } = build({ flags: { flush: 1 } })
    onArrive(ctx)
    elkOf(state).bolted = true
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).flush, 2)
    assert.equal(elkOf(state).mood, 'standing')
  })
  it('never advances past the last wallow', () => {
    const { ctx, state, save } = build({ flags: { flush: 2 } })
    onArrive(ctx)
    const elk = elkOf(state)
    elk.bolted = true
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).flush, 2)
    assert.equal(elkOf(state), elk, 'the standing elk is not replaced')
  })
})

describe('the kill and the hide', () => {
  it('a recorded kill sets the flag, drops the hide and persists — once', () => {
    const { ctx, state, save, calls } = build({ flags: { flush: 2 } })
    onArrive(ctx)
    state.entities = state.entities.filter(e => e.type !== 'hirvi')
    state.creatureKills = { hirvi: true }
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).hirvi_dead, true)
    assert.ok(hideOf(state))
    assert.equal(state.feedback.toasts.length, 1, 'the kill is a pausing toast')
    const persists = calls.persist
    tick(ctx, 0.1)
    assert.equal(calls.persist, persists, 'no second kill beat')
  })
  it('the hide drops where the elk died, not back at the wallow', () => {
    const { ctx, state } = build({ flags: { flush: 2 } })
    onArrive(ctx)
    const elk = elkOf(state)
    elk.x = 12; elk.y = 30; elk.px = 12 * S + 16; elk.py = 30 * S + 16   // kited off the wallow
    elk.hp = 0; elk.dying = 0.7                                          // the corpse is still there this frame
    state.creatureKills = { hirvi: true }
    tick(ctx, 0.1)
    assert.deepEqual({ x: hideOf(state).x, y: hideOf(state).y }, { x: 12, y: 30 })
  })
  it('handing the hide to the elder grants Ski-legs and finishes the quest', () => {
    const elder = { type: 'npc', species: 'elder', x: 10, y: 10, hostile: false }
    const { ctx, state, save, calls } = build({
      flags: { flush: 2, hirvi_dead: true }, at: { x: 10, y: 11 },
      inventory: [makeItem('elk_hide')], entities: [elder],
    })
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).hide_given, true)
    assert.equal(hasTalent(state.player, 'ski_legs'), true)
    assert.equal(state.player.inventory.some(i => i.kind === 'elk_hide'), false)
    assert.ok(calls.refreshInventory > 0)
    assert.ok(calls.persist > 0)
  })
  it('does nothing without the hide, or away from the elder', () => {
    const elder = { type: 'npc', species: 'elder', x: 10, y: 10, hostile: false }
    const far = build({ flags: { hirvi_dead: true }, at: { x: 2, y: 2 }, inventory: [makeItem('elk_hide')], entities: [elder] })
    tick(far.ctx, 0.1)
    assert.equal(questFlags(far.save, mapData.name).hide_given, undefined)

    const empty = build({ flags: { hirvi_dead: true }, at: { x: 10, y: 11 }, entities: [elder] })
    tick(empty.ctx, 0.1)
    assert.equal(questFlags(empty.save, mapData.name).hide_given, undefined)
    assert.equal(hasTalent(empty.state.player, 'ski_legs'), false)
  })
  it('a finished quest ticks quietly', () => {
    const { ctx, state, calls } = build({ flags: { hirvi_dead: true, hide_given: true } })
    tick(ctx, 0.1)
    assert.equal(calls.persist, 0)
    assert.equal(state.entities.length, 0)
  })
  it('declares one delivery: the hide, to the elder', () => {
    assert.deepEqual(DELIVERIES, [{ item: 'elk_hide', to: { species: 'elder' }, sets: 'hide_given' }])
  })
})

describe('the elder', () => {
  it('a dead elder is replaced on arrival while the hide is still owed', () => {
    const { ctx, state } = build({ flags: { flush: 2, hirvi_dead: true }, entities: [] })
    onArrive(ctx)
    const [elder] = elders(state)
    assert.ok(elder, 'an elder stands in the village again')
    assert.ok(Math.abs(elder.x - VILLAGE.x) <= 4 && Math.abs(elder.y - VILLAGE.y) <= 4, 'near the village anchor')
  })
  it('a living elder is not doubled', () => {
    const elder = makeNpc({ species: 'elder', id: 'npc:forest-1-clearings:0', x: 11, y: 10 })
    const { ctx, state } = build({ flags: { hirvi_dead: true }, entities: [elder] })
    onArrive(ctx)
    onArrive(ctx)
    assert.equal(elders(state).length, 1)
  })
  it('the replacement steps in mid-visit, so a same-visit delivery can land', () => {
    const { ctx, state, save } = build({
      flags: { flush: 2, hirvi_dead: true }, at: VILLAGE, inventory: [makeItem('elk_hide')], entities: [],
    })
    tick(ctx, 0.1)
    const [elder] = elders(state)
    assert.ok(elder, 'the tick put an elder back')
    state.player.x = elder.x + 1; state.player.y = elder.y
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).hide_given, true)
  })
  it('a finished quest leaves a dead elder dead', () => {
    const { ctx, state } = build({ flags: { hirvi_dead: true, hide_given: true }, entities: [] })
    onArrive(ctx)
    assert.equal(elders(state).length, 0)
  })
})

describe('wallows', () => {
  it('names three, in order', () => {
    assert.deepEqual(WALLOWS, ['wallow 1', 'wallow 2', 'wallow 3'])
  })
})
