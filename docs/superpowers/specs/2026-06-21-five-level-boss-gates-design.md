# 5-Level Boss-Gated Progression — Design

**Date:** 2026-06-21
**Status:** Approved

## Goal

Restructure the run from 10 procedural depths into **5 levels**, each gated by a
boss. The player must defeat a level's boss before they can advance. Reuse the
existing level designs (landmark templates / arenas) and the existing monster
roster. Levels 1 and 2 are smaller than the standard 80×50 grid.

## Core Loop

Each level hides its exit until its boss dies:

1. Player spawns at the top-left entrance passage (unchanged).
2. Player explores, fighting the usual guard/monster filler.
3. Player finds the **boss lair** and kills the boss.
4. On the boss's death, the exit **materializes at the boss's corpse tile**:
   - Levels 1–4: a `STAIRS_DOWN` tile. Walking onto it descends to the next level.
   - Level 5: a **victory treasure** item entity. Walking onto it wins the run.

This unifies the two chosen mechanics: "stairs appear on boss death" (L1–4) and
"treasure spawns where the boss fell" (L5). There is no key-press to collect —
the player walks onto the spawned exit/treasure.

## Level / Boss / Size Table

| Level | Boss | Lair (design reused) | Map size | Theme |
|-------|------|----------------------|----------|-------|
| 1 | Crab | new small `CRAB_LAIR` template | 50×32 | catacombs (stone) |
| 2 | Wizard | new small `WIZARD_SANCTUM` template | 64×40 | catacombs (stone) |
| 3 | Cyclops | existing `cyclopsArena` 7×7 carve | 80×50 | sand |
| 4 | Dragon (fire breath) | existing `DRAGON_LAIR` template | 80×50 | dark |
| 5 | Dragon Boss (giant) | existing `GREAT_LAIR` template | 80×50 | final / red |

- L4 and L5 reuse their existing lair templates verbatim (`DRAGON_LAIR`,
  `GREAT_LAIR`).
- L3 reuses the existing cyclops-arena carve in `map.js` (`cyclopsArena: true`).
- L1 and L2 need two new small lair templates (crab and wizard have no dedicated
  room today), authored in the same ASCII `TEMPLATES` style. Each must fit inside
  its level's smaller grid.

## Boss Tracking

Exactly one `isBoss` entity exists per level. The level's exit cannot appear
until that entity is gone.

- New `TEMPLATE_LEGEND` symbols:
  - `R` → spawn `crab`, `isBoss: true`
  - `Z` → spawn `wizard`, `isBoss: true`
- Existing legend symbols `D` (dragon) and `B` (dragon_boss) gain `isBoss: true`.
- The cyclops-arena spawn in `map.js` gains `isBoss: true` on its spawn object.
- `placeTemplate` propagates `isBoss` from the legend entry onto the pushed spawn.
- `buildEntities` copies `isBoss` from the spawn onto the constructed entity for
  the boss kinds (`crab`, `wizard`, `cyclops`, `dragon`, `dragon_boss`).
- The old scattered `crabCount` / `wizardCount` spawns are **removed** from
  `LEVEL_CONFIG`, so the only crab/wizard on a level is its boss.
- Normal `guardCount` and monster-density filler remain for challenge; they do
  not gate the exit.

Bosses keep their **base stats** — no HP multiplier.

## Exit-on-Death

- `carveExitPassage` is **dropped** from the boss-gated generation flow. The exit
  no longer pre-exists in the map. (The function may remain in the file for the
  fallback generator if needed, but `generateLevel`'s main path no longer calls
  it.)
- Each frame, after combat resolution, the game detects a boss that was alive and
  is now gone (filtered out by `hp <= 0`). When that transition happens, spawn the
  exit at the boss's last tile:
  - L1–4: set that tile to `TILE.STAIRS_DOWN`. A lone `STAIRS_DOWN` tile renders
    correctly via `sprites.stairs_dn`; with no `stairDepth` it skips the void
    animation. Set `stairWidth: 1`, `stairCol: 0` for safe rendering.
  - L5: push a `victory` treasure item entity at the boss's tile (a chest-like
    item whose `contents.type === 'victory'`).
- `descendLevel` still triggers on stepping onto `STAIRS_DOWN` — no extra gate is
  needed, because the stairs only exist after the boss is dead.
- The existing **X-to-steal-treasure** win handler is removed. Victory is now
  walking onto the L5 victory-treasure item, which calls `endRun(true)`.
- The decorative `TREASURE` tiles in templates (e.g. `GREAT_LAIR`'s `TT`) remain
  purely cosmetic and do **not** win the run — only the spawned `victory` item
  does.

## Data Changes

- `LEVEL_CONFIG` shrinks to 5 rows. Each row gains `mapW` / `mapH`. Densities are
  re-tuned across 5 levels by compressing the current 10-row values. `crabCount` /
  `wizardCount` scatter fields are removed; bosses come from lairs/arena.
- `DEPTH_THEMES` is remapped to cover depths 1–5 (stone, stone, sand, dark,
  final/red per the table above).
- `FINAL_DEPTH = 5`.
- `startNewRun` and `descendLevel` read per-level `mapW` / `mapH` from
  `LEVEL_CONFIG` instead of relying on the 80×50 default.

## Components Touched

- `renderer/data/levels.js` — `LEVEL_CONFIG`, `DEPTH_THEMES`, `FINAL_DEPTH`,
  `TEMPLATE_LEGEND` (new `R`/`Z`, `isBoss` on `D`/`B`), new `CRAB_LAIR` /
  `WIZARD_SANCTUM` templates.
- `renderer/systems/map.js` — `placeTemplate` propagates `isBoss`; cyclops-arena
  spawn flagged; `generateLevel` no longer carves the exit passage; honors
  per-level map size.
- `renderer/game.js` — `buildEntities` propagates `isBoss`; new boss-death →
  exit/treasure spawn logic; `victory` item pickup ends the run; remove
  X-to-steal handler; `startNewRun` / `descendLevel` pass per-level sizes.

## Testing

- Update existing tests affected by the new `FINAL_DEPTH` and 5-row
  `LEVEL_CONFIG` (`map.test.js` and any that assume 10 depths / 80×50).
- New coverage:
  - `isBoss` propagates from legend → spawn → entity for each boss kind.
  - Killing the level's boss spawns `STAIRS_DOWN` at its tile (L1–4).
  - Killing the L5 boss spawns the `victory` item; collecting it ends the run won.
  - `generateLevel` produces a fully connected map at the smaller L1/L2 sizes.
  - `generateLevel` no longer carves a pre-existing exit passage.

## Out of Scope

- Boss stat changes / new boss behaviours.
- New monster types or new art.
- Meta-progression changes beyond the `deepestLevel` cap implied by 5 levels.
