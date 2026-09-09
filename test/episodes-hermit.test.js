import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  onArrive, tick, lightHearths, hearthFireAt, sammunutSpot, SAMMUNUT_MIN_DIST,
  isNight, ARRIVAL_CLOCK, CHORE_TIMEOUT, DELIVERY_COOLDOWN, WOOD_PER_HEARTH, allBlue, standSpot,
} from '../renderer/systems/episodes/hermit.js'
import { makeEpCtx } from '../renderer/systems/leap.js'
import { normalizeAdventureSave } from '../renderer/systems/adventure.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeCampfire } from '../renderer/systems/campfire.js'
import { makeItem } from '../renderer/systems/inventory.js'
import { makeNpc } from '../renderer/systems/npc.js'
import { makeSammunut } from '../renderer/systems/monsters/sammunut.js'
import { EPISODES } from '../renderer/data/leaps.js'
import { DAY_LENGTH } from '../renderer/data/weather.js'
import { makeFeedback } from '../renderer/systems/feedback.js'

const S = 32
const N = 40

const HEARTH1 = { x: 5, y: 5 }
const HEARTH2 = { x: 35, y: 5 }
const HEARTH3 = { x: 20, y: 35 }
const HEARTHS = [HEARTH1, HEARTH2, HEARTH3]
const NIGHT = 0.80 * DAY_LENGTH
const DAY = 0.50 * DAY_LENGTH

function makeMapData() {
  return {
    name: 'marsh-3-hermit', leap: true, w: N, h: N,
    pois: [
      { kind: 'village', x: 8, y: 8, label: 'village' },
      { kind: 'landmark', x: 8, y: 10, label: 'hearth' },
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
  for (const h of HEARTHS) { map[h.y][h.x].overlay = 'prop_hearth_cold'; map[h.y][h.x].tile = TILE.WALL }
  return map
}

function makePlayer(overrides = {}) {
  return { x: 8, y: 8, px: 8 * S + 16, py: 8 * S + 16,
    hp: 10, invulnTimer: 0, inventory: [], maxInventory: 10, facing: 'south', ...overrides }
}

const villagerAt = (x, y, species = 'villager', id = `npc:v:${x},${y}`) => makeNpc({ species, id, x, y })

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
  state = { player: makePlayer(), map: makeMap(), entities: [], feedback: makeFeedback(), sfx: { cues: [] } }
  ctx = makeEpCtx({
    getState: () => state, save, mapData,
    persist: spies.persist, resolve: spies.resolve, refreshInventory: spies.refreshInventory,
    spawn: spawnInto(state),
  })
})

const cue = (st, name) => st.sfx.cues.some(c => c.name === name)
const wraithIn = st => st.entities.find(e => e.type === 'sammunut')
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
const fires = st => st.entities.filter(e => e.type === 'campfire')
const chores = st => st.entities.filter(e => e.type === 'npc' && e.chore)
const moveTo = (e, c) => { e.x = c.x; e.y = c.y; e.px = c.x * S + 16; e.py = c.y * S + 16 }

describe('EPISODES marsh-3-hermit data', () => {
  it('declares the pre-resolution hermit line and post-resolution resolvedLines', () => {
    const ep = EPISODES['marsh-3-hermit']
    assert.deepEqual(ep.villagerLines.hermit, ['…'])
    assert.deepEqual(ep.resolvedLines.hermit, ['You came back.', 'The fire held. I was wrong, Lauri.'])
    assert.ok(ep.resolvedLines.villager?.length, 'the villagers have something to say once the fires hold')
  })

  it("the hermit's woodpile carries deadwood", () => {
    assert.deepEqual(EPISODES['marsh-3-hermit'].houses['hermit hut'].pickups.find(p => p.type === 'deadwood'), { type: 'deadwood', count: 3 })
  })

  it('resolves on wraith_dead alone', () => {
    const { rule } = EPISODES['marsh-3-hermit']
    assert.equal(!!rule({ wood_1: true, wood_2: true, wood_3: true }), false)
    assert.equal(!!rule({ wraith_dead: true }), true)
  })
})

