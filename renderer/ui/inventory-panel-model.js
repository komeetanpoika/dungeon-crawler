// DOM-free model behind ui/inventory-panel.js: the gear of the character
// being played, what the four buttons do for whatever is chosen, where Equip
// can put a thing, and how the cursor moves. Rendering stays in
// inventory-panel.js.
import {
  LOADOUT_NAMES, MAIN_OF, CONSUMABLE_KINDS, EQUIP_FAIL_MESSAGES,
  gearOf, loadoutAvailable, makeItem, offhandItem, canEquip, wornItem,
} from '../systems/inventory.js'
import { WORN_SLOTS } from '../systems/entities.js'
import { nextStance } from '../systems/ranged.js'
import { SPELLS } from '../systems/spells.js'
import { offer, worth, hasPurse } from '../systems/coin.js'

const HAND_EMOJI = { weapon: '⚔', ranged: '🏹', wand: '🪄', outfit: '🧥' }
// The gear grid: two rows of four. The first row is the hands, the outfit
// and the belt; the second what the character wears (entities.js WORN_SLOTS).
export const GEAR_SLOTS = ['main', 'off', 'outfit', 'belt', ...WORN_SLOTS]
export const GEAR_ROOM = 8
export const GEAR_COLS = 4
export const SLOT_NAMES = { main: 'Main', off: 'Off', outfit: 'Outfit', belt: 'Belt', head: 'Head', armor: 'Armor', boots: 'Boots', ring: 'Ring' }
const PLACE_NAMES = { main: 'Main hand', off: 'Offhand', outfit: 'Outfit', belt: 'Belt', head: 'Head', armor: 'Armor', boots: 'Boots', ring: 'Ring' }
const isWorn = item => WORN_SLOTS.includes(item?.kind)

// What a worn piece does, a short line for each thing (entities.js WORN_TYPES).
const POWER_LINES = {
  ram: 'A sprint rams whatever stands in the way.',
  cool: 'Keeps the desert sun off.',
  wayfarer: 'A quicker walk.',
  breath: 'Breath comes back faster.',
  mending: 'Wounds close by themselves, slowly.',
  miser: 'Purses fall heavier.',
  smith: 'Armor mends twice as fast.',
}
function pieceLines(p) {
  const out = []
  if (p.armor > 0) out.push(`${p.armor} armor.`)
  if (p.sprintMul != null && p.sprintMul !== 1)
    out.push(p.sprintMul < 1 ? 'Sprinting costs far less.' : p.sprintMul >= 2 ? 'Sprinting costs double.' : 'Sprinting costs half again as much.')
  if (POWER_LINES[p.power]) out.push(POWER_LINES[p.power])
  return out
}
export const SACK_COLS = 8
export const DROP_HOLD = 0.5   // seconds the Drop button is held

const asItem = (kind, payload) => payload ? { kind, name: payload.name, emoji: HAND_EMOJI[kind], payload } : null
const stanceOf = player => player.attackMode ?? 'melee'
const STANCE_OF_KIND = Object.fromEntries(Object.entries(MAIN_OF).map(([stance, kind]) => [kind, stance]))

// A pointer tile shows the kind even when the sack holds none of it (count 0),
// so the player can see what Q is aimed at.
function offTile(player, off) {
  if (!off) return null
  if (off.kind !== 'consumable') return offhandItem(off)
  const slot = (player.inventory ?? []).find(i => i.kind === off.item)
  const proto = makeItem(off.item)
  return { kind: 'consumable', item: off.item, name: proto.name, emoji: proto.emoji, count: slot?.count ?? 0 }
}

// The character being played and its eight slots. The belt is shared by all
// three and shown with each; everything else is this character's own.
export function gearPanel(player) {
  const stance = stanceOf(player), g = gearOf(player, stance)
  return {
    stance, name: LOADOUT_NAMES[stance],
    tiles: [
      { slot: 'main', item: asItem(MAIN_OF[stance], player[MAIN_OF[stance]]) },
      { slot: 'off', item: offTile(player, g.off) },
      { slot: 'outfit', item: asItem('outfit', g.outfit) },
      { slot: 'belt', item: asItem('weapon', player.belt) },
      ...WORN_SLOTS.map(slot => ({ slot, item: g[slot] ? wornItem(slot, g[slot]) : null })),
    ],
  }
}

export const edible = item => item?.kind === 'potion' || item?.kind === 'mushroom' || Number.isFinite(item?.heal)
const isHand = item => item?.kind === 'weapon' || item?.kind === 'ranged' || item?.kind === 'wand'

