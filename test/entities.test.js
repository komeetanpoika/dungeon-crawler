// test/entities.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeGuard, makeMonster, makeDragon, TILE, hasLineOfSight, isWalkable, makeKey, makeExitDoor, makeTreasure, computePlayerFOV, maybeComputeFOV, makePlayer,
  RANGED_WEAPON_TYPES, makeRangedContents, WAND_TYPES, makeWandContents, AMMO_KINDS, AMMO_CAPS, emptyAmmo } from '../renderer/systems/entities.js'
import { createMap } from '../renderer/systems/map.js'

function openMap(w = 20, h = 20) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      map[y][x].tile = TILE.FLOOR
  return map
}

describe('TILE', () => {
  it('has a SNARE constant distinct from WALL, FLOOR, COLUMN', () => {
    assert.equal(typeof TILE.SNARE, 'number')
    assert.notEqual(TILE.SNARE, TILE.WALL)
    assert.notEqual(TILE.SNARE, TILE.FLOOR)
    assert.notEqual(TILE.SNARE, TILE.COLUMN)
  })

  it('has SAND distinct from WALL, FLOOR, COLUMN, SNARE and is walkable', () => {
    assert.equal(typeof TILE.SAND, 'number')
    assert.notEqual(TILE.SAND, TILE.WALL)
    assert.notEqual(TILE.SAND, TILE.FLOOR)
    assert.notEqual(TILE.SAND, TILE.COLUMN)
    assert.notEqual(TILE.SAND, TILE.SNARE)
    assert.equal(isWalkable(TILE.SAND), true)
  })
})

describe('makeGuard', () => {
  it('has hp, maxHp, inCombat — no patrol or alertState', () => {
    const g = makeGuard(5, 5)
    assert.equal(g.hp, 4)
    assert.equal(g.maxHp, 4)
    assert.equal(g.inCombat, false)
    assert.equal(g.patrol, undefined)
    assert.equal(g.alertState, undefined)
  })
})

describe('makeMonster', () => {
  it('has hp and maxHp matching variant — no alertState', () => {
    const cases = [['weak', 1], ['medium', 2], ['strong', 3], ['boss', 5]]
    for (const [variant, hp] of cases) {
      const m = makeMonster(5, 5, variant)
      assert.equal(m.hp, hp)
      assert.equal(m.maxHp, hp)
      assert.equal(m.alertState, undefined)
    }
  })
})

describe('makeDragon', () => {
  it('has hp:12, maxHp:12, inCombat:false — no sleepMeter or snareTimer', () => {
    const d = makeDragon(5, 5, 1)
    assert.equal(d.hp, 12)
    assert.equal(d.maxHp, 12)
    assert.equal(d.inCombat, false)
    assert.equal(d.sleepMeter, undefined)
    assert.equal(d.snareTimer, undefined)
  })
})

describe('hasLineOfSight', () => {
  it('returns true for two points with open floor between them', () => {
    const map = openMap()
    assert.equal(hasLineOfSight(map, 5, 5, 5, 10), true)
  })

  it('returns false when a wall blocks the line', () => {
    const map = openMap()
    for (let y = 0; y < 20; y++) map[y][7].tile = TILE.WALL
    assert.equal(hasLineOfSight(map, 5, 5, 5, 10), false)
  })
})

