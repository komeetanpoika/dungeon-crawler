import { hasLineOfSight, makeMonster } from './entities.js'
import { updateBrain } from './brain.js'
import { act } from './act.js'

const S = 32
const BOLT_SPEED    = 300
const SPREAD_SPEED  = 200
const SPELL_COOLDOWN = 2.0
const SHIELD_DUR    = 3.0
const SUMMON_INTERVAL = 8.0
const MAX_MINIONS   = 4

export function makeWizard(x, y) {
  return {
    type: 'wizard', x, y,
    hp: 12, maxHp: 12, inCombat: false,
    spellIndex: 0, spellCooldown: SPELL_COOLDOWN,
    shieldTimer: 0,
    summonTimer: SUMMON_INTERVAL,
    damageCooldown: 0,
    id: 'wizard_' + Math.random().toString(36).slice(2),
  }
}

export function updateWizard(e, state, delta) {
  const { player, map } = state

  e.spellCooldown = Math.max(0, e.spellCooldown - delta)
  e.shieldTimer   = Math.max(0, e.shieldTimer   - delta)
  e.summonTimer   = Math.max(0, e.summonTimer   - delta)

  const toAngle = Math.atan2(player.py - e.py, player.px - e.px)
  act(e, state, delta, updateBrain(e, state, delta))

  // Spell rotation
  if (e.spellCooldown <= 0 && hasLineOfSight(map, e.y, e.x, player.y, player.x)) {
    e.inCombat = true
    if (e.spellIndex === 3) {
      e.shieldTimer = SHIELD_DUR
      e.spellIndex  = 0
      e.spellCooldown = SPELL_COOLDOWN
    } else if (e.spellIndex === 2) {
      for (const offset of [-Math.PI / 9, 0, Math.PI / 9]) {
        const a = toAngle + offset
        state.projectiles.push({
          px: e.px, py: e.py,
          dx: Math.cos(a) * SPREAD_SPEED, dy: Math.sin(a) * SPREAD_SPEED,
          damage: 1, friendly: false, color: '#a855f7',
        })
      }
      e.spellIndex++
      e.spellCooldown = SPELL_COOLDOWN
    } else {
      state.projectiles.push({
        px: e.px, py: e.py,
        dx: Math.cos(toAngle) * BOLT_SPEED, dy: Math.sin(toAngle) * BOLT_SPEED,
        damage: 2, friendly: false, color: '#a855f7',
      })
      e.spellIndex++
      e.spellCooldown = SPELL_COOLDOWN
    }
  }

  // Summoning
  if (e.summonTimer <= 0) {
    e.summonTimer = SUMMON_INTERVAL
    const minionCount = state.entities.filter(en => en.summonedBy === e.id).length
    if (minionCount < MAX_MINIONS) {
      const count = Math.min(1 + Math.floor(Math.random() * 2), MAX_MINIONS - minionCount)
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2
        const r = 40 + Math.random() * 20
        const sx = e.x + Math.round(Math.cos(a) * 2)
        const sy = e.y + Math.round(Math.sin(a) * 2)
        state.entities.push({
          ...makeMonster(sx, sy, 'weak'),
          px: e.px + Math.cos(a) * r, py: e.py + Math.sin(a) * r,
          facing: 'east',
          damageCooldown: 0,
          summonedBy: e.id,
        })
      }
    }
  }
}
