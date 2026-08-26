// One tank prices melee swings, sprinting, and gust casts (mana is gone).
// Pure player-state logic — game.js owns feedback and SFX.

export const STAMINA_MAX = 100
const REGEN_RATE = 18     // per second
const REGEN_DELAY = 0.7   // seconds after the last spend before regen starts

// Per-weapon swing prices by charge tier. Light weapons only ever swing
// 'full'; unknown weapons price like the dagger.
const MELEE_COSTS = {
  dagger:       { full: 8 },
  sword:        { full: 12 },
  longsword:    { tap: 10, full: 18, over: 34 },
  axe:          { tap: 12, full: 24, over: 48 },
  maunonmiekka: { tap: 14, full: 30, over: 60 },
}
export function meleeCost(weaponType, tier) {
  const table = MELEE_COSTS[weaponType] ?? MELEE_COSTS.dagger
  return table[tier] ?? table.full
}

export const GUST_COSTS = { tap: 14, full: 22, over: 40 }

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
