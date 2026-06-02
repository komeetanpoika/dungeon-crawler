# Staircase Rework Design

**Date:** 2026-06-02

## Summary

Rework the staircase passages so they descend into an impassable void of darkness, auto-trigger level descent on step (no Enter key), spawn the player at the top of the entrance passage on the next level, and guarantee the passage is surrounded only by wall tiles.

---

## Section 1 — Exit passage structure

12 tiles carved south of the stairsRoom's south wall (up from 8):

| Tiles | Type | Walkable |
|---|---|---|
| 1–7 | STAIR | yes |
| 8 | STAIRS_DOWN (auto-trigger) | yes |
| 9–12 | STAIR (void zone) | no |

Each STAIR tile gets a `stairDepth` field (0-indexed from the room's south wall). `stairDepth` drives the darkness overlay in rendering. Void zone tiles carry `voidZone: true` — `isWalkable` returns false for any tile with this flag. No new tile constant is needed.

The south wall tile of stairsRoom at `cx` is opened to `TILE.FLOOR` (existing behaviour, unchanged).

---

## Section 2 — Placement isolation

When selecting `stairsRoom` in `generateLevel`, add a clearance filter before accepting any candidate:

- Compute `cx = center(room).x` and `half = Math.floor((width - 1) / 2)`
- Check that every tile in the rectangle `[cx - half - 1 … cx + half + 1, room.y + room.h - 1 … room.y + room.h + 13]` is `TILE.WALL` at the time of selection (before carving)
- Only rooms that pass become candidates
- Fall back to the existing pool (farthest from spawn) if no room passes — preserves behaviour on very dense maps

Same isolation check applies to the entrance passage: when confirming `spawnRoom`, verify the rectangle `[cx - half - 1 … cx + half + 1, spawnRoom.y - 13 … spawnRoom.y + 1]` is entirely `TILE.WALL`.

---

## Section 3 — Auto-trigger

Remove the `keys['Enter'] &&` guard from the STAIRS_DOWN check in `game.js`. The check already runs every game tick — stepping on STAIRS_DOWN fires `descendLevel()` immediately.

```js
// before
if (keys['Enter'] && map[player.y]?.[player.x]?.tile === TILE.STAIRS_DOWN) {

// after
if (map[player.y]?.[player.x]?.tile === TILE.STAIRS_DOWN) {
```

---

## Section 4 — Darkness gradient

In `canvas.js`, after drawing the STAIR or STAIRS_DOWN sprite, draw a black `fillRect` overlay:

```js
const depth = tileObj?.stairDepth ?? 0
const alpha = Math.min(depth / 11, 1.0) * 0.85
ctx.fillStyle = `rgba(0,0,0,${alpha})`
ctx.fillRect(px, py, S, S)
```

Tile depth 0 → ~0% black. Tile depth 11 → 85% black. Void zone tiles (depth 8–11) range from ~60–85%, trailing off into near-blackness.

`stairDepth` is written onto every STAIR and STAIRS_DOWN tile during `carveExitPassage`. The STAIRS_DOWN tile gets `stairDepth = 7` (last walkable). Void zone tiles get depths 8–11.

---

## Section 5 — Entrance spawn

`carveEntrancePassage` currently returns `{ x: sc.x, y: spawnRoom.y - 1 }` (bottom of passage, one step above spawn room). Change to return `{ x: sc.x, y: topRow }` — player spawns at the STAIRS_UP tile at the top of the passage and walks south into the dungeon.

---

## File map

| File | Change |
|---|---|
| `renderer/systems/map.js` | `carveExitPassage`: 12 tiles, void zone, stairDepth; isolation check in stairsRoom selection; entrance isolation check; entrance spawn returns topRow |
| `renderer/systems/entities.js` | `isWalkable`: return false for tiles with `voidZone: true` |
| `renderer/render/canvas.js` | STAIR/STAIRS_DOWN: draw black overlay using stairDepth after sprite |
| `renderer/game.js` | Remove `keys['Enter'] &&` from STAIRS_DOWN check |
| `test/map.test.js` | Update passage structure tests for new 12-tile layout and void zone |
