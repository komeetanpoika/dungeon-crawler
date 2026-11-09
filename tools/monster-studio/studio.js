// The Monster Studio page: wiring only. It owns the page state, the header
// (Open…, the monster's name, the draft badge, the five tabs), the cut
// autosave and tab switching. Each tab is an object { show(view), hide(),
// flush() }: the cutter covers Drawing and Cuts; Movement, Fight and Publish
// live in their own modules.
import * as api from './api.js'
import { tabsFor, startTab, disabledNote } from './tabs.js'
import { makeAutosave } from './autosave.js'
import { mountMovementTab } from './movement-tab.js'
import { mountFightTab } from './fight-tab.js'
import { mountPublishTab } from './publish-tab.js'
import { mountCutter } from '/tools/monster-cutter/cutter.js'
import { ask } from '/tools/monster-cutter/panels.js'
import { toast } from '/tools/tile-editor/toast.js'

const $ = id => document.getElementById(id)
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props)
  e.append(...kids.filter(k => k != null))
  return e
}
const CUT_DEBOUNCE = 600
const CUTTER_TABS = new Set(['drawing', 'cuts'])
const KIND_LABEL = { drawn: 'drawn', code: 'drawn by code', story: 'story' }
const stem = fileName => fileName.replace(/\.[^.]*$/, '')

// kind: 'new' while view.isNew, else view.kind. cutterFor: the draft whose
// cut the cutter holds (null while it holds none, so its edits go nowhere).
const state = { name: null, kind: null, view: null, tab: null, cutterFor: null }

// ---- the cut autosave (autosave.js keeps a failed save until it lands or the user leaves) ----
const autosave = makeAutosave({
  delay: CUT_DEBOUNCE,
  async save({ name, cut }) {
    await api.saveCut(name, cut)
    if (name !== state.name) return
    try { // the badge follows the saved cut
      const view = await api.readDraft(name)
      if (name === state.name) applyView(view)
    } catch { /* the next read catches the badge up */ }
  },
  onChange: () => renderBadge(),
  onError: err => toast(`Cut not saved: ${err.message}`, 'error'),
})
window.addEventListener('beforeunload', e => { if (autosave.unsaved()) { e.preventDefault(); e.returnValue = '' } })

// ---- tabs ----
const cutter = mountCutter({
  onCutChanged: cut => { if (state.name && state.cutterFor === state.name) autosave.queue(state.name, cut) },
  isActive: () => !!state.view && CUTTER_TABS.has(state.tab),
})
const cutterTab = {
  async show(view) {
    if (state.cutterFor === view.name) return // Drawing <-> Cuts keeps the session and its undo history
    await cutter.loadCut(view.cut, api.sourcePngUrl(view.name, view.rev))
    state.cutterFor = view.name
  },
  hide() {},
  flush: () => autosave.flush(),
}
const movementTab = mountMovementTab($('tab-movement'), { api })
const publishTab = mountPublishTab($('tab-publish'), {
  api,
  labels: () => movementTab.labels(),
  onPublished: name => openMonster(name, 'publish'),
  onDiscarded: (name, wasNew) => (wasNew ? closeMonster() : openMonster(name, 'publish')),
  onRenamed: to => openMonster(to, 'publish'),
})
const tabs = { drawing: cutterTab, cuts: cutterTab, movement: movementTab, fight: mountFightTab($('tab-fight')), publish: publishTab }

// ---- header and panes ----
function renderBadge() {
  const b = $('draft-badge'), v = state.view
  b.hidden = !v
  if (!v) return
  let text, cls
  if (autosave.pending()) [text, cls] = ['Saving…', 'saving']
  else if (autosave.error) [text, cls] = ['Not saved', 'error']
  else if (v.isNew || v.cutChanged || JSON.stringify(v.def) !== JSON.stringify(v.published)) [text, cls] = ['Unpublished changes', 'changed']
  else [text, cls] = ['Same as the game', 'same']
  b.textContent = text
  b.className = cls
  b.title = cls === 'error' ? autosave.error : ''
}
function renderHeader() {
  $('monster-name').textContent = state.name ?? ''
  const on = state.kind ? tabsFor(state.kind) : {}
  for (const b of document.querySelectorAll('#tabs button')) {
    const t = b.dataset.tab
    b.disabled = !on[t]
    b.title = (state.kind && disabledNote(state.kind, t)) ?? ''
    b.classList.toggle('active', t === state.tab)
  }
  renderBadge()
}
function renderPanes() {
  $('start-prompt').hidden = !!state.view
  $('layout').hidden = !CUTTER_TABS.has(state.tab)
  for (const p of document.querySelectorAll('#side .tab-pane')) p.hidden = p.dataset.pane !== state.tab
  for (const t of ['movement', 'fight', 'publish']) $(`tab-${t}`).hidden = state.tab !== t
}
function applyView(view) {
  state.view = view
  state.name = view.name
  state.kind = view.isNew ? 'new' : view.kind
  if (view.cut) cutter.setPreviewParams(view.def.params)
  renderHeader()
}

