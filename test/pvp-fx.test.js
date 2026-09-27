// PvP 2a's visuals: the pure helpers in renderer/render/pvp-fx.js.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { comboShake, holdArrows, fenceGlints, drawGlow, BUFF_ICON, spotLook, heroLooks } from '../renderer/render/pvp-fx.js'
import { WARRIOR_COMBOS, DOUBLE_SHOT, BUFF_KINDS, BUFF_COLORS } from '../renderer/data/pvp.js'
import { SPRITES } from '../renderer/render/sprites.js'
import { makeHero } from '../renderer/pvp/hero.js'
import { grantBuff } from '../renderer/pvp/buffs.js'
import { buffRowModel } from '../renderer/ui/pvp-hud.js'

describe('pvp fx helpers', () => {
  it('comboShake: only a whirl shakes, fading over its life', () => {
    assert.equal(comboShake({ move: null }), 0)
    assert.equal(comboShake({ move: { kind: 'lunge', t: 0 } }), 0)
    assert.equal(comboShake({ move: { kind: 'whirl', t: 0 } }), 5)
    assert.equal(comboShake({ move: { kind: 'whirl', t: WARRIOR_COMBOS.fxDur } }), 0)
    assert.equal(comboShake(null), 0)
  })
  it('holdArrows: one per move, centred over the head', () => {
    assert.deepEqual(holdArrows({ moves: [] }), [])
    const a = holdArrows({ moves: ['e', 'w'] })
    assert.deepEqual(a.map(x => [x.dir, x.dx]), [['e', -4], ['w', 4]])
    assert.equal(a[1].angle, Math.PI)
  })
  it('fenceGlints: each thrust glints for 0.18 s from its time (m7: widened from 0.12 for visibility)', () => {
    assert.deepEqual(fenceGlints({ kind: 'fence', t: 0 }).map(g => g.i), [0])
    assert.deepEqual(fenceGlints({ kind: 'fence', t: 0.19 }).map(g => g.i), [1])
    assert.deepEqual(fenceGlints({ kind: 'fence', t: 0.31 }).map(g => g.i), [2])
    assert.deepEqual(fenceGlints({ kind: 'lunge', t: 0 }), [])
    const mid = fenceGlints({ kind: 'fence', t: 0.09 })[0]
    assert.equal(mid.i, 0)
    assert.ok(Math.abs(mid.alpha - 0.5) < 1e-9, `alpha ${mid.alpha}`)
  })
  it('drawGlow: the band colour of the draw reached, dim below 30 %', () => {
    assert.equal(drawGlow({ charging: null }), null)
    assert.equal(drawGlow({ charging: { t: 0.1, kind: 'double' } }).color, 'rgba(255,255,255,0.35)')
    const full = drawGlow({ charging: { t: DOUBLE_SHOT.full, kind: 'double' } })
    assert.equal(full.color, DOUBLE_SHOT.bands[0].color)
    assert.equal(full.full, true)
  })
})

describe('2b looks', () => {
  it('every buff has its own atlas icon', () => {
    assert.deepEqual(Object.keys(BUFF_ICON), BUFF_KINDS)
    for (const k of BUFF_KINDS) assert.ok(SPRITES[BUFF_ICON[k]], k)
    assert.equal(new Set(BUFF_KINDS.map(k => SPRITES[BUFF_ICON[k]])).size, 5, 'five different pictures')
  })
  it('spotLook: an up spot shows its buff; a down one the ghost of its next at 30 %; a major is larger, rimmed and pulsing', () => {
    const up = spotLook({ tier: 'minor', up: true, buff: 'ward', next: null })
    assert.deepEqual(up, { key: 'buff_ward', kind: 'ward', alpha: 1, scale: 1, rim: false, pulse: 0 })
    const ghost = spotLook({ tier: 'minor', up: false, buff: null, next: 'venom' })
    assert.equal(ghost.key, 'buff_venom'); assert.equal(ghost.alpha, 0.3)
    const a = spotLook({ tier: 'major', up: true, buff: 'haste' }, 0), b = spotLook({ tier: 'major', up: true, buff: 'haste' }, 0.6)
    assert.equal(a.rim, true)
    assert.ok(a.scale > 1.25 && b.scale > 1.25)
    assert.notEqual(a.scale, b.scale, 'the pulse moves')
  })
  it('heroLooks: each buff, the ward bubble by the pool left, the burn and the poison', () => {
    const h = makeHero({ id: 'a', name: 'A', cls: 'mage' })
    assert.deepEqual(heroLooks(h), { haste: false, might: false, ward: 0, edge: null, burning: false, poisoned: false })
    grantBuff(h, 'haste', 'minor'); grantBuff(h, 'might', 'major'); grantBuff(h, 'ward', 'major'); grantBuff(h, 'ember', 'minor')
    h.buffs.ward.pool = 1
    h.burn = { owner: 'x', t: 1, next: 1 }; h.poison = { owner: 'x', t: 0.5, next: 1 }
    assert.deepEqual(heroLooks(h), { haste: true, might: true, ward: 0.25, edge: 'ember', burning: true, poisoned: true })
  })
  it("buffRowModel: one icon per buff held, a countdown fraction, the buff's colour; nothing when dead", () => {
    const h = makeHero({ id: 'a', name: 'A', cls: 'archer' })
    assert.deepEqual(buffRowModel(h), [])
    grantBuff(h, 'venom', 'major'); grantBuff(h, 'haste', 'minor')
    h.buffs.haste.t = 2
    const row = buffRowModel(h)
    assert.deepEqual(row.map(b => [b.kind, b.tier, b.frac, b.color]), [['haste', 'minor', 0.25, BUFF_COLORS.haste], ['venom', 'major', 1, BUFF_COLORS.venom]])
    assert.equal(row[1].src, `./assets/tiles/${SPRITES.buff_venom}.png`)
    h.dead = true
    assert.deepEqual(buffRowModel(h), [])
  })
})
