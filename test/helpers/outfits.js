// Builds a player.gear with the named outfits worn in their own loadouts.
// Consumable pointers stay at their default (potion) so the offhand HUD and
// Q behave exactly as a fresh player's do.
import { defaultGear, makeOutfitContents, OUTFIT_TYPES } from '../../renderer/systems/entities.js'

export function gearWearing(...outfitTypes) {
  const gear = defaultGear()
  for (const ot of outfitTypes) {
    const { type, ...payload } = makeOutfitContents(ot)
    gear[OUTFIT_TYPES[ot].loadout ?? 'melee'].outfit = payload
  }
  return gear
}

// An outfit bound to no loadout, for the generic swap rules. No such outfit
// is in the table any more (the Leather Coat became armor), so it is built
// by hand: equipOutfit and wearOutfit judge an outfit by its payload alone.
export const plainOutfitPayload = () => ({ outfitType: 'plain', name: 'Plain Coat', loadout: null })
export const plainOutfitItem = () => ({ kind: 'outfit', name: 'Plain Coat', emoji: '🧥', stackable: false, payload: plainOutfitPayload() })
