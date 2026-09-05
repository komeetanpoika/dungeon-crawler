// 8-bit item icons for DOM surfaces (HUD consumable slot, backpack panel).
// Reuses the game's own sprite atlas: an icon is just the sprite's PNG,
// upscaled crisply by CSS image-rendering: pixelated — the pack shows the
// same art the world does.
import { SPRITES } from './sprites.js'

const KIND_ICONS = { potion: 'potion', mushroom: 'ow_mushroom', meat: 'item_meat',
  cooked_meat: 'item_meat_cooked', lumber: 'item_lumber', deadwood: 'item_deadwood',
  clapper: 'item_clapper', fleece: 'item_fleece' }

// The quiver/pouch shows one icon per ammo kind, not per bow.
const AMMO_ICONS = { arrow: 'item_arrows', bolt: 'item_bolts', stone: 'item_stones' }

const WEAPON_FALLBACK = { weapon: 'weapon_sword', ranged: 'weapon_shortbow', wand: 'weapon_sparkwand' }

export function iconSpriteFor(item) {
  if (!item) return null
  if (KIND_ICONS[item.kind]) return KIND_ICONS[item.kind]
  if (item.kind === 'ammo') return AMMO_ICONS[item.ammoKind] ?? null
  if (item.kind === 'weapon' || item.kind === 'ranged' || item.kind === 'wand') {
    const key = `weapon_${item.payload?.weaponType}`
    if (SPRITES[key]) return key
    return WEAPON_FALLBACK[item.kind]
  }
  return null
}

export function iconSrcFor(item) {
  const key = iconSpriteFor(item)
  return key ? `./assets/tiles/${SPRITES[key] ?? key}.png` : null
}
