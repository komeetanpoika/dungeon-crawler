import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { onArrive, tick, DELIVERIES, BURN_INTERVAL, BURN_STAGES, BURN_RADIUS, burnBand, applyBurnt } from '../renderer/systems/episodes/fold.js'
import { makeEpCtx, poiCell, isMapUnlocked, setFlag } from '../renderer/systems/leap.js'
import { normalizeAdventureSave } from '../renderer/systems/adventure.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE, weaponContents } from '../renderer/systems/entities.js'
import { makeItem } from '../renderer/systems/inventory.js'
import { makeCreature } from '../renderer/systems/creatures.js'
import { makeNpc } from '../renderer/systems/npc.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import '../renderer/systems/maahinen.js' // registers CREATURE_MAKE.maahinen etc.

const S = 32
const N = 40

// Four widely-spaced burn POIs (radius-6 bands never overlap) plus a lair.
const BURN1 = { x: 10, y: 10 }
const BURN2 = { x: 30, y: 10 }
const BURN3 = { x: 10, y: 30 }
const BURN4 = { x: 30, y: 30 }
const LAIR = { x: 20, y: 20 }
const ELDER_SPOT = { x: 3, y: 3 }

function makeMapData() {
  return {
    name: 'highland-2-fold', leap: true, w: N, h: N,
    pois: [
      { kind: 'landmark', x: BURN1.x, y: BURN1.y, label: 'burn 1' },
      { kind: 'landmark', x: BURN2.x, y: BURN2.y, label: 'burn 2' },
      { kind: 'landmark', x: BURN3.x, y: BURN3.y, label: 'burn 3' },
      { kind: 'landmark', x: BURN4.x, y: BURN4.y, label: 'burn 4' },
      { kind: 'landmark', x: LAIR.x, y: LAIR.y, label: 'lair' },
    ],
    npcs: { village: ['villager', 'villager', 'elder'], wild: ['wolf'] },
  }
}

// Trees planted around burn 1 to exercise burnBand's radius: two at exactly
// radius 6 (included), a canopy `_top` overlay that isn't a HARVEST key in
// its own right (included), one just outside radius 6 (excluded by the loop
// bound itself), and a rock (never a tree, excluded).
const TREE_TOP = { x: BURN1.x, y: BURN1.y - 5, overlay: 'ow_tree_pine_top' }
const TREE_LEFT = { x: BURN1.x - 6, y: BURN1.y, overlay: 'ow_tree_small' }
const TREE_RIGHT = { x: BURN1.x + 6, y: BURN1.y, overlay: 'ow_tree_small' }
const TREE_FAR = { x: BURN1.x + 7, y: BURN1.y, overlay: 'ow_tree_small' }
const ROCK = { x: BURN1.x + 2, y: BURN1.y + 2, overlay: 'ow_rock_gray_0' }

function makeMap() {
  const map = createMap(N, N)
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) map[y][x].tile = TILE.FLOOR
  for (const t of [TREE_TOP, TREE_LEFT, TREE_RIGHT, TREE_FAR, ROCK]) {
    const cell = map[t.y][t.x]
    cell.tile = TILE.WALL
    cell.overlay = t.overlay
    cell.losSoft = true
  }
  return map
}

function makePlayer(overrides = {}) {
  return { x: 1, y: 1, px: 1 * S + 16, py: 1 * S + 16,
    hp: 10, invulnTimer: 0, inventory: [], maxInventory: 10, facing: 'south', ...overrides }
}

function makeSpies() {
  const calls = { resolve: 0, persist: 0, refreshInventory: 0 }
  return {
    calls,
    resolve: () => { calls.resolve++ },
    persist: () => { calls.persist++ },
    refreshInventory: () => { calls.refreshInventory++ },
  }
}

// Mirrors game.js's buildEntities 'creature' case, as in episodes-ferry.test.js.
function spawnInto(state) {
  return spawns => {
    for (const s of spawns) {
      if (s.kind !== 'creature') continue
      const c = makeCreature(s.creature, s.x, s.y)
      if (c) state.entities.push({ ...c, px: s.x * S + 16, py: s.y * S + 16 })
    }
  }
}

let state, save, mapData, spies, ctx

beforeEach(() => {
  mapData = makeMapData()
  save = normalizeAdventureSave(null)
  spies = makeSpies()
  state = { player: makePlayer(), map: makeMap(), entities: [], log: [], sfx: { cues: [] } }
  ctx = makeEpCtx({
    getState: () => state, save, mapData,
    persist: spies.persist, resolve: spies.resolve, refreshInventory: spies.refreshInventory,
    spawn: spawnInto(state),
  })
})

