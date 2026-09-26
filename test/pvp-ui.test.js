import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parsePvpCheat, cheatDecision } from '../renderer/systems/cheats.js'
import { inputFromKeys, makeLocalMatch, localInputs, viewOf, LOCAL_ID } from '../renderer/pvp/local.js'
import { pvpHudModel } from '../renderer/ui/pvp-hud.js'
import { PVP } from '../renderer/data/pvp.js'
import { nextArenaIndex } from '../renderer/data/pvp-arenas.js'

describe('pvp cheat', () => {
  it('matches a buffer ending in pvp, any case', () => {
    assert.equal(parsePvpCheat('xxPvP'), true)
    assert.equal(parsePvpCheat('pv'), false)
  })
  it('does not disturb the level cheat', () => {
    assert.equal(cheatDecision('pvp'), null)
  })
})

describe('inputFromKeys', () => {
  it('maps WASD/arrows, Space, Q and sprint; the last pressed axis names the facing', () => {
    assert.deepEqual(inputFromKeys({ d: true, s: true, ' ': true, q: true }, true),
      { move: { x: 1, y: 1 }, facing: 'south', attack: true, alt: true, sprint: true })
    assert.deepEqual(inputFromKeys({}), { move: { x: 0, y: 0 }, facing: null, attack: false, alt: false, sprint: false })
  })
})

describe('makeLocalMatch / localInputs / viewOf', () => {
  it('puts you against three bots of cycling classes', () => {
    const m = makeLocalMatch({ cls: 'mage' })
    assert.deepEqual(m.heroes.map(h => [h.id, h.cls]), [[LOCAL_ID, 'mage'], ['bot1', 'warrior'], ['bot2', 'archer'], ['bot3', 'mage']])
  })
  it('plays the arena at arenaIndex in the rotation, pillars by default; "Next match" steps it', () => {
    assert.equal(makeLocalMatch({ cls: 'mage' }).arena.id, 'pillars')
    const ids = []
    for (let i = 0, k = 0; k < 5; k++, i = nextArenaIndex(i)) ids.push(makeLocalMatch({ cls: 'mage', arenaIndex: i }).arena.id)
    assert.deepEqual(ids, ['pillars', 'glade', 'tunnels', 'ruins', 'pillars'])
    const m = makeLocalMatch({ cls: 'mage', arenaIndex: 3 })
    assert.equal(m.map[0].length, m.arena.size.w)
    for (const h of m.heroes) assert.ok(m.arena.spawns.some(s => s.x === h.x && s.y === h.y), h.id)
  })
  it('clamps the bot count to 1-5', () => {
    assert.equal(makeLocalMatch({ cls: 'mage', bots: 9 }).heroes.length, 6)
    assert.equal(makeLocalMatch({ cls: 'mage', bots: 0 }).heroes.length, 2)
  })
  it('keys drive you; bots drive the rest', () => {
    const m = makeLocalMatch({ cls: 'archer' })
    const inputs = localInputs(m, { a: true }, false)
    assert.deepEqual(inputs[LOCAL_ID].move, { x: -1, y: 0 })
    assert.equal(Object.keys(inputs).length, 4)
  })
  it('the view centres on you and shows only pickups that are up', () => {
    const m = makeLocalMatch({ cls: 'archer' })
    const v = viewOf(m, { bgColor: '#000' })
    assert.equal(v.player.id, LOCAL_ID)
    assert.equal(v.heroes, m.heroes)
    assert.ok(v.entities.every(e => e.type === 'pvp_pickup'))
    assert.equal(v.entities.length, 4)   // the rune is not up yet
  })
})

describe('pvpHudModel', () => {
  it('shows time left, your kills and the leader', () => {
    const m = makeLocalMatch({ cls: 'archer' })
    m.clock = 65.5
    m.heroes[2].kills = 3
    const model = pvpHudModel(m, LOCAL_ID)
    assert.equal(model.time, `${Math.floor((PVP.matchLength - 65.5) / 60)}:${String(Math.floor((PVP.matchLength - 65.5) % 60)).padStart(2, '0')}`)
    assert.equal(model.kills, 0)
    assert.equal(model.leaderKills, 3)
    assert.equal(model.leading, false)
  })
})
