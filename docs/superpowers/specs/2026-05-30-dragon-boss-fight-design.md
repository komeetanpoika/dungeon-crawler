# Dragon Boss Fight Design

**Date:** 2026-05-30

## Summary

Add a puzzle-based fight mechanic to the dragon final boss on level 9. The player must intentionally wake the dragon, lure it onto a snare tile that forces it to collapse back into sleep, then deal HP damage during the resulting window. The dragon has 12 HP and can only be damaged while sleeping. This can require multiple snare cycles depending on the player's weapon.

---

## Section 1 — Data model

**File:** `renderer/systems/entities.js`

New tile constant:
- `TILE.SNARE` — a floor tile with special dragon-interaction behavior. Renders as a distinct cyan-tinted rune so the player can identify it visually.

`makeDragon` gains three new fields:
- `hp: 12` — dragon's current HP
- `maxHp: 12` — dragon's maximum HP; used for the HP bar ratio
- `snareTimer: 0` — counts down how many turns the snare is still forcing sleep
- `inCombat: false` — set to `true` when the player first lands a strike; enables HP bar display

**File:** `renderer/data/levels.js`

The `DRAGON_LAIR` template is replaced with a larger organic cave cluster (~24×22 tiles). The plain rectangle is gone. Structure:

- **Upper section** — three small, irregular cave pockets (left, right, and center), each a different shape. Connected by narrow 1–2 tile passages.
- **Mid section** — the passages funnel into a single corridor that drops into the main chamber entrance.
- **Main chamber** — a grand tapered form: wide in the middle, narrowing toward both ends, walls jutting in unevenly. Two `C` (column) tiles flank the snare tile mid-room. Dragon is in the upper half of the chamber, snare below it, treasure in the lower taper.

Rough structural sketch (proportional, not the exact template string — that is finalized in the implementation plan):

```
##[cave A]####[cave B]##
#######.#####.#########   ← narrow passages
########.###.##########
#####[cave C]##########   ← center cave
##########.############   ← funnel into main
####..................##
###...D...............#   ← dragon
##....C....X....C.....#   ← columns + snare
###...T...............#   ← treasure
#####...............###
########.........######
```

Template characters used:
- `#` wall, `.` floor, `D` dragon, `X` snare, `T` treasure, `C` column

**File:** `renderer/systems/map.js`

The `placeTemplate` parser gains two new handlers:
- `'X'` → `TILE.SNARE` (floor tile marked as snare)
- `'C'` → `TILE.COLUMN` (column tile, same visual as existing columns in generated rooms)

**File:** `renderer/render/canvas.js`

`drawTile` handles `TILE.SNARE`: draws the tile as a cyan-tinted floor (e.g., `rgba(0, 200, 200, 0.35)` overlay on top of the normal floor sprite).

---

## Section 2 — Snare mechanics

**File:** `renderer/game.js`

When `stepDragon` moves the dragon onto a `TILE.SNARE` tile, set:
- `snareTimer = 10`
- `dragonState = DRAGON_STATE.SLEEPING`

Each turn, if `dragon.snareTimer > 0`:
- Skip `updateDragonSleep` entirely — noise cannot wake the dragon
- Decrement `snareTimer` by 1
- Force `dragonState = DRAGON_STATE.SLEEPING`

When `snareTimer` reaches 0, normal sleep/wake logic via `updateDragonSleep` resumes.

The snare is reusable — the dragon can be lured onto it multiple times in the same fight. It does not burn out.

Player flow:
1. Make noise to wake the dragon (existing mechanic)
2. Run across the snare tile — dragon chases and steps onto it
3. Ten-turn window to reach and strike the sleeping dragon
4. If the window expires before the dragon dies, wake it and repeat

---

## Section 3 — Dragon combat

**File:** `renderer/systems/turn.js`

`resolvePlayerAction` currently ignores the dragon in the blocker check. Extend the blocker filter to include `e.type === 'dragon'`.

**When the player bumps into the dragon:**

- If `dragonState === DRAGON_STATE.SLEEPING`:
  - Deal `player.weapon.damage` to dragon
  - Set `inCombat: true` on dragon
  - Log: `"You strike the sleeping dragon for X damage!"`
  - If dragon HP reaches 0: remove from entities, log `"The dragon collapses! The treasure is yours!"`, player is blocked from moving onto the tile (dragon is gone next turn)
  - If player has no weapon: log `"You need a weapon to fight!"`, no movement

- If `dragonState === DRAGON_STATE.STIRRING` or `DRAGON_STATE.AWAKE`:
  - Log: `"The dragon is too alert — you can't get close!"`
  - No damage, no movement into the tile

**File:** `renderer/game.js`

- Dragon's existing attack (3 HP when AWAKE and adjacent) remains unchanged.
- When dragon HP reaches 0: call `hideDragonMeter()`.
- `snareTimer` decrement happens at the top of dragon turn processing, before `updateDragonSleep`.
- The snare check happens in `game.js` after `stepDragon` returns the updated dragon: `if (map[newDragon.y][newDragon.x].tile === TILE.SNARE)` → set `snareTimer = 10` and `dragonState = DRAGON_STATE.SLEEPING`. This keeps `stepDragon` in `turn.js` pure (no map tile reads needed there).
