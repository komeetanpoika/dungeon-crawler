// The states that take the hero's controls away: frozen solid (Monsteri's
// frost breath), held in a monster's grip, and sat in Kalevanlinna's stocks.
// While any lasts the hero cannot walk, turn, sprint, swing, cast, raise a
// shield or drink — game.js asks playerBound once a frame and gates every
// control on it. A grip is escaped by mashing: every key press is one
// struggle, and the monster that holds the hero decides how many it takes
// (systems/monsters/monsteri.js). In the stocks a key press does nothing but
// make the crowd jeer; the city lets the hero go (wilds/city/law.js).
// Pure — game.js ticks it and feeds it the key presses.
//
//   player.ice    = { t, dur }                      seconds left / at the start
//   player.held   = { by, presses, jolt, side }     the holder, struggles so far,
//                                                   and the shake each press gives
//   player.stocks = { t, fade, seated }             seconds left, the arrest's fade,
//                                                   in the stocks yet
export const JOLT_TIME = 0.15   // s a press shakes the held hero for

export function freezePlayer(player, dur) {
  if (player.ice && player.ice.t >= dur) return
  player.ice = { t: dur, dur }
  player.charging = null
}

// A grab breaks the ice: from here on the grip is what holds the hero.
export function grabPlayer(player, by) {
  player.ice = null
  player.held = { by, presses: 0, jolt: 0, side: 1 }
  player.charging = null
  player.knockback = null
}

export function releasePlayer(player) {
  const by = player.held?.by ?? null
  player.held = null
  return by
}

// One key press against the grip. False when nothing holds the hero.
export function struggle(player) {
  const h = player.held
  if (!h) return false
  h.presses += 1
  h.jolt = 1
  h.side = -h.side
  return true
}

// Once a frame: the ice thaws, a jolt settles, and a grip whose holder died
// or left the level lets go (the holder's own update is what normally
// releases the hero, but a dead monster no longer runs it).
export function tickBinds(player, delta, entities = null) {
  if (player.ice) {
    player.ice.t -= delta
    if (player.ice.t <= 0) player.ice = null
  }
  const h = player.held
  if (!h) return
  h.jolt = Math.max(0, h.jolt - delta / JOLT_TIME)
  if (!(h.by.hp > 0) || (entities && !entities.includes(h.by))) player.held = null
}

export const playerBound = player => !!(player.ice || player.held || player.stocks)
