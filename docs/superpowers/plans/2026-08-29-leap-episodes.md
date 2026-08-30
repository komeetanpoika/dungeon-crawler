# Leap Episodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three new open maps at depths 8–10 whose runestones each wake by a discovered, story-specific condition (feed the Näkki; prove the wolves innocent and kill the Maahinen; relight the hermit's hearth and kill the Sammunut), with a persona framing (villagers greet you as a missing local who returns when the episode resolves) and an Echo guide only the player sees.

**Architecture:** Maps come from a new `tools/static-overworld/gen-leap.mjs` and are exported like the others with a `leap: true` flag. A pure `systems/leap.js` owns flags (save v6 `leaps`), the unlock rule, deliveries, the Echo's line selection and the resolution spawn; each episode's bespoke mechanics live in `systems/episodes/{ferry,fold,hermit}.js` exporting `onArrive(ctx)` / `tick(ctx, delta)`. Creatures are new enemy types with their own state-machine modules (pattern: `cyclops.js`) and 2×2 custom-tile art; `systems/creatures.js` centralises how the player's hits land on them. `game.js` only wires: builds the episode ctx on arrival, calls `tick` per frame, gates the waystone on `isMapUnlocked`.

**Tech Stack:** Electron + vanilla JS ES modules, `node:test`, 16 px PNG tiles (`tools/npc-placeholders.mjs` painter; editor-native `custom_*` naming), `tools/static-overworld` MapBuilder.

**Spec:** `docs/superpowers/specs/2026-08-29-leap-episodes-design.md`

## Global Constraints

- `renderer/systems/` stays pure (no DOM/Web Audio); `game.js` owns wiring and persistence. Episode modules may import `feedback.js`, `sfx.js`, `stamina.js`, `player-damage.js` (all pure).
- New maps: `lake-1-ferry` depth 8, `highland-2-fold` depth 9, `marsh-3-hermit` depth 10; existing depth 8–15 maps move to 11–18. `LEVEL_CONFIG` open-map block = 12 entries (7–18).
- Save v6: `leaps: { [mapName]: { flags: {} } }` + one-time remap `mapDepth >= 8 → +3` guarded by `save.v6 = true`. Nothing in `leaps` is wiped on death.
- No HUD/quest text. Feedback = Echo speech bubbles, `think()` one-liners, cues. No HP bar for the Näkki (no `maxHp`); Sammunut shows no bar unless visible.
- Walk-onto interactions everywhere (deliveries, feeding, Echo adjacency); the only key is the existing attack/interact.
- Creature art: four 16×16 tiles per creature named `custom_<name>_00|01|10|11.png` (row-major: 00 top-left, 01 top-right, 10 bottom-left, 11 bottom-right), transparent background, drawn 2×2 into a 64 px box anchored like the cyclops (`px - S/2, py - S/2`).
- Values: Näkki drag every 2 s for 1 damage, submerged 4 s, feed count 3. Maahinen HP 24, submerge at ≤ 50 %, resurface 4–6 tiles away, `maul` weapon, `half: 28`. Sammunut HP 18, drift 80 px/s, firelight radius 5 tiles (160 px), touch radius 20 px drains 12 stamina/s. Burn timer 120 s per stage, 4 stages, radius 6 around `burn N` POIs.
- Cues added: `bell`, `leap`, `echo`, `drag`, `erupt`, `wraith-touch` — every name in `CUE_NAMES` must have a `RECIPES` entry (existing registry test).
- Tests: `npm test` (baseline 1137/1137 at plan time). Commit per task; messages end with the two trailer lines:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_0145GUz8i7BMgPBG97pbMtge`.
- `renderer/data/open-maps.js` is generated: edit `tools/static-overworld/export-game-maps.mjs`, run `node tools/static-overworld/gen-leap.mjs` then `node tools/static-overworld/export-game-maps.mjs` (from repo root; the scripts resolve their own paths). Preview PNGs: `cd tools/static-overworld && node render-maps.mjs out/maps/<name>.json`.

---

## Phase 1 — maps and chain insertion

### Task 1: Chain insertion, save v6, shared map kit, and the lake map

**Files:**
- Create: `tools/static-overworld/kit.mjs` (helpers moved out of `gen-forest.mjs`)
- Modify: `tools/static-overworld/gen-forest.mjs:13-66` (import the kit instead of defining helpers)
- Create: `tools/static-overworld/gen-leap.mjs` (lake map now; Tasks 2–3 add the others)
- Modify: `tools/static-overworld/export-game-maps.mjs:16-30` (EXPORTS), `:57-63` (copy `leap`)
- Modify: `renderer/data/levels.js:170-173` (12 open-map entries)
- Modify: `renderer/systems/adventure.js:36-49`
- Regenerate: `renderer/data/open-maps.js`, `tools/static-overworld/out/maps/lake-1-ferry.json`, `out/png/lake-1-ferry.png`
- Test: `test/adventure.test.js`, `test/leap-maps.test.js` (new)

**Interfaces:**
- Produces: map data `OPEN_MAPS[8]` = `lake-1-ferry` with `leap: true`, POIs `runestone`, `village`, `bell`, `pier end`, `nakki`, `pier gap 1`, `pier gap 2`, `islet cache`, `dungeon_entrance`, ≥3 `chest`; `save.leaps`, `save.v6`; kit exports `grassBase, clearing, stampVillage, stampCaveInRocks, forestEdge, PINES, AUTUMN, DIRT, ROCKS_MOSS, GRASS, isOpen, pick`.

- [ ] **Step 1: Write the failing tests**

`test/adventure.test.js` — change the chain test and add v6 tests:

```js
  it('exports the adventure chain at depths 7..18 (leap maps at 8-10)', () => {
    const depths = Object.keys(OPEN_MAPS).map(Number).sort((a, b) => a - b)
    assert.deepEqual(depths, [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18])
    assert.equal(OPEN_MAPS[7].name, 'forest-1-clearings')
    assert.equal(OPEN_MAPS[11].name, 'forest-2-river')
    assert.equal(OPEN_MAPS[18].name, 'sea-3-archipelago')
    assert.equal(OPEN_MAPS[8].leap, true)
    assert.equal(OPEN_MAPS[11].leap, undefined)
  })
```

(Until Tasks 2–3 land, temporarily assert `[7, 8, 11, …, 18]` and change it back in Task 3 — say so in the commit message.) Update the existing `'every map but the last has a walkable exit cell'` test's last-depth constant from `15` to `18`, and `nextMapDepth` assertions: `nextMapDepth(7) === 8`, `nextMapDepth(17) === 18`, `nextMapDepth(18) === null`.

```js
describe('save v6', () => {
  it('a fresh save carries empty leaps and the v6 marker', () => {
    const s = normalizeAdventureSave(null)
    assert.deepEqual(s.leaps, {})
    assert.equal(s.v6, true)
  })
  it('a pre-v6 save at depth 8+ is shifted by three to stay on the same map', () => {
    const v5 = { caves: {}, progress: { mapDepth: 9, cleared: {} }, talents: [], body: null, gates: {}, npcs: {}, felled: {} }
    const s = normalizeAdventureSave(v5)
    assert.equal(s.progress.mapDepth, 12)
    assert.equal(s.v6, true)
    assert.deepEqual(s.leaps, {})
  })
  it('a pre-v6 save at depth 7 is untouched; a v6 save is never shifted twice', () => {
    assert.equal(normalizeAdventureSave({ caves: {}, progress: { mapDepth: 7, cleared: {} } }).progress.mapDepth, 7)
    const twice = normalizeAdventureSave(normalizeAdventureSave({ caves: {}, progress: { mapDepth: 9, cleared: {} } }))
    assert.equal(twice.progress.mapDepth, 12)
  })
})
```

Create `test/leap-maps.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import { buildOpenMap } from '../renderer/systems/openmap.js'
import { TILE } from '../renderer/systems/entities.js'

const REQUIRED = {
  'lake-1-ferry':     ['runestone', 'village', 'bell', 'pier end', 'nakki', 'pier gap 1', 'pier gap 2', 'islet cache'],
  'highland-2-fold':  ['runestone', 'village', 'fold', 'den', 'burrow', 'lair', 'fleece cache', 'burn 1', 'burn 2', 'burn 3', 'burn 4'],
  'marsh-3-hermit':   ['runestone', 'village', 'hearth', 'hermit hut', 'mushroom ring', 'hearth 1', 'hearth 2', 'hearth 3'],
}
const byName = Object.fromEntries(Object.values(OPEN_MAPS).map(m => [m.name, m]))

for (const [name, labels] of Object.entries(REQUIRED)) {
  describe(name, { skip: !byName[name] && 'not exported yet' }, () => {
    const data = byName[name]
    it('is a leap map with one cave, an exit and a starter-free spawn', () => {
      assert.equal(data.leap, true)
      assert.equal(data.pois.filter(p => p.kind === 'dungeon_entrance').length, 1)
      assert.equal(data.caveDepths.length, 1)
      assert.ok(data.exit)
      assert.equal(data.starter, null)
    })
    for (const label of labels) it(`declares POI "${label}"`, () => {
      assert.ok(data.pois.some(p => p.label === label), `missing ${label}`)
    })
    it('builds; spawn and every POI sit on or beside walkable floor', () => {
      const { map } = buildOpenMap(data)
      const open = (x, y) => map[y]?.[x]?.tile === TILE.FLOOR
      const near = (x, y) => open(x, y) || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => open(x + dx, y + dy))
      assert.ok(open(data.playerSpawn.x, data.playerSpawn.y), 'spawn')
      for (const p of data.pois) assert.ok(near(p.x, p.y), `poi ${p.label} at ${p.x},${p.y}`)
    })
    it('has at least three caches', () => {
      assert.ok(data.pois.filter(p => p.kind === 'chest').length >= 3)
    })
  })
}

