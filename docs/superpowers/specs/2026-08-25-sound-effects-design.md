# Sound Effects — Design

**Date:** 2026-08-25
**Status:** Approved design, pre-implementation
**Scope:** SFX only. Music and ambience are explicitly out of scope for this pass.

## Goal

Give the game a reactive sound layer: combat, items, world events, and UI all
make sound, spatialized around the player. Sounds are procedurally synthesized
with the Web Audio API (chiptune-ish, matching the pixel art), with a registry
seam so file-based sounds can be dropped in later without touching call sites.
Everything must work identically in Electron and the web release, and the
existing `node:test` suite must stay green without stubbing.

## Architecture

Two new files, split along the existing systems/render boundary — the same
pattern as `feedback.js` (systems push plain records onto state; the render
layer consumes them each frame).

### `renderer/systems/sfx.js` — pure cue queue (node-testable)

- `makeSfx()` → `{ cues: [], muted: false }`, stored as `state.sfx`, created
  alongside `state.feedback`.
- `sfx(state, name, { px, py } = {})` — pushes `{ name, px, py }`. Position is
  optional: positionless cues (UI, announcements) play centered at full volume.
- `drainSfx(state)` — returns the queued cues and clears the queue. Safely
  no-ops (returns `[]`) when `state.sfx` is missing, so old saves and existing
  tests cannot break.

No Web Audio imports anywhere in `systems/`. Gameplay tests assert cues were
queued, nothing more.

### `renderer/render/audio.js` — Web Audio engine (browser/Electron only)

Never imported by `systems/` or by gameplay tests.

- `makeAudio()` — lazily creates the `AudioContext`; a one-shot
  keydown/pointerdown listener calls `resume()` to satisfy autoplay policy.
  Cues arriving while the context is suspended are dropped (no queuing).
- `playCues(audio, cues, player)` — called once per frame from the game loop
  (right after `tickFeedback`). For each cue, looks the name up in a registry:
  a **file entry** (preloaded `AudioBuffer`) if registered, else a **synth
  recipe**. This lookup is the hybrid seam: adding a file sound later is one
  registry entry, zero call-site changes.
- All voices route through one master `GainNode`; mute drives it with a ~20 ms
  ramp (no clicks).

`game.js` wiring: create the audio object once at boot;
`playCues(audio, drainSfx(state), state.player)` in the frame loop; the `M`
key toggles `state.sfx.muted`.

## Cue set (starter)

The principle: instrument the moments that already have visual/text feedback —
every `addFloat` site and the meaningful `announce`/`speak` sites. Many of
these live in `game.js` itself, not only in `systems/`.

**Combat** — `melee-swing`, `melee-hit`, `ranged-shot`, `projectile-hit`,
`magic-cast`, `fire-burst`, `shockwave`, `player-hurt`, `player-death`,
`enemy-death`, `boss-death`.

**World & items** — `pickup`, `key-pickup`, `heal`, `equip`, `drop`,
`gate-open`, `door-locked`, `descend`, `emerge`, `stance-switch`,
`talent-learned`, `rite`.

**UI** — `ui-open`, `ui-close`, `ui-move` (positionless, centered).

**Deferred (explicitly not this pass):** footsteps (need per-surface variation
and careful throttling), enemy idle chatter (crab clicks, cyclops grunts),
music, ambient beds.

Cue names are plain strings. An emitted name with no registry entry logs one
console warning per name and is skipped — adding a call site before its recipe
is harmless.

## Synthesis palette

Each cue name maps to a small declarative recipe —
`{ type, freq, sweep, dur, curve, noise, … }` — interpreted by a single
`playRecipe()` function. Four building blocks cover the starter set:

1. **Tonal blip** — oscillator (square/triangle) + exponential pitch sweep +
   fast decay. Pickups, heal, UI, stance-switch. Upward sweeps read as "gain"
   (pickup, heal, talent-learned); downward as "fail/close" (door-locked,
   ui-close).
2. **Noise burst** — white-noise buffer through a bandpass + sharp envelope.
   melee-hit, projectile-hit, player-hurt. Filter frequency sets character
   (high = slap, low = thud).
3. **Swoosh** — noise through a sweeping bandpass. melee-swing, ranged-shot.
4. **Layered rumble** — low sine + filtered noise, longer decay. shockwave,
   gate-open, boss-death, descend/emerge.

Every play gets ±5 % random pitch jitter so repeats don't sound identical.

## Spatialization

- Positioned cues: linear falloff from full volume within ~4 tiles of the
  player to silence at ~14 tiles. Constants at the top of `audio.js`.
- Pan: horizontal offset from the player mapped to roughly ±0.7 via
  `StereoPannerNode` — never hard-panned.
- Positionless cues play centered at full volume.

## Voice management

- Per-name throttle: the same cue name plays at most once per ~50 ms.
- Global cap: ~12 simultaneous voices; the oldest voice is dropped when
  exceeded.

## Mute, unlock & persistence

- `M` (edge-triggered, `e.repeat` filtered, following the existing keydown
  pattern in `game.js`) toggles `state.sfx.muted` whenever a run is active.
- Feedback on toggle: `think(state, 'Sound muted.' / 'Sound on.')` — no
  permanent HUD icon.
- The muted flag persists to `localStorage` (`dc-muted`), restored on boot,
  wrapped in try/catch.

## Error handling

Audio must never take the game down:

- Each voice's playback is wrapped in try/catch; a failed voice is dropped
  silently.
- Unknown cue name → one console warning per name, cue skipped.
- `AudioContext` construction failure → the module disables itself; the game
  runs mute, exactly as today.

## Testing

**Pure tests (`node:test`, normal suite):**

- `test/sfx.test.js` — `makeSfx`, `sfx()` push with/without position,
  `drainSfx` returns-and-clears, no-op safety when `state.sfx` is absent.
- Representative call-site assertions added to existing tests (e.g.
  `player-damage.test.js` asserts `player-hurt` is queued;
  `talents.test.js` asserts `talent-learned`). Not every call site.
- `test/audio.test.js` — the spatial math (`falloffGain(dist)`, `panFor(dx)`)
  and the recipe table are exported pure data/functions: gain is 1 inside
  4 tiles and 0 beyond 14, pan clamps to ±0.7, and every starter cue name
  above has a recipe entry. No `AudioContext` needed.

**Runtime verification (kept short):** one brief Playwright pass — boot the
game, press a key, assert the `AudioContext` reaches `running`, no console
errors. Tuning by ear happens on an audition page (comparison-server pattern:
serves `renderer/`, buttons per cue, sliders for recipe params) — no long live
game sessions.
