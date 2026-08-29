import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeMaahinen, updateMaahinen,
  BURROW_SPEED, ERUPT_DIST, ERUPT_TIME, RESURFACE_DELAY, SUBMERGE_TIME,
} from '../renderer/systems/maahinen.js'
import { strikeCreature, creatureAlpha } from '../renderer/systems/creatures.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { stepEnemyAttack } from '../renderer/systems/enemy-attack.js'

const S = 32

function openMap(w = 30, h = 30) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      map[y][x].tile = TILE.FLOOR
  return map
}

function makePlayer(x, y, overrides = {}) {
  return { x, y, px: x * S + 16, py: y * S + 16, hp: 20, invulnTimer: 0, grabbed: false, ...overrides }
}

function makeState(maahinen, player, map = openMap()) {
  return { player, map, entities: [maahinen], projectiles: [], log: [], sfx: makeSfx(), feedback: makeFeedback() }
}

describe('makeMaahinen', () => {
  it('has the correct initial shape', () => {
    const m = makeMaahinen(5, 5)
    assert.equal(m.type, 'maahinen')
    assert.equal(m.x, 5)
    assert.equal(m.y, 5)
    assert.equal(m.hp, 24)
    assert.equal(m.maxHp, 24)
    assert.equal(m.state, 'submerged')
    assert.equal(m.timer, 0)
    assert.equal(m.weaponId, 'maul')
    assert.equal(m.damageCooldown, 0)
    assert.equal(m.inCombat, false)
    assert.equal(m.aiHalf, 28)
    assert.equal(m.facing, 'east')
    assert.deepEqual(m.home, { x: 5, y: 5 })
  })
})

describe('updateMaahinen — submerged glide', () => {
  it('glides toward the player at ~BURROW_SPEED px/s and stays submerged beyond ERUPT_DIST', () => {
    const m = makeMaahinen(5, 5)
    const player = makePlayer(15, 5)   // far away: 10 tiles = 320px east
    const state = makeState(m, player)
    const before = Math.hypot(player.px - m.px, player.py - m.py)
    updateMaahinen(m, state, 1)
    const after = Math.hypot(player.px - m.px, player.py - m.py)
    assert.ok(Math.abs((before - after) - BURROW_SPEED) < 1, `expected ~${BURROW_SPEED}px closed, got ${before - after}`)
    assert.equal(m.state, 'submerged')
  })

  it('erupts once within ERUPT_DIST with timer expired, snapping to a walkable tile', () => {
    const m = makeMaahinen(5, 5)
    m.px = 5 * S + 16; m.py = 5 * S + 16
    const player = makePlayer(5, 5, { px: m.px + ERUPT_DIST - 5, py: m.py })
    const state = makeState(m, player)
    updateMaahinen(m, state, 0.016)
    assert.equal(m.state, 'erupting')
    assert.equal(m.timer, ERUPT_TIME)
    assert.ok(state.sfx.cues.some(c => c.name === 'erupt'), 'erupt cue recorded')
  })

  it('does not erupt while the resurface-delay timer is still running, even within range', () => {
    const m = makeMaahinen(5, 5)
    m.px = 5 * S + 16; m.py = 5 * S + 16
    m.timer = RESURFACE_DELAY
    const player = makePlayer(5, 5, { px: m.px + 10, py: m.py })
    const state = makeState(m, player)
    updateMaahinen(m, state, 0.016)
    assert.equal(m.state, 'submerged')
  })

  it('snaps to an adjacent walkable tile, not the player\'s own tile, when they are co-located', () => {
    const m = makeMaahinen(5, 5)
    m.px = 5 * S + 16; m.py = 5 * S + 16
    const player = makePlayer(5, 5, { px: m.px, py: m.py })
    const state = makeState(m, player)
    updateMaahinen(m, state, 0.016)
    assert.equal(m.state, 'erupting')
    assert.ok(!(m.x === player.x && m.y === player.y), 'must not erupt onto the player\'s own tile')
    const cheb = Math.max(Math.abs(m.x - player.x), Math.abs(m.y - player.y))
    assert.equal(cheb, 1, 'nearest ring search should land adjacent')
    assert.equal(state.map[m.y][m.x].tile, TILE.FLOOR)
  })
})

