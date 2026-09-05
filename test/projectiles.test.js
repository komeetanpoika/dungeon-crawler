import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TILE } from '../renderer/systems/entities.js'
import { stepProjectiles, makeForks, retargetChain } from '../renderer/systems/projectiles.js'

const TILE_SIZE = 32

// A big open floor, optionally with a single wall cell.
function makeMap(w, h, wallAt = null) {
  const rows = []
  for (let y = 0; y < h; y++) {
    const row = []
    for (let x = 0; x < w; x++) {
      row.push({ tile: (wallAt && wallAt.x === x && wallAt.y === y) ? TILE.WALL : TILE.FLOOR })
    }
    rows.push(row)
  }
  return rows
}

// Default hooks: hp-based hittability, damage-by-subtraction hurt, and
// spies for detonate/damagePlayer so tests can assert on call args.
function makeHooks(overrides = {}) {
  const hitLog = []
  const detonations = []
  const playerDamage = []
  const hooks = {
    isHittable: e => e.hp === undefined || e.hp > 0,
    hurt: (e, damage, p) => { hitLog.push(e); return { ...e, hp: e.hp - damage } },
    detonate: (px, py, blastTiles) => detonations.push({ px, py, blastTiles }),
    damagePlayer: damage => playerDamage.push(damage),
    ...overrides,
  }
  return { hooks, hitLog, detonations, playerDamage }
}

function baseState(entities, projectiles, extra = {}) {
  return {
    map: makeMap(50, 10),
    player: { px: 0, py: 0 },
    entities,
    projectiles,
    ...extra,
  }
}

describe('stepProjectiles — pierce and hitIds', () => {
  it('pierce budget hits two enemies in a line and stops at the third', () => {
    const entities = [
      { id: 'a', type: 'monster', px: 50, py: 0, hp: 10 },
      { id: 'b', type: 'monster', px: 100, py: 0, hp: 10 },
      { id: 'c', type: 'monster', px: 150, py: 0, hp: 10 },
    ]
    const p = { px: 0, py: 0, dx: 200, dy: 0, damage: 5, friendly: true, pierce: 1 }
    const { hooks, hitLog } = makeHooks()
    const state = baseState(entities, [p])

    let total = 0
    for (let i = 0; i < 40 && state.projectiles.length; i++) total += stepProjectiles(state, 0.02, hooks).hits

    assert.equal(total, 2)
    assert.deepEqual(hitLog.map(e => e.id), ['a', 'b'])
    assert.equal(state.entities.find(e => e.id === 'a').hp, 5)
    assert.equal(state.entities.find(e => e.id === 'b').hp, 5)
    assert.equal(state.entities.find(e => e.id === 'c').hp, 10) // never reached
    assert.equal(state.projectiles.length, 0) // spent after the second hit
  })

  it('hitIds stops a lingering projectile from hitting the same enemy twice', () => {
    const entities = [{ id: 'a', type: 'monster', px: 5, py: 0, hp: 10 }]
    // Very slow projectile: stays within HIT_RADIUS (8px) of the enemy for
    // more than one frame, so without hitIds it would double-hit.
    const p = { px: 0, py: 0, dx: 1, dy: 0, damage: 3, friendly: true, pierce: 5 }
    const { hooks, hitLog } = makeHooks()
    const state = baseState(entities, [p])

    stepProjectiles(state, 1, hooks) // px=1, dist=4 -> hit
    stepProjectiles(state, 1, hooks) // px=2, dist=3 -> still in radius, must not re-hit

    assert.equal(hitLog.length, 1)
    assert.equal(state.entities[0].hp, 7)
  })
})

