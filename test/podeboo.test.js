import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { update, LASER } from '../renderer/systems/monsters/podeboo.js'
import { CREATURE_UPDATE } from '../renderer/systems/creatures.js'
import { updateMonsterPose } from '../renderer/systems/monsters.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { INVULN_DURATION } from '../renderer/systems/player-damage.js'

const T = 32
function openMap(w = 20, h = 20) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) map[y][x].tile = TILE.FLOOR
  return map
}
function mkPlayer(tx, ty) {
  return { type: 'player', x: tx, y: ty, px: tx * T + T / 2, py: ty * T + T / 2, hp: 30, maxHp: 30, invulnTimer: 0 }
}
function mkPodeboo(tx, ty, hp = 10) {
  return { type: 'podeboo', x: tx, y: ty, px: tx * T + T / 2, py: ty * T + T / 2, hp, maxHp: 10, damage: 3 }
}
function mkState(e, player) { return { player, map: openMap(), entities: [e], log: [] } }
// One game-loop step as game.js runs it: pose bookkeeping, then the hook.
function step(e, state, dt = 0.016) { updateMonsterPose(e, dt); update(e, state, dt) }

describe('podeboo laser hook registration', () => {
  it('registers its CREATURE_UPDATE on import', () => {
    assert.equal(CREATURE_UPDATE.podeboo, update)
  })
})

describe('trigger conditions', () => {
  it('stays idle when the player is out of range', () => {
    const e = mkPodeboo(2, 2)
    const state = mkState(e, mkPlayer(17, 17))
    step(e, state)
    assert.notEqual(e.laser?.state, 'charge')
  })
  it('enters charge when the player is in range with line of sight', () => {
    const e = mkPodeboo(5, 5)
    const state = mkState(e, mkPlayer(9, 5))       // 128px away, same row
    step(e, state)
    assert.equal(e.laser.state, 'charge')
  })
  it('does not trigger through a wall', () => {
    const e = mkPodeboo(5, 5)
    const state = mkState(e, mkPlayer(9, 5))
    state.map[5][7].tile = TILE.WALL
    step(e, state)
    assert.notEqual(e.laser?.state, 'charge')
  })
})

describe('charge phase', () => {
  it('pins position against brain movement and idles the gait', () => {
    const e = mkPodeboo(5, 5)
    const state = mkState(e, mkPlayer(9, 5))
    step(e, state)
    const ax = e.px, ay = e.py
    e.px += 4; e.py += 2                           // simulate act() moving it
    step(e, state)
    assert.equal(e.px, ax)
    assert.equal(e.py, ay)
  })
  it('tracks the player with headAim and ramps eyeGlow', () => {
    const e = mkPodeboo(5, 5)
    const state = mkState(e, mkPlayer(9, 5))       // player at +x, aim 0
    step(e, state); step(e, state)
    assert.ok(Math.abs(e.pose.headAim) < 0.01, `headAim ${e.pose.headAim}`)
    const g1 = e.pose.eyeGlow
    step(e, state, 0.3)
    assert.ok(e.pose.eyeGlow > g1)
    assert.ok(e.pose.eyeGlow <= 1)
  })
})

describe('fire phase', () => {
  const charged = (hp, playerTy = 5) => {
    const e = mkPodeboo(5, 5, hp)
    const state = mkState(e, mkPlayer(9, playerTy))
    step(e, state)
    step(e, state, LASER.chargeTime + 0.01)        // charge completes
    step(e, state)                                  // first fire frame
    return { e, state }
  }
  it('above half HP fires a fan burst spanning the arc', () => {
    const { e } = charged(10)
    assert.equal(e.laser.mode, 'burst')
    assert.equal(e.laser.beams.length, LASER.burstBeams)
    const angs = e.laser.beams.map(b => b.ang)
    assert.ok(Math.abs((Math.max(...angs) - Math.min(...angs)) - LASER.burstArc) < 0.01)
  })
  it('at or below half HP the beams sweep across the arc over time', () => {
    const { e, state } = charged(5)
    assert.equal(e.laser.mode, 'sweep')
    const a0 = e.laser.beams[0].ang
    step(e, state, 0.4)
    assert.ok(e.laser.beams[0].ang > a0, 'sweep did not advance')
  })
  it('burst damages a player standing on the centre beam exactly once', () => {
    const { e, state } = charged(10)
    assert.equal(state.player.hp, 30 - LASER.burstDmg)
    step(e, state)
    assert.equal(state.player.hp, 30 - LASER.burstDmg)   // no double-dip
  })
  it('sweep damage lands with i-frames, not per frame', () => {
    const { e, state } = charged(5)
    // drive the sweep until the beam crosses the player's row
    let landed = 0
    for (let i = 0; i < 80 && e.laser.state === 'fire'; i++) {
      const before = state.player.hp
      step(e, state, 0.016)
      if (state.player.hp < before) landed++
      state.player.invulnTimer = Math.max(0, (state.player.invulnTimer ?? 0) - 0.016)
    }
    assert.ok(landed >= 1, 'sweep never hit')
    assert.ok(landed <= Math.ceil(LASER.sweepTime / INVULN_DURATION) + 1, `hit too often: ${landed}`)
  })
  it('returns to idle on cooldown afterwards and does not immediately re-trigger', () => {
    const { e, state } = charged(10)
    step(e, state, LASER.burstFlash + 0.01)
    assert.equal(e.laser.state, 'idle')
    step(e, state)
    assert.equal(e.laser.state, 'idle')            // cooldown holds
    step(e, state, LASER.cooldown + 0.01)
    step(e, state)
    assert.equal(e.laser.state, 'charge')          // and then it may again
  })
})
