// One PvP hero: a makePlayer body with an id, a class kit and match
// bookkeeping, stepped from an input intent rather than from keys. The
// per-hero slice of game.js's update() (movement, shield, cooldowns, the
// charge/tap logic of each loadout), ported so it runs headless.
import { makePlayer, defaultGear, emptyAmmo, DIRS } from '../systems/entities.js'
import { applyLoadout } from '../systems/loadout.js'
import { gearOf, outfitOf, STANCES, offhand } from '../systems/inventory.js'
import { moveEntity, PLAYER_HALF, PLAYER_SPEED, TILE_SIZE } from '../systems/movement.js'
import { tickShield, BLOCK_SPEED_MUL } from '../systems/shield.js'
import { tickStamina, spendStamina, sprintProfile, STAMINA_MAX } from '../systems/stamina.js'
import { tickStatus } from '../systems/status.js'
import { tickRain, rainSlow } from '../systems/hammer.js'
import { tickWalk } from '../systems/walk.js'
import { chargeMoveFactor, isChargeWeapon, shouldAutoRelease, resolveCharge } from '../systems/melee.js'
import { GUST_CHARGE, resolveGustTier, shouldAutoReleaseGust } from '../systems/magic.js'
import { spellFor } from '../systems/spells.js'
import { swing, castSpell, loose, startCombo, stepCombo, canDrawDouble, looseDouble } from './attacks.js'
import { isComboWeapon, beginHold, holdGesture, classify, unitMove, isDashing, SECTOR_FACING } from './combos.js'
import { KITS, OUTFIT_OVERRIDES, PVP, WARRIOR_COMBOS, DOUBLE_SHOT, drawFrac } from '../data/pvp.js'

export const NEUTRAL_INPUT = Object.freeze({ move: Object.freeze({ x: 0, y: 0 }), facing: null, attack: false, alt: false, sprint: false })

export function makeHero({ id, name, cls }) {
  const h = makePlayer(0, 0)
  Object.assign(h, {
    type: 'hero', id, name, cls, pendingCls: null,
    kills: 0, deaths: 0, dead: false, respawnT: 0, spawnProtect: 0, lastHitBy: null,
    rune: null, needRelease: false, prevAlt: false, blinkTrail: null,
    facing: 'south', attackTimer: 0, attackDuration: 0.2, attackStyle: 'arc', attackFacing: 'south',
  })
  applyKit(h, cls)
  return h
}

// Strip the hero back to a fresh body and dress it in `cls`'s kit. Called at
// creation and at every respawn, so nothing from the last life survives.
export function applyKit(hero, cls) {
  const kit = KITS[cls]
  if (!kit) throw new Error(`pvp: unknown class "${cls}"`)
  hero.cls = cls
  hero.weapon = null; hero.ranged = null; hero.wand = null
  hero.ammo = emptyAmmo(); hero.gear = defaultGear(); hero.talents = []
  applyLoadout(hero, kit.loadout)
  hero.attackMode = kit.stance
  for (const stance of STANCES) {
    const o = gearOf(hero, stance).outfit
    if (o && OUTFIT_OVERRIDES[o.outfitType]) Object.assign(o, OUTFIT_OVERRIDES[o.outfitType])
  }
  hero.maxHp = PVP.hp; hero.hp = PVP.hp
  hero.stamina = STAMINA_MAX; hero.maxStamina = STAMINA_MAX; hero.staminaRegenT = 0; hero.staminaRefusedT = 0
  hero.charging = null; hero.combo = null; hero.move = null; hero.invulnGroup = null; hero.rune = null; hero.shock = undefined; hero.rain = undefined
  hero.stunTimer = 0; hero.slowTimer = 0; hero.slowMul = 1; hero.rootTimer = 0; hero.frozen = false
  hero.knockback = null; hero.invulnTimer = 0; hero.blocking = false; hero.shieldDropT = 0; hero.blockedHit = false
  hero.meleeCooldown = 0; hero.rangedCooldown = 0; hero.magicCooldown = 0; hero.offCooldown = 0
  hero.needRelease = false; hero.blinkTrail = null
  hero.attackTimer = 0; hero.attackDuration = 0.2; hero.attackStyle = 'arc'; hero.attackFacing = 'south'
  hero.prevAlt = false
}

