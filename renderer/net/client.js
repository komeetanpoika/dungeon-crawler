// The browser side of a PvP room (spec §2-§3): the connection, a fixed 30 Hz
// input loop, your predicted hero, everyone else interpolated, and a
// ready-to-draw view. The WebSocket constructor and the clock are passed in,
// so Node tests run the very same code with `ws`. No DOM.
import { MSG, encode, decode, hydrateHero, heroSnap } from './protocol.js'
import { makePredictor, predictStep, predictCosmetics, reconcile, tickCorrection, drawnPos } from './predict.js'
import { makeInterp, pushSnap, renderTick, heroPoses, projectilesAt, newest } from './interp.js'
import { arenaMap } from '../pvp/sim.js'
import { makeFeedback, addFloat, tickFeedback } from '../systems/feedback.js'
import { tickWalk } from '../systems/walk.js'
import { PVP } from '../data/pvp.js'
import { NET } from '../data/net.js'

export function connect({ url, hello, WebSocketImpl = globalThis.WebSocket, now = () => performance.now() }) {
  const s = {
    status: 'connecting', error: null, room: null, heroId: null, map: arenaMap(), now,
    pred: null, interp: makeInterp(), others: new Map(), meView: null, seq: 0, acc: 0, held: { attack: false, alt: false },
    lastFrame: null, lastView: null, lastPingAt: -Infinity, ping: null,
    events: [], cues: [], feedback: makeFeedback(), closedByUs: false,
  }
  const ws = s.ws = new WebSocketImpl(url)
  ws.onopen = () => ws.send(encode({ type: MSG.HELLO, v: NET.protocolVersion, ...hello }))
  ws.onmessage = ev => onMessage(s, decode(ev.data), s.now())
  ws.onclose = () => {
    if (s.status !== 'error') s.status = s.closedByUs ? 'left' : 'lost'
    s.events.push({ type: 'closed', status: s.status })
  }
  return s
}

function onMessage(s, msg, t) {
  if (!msg) return
  if (msg.type === MSG.WELCOME) {
    s.status = 'open'; s.room = msg.room; s.heroId = msg.heroId
    s.events.push({ type: 'welcome', room: msg.room, heroId: msg.heroId })
  } else if (msg.type === MSG.ERROR) {
    s.status = 'error'; s.error = msg.code
    s.events.push({ type: 'error', code: msg.code })
  } else if (msg.type === MSG.PONG) {
    if (Number.isFinite(msg.t)) s.ping = t - msg.t
  } else if (msg.type === MSG.SNAP) {
    onSnap(s, msg, t)
  }
}

function onSnap(s, snap, t) {
  pushSnap(s.interp, snap, t)
  const mine = snap.heroes.find(h => h.id === s.heroId)
  if (mine) {
    if (!s.pred) s.pred = makePredictor({ map: s.map, heroSnap: mine })
    reconcile(s.pred, mine, snap.ack)
  }
  for (const e of snap.events) {
    s.events.push(e)
    const at = snap.heroes.find(h => h.id === (e.type === 'hit' ? e.target : e.killer))
    if (e.type === 'hit' && at && e.amount > 0) addFloat(s.feedback, { px: at.px, py: at.py - 10, text: `-${e.amount}`, kind: e.target === s.heroId ? 'taken' : 'dealt' })
    if (e.type === 'kill' && at) addFloat(s.feedback, { px: at.px, py: at.py - 16, text: '+1', kind: 'heal' })
  }
  s.cues.push(...snap.cues)
}

export function frame(s, input, t = s.now()) {
  if (s.status !== 'open') return
  // Clamped both ways: a hitch never fast-forwards, and a clock that steps
  // back (an injected wall clock) never runs the accumulator negative.
  const dt = s.lastFrame === null ? 0 : Math.max(0, Math.min(t - s.lastFrame, PVP.maxFrame * 1000))
  s.lastFrame = t
  if (s.pred) tickCorrection(s.pred, dt)
  s.acc += dt
  const tickMs = PVP.tick * 1000
  // Frames run faster than the 30 Hz input step, so a press that lasts one
  // frame can fall between two sends; it is latched until the next input
  // carries it, and a tap is never lost.
  s.held.attack ||= !!input.attack
  s.held.alt ||= !!input.alt
  while (s.acc >= tickMs) {
    s.acc -= tickMs
    const msg = {
      type: MSG.INPUT, seq: ++s.seq, view: Math.max(0, Math.floor(renderTick(s.interp, t))),
      move: { x: input.move?.x ?? 0, y: input.move?.y ?? 0 }, facing: input.facing ?? null,
      attack: s.held.attack, alt: s.held.alt, sprint: !!input.sprint,
    }
    s.held = { attack: !!input.attack, alt: !!input.alt }
    s.ws.send(encode(msg))
    if (s.pred) {
      s.pred.from = { x: s.pred.hero.px, y: s.pred.hero.py }
      predictStep(s.pred, msg)
      predictCosmetics(s.pred, msg)
      s.pred.pending.push({ seq: msg.seq, input: msg })
      if (s.pred.pending.length > NET.pendingMax) s.pred.pending.shift()
    }
  }
  if (s.pred) s.pred.alpha = s.acc / tickMs
  if (t - s.lastPingAt >= NET.pingMs) { s.lastPingAt = t; s.ws.send(encode({ type: MSG.PING, t })) }
}

const TILE = 32
const place = (h, px, py) => { h.px = px; h.py = py; h.x = Math.floor(px / TILE); h.y = Math.floor(py / TILE) }

export function sessionView(s, t = s.now()) {
  const last = newest(s.interp)
  if (!s.pred || !last) return null
  const dt = s.lastView === null ? 0 : Math.max(0, Math.min(t - s.lastView, PVP.maxFrame * 1000)) / 1000
  s.lastView = t
  tickFeedback(s.feedback, dt)
  const rt = renderTick(s.interp, t)
  const others = []
  const poses = heroPoses(s.interp, rt)
  for (const [id, pose] of poses) {
    if (id === s.heroId) continue
    const h = hydrateHero(s.others.get(id) ?? null, pose.snap)
    place(h, pose.px, pose.py)
    tickWalk(h, dt)
    s.others.set(id, h)
    others.push(h)
  }
  for (const id of [...s.others.keys()]) if (!poses.has(id)) s.others.delete(id)
  const me = s.meView = hydrateHero(s.meView, heroSnap(s.pred.hero))
  const d = drawnPos(s.pred)
  place(me, d.x, d.y)
  const sw = s.pred.swing
  if (sw) Object.assign(me, { attackTimer: sw.dur - sw.t, attackDuration: sw.dur, attackStyle: sw.style, attackFacing: sw.facing })
  tickWalk(me, dt)
  return {
    me, others, projectiles: projectilesAt(s.interp, rt),
    lightning: last.lightning, strikes: last.strikes, arcs: last.arcs, shockwaves: last.shockwaves, pickups: last.pickups,
    clock: last.clock, waiting: last.waiting, ended: last.ended, matchLength: last.matchLength,
    room: s.room, ping: s.ping, feedback: s.feedback,
  }
}

export function sendClass(s, cls) { if (s.status === 'open') s.ws.send(encode({ type: MSG.CLASS, cls })) }
export function leave(s) { s.closedByUs = true; s.ws.close() }
export function drainEvents(s) { const e = s.events; s.events = []; return e }
export function drainCues(s) { const c = s.cues; s.cues = []; return c }
