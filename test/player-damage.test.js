import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { damagePlayer, INVULN_DURATION, setDamageObserver } from '../renderer/systems/player-damage.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { makePlayer, makeShieldContents, makeWornContents } from '../renderer/systems/entities.js'

const worn = key => { const { type, ...p } = makeWornContents(key); return p }
const cuirass = () => worn('plate'), jerkin = () => worn('leather')

function freshState() {
  return { player: { px: 40, py: 60, hp: 10 }, feedback: makeFeedback() }
}

describe('damagePlayer', () => {
  it("'hit' applies damage, sets invuln, returns true", () => {
    const s = freshState()
    const applied = damagePlayer(s, 3, 'hit')
    assert.equal(applied, true)
    assert.equal(s.player.hp, 7)
    assert.equal(s.player.invulnTimer, INVULN_DURATION)
  })

  it("'hit' is blocked while invulnerable (no damage, returns false)", () => {
    const s = freshState()
    s.player.invulnTimer = 0.5
    const applied = damagePlayer(s, 3, 'hit')
    assert.equal(applied, false)
    assert.equal(s.player.hp, 10)
  })

  it("'dot' always applies and never sets invuln", () => {
    const s = freshState()
    const applied = damagePlayer(s, 1, 'dot')
    assert.equal(applied, true)
    assert.equal(s.player.hp, 9)
    assert.equal(s.player.invulnTimer, undefined)
  })

  it("'dot' applies even while invulnerable, leaving invuln untouched", () => {
    const s = freshState()
    s.player.invulnTimer = 0.5
    damagePlayer(s, 1, 'dot')
    assert.equal(s.player.hp, 9)
    assert.equal(s.player.invulnTimer, 0.5)
  })

  it('queues a player-hurt cue when damage lands', () => {
    const state = freshState()
    state.sfx = makeSfx()
    damagePlayer(state, 3, 'hit')
    assert.deepEqual(state.sfx.cues.map(c => c.name), ['player-hurt'])
    assert.equal(state.sfx.cues[0].px, state.player.px)
  })

  it('queues no cue when i-frames block the hit', () => {
    const state = freshState()
    state.sfx = makeSfx()
    state.player.invulnTimer = 0.5
    damagePlayer(state, 3, 'hit')
    assert.equal(state.sfx.cues.length, 0)
  })
})

describe('damagePlayer with a shield and armour', () => {
  const dressed = (over = {}) => {
    const p = { ...makePlayer(1, 1), px: 40, py: 60, hp: 10, facing: 'east', stamina: 100, ...over }
    return { player: p, feedback: makeFeedback(), sfx: makeSfx() }
  }
  it('a raised shield absorbs a frontal hit: no damage, no i-frames, returns false', () => {
    const s = dressed({ blocking: true })
    const { type, ...b } = makeShieldContents('buckler'); s.player.gear.melee.off = { kind: 'shield', ...b }
    assert.equal(damagePlayer(s, 3, 'hit', { px: 80, py: 60 }), false)
    assert.equal(s.player.hp, 10)
    assert.equal(s.player.invulnTimer ?? 0, 0)
    assert.equal(s.player.stamina, 92)
  })
  it('a hit from behind, a hit with no position, and a dot all get through a raised shield', () => {
    const s = dressed({ blocking: true })
    const { type, ...b } = makeShieldContents('buckler'); s.player.gear.melee.off = { kind: 'shield', ...b }
    assert.equal(damagePlayer(s, 1, 'hit', { px: 0, py: 60 }), true)
    s.player.invulnTimer = 0
    assert.equal(damagePlayer(s, 1, 'hit'), true)
    assert.equal(damagePlayer(s, 1, 'dot', { px: 80, py: 60 }), true)
    assert.equal(s.player.hp, 7)
  })
  it('the played character\'s armor takes a blow before hp, but not a dot (more in worn.test.js)', () => {
    const s = dressed()
    s.player.gear.melee.armor = cuirass()             // 5 armor
    assert.equal(damagePlayer(s, 3, 'hit'), true)
    assert.equal(s.player.hp, 10)
    assert.equal(s.player.invulnTimer, INVULN_DURATION)
    s.player.invulnTimer = 0
    assert.equal(damagePlayer(s, 3, 'hit'), true)     // 2 armor left: one reaches hp
    assert.equal(s.player.hp, 9)
    assert.equal(damagePlayer(s, 1, 'dot'), true)
    assert.equal(s.player.hp, 8)
  })
  it('another character\'s armor protects nobody but its wearer', () => {
    const s = dressed({ attackMode: 'magic' })
    s.player.gear.melee.armor = cuirass()
    damagePlayer(s, 3, 'hit')
    assert.equal(s.player.hp, 7)
  })
})