// ---- opening and switching (one at a time, so clicks can't interleave) ----
let busy = Promise.resolve()
const serial = fn => (...args) => (busy = busy.then(() => fn(...args)).catch(err => toast(err.message, 'error')))

// A tab whose edits can't be saved keeps the page on it (its flush rejects).
async function leaveTab() {
  const leaving = state.tab && tabs[state.tab]
  if (!leaving) return true
  try { await leaving.flush() } catch (err) {
    toast(`Staying here: ${err.message}. Switching again retries the save.`, 'error')
    return false
  }
  leaving.hide()
  return true
}
// Before leaving the open monster its cut must be saved; when the save keeps
// failing, the user chooses between staying and throwing those edits away.
async function leaveMonster() {
  try { await autosave.flush(); return true } catch (err) {
    const name = err.job?.name ?? state.name
    if (await ask(`The cut of ${name} could not be saved: ${err.message}. Leave it anyway and lose those edits?`, 'Leave anyway')) {
      autosave.reset()
      return true
    }
    toast(`Still on ${name}: its cut is not saved yet.`, 'error')
    return false
  }
}

async function doShowTab(tab) {
  if (!state.view || !tabsFor(state.kind)[tab]) return
  if (!(await leaveTab())) return
  applyView(await api.readDraft(state.name))
  state.tab = tab
  renderPanes()
  renderHeader()
  await tabs[tab].show(state.view)
}
async function doOpenMonster(name, tab) {
  if (!(await leaveMonster())) return
  const view = await api.openDraft(name)
  state.cutterFor = null // the cutter reloads from this draft
  applyView(view)
  await doShowTab(tab ?? startTab(state.kind))
}
// A discarded new drawing leaves nothing to show: back to the empty page.
async function doCloseMonster() {
  await leaveTab()
  autosave.reset()
  Object.assign(state, { name: null, kind: null, view: null, tab: null, cutterFor: null })
  renderPanes()
  renderHeader()
}
async function doOpenDrawing(file) {
  if (!file) return
  if (!(await leaveMonster())) return
  const got = await cutter.openImage(file)
  if (!got) return
  state.cutterFor = null // a drawing with no draft yet: edits wait for it
  try {
    const { name } = await api.suggestName(stem(file.name))
    applyView(await api.createDraft({ name, cut: got.cut, sourcePng: got.sourcePng }))
    state.cutterFor = name
    if (cutter.cut !== got.cut) autosave.queue(name, cutter.cut) // edited while the draft was being made
  } catch (err) {
    toast(`Could not start a draft: ${err.message}`, 'error')
    if (state.view && CUTTER_TABS.has(state.tab)) await doShowTab(state.tab) // put the open monster's cut back
    return
  }
  await doShowTab('drawing')
}
const showTab = serial(doShowTab)
const openMonster = serial(doOpenMonster)
const closeMonster = serial(doCloseMonster)
const openDrawing = serial(doOpenDrawing)

// ---- the Open… dialog ----
async function showOpenDialog() {
  let list
  try { list = await api.listMonsters() } catch (err) { return toast(`Could not list the monsters: ${err.message}`, 'error') }
  const dlg = $('open-dialog')
  const pick = (name, ...badges) => el('button', { type: 'button', onclick: () => { dlg.close(); openMonster(name) } },
    el('span', { textContent: name }), ...badges)
  $('open-game').replaceChildren(...list.monsters.map(m => pick(m.name,
    m.hasDraft ? el('span', { className: 'has-draft', textContent: 'draft' }) : null,
    el('span', { className: 'kind', textContent: KIND_LABEL[m.kind] ?? m.kind }))))
  $('open-new').replaceChildren(...(list.newDrafts.length
    ? list.newDrafts.map(n => pick(n, el('span', { className: 'kind', textContent: 'new' })))
    : [el('p', { className: 'none', textContent: 'None yet.' })]))
  dlg.showModal()
}
$('open').onclick = showOpenDialog
$('open-file').onchange = e => { const f = e.target.files[0]; e.target.value = ''; $('open-dialog').close(); openDrawing(f) }
$('file').onchange = e => { const f = e.target.files[0]; e.target.value = ''; openDrawing(f) }
for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => showTab(b.dataset.tab)

// a dropped drawing starts a new monster; elsewhere the browser must not navigate to it
window.addEventListener('dragover', e => e.preventDefault())
window.addEventListener('drop', e => e.preventDefault())
for (const zone of [$('canvas-wrap'), $('start-prompt')]) {
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drop') })
  zone.addEventListener('dragleave', () => zone.classList.remove('drop'))
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drop'); openDrawing(e.dataTransfer.files[0]) })
}

renderPanes()
renderHeader()
window.studio = { state, showTab, openMonster, openDrawing }
