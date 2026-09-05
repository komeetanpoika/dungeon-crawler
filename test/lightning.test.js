import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TILE } from '../renderer/systems/entities.js'
import { registerMonsters, clearMonsters } from '../renderer/systems/monsters.js'
import { makeNakki } from '../renderer/systems/monsters/nakki.js'
import { LIGHTNING, STRIKE_LIFE, castLightning, isWaterCell, connectedWater, tickLightning }
  from '../renderer/systems/spells/lightning.js'

const FAKE_RIG = {
  PARAM_SCHEMA: [{ key: 'size', label: 'Size', group: 'body', type: 'range', min: 0, max: 2, step: 0.1, default: 1 }],
  drawMonster: () => {},
}
// The Näkki is a registry monster whose hook module owns its update
// (behavior.driver 'hook', passive) — the shape isStoryCreature and the
// faction predicates look for. Registered with a fake rig so no canvas is
// needed; the creature itself comes from the real makeNakki.
const registerStoryCreature = name => registerMonsters(
  [{ name, rig: 'fakerig', stats: { hp: 24, dmg: 2, speed: 70, half: 20 },
     behavior: { driver: 'hook', passive: true } }],
  { loadRig: async () => FAKE_RIG, loadHooks: async () => {}, warn: () => {} })

// Build a map from ASCII rows:
//   '#' wall, '.' walkable land, 'w' open water (a wall cell, as buildOpenMap
//   makes it), 'p' pond, '=' the pier: a walkable log over open water.
function grid(rows) {
  return rows.map(r => [...r].map(ch => {
    const cell = { tile: ch === '.' || ch === '=' ? TILE.FLOOR : TILE.WALL, skin: 'ow_grass_0' }
    if (ch === 'w') cell.skin = 'ow_water_0'
    if (ch === 'p') cell.skin = 'ow_pond_2'
    if (ch === '=') { cell.skin = 'ow_water_1'; cell.overlay = 'ow_pier_log' }
    return cell
  }))
}
const row = (n, ch = '.') => ch.repeat(n)

// A player on a tile, facing east unless told otherwise.
const player = (x, y, facing = 'east') =>
  ({ type: 'player', x, y, px: x * 32 + 16, py: y * 32 + 16, facing, hp: 10 })

const enemy = (x, y, extra = {}) =>
  ({ type: 'monster', x, y, px: x * 32 + 16, py: y * 32 + 16, hp: 9, ...extra })

// The one hook game.js injects, recording its calls.
function recorder() {
  const calls = []
  return { calls, hurt: (e, dmg, opts) => { calls.push({ e, dmg, opts }); e.hp -= dmg } }
}

const markKeys = state => (state.lightning ?? []).map(m => `${m.x},${m.y}`)

describe('LIGHTNING constants', () => {
  it('holds the spec numbers', () => {
    assert.deepEqual(LIGHTNING, {
      delay: 0.6, damage: 5, stun: 1.0, flash: 0.12, lit: 0.25, waterCap: 400,
      dists: { tap: [3], full: [6], over: [4, 6, 8] },
    })
    assert.equal(STRIKE_LIFE, 0.15)
  })
})

