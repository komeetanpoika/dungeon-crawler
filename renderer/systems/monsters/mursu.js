// Mursu-ukko, the walrus: champion of the seal folk and judge of their
// court. He sits on his seat by the tide ring (`e.home`, tiles: the ring's
// middle; `e.ring`, tiles: how wide it is; on the bench the ring is `ring`
// tiles round where he stands). A gong stands beside it (kumistin.js).
//
// The bout. Striking the gong calls him (startDuel): he gallumphs into the
// ring and fights for sport (`e.duel`: no longer `peaceful`, see
// systems/tribes.js, and still his hook's own, not the brain's). Nobody dies
// in his ring: none of his blows takes the hero's last hp, and a hero down
// to 1 is thrown out over the stones and the bout is over. So is a hero who
// stays more than `outside` tiles beyond the ring for `forfeit` seconds, who
// dies of something else, or who rides off. He mends at once and may be
// called again after `rematch` seconds (`forfeitRest` after a forfeit).
// Brought to nothing himself he does not die: he yields, sits down and
// laughs. The first time that is the talent Mursun sydän; the next time one
// chest's roll laid at his feet (once for each walrus); after that, the
// laugh. He refuses a hero who has only 1 hp left to lose.
// A bout that is over leaves him in the ring a moment longer (`e.duel` stays
// up for `grace` seconds, or for as long as he laughs): a blow that was
// already on its way then does nothing at all, where a blow on a walrus at
// peace would be his whole tribe's quarrel.
//
// His moves, in a bout and wronged alike, `gap` seconds apart:
//   belly flop   with the hero `flopMin`..`flopMax` tiles off: he rears for
//                `rear` s over a shadow that follows the hero for the first
//                `flopLock` s, leaps `leap` s and lands on it: `flopDmg` and a
//                throw to a hero within `flopR` tiles (from the ground: no
//                shield stops it)
//   tusk charge  with the hero `chargeMin`..`chargeMax` tiles off, in sight:
//                `aim` s with his head down, the line fixed at `aimLock`;
//                then `rushSpeed` px/s for at most `rushTime` s: `chargeDmg`
//                and a throw to a hero within `chargeHit` tiles of him, once
//                (a raised shield takes it). Whatever ends it, a rock, the
//                ring's edge or time, he is winded for `winded` s
//   bellow       with the hero within `bellowR` tiles: `bellowWind` s, then a
//                shove of `shove` tiles and no damage; `follow` s later comes
//                whichever of the other two is ready, at the hero shoved off
// Blubber: a blow takes 1 from him whatever it is, except while he is
// winded, when it lands whole.
//
// Wronged (his tribe's wrath) he fights the same way without mercy, the
// enemy brain walking him between moves (`e.brainDriven`), and he can die:
// the def leaves a chest's worth (`behavior.drops`). Wrath in the middle of
// a bout turns it into that fight where it stands. When the grudge is over
// he mends and goes back to his seat.
//
// Runs first-thing at peace and in a bout, and after brain and act when he
// is wronged (game.js enemy loop): outside 'stalk' every frame starts by
// putting him back where his own last frame left him. Pure: no browser imports.
//
//   e.duel      in the ring: a bout under way (`e.walrus.live`), or just over
//   e.paid      this walrus has given his chest's roll
//   e.walrus    { state, t, live, grace, gap, cd: { flop, charge, bellow }, rest, out, say, last,
//                 to { px, py }, from { px, py }, aim, len, struck, pay }
//               state: 'sit' | 'home' | 'yield' at peace; 'enter' | 'stalk' |
//               'rear' | 'leap' | 'land' | 'aim' | 'rush' | 'winded' |
//               'bellow' | 'roar' in a fight
//   e.channels  { air } | { charge } | { winded } | { bellow } | { laugh }  for the rig
import { CREATURE_HIT, CREATURE_UPDATE } from '../creatures.js'
import { tuningOf, getMonsterDef, entityPose } from '../monsters.js'
import { hasLineOfSight, isWalkable } from '../entities.js'
import { canMoveTo } from '../nav.js'
import { act } from '../act.js'
import { damagePlayer } from '../player-damage.js'
import { startKnockback } from '../knockback.js'
import { shatterBonus } from '../status.js'
import { grantTalent } from '../talents.js'
import { rollChestLoot } from '../loot.js'
import { addFloat, speakFrom, sayDuration } from '../feedback.js'
import { tribeOf, wrathOf, withId } from '../tribes.js'
import { sfx } from '../sfx.js'
import { heroOk, tilesTo, glow, turnTo, postOf, walkTo, goHome, keepSide } from './norppakauppias.js'

const S = 32
const PEACE = new Set(['sit', 'home', 'yield'])
const MOVES = ['flop', 'charge', 'bellow']
const SAY_EVERY = 2          // s between two refusals (a hero hammering the gong)
const LAND_SHOW = 0.45       // s the dust of a landing is drawn
const ROAR_SHOW = 0.35       // s the bellow's rings are drawn

