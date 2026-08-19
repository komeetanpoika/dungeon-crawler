# Dungeon Crawler

A tile-based dungeon-crawler built with Electron and vanilla JavaScript — no bundler, no framework. Fight your way down through procedurally decorated dungeon levels, past crabs, cyclopes, and wizards, to a segmented dragon boss. Depth 6 opens up into an overworld you can explore.

A playable web build is hosted at <https://dungeon-crawler-254496209424.europe-west4.run.app>.

## Getting started

```bash
npm install
npm start           # launch the game (Electron)
npm run editor      # launch the tile/level editor (electron . --editor)
npm test            # run the test suite (node --test test/)
npm run web         # serve the browser build locally (tools/web-server.mjs)
```

## Project layout

```
main.cjs, preload.cjs      Electron shell (main process + preload bridge)
renderer/                  The game itself (loaded in the Electron renderer / browser)
  game.js                  Entry point and main loop
  systems/                 Gameplay logic (pure-ish modules, unit-tested)
  render/                  Canvas drawing: canvas, sprites, hud, dragon boss
  ui/                      Menus and UI widgets
  data/                    Level, tuning, and config data (incl. enemy-ai.js)
  assets/                  Art
  web-shim.js              Browser adapter (localStorage saves, no editor); no-op under Electron
tools/
  tile-editor/             The in-app level/tile editor (--editor mode)
  web-server.mjs           Static server for the web build (PORT-aware)
  bake-dragon-parts.mjs    Asset baking for the dragon boss (npm run bake)
test/                      node:test suites, one per system
docs/superpowers/          Specs and implementation plans
```

## Gameplay systems (`renderer/systems/`)

- **World:** `map` (tile grid), `decorate` (procedural decoration), `overworld` (the open world reached at depth 6), `progression` and `phase` (level flow), `meta` (persistent progression)
- **Player:** `walk` (movement), `melee` / `ranged` / `fire` (attacks), `loot`, `player-damage`, `knockback`, `cheats`
- **Enemy AI:** `nav` (flow-field / A* pathfinding), `brain` (perception and intent), `act` (movement modes), with tuning in `renderer/data/enemy-ai.js`
- **Enemies and bosses:** `crab`, `cyclops`, `wizard`, `dragonboss` (multi-segment boss with its own renderer in `renderer/render/dragonboss.js`), `enemy-attack`, `shockwave`

## Testing

Tests are plain `node:test` files in `test/`, one per system. Rendering and canvas checks use `playwright-core` (headless Chromium); the Electron app itself can also be driven at runtime via Playwright's `_electron` on WSLg.

```bash
npm test                          # everything
node --test test/nav.test.js      # a single suite
```

## Web release

The `web-release` branch carries the browser build: `renderer/web-shim.js`, `tools/web-server.mjs`, `Dockerfile`, and `.gcloudignore`. It deploys to Cloud Run (GCP project `delimaster`, region `europe-west4`):

```bash
git checkout web-release   # rebase on the main feature branch first
gcloud run deploy dungeon-crawler --source . --region europe-west4 --allow-unauthenticated --quiet
```

The web shim is a no-op under Electron, so the same branch runs on desktop too.
