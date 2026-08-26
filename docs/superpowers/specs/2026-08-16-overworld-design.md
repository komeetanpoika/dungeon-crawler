# Overworld — an open, castle-skinned world with dungeons in it

**Date:** 2026-08-16
**Status:** Approved design, pending implementation plan

## Goal

A generated open-world level, skinned with the derived `castle` ruleset, reachable
from the title screen. It is the first piece of a longer direction: **open-world
exploration in which dungeons are one part of the game rather than the whole of
it.** This spec builds the world and places the seams the rest will attach to; it
does not build the transitions.

## Why the shape is what it is

Two facts constrain the design, both established by measurement rather than
assumption.

**The castle ruleset can express a built landscape, not a wilderness.** Its 27
tiles are 4 floor variants, 16 wall variants and 7 overlays. There is no water,
forest, cliff or grass tile. A world made from it is ground, stone and ruins.
Biomes would be a new ruleset and new art, not a generator change.

**Buildings must come from prefabs, not from decoration.** `decorateMap` only
consults the already-decided N and W neighbours, with no propagation and no
backtracking, so it cannot assemble a multi-cell structure — this is exactly why
the `outdoors` house never reconstructs (see
`2026-08-16-adjacency-scoring-fix-design.md`). Settlements therefore use
`placeStructure` with the painted prefabs in `structures.json`.

**Nothing technical caps the size.** Measured on this machine:

| | 80×50 | 180×116 | 256×160 |
|---|---|---|---|
| render | culled to the visible window — free at any size | | |
| `buildNavGrid` | memoized on the map object; built once | | |
| `buildFlowField` (per player step) | 0.3ms | 0.7ms | 0.6ms |
| `decorateMap` (once, at generation) | 168ms | 195ms | 316ms |

The camera is unbounded and player-centred, and `Renderer.render` culls to
`c0..c1 / r0..r1`. Size is a design decision, not an engineering one.

## Decisions

| Question | Decision |
|---|---|
| World shape | **Open plain with settlements, plus ruin pockets.** Mostly traversable ground, 4–5 walled compounds linked by roads, 2–3 pockets of broken street grid placed away from them. |
| Size | **180 × 116** (~33 screens at 32px tiles and a ~1024×645 canvas; ~5× the area of the deepest dungeon). |
| Contents | **Danger gradient from spawn** — enemies and loot both scale with distance, so exploring outward is intrinsically motivated without a quest system. |
| Access | **An `Explore` button on the title screen**, beside Play. `Play` is untouched. |
| Dungeon entrances | **Placed but inert.** They are the seam the next spec attaches to. |

## Non-goals

- **No working dungeon transitions.** Standing on an entrance does nothing but log
  a line. Descending, returning to the same world position, and persisting world
  state across the round trip are the next spec.
- **No fix for the depth-4 softlock.** `generateLevel` falls back to an unwinnable
  single room on ~6.75% of depth-4 generations. Untouched here, deliberately.
- **No new art.** The entrance marker reuses an existing sprite (see below).
- **No change to depths 1–5.** `Play` must behave identically before and after.

## 1. Architecture

New module `renderer/systems/overworld.js`, pure and DOM-free:

```
generateOverworld(width, height, { structures, rng }) -> { map, entitySpawns, playerSpawn, rooms }
```

It returns the same shape `generateLevel` already returns, so nothing downstream
distinguishes it from a dungeon. `rng` is injectable and defaults to
`Math.random`, following `decorateMap(map, ruleset, rng)`'s precedent, so the
tests are deterministic while the game stays random.

`rooms` carries the settlement compounds as `{ id, x, y, w, h }`. Nothing
downstream currently reads `rooms` — verified across `game.js` and every system —
so this is for the tests and for whatever the transitions spec needs, not for the
renderer.

`generateLevel` gains one dispatch line, mirroring the arena branch it already
has:

```js
if (depth === 0) return buildArena(...)                        // exists today
if (depth === OVERWORLD_DEPTH) return generateOverworld(...)   // new
```

