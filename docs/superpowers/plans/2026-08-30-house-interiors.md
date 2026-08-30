# House Interiors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every house door on the open maps walks into a generated one-floor interior (danger by tier, persistent like caves, reset after 180 s), and the three story houses hold the leap episodes' required items as walk-into floor pickups laid out in authored prefab rooms.

**Architecture:** A pure `systems/houses.js` scans door art into `houseDoors` triggers (label, tier, story), owns `INTERIOR_CONFIG`/`INTERIOR_DEPTH`, and turns prefab pickup slots into `floating_pickup` spawns. The dungeon BSP (`generateLevel`) gains a config override, a per-config monster `variantPool`, wooden floors, and interaction-field passthrough from prefabs. `game.js` adds `enterHouse(door)` beside `enterCave`, reusing `buildCaveState`/`restoreSurface`/`caveInstances` unchanged. Story rooms are `structures.json` prefabs (editor-native format) referenced from episode data.

**Tech Stack:** Electron + vanilla JS ES modules, `node:test`, existing BSP generator and cave transition, `renderer/data/structures.json` prefab format.

**Spec:** `docs/superpowers/specs/2026-08-30-house-interiors-design.md`

## Global Constraints

- `renderer/systems/` pure; `game.js` owns wiring and messages.
- Door label `house:<mapName>:<x>,<y>`; tiers `safe` (Chebyshev ≤ 10 of the `village`/`camp` POI), `ruin` (door art `ow_house_arch_stone`, or no village/camp POI on the map), else `hut`; story houses are always `hut`.
- `INTERIOR_DEPTH = 19`; interiors 44×28; `landmark: null` for generic houses; no boss ever (instances always `cleared`, reset after `CAVE_RESET_TIME`).
- Danger table: safe — no monsters, potions 0.006; hut — `monsterDensity 0.006` pool `['weak']`, potions 0.006, weapons 0.004; ruin — `monsterDensity 0.010` pool `['medium','medium','strong']`, potions 0.008, weapons 0.008. Guards 0 everywhere. Traps/puzzles 0.
- Theme for depth 19: `floorTile: 'floor_wood'`, `bgColor '#120c06'`, `fogAlpha 0.55`, props by tier; interior floor cells are `TILE.FLOOR_WOOD`.
- Story pickups are `floating_item`s with `progress: 1` on prefab-marked cells; `{ type: 'meat', count: 3 }` is one stack.
- Messages: `'You step inside.'` / `'You step back out.'`; cues `door-open` (new) and `emerge`. No other text.
- No save version change. Cave arches and their gates are untouched.
- Tests via `npm test` (baseline 1386/1386). Commit per task, messages ending with the trailer lines `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_0145GUz8i7BMgPBG97pbMtge`.
- `renderer/data/open-maps.js` is generated: edit `tools/static-overworld/gen-leap.mjs`, run `node tools/static-overworld/gen-leap.mjs && node tools/static-overworld/export-game-maps.mjs` from the repo root; only the intended map JSON may change.

---

### Task 1: Door scan, tiers, story doors

**Files:**
- Create: `renderer/systems/houses.js`
- Modify: `renderer/systems/openmap.js` (`buildOpenMap` — door cells walkable, return `houseDoors`), `renderer/data/leaps.js` (`houses` keys only, contents in Task 3), `tools/static-overworld/gen-leap.mjs` (`Aino's house` POI), regenerate `open-maps.js` + `highland-2-fold.json`
- Test: `test/houses.test.js` (new), `test/openmap.test.js`, `test/leap-maps.test.js`

**Interfaces:**
- Produces: `HOUSE_DOOR_PREFIXES = ['ow_house_door', 'ow_house_arch_']`, `isHouseDoorArt(name)`, `houseDoorsForMap(data, episode) -> [{ x, y, label, tier, story }]`, `tierForDoor(data, x, y, art) -> 'safe'|'hut'|'ruin'`, `storyForDoor(data, episode, x, y) -> string|null` (nearest `episode.houses` POI within Chebyshev 4). `buildOpenMap` returns `houseDoors` (empty array on maps without houses); door cells `tile === TILE.FLOOR` with the door art kept as `overlay`, `losSoft` absent.
- Episode data: `EPISODES[map].houses = { "<poi label>": { room, pickups } }` (Task 3 fills `room`/`pickups`; this task adds the keys with `room: null, pickups: []` for the three story houses so the scan can resolve them).

