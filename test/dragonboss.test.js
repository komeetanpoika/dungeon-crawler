import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeDragonBoss, updateDragonBoss, pointInCone, easeAngle, BOSS_HP } from '../renderer/systems/dragonboss.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

const T = 32
function openMap(w = 40, h = 40) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) map[y][x].tile = TILE.FLOOR
  return map
}
function mkPlayer(px, py) { return { type: 'player', x: Math.floor(px/T), y: Math.floor(py/T), px, py, hp: 30, maxHp: 30 } }
function mkState(boss, player) { return { player, map: openMap(), projectiles: [], entities: [boss], log: [] } }

describe('pointInCone', () => {
  it('true for a point inside the half-angle and within length', () => {
    assert.equal(pointInCone(100, 0, 0, 0, 0, 0.4, 200), true)       // straight ahead (aim 0 = +x)
  })
  it('false beyond the length', () => {
    assert.equal(pointInCone(300, 0, 0, 0, 0, 0.4, 200), false)
  })
  it('false outside the half-angle', () => {
    assert.equal(pointInCone(0, 100, 0, 0, 0, 0.4, 200), false)      // 90° off-axis
  })
  it('respects a rotated aim', () => {
    assert.equal(pointInCone(0, 100, 0, 0, Math.PI/2, 0.4, 200), true) // aim points +y
  })
  it('false at the apex point itself (d === 0)', () => {
    assert.equal(pointInCone(0, 0, 0, 0, 0, 0.1, 100), false)
  })
})

describe('easeAngle', () => {
  it('snaps to target when within maxStep', () => {
    assert.equal(easeAngle(0, 0.05, 0.1), 0.05)
  })
  it('steps by at most maxStep toward the target', () => {
    assert.equal(easeAngle(0, 1, 0.1), 0.1)
  })
  it('takes the shortest arc across the +/-PI wrap', () => {
    // target just past -PI from a near-+PI current; shortest move is positive (wrap)
    const r = easeAngle(3.0, -3.0, 0.1)
    assert.ok(r > 3.0, `expected to wrap upward past PI, got ${r}`)
  })
})

describe('makeDragonBoss', () => {
  it('has correct initial fields', () => {
    const e = makeDragonBoss(10, 8)
    assert.equal(e.type, 'dragon_boss')
    assert.equal(e.hp, BOSS_HP); assert.equal(e.maxHp, BOSS_HP)
    assert.equal(e.state, 'idle')
    assert.equal(e.anchorX, 10); assert.equal(e.anchorY, 8)
    assert.equal(e.tailSwing, 0); assert.equal(e.neckRear, 0)
  })
})

describe('updateDragonBoss facing', () => {
  it('eases facing toward the player over time', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T; e.facing = 0
    e.attackCooldown = 999; e.repositionTimer = 999   // stay idle so it keeps tracking (facing is locked during attacks)
    const player = mkPlayer(10*T, 16*T)           // due south => target angle +PI/2
    const state = mkState(e, player)
    for (let i = 0; i < 120; i++) updateDragonBoss(e, state, 1/60)  // 2s — enough to fully turn at 1.2 rad/s
    assert.ok(Math.abs(e.facing - Math.PI/2) < 0.2, `facing should approach +PI/2, got ${e.facing}`)
  })
})

describe('updateDragonBoss contact damage', () => {
  it('damages the player on body contact, respecting cooldown', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T
    const player = mkPlayer(10*T + 8, 10*T)       // overlapping the body
    const state = mkState(e, player)
    updateDragonBoss(e, state, 1/60)
    const after = player.hp
    assert.ok(after < 30, 'contact should deal damage')
    updateDragonBoss(e, state, 1/60)              // still on cooldown
    assert.equal(player.hp, after, 'no second hit while damageCooldown active')
  })
})

describe('updateDragonBoss attacks', () => {
  function ready(e) { e.attackCooldown = 0; e.repositionTimer = 999 }  // force an attack, no reposition

  it('picks a tail attack when the player has flanked into the rear arc', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T; e.facing = 0; ready(e)
    const player = mkPlayer(10*T - 2*T, 10*T)     // ~2 tiles BEHIND (boss faces east) => in the tail's rear arc
    const state = mkState(e, player)
    updateDragonBoss(e, state, 1/60)
    assert.ok(e.state === 'tail_windup' || e.state === 'tail', `expected tail*, got ${e.state}`)
  })

  it('picks a ranged breath (cone or sweep) at distance', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T; ready(e)
    const player = mkPlayer(10*T + 6*T, 10*T)     // far => ranged
    const state = mkState(e, player)
    updateDragonBoss(e, state, 1/60)
    assert.ok(['cone','sweep_windup'].includes(e.state), `expected ranged, got ${e.state}`)
  })

  it('does not start a new attack while attackCooldown is active', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T
    e.attackCooldown = 1; e.repositionTimer = 999
    const player = mkPlayer(10*T + 6*T, 10*T)
    const state = mkState(e, player)
    updateDragonBoss(e, state, 1/60)
    assert.equal(e.state, 'idle')
  })

  it('sweeping breath damages a player inside the swept cone', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T; e.facing = 0
    e.state = 'sweep'; e.stateTimer = 1.5; e.headAim = 0
    const player = mkPlayer(10*T + 3*T, 10*T)     // straight ahead, within cone length
    const state = mkState(e, player); const hp0 = player.hp
    for (let i = 0; i < 90; i++) updateDragonBoss(e, state, 1/60)
    assert.ok(player.hp < hp0, 'player in cone should take breath damage')
  })

  it('tail sweep applies burst damage and knocks the player back', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T; e.facing = 0
    e.state = 'tail'; e.stateTimer = 0.45; e.dmgAcc = 0
    const player = mkPlayer(10*T - 2*T, 10*T)     // BEHIND the east-facing boss => inside the tail arc
    const state = mkState(e, player)
    const hp0 = player.hp
    for (let i = 0; i < 30; i++) updateDragonBoss(e, state, 1/60)
    assert.ok(player.hp < hp0, 'tail sweep should deal damage')
    assert.ok(player.knockback, 'player should have a knockback slide queued')
    assert.ok(player.knockback.vx < 0, 'player should be knocked outward (further west, away from the dragon)')
  })

  it('resets the damage accumulator after an attack ends (no carryover free hit)', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T; e.facing = 0
    e.state = 'tail'; e.stateTimer = 0.45; e.dmgAcc = 0
    const player = mkPlayer(10*T - 2*T, 10*T)     // BEHIND => in the tail arc so the hit actually fires
    const state = mkState(e, player)
    for (let i = 0; i < 40; i++) updateDragonBoss(e, state, 1/60)  // tail hits then endAttack
    assert.equal(e.dmgAcc, 0, 'dmgAcc must reset so the next breath has no free instant tick')
  })

  it('reposition crawls toward the anchor then returns to idle', () => {
    const e = makeDragonBoss(10, 10); e.px = 10*T; e.py = 10*T
    e.state = 'reposition'; e.stateTimer = 1.2; e.anchorX = 13; e.anchorY = 10
    const player = mkPlayer(10*T, 30*T)            // far away, no interference
    const state = mkState(e, player)
    const px0 = e.px
    for (let i = 0; i < 80; i++) updateDragonBoss(e, state, 1/60)
    assert.ok(e.px > px0, 'boss should crawl toward the +x anchor')
    assert.equal(e.state, 'idle', 'boss returns to idle after repositioning')
  })
})