describe('makeForks', () => {
  it('spawns three copies after the fork distance, middle on the original heading', () => {
    const p = { px: 0, py: 0, dx: 100, dy: 0, distTraveled: 40,
      fork: { after: 32, count: 3, spread: 15 }, hitIds: new Set(['x']) }
    const forks = makeForks(p)

    assert.equal(forks.length, 3)
    const mid = forks[1]
    assert.equal(mid.dx, 100)
    assert.equal(mid.dy, 0)
    assert.equal(mid.fork, undefined)
    assert.equal(mid.forked, true)
    assert.equal(mid.distTraveled, 0)
    assert.deepEqual([...mid.hitIds], ['x'])
    assert.notEqual(mid.hitIds, p.hitIds) // independent copy going forward

    const angleOf = f => Math.atan2(f.dy, f.dx) * 180 / Math.PI
    assert.ok(Math.abs(angleOf(forks[0]) - (-15)) < 1e-6)
    assert.ok(Math.abs(angleOf(forks[2]) - 15) < 1e-6)
    // Speed is preserved by the fan.
    for (const f of forks) assert.ok(Math.abs(Math.hypot(f.dx, f.dy) - 100) < 1e-6)
  })

  it('integrates with stepProjectiles: one projectile becomes three after 32px', () => {
    const p = { px: 0, py: 0, dx: 320, dy: 0, damage: 1, friendly: true,
      fork: { after: 32, count: 3, spread: 20 } }
    const { hooks } = makeHooks()
    const state = baseState([], [p])

    stepProjectiles(state, 0.1, hooks) // moves 32px exactly -> forks this frame
    assert.equal(state.projectiles.length, 3)
    assert.ok(state.projectiles.some(f => f.dx === 320 && f.dy === 0))
    assert.ok(state.projectiles.every(f => f.fork === undefined && f.forked === true))
  })
})

describe('retargetChain', () => {
  it('picks the nearest unhit candidate within range and points the projectile at it', () => {
    const p = { px: 0, py: 0, dx: 100, dy: 0, chain: { range: 50, left: 2 }, hitIds: new Set(['hitme']) }
    const entities = [
      { id: 'hitme', px: 10, py: 0 },   // already hit -> excluded
      { id: 'far', px: 200, py: 0 },    // out of range
      { id: 'near', px: 20, py: 10 },   // nearest valid candidate
    ]
    const target = retargetChain(p, entities)

    assert.equal(target.id, 'near')
    const len = Math.hypot(20, 10)
    assert.ok(Math.abs(p.dx - 100 * 20 / len) < 1e-6)
    assert.ok(Math.abs(p.dy - 100 * 10 / len) < 1e-6)
  })

  it('returns null (chain ends) when nothing qualifies', () => {
    const p = { px: 0, py: 0, dx: 100, dy: 0, chain: { range: 5, left: 1 }, hitIds: new Set() }
    const entities = [{ id: 'far', px: 200, py: 0 }]
    assert.equal(retargetChain(p, entities), null)
    assert.equal(p.dx, 100) // heading untouched
  })

  it('integrates with stepProjectiles: chains to a second enemy, then ends', () => {
    const entities = [
      { id: 'a', type: 'monster', px: 8, py: 0, hp: 10 },
      { id: 'b', type: 'monster', px: 8, py: 30, hp: 10 }, // within chain range of 'a'
    ]
    const p = { px: 0, py: 0, dx: 400, dy: 0, damage: 4, friendly: true, chain: { left: 1, range: 40 } }
    const { hooks, hitLog } = makeHooks()
    const state = baseState(entities, [p])

    for (let i = 0; i < 50 && state.projectiles.length; i++) stepProjectiles(state, 0.02, hooks)

    assert.deepEqual(hitLog.map(e => e.id).sort(), ['a', 'b'])
    assert.equal(state.projectiles.length, 0) // no third target -> chain ends
  })
})

describe('onHit', () => {
  it('sling stun sets stunTimer', () => {
    const entities = [{ id: 'a', type: 'monster', px: 5, py: 0, hp: 10 }]
    const p = { px: 0, py: 0, dx: 100, dy: 0, damage: 1, friendly: true, onHit: { stun: 1.5 } }
    const { hooks } = makeHooks()
    const state = baseState(entities, [p])

    stepProjectiles(state, 0.1, hooks)
    assert.equal(state.entities[0].stunTimer, 1.5)
  })

  it('crossbow knockback pushes the target via startKnockback', () => {
    const entities = [{ id: 'a', type: 'monster', px: 5, py: 0, hp: 10 }]
    const p = { px: 0, py: 0, dx: 100, dy: 0, damage: 1, friendly: true, onHit: { knockback: 30 } }
    const { hooks } = makeHooks()
    const state = baseState(entities, [p])

    stepProjectiles(state, 0.1, hooks)
    const hit = state.entities[0]
    assert.ok(hit.knockback)
    assert.ok(hit.knockback.vx > 0) // pushed along the projectile's own travel direction
  })
})