- [ ] **Step 1: Write the failing tests**

`test/houses.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isHouseDoorArt, houseDoorsForMap, tierForDoor, storyForDoor } from '../renderer/systems/houses.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import { EPISODES } from '../renderer/data/leaps.js'

const byName = Object.fromEntries(Object.values(OPEN_MAPS).map(m => [m.name, m]))
const doorCount = m => m.prop.flat().filter(pi => pi >= 0 && isHouseDoorArt(m.palette[pi])).length

describe('door art', () => {
  it('matches house doors and arches, not signs, walls or cave arches', () => {
    for (const ok of ['ow_house_door', 'ow_house_door_brown', 'ow_house_door_gray', 'ow_house_arch_stone', 'ow_house_arch_brown']) assert.equal(isHouseDoorArt(ok), true, ok)
    for (const no of ['ow_sign', 'ow_house_wall_l', 'ow_cave_arch_0', 'ow_cave_gate_l', 'ow_house_wall_win']) assert.equal(isHouseDoorArt(no), false, no)
  })
})

describe('houseDoorsForMap', () => {
  it('finds every door cell on every open map with unique, stable labels', () => {
    for (const m of Object.values(OPEN_MAPS)) {
      const doors = houseDoorsForMap(m, EPISODES[m.name] ?? null)
      assert.equal(doors.length, doorCount(m), m.name)
      assert.equal(new Set(doors.map(d => d.label)).size, doors.length, m.name)
      for (const d of doors) assert.equal(d.label, `house:${m.name}:${d.x},${d.y}`)
    }
  })
  it('village houses are safe, outlying huts are hut, stone arches are ruin', () => {
    const lake = byName['lake-1-ferry']
    const village = lake.pois.find(p => p.kind === 'village')
    const doors = houseDoorsForMap(lake, EPISODES[lake.name])
    const near = doors.filter(d => Math.max(Math.abs(d.x - village.x), Math.abs(d.y - village.y)) <= 10 && !d.story)
    assert.ok(near.length >= 3)
    for (const d of near) assert.equal(d.tier, 'safe')
    const toivo = doors.find(d => d.story === "Toivo's hut")
    assert.ok(toivo, 'Toivo\'s hut door resolved'); assert.equal(toivo.tier, 'hut')
    assert.equal(tierForDoor({ pois: [] }, 5, 5, 'ow_house_door'), 'ruin')
    assert.equal(tierForDoor({ pois: [{ kind: 'village', x: 5, y: 5 }] }, 6, 6, 'ow_house_arch_stone'), 'ruin')
    assert.equal(tierForDoor({ pois: [{ kind: 'village', x: 5, y: 5 }] }, 30, 30, 'ow_house_door'), 'hut')
  })
  it('resolves the three story houses and nothing else', () => {
    const expect = { 'lake-1-ferry': "Toivo's hut", 'highland-2-fold': "Aino's house", 'marsh-3-hermit': 'hermit hut' }
    for (const [name, story] of Object.entries(expect)) {
      const doors = houseDoorsForMap(byName[name], EPISODES[name])
      assert.equal(doors.filter(d => d.story).length, 1, name)
      assert.equal(doors.find(d => d.story).story, story)
      assert.equal(doors.find(d => d.story).tier, 'hut')
    }
    for (const d of houseDoorsForMap(byName['forest-1-clearings'], null)) assert.equal(d.story, null)
  })
})
```

`test/openmap.test.js` — add:

