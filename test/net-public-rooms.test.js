import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeLobby, createRoom, joinRoom, leaveRoom, quickJoin, balanceBots, queueInput, setRoomClass,
  stepRoom, drainKicks } from '../server/rooms.js'
import { removeHero } from '../renderer/pvp/sim.js'
import { grantRune } from '../renderer/pvp/pickups.js'
import { ERR } from '../renderer/net/protocol.js'
import { NET } from '../renderer/data/net.js'

const who = (name, cls = 'archer') => ({ name, cls })
const input = (seq, over = {}) => ({ seq, view: 0, move: { x: 0, y: 0 }, facing: null, attack: false, alt: false, sprint: false, ...over })
const steps = (lobby, room, n) => { for (let i = 0; i < n; i++) stepRoom(lobby, room) }
const botsOf = room => room.match.heroes.filter(h => room.bots.includes(h.id))
const humansOf = room => room.match.heroes.filter(h => room.players.has(h.id))
const pub = (opts) => { const lobby = makeLobby(opts); const { room } = quickJoin(lobby, who('A')); return { lobby, room } }

describe('quickJoin', () => {
  it('with no public room, creates one: public, the human is p1, bots fill it to NET.botFill', () => {
    const { room } = pub()
    assert.equal(room.public, true)
    assert.equal(room.players.size, 1)
    assert.ok(room.players.has('p1'))
    assert.equal(room.match.heroes.length, NET.botFill)
    assert.deepEqual(room.bots, ['b1', 'b2', 'b3'])
  })
  it('never picks a private room', () => {
    const lobby = makeLobby()
    const priv = createRoom(lobby, who('A')).room
    const { room } = quickJoin(lobby, who('B'))
    assert.notEqual(room, priv)
    assert.equal(priv.public, false)
    assert.equal(priv.match.heroes.length, 1)
  })
  it('picks the public room with the most humans; a tie goes to the oldest', () => {
    const lobby = makeLobby()
    const older = createRoom(lobby, { ...who('A'), public: true }).room
    const newer = createRoom(lobby, { ...who('B'), public: true }).room
    assert.equal(quickJoin(lobby, who('C')).room, older)                          // 1 vs 1: the older
    joinRoom(lobby, newer.code, who('D')); joinRoom(lobby, newer.code, who('E'))  // newer 3, older 2
    assert.equal(quickJoin(lobby, who('F')).room, newer)
  })
  it('a room with NET.maxHeroes humans is skipped', () => {
    const lobby = makeLobby()
    const full = createRoom(lobby, { ...who('A'), public: true }).room
    for (let i = 1; i < NET.maxHeroes; i++) joinRoom(lobby, full.code, who('X'))
    assert.equal(full.players.size, NET.maxHeroes)
    assert.notEqual(quickJoin(lobby, who('B')).room, full)
  })
  it('server_full when a new room is needed past maxRooms', () => {
    const lobby = makeLobby()
    for (let i = 0; i < NET.maxRooms; i++) createRoom(lobby, who('A'))
    assert.deepEqual(quickJoin(lobby, who('B')), { error: ERR.SERVER_FULL })
  })
})