describe('updateMaahinen — erupting', () => {
  it('surfaces once ERUPT_TIME has elapsed', () => {
    const m = makeMaahinen(5, 5)
    m.state = 'erupting'
    m.timer = ERUPT_TIME
    const player = makePlayer(8, 5)
    const state = makeState(m, player)
    updateMaahinen(m, state, ERUPT_TIME + 0.1)
    assert.equal(m.state, 'surfaced')
  })

  it('stays erupting (stationary, vulnerable) before the timer expires', () => {
    const m = makeMaahinen(5, 5)
    m.state = 'erupting'
    m.timer = ERUPT_TIME
    const startPx = m.px, startPy = m.py
    const player = makePlayer(8, 5)
    const state = makeState(m, player)
    updateMaahinen(m, state, 0.1)
    assert.equal(m.state, 'erupting')
    assert.equal(m.px, startPx)
    assert.equal(m.py, startPy)
  })
})

describe('strikeCreature — maahinen', () => {
  it('absorbs damage while submerged (hp unchanged, cue null)', () => {
    const m = makeMaahinen(5, 5)
    m.state = 'submerged'
    const state = makeState(m, makePlayer(5, 5))
    const r = strikeCreature(m, state, 6)
    assert.equal(r.absorbed, true)
    assert.equal(r.cue, null)
    assert.equal(r.entity.hp, 24)
  })

  it('absorbs damage while submerging (hp unchanged, cue null)', () => {
    const m = makeMaahinen(5, 5)
    m.state = 'submerging'
    const state = makeState(m, makePlayer(5, 5))
    const r = strikeCreature(m, state, 6)
    assert.equal(r.absorbed, true)
    assert.equal(r.cue, null)
    assert.equal(r.entity.hp, 24)
  })

  it('damages while surfaced', () => {
    const m = makeMaahinen(5, 5)
    m.state = 'surfaced'
    const state = makeState(m, makePlayer(5, 5))
    const r = strikeCreature(m, state, 6)
    assert.equal(r.absorbed, false)
    assert.equal(r.cue, 'melee-hit')
    assert.equal(r.entity.hp, 18)
    assert.equal(r.entity.inCombat, true)
  })

  it('damages while erupting', () => {
    const m = makeMaahinen(5, 5)
    m.state = 'erupting'
    const state = makeState(m, makePlayer(5, 5))
    const r = strikeCreature(m, state, 6)
    assert.equal(r.absorbed, false)
    assert.equal(r.entity.hp, 18)
  })
})

