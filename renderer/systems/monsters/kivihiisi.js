// Kivihiisi, the Hiisi of the Pass — the Mountain Pass quest's boss
// (docs/superpowers/specs/2026-09-10-adventure-quests-design.md §4). The ring
// of boulders around the oven is its life: while one stands it sits rooted
// on the oven, unhurt by any weapon, and lashes a tentacle at whoever is in
// range — it sees straight through its own ring, so the only cover is a
// standing boulder squarely on the line, where the tentacle stops dead; a
// step off that line while mining is a grab, and a grab reels the player
// toward the oven and its maul. The quest module (quests/pass.js) owns the
// ring count and calls syncStones every frame; the fall of the last stone is
// the kill (a `source: 'ring'` hit, the one hit this hook lets land).
//
// Runs as a CREATURE_UPDATE supplement AFTER brain+act (systems/monsters.js),
// so pinning means undoing this frame's movement, Podeboo-style; rootTimer is
// topped up as well so act() does not even try. The def carries no
// behavior.driver: the brain still turns it and swings its maul at anyone who
// walks up to the oven. The tentacles are drawn by systems/monsters.js
// (drawTentacles) off `e.lash`. Pure — no browser/Electron imports.
import { CREATURE_HIT, CREATURE_UPDATE } from '../creatures.js'
import { isWalkable } from '../entities.js'
import { damagePlayer } from '../player-damage.js'
import { startKnockback } from '../knockback.js'
import { sfx } from '../sfx.js'

const S = 32
export const RING_STONES = 6

export const LASH = {
  range: 9 * S,        // px: how far a tentacle reaches
  windup: 0.4,         // s the eyes light before it lashes
  speed: 300,          // px/s the tip extends
  retractSpeed: 600,   // px/s it comes back
  cooldown: 1.5,       // s between lashes (windup not included)
  dmg: 2,
  reach: 12,           // px: tip-to-player-centre distance that grabs
  pull: 3 * S,         // px the grab reels the player toward the oven
}

const norm = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a }

// A registry spawn arrives with type/x/y/px/py/hp and the def's weapon
// (behavior.weapon → makeMonsterFromDef), so the first touch stamps only the
// siege state: the standing count, the anchor it is rooted to, the lash.
export function ensureKivihiisi(e, stones = RING_STONES) {
  if (e.stones !== undefined) return e
  Object.assign(e, {
    stones,
    anchor: { x: e.x, y: e.y, px: e.px, py: e.py },
    lash: { state: 'idle', t: 0, cd: 0, len: 0, aim: 0 },
  })
  return e
}

// The standing count is its hp bar: six stones full, each mined stone a
// sixth off. Never below 1 here — the last stone's fall is a hit, not a
// sync, so the kill goes through hurtCreature like every other death.
export function syncStones(e, stones) {
  ensureKivihiisi(e, stones)
  e.stones = stones
  e.inCombat = true
  if (stones > 0) e.hp = Math.max(1, Math.round(e.maxHp * stones / RING_STONES))
  return e
}

function pin(e) {
  const a = e.anchor
  e.px = a.px; e.py = a.py; e.x = a.x; e.y = a.y
  e.rootTimer = Math.max(e.rootTimer ?? 0, 1)
}

function endLash(e, l) {
  l.state = 'idle'; l.t = 0; l.len = 0; l.cd = LASH.cooldown
  if (e.pose) { e.pose.eyeGlow = 0; e.pose.headAim = undefined }
}

function tickLash(e, state, delta) {
  const { player, map } = state
  const l = e.lash
  if (l.state === 'idle') {
    l.cd = Math.max(0, l.cd - delta)
    if (l.cd > 0 || !player || player.hp <= 0) return
    if (Math.hypot(player.px - e.px, player.py - e.py) > LASH.range) return
    l.state = 'windup'; l.t = 0; l.len = 0
    return
  }
  l.t += delta
  if (l.state === 'windup') {
    // the head tracks the player and the eyes light; the aim locks at the end
    l.aim = Math.atan2(player.py - e.py, player.px - e.px)
    if (e.pose) {
      e.pose.headAim = norm(l.aim - e.pose.facing)
      e.pose.eyeGlow = Math.min(1, l.t / LASH.windup)
    }
    if (l.t >= LASH.windup) { l.state = 'extend'; l.len = 0 }
    return
  }
  if (l.state === 'retract') {
    l.len -= LASH.retractSpeed * delta
    if (l.len <= 0) endLash(e, l)
    return
  }
  // extend: the tip walks the locked aim; a wall cell stops it (a standing
  // boulder is one), the player's centre within reach is the grab.
  l.len = Math.min(LASH.range, l.len + LASH.speed * delta)
  const tx = e.px + Math.cos(l.aim) * l.len, ty = e.py + Math.sin(l.aim) * l.len
  const cell = map?.[Math.floor(ty / S)]?.[Math.floor(tx / S)]
  if (!cell || !isWalkable(cell.tile, cell)) { l.len = Math.max(0, l.len - LASH.speed * delta); l.state = 'retract'; return }
  if (Math.hypot(player.px - tx, player.py - ty) <= LASH.reach) {
    damagePlayer(state, LASH.dmg, 'hit', { px: e.px, py: e.py })
    startKnockback(player, e.px - player.px, e.py - player.py, LASH.pull)
    sfx(state, 'drag', { px: player.px, py: player.py })
    l.state = 'retract'
    return
  }
  if (l.len >= LASH.range) l.state = 'retract'
}

export function update(e, state, delta) {
  ensureKivihiisi(e)
  if (!(e.stones > 0)) { if (e.lash.state !== 'idle') endLash(e, e.lash); return }
  pin(e)
  tickLash(e, state, delta)
}

CREATURE_UPDATE.kivihiisi = update

// Absorbed while a stone stands — unless the hit is the ring's own fall.
CREATURE_HIT.kivihiisi = (e, state, dmg, opts = {}) => {
  ensureKivihiisi(e)
  if (e.stones > 0 && opts.source !== 'ring') return { entity: e, absorbed: true, cue: 'wall-slam' }
  return { entity: { ...e, hp: e.hp - dmg, inCombat: true }, absorbed: false, cue: 'melee-hit' }
}
