// The loot sack: slot-capped inventory with stacking, plus the equip rules
// between the sack and the three hand slots (player.weapon / player.ranged /
// player.wand) and the shared ammo pool (player.ammo). Pure player-state
// logic — game.js owns pickups, drops, and messages.

import {
  AMMO_CAPS, emptyAmmo, RANGED_WEAPON_TYPES, WAND_TYPES, OUTFIT_TYPES, SHIELD_TYPES,
  makeRangedContents, makeWandContents, makeOutfitContents, makeShieldContents, defaultGear, isSmallBlade,
} from './entities.js'

const STACKABLE_KINDS = {
  potion:      { name: 'Potion',      emoji: '🧪', extra: { amount: 4 } },
  mushroom:    { name: 'Mushroom',    emoji: '🍄', extra: {} },
  meat:        { name: 'Meat',        emoji: '🍖', extra: { heal: 1 } },   // animal drop, raw
  cooked_meat: { name: 'Cooked Meat', emoji: '🍗', extra: { heal: 4 } },   // raw meat cooked on a campfire
  lumber:      { name: 'Lumber',      emoji: '🪵', extra: {} },            // felled tree (systems/lumber.js)
  deadwood:    { name: 'Grey Wood',   emoji: '🪵', extra: {} },  // dead-tree wood (systems/lumber.js); the hermit's fuel
  // Leap-episode quest items: never consumable, no default panel action
  // (Drop stays available — see ui/inventory-panel-model.js sackActions).
  clapper:     { name: 'Bell Clapper', emoji: '🔔', extra: { quest: true } },
  fleece:      { name: "Lamb's Fleece", emoji: '🐑', extra: { quest: true } },
  // Adventure quest items: same carry-only rule as the leap ones.
  elk_hide:    { name: 'Elk Hide',    emoji: '🦌', extra: { quest: true } },
  tar:         { name: 'Pine Tar',    emoji: '🛢', extra: { quest: true } },
}

export function makeItem(kind, count = 1) {
  const def = STACKABLE_KINDS[kind]
  return { kind, name: def.name, emoji: def.emoji, stackable: true, count, ...def.extra }
}

const HAND_EMOJI = { weapon: '⚔', ranged: '🏹', wand: '🪄', outfit: '🧥', shield: '🛡' }

// Chest/floating `contents` -> sack item. Ammo is never a sack item — it
// goes straight into the pool (see autoEquipOnPickup) — so this returns the
// bare { kind: 'ammo', ammoKind, count } shape rather than a stackable slot.
// Unknown types return null.
//
// Ranged and wand payloads are re-derived from their tables rather than
// copied, exactly as game.js re-derives melee payloads on load. Every pickup
// passes through here, so a pre-redesign floating item persisted in an old
// caveInstances entry (a bow carrying its own `ammo`/`maxAmmo` and no
// `ammoKind`) is normalised at this one place instead of reaching tryFire as
// player.ammo[undefined]. Two consequences, both deliberate:
//   - an unknown weaponType yields null (the pickup is dropped) rather than
//     silently becoming a Shortbow the player never found. Callers must
//     tolerate null — they already had to, for unknown `type`s.
//   - a legacy `contents.ammo` count is discarded here; the pool is topped up
//     once, by the table's `bundle`, in autoEquipOnPickup. Crediting both
//     would pay a stale magazine out twice.
//
// The one field that is *not* re-derived is a ranged contents' `bundle`: the
// quiver top-up rides on the contents so it can be spent. Chest loot and
// legacy contents carry no `bundle` field and so get the table's, once; a bow
// the player dropped carries an explicit `bundle: 0` (see contentsFromItem)
// and re-credits nothing, or drop-and-repickup would be a free arrow mine.
const REBUILD = {
  ranged: [RANGED_WEAPON_TYPES, makeRangedContents],
  wand:   [WAND_TYPES, makeWandContents],
  outfit: [OUTFIT_TYPES, makeOutfitContents],
  shield: [SHIELD_TYPES, makeShieldContents],
}

