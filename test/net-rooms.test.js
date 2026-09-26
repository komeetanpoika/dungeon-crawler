import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeLobby, createRoom, joinRoom, leaveRoom, queueInput, setRoomClass, stepRoom, ackOf, rewoundPos } from '../server/rooms.js'
import { placeHero, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { encode, ERR } from '../renderer/net/protocol.js'
import { NET } from '../renderer/data/net.js'
import { PVP } from '../renderer/data/pvp.js'

const who = (name, cls = 'archer') => ({ name, cls })
const input = (seq, over = {}) => ({ seq, view: 0, move: { x: 0, y: 0 }, facing: null, attack: false, alt: false, sprint: false, ...over })
const heroOf = (room, id) => room.match.heroes.find(h => h.id === id)
const steps = (lobby, room, n) => { const out = []; for (let i = 0; i < n; i++) { const b = stepRoom(lobby, room); if (b) out.push(b) } return out }

describe('creating and joining', () => {
  it('create gives a 4-letter code from the alphabet and hero p1', () => {
    const lobby = makeLobby()
    const { room, heroId } = createRoom(lobby, who('A'))
    assert.match(room.code, new RegExp(`^[${NET.codeAlphabet}]{4}$`))
    assert.equal(heroId, 'p1')
    assert.equal(lobby.rooms.get(room.code), room)
  })
  it('a code collision is retried', () => {
    const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0.99, 0, 0, 0]   // AAAA twice, then ZAAA
    let i = 0
    const lobby = makeLobby({ random: () => seq[i++ % seq.length] })
    const a = createRoom(lobby, who('A')).room
    const b = createRoom(lobby, who('B')).room
    assert.notEqual(a.code, b.code)
  })
  it('server_full past maxRooms', () => {
    const lobby = makeLobby()
    for (let i = 0; i < NET.maxRooms; i++) createRoom(lobby, who('A'))
    assert.deepEqual(createRoom(lobby, who('A')), { error: ERR.SERVER_FULL })
  })
  it('join: no_room, then p2, p3 … up to six, then room_full; same name twice is fine', () => {
    const lobby = makeLobby()
    assert.deepEqual(joinRoom(lobby, 'ZZZZ', who('B')), { error: ERR.NO_ROOM })
    const { room } = createRoom(lobby, who('A'))
    for (let i = 2; i <= 6; i++) assert.equal(joinRoom(lobby, room.code, who('Same')).heroId, `p${i}`)
    assert.deepEqual(joinRoom(lobby, room.code, who('B')), { error: ERR.ROOM_FULL })
  })
  it('leave removes the hero; the last one out destroys the room; ids are never reused', () => {
    const lobby = makeLobby()
    const { room } = createRoom(lobby, who('A'))
    joinRoom(lobby, room.code, who('B'))
    leaveRoom(lobby, room, 'p2')
    assert.equal(room.match.heroes.length, 1)
    assert.equal(joinRoom(lobby, room.code, who('C')).heroId, 'p3')
    leaveRoom(lobby, room, 'p1'); leaveRoom(lobby, room, 'p3')
    assert.equal(lobby.rooms.size, 0)
  })
})

describe('input queue', () => {
  const setup = () => { const lobby = makeLobby(); const { room } = createRoom(lobby, who('A')); joinRoom(lobby, room.code, who('B')); return { lobby, room } }
  it('one input per tick, acked by seq', () => {
    const { lobby, room } = setup()
    queueInput(room, 'p1', input(1, { move: { x: 1, y: 0 } }))
    queueInput(room, 'p1', input(2, { move: { x: 1, y: 0 } }))
    stepRoom(lobby, room)
    assert.equal(ackOf(room, 'p1'), 1)
    stepRoom(lobby, room)
    assert.equal(ackOf(room, 'p1'), 2)
  })
  it('caps the queue at inputQueueMax, dropping the oldest', () => {
    const { lobby, room } = setup()
    for (let s = 1; s <= 7; s++) queueInput(room, 'p1', input(s))
    stepRoom(lobby, room)
    assert.equal(ackOf(room, 'p1'), 7 - NET.inputQueueMax + 1)
  })
  it('an empty queue repeats the last input', () => {
    const { lobby, room } = setup()
    const h = heroOf(room, 'p1')
    queueInput(room, 'p1', input(1, { move: { x: 1, y: 0 } }))
    stepRoom(lobby, room)
    const x1 = h.px
    stepRoom(lobby, room)
    assert.ok(h.px > x1)
    assert.equal(ackOf(room, 'p1'), 1)
  })
  it('stale input goes neutral after staleInputTicks', () => {
    const { lobby, room } = setup()
    const h = heroOf(room, 'p1')
    queueInput(room, 'p1', input(1, { move: { x: 1, y: 0 } }))
    steps(lobby, room, NET.staleInputTicks + 2)
    const x = h.px
    steps(lobby, room, 3)
    assert.equal(h.px, x)
  })
  it('setRoomClass applies at respawn', () => {
    const { lobby, room } = setup()
    setRoomClass(room, 'p1', 'mage')
    assert.equal(heroOf(room, 'p1').pendingCls, 'mage')
  })
})

describe('snapshots', () => {
  it('two snapshots every three ticks, events and cues riding along once', () => {
    const lobby = makeLobby()
    const { room } = createRoom(lobby, who('A'))
    joinRoom(lobby, room.code, who('B'))
    const bodies = steps(lobby, room, 30)
    assert.equal(bodies.length, 20)
    const joins = bodies.flatMap(b => b.events).filter(e => e.type === 'join')
    assert.equal(joins.length, 1)
  })
})