```js
describe('house doors', () => {
  it('door cells become walkable floor keeping the door art, and buildOpenMap returns the triggers', () => {
    const { map, houseDoors } = buildOpenMap(DATA)
    assert.ok(houseDoors.length >= 4)
    for (const d of houseDoors) {
      assert.equal(map[d.y][d.x].tile, TILE.FLOOR)
      assert.ok(map[d.y][d.x].overlay.startsWith('ow_house_'), map[d.y][d.x].overlay)
      assert.equal(map[d.y][d.x].losSoft, undefined)
    }
  })
  it('maps without houses return an empty list', () => {
    assert.deepEqual(buildOpenMap(OPEN_MAPS[13]).houseDoors, [])
  })
})
```

`test/leap-maps.test.js` — in the highland describe: `Aino's house` is a declared landmark POI on a door cell (`isHouseDoorArt(data.palette[data.prop[p.y][p.x]])`).

- [ ] **Step 2: Run** — `node --test test/houses.test.js test/openmap.test.js test/leap-maps.test.js` → FAIL (module missing; POI missing).

- [ ] **Step 3: Implement**

`renderer/systems/houses.js`:

```js
// House doors on the open maps: which prop art is a door, which houses are
// story houses, how dangerous the inside is. Pure — openmap.js stamps the
// triggers, game.js walks through them (systems/cave.js does the transition).
export const HOUSE_DOOR_PREFIXES = ['ow_house_door', 'ow_house_arch_']
export const SAFE_RADIUS = 10          // Chebyshev tiles from the village/camp POI
export const STORY_RADIUS = 4          // door ↔ story POI distance

export const isHouseDoorArt = name => typeof name === 'string' && HOUSE_DOOR_PREFIXES.some(p => name.startsWith(p))
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by))

export function tierForDoor(data, x, y, art) {
  const anchor = data.pois.find(p => p.kind === 'village' || p.kind === 'camp')
  if (!anchor || art === 'ow_house_arch_stone') return 'ruin'
  return cheb(x, y, anchor.x, anchor.y) <= SAFE_RADIUS ? 'safe' : 'hut'
}

export function storyForDoor(data, episode, x, y) {
  let best = null, bestD = Infinity
  for (const label of Object.keys(episode?.houses ?? {})) {
    const poi = data.pois.find(p => p.label === label)
    if (!poi) continue
    const d = cheb(x, y, poi.x, poi.y)
    if (d <= STORY_RADIUS && d < bestD) { best = label; bestD = d }
  }
  return best
}

export function houseDoorsForMap(data, episode) {
  const doors = []
  for (let y = 1; y < data.h - 1; y++) for (let x = 1; x < data.w - 1; x++) {
    const pi = data.prop[y][x]
    const art = pi >= 0 ? data.palette[pi] : null
    if (!isHouseDoorArt(art)) continue
    const story = storyForDoor(data, episode, x, y)
    doors.push({ x, y, label: `house:${data.name}:${x},${y}`, tier: story ? 'hut' : tierForDoor(data, x, y, art), story })
  }
  return doors
}
```

`openmap.js` `buildOpenMap`: import `{ houseDoorsForMap }` and `{ EPISODES }`; after `applyFelled`, compute `const houseDoors = houseDoorsForMap(data, EPISODES[data.name] ?? null)` and for each door `map[y][x].tile = TILE.FLOOR; delete map[y][x].losSoft` (overlay already carries the art); add `houseDoors` to the returned object. `data/leaps.js`: add `houses: { "Toivo's hut": { room: null, pickups: [] } }`, `houses: { "Aino's house": { room: null, pickups: [] } }`, `houses: { 'hermit hut': { room: null, pickups: [] } }` to the three episodes. `gen-leap.mjs` `fold()`: after `stampVillage`, `b.poi('landmark', village.x + 5, village.y + 5, "Aino's house")` (the door of the south-east house — verify against the stamp offsets `[4, 3]` → door at `x+1, y+2`; adjust so the POI sits ON a door cell). Regenerate; only `highland-2-fold.json` may change (a POI added).

- [ ] **Step 4: `npm test`** → PASS. **Step 5: Commit** `feat(houses): door scan, tiers, story doors; Aino's house POI`.

---

### Task 2: Interior generation

