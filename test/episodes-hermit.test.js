import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { onArrive, tick, lightHearths, hearthFireAt, sammunutSpot, SAMMUNUT_MIN_DIST } from '../renderer/systems/episodes/hermit.js'
import { makeEpCtx, poiCell } from '../renderer/systems/leap.js'
import { normalizeAdventureSave } from '../renderer/systems/adventure.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeCampfire, tickCampfires } from '../renderer/systems/campfire.js'
import { makeSammunut } from '../renderer/systems/monsters/sammunut.js'
import { EPISODES } from '../renderer/data/leaps.js'

const S = 32
const N = 40

const HEARTH = { x: 20, y: 20 }
const HEARTH1 = { x: 5, y: 5 }
const HEARTH2 = { x: 35, y: 5 }
const HEARTH3 = { x: 20, y: 35 }

function makeMapData() {
  return {
    name: 'marsh-3-hermit', leap: true, w: N, h: N,
    pois: [
      { kind: 'landmark', x: HEARTH.x, y: HEARTH.y, label: 'hearth' },
      { kind: 'landmark', x: HEARTH1.x, y: HEARTH1.y, label: 'hearth 1' },
      { kind: 'landmark', x: HEARTH2.x, y: HEARTH2.y, label: 'hearth 2' },
      { kind: 'landmark', x: HEARTH3.x, y: HEARTH3.y, label: 'hearth 3' },
    ],
    npcs: { village: [], wild: [] },
  }
}

function makeMap() {
  const map = createMap(N, N)
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) map[y][x].tile = TILE.FLOOR
  for (const h of [HEARTH1, HEARTH2, HEARTH3]) map[h.y][h.x].overlay = 'prop_hearth_cold'
  return map
}

