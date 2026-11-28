// The bag: a pause overlay worked with the stick (or the arrows) and the
// four coloured buttons. The character being played and its gear stand on
// the left (above the stick on a phone), the bag and the chosen thing's
// description in the middle, and what the four buttons do on the right
// (above the buttons). All changes happen in game.js through handlers; what
// to show and what each button does comes from inventory-panel-model.js.
import { gearPanel, buttonsFor, describe, moveSelection, settle, SLOT_NAMES, SACK_COLS, DROP_HOLD } from './inventory-panel-model.js'
import { gearOf } from '../systems/inventory.js'
import { sfx } from '../systems/sfx.js'
import { iconSrcFor } from '../render/icons.js'
import { coinsOf, hasPurse } from '../systems/coin.js'

let keyHandler = null
let keyUpHandler = null
let sel = { area: 'sack', index: 0 }
let lastState = null
let handlers = null
let opts = {}
let chooser = null     // { places, index } while Equip asks where the thing goes
let dropTimer = null
let cols = SACK_COLS   // what the grid really shows (a narrow phone has fewer)

const el = () => document.getElementById('inv-overlay')
const BUTTONS = ['blue', 'red', 'green', 'yellow']   // drawn like the diamond: top, left, right, bottom

function iconHtml(item) {
  if (!item) return ''
  const src = iconSrcFor(item.kind === 'consumable' ? { kind: item.item } : item)
  return src ? `<img class="inv-icon" src="${src}" alt="">` : `<span class="inv-emoji">${item.emoji ?? ''}</span>`
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function cancelDrop() {
  if (dropTimer !== null) { clearTimeout(dropTimer); dropTimer = null }
  el()?.querySelector('.inv-btn.holding')?.classList.remove('holding')
}

function startDrop() {
  if (dropTimer !== null || !handlers) return
  const b = buttonsFor(lastState.player, sel, opts).blue
  if (!b.fn) return
  el().querySelector('.inv-btn.blue')?.classList.add('holding')
  // (Drop, or Sell beside a vendor: whichever the button said when the hold began)
  dropTimer = setTimeout(() => { dropTimer = null; handlers?.[b.fn]?.(sel.index) }, DROP_HOLD * 1000)
}

function fire(b) {
  if (b.fn === 'onUnequip') handlers.onUnequip(lastState.player.attackMode ?? 'melee', b.slot)
  else if (b.fn === 'onSwap') handlers.onSwap()
  else handlers[b.fn](sel.index)
}

function press(name) {
  if (!handlers) return
  const b = buttonsFor(lastState.player, sel, opts)[name]
  if (!b?.fn) return
  if (name === 'blue') return   // Drop (and Sell) is a hold, never a press
  // more than one place it fits: ask where
  if (name === 'red' && b.places?.length > 1) { chooser = { places: b.places, index: 0 }; refreshInventory(lastState); return }
  fire(b)
}

function pick() {
  const place = chooser?.places[chooser.index]
  chooser = null
  if (place) handlers[place.fn](sel.index)
  else refreshInventory(lastState)
}

export function refreshInventory(state) {
  if (!handlers) return
  const { player } = state
  lastState = state
  cancelDrop()
  sel = settle(sel, player.inventory.length)
  const root = el()
  root.className = opts.touch ? 'touch' : ''

  const gear = gearPanel(player)
  const worn = gearOf(player, gear.stance).outfit
  // the character as he stands in the world (game.js hands a portrait), or his outfit's icon
  const who = opts.portrait?.() ?? iconSrcFor(worn ? { kind: 'outfit', payload: worn } : null) ?? './assets/tiles/tile_0088.png'
  const tile = (t, i) => `<div class="inv-slot-wrap"><div class="inv-tile${sel.area === 'gear' && sel.index === i ? ' selected' : ''}" data-gear="${i}">${iconHtml(t.item)}${t.item?.kind === 'consumable' ? `<span class="inv-count">×${t.item.count}</span>` : ''}</div><small>${SLOT_NAMES[t.slot]}</small></div>`

  const slots = []
  for (let i = 0; i < player.maxInventory; i++) {
    const item = player.inventory[i]
    const count = item?.stackable && item.count > 1 ? `<span class="inv-count">×${item.count}</span>` : ''
    slots.push(`<div class="inv-slot${sel.area === 'sack' && i === sel.index ? ' selected' : ''}"${item ? ` data-sack="${i}"` : ''}>${iconHtml(item)}${count}</div>`)
  }

  const d = describe(player, sel, opts)
  const buttons = buttonsFor(player, sel, opts)
  // the purse, once the hero has met coin; and whom the bag is open beside
  const purse = hasPurse(player) || opts.buyer ? `<span class="inv-purse"><img src="./assets/tiles/item_coin.png" alt="coin">${coinsOf(player)}</span>` : ''
  const selling = opts.buyer ? `<div class="inv-selling">Selling to ${esc(opts.buyer.name)}</div>` : ''
  const keyOf = name => (opts.touch || !opts.keys?.[name] ? '' : `<kbd>${esc(opts.keys[name])}</kbd>`)
  const label = name => {
    const b = buttons[name]
    return `<span class="inv-btn ${name}${b.fn ? '' : ' off'}" data-btn="${name}"><b></b><em>${esc(b.label)}${b.hold ? ' (hold)' : ''}</em>${keyOf(name)}</span>`
  }
  const ask = chooser ? `<div class="inv-chooser">${chooser.places.map((p, i) => `<div class="${i === chooser.index ? 'selected' : ''}" data-place="${i}">${esc(p.label)}</div>`).join('')}</div>` : ''

  root.innerHTML = `
    <div class="inv-gear"><div class="inv-who"><img src="${who}" alt=""><span>${esc(gear.name)}</span></div>
      <div class="inv-slots">${gear.tiles.map(tile).join('')}</div></div>
    <div class="inv-bag"><div class="inv-title">BAG ${player.inventory.length}/${player.maxInventory}${purse}</div>${selling}
      <div class="inv-grid">${slots.join('')}</div>
      <div class="inv-desc"><b>${esc(d.title)}</b>${d.lines.map(l => `<div>${esc(l)}</div>`).join('')}${d.warn ? `<div class="warn">${esc(d.warn)}</div>` : ''}</div>${ask}</div>
    <div class="inv-what">${BUTTONS.map(label).join('')}${opts.touch ? '' : `<span class="inv-close">Close<kbd>${esc(opts.keys?.close ?? 'I')}</kbd></span>`}</div>`
  root.style.display = 'flex'

  // taps and clicks: a tile chooses, a label does what its button does
  root.querySelectorAll('[data-gear]').forEach(n => n.addEventListener('click', () => { chooser = null; sel = { area: 'gear', index: +n.dataset.gear }; refreshInventory(lastState) }))
  root.querySelectorAll('[data-sack]').forEach(n => n.addEventListener('click', () => { chooser = null; sel = { area: 'sack', index: +n.dataset.sack }; refreshInventory(lastState) }))
  root.querySelectorAll('[data-place]').forEach(n => n.addEventListener('click', () => { chooser.index = +n.dataset.place; pick() }))
  root.querySelectorAll('[data-btn]').forEach(n => {
    const name = n.dataset.btn
    if (name === 'blue') {
      n.addEventListener('pointerdown', startDrop)
      n.addEventListener('pointerup', cancelDrop)
      n.addEventListener('pointerleave', cancelDrop)
    } else n.addEventListener('click', () => press(name))
  })
  root.querySelector('.inv-close')?.addEventListener('click', () => handlers?.onClose())

  const grid = root.querySelector('.inv-grid')
  const shown = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
  cols = shown > 0 ? shown : SACK_COLS
  root.querySelector('.inv-slot.selected')?.scrollIntoView?.({ block: 'nearest' })
}

// `options`: { touch, keys: { red, green, blue, yellow, close }, buyer } — the
// key names shown beside the labels where there is a keyboard, and the vendor
// the bag is open beside ({ kind, name }: the blue button sells to them).
export function showInventory(state, handlerSet, options = {}) {
  handlers = handlerSet
  document.body.classList.add('pad-panel')
  opts = options
  sel = { area: 'sack', index: 0 }
  chooser = null
  refreshInventory(state)
  const swallow = e => { e.preventDefault(); e.stopImmediatePropagation() }
  keyHandler = (e) => {
    // The stick sends wasd: the same as the arrows here.
    const key = ({ d: 'ArrowRight', a: 'ArrowLeft', s: 'ArrowDown', w: 'ArrowUp' })[e.key] ?? e.key
    const player = state.player
    if (chooser) {
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        chooser.index = (chooser.index + (key === 'ArrowDown' ? 1 : chooser.places.length - 1)) % chooser.places.length
        refreshInventory(state)
      } else if (key === 'Enter' || key === ' ') { if (!e.repeat) pick() }
      else { chooser = null; refreshInventory(state) }   // anything else backs out
      swallow(e)
      return
    }
    if (key.startsWith('Arrow')) {
      const next = moveSelection(sel, key, { sack: player.inventory.length, cols })
      if (next.area !== sel.area || next.index !== sel.index) sfx(lastState, 'ui-move')
      sel = next
      refreshInventory(state)
    } else if (key === 'Enter' || key === ' ') { if (!e.repeat) press('red') }
    else if (key === 'q' || key === 'Q') { if (!e.repeat) press('green') }
    else if (key === 'f' || key === 'F') { if (!e.repeat) startDrop() }
    else if (key === 'Shift') { if (!e.repeat) press('yellow') }
    else return   // the bag key and Escape close it, in game.js
    swallow(e)
  }
  keyUpHandler = (e) => { if (e.key === 'f' || e.key === 'F') cancelDrop() }
  window.addEventListener('keydown', keyHandler, true)   // capture: outrank game key handlers
  window.addEventListener('keyup', keyUpHandler, true)
}

export function hideInventory() {
  if (keyHandler) { window.removeEventListener('keydown', keyHandler, true); keyHandler = null }
  if (keyUpHandler) { window.removeEventListener('keyup', keyUpHandler, true); keyUpHandler = null }
  cancelDrop()
  handlers = null
  document.body.classList.remove('pad-panel')
  chooser = null
  const root = el()
  root.style.display = 'none'
  root.innerHTML = ''
}