// What he says in his court.
export const LINES = {
  start: 'Ha! Into the ring, little two-legs!',
  rest: 'Let an old walrus catch his breath.',
  hurt: 'You can hardly stand. See the singer first.',
  lost: 'Out you go! A good bout. The singer will see to you.',
  forfeit: 'Gone already? Strike the gong when you mean it.',
  heart: 'Ho ho ho! I yield! You have a walrus\'s heart, little two-legs.',
  prize: 'Ho ho! Again! Take this for your trouble.',
  again: 'Ho ho! Enough, enough. You win.',
}

export const TUNING_SCHEMA = [
  { key: 'ring', label: 'Ring (no court)', group: 'bout', type: 'range', min: 3, max: 9, step: 0.5, default: 5, hint: 'tiles: the ring round where he stands when he was dealt none' },
  { key: 'inside', label: 'Comes in', group: 'bout', type: 'range', min: 0.5, max: 4, step: 0.5, default: 2, hint: 'tiles inside the stones before he fights' },
  { key: 'rim', label: 'Keeps off the stones', group: 'bout', type: 'range', min: 0.3, max: 2, step: 0.1, default: 0.7, hint: 'tiles from the ring\'s edge he will not cross in a bout' },
  { key: 'outside', label: 'Out of the ring', group: 'bout', type: 'range', min: 0.5, max: 6, step: 0.5, default: 1, hint: 'tiles beyond the stones that count as gone: keep it inside what his flop and tusks reach from the ring, or he can be shot from where he cannot answer' },
  { key: 'forfeit', label: 'Forfeit after', group: 'bout', type: 'range', min: 0.5, max: 10, step: 0.5, default: 3, hint: 'seconds outside' },
  { key: 'rematch', label: 'Rematch after', group: 'bout', type: 'range', min: 0, max: 300, step: 5, default: 60, hint: 'seconds after a bout fought to its end' },
  { key: 'forfeitRest', label: 'After a forfeit', group: 'bout', type: 'range', min: 0, max: 120, step: 1, default: 10, hint: 'seconds before he answers the gong again' },
  { key: 'clear', label: 'Thrown clear', group: 'bout', type: 'range', min: 0, max: 4, step: 0.5, default: 1.5, hint: 'tiles beyond the stones a beaten hero is thrown' },
  { key: 'laugh', label: 'Laughs for', group: 'bout', type: 'range', min: 0.5, max: 8, step: 0.5, default: 2.5, hint: 'seconds, when he has yielded' },
  { key: 'grace', label: 'Blows count for nothing', group: 'bout', type: 'range', min: 0, max: 6, step: 0.1, default: 1.5, hint: 'seconds after a bout he lost or the hero left: a blow already on its way wrongs nobody' },
  { key: 'enterHaste', label: 'Haste into the ring', group: 'bout', type: 'range', min: 1, max: 3, step: 0.1, default: 1.6, hint: 'times his speed' },
  { key: 'enterMax', label: 'Comes in for at most', group: 'bout', type: 'range', min: 1, max: 20, step: 1, default: 8, hint: 'seconds; then he fights from where he is' },
  { key: 'keep', label: 'Closes to', group: 'bout', type: 'range', min: 0.5, max: 4, step: 0.1, default: 1.6, hint: 'tiles from the hero, between moves in a bout' },
  { key: 'gap', label: 'Between moves', group: 'bout', type: 'range', min: 0.2, max: 5, step: 0.1, default: 1.4, hint: 'seconds' },
  { key: 'flopMin', label: 'Flop from', group: 'flop', type: 'range', min: 0, max: 6, step: 0.5, default: 1.5, hint: 'tiles (where the bellow\'s reach ends: no ring of safety between the two)' },
  { key: 'flopMax', label: 'Flop to', group: 'flop', type: 'range', min: 2, max: 12, step: 0.5, default: 6, hint: 'tiles' },
  { key: 'rear', label: 'Rears for', group: 'flop', type: 'range', min: 0.2, max: 3, step: 0.05, default: 0.8, hint: 'seconds of tell' },
  { key: 'flopLock', label: 'Shadow follows for', group: 'flop', type: 'range', min: 0, max: 3, step: 0.05, default: 0.6, hint: 'seconds of the rear; then it stays (a walk clears the landing in 0.6 s)' },
  { key: 'leap', label: 'Leap', group: 'flop', type: 'range', min: 0.2, max: 2, step: 0.05, default: 0.5, hint: 'seconds in the air' },
  { key: 'flopR', label: 'Lands on', group: 'flop', type: 'range', min: 0.5, max: 5, step: 0.1, default: 2.2, hint: 'tiles round where he comes down' },
  { key: 'flopDmg', label: 'Flop damage', group: 'flop', type: 'range', min: 0, max: 8, step: 1, default: 2 },
  { key: 'flopThrow', label: 'Flop throw', group: 'flop', type: 'range', min: 0, max: 160, step: 4, default: 64, hint: 'px outward' },
  { key: 'recover', label: 'Gets up in', group: 'flop', type: 'range', min: 0, max: 3, step: 0.1, default: 0.5, hint: 'seconds after he lands' },
  { key: 'flopEvery', label: 'Flop every', group: 'flop', type: 'range', min: 1, max: 20, step: 0.5, default: 4.5, hint: 'seconds' },
  { key: 'chargeMin', label: 'Charge from', group: 'charge', type: 'range', min: 0, max: 8, step: 0.5, default: 2.5, hint: 'tiles' },
  { key: 'chargeMax', label: 'Charge to', group: 'charge', type: 'range', min: 3, max: 16, step: 0.5, default: 9, hint: 'tiles' },
  { key: 'aim', label: 'Head down for', group: 'charge', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1, hint: 'seconds of tell' },
  { key: 'aimLock', label: 'Line fixed at', group: 'charge', type: 'range', min: 0, max: 3, step: 0.05, default: 0.7, hint: 'seconds into the tell' },
  { key: 'rushSpeed', label: 'Rush speed', group: 'charge', type: 'range', min: 100, max: 600, step: 10, default: 320, hint: 'px/s' },
  { key: 'rushTime', label: 'Rush for at most', group: 'charge', type: 'range', min: 0.2, max: 4, step: 0.1, default: 1.3, hint: 'seconds' },
  { key: 'chargeHit', label: 'Tusks reach', group: 'charge', type: 'range', min: 0.4, max: 3, step: 0.1, default: 1.1, hint: 'tiles from his centre' },
  { key: 'chargeDmg', label: 'Charge damage', group: 'charge', type: 'range', min: 0, max: 8, step: 1, default: 3 },
  { key: 'chargeThrow', label: 'Charge throw', group: 'charge', type: 'range', min: 0, max: 160, step: 4, default: 72, hint: 'px along his line' },
  { key: 'winded', label: 'Winded for', group: 'charge', type: 'range', min: 0, max: 6, step: 0.1, default: 1.8, hint: 'seconds he takes blows whole' },
  { key: 'chargeEvery', label: 'Charge every', group: 'charge', type: 'range', min: 1, max: 30, step: 0.5, default: 7, hint: 'seconds' },
  { key: 'chargeFirst', label: 'First charge after', group: 'charge', type: 'range', min: 0, max: 20, step: 0.5, default: 3, hint: 'seconds into a fight (the flop comes first)' },
  { key: 'bellowR', label: 'Bellows within', group: 'bellow', type: 'range', min: 0.5, max: 5, step: 0.1, default: 1.5, hint: 'tiles' },
  { key: 'bellowWind', label: 'Draws breath', group: 'bellow', type: 'range', min: 0.1, max: 2, step: 0.05, default: 0.4, hint: 'seconds of tell' },
  { key: 'bellowReach', label: 'Bellow carries', group: 'bellow', type: 'range', min: 0.5, max: 6, step: 0.1, default: 1.9, hint: 'tiles: a hero this near when it comes is shoved' },
  { key: 'shove', label: 'Shove', group: 'bellow', type: 'range', min: 0, max: 8, step: 0.5, default: 3, hint: 'tiles' },
  { key: 'bellowEvery', label: 'Bellow every', group: 'bellow', type: 'range', min: 1, max: 30, step: 0.5, default: 6, hint: 'seconds' },
  { key: 'follow', label: 'Follows a bellow in', group: 'bellow', type: 'range', min: 0, max: 5, step: 0.05, default: 0.25, hint: 'seconds before his next move, at the hero he has just shoved off' },
  { key: 'homeSpeed', label: 'Speed home', group: 'peace', type: 'range', min: 10, max: 160, step: 5, default: 60, hint: 'px/s back to his seat' },
  { key: 'turn', label: 'Turns to the hero within', group: 'peace', type: 'range', min: 0, max: 12, step: 0.5, default: 6, hint: 'tiles' },
]