const cue = (st, name) => st.sfx.cues.some(c => c.name === name)
const maahinenIn = st => st.entities.find(e => e.type === 'maahinen')
const villagers = st => st.entities.filter(e => e.type === 'npc' && e.species === 'villager')
const elderIn = st => st.entities.find(e => e.type === 'npc' && e.species === 'elder')

describe('DELIVERIES', () => {
  it('declares the fleece -> elder delivery that sets fleece_shown and gives a pick', () => {
    assert.deepEqual(DELIVERIES, [{
      item: 'fleece', to: { species: 'elder' }, sets: 'fleece_shown',
      gives: { type: 'weapon', ...weaponContents('pick') },
    }])
  })
})

describe('constants', () => {
  it('matches the brief', () => {
    assert.equal(BURN_INTERVAL, 120)
    assert.equal(BURN_STAGES, 4)
    assert.equal(BURN_RADIUS, 6)
  })
})

describe('burnBand', () => {
  it('chars every tree overlay inside radius 6 of the POI, alternates deadtree skins, and returns their keys in scan order', () => {
    const keys = burnBand(state.map, mapData, 1)
    assert.deepEqual(keys, ['10,5', '4,10', '16,10'])
    assert.equal(state.map[5][10].overlay, 'ow_deadtree_0')
    assert.equal(state.map[10][4].overlay, 'ow_deadtree_1')
    assert.equal(state.map[10][16].overlay, 'ow_deadtree_0')
    // outside the radius / not a tree: untouched
    assert.equal(state.map[10][17].overlay, 'ow_tree_small')
    assert.equal(state.map[12][12].overlay, 'ow_rock_gray_0')
    // burnt cells stay blocking and foliage-soft — a char, not a felling
    assert.equal(state.map[5][10].tile, TILE.WALL)
    assert.equal(state.map[5][10].losSoft, true)
  })

  it('returns [] for a burn POI the map does not declare', () => {
    assert.deepEqual(burnBand(state.map, mapData, 9), [])
  })
})

describe('applyBurnt', () => {
  it('re-stamps the same keys with the same alternating skins on a freshly built map', () => {
    const keys = burnBand(state.map, mapData, 1)
    const fresh = makeMap() // trees back to their original overlays
    applyBurnt(fresh, keys)
    assert.equal(fresh[5][10].overlay, 'ow_deadtree_0')
    assert.equal(fresh[10][4].overlay, 'ow_deadtree_1')
    assert.equal(fresh[10][16].overlay, 'ow_deadtree_0')
    // untouched keys are left alone
    assert.equal(fresh[10][17].overlay, 'ow_tree_small')
  })

  it('ignores an empty/undefined key list', () => {
    const fresh = makeMap()
    applyBurnt(fresh, undefined)
    assert.equal(fresh[5][10].overlay, 'ow_tree_pine_top')
  })
})

describe('tick — burn timer', () => {
  it('does not advance before 120s of accumulated map time', () => {
    tick(ctx, 119)
    assert.equal(ctx.flags.burn, undefined)
    assert.equal(cue(state, 'fire-burst'), false)
  })

  it('burns band 1 at 120s: sets burn, cues fire-burst, records keys in flags.burnt', () => {
    tick(ctx, BURN_INTERVAL)
    assert.equal(ctx.flags.burn, 1)
    assert.ok(cue(state, 'fire-burst'))
    assert.deepEqual(ctx.flags.burnt, ['10,5', '4,10', '16,10'])
    assert.equal(state.map[5][10].overlay, 'ow_deadtree_0')
    assert.equal(spies.calls.persist, 1)
  })

  it('accumulates burnt keys across stages and stops incrementing after stage 4', () => {
    for (let i = 0; i < 4; i++) tick(ctx, BURN_INTERVAL)
    assert.equal(ctx.flags.burn, 4)
    const afterFour = [...ctx.flags.burnt]
    tick(ctx, BURN_INTERVAL) // a 5th tier never fires
    assert.equal(ctx.flags.burn, 4)
    assert.deepEqual(ctx.flags.burnt, afterFour)
  })

  it('stops once fleece_shown is set, even mid-timer', () => {
    ctx.set('fleece_shown')
    tick(ctx, BURN_INTERVAL * 10)
    assert.equal(ctx.flags.burn, undefined)
  })
})

describe('tick — village wrath at stage 4', () => {
  beforeEach(() => {
    state.entities.push(
      { ...makeNpc({ species: 'villager', id: 'npc:highland-2-fold:0', x: 2, y: 2 }) },
      { ...makeNpc({ species: 'villager', id: 'npc:highland-2-fold:1', x: 2, y: 3 }) },
      { ...makeNpc({ species: 'elder', id: 'npc:highland-2-fold:2', x: ELDER_SPOT.x, y: ELDER_SPOT.y }) },
    )
  })

  it('flips fight-capable village NPCs hostile and sets npcWrath, but leaves the flee-only elder alone', () => {
    for (let i = 0; i < 4; i++) tick(ctx, BURN_INTERVAL)
    assert.equal(ctx.flags.burn, 4)
    assert.equal(state.npcWrath, true)
    assert.ok(villagers(state).every(v => v.hostile === true))
    assert.equal(elderIn(state).hostile, false)
    assert.ok(state.log.includes('The village turns on you!'))
  })
})

