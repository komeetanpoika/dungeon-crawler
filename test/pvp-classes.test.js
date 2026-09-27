// Sub-project 2a: the numbers, the kits and the time-to-kill.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PVP, KITS, RUNE_POWER, OUTFIT_OVERRIDES, PICKUPS, WARRIOR_COMBOS, DOUBLE_SHOT, SPELL_OVERRIDES,
  CLASS_HINTS, drawFrac, doubleShotBand } from '../renderer/data/pvp.js'
import { makeHero, placeHero } from '../renderer/pvp/hero.js'
import { hurtHero } from '../renderer/pvp/combat.js'
import { STAMINA_MAX } from '../renderer/systems/stamina.js'
import { testMatch } from './pvp-helpers.js'

describe('2a numbers', () => {
  it('time-to-kill: hp 8, plate protect 0, flasks heal half', () => {
    assert.equal(PVP.hp, 8)
    assert.deepEqual(OUTFIT_OVERRIDES.plate, { protect: 0 })
    assert.equal(PICKUPS.flask.heal, 4)
  })
  it('kits and rune: the mage mains the Storm Wand, the rune is the Fireball Wand', () => {
    assert.equal(KITS.mage.loadout.wandType, 'stormwand')
    assert.equal(KITS.mage.loadout.offhand.weaponType, 'blinkwand')
    assert.deepEqual(RUNE_POWER.mage, { wandType: 'firewand' })
    assert.equal(KITS.warrior.loadout.weaponType, 'sword')
    assert.equal(KITS.warrior.loadout.offhand.weaponType, 'buckler')
  })
  it('warrior combos', () => {
    assert.equal(WARRIOR_COMBOS.holdMoveMul, 0.5)
    assert.equal(WARRIOR_COMBOS.moveCost, 25)
    assert.equal(WARRIOR_COMBOS.maxMoves * WARRIOR_COMBOS.moveCost, STAMINA_MAX)
    assert.deepEqual(WARRIOR_COMBOS.lunge, { tiles: 2.5, dur: 0.15, reach: 20, damage: 3 })
    assert.deepEqual(WARRIOR_COMBOS.fence, { times: [0, 0.12, 0.24], reach: 40, damage: 1 })
    assert.deepEqual(WARRIOR_COMBOS.whirl, { reach: 44, damage: 2, knockback: 40, cooldownMul: 1.5 })
    assert.ok(WARRIOR_COMBOS.fxDur > WARRIOR_COMBOS.fence.times.at(-1) + PVP.tick, 'the last thrust fires inside the effect')
  })
  it('double shot: 1.2 s draw, bands 1-5 from 30 %, 0.8 s cooldown, arrows 12 px apart', () => {
    assert.equal(DOUBLE_SHOT.full, 1.2); assert.equal(DOUBLE_SHOT.moveMul, 0.6)
    assert.equal(DOUBLE_SHOT.gap, 12); assert.equal(DOUBLE_SHOT.cooldown, 0.8)
    const dmg = f => doubleShotBand(f)?.damage ?? null
    assert.deepEqual([0, 0.29, 0.3, 0.39, 0.4, 0.54, 0.55, 0.69, 0.7, 0.84, 0.85, 1].map(dmg),
      [null, null, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
    assert.equal(drawFrac(0.6), 0.5); assert.equal(drawFrac(5), 1)
  })
  it('spell overrides and class hints', () => {
    assert.deepEqual(SPELL_OVERRIDES.lightning, { cooldown: 1.5, delay: 0.4, damage: 3, stun: 0.6 })
    assert.deepEqual(SPELL_OVERRIDES.fireball, { burst: 2 })
    assert.deepEqual(CLASS_HINTS, { warrior: 'Hold attack + stick: combos', archer: 'Hold Q: double shot', mage: 'Storm Wand · Q: blink' })
  })
})

describe('time-to-kill', () => {
  // Sword blows (2 damage) until the target drops; i-frames are waited out.
  const blowsToKill = cls => {
    const w = makeHero({ id: 'w', name: 'w', cls: 'warrior' }); placeHero(w, { x: 4, y: 5 })
    const t = makeHero({ id: 't', name: 't', cls }); placeHero(t, { x: 5, y: 5 })
    const m = testMatch([w, t])
    let n = 0
    while (t.hp > 0 && n < 20) { t.invulnTimer = 0; hurtHero(m, t, 2, { by: w, melee: true }); n++ }
    return n
  }
  it('a sword kills a Warrior, an Archer and a Mage in 4 hits each', () => {
    assert.equal(blowsToKill('warrior'), 4)
    assert.equal(blowsToKill('archer'), 4)
    assert.equal(blowsToKill('mage'), 4)
  })
})
