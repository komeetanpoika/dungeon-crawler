// Enemy status effects (slow, root, freeze) — pure state mutation, ticked
// from game.js's enemy loop alongside stunTimer. act.js reads slowTimer/
// slowMul/rootTimer to gate movement; canvas.js reads `frozen` to tint.

// Slow: act() multiplies speed by slowMul while slowTimer > 0.
export function applySlow(e, mul, dur) {
  e.slowMul = mul
  e.slowTimer = dur
}

// Root: act() performs no movement while rootTimer > 0 (attacks still fire).
export function applyRoot(e, dur) {
  e.rootTimer = dur
}

// Freeze: a stun (Rime's over tier) that also renders an icy tint. Reuses
// stunTimer so the existing stun gate in game.js's enemy loop covers it too;
// never shortens a stun already running longer than this freeze.
export function applyFreeze(e, dur) {
  e.stunTimer = Math.max(e.stunTimer ?? 0, dur)
  e.frozen = true
}

// Counts down slow/root timers; clears `frozen` once the stun backing it
// ends. Safe to call on an enemy with no status fields set (never applied).
export function tickStatus(e, delta) {
  if (e.slowTimer > 0) e.slowTimer -= delta
  if (e.rootTimer > 0) e.rootTimer -= delta
  if (e.frozen && !(e.stunTimer > 0)) e.frozen = false
}

// Melee shatter: +2 damage against a frozen enemy, consumed on hit (the
// player's melee hit path adds this to its damage calc). Not frozen = 0.
export function shatterBonus(e) {
  if (!e.frozen) return 0
  e.frozen = false
  return 2
}