describe('balanceBots', () => {
  it('1 human → 3 bots; a second human replaces a bot; four humans → no bots; up to six', () => {
    const { lobby, room } = pub()
    assert.equal(quickJoin(lobby, who('B')).room, room)
    assert.deepEqual([humansOf(room).length, botsOf(room).length], [2, 2])
    joinRoom(lobby, room.code, who('C')); joinRoom(lobby, room.code, who('D'))
    assert.deepEqual([humansOf(room).length, botsOf(room).length], [4, 0])
    joinRoom(lobby, room.code, who('E')); joinRoom(lobby, room.code, who('F'))
    assert.equal(room.match.heroes.length, 6)
    assert.deepEqual(joinRoom(lobby, room.code, who('G')), { error: ERR.ROOM_FULL })
  })
  it('the most recently added bot leaves first', () => {
    const { lobby, room } = pub()
    quickJoin(lobby, who('B'))
    assert.deepEqual(room.bots, ['b1', 'b2'])
    assert.deepEqual(botsOf(room).map(h => h.id).sort(), ['b1', 'b2'])
  })
  it('a leaving human brings a bot back, with a fresh id', () => {
    const { lobby, room } = pub()
    const { heroId } = quickJoin(lobby, who('B'))
    leaveRoom(lobby, room, heroId)
    assert.deepEqual(room.bots, ['b1', 'b2', 'b4'])
    assert.equal(room.match.heroes.length, NET.botFill)
  })
  it('the last human out closes the room; bots never keep it', () => {
    const { lobby, room } = pub()
    leaveRoom(lobby, room, 'p1')
    assert.equal(lobby.rooms.size, 0)
  })
  it('the last human leaving during the results closes the room', () => {
    const { lobby, room } = pub({ matchLength: 1, resultsDelay: 0.5 })
    steps(lobby, room, 32)
    assert.equal(room.match.ended, true)
    leaveRoom(lobby, room, 'p1')
    assert.equal(lobby.rooms.size, 0)
    assert.equal(room.players.size, 0)
  })
  it('leaveRoom twice is harmless', () => {
    const { lobby, room } = pub()
    const { heroId } = quickJoin(lobby, who('B'))
    leaveRoom(lobby, room, heroId)
    leaveRoom(lobby, room, heroId)
    assert.deepEqual(room.bots, ['b1', 'b2', 'b4'])
    assert.equal(lobby.rooms.size, 1)
  })
  it('joining a public room by its code counts as a human join: a bot gives up its seat', () => {
    const { lobby, room } = pub()
    const { heroId } = joinRoom(lobby, room.code, who('B'))
    assert.equal(heroId, 'p2')
    assert.equal(botsOf(room).length, 2)
    assert.equal(room.match.heroes.length, NET.botFill)
  })
  it('a new match rebalances', () => {
    const { lobby, room } = pub({ matchLength: 1, resultsDelay: 0.5 })
    steps(lobby, room, 32)
    assert.equal(room.match.ended, true)
    removeHero(room.match, room.bots.pop())          // a seat lost without a rebalance
    assert.equal(room.match.heroes.length, 3)
    steps(lobby, room, 20)
    assert.equal(room.match.ended, false)
    assert.equal(room.match.heroes.length, NET.botFill)
    assert.deepEqual(room.bots, ['b1', 'b2', 'b4'])
  })
  it("a removed bot's rune goes back on its pedestal", () => {
    const { lobby, room } = pub()
    const rune = room.match.pickups.find(p => p.kind === 'rune')
    rune.up = false; rune.t = 50
    grantRune(room.match, room.match.heroes.find(h => h.id === 'b3'))
    quickJoin(lobby, who('B'))
    assert.equal(room.match.heroes.some(h => h.id === 'b3'), false)
    assert.equal(rune.up, true)
  })
  it('bot names are "Bot " + a NET.botNames name, unique in the room', () => {
    const { room } = pub()
    const names = botsOf(room).map(h => h.name)
    for (const n of names) assert.ok(n.startsWith('Bot ') && NET.botNames.includes(n.slice(4)), n)
    assert.equal(new Set(names).size, names.length)
  })
  it('bot classes go to the least represented class, ties in CLASSES order', () => {
    const lobby = makeLobby()
    const { room } = quickJoin(lobby, who('A', 'archer'))
    assert.deepEqual(botsOf(room).map(h => h.cls), ['warrior', 'mage', 'warrior'])
  })
  it('private rooms never get bots', () => {
    const lobby = makeLobby()
    const { room } = createRoom(lobby, who('A'))
    balanceBots(lobby, room)
    joinRoom(lobby, room.code, who('B'))
    leaveRoom(lobby, room, 'p2')
    assert.deepEqual(room.bots, [])
    assert.equal(room.match.heroes.length, 1)
  })
  it('bots play: each gets botInput every tick', () => {
    const { lobby, room } = pub()
    const before = botsOf(room).map(h => `${h.px},${h.py}`)
    steps(lobby, room, 90)
    const after = botsOf(room).map(h => `${h.px},${h.py}`)
    assert.ok(after.some((p, i) => p !== before[i]))
  })
})

describe('the idle timer', () => {
  const idleLobby = () => makeLobby({ idleKickMs: 1000 })     // 30 ticks
  it('a human with no real input for idleKickMs is kicked once; neutral inputs do not count', () => {
    const lobby = idleLobby()
    const { room } = quickJoin(lobby, who('A'))
    for (let i = 1; i <= 29; i++) { queueInput(room, 'p1', input(i)); stepRoom(lobby, room) }
    assert.deepEqual(drainKicks(room), [])
    queueInput(room, 'p1', input(30)); stepRoom(lobby, room)
    assert.deepEqual(drainKicks(room), ['p1'])
    steps(lobby, room, 5)
    assert.deepEqual(drainKicks(room), [])
  })
  it('moving, attacking or picking a class keeps a human in', () => {
    const lobby = idleLobby()
    const { room } = quickJoin(lobby, who('A'))
    steps(lobby, room, 20); queueInput(room, 'p1', input(1, { move: { x: 1, y: 0 } }))
    steps(lobby, room, 20); queueInput(room, 'p1', input(2, { attack: true }))
    steps(lobby, room, 20); setRoomClass(room, 'p1', 'mage')
    steps(lobby, room, 20)
    assert.deepEqual(drainKicks(room), [])
  })
  it('a lone host waiting in a private room is never idle (the clock is not running)', () => {
    const lobby = idleLobby()
    const { room } = createRoom(lobby, who('A'))
    steps(lobby, room, 120)
    assert.deepEqual(drainKicks(room), [])
    joinRoom(lobby, room.code, who('B'))
    steps(lobby, room, 31)
    assert.deepEqual(drainKicks(room).sort(), ['p1', 'p2'])
  })
  it('the results screen holds the timer', () => {
    const lobby = makeLobby({ idleKickMs: 1000, matchLength: 0.5, resultsDelay: 3 })
    const { room } = quickJoin(lobby, who('A'))
    queueInput(room, 'p1', input(1, { move: { x: 1, y: 0 } }))
    steps(lobby, room, 16)
    assert.equal(room.match.ended, true)
    steps(lobby, room, 60)                                // 2 s of results, well past 30 ticks
    assert.deepEqual(drainKicks(room), [])
  })
})