**Files:**
- Modify: `renderer/systems/houses.js` (`INTERIOR_DEPTH`, `INTERIOR_CONFIG`, `interiorTheme`, `attachPickups`), `renderer/systems/map.js` (`generateLevel` option `config`, `variantPool`, wooden floors, prefab interaction passthrough), `renderer/data/levels.js` (depth-19 theme), `renderer/render/sprites.js` (`floor_wood` art)
- Test: `test/interior.test.js` (new), `test/structures.test.js`, `test/map.test.js` (existing behaviour unchanged)

**Interfaces:**
- `INTERIOR_DEPTH = 19`; `INTERIOR_CONFIG = { safe: {...}, hut: {...}, ruin: {...} }` each a LEVEL_CONFIG-shaped object `{ depth: 19, mapW: 44, mapH: 28, staircaseWidth: 1, guardCount: 0, monsterDensity, variantPool, trapDensity: 0, puzzleDensity: 0, weaponDensity, potionDensity, landmark: null, weapons: ['dagger'], props }` per the Global Constraints table; `props`: safe/hut `['prop_table','prop_chair','prop_barrel','column']`→ use `['prop_table', 'prop_chair', 'prop_barrel']`, hut adds `'prop_anvil'`, ruin `['prop_gravestone', 'prop_barrel']`.
- `generateLevel(depth, w, h, { config, structures, pickups })`: `config` overrides the `LEVEL_CONFIG` lookup; when `config.variantPool` is set, monster variants are drawn uniformly from it; when the depth theme has `floorTile: 'floor_wood'`, every carved floor cell (rooms + corridors) is `TILE.FLOOR_WOOD` (mirror how `'sand'` is handled at `map.js:706`).
- `placeStructure` spawns spread the interaction: `{ kind: cell.interaction.type, x, y, ...cell.interaction }` (so `slot` survives; existing `door`/`chest` interactions carry no extra keys → unchanged).
- `attachPickups(entitySpawns, pickups) -> entitySpawns` maps `{ kind: 'pickup', slot }` spawns to `{ kind: 'floating_pickup', x, y, contents: pickups[slot] }` (drops pickup spawns with no matching slot).
- `DEPTH_THEMES` gains `{ depths: [19], floorTile: 'floor_wood', bgColor: '#120c06', tint: null, fogAlpha: 0.55, props: { room: [] } }` (room props come from the config, so `generateLevel` reads `config.props ?? theme.props.room`).
- `SPRITES.floor_wood` → a plank tile (view `tile_0063`/`tile_0066` in a contact sheet and pick the one that reads as floorboards; note `treasure` currently aliases `tile_0063` — that is fine, it is tinted).

