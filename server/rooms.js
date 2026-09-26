// PvP rooms (spec §3; public rooms, bots and the idle timer from the 4a
// spec §1-§2): codes, the input queue per player, one simulated tick at a
// time, the position history melee rewinds into, and the next match after
// the results. Pure — no sockets; server/pvp-server.js drives it.
import { makeMatch, stepMatch, addHero, removeHero, setClass } from '../renderer/pvp/sim.js'
import { heroById } from '../renderer/pvp/combat.js'
import { NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { botInput } from '../renderer/pvp/bots.js'
import { makeSfx, drainSfx } from '../renderer/systems/sfx.js'
import { snapshotBody, ERR } from '../renderer/net/protocol.js'
import { PVP, CLASSES } from '../renderer/data/pvp.js'
import { NET } from '../renderer/data/net.js'

export function makeLobby({ random = Math.random, rewind = true, matchLength = PVP.matchLength,
  resultsDelay = NET.resultsDelay, idleKickMs = NET.idleKickMs, lonelyHostKickMs = NET.lonelyHostKickMs } = {}) {
  return { rooms: new Map(), serial: 0, opts: { random, rewind, matchLength, resultsDelay, idleKickMs, lonelyHostKickMs } }
}

function newCode(lobby) {
  const A = NET.codeAlphabet
  for (;;) {
    let code = ''
    for (let i = 0; i < NET.codeLength; i++) code += A[Math.floor(lobby.opts.random() * A.length) % A.length]
    if (!lobby.rooms.has(code)) return code
  }
}

function newMatch(lobby, room, roster) {
  const match = makeMatch({ roster, sfx: makeSfx(false), matchLength: lobby.opts.matchLength })
  if (lobby.opts.rewind) match.hitPos = (foe, attacker) => rewoundPos(room, foe, attacker)
  room.history = new Map()
  return match
}

// activeTick: the room tick of this human's last real input (a move,
// attack, alt or sprint) or class pick — what the idle timer measures.
const freshPlayer = room => ({ queue: [], last: NEUTRAL_INPUT, lastInputTick: room.match.tick, ack: 0,
  activeTick: room.tick, kicked: false })

// public: a quick-join room with bot fill; private (the default): humans
// only, reached by code.
export function createRoom(lobby, { name, cls, public: isPublic = false }) {
  if (lobby.rooms.size >= NET.maxRooms) return { error: ERR.SERVER_FULL }
  const room = { code: newCode(lobby), public: isPublic, serial: lobby.serial++, nextId: 1, nextBot: 1,
    bots: [], kicks: [], tick: 0, match: null, players: new Map(), history: new Map(),
    pendingEvents: [], pendingCues: [], nextMatchAt: null, aloneSince: null }
  const heroId = `p${room.nextId++}`
  room.match = newMatch(lobby, room, [{ id: heroId, name, cls }])
  room.players.set(heroId, freshPlayer(room))
  lobby.rooms.set(room.code, room)
  balanceBots(lobby, room)
  return { room, heroId }
}

// By code — private or public. In a public room a bot gives up its seat.
// A public room below NET.botFill humans holds exactly NET.botFill heroes,
// and one at or above it holds only humans, so the new hero always has a
// spawn (≤ NET.maxHeroes).
export function joinRoom(lobby, code, { name, cls }) {
  const room = lobby.rooms.get(code)
  if (!room) return { error: ERR.NO_ROOM }
  if (room.players.size >= NET.maxHeroes) return { error: ERR.ROOM_FULL }
  const heroId = `p${room.nextId++}`
  addHero(room.match, { id: heroId, name, cls })
  room.players.set(heroId, freshPlayer(room))
  balanceBots(lobby, room)
  return { room, heroId }
}

// The public room with the most humans that still has a seat, the oldest on
// a tie; with none, a new public room.
export function quickJoin(lobby, { name, cls }) {
  let best = null
  for (const room of lobby.rooms.values()) {
    if (!room.public || room.players.size >= NET.maxHeroes) continue
    if (!best || room.players.size > best.players.size ||
        (room.players.size === best.players.size && room.serial < best.serial)) best = room
  }
  return best ? joinRoom(lobby, best.code, { name, cls }) : createRoom(lobby, { name, cls, public: true })
}

// Idempotent: a socket's close after an idle kick already removed it is a no-op.
export function leaveRoom(lobby, room, heroId) {
  if (!room.players.has(heroId)) return
  removeHero(room.match, heroId)
  room.players.delete(heroId)
  room.history.delete(heroId)
  if (room.players.size === 0) lobby.rooms.delete(room.code)   // bots never keep a room alive
  else balanceBots(lobby, room)
}

function botName(lobby, room) {
  const taken = new Set(room.match.heroes.map(h => h.name))
  const free = NET.botNames.map(n => `Bot ${n}`).filter(n => !taken.has(n))
  return free.length ? free[Math.floor(lobby.opts.random() * free.length) % free.length] : `Bot ${room.nextBot}`
}

// The class fewest heroes are playing, ties in CLASSES order.
function botClass(room) {
  const count = Object.fromEntries(CLASSES.map(c => [c, 0]))
  for (const h of room.match.heroes) if (h.cls in count) count[h.cls]++
  return CLASSES.reduce((best, c) => (count[c] < count[best] ? c : best), CLASSES[0])
}

// Public rooms only: top the room up to max(NET.botFill, humans) heroes with
// bots (farthest spawn, spawn protection — addHero), or send the most
// recently added bots home (removeHero returns a rune they held).
export function balanceBots(lobby, room) {
  if (!room.public) return
  const { match } = room
  const target = Math.max(NET.botFill, room.players.size)
  while (match.heroes.length < target && match.heroes.length < match.arena.spawns.length) {
    const id = `b${room.nextBot++}`
    addHero(match, { id, name: botName(lobby, room), cls: botClass(room) })
    room.bots.push(id)
  }
  while (match.heroes.length > target && room.bots.length) {
    const id = room.bots.pop()
    removeHero(match, id)
    room.history.delete(id)
  }
}

const isActive = input => !!(input.move?.x || input.move?.y || input.attack || input.alt || input.sprint)

export function queueInput(room, heroId, input) {
  const p = room.players.get(heroId)
  if (!p) return
  p.queue.push(input)
  if (p.queue.length > NET.inputQueueMax) p.queue.shift()
  p.lastInputTick = room.match.tick
  if (isActive(input)) p.activeTick = room.tick
}

export function setRoomClass(room, heroId, cls) {
  setClass(room.match, heroId, cls)
  const p = room.players.get(heroId)
  if (p) p.activeTick = room.tick
}
export const ackOf = (room, heroId) => room.players.get(heroId)?.ack ?? 0

// Where `attacker` saw `foe`: its position `k` ticks ago, k = how far behind
// the attacker's view was, capped at NET.rewindMaxTicks. Only the melee hit
// test asks (attacks.js swing via match.hitPos).
export function rewoundPos(room, foe, attacker) {
  const now = room.match.tick
  const k = Math.max(0, Math.min(NET.rewindMaxTicks, now - (attacker.viewTick ?? now)))
  if (k === 0) return foe
  const at = room.history.get(foe.id)?.find(e => e.tick === now - k)
  return at ? { type: foe.type, px: at.px, py: at.py } : foe
}

function recordHistory(room) {
  for (const h of room.match.heroes) {
    let ring = room.history.get(h.id)
    if (!ring) room.history.set(h.id, ring = [])
    ring.push({ tick: room.match.tick, px: h.px, py: h.py })
    if (ring.length > NET.historyTicks) ring.shift()
  }
}

function startNextMatch(lobby, room) {
  const prev = room.match
  const roster = prev.heroes.map(h => ({ id: h.id, name: h.name, cls: h.pendingCls ?? h.cls }))
  room.match = newMatch(lobby, room, roster)
  room.match.tick = prev.tick
  for (const p of room.players.values()) p.lastInputTick = room.match.tick
  room.nextMatchAt = null
  balanceBots(lobby, room)
  room.pendingEvents.push({ type: 'matchStart' })
}

// A human with no real input for idleKickMs is queued on room.kicks, once;
// the socket layer sends error idle and frees the seat. The timer is held
// while the match waits for a second hero (a lone private host) and while
// the results are up — but a lone private host waiting that long gets its
// own, much longer limit (lonelyHostKickMs), tracked separately from
// per-player activity since simply sitting there (not idling) is exactly
// what it is meant to catch.
function checkIdle(lobby, room) {
  const limit = Math.round(lobby.opts.idleKickMs / 1000 / PVP.tick)
  const lonelyLimit = Math.round(lobby.opts.lonelyHostKickMs / 1000 / PVP.tick)
  const alone = !room.public && room.match.waiting
  if (alone) {
    // checkIdle runs after this tick's room.tick++ below, so "now" here is
    // one ahead of the convention freshPlayer uses for activeTick (captured
    // before any step); subtract 1 so the two limits measure the same way.
    if (room.aloneSince === null) room.aloneSince = room.tick - 1
    if (room.tick - room.aloneSince >= lonelyLimit) {
      for (const [id, p] of room.players) if (!p.kicked) { p.kicked = true; room.kicks.push(id) }
    }
  } else {
    room.aloneSince = null
  }
  const holding = room.match.waiting || room.match.ended
  for (const [id, p] of room.players) {
    if (holding) p.activeTick = room.tick
    else if (!p.kicked && room.tick - p.activeTick >= limit) { p.kicked = true; room.kicks.push(id) }
  }
}

export function drainKicks(room) {
  const k = room.kicks
  room.kicks = []
  return k
}

// One simulated tick. Returns the snapshot body when one is due (20 Hz of a
// 30 Hz loop), else null.
export function stepRoom(lobby, room) {
  const { match } = room
  const inputs = {}
  for (const [id, p] of room.players) {
    let input
    if (p.queue.length) { input = p.queue.shift(); p.last = input; p.ack = input.seq }
    else input = match.tick - p.lastInputTick > NET.staleInputTicks ? NEUTRAL_INPUT : p.last
    inputs[id] = input
    const hero = heroById(match, id)
    if (hero && input.view !== undefined) hero.viewTick = input.view
  }
  if (!match.ended) {
    for (const id of room.bots) {
      const hero = heroById(match, id)
      if (hero) inputs[id] = botInput(match, hero)
    }
    const events = stepMatch(match, inputs, PVP.tick)
    recordHistory(room)
    room.pendingEvents.push(...events)
    if (events.some(e => e.type === 'matchEnd')) room.nextMatchAt = room.tick + Math.round(lobby.opts.resultsDelay / PVP.tick)
  }
  room.pendingCues.push(...drainSfx(room.match))
  if (room.match.ended && room.nextMatchAt !== null && room.tick >= room.nextMatchAt) startNextMatch(lobby, room)
  room.tick++
  checkIdle(lobby, room)
  const due = Math.floor(room.tick * NET.snapshotHz * PVP.tick) !== Math.floor((room.tick - 1) * NET.snapshotHz * PVP.tick)
  if (!due) return null
  const body = snapshotBody(room.match, { events: room.pendingEvents, cues: room.pendingCues })
  room.pendingEvents = []
  room.pendingCues = []
  return body
}
