// Pause-overlay loot sack panel. Renders player.inventory + the two hand
// slots; all mutations happen in game.js via the handlers.
import { canEquip, EQUIP_FAIL_MESSAGES } from '../systems/inventory.js'
import { sfx } from '../systems/sfx.js'

let keyHandler = null
let selected = 0
let lastState = null
let lastHandlers = null

const el = () => document.getElementById('inv-overlay')

function primaryAction(item) {
  if (!item) return null
  if (item.kind === 'weapon' || item.kind === 'ranged') return { label: 'Equip', fn: 'onEquip' }
  if (item.kind === 'potion') return { label: 'Drink', fn: 'onUse' }
  if (item.kind === 'mushroom') return { label: 'Eat', fn: 'onUse' }
  return null
}

function detailText(player, item) {
  if (!item) return ' '
  const stats = item.payload?.damage != null ? ` (${item.payload.damage} dmg)` : ''
  const gate = (item.kind === 'weapon' || item.kind === 'ranged') ? canEquip(player, item) : { ok: true }
  const warn = gate.ok ? '' : ` — <span class="warn">${EQUIP_FAIL_MESSAGES[gate.reason]}</span>`
  return `${item.name}${stats}${warn}`
}

export function refreshInventory(state) {
  if (!lastHandlers) return
  const { player } = state
  lastState = state
  selected = Math.min(selected, Math.max(0, player.inventory.length - 1))
  const root = el()
  root.innerHTML = ''
  const panel = document.createElement('div')
  panel.className = 'inv-panel'
  panel.innerHTML = `<div class="inv-title">PACK ${player.inventory.length}/${player.maxInventory}</div>`
  const hands = document.createElement('div')
  hands.className = 'inv-hands'
  const handTexts = [`⚔ ${player.weapon ? player.weapon.name : 'Unarmed'}`]
  if ((player.talents ?? []).includes('ranged_stance') || player.ranged)
    handTexts.push(`🏹 ${player.ranged ? player.ranged.name : 'Empty'}`)
  for (const t of handTexts) {
    const h = document.createElement('div'); h.className = 'inv-hand'; h.textContent = t; hands.appendChild(h)
  }
  panel.appendChild(hands)
  const grid = document.createElement('div')
  grid.className = 'inv-grid'
  for (let i = 0; i < player.maxInventory; i++) {
    const slot = document.createElement('div')
    slot.className = 'inv-slot' + (i === selected ? ' selected' : '')
    const item = player.inventory[i]
    if (item) {
      slot.textContent = item.emoji
      if (item.stackable && item.count > 1) {
        const c = document.createElement('span'); c.className = 'inv-count'; c.textContent = `×${item.count}`
        slot.appendChild(c)
      }
      slot.addEventListener('click', () => { selected = i; refreshInventory(lastState) })
    }
    grid.appendChild(slot)
  }
  panel.appendChild(grid)
  const detail = document.createElement('div')
  detail.className = 'inv-detail'
  detail.innerHTML = detailText(player, player.inventory[selected])
  panel.appendChild(detail)
  const actions = document.createElement('div')
  actions.className = 'inv-actions'
  const item = player.inventory[selected]
  const primary = primaryAction(item)
  if (primary) {
    const b = document.createElement('button')
    b.textContent = primary.label
    b.addEventListener('click', () => lastHandlers[primary.fn](selected))
    actions.appendChild(b)
  }
  if (item) {
    const d = document.createElement('button')
    d.textContent = 'Drop'
    d.addEventListener('click', () => lastHandlers.onDrop(selected))
    actions.appendChild(d)
  }
  const close = document.createElement('button')
  close.textContent = 'Close (I)'
  close.addEventListener('click', () => lastHandlers.onClose())
  actions.appendChild(close)
  panel.appendChild(actions)
  root.appendChild(panel)
  root.style.display = 'flex'
}

export function showInventory(state, handlers) {
  lastHandlers = handlers
  selected = 0
  refreshInventory(state)
  keyHandler = (e) => {
    const n = state.player.inventory.length
    const cols = 5
    const prev = selected
    if (e.key === 'ArrowRight') selected = Math.min(Math.max(0, n - 1), selected + 1)
    else if (e.key === 'ArrowLeft') selected = Math.max(0, selected - 1)
    else if (e.key === 'ArrowDown') selected = Math.min(Math.max(0, n - 1), selected + cols)
    else if (e.key === 'ArrowUp') selected = Math.max(0, selected - cols)
    else if (e.key === 'Enter') {
      const p = primaryAction(state.player.inventory[selected])
      if (p) lastHandlers[p.fn](selected)
    } else if (e.key === 'x' || e.key === 'X') {
      if (state.player.inventory[selected]) lastHandlers.onDrop(selected)
    } else return
    if (selected !== prev) sfx(lastState, 'ui-move')
    e.preventDefault(); e.stopPropagation()
    refreshInventory(state)
  }
  window.addEventListener('keydown', keyHandler, true)   // capture: outrank game key handlers
}

export function hideInventory() {
  if (keyHandler) { window.removeEventListener('keydown', keyHandler, true); keyHandler = null }
  lastHandlers = null
  const root = el()
  root.style.display = 'none'
  root.innerHTML = ''
}
