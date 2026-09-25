import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseNetCheat, parsePvpCheat } from '../renderer/systems/cheats.js'
import { netUrl, normalizeCode, validCode, errorText, netViewOf } from '../renderer/net/view.js'
import { netHudModel } from '../renderer/ui/pvp-hud.js'
import { makeHero } from '../renderer/pvp/hero.js'

describe('net cheats', () => {
  it('host and join, suffix-matched, any case; pvp still its own', () => {
    assert.equal(parseNetCheat('xxHOST'), 'host')
    assert.equal(parseNetCheat('join'), 'join')
    assert.equal(parseNetCheat('pvp'), null)
    assert.equal(parsePvpCheat('pvp'), true)
  })
})

describe('view helpers', () => {
  it('netUrl follows the page protocol and host', () => {
    assert.equal(netUrl({ protocol: 'https:', host: 'x.run.app' }), 'wss://x.run.app/pvp')
    assert.equal(netUrl({ protocol: 'http:', host: 'localhost:8080' }), 'ws://localhost:8080/pvp')
  })
  it('normalizeCode uppercases and strips spaces', () => {
    assert.equal(normalizeCode(' kx pt '), 'KXPT')
  })
  it('validCode accepts exactly 4 letters from the code alphabet, normalized', () => {
    assert.equal(validCode(normalizeCode(' kx pt ')), true)
    assert.equal(validCode('KXPT'), true)
    assert.equal(validCode('KXP'), false)   // too short
    assert.equal(validCode('KXPTQ'), false) // too long
    assert.equal(validCode('KX0T'), false)  // digits aren't in the code alphabet (letters only)
    assert.equal(validCode(''), false)
  })
  it('errorText has a line for every error code and a fallback', () => {
    for (const code of ['version', 'no_room', 'room_full', 'bad_name', 'bad_hello', 'server_full'])
      assert.ok(errorText(code).length > 3, code)
    assert.ok(errorText('???').length > 3)
  })
  it('netViewOf builds a render view: you as player, everyone in heroes, pickups up only', () => {
    const me = makeHero({ id: 'p1', name: 'A', cls: 'mage' })
    const other = makeHero({ id: 'p2', name: 'B', cls: 'archer' })
    const v = { me, others: [other], projectiles: [], lightning: [], strikes: [], arcs: [], shockwaves: [],
      pickups: [{ kind: 'flask', x: 1, y: 1, px: 48, py: 48, up: true }, { kind: 'rune', x: 2, y: 2, px: 80, py: 80, up: false }],
      feedback: { floats: [] } }
    const view = netViewOf(v, { bgColor: '#000' }, [[{}]])
    assert.equal(view.player, me)
    assert.deepEqual(view.heroes.map(h => h.id), ['p1', 'p2'])
    assert.deepEqual(view.entities.map(e => [e.type, e.kind]), [['pvp_pickup', 'flask']])
  })
})

describe('netHudModel', () => {
  const view = (over = {}) => {
    const me = makeHero({ id: 'p1', name: 'A', cls: 'mage' })
    const other = makeHero({ id: 'p2', name: 'B', cls: 'archer' }); other.kills = 2
    return { me, others: [other], clock: 65.5, matchLength: 240, waiting: false, room: 'KXPT', ping: 48.4, ...over }
  }
  it('room, time left, kills, leader and ping', () => {
    const m = netHudModel(view(), 'p1')
    assert.equal(m.room, 'KXPT')
    assert.equal(m.time, '2:54')
    assert.equal(m.kills, 0)
    assert.equal(m.leaderKills, 2)
    assert.equal(m.leading, false)
    assert.equal(m.ping, 48)
  })
  it('--:-- while waiting for a second player', () => {
    assert.equal(netHudModel(view({ waiting: true, others: [] }), 'p1').time, '--:--')
  })
})
