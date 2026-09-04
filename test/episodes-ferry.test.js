import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { onArrive, tick, DELIVERIES } from '../renderer/systems/episodes/ferry.js'
import { makeEpCtx, poiCell } from '../renderer/systems/leap.js'
import { normalizeAdventureSave } from '../renderer/systems/adventure.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeItem } from '../renderer/systems/inventory.js'
import { makeNakki, updateNakki, SINK_TIME } from '../renderer/systems/monsters/nakki.js'

const S = 32
const N = 12

// A minimal stand-in for the real lake-1-ferry POIs: bell and pier end share
// a cell (as on the real map), the Näkki sits one cell further out on the
// first pier gap, and the remaining gap cells run on east of it (the real
// map has four; three here prove openGaps takes every `pier gap N` POI).
const BELL = { x: 5, y: 5 }
const GAP1 = { x: 6, y: 5 }
const GAP2 = { x: 7, y: 5 }
const GAP3 = { x: 8, y: 5 }
const GAPS = [GAP1, GAP2, GAP3]

function makeMapData() {
  return {
    name: 'lake-1-ferry', leap: true, w: N, h: N,
    pois: [
      { kind: 'landmark', x: BELL.x, y: BELL.y, label: 'bell' },
      { kind: 'landmark', x: BELL.x, y: BELL.y, label: 'pier end' },
      { kind: 'landmark', x: GAP1.x, y: GAP1.y, label: 'nakki' },
      { kind: 'landmark', x: GAP1.x, y: GAP1.y, label: 'pier gap 1' },
      { kind: 'landmark', x: GAP2.x, y: GAP2.y, label: 'pier gap 2' },
      { kind: 'landmark', x: GAP3.x, y: GAP3.y, label: 'pier gap 3' },
    ],
    npcs: { village: [], wild: [] },
  }
}

function makeMap() {
  const map = createMap(N, N)
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) map[y][x].tile = TILE.FLOOR
  // The pier gaps start as water — WALL and losClear — until the episode
  // opens them (mirrors openmap.js's bake for the `pier gap N` cells).
  for (const g of GAPS) {
    map[g.y][g.x].tile = TILE.WALL
    map[g.y][g.x].skin = 'ow_water_0'
    map[g.y][g.x].losClear = true
  }
  return map
}

