# Staircase Passages Design

**Date:** 2026-06-01

## Summary

Replace the current flat stair tiles and 5×3 alcove with carved staircase passages — narrow corridors that enter/exit through room walls and fade into darkness over 8 tiles. Width scales with depth to telegraph boss and final levels.

---

## Section 1 — Width per depth

`LEVEL_CONFIG` gains a `staircaseWidth` field. Both the entrance passage (stairs-up) and exit passage (stairs-down) use the same width at each depth.

| Depth | Width | Rationale |
|---|---|---|
| 1–5 | 1 | Normal levels |
| 6 | 2 | Cyclops boss |
| 7–8 | 1 | Post-boss, back to normal |
| 9 | 3 | Dragon — final level |

Default (used if field absent): 1.

---

## Section 2 — Tiles and rendering

### New tile constant

`TILE.STAIR = 11` — staircase passage tile. Walkable: `isWalkable` already returns true for anything that isn't WALL (0) or COLUMN (8), so no change to `isWalkable` needed.

### Sprite assignment

| Width | Tiles used |
|---|---|
| 1 | tile_0039 × 1 |
| 2 | tile_0039 × 2 |
| 3 | tile_0036 (left) + tile_0037 (mid) + tile_0038 (right) |

Sprites added to `sprites.js`:
- `stair`:       tile_0039
- `stair_left`:  tile_0036
- `stair_mid`:   tile_0037
- `stair_right`: tile_0038

### Transition tiles

- `TILE.STAIRS_UP` (value 4) — placed at the very top tile of the entrance passage. Not a gameplay trigger (no ascending). Rendered as `sprites.stairs_up` (tile_0057) — kept as landmark.
- `TILE.STAIRS_DOWN` (value 3) — placed at the first (topmost) tile of the exit passage. Player stands on it and presses Enter to descend. Rendered as `sprites.stairs_dn` (tile_0056).

### `drawTile` additions in canvas.js

```js
case TILE.STAIR: {
  // width-aware: use stair_left/mid/right for w=3, stair for w=1 or w=2
  // tile column position within passage is stored in map[y][x].stairCol (0-indexed)
  const col = map[y]?.[x]?.stairCol ?? 0
  const w   = map[y]?.[x]?.stairWidth ?? 1
  if (w === 3) {
    const key = col === 0 ? 'stair_left' : col === 1 ? 'stair_mid' : 'stair_right'
    if (sprites[key]) ctx.drawImage(sprites[key], px, py, S, S)
  } else {
    if (sprites.stair) ctx.drawImage(sprites.stair, px, py, S, S)
  }
  return
}
```

`stairCol` and `stairWidth` are extra fields written onto the tile object during map generation.

### FOV and darkness

No special gradient rendering needed. The passage is 8 tiles long — exactly one FOV radius. Standing at the entrance, the player can see the full passage; tiles beyond are in natural darkness. Explored tiles show the stair sprite; unexplored tiles are dark as normal.

---

## Section 3 — Map placement

### Entrance passage (stairs-up)

1. Use `spawnRoom` (closest to top-left with `room.y >= 4`, unchanged).
2. Center x: `cx = center(spawnRoom).x`
3. Passage column(s): `cx - Math.floor((width-1)/2)` … `cx + Math.floor(width/2)`
4. Carve rows `spawnRoom.y - 8` to `spawnRoom.y - 1` as `TILE.STAIR` for passage columns; walls on all other columns.
5. Place `TILE.STAIRS_UP` at row `spawnRoom.y - 8`, passage columns center.
6. Clamp all rows to map bounds (`>= 1`).
7. Player spawns at `{ x: cx, y: spawnRoom.y - 1 }` — bottom tile of passage, one step above the spawn room.

The old `carveAlcove` function is replaced by `carveEntrancePassage`.

### Exit passage (stairs-down)

1. Use `stairsRoom` (farthest from spawn, generally south), unchanged.
2. Center x: `cx = center(stairsRoom).x`
3. Carve rows `stairsRoom.y + stairsRoom.h - 1` to `stairsRoom.y + stairsRoom.h + 7` (8 tiles going south) as `TILE.STAIR` for passage columns; walls on other columns.
4. Place `TILE.STAIRS_DOWN` at row `stairsRoom.y + stairsRoom.h - 1` (passage entrance — the first tile the player steps on).
5. Clamp all rows to `< map.height - 1`.

The opening from the stairs room into the passage: the south wall tile of `stairsRoom` at `cx` is set to `TILE.FLOOR` (carved open).

---

## File Map

| File | Change |
|---|---|
| `renderer/systems/entities.js` | Add `TILE.STAIR = 11` (no change to `isWalkable` needed) |
| `renderer/data/levels.js` | Add `staircaseWidth` to each `LEVEL_CONFIG` entry |
| `renderer/systems/map.js` | Replace `carveAlcove` with `carveEntrancePassage`; add `carveExitPassage`; update stair placement in `generateLevel` |
| `renderer/render/sprites.js` | Add `stair`, `stair_left`, `stair_mid`, `stair_right` |
| `renderer/render/canvas.js` | Add `TILE.STAIR` case to `drawTile` |
| `test/map.test.js` | Update stair placement tests for new passage structure |