export function placeHero(hero, { x, y }) {
  hero.x = x; hero.y = y
  hero.px = x * TILE_SIZE + TILE_SIZE / 2
  hero.py = y * TILE_SIZE + TILE_SIZE / 2
  hero._wpx = hero.px; hero._wpy = hero.py   // no walk sway from the teleport
}

// Status timers. The sim runs this for every hero before the CC snapshot, so
// only CC applied *during* the tick is scaled by PVP.ccMul.
export function tickHeroStatus(hero, dt) {
  hero.stunTimer = Math.max(0, (hero.stunTimer ?? 0) - dt)
  tickStatus(hero, dt)
}

// The movement half of a hero's tick — timers, shield, facing, the walk —
// with no attacks. The server runs it inside tickHero; the client's
// predictor runs the very same code for its own hero.
export function moveHero(match, hero, input = NEUTRAL_INPUT, dt) {
  hero.meleeCooldown = Math.max(0, hero.meleeCooldown - dt)
  hero.rangedCooldown = Math.max(0, hero.rangedCooldown - dt)
  hero.attackTimer = Math.max(0, hero.attackTimer - dt)
  hero.invulnTimer = Math.max(0, hero.invulnTimer - dt)
  hero.magicCooldown = Math.max(0, hero.magicCooldown - dt)
  hero.offCooldown = Math.max(0, hero.offCooldown - dt)
  hero.staminaRefusedT = Math.max(0, hero.staminaRefusedT - dt)
  hero.spawnProtect = Math.max(0, hero.spawnProtect - dt)
  tickStamina(hero, dt)
  tickRain(hero, dt)
  if (hero.blinkTrail) {
    hero.blinkTrail.t += dt
    if (hero.blinkTrail.t >= PVP.blinkTrailDur) hero.blinkTrail = null
  }

  const stunned = hero.stunTimer > 0
  // After a release the attack must be let go before it can wind up again
  // (game.js does this by clearing keys[' ']).
  if (!input.attack) hero.needRelease = false
  // A stun also ends a running combo effect (the lunge's dash, the thrusts).
  if (stunned) { hero.charging = null; hero.move = null; cancelHold(hero, input) }
  const altEdge = !!input.alt && !hero.prevAlt
  hero.prevAlt = !!input.alt
  hero.blockedHit = false
  const blocking = tickShield(hero, !!input.alt && !stunned, dt)
  if (blocking) { hero.charging = null; cancelHold(hero, input) }
  // A held combo locks the facing (the moves aim the strike, not the stick),
  // and so does the lunge's dash.
  const dashing = isDashing(hero)
  if (!stunned && !hero.combo && !dashing && input.facing && DIRS[input.facing]) hero.facing = input.facing

  // While the attack is held the Warrior slides along the move held at the
  // press, at half speed, whatever the stick does now (spec 2a §2); during
  // the lunge's dash the dash alone moves the hero.
  const { x: vx, y: vy } = hero.combo ? hero.combo.lockDir : dashing ? { x: 0, y: 0 } : unitMove(input.move)
  const moving = vx !== 0 || vy !== 0
  const profile = sprintProfile(hero.attackMode, { drainMul: outfitOf(hero, hero.attackMode)?.sprintDrain ?? 1 })
  const sprinting = moving && !!input.sprint && !hero.charging && !hero.combo && !blocking && hero.stamina > 0
  const chargeFactor = hero.combo ? WARRIOR_COMBOS.holdMoveMul
    : hero.charging
      ? (hero.charging.kind === 'spell' ? GUST_CHARGE.moveFactor
        : hero.charging.kind === 'double' ? DOUBLE_SHOT.moveMul
        : chargeMoveFactor(hero.weapon?.weaponType))
      : 1
  const slow = hero.slowTimer > 0 ? hero.slowMul : 1
  const speed = PLAYER_SPEED * chargeFactor * rainSlow(hero) * slow *
    (blocking ? BLOCK_SPEED_MUL : 1) * (sprinting ? profile.speedMul : 1)
  if (sprinting) spendStamina(hero, profile.drain * dt)
  if (!stunned && !(hero.rootTimer > 0)) moveEntity(hero, vx * speed * dt, vy * speed * dt, match.map, PLAYER_HALF)
  tickWalk(hero, dt)
  return { stunned, blocking, altEdge }
}

