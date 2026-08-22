// The loot sack: slot-capped inventory with stacking, plus the equip rules
// between sack and the two hand slots (player.weapon / player.ranged).
// Pure player-state logic — game.js owns pickups, drops, and messages.

const STACKABLE_KINDS = {
  potion:   { name: 'Potion',   emoji: '🧪', extra: { amount: 4 } },
  mushroom: { name: 'Mushroom', emoji: '🍄', extra: {} },
}

export function makeItem(kind) {
  const def = STACKABLE_KINDS[kind]
  return { kind, name: def.name, emoji: def.emoji, stackable: true, count: 1, ...def.extra }
}

// Chest/floating `contents` -> sack item. Unknown types return null.
export function itemFromContents(contents) {
  if (contents.type === 'weapon' || contents.type === 'ranged') {
    const { type, ...payload } = contents
    return { kind: type, name: contents.name, emoji: type === 'weapon' ? '⚔' : '🏹', stackable: false, payload }
  }
  if (contents.type === 'potion') return makeItem('potion')
  if (contents.type === 'mushroom') return makeItem('mushroom')
  return null
}

export function contentsFromItem(item) {
  if (item.kind === 'weapon') return { ...item.payload, type: 'weapon' }
  if (item.kind === 'ranged') return { ...item.payload, type: 'ranged' }
  if (item.kind === 'potion') return { type: 'potion', amount: item.amount }
  return { type: 'mushroom' }
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
  if (item.kind !== 'weapon' && item.kind !== 'ranged') return { ok: false, reason: 'not_equippable' }
  if (item.kind === 'ranged' && !(player.talents ?? []).includes('ranged_stance'))
    return { ok: false, reason: 'not_learned' }
  if (item.payload.heavy && !(player.talents ?? []).includes('heavy_weapons'))
    return { ok: false, reason: 'heavy' }
  return { ok: true }
}

// Equip the sack slot at `index` into its hand; a held item swaps back in.
export function equipItem(player, index) {
  const item = player.inventory[index]
  if (!item) return { ok: false, reason: 'not_equippable' }
  const gate = canEquip(player, item)
  if (!gate.ok) return gate
  const hand = item.kind === 'weapon' ? 'weapon' : 'ranged'
  const held = player[hand]
  player[hand] = { ...item.payload }
  player.inventory.splice(index, 1)
  if (held) {
    const kind = hand
    player.inventory.push({ kind, name: held.name, emoji: kind === 'weapon' ? '⚔' : '🏹',
      stackable: false, payload: { ...held } })
  }
  return { ok: true, equipped: item }
}

// Walk-onto pickup policy: empty allowed hand -> equip; otherwise -> sack.
export function autoEquipOnPickup(player, item) {
  const hand = item.kind === 'weapon' ? 'weapon' : item.kind === 'ranged' ? 'ranged' : null
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
