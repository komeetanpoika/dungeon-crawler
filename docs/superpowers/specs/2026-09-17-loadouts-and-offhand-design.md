# Loadouts, Offhand, Outfits and Belt — Design

**Date:** 2026-09-17
**Status:** Approved design, pending implementation plans
**Supersedes:** the stance-talent parts of `2026-08-22-talents-and-inventory-design.md`
(Marksmanship, Gust of Wind, Might become outfits; Ski-legs and the talent
module stay). Builds on `2026-09-05-wands-and-bows-redesign.md` (pooled ammo,
stamina spells, the third hand).

## Summary

The three stances become three **loadouts** — Warrior, Archer, Mage — of one
body. Hp, stamina, the sack, the ammo pool and the remaining talents are
shared; each loadout owns a **main hand**, an **offhand** and an **outfit**,
and the body carries one shared **belt** tool. Shift still cycles the loadouts
and still decides which main hand fires.

Equipping any weapon, shield, outfit or tool takes it out of the sack, so a
dagger in the Warrior's offhand is not the Mage's dagger. Consumables are the
exception: an offhand can *point at* a sack stack, and every loadout may point
at the same stack at once.

The Archer and Mage loadouts are unlocked by **wearing their outfit**, found
as an item in the world that self-equips on pickup. Heavy weapons need the
**Plated Armor** the cyclops drops. The offhand gives the player sword and
shield, two daggers, two wands, or a potion at the ready — and takes the
quick-use key: Q (and the green touch button) now acts on whatever the active
offhand holds.

**Delivery order** (three plans off this one spec):
1. Loadouts and outfits — data model, the three outfits and their sources,
   loadout availability in the stance cycle, save migration, panel gear
   strip, HUD offhand slot showing consumables only.
2. Offhand behaviours — shield, offhand wand, alternating blades, the
   two-handed rule, HUD icons for each.
3. Belt, loot and polish — belt fallback in harvesting, shields and the
   Leather Coat in the loot ladder, sprite/icon coverage, panel refinements.

## 1. Data model

Main hands stay exactly where combat code reads them: `player.weapon`
(Warrior), `player.ranged` (Archer), `player.wand` (Mage). The stance name
is the loadout key, as `player.attackMode` already is:

```js
// makePlayer additions (systems/entities.js)
gear: {
  melee:  { off: null, outfit: null },
  ranged: { off: null, outfit: null },
  magic:  { off: null, outfit: null },
},
belt: null,
```

`gear[stance].off` holds one of:

- a weapon item payload `{ weaponType, name, damage, ... }` (the same shape as
  `player.weapon`), tagged by its origin kind: `{ kind: 'weapon' | 'wand' | 'shield', ...payload }`;
- a consumable pointer `{ kind: 'consumable', item: 'potion' }` — the sack
  stack of that kind is the truth; the pointer stores no count;
- `null`.

`gear[stance].outfit` is an outfit payload `{ kind: 'outfit', outfitType, name, loadout, protect, heavy? }` or `null`. `belt` is a melee weapon payload
with `chop` or `mine`, or `null`.

Why the main hand lives one level up from its offhand: about sixty readers
across melee, ranged, spells, lumber, the hammer, the HUD and the canvas read
the three hand fields, and none of them change behaviour under this design.
The wart is confined to one comment in `makePlayer` and to the accessors
below, which are the only way new code touches gear.

### Accessors (systems/inventory.js)

```js
export const MAIN_OF = { melee: 'weapon', ranged: 'ranged', magic: 'wand' }
export function loadout(player, stance = player.attackMode)   // { main, off, outfit }
export function offhand(player)                               // active loadout's off
export function outfitOf(player, stance)                      // gear[stance].outfit
export function loadoutAvailable(player, stance)              // §3
export function resolveOffhand(player)                        // §4 — a consumable pointer resolved to its sack slot (or null)
```

`player.gear` and `player.belt` are lazily created by the accessors, as
`player.ammo` is by `addAmmo`, so plain `{}` test players keep working.

## 2. Item kinds and tables

New rows in `systems/entities.js`, following `WAND_TYPES`:

```js
export const SHIELD_TYPES = {
  buckler: { name: 'Buckler',     blockCost: 8 },
  kite:    { name: 'Kite Shield', blockCost: 4, heavy: true },
}
export const OUTFIT_TYPES = {
  ranger:  { name: "Ranger's Coat", loadout: 'ranged', protect: 0 },
  robe:    { name: "Mage's Robe",   loadout: 'magic',  protect: 0 },
  plate:   { name: 'Plated Armor',  loadout: 'melee',  protect: 2, heavy: true, sprintDrain: 2 },
  leather: { name: 'Leather Coat',  loadout: null,     protect: 1 },
}
```

