// test/turn.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePlayerAction, stepGuard, stepMonster, ACTION_NOISE } from '../renderer/systems/turn.js'
import { TILE, makePlayer, makeGuard, makeMonster, makeTrap, makePuzzle } from '../renderer/systems/entities.js'
import { createMap } from '../renderer/systems/map.js'

function openMap(w = 20, h = 20) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      map[y][x].tile = TILE.FLOOR
  return map
}

function makeState(overrides = {}) {
  return {
    level: 1,
    map: openMap(),
    player: makePlayer(5, 5),
    entities: [],
    log: [],
    noiseMap: {},
    run: { deepestLevel: 1, won: false },
    ...overrides,
  }
}

describe('resolvePlayerAction — move', () => {
  it('moves player on open floor', () => {
    const state = makeState()
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    assert.equal(next.player.x, 6)
    assert.equal(next.player.y, 5)
  })

  it('does not move player into a wall', () => {
    const state = makeState()
    state.map[5][6].tile = TILE.WALL
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    assert.equal(next.player.x, 5)
  })

  it('sets pendingNoise.amount > 0 for a move', () => {
    const state = makeState()
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    assert.ok(next.pendingNoise.amount > 0)
  })

  it('triggers a trap on stepped tile', () => {
    const trap = makeTrap(6, 5)
    const state = makeState({ entities: [trap] })
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    const updatedTrap = next.entities.find(e => e.type === 'trap')
    assert.equal(updatedTrap.triggered, true)
    assert.ok(next.pendingNoise.amount >= ACTION_NOISE.trigger_trap)
  })

  it('attacks and damages a guard on the target tile', () => {
    const guard = makeGuard(6, 5)
    const state = makeState({ entities: [guard] })
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    const updatedGuard = next.entities.find(e => e.type === 'guard')
    assert.ok(updatedGuard.hp < guard.hp)
  })

  it('removes guard from entities when HP reaches 0', () => {
    const guard = { ...makeGuard(6, 5), hp: 1 }
    const state = makeState({ entities: [guard] })
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    assert.equal(next.entities.filter(e => e.type === 'guard').length, 0)
  })
})

describe('resolvePlayerAction — steal', () => {
  it('sets won:true when player is on TREASURE tile', () => {
    const state = makeState()
    state.map[5][5].tile = TILE.TREASURE
    const next = resolvePlayerAction(state, { type: 'steal' })
    assert.equal(next.won, true)
  })
})

describe('resolvePlayerAction — descend', () => {
  it('sets descend:true when player is on STAIRS_DOWN tile', () => {
    const state = makeState()
    state.map[5][5].tile = TILE.STAIRS_DOWN
    const next = resolvePlayerAction(state, { type: 'descend' })
    assert.equal(next.descend, true)
  })
})

describe('stepGuard', () => {
  it('moves guard along its patrol path', () => {
    const map = openMap()
    const guard = makeGuard(5, 5, [{ x: 7, y: 5 }])
    const next = stepGuard(guard, map)
    assert.equal(next.x, 6)
  })

  it('does not move guard into a wall', () => {
    const map = openMap()
    map[5][6].tile = TILE.WALL
    const guard = makeGuard(5, 5, [{ x: 7, y: 5 }])
    const next = stepGuard(guard, map)
    assert.equal(next.x, 5)
  })
})

describe('stepMonster', () => {
  it('moves monster to an adjacent floor tile', () => {
    const map = openMap()
    const monster = makeMonster(5, 5)
    const next = stepMonster(monster, map)
    const dx = Math.abs(next.x - 5), dy = Math.abs(next.y - 5)
    assert.ok((dx === 1 && dy === 0) || (dx === 0 && dy === 1))
  })
})

describe('resolvePlayerAction — interact', () => {
  it('solves an adjacent puzzle', () => {
    const puzzle = makePuzzle(6, 5)
    const state = makeState({ entities: [puzzle] })
    const next = resolvePlayerAction(state, { type: 'interact' })
    const updated = next.entities.find(e => e.type === 'puzzle')
    assert.equal(updated.solved, true)
  })

  it('does nothing when no puzzle is adjacent', () => {
    const state = makeState()
    const next = resolvePlayerAction(state, { type: 'interact' })
    assert.ok(next.log[next.log.length - 1].includes('Nothing'))
  })

  it('does not re-solve an already solved puzzle', () => {
    const puzzle = { ...makePuzzle(6, 5), solved: true }
    const state = makeState({ entities: [puzzle] })
    const next = resolvePlayerAction(state, { type: 'interact' })
    assert.ok(next.log[next.log.length - 1].includes('Nothing'))
  })
})

describe('resolvePlayerAction — inCombat', () => {
  it('sets inCombat:true on a guard that survives a player attack', () => {
    const guard = makeGuard(6, 5) // hp: 4
    const player = { ...makePlayer(5, 5), weapon: { weaponType: 'dagger', name: 'Dagger', damage: 1 } }
    const state = makeState({ player, entities: [guard] })
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    const updated = next.entities.find(e => e.type === 'guard')
    assert.equal(updated.inCombat, true)
  })

  it('sets inCombat:true on a monster that survives a player attack', () => {
    const monster = makeMonster(6, 5, 'strong') // hp: 3, survives a 1-dmg hit
    const player = { ...makePlayer(5, 5), weapon: { weaponType: 'dagger', name: 'Dagger', damage: 1 } }
    const state = makeState({ player, entities: [monster] })
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    const updated = next.entities.find(e => e.type === 'monster')
    assert.equal(updated.inCombat, true)
  })
})
