// Contested pickups: walk-onto flasks, Archer-only quivers, the power rune
// and the buff spots (2b), each on its own respawn timer; and the rune's
// swap of a hero's main hand for its class's power weapon. Pure: no DOM.
import { weaponContents, makeRangedContents, makeWandContents } from '../systems/entities.js'
import { addAmmo, gearOf } from '../systems/inventory.js'
import { addFloat } from '../systems/feedback.js'
import { sfx } from '../systems/sfx.js'
import { TILE_SIZE } from '../systems/movement.js'
import { PICKUPS, RUNE_POWER, BUFF_SPOTS } from '../data/pvp.js'
import { grantBuff } from './buffs.js'
import { mulberry32, rollBuff } from './rng.js'

// A buff spot also carries its tier, `buff` (the kind up now, null while
// down) and `next` (the kind it will bring back: the ghost drawn while it
// is down). A minor spot starts up; a major one waits majorFirstSpawn.
// Every roll draws from `rng` — the match's own (makeMatch passes it).
export function makePickups(arena, rng = mulberry32(1)) {
  return arena.pickups.map(p => {
    const base = { kind: p.kind, x: p.x, y: p.y, px: p.x * TILE_SIZE + TILE_SIZE / 2, py: p.y * TILE_SIZE + TILE_SIZE / 2 }
    if (p.kind !== 'buff') return { ...base, up: p.kind !== 'rune', t: p.kind === 'rune' ? PICKUPS.rune.firstSpawn : 0 }
    const major = p.tier === 'major'
    const kind = rollBuff(rng)
    return { ...base, tier: p.tier, up: !major, t: major ? BUFF_SPOTS.majorFirstSpawn : 0,
      buff: major ? null : kind, next: major ? kind : null }
  })
}

// How long a taken pickup stays down.
const respawnOf = p => p.kind === 'buff'
  ? (p.tier === 'major' ? BUFF_SPOTS.majorRespawn : BUFF_SPOTS.minorRespawn)
  : PICKUPS[p.kind].respawn

function take(match, hero, p) {
  if (p.kind === 'flask') {
    if (hero.hp >= hero.maxHp) return false
    const healed = Math.min(PICKUPS.flask.heal, hero.maxHp - hero.hp)
    hero.hp += healed
    addFloat(match.feedback, { px: hero.px, py: hero.py - 10, text: `+${healed}`, kind: 'heal' })
    return true
  }
  if (p.kind === 'quiver') {
    if (hero.cls !== 'archer') return false
    return addAmmo(hero, 'arrow', PICKUPS.quiver.arrows) > 0
  }
  if (p.kind === 'rune') return grantRune(match, hero)
  if (p.kind === 'buff') {
    // Any class takes any buff, whatever it already holds (buffs.js stacks it).
    grantBuff(hero, p.buff, p.tier)
    addFloat(match.feedback, { px: hero.px, py: hero.py - 10, text: '+', kind: p.buff })
    return true
  }
  return false
}

export function tickPickups(match, dt) {
  for (const p of match.pickups) {
    if (!p.up) {
      p.t -= dt
      if (p.t <= 0) {
        p.up = true; p.t = 0
        if (p.kind === 'buff') { p.buff = p.next; p.next = null }
      }
      continue
    }
    const taker = match.heroes.find(h => !h.dead && h.x === p.x && h.y === p.y && take(match, h, p))
    if (!taker) continue
    p.up = false
    p.t = respawnOf(p)
    const taken = p.kind === 'buff' ? { buff: p.buff, tier: p.tier } : {}
    // A buff spot rolls what it brings back the moment it is taken, so the
    // ghost shows it for the whole wait.
    if (p.kind === 'buff') { p.next = rollBuff(match.rng); p.buff = null }
    match.events.push({ type: 'pickup', kind: p.kind, hero: taker.id, ...taken })
    sfx(match, 'pickup', { px: p.px, py: p.py })
  }
}

export function grantRune(match, hero) {
  if (hero.rune) return false
  const power = RUNE_POWER[hero.cls]
  if (!power) return false
  const saved = { weapon: hero.weapon, ranged: hero.ranged, wand: hero.wand }
  if (power.weaponType) {
    hero.weapon = weaponContents(power.weaponType)
    // The Warrior's buckler has no business beside a two-handed hammer:
    // park the melee offhand for the rune's duration so tickShield can't
    // raise it, and hand it back when the rune ends.
    saved.off = gearOf(hero, 'melee').off
    gearOf(hero, 'melee').off = null
  }
  if (power.rangedType) {
    hero.ranged = makeRangedContents(power.rangedType)
    hero.ammo.bolt = (hero.ammo.bolt ?? 0) + power.bolts
  }
  if (power.wandType) hero.wand = makeWandContents(power.wandType)
  // A weapon swap mid-hold or mid-wind-up drops it (Task 3); a key still
  // held across the swap must be let go before the new weapon's attack
  // starts, or it fires without ever having been freshly pressed. The
  // double shot's draw is alt-driven, not attack-driven (fix round 1: task
  // 5) — attack may never have been held for it, so it must not demand a
  // release attack never made.
  if (hero.combo || (hero.charging && hero.charging.kind !== 'double')) hero.needRelease = true
  hero.charging = null
  hero.combo = null
  hero.move = null
  hero.rune = { t: PICKUPS.rune.duration, saved }
  return true
}

export function endRune(match, hero) {
  if (!hero.rune) return
  const { off, ...saved } = hero.rune.saved
  Object.assign(hero, saved)
  if (off !== undefined) gearOf(hero, 'melee').off = off
  if (RUNE_POWER[hero.cls]?.bolts) hero.ammo.bolt = 0   // unused bolts go with the crossbow
  // Same as the swap above: a key held through the rune's end must be let
  // go before the hero's own weapon starts — except an alt-driven double
  // shot draw, which never held attack in the first place (fix round 1).
  if (hero.combo || (hero.charging && hero.charging.kind !== 'double')) hero.needRelease = true
  hero.charging = null
  hero.combo = null
  hero.move = null
  hero.rune = null
  match.events.push({ type: 'runeEnd', hero: hero.id })
}

export function tickRunes(match, dt) {
  for (const h of match.heroes) {
    if (!h.rune || h.dead) continue
    h.rune.t -= dt
    if (h.rune.t <= 0) endRune(match, h)
  }
}