- [ ] **Step 1: Tests** — `test/interior.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { INTERIOR_DEPTH, INTERIOR_CONFIG, attachPickups } from '../renderer/systems/houses.js'
import { generateLevel } from '../renderer/systems/map.js'
import { TILE, isWalkable } from '../renderer/systems/entities.js'
import { DEPTH_THEMES } from '../renderer/data/levels.js'

const gen = (tier, extra = {}) => generateLevel(INTERIOR_DEPTH, 44, 28, { config: INTERIOR_CONFIG[tier], structures: {}, ...extra })
const count = (spawns, kind, variant) => spawns.filter(s => s.kind === kind && (variant === undefined || s.variant === variant)).length

describe('interior config', () => {
  it('has the three tiers with the spec densities and no boss/landmark/guards', () => {
    for (const t of ['safe', 'hut', 'ruin']) { const c = INTERIOR_CONFIG[t]; assert.equal(c.depth, 19); assert.equal(c.landmark, null); assert.equal(c.guardCount, 0); assert.equal(c.trapDensity, 0) }
    assert.equal(INTERIOR_CONFIG.safe.monsterDensity, 0); assert.equal(INTERIOR_CONFIG.hut.monsterDensity, 0.006); assert.equal(INTERIOR_CONFIG.ruin.monsterDensity, 0.010)
    assert.deepEqual(INTERIOR_CONFIG.hut.variantPool, ['weak'])
    assert.ok(DEPTH_THEMES.find(t => t.depths.includes(19))?.floorTile === 'floor_wood')
  })
})

describe('generated interiors', () => {
  it('safe houses have no enemies; huts have only rats; ruins have spiders and a strong one', () => {
    for (let i = 0; i < 5; i++) {
      const s = gen('safe').entitySpawns; assert.equal(count(s, 'monster'), 0); assert.equal(count(s, 'guard'), 0)
      const h = gen('hut').entitySpawns; assert.ok(count(h, 'monster') >= 1); assert.equal(count(h, 'monster'), count(h, 'monster', 'weak'))
      const r = gen('ruin').entitySpawns; assert.ok(count(r, 'monster', 'medium') >= 1); assert.ok(count(r, 'monster', 'strong') >= 1); assert.equal(count(r, 'monster', 'boss'), 0)
    }
  })
  it('floors are wooden and walkable, the map is 44x28 with a stairs-free spawn', () => {
    const { map, playerSpawn } = gen('safe')
    assert.equal(map.length, 28); assert.equal(map[0].length, 44)
    const floors = map.flat().filter(c => isWalkable(c.tile))
    assert.ok(floors.length > 100)
    assert.ok(floors.every(c => c.tile === TILE.FLOOR_WOOD || c.tile === TILE.FLOOR), 'wood or plain floor only')
    assert.ok(floors.filter(c => c.tile === TILE.FLOOR_WOOD).length / floors.length > 0.9)
    assert.ok(isWalkable(map[playerSpawn.y][playerSpawn.x].tile))
  })
  it('a story prefab becomes the landmark room and its pickup slots become floating pickups', () => {
    const prefab = { w: 3, h: 3, targetDepth: 19, cells: [
      ...[0, 1, 2].flatMap(x => [0, 2].map(y => ({ x, y, skin: 'tile_0040', overlay: null, collision: 'wall', interaction: null }))),
      { x: 0, y: 1, skin: 'tile_0063', overlay: null, collision: 'walkable', interaction: { type: 'pickup', slot: 0 } },
      { x: 1, y: 1, skin: 'tile_0063', overlay: null, collision: 'walkable', interaction: null },
      { x: 2, y: 1, skin: 'tile_0063', overlay: null, collision: 'walkable', interaction: { type: 'pickup', slot: 1 } },
    ] }
    const pickups = [{ type: 'meat', count: 3 }, { type: 'weapon', weaponType: 'hatchet' }]
    const { map, entitySpawns } = gen('hut', { structures: { toivo: prefab } })
    const spawns = attachPickups(entitySpawns, pickups)
    const fp = spawns.filter(s => s.kind === 'floating_pickup')
    assert.equal(fp.length, 2)
    assert.deepEqual(fp.map(s => s.contents).sort((a, b) => a.type.localeCompare(b.type)), pickups.slice().sort((a, b) => a.type.localeCompare(b.type)))
    for (const s of fp) assert.ok(isWalkable(map[s.y][s.x].tile))
    assert.equal(spawns.some(s => s.kind === 'pickup'), false)
  })
})
```

`test/structures.test.js`: `placeStructure` spawns carry interaction fields (`{ type: 'pickup', slot: 2 }` → spawn `{ kind: 'pickup', x, y, type: 'pickup', slot: 2 }`).

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**

`houses.js` additions:

```js
export const INTERIOR_DEPTH = 19
const base = { depth: INTERIOR_DEPTH, mapW: 44, mapH: 28, staircaseWidth: 1, guardCount: 0, trapDensity: 0, puzzleDensity: 0, landmark: null, weapons: ['dagger'] }
export const INTERIOR_CONFIG = {
  safe: { ...base, monsterDensity: 0,     variantPool: [],                           weaponDensity: 0,     potionDensity: 0.006, props: ['prop_table', 'prop_chair', 'prop_barrel'] },
  hut:  { ...base, monsterDensity: 0.006, variantPool: ['weak'],                     weaponDensity: 0.004, potionDensity: 0.006, props: ['prop_table', 'prop_chair', 'prop_barrel', 'prop_anvil'] },
  ruin: { ...base, monsterDensity: 0.010, variantPool: ['medium', 'medium', 'strong'], weaponDensity: 0.008, potionDensity: 0.008, props: ['prop_gravestone', 'prop_barrel'] },
}

// Prefab pickup slots -> the story house's items, laid on the floor.
export function attachPickups(entitySpawns, pickups = []) {
  return entitySpawns.flatMap(s => {
    if (s.kind !== 'pickup') return [s]
    const contents = pickups[s.slot]
    return contents ? [{ kind: 'floating_pickup', x: s.x, y: s.y, contents }] : []
  })
}
```

