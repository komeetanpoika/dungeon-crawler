# Lumber and campfire — design

Date: 2026-08-29

## Goal

Give the forest maps a harvest loop: fell trees with a chopping weapon, collect
lumber, build a campfire from it, and cook the raw meat animals drop into a
proper meal. Three linked pieces, each small:

1. a **hatchet** — the new starter weapon; hatchet and axe both chop
2. **chopping** — swinging a chopping weapon at a tree chips and eventually
   fells it, leaving a walkable stump and lumber to walk onto
3. a **campfire** built from lumber that cooks raw meat into cooked meat

## Non-goals

- Lumber has no other use yet (no building, trading, bridges).
- Trees never regrow; felled trees are permanent per adventure save.
- No campfire light radius or enemy reaction to fire.
- No damage states for tree art: a tree looks untouched until it falls, and
  never shows an HP bar. Per-damage tree graphics may come later.
- Only the open (overworld) maps have trees; caves are untouched.

## 1. Hatchet

`WEAPON_TYPES` (`renderer/systems/entities.js`):

| type | name | damage | chop | heavy |
|---|---|---|---|---|
| hatchet | Hatchet | 1 | 1 | – |
| axe | Axe | 4 | 2 | yes |

`chop` is the damage a swing deals to a tree. Types without `chop` (dagger,
sword, longsword, maunonmiekka) do not chop.

- `ATTACK_STYLES.hatchet = { style: 'arc', duration: 0.18, cooldown: 0.38, knockback: 14 }`
  — a short sweeping chop; not a charge weapon.
- `MELEE_COSTS.hatchet = { full: 10 }` (between dagger 8 and sword 12).
- Sprite `weapon_hatchet: 'tile_0119'` (the single-bit axe; `tile_0118`
  stays the big axe). The held-weapon and icon paths already key on
  `weapon_${weaponType}`, so no drawing changes.
- Starter: `starter: 'hatchet'` on the first map in
  `tools/static-overworld/export-game-maps.mjs`; regenerate
  `renderer/data/open-maps.js`. Loot pools and cave `weapons` lists keep the
  dagger — it is still a fine early blade, it just can't chop.

## 2. Chopping

New pure module `renderer/systems/lumber.js`. It owns the tree table, hit
selection and felling; `game.js` wires it into the existing swing and spawns
the pickup.

### Tree table

Keyed by the overlay art name `buildOpenMap` stamps on a blocking cell:

| overlay | hp | yield | cells |
|---|---|---|---|
| `ow_tree_small`, `ow_tree_small_autumn`, `ow_tree_apple` | 3 | 1 | 1 |
| `ow_deadtree_0`, `ow_deadtree_1` | 2 | 1 | 1 |
| `ow_tree_pine_trunk`, `ow_tree_autumn_trunk` | 4 | 2 | 2 (top at `y-1`) |
| `ow_tree_autumn_top` | 3 | 1 | 1 (standalone small tree; directly above an autumn trunk it is that tree's canopy instead) |

Two-cell trees are addressed by their **trunk** cell. A `_top` overlay above
a two-cell trunk is never a target on its own: hitting such a top cell
resolves to the trunk directly below it. Otherwise the top cell is a tree
only if the table lists it (`ow_tree_autumn_top`); an orphan top is scenery.
Border cells (`x` or `y` on the map edge) are never trees — `buildOpenMap`
forces the edge to wall because the camera is unbounded.

Chop damage is tracked as `cell.chopHp`, initialised lazily from the table
on first hit, so `buildOpenMap` needs no per-cell setup. It is invisible: the
overlay art stays the plain tree until the cell is felled, and no HP bar or
number is drawn for tree cells (the `hp`-bar path is for entities only).

### Hit selection

```
findTreeHit(map, player, hitAt) -> { x, y } | null
```

Scans the cells within `ceil(reach / 32) + 1` tiles of the player, keeps
those whose overlay is a tree (resolving tops to trunks), tests the cell
centre with the swing's `hitAt(dx, dy)` wedge test — the same wedge the
entity hit uses — and returns the nearest trunk. **One tree per swing.**

### Felling

```
chopTree(map, x, y, chop) -> { felled: boolean, yield: number }
```

Subtracts `chop` from `chopHp`. On reaching 0:

- trunk cell → `tile = TILE.FLOOR`, `overlay = 'ow_stump'`, `losSoft` cleared
- top cell (two-cell trees) → `tile = TILE.FLOOR`, `overlay = null`, `losSoft`
  cleared
- returns `yield` from the table

The stump is plain walkable floor with art on it — `isWalkable` ignores
overlays, so nothing else changes. Because these cells also feed
`hasLineOfSight`, felling opens sight lines exactly as it opens paths.

### Wiring in `game.js`

Inside the existing `swing(mods)`, after the entity loop:

- if `player.weapon.chop` and `findTreeHit` returns a trunk:
  - `chopTree(...)`; push a hit spark on that cell; cue `chop`
  - if felled: cue `tree-fall`, and push a `floating_item` with
    `contents: { type: 'lumber', count: yield }` arcing from the trunk cell
    onto the stump cell (same shape as the NPC meat drop), so the player
    collects it by walking onto the stump — no prompt
  - record the felled trunk in `state.felled` and `persistAdventure()`
- if the weapon can't chop, trees are simply not tested (no message; the
  swing already has its normal feedback).

