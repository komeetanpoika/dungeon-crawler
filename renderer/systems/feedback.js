// Prominent message feedback:
//   floats — rising damage/heal numbers anchored in the world
//   bubble — one speech or thought bubble above the player at a time
//   banner — a centered pop-up box for milestone events

export const FLOAT_DUR = 0.8
export const BUBBLE_DUR = 2.0
export const BANNER_DUR = 2.5

export function makeFeedback() {
  return { floats: [], bubble: null, banner: null, toasts: [] }
}

export function addFloat(fb, { px, py, text, kind }) {
  if (!fb) return
  fb.floats.push({ px, py, text, kind, t: 0 })
}

export function tickFeedback(fb, dt) {
  if (!fb) return
  for (const f of fb.floats) f.t += dt
  fb.floats = fb.floats.filter(f => f.t < FLOAT_DUR)
  if (fb.bubble && (fb.bubble.t += dt) >= BUBBLE_DUR) fb.bubble = null
  if (fb.banner && (fb.banner.t += dt) >= BANNER_DUR) fb.banner = null
}

function bubble(state, text, kind) {
  if (state.feedback) state.feedback.bubble = { text, kind, t: 0 }
}

export function speak(state, text) { bubble(state, text, 'speech') }
export function think(state, text) { bubble(state, text, 'thought') }

// A speech bubble above another entity (an NPC). The renderer resolves
// anchorId against state.entities and falls back to the player.
export function speakFrom(state, entity, text) {
  if (state.feedback) state.feedback.bubble = { text, kind: 'speech', t: 0, anchorId: entity.id }
}

// Kalevanlinna's people speak their scene lines over their own heads, apart
// from the single bubble above (which stays the player's and the tales'):
// e.city.say = { text, n, t } (npc.js sceneSay; the city runtime ages t).
// Which of them draw a bubble now: a line younger than BUBBLE_DUR, a speaker
// on its feet within `view` (a pixel rect { x0, y0, x1, y1 }), and of those
// the `max` nearest `focus` (the player), nearest first; never `skip` (the id
// the single bubble is over). Pure.
export const AMBIENT_MAX = 4
export function ambientSpeakers(entities, view, focus, { max = AMBIENT_MAX, skip = null } = {}) {
  const out = [], d2 = []
  for (const e of entities) {
    const s = e.city?.say
    if (!s || !(s.t < BUBBLE_DUR) || e.hp <= 0 || (skip !== null && e.id === skip)) continue
    if (e.px < view.x0 || e.px > view.x1 || e.py < view.y0 || e.py > view.y1) continue
    const d = (e.px - focus.px) ** 2 + (e.py - focus.py) ** 2
    let i = out.length
    while (i > 0 && d2[i - 1] > d) i--
    if (i >= max) continue
    out.splice(i, 0, e); d2.splice(i, 0, d)
    if (out.length > max) { out.pop(); d2.pop() }
  }
  return out
}

export function announce(state, text) {
  if (state.feedback) state.feedback.banner = { text, t: 0 }
}

// Tier-A feedback: a pausing, dismissible panel. Systems queue; game.js
// drains once per frame and owns the pause/DOM around it.
export function queueToast(state, { title, lines = [] }) {
  if (state.feedback) state.feedback.toasts.push({ title, lines })
}

export function drainToasts(state) {
  if (!state?.feedback?.toasts?.length) return []
  const t = state.feedback.toasts
  state.feedback.toasts = []
  return t
}