describe('maybeComputeFOV (cached FOV)', () => {
  it('computes FOV on the first call', () => {
    const map = openMap()
    const player = { x: 5, y: 5 }
    const recomputed = maybeComputeFOV(map, player)
    assert.equal(recomputed, true)
    assert.equal(map[5][5].visible, true)
  })

  it('skips recompute when the player tile and map are unchanged', () => {
    const map = openMap()
    const player = { x: 5, y: 5 }
    maybeComputeFOV(map, player)
    // Dirty a visible tile; a real recompute would restore it to visible.
    map[5][5].visible = false
    const recomputed = maybeComputeFOV(map, player)
    assert.equal(recomputed, false)
    assert.equal(map[5][5].visible, false) // untouched — proves the recompute was skipped
  })

  it('recomputes when the player moves to a new tile', () => {
    const map = openMap()
    const player = { x: 5, y: 5 }
    maybeComputeFOV(map, player)
    map[5][5].visible = false
    player.x = 6
    const recomputed = maybeComputeFOV(map, player)
    assert.equal(recomputed, true)
    assert.equal(map[5][5].visible, true) // restored by the recompute
  })

  it('recomputes when the map reference changes (e.g. descending a level)', () => {
    const map1 = openMap()
    const player = { x: 5, y: 5 }
    maybeComputeFOV(map1, player)
    const map2 = openMap()
    const recomputed = maybeComputeFOV(map2, player)
    assert.equal(recomputed, true)
    assert.equal(map2[5][5].visible, true)
  })

  it('produces the same visibility as a direct computePlayerFOV call', () => {
    const cached = openMap()
    const direct = openMap()
    const player = { x: 8, y: 8 }
    maybeComputeFOV(cached, player)
    computePlayerFOV(direct, { x: 8, y: 8 })
    for (let y = 0; y < cached.length; y++)
      for (let x = 0; x < cached[0].length; x++)
        assert.equal(cached[y][x].visible, direct[y][x].visible, `mismatch at ${x},${y}`)
  })
})

describe('computePlayerFOV (radius-bounded clear)', () => {
  it('does not touch far-off tiles when recomputing on the same map', () => {
    // The clear must cost O(radius²), not O(map area): a recompute on the same
    // map should never write `visible` on tiles it never lit. This is the whole
    // point for large/open-world maps. Fails against a full-map clear.
    const map = openMap(40, 40)
    const player = { x: 20, y: 20 }
    computePlayerFOV(map, player) // first compute (may full-clear once)

    let writes = 0
    const far = map[0][0]
    let v = far.visible
    Object.defineProperty(far, 'visible', {
      configurable: true,
      get: () => v,
      set: (nv) => { writes++; v = nv },
    })

    player.x = 21
    computePlayerFOV(map, player) // recompute on the same map
    assert.equal(writes, 0, 'far-off tile must not be cleared by a bounded recompute')
  })

  it('clears tiles that fall out of range when the player moves away', () => {
    // A tile visible from the old position but out of radius from the new one
    // must go dark. A naive "clear only a box around the new center" would leave
    // it stale; clearing the previously-lit set gets it right.
    const map = openMap(40, 40)
    const player = { x: 20, y: 20 }
    computePlayerFOV(map, player, 8)
    assert.equal(map[20][12].visible, true) // distance 8, in view

    player.x = 28 // moved +8; (20,12) is now distance 16 — out of range
    computePlayerFOV(map, player, 8)
    assert.equal(map[20][12].visible, false, 'tile out of range must be cleared')
    assert.equal(map[20][28].visible, true, 'tile at new center must be lit')
  })

  it('clears stale visibility carried by a freshly-entered map', () => {
    // Revisiting a level: its tiles may still carry `visible=true` from a prior
    // visit. Entering a new map must full-clear so old sight does not leak in.
    const map1 = openMap(40, 40)
    const player = { x: 20, y: 20 }
    computePlayerFOV(map1, player)

    const map2 = openMap(40, 40)
    map2[2][2].visible = true // stale flag from a "previous visit", far from player
    maybeComputeFOV(map2, player)
    assert.equal(map2[2][2].visible, false, 'stale visibility on a new map must be cleared')
  })
})

describe('boss-drop and exit-door factories', () => {
  it('makeKey produces a key entity', () => {
    assert.deepEqual(makeKey(3, 4), { type: 'key', x: 3, y: 4 })
  })

  it('makeExitDoor produces a locked exit door using door frames', () => {
    const d = makeExitDoor(5, 6)
    assert.equal(d.type, 'door')
    assert.equal(d.x, 5); assert.equal(d.y, 6)
    assert.equal(d.locked, true)
    assert.equal(d.isExit, true)
    assert.equal(d.frame, 0)
    assert.equal(d.opening, false)
  })

  it('makeTreasure carries its weapon type', () => {
    const t = makeTreasure(7, 8, 'axe')
    assert.equal(t.type, 'treasure')
    assert.equal(t.x, 7); assert.equal(t.y, 8)
    assert.equal(t.weaponType, 'axe')
  })
})