export function tickHero(match, hero, input = NEUTRAL_INPUT, dt) {
  if (hero.dead) return
  const { stunned, blocking, altEdge } = moveHero(match, hero, input, dt)
  if (stunned) return
  const attacking = !!input.attack && !hero.needRelease && !blocking
  if (hero.attackMode === 'melee') tickMelee(match, hero, input, attacking, dt)
  else if (hero.attackMode === 'magic') tickMagic(match, hero, input, attacking, altEdge, dt)
  else if (hero.attackMode === 'ranged') tickRanged(match, hero, input, attacking, dt)
  stepCombo(match, hero, dt)
}

// A stun or a raised shield ends a hold: no combo fires, the stamina spent
// stays spent. A release is required before the next hold only if the key
// was still down at the moment of the cancel — if it had already come up
// this tick, `needRelease` is already false and stays that way, so a bot
// (or a player) that let go exactly on the cancelling tick is not stuck
// waiting on a release that already happened.
function cancelHold(hero, input) {
  if (!hero.combo) return
  hero.combo = null
  hero.needRelease = !!input.attack
}

// The sword is a combo weapon (spec 2a §2): the press begins a hold, moves
// are entered while it is held, and the release fires what was entered —
// a plain swing when nothing was. Charge weapons (the rune's hammer) wind up
// while held and swing on release, tiered by hold; any other light blade
// swings the instant attack lands.
function tickMelee(match, hero, input, attacking, dt) {
  const wt = hero.weapon?.weaponType
  if (!wt) { hero.charging = null; hero.combo = null; return }
  if (isComboWeapon(wt)) {
    if (hero.charging && !hero.charging.kind) hero.charging = null
    if (hero.combo) {
      if (input.attack) holdGesture(hero, input.move)
      else releaseCombo(match, hero)
    } else if (attacking && hero.meleeCooldown <= 0) beginHold(hero, input.move)
    return
  }
  hero.combo = null
  if (isChargeWeapon(wt)) {
    if (hero.charging) {
      if (input.attack && !shouldAutoRelease(wt, hero.charging.t)) hero.charging.t += dt
      else {
        const held = hero.charging.t
        hero.charging = null
        hero.needRelease = true
        swing(match, hero, resolveCharge(wt, held))
      }
    } else if (attacking && hero.meleeCooldown <= 0) hero.charging = { t: 0 }
  } else {
    if (hero.charging && !hero.charging.kind) hero.charging = null
    if (attacking && hero.meleeCooldown <= 0) swing(match, hero, resolveCharge(wt, 0))
  }
}

// The release: the combo's direction becomes the facing, then the plain
// swing or the combo's cooldown. Returns the classified combo.
function releaseCombo(match, hero) {
  const combo = classify(hero.combo.moves)
  hero.combo = null
  if (combo.dir) hero.facing = SECTOR_FACING[combo.dir]
  if (combo.kind === 'swing') swing(match, hero, resolveCharge(hero.weapon.weaponType, 0))
  else startCombo(match, hero, combo)
  return combo
}

// Hold to charge the main wand, release to cast; an offhand wand casts a
// tap on each alt press, on its own cooldown.
function tickMagic(match, hero, input, attacking, altEdge, dt) {
  if (hero.charging?.kind === 'spell') {
    if (input.attack && !shouldAutoReleaseGust(hero.charging.t)) hero.charging.t += dt
    else {
      const tier = resolveGustTier(hero.charging.t)
      hero.charging = null
      hero.needRelease = true
      castSpell(match, hero, spellFor(hero).id, tier, 'main')
    }
  } else if (attacking && hero.magicCooldown <= 0) hero.charging = { t: 0, kind: 'spell' }
  if (altEdge && offhand(hero)?.kind === 'wand') castSpell(match, hero, spellFor(hero, 'off').id, 'tap', 'off')
}

// Every PvP bow fires on its cooldown while attack is held. Holding alt (Q)
// draws the double shot (spec 2a §3): the draw counts up to
// DOUBLE_SHOT.full and holds there (no auto-release), the attack does
// nothing meanwhile, and letting go looses both arrows at the draw reached.
function tickRanged(match, hero, input, attacking, dt) {
  if (hero.charging?.kind === 'double') {
    if (input.alt) { hero.charging.t = Math.min(hero.charging.t + dt, DOUBLE_SHOT.full); return }
    const frac = drawFrac(hero.charging.t)
    hero.charging = null
    looseDouble(match, hero, frac)
    return
  }
  if (input.alt && canDrawDouble(hero)) { hero.charging = { t: 0, kind: 'double' }; return }
  if (attacking) loose(match, hero)
}