describe('isNight', () => {
  it('holds from dusk through the night until dawn', () => {
    assert.equal(isNight(0.70 * DAY_LENGTH), true)
    assert.equal(isNight(0.95 * DAY_LENGTH), true)
    assert.equal(isNight(0.05 * DAY_LENGTH), true)
    assert.equal(isNight(0.20 * DAY_LENGTH), false)
    assert.equal(isNight(0.50 * DAY_LENGTH), false)
    assert.equal(isNight(0.69 * DAY_LENGTH), false)
  })
})

describe('sammunutSpot', () => {
  it('returns a walkable interior cell at least SAMMUNUT_MIN_DIST from the player', () => {
    const spot = sammunutSpot(state.map, state.player)
    assert.ok(spot)
    assert.ok(cheb(spot, state.player) >= SAMMUNUT_MIN_DIST)
    assert.equal(state.map[spot.y][spot.x].tile, TILE.FLOOR)
  })
  it('returns null when nothing is far enough away', () => {
    assert.equal(sammunutSpot(state.map, { x: 20, y: 20, px: 0, py: 0 }), null)
    assert.equal(SAMMUNUT_MIN_DIST, 20)
  })
})

describe('standSpot', () => {
  it('is the walkable cell beside the hearth nearest the walker', () => {
    const spot = standSpot(state.map, HEARTH2, { x: 30, y: 5 })
    assert.deepEqual(spot, { x: HEARTH2.x - 1, y: HEARTH2.y })
    assert.equal(state.map[spot.y][spot.x].tile, TILE.FLOOR)
  })
  it('skips cells already tried, and prefers an orthogonal neighbour over a nearer diagonal one', () => {
    const spot = standSpot(state.map, HEARTH2, { x: 30, y: 5 }, [{ x: HEARTH2.x - 1, y: HEARTH2.y }])
    assert.notDeepEqual(spot, { x: HEARTH2.x - 1, y: HEARTH2.y })
    const diag = standSpot(state.map, HEARTH2, { x: HEARTH2.x - 2, y: HEARTH2.y - 2 })
    assert.equal(Math.abs(diag.x - HEARTH2.x) + Math.abs(diag.y - HEARTH2.y), 1, `orthogonal, got ${JSON.stringify(diag)}`)
    const all = new Set()
    let tried = []
    for (let i = 0; i < 8; i++) { const c = standSpot(state.map, HEARTH2, { x: 30, y: 5 }, tried); if (!c) break; all.add(`${c.x},${c.y}`); tried = [...tried, c] }
    assert.equal(all.size, 8)
    assert.equal(standSpot(state.map, HEARTH2, { x: 30, y: 5 }, tried), null)
  })
})

describe('onArrive — the first evening', () => {
  it('winds the clock to late afternoon on the first arrival only', () => {
    onArrive(ctx)
    assert.equal(save.clock, ARRIVAL_CLOCK)
    assert.equal(ctx.flags.arrived, true)
    assert.equal(isNight(ARRIVAL_CLOCK), false)
    assert.ok(0.70 * DAY_LENGTH - ARRIVAL_CLOCK <= 60, 'dusk comes within a minute')
    save.clock = 5
    onArrive(ctx)
    assert.equal(save.clock, 5)
  })
})

describe('onArrive — spawning the wraith', () => {
  it('spawns the Sammunut at least SAMMUNUT_MIN_DIST tiles from the player and sets sammunut_spawned', () => {
    onArrive(ctx)
    const w = wraithIn(state)
    assert.ok(w, 'sammunut spawned')
    assert.ok(cheb(w, state.player) >= SAMMUNUT_MIN_DIST)
    assert.equal(ctx.flags.sammunut_spawned, true)
    assert.ok(spies.calls.persist >= 1)
  })

  it('does nothing once wraith_dead is set', () => {
    ctx.set('wraith_dead')
    onArrive(ctx)
    assert.equal(wraithIn(state), undefined)
  })
})