describe('gen-forest maps are unchanged by the kit refactor', () => {
  it('forest-1-clearings JSON on disk still matches the exported data', () => {
    const json = JSON.parse(readFileSync(new URL('../tools/static-overworld/out/maps/forest-1-clearings.json', import.meta.url)))
    assert.deepEqual(json.ground, byName['forest-1-clearings'].ground)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/adventure.test.js test/leap-maps.test.js`
Expected: FAIL — depths still 7..15, no `leaps`/`v6`, lake map absent (its describe is skipped — that's fine; the forest check passes).

- [ ] **Step 3: Kit refactor**

Create `tools/static-overworld/kit.mjs` by **moving** these from `gen-forest.mjs` verbatim, adding `export` to each: `GRASS`, `PINES`, `AUTUMN`, `DIRT`, `ROCKS_MOSS`, `pick`, `isOpen`, `clearing`, `forestEdge`, `grassBase`, `stampVillage`, `stampCaveInRocks` (the last three reference `stampHouse3`, `plantTree`, `stampEdgeBand`, `mulberry32` — import them from `./lib.mjs` at the top of kit.mjs). In `gen-forest.mjs` replace the moved definitions with:

```js
import { GRASS, PINES, AUTUMN, DIRT, ROCKS_MOSS, pick, isOpen, clearing, forestEdge, grassBase, stampVillage, stampCaveInRocks } from './kit.mjs'
```

Run `cd tools/static-overworld && node gen-forest.mjs && git status --short out/maps` — expected: no changes (same seeds, same code). If a forest JSON changed, the move altered evaluation order; fix before continuing.

- [ ] **Step 4: Save v6**

`renderer/systems/adventure.js` — extend the shape comment with `v6 adds leaps ({mapName: {flags}}) and shifts pre-v6 mapDepth >= 8 by +3 (three leap maps inserted at 8-10); save.v6 marks the shift done`. In `normalizeAdventureSave`, after `base.felled ??= {}`:

```js
  base.leaps ??= {}
  if (!base.v6) {
    if (base.progress.mapDepth >= 8) base.progress.mapDepth += 3
    base.v6 = true
  }
```

`renderer/data/levels.js:170-173`: change `Array.from({ length: 9 }, …)` to `length: 12` and the comment to `Depths 7-18 — the Adventure chain of static open maps (7, 11-18 forest/desert/sea; 8-10 the leap maps)`.

- [ ] **Step 5: The lake map**

Create `tools/static-overworld/gen-leap.mjs`:

```js
// The three "leap" maps (docs/superpowers/specs/2026-08-29-leap-episodes-design.md):
//   lake-1-ferry     — Toivo's pier, the Näkki, the orchard bank
//   highland-2-fold  — Aino's fold, the wolf den, the Maahinen's burrow
//   marsh-3-hermit   — Lauri's cold village, the hermit's hearth, the Sammunut
// Every episode POI the game reads is declared here by label; test/leap-maps.test.js
// lists them.
import { MapBuilder, mulberry32, makeNoise, validate, plantTree, pruneBrokenTrees, stampHouse3 } from './lib.mjs'
import { PINES, AUTUMN, DIRT, ROCKS_MOSS, pick, isOpen, clearing, forestEdge, grassBase, stampVillage, stampCaveInRocks } from './kit.mjs'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out/maps')
fs.mkdirSync(OUT, { recursive: true })
const WATER = ['ow_water_0', 'ow_water_1', 'ow_water_2', 'ow_water_3']
const isWater = (b, x, y) => b.palette[b.ground[y]?.[x]]?.startsWith('ow_water')

// The arrival runestone: a walkable stone arch with the spawn just south of it.
function stampRunestone(b, x, y) {
  clearing(b, x, y, 2)
  b.p(x, y, 'ow_house_arch_stone', { walkable: true })
  b.poi('landmark', x, y, 'runestone')
  b.playerSpawn = { x, y: y + 1 }
}

function lake() {
  const rng = mulberry32(808)
  const noise = makeNoise(rng)
  const b = new MapBuilder('lake-1-ferry', 'forest', 'lake with a pier, islet, orchard bank', 120, 80)
  b.notes = "Toivo's lake: village west, orchard east, the pier between them, the Näkki beneath it."
  grassBase(b, rng)
  // the lake: a blob centred east of the middle, noise-rimmed
  const cx = 66, cy = 40, rx = 24, ry = 18
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + noise(x, y, { freq: 0.12, octaves: 2 }) * 0.25 - 0.12
    if (d < 1) { b.g(x, y, pick(rng, WATER)); b.block(x, y) }
  }
  // woods everywhere else, thinner near the shore
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    if (!b.walkable(x, y)) continue
    const d = noise(x + 100, y, { freq: 0.08, octaves: 3 })
    if (d > 0.46 && rng() < (d - 0.46) * 3.5) plantTree(b, rng, x, y, PINES)
  }
  forestEdge(b, rng, PINES)
  // village on the west shore
  const village = { x: 28, y: 40 }
  stampVillage(b, rng, village.x, village.y)
  b.poi('village', village.x, village.y - 1, 'Lakeshore')
  // Toivo's hut a little south, with the fish-rack sign
  stampHouse3(b, rng, village.x - 2, village.y + 10, 'brown')
  b.p(village.x + 1, village.y + 12, 'ow_sign', { walkable: false })
  b.poi('landmark', village.x, village.y + 12, "Toivo's hut")
  // the pier: from the west shore straight east to the bell post, then a
  // two-cell gap of open water (the Näkki's), then the orchard bank
  const py = cy
  let x0 = cx - rx
  while (!isWater(b, x0, py)) x0++
  const pierLen = 14
  for (let x = x0; x < x0 + pierLen; x++) { b.clearProp(x, py); b.g(x, py, 'ow_pier_log'); b.unblock(x, py) }
  const bellX = x0 + pierLen - 1
  b.p(bellX, py - 1, 'ow_pier_post', { walkable: false })
  b.poi('landmark', bellX, py, 'bell')
  b.poi('landmark', bellX, py, 'pier end')
  b.poi('landmark', bellX + 1, py + 1, 'nakki')          // water beside the pier end
  b.poi('landmark', bellX + 1, py, 'pier gap 1')          // water until the Näkki is gone
  b.poi('landmark', bellX + 2, py, 'pier gap 2')
  // the pier resumes after the gap and runs to the east bank
  let x1 = bellX + 3
  while (isWater(b, x1, py)) { b.clearProp(x1, py); b.g(x1, py, 'ow_pier_log'); b.unblock(x1, py); x1++ }
  // orchard on the east bank — apple trees on a cleared lawn
  const orchard = { x: x1 + 6, y: py }
  clearing(b, orchard.x, orchard.y, 7)
  for (let y = -5; y <= 5; y += 2) for (let x = -5; x <= 5; x += 2) b.p(orchard.x + x, orchard.y + y, 'ow_tree_apple')
  b.poi('landmark', orchard.x, orchard.y, 'orchard')
  // the east bank must only be reachable across the pier: wall it off with
  // dense trees north and south of the lake
  for (let y = 1; y < b.h - 1; y++) for (let x = cx + 4; x < b.w - 1; x++)
    if (b.walkable(x, y) && b.prop[y][x] === -1 && !isWater(b, x, y) && Math.hypot(x - orchard.x, y - orchard.y) > 8 && rng() < 0.85)
      plantTree(b, rng, x, y, PINES)
  // the islet: a small dot of land in the lake's south, ringed by trees,
  // holding the clapper cache; reached by felling the ring
  const islet = { x: cx - 6, y: cy + 11 }
  for (let y = -2; y <= 2; y++) for (let x = -3; x <= 3; x++) {
    if (x * x + y * y > 9) continue
    b.g(islet.x + x, islet.y + y, 'ow_grass_0'); b.unblock(islet.x + x, islet.y + y)
  }
  for (let y = -2; y <= 2; y++) for (let x = -3; x <= 3; x++)
    if (x * x + y * y > 4 && x * x + y * y <= 9) b.p(islet.x + x, islet.y + y, 'ow_tree_small')
  b.p(islet.x, islet.y, 'tile_0089', { walkable: true }); b.poi('chest', islet.x, islet.y, 'islet cache')
  // a strip of shore trees joins the islet to the south shore so it is
  // reachable on foot once chopped
  for (let y = islet.y + 3; isWater(b, islet.x, y); y++) { b.g(islet.x, y, 'ow_grass_0'); b.p(islet.x, y, 'ow_tree_small') }
  // one cave in the north woods
  const cave = { x: 60, y: 10 }
  clearing(b, cave.x, cave.y, 3); stampCaveInRocks(b, rng, cave.x, cave.y); b.poi('dungeon_entrance', cave.x, cave.y, 'lake cave')
  // caches
  for (const c of b.scatter(rng, 3, 26, isOpen(b))) { b.p(c.x, c.y, 'tile_0089', { walkable: true }); b.poi('chest', c.x, c.y, 'cache') }
  // arrival runestone west of the village, exit runestone by the orchard
  stampRunestone(b, 12, 40)
  b.p(orchard.x + 6, orchard.y, 'ow_house_arch_stone', { walkable: true }); b.poi('landmark', orchard.x + 6, orchard.y, 'orchard stone')
  b.healFragmentation({ fill: (x, y) => b.p(x, y, pick(rng, ROCKS_MOSS)), groundSkin: 'ow_dirt_0' })
  b.ensureReachable('ow_dirt_0')
  // the islet chest must stay tree-locked and the orchard pier-locked: the
  // heal pass may have bridged them — re-block the gap cells afterwards
  for (const label of ['pier gap 1', 'pier gap 2']) { const p = b.pois.find(q => q.label === label); b.g(p.x, p.y, pick(rng, WATER)); b.block(p.x, p.y) }
  pruneBrokenTrees(b)
  return b
}

export const LEAP_MAPS = [lake]
for (const make of LEAP_MAPS) {
  const b = make()
  const problems = validate(b)
  // the orchard is deliberately unreachable until the Näkki is fed
  const ok = problems.filter(p => !/orchard|pier gap|nakki/.test(p))
  if (ok.length) { console.error(b.name, ok); process.exitCode = 1 }
  fs.writeFileSync(path.join(OUT, `${b.name}.json`), JSON.stringify(b.toJSON()))
  console.log('wrote', b.name, problems.length ? `(expected-unreachable: ${problems.join('; ')})` : '')
}
```

`export-game-maps.mjs` `EXPORTS`: insert after the Clearings entry and renumber the rest 11–18:

```js
  { depth: 8,  file: 'lake-1-ferry.json',        title: "Toivo's Lake",     caveDepths: [2], exitPoi: 'orchard stone', leap: true,
    npcs: { village: ['villager', 'villager', 'elder', 'chicken', 'chicken'], wild: ['deer', 'deer', 'mouse', 'boar'] } },
```

and copy the flag in the `maps[e.depth] = {…}` literal: `leap: e.leap ?? undefined,`. Keep `starter` only on Clearings. Run:

```bash
node tools/static-overworld/gen-leap.mjs
node tools/static-overworld/export-game-maps.mjs
cd tools/static-overworld && node render-maps.mjs out/maps/lake-1-ferry.json
```

Look at `out/png/lake-1-ferry.png` (Read it). The pier must visibly cross the lake with a two-cell water gap before the east bank, the islet must sit in the lake ringed by trees, the orchard must be sealed by trees. Adjust the numbers until it reads right.

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: PASS (chain test temporarily `[7, 8, 11..18]`).

- [ ] **Step 7: Commit**

```bash
git add tools/static-overworld/kit.mjs tools/static-overworld/gen-forest.mjs tools/static-overworld/gen-leap.mjs tools/static-overworld/export-game-maps.mjs tools/static-overworld/out/maps/lake-1-ferry.json tools/static-overworld/out/png/lake-1-ferry.png renderer/data/levels.js renderer/data/open-maps.js renderer/systems/adventure.js test/adventure.test.js test/leap-maps.test.js
git commit -m "feat(maps): leap chain insertion (save v6), map kit, Toivo's Lake at depth 8"
```

---

### Task 2: The highland map

**Files:**
- Modify: `tools/static-overworld/gen-leap.mjs` (add `fold()`), `tools/static-overworld/export-game-maps.mjs` (depth 9 entry)
- Regenerate: `out/maps/highland-2-fold.json`, `out/png/highland-2-fold.png`, `renderer/data/open-maps.js`
- Test: `test/leap-maps.test.js` (the highland describe un-skips)

**Interfaces:**
- Produces: `OPEN_MAPS[9]` = `highland-2-fold`, POIs `runestone`, `village`, `fold`, `den`, `burrow` (rock-sealed mouth), `lair` (inside), `fleece cache`, `burn 1..4`, `dungeon_entrance`, caches; `npcs.wild` declares exactly three wolves.

- [ ] **Step 1: Test** — already in `test/leap-maps.test.js`; add one highland-specific case inside the loop-generated describe (guard on `name === 'highland-2-fold'`):

```js
    if (name === 'highland-2-fold') {
      it('declares three wolves and seals the burrow with rocks', () => {
        assert.equal(data.npcs.wild.filter(s => s === 'wolf').length, 3)
        const burrow = data.pois.find(p => p.label === 'burrow')
        const rocks = [[0, 0], [-1, 0], [1, 0]].filter(([dx, dy]) => (data.palette[data.prop[burrow.y + dy][burrow.x + dx]] ?? '').startsWith('ow_rock_'))
        assert.equal(rocks.length, 3)
      })
    }
```

Run: `node --test test/leap-maps.test.js` — Expected: highland describe still skipped (not exported).

- [ ] **Step 2: Generator**

Add to `gen-leap.mjs` and to `LEAP_MAPS`:

```js
function fold() {
  const rng = mulberry32(909)
  const noise = makeNoise(rng)
  const b = new MapBuilder('highland-2-fold', 'forest', 'highland fold, wolf den, sealed burrow', 120, 80)
  b.notes = "Aino's highland: the fold by the village, the wolves' hollow north, the burrow beyond it."
  grassBase(b, rng)
  const elev = (x, y) => noise(x, y, { freq: 0.05, octaves: 3 }) * 0.7 + ((b.h - y) / b.h) * 0.3
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    const e = elev(x, y)
    if (e > 0.64) { b.g(x, y, rng() < 0.2 ? 'ow_stone_ground_0' : 'ow_grass_0'); if (rng() < 0.7) b.p(x, y, pick(rng, ROCKS_MOSS)) }
    else { const d = noise(x + 300, y, { freq: 0.08, octaves: 3 }); if (d > 0.47 && rng() < (d - 0.47) * 3) plantTree(b, rng, x, y, PINES) }
  }
  forestEdge(b, rng, PINES)
  // village south with the fold beside it
  const village = { x: 40, y: 58 }
  stampVillage(b, rng, village.x, village.y)
  b.poi('village', village.x, village.y - 1, 'Aino\'s village')
  const fold = { x: village.x + 14, y: village.y }
  for (let y = -3; y <= 3; y++) for (let x = -4; x <= 4; x++) b.clearProp(fold.x + x, fold.y + y)
  for (let x = -4; x <= 4; x++) { b.p(fold.x + x, fold.y - 3, x === -4 ? 'ow_fence_l' : x === 4 ? 'ow_fence_r' : 'ow_fence_m'); if (x !== 0) b.p(fold.x + x, fold.y + 3, x === -4 ? 'ow_fence_l' : x === 4 ? 'ow_fence_r' : 'ow_fence_m') }
  for (let y = -2; y <= 2; y++) { b.p(fold.x - 4, fold.y + y, 'ow_fence_v'); b.p(fold.x + 4, fold.y + y, 'ow_fence_v') }
  b.poi('landmark', fold.x, fold.y, 'fold')
  // the wolves' hollow: a rock ring north-east
  const den = { x: 78, y: 34 }
  clearing(b, den.x, den.y, 4)
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; if (i !== 9) b.p(den.x + Math.round(Math.cos(a) * 4), den.y + Math.round(Math.sin(a) * 4), pick(rng, ROCKS_MOSS)) }
  b.poi('landmark', den.x, den.y, 'den')
  // the lamb trail: dirt cells from the fold gap past the den to the burrow
  const burrow = { x: 96, y: 18 }
  const trail = [[fold.x, fold.y + 3], [fold.x + 6, fold.y - 6], [den.x - 8, den.y + 6], [den.x + 6, den.y - 4], [burrow.x - 2, burrow.y + 3]]
  for (let i = 1; i < trail.length; i++) {
    const [ax, ay] = trail[i - 1], [bx, by] = trail[i]
    const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay))
    for (let k = 0; k <= n; k++) { const x = Math.round(ax + (bx - ax) * k / n), y = Math.round(ay + (by - ay) * k / n); b.clearProp(x, y); b.g(x, y, pick(rng, DIRT)) }
  }
  // the burrow: a rock pocket whose mouth is three rocks across; the lair inside
  clearing(b, burrow.x, burrow.y, 5)
  for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) {
    const r2 = x * x + y * y
    if (r2 > 16 && r2 <= 25) b.p(burrow.x + x, burrow.y + y, pick(rng, ['ow_rock_gray_0', 'ow_rock_gray_1', 'ow_rock_gray_2']))
  }
  const mouth = { x: burrow.x, y: burrow.y + 4 }
  for (const dx of [-1, 0, 1]) { b.clearProp(mouth.x + dx, mouth.y); b.p(mouth.x + dx, mouth.y, pick(rng, ['ow_rock_gray_0', 'ow_rock_gray_1'])) }
  b.poi('landmark', mouth.x, mouth.y, 'burrow')
  b.poi('landmark', burrow.x, burrow.y - 1, 'lair')
  b.p(mouth.x, mouth.y + 1, 'tile_0089', { walkable: true }); b.poi('chest', mouth.x, mouth.y + 1, 'fleece cache')
  // the four burn bands: forest pockets the villagers torch in order,
  // marching from the village toward the den
  for (const [i, c] of [[52, 50], [60, 44], [68, 40], [74, 30]].entries()) b.poi('landmark', c[0], c[1], `burn ${i + 1}`)
  // the old mine
  const mine = { x: 20, y: 14 }
  clearing(b, mine.x, mine.y, 3); stampCaveInRocks(b, rng, mine.x, mine.y); b.poi('dungeon_entrance', mine.x, mine.y, 'old mine')
  for (const c of b.scatter(rng, 3, 26, isOpen(b))) { b.p(c.x, c.y, 'tile_0089', { walkable: true }); b.poi('chest', c.x, c.y, 'cache') }
  stampRunestone(b, village.x - 14, village.y)
  b.p(burrow.x - 14, burrow.y + 8, 'ow_house_arch_stone', { walkable: true }); b.poi('landmark', burrow.x - 14, burrow.y + 8, 'ridge stone')
  b.healFragmentation({ fill: (x, y) => b.p(x, y, pick(rng, ROCKS_MOSS)), groundSkin: 'ow_dirt_0' })
  b.ensureReachable('ow_dirt_0')
  // the heal pass must not have opened the burrow mouth
  for (const dx of [-1, 0, 1]) if (b.walkable(mouth.x + dx, mouth.y)) b.p(mouth.x + dx, mouth.y, 'ow_rock_gray_0')
  pruneBrokenTrees(b)
  return b
}
```

Update the validate filter regex to `/orchard|pier gap|nakki|lair/`. `export-game-maps.mjs` entry:

```js
  { depth: 9,  file: 'highland-2-fold.json',     title: "Aino's Fold",      caveDepths: [2], exitPoi: 'ridge stone', leap: true,
    npcs: { village: ['villager', 'villager', 'elder', 'sheep', 'sheep', 'sheep', 'goat'], wild: ['wolf', 'wolf', 'wolf', 'deer', 'mouse'] } },
