# Fireball Wand — Design

**Date:** 2026-07-24
**Status:** Approved for planning

## Summary

A new deep-tier ranged weapon: the **Fireball Wand**. It fires a projectile that
detonates on enemy impact, on hitting a wall, or after traveling 10 tiles.
The detonation flood-fills up to 16 walkable tiles with fire (gas-like: blocked
by walls, spills around corners), dealing an initial burst of damage and then
lingering tick damage. Fire damages **everyone** standing in it — enemies and
the player alike.

## Goals

- Add an AoE ranged option that rewards positioning and punishes point-blank use.
- Keep the implementation consistent with existing patterns: pure system module
  (like `shockwave.js`), orchestration in `game.js`, drawing in `canvas.js`.
- Fully unit-test the flood-fill and tick logic with `node:test`.

## Non-goals

- No generic hazard-tile framework (lava/poison later, if ever). Fire is bespoke.
- No changes to the stance system, ammo economy, or other ranged weapons.
- No enemy use of the wand.

## 1. The weapon

New entry in `RANGED_WEAPON_TYPES` (`renderer/systems/entities.js`):

```js
firewand: { name: 'Fireball Wand', damage: 4, maxAmmo: 5, cooldown: 1.0,
            color: '#f97316', kind: 'wand', explodes: true }
```

- Added to `RANGED_POOLS.deep` in `renderer/systems/loot.js` — depth 3+ chests
  roll it alongside Longbow and Storm Wand (each 1-in-3 of the 25% ranged slot).
- `makeRangedContents` copies `explodes` onto the chest contents / equipped
  weapon; `tryFire` (`renderer/systems/ranged.js`) returns it in the shot stats
  so `game.js` can stamp it onto the projectile.
- Firing UX is unchanged: Shift toggles stance, Space fires, ammo and cooldown
  gate as they do for every ranged weapon.

## 2. Projectile & detonation

The spawned projectile carries `explodes: true` and `maxDist: 10 * TILE_SIZE`
(`distTraveled` starts at 0, reusing the existing spider-shot mechanism).

Detonation triggers — any of the three, whichever happens first:

| Trigger | Current behavior | New behavior for `explodes` projectiles |
|---|---|---|
| Enemy hit (radius-8 check) | enemy takes `damage`, projectile dies | same direct hit, **then** detonate at the projectile's tile |
| Wall / unwalkable tile | projectile silently vanishes | detonate on the **last walkable tile** the projectile occupied |
| `maxDist` reached (10 tiles) | projectile vanishes | detonate in flight at the current tile |

Detonation position is the projectile's pixel position snapped to its containing
tile (for the wall case: the last walkable tile, tracked per-frame on the
projectile).

**Special entities:**

- **Dragon boss** keeps full ranged immunity: the projectile passes over it
  without detonating (existing rule), and the boss ignores burst and tick
  damage.
- **Shielded wizard** (`shieldTimer > 0`) blocks the direct projectile hit
  (existing rule) but **does** take burst and tick damage — the fireball is the
  counter-tool to the shield. The blocked hit still detonates the projectile.

## 3. The blast — flood fill + burst

New module `renderer/systems/fire.js`, pure logic (no game.js imports beyond
shared helpers):

```js
computeBlastTiles(map, tileX, tileY, count = 16) → [{x, y}, ...]
```

- 4-neighbor BFS from the detonation tile through walkable tiles
  (`isWalkable`, which already excludes walls, columns, and void zones).
- Collects tiles in BFS order until `count` tiles are filled or the reachable
  space is exhausted (a small closet may burn fewer than 16).
- Gas-like: never crosses walls; spills around corners and down corridors.
- If the detonation tile itself is unwalkable (shouldn't happen given the
  last-walkable-tile rule, but defensively): return an empty list — no blast.

**Burst:** on detonation, every enemy and the player whose position (tile of
`px/py`) is on a blast tile takes **4 damage** immediately. Player damage goes
through `damagePlayer(state, 4, 'hit', ...)`. Enemies killed by the burst are
filtered out the same way projectile kills are. Dragon boss is skipped.

## 4. Lingering fire

`state.fireZones` — array of zones, each:

```js
{ tiles: [{x, y}, ...], age: 0, tickTimer: 1.0 }
```

- A zone lasts **3 seconds** (`age` accumulates `delta`; zone removed at 3.0).
- `tickTimer` counts down; every **1.0 s** the zone deals **1 damage** to every
  enemy and the player standing on one of its tiles (3 ticks over a full
  lifetime for something standing in the fire the whole time).
- Pure updater in `fire.js`:

  ```js
  updateFireZones(zones, entities, player, delta)
    → { zones, enemyDamage: Map<entity, dmg>, playerDamage: number }
  ```

  `game.js` applies the results: `damagePlayer(state, n, 'dot',
  "You're burning! (-1 HP)")` for the player, hp deduction + `inCombat: true`
  + dead-enemy filtering for entities. Dragon boss is skipped.
- Overlapping zones tick independently (each has its own timer). At 5 ammo and
  a 1 s cooldown, stacking is rare enough not to special-case.

## 5. Rendering

In `renderer/render/canvas.js`:

- **Blast flash:** on detonation push an effect reusing the shockwave-ring
  pattern (`state.shockwaves`-style entry or a parallel `blastEffects` list),
  drawn in orange (`#f97316` → `#fbbf24` gradient), ~0.35 s.
- **Burning tiles:** for each zone tile, flickering flame — layered orange/red
  shapes with per-tile phase offset (seeded by tile coords so it doesn't strobe
  uniformly). Fade out over the final ~0.7 s of the zone's life.
- **Projectile:** existing wand-bolt rendering, color `#f97316`. No new sprite.

HUD: no changes beyond what the ranged HUD already shows (name, damage, ammo).

## 6. Testing

`test/fire.test.js` (`node:test`):

- Flood fill: open-room shape (BFS diamond), corridor spill around a corner,
  wall blocking, closet truncation (<16 tiles), void-zone exclusion, unwalkable
  origin → empty.
- Ticks: 3 ticks over 3 s for an entity standing still in the zone; zone
  expires at 3 s; entity outside tiles takes nothing; player and enemy both
  damaged; dragon boss skipped.
- Burst helper (if extracted): entities on/off blast tiles.

Extensions to existing suites:

- Loot: deep pool (depth ≥ 3) can roll `firewand`; shallow pool cannot.
- Ranged: `tryFire` passes `explodes` through; `makeRangedContents('firewand')`
  carries the flag.

Live verification: **one short `arena-test` run** (per journal discipline):
fire into a corridor — confirm corner spill, self-damage when standing in
fire, enemy burn ticks. Time-boxed; logic paths rely on unit coverage.

## Decisions log

- **Fill shape:** flood-fill (gas-like), not fixed radius — user choice.
- **Friendly fire:** full — burst and ticks damage the player.
- **Fire profile:** short & hot — 3 s duration, 1 dmg/s ticks, 4 burst.
- **Loot:** deep-tier rare — 5 charges, 1.0 s cooldown, deep pool only.
- **Architecture:** dedicated pure `fire.js` module (Approach A), mirroring
  `shockwave.js`; no generic hazard framework.