Feedback is sfx + spark only. No text on hit; the fall is audible.

## 3. Persistence

`adventure.js` save shape becomes **v5**, additive as before:

```
felled: { [mapName]: ['x,y', ...] }     // trunk cells
```

- `normalizeAdventureSave` defaults it to `{}`.
- `buildOpenMap(data, { npcs, felled })` applies each felled trunk via the
  same felling routine (`applyFelled(map, list)` in `lumber.js`) before LOS
  flags are relied on.
- `persistAdventure` writes it from `surface.felled`.
- Not wiped on player death (unlike npcs): a cleared path stays cleared.
- Campfires are not saved — they burn out within a minute (section 5).

## 4. Items

`renderer/systems/inventory.js` `STACKABLE_KINDS`:

| kind | name | extra |
|---|---|---|
| lumber | Lumber | – |
| meat | Meat | `heal: 1` (was 2) |
| cooked_meat | Cooked Meat | `heal: 4` |

- `itemFromContents` / `contentsFromItem` learn `lumber` and `cooked_meat`;
  `contents.count` (default 1) sets the stack size so a felled pine grants
  2 lumber in one pickup.
- `CONSUMABLE_KINDS` gains `cooked_meat`; quick-use (Q) order stays
  sack order.
- `useInventoryItem` heals for `cooked_meat` like `meat`.
- Inventory panel primary actions: `meat` / `cooked_meat` → **Eat**,
  `lumber` → **Build fire** (calls a new `onBuild` handler).
- Icons (`render/icons.js` `KIND_ICONS`): `lumber → item_lumber`,
  `cooked_meat → item_meat_cooked`.

### Art

Placeholder 16×16 PNGs painted by `tools/npc-placeholders.mjs` (same pattern
as `item_meat`), registered in `render/sprites.js` and listed in the
open-map sprite manifest so `loadSprites` fetches them:

- `item_lumber` — two stacked logs
- `item_meat_cooked` — the drumstick, browned
- `ow_stump` — a cut trunk, transparent background (drawn over the ground art)
- `prop_campfire` — logs with a flame

## 5. Campfire

New pure module `renderer/systems/campfire.js`:

```
CAMPFIRE_COST = 3            // lumber per fire
CAMPFIRE_DURATION = 60       // seconds a fire burns
canBuildCampfire(player) -> { ok } | { ok: false, reason: 'lumber' }
buildSpot(map, entities, player) -> { x, y } | null   // nearest free adjacent walkable tile (drop's search)
makeCampfire(x, y) -> { type: 'campfire', x, y, px, py, t: 0 }
tickCampfires(entities, delta) -> entities   // ages fires; drops those past CAMPFIRE_DURATION
cookMeat(player) -> number   // converts every raw meat stack into cooked_meat; returns count cooked
```

Wiring:

- **Build**: sack panel *Build fire* → `game.js` `buildCampfire(i)`:
  refuses with `think('Not enough lumber.')` below 3 or
  `think('No room for a fire here.')` with no spot; otherwise removes 3
  lumber, pushes the entity, cues `campfire-light`, closes the panel.
- **Burn-out**: `tickCampfires` runs each frame; a fire vanishes 60 s after
  it was lit (cue `campfire-out`). The last ~10 s the flame draws dimmer so
  the player sees it dying. Fires are per-session — leaving the map or
  reloading forgets them.
- **Cook**: walk-onto. Each frame, if the player's tile holds a campfire and
  the sack has raw meat, `cookMeat` runs once (`sizzle` cue,
  `think('You cook the meat.')`). Standing still on the fire does not
  re-trigger; stepping off and back on with new raw meat does.
- The campfire is scenery: not hittable, not a blocker for the player or
  enemies (like `floating_item`), no damage. Rendered as `prop_campfire`
  on its tile, under entities.

## Sound cues

New recipes in `render/audio.js`: `chop` (burst, wood-ish ~320 Hz),
`tree-fall` (rumble, ~75 Hz, 0.6 s), `campfire-light` (swoosh up),
`sizzle` (short noise burst), `campfire-out` (soft downward blip).

## Testing

`node:test` files:

- `test/lumber.test.js` — tree table lookup incl. top→trunk resolution;
  `findTreeHit` picks the nearest trunk inside the wedge and ignores cells
  outside it; `chopTree` hp, felling both cells, yield, LOS flags;
  `applyFelled` idempotence.
- `test/campfire.test.js` — cost gate, spot search, `tickCampfires` ages and
  removes fires past 60 s, `cookMeat` converts all raw stacks and returns the
  count, is a no-op without meat.
- `test/inventory.test.js` — new kinds round-trip through
  `itemFromContents`/`contentsFromItem` with counts; quick-use includes
  cooked meat.
- `test/adventure.test.js` — v5 defaults; v4 saves pass through gaining an
  empty `felled`.
- `test/openmap.test.js` — felled record produces stump floor; starter is
  the hatchet.
- `test/canvas.test.js` — a damaged (unfelled) tree cell renders identically
  to an untouched one (no bar, same overlay).
- `test/melee.test.js` / `test/stamina.test.js` — hatchet entries.
- `test/sprites.test.js` / `test/icons.test.js` — new sprite keys resolve to
  existing PNGs.

Then one short live check via Playwright on WSLg: spawn on the first map,
chop the nearest tree, pick up lumber, build a fire, cook a meat.