// Where Equip can put a thing from the bag, for the character being played.
// An outfit is the one thing that may dress another character: wearing it is
// how that character is opened.
export function placesFor(player, item) {
  if (!item || item.quest) return []
  if (item.kind === 'outfit') return [{ slot: 'outfit', label: PLACE_NAMES.outfit, fn: 'onEquip' }]
  if (isWorn(item)) return canEquip(player, item, item.kind).ok ? [{ slot: item.kind, label: PLACE_NAMES[item.kind], fn: 'onEquipWorn' }] : []
  const out = []
  if (isHand(item) && item.kind === MAIN_OF[stanceOf(player)] && canEquip(player, item, 'main').ok)
    out.push({ slot: 'main', label: PLACE_NAMES.main, fn: 'onEquip' })
  if ((CONSUMABLE_KINDS.includes(item.kind) || item.kind === 'weapon' || item.kind === 'wand' || item.kind === 'shield')
    && canEquip(player, item, 'off').ok)
    out.push({ slot: 'off', label: PLACE_NAMES.off, fn: 'onEquipOff' })
  if (item.kind === 'weapon' && canEquip(player, item, 'belt').ok) out.push({ slot: 'belt', label: PLACE_NAMES.belt, fn: 'onEquipBelt' })
  return out
}

// Why a thing that looks wearable cannot be equipped just now, or null.
export function refusal(player, item) {
  if (!item || item.quest || placesFor(player, item).length) return null
  if (isHand(item)) {
    const gate = canEquip(player, item, 'main')
    if (!gate.ok) return EQUIP_FAIL_MESSAGES[gate.reason]
    const whose = STANCE_OF_KIND[item.kind]
    if (whose !== stanceOf(player)) return `The ${LOADOUT_NAMES[whose]} carries this.`
  }
  if (item.kind === 'shield') return EQUIP_FAIL_MESSAGES[canEquip(player, item, 'off').reason] ?? null
  if (isWorn(item)) {
    const reason = canEquip(player, item, item.kind).reason
    return reason === 'heavy' ? "Needs the Knight's Tabard." : EQUIP_FAIL_MESSAGES[reason] ?? null
  }
  return null
}

function unequipLabel(player, slot) {
  const stance = stanceOf(player), g = gearOf(player, stance)
  if (slot === 'belt') return player.belt ? 'Unequip' : null
  if (slot === 'main') return player[MAIN_OF[stance]] ? 'Unequip' : null
  if (slot === 'outfit') return g.outfit ? 'Unequip' : null
  if (slot === 'off') return g.off ? (g.off.kind === 'consumable' ? 'Clear' : 'Unequip') : null
  if (WORN_SLOTS.includes(slot)) return g[slot] ? 'Unequip' : null
  return null
}

const useOf = item => {
  if (!item || item.quest) return null
  if (item.kind === 'potion') return { label: 'Drink', fn: 'onUse' }
  if (edible(item)) return { label: 'Eat', fn: 'onUse' }
  if (item.kind === 'lumber' || item.kind === 'deadwood') return { label: 'Build fire', fn: 'onBuild' }
  return null
}

// What the four buttons do for the selection. A button that does nothing is
// still named (so its label can be greyed) but has no `fn`.
//   red     Equip (with `places` when there is more than one) / Unequip
//   green   Use: eat, drink, build a fire
//   blue    Drop, held; beside a vendor (`buyer`: { kind, name }, systems/coin.js)
//           it is Sell for whatever that vendor buys, with what they pay
//   yellow  Switch character
export function buttonsFor(player, sel, { buyer = null } = {}) {
  const off = label => ({ label, fn: null })
  const yellow = nextStance(player) ? { label: 'Switch character', fn: 'onSwap' } : off('Switch character')
  if (sel.area === 'gear') {
    const slot = GEAR_SLOTS[sel.index], label = unequipLabel(player, slot)
    return {
      red: label ? { label, fn: 'onUnequip', slot } : off('Unequip'),
      green: off('Use'), blue: off('Drop'), yellow,
    }
  }
  const item = player.inventory[sel.index] ?? null
  const places = placesFor(player, item)
  const equipLabel = item?.kind === 'outfit' || isWorn(item) ? 'Wear' : 'Equip'
  return {
    red: places.length ? { label: equipLabel, fn: places[0].fn, places } : off(equipLabel),
    green: useOf(item) ?? off('Use'),
    blue: !item ? off('Drop')
      : buyer && offer(buyer.kind, item) > 0 ? { label: `Sell for ${offer(buyer.kind, item)}`, fn: 'onSell', hold: DROP_HOLD, coins: offer(buyer.kind, item) }
      : { label: 'Drop', fn: 'onDrop', hold: DROP_HOLD },
    yellow,
  }
}