describe('shield and boss immunity', () => {
  it('a shielded wizard absorbs the hit unless piercesShield is set', () => {
    const entities = [{ id: 'w', type: 'wizard', px: 5, py: 0, hp: 10, shieldTimer: 3 }]
    const p = { px: 0, py: 0, dx: 100, dy: 0, damage: 5, friendly: true }
    const { hooks, hitLog } = makeHooks()
    const state = baseState(entities, [p])

    stepProjectiles(state, 0.1, hooks)
    assert.equal(hitLog.length, 0)
    assert.equal(state.entities[0].hp, 10)     // absorbed, no damage
    assert.equal(state.projectiles.length, 0)  // still consumed by the shield
  })

  it('piercesShield bypasses the wizard shield', () => {
    const entities = [{ id: 'w', type: 'wizard', px: 5, py: 0, hp: 10, shieldTimer: 3 }]
    const p = { px: 0, py: 0, dx: 100, dy: 0, damage: 5, friendly: true, piercesShield: true }
    const { hooks, hitLog } = makeHooks()
    const state = baseState(entities, [p])

    stepProjectiles(state, 0.1, hooks)
    assert.equal(hitLog.length, 1)
    assert.equal(state.entities[0].hp, 5)
  })

  it('dragon_boss is immune to all friendly projectiles', () => {
    const entities = [{ id: 'boss', type: 'dragon_boss', px: 5, py: 0, hp: 999 }]
    const p = { px: 0, py: 0, dx: 100, dy: 0, damage: 5, friendly: true }
    const { hooks, hitLog } = makeHooks()
    const state = baseState(entities, [p])

    stepProjectiles(state, 0.1, hooks) // flies right through the boss's hitbox
    assert.equal(hitLog.length, 0)
    assert.equal(state.entities[0].hp, 999)
    assert.equal(state.projectiles.length, 1) // not consumed — passes over
  })
})

describe('fireball direct-impact detonation', () => {
  it('detonates exactly once on a direct enemy hit', () => {
    const entities = [{ id: 'a', type: 'monster', px: 5, py: 0, hp: 10 }]
    const p = { px: 0, py: 0, dx: 100, dy: 0, damage: 5, friendly: true, explodes: true, blastTiles: 16 }
    const { hooks, detonations } = makeHooks()
    const state = baseState(entities, [p])

    stepProjectiles(state, 0.1, hooks) // px -> 10, dist to enemy(5,0) = 5 < 8: hit
    assert.equal(detonations.length, 1)
    assert.deepEqual(detonations[0], { px: 10, py: 0, blastTiles: 16 })
  })

  it('a shielded wizard absorbs the hit but the fireball still detonates once', () => {
    const entities = [{ id: 'w', type: 'wizard', px: 5, py: 0, hp: 10, shieldTimer: 3 }]
    const p = { px: 0, py: 0, dx: 100, dy: 0, damage: 5, friendly: true, explodes: true, blastTiles: 16 }
    const { hooks, detonations, hitLog } = makeHooks()
    const state = baseState(entities, [p])

    stepProjectiles(state, 0.1, hooks)
    assert.equal(hitLog.length, 0)            // no damage — the shield absorbed it
    assert.equal(state.entities[0].hp, 10)
    assert.equal(detonations.length, 1)       // but the direct-impact blast still fires
    assert.deepEqual(detonations[0], { px: 10, py: 0, blastTiles: 16 })
  })

  it('an exploding, piercing projectile detonates once on impact and once at maxDist — never twice for either event', () => {
    const entities = [{ id: 'a', type: 'monster', px: 30, py: 0, hp: 10 }]
    const p = { px: 0, py: 0, dx: 100, dy: 0, damage: 5, friendly: true,
      explodes: true, blastTiles: 16, pierce: 1, maxDist: 80 }
    const { hooks, detonations, hitLog } = makeHooks()
    const state = baseState(entities, [p])

    for (let i = 0; i < 30 && state.projectiles.length; i++) stepProjectiles(state, 0.05, hooks)

    assert.equal(hitLog.length, 1)                     // pierced through the one enemy
    assert.equal(state.entities[0].hp, 5)
    assert.equal(detonations.length, 2)                // one impact blast, one end-of-range blast — not 1, not 3+
    assert.ok(detonations[0].px < detonations[1].px)    // impact happened before the projectile ran out of range
  })
})