export function itemFromContents(contents) {
  const rebuild = REBUILD[contents.type]
  if (rebuild) {
    const [table, make] = rebuild
    const key = contents.type === 'outfit' ? contents.outfitType : contents.weaponType
    if (!table[key]) return null
    const { type, ...payload } = make(key)
    if (type === 'ranged' && Number.isFinite(contents.bundle)) payload.bundle = contents.bundle
    return { kind: type, name: payload.name, emoji: HAND_EMOJI[type], stackable: false, payload }
  }
  if (contents.type === 'weapon') {
    const { type, ...payload } = contents
    return { kind: type, name: contents.name, emoji: HAND_EMOJI[type], stackable: false, payload }
  }
  if (contents.type === 'ammo') return { kind: 'ammo', ammoKind: contents.ammoKind, count: contents.count ?? 1 }
  if (STACKABLE_KINDS[contents.type]) return makeItem(contents.type, contents.count ?? 1)
  return null
}

export function contentsFromItem(item) {
  // A dropped bow's arrows are already in the quiver, so what hits the floor
  // is an empty weapon: bundle 0 travels with the contents and survives the
  // rebuild in itemFromContents.
  if (item.kind === 'ranged') return { ...item.payload, type: 'ranged', bundle: 0 }
  if (item.kind === 'weapon' || item.kind === 'wand' || item.kind === 'outfit' || item.kind === 'shield')
    return { ...item.payload, type: item.kind }
  if (item.kind === 'potion') return { type: 'potion', amount: item.amount }
  return { type: item.kind, count: item.count ?? 1 }
}

// ── Loadouts ────────────────────────────────────────────────────────────────
// The stance name is the loadout key. Main hands stay on the player object;
// gear[stance] holds the offhand and the outfit (entities.js defaultGear).
export const STANCES = ['melee', 'ranged', 'magic']
export const MAIN_OF = { melee: 'weapon', ranged: 'ranged', magic: 'wand' }
export const LOADOUT_NAMES = { melee: 'Warrior', ranged: 'Archer', magic: 'Mage' }
// What an offhand may point at (Q uses one). Quest items and wood are not.
export const CONSUMABLE_KINDS = ['potion', 'mushroom', 'meat', 'cooked_meat']

export function gearOf(player, stance) {
  player.gear ??= defaultGear()
  return player.gear[stance]
}
export function loadout(player, stance = player.attackMode ?? 'melee') {
  const g = gearOf(player, stance)
  return { main: player[MAIN_OF[stance]] ?? null, off: g.off, outfit: g.outfit }
}
export const offhand = player => gearOf(player, player.attackMode ?? 'melee').off
export const outfitOf = (player, stance) => gearOf(player, stance).outfit

// Warrior is innate; Archer and Mage exist while their own outfit is worn.
export function loadoutAvailable(player, stance) {
  if (stance === 'melee') return true
  return outfitOf(player, stance)?.loadout === stance
}
// Heavy weapons (and, in plan 2, the heavy shield) need the plate on the Warrior.
export const canWieldHeavy = player => outfitOf(player, 'melee')?.heavy === true

// The active offhand with a consumable pointer resolved against the sack:
// { kind:'consumable', item, count, index, slot }. Non-pointer contents
// (plan 2) come back as they are; an empty offhand is null.
export function resolveOffhand(player) {
  const off = offhand(player)
  if (!off) return null
  if (off.kind !== 'consumable') return off
  const index = (player.inventory ?? []).findIndex(i => i.kind === off.item)
  const slot = index === -1 ? null : player.inventory[index]
  return { kind: 'consumable', item: off.item, count: slot?.count ?? 0, index, slot }
}

export function outfitItem(payload) {
  return { kind: 'outfit', name: payload.name, emoji: HAND_EMOJI.outfit, stackable: false, payload: { ...payload } }
}

