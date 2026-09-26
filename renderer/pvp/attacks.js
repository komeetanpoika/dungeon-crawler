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
import { spendAmmo } from '../systems/inventory.js'
import { sfx } from '../systems/sfx.js'
import { canMoveTo, PLAYER_HALF, TILE_SIZE } from '../systems/movement.js'
import { hurtHero, foesOf } from './combat.js'
import { SECTOR_FACING } from './combos.js'
import { PVP, WARRIOR_COMBOS, DOUBLE_SHOT, doubleShotBand, SPELL_OVERRIDES } from '../data/pvp.js'

const MODULES = { lightning: castLightning }

// What a melee release at `mods` (a resolveCharge/tierMods result) would
// cost: the mods it actually swings at — degraded to 'tap' when the tank
// can't afford the requested tier, same as a starved swing always has — the
// stamina it spends, and the cooldown that follows. No effects (no damage,
// no cooldown/stamina write): swing() below applies this and does the rest.
// predict.js calls this too, so a charge weapon's predicted release pays
// exactly what the server would.
export function swingCost(hero, mods) {
  const wt = hero.weapon.weaponType
  const cost = meleeCost(wt, mods.tier)
  if (canAfford(hero, cost)) return { mods, stamina: cost, starved: false, cooldown: getAttack(wt).cooldown * mods.cooldownMul }
  const starvedMods = tierMods('tap', wt)         // starved: a weak swing that empties the tank
  return { mods: starvedMods, stamina: hero.stamina, starved: true, cooldown: getAttack(wt).cooldown * starvedMods.cooldownMul }
}

// The melee cooldown a combo's release starts: the weapon's own, and the
// whirlwind's 1.5 times it. predict.js calls this too.
export function comboCooldown(weaponType, kind) {
  const cd = getAttack(weaponType).cooldown
  return kind === 'whirl' ? cd * WARRIOR_COMBOS.whirl.cooldownMul : cd
}

// --- the Warrior's combos (spec 2a §2) --------------------------------
// A release that classified as a combo starts hero.move = { kind, dir, t,
// from, done, dist, fired, group }; stepCombo runs it once a tick (the
// release tick included) until WARRIOR_COMBOS.fxDur, which is also how long
// the renderer draws it. Every hit is a 'hit' from the attacker's position
// through hurtHero (melee: a facing buckler blocks it and shoves back), and
// every hit test asks match.hitPos like the swing does.

// Where the hit test sees `e` (the server's rewind), and the vector from
// the hero to the nearest point of that body.
const reachTo = (match, hero, e) => {
  const n = nearestPoint(match.hitPos?.(e, hero) ?? e, hero.px, hero.py)
  return { dx: n.x - hero.px, dy: n.y - hero.py }
}

export function startCombo(match, hero, combo) {
  hero.spawnProtect = 0
  hero.meleeCooldown = comboCooldown(hero.weapon.weaponType, combo.kind)
  match.groupSeq = (match.groupSeq ?? 0) + 1
  hero.move = { kind: combo.kind, dir: combo.dir, t: 0, from: { px: hero.px, py: hero.py }, done: false,
    dist: 0, fired: 0, group: `${hero.id}#${match.groupSeq}` }
  if (combo.kind === 'whirl') whirl(match, hero)
  else sfx(match, 'melee-swing', { px: hero.px, py: hero.py })
}

export function stepCombo(match, hero, dt) {
  const mv = hero.move
  if (!mv) return
  if (mv.kind === 'lunge' && !mv.done) stepLunge(match, hero, mv, dt)
  if (mv.kind === 'fence') {
    const { times } = WARRIOR_COMBOS.fence
    while (mv.fired < times.length && mv.t >= times[mv.fired] - 1e-9) { thrust(match, hero, mv); mv.fired++ }
  }
  mv.t += dt
  if (mv.t >= WARRIOR_COMBOS.fxDur - 1e-9) hero.move = null
}

// The lunge: a dash of lunge.tiles toward dir over lunge.dur. The first foe
// whose body comes within lunge.reach ahead (the half-plane in front, checked
// before and after each step) takes lunge.damage, and the dash ends there;
// a wall ends it too, the hero stopped flush against it.
function stepLunge(match, hero, mv, dt) {
  const L = WARRIOR_COMBOS.lunge
  const [dx, dy] = DIRS[SECTOR_FACING[mv.dir]]
  if (lungeHit(match, hero, mv, dx, dy)) return
  const total = L.tiles * TILE_SIZE
  let step = Math.min(total / L.dur * dt, total - mv.dist)
  while (step > 0 && !canMoveTo(match.map, hero.px + dx * step, hero.py + dy * step, PLAYER_HALF)) {
    step = Math.max(0, Math.ceil(step) - 1)       // a wall: close the gap a pixel at a time
    mv.done = true
  }
  hero.px += dx * step; hero.py += dy * step
  hero.x = Math.floor(hero.px / TILE_SIZE); hero.y = Math.floor(hero.py / TILE_SIZE)
  mv.dist += step
  if (mv.dist >= total - 1e-9) mv.done = true
  lungeHit(match, hero, mv, dx, dy)
}

function lungeHit(match, hero, mv, dx, dy) {
  const L = WARRIOR_COMBOS.lunge
  // reachTo (like the swing) tests the foe's rewound position, so under
  // latency the dash stops where the attacker saw it — cosmetic only:
  // damage, the stop point's real px/py and blocks all use the real hero.
  const fa = Math.atan2(dy, dx)
  let first = null, best = Infinity
  for (const e of foesOf(match, hero)) {
    const v = reachTo(match, hero, e)
    const d = Math.hypot(v.dx, v.dy)
    if (d < best && inSwing(L.reach, Math.PI / 2, fa, v.dx, v.dy)) { first = e; best = d }
  }
  if (!first) return false
  mv.done = true
  if (hurtHero(match, first, L.damage, { by: hero, melee: true })) sfx(match, 'melee-hit', { px: first.px, py: first.py })
  return true
}

