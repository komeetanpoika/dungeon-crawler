# Dungeon Crawler

A tile-based action RPG built with Electron and vanilla JavaScript: no bundler,
no framework. It has three modes, picked on the title screen:

- **Adventure**: a chain of open forest, mountain, desert and sea maps with
  villages, caves, house interiors, quests and a day/night cycle.
- **Dungeon Rush**: the classic crawl through five procedural dungeon levels,
  with a boss lair.
- **Timewarp**: three short story episodes, each about putting right what a
  missing villager left broken.

There is also a free-for-all PvP arena, against bots or, in the browser
build, online.

Play it in a browser: <https://dungeon-crawler-254496209424.europe-west4.run.app>

## Getting started

Needs Node.js 22.

```bash
npm install
npm start               # the game (Electron)
npm run editor          # the tile/level editor
npm test                # the test suite (node:test)
npm run web             # the browser build plus the PvP server, http://localhost:8080
npm run monster-lab     # monster tuner and cutter, http://localhost:5180
npm run bench -- <name> # one monster in an arena with a live tuning panel
```

## Project layout

```
main.cjs, preload.cjs   Electron shell (main process and preload bridge)
renderer/               The game, loaded by Electron or a browser
  game.js               Entry point and main loop
  systems/              Gameplay logic, mostly pure modules with unit tests
  render/               Canvas drawing, sprites, HUD, Web Audio synthesis
  ui/                   Menus, inventory panel, touch controls
  data/                 Levels, maps, monsters, tuning
  pvp/, net/            PvP simulation, netcode and client
  assets/               Runtime art
  web-shim.js           Browser adapter (localStorage saves); a no-op under Electron
server/                 Static file server and the PvP WebSocket server
tools/                  Editor, monster lab and bench, map generators, art pipelines
assets/                 Source art the runtime art is built from
test/                   node:test suites, one per system
```

## Testing

The tests are plain `node:test` files that import the renderer modules
directly. A few rendering checks use `playwright-core`.

```bash
npm test
node --test test/nav.test.js   # one suite
```

## Hosting the web build

`npm run web` (`tools/web-server.mjs`) serves `renderer/` and the PvP WebSocket
on `/pvp` from one port (`PORT`, default 8080). Any static host can serve the
single-player game on its own.

The PvP server limits connections per IP address. Behind a proxy that appends
the caller to `X-Forwarded-For` (Cloud Run, nginx, Caddy), start it with
`TRUST_PROXY=1`. Leave that unset when clients connect to it directly.

The `Dockerfile` builds that server with `TRUST_PROXY=1` set. To run it on
Google Cloud Run:

```bash
GCP_PROJECT=<your-project-id> tools/deploy-web.sh   # REGION and SERVICE optional
```

The script keeps a single instance, because every PvP room lives in one
process.

## Notes

Code comments sometimes cite design specs under `docs/superpowers/`. Those
working notes are not part of the public repository.

## Licence

The code is MIT, see `LICENSE`. The art comes from several sources, most of it
CC0; see `CREDITS.md`.
