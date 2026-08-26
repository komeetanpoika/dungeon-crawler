import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RANGED_WEAPON_TYPES, makeRangedContents, makePlayer } from '../renderer/systems/entities.js'
import { nextStance, startStanceSwitch, tickStanceSwitch, STANCE_SWITCH_DURATION,
  tryFire, FIRE_FAIL_MESSAGES } from '../renderer/systems/ranged.js'

describe('RANGED_WEAPON_TYPES', () => {
  it('defines the five-weapon roster with full stat blocks', () => {
    assert.deepEqual(Object.keys(RANGED_WEAPON_TYPES), ['shortbow', 'longbow', 'sparkwand', 'stormwand', 'firewand'])
    for (const [wt, def] of Object.entries(RANGED_WEAPON_TYPES)) {
      assert.equal(typeof def.name, 'string', wt)
      assert.ok(def.damage > 0 && def.maxAmmo > 0 && def.cooldown > 0, wt)
      assert.match(def.color, /^#[0-9a-f]{6}$/, wt)
      assert.ok(def.kind === 'bow' || def.kind === 'wand', wt)
    }
  })

  it('bows are bows and wands are wands', () => {
    assert.equal(RANGED_WEAPON_TYPES.shortbow.kind, 'bow')
    assert.equal(RANGED_WEAPON_TYPES.longbow.kind, 'bow')
    assert.equal(RANGED_WEAPON_TYPES.sparkwand.kind, 'wand')
    assert.equal(RANGED_WEAPON_TYPES.stormwand.kind, 'wand')
    assert.equal(RANGED_WEAPON_TYPES.firewand.kind, 'wand')
  })
})

describe('makeRangedContents', () => {
  it('builds full-ammo chest contents from a weapon type', () => {
    const c = makeRangedContents('stormwand')
    assert.deepEqual(c, {
      type: 'ranged', weaponType: 'stormwand', name: 'Storm Wand',
      damage: 5, ammo: 6, maxAmmo: 6, cooldown: 0.8, color: '#a78bfa', kind: 'wand',
    })
  })

  it('falls back to shortbow for unknown types', () => {
    assert.equal(makeRangedContents('bazooka').weaponType, 'shortbow')
    assert.equal(makeRangedContents().weaponType, 'shortbow')
  })

  it('firewand carries the explodes flag; others stay flag-free', () => {
    const c = makeRangedContents('firewand')
    assert.equal(c.explodes, true)
    assert.deepEqual(
      { name: c.name, damage: c.damage, ammo: c.ammo, cooldown: c.cooldown },
      { name: 'Fireball Wand', damage: 4, ammo: 5, cooldown: 1.0 })
    assert.ok(!('explodes' in makeRangedContents('stormwand')))
  })
})

describe('makePlayer ranged fields', () => {
  it('starts with no ranged weapon, in melee stance', () => {
    const p = makePlayer(1, 1)
    assert.equal(p.ranged, null)
    assert.equal(p.attackMode, 'melee')
  })
})

function armedPlayer(over = {}) {
  return {
    ...makePlayer(1, 1), rangedCooldown: 0, ranged: makeRangedContents('shortbow'),
    talents: ['ranged_stance'], ...over,
  }
}

describe('nextStance', () => {
  it('cycles melee -> ranged -> magic -> melee among learned stances without flipping', () => {
    const p = { ...makePlayer(1, 1), talents: ['ranged_stance', 'magic_stance'] }
    assert.equal(nextStance(p), 'ranged')
    assert.equal(p.attackMode, 'melee')      // pure query, no mutation
    p.attackMode = 'ranged'
    assert.equal(nextStance(p), 'magic')
    p.attackMode = 'magic'
    assert.equal(nextStance(p), 'melee')
  })

  it('skips unlearned stances and returns null with nothing else learned', () => {
    assert.equal(nextStance({ attackMode: 'melee', talents: ['magic_stance'] }), 'magic')
    assert.equal(nextStance({ attackMode: 'melee', talents: [] }), null)
  })

  it('cycles even with no ranged weapon or empty ammo', () => {
    const empty = armedPlayer()
    empty.ranged.ammo = 0
    assert.equal(nextStance(empty), 'ranged')
  })
})

describe('stance switching', () => {
  const learned = () => ({ ...makePlayer(1, 1), talents: ['ranged_stance', 'magic_stance'] })

  it('startStanceSwitch begins a timed transition without flipping the mode yet', () => {
    const p = learned()
    assert.equal(startStanceSwitch(p), 'ranged')
    assert.equal(p.attackMode, 'melee')
    assert.deepEqual(p.stanceSwitch, { from: 'melee', to: 'ranged', t: 0, dur: STANCE_SWITCH_DURATION })
  })

  it('returns null when only melee is known and starts nothing', () => {
    const p = { ...makePlayer(1, 1), talents: [] }
    assert.equal(startStanceSwitch(p), null)
    assert.equal(p.stanceSwitch, undefined)
  })

  it('ignores Shift while a switch is already running', () => {
    const p = learned()
    startStanceSwitch(p)
    tickStanceSwitch(p, 0.3)
    assert.equal(startStanceSwitch(p), false)
    assert.equal(p.stanceSwitch.to, 'ranged')
    assert.equal(p.stanceSwitch.t, 0.3)      // untouched, no restart
  })

  it('tickStanceSwitch flips the mode exactly once the duration elapses', () => {
    const p = learned()
    startStanceSwitch(p)
    assert.equal(tickStanceSwitch(p, STANCE_SWITCH_DURATION - 0.1), null)
    assert.equal(p.attackMode, 'melee')
    assert.equal(tickStanceSwitch(p, 0.2), 'ranged')
    assert.equal(p.attackMode, 'ranged')
    assert.equal(p.stanceSwitch, null)
  })

  it('ticking without an active switch is a no-op', () => {
    const p = learned()
    assert.equal(tickStanceSwitch(p, 1), null)
    assert.equal(p.attackMode, 'melee')
  })

  it('the switch takes 0.7 seconds', () => {
    assert.equal(STANCE_SWITCH_DURATION, 0.7)
  })
})

describe('tryFire', () => {
  it('fires: returns projectile stats, spends 1 ammo, starts the weapon cooldown', () => {
    const p = armedPlayer()
    const res = tryFire(p)
    assert.deepEqual(res, { ok: true, damage: 2, color: '#facc15', shape: 'arrow' })
    assert.equal(p.ranged.ammo, 11)
    assert.equal(p.rangedCooldown, 0.6)
  })

  it('wands fire square bolts', () => {
    const p = armedPlayer({ ranged: makeRangedContents('sparkwand') })
    assert.equal(tryFire(p).shape, 'bolt')
  })

  it('refuses without a weapon and spends nothing', () => {
    const p = armedPlayer({ ranged: null })
    assert.deepEqual(tryFire(p), { ok: false, reason: 'no_weapon' })
    assert.equal(p.rangedCooldown, 0)
  })

  it('refuses at 0 ammo', () => {
    const p = armedPlayer()
    p.ranged.ammo = 0
    assert.deepEqual(tryFire(p), { ok: false, reason: 'no_ammo' })
  })

  it('refuses during cooldown without spending ammo', () => {
    const p = armedPlayer({ rangedCooldown: 0.3 })
    assert.deepEqual(tryFire(p), { ok: false, reason: 'cooldown' })
    assert.equal(p.ranged.ammo, 12)
  })

  it('projectile damage comes from the ranged weapon, never the melee weapon', () => {
    const p = armedPlayer({ weapon: { weaponType: 'maunonmiekka', name: 'Maunonmiekka', damage: 10 } })
    assert.equal(tryFire(p).damage, 2)
  })

  it('has HUD messages for weaponless and empty fails, none for cooldown', () => {
    assert.equal(typeof FIRE_FAIL_MESSAGES.no_weapon, 'string')
    assert.equal(typeof FIRE_FAIL_MESSAGES.no_ammo, 'string')
    assert.equal(FIRE_FAIL_MESSAGES.cooldown, undefined)
  })

  it('firewand shots are exploding bolts', () => {
    const p = armedPlayer({ ranged: makeRangedContents('firewand') })
    assert.deepEqual(tryFire(p), { ok: true, damage: 4, color: '#f97316', shape: 'bolt', explodes: true })
  })

  it('refuses without the ranged_stance talent', () => {
    const p = { talents: [], ranged: { ammo: 5, cooldown: 0.5, damage: 2, color: '#fff', kind: 'bow' }, rangedCooldown: 0 }
    assert.deepEqual(tryFire(p), { ok: false, reason: 'not_learned' })
    assert.equal(p.ranged.ammo, 5)
  })
})