const half = e => getMonsterDef(e.type)?.stats.half ?? 13
const speedOf = e => getMonsterDef(e.type)?.stats.speed ?? 50
const tribeWrath = (e, state) => wrathOf(state, tribeOf(e)) > 0
const chan = (e, c) => { e.channels = c }
const to = (m, state) => { m.state = state; m.t = 0 }
const place = (e, px, py) => { e.px = px; e.py = py; e.x = Math.floor(px / S); e.y = Math.floor(py / S) }

function ensure(e) {
  if (e.walrus) return e.walrus
  // (a bout's flag without the state behind it, a save loaded in the middle of one, is no bout)
  e.duel = false
  e.aiHalf = half(e)
  postOf(e)
  return e.walrus = { state: 'sit', t: 0, live: false, grace: 0, gap: 0, cd: { flop: 0, charge: 0, bellow: 0 }, rest: 0, out: 0, say: 0, last: null,
    to: null, from: null, aim: 0, len: 0, struck: false, pay: false }
}
// The ring: its middle in px and its radius in tiles.
const homeOf = e => (e.home ? { px: e.home.x * S + S / 2, py: e.home.y * S + S / 2 } : postOf(e))
const ringOf = (e, T) => (Number.isFinite(e.ring) ? e.ring : T.ring)
const fromHome = (e, px, py) => { const h = homeOf(e); return Math.hypot(px - h.px, py - h.py) / S }