```

Run the three regenerate commands; view the PNG — trail visible from fold to burrow, den ring with one gap, burrow mouth sealed.

- [ ] **Step 3: Run tests** — `npm test` → PASS (chain test: adjust to `[7, 8, 9, 11..18]`).

- [ ] **Step 4: Commit**

```bash
git add tools/static-overworld/gen-leap.mjs tools/static-overworld/export-game-maps.mjs tools/static-overworld/out/maps/highland-2-fold.json tools/static-overworld/out/png/highland-2-fold.png renderer/data/open-maps.js test/leap-maps.test.js test/adventure.test.js
git commit -m "feat(maps): Aino's Fold at depth 9"
```

---

### Task 3: The marsh map and hearth props

**Files:**
- Modify: `tools/static-overworld/gen-leap.mjs` (add `marsh()`), `export-game-maps.mjs` (depth 10 entry)
- Modify: `tools/npc-placeholders.mjs` (two hearth props), `renderer/render/sprites.js` (register)
- Create (generated): `renderer/assets/tiles/prop_hearth_cold.png`, `prop_hearth_lit.png`
- Regenerate: `out/maps/marsh-3-hermit.json`, PNG, `renderer/data/open-maps.js`
- Test: `test/leap-maps.test.js`, `test/sprites.test.js`, `test/adventure.test.js` (chain test final form)

**Interfaces:**
- Produces: `OPEN_MAPS[10]` = `marsh-3-hermit`, POIs `runestone`, `village`, `hearth 1..3` (cells carrying `prop_hearth_cold`), `hermit hut`, `hearth` (cell in front of the hut), `mushroom ring`, `dungeon_entrance`, caches; sprites `prop_hearth_cold`, `prop_hearth_lit`.

- [ ] **Step 1: Tests** — in `test/sprites.test.js` add `prop_hearth_cold`/`prop_hearth_lit` to the placeholder loop. In `test/leap-maps.test.js` add (guarded on `name === 'marsh-3-hermit'`):

```js
      it('the three village hearths carry the cold hearth prop', () => {
        for (const n of [1, 2, 3]) {
          const p = data.pois.find(q => q.label === `hearth ${n}`)
          assert.equal(data.palette[data.prop[p.y][p.x]], 'prop_hearth_cold')
        }
      })
```

Restore the chain test to its final `[7..18]` form.

- [ ] **Step 2: Hearth art** — in `tools/npc-placeholders.mjs` add two paints and list them:

```js
// Cold hearth: a ring of stones round grey ash. Lit: the same ring with flame.
const HEARTH_COLD = paint([
  '................', '................', '................', '.....######.....',
  '....#ssssss#....', '...#saaaaaas#...', '...#saaaaaas#...', '...#saaaaaas#...',
  '...#saaaaaas#...', '....#ssssss#....', '.....######.....', '................',
  '................', '................', '................', '................',
], { s: [120, 120, 125, 255], a: [90, 88, 86, 255] })
const HEARTH_LIT = paint([
  '................', '.......#........', '......#y#.......', '.....#yoy#......',
  '....#soooos#....', '...#soorroos#...', '...#sorrrros#...', '...#soorroos#...',
  '...#saoooaas#...', '....#ssssss#....', '.....######.....', '................',
  '................', '................', '................', '................',
], { s: [120, 120, 125, 255], a: [90, 88, 86, 255], y: [255, 230, 120, 255], o: [255, 150, 40, 255], r: [220, 60, 30, 255] })
```

Register in `sprites.js` after `prop_campfire`: `prop_hearth_cold: 'prop_hearth_cold', prop_hearth_lit: 'prop_hearth_lit',`. Run `node tools/npc-placeholders.mjs`.

- [ ] **Step 3: Generator**

```js
function marsh() {
  const rng = mulberry32(1010)
  const noise = makeNoise(rng)
  const b = new MapBuilder('marsh-3-hermit', 'forest', 'autumn marsh, cold village, hermit knoll', 120, 80)
  b.notes = "Lauri's marsh: pools and autumn woods, the cold village south, the hermit's knoll north ringed by dead trees."
  grassBase(b, rng)
  // pools
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    const w = noise(x, y, { freq: 0.07, octaves: 2 })
    if (w > 0.62) { b.g(x, y, pick(rng, WATER)); b.block(x, y) }
    else if (w > 0.58) b.g(x, y, pick(rng, DIRT))
  }
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    if (!b.walkable(x, y)) continue
    const d = noise(x + 500, y, { freq: 0.08, octaves: 3 })
    if (d > 0.47 && rng() < (d - 0.47) * 3) plantTree(b, rng, x, y, AUTUMN)
    else if (d > 0.55 && rng() < 0.08) b.p(x, y, 'ow_mushroom')
  }
  forestEdge(b, rng, AUTUMN)
  // the cold village: three hearths in the plaza
  const village = { x: 60, y: 60 }
  stampVillage(b, rng, village.x, village.y)
  b.poi('village', village.x, village.y - 1, 'Coldhearth')
  for (const [i, [dx, dy]] of [[-4, -2], [4, -2], [0, 3]].entries()) {
    b.clearProp(village.x + dx, village.y + dy); b.p(village.x + dx, village.y + dy, 'prop_hearth_cold', { walkable: false })
    b.poi('landmark', village.x + dx, village.y + dy, `hearth ${i + 1}`)
  }
  // the hermit's knoll north, ringed by dead trees, hearth in front of the door
  const hut = { x: 58, y: 18 }
  clearing(b, hut.x, hut.y, 7)
  stampHouse3(b, rng, hut.x, hut.y, 'brown')
  b.poi('village', hut.x + 1, hut.y + 2, 'hermit hut')
  b.clearProp(hut.x + 1, hut.y + 4); b.poi('landmark', hut.x + 1, hut.y + 4, 'hearth')
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2
    const x = hut.x + 1 + Math.round(Math.cos(a) * 7), y = hut.y + 2 + Math.round(Math.sin(a) * 6)
    if (i % 5 !== 0) b.p(x, y, pick(rng, ['ow_deadtree_0', 'ow_deadtree_1']))
  }
  // the mushroom ring east, the rite anchor
  const ring = { x: 92, y: 40 }
  clearing(b, ring.x, ring.y, 4)
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; b.p(ring.x + Math.round(Math.cos(a) * 3), ring.y + Math.round(Math.sin(a) * 3), 'ow_mushroom') }
  b.poi('landmark', ring.x, ring.y, 'mushroom ring')
  const cave = { x: 22, y: 30 }
  clearing(b, cave.x, cave.y, 3); stampCaveInRocks(b, rng, cave.x, cave.y); b.poi('dungeon_entrance', cave.x, cave.y, 'bog cave')
  for (const c of b.scatter(rng, 3, 26, isOpen(b))) { b.p(c.x, c.y, 'tile_0089', { walkable: true }); b.poi('chest', c.x, c.y, 'cache') }
  stampRunestone(b, village.x - 16, village.y + 4)
  b.p(hut.x + 14, hut.y + 2, 'ow_house_arch_stone', { walkable: true }); b.poi('landmark', hut.x + 14, hut.y + 2, 'knoll stone')
  b.healFragmentation({ fill: (x, y) => b.p(x, y, pick(rng, ROCKS_MOSS)), groundSkin: 'ow_dirt_0' })
  b.ensureReachable('ow_dirt_0')
  pruneBrokenTrees(b)
  return b
}
```

Add `marsh` to `LEAP_MAPS`. Export entry:

```js
  { depth: 10, file: 'marsh-3-hermit.json',      title: 'Coldhearth Marsh', caveDepths: [3], exitPoi: 'knoll stone', leap: true,
    npcs: { village: ['villager', 'villager', 'villager', 'elder', 'goat'], wild: ['deer', 'mouse', 'mouse', 'boar'] } },
