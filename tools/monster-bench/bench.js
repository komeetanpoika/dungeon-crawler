// tools/monster-bench/bench.js
// The monster bench: `npm run bench -- <name>` opens the game straight into
// a level-0 arena with that monster. game.js imports this module only in
// bench mode and consults the hooks it returns once a frame (frame delta,
// freeze test, overlay). Unsaved panel values and the switches survive the
// reload a file change triggers, via sessionStorage.
import { getMonsterDef, monsterNames, retuneMonster } from '../../renderer/systems/monsters.js'
import { setDamageObserver } from '../../renderer/systems/player-damage.js'
import { makeBenchModel, restore, storageKey, savePatch, markSaved, takeSnapshot, keepSnapshot, liveBehavior, usesSnapshots } from './bench-state.js'
import { makeBenchCore, benchArenaConfig } from './bench-core.js'
import { mountPanel } from './panel.js'
import { drawOverlay } from './overlay.js'

const READOUT_MS = 100

// The hook's debugState may answer a string or a flat object.
function describe(state) {
  if (state == null) return ''
  if (typeof state !== 'object') return String(state)
  return Object.entries(state).map(([k, v]) => `${k} ${typeof v === 'number' ? +v.toFixed(2) : v}`).join('  ')
}

function readout(state, name, def, core, sw) {
  const lines = state.entities.filter(e => e.type === name).map((e, i) => {
    let extra = ''
    try { extra = describe(def.hookModule?.debugState?.(e)) } catch (err) { extra = `debugState failed: ${err.message}` }
    return `#${i + 1} hp ${e.hp}/${e.maxHp}${extra ? '  ' + extra : ''}`
  })
  if (!lines.length) lines.push('(none alive — Respawn)')
  lines.push(`hero hp ${state.player.hp}/${state.player.maxHp}  taken ${core.tally.taken}  deaths ${core.tally.deaths}`)
  if (sw.paused) lines.push('paused')
  return lines.join('\n')
}

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
  const store = (() => { try { return globalThis.sessionStorage } catch { return null } })()
  const studio = !!window.saveAPI.isStudio
  const snapshots = usesSnapshots(window.saveAPI)
  if (snapshots) restore(model, takeSnapshot(store, key), def.tuningSchema, def.rig?.PARAM_SCHEMA)
  // What the panel shows is what the monster runs on: restored tweaks go
  // into the live tuning object and the AI row before anything spawns.
  Object.assign(def.tuning, model.values.tuning)
  Object.assign(def.params, model.values.params)
  retuneMonster(name, { stats: model.values.stats, behavior: liveBehavior(model) })
  const core = makeBenchCore(model)
  setDamageObserver(core.observe)
  seam.startArena(benchArenaConfig(name, model.switches.count))

  // Studio: every edit is saved to the draft 400 ms after the last one, one
  // save in flight at a time. A failed save stays unsent until the next edit
  // or flush sends it again.
  let saveTimer = null, inflight = null, unsent = false
  function sendSave() {
    clearTimeout(saveTimer); saveTimer = null
    if (!unsent) return inflight ?? Promise.resolve()
    unsent = false
    const patch = savePatch(model, { params: false })
    const p = (inflight ?? Promise.resolve()).catch(() => {}).then(() => window.saveAPI.benchSave(name, patch)).then(
      () => { if (!unsent) { markSaved(model); panel.markSaved() } panel.setError('') },
      err => { unsent = true; panel.setError(`save failed: ${err.message}`); throw err })
    inflight = p
    p.finally(() => { if (inflight === p) inflight = null }).catch(() => {})
    return p
  }
  if (studio) {
    // the studio page's Fight tab: send a pending save now (rejects when it fails), and is one waiting?
    window.benchFlush = () => sendSave()
    window.benchPending = () => !!(saveTimer || inflight || unsent)
  }
  const panel = mountPanel(model, core, {
    def,
    studio,
    ignores: def.hookModule?.IGNORES ?? {},
    onEdit: () => {
      unsent = true
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => { sendSave().catch(() => { /* shown in the panel */ }) }, 400)
    },
    onTuning: (k, v) => { def.tuning[k] = v },
    // the rig reads def.params every frame; retune keeps the hit size in step
    onParam: (k, v) => { def.params[k] = v; retuneMonster(name) },
    onSave: async () => {
      try { await window.saveAPI.benchSave(name, savePatch(model)); markSaved(model); panel.setError('') }
      catch (err) { panel.setError(`save failed: ${err.message}`) }
    },
    onRespawn: () => core.respawn(seam, name),
    onHeal: () => core.heal(seam.getState()),
  })
  let lastRead = -Infinity

  if (snapshots) {
    window.addEventListener('pagehide', () => keepSnapshot(store, key, model))
    window.saveAPI.onBenchFilesChanged?.(() => location.reload())
  }

  return {
    arenaConfig: () => benchArenaConfig(name, model.switches.count),
    frameDelta: d => core.frameDelta(d),
    isFrozen: e => core.isFrozen(e, name),
    drawOverlay: (ctx, state, renderer) => {
      if (model.switches.hitboxes) drawOverlay(ctx, state, renderer, name)
      const now = performance.now()
      if (now - lastRead >= READOUT_MS) { lastRead = now; panel.refresh(readout(state, name, def, core, model.switches)) }
    },
  }
}
