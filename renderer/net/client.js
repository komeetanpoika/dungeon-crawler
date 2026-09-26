// The browser side of a PvP room (spec §2-§3): the connection, a fixed 30 Hz
// input loop, your predicted hero, everyone else interpolated, and a
// ready-to-draw view — and, when the socket drops after the welcome, the
// way back into the same seat (4b spec §2). The WebSocket constructor and
// the clock are passed in, so Node tests run the very same code with `ws`.
// No DOM.
import { MSG, ERR, encode, decode, hydrateHero, heroSnap } from './protocol.js'
import { makePredictor, predictStep, predictCosmetics, reconcile, tickCorrection, drawnPos } from './predict.js'
import { makeInterp, pushSnap, renderTick, heroPoses, projectilesAt, newest } from './interp.js'
import { arenaMap } from '../pvp/sim.js'
import { PVP_ARENAS } from '../data/pvp-arenas.js'
import { makeFeedback, addFloat, tickFeedback } from '../systems/feedback.js'
import { tickWalk } from '../systems/walk.js'
import { PVP } from '../data/pvp.js'
import { NET } from '../data/net.js'

// status: 'connecting' → 'open' (welcomed) → 'reconnecting' (dropped, trying
// hello.resume) → 'open' again, or it ends in 'left' (we closed it), 'lost'
// or 'error' (a refusal). `hello` may itself be { resume: token } (a
// reloaded tab going back to its seat). token: the seat token from the
// latest welcome. lostAt/attempt/retryAt: the reconnect schedule.
export function connect({ url, hello, WebSocketImpl = globalThis.WebSocket, now = () => performance.now() }) {
  const s = {
    status: 'connecting', error: null, room: null, heroId: null, arena: 'pillars', map: arenaMap(), now,
    url, WebSocketImpl, token: hello?.resume ?? null, lostAt: null, attempt: 0, retryAt: null,
    pred: null, interp: makeInterp(), others: new Map(), meView: null, seq: 0, acc: 0, held: { attack: false, alt: false },
    lastFrame: null, lastView: null, lastPingAt: -Infinity, ping: null,
    events: [], cues: [], feedback: makeFeedback(), closedByUs: false, over: false,
  }
  openSocket(s, hello)
  return s
}

// Every socket's handlers check it is still the session's own: an attempt
// that was abandoned for a newer one, or the socket that dropped, is
// ignored from then on.
function openSocket(s, hello) {
  const ws = s.ws = new s.WebSocketImpl(s.url)
  ws.onopen = () => ws.send(encode({ type: MSG.HELLO, v: NET.protocolVersion, ...hello }))
  ws.onmessage = ev => { if (s.ws === ws) onMessage(s, decode(ev.data), s.now()) }
  ws.onclose = ev => { if (s.ws === ws) onClose(s, s.now(), ev?.code) }
}

// The session is over for good: one 'closed' event, then nothing more.
function end(s, status) {
  if (s.over) return
  s.over = true
  if (s.status !== 'error') s.status = status
  pushEvent(s, { type: 'closed', status: s.status })
}

// Close code 4001 'replaced' (server/pvp-server.js): another connection sent
// hello.resume with this same seat's token and took it over while this
// socket was still live. That seat is no longer ours to reclaim — trying to
// resume it ourselves would only fight the connection that just won it — so
// this is a final loss, not a drop, whatever the session's status was.
function onClose(s, t, code) {
  if (code === 4001) { end(s, 'lost'); return }
  // A resume attempt that got no welcome: tickReconnect starts the next one
  // when its time comes; after the last one there is nothing left to try.
  if (s.status === 'reconnecting') {
    if (s.attempt >= NET.reconnectDelaysMs.length) end(s, 'lost')
    return
  }
  // An unexpected drop after the welcome: try to get the seat back.
  if (s.status === 'open' && !s.closedByUs && s.token) {
    s.status = 'reconnecting'
    s.lostAt = t
    s.attempt = 0
    s.retryAt = t + NET.reconnectDelaysMs[0]
    pushEvent(s, { type: 'reconnecting' })
    return
  }
  end(s, s.closedByUs ? 'left' : 'lost')
}

// Called every frame while reconnecting: the next hello.resume when its
// time comes — 0.5, 1, 2, 4 and 8 s apart — for as long as the server can
// still be holding the seat. A tab that comes back after the grace (rAF
// stops while it is hidden) gives up at once instead of trying a seat that
// is surely gone.
function tickReconnect(s, t) {
  if (t < s.retryAt) return
  const delays = NET.reconnectDelaysMs
  if (s.attempt >= delays.length || t - s.lostAt > NET.reconnectGraceMs) {
    const hanging = s.ws
    end(s, 'lost')
    hanging.close()
    return
  }
  const abandoned = s.ws
  s.attempt++
  s.retryAt = s.attempt < delays.length ? t + delays[s.attempt] : s.lostAt + NET.reconnectGraceMs
  openSocket(s, { resume: s.token })
  abandoned.close()                                    // the dropped socket, or an attempt still hanging
}