describe('updateMaahinen — surfaced', () => {
  it('runs the enemy brain + act without throwing, and chases the player', () => {
    const m = makeMaahinen(5, 5)
    m.px = 5 * S + 16; m.py = 5 * S + 16
    m.state = 'surfaced'
    const player = makePlayer(9, 5)
    const state = makeState(m, player)
    assert.doesNotThrow(() => updateMaahinen(m, state, 0.1))
    assert.equal(m.state, 'surfaced')
    assert.ok(m.ai, 'brain initialised an ai object on the entity')
  })

  it('enters submerging on the next update once hp drops to half (12)', () => {
    const m = makeMaahinen(5, 5)
    m.px = 5 * S + 16; m.py = 5 * S + 16
    m.state = 'surfaced'
    m.hp = 12
    const player = makePlayer(9, 5)
    const state = makeState(m, player)
    updateMaahinen(m, state, 0.1)
    assert.equal(m.state, 'submerging')
    assert.equal(m.timer, SUBMERGE_TIME)
    assert.equal(m.dived, true)
  })

  it('allows a second dive once hp drops to a quarter (6), after the first dive', () => {
    const m = makeMaahinen(5, 5)
    m.px = 5 * S + 16; m.py = 5 * S + 16
    m.state = 'surfaced'
    m.hp = 6
    m.dived = true
    const player = makePlayer(9, 5)
    const state = makeState(m, player)
    updateMaahinen(m, state, 0.1)
    assert.equal(m.state, 'submerging')
    assert.equal(m.dived2, true)
  })

  it('damageCooldown ticks down each surfaced update, so the maul lands repeatedly (not just once)', () => {
    const m = makeMaahinen(5, 5)
    m.px = 5 * S + 16; m.py = 5 * S + 16
    m.state = 'surfaced'
    // Player parked well within reach (34px) and stopRange (30px) the whole time.
    const player = makePlayer(5, 5, { px: m.px + 20, py: m.py, hp: 999, invulnTimer: 0 })
    const state = makeState(m, player)
    let attacksStarted = 0
    for (let t = 0; t < 4; t += 0.05) {
      const hadAttack = !!m.attack
      // game.js decrements the player's i-frame timer every frame (separately
      // from the enemy update) — replicate that here, or the first hit's
      // invulnerability window would never expire and mask the real fix.
      player.invulnTimer = Math.max(0, (player.invulnTimer ?? 0) - 0.05)
      updateMaahinen(m, state, 0.05)
      if (!hadAttack && m.attack) attacksStarted++
      stepEnemyAttack(m, state, 0.05)
    }
    assert.ok(attacksStarted >= 3, `expected >= 3 attacks started over 4s, got ${attacksStarted}`)
  })

  it('clears a pending attack when diving into submerging (no swing sprite over an invisible body)', () => {
    const m = makeMaahinen(5, 5)
    m.px = 5 * S + 16; m.py = 5 * S + 16
    m.state = 'surfaced'
    m.hp = 12
    m.attack = { weaponId: 'maul', phase: 'swing', timer: 0.1, duration: 0.3, angle: 0, message: 'x' }
    const player = makePlayer(9, 5)
    const state = makeState(m, player)
    updateMaahinen(m, state, 0.1)
    assert.equal(m.state, 'submerging')
    assert.equal(m.attack, null)
  })
})

describe('updateMaahinen — submerging', () => {
  it('teleports to a walkable tile 4-6 Chebyshev tiles from the player and resubmerges', () => {
    const m = makeMaahinen(5, 5)
    m.state = 'submerging'
    m.timer = SUBMERGE_TIME
    const player = makePlayer(15, 15)
    const state = makeState(m, player)
    updateMaahinen(m, state, SUBMERGE_TIME + 0.1)
    assert.equal(m.state, 'submerged')
    assert.equal(m.timer, RESURFACE_DELAY)
    const cheb = Math.max(Math.abs(m.x - player.x), Math.abs(m.y - player.y))
    assert.ok(cheb >= 4 && cheb <= 6, `expected Chebyshev 4-6, got ${cheb}`)
    assert.equal(state.map[m.y][m.x].tile, TILE.FLOOR)
  })

  it('stays put before the timer expires', () => {
    const m = makeMaahinen(5, 5)
    m.state = 'submerging'
    m.timer = SUBMERGE_TIME
    const px = m.px, py = m.py
    const player = makePlayer(15, 15)
    const state = makeState(m, player)
    updateMaahinen(m, state, 0.1)
    assert.equal(m.state, 'submerging')
    assert.equal(m.px, px)
    assert.equal(m.py, py)
  })
})

describe('CREATURE_ALPHA.maahinen', () => {
  it('is 0 submerged, 0.4 submerging, 1 otherwise', () => {
    const m = makeMaahinen(5, 5)
    m.state = 'submerged'
    assert.equal(creatureAlpha(m), 0)
    m.state = 'submerging'
    assert.equal(creatureAlpha(m), 0.4)
    m.state = 'erupting'
    assert.equal(creatureAlpha(m), 1)
    m.state = 'surfaced'
    assert.equal(creatureAlpha(m), 1)
  })
})
