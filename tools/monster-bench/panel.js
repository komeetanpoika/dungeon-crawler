// tools/monster-bench/panel.js
// The bench's tuning panel: a column down the right edge (F2 or the edge
// button folds it away) over the running arena. Tuning edits apply on the
// next frame; stats and behaviour wait for a respawn. Buttons show state by
// colour. Every key event stops at the panel (gateKeys), so typing a number
// never walks the hero.
import { edit } from './bench-state.js'
import { gateKeys } from './bench-core.js'

const CSS = `
#bench-panel { position: fixed; top: 0; right: 0; bottom: 0; width: 280px; z-index: 30; overflow-y: auto;
  background: rgba(13,13,16,0.92); border-left: 2px solid #2a2a36; color: #ccc; font: 12px monospace; padding: 8px 10px 16px; }
#bench-panel.collapsed { width: 26px; padding: 8px 2px; overflow: hidden; }
#bench-panel.collapsed > :not(.bp-head) { display: none; }
#bench-panel.collapsed .bp-head > :not(.bp-fold) { display: none; }
#bench-panel h2 { font-size: 13px; color: #f0c040; margin: 0; flex: 1; }
#bench-panel h3 { font-size: 11px; color: #8a8aa0; text-transform: uppercase; margin: 12px 0 4px; }
#bench-panel .bp-head { display: flex; gap: 6px; align-items: center; }
#bench-panel .bp-row { display: grid; grid-template-columns: 1fr 64px; gap: 2px 6px; align-items: center; margin: 4px 0; }
#bench-panel .bp-row label { color: #ddd; }
#bench-panel .bp-row input[type=range] { grid-column: 1 / 3; width: 100%; }
#bench-panel .bp-hint { grid-column: 1 / 3; color: #7a7a8c; font-size: 11px; }
#bench-panel input[type=number], #bench-panel input[type=text] { width: 64px; background: #1b1b22; color: #eee;
  border: 1px solid #3a3a48; font: 12px monospace; padding: 1px 3px; }
#bench-panel .bp-note { color: #7a7a8c; font-size: 11px; margin: 2px 0 4px; }
#bench-panel .bp-btns { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
#bench-panel button { background: #2a2a36; color: #ddd; border: 1px solid #3a3a48; font: 12px monospace; padding: 3px 7px; cursor: pointer; }
#bench-panel button.on { background: #2f6f4f; border-color: #4ade80; color: #fff; }
#bench-panel button.dirty { background: #8a5a12; border-color: #f0c040; color: #fff; }
#bench-panel .bp-read { white-space: pre-wrap; color: #cfe; background: #15151b; padding: 4px 6px; min-height: 3em; }
#bench-panel .bp-err { color: #f87171; white-space: pre-wrap; }
body.bench-open #hud-offhand, body.bench-open #hud-ammo { right: 294px; }
`

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n }

