import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeNpc, GOALS, buildCtx, selectGoal, updateNpc, FLEE_TIME, STARTLE_TIME } from '../renderer/systems/npc.js'
import { buildNavGrid, findPath } from '../renderer/systems/nav.js'

const S = 32
// 20x14 open field with a solid 3x3 block at (10..12, 5..7)
function field() {
  const map = createMap(20, 14)
  for (let y = 1; y < 13; y++) for (let x = 1; x < 19; x++) map[y][x].tile = TILE.FLOOR
  for (let y = 5; y <= 7; y++) for (let x = 10; x <= 12; x++) map[y][x].tile = TILE.WALL
  return map
}
function makeState(map, playerTile, entities = []) {
  const player = { type: 'player', x: playerTile.x, y: playerTile.y,
    px: playerTile.x * S + S / 2, py: playerTile.y * S + S / 2, maxHp: 10, hp: 10 }
  return { map, player, entities, feedback: null, log: [], sfx: { cues: [], muted: false } }
}
const npcAt = (species, x, y, extra = {}) => makeNpc({ species, id: `npc:test:${x},${y}`, x, y, hostile: false, ...extra })

describe('makeNpc', () => {
  it('shapes an entity from its species', () => {
    const e = npcAt('villager', 3, 4)
    assert.equal(e.type, 'npc')
    assert.equal(e.faction, 'village')
    assert.equal(e.hp, 3); assert.equal(e.maxHp, 3)
    assert.equal(e.px, 3 * S + S / 2); assert.equal(e.py, 4 * S + S / 2)
    assert.deepEqual(e.home, { x: 3, y: 4 })
    assert.equal(e.hostile, false)
    assert.equal(e.objective, null)
    assert.equal(e.id, 'npc:test:3,4')
  })
  it('honours a hostile spawn flag', () => {
    assert.equal(npcAt('villager', 3, 4, { hostile: true }).hostile, true)
  })
  it('returns null for an unknown species', () => {
    assert.equal(makeNpc({ species: 'griffin', id: 'x', x: 1, y: 1 }), null)
  })
})

describe('goal selection', () => {
  it('falls through to wander when nothing else applies', () => {
    const map = field()
    const e = npcAt('villager', 3, 3)
    const ctx = buildCtx(e, makeState(map, { x: 17, y: 11 }, [e]), 1 / 60)
    assert.equal(selectGoal(e, ctx), 'wander')
    assert.equal(e.ai.current, 'wander')
  })
  it('go_to beats wander while an objective is set', () => {
    const map = field()
    const e = npcAt('villager', 3, 3)
    e.objective = { x: 8, y: 3 }
    const ctx = buildCtx(e, makeState(map, { x: 17, y: 11 }, [e]), 1 / 60)
    assert.equal(selectGoal(e, ctx), 'go_to')
  })
  it('enter fires once on a goal switch, not every frame', () => {
    const map = field()
    const e = npcAt('villager', 3, 3)
    const state = makeState(map, { x: 17, y: 11 }, [e])
    let enters = 0
    const orig = GOALS.wander.enter
    GOALS.wander.enter = (...a) => { enters++; return orig(...a) }
    try {
      selectGoal(e, buildCtx(e, state, 1 / 60))
      selectGoal(e, buildCtx(e, state, 1 / 60))
      assert.equal(enters, 1)
    } finally { GOALS.wander.enter = orig }
  })
})

describe('go_to', () => {
  it('emits a patrol intent toward the objective and clears it on arrival', () => {
    const map = field()
    const e = npcAt('villager', 3, 3)
    e.objective = { x: 8, y: 3 }
    const state = makeState(map, { x: 17, y: 11 }, [e])
    const ctx = buildCtx(e, state, 1 / 60)
    selectGoal(e, ctx)
    const intent = GOALS.go_to.run(e, ctx, 1 / 60)
    assert.equal(intent.mode, 'patrol')
    assert.deepEqual(intent.target, { x: 8, y: 3 })
    e.x = 8; e.y = 3; e.px = 8 * S + S / 2; e.py = 3 * S + S / 2
    const done = GOALS.go_to.run(e, buildCtx(e, state, 1 / 60), 1 / 60)
    assert.equal(done.mode, 'hold')
    assert.equal(e.objective, null)
  })
})

describe('wander', () => {
  it('picks points within roam of home that are reachable from it', () => {
    const map = field()
    const nav = buildNavGrid(map)
    const e = npcAt('chicken', 3, 3)          // roam 3
    const state = makeState(map, { x: 17, y: 11 }, [e])
    for (let i = 0; i < 40; i++) {
      e.ai.wanderPt = null; e.ai.dwell = 0
      const ctx = buildCtx(e, state, 1 / 60)
      selectGoal(e, ctx)
      GOALS.wander.run(e, ctx, 5)             // a long dt burns any dwell
      const pt = e.ai.wanderPt
      if (!pt) continue
      assert.ok(Math.abs(pt.x - 3) <= 3 && Math.abs(pt.y - 3) <= 3, `point ${pt.x},${pt.y} outside roam`)
      assert.ok(findPath(nav, 3, 3, pt.x, pt.y, 1), 'unreachable point')
    }
  })
  it('moves the NPC over time', () => {
    const map = field()
    const e = npcAt('deer', 4, 4)
    const state = makeState(map, { x: 17, y: 11 }, [e])
    const start = { px: e.px, py: e.py }
    for (let i = 0; i < 600; i++) updateNpc(e, state, 1 / 60)   // 10 s
    assert.ok(Math.hypot(e.px - start.px, e.py - start.py) > S, 'deer never moved')
  })
})

describe('go_to give-up', () => {
  // A target inside the 3x3 wall block is NOT actually unpathable: findPath
  // snaps a blocked target to the nearest passable tile via nearestPassable
  // and routes there successfully. A target far outside the map has no
  // passable tile within nearestPassable's search radius, so it stays
  // genuinely unreachable (ai.path === null) — that's what exercises give-up.
  it('gives up on a genuinely unreachable objective, leaving the NPC alive and positioned sanely', () => {
    const map = field()
    const e = npcAt('villager', 3, 3)
    const state = makeState(map, { x: 17, y: 11 }, [e])
    e.objective = { x: 100, y: 100 }
    for (let i = 0; i < 240; i++) updateNpc(e, state, 1 / 60)   // ~4 s; give-up fires at 3 s stuck
    assert.equal(e.objective, null)
    assert.ok(e.hp > 0)
    assert.ok(Number.isFinite(e.px) && Number.isFinite(e.py))
  })
  it('does not carry a partial give-up timer into a fresh objective set mid-goal', () => {
    const map = field()
    const e = npcAt('villager', 3, 3)
    const state = makeState(map, { x: 17, y: 11 }, [e])
    e.objective = { x: 100, y: 100 }
    for (let i = 0; i < 174; i++) updateNpc(e, state, 1 / 60)   // ~2.9 s stuck — just under the 3 s threshold
    assert.ok(e.ai.giveUp > 2.5, 'setup: should have accrued most of the give-up timer')
    assert.equal(e.objective.x, 100, 'setup: objective should not have been dropped yet')
    e.objective = { x: 8, y: 3 }                // swap to a fresh, reachable objective — still inside go_to, no goal switch
    updateNpc(e, state, 1 / 60)
    assert.equal(e.ai.giveUp, 0, 'stale give-up time leaked into the new objective')
    for (let i = 0; i < 30; i++) updateNpc(e, state, 1 / 60)   // 0.5 s more
    assert.notEqual(e.objective, null, 'fresh objective was wrongly abandoned')
  })
})
