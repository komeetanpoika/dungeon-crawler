// The Publish tab: where a draft reaches the game. Spawn choices (autosaved to
// the draft 400 ms after the last edit), a name field for new drafts, the list
// of what changes against the game's copy, Publish into the game and Discard.
import { spawnToForm, formToSpawn, SPAWN_LIMITS } from './spawn-form.js'
import { describeChanges } from './changes.js'
import { ask } from '/tools/monster-cutter/panels.js'
import { toast } from '/tools/tile-editor/toast.js'

const SAVE_DELAY = 400
const BOSS_NOTES = { monsteri: 'Also guards the depth-4 lair (set in the map, not here).' }
const NAME_RE = /^[a-z0-9_]+$/
const DONE = 'In the game. Restart the game to see it. The public website is a separate step.'

export function mountPublishTab(rootEl, { api, labels = () => ({}), onPublished, onDiscarded, onRenamed }) {
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter(k => k != null)); return e }
  let view = null, form = null, touched = false
  let timer = null, dirty = false, inflight = Promise.resolve(), sending = 0
  let publishing = false, resultFor = null, nameError = '', paramLabels = {}

  function sendSpawn() {
    clearTimeout(timer); timer = null
    if (!dirty) return inflight
    const forName = view.name, spawn = formToSpawn(form)
    dirty = false
    sending++
    inflight = inflight.catch(() => {}).then(async () => {
      try { await api.patchDef(forName, { spawn }) } catch (err) { dirty = true; throw err } finally { sending-- }
    })
    return inflight
  }
  function spawnEdited() {
    touched = true; dirty = true; resultFor = null
    clearTimeout(timer)
    timer = setTimeout(() => sendSpawn().catch(err => toast(`Spawn not saved: ${err.message}`, 'error')), SAVE_DELAY)
    renderChanges()
  }

  async function loadLabels(v) {
    let l = labels(v.name) ?? {}
    if (Object.keys(l).length || v.buildError) return l
    try {
      const rig = await import(`/sg/${v.name}@${v.rev}/renderer/render/monster-rigs/${v.def.rig}.js`)
      l = Object.fromEntries(rig.PARAM_SCHEMA.map(p => [p.key, p.label]))
    } catch { l = {} }
    return l
  }

  const changesBox = make('div', { className: 'publish-changes' })
  function renderChanges() {
    const draft = (touched && view.kind !== 'story') ? { ...view.def, spawn: formToSpawn(form) } : view.def
    const list = describeChanges({ name: view.name, isNew: view.isNew, published: view.published, draft, cutChanged: view.cutChanged, labels: paramLabels })
    changesBox.replaceChildren(make('h2', { textContent: 'What changes' }),
      list.length ? make('ul', {}, ...list.map(t => make('li', { textContent: t }))) : make('p', { className: 'info', textContent: 'Same as the game.' }))
  }

  function row(key, title, fields, locked) {
    const f = form[key]
    const on = make('input', { type: 'checkbox', checked: f.on, disabled: locked })
    on.onchange = () => { f.on = on.checked; spawnEdited() }
    const num = (prop, lim, extra = {}) => {
      const i = make('input', { type: 'number', value: f[prop], min: lim.min, max: lim.max, step: lim.step ?? 1, disabled: locked, ...extra })
      i.oninput = () => { f[prop] = i.value === '' ? f[prop] : Number(i.value); spawnEdited() }
      return i
    }
    const L = SPAWN_LIMITS, lim = L[key]
    return make('div', { className: 'spawn-row' }, make('label', { className: 'check' }, on, ` ${title}`),
      make('span', {}, ' from ', num('from', lim), ' to ', num('to', lim)),
      ...fields(num))
  }

  function renderSpawn() {
    const locked = view.kind === 'story'
    const L = SPAWN_LIMITS
    const box = make('section', { className: 'publish-spawn' }, make('h2', { textContent: 'Where it appears' }))
    if (locked) box.append(make('p', { className: 'info', textContent: 'Placed by its story.' }))
    box.append(
      row('dungeon', 'Dungeon & cave levels', num => [make('span', {}, ', how common ', num('weight', L.weight))], locked),
      row('openMaps', 'Open maps', num => [make('span', {}, ', ', num('count', L.count), ' per map')], locked),
      make('p', { className: 'hint', textContent: 'Maps 8–10 are story maps and never get random monsters.' }))
    if (BOSS_NOTES[view.name]) box.append(make('p', { className: 'hint', textContent: BOSS_NOTES[view.name] }))
    return box
  }

  function renderName() {
    if (!view.isNew) return null
    const input = make('input', { type: 'text', value: view.name, spellcheck: false })
    const err = make('p', { className: 'error', textContent: nameError })
    input.onchange = async () => {
      const to = input.value.trim()
      if (to === view.name) return
      if (!NAME_RE.test(to)) { err.textContent = 'Use lowercase letters, digits and underscores only.'; return }
      try {
        await sendSpawn()
        await api.renameDraft(view.name, to)
      } catch (e) { err.textContent = e.message; return }
      nameError = ''
      onRenamed?.(to)
    }
    return make('section', { className: 'publish-name' }, make('h2', { textContent: 'Name' }), input, err,
      make('p', { className: 'hint', textContent: 'Lowercase letters, digits and underscores. This becomes the monster\'s file name.' }))
  }

  async function publish(btn) {
    publishing = true; btn.disabled = true
    const name = view.name
    try {
      await sendSpawn()
      try {
        await api.publish(name)
      } catch (err) {
        if (err.status === 409 && err.body?.stale) {
          if (!(await ask(`The game's copy of ${name} changed since you started this draft. Publish anyway and overwrite it?`, 'Publish anyway'))) return
          await api.publish(name, { force: true })
        } else throw err
      }
      resultFor = name
      toast(DONE)
      onPublished?.(name)
    } catch (err) {
      toast(`Not published: ${err.message}`, 'error')
    } finally {
      publishing = false; btn.disabled = !!view.buildError
    }
  }

  async function discard() {
    if (!(await ask('Throw away this draft and go back to the game\'s version?', 'Throw away'))) return
    const name = view.name, wasNew = view.isNew
    clearTimeout(timer); timer = null; dirty = false
    try { await inflight } catch { /* the draft is going away */ }
    try { await api.discardDraft(name) } catch (err) { return toast(`Not discarded: ${err.message}`, 'error') }
    onDiscarded?.(name, wasNew)
  }

  function render() {
    const publishBtn = make('button', { className: 'primary', type: 'button', textContent: 'Publish into the game', disabled: !!view.buildError || publishing })
    publishBtn.onclick = () => publish(publishBtn)
    const discardBtn = make('button', { type: 'button', textContent: 'Discard draft' })
    discardBtn.onclick = discard
    rootEl.replaceChildren(make('div', { className: 'publish-layout' },
      renderName(), renderSpawn(), changesBox,
      make('section', { className: 'publish-actions' },
        view.buildError ? make('p', { className: 'error', textContent: `Fix the cut first: ${view.buildError}` }) : null,
        make('div', { className: 'btns' }, publishBtn, discardBtn),
        resultFor === view.name ? make('p', { className: 'result', textContent: DONE }) : null)))
    renderChanges()
  }

  return {
    async show(v) {
      await this.flush()
      if (resultFor && resultFor !== v.name) resultFor = null
      view = v; touched = false; nameError = ''
      form = spawnToForm(v.def.spawn)
      paramLabels = await loadLabels(v)
      render()
    },
    hide() {},
    flush() { return sendSpawn() },
    pending: () => dirty || !!timer || sending > 0,
  }
}
