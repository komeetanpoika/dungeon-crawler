// Single funnel for all player damage. 'hit' respects and grants i-frames;
// 'dot' always applies and never touches them. Returns whether damage landed.

export const INVULN_DURATION = 0.8

export function damagePlayer(state, amount, kind, message) {
  const player = state.player
  if (kind === 'hit' && (player.invulnTimer ?? 0) > 0) return false
  player.hp -= amount
  if (kind === 'hit') player.invulnTimer = INVULN_DURATION
  if (message) state.log = [...state.log, message].slice(-5)
  return true
}
