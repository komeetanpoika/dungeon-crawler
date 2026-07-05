# Enemy Pathfinding & Movement AI — Design

**Date:** 2026-07-05
**Status:** Approved design, pending implementation plan

## Problem

Every enemy currently moves in a straight line toward the player's pixel
position (`game.js` enemy loop; `crab.js`, `cyclops.js` etc. do the same
inside their state machines). Consequences:

- Enemies press into walls, columns, and doorway edges whenever the player
  is not in a direct walkable line ("stuck on geometry").
- When line of sight breaks, enemies instantly forget the player and revert
  to random wander — no pursuit.
- Idle behavior is random-direction wander, not purposeful patrol.
- No retreating or distance-keeping: ranged enemies stand still, hurt
  enemies fight to the death.
- Multiple enemies stack onto the same tile in a single-file line.

## Goals

1. **Unstick:** enemies route around obstacles toward their target.
2. **Hunt:** on losing sight, pursue the player's last known position
   before giving up.
3. **Smarter combat movement:** wall-aware strafing, enemy separation.
4. **Patrol:** auto-generated patrol loops between nearby points of
   interest when idle.
5. **Flee/kite:** per-enemy configurable distance-keeping and retreat.

Non-goals (this pass): noise/stealth investigation (the `noiseFootprint`
hook stays unused), hand-authored patrol waypoints in the tile editor.

## Chosen approach

**Flow field + A\* hybrid** (user-selected over pure per-enemy A\* and
steering-only alternatives):

- A **Dijkstra flow field** flooded from the player's tile serves all
  player-directed movement. Chasers descend it; fleeing/kiting enemies
  ascend it. Rebuilt lazily only when the player changes tile (same
  caching pattern as `maybeComputeFOV`).
- **Clearance-aware A\*** serves every other target: patrol waypoints,
  last-known player positions, arbitrary entities. Paths cache and
  recompute only when the destination tile changes or a 0.5 s repath
  timer expires (moving-target compensation).

## Architecture

Three new modules in `renderer/systems/`, pure-logic core kept free of
game-state imports:

### `nav.js` — navigation core (pure)

- `buildNavGrid(map)` — once per map, cached on the map object:
  walkability + per-tile **clearance** (distance to nearest blocker).
  Two clearance classes: *normal* (entity half ≤ 16 px) and *large*
  (cyclops half 28 px, dragon boss). Wide enemies are never routed
  through gaps they cannot fit.
- `buildFlowField(nav, targetTile, clearanceClass)` — Dijkstra flood.
  The large-clearance field is built only while a large enemy is alive.
- `findPath(nav, fromTile, toTile, half)` — clearance-aware A\*
  returning tile waypoints.
- Helpers to descend/ascend a field and to line-of-sight-skip waypoints
  (path smoothing, no zigzag).

### `brain.js` — perception and intent

Tracks each enemy's **object of interest** (any entity or tile position —
the API is target-agnostic; this pass uses the player, last-known
positions, and patrol waypoints):

- **Spot:** player within per-enemy sight range + LOS → chase (flow
  field). Replaces the flat 180 px `CHASE_RANGE`.
- **Lose:** LOS breaks → hunt to last seen tile via A\*; on arrival
  without re-spotting, pause briefly, then give up → patrol.
- **Patrol:** default idle state. On spawn / giving up, pick 2–4
  reachable tiles near notable features within a patrol radius (doors,
  treasure, shrines, decorations; fallback: random reachable room
  tiles) and rotate between them with a dwell pause at each. Patrol
  legs use A\*.

Output is an **intent** object; brain.js never moves anything.

### `act.js` — movement brain

Single entry point:

```js
act(e, state, delta, { mode, speed, range, ... })
```

Named-parameter intents (not positional arrays) for readable call sites.
Modes:

| Mode | Behavior |
|---|---|
| `approach` | Descend flow field / follow A\* path until within attack range. |
| `kite` | Keep distance band `[min, max]`: below min → ascend field; above max → approach; inside → strafe. Default for shooting spider and wizard. |
| `flee` | Ascend flow field. If cornered (no uphill neighbor), turn and fight. |
| `strafe` | Orbit target at current distance; wall-aware; flips direction on obstruction. Crab's 30/70 blend becomes parameters of this mode. |
| `charge` | Straight-line dash, deliberately NOT pathfound (charging into a wall and self-stunning is a feature). |
| `patrol` | Follow patrol route waypoints with dwell pauses. |
| `hold` | Stand still (windups, grabs). |

`act` applies enemy-vs-enemy **separation steering** (groups fan out
instead of stacking) and performs the actual `canMoveTo` collision moves.

### Per-enemy config table (data, not code)

Per enemy type: `speed`, `half` (collision half-size), `sightRange`,
`kiteBand` (nullable), `fleeHpFraction` (nullable), `taxon`
(`humanoid` | `mammal` | `beast` | `construct` | ...), strafe params.
**Low-HP fleeing defaults on only for `humanoid` and `mammal`.** Any
enemy can be tuned to kite/flee via config alone.

### Integration

- Basic monsters + guards (`game.js` shared enemy loop): replaced
  wholesale by brain + act.
- Crab, cyclops, wizard, dragon boss: keep their signature state
  machines (grab, charge, slam, summon); only their raw
  "vector-at-player" movement lines are replaced with `act()` calls.

## Edge cases

- **Unreachable target** (e.g. across a void zone): fall back to direct
  steering for a few seconds, then give up to patrol. Never re-run A\*
  every frame on a hopeless goal.
- **Enemy overlapping geometry** (bad spawn, knockback): moves that
  *reduce* penetration are always permitted — no permanent wedging.
- **Wide enemies vs. flow field:** the large-clearance field treats
  narrow gaps as walls, so descent never leads through an unpassable
  doorway.
- **State-machine priority:** `act` is skipped while an enemy is in a
  non-movement state (grabbing, slamming, stunned, knockback slide).
- **Performance:** nav grid once per map; flow field only on player
  tile change; per-enemy A\* throttled (destination tile change or
  0.5 s). Worst case per frame: a handful of small grid floods.

## Testing

- **Unit (`node:test`, one file per system):**
  - `test/nav.test.js` — grid/clearance correctness; A\* routes around
    a column; flow-field descent reaches player; ascent increases
    distance; large-clearance field rejects narrow gaps.
  - `test/brain.test.js` — spot → hunt → give-up → patrol transitions;
    generated patrol points are reachable; kite band decisions; flee
    threshold honors taxon.
- **Live (arena-test skill):** arena runs asserting: enemy behind a
  column reaches the player; spider kites; guard flees at low HP; crab
  strafes around obstacles. Journal criteria written before each run
  per the skill's rules.