describe('onArrive — blue hearths re-derived from the wood flags', () => {
  it('a delivered hearth burns blue and eternal on arrival, without duplicates', () => {
    ctx.set('wood_2')
    onArrive(ctx)
    assert.equal(fires(state).length, 1)
    const fire = hearthFireAt(state.entities, HEARTH2)
    assert.deepEqual([fire.eternal, fire.fuel, fire.x, fire.y], [true, 'deadwood', HEARTH2.x, HEARTH2.y])
    onArrive(ctx)
    assert.equal(fires(state).length, 1, 'no duplicate fire')
  })

  it('without wood flags, no campfire is created', () => {
    onArrive(ctx)
    assert.equal(fires(state).length, 0)
  })
})

describe('tick — the villagers light the hearths at dusk', () => {
  let a, b
  beforeEach(() => {
    a = villagerAt(6, 7); b = villagerAt(34, 7, 'elder')
    state.entities.push(a, b)
    save.clock = NIGHT
  })

  it('by day nobody is sent out', () => {
    save.clock = DAY
    tick(ctx, 0.1)
    assert.equal(chores(state).length, 0)
  })

  it('at night each cold hearth gets the nearest free villager sent to stand beside it', () => {
    tick(ctx, 0.1)
    assert.equal(a.chore?.hearth, 1)
    assert.equal(b.chore?.hearth, 2)
    assert.equal(cheb(a.objective, HEARTH1), 1)
    assert.equal(state.map[a.objective.y][a.objective.x].tile, TILE.FLOOR)
  })

  it('the hermit, the returned local and hostile villagers are never sent', () => {
    state.entities = [villagerAt(6, 7, 'hermit'), villagerAt(6, 8, 'villager', 'm'), villagerAt(6, 9)]
    state.entities[1].role = 'missing'
    state.entities[2].hostile = true
    tick(ctx, 0.1)
    assert.equal(chores(state).length, 0)
  })

  it('a villager who reaches the hearth lights an ordinary hearth fire on it', () => {
    tick(ctx, 0.1)
    moveTo(a, a.objective)
    tick(ctx, 0.1)
    const fire = hearthFireAt(state.entities, HEARTH1)
    assert.ok(fire)
    assert.deepEqual([fire.x, fire.y, fire.hearth, 'eternal' in fire, 'fuel' in fire], [HEARTH1.x, HEARTH1.y, true, false, false])
    assert.ok(cue(state, 'campfire-light'))
    assert.equal(a.chore, undefined)
    assert.equal(a.objective, null)
    assert.equal(state.feedback.bubble.anchorId, a.id)
  })

  it('a villager who gave up on one stand spot is sent to another', () => {
    tick(ctx, 0.1)
    const first = a.objective
    a.objective = null   // go_to's give-up: the spot was unpathable
    tick(ctx, 0.1)
    assert.ok(a.objective, 'a new stand spot')
    assert.notDeepEqual(a.objective, first)
    assert.equal(cheb(a.objective, HEARTH1), 1)
    assert.equal(a.chore.hearth, 1)
  })

  it('a villager who never gets there still lights it after CHORE_TIMEOUT', () => {
    tick(ctx, 0.1)
    tick(ctx, CHORE_TIMEOUT)
    assert.ok(hearthFireAt(state.entities, HEARTH1))
    assert.equal(a.chore, undefined)
  })

  it('a hearth snuffed during the night is not relit until the next dusk', () => {
    tick(ctx, 0.1)
    moveTo(a, a.objective)
    tick(ctx, 0.1)
    state.entities = state.entities.filter(e => e.type !== 'campfire')   // the wraith ate it
    tick(ctx, 0.1)
    assert.equal(a.chore?.hearth, 3, 'freed, a takes the hearth nobody reached')
    assert.equal(hearthFireAt(state.entities, HEARTH1), null)
    assert.equal(chores(state).some(e => e.chore.hearth === 1), false)
    save.clock = DAY
    tick(ctx, 0.1)
    assert.equal(chores(state).length, 0, 'dawn drops the unfinished dusk chores')
    assert.equal(a.objective, null)
    save.clock = NIGHT
    tick(ctx, 0.1)
    assert.ok(hearthFireAt(state.entities, HEARTH1), 'a, still standing beside it, lights it again')
  })

  it('a hearth that already has a fire (the player built one) needs no villager', () => {
    state.entities.push(makeCampfire(HEARTH1.x + 1, HEARTH1.y))
    tick(ctx, 0.1)
    assert.equal(chores(state).some(e => e.chore.hearth === 1), false)
  })

  it('dawn puts the ordinary hearth fires out but leaves the blue ones and the player’s own', () => {
    ctx.set('wood_3')
    onArrive(ctx)
    save.clock = NIGHT
    tick(ctx, 0.1)
    moveTo(a, a.objective)
    tick(ctx, 0.1)
    const own = makeCampfire(10, 10)
    state.entities.push(own)
    save.clock = DAY
    tick(ctx, 0.1)
    assert.equal(hearthFireAt(state.entities, HEARTH1), null)
    assert.ok(hearthFireAt(state.entities, HEARTH3)?.eternal)
    assert.ok(state.entities.includes(own))
  })
})

