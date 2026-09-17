// Pause-overlay loot sack panel: a gear strip (three loadouts × main / off /
// outfit, plus a fourth narrow belt column) above the sack grid. All
// mutations happen in game.js via handlers; what to show and where the
// cursor goes comes from inventory-panel-model.js.
import { canEquip, EQUIP_FAIL_MESSAGES } from '../systems/inventory.js'
import { gearStrip, sackActions, gearAction, gearAt, moveSelection, beltTile, BELT_INDEX } from './inventory-panel-model.js'
import { sfx } from '../systems/sfx.js'
import { iconSrcFor } from '../render/icons.js'
import { SPELLS } from '../systems/spells.js'

let keyHandler = null
let sel = { area: 'sack', index: 0 }
let lastState = null
let lastHandlers = null

const el = () => document.getElementById('inv-overlay')

function detailText(player, item) {
  if (!item) return ' '
  if (item.kind === 'consumable') return `${item.name} ×${item.count}`
  // Ammo is a shared pool, not a per-item count (Wands and Bows redesign) —
  // a sacked bow shows its damage only, never a stale per-item ammo figure.
  const stats = item.payload?.blockCost != null ? ` (block ${item.payload.blockCost} st)`
    : item.payload?.damage != null ? ` (${item.payload.damage} dmg)`
    : item.payload?.spell ? ` (${SPELLS[item.payload.spell]?.name ?? item.payload.spell})`
    : item.payload?.protect != null ? ` (protect ${item.payload.protect})` : ''
  const slot = item.kind === 'outfit' ? 'outfit' : item.kind === 'shield' ? 'off' : 'main'
  const gated = ['weapon', 'ranged', 'wand', 'outfit', 'shield'].includes(item.kind)
  const gate = gated ? canEquip(player, item, slot) : { ok: true }
  const warn = gate.ok ? '' : ` — <span class="warn">${EQUIP_FAIL_MESSAGES[gate.reason]}</span>`
  return `${item.name}${stats}${warn}`
}

function iconHtml(item, cls = 'inv-icon') {
  if (!item) return ''
  const src = iconSrcFor(item.kind === 'consumable' ? { kind: item.item } : item)
  return src ? `<img class="${cls}" src="${src}" alt="${item.name}">` : (item.emoji ?? '')
}

function selectedItem(player) {
  if (sel.area === 'sack') return player.inventory[sel.index] ?? null
  const { stance, slot } = gearAt(sel.index)
  if (stance === 'belt') return beltTile(player).item
  return gearStrip(player).find(c => c.stance === stance).tiles.find(t => t.slot === slot).item
}