```

`MAP_RITES` (`renderer/data/rites.js`) gains `'marsh-3-hermit': [{ fromPoi: 'mushroom ring', talent: null, rite: 'mushroom_circle' }]` — check `openmap.js:157` and the `talent_trigger` consumer in `game.js` (`hasTalent(player, trigger.talent)` at ~`:826`) tolerate `talent: null` (the rite must still start the trance but grant nothing): change that condition to `(!trigger.talent || !hasTalent(player, trigger.talent))` and make the rite-completion grant (`grantTalent(state, talent)` at ~`:656`) skip when `talent` is null. Regenerate, render, view the PNG.

- [ ] **Step 4: Run tests** — `npm test` → PASS (chain `[7..18]`, all three leap describes active).

- [ ] **Step 5: Commit**

```bash
git add tools/ renderer/assets/tiles/prop_hearth_cold.png renderer/assets/tiles/prop_hearth_lit.png renderer/render/sprites.js renderer/data/rites.js renderer/data/open-maps.js renderer/game.js test/
git commit -m "feat(maps): Coldhearth Marsh at depth 10; hearth props; talent-less rite anchor"
```

---

## Phase 2 — the leap framework

### Task 4: Episode data, flags, unlock rule, persona lines, resolution

**Files:**
- Create: `renderer/data/leaps.js`, `renderer/systems/leap.js`
- Modify: `renderer/systems/npc.js:231-243` (`interactNpc` line override), `renderer/game.js` (waystone gate `:786-800`, `travelToMap`/`startNewRun` arrival hook, `persistAdventure`)
- Modify: `renderer/systems/sfx.js`, `renderer/render/audio.js` (`leap`, `echo`, `bell`, `drag`, `erupt`, `wraith-touch`)
- Test: `test/leap.test.js` (new), `test/npc.test.js`, `test/audio.test.js` (registry)

**Interfaces:**
- Produces (`data/leaps.js`): `EPISODES[mapName] = { persona, missing: { species }, villagerLines: { [species]: string[] }, echoSpots: [{ fromPoi, lines: [{ when(flags, ctx), text }] }], rule(flags, ctx) }`.
- Produces (`systems/leap.js`):
  - `episodeFor(mapData) -> episode | null`
  - `leapFlags(save, mapName) -> flags` (live object, created on demand)
  - `setFlag(save, mapName, flag, value = true)`
  - `wolvesAlive(save, mapData) -> number`
  - `ruleCtx(save, mapData) -> { wolvesAlive }`
  - `isMapUnlocked(save, mapData) -> boolean` (leap rule or `isMapComplete`)
  - `isResolved(save, mapData) -> boolean` (leap maps only; false otherwise)
  - `echoLine(episode, spotIndex, flags, ctx) -> string | null`
  - `poiCell(mapData, label) -> { x, y } | null`
  - `missingSpawn(mapData) -> { kind: 'npc', species, id: 'npc:<map>:missing', x, y, hostile: false }` placed on the nearest walkable cell to the `village` POI (search rings 1..4, `walk[y][x] === '1'`)
- Consumes: `isMapComplete` from `adventure.js`.

- [ ] **Step 1: Write the failing tests**

Create `test/leap.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EPISODES } from '../renderer/data/leaps.js'
import { episodeFor, leapFlags, setFlag, wolvesAlive, isMapUnlocked, isResolved, echoLine, poiCell, missingSpawn } from '../renderer/systems/leap.js'
import { normalizeAdventureSave, markCleared } from '../renderer/systems/adventure.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'

const fold = Object.values(OPEN_MAPS).find(m => m.name === 'highland-2-fold')
const lake = Object.values(OPEN_MAPS).find(m => m.name === 'lake-1-ferry')
const clearings = OPEN_MAPS[7]

describe('episode data', () => {
  it('every leap map has an episode and no plain map does', () => {
    for (const m of Object.values(OPEN_MAPS)) assert.equal(!!episodeFor(m), !!m.leap, m.name)
  })
  it('each episode declares persona, missing species, villager lines, echo spots and a rule', () => {
    for (const [name, ep] of Object.entries(EPISODES)) {
      assert.ok(ep.persona, name); assert.ok(ep.missing?.species, name)
      assert.ok(Object.keys(ep.villagerLines).length, name)
      assert.ok(ep.echoSpots.length >= 2, name)
      assert.equal(typeof ep.rule, 'function', name)
      for (const s of ep.echoSpots) assert.ok(s.lines.length && s.lines.at(-1).when({}, {}) !== undefined, `${name} ${s.fromPoi}`)
    }
  })
  it('every echo spot names a POI the map declares', () => {
    for (const m of Object.values(OPEN_MAPS)) for (const s of episodeFor(m)?.echoSpots ?? [])
      assert.ok(poiCell(m, s.fromPoi), `${m.name}: ${s.fromPoi}`)
  })
})

describe('flags', () => {
  it('leapFlags creates the record on demand and setFlag writes through', () => {
    const save = normalizeAdventureSave(null)
    assert.deepEqual(leapFlags(save, 'lake-1-ferry'), {})
    setFlag(save, 'lake-1-ferry', 'bell_hung')
    setFlag(save, 'lake-1-ferry', 'fed', 2)
    assert.deepEqual(save.leaps['lake-1-ferry'], { flags: { bell_hung: true, fed: 2 } })
  })
})

describe('rules', () => {
  it('a plain map still unlocks by clearing its dungeons', () => {
    const save = normalizeAdventureSave(null)
    assert.equal(isMapUnlocked(save, clearings), false)
    for (const l of ['cave 1', 'cave 2']) markCleared(save.progress, clearings.name, l)
    assert.equal(isMapUnlocked(save, clearings), true)
    assert.equal(isResolved(save, clearings), false)
  })
  it('the lake unlocks only when the Näkki is gone, regardless of caves', () => {
    const save = normalizeAdventureSave(null)
    markCleared(save.progress, lake.name, 'lake cave')
    assert.equal(isMapUnlocked(save, lake), false)
    setFlag(save, lake.name, 'nakki_gone')
    assert.equal(isMapUnlocked(save, lake), true)
    assert.equal(isResolved(save, lake), true)
  })
  it('wolvesAlive counts declared wolves minus the dead record', () => {
    const save = normalizeAdventureSave(null)
    assert.equal(wolvesAlive(save, fold), 3)
    const v = fold.npcs.village.length
    save.npcs[fold.name] = { dead: [`npc:${fold.name}:${v}`, `npc:${fold.name}:${v + 1}`], hostile: false }
    assert.equal(wolvesAlive(save, fold), 1)
  })
  it('the fold needs the Maahinen dead and a wolf alive', () => {
    const save = normalizeAdventureSave(null)
    setFlag(save, fold.name, 'maahinen_dead')
    assert.equal(isMapUnlocked(save, fold), true)
    const v = fold.npcs.village.length
    save.npcs[fold.name] = { dead: [v, v + 1, v + 2].map(i => `npc:${fold.name}:${i}`), hostile: false }
    assert.equal(isMapUnlocked(save, fold), false)
  })
})

describe('echo and resolution helpers', () => {
  it('echoLine picks the first line whose condition holds, last line is the fallback', () => {
    const ep = { echoSpots: [{ fromPoi: 'x', lines: [{ when: f => f.a, text: 'A' }, { when: () => true, text: 'Z' }] }] }
    assert.equal(echoLine(ep, 0, {}, {}), 'Z')
    assert.equal(echoLine(ep, 0, { a: true }, {}), 'A')
    assert.equal(echoLine(ep, 5, {}, {}), null)
  })
  it('missingSpawn lands on walkable ground beside the village', () => {
    const s = missingSpawn(lake)
    assert.equal(s.kind, 'npc'); assert.equal(s.id, 'npc:lake-1-ferry:missing')
    assert.equal(lake.walk[s.y][s.x], '1')
    const v = poiCell(lake, 'village')
    assert.ok(Math.max(Math.abs(s.x - v.x), Math.abs(s.y - v.y)) <= 4)
  })
})
```

`test/npc.test.js` — add:

```js
describe('persona lines', () => {
  it('interactNpc prefers state.villagerLines for the species over the species lines', () => {
    const e = makeNpc({ species: 'villager', id: 'npc:t:0', x: 2, y: 2 })
    const state = { player: { px: 0, py: 0 }, entities: [e], log: [], feedback: {}, villagerLines: { villager: ["You're back, Toivo!"] } }
    const r = interactNpc(state, e, () => 0)
    assert.equal(r.text, "You're back, Toivo!")
    delete state.villagerLines
    assert.notEqual(interactNpc(state, e, () => 0).text, "You're back, Toivo!")
  })
})
```

(Match the file's existing `makeNpc`/state fixture style if it differs.)

- [ ] **Step 2: Run to verify failure** — `node --test test/leap.test.js test/npc.test.js` → module not found / line not overridden.

- [ ] **Step 3: Implement**

`renderer/data/leaps.js`:

```js
// One episode per leap map (docs/superpowers/specs/2026-08-29-leap-episodes-design.md).
// Villagers speak `villagerLines` while the episode is open; the Echo speaks
// the first `lines` entry whose `when(flags, ctx)` holds (last entry = fallback);
// `rule(flags, ctx)` is when the runestone wakes. ctx = { wolvesAlive }.
export const EPISODES = {
  'lake-1-ferry': {
    persona: 'Toivo',
    missing: { species: 'villager' },
    villagerLines: {
      villager: ["Toivo! The lake gave you back?", 'The orchard rots over there and we eat seed grain.', 'Ring the bell like you used to — nobody dares the pier.'],
      elder:    ['You always rang it at dusk, Toivo, and the water lay flat after.', 'It was never the lake that took you. It was what lives in it.'],
    },
    echoSpots: [
      { fromPoi: 'runestone', lines: [
        { when: f => f.nakki_gone, text: 'Ziggy says the lake is quiet. Oh boy — here we go.' },
        { when: f => f.bell_hung, text: "It comes up when the bell rings. Ziggy's at 91 % you should feed it, not fight it." },
        { when: f => f.clapper, text: "That's the clapper. The bell's out on the pier." },
        { when: () => true, text: "Oh boy. They think you're Toivo, the ferryman. The bell on the pier has no clapper — Ziggy likes the islet." },
      ] },
      { fromPoi: 'bell', lines: [
        { when: f => f.fed >= 1 && !f.nakki_gone, text: `It liked that. Toivo smoked his fish, Sam — cooked, never raw.` },
        { when: f => f.bell_hung, text: 'Stand at the end with something cooked in your pack and let it come.' },
        { when: () => true, text: 'No clapper. Ziggy puts the islet cache at 72 %.' },
      ] },
      { fromPoi: "Toivo's hut", lines: [
        { when: () => true, text: 'A fish rack. He fed the lake every dusk. Ziggy is very sure that matters.' },
      ] },
    ],
    rule: f => !!f.nakki_gone,
  },
  'highland-2-fold': {
    persona: 'Aino',
    missing: { species: 'villager' },
    villagerLines: {
      villager: ['Aino! Back from the city — the lambs are gone again.', 'We burn the forest tomorrow. The wolves have had their chance.', 'Your father would have shot every wolf on the ridge.'],
      elder:    ['The wolves never took lambs before the prospector came, Aino.', 'Bring me proof and I will call the torches off.'],
    },
    echoSpots: [
      { fromPoi: 'runestone', lines: [
        { when: (f, c) => f.maahinen_dead && c.wolvesAlive < 1, text: "The thing is dead, but so are the wolves. Ziggy's odds are 0 %, Sam. This isn't the fix." },
        { when: f => f.maahinen_dead, text: 'Ziggy says the fold will be quiet tonight. Oh boy.' },
        { when: f => f.fleece_shown, text: 'Torches are down. Whatever took the lambs is behind those rocks, and now you have a pick.' },
        { when: f => f.burn >= 3, text: "They're burning toward the den. Ziggy gives the wolves 40 % if you don't hurry." },
        { when: () => true, text: "Oh boy. You're Aino, the shepherd's girl. They blame the wolves. Ziggy puts that at 12 %. Follow the tracks." },
      ] },
      { fromPoi: 'den', lines: [
        { when: () => true, text: "Wolves, but no bones, no wool. The tracks keep going. Ziggy's at 88 % it's not them." },
      ] },
      { fromPoi: 'burrow', lines: [
        { when: f => f.fleece_shown, text: 'Break the rocks. Whatever is in there comes up from under you — watch the ground.' },
        { when: () => true, text: "Lamb's fleece, and the prospector's mess. Show the elder before the torches reach the den." },
      ] },
    ],
    rule: (f, c) => !!f.maahinen_dead && (c?.wolvesAlive ?? 0) >= 1,
  },
  'marsh-3-hermit': {
    persona: 'Lauri',
    missing: { species: 'villager' },
    villagerLines: {
      villager: ['Lauri. So you came back after all.', 'Every hearth went cold the night you two quarrelled.', 'The old man sits up on the knoll and says nothing.'],
      elder:    ['Fires light and something puts them out again, Lauri. Something that walks.', 'Only his own wood ever burned on that hearth.'],
    },
    echoSpots: [
      { fromPoi: 'runestone', lines: [
        { when: f => f.wraith_dead, text: 'Hearths are lit. Ziggy says the old man is talking again. Oh boy.' },
        { when: f => f.hearth_lit, text: "That fire it can't eat. It'll come for it anyway — that's where you fight it." },
        { when: () => true, text: "Oh boy. You're Lauri, the apprentice. Something is eating the fires. Ziggy says the dead trees on the knoll are his woodpile." },
      ] },
      { fromPoi: 'hearth', lines: [
        { when: f => f.hearth_lit, text: "It's coming. Stay in the light — outside it you can't touch it, and it drains you." },
        { when: () => true, text: 'His hearth. Build a fire here from his own wood and it stays lit.' },
      ] },
      { fromPoi: 'mushroom ring', lines: [
        { when: () => true, text: 'The ring. Ziggy says a trance shows you where it walks, even in the dark.' },
      ] },
    ],
    rule: f => !!f.wraith_dead,
  },
}
```

`renderer/systems/leap.js`:

```js
// Leap episodes: per-map story flags, the runestone's unlock rule, the Echo's
// line choice and the missing person's return. Pure — game.js and the
// episode modules (systems/episodes/*) do the world mutation.
import { EPISODES } from '../data/leaps.js'
import { isMapComplete } from './adventure.js'

