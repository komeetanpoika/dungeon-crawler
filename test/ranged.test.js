import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeRangedContents, makePlayer } from '../renderer/systems/entities.js'
import {
  nextStance, startStanceSwitch, tickStanceSwitch, STANCE_SWITCH_DURATION,
  tryFire, FIRE_FAIL_MESSAGES, noAmmoMessage,
  DRAW_CHARGE, resolveDrawTier, shouldAutoReleaseDraw,
} from '../renderer/systems/ranged.js'

// Full ammo pool — plenty for every test so only the assertion under test
// drives it to zero (tests that need 0 ammo set it explicitly).
function fullAmmo() {
  return { arrow: 10, bolt: 10, stone: 10 }
}

function armedPlayer(weaponType, over = {}) {
  return {
    ...makePlayer(1, 1),
    talents: ['ranged_stance'],
    ranged: makeRangedContents(weaponType),
    ammo: fullAmmo(),
    rangedCooldown: 0,
    ...over,
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

  it('cycles even with no ranged weapon or empty ammo pool', () => {
    const p = armedPlayer('shortbow', { ammo: { arrow: 0, bolt: 0, stone: 0 } })
    assert.equal(nextStance(p), 'ranged')
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

  it('starting a switch drops any charge in progress', () => {
    // A draw or spell charge belongs to the stance that started it: left
    // standing it would keep the move-speed penalty and the charge ring
    // forever, since the release branch for that stance no longer runs.
    const p = learned()
    p.charging = { t: 0.5, kind: 'draw' }
    assert.equal(startStanceSwitch(p), 'ranged')
    assert.equal(p.charging, null)
  })

  it('a refused switch leaves the charge alone', () => {
    const p = { ...makePlayer(1, 1), talents: [] }
    p.charging = { t: 0.5, kind: 'draw' }
    assert.equal(startStanceSwitch(p), null)
    assert.deepEqual(p.charging, { t: 0.5, kind: 'draw' })
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

describe('DRAW_CHARGE / resolveDrawTier / shouldAutoReleaseDraw', () => {
  it('matches the spec thresholds', () => {
    assert.deepEqual(DRAW_CHARGE, { full: 0.4, over: 0.9, moveFactor: 0.6 })
  })

  it('resolves tap below full, full between full and over, over at/above over', () => {
    assert.equal(resolveDrawTier(0), 'tap')
    assert.equal(resolveDrawTier(0.39), 'tap')
    assert.equal(resolveDrawTier(0.4), 'full')
    assert.equal(resolveDrawTier(0.89), 'full')
    assert.equal(resolveDrawTier(0.9), 'over')
    assert.equal(resolveDrawTier(5), 'over')
  })

  it('auto-releases only once held exceeds over + 0.5s', () => {
    assert.equal(shouldAutoReleaseDraw(1.4), false)   // exactly over + 0.5
    assert.equal(shouldAutoReleaseDraw(1.41), true)
    assert.equal(shouldAutoReleaseDraw(0.9), false)
  })
})

describe('tryFire — gating', () => {
  it('refuses without the ranged_stance talent and spends nothing', () => {
    const p = armedPlayer('shortbow', { talents: [] })
    assert.deepEqual(tryFire(p), { ok: false, reason: 'not_learned' })
    assert.equal(p.ammo.arrow, 10)
  })

  it('refuses without a weapon', () => {
    const p = armedPlayer('shortbow', { ranged: null })
    assert.deepEqual(tryFire(p), { ok: false, reason: 'no_weapon' })
  })

  it('refuses when the shared ammo pool for this weapon\'s kind is at 0', () => {
    const p = armedPlayer('shortbow', { ammo: { arrow: 0, bolt: 10, stone: 10 } })
    assert.deepEqual(tryFire(p), { ok: false, reason: 'no_ammo' })
    assert.equal(p.rangedCooldown, 0)   // cooldown never started
  })

  it('refuses during cooldown without spending ammo', () => {
    const p = armedPlayer('shortbow', { rangedCooldown: 0.3 })
    assert.deepEqual(tryFire(p), { ok: false, reason: 'cooldown' })
    assert.equal(p.ammo.arrow, 10)
  })

  it('gates on the pooled ammo kind, not weapon identity: crossbow with bolts empty', () => {
    const p = armedPlayer('crossbow', { ammo: { arrow: 10, bolt: 0, stone: 10 } })
    assert.deepEqual(tryFire(p), { ok: false, reason: 'no_ammo' })
  })
})

describe('tryFire — success shapes and flags per weapon', () => {
  it('shortbow: plain arrow, spends 1 arrow, starts cooldown, damage from the bow not melee', () => {
    const p = armedPlayer('shortbow', { weapon: { weaponType: 'sword', name: 'Sword', damage: 99 } })
    const res = tryFire(p)
    assert.deepEqual(res, { ok: true, damage: 2, color: '#facc15', shape: 'arrow', ammoKind: 'arrow' })
    assert.equal(p.ammo.arrow, 9)
    assert.equal(p.rangedCooldown, 0.6)
  })

  it('hunterbow: plain arrow, its own (short) cooldown', () => {
    const p = armedPlayer('hunterbow')
    const res = tryFire(p)
    assert.deepEqual(res, { ok: true, damage: 1, color: '#facc15', shape: 'arrow', ammoKind: 'arrow' })
    assert.equal(p.rangedCooldown, 0.3)
  })

  it('longbow tap: no bonus, no pierce', () => {
    const p = armedPlayer('longbow')
    assert.deepEqual(tryFire(p, 'tap'), { ok: true, damage: 3, color: '#facc15', shape: 'arrow', ammoKind: 'arrow' })
  })

  it('longbow defaults to tap when no tier is given', () => {
    const p = armedPlayer('longbow')
    assert.deepEqual(tryFire(p), { ok: true, damage: 3, color: '#facc15', shape: 'arrow', ammoKind: 'arrow' })
  })

  it('longbow full: +1 damage, pierce 1', () => {
    const p = armedPlayer('longbow')
    assert.deepEqual(tryFire(p, 'full'), { ok: true, damage: 4, color: '#facc15', shape: 'arrow', ammoKind: 'arrow', pierce: 1 })
  })

  it('longbow over: +2 damage, infinite pierce', () => {
    const p = armedPlayer('longbow')
    assert.deepEqual(tryFire(p, 'over'), { ok: true, damage: 5, color: '#facc15', shape: 'arrow', ammoKind: 'arrow', pierce: Infinity })
  })

  it('a non-draw bow ignores the tier argument entirely', () => {
    const p = armedPlayer('shortbow')
    assert.deepEqual(tryFire(p, 'over'), { ok: true, damage: 2, color: '#facc15', shape: 'arrow', ammoKind: 'arrow' })
  })

  it('splitbow: carries its fork spec', () => {
    const p = armedPlayer('splitbow')
    const res = tryFire(p)
    assert.deepEqual(res.fork, { after: 32, count: 3, spread: Math.PI / 9 })
    assert.equal(res.shape, 'arrow')
  })

  it('crossbow: quarrel shape, knockback onHit, piercesShield, spends a bolt', () => {
    const p = armedPlayer('crossbow')
    const res = tryFire(p)
    assert.deepEqual(res, {
      ok: true, damage: 5, color: '#e5e7eb', shape: 'quarrel', ammoKind: 'bolt',
      onHit: { knockback: 45 }, piercesShield: true,
    })
    assert.equal(p.ammo.bolt, 9)
  })

  it('sling: stone shape, stun onHit, spends a stone', () => {
    const p = armedPlayer('sling')
    const res = tryFire(p)
    assert.deepEqual(res, {
      ok: true, damage: 1, color: '#a8a29e', shape: 'stone', ammoKind: 'stone',
      onHit: { stun: 0.5 },
    })
    assert.equal(p.ammo.stone, 9)
  })
})

describe('FIRE_FAIL_MESSAGES / noAmmoMessage', () => {
  it('keeps the weaponless and not-learned lines; cooldown stays silent', () => {
    assert.equal(typeof FIRE_FAIL_MESSAGES.no_weapon, 'string')
    assert.equal(typeof FIRE_FAIL_MESSAGES.not_learned, 'string')
    assert.equal(FIRE_FAIL_MESSAGES.cooldown, undefined)
  })

  it('no longer carries a single generic no_ammo line — that is per ammo kind now', () => {
    assert.equal(FIRE_FAIL_MESSAGES.no_ammo, undefined)
  })

  it('names the ammo kind that ran out', () => {
    assert.equal(noAmmoMessage('arrow'), 'Out of arrows!')
    assert.equal(noAmmoMessage('bolt'), 'Out of bolts!')
    assert.equal(noAmmoMessage('stone'), 'Out of stones!')
  })
})