export function refreshInventory(state) {
  if (!lastHandlers) return
  const { player } = state
  lastState = state
  if (sel.area === 'sack') sel.index = Math.min(sel.index, Math.max(0, player.inventory.length - 1))
  const root = el()
  root.innerHTML = ''
  const panel = document.createElement('div')
  panel.className = 'inv-panel'
  panel.innerHTML = `<div class="inv-title">PACK ${player.inventory.length}/${player.maxInventory}</div>`

  // Gear strip — one column per loadout. A locked column is greyed and inert:
  // no hint of how it opens (the world is the clue).
  const strip = document.createElement('div')
  strip.className = 'inv-strip'
  gearStrip(player).forEach((col, c) => {
    const colEl = document.createElement('div')
    colEl.className = 'inv-col' + (col.active ? ' active' : '') + (col.locked ? ' locked' : '')
    colEl.innerHTML = `<div class="inv-col-name">${col.name}</div>`
    col.tiles.forEach((t, i) => {
      const idx = c * 3 + i
      const tile = document.createElement('div')
      tile.className = 'inv-tile' + (sel.area === 'gear' && sel.index === idx ? ' selected' : '')
      tile.dataset.slot = t.slot
      tile.innerHTML = iconHtml(t.item) + (t.item?.kind === 'consumable' ? `<span class="inv-count">×${t.item.count}</span>` : '')
      if (!col.locked) tile.addEventListener('click', () => { sel = { area: 'gear', index: idx }; refreshInventory(lastState) })
      colEl.appendChild(tile)
    })
    strip.appendChild(colEl)
  })

  // The belt: one shared tool, its own narrow column, never locked.
  const belt = beltTile(player)
  const beltCol = document.createElement('div')
  beltCol.className = 'inv-col'
  beltCol.innerHTML = `<div class="inv-col-name">Belt</div>`
  const beltEl = document.createElement('div')
  beltEl.className = 'inv-tile' + (sel.area === 'gear' && sel.index === BELT_INDEX ? ' selected' : '')
  beltEl.dataset.slot = 'belt'
  beltEl.innerHTML = iconHtml(belt.item)
  beltEl.addEventListener('click', () => { sel = { area: 'gear', index: BELT_INDEX }; refreshInventory(lastState) })
  beltCol.appendChild(beltEl)
  strip.appendChild(beltCol)

  panel.appendChild(strip)

  const grid = document.createElement('div')
  grid.className = 'inv-grid'
  for (let i = 0; i < player.maxInventory; i++) {
    const slot = document.createElement('div')
    slot.className = 'inv-slot' + (sel.area === 'sack' && i === sel.index ? ' selected' : '')
    const item = player.inventory[i]
    if (item) {
      slot.innerHTML = iconHtml(item)
      if (item.stackable && item.count > 1) {
        const cnt = document.createElement('span'); cnt.className = 'inv-count'; cnt.textContent = `×${item.count}`
        slot.appendChild(cnt)
      }
      slot.addEventListener('click', () => { sel = { area: 'sack', index: i }; refreshInventory(lastState) })
    }
    grid.appendChild(slot)
  }
  panel.appendChild(grid)

  const detail = document.createElement('div')
  detail.className = 'inv-detail'
  detail.innerHTML = detailText(player, selectedItem(player))
  panel.appendChild(detail)

  const actions = document.createElement('div')
  actions.className = 'inv-actions'
  for (const a of currentActions(player)) {
    const b = document.createElement('button')
    b.textContent = a.label
    b.addEventListener('click', () => fire(a))
    actions.appendChild(b)
  }
  const close = document.createElement('button')
  close.textContent = 'Close (I)'
  close.addEventListener('click', () => lastHandlers.onClose())
  actions.appendChild(close)
  panel.appendChild(actions)
  root.appendChild(panel)
  root.style.display = 'flex'
}

function currentActions(player) {
  if (sel.area === 'sack') return sackActions(player, player.inventory[sel.index])
  const { stance, slot } = gearAt(sel.index)
  const a = gearAction(player, stance, slot)
  return a ? [a] : []
}

function fire(action) {
  if (sel.area === 'sack') lastHandlers[action.fn](sel.index)
  else { const { stance, slot } = gearAt(sel.index); lastHandlers[action.fn](stance, slot) }
}

export function showInventory(state, handlers) {
  lastHandlers = handlers
  sel = { area: 'sack', index: 0 }
  refreshInventory(state)
  keyHandler = (e) => {
    // Normalize the stick's synthetic wasd to the arrow keys this handler
    // already understands.
    const key = ({ d: 'ArrowRight', a: 'ArrowLeft', s: 'ArrowDown', w: 'ArrowUp' })[e.key] ?? e.key
    const player = state.player
    if (key.startsWith('Arrow')) {
      const next = moveSelection(sel, key, { sack: player.inventory.length, gear: 9 }, player.attackMode ?? 'melee')
      if (next.area !== sel.area || next.index !== sel.index) sfx(lastState, 'ui-move')
      sel = next
    } else if (key === 'Enter' || key === ' ') {
      // Enter fires the selection's primary action, but never a Drop: X is the
      // deliberate key for letting something go.
      const [first] = currentActions(player)
      if (first && first.fn !== 'onDrop') fire(first)
    } else if (key === 'x' || key === 'X') {
      if (sel.area === 'sack' && player.inventory[sel.index]) lastHandlers.onDrop(sel.index)
    } else return
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
