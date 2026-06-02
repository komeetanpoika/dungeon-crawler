# Fixed Corner Stairs Design

**Date:** 2026-06-02

## Summary

Replace room-anchored staircase passages with fixed-corner passages that protrude toward the map boundary. The entrance is always at the top-left corner; the exit is always at the bottom-right corner. Both connect to the dungeon via a corridor from the nearest room. Stair tiles are always rendered at full brightness regardless of FOV.

---

## Section 1 — Entrance passage (top-left)

**Fixed position:** center column `2`, rows `1`–`8`.

| Row | Tile | Notes |
|---|---|---|
| 1 | STAIRS_UP | Player spawn |
| 2–8 | STAIR (walkable) | |
| 9 | corridor endpoint | FLOOR, carved by `carveCorridor` from nearest room |

Player always spawns at `(2, 1)`. The passage protrudes toward the top-left map boundary (row 0 is the outer wall).

The opening from the dungeon into the passage: the corridor ends at `(2, 9)`, which is a plain FLOOR tile. No room wall needs to be opened.

Width is always 1 for the entrance passage (staircaseWidth not applied here).

---

## Section 2 — Exit passage (bottom-right)

**Fixed position:** center column `MAP_W − 3` = `77`, rows `MAP_H − 9` to `MAP_H − 2` = rows `41`–`48`.

| Row | Tile | stairDepth | Walkable |
|---|---|---|---|
| 41 | STAIR | 0 | yes |
| 42 | STAIR | 1 | yes |
| 43 | STAIR | 2 | yes |
| 44 | STAIR | 3 | yes |
| 45 | STAIRS_DOWN | 4 | yes |
| 46 | STAIR (void) | 5 | no |
| 47 | STAIR (void) | 6 | no |
| 48 | STAIR (void) | 7 | no |

The void tiles at rows 46–48 reach the map boundary (row `MAP_H − 2 = 48`). The darkness gradient (`stairDepth / 7 * 0.85`) applies as before.

The corridor from the nearest room connects to `(77, 40)` — the FLOOR tile directly above the passage.

For multi-column passages (`staircaseWidth = 2` at depth 6, `= 3` at depth 9), the center stays at column `77`; extra columns expand leftward (toward `x = 0`): column `76` for width 2, columns `75`–`77` for width 3.

---

## Section 3 — Dungeon connection

After carving each passage at its fixed position, carve a corridor from the nearest room center:

- **Entrance:** `carveCorridor(map, nearestRoom.cx, nearestRoom.cy, 2, 9)`
- **Exit:** `carveCorridor(map, nearestRoom.cx, nearestRoom.cy, 77, 40)`

"Nearest room" = the room whose center has the smallest Manhattan distance to the passage connection point.

These corridors replace the old concept of spawnRoom and stairsRoom driving passage position. The spawnRoom is still selected (closest to top-left, `r.y >= 4`) for entity/landmark purposes only — it no longer affects passage placement.

---

## Section 4 — Stair tiles always visible (FOV bypass)

In `canvas.js`, in the tile-rendering loop, stair tile types (`TILE.STAIR`, `TILE.STAIRS_UP`, `TILE.STAIRS_DOWN`) always render at full brightness regardless of `tile.visible` or `tile.explored`.

Implementation: in `drawScene` (or equivalent), before applying the FOV dim/skip, add a check:

```js
const isStairTile = t.tile === TILE.STAIR || t.tile === TILE.STAIRS_UP || t.tile === TILE.STAIRS_DOWN
if (!t.visible && !t.explored && !isStairTile) continue  // skip unvisited non-stair tiles
// draw tile — stair tiles always drawn at full brightness
if (!t.visible && !isStairTile) {
  // apply explored dim overlay as before
}
```

No changes to `computePlayerFOV`.

---

## File Map

| File | Change |
|---|---|
| `renderer/systems/map.js` | Replace `carveEntrancePassage` and `carveExitPassage` with fixed-corner versions; add corridor connection; remove passage-position logic from `spawnRoom`/`stairsRoom` selection |
| `renderer/render/canvas.js` | Stair tiles bypass FOV dim/skip |
| `test/map.test.js` | Update spawn and passage position tests for fixed coordinates |
