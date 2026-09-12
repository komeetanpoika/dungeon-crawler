import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { onArrive, tick, PIT, CAMP, GAPS, TAR_PIT_COST, TAR_YIELD, BOW, breakGap, plankGap } from '../renderer/systems/quests/river.js'
import { makeQuestCtx, questFlags } from '../renderer/systems/quests.js'
import { normalizeAdventureSave } from '../renderer/systems/adventure.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE, makeRangedContents } from '../renderer/systems/entities.js'
import { makeItem, itemFromContents } from '../renderer/systems/inventory.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const S = 32
const N = 40

// The deck runs east-west: 7,20 is the west bank, 8..10 the three gaps, 11 the east bank.
const CELLS = { [CAMP]: { x: 5, y: 5 }, [PIT]: { x: 9, y: 5 }, [GAPS[0]]: { x: 8, y: 20 }, [GAPS[1]]: { x: 9, y: 20 }, [GAPS[2]]: { x: 10, y: 20 } }
const WEST = { x: 7, y: 20 }

const mapData = {
  name: 'forest-2-river', w: N, h: N,
  pois: [
    { kind: 'camp', x: CELLS[CAMP].x, y: CELLS[CAMP].y, label: CAMP },
    ...Object.entries(CELLS).filter(([l]) => l !== CAMP).map(([label, c]) => ({ kind: 'landmark', x: c.x, y: c.y, label })),
  ],
  npcs: { village: ['villager', 'villager'], wild: [] },
}

// Grass everywhere; the three gap cells baked exactly as the real map bakes
// them — water skin under a walkable pier-log prop.
function makeMap() {
  const map = createMap(N, N)
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) { map[y][x].tile = TILE.FLOOR; map[y][x].skin = 'ow_grass_0' }
  for (const label of GAPS) { const c = CELLS[label]; map[c.y][c.x].skin = 'ow_water_0'; map[c.y][c.x].overlay = 'ow_pier_log' }
  return map
}

function spawnInto(state) {
  return spawns => {
    for (const s of spawns) {
      if (s.kind === 'floating_pickup') state.entities.push({ type: 'floating_item', contents: s.contents, x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16, progress: 1 })
    }
  }
}

function build({ flags = {}, at = CELLS[CAMP], inventory = [], entities = [], ranged = null } = {}) {
  const save = normalizeAdventureSave(null)
  Object.assign(questFlags(save, mapData.name), flags)
  const state = {
    map: makeMap(), entities: [...entities], feedback: makeFeedback(), sfx: makeSfx(),
    player: { x: at.x, y: at.y, px: at.x * S + 16, py: at.y * S + 16, hp: 10, talents: [], inventory, maxInventory: 10, ranged },
  }
  const calls = { persist: 0, refreshInventory: 0, flags: [] }
  const ctx = makeQuestCtx({
    getState: () => state, save, mapData,
    persist: () => { calls.persist++ }, refreshInventory: () => { calls.refreshInventory++ },
    spawn: spawnInto(state), onFlag: f => calls.flags.push(f),
  })
  return { ctx, state, save, calls }
}

const gapCell = (state, i) => state.map[CELLS[GAPS[i]].y][CELLS[GAPS[i]].x]
const isBroken = cell => cell.tile === TILE.WALL && cell.overlay === null && cell.losClear === true
const isPlanked = cell => cell.tile === TILE.FLOOR && cell.overlay === 'ow_pier_log' && cell.losClear === undefined
const fires = state => state.entities.filter(e => e.type === 'campfire')
const count = (player, kind) => player.inventory.filter(i => i.kind === kind).reduce((n, i) => n + (i.count ?? 1), 0)
const bowOf = state => state.entities.find(e => e.type === 'floating_item' && e.contents?.weaponType === BOW) ?? null
const moveTo = (state, c) => { state.player.x = c.x; state.player.y = c.y; state.player.px = c.x * S + 16; state.player.py = c.y * S + 16 }

describe('the gap cells', () => {
  it('breakGap turns a baked plank into water: WALL, no log, losClear, dirty', () => {
    const { state } = build()
    breakGap(state.map, CELLS[GAPS[0]])
    assert.ok(isBroken(gapCell(state, 0)))
    assert.equal(gapCell(state, 0).skin, 'ow_water_0', 'the water skin is untouched')
  })
  it('plankGap puts the log back over the water and clears losClear', () => {
    const { state } = build()
    breakGap(state.map, CELLS[GAPS[0]])
    plankGap(state.map, CELLS[GAPS[0]])
    assert.ok(isPlanked(gapCell(state, 0)))
  })
})