function say(e, m, state, line, must = false) {
  if (!must && m.say > 0) return
  m.say = SAY_EVERY
  speakFrom(state, withId(e), line, sayDuration(line))
}
// Whatever move he was in is over: nothing glows, nothing is aimed.
function settle(e, m) {
  glow(e, 0)
  chan(e, {})
  m.to = null; m.from = null; m.struck = false; m.len = 0
}
// Into a fight (a bout, or the tribe's wrath): the flop comes first.
function arm(m, T) {
  m.gap = T.gap
  m.cd = { flop: 0, charge: T.chargeFirst, bellow: 0 }
}

// ---- the bout ---------------------------------------------------------------------

// The gong has been struck (kumistin.js). True when he takes the challenge.
export function startDuel(e, state) {
  const T = tuningOf(e.type), m = ensure(e)
  const { player } = state
  if (e.duel || !(e.hp > 0) || e.dying > 0 || tribeWrath(e, state) || !heroOk(player)) return false
  if (m.rest > 0) { say(e, m, state, LINES.rest); return false }
  if (player.hp <= 1) { say(e, m, state, LINES.hurt); return false }
  e.duel = true
  e.inCombat = true
  m.live = true; m.grace = 0
  m.out = 0; m.pay = false
  settle(e, m)
  arm(m, T)
  to(m, 'enter')
  say(e, m, state, LINES.start, true)
  sfx(state, 'seal-bark', { px: e.px, py: e.py })
  return true
}

// A bout under way, as against one just over or none.
export const inBout = e => !!e.duel && !!e.walrus?.live

// how: 'lost' (the hero is down to 1) | 'won' (he yields) | 'forfeit' | 'void' (the hero is dead)
function endBout(e, m, state, T, how) {
  const { player } = state
  // he stays in the ring a moment (see the header): `e.duel` comes down when the grace runs out
  m.live = false
  m.grace = how === 'won' ? T.laugh : how === 'void' ? 0 : T.grace
  if (!(m.grace > 0)) e.duel = false
  e.hp = e.maxHp                                           // he mends
  e.inCombat = false
  m.out = 0
  m.rest = how === 'lost' || how === 'won' ? T.rematch : T.forfeitRest
  settle(e, m)
  to(m, how === 'won' ? 'yield' : 'home')
  if (how === 'forfeit') say(e, m, state, LINES.forfeit, true)
  if (how !== 'lost') return
  // out over the stones
  const h = homeOf(e), dx = player.px - h.px, dy = player.py - h.py, d = Math.hypot(dx, dy)
  startKnockback(player, d > 1 ? dx : 0, d > 1 ? dy : 1, Math.max(T.flopThrow, (ringOf(e, T) + T.clear) * S - d))
  say(e, m, state, LINES.lost, true)
  sfx(state, 'seal-bark', { px: e.px, py: e.py })
}

// The judge's eye, every frame of a bout. False when it has just ended.
function referee(e, m, state, delta, T) {
  const { player } = state
  if (!player || !(player.hp > 0)) { endBout(e, m, state, T, 'void'); return false }
  if (player.riding) { endBout(e, m, state, T, 'forfeit'); return false }
  if (player.hp <= 1) { endBout(e, m, state, T, 'lost'); return false }
  const gone = m.state !== 'enter' && fromHome(e, player.px, player.py) > ringOf(e, T) + T.outside
  m.out = gone ? m.out + delta : 0
  if (m.out >= T.forfeit) { endBout(e, m, state, T, 'forfeit'); return false }
  return true
}

// His blow on the hero: in a bout never the last hp. Whether it landed.
function strike(e, state, dmg, from) {
  const { player } = state
  const amount = e.duel ? Math.min(dmg, player.hp - 1) : dmg
  return amount > 0 && damagePlayer(state, amount, 'hit', from)
}
// The hero thrown `px` along (dx, dy); straight down the screen when he stands on the very spot.
function hurl(player, dx, dy, px) {
  const away = Math.hypot(dx, dy) > 0.5
  startKnockback(player, away ? dx : 0, away ? dy : 1, px)
}

// One chest's roll at his feet, on the free cell nearest the hero.
function layPrize(e, state) {
  const { map, player } = state
  let at = { x: e.x, y: e.y }, best = Infinity
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = e.x + dx, y = e.y + dy, c = map[y]?.[x]
    if (!(dx || dy) || !c || !isWalkable(c.tile, c) || c.over || state.entities.some(o => o.x === x && o.y === y)) continue
    const d = Math.hypot(x - player.x, y - player.y) + Math.hypot(dx, dy) * 0.5
    if (d < best) { best = d; at = { x, y } }
  }
  state.entities.push({
    type: 'floating_item', contents: rollChestLoot(e.lootDepth ?? 1, Math.random, player), x: at.x, y: at.y,
    startPx: e.px, startPy: e.py, targetPx: at.x * S + S / 2, targetPy: at.y * S + S / 2,
    px: e.px, py: e.py, progress: 0, duration: 0.35,
  })
}