describe('corpse culling (hooks.cull)', () => {
  it('culls a killed entity before a second same-frame projectile can target its corpse', () => {
    const entities = [{ id: 'a', type: 'monster', px: 5, py: 0, hp: 3 }]
    const first = { px: 0, py: 0, dx: 100, dy: 0, damage: 5, friendly: true }
    const second = { px: 0, py: 0, dx: 100, dy: 0, damage: 5, friendly: true }
    const cull = entities => entities.filter(e => e.hp === undefined || e.hp > 0)
    const { hooks, hitLog } = makeHooks({ cull })
    const state = baseState(entities, [first, second])

    const { hits } = stepProjectiles(state, 0.1, hooks) // both reach px=10 this frame
    assert.equal(hits, 1)
    assert.equal(hitLog.length, 1)             // second found no target — the corpse was already culled
    assert.equal(state.entities.length, 0)
    assert.equal(state.projectiles.length, 1)  // second survives (no hit, non-piercing default has nothing to consume it)
  })

  it('defaults to identity when no cull hook is supplied — corpses linger (hp<=0 stays isHittable via dying)', () => {
    const entities = [{ id: 'a', type: 'monster', px: 5, py: 0, hp: 3 }]
    const p = { px: 0, py: 0, dx: 100, dy: 0, damage: 5, friendly: true }
    const { hooks } = makeHooks() // no cull override — default identity
    const state = baseState(entities, [p])

    stepProjectiles(state, 0.1, hooks)
    assert.equal(state.entities.length, 1) // still present, just at negative hp
    assert.equal(state.entities[0].hp, -2)
  })
})

describe('enemy projectiles vs the player', () => {
  it('an enemy bolt damages the player at radius 10 and is consumed', () => {
    const p = { px: 0, py: 0, dx: 100, dy: 0, damage: 4, friendly: false }
    const { hooks, playerDamage } = makeHooks()
    const state = baseState([], [p], { player: { px: 5, py: 0 } })

    const { hits } = stepProjectiles(state, 0.01, hooks) // px -> 1, dist to player(5,0) = 4 < 10
    assert.equal(hits, 1)
    assert.deepEqual(playerDamage, [4])
    assert.equal(state.projectiles.length, 0)
  })
})

describe('wall stop and maxDist', () => {
  it('stops at a wall and detonates at the last walkable position', () => {
    // Wall at tile (2,0) -> x in [64,96). Projectile starts at x=50 moving right.
    const map = makeMap(50, 10, { x: 2, y: 0 })
    const p = { px: 50, py: 16, dx: 500, dy: 0, damage: 5, friendly: true, explodes: true, blastTiles: 16 }
    const { hooks, detonations } = makeHooks()
    const state = baseState([], [p], { map })

    let steps = 0
    while (state.projectiles.length && steps < 20) { stepProjectiles(state, 0.01, hooks); steps++ }

    assert.equal(state.projectiles.length, 0)
    assert.equal(detonations.length, 1)
    assert.ok(detonations[0].px < 64) // last position was still on the walkable side
    assert.equal(detonations[0].blastTiles, 16)
  })

  it('does not detonate a non-exploding projectile at a wall', () => {
    const map = makeMap(50, 10, { x: 2, y: 0 })
    const p = { px: 50, py: 16, dx: 500, dy: 0, damage: 5, friendly: true }
    const { hooks, detonations } = makeHooks()
    const state = baseState([], [p], { map })

    for (let i = 0; i < 20 && state.projectiles.length; i++) stepProjectiles(state, 0.01, hooks)
    assert.equal(detonations.length, 0)
    assert.equal(state.projectiles.length, 0)
  })

  it('detonates on reaching maxDist', () => {
    const p = { px: 0, py: 16, dx: 100, dy: 0, damage: 5, friendly: true, explodes: true, maxDist: 50 }
    const { hooks, detonations } = makeHooks()
    const state = baseState([], [p])

    for (let i = 0; i < 20 && state.projectiles.length; i++) stepProjectiles(state, 0.1, hooks)
    assert.equal(state.projectiles.length, 0)
    assert.equal(detonations.length, 1)
  })
})
