// Enemy status effects (slow, root, freeze, haste) — pure state mutation, ticked
// from game.js's enemy loop alongside stunTimer. act.js reads slowTimer/
// slowMul/rootTimer and hasteMul() to gate movement; canvas.js reads `frozen` to tint.

// Slow: act() multiplies speed by slowMul while slowTimer > 0.
export function applySlow(e, mul, dur) {
  e.slowMul = mul
  e.slowTimer = dur
}

// Haste (a troll stirred by its band's drum): act() multiplies speed by
// hasteMul(e) beside the slow, so a slowed and stirred enemy moves at the
// product. A new haste keeps the larger multiplier of the one still running
// and starts the time again.
export function applyHaste(e, mul, dur) {
  e.hasteMul = e.hasteTimer > 0 ? Math.max(e.hasteMul ?? 1, mul) : mul
  e.hasteTimer = dur
}
export const hasteMul = e => (e.hasteTimer > 0 ? e.hasteMul ?? 1 : 1)

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

// Counts down slow/root/haste timers; clears `frozen` once the stun backing it
// ends. Safe to call on an enemy with no status fields set (never applied).
export function tickStatus(e, delta) {
  if (e.slowTimer > 0) e.slowTimer -= delta
  if (e.hasteTimer > 0) e.hasteTimer -= delta
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
