// One tank prices melee swings, sprinting, and gust casts (mana is gone).
// Pure player-state logic — game.js owns feedback and SFX.

export const STAMINA_MAX = 100
const REGEN_RATE = 18     // per second
const REGEN_DELAY = 0.7   // seconds after the last spend before regen starts

// Per-weapon swing prices by charge tier. Light weapons only ever swing
// 'full'; unknown weapons price like the dagger.
const MELEE_COSTS = {
  hatchet:      { full: 10 },
  dagger:       { full: 8 },
  sword:        { full: 12 },
  longsword:    { tap: 10, full: 18, over: 34 },
  axe:          { tap: 12, full: 24, over: 48 },
  maunonmiekka: { tap: 14, full: 30, over: 60 },
  pick:         { full: 12 },
}
export function meleeCost(weaponType, tier) {
  const table = MELEE_COSTS[weaponType] ?? MELEE_COSTS.dagger
  return table[tier] ?? table.full
}

// Gust is the wandless cast, so its prices live here with the other tank
// costs; systems/spells.js hands this very table back as SPELLS.gust.cost
// (the dependency runs one way — nothing here knows about spells).
export const GUST_COSTS = { tap: 14, full: 22, over: 40 }

// A release at a tier the caster can't afford degrades to the highest tier
// they *can* afford (over -> full -> tap) rather than refusing outright, so
// a long hold is never wasted just because it overshot the tank. Returns
// null when even tap is unaffordable, so the caller still refuses.
// An unrecognised tier starts at the *cheapest* rung, not the dearest: a
// caller that lost track of the hold must never be charged for an overcharge
// it did not ask for.
const TIER_ORDER = ['over', 'full', 'tap']
export function affordableTier(stamina, cost, tier) {
  const known = TIER_ORDER.indexOf(tier)
  const start = known >= 0 ? known : TIER_ORDER.indexOf('tap')
  for (let i = start; i < TIER_ORDER.length; i++) {
    if (stamina >= cost[TIER_ORDER[i]]) return TIER_ORDER[i]
  }
  return null
}

export const canAfford = (player, cost) => (player.stamina ?? 0) >= cost

export function spendStamina(player, cost) {
  player.stamina = Math.max(0, (player.stamina ?? 0) - cost)
  player.staminaRegenT = 0
}

// Also the save-migration point: players persisted before stamina existed
// get a full tank the first time they tick.
export function tickStamina(player, dt) {
  if (player.stamina == null) {
    player.stamina = STAMINA_MAX
    player.maxStamina = STAMINA_MAX
    player.staminaRegenT = 0
    return
  }
  player.staminaRegenT = (player.staminaRegenT ?? 0) + dt
  if (player.staminaRegenT <= REGEN_DELAY) return
  const t = Math.min(dt, player.staminaRegenT - REGEN_DELAY)
  player.stamina = Math.min(player.maxStamina ?? STAMINA_MAX,
    player.stamina + REGEN_RATE * t)
}

// The mage jogs: slower burst, far cheaper — sprinting is how a caster
// keeps distance, not how they close it.
const SPRINT_PROFILES = {
  melee:  { speedMul: 1.55, drain: 22 },
  ranged: { speedMul: 1.55, drain: 22 },
  magic:  { speedMul: 1.25, drain: 8 },
}
export const sprintProfile = mode => SPRINT_PROFILES[mode] ?? SPRINT_PROFILES.melee

// Desktop sprint intent: double-tap a direction and hold. Timestamps are
// injected (seconds) so this stays clock-free and unit-testable.
export function makeSprintDetector(gap = 0.3) {
  const lastPress = {}
  let sprintDir = null
  return {
    press(dir, t) {
      if (t - (lastPress[dir] ?? -Infinity) <= gap) sprintDir = dir
      lastPress[dir] = t
    },
    release(dir) { if (sprintDir === dir) sprintDir = null },
    sprinting() { return sprintDir !== null },
  }
}