`OVERWORLD_DEPTH = 6` is exported from `renderer/data/levels.js` beside
`FINAL_DEPTH`. Depth 6 already exists there as a cheat-only castle sandbox and
already has a `DEPTH_THEMES` entry with `ruleset: 'castle'`; this spec repurposes
the slot and widens it from 40×26 to 180×116.

**Why a separate module.** `map.js` is 838 lines of BSP rooms, corridors and
lairs. The overworld shares none of that logic — only four already-exported
helpers, plus one that needs exporting (below).

## 2. Generation order

The order matters: it makes the world **connected by construction** rather than by
retry. `generateLevel` currently generates, tests `isFullyConnected`, and retries
up to five times before falling back to a bare unwinnable room — the mechanism
behind the depth-4 bug. The overworld has no retry loop and no fallback path,
because no step can disconnect what came before.

1. **Fill with open ground.** Trivially connected.
2. **Choose sites.** 4–5 settlements and 2–3 ruin pockets by rejection sampling
   with a clearance radius, relaxing the clearance if the plain is too crowded to
   satisfy it. *Filtering a pre-generated scatter instead of rejection-sampling
   against what already exists drops the pockets entirely on most seeds — this was
   observed, not hypothesised.*
3. **Carve roads.** A minimum spanning tree over the settlements via
   `carveCorridor`. Only ever adds traversable ground.
4. **Stamp ruin pockets.** Hollow rectangles, each punched with 2–3 gaps so it is
   enterable from the plain.
5. **Stamp settlements.** A hollow compound wall with a guaranteed gate opening,
   then `placeStructure` for the prefab inside. `placeStructure` marks its cells
   `locked`, so the decoration pass leaves the prefab's exact skins alone.
6. **Verify.** `isFullyConnected`, then `healConnectivity` as belt-and-braces. If
   healing ever has work to do, that is a bug in steps 3–5, and the tests assert
   it does not.

## 3. Contents — the danger gradient

Rank every walkable tile by Manhattan distance from the spawn point, then bucket:

| Ring | Distance | Enemies | Chests |
|---|---|---|---|
| inner | 0–25% | none | none |
| mid | 25–60% | 4–6 `guard`, 6–10 `monster` (`weak`) | 3–5 `chest` |
| outer | 60–100% | 8–12 `monster` (`medium`/`strong`), 1–2 `cyclops` | 6–9 `chest` |

Counts are absolute rather than densities, because a fixed fraction of 20,880
cells would flood the map — the dungeon generator's `monsterDensity: 0.01` would
put over 150 monsters here. All counts scale down proportionally if the world is
generated smaller than 180×116.

Chest tier comes free: `kind: 'chest'` rolls `rollChestLoot(depth)` at open time,
and depth 6 sits above the whole 1–5 run, so overworld chests already roll the
best table in the game. No new loot code.

Dungeon entrances are placed in the outer ring, spread by the same clearance
sampling as everything else.

**Player spawn** is the settlement nearest the map centre, so the world extends in
every direction and the gradient is radial rather than one-sided.

**Chests** emit `kind: 'chest'`, which already rolls depth-tiered loot at open
time via `rollChestLoot(depth)`.

## 4. The dungeon-entrance marker

Entrances emit a new spawn kind, `dungeon_entrance`.

**They must not be `TILE.STAIRS_DOWN`.** The existing descend logic would send the
player to depth 7, which does not exist. They are entities, not tiles.

**`buildEntities` silently drops unknown kinds** — its `switch` in `game.js` has no
default that warns. A new kind therefore needs a case there or it vanishes with no
error and no log.

The marker reuses `prop_grave` (`tile_0066`), which is already part of the castle
palette as an `overlay.castle` member, so it fits the world visually. It is a
**placeholder**: a dedicated sprite drawn in the editor's Draw tab is a follow-up,
not part of this spec. Stepping onto one logs a line and does nothing else.

## 5. Integration