export function mountPanel(model, core, handlers) {
  const { def } = handlers
  const sw = model.switches
  document.head.append(el('style', { textContent: CSS }))
  const root = el('div', { id: 'bench-panel' })
  gateKeys(root)

  // header: fold, name, save
  const save = el('button', { textContent: 'Save', title: 'Write tuning, stats and behaviour to the monster JSON' })
  const fold = el('button', { className: 'bp-fold', title: 'Fold the panel (F2)' })
  // the HUD's right-hand icons step aside while the panel is open
  const syncFold = () => { root.classList.toggle('collapsed', sw.collapsed); document.body.classList.toggle('bench-open', !sw.collapsed)
                           fold.textContent = sw.collapsed ? '<' : '>' }
  fold.onclick = () => { sw.collapsed = !sw.collapsed; syncFold() }
  window.addEventListener('keydown', e => { if (e.key === 'F2' && !e.repeat) { sw.collapsed = !sw.collapsed; syncFold() } })
  const syncDirty = () => save.classList.toggle('dirty', model.dirty.size > 0)
  save.onclick = async () => { await handlers.onSave(); syncDirty() }
  root.append(el('div', { className: 'bp-head' }, fold, el('h2', { textContent: def.name }), save))
  // a hook that failed to load, a bad schema, clamped values: say so up top
  if (def.warnings?.length) root.append(el('div', { className: 'bp-err', textContent: def.warnings.join('\n') }))

  // tuning: slider + exact number per range, checkbox per toggle, hint below
  if (def.tuningSchema?.length) {
    root.append(el('h3', { textContent: 'Tuning — live' }))
    let group = null
    for (const p of def.tuningSchema) {
      if (p.group !== group) { group = p.group; root.append(el('div', { className: 'bp-note', textContent: group })) }
      const row = el('div', { className: 'bp-row' })
      const set = v => { edit(model, 'tuning', p.key, v); handlers.onTuning(p.key, v); syncDirty() }
      if (p.type === 'range') {
        const num = el('input', { type: 'number', min: p.min, max: p.max, step: p.step, value: model.values.tuning[p.key] })
        const slider = el('input', { type: 'range', min: p.min, max: p.max, step: p.step, value: model.values.tuning[p.key] })
        slider.oninput = () => { num.value = slider.value; set(Number(slider.value)) }
        num.onchange = () => {
          const v = Math.max(p.min, Math.min(p.max, Number(num.value)))
          if (!Number.isFinite(v)) { num.value = model.values.tuning[p.key]; return }
          num.value = slider.value = v; set(v)
        }
        row.append(el('label', { textContent: p.label }), num, slider)
      } else if (p.type === 'toggle') {
        const box = el('input', { type: 'checkbox', checked: !!model.values.tuning[p.key] })
        box.onchange = () => set(box.checked)
        row.append(el('label', { textContent: p.label }), box)
      } else continue
      if (p.hint) row.append(el('div', { className: 'bp-hint', textContent: p.hint }))
      root.append(row)
    }
  }

  // stats and numeric behaviour: plain numbers, applied by the next respawn
  root.append(el('h3', { textContent: 'Stats and behaviour' }), el('div', { className: 'bp-note', textContent: 'applies on respawn' }))
  for (const section of ['stats', 'behavior']) {
    for (const [k, v] of Object.entries(model.values[section])) {
      const input = el('input', { type: 'number', value: v })
      input.onchange = () => {
        const n = Number(input.value)
        if (input.value === '' || !Number.isFinite(n)) { input.value = model.values[section][k]; return }
        edit(model, section, k, n); syncDirty()
      }
      root.append(el('div', { className: 'bp-row' }, el('label', { textContent: k }), input))
    }
  }

  // switches
  const toggle = (label, key, title) => {
    const b = el('button', { textContent: label, title })
    const sync = () => b.classList.toggle('on', !!sw[key])
    b.onclick = () => { sw[key] = !sw[key]; sync() }
    sync()
    return b
  }
  const speeds = [0.25, 0.5, 1].map(s => {
    const b = el('button', { textContent: `${s}x` })
    b.onclick = () => { sw.timeScale = s; for (const o of speeds) o.classList.toggle('on', o === b) }
    b.classList.toggle('on', sw.timeScale === s)
    return b
  })
  const pause = toggle('Pause', 'paused', 'Stop the world; Step advances one frame')
  const step = el('button', { textContent: 'Step', onclick: () => core.step() })
  const count = el('input', { type: 'number', min: 1, max: 7, value: sw.count, title: 'How many to spawn' })
  count.onchange = () => { sw.count = Math.max(1, Math.min(7, Math.round(Number(count.value)) || 1)); count.value = sw.count }
  root.append(
    el('h3', { textContent: 'Switches' }),
    el('div', { className: 'bp-btns' },
      toggle('Freeze', 'frozen', 'The monster stops thinking and moving; still hittable'),
      toggle('Invulnerable', 'invulnerable', 'Hits show and are counted but take no hp'),
      toggle('Hitboxes', 'hitboxes', 'Draw hit capsules and the hook\'s debugDraw')),
    el('div', { className: 'bp-btns' }, pause, step, ...speeds),
    el('div', { className: 'bp-btns' }, count,
      el('button', { textContent: 'Respawn', onclick: () => handlers.onRespawn() }),
      el('button', { textContent: 'Full heal', onclick: () => handlers.onHeal() })),
  )

  // readout
  const read = el('div', { className: 'bp-read' })
  const err = el('div', { className: 'bp-err' })
  root.append(el('h3', { textContent: 'Readout' }), read, err)

  document.body.append(root)
  syncFold(); syncDirty()

  let lastText = ''
  return {
    refresh(text) { if (text !== lastText) { lastText = text; read.textContent = text } },
    setError(msg) { err.textContent = msg ?? '' },
    syncDirty,
  }
}
