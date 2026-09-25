// One PvP hero: a makePlayer body with an id, a class kit and match
// bookkeeping, stepped from an input intent rather than from keys. The
// per-hero slice of game.js's update() (movement, shield, cooldowns, the
// charge/tap logic of each loadout), ported so it runs headless.
import { makePlayer, defaultGear, emptyAmmo, DIRS } from '../systems/entities.js'
import { applyLoadout } from '../systems/loadout.js'
import { gearOf, outfitOf, STANCES } from '../systems/inventory.js'
import { moveEntity, PLAYER_HALF, PLAYER_SPEED, TILE_SIZE } from '../systems/movement.js'
import { tickShield, BLOCK_SPEED_MUL } from '../systems/shield.js'
import { tickStamina, spendStamina, sprintProfile, STAMINA_MAX } from '../systems/stamina.js'
import { tickStatus } from '../systems/status.js'
import { tickRain, rainSlow } from '../systems/hammer.js'
import { tickWalk } from '../systems/walk.js'
import { chargeMoveFactor } from '../systems/melee.js'
import { GUST_CHARGE } from '../systems/magic.js'
import { KITS, OUTFIT_OVERRIDES, PVP } from '../data/pvp.js'

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
  hero.charging = null; hero.rune = null; hero.shock = undefined; hero.rain = undefined
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

export function tickHero(match, hero, input = NEUTRAL_INPUT, dt) {
  if (hero.dead) return
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
  if (stunned) hero.charging = null
  // After a release the attack must be let go before it can wind up again
  // (game.js does this by clearing keys[' ']).
  if (!input.attack) hero.needRelease = false
  const altEdge = !!input.alt && !hero.prevAlt
  hero.prevAlt = !!input.alt
  hero.blockedHit = false
  const blocking = tickShield(hero, !!input.alt && !stunned, dt)
  if (blocking) hero.charging = null
  if (!stunned && input.facing && DIRS[input.facing]) hero.facing = input.facing

  let vx = Math.sign(input.move?.x ?? 0), vy = Math.sign(input.move?.y ?? 0)
  if (vx !== 0 && vy !== 0) { vx /= Math.SQRT2; vy /= Math.SQRT2 }
  const moving = vx !== 0 || vy !== 0
  const profile = sprintProfile(hero.attackMode, { drainMul: outfitOf(hero, hero.attackMode)?.sprintDrain ?? 1 })
  const sprinting = moving && !!input.sprint && !hero.charging && !blocking && hero.stamina > 0
  const chargeFactor = hero.charging
    ? (hero.charging.kind === 'spell' ? GUST_CHARGE.moveFactor : chargeMoveFactor(hero.weapon?.weaponType))
    : 1
  const slow = hero.slowTimer > 0 ? hero.slowMul : 1
  const speed = PLAYER_SPEED * chargeFactor * rainSlow(hero) * slow *
    (blocking ? BLOCK_SPEED_MUL : 1) * (sprinting ? profile.speedMul : 1)
  if (sprinting) spendStamina(hero, profile.drain * dt)
  if (!stunned && !(hero.rootTimer > 0)) moveEntity(hero, vx * speed * dt, vy * speed * dt, match.map, PLAYER_HALF)
  tickWalk(hero, dt)

  if (stunned) return
  const attacking = !!input.attack && !hero.needRelease && !blocking
  if (hero.attackMode === 'melee') tickMelee(match, hero, input, attacking, dt)
  else if (hero.attackMode === 'magic') tickMagic(match, hero, input, attacking, altEdge, dt)
  else if (hero.attackMode === 'ranged') tickRanged(match, hero, attacking)
}

// Attacks land in Task 6 (renderer/pvp/attacks.js).
function tickMelee() {}
function tickMagic() {}
function tickRanged() {}
