# Castle ruleset + depth-6 test level: render a playable generated map

**Date:** 2026-07-02
**Status:** approved design

## Background

The game already skins generated levels from editor rulesets:
`decorateMap(map, rulesets[theme.ruleset])` (renderer/systems/decorate.js)
assigns floor/wall skins by tile weight × learned adjacency, and places
overlays from base-conditional distributions. But today only depths 1–2 point
at a ruleset (`catacombs`), which contains just two moss floor tiles — walls
fall back to the default drawing, so the generator has never rendered a fully
skinned map.

The user's `castle-demo-1781607145194` painting (16×12, under ruleset
`catacombs` in `renderer/data/painter-maps.json`) is fully painted on base +
overlay layers but its tiles are untagged, so it has never contributed rules.

Goal: derive a complete ruleset from that painting and render it on a new
**test depth**, leaving depths 0–5 and the `catacombs` ruleset untouched.

## Constraints

- **Do not modify** `LEVEL_CONFIG` entries for depths 0–5, `DEPTH_THEMES`
  entries for depths 0–5, the `catacombs`/`outdoors`/`moss` rulesets, or the
  painting itself.
- `FINAL_DEPTH` stays 5 — endgame logic on depth 5 must not change.
- The derived ruleset goes into a NEW `rulesets.json` key: `castle`.

## Component 1 — derivation script: `tools/derive-castle-ruleset.mjs`

A committed Node ESM script (run manually: `node tools/derive-castle-ruleset.mjs`):

1. Reads `renderer/data/painter-maps.json`, takes
   `catacombs.maps['castle-demo-1781607145194']` (map name is a `const` at the
   top of the script).
2. Builds `tileMeta: Map<name, {role, tags}>` from this authored table:
   - `castle.floor` (role `floor`): tile_0048, tile_0050, tile_0030, tile_0042
   - `castle.wall` (role `wall`): tile_0000, tile_0002, tile_0004, tile_0005,
     tile_0006, tile_0012, tile_0013, tile_0015, tile_0016, tile_0017,
     tile_0018, tile_0026, tile_0028, tile_0045, tile_0057, tile_0059
   - `overlay.castle` (role `overlay`): tile_0001, tile_0014, tile_0019,
     tile_0031, tile_0064, tile_0065, tile_0066
     (only tiles appearing exclusively on the overlay layer get the overlay
     role; dual-layer tiles keep their base role — `deriveRules` counts their
     overlay-layer appearances as "no overlay", which matches what the
     decoration pass can actually place)
3. Runs the editor's pure `deriveRules(base, overlay, tileMeta)`
   (`tools/tile-editor/derive-rules.js`).
4. **Fails loudly** (non-zero exit, no write) if `skipped > 0` — every painted
   cell must be covered by the table — or if any tagged tile's sprite
   `renderer/assets/tiles/<name>.png` is missing.
5. Writes the fragment to `renderer/data/rulesets.json` under key `castle`
   (straight assignment — new key, no merge), preserving the other rulesets
   byte-for-byte semantically (re-serialize whole file with 2-space indent,
   matching current formatting).

Weights and adjacency fall out of the painting (~160× plain floor vs 3–4×
rubble variants; walls a low-count mix biased by observed neighbours).

## Component 2 — depth-6 test level

In `renderer/data/levels.js` (additions only):

- `LEVEL_CONFIG` gains
  `{ depth: 6, mapW: 40, mapH: 26, staircaseWidth: 1, guardCount: 2,
  monsterDensity: 0, trapDensity: 0.03, puzzleDensity: 0.01,
  weaponDensity: 0.012, potionDensity: 0.008, landmark: null,
  weapons: ['dagger'] }`.
- `DEPTH_THEMES` gains
  `{ depths: [6], floorTile: 'floor', ruleset: 'castle', bgColor: '#141008',
  tint: null, fogAlpha: 0.65, props: { room: [] } }`.
  (Room props are skipped anyway when the ruleset has overlays; the empty
  list documents intent.)

Descending from depth 6 stays blocked by the existing
`state.level >= FINAL_DEPTH` guard — the level is a sandbox reached only by
cheat.

## Component 3 — cheat accepts config depths

`renderer/systems/cheats.js` `parseLevelCheat` currently accepts
`0..FINAL_DEPTH`. Change the validity check to "some `LEVEL_CONFIG` entry has
this depth" (import `LEVEL_CONFIG` instead of `FINAL_DEPTH`), and update the
JSDoc (which is stale anyway — it says `1..FINAL_DEPTH` but 0 is accepted).
Behavior for depths 0–5 is unchanged; `level6` becomes valid.

## Testing

- **Unit (`test/castle-ruleset.test.js`, node:test):** loads
  `renderer/data/rulesets.json` and asserts for `castle`: floor and wall
  role candidate lists are non-empty (via `candidatesForRole`), every tile
  has an existing sprite PNG, `rulesetHasOverlays(castle)` is true, and
  every tile weight is ≥ 1.
- **Unit (existing):** `parseLevelCheat` tests in `test/cheats.test.js`
  updated/extended: 6 accepted, 7 rejected, 0–5 unchanged.
- **Runtime (Playwright/Electron, scripted, not committed):** launch game,
  enter `level6` cheat, screenshot the rendered level for the user, assert
  zero console errors, count `decorate:` fallback warnings (report the
  number; a handful is acceptable, a majority of cells is not), move the
  player a few tiles to confirm input/walkability.
- **Data guard:** after runtime checks, `git status renderer/data/` must be
  clean except for the intended `rulesets.json` change.

## Out of scope

- Any visual re-tuning of the derived rules (re-paint → re-run script is the
  iteration loop, done by the user later).
- Wiring `castle` or the test depth into normal progression.