// One of the fence's three thrusts: a snap-style wedge of fence.reach toward
// dir. The three share one hit group, so all three can land on one hero.
function thrust(match, hero, mv) {
  const F = WARRIOR_COMBOS.fence
  const arc = getSwingArc('snap')
  const facing = SECTOR_FACING[mv.dir]
  const fa = FACING_ANGLE[facing]
  for (const e of foesOf(match, hero)) {
    const v = reachTo(match, hero, e)
    if (!inSwing(F.reach, arc.halfAngle, fa, v.dx, v.dy)) continue
    if (hurtHero(match, e, F.damage, { by: hero, melee: true, group: mv.group })) sfx(match, 'melee-hit', { px: e.px, py: e.py })
  }
  const atk = getAttack('dagger')                // the snap's own quick poke, drawn at the fence's reach
  Object.assign(hero, { swingHand: 'main', attackTimer: atk.duration, attackDuration: atk.duration, attackStyle: 'snap',
    attackFacing: facing, attackReachMul: F.reach / arc.reach })
  sfx(match, 'melee-swing', { px: hero.px, py: hero.py })
}

// The whirlwind: at the release, every foe within whirl.reach all round takes
// whirl.damage and is thrown whirl.knockback px away from the spinner.
function whirl(match, hero) {
  const Wh = WARRIOR_COMBOS.whirl
  for (const e of foesOf(match, hero)) {
    const v = reachTo(match, hero, e)
    if (Math.hypot(v.dx, v.dy) > Wh.reach) continue
    if (!hurtHero(match, e, Wh.damage, { by: hero, melee: true })) continue
    startKnockback(e, e.px - hero.px, e.py - hero.py, Wh.knockback)
    sfx(match, 'melee-hit', { px: e.px, py: e.py })
  }
  const dur = WARRIOR_COMBOS.fxDur
  Object.assign(hero, { swingHand: 'main', attackTimer: dur, attackDuration: dur, attackStyle: 'spin',
    attackFacing: hero.facing, attackReachMul: Wh.reach / getSwingArc('spin').reach })
  sfx(match, 'whirl', { px: hero.px, py: hero.py })
}

export function swing(match, hero, mods) {
  hero.spawnProtect = 0
  const wpn = hero.weapon
  const wt = wpn.weaponType
  const { mods: resolvedMods, stamina, starved, cooldown } = swingCost(hero, mods)
  mods = resolvedMods
  if (starved) hero.staminaRefusedT = 0.4
  spendStamina(hero, stamina)
  const atk = getAttack(wt)
  hero.meleeCooldown = cooldown
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
  // The server rewinds foes to where the attacker saw them (spec §2); only the
  // hit test moves — knockback, blocks and damage use the real hero.
  const bodyHit = e => {
    const at = match.hitPos?.(e, hero) ?? e
    const n = nearestPoint(at, hero.px, hero.py)
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
  // A match's numbers for the shared spells (spec 2a §4): SPELL_OVERRIDES.
  const cast = tryCast(match, spellId, tier, { modules: MODULES, hand, caster: hero, override: SPELL_OVERRIDES[spellId] ?? null })
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

// --- the Archer's double shot (spec 2a §3) -----------------------------

// Q starts a draw only with a bow (not the rune's crossbow), an arrow to
// shoot and the ranged cooldown ready.
export const canDrawDouble = hero =>
  hero.ranged?.kind === 'bow' && (hero.ammo?.arrow ?? 0) > 0 && hero.rangedCooldown <= 0

// Pays for a release at draw fraction `frac`: two arrows (or the one left)
// and DOUBLE_SHOT.cooldown — or nothing, returning null, below
// DOUBLE_SHOT.min. predict.js calls this too, for the same ammo and cooldown.
export function payDoubleShot(hero, frac) {
  const band = doubleShotBand(frac)
  const arrows = Math.min(2, hero.ammo?.arrow ?? 0)
  if (!band || arrows <= 0) return null
  spendAmmo(hero, 'arrow', arrows)
  hero.rangedCooldown = DOUBLE_SHOT.cooldown
  return { band, arrows }
}

// The release: two arrows straight ahead, DOUBLE_SHOT.gap apart across the
// facing (one from the centre if only one was left), each dealing the band's
// damage in the band's colour. Ordinary arrows — a raised buckler blocks
// them — sharing one hit group, so both can land on one hero.
export function looseDouble(match, hero, frac) {
  const shot = payDoubleShot(hero, frac)
  if (!shot) return null
  hero.spawnProtect = 0
  const [dx, dy] = DIRS[hero.facing] ?? DIRS.east
  match.groupSeq = (match.groupSeq ?? 0) + 1
  const group = `${hero.id}#${match.groupSeq}`
  const half = DOUBLE_SHOT.gap / 2
  for (const k of shot.arrows === 2 ? [-1, 1] : [0]) {
    match.projectiles.push({ px: hero.px - dy * half * k, py: hero.py + dx * half * k,
      dx: dx * PVP.arrowSpeed, dy: dy * PVP.arrowSpeed, damage: shot.band.damage, color: shot.band.color,
      shape: 'arrow', trail: true, friendly: true, owner: hero.id, group })
  }
  sfx(match, 'ranged-shot', { px: hero.px, py: hero.py })
  return shot
}
