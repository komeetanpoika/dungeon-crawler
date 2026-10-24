// tools/monster-bench/bench-core.js
// The bench's behaviour, apart from its DOM: the hero who never dies (and
// may not be hurt at all), the time controls, freezing the monster,
// respawning it with the panel's current numbers, the arena it fights in,
// and the gate that keeps panel typing away from the game's keys.
import { retuneMonster } from '../../renderer/systems/monsters.js'

// No plate: a hit lands at face value, so the damage numbers read true.
export const BENCH_KIT = { weaponType: 'sword', rangedType: 'shortbow', wandType: 'sparkwand',
                           ammo: { arrow: 999 }, outfits: ['ranger', 'robe'] }

const SPOT_XS = [13, 10, 16, 7, 19, 4, 22]
const SPOT_Y = 7
const HERO = { x: 13, y: 15 }

export function respawnSpots(count) {
  const n = Math.max(1, Math.min(SPOT_XS.length, Math.round(count) || 1))
  return SPOT_XS.slice(0, n).map(x => ({ x, y: SPOT_Y }))
}

export function benchArenaConfig(name, count) {
  return { size: { w: 26, h: 18 }, player: { ...HERO, ...BENCH_KIT },
           enemies: respawnSpots(count).map(p => ({ kind: name, ...p })) }
}

export function makeBenchCore(model) {
  const sw = model.switches
  let stepPending = false
  const core = {
    tally: { taken: 0, deaths: 0 },

    // setDamageObserver's callback (systems/player-damage.js).
    observe(state, player, amount) {
      if (player !== state.player) return amount
      core.tally.taken += amount
      if (sw.invulnerable) return 0
      if (amount >= player.hp) { core.tally.deaths++; player.hp = player.maxHp; return 0 }
      return amount
    },

    // null = skip this frame's update (paused); render goes on regardless.
    frameDelta(delta) {
      if (sw.paused) {
        if (!stepPending) return null
        stepPending = false
        return 1 / 60
      }
      return delta * sw.timeScale
    },
    step() { stepPending = true },

    isFrozen: (e, name) => sw.frozen && e.type === name,

    respawn(seam, name) {
      retuneMonster(name, { stats: model.values.stats, behavior: model.values.behavior })
      const state = seam.getState()
      state.entities = state.entities.filter(e => e.type !== name)
      seam.spawn(respawnSpots(sw.count).map(p => ({ kind: name, ...p })))
    },

    heal(state) { state.player.hp = state.player.maxHp },
  }
  return core
}

// game.js reads keys from window listeners, so a key event stopped at the
// panel never reaches the hero. Focusing the panel fires the window's blur,
// which game.js answers by releasing every held key. Buttons, sliders and
// checkboxes give focus back after use — a focused button would otherwise
// take the attack key (Space) as another click; text fields keep it until
// Escape or a click on the arena.
const KEEPS_FOCUS = new Set(['text', 'number'])
export function gateKeys(root, win = globalThis.window) {
  root.addEventListener('focusin', () => win.dispatchEvent(new Event('blur')))
  root.addEventListener('keydown', e => { if (e.key === 'Escape') e.target?.blur?.(); e.stopPropagation() })
  root.addEventListener('keyup', e => e.stopPropagation())
  const release = e => { if (!KEEPS_FOCUS.has(e.target?.type)) e.target?.blur?.() }
  root.addEventListener('pointerup', release)
  root.addEventListener('change', release)
}
