// tools/monster-lab/main.js
import * as io from './io.js'
import { makeStage } from './stage.js'
import { defaultParams } from '/renderer/render/monster-rigs/schema.js'

const stage = makeStage(document.getElementById('stage'), document.getElementById('simbar'))
document.getElementById('zoom').oninput = e => { stage.zoom = Number(e.target.value) }
document.getElementById('backdrop').onchange = e => { stage.backdrop = e.target.checked }
document.getElementById('overlay').onchange = e => { stage.overlay = e.target.checked }

async function boot() {
  const rigs = await io.listRigs()
  const rig = await io.loadRig(rigs[0])
  stage.setRig(rig)
  stage.setParams(defaultParams(rig.PARAM_SCHEMA))
}
boot()
window.lab = { stage, io }
