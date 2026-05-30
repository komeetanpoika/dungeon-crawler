# Enemy HP Bar Design

**Date:** 2026-05-30

## Summary

Display a solid colored HP bar above enemies while they are in combat. The bar is invisible when enemies are at peace, keeping the screen clean during exploration.

---

## Section 1 — Data model

**File:** `renderer/systems/entities.js`

Two entity factories gain new fields:

- `makeGuard` — add `maxHp: 4` and `inCombat: false` alongside the existing `hp: 4`
- `makeMonster` — add `maxHp: stats.hp` (mirrors the `hp` value drawn from `MONSTER_VARIANTS`) and `inCombat: false`

The dragon has no HP stat and is excluded. No other entity types (trap, puzzle, chest, door, weapon, potion) need these fields.

---

## Section 2 — Combat state transitions

### Entering combat

**`renderer/systems/turn.js` — `resolvePlayerAction`:**
When the player attacks a blocker (the `blocker.hp - dmg` block), set `inCombat: true` on the updated entity before writing it back to `newEntities`. Applies to both guards and monsters.

**`renderer/game.js` — `processTurn`:**
When alerted guards adjacent to the player deal damage (the `attackers` block), set `inCombat: true` on each attacking guard at the same time as the damage is applied.

### Leaving combat

**`renderer/game.js` — `processTurn`:**
After the `alertedEntities` map (the `updateGuardAlert` pass), do a follow-up pass that clears `inCombat: false` on any guard whose `alertState` is no longer `ALERT.ALERTED`.

Monsters have no alert-state update loop, so they remain `inCombat` until killed or the level changes. On level descent, entities are fully rebuilt, so `inCombat` resets naturally.

### Caveat — guard un-alerting

`updateGuardAlert` in `stealth.js` currently never drops a guard from `ALERTED` back to a lower state — once alerted, always alerted. The exit condition above is correctly wired to `alertState`, but will only fire when a future change adds cooldown/un-alerting logic to `updateGuardAlert`. No action needed in this spec.

---

## Section 3 — Rendering

**File:** `renderer/render/canvas.js`

Add a `drawHealthBars(ctx, entities, map, camX, camY, S)` function. Call it in `Renderer.render()` after the entity loop, before hit effects — this ensures bars render on top of sprites but under the hit flash.

**Visibility gate:** same check as the entity loop — skip if `!map[e.y]?.[e.x]?.visible`.

**Eligibility:** skip entities where `!e.inCombat`, `e.hp === undefined`, or `e.maxHp === undefined`. Also skip `type === 'player'` (player HP is handled by the HUD).

**Bar dimensions:**
- Width: `S` (32px, full tile width)
- Height: 4px
- Position: 3px above the top edge of the sprite (`py - 7` where `py` is the sprite top)

**Colors** based on `ratio = e.hp / e.maxHp`:
- `ratio > 0.6` → green `#22c55e`
- `ratio > 0.3` → yellow `#facc15`
- otherwise → red `#ef4444`

**Background:** dark gray `#111`, full tile width, drawn first. No border — the dark background provides sufficient contrast against dungeon tiles.