`map.js` `generateLevel`: signature gains `config = null, pickups = null` (ignore `pickups` here — `game.js` calls `attachPickups`); `const cfg = config ?? LEVEL_CONFIG.find(…)`; monster variant: `const variant = cfg.variantPool?.length ? cfg.variantPool[Math.floor(Math.random() * cfg.variantPool.length)] : <existing expression>`; room props: `const roomProps = skipProps ? [] : (cfg.props ?? theme?.props?.room ?? [])`; wooden floors: where `'sand'` converts floor cells (line ~706), add `else if (theme?.floorTile === 'floor_wood')` converting every `TILE.FLOOR` cell to `TILE.FLOOR_WOOD` (check `isWalkable` and `roleOf` in decorate.js treat `FLOOR_WOOD` as floor — grep `FLOOR_WOOD`; extend `roleOf` if needed). `placeStructure`: `spawns.push({ kind: cell.interaction.type, x: tx, y: ty, ...cell.interaction })`. `levels.js`: theme entry. `sprites.js`: `floor_wood` → the plank tile chosen visually.

- [ ] **Step 4: `npm test`** → PASS (existing map tests unchanged). **Step 5: Commit** `feat(houses): interior config, wooden BSP floors, prefab pickups`.

---

### Task 3: Story rooms and episode pickups

**Files:**
- Modify: `renderer/data/structures.json` (three 9×7 prefabs), `renderer/data/leaps.js` (`houses` filled), `renderer/systems/houses.js` (`storyStructures(episode, story) -> { [room]: prefab }`)
- Test: `test/structures.test.js`, `test/leap-maps.test.js`, `test/houses.test.js`

**Interfaces:**
- Prefabs `toivo_kitchen`, `hermit_woodpile`, `aino_larder`: `{ w: 9, h: 7, targetDepth: 19, cells: [...] }` in the editor's cell format (`skin`, `overlay`, `collision`, `interaction`). Walls (`tile_0040`) on the border with one 1-cell doorway on the south edge; interior `tile_0063` floor; dressing overlays (`tile_0072` table, `tile_0073` chair, `tile_0082` barrel, `tile_0075` crate; a "fish rack" = `tile_0077` fence over floor for Toivo); pickup cells `interaction: { type: 'pickup', slot: n }` on floor, none adjacent to the doorway.
- `data/leaps.js` `houses` per spec §3 (`room`, `pickups`).
- `storyStructures(episode, story)`: `{ [room]: { ...STRUCTURES[room], targetDepth: INTERIOR_DEPTH } }` or `{}` when no story.
- `placeStructure` currently marks cells `locked` — fine (interiors have no ruleset decoration).

- [ ] **Step 1: Tests** — `test/structures.test.js`: the three prefabs load, are 9×7, have exactly one non-wall border cell (the doorway), and pickup slots `0..n-1` contiguous on walkable cells. `test/leap-maps.test.js`: for each leap map, `houses` POIs exist and `houseDoorsForMap` resolves each to a door; the required items per spec §4 are present in that episode's `houses[*].pickups` (lake: `weapon hatchet`, `lumber ≥ 3`, `meat ≥ 3`; marsh: `weapon hatchet`, `lumber ≥ 3`). `test/houses.test.js`: `storyStructures(EPISODES['lake-1-ferry'], "Toivo's hut")` has `toivo_kitchen` with `targetDepth 19`; `storyStructures(ep, null)` is `{}`.
- [ ] **Step 2–4**: author the prefabs (write the JSON by hand in the editor format; keep them retouchable in the Build tab), fill `houses`, implement `storyStructures`, `npm test`, commit `feat(houses): story rooms with the episodes' required items`.

