import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeLobby, createRoom, joinRoom, leaveRoom, quickJoin, balanceBots, queueInput, setRoomClass,
  stepRoom, drainKicks, markAway, resumeSeat, drainExpired, ackOf } from '../server/rooms.js'
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
  // Item 2c: a lone private host still isn't caught by the ordinary idle
  // timer (idleKickMs stays held the whole time it's waiting — see the test
  // above), but it does get its own, much longer limit.
  it('a lone host waiting in a private room past lonelyHostKickMs is kicked, even while moving', () => {
    const lobby = makeLobby({ idleKickMs: 1000, lonelyHostKickMs: 500 })   // 15 ticks
    const { room } = createRoom(lobby, who('A'))
    for (let i = 1; i <= 14; i++) { queueInput(room, 'p1', input(i, { move: { x: 1, y: 0 } })); stepRoom(lobby, room) }
    assert.deepEqual(drainKicks(room), [])
    queueInput(room, 'p1', input(15, { move: { x: 1, y: 0 } })); stepRoom(lobby, room)
    assert.deepEqual(drainKicks(room), ['p1'])
  })
  it('a friend joining before lonelyHostKickMs cancels it — the room is no longer "alone"', () => {
    const lobby = makeLobby({ idleKickMs: 1000, lonelyHostKickMs: 500 })   // 15 ticks
    const { room } = createRoom(lobby, who('A'))
    steps(lobby, room, 10)
    joinRoom(lobby, room.code, who('B'))
    steps(lobby, room, 10)                                // total 20 ticks, well past 15, but no longer alone
    assert.deepEqual(drainKicks(room), [])
  })
  it('a public room (always at botFill or more) never counts as a lone host', () => {
    const lobby = makeLobby({ idleKickMs: 1000, lonelyHostKickMs: 500 })
    const { room } = quickJoin(lobby, who('A'))
    steps(lobby, room, 20)
    assert.deepEqual(drainKicks(room), [])
  })
  // Task 5 review fix: an away lone host must not be kicked by the lonely-host
  // timer — its seat is already waiting on hello.resume, not sitting idle.
  it('an away lone private host is skipped by the lonely-host kick', () => {
    const lobby = makeLobby({ idleKickMs: 1000, lonelyHostKickMs: 500 })   // 15 ticks
    const { room } = createRoom(lobby, who('A'))
    markAway(lobby, room, 'p1')
    steps(lobby, room, 20)
    assert.deepEqual(drainKicks(room), [])
  })
})

