// Sand in the face: the antlion's thrown sand (systems/monsters/kuoppaleuka.js)
// leaves the hero walking at half speed for a moment. game.js multiplies the
// walk by sandSlowMul, as it does the rain cloud's (systems/hammer.js). Pure.
export const SAND_SLOW = 0.5

export function slowBySand(player, seconds) { player.sandSlow = Math.max(player.sandSlow ?? 0, seconds) }
export function tickSandSlow(player, delta) {
  if (player.sandSlow > 0) player.sandSlow = Math.max(0, player.sandSlow - delta)
}
export const sandSlowMul = player => player.sandSlow > 0 ? SAND_SLOW : 1
