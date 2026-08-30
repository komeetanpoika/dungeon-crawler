# House interiors — design

Date: 2026-08-30

## Goal

Every house door on the open maps opens into a generated interior — a one-floor
"mini dungeon" far larger than the 3×3 façade — reached and left exactly the way
caves are. Danger escalates by where the house stands. The three leap episodes'
required items (a chopper, lumber, raw meat) are found **inside story houses as
floor pickups**, so they are obtainable without chests and without relying on
what the player carried in.

Approach: **hybrid** — the existing BSP dungeon generator with an interior
config and a `house` theme for layout and danger, plus one authored **story
room** prefab per story house that carries the episode's items.

## Non-goals

- No hand-authored plan per house; generic houses share the generator.
- No new save version: interiors ride in `caveInstances` like caves.
- No windows/lighting, no NPCs indoors, no shops.
- Desert maps (no houses) are untouched. Cave arches keep their own logic.
- Chest caches on the surface are unchanged; this feature adds pickups, it
  does not remove chests.

## 1. Doors are entrances

`buildOpenMap` scans prop cells whose palette name starts with `ow_house_door`
or `ow_house_arch_` and, for each:

- makes the cell walkable (`tile = FLOOR`), keeping the door art as the overlay;
- emits a `houseDoors` entry `{ x, y, label, tier, story }` (state-level
  triggers, like `caveEntrances`), where
  - `label = 'house:<mapName>:<x>,<y>'` (stable across visits and rebuilds),
  - `tier` is `'safe'` when the door lies within the village/camp POI's roam
    box (Chebyshev ≤ 10 of the `village`/`camp` POI), `'ruin'` when the door art
    is `ow_house_arch_stone` or the map has no village, else `'hut'`;
  - `story` is the label of a `houses` entry in the map's episode (§4) whose
    named POI is nearest this door (Chebyshev ≤ 4), else `null`.

Walking onto a door cell enters the house (`entranceHold` prevents immediate
re-entry, as with arches). Stepping back onto the entry tile inside leaves
(the cave "retreat" rule, `cave.offStairs`).

Signposts that share the `ow_sign` art are unaffected (different prefix).

## 2. Interiors

`enterHouse(door)` reuses the cave transition (`buildCaveState`,
`restoreSurface`, `caveInstances[label]`) with an interior in place of a cave:

- **Generator**: `generateLevel(INTERIOR_DEPTH, cfg.mapW, cfg.mapH, …)` with
  `INTERIOR_DEPTH = 19` and `INTERIOR_CONFIG[tier]` supplying the level config
  (grid 44×28, `staircaseWidth 1`, `landmark: null`, `weapons: ['dagger']`):

  | tier | monsters | loot | props |
  |---|---|---|---|
  | safe | none | `potionDensity 0.006` | tables, chairs, barrels, crates |
  | hut  | `monsterDensity 0.006`, weak (rats) | potions 0.006, `weaponDensity 0.004` | + anvil |
  | ruin | `monsterDensity 0.010`, medium (spiders) + 1 strong | potions 0.008, weapons 0.008 | gravestones, rubble |

  Monster variant selection at `INTERIOR_DEPTH` follows the tier, not the
  depth (a `variantPool` in the config).
- **Theme**: a new `DEPTH_THEMES` entry for depth 19: `floorTile: 'floor_wood'`
  (the wooden-plank tile — chosen from the tileset contact sheet; the current
  `floor_wood` alias points at a crate and is corrected), `bgColor '#120c06'`,
  `fogAlpha 0.55`, `props.room` per the table, no ruleset (the BSP walls keep
  the dungeon wall art — cellars).
- **Spawn/exit**: the BSP spawn room's centre is the entry tile
  (`TILE.STAIRS_UP`), the way back out.
- **Persistence and reset**: the instance is stored under the door label in
  `caveInstances` on exit, so killed vermin stay dead and pickups stay taken;
  `cleared` is always true (no boss), so the instance is dropped after
  `CAVE_RESET_TIME` (180 s of surface time) and regenerates fresh — **story
  pickups are renewable**.
- Messages: `'You step inside.'` / `'You step back out.'`, cues `door-open`
  (new) and `emerge`.

## 3. Story rooms

Episode data (`data/leaps.js`) gains

```
houses: {
  "Toivo's hut": { room: 'toivo_kitchen',  pickups: [{ type: 'meat', count: 3 }, { type: 'weapon', weaponType: 'hatchet' }, { type: 'lumber', count: 3 }] },
  "hermit hut":  { room: 'hermit_woodpile', pickups: [{ type: 'weapon', weaponType: 'hatchet' }, { type: 'lumber', count: 3 }] },
  "Aino's house": { room: 'aino_larder',   pickups: [{ type: 'meat', count: 2 }] },
}
```

- The named POI must exist on the map (`Aino's house` is added to the fold:
  the village house nearest the fold gets a `landmark` POI on its door).
- `room` names a prefab in `renderer/data/structures.json` (authored with the
  editor's Build tab, 9×7): a kitchen with a fish rack and bench, a woodpile
  room, a larder. Prefab cells mark pickup spots with `interaction: { type:
  'pickup', slot: n }`.
- When a story door is entered, the generator places the prefab as the
  floor's landmark room (the existing structure-landmark path) and lays the
  `pickups` on the marked floor cells as `floating_item`s with `progress: 1`
  (walk-into pickup; `{ type: 'meat', count: 3 }` is one stack). Story houses
  are always tier `hut`, so vermin guard the goods.
- A story house's instance therefore holds the items until taken; after the
  reset timer they are back.

## 4. Audit closure

| Episode | Required | Source after this feature |
|---|---|---|
| Ferry | chopper, 3 lumber, 3 raw meat (→ cooked), clapper | Toivo's hut (hatchet, lumber ×3, meat ×3); islet cache (clapper) |
| Fold | fleece, pick | burrow-mouth cache; the elder |
| Hermit | chopper, 3 lumber | hermit hut (hatchet, lumber ×3) |

Wild animals remain an additional meat source.

## 5. Sound cues

`door-open` (short wooden knock: burst, ~200 Hz).

## 6. Testing

- `test/openmap.test.js` — door scan on every open map: count equals the
  `ow_house_door*`/`ow_house_arch_*` prop count, cells walkable with the art
  kept as overlay, labels unique/stable, tiers as specified, story doors
  resolved for the three story POIs (and `null` elsewhere).
- `test/interior.test.js` — `INTERIOR_CONFIG` per tier; generated interiors:
  size, no landmark for generic houses, monster counts by tier (safe = 0), the
  story prefab present with the pickups on floor cells, `floor_wood` theme.
- `test/cave.test.js` — enter/exit round-trip with a house door: instance
  stored under the door label, restored on re-entry, dropped after the reset
  timer.
- `test/leap-maps.test.js` — each episode's `houses` POI exists and resolves
  to a door on that map; the required items per §4 are all present as pickups.
- `test/structures.test.js` — the three prefabs load and carry pickup slots.
- Live: enter Toivo's hut, walk onto the meat/hatchet/lumber, walk out; enter
  a village house (no enemies) and the hermit's hut (rats).
