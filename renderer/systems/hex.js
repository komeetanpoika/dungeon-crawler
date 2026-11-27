// The frog hex (the marsh coven's: a witch's wisp, systems/tribes/wisps.js).
// It wounds nothing. For its seconds the hero is a frog: he hops about at
// HEX.speed of his walk and may still sprint, but a frog has no hands
// (hasHands): no swing, shot or cast, no offhand, no shield, no change of
// stance, no sack and no map. game.js gates each of those on hasHands and
// ticks this once a frame; render/canvas.js draws the frog in the hero's place.
//
// When it ends the hero is warded for HEX.ward seconds, in which no hex
// takes: nobody is kept a frog. Nor does one take on a hero who is riding the
// coach, frozen, held or in the stocks (systems/player-bind.js). A new hex on
// a frog starts its time again. It ends with his death, leaving no ward.
// Pure and DOM-free.
//
//   player.hex      { t, dur }   seconds left as a frog / at the start
//   player.hexWard  seconds in which no hex takes
import { playerBound } from './player-bind.js'

export const HEX = { speed: 0.85, ward: 3 }

export const isFrog = player => player?.hex?.t > 0
// Everything a frog cannot do takes hands.
export const hasHands = player => !isFrog(player)
export const frogSpeedMul = player => (isFrog(player) ? HEX.speed : 1)

// True when it took. Whatever the hands were doing is dropped: a charge in
// progress, a raised shield, a stance switch under way, a swing in the air.
export function hexPlayer(player, seconds) {
  if (!(seconds > 0) || !(player.hp > 0) || playerBound(player) || player.hexWard > 0) return false
  player.hex = { t: seconds, dur: seconds }
  player.charging = null
  player.blocking = false
  player.stanceSwitch = null
  player.attackTimer = 0
  return true
}

export function clearHex(player) {
  player.hex = null
  player.hexWard = 0
}

// Once a frame: the frog's time, and only then the ward's.
export function tickHex(player, delta) {
  if (player.hex) {
    if (!(player.hp > 0)) { clearHex(player); return }
    player.hex.t -= delta
    if (player.hex.t <= 0) { player.hex = null; player.hexWard = HEX.ward }
    return
  }
  if (player.hexWard > 0) player.hexWard = Math.max(0, player.hexWard - delta)
}