---

### Task 4: Wiring — enter, leave, persist, pickups, cue

**Files:**
- Modify: `renderer/game.js` (`houseDoors` state, `enterHouse`, walk-onto check, `buildEntities` `'floating_pickup'`), `renderer/systems/sfx.js` + `renderer/render/audio.js` (`door-open`), `renderer/systems/cave.js` (no change expected — verify `restoreSurface` handles a house label)
- Test: `test/cave.test.js` (house round trip using the pure pieces), `test/audio.test.js` (registry)

**Interfaces:**
- `state.houseDoors` from `buildOpenMap` (both `startNewRun` and `travelToMap`; `[]` inside caves/houses).
- Walk-onto (next to the arch check): `const door = !state.cave && state.houseDoors?.find(d => d.x === player.x && d.y === player.y); if (door && !state.entranceHold) { enterHouse(door); return }`; `entranceHold` resets when standing on neither an arch nor a door.
- `enterHouse(door)`: stored instance → `buildCaveState(state, { x, y, caveDepth: INTERIOR_DEPTH, label }, inst)` like `enterCave`; else `const cfg = INTERIOR_CONFIG[door.tier]`, `theme = DEPTH_THEMES.find(19)`, `structures = storyStructures(state.episode, door.story)`, `{ map, entitySpawns, playerSpawn } = generateLevel(INTERIOR_DEPTH, cfg.mapW, cfg.mapH, { config: cfg, structures })`, `spawns = attachPickups(entitySpawns, state.episode?.houses?.[door.story]?.pickups ?? [])`, `buildCaveState(state, entrance, { map, entities: buildEntities(spawns, map, INTERIOR_DEPTH), playerSpawn, theme })`; `announce('You step inside.')`, cue `door-open`.
- Exit: the existing `exitCave` path; message `'You step back out.'` when `state.cave.label.startsWith('house:')`, cue `emerge`.
- `buildEntities` case `'floating_pickup'`: `{ type: 'floating_item', contents: s.contents, x, y, startPx: cx, startPy: cy, targetPx: cx, targetPy: cy, px: cx, py: cy, progress: 1, duration: 0.3 }`.
- `door-open` recipe `{ kind: 'burst', freq: 200, q: 1.5, dur: 0.12, vol: 0.6 }`.

- [ ] **Step 1: Tests** — `test/cave.test.js`: build a lake surface with `buildOpenMap`, take its first `houseDoors` entry as the entrance (`caveDepth: INTERIOR_DEPTH`), `buildCaveState` with a generated interior → `state.cave.label` is the door label and the spawn tile is `STAIRS_UP`; `restoreSurface` stores `caveInstances[label]` with `cleared: true`; `tickCaveInstances` drops it after `CAVE_RESET_TIME`. `test/audio.test.js` registry covers the cue.
- [ ] **Step 2–4**: implement, `npm test`, commit `feat(houses): walk through doors into persistent interiors`.

---

### Task 5: Live verification, docs, memory

- [ ] Playwright driver (pattern `tools/verify-npcs.mjs`, `--dcdebug`, `level8` cheat): teleport onto Toivo's hut door → `state.cave.label` starts with `house:lake-1-ferry:`, map 44×28, `entities` contain three `floating_item`s with `meat`/`hatchet`/`lumber`; walk onto each → sack has them; step back onto the entry tile → surface restored, `caveInstances[label]` present; re-enter → pickups gone; a village door (`tier safe`) → no monsters; the hermit hut → ≥ 1 rat. Screenshot an interior. `git status --short renderer/data/` clean.
- [ ] `~/CLAUDE.md`: add `houses` (door scan/tiers/interior config/story prefabs) to the systems list. Memory note on how to add a story house.
- [ ] Commit `docs: house interiors`.