export function episodeFor(mapData) { return (mapData?.leap && EPISODES[mapData.name]) || null }

export function leapFlags(save, mapName) {
  const rec = save.leaps[mapName] ??= { flags: {} }
  return rec.flags
}

export function setFlag(save, mapName, flag, value = true) { leapFlags(save, mapName)[flag] = value }

export function poiCell(mapData, label) {
  const p = mapData.pois.find(q => q.label === label)
  return p ? { x: p.x, y: p.y } : null
}

// Declared wild wolves whose spawn id is not in the dead record. Ids index
// the concatenated village+wild list (openmap.js npcSpawnsForMap).
export function wolvesAlive(save, mapData) {
  const village = mapData.npcs?.village?.length ?? 0
  const dead = new Set(save.npcs?.[mapData.name]?.dead ?? [])
  return (mapData.npcs?.wild ?? []).filter((sp, i) => sp === 'wolf' && !dead.has(`npc:${mapData.name}:${village + i}`)).length
}

export const ruleCtx = (save, mapData) => ({ wolvesAlive: wolvesAlive(save, mapData) })

export function isResolved(save, mapData) {
  const ep = episodeFor(mapData)
  return !!ep && !!ep.rule(leapFlags(save, mapData.name), ruleCtx(save, mapData))
}

export function isMapUnlocked(save, mapData) {
  return episodeFor(mapData) ? isResolved(save, mapData) : isMapComplete(save.progress, mapData)
}

export function echoLine(episode, spotIndex, flags, ctx) {
  const spot = episode?.echoSpots?.[spotIndex]
  if (!spot) return null
  return spot.lines.find(l => l.when(flags, ctx))?.text ?? null
}

