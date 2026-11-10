// The Movement tab's phase cards: one card per pose of the selected
// animation, in a row, then + Add phase. A card shows its number and name, a
// thumbnail of its pose, the time its move takes (the first card's is the
// move back to the start), a delete button (every card but the first) and,
// on the attack, "blow lands here" (every card but the first; the hit card is
// outlined red with a HIT badge). render() updates the cards in place, so a
// time slider or the name field keeps working while the tab re-renders on
// every edit; a thumbnail redraws only when its pose changed.
import { LIMITS } from '../../renderer/render/monster-rigs/anims.js'

const [T0, T1] = LIMITS.time
const STEPS = 1000
// the slider runs on the square root of the time, so the short end, where
// "quickly" lives, gets most of its travel
const toSlider = t => Math.round(Math.sqrt((Math.min(T1, Math.max(T0, t)) - T0) / (T1 - T0)) * STEPS)
const fromSlider = v => { const u = v / STEPS; return Math.round((T0 + (T1 - T0) * u * u) * 100) / 100 }
const NAME_MAX = 24
let mounts = 0

export function mountPhaseCards(el, { onSelect, onTime, onHit, onDelete, onAdd, onName, drawThumb }) {
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e }
  const radioGroup = `phase-hit-${++mounts}`
  const addBtn = make('button', { type: 'button', className: 'add-phase', textContent: '+ Add phase',
    title: 'Insert a copy of the selected card right after it' })
  addBtn.onclick = () => onAdd()
  el.replaceChildren(addBtn)
  let cards = [], shownName = null

  function makeCard() {
    const badge = make('span', { className: 'hitbadge', textContent: 'HIT' })
    const num = make('span', { className: 'num' })
    const nameIn = make('input', { type: 'text', maxLength: NAME_MAX, spellcheck: false })
    const del = make('button', { type: 'button', className: 'del', textContent: '✕', title: 'Delete this card' })
    const thumb = make('canvas', { width: 120, height: 92 })
    const what = make('span'), secs = make('b')
    const slider = make('input', { type: 'range', min: 0, max: STEPS, step: 1 })
    const radio = make('input', { type: 'radio', name: radioGroup })
    const hitRow = make('label', { className: 'hitrow' }, radio, ' blow lands here')
    const root = make('div', { className: 'phase-card' }, badge, make('div', { className: 'top' }, num, nameIn, del),
      thumb, make('div', { className: 'time' }, what, secs), slider, hitRow)
    const card = { root, badge, num, nameIn, del, thumb, what, secs, slider, radio, hitRow, i: 0, pose: {}, poseKey: null }
    root.onclick = e => { if (!e.target.closest('button, input[type=range], .hitrow')) onSelect(card.i) }
    nameIn.onchange = () => onName(card.i, nameIn.value)
    nameIn.onkeydown = e => { if (e.key === 'Enter') nameIn.blur() }
    del.onclick = () => onDelete(card.i)
    slider.oninput = () => {
      const t = fromSlider(Number(slider.value))
      secs.textContent = `${t.toFixed(2)} s`
      onTime(card.i, t)
    }
    radio.onchange = () => { if (radio.checked) onHit(card.i) }
    el.insertBefore(root, addBtn)
    return card
  }

  function update(card, phase, i, name, selected) {
    const attack = name === 'attack', hit = attack && i >= 1 && !!phase.hit
    card.i = i
    card.root.className = 'phase-card' + (i === selected ? ' sel' : '') + (hit ? ' hit' : '')
    card.badge.hidden = !hit
    card.num.textContent = `${i + 1}.`
    card.nameIn.placeholder = i === 0 ? 'Start' : 'Name'
    if (document.activeElement !== card.nameIn) card.nameIn.value = phase.name ?? ''
    card.del.hidden = i === 0
    card.what.textContent = i === 0 ? 'back to start' : 'move takes'
    card.slider.title = i === 0 ? 'How long the move from the last card back to this one takes' : 'How long the move into this pose takes'
    card.secs.textContent = `${phase.time.toFixed(2)} s`
    // left alone while it already reads this time, so a drag in progress keeps its exact spot
    if (fromSlider(Number(card.slider.value)) !== phase.time) card.slider.value = String(toSlider(phase.time))
    card.hitRow.hidden = !(attack && i >= 1)
    card.radio.checked = hit
    card.pose = phase.pose ?? {}
    const key = JSON.stringify(card.pose)
    if (key !== card.poseKey) { card.poseKey = key; drawThumb(card.thumb, card.pose) }
  }

  function clear() {
    for (const c of cards) c.root.remove()
    cards = []
    shownName = null
  }

  return {
    // anim: { phases } (the animation's cards), name: which animation, selected: the card being posed
    render(anim, name, selected) {
      if (name !== shownName) { clear(); shownName = name }
      const phases = anim?.phases ?? []
      while (cards.length < phases.length) cards.push(makeCard())
      while (cards.length > phases.length) cards.pop().root.remove()
      phases.forEach((ph, i) => update(cards[i], ph, i, name, selected))
    },
    // the figure changed under the same poses (its drawing loaded, another monster)
    redrawThumbs() { for (const c of cards) drawThumb(c.thumb, c.pose) },
    clear,
  }
}