describe('tick — seeing the wraith eat a fire', () => {
  it('a hearth fire vanishing at night near the player sets seen_snuff once, with a thought', () => {
    save.clock = NIGHT
    state.entities.push(makeCampfire(HEARTH1.x, HEARTH1.y, { hearth: true }))
    state.player = makePlayer({ x: 8, y: 5, px: 8 * S + 16, py: 5 * S + 16 })
    tick(ctx, 0.1)
    state.entities = state.entities.filter(e => e.type !== 'campfire')
    tick(ctx, 0.1)
    assert.equal(ctx.flags.seen_snuff, true)
    assert.equal(state.feedback.bubble.kind, 'thought')
    assert.ok(spies.calls.persist >= 1)
  })

  it('a fire vanishing far from the player, or at dawn, is not seen', () => {
    save.clock = NIGHT
    state.entities.push(makeCampfire(HEARTH1.x, HEARTH1.y, { hearth: true }))
    state.player = makePlayer({ x: 35, y: 35, px: 35 * S + 16, py: 35 * S + 16 })
    tick(ctx, 0.1)
    state.entities = state.entities.filter(e => e.type !== 'campfire')
    tick(ctx, 0.1)
    assert.equal(ctx.flags.seen_snuff, undefined)
    state.entities.push(makeCampfire(HEARTH1.x, HEARTH1.y, { hearth: true }))
    state.player = makePlayer({ x: 8, y: 5, px: 8 * S + 16, py: 5 * S + 16 })
    tick(ctx, 0.1)
    save.clock = DAY
    tick(ctx, 0.1)
    assert.equal(ctx.flags.seen_snuff, undefined)
  })
})

