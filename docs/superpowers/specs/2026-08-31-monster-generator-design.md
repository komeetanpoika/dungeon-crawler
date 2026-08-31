# AI-Assisted Monster Generator — Design

**Date:** 2026-08-31
**Status:** Approved design, pending implementation plan

## Goal

The second asset-generator sub-project (the first was the 16×16 tile
generator, 2026-06-11). A pipeline for creating **full game enemies** —
visuals, stats, and behavior — as parametric, canvas-drawn monsters in the
style of the dragon boss (`renderer/render/dragonboss.js`), iterated through
AI conversation (Claude Code in the terminal) and hand-tweaked via sliders in
a live browser tuner.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Output | **Full game enemy** — renderer + stats + AI wiring; the tool's output spawns and fights in dungeons. |
| AI location | **Claude Code drives it.** The tool is a live preview/tuner; the user describes monsters in the terminal, Claude edits rig code/params, the preview hot-reloads. No API key, no chat UI. |
| Representation | **Rig library + escape hatch.** Shared body-plan rigs; a monster is a parameter file picking a rig. A monster that outgrows its rig is promoted to a bespoke drawing module. |
| Behavior | **Archetype + stats, with AI-written hooks.** Behavior rows reuse the existing enemy-AI brain; bespoke per-monster behavior plugs in via the creature-registry hook pattern (`CREATURE_HIT`/`UPDATE`/…). |
| Tool home | **Browser page + dev server first**, styled after the Electron tile editor. Later integration into the Electron editor is planned; get the UX right in the browser before that. All file I/O behind a swappable adapter. |
| v1 scope | **One rig (quadruped), full loop:** describe → tune → save → the monster spawns, fights, dies, and drops loot in the game. |

## Architecture

Three components, one-way data flow, mirroring the tile generator:

```
monster lab (browser) → renderer/data/monsters/<name>.json → game reads at startup
        ↑ imports the same rig modules the game uses ↑
```

### 1. Rig modules — `renderer/render/monster-rigs/`

Pure parametric canvas renderers in the game's own tree (v1:
`quadruped.js`). Each rig exports:

```js
export const RIG_ID = 'quadruped'
export const PARAM_SCHEMA = [ /* ordered list of tunables */ ]
export function drawMonster(ctx, params, pose, S) { ... }
```

Conventions (from dragonboss): drawn around origin `(0,0)` — the caller has
translated to screen position; the rig rotates by `pose.facing`; `-y` is
forward; `S` is the tile-size scale. Pure function of its arguments — no game
imports, no entity-state reads, no DOM beyond `ctx`. The lab and the game
therefore render pixel-identical monsters from the same file.

**PARAM_SCHEMA** is a flat ordered list the lab turns directly into its
control panel. Three control types in v1:

```js
{ key: 'legLength', label: 'Leg length', group: 'legs',
  type: 'range', min: 0.4, max: 2.2, step: 0.05, default: 1.0 }
{ key: 'hideColor', label: 'Hide', group: 'skin', type: 'color', default: '#7c4a24' }
{ key: 'horns', label: 'Horns', group: 'head', type: 'toggle', default: false }
```

Quadruped groups (approximate; the schema *format* is the contract, not this
list): **body** (length, width, bulge profile), **legs** (length, thickness,
gait), **head** (size, snout, horns, eyes), **tail** (length, taper),
**skin** (2–3 colors + `smooth`/`scales` texture), **motion** (bob, gait
frequency).

