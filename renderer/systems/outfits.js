// Outfits: where the three story outfits come from, who owns what, and the
// one-time save migration from the stance talents they replaced. Pure —
// game.js spawns the floating items and calls grantContents.
import { makeOutfitContents, makeWornContents, OUTFIT_TYPES, defaultGear, emptyAmmo } from './entities.js'
import { gearOf, wornItem, STANCES } from './inventory.js'
import { queueToast } from './feedback.js'
import { sfx } from './sfx.js'

// The stance talents of the 2026-08-22 design, now items. Ski-legs stays a talent.
export const RETIRED_TALENT_OUTFITS = { ranged_stance: 'ranger', magic_stance: 'robe', heavy_weapons: 'plate' }
// A dungeon cleared on this map drops the outfit at the boss's feet (once — see ownsOutfit).
// In the Wilds the first cave cleared anywhere is the one that drops it.
export const MAP_CLEAR_OUTFITS = { 'forest-1-clearings': 'ranger', wilds: 'ranger' }
// A boss of this type drops the outfit wherever it dies (Rush depth 3, the Mountain Pass cave).
export const BOSS_DROP_OUTFITS = { cyclops: 'plate' }
// Dungeon Rush wears everything from the first step.
export const RUSH_START_OUTFITS = ['ranger', 'robe', 'plate']
// ...and these pieces (applyLoadout's `worn` shape, entities.js WORN_TYPES
// keys): the cuirass the tabard's protection moved to, and the boots
// Ski-legs became, on each of the three since a Rush run has no time to shop.
export const RUSH_START_WORN = { melee: { armor: 'plate', boots: 'elk' }, ranged: { boots: 'elk' }, magic: { boots: 'elk' } }
// A boss of this type drops this worn piece beside its outfit, under the
// same once-only rule (the cyclops: the Plate Cuirass with the tabard).
export const BOSS_DROP_WORN = { cyclops: 'plate' }

export const OUTFIT_TOAST_LINES = {
  ranger:  "Ranger's Coat — the Archer's way is open.",
  robe:    "Mage's Robe — the Mage's way is open.",
  plate:   "Knight's Tabard — heavy steel sits easy now.",
}

export const outfitStance = (payload, fallback = 'melee') => payload.loadout ?? fallback

// Put an outfit straight on (no sack involved). False when the slot is taken
// or the outfit belongs to another loadout.
export function wearOutfit(player, payload, stance = outfitStance(payload, player.attackMode ?? 'melee')) {
  if (payload.loadout && payload.loadout !== stance) return false
  const g = gearOf(player, stance)
  if (g.outfit) return false
  g.outfit = { ...payload }
  return true
}

export function ownsOutfit(player, outfitType) {
  if (!player) return false
  if (STANCES.some(s => player.gear?.[s]?.outfit?.outfitType === outfitType)) return true
  return (player.inventory ?? []).some(i => i.kind === 'outfit' && i.payload?.outfitType === outfitType)
}

const emptyBody = () => ({ weapon: null, ranged: null, wand: null, ammo: emptyAmmo(), inventory: [], gear: defaultGear(), belt: null })

// Save migration (adventure.js v8, timewarp mini-saves, arena kits): every
// retired talent becomes its outfit, worn. Pure: returns new objects only
// when something changed, so an already-current save round-trips by identity.
export function migrateTalentsToOutfits(body, talents = []) {
  const retired = talents.filter(t => RETIRED_TALENT_OUTFITS[t])
  if (retired.length === 0) return { body, talents }
  const out = body ? { ...body, gear: structuredClone(body.gear ?? defaultGear()) } : emptyBody()
  for (const t of retired) {
    const { type, ...payload } = makeOutfitContents(RETIRED_TALENT_OUTFITS[t])
    const stance = OUTFIT_TYPES[payload.outfitType].loadout
    out.gear[stance].outfit ??= payload
  }
  return { body: out, talents: talents.filter(t => !RETIRED_TALENT_OUTFITS[t]) }
}

// Save migration (adventure.js v9): what an old save had as a talent or on
// an outfit and is a worn piece now. Ski-legs is one pair of Elk-hide Boots,
// and the plate the Warrior wore (the tabard since) has its Plate Cuirass
// under it. Both go on the Warrior, or into the bag when that slot of his is
// taken. Pure: the same objects come back when there was nothing to turn.
export function migrateToWorn(body, talents = []) {
  const skis = talents.includes('ski_legs')
  const plated = body?.gear?.melee?.outfit?.outfitType === 'plate'
  if (!skis && !plated) return { body, talents }
  const out = body
    ? { ...body, gear: structuredClone(body.gear ?? defaultGear()), inventory: [...(body.inventory ?? [])] }
    : emptyBody()
  const put = key => {
    const { type: slot, ...payload } = makeWornContents(key)
    if (!out.gear.melee[slot]) out.gear.melee[slot] = payload
    else out.inventory.push(wornItem(slot, payload))
  }
  if (skis) put('elk')
  if (plated) put('plate')
  return { body: out, talents: skis ? talents.filter(t => t !== 'ski_legs') : talents }
}

export function outfitToast(state, payload) {
  queueToast(state, { title: 'Outfit found', lines: [OUTFIT_TOAST_LINES[payload.outfitType]].filter(Boolean) })
  sfx(state, 'talent-learned')
}