describe('tick — handing the villagers the grey wood', () => {
  let v
  beforeEach(() => {
    v = villagerAt(9, 8)
    state.entities.push(v)
    save.clock = DAY
  })

  it('three deadwood beside a villager become a blue chore for the first cold hearth', () => {
    state.player.inventory = [makeItem('deadwood', 3)]
    tick(ctx, 0.1)
    assert.equal(ctx.flags.wood_1, true)
    assert.equal(state.player.inventory.length, 0)
    assert.deepEqual([v.chore.hearth, v.chore.blue], [1, true])
    assert.equal(cheb(v.objective, HEARTH1), 1)
    assert.equal(state.feedback.bubble.anchorId, v.id)
    assert.equal(spies.calls.refreshInventory, 1)
    assert.ok(spies.calls.persist >= 1)
    assert.equal(WOOD_PER_HEARTH, 3)
  })

  it('fewer than three, or lumber, hands nothing over', () => {
    state.player.inventory = [makeItem('deadwood', 2), makeItem('lumber', 3)]
    tick(ctx, 0.1)
    assert.equal(ctx.flags.wood_1, undefined)
    assert.equal(state.player.inventory.length, 2)
  })

  it('one hearth per handover, DELIVERY_COOLDOWN apart', () => {
    state.player.inventory = [makeItem('deadwood', 6)]
    tick(ctx, 0.1)
    tick(ctx, 0.1)
    assert.equal(ctx.flags.wood_2, undefined)
    tick(ctx, DELIVERY_COOLDOWN)
    assert.equal(ctx.flags.wood_2, true)
    assert.equal(state.player.inventory.length, 0)
  })

  it('a villager is not needed beside the player for nothing: standing apart hands nothing over', () => {
    state.player.inventory = [makeItem('deadwood', 3)]
    moveTo(v, { x: 25, y: 25 })
    tick(ctx, 0.1)
    assert.equal(ctx.flags.wood_1, undefined)
  })

  it('the blue chore lights an eternal deadwood fire on the hearth, replacing an ordinary one', () => {
    state.entities.push(makeCampfire(HEARTH1.x, HEARTH1.y, { hearth: true }))
    state.player.inventory = [makeItem('deadwood', 3)]
    tick(ctx, 0.1)
    moveTo(v, v.objective)
    tick(ctx, 0.1)
    assert.equal(fires(state).length, 1)
    const fire = hearthFireAt(state.entities, HEARTH1)
    assert.deepEqual([fire.eternal, fire.fuel, fire.x, fire.y], [true, 'deadwood', HEARTH1.x, HEARTH1.y])
    assert.ok(cue(state, 'grey-fire'))
    assert.equal(v.chore, undefined)
  })

  it('an ordinary chore for a hearth that has since turned blue is dropped', () => {
    save.clock = NIGHT
    const b = villagerAt(6, 7)
    state.entities.push(b)
    tick(ctx, 0.1)
    assert.equal(b.chore?.hearth, 1)
    state.player.inventory = [makeItem('deadwood', 3)]
    tick(ctx, 0.1)   // v (beside the player) takes the wood for hearth 1
    assert.equal(v.chore?.blue, true)
    assert.equal(b.chore, undefined)
    assert.equal(b.objective, null)
  })

  it('a blue chore outranks an ordinary chore the same villager was on', () => {
    save.clock = NIGHT
    tick(ctx, 0.1)
    assert.equal(v.chore.blue, false)
    state.player.inventory = [makeItem('deadwood', 3)]
    tick(ctx, 0.1)
    assert.equal(v.chore.blue, true)
  })

  it('once every hearth is blue nothing more is taken and the wraith is doomed', () => {
    onArrive(ctx)
    for (const n of [1, 2, 3]) ctx.set(`wood_${n}`)
    state.player.inventory = [makeItem('deadwood', 3)]
    tick(ctx, 0.1)
    assert.equal(state.player.inventory.length, 1)
    assert.equal(allBlue(ctx.flags), true)
    assert.equal(wraithIn(state).doomed, true)
  })

  it('the wraith is not doomed while a hearth is still cold', () => {
    onArrive(ctx)
    ctx.set('wood_1'); ctx.set('wood_2')
    tick(ctx, 0.1)
    assert.equal(wraithIn(state).doomed, undefined)
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
    for (const h of HEARTHS) assert.equal(state.map[h.y][h.x].overlay, 'prop_hearth_lit')
    assert.equal(spies.calls.resolve, 1)
    tick(ctx, 0) // idempotent: no repeat resolve
    assert.equal(spies.calls.resolve, 1)
  })
})

describe('onArrive — resolved', () => {
  it('with wraith_dead: lights the hearths, keeps the blue fires and sets the resolved lines', () => {
    ctx.set('wraith_dead'); ctx.set('wood_1'); ctx.set('wood_2'); ctx.set('wood_3')
    onArrive(ctx)
    for (const h of HEARTHS) assert.equal(state.map[h.y][h.x].overlay, 'prop_hearth_lit')
    assert.equal(fires(state).length, 3)
    assert.equal(state.villagerLines, EPISODES['marsh-3-hermit'].resolvedLines)
    lightHearths(state.map, mapData)
  })
})
