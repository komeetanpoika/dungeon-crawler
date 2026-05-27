# Dungeon Crawler — Design Spec
_2026-05-26_

## Overview

A turn-based stealth dungeon crawler built with Electron and HTML5 Canvas. The player descends through multiple dungeon levels — past guards, monsters, traps, and puzzles — to reach a dragon's lair on the final level and steal its treasure without waking it. Permadeath with roguelite milestone bonuses that persist across runs.

---

## Platform & Stack

| Concern | Choice |
|---|---|
| Shell | Electron (desktop, no install complexity) |
| Rendering | HTML5 `<canvas>`, vanilla JS ES modules |
| HUD | DOM overlay (thin top bar + bottom log strip) |
| Save I/O | JSON file via `contextBridge` (main process handles FS) |
| Tests | `node:test` for pure logic modules |

No bundler required to start. Vite can be introduced later if module ergonomics become painful.

---

## Project Structure

```
dungeon-crawler/
├── main.js                  # Electron main — window creation, save file I/O
├── preload.js               # contextBridge: exposes saveRun / loadRun / loadMeta / saveMeta
├── renderer/
│   ├── index.html           # Shell: <canvas> + HUD divs
│   ├── game.js              # Entry point — init, input, main turn loop
│   ├── systems/
│   │   ├── map.js           # Hybrid map generation (BSP + hand-crafted templates)
│   │   ├── stealth.js       # Noise map, FOV sight lines, alert state machine
│   │   ├── turn.js          # Turn queue, action resolution, dragon sleep meter
│   │   ├── entities.js      # Player, guards, monsters, traps, dragon definitions
│   │   └── meta.js          # Milestone bonus tracking, serialisation
│   ├── render/
│   │   ├── canvas.js        # Tile + entity drawing, dirty-tile optimisation, camera
│   │   └── hud.js           # Updates top bar and log strip DOM elements
│   └── data/
│       ├── levels.js        # Hand-crafted room templates (dragon lair, shrine, vault…)
│       └── items.js         # Item and ability definitions
└── test/
    ├── map.test.js
    ├── stealth.test.js
    ├── turn.test.js
    └── meta.test.js
```

---

## Core Systems

### Map System

Each level is a 2D `Tile[][]` grid. Generation runs in two passes:

1. **Template placement** — hand-crafted rooms are placed first at fixed relative positions. The dragon's lair always occupies the deepest corner of the final level. Other landmarks (shrine, locked vault) appear at fixed depth milestones.
2. **BSP fill** — a binary space partitioning pass fills remaining space with procedural rooms and corridors. Difficulty parameters (room density, enemy count, trap frequency) scale linearly with depth.

After generation a flood-fill reachability check validates that all rooms are connected. If not, generation retries up to 5 times before falling back to a simpler guaranteed-connected template.

### Turn System

Strictly sequential:
1. Player inputs a key → action resolved → `GameState` mutated
2. Stealth system recalculates noise map and guard sight lines
3. Each entity acts in initiative order → `GameState` mutated
4. Dragon sleep meter updated
5. Renderer redraws dirty tiles, HUD DOM updated

Each player action (move, wait, interact, use item) consumes the player's turn. Traps react to movement events, not the turn clock.

### Stealth System

Three layers:

- **Noise** — every action emits a noise value. Moving = low, interacting = medium, attacking/triggering a trap = high. Noise radiates outward on the tile grid each tick and decays by a fixed amount per turn. Walls block propagation.
- **Sight lines** — guards have a directional FOV cone (angle + range configurable per guard type). Line-of-sight is raycasted on the tile grid; walls and closed doors block it. Darkness tiles reduce effective range.
- **Alert states** — guards cycle through `unaware → curious → searching → alerted`. Curious is triggered by noise within hearing radius; searching causes the guard to move toward the last heard noise origin; alerted propagates to nearby guards. The dragon has its own meter: `sleeping (0–60) → stirring (61–90) → awake (91–100)`. The meter rises with cumulative noise emitted inside its room and falls by 1 each turn no noise is present. Reaching 100 ends the run.

### Entity Definitions

| Entity | Key properties |
|---|---|
| Player | position, HP, inventory (max 5 slots), noise_footprint, active_bonuses |
| Guard | position, facing, fov_angle, fov_range, patrol_path[], alert_state, hearing_radius |
| Monster | position, wander_radius, alert_state, hearing_radius (no patrol) |
| Trap | position, type (pressure_plate / tripwire), triggered, noise_burst |
| Puzzle | position, type (lever / combination_lock / pressure_sequence), solved, reward |
| Dragon | position (fixed), sleep_meter 0–100, room_id |

### Meta-Progression

On death, the game records the deepest level reached in the run. Specific depth milestones unlock a permanent passive bonus for all future runs:

| Milestone | Example bonus |
|---|---|
| Reach level 3 | Quieter footsteps (−1 move noise) |
| Reach level 6 | Extra inventory slot |
| Reach level 9 | Starting consumable each run |
| Steal the treasure | Unlock a new character variant |

Milestone data is stored in a separate JSON file from run state so it survives permadeath.

---

## Game State Shape

```js
GameState {
  level: number,
  map: Tile[][],          // dirty flag per tile for render optimisation
  entities: Entity[],
  player: Player,
  turnCount: number,
  log: string[],          // ring buffer, last 5 messages shown in bottom strip
  run: {
    deepestLevel: number,
    treasureStolen: boolean,
  }
}
```

State is a single plain object mutated in place each turn. The renderer reads it at the end of each turn and redraws only tiles with `dirty = true`.

---

## UI Layout

```
┌─────────────────────────────────────────────────┐
│  LVL 3   HP ████░░   NOISE ██░░░░   🗡 2 🔑 1 🧪 3  │  ← top bar (DOM)
├─────────────────────────────────────────────────┤
│                                                 │
│                  [ canvas ]                     │
│                                                 │
├─────────────────────────────────────────────────┤
│  You move north. A guard stirs nearby…          │  ← log strip (DOM)
└─────────────────────────────────────────────────┘
```

Both strips are DOM elements positioned above/below the canvas. The canvas fills all remaining vertical space. The noise meter is the primary stealth feedback signal.

---

## Error Handling

- **Save file corruption** — on load, validate JSON schema. If invalid, discard run state and start fresh, but preserve the milestone bonus file (stored separately).
- **Map generation failure** — after 5 failed reachability checks, fall back to a minimal hand-crafted template for that level.
- No async paths in the game loop, so no meaningful error surface beyond the above two cases.

---

## Testing

Pure logic modules (`map.js`, `stealth.js`, `turn.js`, `meta.js`) are written as functions that take state and return state, tested with `node:test`. No UI test framework.

A `--debug` CLI flag exposes a dev overlay on the canvas: noise heatmap, guard FOV cones, tile coordinates, and turn counter.

---

## Win & Lose Conditions

- **Win** — player reaches the treasure tile in the dragon's lair while `dragon.sleep_meter < 100`
- **Lose (death)** — player HP reaches 0, or `dragon.sleep_meter` reaches 100
- On lose: run ends, milestone progress saved, bonuses applied, new run starts from level 1
