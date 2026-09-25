// Contested pickups: walk-onto flasks, Archer-only quivers and the power
// rune, each on its own respawn timer; and the rune's swap of a hero's main
// hand for its class's power weapon. Pure: no DOM.
import { weaponContents, makeRangedContents, makeWandContents } from '../systems/entities.js'
import { addAmmo } from '../systems/inventory.js'
import { addFloat } from '../systems/feedback.js'
import { sfx } from '../systems/sfx.js'
import { PICKUPS, RUNE_POWER } from '../data/pvp.js'

const TILE = 32

export function makePickups(arena) {
  return arena.pickups.map(p => ({
    kind: p.kind, x: p.x, y: p.y, px: p.x * TILE + TILE / 2, py: p.y * TILE + TILE / 2,
    up: p.kind !== 'rune', t: p.kind === 'rune' ? PICKUPS.rune.firstSpawn : 0,
  }))
}

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
  return false
}

export function tickPickups(match, dt) {
  for (const p of match.pickups) {
    if (!p.up) {
      p.t -= dt
      if (p.t <= 0) { p.up = true; p.t = 0 }
      continue
    }
    const taker = match.heroes.find(h => !h.dead && h.x === p.x && h.y === p.y && take(match, h, p))
    if (!taker) continue
    p.up = false
    p.t = PICKUPS[p.kind].respawn
    match.events.push({ type: 'pickup', kind: p.kind, hero: taker.id })
    sfx(match, 'pickup', { px: p.px, py: p.py })
  }
}

export function grantRune(match, hero) {
  if (hero.rune) return false
  const power = RUNE_POWER[hero.cls]
  if (!power) return false
  const saved = { weapon: hero.weapon, ranged: hero.ranged, wand: hero.wand }
  if (power.weaponType) hero.weapon = weaponContents(power.weaponType)
  if (power.rangedType) {
    hero.ranged = makeRangedContents(power.rangedType)
    hero.ammo.bolt = (hero.ammo.bolt ?? 0) + power.bolts
  }
  if (power.wandType) hero.wand = makeWandContents(power.wandType)
  hero.charging = null
  hero.rune = { t: PICKUPS.rune.duration, saved }
  return true
}

export function endRune(match, hero) {
  if (!hero.rune) return
  Object.assign(hero, hero.rune.saved)
  if (RUNE_POWER[hero.cls]?.bolts) hero.ammo.bolt = 0   // unused bolts go with the crossbow
  hero.charging = null
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