// ---- at peace ---------------------------------------------------------------------

function peace(e, m, state, delta, T) {
  const { player } = state
  m.rest = Math.max(0, m.rest - delta)
  if (!PEACE.has(m.state)) {
    // peace has come back in the middle of a fight: he drops it, and mends
    settle(e, m)
    to(m, 'home')
    e.hp = e.maxHp; e.inCombat = false
  }
  e.quiet = m.state !== 'sit'
  if (m.state === 'yield') {
    chan(e, { laugh: 1 })
    if (m.pay) { m.pay = false; layPrize(e, state) }
    if ((m.t += delta) >= T.laugh) { chan(e, {}); to(m, 'home') }
    return
  }
  m.state = goHome(e, state, delta, T.homeSpeed) ? 'sit' : 'home'
  if (m.state === 'sit' && heroOk(player) && tilesTo(e, player) <= T.turn) turnTo(e, player.px)
}

// ---- his moves --------------------------------------------------------------------

function enter(e, m, state, delta, T) {
  // (in the ring he takes a breath before his first move: time for the hero to come in too)
  if (!e.duel || m.t >= T.enterMax || fromHome(e, e.px, e.py) <= Math.max(0.5, ringOf(e, T) - T.inside)) { to(m, 'stalk'); m.gap = T.gap; return }
  const h = homeOf(e)
  turnTo(e, h.px)
  walkTo(e, state, delta, h, speedOf(e) * T.enterHaste)
}

function stalk(e, m, state, delta, T) {
  const { player, map } = state
  if (!heroOk(player)) return
  if (e.duel) {
    // the bout is his hook's own: he closes in, and keeps off the stones
    const was = { px: e.px, py: e.py, x: e.x, y: e.y }
    act(e, state, delta, { mode: 'approach', speed: speedOf(e), stopRange: T.keep * S })
    const now = fromHome(e, e.px, e.py)
    if (now > ringOf(e, T) - T.rim && now > fromHome(e, was.px, was.py)) Object.assign(e, was)
  }
  turnTo(e, player.px)
  if (m.gap > 0) return
  const d = tilesTo(e, player)
  if (m.cd.bellow <= 0 && d <= T.bellowR) {
    to(m, 'bellow')
  } else if (m.cd.charge <= 0 && d >= T.chargeMin && d <= T.chargeMax && hasLineOfSight(map, e.y, e.x, player.y, player.x)) {
    to(m, 'aim')
    m.aim = Math.atan2(player.py - e.py, player.px - e.px)
    sfx(state, 'walrus-snort', { px: e.px, py: e.py })
  } else if (m.cd.flop <= 0 && d >= T.flopMin && d <= T.flopMax) {
    to(m, 'rear')
    m.to = landing(e, state, T)
    sfx(state, 'walrus-snort', { px: e.px, py: e.py })
  }
}

// A move given up: the hero it was meant for is gone.
function drop(e, m, T) { settle(e, m); to(m, 'stalk'); m.gap = T.gap }

// Where a flop would come down now: on the hero; in a bout no nearer the
// stones than he goes; and never in a rock (back along his own line to the
// last place he fits).
function landing(e, state, T) {
  const { player, map } = state
  let px = player.px, py = player.py
  if (e.duel) {
    const h = homeOf(e), d = Math.hypot(px - h.px, py - h.py), most = Math.max(0, ringOf(e, T) - T.rim) * S
    if (d > most) { px = h.px + (px - h.px) * most / d; py = h.py + (py - h.py) * most / d }
  }
  const dx = px - e.px, dy = py - e.py, len = Math.hypot(dx, dy)
  for (let back = 0; back < len; back += 8) {
    const x = px - dx / len * back, y = py - dy / len * back
    if (canMoveTo(map, x, y, half(e))) return { px: x, py: y }
  }
  return { px: e.px, py: e.py }
}

function rear(e, m, state, delta, T) {
  const { player } = state
  if (!heroOk(player)) { drop(e, m, T); return }
  if (m.t < T.flopLock) m.to = landing(e, state, T)       // the shadow follows him this long, then stays
  turnTo(e, m.to.px)
  glow(e, Math.min(1, m.t / T.rear))
  if (m.t < T.rear) return
  m.from = { px: e.px, py: e.py }
  to(m, 'leap')
  glow(e, 0)
}

