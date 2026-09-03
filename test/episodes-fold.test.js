import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { onArrive, tick, DELIVERIES, BURN_INTERVAL, BURN_STAGES, BURN_RADIUS, burnBand, applyBurnt, burrowOpen } from '../renderer/systems/episodes/fold.js'
import { makeEpCtx, poiCell, isMapUnlocked, setFlag } from '../renderer/systems/leap.js'
import { normalizeAdventureSave } from '../renderer/systems/adventure.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE, weaponContents } from '../renderer/systems/entities.js'
import { makeItem } from '../renderer/systems/inventory.js'
import { makeNpc } from '../renderer/systems/npc.js'
import { harvest } from '../renderer/systems/lumber.js'
import { buildOpenMap, npcSpawnIndex } from '../renderer/systems/openmap.js'
import { makeMaahinen, updateMaahinen } from '../renderer/systems/monsters/maahinen.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'

const S = 32
const N = 40

// Four widely-spaced burn POIs (radius-6 bands never overlap) plus a lair.
const BURN1 = { x: 10, y: 10 }
const BURN2 = { x: 30, y: 10 }
const BURN3 = { x: 10, y: 30 }
const BURN4 = { x: 30, y: 30 }
const LAIR = { x: 20, y: 20 }
// The burrow mouth: the POI cell and its two horizontal neighbours, sealed
// with rock until a pick clears one.
const BURROW = { x: 20, y: 22 }
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
      { kind: 'landmark', x: BURROW.x, y: BURROW.y, label: 'burrow' },
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
// Unrelated `_top` art in the fold's real palette — must never char.
const WELL_TOP = { x: BURN1.x - 1, y: BURN1.y - 1, overlay: 'ow_well_top' }

function makeMap() {
  const map = createMap(N, N)
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) map[y][x].tile = TILE.FLOOR
  for (const t of [TREE_TOP, TREE_LEFT, TREE_RIGHT, TREE_FAR, ROCK, WELL_TOP]) {
    const cell = map[t.y][t.x]
    cell.tile = TILE.WALL
    cell.overlay = t.overlay
    cell.losSoft = true
  }
  // The three sealed mouth cells.
  for (const dx of [-1, 0, 1]) {
    const cell = map[BURROW.y][BURROW.x + dx]
    cell.tile = TILE.WALL
    cell.overlay = 'ow_rock_gray_0'
  }
  return map
}

