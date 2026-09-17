// DOM-free model behind ui/inventory-panel.js: what the gear strip shows,
// which buttons a selection offers, and how the cursor moves between the
// strip and the sack grid. Rendering stays in inventory-panel.js.
import { STANCES, LOADOUT_NAMES, MAIN_OF, CONSUMABLE_KINDS, gearOf, loadoutAvailable, makeItem, offhandItem, canEquip } from '../systems/inventory.js'

const HAND_EMOJI = { weapon: '⚔', ranged: '🏹', wand: '🪄', outfit: '🧥' }
export const GEAR_SLOTS = ['main', 'off', 'outfit']
export const SACK_COLS = 5

const asItem = (kind, payload) => payload ? { kind, name: payload.name, emoji: HAND_EMOJI[kind], payload } : null

// A pointer tile shows the kind even when the sack holds none of it (count 0),
// so the player can see what Q is aimed at. Distinct from resolveOffhand's
// shape: the panel wants a name and an emoji, Q wants the sack slot.
function offTile(player, off) {
  if (!off) return null
  if (off.kind !== 'consumable') return offhandItem(off)
  const slot = (player.inventory ?? []).find(i => i.kind === off.item)
  const proto = makeItem(off.item)
  return { kind: 'consumable', item: off.item, name: proto.name, emoji: proto.emoji, count: slot?.count ?? 0 }
}

export function gearStrip(player) {
  const active = player.attackMode ?? 'melee'
  return STANCES.map(stance => {
    const g = gearOf(player, stance)
    return {
      stance, name: LOADOUT_NAMES[stance], active: stance === active, locked: !loadoutAvailable(player, stance),
      tiles: [
        { slot: 'main', item: asItem(MAIN_OF[stance], player[MAIN_OF[stance]]) },
        { slot: 'off', item: offTile(player, g.off) },
        { slot: 'outfit', item: asItem('outfit', g.outfit) },
      ],
    }
  })
}

export function sackActions(player, item) {
  if (!item) return []
  const out = []
  if (!item.quest) {
    if (item.kind === 'weapon' || item.kind === 'ranged' || item.kind === 'wand') out.push({ label: 'Equip', fn: 'onEquip' })
    else if (item.kind === 'outfit') out.push({ label: 'Wear', fn: 'onEquip' })
    else if (item.kind === 'potion') out.push({ label: 'Drink', fn: 'onUse' })
    else if (item.kind === 'mushroom' || item.kind === 'meat' || item.kind === 'cooked_meat') out.push({ label: 'Eat', fn: 'onUse' })
    else if (item.kind === 'lumber' || item.kind === 'deadwood') out.push({ label: 'Build fire', fn: 'onBuild' })
    if (CONSUMABLE_KINDS.includes(item.kind)
      || ((item.kind === 'weapon' || item.kind === 'wand' || item.kind === 'shield') && canEquip(player, item, 'off').ok))
      out.push({ label: 'Offhand', fn: 'onEquipOff' })
    if (item.kind === 'weapon' && canEquip(player, item, 'belt').ok) out.push({ label: 'Belt', fn: 'onEquipBelt' })
  }
  out.push({ label: 'Drop', fn: 'onDrop' })
  return out
}

export function gearAction(player, stance, slot) {
  if (stance === 'belt') return player.belt ? { label: 'Unequip', fn: 'onUnequip' } : null
  if (!loadoutAvailable(player, stance)) return null
  const g = gearOf(player, stance)
  if (slot === 'main') return player[MAIN_OF[stance]] ? { label: 'Unequip', fn: 'onUnequip' } : null
  if (slot === 'outfit') return g.outfit ? { label: 'Unequip', fn: 'onUnequip' } : null
  if (slot === 'off') return g.off ? { label: g.off.kind === 'consumable' ? 'Clear' : 'Unequip', fn: 'onUnequip' } : null
  return null
}

// Gear index = column * 3 + tile (columns in STANCES order). The belt is one
// tile to the right of the three loadout columns, gear index 9. It has no
// loadout and is never locked.
export const BELT_INDEX = STANCES.length * GEAR_SLOTS.length   // 9
export const gearAt = index =>
  index === BELT_INDEX ? { stance: 'belt', slot: 'belt' } : { stance: STANCES[Math.floor(index / 3)], slot: GEAR_SLOTS[index % 3] }

export function beltTile(player) {
  return { slot: 'belt', item: asItem('weapon', player.belt) }
}

export function moveSelection(sel, key, counts, activeStance = 'melee') {
  const clampSack = i => Math.max(0, Math.min(Math.max(0, counts.sack - 1), i))
  if (sel.area === 'sack') {
    if (key === 'ArrowRight') return { area: 'sack', index: clampSack(sel.index + 1) }
    if (key === 'ArrowLeft') return { area: 'sack', index: clampSack(sel.index - 1) }
    if (key === 'ArrowDown') return { area: 'sack', index: clampSack(sel.index + SACK_COLS) }
    if (key === 'ArrowUp') {
      if (sel.index >= SACK_COLS) return { area: 'sack', index: sel.index - SACK_COLS }
      return { area: 'gear', index: STANCES.indexOf(activeStance) * 3 }
    }
    return sel
  }
  if (sel.index === BELT_INDEX) {
    if (key === 'ArrowLeft') return { area: 'gear', index: (STANCES.length - 1) * 3 }
    if (key === 'ArrowDown') return { area: 'sack', index: 0 }
    return sel
  }
  const col = Math.floor(sel.index / 3), tile = sel.index % 3
  if (key === 'ArrowRight') return col === STANCES.length - 1 ? { area: 'gear', index: BELT_INDEX } : { area: 'gear', index: (col + 1) * 3 + tile }
  if (key === 'ArrowLeft') return { area: 'gear', index: Math.max(0, col - 1) * 3 + tile }
  if (key === 'ArrowUp') return { area: 'gear', index: col * 3 + Math.max(0, tile - 1) }
  if (key === 'ArrowDown') return tile < 2 ? { area: 'gear', index: col * 3 + tile + 1 } : { area: 'sack', index: 0 }
  return sel
}
