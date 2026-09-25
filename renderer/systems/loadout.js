// Apply a loadout override — an arena config's `player`, a timewarp
// episode's kit, or a PvP class kit (renderer/data/pvp.js), all the same
// shape. Lifted out of game.js so the PvP simulation can import it.
import { WEAPON_TYPES, RANGED_WEAPON_TYPES, WAND_TYPES, SHIELD_TYPES, OUTFIT_TYPES,
  weaponContents, makeRangedContents, makeWandContents, makeShieldContents, makeOutfitContents,
  emptyAmmo } from './entities.js'
import { gearOf } from './inventory.js'
import { wearOutfit, RETIRED_TALENT_OUTFITS } from './outfits.js'
import { TALENTS } from './talents.js'

// Apply a loadout override (arena config's `player`, or a timewarp episode's
// kit — same shape): weaponType/rangedType/wandType/ammo/hp/talents/outfits/
// offhand, each optional.
export function applyLoadout(player, po, warn = console.warn) {
  if (!po) return
  const def = WEAPON_TYPES[po.weaponType]
  if (def) player.weapon = weaponContents(po.weaponType)
  else if (po.weaponType !== undefined) warn(`loadout: unknown player weaponType "${po.weaponType}" — keeping current weapon`)
  const rdef = RANGED_WEAPON_TYPES[po.rangedType]
  if (rdef) player.ranged = makeRangedContents(po.rangedType)
  else if (po.rangedType !== undefined) warn(`loadout: unknown player rangedType "${po.rangedType}" — no ranged weapon`)
  const wdef = WAND_TYPES[po.wandType]
  if (wdef) player.wand = makeWandContents(po.wandType)
  else if (po.wandType !== undefined) warn(`loadout: unknown player wandType "${po.wandType}" — no wand`)
  // A kit's `ammo` tops up the pool it names; kinds it leaves out stay empty.
  if (po.ammo) player.ammo = { ...emptyAmmo(), ...player.ammo, ...po.ammo }
  if (Number.isFinite(po.hp) && po.hp >= 1) {
    player.maxHp = Math.max(player.maxHp, Math.round(po.hp))
    player.hp = Math.round(po.hp)
  }
  // A kit's `talents` may still name a retired stance talent — it means the
  // outfit now. `outfits` names outfits directly.
  const wear = ot => { const { type, ...payload } = makeOutfitContents(ot); if (OUTFIT_TYPES[ot]) wearOutfit(player, payload); else warn(`loadout: unknown outfit "${ot}" — skipped`) }
  if (Array.isArray(po.talents)) {
    for (const t of po.talents) {
      if (RETIRED_TALENT_OUTFITS[t]) wear(RETIRED_TALENT_OUTFITS[t])
      else if (TALENTS[t]) player.talents.push(t)
      else warn(`loadout: unknown talent "${t}" — skipped`)
    }
  }
  if (Array.isArray(po.outfits)) po.outfits.forEach(wear)
  // A kit's `offhand` ({ type, weaponType }) goes straight into the loadout
  // that takes it: blades and shields to the Warrior, wands to the Mage.
  if (po.offhand) {
    const { type, weaponType } = po.offhand
    const make = { weapon: wt => WEAPON_TYPES[wt] && weaponContents(wt), wand: wt => WAND_TYPES[wt] && handPayload(makeWandContents(wt)), shield: wt => SHIELD_TYPES[wt] && handPayload(makeShieldContents(wt)) }[type]
    const payload = make?.(weaponType)
    if (payload) gearOf(player, type === 'wand' ? 'magic' : 'melee').off = { kind: type, ...payload }
    else warn(`loadout: unknown offhand ${type}/${weaponType} — skipped`)
  }
}

// A hand slot holds a *Contents() object minus its `type` tag — that field
// only exists to tell a floating pickup's contents apart, and equipItem /
// autoEquipOnPickup strip it the same way.
export const handPayload = contents => { const { type, ...payload } = contents; return payload }