describe('castLightning', () => {
  const openState = (facing = 'east') => ({
    map: grid([row(12), row(12), row(12), row(12), row(12)]),
    player: player(1, 2, facing),
    entities: [],
  })

  it('marks the tap distance ahead, creating state.lightning', () => {
    const state = openState()
    const { marks } = castLightning(state, 'tap')
    assert.equal(marks.length, 1)
    assert.deepEqual(marks[0], { x: 4, y: 2, t: 0, delay: LIGHTNING.delay, struck: false })
    assert.deepEqual(state.lightning, marks)
  })

  it('marks the full distance and appends to marks already in flight', () => {
    const state = openState()
    state.lightning = [{ x: 0, y: 0, t: 0.2, delay: LIGHTNING.delay, struck: false }]
    const { marks } = castLightning(state, 'full')
    assert.deepEqual(marks.map(m => m.x), [7])
    assert.equal(state.lightning.length, 2)
    assert.equal(state.lightning[0].t, 0.2, 'the older mark keeps its timer')
  })

  it('drops the over tier as three marks on one line, all with the same delay', () => {
    const state = openState()
    const { marks } = castLightning(state, 'over')
    assert.deepEqual(marks.map(m => m.x), [5, 7, 9])
    for (const m of marks) { assert.equal(m.y, 2); assert.equal(m.delay, LIGHTNING.delay) }
  })

  it('walks the facing: north, south and west', () => {
    for (const [facing, want] of [['north', { x: 4, y: 1 }], ['south', { x: 4, y: 7 }], ['west', { x: 1, y: 4 }]]) {
      const state = {
        map: grid(Array.from({ length: 9 }, () => row(9))),
        player: player(4, 4, facing), entities: [],
      }
      const { marks } = castLightning(state, 'tap')
      assert.deepEqual({ x: marks[0].x, y: marks[0].y }, want, facing)
    }
  })

  it('clamps to the last walkable cell before a wall', () => {
    const state = {
      map: grid([row(12), '..##########', row(12)]),
      player: player(0, 1), entities: [],
    }
    const { marks } = castLightning(state, 'tap')
    assert.deepEqual(markKeys(state), ['1,1'])
    assert.equal(marks[0].x, 1)
  })

  it('collapses the over tier to one mark when every distance clamps to the same cell', () => {
    const state = {
      map: grid([row(12), '...#########', row(12)]),
      player: player(0, 1), entities: [],
    }
    castLightning(state, 'over')
    assert.deepEqual(markKeys(state), ['2,1'], 'three clamped marks are one strike, not triple damage')
  })

  it('marks nothing when the caster is walled in', () => {
    const state = { map: grid(['####', '#.##', '####']), player: player(1, 1), entities: [] }
    const { marks } = castLightning(state, 'tap')
    assert.deepEqual(marks, [])
    assert.deepEqual(state.lightning, [])
  })

  it('marks the pier, which is walkable water', () => {
    const state = { map: grid(['............', '.===========', '............']), player: player(0, 1), entities: [] }
    castLightning(state, 'tap')
    assert.deepEqual(markKeys(state), ['3,1'])
  })
})

describe('isWaterCell', () => {
  it('is true for open water and ponds, false for land and nothing', () => {
    assert.equal(isWaterCell({ skin: 'ow_water_0' }), true)
    assert.equal(isWaterCell({ skin: 'ow_pond_2' }), true)
    assert.equal(isWaterCell({ skin: 'ow_grass_0' }), false)
    assert.equal(isWaterCell({}), false)
    assert.equal(isWaterCell(null), false)
    assert.equal(isWaterCell(undefined), false)
  })

  it('is true for a pier log, which lies over water', () => {
    assert.equal(isWaterCell({ skin: 'ow_water_1', overlay: 'ow_pier_log' }), true)
    assert.equal(isWaterCell({ skin: 'ow_grass_0', overlay: 'ow_pier_log' }), false, 'a log on land conducts nothing')
  })
})

describe('connectedWater', () => {
  const lake = grid([
    'wwww.wwww',
    'wwww.wwww',
    'wwww.wwww',
  ])

  it('floods the water reachable from the start, stopping at land', () => {
    const set = connectedWater(lake, 0, 0, LIGHTNING.waterCap)
    assert.equal(set.size, 12)
    assert.ok(set.has('0,0') && set.has('3,2'))
    assert.equal(set.has('4,1'), false, 'the land spit is not water')
    assert.equal(set.has('5,0'), false, 'the far pool is a separate body')
  })

  it('is empty when the start is not water', () => {
    assert.equal(connectedWater(lake, 4, 0, LIGHTNING.waterCap).size, 0)
    assert.equal(connectedWater(lake, 99, 99, LIGHTNING.waterCap).size, 0)
  })

  it('joins ponds and pier logs into the same body', () => {
    const map = grid(['wp=w'])
    assert.equal(connectedWater(map, 0, 0, LIGHTNING.waterCap).size, 4)
  })

  it('stops at the cap', () => {
    const map = grid(Array.from({ length: 5 }, () => 'wwwwwwwwww'))
    assert.equal(connectedWater(map, 0, 0, 7).size, 7)
  })
})

