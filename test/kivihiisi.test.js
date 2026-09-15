import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ensureKivihiisi, syncStones, update, LASH } from '../renderer/systems/monsters/kivihiisi.js'
import { CREATURE_HIT, CREATURE_UPDATE, hurtCreature } from '../renderer/systems/creatures.js'
import { updateMonsterPose } from '../renderer/systems/monsters.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const S = 32
const KC = { x: 8, y: 5 }
const mk = () => ({ type: 'kivihiisi', x: KC.x, y: KC.y, px: KC.x * S + 16, py: KC.y * S + 16, hp: 40, maxHp: 40, damage: 3 })
const at = c => ({ x: c.x, y: c.y, px: c.x * S + 16, py: c.y * S + 16 })
function makeMap(w = 20, h = 12) {
  const rows = []
  for (let y = 0; y < h; y++) { const row = []; for (let x = 0; x < w; x++) row.push({ tile: TILE.FLOOR }); rows.push(row) }
  return rows
}
const mkState = (e, player = { x: 4, y: 5 }) => ({
  entities: [e], projectiles: [], map: makeMap(), feedback: makeFeedback(), sfx: makeSfx(),
  player: { ...at(player), hp: 10 },
})
// game.js order for a registry enemy: brain/act, then pose, then the hook.
const run = (e, state, seconds, dt = 0.1) => { for (let t = 0; t < seconds - 1e-9; t += dt) { updateMonsterPose(e, dt); update(e, state, dt) } }

describe('lazy init', () => {
  it('stamps the standing stones and its anchor at its own cell, and does not arm it', () => {
    const e = ensureKivihiisi(mk(), 6)
    assert.equal(e.stones, 6)
    assert.deepEqual(e.anchor, at(KC))
    assert.equal('weaponId' in e, false, "the weapon is the def's (behavior.weapon), not the hook's")
  })
  it('never re-stamps', () => {
    const e = ensureKivihiisi(mk(), 6)
    e.stones = 2
    ensureKivihiisi(e, 6)
    assert.equal(e.stones, 2)
  })
  it('registers its hit and update hooks', () => {
    assert.equal(typeof CREATURE_HIT.kivihiisi, 'function')
    assert.equal(CREATURE_UPDATE.kivihiisi, update)
  })
})

describe('the ring is its life', () => {
  it('syncStones mirrors the standing count onto hp, so the bar reads the ring', () => {
    const e = ensureKivihiisi(mk(), 6)
    syncStones(e, 3)
    assert.equal(e.stones, 3)
    assert.equal(e.hp, 20)
    assert.equal(e.inCombat, true, 'the bar shows once woken')
    syncStones(e, 1)
    assert.equal(e.hp, 7)
  })
  it('absorbs every weapon hit while a stone stands', () => {
    const e = ensureKivihiisi(mk(), 6)
    for (const dmg of [5, 99]) {
      const r = hurtCreature(mkState(e), e, dmg)
      assert.equal(r.absorbed, true)
      assert.equal(r.cue, 'wall-slam')
    }
    assert.equal(e.hp, 40)
  })
  it('the fall of the last stone lands, kills, and records the kill', () => {
    const e = ensureKivihiisi(mk(), 6)
    syncStones(e, 1)
    const state = mkState(e)
    const r = hurtCreature(state, e, e.hp, { source: 'ring' })
    assert.equal(r.absorbed, false)
    assert.equal(r.killed, true)
    assert.equal(state.creatureKills.kivihiisi, true)
  })
  it('with nothing standing an ordinary hit lands too', () => {
    const e = ensureKivihiisi(mk(), 0)
    const r = hurtCreature(mkState(e), e, 5)
    assert.equal(r.absorbed, false)
    assert.equal(e.hp, 35)
  })
})

describe('rooted at the oven', () => {
  it('undoes the frame\'s movement while stones stand', () => {
    const e = ensureKivihiisi(mk(), 6)
    const state = mkState(e)
    e.px += 20; e.py -= 9; e.x = KC.x + 1
    update(e, state, 0.1)
    assert.deepEqual({ x: e.x, y: e.y, px: e.px, py: e.py }, at(KC))
  })
  it('keeps the brain\'s feet still too', () => {
    const e = ensureKivihiisi(mk(), 6)
    update(e, mkState(e), 0.1)
    assert.ok(e.rootTimer > 0, 'act() performs no movement while rootTimer > 0')
  })
  it('is free once nothing stands', () => {
    const e = ensureKivihiisi(mk(), 0)
    e.px += 20
    update(e, mkState(e), 0.1)
    assert.equal(e.px, KC.x * S + 16 + 20)
    assert.equal(e.rootTimer ?? 0, 0)
  })
})

