// The loot sack: slot-capped inventory with stacking, plus the equip rules
// between the sack and the three hand slots (player.weapon / player.ranged /
// player.wand) and the shared ammo pool (player.ammo). Pure player-state
// logic — game.js owns pickups, drops, and messages.

import { AMMO_CAPS, emptyAmmo } from './entities.js'

const STACKABLE_KINDS = {
  potion:      { name: 'Potion',      emoji: '🧪', extra: { amount: 4 } },
  mushroom:    { name: 'Mushroom',    emoji: '🍄', extra: {} },
  meat:        { name: 'Meat',        emoji: '🍖', extra: { heal: 1 } },   // animal drop, raw
  cooked_meat: { name: 'Cooked Meat', emoji: '🍗', extra: { heal: 4 } },   // raw meat cooked on a campfire
  lumber:      { name: 'Lumber',      emoji: '🪵', extra: {} },            // felled tree (systems/lumber.js)
  deadwood:    { name: 'Grey Wood',   emoji: '🪵', extra: {} },  // dead-tree wood (systems/lumber.js); the hermit's fuel
  // Leap-episode quest items: never consumable, no default panel action
  // (Drop stays available — see ui/inventory-panel.js primaryAction).
  clapper:     { name: 'Bell Clapper', emoji: '🔔', extra: { quest: true } },
  fleece:      { name: "Lamb's Fleece", emoji: '🐑', extra: { quest: true } },
}

export function makeItem(kind, count = 1) {
  const def = STACKABLE_KINDS[kind]
  return { kind, name: def.name, emoji: def.emoji, stackable: true, count, ...def.extra }
}

const HAND_EMOJI = { weapon: '⚔', ranged: '🏹', wand: '🪄' }

// Chest/floating `contents` -> sack item. Ammo is never a sack item — it
// goes straight into the pool (see autoEquipOnPickup) — so this returns the
// bare { kind: 'ammo', ammoKind, count } shape rather than a stackable slot.
// Unknown types return null.
export function itemFromContents(contents) {
  if (contents.type === 'weapon' || contents.type === 'ranged' || contents.type === 'wand') {
    const { type, ...payload } = contents
    return { kind: type, name: contents.name, emoji: HAND_EMOJI[type], stackable: false, payload }
  }
  if (contents.type === 'ammo') return { kind: 'ammo', ammoKind: contents.ammoKind, count: contents.count ?? 1 }
  if (STACKABLE_KINDS[contents.type]) return makeItem(contents.type, contents.count ?? 1)
  return null
}

export function contentsFromItem(item) {
  if (item.kind === 'weapon' || item.kind === 'ranged' || item.kind === 'wand')
    return { ...item.payload, type: item.kind }
  if (item.kind === 'potion') return { type: 'potion', amount: item.amount }
  return { type: item.kind, count: item.count ?? 1 }
}

// Quick-use (Q / the green touch button): first potion-or-mushroom slot in
// sack order. The summary drives the button badge — next-up slot's emoji,
// combined count across all consumable slots.
const CONSUMABLE_KINDS = ['potion', 'mushroom', 'meat', 'cooked_meat']

export function findQuickUseIndex(inventory) {
  return inventory.findIndex(i => CONSUMABLE_KINDS.includes(i.kind))
}

export function quickUseSummary(inventory) {
  const first = findQuickUseIndex(inventory)
  if (first === -1) return null
  const count = inventory
    .filter(i => CONSUMABLE_KINDS.includes(i.kind))
    .reduce((sum, i) => sum + (i.count ?? 1), 0)
  return { emoji: inventory[first].emoji, count }
}

export function addItem(player, item) {
  if (item.stackable) {
    const slot = player.inventory.find(i => i.kind === item.kind)
    if (slot) { slot.count += item.count ?? 1; return { ok: true, stacked: true } }
  }
  if (player.inventory.length >= player.maxInventory) return { ok: false, reason: 'full' }
  player.inventory.push(item)
  return { ok: true, stacked: false }
}

// Remove one unit from the slot at `index`; returns a count-1 copy or null.
export function removeItem(player, index) {
  const slot = player.inventory[index]
  if (!slot) return null
  if (slot.stackable && slot.count > 1) { slot.count -= 1; return { ...slot, count: 1 } }
  player.inventory.splice(index, 1)
  return { ...slot }
}

