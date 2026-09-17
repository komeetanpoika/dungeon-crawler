// Outfits: where the three story outfits come from, who owns what, and the
// one-time save migration from the stance talents they replaced. Pure —
// game.js spawns the floating items and calls grantContents.
import { makeOutfitContents, OUTFIT_TYPES, defaultGear, emptyAmmo } from './entities.js'
import { gearOf, STANCES } from './inventory.js'
import { queueToast } from './feedback.js'
import { sfx } from './sfx.js'

// The stance talents of the 2026-08-22 design, now items. Ski-legs stays a talent.
export const RETIRED_TALENT_OUTFITS = { ranged_stance: 'ranger', magic_stance: 'robe', heavy_weapons: 'plate' }
// A dungeon cleared on this map drops the outfit at the boss's feet (once — see ownsOutfit).
export const MAP_CLEAR_OUTFITS = { 'forest-1-clearings': 'ranger' }
// A boss of this type drops the outfit wherever it dies (Rush depth 3, the Mountain Pass cave).
export const BOSS_DROP_OUTFITS = { cyclops: 'plate' }
// Dungeon Rush wears everything from the first step.
export const RUSH_START_OUTFITS = ['ranger', 'robe', 'plate']

export const OUTFIT_TOAST_LINES = {
  ranger:  "Ranger's Coat — the Archer's way is open.",
  robe:    "Mage's Robe — the Mage's way is open.",
  plate:   'Plated Armor — heavy steel sits easy now.',
  leather: 'Leather Coat — a little between me and the teeth.',
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

export function outfitToast(state, payload) {
  queueToast(state, { title: 'Outfit found', lines: [OUTFIT_TOAST_LINES[payload.outfitType]].filter(Boolean) })
  sfx(state, 'talent-learned')
}