with `makeShieldContents(type)` and `makeOutfitContents(type)` mirroring
`makeWandContents`. `itemFromContents` / `contentsFromItem` learn
`type: 'shield'` and `type: 'outfit'` (rebuilt from their tables, like
wands). Sack items: `{ kind: 'shield' | 'outfit', name, emoji, stackable: false, payload }`.

`loadout: null` means any loadout may wear it; a named loadout means only
that one. `heavy: true` on the kite shield means it needs the same gate heavy
weapons do (§3).

Small blades are derived, not listed: a `WEAPON_TYPES` row with no `heavy`
and `damage <= 2` (`isSmallBlade(weaponType)`): dagger, hatchet, pick, sword.
The crossbow loses its `heavy` flag (plate belongs to the Warrior; the archer
can never wear it), keeping its `piercesShield` and knockback.

Every new weaponType gets a `SPRITES['weapon_<key>']` entry and an atlas
icon; `test/sprites.test.js` already fails without them.

## 3. Loadout availability and the gates

The three stance talents are retired. `TALENTS` keeps `ski_legs` (and future
non-gear abilities); `MAP_CLEAR_TALENTS` and the `talentReward` path are
removed with them.

> **As built:** `RUSH_START_TALENTS` is kept — it is "every talent, granted at
> a Rush spawn", and Ski-legs still needs it, so it shrank to that one entry
> rather than disappearing. Only `MAP_CLEAR_TALENTS` went.

```js
loadoutAvailable(player, 'melee')  === true
loadoutAvailable(player, 'ranged') === (outfitOf(player,'ranged')?.loadout === 'ranged')
loadoutAvailable(player, 'magic')  === (outfitOf(player,'magic')?.loadout  === 'magic')
```

`nextStance` in `systems/ranged.js` consults `loadoutAvailable` instead of
`STANCE_TALENT`. Every `hasTalent(player, 'magic_stance')` /
`'ranged_stance'` check (spells, magic, ranged, the HUD, the canvas)
becomes the corresponding `loadoutAvailable` call. Wearing the coat again
after taking it off re-opens the loadout; nothing else is remembered.

Heavy gate: `canWieldHeavy(player) === outfitOf(player, 'melee')?.heavy === true`
(plate). It replaces `hasTalent(player, 'heavy_weapons')` in `canEquip`.
A heavy item is refused with the existing *"Too heavy — I lack the
strength."*; unequipping the plate while a heavy weapon is held moves the
weapon to the sack first, refusing the unequip if the sack is full
(*"My pack is full."*).

`canEquip(player, item, slot)` grows a `slot` argument (`'main' | 'off' | 'outfit' | 'belt'`) and returns the same `{ ok, reason }` shape. Refusal
reasons: `not_equippable`, `not_learned` (the loadout is locked), `heavy`,
`two_handed` (§4), `wrong_loadout` (an outfit for another loadout), `full`.

### Sources

| Outfit | Adventure | Dungeon Rush | Timewarp |
|---|---|---|---|
| Ranger's Coat | On the floor where the first Clearings dungeon boss falls (the old `MAP_CLEAR_TALENTS` slot) | worn at spawn | per episode kit |
| Mage's Robe | The mushroom rite's ceremony ends with the robe at the ring centre; the player is standing on it, so it self-equips as the ceremony clears | worn at spawn | per episode kit |
| Plated Armor | Dropped by the cyclops when it dies (Mountain Pass dungeon in Adventure) | worn at spawn (also the depth-3 cyclops drops one, absorbed as a duplicate) | per episode kit |
| Leather Coat | chest loot, tier 2+ (§6) | chest loot | chest loot |

An outfit **self-equips on pickup** into its loadout's outfit slot when that
slot is empty (`autoEquipOnPickup`), with a toast in the talent-learned
style: *"Ranger's Coat — the Archer's way is open."* Otherwise it goes to the
sack. The rite anchor's "already learned" fizzle (`rites.js` `pullTarget`)
becomes "the robe already exists anywhere on the body or in the sack".

A `talent_trigger` entity's `talent` field becomes `outfit` in
`data/rites.js`. There is no editor dropdown for rites — triggers are
spawned from `data/rites.js` POIs, not placed in the tile editor — so this
is a data field rename only.

## 4. The offhand

### Legality

| Loadout | Offhand accepts |
|---|---|
| Warrior | small blade, shield, consumable |
| Archer | consumable only (every bow and the sling is two-handed) |
| Mage | wand, small blade, shield, consumable |

A heavy main hand (longsword, axe, Ukonvasara) narrows the offhand to
consumables. Equipping a heavy main hand while a blade, shield or wand sits
in the offhand moves it to the sack, refusing the equip with `two_handed` if
the sack is full. Equipping a two-handed item into the offhand is refused
with `two_handed`.