// An item offhand ({ kind:'weapon'|'wand'|'shield', ...payload }) back into a
// sack item; a consumable pointer or an empty offhand is not an item.
export function offhandItem(off) {
  if (!off || off.kind === 'consumable') return null
  const { kind, ...payload } = off
  return { kind, name: payload.name, emoji: HAND_EMOJI[kind], stackable: false, payload }
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

// ── Equip rules ─────────────────────────────────────────────────────────────
// `slot` is where the item is going: 'main' (the loadout's hand), 'off',
// 'outfit' or 'belt' (plan 3). Talents no longer gate anything here — the
// worn outfits do (loadoutAvailable / canWieldHeavy).
export function canEquip(player, item, slot = 'main') {
  if (!item) return { ok: false, reason: 'not_equippable' }
  if (slot === 'outfit') return item.kind === 'outfit' ? { ok: true } : { ok: false, reason: 'not_equippable' }
  if (slot === 'off') return canEquipOffhand(player, item)
  if (slot === 'belt') return canEquipBelt(player, item)
  if (item.kind === 'wand')
    return loadoutAvailable(player, 'magic') ? { ok: true } : { ok: false, reason: 'not_learned' }
  if (item.kind !== 'weapon' && item.kind !== 'ranged') return { ok: false, reason: 'not_equippable' }
  if (item.kind === 'ranged' && !loadoutAvailable(player, 'ranged'))
    return { ok: false, reason: 'not_learned' }
  if (item.payload.heavy && !canWieldHeavy(player))
    return { ok: false, reason: 'heavy' }
  return { ok: true }
}

// Which item kinds each loadout's offhand takes beside a consumable pointer.
// The Archer's bows are two-handed, so only a belt potion rides with them.
export const OFFHAND_KINDS = { melee: ['weapon', 'shield'], ranged: [], magic: ['wand', 'weapon', 'shield'] }

export function canEquipOffhand(player, item, stance = player.attackMode ?? 'melee') {
  if (!item) return { ok: false, reason: 'not_equippable' }
  if (CONSUMABLE_KINDS.includes(item.kind)) return { ok: true }
  if (!(OFFHAND_KINDS[stance] ?? []).includes(item.kind)) return { ok: false, reason: 'not_equippable' }
  // Every non-consumable kind is judged by its payload (small blade? heavy?),
  // so a malformed item with none is refused here rather than thrown on. A
  // bare `item.payload?.` would be worse than the crash for a shield: with no
  // payload to fail either test it would sail through as equippable.
  if (!item.payload) return { ok: false, reason: 'not_equippable' }
  if (!loadoutAvailable(player, stance)) return { ok: false, reason: 'not_learned' }
  if (item.kind === 'weapon' && !isSmallBlade(item.payload.weaponType)) return { ok: false, reason: 'two_handed' }
  if (item.payload.heavy && !canWieldHeavy(player)) return { ok: false, reason: 'heavy' }
  // A heavy main hand needs both hands: only a consumable rides with it.
  if (player[MAIN_OF[stance]]?.heavy) return { ok: false, reason: 'two_handed' }
  return { ok: true }
}

const HAND_OF_KIND = { weapon: 'weapon', ranged: 'ranged', wand: 'wand' }

const handItem = (hand, payload) =>
  ({ kind: hand, name: payload.name, emoji: HAND_EMOJI[hand], stackable: false, payload: { ...payload } })

const roomFor = (player, n) => player.inventory.length + n <= player.maxInventory

// ── The belt ──────────────────────────────────────────────────────────────
// One shared tool the swing borrows chop/mine from (lumber.js resolveTool).
// Only a melee weapon that can chop or mine fits; the belt never fights and
// is never drawn in a hand. The heavy axe still needs the plate.
export const isTool = payload => !!(payload?.chop || payload?.mine)

export function canEquipBelt(player, item) {
  if (item?.kind !== 'weapon' || !isTool(item.payload)) return { ok: false, reason: 'not_equippable' }
  if (item.payload.heavy && !canWieldHeavy(player)) return { ok: false, reason: 'heavy' }
  return { ok: true }
}

export const beltItem = payload => handItem('weapon', payload)

// Sack slot `index` → belt; a held tool swaps back into the sack (net 0).
export function equipBelt(player, index) {
  const item = player.inventory[index]
  const gate = canEquipBelt(player, item)
  if (!gate.ok) return gate
  const held = player.belt
  player.belt = { ...item.payload }
  player.inventory.splice(index, 1)
  if (held) player.inventory.push(beltItem(held))
  return { ok: true, equipped: item }
}

export function unequipBelt(player) {
  if (!player.belt) return { ok: false, reason: 'not_equippable' }
  if (!roomFor(player, 1)) return { ok: false, reason: 'full' }
  player.inventory.push(beltItem(player.belt))
  player.belt = null
  return { ok: true }
}

// A heavy blade needs both hands, so an item in the Warrior's offhand goes
// back to the sack before the blade lands (a consumable pointer stays — it is
// only a pointer). Both ways into the weapon hand run through here: the panel
// (equipItem) and walking onto one (autoEquipOnPickup).
//
// `net` is the caller's own sack accounting for the swap, before this
// eviction: from the panel the incoming item leaves the sack (−1) and a held
// weapon returns (+1); a walk-onto pickup was never in the sack and lands in
// an empty hand, so it is 0. The evicted offhand adds its own +1 on top.
//
// Returns null when there is nothing to evict, `{ full: true }` when the sack
// has no slot for it (nothing is moved — the caller refuses), or
// `{ item }` with the offhand already cleared and the item left for the
// caller to push, so it lands in the sack after whatever the swap returns.
function evictOffhandForHeavy(player, payload, net = 0) {
  if (!payload?.heavy) return null
  const g = gearOf(player, 'melee')
  const item = offhandItem(g.off)
  if (!item) return null
  if (!roomFor(player, net + 1)) return { full: true }
  g.off = null
  return { item }
}

// Equip the sack slot at `index` into its main hand; a held item swaps back in.
export function equipItem(player, index) {
  const item = player.inventory[index]
  if (!item) return { ok: false, reason: 'not_equippable' }
  const gate = canEquip(player, item)
  if (!gate.ok) return gate
  const hand = HAND_OF_KIND[item.kind]
  const held = player[hand]
  const evict = hand === 'weapon' ? evictOffhandForHeavy(player, item.payload, (held ? 1 : 0) - 1) : null
  if (evict?.full) return { ok: false, reason: 'two_handed' }
  player[hand] = { ...item.payload }
  player.inventory.splice(index, 1)
  if (held) player.inventory.push(handItem(hand, held))
  if (evict) player.inventory.push(evict.item)
  return { ok: true, equipped: item }
}

// Hand → sack. A locked loadout's hand is always empty — closing a loadout
// evicts its main hand (see handsToEvict) — so this only ever runs on a hand
// the player can still reach from the panel.
export function unequipMain(player, stance) {
  const hand = MAIN_OF[stance]
  const held = player[hand]
  if (!held) return { ok: false, reason: 'not_equippable' }
  if (!roomFor(player, 1)) return { ok: false, reason: 'full' }
  player.inventory.push(handItem(hand, held))
  player[hand] = null
  return { ok: true }
}

// Which main hands an outfit change leaves nowhere to live, so that whatever
// removes the outfit (swap or unequip) finds them a sack slot first. Two
// cases: the Warrior's heavy weapon rides on the plate, and the Archer's and
// Mage's hands ride on the loadout itself — take the coat off and the bow has
// no open loadout to be held in, and the panel offers no way to reach it.
// Returns hand names (MAIN_OF values), in eviction order.
function handsToEvict(player, stance, nextOutfit) {
  const hand = MAIN_OF[stance]
  if (!player[hand]) return []
  if (stance === 'melee') return player[hand].heavy && !nextOutfit?.heavy ? [hand] : []
  return nextOutfit?.loadout === stance ? [] : [hand]
}

// The heavy shield rides on the plate too: an outfit change that drops the
// heavy grant sends it to the sack with the heavy blade. canWieldHeavy reads
// only the Warrior's outfit, so the grant it loses is every loadout's — a kite
// shield in the Mage's offhand is evicted alongside the Warrior's own.
// Returns [{ stance, item }], in eviction order.
function offsToEvict(player, stance, nextOutfit) {
  if (stance !== 'melee' || nextOutfit?.heavy) return []
  return STANCES
    .map(s => ({ stance: s, item: offhandItem(gearOf(player, s).off) }))
    .filter(e => e.item?.payload.heavy)
}

// The axe on the belt rides on the plate like the heavy hand and the kite
// shields: losing the heavy grant sends it to the sack.
function beltToEvict(player, stance, nextOutfit) {
  if (stance !== 'melee' || !player.belt?.heavy || nextOutfit?.heavy) return null
  return beltItem(player.belt)
}

// Move the evicted offhands into the sack; like evictHands, the caller has
// already counted them in its own roomFor arithmetic.
function evictOffs(player, offs) {
  for (const { stance, item } of offs) {
    player.inventory.push(item)
    gearOf(player, stance).off = null
  }
}

// Move the evicted hands into the sack. Callers must have counted them in
// their own roomFor arithmetic — by here the slots are guaranteed.
function evictHands(player, hands) {
  for (const hand of hands) {
    player.inventory.push(handItem(hand, player[hand]))
    player[hand] = null
  }
}

// A closed loadout cannot stay active: fall back to the Warrior and drop any
// charge that belonged to the stance being closed.
function closeIfLocked(player, stance) {
  if (loadoutAvailable(player, stance)) return
  // A switch *into* the loadout that just closed is abandoned where it stands:
  // tickStanceSwitch flips attackMode with no availability re-check, so a
  // switch left running would land the player in a loadout they cannot use.
  if (player.stanceSwitch?.to === stance) player.stanceSwitch = null
  if (player.attackMode !== stance) return
  player.attackMode = 'melee'
  player.charging = null
  player.stanceSwitch = null
}

// Wear the sack outfit at `index` in `stance` (default: the outfit's own
// loadout, else the active one). A worn outfit swaps back into the sack.
export function equipOutfit(player, index, stance) {
  const item = player.inventory[index]
  if (!item || item.kind !== 'outfit') return { ok: false, reason: 'not_equippable' }
  stance ??= item.payload.loadout ?? player.attackMode ?? 'melee'
  if (item.payload.loadout && item.payload.loadout !== stance) return { ok: false, reason: 'wrong_loadout' }
  const g = gearOf(player, stance)
  const evict = handsToEvict(player, stance, item.payload)
  const offEvict = offsToEvict(player, stance, item.payload)
  const beltEvict = beltToEvict(player, stance, item.payload)
  // The new outfit frees one slot; the old outfit, each evicted hand, each
  // evicted offhand and an evicted belt tool take one.
  if (!roomFor(player, (g.outfit ? 1 : 0) + evict.length + offEvict.length + (beltEvict ? 1 : 0) - 1))
    return { ok: false, reason: 'full' }
  player.inventory.splice(index, 1)
  if (g.outfit) player.inventory.push(outfitItem(g.outfit))
  evictHands(player, evict)
  evictOffs(player, offEvict)
  if (beltEvict) { player.inventory.push(beltEvict); player.belt = null }
  g.outfit = { ...item.payload }
  closeIfLocked(player, stance)
  return { ok: true, equipped: item }
}

export function unequipOutfit(player, stance) {
  const g = gearOf(player, stance)
  if (!g.outfit) return { ok: false, reason: 'not_equippable' }
  const evict = handsToEvict(player, stance, null)
  const offEvict = offsToEvict(player, stance, null)
  const beltEvict = beltToEvict(player, stance, null)
  if (!roomFor(player, 1 + evict.length + offEvict.length + (beltEvict ? 1 : 0))) return { ok: false, reason: 'full' }
  player.inventory.push(outfitItem(g.outfit))
  evictHands(player, evict)
  evictOffs(player, offEvict)
  if (beltEvict) { player.inventory.push(beltEvict); player.belt = null }
  g.outfit = null
  closeIfLocked(player, stance)
  return { ok: true }
}

// Put the sack item at `index` in `stance`'s offhand. A consumable becomes a
// pointer (the stack stays in the sack; every loadout may point at the same
// one). Anything else moves out of the sack, and a held item swaps back in.
export function equipOffhand(player, index, stance = player.attackMode ?? 'melee') {
  const item = player.inventory[index]
  const gate = canEquipOffhand(player, item, stance)
  if (!gate.ok) return gate
  const g = gearOf(player, stance)
  const held = offhandItem(g.off)
  if (CONSUMABLE_KINDS.includes(item.kind)) {
    // Pointing at a consumable while holding an item: the sack already holds
    // the consumable stack, so the returning item is a net +1.
    if (held && !roomFor(player, 1)) return { ok: false, reason: 'full' }
    if (held) player.inventory.push(held)   // the item leaves; the sack gains one, never more
    g.off = { kind: 'consumable', item: item.kind }
    return { ok: true, equipped: item }
  }
  player.inventory.splice(index, 1)
  if (held) player.inventory.push(held)
  g.off = { kind: item.kind, ...item.payload }
  return { ok: true, equipped: item }
}

export function unequipOffhand(player, stance = player.attackMode ?? 'melee') {
  const g = gearOf(player, stance)
  const held = offhandItem(g.off)
  if (held) {
    if (!roomFor(player, 1)) return { ok: false, reason: 'full' }
    player.inventory.push(held)
  }
  g.off = null
  return { ok: true }
}

// The quiver/pouch pool (player.ammo, see entities.js AMMO_KINDS/AMMO_CAPS).
// Lazily created so a plain `{}` player object still works — callers never
// need to seed player.ammo themselves.
export function addAmmo(player, ammoKind, count) {
  if (!player.ammo) player.ammo = emptyAmmo()
  // An unknown (or missing) kind adds nothing rather than writing
  // `undefined: NaN` into the pool — Math.min(undefined, n) is NaN, and a NaN
  // slot would poison every later add and read for that kind.
  const cap = AMMO_CAPS[ammoKind]
  if (cap === undefined) return 0
  const before = player.ammo[ammoKind] ?? 0
  const after = Math.min(cap, before + count)
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
// - a ranged pickup's bundle tops the pool up first (0 for a bow the player
//   dropped, so nothing is credited and game.js floats nothing); a carried twin
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
    const added = addAmmo(player, ammoKind, item.payload.bundle ?? 0)
    const wt = item.payload.weaponType
    if (player.ranged?.weaponType === wt)
      return { ok: true, equipped: false, merged: 'hand', ammo: added, ammoKind }
    if (player.inventory.some(i => i.kind === 'ranged' && i.payload.weaponType === wt))
      return { ok: true, equipped: false, merged: 'sack', ammo: added, ammoKind }
    // The bundle rides on every successful ranged outcome, merged or not, so
    // game.js can float "+n" for a first bow just as it does for a duplicate.
    if (!player.ranged && canEquip(player, item).ok) {
      player.ranged = { ...item.payload }
      return { ok: true, equipped: true, ammo: added, ammoKind }
    }
    const r = addItem(player, item)
    return r.ok ? { ok: true, equipped: false, ammo: added, ammoKind } : r
  }
  if (item.kind === 'outfit') {
    const ot = item.payload.outfitType
    const owned = STANCES.some(s => gearOf(player, s).outfit?.outfitType === ot)
      || player.inventory.some(i => i.kind === 'outfit' && i.payload.outfitType === ot)
    if (owned) return { ok: true, equipped: false, merged: 'outfit' }
    const stance = item.payload.loadout ?? player.attackMode ?? 'melee'
    if (!gearOf(player, stance).outfit) {
      gearOf(player, stance).outfit = { ...item.payload }
      return { ok: true, equipped: true, outfit: true }
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
    // A walked-onto heavy blade frees the offhand exactly as the panel does.
    // With no sack slot for what the offhand held, nothing moves and the blade
    // goes to the sack like any other pickup — the alternative would be a
    // raised shield beside a two-handed weapon.
    const evict = evictOffhandForHeavy(player, item.payload)
    if (!evict?.full) {
      player[hand] = { ...item.payload }
      if (evict) player.inventory.push(evict.item)
      return { ok: true, equipped: true }
    }
  }
  const r = addItem(player, item)
  return r.ok ? { ok: true, equipped: false } : r
}

export const EQUIP_FAIL_MESSAGES = {
  heavy: 'Too heavy — I lack the strength.',
  not_equippable: "I can't wield that.",
  not_learned: "I don't know how to use this.",
  two_handed: 'I need both hands for that.',
  wrong_loadout: "That's not my garb.",
  full: 'My pack is full.',
}