| File | Change |
|---|---|
| `renderer/systems/overworld.js` | **Create.** The generator. |
| `renderer/data/levels.js` | Export `OVERWORLD_DEPTH = 6`; widen the depth-6 `LEVEL_CONFIG` entry to 180×116. Its `DEPTH_THEMES` entry already names `ruleset: 'castle'` and needs no change. |
| `renderer/systems/map.js` | One dispatch line in `generateLevel`; **export `healConnectivity`**, which is currently a plain module-local `function` at line 378. |
| `renderer/ui/menu.js` | `showTitle` gains an `onExplore` callback and an `Explore` button after `Play`. |
| `renderer/game.js` | Wire `onExplore: () => beginRun(OVERWORLD_DEPTH)`; add the `dungeon_entrance` case to the `buildEntities` switch. |
| `test/overworld.test.js` | **Create.** |

`Explore` stays visible on the web build, unlike `Open Editor` and `Quit` — it is
gameplay, not a desktop affordance.

## Data flow

```
title screen ── Explore ──▶ beginRun(OVERWORLD_DEPTH)
                                │
                                ▼
                        startNewRun(6)
                                │
              generateLevel(6, 180, 116, { structures })
                                │  dispatch on depth
                                ▼
              generateOverworld(180, 116, { structures, rng })
                                │
                    { map, entitySpawns, playerSpawn }
                                │
                     decorateMap(map, rulesets.castle)
                                │
                      buildEntities(entitySpawns, map, 6)
                                │
                                ▼
                          state ── the normal game loop
```

## Error handling

- **A missing prefab.** If `structures.castle` is absent, the settlement is still
  stamped as a walled compound with a gate — an empty courtyard, not a crash. The
  generator never assumes a named structure exists.
- **A world too small for its contents.** Below roughly 80×60 the clearance
  sampling cannot place 4 settlements. The generator scales the requested counts
  down to what fits rather than looping forever, and returns however many it
  placed.
- **`healConnectivity` doing work** is a defect, not a fallback. Tests assert
  `isFullyConnected` is already true before healing runs.
- **An unknown spawn kind** is the failure mode most likely to go unnoticed here,
  because `buildEntities` drops silently. The tests assert every kind the
  generator emits is one `buildEntities` handles.

## Testing

`test/overworld.test.js`, pure and seeded, asserted across **many seeds rather
than one** — the three-seed mockup during design is what exposed the pocket-placement
bug, and a single-seed test would have shipped it:

- **Connectivity.** Every seed produces a fully connected world, *before*
  `healConnectivity` is given a chance to fix anything.
- **Counts in range on every seed** — settlements, ruin pockets and dungeon
  entrances each land within their intended range on all seeds, not most.
- **Danger gradient is monotonic.** No enemy spawns in the inner ring; the outer
  ring's enemy density is strictly greater than the mid ring's.
- **Player spawn is walkable**, is not inside a prefab or a compound wall, and is
  the settlement nearest the centre.
- **Determinism.** The same seed yields identical output; different seeds differ.
- **Every emitted spawn kind is one `buildEntities` handles** — guarding the
  silent-drop failure mode directly.
- **Size guards.** A world too small to hold the full content set returns fewer
  landmarks rather than hanging or throwing.

Existing suites must pass unmodified. The only expected change to an existing test
file is `test/menu.test.js` gaining the `Explore` button case. If
`map.test.js`, `decorate.test.js` or any other suite needs editing, the change has
exceeded this spec.

## Follow-ups this deliberately sets up

1. **Dungeon transitions** — entrances become functional: descend into the depth
   1–5 run and return to the same world position. The entrance entities are the
   seam.
2. **A dedicated entrance sprite**, replacing the `prop_grave` placeholder.
3. **More enterable prefabs.** `castle` (7×6) is the only one with a real
   interior; `barracks` (4 walkable of 35) and `castle2` (3 of 36) are essentially
   solid massing. More painted prefabs would make arriving somewhere pay off.
4. **World persistence**, once there is anything to persist across a transition.