describe('damage observer', () => {
  afterEach(() => setDamageObserver(null))
  const lastFloat = s => s.feedback.floats.at(-1)
  it('can zero the hp loss while the float shows the would-be damage', () => {
    setDamageObserver(() => 0)
    const s = freshState()
    assert.equal(damagePlayer(s, 3, 'hit'), true)
    assert.equal(s.player.hp, 10)
    assert.equal(lastFloat(s).text, '-3')
    assert.equal(s.player.invulnTimer, INVULN_DURATION)
  })
  it('sees the amount after the armor, with state, player and kind', () => {
    const seen = []
    setDamageObserver((state, player, amount, kind) => { seen.push({ state, player, amount, kind }); return amount })
    const p = { ...makePlayer(1, 1), px: 40, py: 60, hp: 10 }
    p.gear.melee.armor = jerkin()                     // 2 armor
    const s = { player: p, feedback: makeFeedback(), sfx: makeSfx() }
    damagePlayer(s, 3, 'hit')
    assert.equal(seen.length, 1)
    assert.equal(seen[0].state, s); assert.equal(seen[0].player, p)
    assert.equal(seen[0].amount, 1); assert.equal(seen[0].kind, 'hit')
    assert.equal(p.hp, 9)
  })
  it('a non-finite return leaves the amount unchanged', () => {
    setDamageObserver(() => undefined)
    const s = freshState()
    damagePlayer(s, 3, 'dot')
    assert.equal(s.player.hp, 7)
  })
  it('without an observer behaviour is unchanged', () => {
    const s = freshState()
    damagePlayer(s, 3, 'hit')
    assert.equal(s.player.hp, 7)
  })
  it('is not consulted for a blocked hit', () => {
    let calls = 0
    setDamageObserver((_s, _p, a) => { calls++; return a })
    const p = { ...makePlayer(1, 1), px: 40, py: 60, hp: 10, facing: 'east', stamina: 100, blocking: true }
    const { type, ...b } = makeShieldContents('buckler'); p.gear.melee.off = { kind: 'shield', ...b }
    const s = { player: p, feedback: makeFeedback(), sfx: makeSfx() }
    assert.equal(damagePlayer(s, 3, 'hit', { px: 80, py: 60 }), false)
    assert.equal(calls, 0)
  })
})

// Kivinahka, the Mountain King's talent (systems/talents.js).
describe('Kivinahka', () => {
  const st = (over = {}) => ({
    player: { ...makePlayer(1, 1), px: 40, py: 60, facing: 'east', talents: ['kivinahka'], ...over },
    feedback: makeFeedback(), sfx: makeSfx(),
  })

  it('a blow of three or more lands one lighter, and shows as it landed', () => {
    const s = st()
    damagePlayer(s, 3, 'hit')
    assert.equal(s.player.hp, 8)
    assert.equal(s.feedback.floats.at(-1).text, '-2')
    s.player.invulnTimer = 0
    damagePlayer(s, 5, 'hit')
    assert.equal(s.player.hp, 4)
  })

  it('a blow of two or one lands whole', () => {
    const s = st()
    damagePlayer(s, 2, 'hit')
    assert.equal(s.player.hp, 8)
    s.player.invulnTimer = 0
    damagePlayer(s, 1, 'hit')
    assert.equal(s.player.hp, 7)
  })

  it('comes off the blow before the armor: a three is a two, and a jerkin holds it', () => {
    const s = st()
    s.player.gear.melee.armor = jerkin()
    damagePlayer(s, 3, 'hit')           // 3 - 1 = 2, all of it on the armor
    assert.equal(s.player.hp, 10)
    s.player.invulnTimer = 0
    damagePlayer(s, 5, 'hit')           // 5 - 1 = 4, the armor is spent
    assert.equal(s.player.hp, 6)
  })

  it('poison, fire and lightning are no blows: they land whole', () => {
    const s = st()
    damagePlayer(s, 3, 'dot')
    assert.equal(s.player.hp, 7)
    damagePlayer(s, 4, 'lightning')
    assert.equal(s.player.hp, 3)
  })

  it('a blocked blow is still blocked, and a hero without the talent takes the three whole', () => {
    const s = st({ blocking: true, stamina: 100 })
    const { type, ...b } = makeShieldContents('buckler'); s.player.gear.melee.off = { kind: 'shield', ...b }
    assert.equal(damagePlayer(s, 3, 'hit', { px: 80, py: 60 }), false)
    assert.equal(s.player.hp, 10)
    const plain = st({ talents: [] })
    damagePlayer(plain, 3, 'hit')
    assert.equal(plain.player.hp, 7)
  })
})