function leap(e, m, state, delta, T) {
  const { player } = state
  const f = Math.min(1, m.t / T.leap)
  place(e, m.from.px + (m.to.px - m.from.px) * f, m.from.py + (m.to.py - m.from.py) * f)
  chan(e, { air: Math.sin(Math.PI * f) })
  if (f < 1) return
  // he lands
  chan(e, {})
  sfx(state, 'flop', { px: e.px, py: e.py })
  if (heroOk(player) && tilesTo(e, player) <= T.flopR && strike(e, state, T.flopDmg, null))
    hurl(player, player.px - e.px, player.py - e.py, T.flopThrow)
  m.cd.flop = T.flopEvery
  m.gap = T.gap
  to(m, 'land')
}

function land(e, m, state, delta, T) {
  if (m.t >= T.recover) to(m, 'stalk')
}

// How far along his line he would get: to a rock, to the stones in a bout, or as far as his wind lasts.
function reachOf(e, m, state, T) {
  const most = T.rushSpeed * T.rushTime, dx = Math.cos(m.aim), dy = Math.sin(m.aim)
  for (let s = 8; s <= most; s += 8) if (blocked(e, state, T, e.px + dx * s, e.py + dy * s, e.px + dx * (s - 8), e.py + dy * (s - 8))) return s - 8
  return most
}
// What ends a rush on the way from (x0, y0) to (px, py): 'rock', 'edge' (the ring's, in a bout) or null.
function blocked(e, state, T, px, py, x0, y0) {
  if (!canMoveTo(state.map, px, py, half(e))) return 'rock'
  if (e.duel && fromHome(e, px, py) > ringOf(e, T) - T.rim && fromHome(e, px, py) > fromHome(e, x0, y0)) return 'edge'
  return null
}

function aim(e, m, state, delta, T) {
  const { player } = state
  if (!heroOk(player)) { drop(e, m, T); return }
  if (m.t < T.aimLock) m.aim = Math.atan2(player.py - e.py, player.px - e.px)
  m.len = reachOf(e, m, state, T)
  if (e.pose) e.pose.facing = m.aim
  chan(e, { charge: Math.min(1, m.t / (T.aim * 0.3)) })
  glow(e, Math.min(1, m.t / T.aim))
  if (m.t < T.aim) return
  m.struck = false
  to(m, 'rush')
}

function rush(e, m, state, delta, T) {
  const { player } = state
  chan(e, { charge: 1 })
  glow(e, 1)
  if (e.pose) e.pose.facing = m.aim
  const step = T.rushSpeed * delta
  const px = e.px + Math.cos(m.aim) * step, py = e.py + Math.sin(m.aim) * step
  const stop = m.t >= T.rushTime ? 'time' : blocked(e, state, T, px, py, e.px, e.py)
  if (stop) {
    // whatever ends it, he is winded
    if (stop === 'rock') sfx(state, 'wall-slam', { px: e.px, py: e.py })
    settle(e, m)
    chan(e, { winded: 1 })
    m.cd.charge = T.chargeEvery
    to(m, 'winded')
    return
  }
  place(e, px, py)
  if (m.struck || !heroOk(player) || tilesTo(e, player) > T.chargeHit) return
  m.struck = true
  if (strike(e, state, T.chargeDmg, { px: e.px, py: e.py }))
    hurl(player, Math.cos(m.aim) * 2 + (player.px - e.px) / S, Math.sin(m.aim) * 2 + (player.py - e.py) / S, T.chargeThrow)
}

function winded(e, m, state, delta, T) {
  chan(e, { winded: 1 })
  if (m.t < T.winded) return
  chan(e, {})
  m.gap = T.gap * 0.5
  to(m, 'stalk')
}

function bellow(e, m, state, delta, T) {
  const { player } = state
  chan(e, { bellow: Math.min(1, m.t / T.bellowWind) })
  if (heroOk(player)) turnTo(e, player.px)
  if (m.t < T.bellowWind) return
  sfx(state, 'seal-bark', { px: e.px, py: e.py })
  if (heroOk(player) && tilesTo(e, player) <= T.bellowReach) hurl(player, player.px - e.px, player.py - e.py, T.shove * S)
  m.cd.bellow = T.bellowEvery
  m.gap = ROAR_SHOW + T.follow
  to(m, 'roar')
}

function roar(e, m) {
  chan(e, { bellow: 1 })
  if (m.t < ROAR_SHOW) return
  chan(e, {})
  to(m, 'stalk')
}

const STATES = { enter, stalk, rear, leap, land, aim, rush, winded, bellow, roar }

export function update(e, state, delta) {
  step(e, state, delta)
  keepSide(e)
}

