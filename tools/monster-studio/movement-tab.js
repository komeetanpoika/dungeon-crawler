// The Movement tab: the monster's real rig (through the /sg/ game mirror, on
// the draft's own parts) walking on a stage, with its PARAM_SCHEMA sliders.
// Slider edits change the live params at once and are saved to the draft's
// def.json 400 ms after the last one; flush() sends a pending save now. Only
// the keys the game's copy holds and the ones off their default are saved.
import { makeStage } from '/tools/monster-lab/stage.js'
import { buildParamsPanel } from '/tools/monster-lab/params-panel.js'
import { clampParams, sparseValues } from '/renderer/render/monster-rigs/schema.js'
import { toast } from '/tools/tile-editor/toast.js'

const SAVE_DELAY = 400

export function mountMovementTab(rootEl, { api }) {
  rootEl.replaceChildren()
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e }
  const canvas = make('canvas', { width: 480, height: 480, className: 'movement-stage' })
  const simBar = make('div', { className: 'movement-bar' })
  const zoom = make('input', { type: 'range', min: 1, max: 4, step: 0.5, value: 2 })
  const floor = make('input', { type: 'checkbox', checked: true })
  const hitbox = make('input', { type: 'checkbox' })
  const stageBar = make('div', { className: 'movement-bar' },
    make('label', {}, 'zoom ', zoom),
    make('label', { className: 'check' }, floor, ' floor'),
    make('label', { className: 'check' }, hitbox, ' hitbox'))
  const message = make('p', { className: 'info' })
  const panel = make('div', { className: 'movement-sliders' })
  const left = make('div', { className: 'movement-left' }, canvas, simBar, stageBar)
  rootEl.append(make('div', { className: 'movement-layout' }, left, make('div', { className: 'movement-side' }, message, panel)))

  const stage = makeStage(canvas, simBar)
  zoom.oninput = () => { stage.zoom = Number(zoom.value) }
  floor.onchange = () => { stage.backdrop = floor.checked }
  hitbox.onchange = () => { stage.overlay = hitbox.checked }

  let schema = []
  let name = null
  let params = null
  let baseline = {}          // the params keys the game's copy (or a new draft) holds
  let timer = null
  let dirty = false          // params differ from what the draft holds
  let inflight = Promise.resolve()
  let sending = 0            // saves on their way
  let labelsFor = null       // the monster whose rig labels `schema` holds

  const say = text => { message.textContent = text; panel.replaceChildren() }

  // One save of the current params; a failure keeps `dirty` so the next try resends.
  function send() {
    clearTimeout(timer); timer = null
    if (!dirty) return inflight
    const forName = name, snapshot = sparseValues(schema, params, baseline)
    dirty = false
    sending++
    inflight = inflight.catch(() => {}).then(async () => {
      try { await api.patchDef(forName, { params: snapshot }) } catch (err) { dirty = true; throw err } finally { sending-- }
    })
    return inflight
  }

  function change(key, value) {
    params[key] = value
    dirty = true
    clearTimeout(timer)
    timer = setTimeout(() => send().catch(err => toast(`Movement not saved: ${err.message}`, 'error')), SAVE_DELAY)
  }

  return {
    async show(view) {
      await this.flush()
      name = view.name
      params = null
      schema = []
      labelsFor = null
      stage.setRig(null)
      if (view.buildError) return say(`Fix the cut first: ${view.buildError}`)
      let rig
      try {
        rig = await import(`/sg/${view.name}@${view.rev}/renderer/render/monster-rigs/${view.def.rig}.js`)
      } catch (err) {
        return say(`Could not load the rig: ${err.message}`)
      }
      schema = rig.PARAM_SCHEMA
      labelsFor = view.name
      params = clampParams(schema, view.def.params ?? {})
      baseline = { ...((view.isNew ? view.def.params : view.published?.params) ?? {}) }
      message.textContent = ''
      stage.setRig(rig)
      stage.setParams(params)
      stage.setHalf(rig.hitHalf?.(params) ?? 8)
      buildParamsPanel(panel, schema, params, change)
    },
    hide() {},
    flush() { return send() },
    pending: () => dirty || !!timer || sending > 0,
    // the rig's slider labels, only when they were loaded for this monster ({} otherwise)
    labels(forName) { return forName && forName === labelsFor ? Object.fromEntries(schema.map(p => [p.key, p.label])) : {} },
  }
}