function makePlayer(overrides = {}) {
  return { x: BELL.x, y: BELL.y, px: BELL.x * S + 16, py: BELL.y * S + 16,
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

// Mirrors game.js's buildEntities registry-monster default case closely
// enough for these tests: the nakki entity + px/py, pushed straight into
// the live state.
function spawnInto(state) {
  return spawns => {
    for (const s of spawns) {
      if (s.kind !== 'nakki') continue
      state.entities.push({ ...makeNakki(s.x, s.y), px: s.x * S + 16, py: s.y * S + 16 })
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

const nakkiIn = st => st.entities.find(e => e.type === 'nakki')
const cue = (st, name) => st.sfx.cues.some(c => c.name === name)

describe('DELIVERIES', () => {
  it('declares the clapper -> bell delivery that sets bell_hung', () => {
    assert.deepEqual(DELIVERIES, [{ item: 'clapper', to: { poi: 'bell' }, sets: 'bell_hung' }])
  })
})

describe('tick — delivering the clapper', () => {
  it('sets bell_hung, cues bell, and spawns a surfaced Näkki with pierEnd at the nakki POI', () => {
    state.player.inventory.push(makeItem('clapper'))
    tick(ctx, 0)
    assert.equal(ctx.flags.bell_hung, true)
    assert.ok(cue(state, 'bell'), 'bell cue recorded')
    assert.equal(state.player.inventory.length, 0, 'clapper consumed')
    const n = nakkiIn(state)
    assert.ok(n, 'nakki spawned')
    assert.equal(n.state, 'surfaced')
    assert.deepEqual(n.pierEnd, poiCell(mapData, 'pier end'))
    assert.equal(n.x, GAP1.x)
    assert.equal(n.y, GAP1.y)
  })
})

describe('tick — feeding', () => {
  it('three feeds advance fed 1, 2, 3, then clear the Näkki, open the gaps, and resolve once', () => {
    ctx.set('bell_hung')
    onArrive(ctx)
    assert.ok(nakkiIn(state), 'onArrive spawned the nakki')

    for (let i = 1; i <= 3; i++) {
      state.player.inventory.push(makeItem('cooked_meat'))
      state.player.x = BELL.x; state.player.y = BELL.y
      tick(ctx, 0)
      assert.equal(ctx.flags.fed, i, `fed after feed ${i}`)
      assert.ok(cue(state, 'sizzle'), `sizzle cue on feed ${i}`)
      assert.equal(spies.calls.refreshInventory, i)
      assert.equal(spies.calls.persist, i)

      if (i < 3) {
        const n = nakkiIn(state)
        assert.equal(n.state, 'sinking', `nakki starts sinking after feed ${i}`)
        updateNakki(n, state, SINK_TIME + 0.001)
        assert.equal(n.state, 'submerged', `nakki submerges after feed ${i}`)
        updateNakki(n, state, 4.1) // past SUBMERGE_TIME
        assert.equal(n.state, 'rising')
        updateNakki(n, state, SINK_TIME + 0.001) // resurfaces before the next feed
        assert.equal(n.state, 'surfaced')
      }
    }

    assert.equal(ctx.flags.nakki_gone, true)
    const gone = nakkiIn(state)
    assert.ok(gone, 'nakki still present until the sink completes')
    assert.equal(gone.leaving, true)
    assert.equal(gone.state, 'sinking')
    updateNakki(gone, state, SINK_TIME + 0.001)
    assert.equal(nakkiIn(state), undefined, 'nakki removed once the sink completes')
    for (const g of GAPS) {
      const cell = state.map[g.y][g.x]
      assert.equal(cell.tile, TILE.FLOOR)
      assert.equal(cell.skin, 'ow_water_0', 'water skin stays under the planks')
      assert.equal(cell.overlay, 'ow_pier_log', 'planks go on the overlay like the rest of the pier')
      assert.equal('losClear' in cell, false)
    }
    assert.equal(spies.calls.resolve, 1, 'resolve called exactly once')
  })

  it('raw meat never feeds the Näkki', () => {
    ctx.set('bell_hung')
    onArrive(ctx)
    state.player.inventory.push(makeItem('meat'))
    tick(ctx, 0)
    assert.equal(ctx.flags.fed, undefined)
    assert.equal(state.player.inventory.length, 1, 'raw meat not consumed')
    assert.equal(nakkiIn(state).state, 'surfaced')
    assert.equal(spies.calls.resolve, 0)
  })
})

describe('onArrive', () => {
  it('with nakki_gone already set: opens the gaps and spawns nothing', () => {
    ctx.set('nakki_gone')
    onArrive(ctx)
    assert.equal(nakkiIn(state), undefined)
    for (const g of GAPS) {
      const cell = state.map[g.y][g.x]
      assert.equal(cell.tile, TILE.FLOOR)
      assert.equal(cell.skin, 'ow_water_0', 'water skin stays under the planks')
      assert.equal(cell.overlay, 'ow_pier_log', 'planks go on the overlay like the rest of the pier')
      assert.equal('losClear' in cell, false)
    }
  })

  it('with only bell_hung: spawns the Näkki and leaves the gaps closed', () => {
    ctx.set('bell_hung')
    onArrive(ctx)
    const n = nakkiIn(state)
    assert.ok(n)
    assert.equal(n.state, 'surfaced')
    assert.deepEqual(n.pierEnd, poiCell(mapData, 'pier end'))
    for (const g of GAPS) assert.equal(state.map[g.y][g.x].tile, TILE.WALL)
  })

  it('with neither flag set: does nothing', () => {
    onArrive(ctx)
    assert.equal(nakkiIn(state), undefined)
    for (const g of GAPS) assert.equal(state.map[g.y][g.x].tile, TILE.WALL)
  })
})