describe('the lash', () => {
  const lash = e => e.lash
  const tip = e => ({ px: e.px + Math.cos(e.lash.aim) * e.lash.len, py: e.py + Math.sin(e.lash.aim) * e.lash.len })
  it('winds up, then a tentacle extends toward the player in range at LASH.speed', () => {
    const e = ensureKivihiisi(mk(), 6)
    const state = mkState(e, { x: 3, y: 5 })     // 5 tiles west
    run(e, state, LASH.windup - 0.05)
    assert.equal(lash(e).state, 'windup')
    assert.ok(e.pose?.eyeGlow > 0, 'the eyes light as it winds up')
    run(e, state, 0.1)
    assert.equal(lash(e).state, 'extend')
    assert.ok(Math.abs(lash(e).aim - Math.PI) < 1e-9, 'aimed west, locked')
    const l0 = lash(e).len
    run(e, state, 0.1)
    assert.ok(Math.abs((lash(e).len - l0) - LASH.speed * 0.1) < 1e-6)
  })
  it('a boulder squarely between stops the tentacle short, and it retracts without a grab', () => {
    const e = ensureKivihiisi(mk(), 6)
    const state = mkState(e, { x: KC.x + 4, y: 5 })
    state.map[5][KC.x + 3].tile = TILE.WALL
    let maxLen = 0
    for (let t = 0; t < 4; t += 0.05) { updateMonsterPose(e, 0.05); update(e, state, 0.05); maxLen = Math.max(maxLen, lash(e).len ?? 0) }
    assert.ok(maxLen < 3 * S, `stopped at the boulder, reached ${maxLen}`)
    assert.equal(state.player.hp, 10, 'no grab')
    assert.equal(state.player.knockback, undefined)
    assert.equal(lash(e).state, 'idle', 'retracted')
  })
  it('a player a step off that line is grabbed: damage, and reeled toward the oven', () => {
    const e = ensureKivihiisi(mk(), 6)
    const state = mkState(e, { x: KC.x + 4, y: 6 })
    state.map[5][KC.x + 3].tile = TILE.WALL
    let grabbedAt = null
    for (let t = 0; t < 3 && !grabbedAt; t += 0.05) { updateMonsterPose(e, 0.05); update(e, state, 0.05); if (state.player.hp < 10) grabbedAt = tip(e) }
    assert.ok(grabbedAt, 'grabbed')
    assert.equal(state.player.hp, 10 - LASH.dmg)
    assert.ok(Math.hypot(grabbedAt.px - state.player.px, grabbedAt.py - state.player.py) <= LASH.reach + 1e-6, 'the tip was on the player')
    const kb = state.player.knockback
    assert.ok(kb && kb.vx < 0 && kb.vy < 0, 'pulled back toward the Hiisi (north-west of the player)')
    assert.equal(lash(e).state, 'retract')
    assert.ok(state.sfx.cues.some(c => c.name === 'drag'))
  })
  it('grabs once per lash, then waits the cooldown', () => {
    const e = ensureKivihiisi(mk(), 6)
    const state = mkState(e, { x: KC.x + 3, y: 5 })
    const grabs = []
    let t = 0
    // up to the grab: one, and the tentacle turns back on it
    for (; t < 3 && !grabs.length; t += 0.05) {
      updateMonsterPose(e, 0.05); update(e, state, 0.05)
      if (state.player.hp < 10) { grabs.push(t); state.player.hp = 10 }
    }
    assert.equal(grabs.length, 1)
    assert.equal(lash(e).state, 'retract')
    // the way back: the tip passes the player again and grabs nothing
    for (; t < 3 && lash(e).state === 'retract'; t += 0.05) {
      state.player.invulnTimer = 0; state.player.knockback = null   // i-frames are not what limits it
      updateMonsterPose(e, 0.05); update(e, state, 0.05)
      if (state.player.hp < 10) grabs.push(t)
    }
    assert.equal(grabs.length, 1)
    assert.equal(lash(e).state, 'idle')
    run(e, state, LASH.cooldown - 0.2)
    assert.equal(lash(e).state, 'idle', 'still cooling')
    run(e, state, 0.3)
    assert.equal(lash(e).state, 'windup')
  })
  it('reaches no further than LASH.range, then retracts', () => {
    const e = ensureKivihiisi(mk(), 6)
    const state = mkState(e, { x: KC.x + 8, y: 5 })
    let maxLen = 0
    for (let t = 0; t < 4; t += 0.05) { updateMonsterPose(e, 0.05); update(e, state, 0.05); maxLen = Math.max(maxLen, lash(e).len ?? 0); if (state.player.hp < 10) { state.player.x = 100; state.player.px = 100 * S } }
    assert.ok(maxLen <= LASH.range + 1e-6)
    assert.equal(lash(e).state, 'idle')
  })
  it('does not reach for a player out of range', () => {
    const e = ensureKivihiisi(mk(), 6)
    const state = mkState(e, { x: KC.x + Math.ceil(LASH.range / S) + 2, y: 5 })
    run(e, state, LASH.windup + LASH.cooldown + 1)
    assert.equal(lash(e).state, 'idle')
  })
  it('lashes nothing once nothing stands, and pulls a live tentacle in', () => {
    const e = ensureKivihiisi(mk(), 6)
    const state = mkState(e, { x: KC.x + 5, y: 5 })
    run(e, state, LASH.windup + 0.2)
    assert.equal(lash(e).state, 'extend')
    syncStones(e, 0)
    run(e, state, 0.1)
    assert.equal(lash(e).state, 'idle')
    run(e, state, LASH.cooldown + 2)
    assert.equal(lash(e).state, 'idle')
  })
})