function step(e, state, delta) {
  const T = tuningOf(e.type), m = ensure(e)
  const wrath = tribeWrath(e, state)
  for (const k of MOVES) m.cd[k] = Math.max(0, m.cd[k] - delta)
  m.gap = Math.max(0, m.gap - delta)
  m.say = Math.max(0, m.say - delta)
  if (wrath && e.duel) { e.duel = false; m.live = false; m.grace = 0 }   // the bout has become the real fight, where it stands
  if (e.duel && !m.live && (m.grace -= delta) <= 0) e.duel = false       // a bout over: he has left the ring
  if (inBout(e)) referee(e, m, state, delta, T)
  const fight = wrath || inBout(e)
  e.brainDriven = wrath
  e.spellOpen = fight
  if (!fight) {
    peace(e, m, state, delta, T)
    m.last = null
    return
  }
  if (PEACE.has(m.state)) { settle(e, m); arm(m, T); to(m, 'stalk') }   // wronged where he sat
  // (a stun holds him in a bout as the enemy loop holds a wronged one: nothing else counts it down for him)
  if (!wrath && e.stunTimer > 0) { e.stunTimer -= delta; return }
  // outside the stalk he is where his own last frame left him, whatever the brain or a shove did since
  if (m.state !== 'stalk' && m.last) { Object.assign(e, m.last); e.knockback = null }
  e.quiet = true
  e.inCombat = true
  m.t += delta
  STATES[m.state](e, m, state, delta, T)
  m.last = { px: e.px, py: e.py, x: e.x, y: e.y }
}

// Blubber: 1 from any blow, except winded, when it lands whole (and a blow
// that blubber made lighter says so itself: game.js would float the blade's
// own number). In a bout the blow that would finish him is his yielding.
export function hit(e, state, dmg, opts = {}) {
  const T = tuningOf(e.type), m = ensure(e)
  const wrath = tribeWrath(e, state)
  // (with a bout just over, and with none, nothing lands: the hero's own blow on him at peace has made it wrath before it comes here)
  if (!wrath && !inBout(e)) return { entity: e, absorbed: true, cue: e.duel ? 'melee-hit' : null }
  const took = m.state === 'winded' ? dmg + shatterBonus(e) : Math.min(1, dmg)
  e.inCombat = true
  if (!wrath && e.hp - took <= 0) {
    e.hp = 1
    yieldBout(e, m, state, T)
    return { entity: e, absorbed: false, cue: 'melee-hit' }
  }
  e.hp -= took
  if (took === dmg || e.hp <= 0) return { entity: e, absorbed: false, cue: 'melee-hit' }
  addFloat(state.feedback, { px: e.px, py: e.py - 10, text: `-${took}`, kind: 'dealt' })
  return { entity: e, absorbed: true, cue: 'melee-hit' }
}

function yieldBout(e, m, state, T) {
  endBout(e, m, state, T, 'won')
  chan(e, { laugh: 1 })
  if (grantTalent(state, 'mursun_sydan')) say(e, m, state, LINES.heart, true)
  else if (!e.paid) { e.paid = true; m.pay = true; say(e, m, state, LINES.prize, true) }
  else say(e, m, state, LINES.again, true)
  sfx(state, 'seal-bark', { px: e.px, py: e.py })
}

// ---- drawing over the hero ------------------------------------------------------------
// ctx sits at his screen centre, S px per tile (systems/monsters.js drawMonsterFx).

const DARK = '#2a2418', WARN = '#ff6a3a', PALE = '#fff8e7', DUST = ['#fff8e7', '#a8946c', '#7d6a4a']
const R = Math.round
// a disc of the ground, in rows
function disc(ctx, x, y, r, u) {
  for (let dy = -r; dy < r; dy += u) {
    const w = Math.sqrt(Math.max(0, r * r - (dy + u / 2) ** 2))
    ctx.fillRect(R(x - w), R(y + dy), R(2 * w), u)
  }
}
// marks round a circle, every other one left out, turning with `spin`
function rim(ctx, x, y, r, n, u, spin = 0) {
  for (let i = 0; i < n; i += 2) {
    const a = (i + spin) / n * Math.PI * 2
    ctx.fillRect(R(x + Math.cos(a) * r - u), R(y + Math.sin(a) * r - u / 2), 2 * u, u)
  }
}

