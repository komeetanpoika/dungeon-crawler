import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MSG, ERR, encode, decode, validateInput, validateName, validateClass, validateHello,
  heroSnap, hydrateHero, snapshotBody } from '../renderer/net/protocol.js'
import { makeMatch } from '../renderer/pvp/sim.js'
import { grantRune } from '../renderer/pvp/pickups.js'
import { NET } from '../renderer/data/net.js'

describe('encode / decode', () => {
  it('round-trips a message', () => {
    assert.deepEqual(decode(encode({ type: MSG.PING, t: 5 })), { type: 'ping', t: 5 })
  })
  it('rejects garbage, non-objects and messages without a type', () => {
    for (const bad of ['{', '42', 'null', '[]', '{"t":1}']) assert.equal(decode(bad), null, bad)
  })
})

describe('validateInput', () => {
  it('clamps move to -1/0/1 and keeps a known facing', () => {
    assert.deepEqual(validateInput({ seq: 3, view: 10, move: { x: 50, y: -0.2 }, facing: 'west', attack: true, alt: false, sprint: true }),
      { seq: 3, view: 10, move: { x: 1, y: -1 }, facing: 'west', attack: true, alt: false, sprint: true })
  })
  it('drops an unknown facing, non-boolean flags and non-finite axes', () => {
    assert.deepEqual(validateInput({ seq: 1, view: 0, move: { x: 'a', y: NaN }, facing: 'up', attack: 'yes', alt: 1 }),
      { seq: 1, view: 0, move: { x: 0, y: 0 }, facing: null, attack: false, alt: false, sprint: false })
    assert.equal(validateInput({ seq: 1, view: 0, facing: 'toString' }).facing, null)
  })
  it('rejects a missing, negative or fractional seq/view', () => {
    for (const bad of [{ view: 0 }, { seq: -1, view: 0 }, { seq: 1.5, view: 0 }, { seq: 1 }, { seq: 1, view: 'x' }, null])
      assert.equal(validateInput(bad), null)
  })
})

describe('names, classes and hello', () => {
  it('names: trimmed, 1-12 of letters digits space _ -', () => {
    assert.equal(validateName('  Aino_2 '), 'Aino_2')
    for (const bad of ['', '   ', 'x'.repeat(13), 'a<b', 42, null]) assert.equal(validateName(bad), null)
  })
  it('classes are the three kits', () => {
    assert.equal(validateClass('mage'), true)
    assert.equal(validateClass('bard'), false)
    assert.equal(validateClass('toString'), false)
  })
  it('hello: version, name, class and exactly one of create/room', () => {
    const base = { type: 'hello', v: NET.protocolVersion, name: 'Aino', cls: 'mage' }
    assert.deepEqual(validateHello({ ...base, create: true }), { name: 'Aino', cls: 'mage', create: true })
    assert.deepEqual(validateHello({ ...base, room: ' kxpt ' }), { name: 'Aino', cls: 'mage', room: 'KXPT' })
    assert.deepEqual(validateHello({ ...base, v: 0, create: true }), { error: ERR.VERSION })
    assert.deepEqual(validateHello({ ...base, name: '<>', create: true }), { error: ERR.BAD_NAME })
    assert.deepEqual(validateHello({ ...base, cls: 'bard', create: true }), { error: ERR.BAD_HELLO })
    assert.deepEqual(validateHello({ ...base }), { error: ERR.BAD_HELLO })
    assert.deepEqual(validateHello({ ...base, room: 'KX1' }), { error: ERR.BAD_HELLO })
    assert.deepEqual(validateHello({ ...base, create: true, room: 'KXPT' }), { error: ERR.BAD_HELLO })
  })
})

describe('snapshots', () => {
  const match = () => makeMatch({ roster: [{ id: 'p1', name: 'A', cls: 'warrior' }, { id: 'p2', name: 'B', cls: 'archer' }] })
  it('a hero survives heroSnap → JSON → hydrateHero', () => {
    const m = match()
    const w = m.heroes[0]
    w.px = 123.5; w.hp = 7; w.stunTimer = 0.3
    grantRune(m, w)                                       // hammer in hand, buckler parked
    w.charging = { t: 0.4 }                                // set after: grantRune itself cancels any in-flight charge
    const s = JSON.parse(JSON.stringify(heroSnap(w)))
    const h = hydrateHero(null, s)
    assert.equal(h.type, 'hero')
    assert.equal(h.px, 123.5); assert.equal(h.hp, 7); assert.equal(h.stunTimer, 0.3)
    assert.deepEqual(h.charging, { t: 0.4 })
    assert.equal(h.weapon.weaponType, 'ukonvasara')
    assert.equal(h.gear.melee.off, null)
    assert.equal(h.gear.melee.outfit.outfitType, 'plate')
    assert.deepEqual(h.rune, { t: w.rune.t })
  })
  it('hydrating an existing hero applies a class change first', () => {
    const m = match()
    const h = hydrateHero(null, heroSnap(m.heroes[0]))
    const s = heroSnap(m.heroes[1])
    s.id = h.id
    hydrateHero(h, s)
    assert.equal(h.cls, 'archer')
    assert.equal(h.ranged.weaponType, 'shortbow')
    assert.equal(h.gear.melee.outfit, null)
  })
  it('hydrating leaves walk-sway anchors (_wpx/_wpy) at the hero\'s own value', () => {
    const m = match()
    const w = m.heroes[0]
    const s = heroSnap(w)
    s.px = 999; s.py = 999   // the snapshot's raw position differs from the hydrated hero's own anchor
    const h = { ...w, _wpx: 5, _wpy: 7 }
    hydrateHero(h, s)
    assert.equal(h.px, 999); assert.equal(h.py, 999)
    assert.equal(h._wpx, 5); assert.equal(h._wpy, 7)
  })
  it('snapshotBody is plain JSON with every list the client draws', () => {
    const m = match()
    m.projectiles.push({ px: 1, py: 2, dx: 3, dy: 4, shape: 'arrow', color: '#fff', owner: 'p2', hitIds: new Set() })
    const body = JSON.parse(JSON.stringify(snapshotBody(m, { events: [{ type: 'join', hero: 'p2' }], cues: [{ name: 'x' }] })))
    assert.equal(body.type, MSG.SNAP)
    assert.equal(body.heroes.length, 2)
    assert.deepEqual(body.projectiles[0], { px: 1, py: 2, dx: 3, dy: 4, shape: 'arrow', color: '#fff' })
    assert.equal(body.pickups.length, 5)
    assert.equal(body.matchLength, m.matchLength)
    for (const k of ['tick', 'clock', 'waiting', 'ended', 'lightning', 'strikes', 'arcs', 'shockwaves', 'events', 'cues']) assert.ok(k in body, k)
  })
})