function makePlayer(overrides = {}) {
  return { x: 5, y: 5, px: 5 * S + 16, py: 5 * S + 16,
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
      if (s.kind !== 'sammunut') continue
      state.entities.push({ ...makeSammunut(s.x, s.y), px: s.x * S + 16, py: s.y * S + 16 })
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
const wraithIn = st => st.entities.find(e => e.type === 'sammunut')
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

describe('EPISODES marsh-3-hermit data', () => {
  it('declares the pre-resolution hermit line and post-resolution resolvedLines', () => {
    const ep = EPISODES['marsh-3-hermit']
    assert.deepEqual(ep.villagerLines.hermit, ['…'])
    assert.deepEqual(ep.resolvedLines, { hermit: ['You came back.', 'The fire held. I was wrong, Lauri.'] })
  })

  it("the hermit's woodpile carries deadwood", () => {
    assert.deepEqual(EPISODES['marsh-3-hermit'].houses['hermit hut'].pickups.find(p => p.type === 'deadwood'), { type: 'deadwood', count: 3 })
  })
})

describe('sammunutSpot', () => {
  it('picks the map far corner when it is walkable and far enough from the player', () => {
    const spot = sammunutSpot(state.map, state.player)
    assert.deepEqual(spot, { x: N - 2, y: N - 2 })
    assert.ok(cheb(spot, state.player) >= SAMMUNUT_MIN_DIST)
  })

  it('skips a blocked far corner and scans to the next cell in the same row', () => {
    state.map[N - 2][N - 2].tile = TILE.WALL
    const spot = sammunutSpot(state.map, state.player)
    assert.deepEqual(spot, { x: N - 3, y: N - 2 })
  })

  it('skips cells closer than the minimum distance to the player', () => {
    state.player.x = 35; state.player.y = 35
    const spot = sammunutSpot(state.map, state.player)
    assert.equal(cheb(spot, state.player) >= SAMMUNUT_MIN_DIST, true)
    // deterministic: same row (y = N-2) as the scan reaches the first x
    // whose distance from the player clears the threshold
    assert.deepEqual(spot, { x: 15, y: N - 2 })
  })

  it('is deterministic across repeated calls', () => {
    const a = sammunutSpot(state.map, state.player)
    const b = sammunutSpot(state.map, state.player)
    assert.deepEqual(a, b)
  })
})

describe('lightHearths', () => {
  it('switches every hearth N prop from cold to lit', () => {
    lightHearths(state.map, mapData)
    for (const h of [HEARTH1, HEARTH2, HEARTH3]) assert.equal(state.map[h.y][h.x].overlay, 'prop_hearth_lit')
  })

  it('skips a hearth POI the map does not declare', () => {
    const data = { ...mapData, pois: mapData.pois.filter(p => p.label !== 'hearth 2') }
    lightHearths(state.map, data)
    assert.equal(state.map[HEARTH1.y][HEARTH1.x].overlay, 'prop_hearth_lit')
    assert.equal(state.map[HEARTH2.y][HEARTH2.x].overlay, 'prop_hearth_cold')
  })
})

describe('hearthFireAt', () => {
  it('finds a campfire within Chebyshev 1 of the hearth cell', () => {
    const fire = makeCampfire(HEARTH.x + 1, HEARTH.y, {})
    state.entities.push(fire)
    assert.equal(hearthFireAt(state.entities, HEARTH), fire)
  })

  it('ignores a campfire two tiles away', () => {
    const fire = makeCampfire(HEARTH.x + 2, HEARTH.y, {})
    state.entities.push(fire)
    assert.equal(hearthFireAt(state.entities, HEARTH), null)
  })

  it('returns null with no hearth cell', () => {
    assert.equal(hearthFireAt(state.entities, null), null)
  })
})

describe('tick — hearth detection', () => {
  it('an adjacent deadwood fire is marked eternal, the flag is set, moved onto the hearth cell, cued and logged', () => {
    const fire = makeCampfire(HEARTH.x + 1, HEARTH.y, { fuel: 'deadwood' })
    state.entities.push(fire)
    tick(ctx, 0)
    assert.equal(ctx.flags.hearth_lit, true)
    assert.equal(fire.eternal, true)
    assert.equal(fire.x, HEARTH.x)
    assert.equal(fire.y, HEARTH.y)
    assert.equal(fire.px, HEARTH.x * S + S / 2)
    assert.equal(fire.py, HEARTH.y * S + S / 2)
    assert.ok(cue(state, 'campfire-light'))
    assert.ok(state.log.includes('His wood. It holds.'))
    assert.equal(spies.calls.persist, 1)
  })

  it('a fire two tiles away does nothing', () => {
    const fire = makeCampfire(HEARTH.x + 2, HEARTH.y, { fuel: 'deadwood' })
    state.entities.push(fire)
    tick(ctx, 0)
    assert.equal(ctx.flags.hearth_lit, undefined)
    assert.equal(fire.eternal, undefined)
    assert.equal(cue(state, 'campfire-light'), false)
    assert.equal(spies.calls.persist, 0)
  })

  it('does nothing once hearth_lit is already set', () => {
    ctx.set('hearth_lit')
    const fire = makeCampfire(HEARTH.x + 1, HEARTH.y, { fuel: 'deadwood' })
    state.entities.push(fire)
    tick(ctx, 0)
    assert.equal(fire.eternal, undefined)
    assert.equal(spies.calls.persist, 0)
  })

  it('a lumber fire on the hearth gutters: no hearth_lit, one thought per fire', () => {
    const fire = makeCampfire(HEARTH.x, HEARTH.y)
    state.entities.push(fire)
    tick(ctx, 0.1); tick(ctx, 0.1)
    assert.equal(ctx.flags.hearth_lit, undefined)
    assert.equal(state.log.filter(l => /gutters/.test(l.text ?? l)).length, 1)
  })

  it('a deadwood fire on the hearth lights it and becomes eternal', () => {
    state.entities.push(makeCampfire(HEARTH.x, HEARTH.y, { fuel: 'deadwood' }))
    tick(ctx, 0.1)
    assert.equal(ctx.flags.hearth_lit, true)
    const fire = hearthFireAt(state.entities, HEARTH)
    assert.equal(fire.eternal, true)
    assert.equal(fire.fuel, 'deadwood')
  })
})

describe('eternal fires', () => {
  it('survive tickCampfires past the normal 60s duration', () => {
    const fire = makeCampfire(HEARTH.x, HEARTH.y, { eternal: true })
    const { entities, expired } = tickCampfires([fire], 61)
    assert.equal(entities.length, 1)
    assert.equal(expired.length, 0)
    assert.equal(entities[0].eternal, true)
  })
})

describe('onArrive — spawning the wraith', () => {
  it('spawns the Sammunut at least SAMMUNUT_MIN_DIST tiles from the player and sets sammunut_spawned', () => {
    onArrive(ctx)
    const w = wraithIn(state)
    assert.ok(w, 'sammunut spawned')
    assert.ok(cheb(w, state.player) >= SAMMUNUT_MIN_DIST)
    assert.equal(ctx.flags.sammunut_spawned, true)
    assert.equal(spies.calls.persist, 1)
  })

  it('only persists sammunut_spawned once across repeated arrivals', () => {
    onArrive(ctx)
    onArrive(ctx)
    assert.equal(spies.calls.persist, 1)
  })

  it('does nothing once wraith_dead is set', () => {
    ctx.set('wraith_dead')
    onArrive(ctx)
    assert.equal(wraithIn(state), undefined)
  })
})

describe('onArrive — hearth re-creation', () => {
  it('re-creates the eternal campfire from hearth_lit and does not duplicate one already there', () => {
    ctx.set('hearth_lit')
    onArrive(ctx)
    const fires = state.entities.filter(e => e.type === 'campfire')
    assert.equal(fires.length, 1)
    assert.equal(fires[0].eternal, true)
    assert.equal(fires[0].x, HEARTH.x)
    assert.equal(fires[0].y, HEARTH.y)

    onArrive(ctx) // a second arrival on the same (unreset) state
    assert.equal(state.entities.filter(e => e.type === 'campfire').length, 1, 'no duplicate fire')
  })

  it('without hearth_lit, no campfire is created', () => {
    onArrive(ctx)
    assert.equal(state.entities.some(e => e.type === 'campfire'), false)
  })

  it('relighting on arrival re-derives a deadwood eternal fire', () => {
    ctx.set('hearth_lit')
    onArrive(ctx)
    const fire = hearthFireAt(state.entities, HEARTH)
    assert.deepEqual([fire.eternal, fire.fuel], [true, 'deadwood'])
  })
})

describe('tick — wraith death', () => {
  beforeEach(() => { onArrive(ctx) }) // spawns the sammunut, sets sammunut_spawned

  it('does nothing while the wraith is alive', () => {
    tick(ctx, 0)
    assert.equal(ctx.flags.wraith_dead, undefined)
    assert.equal(spies.calls.resolve, 0)
  })

  it('a wraith merely absent (not killed) never counts as dead', () => {
    state.entities = state.entities.filter(e => e.type !== 'sammunut')
    tick(ctx, 0)
    assert.equal(ctx.flags.wraith_dead, undefined)
    assert.equal(spies.calls.resolve, 0)
  })

  it('a recorded kill sets wraith_dead, lights all three hearths, and resolves once', () => {
    state.creatureKills = { sammunut: true }
    tick(ctx, 0)
    assert.equal(ctx.flags.wraith_dead, true)
    for (const h of [HEARTH1, HEARTH2, HEARTH3]) assert.equal(state.map[h.y][h.x].overlay, 'prop_hearth_lit')
    assert.equal(spies.calls.resolve, 1)
    assert.equal(spies.calls.persist >= 1, true)

    tick(ctx, 0) // idempotent: no repeat resolve
    assert.equal(spies.calls.resolve, 1)
  })
})

describe('onArrive — resolved', () => {
  it('with wraith_dead: lights the hearths and sets villagerLines.hermit to the resolved lines', () => {
    ctx.set('wraith_dead')
    onArrive(ctx)
    for (const h of [HEARTH1, HEARTH2, HEARTH3]) assert.equal(state.map[h.y][h.x].overlay, 'prop_hearth_lit')
    assert.deepEqual(state.villagerLines, { hermit: ['You came back.', 'The fire held. I was wrong, Lauri.'] })
  })
})
