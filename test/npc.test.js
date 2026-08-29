import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeNpc, GOALS, buildCtx, selectGoal, updateNpc, onNpcHit, FLEE_TIME, STARTLE_TIME, interactNpc, nearestPeacefulNpc, REACT_TIME, spriteKeyFor, rollNpcDrop } from '../renderer/systems/npc.js'
import { buildNavGrid, findPath, passable } from '../renderer/systems/nav.js'
import { getEnemyWeapon } from '../renderer/systems/enemy-attack.js'
import { makeFeedback } from '../renderer/systems/feedback.js'

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
  it('caches a reach set that stops at the wall block and never leaves the roam box', () => {
    const map = field()
    const nav = buildNavGrid(map)
    const e = npcAt('deer', 11, 3)            // roam 8, three tiles above the block
    const state = makeState(map, { x: 17, y: 11 }, [e])
    selectGoal(e, buildCtx(e, state, 1 / 60))
    GOALS.wander.run(e, buildCtx(e, state, 1 / 60), 5)
    const reach = e.ai.goals.wander.reach
    assert.ok(reach.length > 0, 'no reachable tiles')
    for (const t of reach) {
      assert.ok(Math.max(Math.abs(t.x - 11), Math.abs(t.y - 3)) <= 8, `tile ${t.x},${t.y} outside roam`)
      assert.ok(!(t.x >= 10 && t.x <= 12 && t.y >= 5 && t.y <= 7), `tile ${t.x},${t.y} is solid`)
      assert.ok(passable(nav, t.x, t.y, 1), `tile ${t.x},${t.y} is not passable`)
    }
    assert.ok(reach.some(t => t.x === 11 && t.y === 3), 'home missing from the reach set')
    assert.ok(reach.some(t => t.x === 3 && t.y === 3), 'the open west side should be reachable')
    // computed once and reused while the nav grid stands
    e.ai.wanderPt = null; e.ai.dwell = 0
    GOALS.wander.run(e, buildCtx(e, state, 1 / 60), 5)
    assert.equal(e.ai.goals.wander.reach, reach, 'reach set recomputed')
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

describe('onNpcHit', () => {
  it('a flee species runs and stays peaceful', () => {
    const map = field()
    const e = npcAt('chicken', 3, 3)
    const state = makeState(map, { x: 4, y: 3 }, [e])
    e.hp -= 1
    const r = onNpcHit(e, state)
    assert.equal(e.hostile, false)
    assert.equal(e.ai.fleeTimer, FLEE_TIME)
    assert.deepEqual(r, { hostile: false, wrath: false })
    assert.equal(selectGoal(e, buildCtx(e, state, 1 / 60)), 'flee_hurt')
  })
  it('a fight species turns hostile and the whole village follows', () => {
    const map = field()
    const a = npcAt('villager', 3, 3), b = npcAt('villager', 15, 10), old = npcAt('elder', 5, 5), hen = npcAt('chicken', 8, 8)
    const state = makeState(map, { x: 4, y: 3 }, [a, b, old, hen])
    a.hp -= 1
    const r = onNpcHit(a, state)
    assert.deepEqual(r, { hostile: true, wrath: true })
    assert.equal(a.hostile, true)
    assert.equal(b.hostile, true, 'far villager joins the wrath')
    assert.equal(old.hostile, false, 'elders flee, they do not fight')
    assert.equal(hen.hostile, false, 'wild animals are not villagers')
    assert.equal(state.npcWrath, true)
    assert.equal(onNpcHit(b, state).wrath, false, 'wrath announces once')
  })
  it('hitting a fleeing elder still provokes the village', () => {
    const map = field()
    const old = npcAt('elder', 5, 5), v = npcAt('villager', 3, 3)
    const state = makeState(map, { x: 6, y: 5 }, [old, v])
    old.hp -= 1
    const r = onNpcHit(old, state)
    assert.equal(old.hostile, false)
    assert.equal(old.ai.fleeTimer, FLEE_TIME)
    assert.equal(v.hostile, true)
    assert.equal(r.wrath, true)
  })
  it('hitting a wild animal provokes nobody else', () => {
    const map = field()
    const deer = npcAt('deer', 5, 5), v = npcAt('villager', 3, 3)
    const state = makeState(map, { x: 6, y: 5 }, [deer, v])
    deer.hp -= 1
    onNpcHit(deer, state)
    assert.equal(v.hostile, false)
    assert.equal(state.npcWrath, undefined)
  })
})

describe('startle and hostile goals', () => {
  it('a deer bolts inside its startle radius and not outside', () => {
    const map = field()
    const e = npcAt('deer', 5, 5)          // startle 96 px = 3 tiles
    const near = makeState(map, { x: 7, y: 5 }, [e])
    assert.equal(selectGoal(e, buildCtx(e, near, 1 / 60)), 'startle')
    assert.equal(e.ai.startleTimer, STARTLE_TIME)
    const e2 = npcAt('deer', 5, 5)
    const far = makeState(map, { x: 12, y: 11 }, [e2])
    assert.equal(selectGoal(e2, buildCtx(e2, far, 1 / 60)), 'wander')
  })
  it('a hostile villager approaches the player through the enemy brain', () => {
    const map = field()
    const e = npcAt('villager', 3, 3, { hostile: true })
    const state = makeState(map, { x: 6, y: 3 }, [e])
    const ctx = buildCtx(e, state, 1 / 60)
    assert.equal(selectGoal(e, ctx), 'attack_hostile')
    const intent = GOALS.attack_hostile.run(e, ctx, 1 / 60)
    assert.equal(intent.mode, 'approach')
    assert.equal(e.ai.mode, 'chase')
  })
  it('hostile villagers fight with fists', () => {
    const w = getEnemyWeapon({ type: 'npc', species: 'villager' })
    assert.equal(w.id, 'fists')
    assert.equal(w.damage, 1)
  })
})

describe('interactNpc', () => {
  it('a villager faces the player, lingers and speaks a species line', () => {
    const map = field()
    const e = npcAt('villager', 5, 5)
    const state = makeState(map, { x: 4, y: 5 }, [e]); state.feedback = makeFeedback()
    const r = interactNpc(state, e, () => 0)
    assert.equal(r.kind, 'speech')
    assert.equal(r.text, 'Fine weather for it.')
    assert.equal(e.facing, 'west')
    assert.ok(e.ai.dwell >= 3)
    assert.equal(state.feedback.bubble.anchorId, e.id)
    assert.equal(state.feedback.bubble.text, r.text)
  })
  it('an animal reacts per species and queues its cue', () => {
    const map = field()
    const hen = npcAt('chicken', 5, 5), deer = npcAt('deer', 9, 9)
    const state = makeState(map, { x: 6, y: 5 }, [hen, deer])
    assert.deepEqual(interactNpc(state, hen), { kind: 'react', react: 'hop' })
    assert.equal(hen.ai.reactTimer, REACT_TIME)
    assert.deepEqual(interactNpc(state, deer), { kind: 'react', react: 'bolt' })
    assert.equal(deer.ai.startleTimer, STARTLE_TIME)
    assert.deepEqual(state.sfx.cues.map(c => c.name), ['npc-chicken', 'npc-deer'])
  })
  it('hostile NPCs ignore the button', () => {
    const e = npcAt('villager', 5, 5, { hostile: true })
    assert.equal(interactNpc(makeState(field(), { x: 4, y: 5 }, [e]), e), null)
  })
  it('nearestPeacefulNpc finds the closest peaceful npc within reach', () => {
    const map = field()
    const near = npcAt('chicken', 5, 5), far = npcAt('deer', 9, 9), mad = npcAt('villager', 4, 4, { hostile: true })
    const state = makeState(map, { x: 4, y: 5 }, [far, mad, near])
    assert.equal(nearestPeacefulNpc(state), near)
    assert.equal(nearestPeacefulNpc(makeState(map, { x: 15, y: 12 }, [near])), null)
  })
})

describe('spriteKeyFor', () => {
  it('rotates villager faces by spawn index and uses the species sprite otherwise', () => {
    assert.equal(spriteKeyFor(npcAt('villager', 1, 1, { id: 'npc:m:0' })), 'npc_villager')
    assert.equal(spriteKeyFor(npcAt('villager', 1, 1, { id: 'npc:m:1' })), 'npc_villager_2')
    assert.equal(spriteKeyFor(npcAt('villager', 1, 1, { id: 'npc:m:5' })), 'npc_villager_3')
    assert.equal(spriteKeyFor(npcAt('deer', 1, 1)), 'npc_deer')
  })
})

describe('hostile animals and drops', () => {
  it('a wolf spawns hostile with its species weapon; a boar is peaceful until hit', () => {
    const wolf = npcAt('wolf', 3, 3)
    assert.equal(wolf.hostile, true)
    assert.equal(wolf.weaponId, 'claw')
    assert.equal(npcAt('bear', 3, 3).weaponId, 'maul')
    const boar = npcAt('boar', 3, 3)
    assert.equal(boar.hostile, false)
    boar.hp -= 1
    const r = onNpcHit(boar, makeState(field(), { x: 4, y: 3 }, [boar]))
    assert.deepEqual(r, { hostile: true, wrath: false })
  })
  it('rollNpcDrop yields meat under the species chance and nothing above it', () => {
    const hen = npcAt('chicken', 3, 3)      // drop 0.5
    assert.deepEqual(rollNpcDrop(hen, () => 0.2), { type: 'meat' })
    assert.equal(rollNpcDrop(hen, () => 0.9), null)
    assert.deepEqual(rollNpcDrop(npcAt('bear', 3, 3), () => 0.99), { type: 'meat' })
    assert.equal(rollNpcDrop(npcAt('villager', 3, 3), () => 0), null)
  })
})