describe('arrival rebuilds the deck from the flags', () => {
  it('a fresh map breaks all three gaps', () => {
    const { ctx, state } = build()
    onArrive(ctx)
    for (let i = 0; i < 3; i++) assert.ok(isBroken(gapCell(state, i)), `gap ${i + 1} broken`)
  })
  it('restores exactly the planked cells', () => {
    const { ctx, state } = build({ flags: { pit_lit: true, plank_2: true } })
    onArrive(ctx)
    assert.ok(isBroken(gapCell(state, 0)))
    assert.ok(isPlanked(gapCell(state, 1)))
    assert.ok(isBroken(gapCell(state, 2)))
  })
  it('a finished bridge is left exactly as baked', () => {
    const { ctx, state } = build({ flags: { pit_lit: true, plank_1: true, plank_2: true, plank_3: true, bridge_done: true, bow_given: true } })
    onArrive(ctx)
    for (let i = 0; i < 3; i++) assert.ok(isPlanked(gapCell(state, i)))
  })
  it('a lit pit comes back as one eternal fire, never two', () => {
    const { ctx, state } = build({ flags: { pit_lit: true } })
    onArrive(ctx)
    onArrive(ctx)
    assert.equal(fires(state).length, 1)
    assert.equal(fires(state)[0].eternal, true)
    assert.deepEqual({ x: fires(state)[0].x, y: fires(state)[0].y }, CELLS[PIT])
  })
  it('an unlit pit has no fire', () => {
    const { ctx, state } = build()
    onArrive(ctx)
    assert.equal(fires(state).length, 0)
  })
})

describe('the burn', () => {
  it('the first tick on the map notes the broken deck, once', () => {
    const { ctx, state, save, calls } = build()
    onArrive(ctx)
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).bridge_seen, true)
    assert.equal(state.feedback.bubble?.kind, 'thought', 'the beat is a thought bubble, not a toast')
    assert.equal(state.feedback.toasts.length, 0)
    const persists = calls.persist
    tick(ctx, 0.1)
    assert.equal(calls.persist, persists, 'no second beat')
  })
  it('six lumber on the pit become three tar, an eternal fire and a toast', () => {
    const { ctx, state, save, calls } = build({ at: CELLS[PIT], inventory: [makeItem('lumber', 7)] })
    onArrive(ctx)
    tick(ctx, 0.1)
    assert.equal(count(state.player, 'lumber'), 1)
    assert.equal(count(state.player, 'tar'), TAR_YIELD)
    assert.equal(questFlags(save, mapData.name).pit_lit, true)
    assert.equal(fires(state).length, 1)
    assert.equal(fires(state)[0].eternal, true)
    assert.equal(state.feedback.toasts.length, 1, 'lighting the pit is a pausing toast')
    assert.ok(state.sfx.cues.some(c => c.name === 'campfire-light'))
    assert.ok(calls.refreshInventory > 0 && calls.persist > 0)
  })
  it('five lumber is not enough', () => {
    const { ctx, state, save } = build({ at: CELLS[PIT], inventory: [makeItem('lumber', 5)] })
    onArrive(ctx)
    tick(ctx, 0.1)
    assert.equal(count(state.player, 'lumber'), 5)
    assert.equal(questFlags(save, mapData.name).pit_lit, undefined)
  })
  it('standing anywhere else with the lumber does nothing', () => {
    const { ctx, state } = build({ at: CELLS[CAMP], inventory: [makeItem('lumber', 6)] })
    onArrive(ctx)
    tick(ctx, 0.1)
    assert.equal(count(state.player, 'lumber'), 6)
  })
  it('re-fires for more tar while the deck is unfinished, without a second fire or toast', () => {
    const { ctx, state } = build({ flags: { pit_lit: true }, at: CELLS[PIT], inventory: [makeItem('lumber', 6)] })
    onArrive(ctx)
    tick(ctx, 0.1)
    assert.equal(count(state.player, 'tar'), TAR_YIELD)
    assert.equal(fires(state).length, 1)
    assert.equal(state.feedback.toasts.length, 0)
  })
  it('drops the tar at the pit when the sack has no room', () => {
    // Ten junk slots + the lumber stack: once the lumber is spent the sack is exactly full (maxInventory 10).
    const full = Array.from({ length: 10 }, (_, i) => ({ kind: `junk_${i}`, name: 'x', stackable: false }))
    const { ctx, state } = build({ at: CELLS[PIT], inventory: [...full, makeItem('lumber', 6)] })
    onArrive(ctx)
    tick(ctx, 0.1)
    assert.equal(count(state.player, 'tar'), 0)
    const drop = state.entities.find(e => e.type === 'floating_item' && e.contents?.type === 'tar')
    assert.ok(drop)
    assert.equal(drop.contents.count, TAR_YIELD)
    assert.deepEqual({ x: drop.x, y: drop.y }, CELLS[PIT])
  })
})