// Mine one mouth cell through (rocks take 3 blows) so burrowOpen holds.
function openMouth(map, dx = 0) {
  for (let i = 0; i < 3; i++) harvest(map, BURROW.x + dx, BURROW.y, { mine: 1 })
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

// Mirrors game.js's buildEntities registry-monster case, as in episodes-ferry.test.js.
function spawnInto(state) {
  return spawns => {
    for (const s of spawns) {
      if (s.kind !== 'maahinen') continue
      state.entities.push({ ...makeMaahinen(s.x, s.y), px: s.x * S + 16, py: s.y * S + 16 })
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
    // ow_well_top ends in `_top` but is not `ow_tree_*` — never chars
    assert.equal(state.map[9][9].overlay, 'ow_well_top')
    assert.equal(keys.includes('9,9'), false)
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

describe('burrowOpen', () => {
  it('is false while all three mouth cells are still sealed', () => {
    assert.equal(burrowOpen(state.map, mapData), false)
  })

  it('is true once any one mouth cell has been mined through', () => {
    openMouth(state.map, -1)
    assert.equal(burrowOpen(state.map, mapData), true)
  })

  it('is false on a map with no burrow POI', () => {
    mapData.pois = mapData.pois.filter(p => p.label !== 'burrow')
    openMouth(state.map)
    assert.equal(burrowOpen(state.map, mapData), false)
  })
})

describe('Maahinen', () => {
  it('onArrive spawns nothing while the burrow mouth is still sealed', () => {
    onArrive(ctx)
    assert.equal(maahinenIn(state), undefined)
    assert.equal(ctx.flags.maahinen_spawned, undefined)
    assert.equal(spies.calls.persist, 0)
  })

  it('onArrive spawns it at the lair once the mouth is open, and sets maahinen_spawned', () => {
    openMouth(state.map)
    onArrive(ctx)
    const m = maahinenIn(state)
    assert.ok(m)
    assert.equal(m.x, LAIR.x)
    assert.equal(m.y, LAIR.y)
    assert.equal(ctx.flags.maahinen_spawned, true)
    assert.equal(spies.calls.persist, 1)
  })

  it('onArrive does nothing once maahinen_dead is set', () => {
    openMouth(state.map)
    ctx.set('maahinen_dead')
    onArrive(ctx)
    assert.equal(maahinenIn(state), undefined)
  })

  it('tick spawns it the moment the player breaks through, exactly once', () => {
    onArrive(ctx)
    tick(ctx, 0)
    assert.equal(maahinenIn(state), undefined, 'still sealed')
    openMouth(state.map)
    tick(ctx, 0)
    const m = maahinenIn(state)
    assert.ok(m, 'spawned on the break-through tick')
    assert.equal(m.x, LAIR.x)
    assert.equal(m.y, LAIR.y)
    assert.equal(ctx.flags.maahinen_spawned, true)
    tick(ctx, 0)
    assert.equal(state.entities.filter(e => e.type === 'maahinen').length, 1, 'no second spawn')
  })

  it('tick leaves maahinen_dead unset and never resolves while the creature is alive', () => {
    openMouth(state.map)
    onArrive(ctx)
    tick(ctx, 0)
    assert.equal(ctx.flags.maahinen_dead, undefined)
    assert.equal(spies.calls.resolve, 0)
  })

  it('a maahinen merely absent (not killed) never counts as dead', () => {
    openMouth(state.map)
    onArrive(ctx)
    state.entities = state.entities.filter(e => e.type !== 'maahinen')
    tick(ctx, 0)
    assert.equal(ctx.flags.maahinen_dead, undefined)
    assert.equal(spies.calls.resolve, 0)
  })

  it('tick sets maahinen_dead and resolves exactly once on the recorded kill', () => {
    openMouth(state.map)
    onArrive(ctx)
    state.creatureKills = { maahinen: true }
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

describe('tick — burn timer stops once the Maahinen is dead', () => {
  it('never advances a burn tier after maahinen_dead', () => {
    ctx.set('maahinen_dead')
    tick(ctx, BURN_INTERVAL * 10)
    assert.equal(ctx.flags.burn, undefined)
  })
})

// The real map, not a fixture: the fold's lair sits 70 tiles from the
// player's spawn behind three rock-sealed mouth cells. Regression for the
// bug where the Maahinen spawned on arrival and glided through walls to
// erupt on the player.
describe('Maahinen on the real fold map', () => {
  const fold = Object.values(OPEN_MAPS).find(m => m.name === 'highland-2-fold')
  const LEASH_MARGIN = 12

  function realCtx() {
    const { map, playerSpawn } = buildOpenMap(fold)
    const st = {
      player: { ...makePlayer(), x: playerSpawn.x, y: playerSpawn.y,
        px: playerSpawn.x * S + 16, py: playerSpawn.y * S + 16 },
      map, entities: [], log: [], sfx: { cues: [] },
    }
    const realSave = normalizeAdventureSave(null)
    const realSpies = makeSpies()
    const c = makeEpCtx({
      getState: () => st, save: realSave, mapData: fold,
      persist: realSpies.persist, resolve: realSpies.resolve, refreshInventory: realSpies.refreshInventory,
      spawn: spawnInto(st),
    })
    return { st, ctx: c }
  }

  it('never spawns while the mouth is sealed, even after 120s on the map', () => {
    const { st, ctx: c } = realCtx()
    onArrive(c)
    for (let t = 0; t < 120; t += 0.1) {
      tick(c, 0.1)
      for (const e of st.entities.filter(e => e.type === 'maahinen')) updateMaahinen(e, st, 0.1)
    }
    assert.equal(st.entities.some(e => e.type === 'maahinen'), false, 'never spawned')
  })

  it('once spawned, stays in the lair area for 120s while the player is far away', () => {
    const { st, ctx: c } = realCtx()
    const burrow = poiCell(fold, 'burrow')
    const lair = poiCell(fold, 'lair')
    for (let i = 0; i < 3; i++) harvest(st.map, burrow.x, burrow.y, { mine: 1 })
    assert.equal(burrowOpen(st.map, fold), true)
    tick(c, 0.1)
    const m = st.entities.find(e => e.type === 'maahinen')
    assert.ok(m, 'spawned on the break-through tick')
    for (let t = 0; t < 120; t += 0.1) updateMaahinen(m, st, 0.1)
    const cheb = Math.max(Math.abs(m.px / S - (lair.x + 0.5)), Math.abs(m.py / S - (lair.y + 0.5)))
    assert.ok(cheb <= LEASH_MARGIN, `wandered ${cheb.toFixed(1)} tiles from the lair`)
    assert.equal(m.state, 'submerged', 'never erupted on a player 70 tiles away')
  })
})

describe('isMapUnlocked — real fold map', () => {
  const fold = Object.values(OPEN_MAPS).find(m => m.name === 'highland-2-fold')

  it('unlocks only with the Maahinen dead and at least one wolf still alive', () => {
    const realSave = normalizeAdventureSave(null)
    setFlag(realSave, fold.name, 'maahinen_dead')
    assert.equal(isMapUnlocked(realSave, fold), true)
    // The wolves are homed at the den, so their ids come off openmap's roster.
    realSave.npcs[fold.name] = {
      dead: npcSpawnIndex(fold).filter(e => e.species === 'wolf').map(e => `npc:${fold.name}:${e.i}`),
      hostile: false,
    }
    assert.equal(isMapUnlocked(realSave, fold), false)
  })
})

describe('tick — delivering the fleece without a free ground tile', () => {
  // Player boxed in beside the elder: west/north/south walled off, the
  // elder itself occupies east (besideNpc range), so freeAdjTile finds
  // nothing.
  const P = { x: 10, y: 3 }
  const E = { x: 11, y: 3 }

  beforeEach(() => {
    for (const [dx, dy] of [[-1, 0], [0, -1], [0, 1]]) {
      const c = state.map[P.y + dy][P.x + dx]
      c.tile = TILE.WALL
      c.overlay = null
    }
    state.entities.push(makeNpc({ species: 'elder', id: 'npc:highland-2-fold:2', x: E.x, y: E.y }))
    state.player.x = P.x; state.player.y = P.y
    state.player.px = P.x * S + 16; state.player.py = P.y * S + 16
    state.player.inventory.push(makeItem('fleece'))
  })

  it('grants the pick straight into an empty weapon hand when the sack has room but the ground does not', () => {
    assert.equal(state.player.weapon, undefined)
    tick(ctx, 0)
    assert.equal(ctx.flags.fleece_shown, true)
    assert.equal(state.player.weapon?.weaponType, 'pick')
    assert.equal(state.player.inventory.length, 0)
    assert.equal(state.entities.some(e => e.type === 'floating_item'), false, 'nothing dropped on the ground')
    assert.ok(cue(state, 'pickup'))
    assert.ok(cue(state, 'talent-learned'))
    assert.equal(spies.calls.persist, 1)
  })

  it('defers the delivery when neither the ground nor the sack has room, keeping the fleece and throttling the message', () => {
    state.player.weapon = weaponContents('dagger')  // hand occupied
    state.player.maxInventory = 1                   // only the fleece itself fits

    tick(ctx, 0)
    assert.equal(ctx.flags.fleece_shown, undefined, 'delivery deferred')
    assert.equal(state.player.inventory.length, 1, 'fleece kept')
    assert.equal(state.player.inventory[0].kind, 'fleece')
    assert.equal(spies.calls.persist, 0)
    assert.equal(spies.calls.refreshInventory, 0)
    const msg = 'The elder holds the pick for you.'
    assert.ok(state.log.includes(msg))

    // throttled: an immediate re-tick does not log it again
    const before = state.log.filter(l => l === msg).length
    tick(ctx, 0)
    assert.equal(state.log.filter(l => l === msg).length, before, 'still cooling down')

    // past the cooldown it fires again
    tick(ctx, 10)
    assert.equal(state.log.filter(l => l === msg).length, before + 1)

    // once the player frees a sack slot, a later tick completes the delivery
    state.player.maxInventory = 5
    tick(ctx, 0)
    assert.equal(ctx.flags.fleece_shown, true)
    assert.equal(state.player.inventory.some(i => i.kind === 'fleece'), false)
    assert.equal(state.player.inventory.some(i => i.kind === 'weapon'), true, 'pick landed in the sack')
  })
})

describe('tick — burnt keys dedupe across overlapping bands', () => {
  it('never records the same "x,y" key twice when two burn bands overlap', () => {
    // Pull burn 2 in close enough that its radius-6 band overlaps burn 1's,
    // re-hitting TREE_RIGHT (16,10, already charred) and TREE_TOP (10,5,
    // already charred) — both are still "trees" once deadtree'd, since
    // ow_deadtree_* is itself a chop-tool HARVEST key.
    const burn2 = mapData.pois.find(p => p.label === 'burn 2')
    burn2.x = BURN1.x + 4
    burn2.y = BURN1.y

    tick(ctx, BURN_INTERVAL) // burn 1: chars '10,5', '4,10', '16,10'
    tick(ctx, BURN_INTERVAL) // burn 2: re-hits '10,5' and '16,10', adds '17,10'

    const keys = ctx.flags.burnt
    assert.equal(new Set(keys).size, keys.length, 'no duplicate keys')
    assert.deepEqual(keys, ['10,5', '4,10', '16,10', '17,10'])
  })
})
