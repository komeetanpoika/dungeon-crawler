// tools/monster-bench/bench.js
// The monster bench: `npm run bench -- <name>` opens the game straight into
// a level-0 arena with that monster. game.js imports this module only in
// bench mode and consults the hooks it returns once a frame (frame delta,
// freeze test, overlay). Unsaved panel values and the switches survive the
// reload a file change triggers, via sessionStorage.
import { getMonsterDef, monsterNames, retuneMonster } from '../../renderer/systems/monsters.js'
import { setDamageObserver } from '../../renderer/systems/player-damage.js'
import { makeBenchModel, restore, snapshot, storageKey } from './bench-state.js'
import { makeBenchCore, benchArenaConfig } from './bench-core.js'

export function startBench(seam) {
  const { name } = seam
  const def = getMonsterDef(name)
  if (!def) {
    console.warn(`bench: no monster "${name}" — known: ${monsterNames().join(', ')}`)
    seam.goTitle()
    return null
  }
  const model = makeBenchModel(def)
  const key = storageKey(name)
  let saved = null
  try { saved = sessionStorage.getItem(key) } catch { /* storage unavailable: start clean */ }
  restore(model, saved, def.tuningSchema)
  // What the panel shows is what the monster runs on: restored tweaks go
  // into the live tuning object and the AI row before anything spawns.
  Object.assign(def.tuning, model.values.tuning)
  retuneMonster(name, { stats: model.values.stats, behavior: model.values.behavior })
  const core = makeBenchCore(model)
  setDamageObserver(core.observe)
  seam.startArena(benchArenaConfig(name, model.switches.count))

  window.saveAPI.onBenchFilesChanged?.(() => {
    try { sessionStorage.setItem(key, snapshot(model)) } catch { /* the reload still happens */ }
    location.reload()
  })

  return {
    arenaConfig: () => benchArenaConfig(name, model.switches.count),
    frameDelta: d => core.frameDelta(d),
    isFrozen: e => core.isFrozen(e, name),
    drawOverlay: () => {},
  }
}
