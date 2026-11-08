// The cutter's live preview: the cut composed into an atlas and PARTS, played
// by the real cut-out engine on the monster lab's stage, with the lab's pin
// strip and preview-only motion sliders. Element ids come from index.html.
import { validateCut } from './cut-format.js'
import { composeCut } from './compose.js'
import { makeStage } from '/tools/monster-lab/stage.js'
import { makePinStrip } from '/tools/monster-lab/compare.js'
import { buildParamsPanel } from '/tools/monster-lab/params-panel.js'
import { makeCutoutRig, CUTOUT_SCHEMA } from '/renderer/render/monster-rigs/cutout.js'
import { defaultParams } from '/renderer/render/monster-rigs/schema.js'

export function makePreviewPane() {
  const $ = id => document.getElementById(id)
  const stage = makeStage($('stage'), $('simbar'))
  const params = defaultParams(CUTOUT_SCHEMA)
  let rig = null, timer = null
  const syncHalf = () => { if (rig) stage.setHalf(rig.hitHalf(params)) }
  const onParam = (k, v) => { params[k] = v; syncHalf() }
  stage.setParams(params)
  buildParamsPanel($('params'), CUTOUT_SCHEMA, params, onParam)
  const pins = makePinStrip($('pins'), () => rig, () => stage.sim, p => {
    Object.assign(params, p)
    buildParamsPanel($('params'), CUTOUT_SCHEMA, params, onParam)
    syncHalf()
  })
  $('pin').onclick = () => rig && pins.pin(params)
  $('zoom').oninput = e => { stage.zoom = Number(e.target.value) }
  $('backdrop').onchange = e => { stage.backdrop = e.target.checked }
  $('overlay').onchange = e => { stage.overlay = e.target.checked }

  // src: { w, h, rgba }; leaks: ids whose cut does not close (they stay on their parent)
  function rebuild(src, cut, leaks) {
    clearTimeout(timer)
    const status = $('preview-status')
    try {
      const errs = validateCut(cut)
      if (errs.length) throw new Error(errs[0])
      const { atlas, parts } = composeCut(src, cut)
      const sheet = document.createElement('canvas')
      sheet.width = atlas.w; sheet.height = atlas.h
      sheet.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(atlas.rgba), atlas.w, atlas.h), 0, 0)
      rig = makeCutoutRig({ id: 'preview', parts, imageUrl: null })
      rig._setSheetImage(sheet)
      stage.setRig(rig)
      syncHalf()
      status.className = 'info'
      status.textContent = `${parts.pieces.length} pieces · ${parts.figure.w}×${parts.figure.h} art px${leaks.length ? ` · leaking: ${leaks.join(', ')} (left on its parent)` : ''}`
    } catch (err) {
      status.className = 'info error'
      status.textContent = `Preview failed: ${err.message}`
    }
  }
  // debounced: get() is read when the rebuild runs, so it sees the latest cut
  const schedule = get => { clearTimeout(timer); timer = setTimeout(() => { const a = get(); if (a) rebuild(...a) }, 300) }
  return { stage, rebuild, schedule, get rig() { return rig } }
}
