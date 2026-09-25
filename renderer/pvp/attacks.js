// A hero's three ways to hurt another: the melee swing (sword, and the
// rune's Ukonvasara with its shock, clap and chain), a spell cast from
// either hand, and a bow shot. Ported from game.js's update(), aimed at
// foesOf() instead of state.entities, and every hit routed through
// hurtHero. Pure: no DOM.
import { DIRS, FACING_ANGLE } from '../systems/entities.js'
import { getAttack, getSwingArc, inSwing, tierMods } from '../systems/melee.js'
import { meleeCost, canAfford, spendStamina } from '../systems/stamina.js'
import { nearestPoint } from '../systems/hitbox.js'
import { shatterBonus } from '../systems/status.js'
import { startKnockback } from '../systems/knockback.js'
import { applyShock, thunderclap, chainNodes, applyChain, applyRain, lightningMods, HAMMER } from '../systems/hammer.js'
import { tryCast } from '../systems/spells.js'
import { castLightning } from '../systems/spells/lightning.js'
import { tryFire } from '../systems/ranged.js'
import { sfx } from '../systems/sfx.js'
import { hurtHero, foesOf } from './combat.js'
import { PVP } from '../data/pvp.js'

const MODULES = { lightning: castLightning }

export function swing(match, hero, mods) {
  hero.spawnProtect = 0
  const wpn = hero.weapon
  const wt = wpn.weaponType
  const cost = meleeCost(wt, mods.tier)
  if (!canAfford(hero, cost)) {
    mods = tierMods('tap', wt)                 // starved: a weak swing that empties the tank
    hero.staminaRefusedT = 0.4
    spendStamina(hero, hero.stamina)
  } else {
    spendStamina(hero, cost)
  }
  const atk = getAttack(wt)
  hero.meleeCooldown = atk.cooldown * mods.cooldownMul
  hero.swingHand = 'main'
  hero.attackTimer = atk.duration
  hero.attackDuration = atk.duration
  hero.attackStyle = atk.style
  hero.attackFacing = hero.facing
  hero.attackReachMul = mods.reachMul
  sfx(match, 'melee-swing', { px: hero.px, py: hero.py })

  const dmg = Math.max(1, Math.round((wpn.damage ?? 1) * mods.dmgMul))
  const fa = FACING_ANGLE[hero.facing] ?? 0
  const arc = getSwingArc(atk.style)
  const bodyHit = e => {
    const n = nearestPoint(e, hero.px, hero.py)
    return inSwing(arc.reach * mods.reachMul, arc.halfAngle, fa, n.x - hero.px, n.y - hero.py)
  }
  const hammer = !!wpn.lightning
  const zap = hammer && mods.tier === 'over'   // the overcharge lands no blow: all its damage is lightning
  const foes = foesOf(match, hero)
  const struck = []
  for (const e of foes) {
    if (!bodyHit(e)) continue
    struck.push(e)
    if (zap) continue
    if (!hurtHero(match, e, dmg + shatterBonus(e), { by: hero, melee: true })) continue
    startKnockback(e, e.px - hero.px, e.py - hero.py, atk.knockback * mods.kbMul)
    sfx(match, 'melee-hit', { px: e.px, py: e.py })
    if (hammer && mods.tier === 'full') { applyShock(e); e.shock.owner = hero.id }
  }
  if (zap) {
    thunderclap(hero, foes)
    match.shockwaves.push({ px: hero.px, py: hero.py, t: 0, dur: 0.35, maxRadius: HAMMER.clap.radius, color: '#e9d5ff' })
    sfx(match, 'thunder', { px: hero.px, py: hero.py })
    // PvP drops the chain's last hop onto its own wielder (spec §2).
    const nodes = chainNodes(hero, struck, foes, lightningMods(hero)).filter(n => !n.player)
    if (nodes.length) {
      applyChain(match, nodes, { hurt: (e, d) => hurtHero(match, e, d, { kind: 'lightning', by: hero }) }, hero)
      sfx(match, 'crackle', { px: hero.px, py: hero.py })
    } else {
      applyRain(hero)
    }
  }
}

export function castSpell(match, hero, spellId, tier, hand = 'main') {
  const cast = tryCast(match, spellId, tier, { modules: MODULES, hand, caster: hero })
  if (!cast.ok) {
    if (cast.reason === 'stamina') hero.staminaRefusedT = 0.4
    return cast
  }
  hero.spawnProtect = 0
  sfx(match, 'magic-cast', { px: hero.px, py: hero.py })
  if (cast.projectiles) match.projectiles.push(...cast.projectiles)
  if (cast.from) hero.blinkTrail = { from: cast.from, to: cast.to, t: 0 }
  return cast
}

export function loose(match, hero) {
  const shot = tryFire(hero)
  if (!shot.ok) return shot
  hero.spawnProtect = 0
  const [dx, dy] = DIRS[hero.facing] ?? DIRS.east
  const proj = { px: hero.px, py: hero.py, dx: dx * PVP.arrowSpeed, dy: dy * PVP.arrowSpeed,
    damage: shot.damage, color: shot.color, shape: shot.shape, friendly: true, owner: hero.id }
  if (shot.pierce !== undefined) proj.pierce = shot.pierce
  if (shot.fork) proj.fork = { ...shot.fork }
  if (shot.onHit) proj.onHit = { ...shot.onHit }
  match.projectiles.push(proj)
  sfx(match, 'ranged-shot', { px: hero.px, py: hero.py })
  return shot
}