// The chosen thing in words: a title and a few short lines.
export function describe(player, sel, { buyer = null } = {}) {
  const lines = []
  let item
  if (sel.area === 'gear') {
    const tile = gearPanel(player).tiles[sel.index]
    item = tile?.item
    if (!item) return { title: SLOT_NAMES[GEAR_SLOTS[sel.index]] ?? '', lines: ['Nothing here.'] }
    lines.push(tile.slot === 'belt' ? 'On the belt, shared by all three.' : `${PLACE_NAMES[tile.slot]} of the ${gearPanel(player).name}.`)
  } else {
    item = player.inventory[sel.index] ?? null
    if (!item) return { title: '', lines: [] }
  }
  const p = item.payload
  if (p?.damage != null) lines.unshift(`${p.damage} damage.`)
  if (p?.blockCost != null) lines.unshift(`Blocks a blow for ${p.blockCost} stamina.`)
  if (p?.spell) lines.unshift(`Casts ${SPELLS[p.spell]?.name ?? p.spell}.`)
  if (isWorn(item)) lines.unshift(...pieceLines(p))
  if (p?.chop || p?.mine) lines.push(p.chop && p.mine ? 'Chops trees and breaks rock.' : p.chop ? 'Chops trees.' : 'Breaks rock.')
  if (item.kind === 'potion' && item.amount) lines.push(`Heals ${item.amount}.`)
  else if (Number.isFinite(item.heal)) lines.push(`Heals ${item.heal}.`)
  if (item.kind === 'consumable' && sel.area === 'gear') lines.push(item.count ? `${item.count} in the bag.` : 'None left in the bag.')
  // what it would fetch: from the vendor at hand, or (once the hero has met coin) from a smith
  if (sel.area === 'sack' && worth(item) > 0) {
    if (buyer) lines.push(`${buyer.name} pays ${offer(buyer.kind, item)} coin.`)
    else if (hasPurse(player)) lines.push(`Worth ${worth(item)} coin to a smith.`)
  } else if (sel.area === 'sack' && buyer) lines.push(`${buyer.name} does not buy this.`)
  const no = sel.area === 'sack' ? refusal(player, item) : null
  const count = sel.area === 'sack' && item.stackable && item.count > 1 ? ` ×${item.count}` : ''
  return { title: `${item.name}${count}`, lines, warn: no }
}

// The cursor. The bag is a grid `cols` wide holding `sack` things; the gear
// is two rows of four to its left. Left from the bag's first column goes to
// the last slot of the gear row beside it (the second for any row below),
// and right from a gear row's last slot comes back to the bag row it left,
// or to the gear's own row once the cursor has changed row there (`row`).
export function moveSelection(sel, key, { sack, cols = SACK_COLS }) {
  const last = Math.max(0, sack - 1)
  const gearRows = Math.ceil(GEAR_SLOTS.length / GEAR_COLS)
  if (sel.area === 'gear') {
    const gcol = sel.index % GEAR_COLS, grow = Math.floor(sel.index / GEAR_COLS)
    if (key === 'ArrowLeft') return gcol > 0 ? { ...sel, index: sel.index - 1 } : sel
    if (key === 'ArrowUp') return grow > 0 ? { ...sel, index: sel.index - GEAR_COLS, row: grow - 1 } : sel
    if (key === 'ArrowDown') return grow < gearRows - 1 ? { ...sel, index: sel.index + GEAR_COLS, row: grow + 1 } : sel
    if (key === 'ArrowRight') {
      if (gcol < GEAR_COLS - 1) return { ...sel, index: sel.index + 1 }
      return sack ? { area: 'sack', index: Math.min(last, (sel.row ?? grow) * cols) } : sel
    }
    return sel
  }
  const col = sel.index % cols, row = Math.floor(sel.index / cols)
  if (key === 'ArrowRight') return { area: 'sack', index: Math.min(last, sel.index + 1) }
  if (key === 'ArrowLeft') return col === 0 ? { area: 'gear', index: Math.min(row, gearRows - 1) * GEAR_COLS + GEAR_COLS - 1, row } : { area: 'sack', index: sel.index - 1 }
  if (key === 'ArrowDown') return { area: 'sack', index: sel.index + cols <= last ? sel.index + cols : (Math.floor(last / cols) > row ? last : sel.index) }
  if (key === 'ArrowUp') return { area: 'sack', index: row > 0 ? sel.index - cols : sel.index }
  return sel
}

// A selection that still points at something after the bag changed.
export function settle(sel, sack) {
  if (sel.area === 'gear') return sel
  return sack ? { area: 'sack', index: Math.min(sel.index, sack - 1) } : { area: 'gear', index: 0 }
}
