import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TALENTS, hasTalent, grantTalent, RUSH_START_TALENTS, applyTalents, HEART_BONUS } from '../renderer/systems/talents.js'
import { adventureRespawn } from '../renderer/systems/cave.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const mkState = () => ({ player: { talents: [] }, feedback: makeFeedback() })

describe('talent registry', () => {
  it('defines ski-legs and no stance talents', () => {
    assert.ok('ski_legs' in TALENTS)
    for (const stance of ['marksmanship', 'gust', 'might']) assert.ok(!(stance in TALENTS), `${stance} is a talent again`)
  })

  it('a rush run starts with every talent', () => {
    // Dungeon Rush keeps the talents it always had; the tales' rewards are the Wilds' own
    assert.deepEqual([...RUSH_START_TALENTS], ['ski_legs'])
    for (const id of ['lake_breath', 'tapio_peace', 'sinituli']) assert.ok(TALENTS[id]?.name && TALENTS[id]?.desc, `no talent ${id}`)
  })
})

describe('grantTalent', () => {
  it('grants once, reports newness, and celebrates', () => {
    const state = mkState()
    assert.equal(grantTalent(state, 'ski_legs'), true)
    assert.ok(hasTalent(state.player, 'ski_legs'))
    assert.equal(grantTalent(state, 'ski_legs'), false)     // idempotent
    assert.deepEqual(state.player.talents, ['ski_legs'])
  })

  it('refuses unknown ids', () => {
    const state = mkState()
    assert.equal(grantTalent(state, 'levitation'), false)
    assert.equal(grantTalent(state, 'magic_stance'), false)
    assert.deepEqual(state.player.talents, [])
  })

  it('tolerates a player without a talents array', () => {
    const state = { player: {}, feedback: makeFeedback() }
    assert.equal(grantTalent(state, 'ski_legs'), true)
    assert.ok(hasTalent(state.player, 'ski_legs'))
    assert.equal(hasTalent({ }, 'ski_legs'), false)
  })

  it('queues a talent-learned cue only when newly learned', () => {
    const state = { player: {}, feedback: makeFeedback(), sfx: makeSfx() }
    grantTalent(state, 'ski_legs')
    assert.deepEqual(state.sfx.cues.map(c => c.name), ['talent-learned'])
    grantTalent(state, 'ski_legs')          // already known — no new cue
    assert.equal(state.sfx.cues.length, 1)
  })
})

describe('ski-legs', () => {
  it('is a real talent with a name and a description', () => {
    assert.ok(TALENTS.ski_legs?.name)
    assert.ok(TALENTS.ski_legs?.desc)
  })
  it('grants once and reports only the first time', () => {
    const state = mkState()
    assert.equal(grantTalent(state, 'ski_legs'), true)
    assert.equal(grantTalent(state, 'ski_legs'), false)
    assert.equal(hasTalent(state.player, 'ski_legs'), true)
  })
})

// The three tribes' rewards (docs/superpowers/specs/2026-11-27-three-tribes-design.md).
describe('the tribes\' talents', () => {
  const body = (over = {}) => ({ talents: [], hp: 10, maxHp: 10, ...over })
  const mk = over => ({ player: body(over), feedback: makeFeedback(), sfx: makeSfx() })

  it('are in the registry with a name and a line each, and no Rush run starts with them', () => {
    assert.equal(TALENTS.kivinahka.name, 'Kivinahka')
    assert.equal(TALENTS.kaarmeenkieli.name, 'Käärmeenkieli')
    assert.equal(TALENTS.mursun_sydan.name, 'Mursun sydän')
    for (const id of ['kivinahka', 'kaarmeenkieli', 'mursun_sydan']) {
      assert.ok(TALENTS[id].desc)
      assert.ok(!RUSH_START_TALENTS.includes(id))
    }
  })

  it('Mursun sydän: two more at the grant, and mended by as much, once', () => {
    const s = mk({ hp: 4 })
    assert.equal(grantTalent(s, 'mursun_sydan'), true)
    assert.equal(HEART_BONUS, 2)
    assert.equal(s.player.maxHp, 12)
    assert.equal(s.player.hp, 6)
    assert.equal(grantTalent(s, 'mursun_sydan'), false)
    assert.equal(s.player.maxHp, 12)
    assert.equal(s.player.hp, 6)
  })

  it('a body built anew with the talent (a save loaded, a new run) comes out with twelve, however often it is settled', () => {
    const p = body({ talents: ['mursun_sydan'] })
    applyTalents(p)
    assert.equal(p.maxHp, 12)
    assert.equal(p.hp, 12)
    applyTalents(p)
    applyTalents(p)
    assert.equal(p.maxHp, 12)
    assert.equal(p.hp, 12)
    // a kit that raised the body first keeps its own on top
    const kit = body({ talents: ['mursun_sydan'], hp: 14, maxHp: 14 })
    applyTalents(kit)
    assert.equal(kit.maxHp, 16)
    // a body without it is left alone
    const plain = body({ hp: 7 })
    applyTalents(plain)
    assert.equal(plain.hp, 7)
    assert.equal(plain.maxHp, 10)
  })

  it('a hero who wakes after death wakes with all twelve', () => {
    const s = mk()
    grantTalent(s, 'mursun_sydan')
    s.player.hp = 0
    const woke = adventureRespawn({ ...s, map: [], entities: [] }, { x: 3, y: 3 })
    applyTalents(woke.player)
    assert.equal(woke.player.maxHp, 12)
    assert.equal(woke.player.hp, 12)
    assert.ok(hasTalent(woke.player, 'mursun_sydan'))
  })

  it('a body that no longer has the talent gives the two back', () => {
    const p = body({ talents: ['mursun_sydan'] })
    applyTalents(p)
    p.talents = []
    applyTalents(p)
    assert.equal(p.maxHp, 10)
    assert.equal(p.hp, 10)
  })

  it('Käärmeenkieli: learning it clears the poison already in him', () => {
    const s = mk({ poison: { left: 3, next: 2, wash: 0 } })
    grantTalent(s, 'kaarmeenkieli')
    assert.equal(s.player.poison, undefined)
  })

  it('a hero with no hearts of his own to settle (the arena\'s) is left as he is', () => {
    const h = { hp: 20, maxHp: 20 }
    applyTalents(h)
    assert.equal(h.hp, 20)
    assert.equal(h.maxHp, 20)
    assert.equal('talentHp' in h, false)
  })
})