export function drawFx(ctx, e, S) {
  const m = e.walrus
  if (!m || !(e.hp > 0) || PEACE.has(m.state)) return
  const T = tuningOf(e.type), k = S / 32, u = Math.max(2, R(2 * k))
  const t = e.pose?.t ?? 0
  ctx.save()
  if ((m.state === 'rear' || m.state === 'leap') && m.to) {
    // the shadow he will come down on: it grows as he comes, its rim is how far the landing reaches
    const x = (m.to.px - e.px) * k, y = (m.to.py - e.py) * k, full = T.flopR * S
    const f = m.state === 'rear' ? 0.35 + 0.3 * Math.min(1, m.t / T.rear) : 0.65 + 0.35 * Math.min(1, m.t / T.leap)
    ctx.fillStyle = DARK
    ctx.globalAlpha = 0.16 + 0.2 * f
    disc(ctx, x, y, full * f, u)
    ctx.globalAlpha = 0.75
    ctx.fillStyle = m.state === 'leap' || m.t >= T.flopLock ? WARN : DARK
    rim(ctx, x, y, full, 28, u, m.state === 'leap' ? 0 : t * 4)
  } else if (m.state === 'land') {
    // sand thrown out from under him
    const f = Math.min(1, m.t / LAND_SHOW), r = T.flopR * S * (0.45 + 0.55 * f)
    if (f < 1) for (let i = 0; i < 22; i++) {
      const a = i / 22 * Math.PI * 2 + (i % 3) * 0.2, s = (2 + (i % 2)) * u
      ctx.globalAlpha = 1 - f * f
      ctx.fillStyle = DUST[i % DUST.length]
      ctx.fillRect(R(Math.cos(a) * r - s / 2), R(Math.sin(a) * r - s / 2 - Math.sin(f * Math.PI) * 7 * k), s, s)
    }
  } else if (m.state === 'aim') {
    // the line he will take: it swings with the hero, then it is fixed and burns
    const fixed = m.t >= T.aimLock, dx = Math.cos(m.aim), dy = Math.sin(m.aim)
    const len = Math.max(S, m.len * k), w = Math.max(2, R((fixed ? 3 : 2) * k))
    ctx.fillStyle = fixed ? WARN : DARK
    ctx.globalAlpha = fixed ? 0.6 + 0.35 * (Math.floor(t * 12) % 2) : 0.5
    for (let s = 18 * k; s < len; s += 10 * k) ctx.fillRect(R(dx * s - w / 2), R(dy * s - w / 2), w, w)
    if (fixed) for (const side of [-1, 1]) {
      // an arrowhead at its end
      const a = m.aim + Math.PI + side * 0.5
      for (let s = 0; s < 14 * k; s += 4 * k) ctx.fillRect(R(dx * len + Math.cos(a) * s - w / 2), R(dy * len + Math.sin(a) * s - w / 2), w, w)
    }
  } else if (m.state === 'rush') {
    // sand kicked up behind him
    const dx = Math.cos(m.aim), dy = Math.sin(m.aim)
    for (let i = 0; i < 12; i++) {
      const back = (12 + i * 5 + (t * 90 + i * 13) % 6) * k, off = (((i * 7919) % 11) - 5) * 1.8 * k
      ctx.globalAlpha = 0.95 - i * 0.06
      ctx.fillStyle = DUST[i % DUST.length]
      const s = Math.max(2, R((3 + (i % 3)) * k))
      ctx.fillRect(R(-dx * back - dy * off - s / 2), R(-dy * back + dx * off - s / 2 + 8 * k - i * 0.7 * k), s, s)
    }
  } else if (m.state === 'bellow' || m.state === 'roar') {
    // the bellow: breath drawn in, then rings thrown out as far as it carries
    const def = getMonsterDef(e.type)
    const mouth = def?.rig.anchor?.(def.params, entityPose(e), S, 'mouth') ?? { x: 0, y: -10 * k }
    if (m.state === 'bellow') {
      const f = Math.min(1, m.t / T.bellowWind)
      ctx.fillStyle = PALE
      ctx.globalAlpha = 0.9
      rim(ctx, mouth.x, mouth.y, (30 - 18 * f) * k, 12, Math.max(1, R(1.5 * k)), t * 6)
    } else {
      const f = Math.min(1, m.t / ROAR_SHOW)
      for (const [i, colour] of [WARN, PALE, WARN].entries()) {
        const r = T.bellowReach * S * Math.min(1, f * 1.2 - i * 0.18)
        if (!(r > 4)) continue
        ctx.fillStyle = colour
        ctx.globalAlpha = Math.max(0, 1 - f * f)
        rim(ctx, 0, mouth.y * 0.5, r, 20, R(1.5 * u), i)
      }
    }
  }
  ctx.restore()
}

export function debugState(e) {
  const m = e.walrus
  if (!m) return '-'
  const cd = MOVES.map(k => `${k} ${m.cd[k].toFixed(1)}`).join(' ')
  return `${inBout(e) ? 'bout ' : e.duel ? 'bout over ' : ''}${m.state} ${m.t.toFixed(1)} gap ${m.gap.toFixed(1)} ${cd}${m.rest > 0 ? ` rest ${m.rest.toFixed(0)}` : ''}${m.out > 0 ? ` out ${m.out.toFixed(1)}` : ''}`
}
// Bench overlay: the ring, where a flop lands, how far the tusks and the bellow reach.
export function debugDraw(ctx, e, S) {
  const T = tuningOf(e.type), h = homeOf(e)
  ctx.strokeStyle = '#7ad7ff'
  ctx.beginPath(); ctx.arc((h.px - e.px) * S / 32, (h.py - e.py) * S / 32, ringOf(e, T) * S, 0, Math.PI * 2); ctx.stroke()
  for (const [r, colour] of [[T.flopR, '#ffe14a'], [T.chargeHit, '#ff5a3a'], [T.bellowReach, '#f8f8f8']]) {
    ctx.strokeStyle = colour
    ctx.beginPath(); ctx.arc(0, 0, r * S, 0, Math.PI * 2); ctx.stroke()
  }
}

CREATURE_UPDATE.mursu = update
CREATURE_HIT.mursu = hit
