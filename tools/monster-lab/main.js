// tools/monster-lab/main.js
import * as io from './io.js'
import { makeStage } from './stage.js'
import { buildParamsPanel, buildFieldEditors } from './params-panel.js'
import { defaultParams, clampParams } from '/renderer/render/monster-rigs/schema.js'
import { toast } from '/tools/tile-editor/toast.js'

const stage = makeStage(document.getElementById('stage'), document.getElementById('simbar'))
document.getElementById('zoom').oninput = e => { stage.zoom = Number(e.target.value) }
document.getElementById('backdrop').onchange = e => { stage.backdrop = e.target.checked }
document.getElementById('overlay').onchange = e => { stage.overlay = e.target.checked }

const els = { list: document.getElementById('monster-list'), params: document.getElementById('params'),
              editors: document.getElementById('editors'), save: document.getElementById('save'),
              newBtn: document.getElementById('new-monster') }

let rigMod = null
let work = null          // { name, rigId, params, stats, behavior, spawn, hooks, dirty }
let saved = []           // defs from the server

function markDirty() {
  work.dirty = true
  els.save.disabled = false
  renderLibrary()
}

async function setWork(w) {
  work = w
  rigMod = await io.loadRig(w.rigId)
  work.params = clampParams(rigMod.PARAM_SCHEMA, work.params)
  stage.setRig(rigMod)
  stage.setParams(work.params)
  stage.setHalf(work.stats.half ?? 8)
  buildParamsPanel(els.params, rigMod.PARAM_SCHEMA, work.params,
    (k, v) => { work.params[k] = v; markDirty() })
  buildFieldEditors(els.editors, work, () => { stage.setHalf(work.stats.half ?? 8); markDirty() })
  els.save.disabled = !work.dirty
  renderLibrary()
}

function renderLibrary() {
  els.list.innerHTML = ''
  for (const d of saved) {
    const li = document.createElement('li')
    li.textContent = d.name
    li.classList.toggle('active', work?.name === d.name)
    li.classList.toggle('dirty', work?.name === d.name && work.dirty)
    li.onclick = () => setWork({ name: d.name, rigId: d.rig, params: { ...(d.params ?? {}) },
      stats: { ...(d.stats ?? {}) }, behavior: { ...(d.behavior ?? {}) },
      spawn: d.spawn ? { ...d.spawn } : null, hooks: d.hooks ?? false, dirty: false })
    els.list.append(li)
  }
}

els.newBtn.onclick = async () => {
  const rigs = await io.listRigs()
  const name = (window.prompt ?? (() => null))('monster name ([a-z0-9_])') // browser page: prompt is fine here
  if (!name || !/^[a-z0-9_]+$/.test(name)) return toast?.('invalid name') ?? alert('invalid name')
  await setWork({ name, rigId: rigs[0], params: defaultParams((await io.loadRig(rigs[0])).PARAM_SCHEMA),
                  stats: { hp: 10, dmg: 1, speed: 70, half: 8 }, behavior: {}, spawn: null, hooks: false, dirty: true })
}

els.save.onclick = async () => {
  const { name, rigId, params, stats, behavior, spawn, hooks } = work
  const clean = { rig: rigId, params, stats, behavior,
                  ...(spawn?.depths ? { spawn } : {}), ...(hooks ? { hooks: true } : {}) }
  try {
    await io.saveMonster(name, clean)
    work.dirty = false
    els.save.disabled = true
    await refreshList()
    toast?.('saved') ?? console.log('saved')
  } catch (err) { alert(`save failed: ${err.message}`) }
}

async function refreshList() {
  saved = (await io.listMonsters()).defs
  renderLibrary()
}

async function boot() {
  await refreshList()
  if (saved.length) els.list.firstChild.click()
  else {
    const rigs = await io.listRigs()
    const mod = await io.loadRig(rigs[0])
    await setWork({ name: 'untitled', rigId: rigs[0], params: defaultParams(mod.PARAM_SCHEMA),
                    stats: { hp: 10, dmg: 1, speed: 70, half: 8 }, behavior: {}, spawn: null, hooks: false, dirty: false })
  }
}
boot()
window.lab = { stage, io, get work() { return work } }
