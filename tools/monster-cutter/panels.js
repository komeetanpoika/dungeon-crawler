// The cutter page's side-panel lists (warnings, pieces, points) and its
// confirm dialog. DOM only: every change goes through the `act` callbacks.
import { ROLES } from './cut-format.js'
import { LEAK } from './overlay.js'

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props)
  e.append(...kids.filter(k => k != null))
  return e
}

export function renderWarnings(box, { leaks, behind }) {
  box.replaceChildren()
  if (leaks.size) {
    box.append(el('div', { className: 'warn leak' },
      el('b', { textContent: `Cut line doesn't close: ${[...leaks].join(', ')}` }),
      el('div', { textContent: 'Drag both round ends past the outline so the line crosses the whole part, and keep the square seed on the part itself. Save is blocked until every cut closes.' })))
  }
  for (const { id, over } of behind) {
    box.append(el('div', { className: 'warn behind',
      textContent: `${id} claims pixels from ${over}, which is drawn in front of it: a hole may show when ${id} turns. Raise ${id}'s z above ${over}'s, or clear its claims.` }))
  }
}

// act: { select(id), role(id, role, side), z(id, z), merge(id), clearClaims(id) }
export function renderPieces(box, { cut, leaks, selected, colourOf }, act) {
  box.replaceChildren()
  const torso = cut.pieces.find(p => p.parent === null)
  for (const p of cut.pieces) {
    const root = p.parent === null, leak = leaks.has(p.id), limb = p.role === 'arm' || p.role === 'leg'
    const row = el('div', { className: `piece${p.id === selected ? ' sel' : ''}${leak ? ' leak' : ''}` })
    row.dataset.id = p.id
    row.onclick = e => { if (!e.target.closest('select, button')) act.select(p.id) }

    const swatch = el('span', { className: 'swatch' })
    swatch.style.background = leak ? LEAK : colourOf(p.id)
    row.append(el('div', { className: 'line1' }, swatch,
      el('b', { className: 'pid', textContent: p.id }),
      el('span', { className: 'parent', textContent: root ? 'root' : `on ${p.parent}${p.cut ? '' : ' · detached'}` }),
      leak ? el('span', { className: 'badge', textContent: 'LEAKS' }) : null,
      root ? null : el('button', { className: 'merge', textContent: 'merge', title: `Merge ${p.id} back into ${p.parent} (Del)`, onclick: () => act.merge(p.id) })))

    const role = el('select', { title: 'Role: decides how the piece moves', disabled: root })
    for (const r of root ? ['torso'] : ROLES.filter(r => r !== 'torso')) role.append(el('option', { value: r, textContent: r }))
    role.value = p.role
    const guessSide = () => p.side ?? (p.pivot[0] < torso.seed[0] ? 'left' : 'right')
    role.onchange = () => act.role(p.id, role.value, role.value === 'arm' || role.value === 'leg' ? guessSide() : null)
    const side = el('select', { title: 'Side: sets the walk phase', hidden: !limb })
    for (const s of ['left', 'right']) side.append(el('option', { value: s, textContent: s }))
    if (limb) side.value = p.side
    side.onchange = () => act.role(p.id, p.role, side.value)
    const z = el('span', { className: 'z', title: 'Draw order: higher is in front' },
      el('button', { textContent: '−', title: 'Draw further back', onclick: () => act.z(p.id, p.z - 1) }),
      el('span', { className: 'zval', textContent: `z ${p.z}` }),
      el('button', { textContent: '+', title: 'Draw further forward', onclick: () => act.z(p.id, p.z + 1) }))
    row.append(el('div', { className: 'line2' }, role, side, z))

    const n = p.claims?.length ?? 0
    if (n) row.append(el('div', { className: 'line3' }, el('span', { textContent: `${n} claim disc${n > 1 ? 's' : ''}` }),
      el('button', { textContent: 'clear claims', onclick: () => act.clearClaims(p.id) })))
    box.append(row)
  }
}

// act: { place(name), remove(name) }; active: the point the Point tool places
export function renderPoints(box, { cut, active }, act) {
  box.replaceChildren()
  const names = ['head', 'chest', ...Object.keys(cut.points ?? {}).filter(n => n !== 'head' && n !== 'chest')]
  for (const name of names) {
    const pt = cut.points?.[name]
    box.append(el('div', { className: `point${active === name ? ' active' : ''}` },
      el('b', { textContent: name }),
      el('span', { className: 'where', textContent: pt ? `on ${pt.piece}` : 'not placed' }),
      el('button', { textContent: pt ? 'move' : 'place', title: `Click on the monster to place "${name}"`, onclick: () => act.place(name) }),
      pt ? el('button', { className: 'x', textContent: '×', title: `Remove ${name}`, onclick: () => act.remove(name) }) : null))
  }
}

// A modal yes/no; resolves true when the user presses the OK button.
export function ask(text, okLabel = 'OK') {
  const dlg = document.getElementById('ask')
  document.getElementById('ask-text').textContent = text
  document.getElementById('ask-ok').textContent = okLabel
  return new Promise(resolve => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true })
    dlg.returnValue = ''
    dlg.showModal()
    document.getElementById('ask-ok').focus()
  })
}
