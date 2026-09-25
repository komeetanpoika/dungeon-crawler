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

// A backgrounded tab keeps receiving WebSocket messages while
// requestAnimationFrame stops, so a busy room's events/cues/floats can pile
// up (~7 cues/s) for however long the tab was hidden, then all play at once
// the moment it returns. These three ALWAYS_KEPT event types are the ones a
// caller still needs after a long gap (session status changes), so trimming
// never drops them; everything else is capped like cues/floats.
const ALWAYS_KEPT_EVENTS = new Set(['closed', 'error', 'welcome'])

function pushEvent(s, e) {
  s.events.push(e)
  while (s.events.length > NET.maxEvents) {
    const i = s.events.findIndex(x => !ALWAYS_KEPT_EVENTS.has(x.type))
    if (i === -1) break
    s.events.splice(i, 1)
  }
}

function onMessage(s, msg, t) {
  if (!msg) return
  if (msg.type === MSG.WELCOME) {
    s.status = 'open'; s.room = msg.room; s.heroId = msg.heroId
    pushEvent(s, { type: 'welcome', room: msg.room, heroId: msg.heroId })
  } else if (msg.type === MSG.ERROR) {
    s.status = 'error'; s.error = msg.code
    pushEvent(s, { type: 'error', code: msg.code })
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
    pushEvent(s, e)
    const at = snap.heroes.find(h => h.id === (e.type === 'hit' ? e.target : e.killer))
    if (e.type === 'hit' && at && e.amount > 0) addFloat(s.feedback, { px: at.px, py: at.py - 10, text: `-${e.amount}`, kind: e.target === s.heroId ? 'taken' : 'dealt' })
    if (e.type === 'kill' && at) addFloat(s.feedback, { px: at.px, py: at.py - 16, text: '+1', kind: 'heal' })
  }
  if (s.feedback.floats.length > NET.maxFloats) s.feedback.floats = s.feedback.floats.slice(-NET.maxFloats)
  s.cues.push(...snap.cues)
  if (s.cues.length > NET.maxCues) s.cues = s.cues.slice(-NET.maxCues)
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
    // While the newest snapshot shows the match ended (the results screen),
    // the server has stopped stepping every hero, so predicting further
    // would just run the hero into the wall on its own and rubber-band back
    // on the next snapshot. Inputs are still sent — a fresh joiner or a
    // client that briefly missed the matchEnd event needs its ack to keep
    // advancing — but nothing is predicted or queued for replay.
    if (s.pred && !newest(s.interp)?.ended) {
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
  // A tab backgrounded past a frame's worth of time (rAF stopped, but the
  // socket kept receiving) comes back to cues/floats queued for however long
  // it was hidden. tickFeedback's dt is clamped below like frame()'s, so
  // those floats would otherwise still be mid-flight and play late; clear
  // them here instead — stale effects are not worth playing.
  if (s.lastView !== null && t - s.lastView > PVP.maxFrame * 1000) { s.cues = []; s.feedback.floats = [] }
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
