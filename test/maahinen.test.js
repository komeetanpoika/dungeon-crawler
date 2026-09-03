import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeMaahinen, updateMaahinen,
  BURROW_SPEED, ERUPT_DIST, ERUPT_TIME, RESURFACE_DELAY, SUBMERGE_TIME, LEASH_TILES,
} from '../renderer/systems/monsters/maahinen.js'
import { strikeCreature, creatureAlpha, CREATURE_HIT, CREATURE_ALPHA } from '../renderer/systems/creatures.js'
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
    assert.equal(m.hp, 36)
    assert.equal(m.maxHp, 36)
    assert.equal(m.state, 'submerged')
    assert.equal(m.timer, 0)
    assert.equal(m.weaponId, 'maul')
    assert.equal(m.damageCooldown, 0)
    assert.equal(m.inCombat, false)
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

describe('updateMaahinen — leash', () => {
  it('LEASH_TILES is 24', () => {
    assert.equal(LEASH_TILES, 24)
  })

  it('glides back toward home, and never erupts, while the player is outside the leash', () => {
    const m = makeMaahinen(5, 5)
    // Player 30 tiles east of home: well outside the 24-tile leash.
    const player = makePlayer(35, 5)
    const state = makeState(m, player, openMap(50, 50))
    // Displace it a few tiles off home so "toward home" is measurable.
    m.px = 9 * S + 16; m.py = 5 * S + 16; m.x = 9; m.y = 5
    const homePx = 5 * S + 16, homePy = 5 * S + 16
    const before = Math.hypot(homePx - m.px, homePy - m.py)
    updateMaahinen(m, state, 1)
    const after = Math.hypot(homePx - m.px, homePy - m.py)
    assert.ok(after < before, `expected it to close on home, went ${before} -> ${after}`)
    assert.ok(Math.abs((before - after) - BURROW_SPEED) < 1, `expected ~${BURROW_SPEED}px closed`)
    assert.equal(m.state, 'submerged')
  })

  it('never erupts on a player standing on it from outside the leash', () => {
    const m = makeMaahinen(5, 5)
    const player = makePlayer(35, 5)
    const state = makeState(m, player, openMap(50, 50))
    for (let t = 0; t < 60; t += 0.1) updateMaahinen(m, state, 0.1)
    assert.equal(m.state, 'submerged')
    assert.ok(!state.sfx.cues.some(c => c.name === 'erupt'), 'no erupt cue')
    // parked on home, not drifting toward the distant player
    assert.equal(m.x, 5)
    assert.equal(m.y, 5)
  })

  it('still hunts a player inside the leash', () => {
    const m = makeMaahinen(5, 5)
    const player = makePlayer(13, 5)   // 8 tiles: inside the leash
    const state = makeState(m, player, openMap(40, 40))
    const before = Math.hypot(player.px - m.px, player.py - m.py)
    updateMaahinen(m, state, 1)
    const after = Math.hypot(player.px - m.px, player.py - m.py)
    assert.ok(Math.abs((before - after) - BURROW_SPEED) < 1, 'closes on the player')
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
    assert.equal(r.entity.hp, 36)
  })

  it('absorbs damage while submerging (hp unchanged, cue null)', () => {
    const m = makeMaahinen(5, 5)
    m.state = 'submerging'
    const state = makeState(m, makePlayer(5, 5))
    const r = strikeCreature(m, state, 6)
    assert.equal(r.absorbed, true)
    assert.equal(r.cue, null)
    assert.equal(r.entity.hp, 36)
  })

  it('damages while surfaced', () => {
    const m = makeMaahinen(5, 5)
    m.state = 'surfaced'
    const state = makeState(m, makePlayer(5, 5))
    const r = strikeCreature(m, state, 6)
    assert.equal(r.absorbed, false)
    assert.equal(r.cue, 'melee-hit')
    assert.equal(r.entity.hp, 30)
    assert.equal(r.entity.inCombat, true)
  })

  it('damages while erupting', () => {
    const m = makeMaahinen(5, 5)
    m.state = 'erupting'
    const state = makeState(m, makePlayer(5, 5))
    const r = strikeCreature(m, state, 6)
    assert.equal(r.absorbed, false)
    assert.equal(r.entity.hp, 30)
  })
})