describe('tick — delivering the fleece', () => {
  beforeEach(() => {
    state.entities.push(makeNpc({ species: 'elder', id: 'npc:highland-2-fold:2', x: ELDER_SPOT.x, y: ELDER_SPOT.y }))
    state.entities.push({ ...makeNpc({ species: 'villager', id: 'npc:highland-2-fold:0', x: 5, y: 5 }), hostile: true })
    state.npcWrath = true
    state.player.x = ELDER_SPOT.x + 1
    state.player.y = ELDER_SPOT.y
    state.player.px = state.player.x * S + 16
    state.player.py = state.player.y * S + 16
    state.player.inventory.push(makeItem('fleece'))
  })

  it('clears wrath, drops a pick beside the player, cues pickup and talent-learned, and refreshes/persists once', () => {
    tick(ctx, 0)
    assert.equal(ctx.flags.fleece_shown, true)
    assert.equal(state.player.inventory.length, 0, 'fleece consumed')
    assert.equal(state.npcWrath, false)
    assert.equal(villagers(state)[0].hostile, false)
    assert.ok(cue(state, 'pickup'))
    assert.ok(cue(state, 'talent-learned'))
    assert.equal(spies.calls.refreshInventory, 1)
    assert.equal(spies.calls.persist, 1)
    const drop = state.entities.find(e => e.type === 'floating_item')
    assert.ok(drop, 'pick dropped')
    assert.equal(drop.contents.type, 'weapon')
    assert.equal(drop.contents.weaponType, 'pick')
    // adjacent to the player, not on top of it
    assert.equal(Math.abs(drop.x - state.player.x) + Math.abs(drop.y - state.player.y), 1)
  })

  it('a delivery on the same frame a burn tier would land stops that burn', () => {
    ctx.set('burn', 3)
    state.burnT = BURN_INTERVAL
    tick(ctx, 0)
    assert.equal(ctx.flags.fleece_shown, true)
    assert.equal(ctx.flags.burn, 3, 'burn did not advance to 4 this frame')
  })
})

describe('Maahinen', () => {
  it('onArrive spawns it at the lair and sets maahinen_spawned', () => {
    onArrive(ctx)
    const m = maahinenIn(state)
    assert.ok(m)
    assert.equal(m.x, LAIR.x)
    assert.equal(m.y, LAIR.y)
    assert.equal(ctx.flags.maahinen_spawned, true)
    assert.equal(spies.calls.persist, 1)
  })

  it('onArrive does nothing once maahinen_dead is set', () => {
    ctx.set('maahinen_dead')
    onArrive(ctx)
    assert.equal(maahinenIn(state), undefined)
  })

  it('tick leaves maahinen_dead unset and never resolves while the creature is alive', () => {
    onArrive(ctx)
    tick(ctx, 0)
    assert.equal(ctx.flags.maahinen_dead, undefined)
    assert.equal(spies.calls.resolve, 0)
  })

  it('tick sets maahinen_dead and resolves exactly once once the creature is gone', () => {
    onArrive(ctx)
    state.entities = state.entities.filter(e => e.type !== 'maahinen')
    tick(ctx, 0)
    assert.equal(ctx.flags.maahinen_dead, true)
    assert.equal(spies.calls.resolve, 1)
    tick(ctx, 0) // idempotent: no repeat resolve
    assert.equal(spies.calls.resolve, 1)
  })

  it('does nothing before the maahinen has ever been spawned', () => {
    tick(ctx, 0)
    assert.equal(ctx.flags.maahinen_dead, undefined)
    assert.equal(spies.calls.resolve, 0)
  })
})

describe('isMapUnlocked — real fold map', () => {
  const fold = Object.values(OPEN_MAPS).find(m => m.name === 'highland-2-fold')

  it('unlocks only with the Maahinen dead and at least one wolf still alive', () => {
    const realSave = normalizeAdventureSave(null)
    setFlag(realSave, fold.name, 'maahinen_dead')
    assert.equal(isMapUnlocked(realSave, fold), true)
    const v = fold.npcs.village.length
    realSave.npcs[fold.name] = { dead: fold.npcs.wild.map((_, i) => `npc:${fold.name}:${v + i}`), hostile: false }
    assert.equal(isMapUnlocked(realSave, fold), false)
  })
})
