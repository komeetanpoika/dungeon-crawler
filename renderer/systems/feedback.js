// Prominent message feedback, layered over the quiet bottom-strip history:
//   floats — rising damage/heal numbers anchored in the world
//   bubble — one speech or thought bubble above the player at a time
//   banner — a centered pop-up box for milestone events
// Every speak/think/announce still appends to state.log, so the HUD strip
// keeps the full recent history.

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

function log(state, text) {
  state.log = [...state.log, text].slice(-5)
}

function bubble(state, text, kind) {
  log(state, text)
  if (state.feedback) state.feedback.bubble = { text, kind, t: 0 }
}

export function speak(state, text) { bubble(state, text, 'speech') }
export function think(state, text) { bubble(state, text, 'thought') }

// A speech bubble above another entity (an NPC). The renderer resolves
// anchorId against state.entities and falls back to the player.
export function speakFrom(state, entity, text) {
  log(state, text)
  if (state.feedback) state.feedback.bubble = { text, kind: 'speech', t: 0, anchorId: entity.id }
}

export function announce(state, text) {
  log(state, text)
  if (state.feedback) state.feedback.banner = { text, t: 0 }
}

// Tier-A feedback: a pausing, dismissible panel. Systems queue; game.js
// drains once per frame and owns the pause/DOM around it.
export function queueToast(state, { title, lines = [] }) {
  log(state, title)
  if (state.feedback) state.feedback.toasts.push({ title, lines })
}

export function drainToasts(state) {
  if (!state?.feedback?.toasts?.length) return []
  const t = state.feedback.toasts
  state.feedback.toasts = []
  return t
}