Consumable pointers are allowed everywhere. `CONSUMABLE_KINDS` (potion,
mushroom, meat, cooked meat) is the pointable set; quest items and lumber
are not.

### The offhand key

Q and the green touch button become **use offhand**. `findQuickUseIndex` and
`quickUseSummary` are removed; the HUD badge data (`data-quick-emoji`) the
touch button mirrors is published from the resolved offhand instead. With an
empty offhand Q says *"Nothing in my off hand."* (throttled think).

- **Consumable** — Q uses one from the pointed stack via the existing
  `useInventoryItem`. When the stack is gone the pointer stays and reads
  empty (dimmed icon, no count); picking the kind up again fills it.
  Any loadout may point at any kind at the same time.
- **Shield** — hold Q to raise (`player.blocking = true` while held and
  stamina > 0). Raised: walk speed × 0.5, melee swings and casts refused,
  sprint off. `damagePlayer` gains a `from` (world position or entity)
  argument; a hit whose source lies within 60° either side of the facing
  direction is absorbed: no damage, `spendStamina(blockCost)`,
  `sfx('shield-block')`. Sources with no position (zones, poison, falls)
  are never blocked. At zero stamina the shield lowers for `SHIELD_DROP`
  (0.8 s) as the sprint does, with the stamina bar's refused flash.
  Melee enemies whose hit is blocked take a `knockback` shove of 12 px.
- **Wand** — Q taps `tryCast` with the offhand wand's spell. Stamina is
  shared; the cooldown is per wand (`player.offCooldown`). No hold-to-charge
  on the offhand: a tap cast only. Only the Mage can hold one, since only the
  Mage's offhand accepts wands.
- **Small blade** — no key. Melee swings alternate hands: `player.nextHand`
  flips on every completed swing while an offhand blade is present. The
  offhand swing uses that blade's `ATTACK_STYLES` row and damage with
  `cooldown × 0.75`, and `chop`/`mine` come from whichever blade swings.
  `drawHeldWeapon` draws the swinging hand's weapon; idle, both are drawn
  (offhand mirrored on the other side at the same grip scale). Charge weapons
  are never small, so the charge path never alternates.

> **As built:** an arena config's `player` block and a Timewarp episode kit
> both accept `offhand: { type: 'weapon' | 'wand' | 'shield', weaponType }`
> beside `weaponType` / `rangedType` / `wandType` / `talents` / `outfits`.
> `applyLoadout` in `game.js` builds the payload from the matching table
> (`WEAPON_TYPES` / `WAND_TYPES` / `SHIELD_TYPES`) and drops it into the
> loadout that takes it — a blade or shield into the Warrior's gear, a wand
> into the Mage's — warning and skipping an unknown `type`/`weaponType`
> pair. It is the only way to spawn already holding an offhand, and it is
> what the level-0 arena check drove (arena journal run 25).

### HUD

`#hud-consumable` is renamed `#hud-offhand` and shows the active loadout's
resolved offhand: consumable icon with `×count` (as today), shield / wand /
blade icon with no count; dimmed when a consumable stack is empty, when a
shield cannot be raised for stamina, or when a wand's tap cost exceeds
stamina. Empty offhand: the dimmed potion silhouette as today. Loadout
switches swap the slot with the existing stance-switch timing.

## 5. Outfits and the belt in play