**Pose object** — decouples what the monster is doing (game's business) from
how that looks (rig's business):

```js
pose = { t, state, stateT, facing, speed01, seed }
```

- `state`: `idle | walk | attack | hit | death`; `stateT` = seconds in state.
- `speed01`: scales the gait (0 = standing, 1 = full sprint).
- `seed`: per-individual deterministic jitter via the dragonboss `hash()`
  trick, so two spawns of the same monster aren't clones.
- A rig must render something sane for **every** state. Minimum viable:
  `hit` = brief flash, `death` = collapse/fade. No monster ever renders as
  nothing.

The game computes the pose from the entity each frame; the lab computes it
from a pose simulator.

**Escape hatch:** a monster needing more than its rig sets
`rig: "bespoke/<name>"`, pointing at its own drawing module with the same
export contract.

### 2. Monster definitions — `renderer/data/monsters/<name>.json`

```json
{
  "name": "boarhound",
  "rig": "quadruped",
  "params": { "legLength": 1.3, "hideColor": "#6b3a1e" },
  "stats": { "hp": 30, "dmg": 8, "speed": 75, "half": 10 },
  "behavior": { "taxon": "beast", "sightRange": 240, "combat": "strafe" },
  "spawn": { "depths": [3, 6], "weight": 1 },
  "hooks": true
}
```

- `behavior` is literally an `enemy-ai.js` BASE-row fragment (same keys),
  merged over sensible defaults — kiteBand, strafe, fleeHp, stopRange etc.
  all work with no new AI code.
- `spawn` is optional. Present → the monster joins those depths' enemy
  spawn pool alongside the built-in types, where `weight: 1` counts the same
  as one built-in monster type's share of the roll. Absent → only explicit
  placement (arena, scripted spawns).
- `hooks: true` → `renderer/systems/monsters/<name>.js` exists and registers
  bespoke behavior.
- The lab maintains `renderer/data/monsters/index.json` (a name list) on
  every save, because the renderer cannot list directories.

### 3. Game loader — `renderer/systems/monsters.js`

Runs once at startup:

1. Reads `index.json`, fetches each monster JSON, **clamps params** against
   the rig's schema (out-of-range → clamped + warn; unknown keys → ignored +
   warn).
2. Registers each monster into existing seams:
   - **AI:** `enemy-ai.js` exports `registerMonsterAI(name, row)`; the
     loader registers each monster's `behavior` row (over beast defaults)
     into `BASE`, so the existing `getAIConfig` lookup resolves generated
     types with no change to its logic.
   - **Spawning:** `buildEntities` (renderer/game.js) gains a **single** new
     case that checks the registry — one case for all generated monsters.
     The arena allowlist gets the same check (unknown kinds are silently
     dropped today).
   - **Rendering:** the enemy draw path gains one branch — registry type →
     build pose via shared `entityPose(e)` helper (state from brain intent,
     `speed01` from actual velocity, `seed` from spawn position) → call the
     rig's `drawMonster`.
   - **Hooks:** `hooks: true` → dynamic-`import()` the hook module, which
     assigns into `CREATURE_HIT`/`CREATURE_UPDATE`/`CREATURE_ALPHA` keyed by
     the monster's name. Generated monsters are **never** added to
     `CREATURE_TYPES` — `isCreature` membership diverts an entity away from
     the brain, the normal strike path, and the enemy draw path
     (game.js:1052/1272, canvas.js). Instead the strike gates also dispatch
     when `CREATURE_HIT[e.type]` exists, and the enemy update loop calls
     `CREATURE_UPDATE[e.type]` (if any) *after* brain+act as a supplement.
3. Death, loot, XP, hit flash, knockback ride the existing enemy pipeline
   untouched — a generated monster dies like a crab dies, rolling the same
   depth-tiered loot.

### 4. Monster lab — `tools/monster-lab/`

**Dev server** (`server.mjs`, plain node `http`, zero dependencies, started
via `npm run monster-lab`):

1. **Serves the repo root** so the lab imports
   `renderer/render/monster-rigs/*.js` as real ES modules — the preview *is*
   the game's renderer (anim-comparison-server pattern).
2. **API:** `GET /api/monsters` (index + files), `PUT /api/monsters/<name>`
   (name sanitized to `[a-z0-9_]`, writes JSON, updates `index.json`),
   `GET /api/rigs` (lists rig modules).
3. **File watching → live reload:** watches `monster-rigs/` and
   `data/monsters/`, pushes an SSE event on change; the page re-imports the
   touched rig with a cache-busting query and redraws in place — sliders and
   pose state preserved. This is the loop that makes the AI conversation
   work: user describes a change in the terminal, Claude edits the rig, the
   browser updates without a refresh.

**Lab UI** (`index.html` + modules, three-column layout styled after the
tile editor; its plain-module helpers like `toast.js` reused where they drop
in):

- **Left — library:** saved monsters from `index.json`; "New monster" →
  pick a rig, start from schema defaults; unsaved-changes indicator.
- **Center — stage:** live preview canvas with zoom (`S` slider), optional
  dungeon-floor backdrop, optional collision-circle overlay drawn from
  `stats.half` (keeps visual size and hitbox honest). Below it the **pose
  simulator**: one button per state, `speed01` slider, seed reroll, pause +
  scrub on `t`.
- **Right — controls:** param panel auto-generated from `PARAM_SCHEMA`
  (grouped, collapsible; range → slider+number, color → picker, toggle →
  checkbox), then plain field editors for `stats`, `behavior`, `spawn`.
- **Compare:** "pin variant" snapshots current params into a strip of
  smaller side-by-side canvases, all animating on the same pose clock
  (dragon-tuner style); clicking a pin restores its params.

**Integration seam:** all persistence goes through one adapter,
`tools/monster-lab/io.js`, exposing
`listMonsters / readMonster / saveMonster / onFilesChanged`. Browser
implementation = fetch + SSE. The future Electron build swaps in a
preload-bridge implementation behind the same four functions; nothing else
in the lab may touch `fetch` directly. (`window.prompt()` is unsupported in
Electron renderers — reuse the `text-prompt.js` pattern for any text input.)

## Error handling

- **Game — missing/invalid `index.json`:** no generated monsters; game runs
  exactly as today.
- **Game — monster references a missing rig:** warn at load, skip that
  monster.
- **Game — hook module fails to import:** monster still loads with default
  behavior; error logged.
- **Game — out-of-range/unknown params:** clamped/ignored with warnings.
  A bad monster file can cost that monster, never the game.
- **Lab — save:** requires a non-empty name; sanitized to `[a-z0-9_]`; no
  path escapes.

## Testing

`node:test` files in `test/` (one per system), playwright-core for canvas:

- **Rig contract:** `PARAM_SCHEMA` well-formed (min < max, defaults in
  range, known control types); `drawMonster` completes without throwing for
  every state × extreme params (all-min, all-max, defaults) on a recording
  mock ctx.
- **Loader:** param clamping + unknown-key warnings; `getAIConfig` fallback
  returns the behavior row; missing rig skips with warning; failing hook
  module is non-fatal; `CREATURE_TYPES` gains the name only when hooks load.
- **Pose:** `entityPose(e)` maps brain intent → state and velocity →
  `speed01`; seed deterministic from spawn position.
- **Server:** name sanitization rejects path escapes; save updates
  `index.json` atomically (handlers tested directly, no live server).
- **Canvas:** a recording mock-ctx (proxy logging every draw call) asserts
  each state emits draw ops, states are distinct, save/restore balances, and
  output is deterministic — no browser needed; visual quality is judged live
  in the lab.
- **Runtime:** one short, time-boxed arena run for the full loop (spawns,
  chases, hits, dies, drops loot); logic paths stay on unit coverage.
- **Lab UI:** exercised manually (dev tool; tile-editor precedent).

## Out of scope (v1)

- Additional rigs (serpent, blob, flyer) — the schema/pose contract is
  designed for them; they come after the quadruped proves the loop.
- Electron editor integration — planned second step, enabled by `io.js`.
- Baked spritesheet export.
- Example-based or in-tool AI generation (the AI is Claude Code in the
  terminal by design).
