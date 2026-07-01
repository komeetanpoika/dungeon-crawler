# Level 0 — Dragon Boss Test Arena (Design)

**Date:** 2026-06-30
**Status:** Approved (brainstorming) — ready for implementation plan

## Goal

A dedicated debug/test level containing **only the main dragon boss and 20 chests**,
reached on demand via the title-screen cheat code. It exists so the boss
(`dragon_boss` — `makeDragonBoss`/`updateDragonBoss` in `renderer/systems/dragonboss.js`)
can be iterated on without playing through the normal 5-depth run.

The boss is the larger articulated boss (`B` marker, `BOSS_HP = 28`) that normally
lives in the `GREAT_LAIR` arena at depth 5 — **not** the lesser depth-4 `dragon`.

## Access

The title screen reads a typed cheat buffer; `parseLevelCheat(buffer)`
(`renderer/systems/cheats.js`) matches a `level<N>` suffix and, when valid, calls
`onCheat(N)` → `beginRun(N)`.

- **Change:** `parseLevelCheat` accepts `level0` → `0`, in addition to the existing
  `1..FINAL_DEPTH`. New accepted range: `0 <= N <= FINAL_DEPTH`.
- Typing `level0` on the title screen starts the boss test arena.
- One existing test asserts `parseLevelCheat('level0') === null`; it is updated to
  expect `0`. `level6`/`level9`/`level10` stay `null` (still out of range).

## Level building

Depth 0 must be a pure arena — no procedural rooms, staircases, guards, traps, or
exit door. The chosen approach (selected over routing through procedural
`generateLevel`, which would wrap the arena in generated rooms + stairs + exit):

- **New `buildBossTestArena(width, height)` in `renderer/systems/map.js`** returns the
  same contract as `generateLevel`: `{ map, entitySpawns, playerSpawn }`.
- **`generateLevel(depth, …)` early-returns `buildBossTestArena(width, height)` when
  `depth === 0`**, before any procedural generation. All downstream wiring
  (`startNewRun` → `buildEntities` → render/update) is unchanged because the return
  shape is identical.

### Arena contents (`buildBossTestArena`)

A single rectangular room, **26 wide × 18 tall**:

- Solid `TILE.WALL` border (row/col 0 and the last row/col); `TILE.FLOOR` interior.
- **No** stairs and **no** exit door — a dead-end test room (you fight/observe, you
  don't descend).
- **1 boss spawn** at the arena center:
  `{ kind: 'dragon_boss', x: cx, y: cy, isBoss: true }` where `cx = floor(width/2)`,
  `cy = floor(height/2)`.
- **20 chest spawns** ringed evenly around the **interior perimeter** (the ring of
  floor tiles just inside the wall border), spaced as evenly as the perimeter allows,
  **alternating `weapon` and `potion`** kinds:
  - `weapon` spawns cycle through `WEAPON_TYPES` keys (dagger → sword → longsword →
    axe → repeat), matching how `buildEntities`' `weapon` case builds a weapon chest.
  - `potion` spawns use the existing `potion` case (`amount: 4`).
  - Both kinds resolve to `makeChest` entities (walk-onto pickups) via `buildEntities`.
- **Player spawn** at bottom-center interior (e.g. `{ x: cx, y: height - 2 }`), on a
  floor tile, never overlapping the boss or any chest. If the bottom-center ring slot
  would hold a chest, that slot is left empty (player takes precedence).

### Theme & config

- **Reuse the depth-5 boss theme** (the molten/obsidian `GREAT_LAIR` look) by adding
  `0` to that theme's `depths` array in `DEPTH_THEMES`, so the test arena visually
  matches the real boss fight (useful for debugging rendering).
- **Add a depth-0 `LEVEL_CONFIG` entry** providing `mapW: 26, mapH: 18` (and benign
  zeroed densities), so `startNewRun`'s `cfg.mapW`/`cfg.mapH` read resolves. The
  procedural fields are irrelevant because `generateLevel` short-circuits for depth 0,
  but the entry keeps the `LEVEL_CONFIG.find(c => c.depth === depth)` lookup honest.

## Components & boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `parseLevelCheat` (`cheats.js`) | Accept `level0..level<FINAL_DEPTH>` → depth | `FINAL_DEPTH` |
| `buildBossTestArena` (`map.js`) | Build the arena map + boss + 20 chest spawns + player spawn | `TILE`, `WEAPON_TYPES`, `createMap` |
| `generateLevel` (`map.js`) | Route `depth === 0` to the arena builder | `buildBossTestArena` |
| `LEVEL_CONFIG` / `DEPTH_THEMES` (`levels.js`) | Supply depth-0 size + theme | — |

`buildBossTestArena` is pure (map + spawn data only); it emits the same spawn-kind
vocabulary the rest of the engine already understands, so no `buildEntities`,
render, or update changes are required.

## Testing

Unit tests (`node:test`), no new deps:

**`buildBossTestArena`:**
- Map dimensions are 26×18 (or the agreed size), with a full `TILE.WALL` border and a
  `TILE.FLOOR` interior.
- Exactly **1** spawn with `kind: 'dragon_boss'`, located at the arena center, flagged
  `isBoss: true`.
- Exactly **20** chest spawns; kinds are a mix of `weapon` and `potion` (both present;
  alternating); weapon spawns carry a valid `WEAPON_TYPES` key.
- Every spawn sits on an in-bounds, walkable floor tile.
- `playerSpawn` is in-bounds on a floor tile and does not coincide with the boss or any
  chest spawn.

**`generateLevel`:**
- `generateLevel(0, 26, 18)` returns the arena (1 `dragon_boss` + 20 chest spawns, no
  `exit_door`/stairs spawns), i.e. it routed to `buildBossTestArena`.

**`parseLevelCheat`:**
- `parseLevelCheat('level0') === 0`.
- `parseLevelCheat('level1')..('level' + FINAL_DEPTH)` unchanged; `level6`/`level9`/
  `level10` still `null`.

## Out of scope (YAGNI)

- No stairs/descend from the arena; no second debug level.
- No changes to boss-death drop/win handling — killing the boss at depth 0 runs the
  existing non-final drop path (`state.level < FINAL_DEPTH`), which is acceptable for a
  test room.
- No tile-editor support for the arena.
- No tuning of the boss itself (this spec only delivers the arena to debug it in).