export function canEquip(player, item) {
  if (item.kind === 'wand')
    return (player.talents ?? []).includes('magic_stance') ? { ok: true } : { ok: false, reason: 'not_learned' }
  if (item.kind !== 'weapon' && item.kind !== 'ranged') return { ok: false, reason: 'not_equippable' }
  if (item.kind === 'ranged' && !(player.talents ?? []).includes('ranged_stance'))
    return { ok: false, reason: 'not_learned' }
  if (item.payload.heavy && !(player.talents ?? []).includes('heavy_weapons'))
    return { ok: false, reason: 'heavy' }
  return { ok: true }
}

const HAND_OF_KIND = { weapon: 'weapon', ranged: 'ranged', wand: 'wand' }

// Equip the sack slot at `index` into its hand; a held item swaps back in.
export function equipItem(player, index) {
  const item = player.inventory[index]
  if (!item) return { ok: false, reason: 'not_equippable' }
  const gate = canEquip(player, item)
  if (!gate.ok) return gate
  const hand = HAND_OF_KIND[item.kind]
  const held = player[hand]
  player[hand] = { ...item.payload }
  player.inventory.splice(index, 1)
  if (held) {
    player.inventory.push({ kind: hand, name: held.name, emoji: HAND_EMOJI[hand],
      stackable: false, payload: { ...held } })
  }
  return { ok: true, equipped: item }
}

// The quiver/pouch pool (player.ammo, see entities.js AMMO_KINDS/AMMO_CAPS).
// Lazily created so a plain `{}` player object still works — callers never
// need to seed player.ammo themselves.
export function addAmmo(player, ammoKind, count) {
  if (!player.ammo) player.ammo = emptyAmmo()
  const before = player.ammo[ammoKind] ?? 0
  const after = Math.min(AMMO_CAPS[ammoKind], before + count)
  player.ammo[ammoKind] = after
  return after - before
}

export function spendAmmo(player, ammoKind, n = 1) {
  if (!player.ammo) player.ammo = emptyAmmo()
  const have = player.ammo[ammoKind] ?? 0
  if (have < n) return false
  player.ammo[ammoKind] = have - n
  return true
}

// Walk-onto pickup policy:
// - ammo bundles (mined stone, dropped ammo) go straight into the pool —
//   never a sack slot.
// - a ranged pickup's bundle always tops the pool up first; a carried twin
//   (hand or sack) then absorbs the weapon itself (discarded, ammo-only);
//   otherwise an empty allowed hand equips it, else it goes to the sack.
// - a wand: empty allowed hand -> equip; otherwise -> sack (no merging —
//   wands have no ammo to pool, so a duplicate is just a spare).
export function autoEquipOnPickup(player, item) {
  if (item.kind === 'ammo') {
    const added = addAmmo(player, item.ammoKind, item.count)
    return { ok: true, equipped: false, ammo: added, ammoKind: item.ammoKind }
  }
  if (item.kind === 'ranged') {
    const ammoKind = item.payload.ammoKind
    const added = addAmmo(player, ammoKind, item.payload.bundle)
    const wt = item.payload.weaponType
    if (player.ranged?.weaponType === wt)
      return { ok: true, equipped: false, merged: 'hand', ammo: added, ammoKind }
    if (player.inventory.some(i => i.kind === 'ranged' && i.payload.weaponType === wt))
      return { ok: true, equipped: false, merged: 'sack', ammo: added, ammoKind }
    if (!player.ranged && canEquip(player, item).ok) {
      player.ranged = { ...item.payload }
      return { ok: true, equipped: true }
    }
    const r = addItem(player, item)
    return r.ok ? { ok: true, equipped: false } : r
  }
  if (item.kind === 'wand') {
    if (!player.wand && canEquip(player, item).ok) {
      player.wand = { ...item.payload }
      return { ok: true, equipped: true }
    }
    const r = addItem(player, item)
    return r.ok ? { ok: true, equipped: false } : r
  }
  const hand = item.kind === 'weapon' ? 'weapon' : null
  if (hand && !player[hand] && canEquip(player, item).ok) {
    player[hand] = { ...item.payload }
    return { ok: true, equipped: true }
  }
  const r = addItem(player, item)
  return r.ok ? { ok: true, equipped: false } : r
}

export const EQUIP_FAIL_MESSAGES = {
  heavy: 'Too heavy — I lack the strength.',
  not_equippable: "I can't wield that.",
  not_learned: "I don't know how to use this.",
}