describe('rewind', () => {
  const duel = () => {
    const lobby = makeLobby()
    const { room } = createRoom(lobby, who('A', 'warrior'))
    joinRoom(lobby, room.code, who('B', 'archer'))
    return { lobby, room, w: heroOf(room, 'p1'), a: heroOf(room, 'p2') }
  }
  it('records history and returns the foe where the attacker saw it, capped at rewindMaxTicks', () => {
    const { lobby, room, w, a } = duel()
    placeHero(a, { x: 10, y: 7 })
    steps(lobby, room, 8)                                   // history ticks 1..8 at x=10
    placeHero(a, { x: 14, y: 7 })
    steps(lobby, room, 1)                                   // tick 9 at x=14
    room.match.tick += 1                                    // simulate being inside tick 10
    w.viewTick = 8
    assert.equal(rewoundPos(room, a, w).px, 10 * 32 + 16)
    w.viewTick = 0                                          // too old: clamped to 6 ticks back → tick 4
    assert.equal(rewoundPos(room, a, w).px, 10 * 32 + 16)
    w.viewTick = 99                                         // the future: clamped to now
    assert.equal(rewoundPos(room, a, w), a)
    room.match.tick -= 1
  })
  it('makeLobby({ rewind: false }) installs no hitPos', () => {
    const lobby = makeLobby({ rewind: false })
    const { room } = createRoom(lobby, who('A'))
    assert.equal(room.match.hitPos, undefined)
    assert.equal(typeof createRoom(makeLobby(), who('A')).room.match.hitPos, 'function')
  })
})

describe('the next match', () => {
  it('after matchEnd and resultsDelay a new match starts with the same ids, pending classes and a matchStart event', () => {
    const lobby = makeLobby({ matchLength: 1, resultsDelay: 0.5 })
    const { room } = createRoom(lobby, who('A', 'warrior'))
    joinRoom(lobby, room.code, who('B', 'archer'))
    setRoomClass(room, 'p2', 'mage')
    const first = room.match
    const bodies = steps(lobby, room, 30 + 15 + 5)
    const events = bodies.flatMap(b => b.events)
    assert.ok(events.some(e => e.type === 'matchEnd'))
    assert.ok(events.some(e => e.type === 'matchStart'))
    assert.notEqual(room.match, first)
    assert.deepEqual(room.match.heroes.map(h => [h.id, h.cls]), [['p1', 'warrior'], ['p2', 'mage']])
    assert.ok(room.match.tick >= first.tick)
    assert.equal(typeof room.match.hitPos, 'function')
  })
  it('a hero joining during results is in the next match', () => {
    const lobby = makeLobby({ matchLength: 1, resultsDelay: 0.5 })
    const { room } = createRoom(lobby, who('A'))
    joinRoom(lobby, room.code, who('B'))
    steps(lobby, room, 32)                                  // matchEnd has fired
    assert.equal(room.match.ended, true)
    joinRoom(lobby, room.code, who('C'))
    steps(lobby, room, 20)
    assert.equal(room.match.ended, false)
    assert.ok(room.match.heroes.some(h => h.id === 'p3'))
  })
})

describe('arena rotation', () => {
  const nextMatch = (lobby, room) => { const m = room.match; const out = []; while (room.match === m) { const b = stepRoom(lobby, room); if (b) out.push(b) } return out }
  it('a room starts on pillars and each new match takes the next arena, wrapping', () => {
    const lobby = makeLobby({ matchLength: 1, resultsDelay: 0.5 })
    const { room } = createRoom(lobby, who('A', 'warrior'))
    joinRoom(lobby, room.code, who('B', 'archer'))
    const ids = [room.match.arena.id]
    for (let i = 0; i < 4; i++) { nextMatch(lobby, room); ids.push(room.match.arena.id) }
    assert.deepEqual(ids, ['pillars', 'glade', 'tunnels', 'ruins', 'pillars'])
    assert.equal(room.arenaIndex, 0)
  })
  it("the new match puts every hero on the new arena's spawns and its snapshots name it", () => {
    const lobby = makeLobby({ matchLength: 1, resultsDelay: 0.5 })
    const { room } = createRoom(lobby, who('A', 'warrior'))
    joinRoom(lobby, room.code, who('B', 'archer'))
    nextMatch(lobby, room)
    const { arena } = room.match
    assert.equal(arena.id, 'glade')
    for (const h of room.match.heroes) assert.ok(arena.spawns.some(s => s.x === h.x && s.y === h.y), `${h.id} at ${h.x},${h.y}`)
    assert.equal(room.match.map[0].length, arena.size.w)
    const body = steps(lobby, room, 3).at(-1)
    assert.equal(body.arena, 'glade')
  })
})

describe('cost', () => {
  it('a six-hero room steps and encodes in well under 2 ms a tick', () => {
    const lobby = makeLobby()
    const { room } = createRoom(lobby, who('A', 'warrior'))
    for (const c of ['archer', 'mage', 'warrior', 'archer', 'mage']) joinRoom(lobby, room.code, who('X', c))
    const t0 = performance.now()
    for (let i = 0; i < 300; i++) {
      for (const id of room.players.keys()) queueInput(room, id, input(i + 1, { move: { x: i % 2 ? 1 : -1, y: 0 }, attack: true }))
      const body = stepRoom(lobby, room)
      if (body) for (const id of room.players.keys()) encode({ ...body, ack: ackOf(room, id) })
    }
    const perTick = (performance.now() - t0) / 300
    console.log(`room cost: ${perTick.toFixed(3)} ms/tick`)
    assert.ok(perTick < 2, `${perTick} ms/tick`)
  })
})