- `damagePlayer` subtracts the active loadout's `outfit.protect`, floored at
  0, before hp. Order: block check → protect → hp.

  > **As built:** `protect` comes off `'hit'` damage **only**.
  > `damagePlayer(state, amount, kind, from)` lets `'dot'` (bleed, the
  > hammer's shock) and `'lightning'` through untouched, exactly as those
  > kinds already skip i-frames and the block check — armour that soaked a
  > poison tick or the player's own thunderclap would leave those sources
  > with nothing to say. Full order for a `'hit'`: i-frames → block →
  > protect → hp.
- `sprintProfile` multiplies drain by `outfit.sprintDrain ?? 1` (plate: 2),
  composed with Ski-legs.
- Belt: `findHarvestHit(map, player, hitAt, reach, weapon)` receives the
  swinging weapon as today; when it lacks the needed tool value,
  `player.belt?.[tool]` is used instead. `harvest`/`chopTree` take the
  resolved value. The belt tool never fights and never appears in
  `drawHeldWeapon`.
- Belt equip: `canEquip(player, item, 'belt')` accepts a melee weapon with
  `chop` or `mine`; the heavy axe still needs plate.

## 6. Loot

`loot.js` gains `SHIELD_POOLS = { 1: ['buckler'], 2: ['buckler'], 3: ['buckler','kite'], 4: ['kite'] }` and an outfit rung `{ 2: ['leather'], 3: ['leather'], 4: ['leather'] }`. Category weights: shields share the melee
category's weight (a shield rolls in one of five melee picks); the Leather
Coat is its own low-weight category (about a twentieth of a chest). Story
outfits (ranger, robe, plate) are never chest loot. The talent teaser rule
(a fifth of the weight, humblest example) now keys on `loadoutAvailable` /
`canWieldHeavy` instead of talents. `tools/verify-loot.mjs` unchanged.

## 7. Saves and migration

- Adventure save → v8. `normalizeBody` migrates the player: `talents` entries
  `ranged_stance` / `magic_stance` / `heavy_weapons` are removed and become
  worn outfits in `gear.ranged.outfit` / `gear.magic.outfit` /
  `gear.melee.outfit`; missing `gear` / `belt` default empty. The migration
  is one pure function `migrateTalentsToOutfits(body, talents)` in
  `systems/outfits.js`, so Timewarp mini-saves (`normalizeTimewarpSave`),
  the episode kits and the arena player-override shape run the same code.
- Rush: `makePlayer` for `runMode === 'rush'` wears all three story outfits
  (replacing `RUSH_START_TALENTS`).
- Floating items and cave instances holding old `talent` fields on
  `talent_trigger` entities read `outfit ?? talent` for one version.

## 8. Panel (ui/inventory-panel.js)

Above the sack grid, a **gear strip**: three columns (Warrior / Archer /
Mage), each with main, offhand and outfit tiles, and a belt tile at the end.
The active loadout's column is highlighted; a locked loadout's column is
greyed and its tiles are inert, with no unlock hint (spec §1 of the talents
design: no spoilers).

- Arrow keys move within the grid as today; Up from the top row enters the
  strip, Down leaves it.
- Enter on a sack item equips it into the active loadout's first legal slot
  (main before off before outfit before belt). When both main and off are
  legal a second button, **Offhand**, targets the offhand explicitly; for
  tools a **Belt** button appears.

  > **As built:** "first legal slot" would have made Enter on a potion point
  > the offhand at it instead of drinking it, which is the opposite of what a
  > player reaching for a potion wants. A consumable keeps its own use action
  > (**Drink** / **Eat**) as the primary, and **Offhand** is always offered as
  > an explicit second button (`sackActions` in
  > `ui/inventory-panel-model.js`). Only kinds with no use action — weapons,
  > bows, wands, outfits — lead with **Equip**/**Wear**.
- Enter on a gear tile unequips it to the sack (a consumable pointer simply
  clears). Refusals use `EQUIP_FAIL_MESSAGES`, extended with
  `two_handed: 'I need both hands for that.'`, `wrong_loadout: "That's not
  my garb."`, `full: 'My pack is full.'`.
- Detail line shows protect / blockCost / spell where relevant. (Plan 1 shows
  protect; `blockCost` and the wand's spell arrive with plan 2's shields and
  offhand wand.)
- Touch: tiles are tappable; the existing stick-to-arrow mapping covers
  navigation.

## 9. Testing

`node:test` files, one per concern, alongside the existing suite:

- `test/loadouts.test.js` — accessors, `loadoutAvailable`, stance cycle
  skipping locked loadouts, wearing/removing the coat.
- `test/offhand.test.js` — legality matrix, two-handed eviction and refusal,
  consumable pointer resolution, shared pointer across loadouts, empty-stack
  behaviour.
- `test/shield.test.js` — arc test, stamina cost, drop at zero, unblockable
  sources.
- `test/dual-wield.test.js` — alternation, offhand cooldown, per-hand
  chop/mine.
- `test/outfits.test.js` — protect in `damagePlayer`, plate gates heavy,
  sprint drain, self-equip on pickup, rite drops the robe.
- `test/belt.test.js` — harvest fallback.
- `test/loot.test.js` additions — shield/outfit rungs, story outfits never
  roll.
- `test/save-migration.test.js` — talents → outfits, v7 → v8, timewarp kits.
- `test/sprites.test.js` — covers the new weaponTypes automatically.
- One short Playwright check that the panel strip renders and Enter equips.

## 10. Out of scope, noted for later

- **Rummaging in the pause panel during combat.** The panel pauses the game,
  so swapping the offhand mid-fight costs nothing. A real-time panel, or one
  that closes on damage, is a separate design; this spec deliberately makes
  the offhand consumable the *fast* heal and leaves the panel as the slow one.
- Multiple armor pieces (head, boots), enchantments, outfit-specific spell
  bonuses.
- An offhand bow, throwing daggers, a torch in the offhand.
- Per-loadout hp or stamina.