describe('updateMaahinen — surfaced', () => {
  it('runs the enemy brain + act without throwing, and chases the player', () => {
    const m = makeMaahinen(5, 5)
    m.px = 5 * S + 16; m.py = 5 * S + 16
    m.state = 'surfaced'
    m.sink = 0
    const player = makePlayer(9, 5)
    const state = makeState(m, player)
    assert.doesNotThrow(() => updateMaahinen(m, state, 0.1))
    assert.equal(m.state, 'surfaced')
    assert.ok(m.ai, 'brain initialised an ai object on the entity')
  })

  it('enters submerging on the next update once hp drops to half (18)', () => {
    const m = makeMaahinen(5, 5)
    m.px = 5 * S + 16; m.py = 5 * S + 16
    m.state = 'surfaced'
    m.sink = 0
    m.hp = 18
    const player = makePlayer(9, 5)
    const state = makeState(m, player)
    updateMaahinen(m, state, 0.1)
    assert.equal(m.state, 'submerging')
    assert.equal(m.timer, SUBMERGE_TIME)
    assert.equal(m.dived, true)
  })

  it('allows a second dive once hp drops to a quarter (9), after the first dive', () => {
    const m = makeMaahinen(5, 5)
    m.px = 5 * S + 16; m.py = 5 * S + 16
    m.state = 'surfaced'
    m.sink = 0
    m.hp = 9
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
    m.sink = 0
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
    m.sink = 0
    m.hp = 18
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
  it('reads fadeA directly (defaulting to fully opaque when unset)', () => {
    const m = makeMaahinen(5, 5)
    assert.equal(creatureAlpha(m), 0)   // spawns submerged: fadeA stamped 0
    m.fadeA = 0.4
    assert.equal(creatureAlpha(m), 0.4)
    m.fadeA = undefined
    assert.equal(creatureAlpha(m), 1)
  })
})

describe('maahinen hit sources', () => {
  it('a player hit wounds it and forces an immediate dive', () => {
    const m = { ...makeMaahinen(5, 5), state: 'surfaced' }
    const r = CREATURE_HIT.maahinen(m, {}, 3, { source: 'player' })
    assert.equal(r.absorbed, false)
    assert.equal(r.entity.hp, 33)
    assert.equal(r.entity.state, 'submerging')
    assert.equal(r.think, 'It just dives.')
  })
  it('a wolf bite wounds it without a dive', () => {
    const m = { ...makeMaahinen(5, 5), state: 'surfaced' }
    const r = CREATURE_HIT.maahinen(m, {}, 2, { source: 'wolf' })
    assert.equal(r.entity.hp, 34)
    assert.equal(r.entity.state, 'surfaced')
  })
  it('a killing player blow does not dive (it dies on the surface)', () => {
    const m = { ...makeMaahinen(5, 5), state: 'surfaced', hp: 2 }
    const r = CREATURE_HIT.maahinen(m, {}, 3, { source: 'player' })
    assert.equal(r.entity.state, 'surfaced')
    assert.ok(r.entity.hp <= 0)
  })
  it('a forced dive marks HP thresholds already crossed, so it does not immediately re-dive after resurfacing', () => {
    const wounded = { ...makeMaahinen(5, 5), state: 'surfaced', hp: 36 }
    const r1 = CREATURE_HIT.maahinen(wounded, {}, 20, { source: 'player' })   // 36 -> 16: past half
    assert.equal(r1.entity.dived, true)
    assert.ok(!r1.entity.dived2)

    const gutted = { ...makeMaahinen(5, 5), state: 'surfaced', hp: 36 }
    const r2 = CREATURE_HIT.maahinen(gutted, {}, 28, { source: 'player' })   // 36 -> 8: past quarter too
    assert.equal(r2.entity.dived, true)
    assert.equal(r2.entity.dived2, true)

    // Resurfacing shouldn't immediately re-trigger surfacedTick's own
    // half-HP dive check, now that `dived` is already marked on the entity.
    const resurfaced = { ...r1.entity, state: 'surfaced' }
    const state = makeState(resurfaced, makePlayer(25, 25))
    updateMaahinen(resurfaced, state, 0.1)
    assert.equal(resurfaced.state, 'surfaced')
  })
})

describe('maahinen sink channel', () => {
  it('submerging drives sink 0 → 1 then fades out; erupting rises over its last 0.3 s', () => {
    const m = { ...makeMaahinen(5, 5), state: 'submerging', timer: SUBMERGE_TIME, sink: 0, fadeA: 1 }
    const state = { player: { x: 5, y: 12, px: 5 * 32 + 16, py: 12 * 32 + 16 }, map: openMap(), entities: [], sfx: makeSfx() }
    updateMaahinen(m, state, SUBMERGE_TIME / 2)
    assert.ok(Math.abs(m.sink - 0.5) < 1e-6)
    updateMaahinen(m, state, SUBMERGE_TIME)
    assert.equal(m.state, 'submerged')
    assert.equal(m.sink, 1)
    updateMaahinen(m, state, 1)
    assert.equal(CREATURE_ALPHA.maahinen(m, state), 0)
    Object.assign(m, { state: 'erupting', timer: ERUPT_TIME })
    updateMaahinen(m, state, ERUPT_TIME - 0.15)
    assert.ok(Math.abs(m.sink - 0.5) < 0.05)
    updateMaahinen(m, state, 0.2)
    assert.equal(m.state, 'surfaced')
    assert.equal(m.sink, 0)
    assert.ok(CREATURE_ALPHA.maahinen(m, state) > 0.9)
  })

  it('a forced dive out of erupting continues the sink value instead of popping back toward 0', () => {
    const m = { ...makeMaahinen(5, 5), state: 'erupting', timer: 0.15, sink: 0.5, hp: 36 }
    const r = CREATURE_HIT.maahinen(m, {}, 3, { source: 'player' })
    assert.equal(r.entity.state, 'submerging')
    const state = { player: { x: 5, y: 5, px: 5 * S + 16, py: 5 * S + 16 }, map: openMap(), entities: [], sfx: makeSfx() }
    const entity = { ...r.entity }
    updateMaahinen(entity, state, 0.016)
    assert.ok(entity.sink >= 0.5, `expected no drop below 0.5, got ${entity.sink}`)
  })
})
