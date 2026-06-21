# Boss Key → Exit Door — Design

**Date:** 2026-06-21
**Status:** Approved
**Supersedes:** the "exit-on-death" mechanic from
`2026-06-21-five-level-boss-gates-design.md` (boss death no longer spawns the
stairs/treasure tile directly).

## Goal

Replace the boss-death "exit appears at the corpse" mechanic. Instead, each
level (1–4) has a **locked exit door pre-placed at generation** (visible from the
start). The level's boss **drops a key** on death; the player collects the key by
walking onto it, then walks onto the exit door to open it and advance to the next
level. Level 5 (the dragon boss) instead drops a **collectible treasure**
(placeholder: a random weapon recolored gold); walking onto it wins the run.

This keeps the boss as the progression gate while removing the disliked
"stairs/treasure materializing after the kill" — the exit (door) is always
present; only the *key* drops from the boss.

## Per-Level Flow

1. **Generation (depth 1–4):** place one locked **exit door** on a reachable
   floor tile, in the room farthest from the player spawn (so it is visible and
   encourages exploration, and is distinct from the entrance). Depth 5 places no
   door.
2. **Boss death:** the level's single `isBoss` entity dies; drop a pickup at its
   last tile:
   - Depth 1–4: a **key** entity.
   - Depth 5: a **golden treasure** entity (a random weapon from the depth's pool,
     rendered with a gold tint — placeholder for a future bespoke treasure).
3. **Key pickup (depth 1–4):** walking onto the key tile sets `state.hasKey =
   true` and removes the key entity. No key press (consistent with the walk-onto
   interaction preference, [[prefer-walk-into-pickups]]).
4. **Exit door (depth 1–4):** walking onto the exit-door tile —
   - with `hasKey` → the door plays its open animation, the key is consumed
     (`hasKey = false`), and the game advances to the next level;
   - without `hasKey` → a log line: *"The door is locked — defeat the boss for the
     key."* (no transition).
5. **Treasure (depth 5):** walking onto the golden treasure wins the run
   (`endRun(true)`).
6. **Reset:** per-level gating state (`hasKey`, the exit door, the boss drop,
   tracking flags) resets on every `startNewRun` and `descendLevel`.

## Architecture & Components

The boss-gate stays as built (one `isBoss` entity per level, tracked by
`countBosses` and `lastBossTile`). What changes is what happens on boss death and
how the player exits.

### `renderer/systems/entities.js`
- `makeKey(x, y)` → `{ type: 'key', x, y }` — collectible key entity.
- Exit door: extend the existing door entity. `makeDoor(x, y)` stays; add
  `makeExitDoor(x, y)` → `{ type: 'door', x, y, opening: false, frame: 0,
  locked: true, isExit: true }`. Reuses the existing `door_0..door_3` frames
  (frame 0 = closed/locked, animates to open).
- Golden treasure: represented as a normal floating/collectible item whose
  `contents` carry a `victory: true` flag and a weapon type, plus a `golden: true`
  render hint. Reuse the existing item-pickup entity shape rather than a new type
  where practical.

### `renderer/systems/map.js` — `generateLevel`
- For `depth < FINAL_DEPTH`, after rooms/landmark/connectivity, choose the room
  farthest from the player spawn (excluding the spawn room) and push an exit-door
  spawn `{ kind: 'exit_door', x, y }` at a walkable tile in/near that room's
  center. Guarantee the tile is walkable and not the player spawn or a boss tile.
- Return the door position (or rely on the spawn list) so the door is built like
  other entities.
- No `STAIRS_DOWN` is involved in level transition anymore. (The entrance
  `STAIRS_UP` and entrance passage are unchanged.)
- `generateFallback`: for `depth < FINAL_DEPTH`, place an exit-door spawn too (so
  a fallback level remains completable); for the final depth keep the boss spawn
  (the treasure drops on its death, as in the normal path).

### `renderer/systems/progression.js`
- Replace `spawnLevelExit(map, tile, isFinal)` with
  `spawnBossDrop(tile, isFinal, weaponPool)`:
  - non-final → returns a **key** entity at `tile`.
  - final → returns a **golden treasure** entity at `tile` (random weapon from
    `weaponPool`, `victory: true`, `golden: true`).
- `countBosses(entities)` is unchanged.

### `renderer/game.js`
- `buildEntities`: handle `kind: 'exit_door'` → `makeExitDoor`. (Keys and the
  golden treasure are not generated at level-build time — they are created
  directly as entities by `spawnBossDrop` on boss death and pushed to
  `state.entities`, so they need no `buildEntities` case.)
- Boss-death block (the existing one near the end of `update`): when the boss is
  gone and the drop hasn't spawned, call `spawnBossDrop(lastBossTile,
  level >= FINAL_DEPTH, cfg.weapons)` and push the returned entity; set the
  `dropSpawned` flag. Remove the `spawnLevelExit`/`victoryTile` tile logic.
- Pickups/interactions in `update`:
  - key entity on the player's tile → set level `hasKey`, remove the key, log
    *"You picked up the key!"*.
  - exit-door entity on the player's tile → if `hasKey`, start the door opening
    animation, consume the key, and call `descendLevel()`; else log the locked
    message (throttled so it doesn't spam every frame).
  - golden treasure (`contents.victory`) on the player's tile → `endRun(true)`.
- Remove the old `STAIRS_DOWN` descend trigger and the `victoryTile` win check.
- `startNewRun` / `descendLevel`: initialize/reset `hasKey: false`,
  `dropSpawned: false`, `lastBossTile: null` (drop the `exitSpawned`/`victoryTile`
  fields).

### `renderer/render/canvas.js` + `renderer/render/sprites.js`
- Add a **key** sprite: pick an appropriate tile from the Kenney tiny-dungeon set
  (`assets/.../Tilesheet.txt`) and register it in `sprites.js`; render the `key`
  entity with it.
- Exit door renders via the existing `door_{frame}` frames; a locked door shows
  frame 0.
- Golden treasure: render the chosen weapon's item sprite with a gold tint
  (canvas `globalCompositeOperation`/overlay or a tint pass) when `golden` is set.

## Testing

Unit-testable (systems/data — the existing harness covers these):
- `progression.spawnBossDrop`: non-final returns a `key` entity at the tile;
  final returns a treasure entity carrying `victory: true`, `golden: true`, and a
  weapon type drawn from the pool.
- `map.generateLevel`: depths 1–4 include exactly one `exit_door` spawn on a
  walkable tile that is not the player spawn; depth 5 includes none; fallback at
  small L1/L2 sizes still yields an exit door and stays connected.
- `entities.makeKey` / `makeExitDoor` shape.

Not unit-tested (game.js shell — verified via `node --check` + green suite +
runtime Electron boot, per the project's testing boundary):
- key pickup sets `hasKey`; locked door blocks transition without key; door opens
  + descends with key; golden treasure wins on L5.
- Runtime check: on level 1, kill the crab, confirm a key drops, the door opens
  after pickup, and the player advances.

## Out of Scope

- A bespoke treasure asset/behavior for L5 (gold-tinted random weapon is an
  explicit placeholder).
- Doors that physically block a region (the exit door is the transition point, not
  a barrier sealing a sub-area).
- Multiple keys/doors per level.