// Back in: the old predictor and snapshot buffer describe a connection that
// is gone, and the server numbers this socket's inputs afresh. The next
// snapshot rebuilds the view.
function resetSession(s) {
  s.pred = null
  s.interp = makeInterp()
  s.others = new Map()
  s.meView = null
  s.seq = 0
  s.acc = 0
  s.held = { attack: false, alt: false }
  s.lastFrame = null
  s.lastPingAt = -Infinity
}

function refuse(s, code) {
  const reconnect = s.status === 'reconnecting'
  s.status = 'error'
  s.error = code
  pushEvent(s, { type: 'error', code, ...(reconnect && { reconnect: true }) })
}

// A backgrounded tab keeps receiving WebSocket messages while
// requestAnimationFrame stops, so a busy room's events/cues/floats can pile
// up (~7 cues/s) for however long the tab was hidden, then all play at once
// the moment it returns. Same hazard for a slow reader the server skipped a
// broadcast to. These ALWAYS_KEPT event types are the ones a caller still
// needs after a long gap (session status changes, and the two match-boundary
// events that drive the results/wait panel), so trimming never drops them —
// plus the local hero's own kill/respawn, which drive the death picker and
// can't be identified by type alone. Everything else is capped like
// cues/floats.
const ALWAYS_KEPT_EVENTS = new Set(['closed', 'error', 'welcome', 'reconnecting', 'matchEnd', 'matchStart'])

function isKeptEvent(s, e) {
  if (ALWAYS_KEPT_EVENTS.has(e.type)) return true
  if (e.type === 'kill' && e.victim === s.heroId) return true
  if (e.type === 'respawn' && e.hero === s.heroId) return true
  return false
}

function pushEvent(s, e) {
  s.events.push(e)
  while (s.events.length > NET.maxEvents) {
    const i = s.events.findIndex(x => !isKeptEvent(s, x))
    if (i === -1) break
    s.events.splice(i, 1)
  }
}

// The arena a welcome or snapshot names (protocol v3). A new one gets a new
// map object — which also drops the renderer's tile-chunk cache and makes
// game.js decorate it — and the predictor walks on it from then on. An id
// this build does not know means the server is newer: the same refusal as a
// version mismatch.
function setArena(s, id) {
  if (typeof id !== 'string' || !Object.hasOwn(PVP_ARENAS, id)) {
    refuse(s, ERR.VERSION)
    s.ws.close()
    return false
  }
  if (id !== s.arena) {
    s.arena = id
    s.map = arenaMap(PVP_ARENAS[id])
    if (s.pred) s.pred.map = s.map
  }
  return true
}

function onMessage(s, msg, t) {
  // After a refusal nothing more is read: the socket is closing.
  if (!msg || s.status === 'error') return
  if (msg.type === MSG.WELCOME) {
    if (!setArena(s, msg.arena)) return
    const resumed = s.status === 'reconnecting'
    if (resumed) resetSession(s)
    s.status = 'open'; s.room = msg.room; s.heroId = msg.heroId; s.token = msg.token ?? null
    s.lostAt = null; s.attempt = 0; s.retryAt = null
    pushEvent(s, { type: 'welcome', room: msg.room, heroId: msg.heroId, token: s.token, resumed })
  } else if (msg.type === MSG.ERROR) {
    // While reconnecting, only two refusals are final: the seat is gone, or
    // the server is a newer build. Anything else (rate_limited, server_full)
    // costs just that one attempt.
    if (s.status === 'reconnecting') {
      if (msg.code === ERR.RESUME_FAILED) end(s, 'lost')
      else if (msg.code === ERR.VERSION) refuse(s, msg.code)
      return
    }
    refuse(s, msg.code)
  } else if (msg.type === MSG.PONG) {
    if (Number.isFinite(msg.t)) s.ping = t - msg.t
  } else if (msg.type === MSG.SNAP) {
    onSnap(s, msg, t)
  }
}

function onSnap(s, snap, t) {
  if (!setArena(s, snap.arena)) return
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
  if (s.status === 'reconnecting') { tickReconnect(s, t); return }
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
// A deliberate leave says bye first, so the server frees the seat at once
// instead of holding it for the reconnect grace.
export function leave(s) {
  if (s.status === 'open') s.ws.send(encode({ type: MSG.BYE }))
  s.closedByUs = true
  // Leave on the Reconnecting… overlay: no further attempts.
  if (s.status === 'reconnecting') end(s, 'left')
  s.ws.close()
}
export function drainEvents(s) { const e = s.events; s.events = []; return e }
export function drainCues(s) { const c = s.cues; s.cues = []; return c }