// The returned local: a villager beside the village POI, on the nearest
// walkable cell by expanding rings (never the POI itself, which is usually art).
export function missingSpawn(mapData) {
  const ep = episodeFor(mapData)
  const v = poiCell(mapData, 'village') ?? mapData.playerSpawn
  for (let r = 1; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
    const x = v.x + dx, y = v.y + dy
    if (mapData.walk[y]?.[x] === '1') return { kind: 'npc', species: ep.missing.species, id: `npc:${mapData.name}:missing`, x, y, hostile: false }
  }
  return { kind: 'npc', species: ep.missing.species, id: `npc:${mapData.name}:missing`, x: mapData.playerSpawn.x, y: mapData.playerSpawn.y, hostile: false }
}
```

`renderer/systems/npc.js` `interactNpc`: replace `if (def.lines) {` … `def.lines[…]` with `const lines = state.villagerLines?.[e.species] ?? def.lines` and use `lines` for both the guard and the pick.

Cues: add to `CUE_NAMES` a group `// leap episodes` with `'leap', 'echo', 'bell', 'drag', 'erupt', 'wraith-touch'`; recipes:

```js
  'leap':         { kind: 'swoosh', f0: 200,  f1: 1800, dur: 0.60, vol: 0.7 },
  'echo':         { kind: 'blip',   wave: 'triangle', f0: 880, f1: 660, dur: 0.12, vol: 0.35 },
  'bell':         { kind: 'blip',   wave: 'triangle', f0: 1320, f1: 1300, dur: 0.90, vol: 0.7 },
  'drag':         { kind: 'rumble', freq: 60,  dur: 0.30, vol: 0.8 },
  'erupt':        { kind: 'rumble', freq: 85,  dur: 0.40, vol: 0.9 },
  'wraith-touch': { kind: 'swoosh', f0: 900,  f1: 200,  dur: 0.20, vol: 0.3 },
```

`renderer/game.js`:
- import `{ episodeFor, isMapUnlocked, isResolved, leapFlags, missingSpawn }` from `./systems/leap.js`.
- Waystone (`:790`): replace `mapData && isMapComplete(savedAdventure.progress, mapData)` with `mapData && isMapUnlocked(savedAdventure, mapData)`; in the sealed branch, for leap maps say `think(state, 'The runestone is dark. Something here is still wrong.')` instead of the dungeon count (keep the count for plain maps).
- New `function arriveOnMap()` called at the end of both `startNewRun` (when `OPEN_MAPS[depth]`) and `travelToMap`, after `state` is built:

```js
// Leap maps: install the persona while the episode is open, or bring the
// missing person home if it is already resolved.
function arriveOnMap() {
  const mapData = OPEN_MAPS[state.level]
  const ep = episodeFor(mapData)
  state.episode = ep
  state.villagerLines = null
  if (!ep) return
  if (isResolved(savedAdventure, mapData)) {
    state.entities.push(...buildEntities([missingSpawn(mapData)], state.map, state.level))
  } else {
    state.villagerLines = ep.villagerLines
  }
}
```

- New `function resolveEpisode()` (called by the episode modules through ctx, Task 5): if `state.episode && isResolved(...)` and `!state.episodeResolved`: `state.episodeResolved = true; state.villagerLines = null; state.entities.push(...buildEntities([missingSpawn(mapData)], …)); sfx(state, 'leap', {px: player.px, py: player.py}); announce(state, \`${ep.persona} walks back into the village. The runestone hums.\`); persistAdventure()`. Reset `state.episodeResolved = false` in `arriveOnMap` (set true there when already resolved).

- [ ] **Step 4: Run tests** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/data/leaps.js renderer/systems/leap.js renderer/systems/npc.js renderer/game.js renderer/systems/sfx.js renderer/render/audio.js test/leap.test.js test/npc.test.js
git commit -m "feat(leap): episode data, flags, runestone rule, persona lines, resolution"
```

---

### Task 5: The Echo, deliveries, carry-items, and the episode ctx

**Files:**
- Modify: `renderer/systems/leap.js` (Echo spawns, adjacency, deliveries), `renderer/systems/inventory.js` (quest kinds), `renderer/systems/entities.js` (`pick` weapon), `renderer/systems/melee.js`, `renderer/systems/stamina.js`, `renderer/render/sprites.js` (`weapon_pick: 'tile_0117'`), `renderer/render/icons.js`, `renderer/render/canvas.js` (echo draw), `renderer/ui/inventory-panel.js` (no action for quest kinds), `renderer/game.js` (ctx + per-frame tick)
- Create: `renderer/systems/episodes/index.js` (registry: `{ 'lake-1-ferry': ferry, … }` — modules land in Tasks 12–14; export an empty registry now)
- Test: `test/leap.test.js`, `test/inventory.test.js`, `test/melee.test.js`, `test/canvas.test.js`

**Interfaces:**
- Produces:
  - `echoSpawns(mapData) -> [{ kind: 'echo', x, y, spot }]`; `buildEntities` case `'echo'` → `{ type: 'echo', x, y, spot, px, py }`.
  - `echoAdjacent(entities, player) -> echo | null` (orthogonal neighbour or same cell).
  - Deliveries live in the **episode module** data: `DELIVERIES = [{ item, to: { poi } | { species }, sets, gives?: contents }]`; `checkDeliveries(ctx, deliveries) -> delivery | null` performs one delivery per frame: player on the POI cell (or on/adjacent to an NPC of `species`), sack has `item` → remove one, `set(sets)`, returns the delivery (game.js cues `pickup`, drops `gives` as a floating item beside the player, `afterInventoryChange()`).
  - Items: `STACKABLE_KINDS.clapper = { name: 'Bell Clapper', quest: true }`, `fleece = { name: "Lamb's Fleece", quest: true }`; `WEAPON_TYPES.pick = { name: 'Pick', damage: 2, chop: 1, mine: 1 }` (`weaponContents` copies `mine` like `chop`); `ATTACK_STYLES.pick = { style: 'arc', duration: 0.22, cooldown: 0.45, knockback: 16 }`; `MELEE_COSTS.pick = { full: 12 }`; icons `clapper → 'weapon_club'`-style fallback is wrong — paint `item_clapper`, `item_fleece` 16 px placeholders in `tools/npc-placeholders.mjs` (a bronze teardrop; a cream tuft) and map them.
  - Episode ctx (built by `game.js` on arrival, stored as `state.epCtx`): `{ state, save: savedAdventure, mapData, episode, flags: leapFlags(save, name), set(flag, v=true), persist(), resolve(), refreshInventory(), spawn(spawns) }` where `persist = persistAdventure`, `resolve = resolveEpisode`, `refreshInventory = afterInventoryChange`, `spawn = spawns => state.entities.push(...buildEntities(spawns, state.map, state.level))`. Episode modules (Tasks 12–14) receive this ctx in `onArrive(ctx)` (called from `arriveOnMap`) and `tick(ctx, delta)`.
  - Per frame (`update`, after the floating-item pickup block): `tickEpisode(delta)` = Echo adjacency → `speakFrom(state, echo, line)` + `echo` cue (once per approach via `state.echoHold = echo`), then `EPISODE_MODULES[mapName]?.tick(state.epCtx, delta)`.

- [ ] **Step 1: Tests**

`test/leap.test.js` — append:

```js
import { echoSpawns, echoAdjacent, checkDeliveries } from '../renderer/systems/leap.js'
import { makeItem } from '../renderer/systems/inventory.js'

describe('echo', () => {
  it('spawns one echo per spot, on the POI cell', () => {
    const s = echoSpawns(lake)
    assert.equal(s.length, episodeFor(lake).echoSpots.length)
    assert.deepEqual(s[0], { kind: 'echo', x: poiCell(lake, 'runestone').x, y: poiCell(lake, 'runestone').y, spot: 0 })
  })
  it('echoAdjacent finds an echo on or orthogonally beside the player', () => {
    const e = { type: 'echo', x: 5, y: 5, spot: 0 }
    assert.equal(echoAdjacent([e], { x: 5, y: 6 }), e)
    assert.equal(echoAdjacent([e], { x: 6, y: 6 }), null)
  })
})

describe('deliveries', () => {
  const mk = (over) => ({ player: { x: 3, y: 3, inventory: [makeItem('clapper')], maxInventory: 10 }, entities: [], ...over })
  it('delivers to a POI cell when standing on it, removing the item and setting the flag', () => {
    const save = normalizeAdventureSave(null)
    const state = mk({})
    const ctx = { state, save, mapData: { name: 'm', pois: [{ kind: 'landmark', label: 'bell', x: 3, y: 3 }] }, flags: leapFlags(save, 'm'), set: (f, v = true) => setFlag(save, 'm', f, v) }
    const d = checkDeliveries(ctx, [{ item: 'clapper', to: { poi: 'bell' }, sets: 'bell_hung' }])
    assert.equal(d?.sets, 'bell_hung')
    assert.equal(ctx.flags.bell_hung, true)
    assert.equal(state.player.inventory.length, 0)
    assert.equal(checkDeliveries(ctx, [{ item: 'clapper', to: { poi: 'bell' }, sets: 'bell_hung' }]), null)
  })
  it('delivers to an NPC species when beside it, and not to a hostile one', () => {
    const save = normalizeAdventureSave(null)
    const elder = { type: 'npc', species: 'elder', x: 4, y: 3, hostile: false }
    const state = mk({ player: { x: 3, y: 3, inventory: [makeItem('fleece')], maxInventory: 10 }, entities: [elder] })
    const ctx = { state, save, mapData: { name: 'm', pois: [] }, flags: leapFlags(save, 'm'), set: (f, v = true) => setFlag(save, 'm', f, v) }
    elder.hostile = true
    assert.equal(checkDeliveries(ctx, [{ item: 'fleece', to: { species: 'elder' }, sets: 'fleece_shown' }]), null)
    elder.hostile = false
    assert.equal(checkDeliveries(ctx, [{ item: 'fleece', to: { species: 'elder' }, sets: 'fleece_shown' }]).sets, 'fleece_shown')
  })
})
```

`test/inventory.test.js`: `makeItem('clapper').quest === true`, `findQuickUseIndex([makeItem('clapper')]) === -1`, `itemFromContents({ type: 'fleece' }).kind === 'fleece'`. `test/melee.test.js`: `weaponContents('pick')` deep-equals `{ weaponType: 'pick', name: 'Pick', damage: 2, chop: 1, mine: 1 }`. `test/canvas.test.js`: `drawEntity(ctx, { type: 'echo' }, 0, 0, 32, { player_magic: 'WIZ' })` draws `'WIZ'` with alpha `0.5` observed during `drawImage` (extend the recording ctx with `globalAlpha` and `filter` properties like the campfire test).

- [ ] **Step 2: Run** — expected failures on the new functions/kinds.

- [ ] **Step 3: Implement**

`leap.js` additions:

```js
export function echoSpawns(mapData) {
  const ep = episodeFor(mapData)
  return (ep?.echoSpots ?? []).map((s, i) => ({ ...poiCell(mapData, s.fromPoi), kind: 'echo', spot: i }))
    .filter(s => Number.isFinite(s.x)).map(({ kind, x, y, spot }) => ({ kind, x, y, spot }))
}

export function echoAdjacent(entities, player) {
  return entities.find(e => e.type === 'echo' && Math.abs(e.x - player.x) + Math.abs(e.y - player.y) <= 1) ?? null
}

const carries = (player, kind) => player.inventory.findIndex(i => i.kind === kind)
const onCell = (player, c) => c && player.x === c.x && player.y === c.y
const besideNpc = (entities, player, species) => entities.some(e => e.type === 'npc' && e.species === species && !e.hostile
  && Math.abs(e.x - player.x) + Math.abs(e.y - player.y) <= 1)

// One delivery per call: the first whose item is carried and whose target the
// player stands on (POI) or beside (NPC of the species). Removes one item,
// sets the flag, returns the delivery for game.js to cue and drop `gives`.
export function checkDeliveries(ctx, deliveries) {
  const { state, mapData, flags } = ctx
  for (const d of deliveries) {
    if (flags[d.sets]) continue
    const i = carries(state.player, d.item)
    if (i === -1) continue
    const here = d.to.poi ? onCell(state.player, poiCell(mapData, d.to.poi)) : besideNpc(state.entities, state.player, d.to.species)
    if (!here) continue
    removeItem(state.player, i)
    ctx.set(d.sets)
    return d
  }
  return null
}
```

(import `removeItem` from `./inventory.js`). Inventory: add kinds with `extra: { quest: true }`; `CONSUMABLE_KINDS` unchanged (quest kinds are not consumable); panel `primaryAction` returns null for `quest` items (Drop stays available). `icons.js`: `clapper: 'item_clapper', fleece: 'item_fleece'`. Weapon `pick` per the Interfaces block; `weaponContents` adds `...(def.mine && { mine: def.mine })`.

`canvas.js` `drawEntity` — before the `floating_item` branch:

```js
  if (entity.type === 'echo') {
    const s = sprites.player_magic
    if (!s) return
    const prevA = ctx.globalAlpha, prevF = ctx.filter
    ctx.globalAlpha = prevA * 0.5
    ctx.filter = 'hue-rotate(160deg) saturate(0.6)'
    ctx.drawImage(s, px, py, S, S)
    ctx.filter = prevF; ctx.globalAlpha = prevA
    return
  }
```

`game.js`: `buildEntities` case `'echo': return [{ type: 'echo', x: s.x, y: s.y, spot: s.spot, px: cx, py: cy }]`; in `arriveOnMap` push `buildEntities(echoSpawns(mapData), …)` and build `state.epCtx`; in `update` after the floating-item pickup:

```js
  // Leap episodes: the Echo speaks when approached; the episode module runs.
  if (state.epCtx) {
    const echo = echoAdjacent(state.entities, player)
    if (echo && state.echoHold !== echo) {
      const line = echoLine(state.episode, echo.spot, state.epCtx.flags, ruleCtx(savedAdventure, state.epCtx.mapData))
      if (line) { speakFrom(state, echo, line); sfx(state, 'echo', { px: echo.px, py: echo.py }) }
    }
    state.echoHold = echo
    EPISODE_MODULES[state.epCtx.mapData.name]?.tick(state.epCtx, delta)
  }
```

`speakFrom` anchors by `entity.id` — give echoes `id: \`echo:${s.spot}\``. Create `renderer/systems/episodes/index.js` exporting `EPISODE_MODULES = {}` for now. `isHittable`/`isEnemy` are untouched (echo is scenery); `drawHealthBars` skips it (no hp).

- [ ] **Step 4: `npm test`** → PASS. **Step 5: Commit** `feat(leap): the Echo, deliveries, quest items, the pick`.

---

### Task 6: Harvestable rocks

**Files:**
- Modify: `renderer/systems/lumber.js`, `renderer/game.js:939-960` (swing block), `renderer/systems/openmap.js` (nothing — rocks are already blocking overlays)
- Test: `test/lumber.test.js`

**Interfaces:**
- Produces: `HARVEST` table (trees `tool: 'chop'`; `ow_rock_gray_0/1/2`, `ow_rock_gray_moss_0/1/2`, `ow_rock_brown_0/1/2`, `ow_rock_brown_moss_0/1/2` → `{ hp: 3, yield: 0, cells: 1, tool: 'mine' }`); `findHarvestHit(map, player, hitAt, reachPx, weapon)` (weapon = `{ chop?, mine? }`; only defs whose tool the weapon carries); `harvest(map, x, y, weapon) -> { felled, yield, kind: 'tree' | 'rock' }`; cleared rocks → `tile FLOOR, overlay null, cell.cleared = 'rock'`; `felledCells` includes cleared rocks; `applyFelled` re-clears them. `TREES`, `resolveTree`, `chopTree`, `findTreeHit` remain as thin wrappers (chop only) so existing tests pass unchanged.

- [ ] **Step 1: Tests** — append to `test/lumber.test.js`:

```js
import { HARVEST, findHarvestHit, harvest } from '../renderer/systems/lumber.js'
describe('rocks', () => {
  const rock = (m, x, y) => { m[y][x].tile = TILE.WALL; m[y][x].overlay = 'ow_rock_gray_1' }
  it('a pick mines a rock in three blows; the cell clears to plain floor and is recorded', () => {
    const m = grass(); rock(m, 3, 3)
    assert.equal(HARVEST.ow_rock_gray_1.tool, 'mine')
    assert.deepEqual(harvest(m, 3, 3, { mine: 1 }), { felled: false, yield: 0, kind: 'rock' })
    assert.deepEqual(harvest(m, 3, 3, { mine: 2 }), { felled: true, yield: 0, kind: 'rock' })
    assert.equal(m[3][3].tile, TILE.FLOOR); assert.equal(m[3][3].overlay, null)
    assert.deepEqual(felledCells(m), ['3,3'])
    const fresh = grass(); rock(fresh, 3, 3); applyFelled(fresh, ['3,3']); assert.equal(fresh[3][3].tile, TILE.FLOOR)
  })
  it('a hatchet cannot mine and a pick can also chop', () => {
    const m = grass(); rock(m, 3, 3); tree(m, 4, 3, 'ow_tree_small')
    assert.deepEqual(harvest(m, 3, 3, { chop: 1 }), { felled: false, yield: 0, kind: null })
    assert.equal(findHarvestHit(m, player(2, 3), anyHit, 46, { chop: 1 }), null)
    assert.deepEqual(findHarvestHit(m, player(2, 3), anyHit, 46, { mine: 1 }), { x: 3, y: 3 })
    assert.deepEqual(harvest(m, 4, 3, { chop: 1, mine: 1 }), { felled: false, yield: 0, kind: 'tree' })
  })
})
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** — build `HARVEST = { ...Object.fromEntries(Object.entries(TREES).map(([k, v]) => [k, { ...v, tool: 'chop' }])), ...rocks }`; `harvestAt(map, x, y)` replaces `treeAt` (same border guard, looks up `HARVEST`); `resolveHarvest` = `resolveTree` logic over `HARVEST`; `findHarvestHit` filters `weapon[def.tool]`; `harvest` deals `weapon[def.tool]` and on 0 calls `fell` for trees or `clearRock` (FLOOR, `overlay = null`, `cleared = 'rock'`, `delete losSoft`); `felledCells` collects `overlay === STUMP || cell.cleared === 'rock'`; `applyFelled` clears either. Wrappers: `findTreeHit = (m, p, h, r) => findHarvestHit(m, p, h, r, { chop: 1 })`, `chopTree = (m, x, y, chop) => { const r = harvest(m, x, y, { chop }); return { felled: r.felled, yield: r.yield } }`. `game.js` swing: `const tool = { chop: player.weapon?.chop, mine: player.weapon?.mine }; if (tool.chop || tool.mine) { const hit = findHarvestHit(state.map, player, hitAt, reach, tool); … const res = harvest(…); cue 'chop' for trees, 'wall-slam' for rocks; lumber drop only when res.yield > 0 }`.

- [ ] **Step 4: `npm test`** → PASS. **Step 5: Commit** `feat(lumber): the pick mines rocks`.

---

## Phase 3 — creatures

### Task 7: Creature art and 2×2 drawing

**Files:**
- Modify: `tools/npc-placeholders.mjs` (twelve tiles), `renderer/render/sprites.js`, `renderer/render/canvas.js` (`drawCreature`)
- Create (generated): `renderer/assets/tiles/custom_nakki_{00,01,10,11}.png`, `custom_maahinen_*`, `custom_sammunut_*`, plus `item_clapper.png`, `item_fleece.png` if Task 5 deferred them
- Test: `test/sprites.test.js`, `test/canvas.test.js`

**Interfaces:**
- Produces: sprite keys `custom_<name>_<q>` (key === file); `drawCreature(ctx, sprites, name, px, py, S, { alpha = 1 } = {})` draws the four quadrants into the 64 px box at `(px - S/2, py - S/2)`; `CREATURE_SPRITES = { nakki: 'custom_nakki', maahinen: 'custom_maahinen', sammunut: 'custom_sammunut' }`.

- [ ] **Step 1: Tests** — sprites: loop the twelve keys `custom_${name}_${q}` for names `nakki|maahinen|sammunut`, q in `00|01|10|11`, assert `SPRITES[key] === key` and the file exists (the existing existence test covers the second). canvas:

```js
describe('drawCreature', () => {
  it('draws the four quadrants row-major into a 2x2 box anchored like the cyclops', () => {
    const calls = []
    const ctx = { drawImage: (img, x, y, w, h) => calls.push([img, x, y, w, h]), globalAlpha: 1 }
    const spr = Object.fromEntries(['00', '01', '10', '11'].map(q => [`custom_nakki_${q}`, q]))
    drawCreature(ctx, spr, 'nakki', 100, 100, 32)
    assert.deepEqual(calls, [['00', 84, 84, 32, 32], ['01', 116, 84, 32, 32], ['10', 84, 116, 32, 32], ['11', 116, 116, 32, 32]])
  })
})
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Paint** — twelve `paint([...])` rows in `npc-placeholders.mjs` (each quadrant 16 rows × 16 chars; design each creature on a 32×32 grid first, then split). Näkki (`n` weed-green `[60,90,60]`, `k` black-green `[20,35,30]`, `e` pale eye `[220,235,200]`): head and shoulders only, water line across the bottom quadrants. Maahinen (`b` brown `[120,80,45]`, `d` dark `[70,45,25]`, `c` claw `[200,190,170]`): blunt snout top, two claws bottom. Sammunut (`g` blue-grey `[120,130,160]`, `w` pale `[200,205,220]`, `r` ember `[255,120,40]`): ragged hood, one ember eye, trailing wisps, no feet. Register all keys in `sprites.js` under a `// leap creatures (editor-native custom tiles, 2x2)` comment. Add to `canvas.js`:

```js
export const CREATURE_SPRITES = { nakki: 'custom_nakki', maahinen: 'custom_maahinen', sammunut: 'custom_sammunut' }
export function drawCreature(ctx, sprites, name, px, py, S, { alpha = 1 } = {}) {
  const base = CREATURE_SPRITES[name]
  const prev = ctx.globalAlpha
  ctx.globalAlpha = prev * alpha
  for (const [q, dx, dy] of [['00', 0, 0], ['01', 1, 0], ['10', 0, 1], ['11', 1, 1]]) {
    const s = sprites[`${base}_${q}`]
    if (s) ctx.drawImage(s, px - S / 2 + dx * S, py - S / 2 + dy * S, S, S)
  }
  ctx.globalAlpha = prev
}
```

Render a contact sheet of the three creatures (PIL, 4× nearest) into the scratchpad and Read it; iterate rows until each reads as described.

- [ ] **Step 4: `npm test`** → PASS. **Step 5: Commit** `art(creatures): Näkki, Maahinen, Sammunut as editor-native 2x2 custom tiles`.

---

### Task 8: `systems/creatures.js` — hit routing, factions, dispatch

**Files:**
- Create: `renderer/systems/creatures.js`
- Modify: `renderer/systems/factions.js`, `renderer/data/enemy-ai.js` (`maahinen`, `sammunut`, `nakki` rows), `renderer/game.js` (swing `:946-954`, projectile hit `:1116`, enemy loop `:1153`, `buildEntities`, `drawEntity` dispatch)
- Test: `test/creatures.test.js`, `test/factions.test.js`

**Interfaces:**
- Produces: `CREATURE_TYPES = ['nakki', 'maahinen', 'sammunut']`, `isCreature(e)`; `strikeCreature(e, state, dmg) -> { entity, absorbed, cue }` — the ONE place player damage to a creature is decided (Tasks 9–11 fill in per-type behaviour via `CREATURE_HIT[type](e, state, dmg)`; default: `hp - dmg`); `isEnemy` includes creature types **except** `nakki` (it must not be chased/targeted as a combatant; it is `isHittable` only); `enemy-ai.js` rows: `maahinen: { taxon: 'beast', speed: 70, wanderSpeed: 0, half: 28, sightRange: 320, stopRange: 30, fleeHp: 0 }`, `sammunut: { taxon: 'beast', speed: 80, wanderSpeed: 40, half: 12, sightRange: 400, stopRange: 0, fleeHp: 0 }`.
- `game.js`: swing → `if (isCreature(e)) { const r = strikeCreature(e, state, dmg); if (r.cue) sfx(…); return r.entity }` (before the generic `hitEnemy` construction; no knockback for creatures); projectile hit likewise; enemy loop → `if (isCreature(e)) { updateCreature(e, state, delta); continue }` where `updateCreature` dispatches to the per-type update registered by Tasks 9–11 (`CREATURE_UPDATE[type]`); `buildEntities` case `'creature'` → `CREATURE_MAKE[s.creature](s.x, s.y)` spread with `px, py`; `drawEntity` → `if (isCreature(entity)) { drawCreature(ctx, sprites, entity.type, px + S/2, py + S/2, S, { alpha: creatureAlpha(entity, state?) }) ; return }` — `drawEntity` has no `state`; add an optional `drawOpts` param carrying `{ alpha }` computed by the caller (`canvas.js:909` loop) via `CREATURE_ALPHA[type](entity, state)` (default 1).

- [ ] **Step 1: Tests** — `test/factions.test.js`: `isEnemy({ type: 'maahinen' })` true, `isEnemy({ type: 'nakki' })` false, `isHittable({ type: 'nakki' })` true. `test/creatures.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isCreature, strikeCreature, CREATURE_HIT, CREATURE_UPDATE, CREATURE_ALPHA, updateCreature } from '../renderer/systems/creatures.js'
describe('creature registry', () => {
  it('unregistered types take plain damage; registered hooks decide', () => {
    assert.equal(isCreature({ type: 'maahinen' }), true); assert.equal(isCreature({ type: 'npc' }), false)
    const e = { type: 'maahinen', hp: 10, maxHp: 24 }
    assert.deepEqual(strikeCreature(e, {}, 3), { entity: { ...e, hp: 7, inCombat: true }, absorbed: false, cue: 'melee-hit' })
    CREATURE_HIT.testtype = (e) => ({ entity: e, absorbed: true, cue: 'chop' })
    assert.equal(strikeCreature({ type: 'testtype', hp: 1 }, {}, 5).absorbed, true)
    delete CREATURE_HIT.testtype
  })
  it('updateCreature is a no-op for a type with no update', () => { assert.doesNotThrow(() => updateCreature({ type: 'nakki' }, {}, 0.016)) })
})
```

- [ ] **Step 2–5**: implement per the Interfaces block (registries are plain mutable objects the per-type modules populate on import: `CREATURE_HIT`, `CREATURE_UPDATE`, `CREATURE_MAKE`, `CREATURE_ALPHA`; `game.js` imports the three creature modules for their side effect once they exist — for now import only `creatures.js`), run `npm test`, commit `feat(creatures): registry, hit routing, dispatch`.

---

### Task 9: The Näkki

**Files:**
- Create: `renderer/systems/nakki.js`
- Test: `test/nakki.test.js`

**Interfaces:**
- Produces: `makeNakki(x, y) -> { type: 'nakki', x, y, px, py, state: 'surfaced', timer: 0, dragCooldown: 0, pierEnd: null }` (no `hp`/`maxHp`); `updateNakki(e, state, delta)`: `submerged` counts `timer` down from `SUBMERGE_TIME = 4` then surfaces; `surfaced` and the player is on `e.pierEnd` cell: `dragCooldown` ticks; at 0 → `damagePlayer(state, 1, 'hit', 'The lake pulls at you!')`, `sfx('drag')`, `dragCooldown = DRAG_INTERVAL = 2`. `sinkNakki(e)` → `submerged`, `timer = SUBMERGE_TIME`. `feedNakki(e, player) -> boolean` — surfaced and the sack holds `cooked_meat` (not raw): removes one, sinks it, returns true. Registers `CREATURE_HIT.nakki = (e) => ({ entity: sunk copy, absorbed: true, cue: 'drag' })`, `CREATURE_UPDATE.nakki`, `CREATURE_MAKE.nakki`, `CREATURE_ALPHA.nakki = e => e.state === 'surfaced' ? 1 : 0`.

- [ ] **Step 1: Tests** (`test/nakki.test.js`, fixture like `cyclops.test.js`; player `{ x, y, px, py, hp: 10, inventory, maxInventory: 10, invulnTimer: 0 }`): surfaced → after `sinkNakki` state is `submerged` and `timer === 4`; 4.1 s of updates resurfaces it; on the pier end with the player there, two seconds of updates deal exactly 1 damage (drag) and set `dragCooldown` to 2; off the pier end no damage; `feedNakki` with raw meat only → false and nothing removed; with cooked meat → true, one removed, state submerged; `strikeCreature(nakki, state, 5)` → `absorbed: true`, entity submerged, no `hp` key added.

- [ ] **Step 2–5**: implement (`damagePlayer` from `./player-damage.js`; `sfx` from `./sfx.js`), `npm test`, commit `feat(creatures): the Näkki`.

---

### Task 10: The Maahinen

**Files:**
- Create: `renderer/systems/maahinen.js`
- Modify: `renderer/render/canvas.js` (erupt dust ring: reuse the cyclops slam-ring drawing with brown colour when `entity.state === 'erupting'`)
- Test: `test/maahinen.test.js`

**Interfaces:**
- Produces: `makeMaahinen(x, y) -> { type: 'maahinen', hp: 24, maxHp: 24, state: 'submerged', timer: 0, weaponId: 'maul', damageCooldown: 0, inCombat: false, aiHalf: 28, facing: 'east', home: { x, y } }`; `updateMaahinen(e, state, delta)`:
  - `submerged`: invulnerable, invisible; glides toward the player at `BURROW_SPEED = 60` px/s ignoring walls; when within `ERUPT_DIST = 48` px and `timer <= 0` → snap to the nearest walkable tile centre (`isWalkable`) and `state = 'erupting', timer = ERUPT_TIME = 0.6`, cue `erupt`.
  - `erupting`: stationary, vulnerable; at `timer <= 0` → `surfaced`.
  - `surfaced`: `act(e, state, delta, updateBrain(e, state, delta))` + `tryStartEnemyAttack(e, state)`; when `hp <= maxHp / 2` and `!e.dived` → `submerging`, `timer = 0.4`, `dived = true`.
  - `submerging`: at `timer <= 0` → teleport to a walkable tile 4–6 tiles from the player (deterministic search rings, first fit), `state = 'submerged', timer = RESURFACE_DELAY = 2`.
  - `CREATURE_HIT.maahinen`: absorbed while `submerged`/`submerging` (cue `null`); otherwise plain damage; a second dive after the first is allowed once `hp <= maxHp / 4` (`dived2`).
  - `CREATURE_ALPHA.maahinen = e => e.state === 'submerged' ? 0 : e.state === 'submerging' ? 0.4 : 1`.

- [ ] **Step 1: Tests**: initial shape; submerged glide reduces distance to the player by ~60 px per second and never changes state beyond 48 px; within 48 px → `erupting` with `timer 0.6`; 0.7 s later `surfaced`; `strikeCreature` while submerged is absorbed and hp unchanged; while surfaced hp drops; at hp 12 the next update enters `submerging`; after 0.5 s it is `submerged` at a tile 4–6 Chebyshev from the player; `stepEnemyAttack`/`tryStartEnemyAttack` — verify in `game.js` that `stepEnemyAttack` runs for every entity with `e.attack` (grep); if it is gated by type, extend the gate to creatures and note it in the report.

- [ ] **Step 2–5**: implement, `npm test`, commit `feat(creatures): the Maahinen`.

---

### Task 11: The Sammunut and eternal campfires

**Files:**
- Create: `renderer/systems/sammunut.js`
- Modify: `renderer/systems/campfire.js` (`makeCampfire(x, y, { eternal })`, `tickCampfires` skips eternal, `campfireAlpha` = 1 for eternal), `renderer/systems/stamina.js` (export `drainStamina(player, amount)` = `spendStamina` without the regen reset? — no: use `spendStamina` so regen pauses; touch is meant to be felt)
- Test: `test/sammunut.test.js`, `test/campfire.test.js`

**Interfaces:**
- Produces: `makeSammunut(x, y) -> { type: 'sammunut', hp: 18, maxHp: 18, px, py, x, y, target: null, wanderT: 0, touchT: 0, inCombat: false }`; `nearestFire(entities, e) -> campfire | null`; `inFirelight(entities, px, py) -> boolean` (any campfire within `FIRELIGHT = 160` px); `sammunutVisible(e, state) -> boolean` = `inFirelight(...) || (state.player.trance ?? 0) > 0 || e.touchT > 0`; `updateSammunut`: pick `target` = nearest campfire (re-evaluated every frame); move straight toward it at `DRIFT = 80` px/s ignoring walls (clamped inside the map interior); on arrival (< 16 px) and `!target.eternal` → remove that campfire from `state.entities`, cue `campfire-out`; no fire → wander toward a random interior point re-picked every 3 s; player within `TOUCH = 20` px → `spendStamina(player, 12 * delta)`, `touchT = 0.5`, cue `wraith-touch` throttled to once per 0.5 s. `CREATURE_HIT.sammunut`: vulnerable only when `inFirelight(state.entities, e.px, e.py)`; else `absorbed: true, cue: 'chop'`. `CREATURE_ALPHA.sammunut = (e, state) => sammunutVisible(e, state) ? 0.85 : 0`. `drawHealthBars` must skip it when invisible: set `inCombat` only when struck while vulnerable, and clear `inCombat` whenever invisible.
- Campfire: `makeCampfire(x, y, { eternal = false } = {})`; `tickCampfires` never expires eternal fires; `campfireAlpha` returns 1 for eternal.

- [ ] **Step 1: Tests**: fire-seeking (moves toward the only campfire, removes it on arrival, cues), eternal fire survives arrival; wander when no fire (position changes, stays inside the map); touch drains 12/s and sets `touchT`; visibility rules (each of the three conditions); invulnerable outside firelight (absorbed, hp unchanged), vulnerable inside (hp drops); `campfire.test.js`: eternal fire survives `tickCampfires` past 60 s and has alpha 1.

- [ ] **Step 2–5**: implement, `npm test`, commit `feat(creatures): the Sammunut; eternal campfires`.

---

## Phase 4 — the episodes

### Task 12: Episode — The Ferryman's Bell

**Files:**
- Create: `renderer/systems/episodes/ferry.js`; Modify: `renderer/systems/episodes/index.js` (register), `renderer/game.js` (drop `gives`, cue on delivery, nothing else), `renderer/systems/openmap.js` (nothing), `tools/static-overworld/gen-leap.mjs` (nothing)
- Test: `test/episodes-ferry.test.js`

**Interfaces:**
- `DELIVERIES = [{ item: 'clapper', to: { poi: 'bell' }, sets: 'bell_hung' }]`; the clapper is the `islet cache` chest's contents: `openmap.js` chest spawns get `contents` when the episode declares `items: [{ kind: 'clapper', fromPoi: 'islet cache' }]` → add `items` to the lake episode in `data/leaps.js` and, in `openmap.js`, `{ kind: 'chest', x, y, contents: { type: 'clapper' } }` for a chest POI whose label matches; `buildEntities` `'chest'` case uses `s.contents ?? rollChestLoot(depth)`.
- `onArrive(ctx)`: if `flags.nakki_gone` → open the pier gaps (`pier gap 1/2` cells → `tile FLOOR`, `skin 'ow_pier_log'`, `overlay null`, `delete losClear`); else if `flags.bell_hung` → spawn the Näkki at `nakki` POI with `pierEnd = poiCell('pier end')`.
- `tick(ctx, delta)`: `checkDeliveries` → on `bell_hung` cue `bell`, spawn the Näkki; feeding: player on `pier end`, a surfaced Näkki, `feedNakki(e, player)` true → `set('fed', (flags.fed ?? 0) + 1)`, cue `sizzle`, `ctx.refreshInventory()`; at `fed >= 3` → `set('nakki_gone')`, remove the Näkki, open the pier gaps, `ctx.resolve()`.

- [ ] **Step 1: Tests** (fake ctx with a 12×12 map, POIs at known cells, `state.entities`, `save` from `normalizeAdventureSave(null)`): delivery on the bell cell spawns a surfaced Näkki at the `nakki` POI with `pierEnd` set; feeding three times (player on pier end, cooked meat in sack, Näkki surfaced each time — call `updateNakki` past 4 s between feeds) sets `fed` 1,2,3 then `nakki_gone`, removes the Näkki, and the gap cells are FLOOR with `ow_pier_log`; `onArrive` with `nakki_gone` already set opens the gaps and spawns nothing; `onArrive` with only `bell_hung` spawns the Näkki.

- [ ] **Step 2–5**: implement, `npm test`, commit `feat(episodes): The Ferryman's Bell`.

---

### Task 13: Episode — Wolves at the Fold

**Files:**
- Create: `renderer/systems/episodes/fold.js`; Modify: `episodes/index.js`, `data/leaps.js` (`items: [{ kind: 'fleece', fromPoi: 'fleece cache' }]`), `renderer/game.js` (delivery `gives` drop already generic)
- Test: `test/episodes-fold.test.js`

**Interfaces:**
- `DELIVERIES = [{ item: 'fleece', to: { species: 'elder' }, sets: 'fleece_shown', gives: { type: 'weapon', ...weaponContents('pick') } }]`.
- `BURN_INTERVAL = 120`, `BURN_STAGES = 4`, `BURN_RADIUS = 6`. `burnBand(map, mapData, n) -> string[]` converts every tree overlay (`HARVEST` keys with `tool: 'chop'`, tops included) within radius 6 of `burn n` to `ow_deadtree_0`/`_1` (alternating), keeps `tile WALL` and `losSoft`, returns the `'x,y'` keys; keys accumulate in `flags.burnt` (array) and `onArrive` re-applies them (`applyBurnt(map, keys)`).
- `tick`: while `!flags.fleece_shown && (flags.burn ?? 0) < 4`: `state.burnT += delta`; at `>= 120` → `burnT = 0`, `set('burn', burn + 1)`, `burnBand`, cue `fire-burst` at the band centre, `think('Smoke on the ridge — they've lit another band.')`; at `burn === 4` → `state.npcWrath = true` and every `faction === 'village'` NPC with `onHit === 'fight'` gets `hostile = true` (mirror `onNpcHit`'s wrath path — import the helper if `npc.js` exports one, else replicate), `announce('The village turns on you!')`. On `fleece_shown`: `state.npcWrath = false`, all village NPCs `hostile = false`, cue `talent-learned`. Maahinen: `onArrive` spawns it at `lair` if `!flags.maahinen_dead` and sets `flags.maahinen_spawned`; `tick`: if `flags.maahinen_spawned && !flags.maahinen_dead && !entities.some(maahinen)` → `set('maahinen_dead')`, `ctx.resolve()` (resolve checks the wolves via the rule).
- `checkDeliveries` is called before the burn tick so a delivery on the same frame stops the burn.

- [ ] **Step 1: Tests**: burnBand converts only trees inside the radius and returns their keys; applyBurnt re-applies; the timer advances `burn` every 120 s and stops after 4 / after `fleece_shown`; stage 4 flips village NPCs hostile and the wrath flag; delivery clears them; the Maahinen death detection sets the flag and calls `ctx.resolve` (spy), and `isMapUnlocked` is true only with a wolf alive.

- [ ] **Step 2–5**: implement, `npm test`, commit `feat(episodes): Wolves at the Fold`.

---

### Task 14: Episode — The Hermit's Fire

**Files:**
- Create: `renderer/systems/episodes/hermit.js`; Modify: `episodes/index.js`, `renderer/data/npcs.js` (`hermit` species: villager sprite `npc_elder`, `lines: ['…']`, `hp: 2`, `onHit: 'flee'`, `roam: 1`), `tools/static-overworld/export-game-maps.mjs` (marsh `npcs.village` gains `'hermit'` — the sampler homes village NPCs at the `village` POI; add `home: 'hermit hut'` support: `npcSpawnsForMap` places species listed under `npcs.at = { 'hermit hut': ['hermit'] }` at that POI's nearest walkable cell — small extension in `openmap.js`, tested in `test/openmap.test.js`)
- Test: `test/episodes-hermit.test.js`, `test/openmap.test.js`

**Interfaces:**
- `onArrive`: if `!flags.wraith_dead` spawn the Sammunut at a random interior walkable cell ≥ 20 tiles from the player (deterministic: first cell scanning from the map's far corner that satisfies it); if `flags.hearth_lit` and no eternal fire at the hearth, re-create the eternal campfire there (fires are not saved, but the hearth's is re-derived from the flag); if `flags.wraith_dead` → hearth props lit (`hearth 1..3` cells `overlay = 'prop_hearth_lit'`), hermit lines = `EPISODES[...].hermitLines` (add to data: `['You came back.', 'The fire held. I was wrong, Lauri.']`).
- `tick`: a campfire within Chebyshev 1 of the `hearth` POI and `!flags.hearth_lit` → `set('hearth_lit')`, mark that fire `eternal = true`, snap its `x,y` to the hearth cell if free, cue `campfire-light`, `think('His wood. It holds.')`; wraith death detection as in Task 13 (`sammunut_spawned` flag) → `set('wraith_dead')`, light the hearth props, set hermit lines (`state.villagerLines` is cleared on resolve — hermit lines live in `state.speciesLines = { hermit: […] }`, read by `interactNpc` the same way; simplest: keep `state.villagerLines` but resolution sets it to `{ hermit: hermitLines }` instead of null for this map — implement via an optional `episode.resolvedLines`), `ctx.resolve()`.

- [ ] **Step 1: Tests**: hearth detection marks the adjacent fire eternal and sets the flag (and not a fire two tiles away); the eternal fire survives `tickCampfires`; `onArrive` re-creates it from the flag; wraith death lights the three hearth props and sets `wraith_dead`; `npcs.at` places the hermit beside the hut POI.

- [ ] **Step 2–5**: implement, `npm test`, commit `feat(episodes): The Hermit's Fire`.

---

### Task 15: Live verification, docs, memory

**Files:**
- Scratch: `<scratchpad>/verify-leap-<episode>.mjs` ×3 (not committed)
- Modify: `~/CLAUDE.md` (dungeon-crawler systems list: `leap`, `episodes/`, `creatures`, `nakki`, `maahinen`, `sammunut`), `README`-level doc if the repo has one for cheats (`level8..10`)

- [ ] **Step 1**: Per episode, a Playwright driver (pattern: `tools/verify-npcs.mjs`, `--dcdebug`, `window.__dc.state`): type the `level<N>` cheat on the title screen (check how `parseLevelCheat` is fed — the arena skill docs describe it) to land on the map, then: **Ferry** — read the runestone Echo line (walk beside it, assert `state.feedback.bubble.text`), push a clapper into the sack, teleport to the bell cell → `flags.bell_hung`, Näkki entity present; push 3 cooked meat, stand on the pier end and wait through three surface cycles → `nakki_gone`, gap cells walkable, a `missing` NPC exists; screenshot the Näkki surfaced. **Fold** — set `state.burnT = 119` and step → `burn 1` and dead trees near `burn 1`; push fleece, teleport beside the elder → `fleece_shown`, a pick floating item; equip it, teleport to the burrow mouth, swing at the rocks until clear; teleport near the lair → Maahinen erupts (screenshot); set its hp to 1 and swing → `maahinen_dead`, runestone unlocked (`isMapUnlocked` via a page-side import is not available — assert `flags` and that stepping on the exit cell travels to depth 10). **Hermit** — push 3 lumber, stand beside the hearth, build → `hearth_lit`, eternal fire; wait for the Sammunut to arrive within firelight (or teleport it), screenshot it visible; set hp 1, swing → `wraith_dead`, hearth props lit. Time-box 25 minutes total; report exactly what passed and what was skipped.
- [ ] **Step 2**: `git status --short renderer/data/` clean; `npm test` green.
- [ ] **Step 3**: Docs + memory note; commit `docs: leap episodes systems`.
