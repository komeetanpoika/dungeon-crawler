// The cutter's live preview: the cut composed into an atlas and PARTS, played
// by the real cut-out engine on the monster lab's stage. The pin strip and the
// preview-only motion sliders are optional: they are wired only when the page
// has #pins/#pin and #params (the studio tunes motion on its Movement tab and
// hands the draft's params in through setParams).
import { validateCut } from './cut-format.js'
import { composeCut } from './compose.js'
import { makeStage } from '/tools/monster-lab/stage.js'
import { makePinStrip } from '/tools/monster-lab/compare.js'
import { buildParamsPanel } from '/tools/monster-lab/params-panel.js'
import { makeCutoutRig, CUTOUT_SCHEMA } from '/renderer/render/monster-rigs/cutout.js'
import { defaultParams, clampParams } from '/renderer/render/monster-rigs/schema.js'

export function makePreviewPane() {
  const $ = id => document.getElementById(id)
  const stage = makeStage($('stage'), $('simbar'))
  let params = defaultParams(CUTOUT_SCHEMA)
  let rig = null, timer = null
  const syncHalf = () => { if (rig) stage.setHalf(rig.hitHalf(params)) }
  const onParam = (k, v) => { params[k] = v; syncHalf() }
  const sliders = () => { if ($('params')) buildParamsPanel($('params'), CUTOUT_SCHEMA, params, onParam) }
  stage.setParams(params)
  sliders()
  if ($('pins') && $('pin')) {
    const pins = makePinStrip($('pins'), () => rig, () => stage.sim, p => {
      Object.assign(params, p)
      sliders()
      syncHalf()
    })
    $('pin').onclick = () => rig && pins.pin(params)
  }
  $('zoom').oninput = e => { stage.zoom = Number(e.target.value) }
  $('backdrop').onchange = e => { stage.backdrop = e.target.checked }
  $('overlay').onchange = e => { stage.overlay = e.target.checked }

  // Swap in a new params object (e.g. the draft's def.params), clamped to the
  // engine's schema so a partial or foreign object still draws.
  function setParams(p) {
    params = clampParams(CUTOUT_SCHEMA, p ?? {})
    stage.setParams(params)
    sliders()
    syncHalf()
  }

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
  return { stage, rebuild, schedule, setParams, get rig() { return rig } }
}