describe('tickLightning', () => {
  // A pond (rows 0-2, columns 4-8) with land around it and a pier reaching in.
  const pondMap = () => grid([
    '..........',
    '....wwwww.',
    '..==wwwww.',
    '....wwwww.',
    '..........',
  ])
  const mark = (x, y) => ({ x, y, t: 0, delay: LIGHTNING.delay, struck: false })

  it('does nothing before the delay and strikes once at it', () => {
    const e = enemy(4, 4)
    const state = { map: pondMap(), entities: [e], lightning: [mark(4, 4)] }
    const hooks = recorder()
    assert.deepEqual(tickLightning(state, 0.5, hooks), { struck: 0 })
    assert.equal(hooks.calls.length, 0)
    assert.equal(state.lightning.length, 1)

    assert.deepEqual(tickLightning(state, 0.2, hooks), { struck: 1 })
    assert.equal(hooks.calls.length, 1)
    assert.deepEqual(state.lightning, [], 'a struck mark is spent')
    assert.deepEqual(tickLightning(state, 1, hooks), { struck: 0 })
    assert.equal(hooks.calls.length, 1, 'it never strikes twice')
  })

  it('hurts and stuns the 3×3 around the mark, and nothing outside it', () => {
    const near = enemy(3, 3), corner = enemy(5, 5), far = enemy(6, 4)
    const state = { map: pondMap(), entities: [near, corner, far], lightning: [mark(4, 4)] }
    const hooks = recorder()
    assert.deepEqual(tickLightning(state, LIGHTNING.delay, hooks), { struck: 2 })
    assert.deepEqual(hooks.calls.map(c => c.e), [near, corner])
    for (const c of hooks.calls) assert.deepEqual([c.dmg, c.opts], [LIGHTNING.damage, { source: 'lightning' }])
    assert.equal(near.stunTimer, LIGHTNING.stun)
    assert.equal(corner.stunTimer, LIGHTNING.stun)
    assert.equal(far.stunTimer, undefined)
    assert.equal(far.hp, 9)
  })

  it('leaves the player, the Echo and villagers alone', () => {
    const p = player(4, 4), echo = { type: 'echo', px: 4 * 32, py: 4 * 32, hp: 1 }
    const villager = enemy(3, 4, { type: 'npc' })
    const state = { map: pondMap(), player: p, entities: [p, echo, villager], lightning: [mark(4, 4)] }
    const hooks = recorder()
    assert.deepEqual(tickLightning(state, LIGHTNING.delay, hooks), { struck: 0 })
    assert.equal(hooks.calls.length, 0)
  })

  it('skips something already dying — its death pose is playing out', () => {
    const dead = enemy(4, 4, { hp: 0, dying: 0.5 })
    const state = { map: pondMap(), entities: [dead], lightning: [mark(4, 4)] }
    assert.deepEqual(tickLightning(state, LIGHTNING.delay, recorder()), { struck: 0 })
  })

  it('conducts through the connected water from a pier strike', () => {
    const swimmer = enemy(8, 1)                    // far side of the pond
    const bystander = enemy(0, 0)                  // on land, no path through water
    const state = { map: pondMap(), entities: [swimmer, bystander], lightning: [mark(2, 2)] }
    const hooks = recorder()
    assert.deepEqual(tickLightning(state, LIGHTNING.delay, hooks), { struck: 1 })
    assert.deepEqual(hooks.calls.map(c => c.e), [swimmer])
    assert.equal(swimmer.hp, 4)
  })

  it('does not conduct from a strike on dry land', () => {
    const swimmer = enemy(8, 1)
    const state = { map: pondMap(), entities: [swimmer], lightning: [mark(0, 4)] }
    assert.deepEqual(tickLightning(state, LIGHTNING.delay, recorder()), { struck: 0 })
  })

  it('hits a target standing in both the 3×3 and the water only once', () => {
    const e = enemy(4, 2)
    const state = { map: pondMap(), entities: [e], lightning: [mark(3, 2)] }
    const hooks = recorder()
    assert.deepEqual(tickLightning(state, LIGHTNING.delay, hooks), { struck: 1 })
    assert.equal(hooks.calls.length, 1)
  })

  // The real Näkki, not a stand-in: ensureNakki deletes hp/maxHp, so any
  // target predicate that asks for a positive hp would make the one creature
  // the spec's conduction clause exists to reach permanently unstrikeable.
  it('conducts into the real Näkki, which carries no hp at all', async () => {
    await registerStoryCreature('nakki')
    try {
      const nakki = makeNakki(8, 1)
      assert.equal('hp' in nakki, false, 'guarding the premise of this test')
      const state = { map: pondMap(), entities: [nakki], lightning: [mark(2, 2)] }
      const hooks = recorder()
      assert.deepEqual(tickLightning(state, LIGHTNING.delay, hooks), { struck: 1 })
      assert.deepEqual(hooks.calls[0].opts, { source: 'lightning' })
      assert.equal(hooks.calls[0].e, nakki)
      assert.equal(nakki.stunTimer, undefined, 'the Näkki keeps driving its own state machine')
    } finally { clearMonsters() }
  })

  it('spares a story creature the plain 3×3 on dry land', async () => {
    await registerStoryCreature('nakki')
    try {
      const nakki = makeNakki(0, 4)
      const state = { map: pondMap(), entities: [nakki], lightning: [mark(1, 4)] }
      assert.deepEqual(tickLightning(state, LIGHTNING.delay, recorder()), { struck: 0 })
    } finally { clearMonsters() }
  })

  it('strikes a hostile villager but spares a peaceful one', () => {
    const angry = enemy(3, 4, { type: 'npc', hostile: true })
    const calm = enemy(5, 4, { type: 'npc' })
    const state = { map: pondMap(), entities: [angry, calm], lightning: [mark(4, 4)] }
    const hooks = recorder()
    assert.deepEqual(tickLightning(state, LIGHTNING.delay, hooks), { struck: 1 })
    assert.deepEqual(hooks.calls.map(c => c.e), [angry])
    assert.equal(calm.hp, 9)
  })

  it('shrugs the stun off a boss but still hurts it', () => {
    const boss = enemy(4, 4, { isBoss: true })
    const state = { map: pondMap(), entities: [boss], lightning: [mark(4, 4)] }
    const hooks = recorder()
    tickLightning(state, LIGHTNING.delay, hooks)
    assert.equal(hooks.calls.length, 1)
    assert.equal(boss.stunTimer, undefined)
  })

  it('flashes the screen and lights the weather layer', () => {
    const state = { map: pondMap(), entities: [], lightning: [mark(4, 4)], weather: { dayCycle: true, t: 3, lightningT: 0 } }
    tickLightning(state, LIGHTNING.delay, recorder())
    assert.equal(state.flash, LIGHTNING.flash)
    assert.equal(state.weather.lightningT, LIGHTNING.lit)
  })

  it('strikes fine on a map with no weather', () => {
    const state = { map: pondMap(), entities: [], lightning: [mark(4, 4)] }
    assert.doesNotThrow(() => tickLightning(state, LIGHTNING.delay, recorder()))
    assert.equal(state.flash, LIGHTNING.flash)
    assert.equal(state.weather, undefined)
  })

  it('counts the lightning light down and never past zero', () => {
    const state = { map: pondMap(), entities: [], weather: { lightningT: LIGHTNING.lit } }
    tickLightning(state, 0.1, {})
    assert.ok(Math.abs(state.weather.lightningT - 0.15) < 1e-9)
    tickLightning(state, 5, {})
    assert.equal(state.weather.lightningT, 0)
  })

  it('records a strike for the renderer and drops it after STRIKE_LIFE', () => {
    const state = { map: pondMap(), entities: [], lightning: [mark(4, 4)] }
    tickLightning(state, LIGHTNING.delay, recorder())
    assert.deepEqual(state.strikes, [{ x: 4, y: 4, t: 0 }], 'the frame it is born it draws at t 0')
    tickLightning(state, 0.1, recorder())
    assert.equal(state.strikes.length, 1)
    assert.ok(Math.abs(state.strikes[0].t - 0.1) < 1e-9)
    tickLightning(state, 0.06, recorder())
    assert.deepEqual(state.strikes, [])
  })

  it('keeps counting the strike light down after the last mark is spent', () => {
    const state = { map: pondMap(), entities: [], lightning: [mark(4, 4)], weather: { lightningT: 0 } }
    tickLightning(state, LIGHTNING.delay, recorder())
    assert.deepEqual(state.lightning, [], 'nothing left in flight')
    assert.equal(state.weather.lightningT, LIGHTNING.lit)
    // game.js calls this every frame, marks or not — the light is its job too.
    tickLightning(state, 0.2, {})
    tickLightning(state, 0.2, {})
    assert.equal(state.weather.lightningT, 0)
  })

  it('is a no-op with nothing marked and no hooks', () => {
    const state = { map: pondMap(), entities: [] }
    assert.deepEqual(tickLightning(state, 0.1), { struck: 0 })
    assert.equal(state.flash, undefined)
  })

  it('cast then ticked strikes where the mark landed', () => {
    const state = { map: pondMap(), player: player(0, 4), entities: [enemy(3, 4)] }
    castLightning(state, 'tap')
    const hooks = recorder()
    assert.deepEqual(tickLightning(state, LIGHTNING.delay, hooks), { struck: 1 })
    assert.equal(hooks.calls[0].e.hp, 4)
  })
})