describe('makePlayer', () => {
  it('starts with a full stamina tank and no mana fields', () => {
    const p = makePlayer(1, 1)
    assert.equal(p.stamina, 100)
    assert.equal(p.maxStamina, 100)
    assert.equal(p.staminaRegenT, 0)
    assert.equal(p.mana, undefined)
    assert.equal(p.manaRegenT, undefined)
    assert.equal(p.magicCooldown, 0)
  })
})

describe('RANGED_WEAPON_TYPES (bows only)', () => {
  it('every row draws from a shared ammo pool with a positive bundle size', () => {
    for (const [type, def] of Object.entries(RANGED_WEAPON_TYPES)) {
      assert.ok(AMMO_KINDS.includes(def.ammoKind), `${type}.ammoKind must be one of ${AMMO_KINDS}`)
      assert.ok(Number.isFinite(def.bundle) && def.bundle > 0, `${type}.bundle must be positive`)
      assert.equal(def.maxAmmo, undefined, `${type} must not carry a per-weapon maxAmmo any more`)
    }
  })

  it('has exactly the six spec rows', () => {
    assert.deepEqual(Object.keys(RANGED_WEAPON_TYPES).sort(),
      ['crossbow', 'hunterbow', 'longbow', 'shortbow', 'sling', 'splitbow'])
  })

  it('makeRangedContents("crossbow") carries its heavy/knockback/pierce flags and no ammo fields', () => {
    const c = makeRangedContents('crossbow')
    assert.equal(c.type, 'ranged')
    assert.equal(c.weaponType, 'crossbow')
    assert.equal(c.ammoKind, 'bolt')
    assert.equal(c.bundle, 8)
    assert.equal(c.heavy, true)
    assert.equal(c.knockback, 45)
    assert.equal(c.piercesShield, true)
    assert.equal('ammo' in c, false)
    assert.equal('maxAmmo' in c, false)
  })

  it('makeRangedContents falls back to shortbow for an unknown type', () => {
    assert.equal(makeRangedContents('nope').weaponType, 'shortbow')
  })

  it('longbow carries the draw flag, splitbow the fork spec, sling the stun', () => {
    assert.equal(makeRangedContents('longbow').draw, true)
    assert.deepEqual(makeRangedContents('splitbow').fork, { after: 32, count: 3, spread: Math.PI / 9 })
    assert.equal(makeRangedContents('sling').stun, 0.5)
  })
})

describe('WAND_TYPES', () => {
  it('has exactly the six spec rows', () => {
    assert.deepEqual(Object.keys(WAND_TYPES).sort(),
      ['blinkwand', 'bramblewand', 'firewand', 'frostwand', 'sparkwand', 'stormwand'])
  })

  it('makeWandContents("stormwand") carries the lightning spell', () => {
    const w = makeWandContents('stormwand')
    assert.equal(w.type, 'wand')
    assert.equal(w.weaponType, 'stormwand')
    assert.equal(w.spell, 'lightning')
    assert.equal(w.color, '#a78bfa')
  })

  it('makeWandContents falls back to sparkwand for an unknown type', () => {
    assert.equal(makeWandContents('nope').weaponType, 'sparkwand')
  })
})

describe('ammo pool', () => {
  it('AMMO_KINDS and AMMO_CAPS match the spec', () => {
    assert.deepEqual(AMMO_KINDS, ['arrow', 'bolt', 'stone'])
    assert.deepEqual(AMMO_CAPS, { arrow: 40, bolt: 24, stone: 60 })
  })

  it('emptyAmmo starts every kind at zero', () => {
    assert.deepEqual(emptyAmmo(), { arrow: 0, bolt: 0, stone: 0 })
  })
})