describe('away seats (reconnect grace)', () => {
  const two = opts => { const lobby = makeLobby(opts); const { room } = quickJoin(lobby, who('A')); quickJoin(lobby, who('B')); return { lobby, room } }
  const hero = (room, id) => room.match.heroes.find(h => h.id === id)
  it('carries the spec number', () => {
    assert.equal(NET.reconnectGraceMs, 20000)
  })
  it('an away hero stays in the match on neutral input, and its seat still counts as human', () => {
    const { lobby, room } = two()
    for (let i = 1; i <= 3; i++) queueInput(room, 'p1', input(i, { move: { x: 1, y: 0 }, facing: 'east' }))
    assert.equal(markAway(lobby, room, 'p1'), true)
    const px = hero(room, 'p1').px
    steps(lobby, room, 10)
    assert.equal(hero(room, 'p1').px, px, 'stands still')
    assert.equal(humansOf(room).length, 2)
    assert.equal(botsOf(room).length, 2, 'no bot took the seat')
    assert.equal(room.players.get('p1').away, true)
  })
  it('an away hero can still be killed', () => {
    const { lobby, room } = two()
    markAway(lobby, room, 'p1')
    hero(room, 'p1').spawnProtect = 0
    hero(room, 'p1').hp = 0
    steps(lobby, room, 1)
    assert.equal(hero(room, 'p1').dead, true)
    assert.equal(hero(room, 'p1').deaths, 1)
  })
  it('the idle kick is suspended while away', () => {
    const { lobby, room } = two({ idleKickMs: 1000, reconnectGraceMs: 5000 })   // 30 and 150 ticks
    markAway(lobby, room, 'p1')
    for (let i = 1; i <= 100; i++) { queueInput(room, 'p2', input(i, { attack: true })); stepRoom(lobby, room) }
    assert.deepEqual(drainKicks(room), [])
    assert.deepEqual(drainExpired(room), [])
  })
  it('the grace runs out after reconnectGraceMs of room ticks: expired once; freeing the seat refills it with a bot', () => {
    const { lobby, room } = two({ reconnectGraceMs: 1000 })                        // 30 ticks
    markAway(lobby, room, 'p1')
    steps(lobby, room, 29)
    assert.deepEqual(drainExpired(room), [])
    steps(lobby, room, 1)
    assert.deepEqual(drainExpired(room), ['p1'])
    steps(lobby, room, 5)
    assert.deepEqual(drainExpired(room), [], 'queued once')
    leaveRoom(lobby, room, 'p1')                                                   // what the socket layer does
    assert.equal(humansOf(room).length, 1)
    assert.equal(botsOf(room).length, 3)
  })
  // Task 5 review fix: a second markAway on an already-away seat must not
  // push awayUntil further out — the grace keeps counting from the first drop.
  it('markAway on an already-away seat is a no-op: the grace is not restarted', () => {
    const { lobby, room } = two({ reconnectGraceMs: 1000 })                       // 30 ticks
    markAway(lobby, room, 'p1')
    const awayUntil = room.players.get('p1').awayUntil
    steps(lobby, room, 20)
    assert.equal(markAway(lobby, room, 'p1'), true)
    assert.equal(room.players.get('p1').awayUntil, awayUntil, 'grace not restarted')
  })
  it('a lone private host who drops keeps the room open while away', () => {
    const lobby = makeLobby()
    const { room } = createRoom(lobby, who('A'))
    markAway(lobby, room, 'p1')
    steps(lobby, room, 30)
    assert.ok(lobby.rooms.has(room.code))
  })
  it('resumeSeat puts the same hero back: kills, deaths and class kept; queue, ack and idle clock start over', () => {
    const { lobby, room } = two({ idleKickMs: 1000 })
    for (let i = 1; i <= 5; i++) { queueInput(room, 'p1', input(500 + i, { move: { x: 1, y: 0 } })); stepRoom(lobby, room) }
    assert.equal(ackOf(room, 'p1'), 505)
    Object.assign(hero(room, 'p1'), { kills: 2, deaths: 1 })
    markAway(lobby, room, 'p1')
    steps(lobby, room, 40)
    assert.deepEqual(resumeSeat(room, 'p1'), { room, heroId: 'p1' })
    const p = room.players.get('p1')
    assert.equal(p.away, false)
    assert.deepEqual(p.queue, [])
    assert.equal(ackOf(room, 'p1'), 0)
    assert.equal(p.activeTick, room.tick)
    assert.deepEqual([hero(room, 'p1').kills, hero(room, 'p1').deaths, hero(room, 'p1').cls], [2, 1, 'archer'])
    // The new client numbers its inputs from 1 again, and they are acked.
    queueInput(room, 'p1', input(1)); stepRoom(lobby, room)
    assert.equal(ackOf(room, 'p1'), 1)
  })
  // CONTROLLER RULING (2026-09-26, design §2): a resume takes over a seat
  // whose original socket still looks open, instead of being refused — a
  // phone that switched networks before the server noticed the old link
  // died. Only an unknown hero id or one already freed is resume_failed;
  // closing the superseded socket (4001) is the socket layer's job (Task 6).
  it('resumeSeat takes over a live (not-away) seat; refuses an unknown one and one already freed', () => {
    const { lobby, room } = two({ reconnectGraceMs: 1000 })
    assert.deepEqual(resumeSeat(room, 'p1'), { room, heroId: 'p1' }, 'its socket still looks open, but the new one takes over')
    const p = room.players.get('p1')
    assert.equal(p.away, false)
    assert.equal(p.awayUntil, null)
    assert.deepEqual(p.queue, [])
    assert.equal(ackOf(room, 'p1'), 0)
    assert.equal(p.activeTick, room.tick)
    assert.deepEqual(resumeSeat(room, 'p9'), { error: ERR.RESUME_FAILED })
    markAway(lobby, room, 'p2')
    steps(lobby, room, 30)
    for (const id of drainExpired(room)) leaveRoom(lobby, room, id)
    assert.deepEqual(resumeSeat(room, 'p2'), { error: ERR.RESUME_FAILED })
  })
})
