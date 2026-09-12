# Adventure Quests — Slice 2: *Tervahauta*, the Tar Pit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The River Split's build quest — fell six lumber, fire the tar pit for three Pine Tar, plank the south bridge's three missing deck cells, and take the crew's Tervajousi, a bow whose arrows leave a burning patch.

**Architecture:** Rides the story engine slice 1 shipped (`systems/story.js` → `systems/quests.js`): one declaration in `data/quests.js`, one module `systems/quests/river.js` exporting `onArrive`/`tick`, registered in `systems/quests/index.js`. The world changes are all runtime: the map is baked with the bridge whole, and the module breaks the three gap cells on arrival while `bridge_done` is false (the ferry episode's pier-gap treatment, inverted). The bow is a new `RANGED_WEAPON_TYPES` row carrying a `fire` flag that `ranged.js` turns into the fireball's own detonation fields plus `fireOnly`, which `game.js`'s detonate hook reads to lay a fire zone without a burst.

**Tech Stack:** Vanilla ES modules, `node:test`, no bundler. Electron on desktop, `web-shim.js` on the web release.

**Spec:** `docs/superpowers/specs/2026-09-10-adventure-quests-design.md` §3 (quest), §5 (weapon + item), §7 (map data), §8 (tests). Slice 1's plan `docs/superpowers/plans/2026-09-10-adventure-quests-slice-1.md` is the model for module shape and test harness; slice 1's module is `renderer/systems/quests/clearings.js`.

## Global Constraints

- Quests are **optional**: never touch `isMapComplete`, `waystoneDestinations` or `nextMapDepth` in `systems/adventure.js`. If a task makes you edit them, stop.
- Every new POI is `kind: 'landmark'`. Never `village` or `camp` — `openmap.js` anchors the whole NPC roster on the first of those. Never reuse a label a rite names (`renderer/data/rites.js`).
- **`forest-2-river` is hand-painted. Never run `gen-forest.mjs` on it** (it is in `HAND_FINISHED`, but `--all` overwrites it). POIs go into `tools/static-overworld/out/maps/forest-2-river.json` by script, then `node tools/static-overworld/export-game-maps.mjs` re-exports `renderer/data/open-maps.js`.
- **The north bridge (67,22) is off limits** — it is the only route to the bear cave and the river shrine's waystone. Only the *south* bridge's three cells (48,58) (49,58) (50,58) are ever touched.
- `TAR_PIT_COST = 6` lives in the quest module. Never mutate `CAMPFIRE_COST` (3): the sack panel's campfire still costs 3.
- Quest items carry `extra: { quest: true }` — carry-only, Drop stays.
- Names match `^[a-z0-9_]+$`; no new art (bridge planks reuse `ow_pier_log`, the pit's flame is the campfire render).
- Every code task is TDD: failing test → watch it fail → minimal code → green → commit. `npm test` must be green at every commit. A lone SIGSEGV with every test passing is Node's runner crashing on this WSL box (~1 in 12 runs) — re-run, don't chase it.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01TrZDgRjkMKNomd7sYjBJFq
  ```

---

## File Structure

| File | Responsibility |
|---|---|
| `renderer/systems/inventory.js` (modify) | `tar` in `STACKABLE_KINDS` — Pine Tar, carry-only |
| `renderer/systems/campfire.js` (modify) | `spendLumber(player, fuel, count)` grows a `count` parameter defaulting to `CAMPFIRE_COST` |
| `renderer/systems/entities.js` (modify) | `RANGED_WEAPON_TYPES.tervajousi`; `RANGED_FLAG_KEYS` gains `'fire'` so `makeRangedContents` carries it |
| `renderer/systems/ranged.js` (modify) | `tryFire` stamps `explodes` / `blastTiles` / `fireOnly` from `r.fire` |
| `renderer/systems/projectiles.js` (modify) | the three `hooks.detonate` calls pass `{ fireOnly }` as a fourth argument |
| `renderer/game.js` (modify) | the shot's explode fields ride onto the projectile; `detonateFireball` skips the burst for `fireOnly` |
| `renderer/data/quests.js` (modify) | the `forest-2-river` declaration: title, staged villager lines, `rule` |
| `renderer/systems/quests/river.js` (create) | the module: gap break/plank, the burn, the planking, the bow |
| `renderer/systems/quests/index.js` (modify) | register the module |
| `tools/static-overworld/out/maps/forest-2-river.json` + `renderer/data/open-maps.js` (regenerate) | four new landmark POIs |
| `test/inventory.test.js`, `test/campfire.test.js`, `test/entities.test.js`, `test/ranged.test.js`, `test/projectiles.test.js`, `test/adventure-quest-maps.test.js`, `test/quests.test.js` (extend) | per-system coverage |
| `test/quest-river.test.js` (create) | the module, end to end from flags |

---

### Task 1: Pine Tar, and a `spendLumber` that takes a count

**Files:**
- Modify: `renderer/systems/inventory.js` (the `STACKABLE_KINDS` table, next to `elk_hide`)
- Modify: `renderer/systems/campfire.js:19-30`
- Test: `test/inventory.test.js`, `test/campfire.test.js`

**Interfaces:**
- Produces: `makeItem('tar', n)` → `{ kind: 'tar', stackable: true, quest: true, count: n }`; `spendLumber(player, fuel = 'lumber', count = CAMPFIRE_COST)`.

- [ ] **Step 1: Write the failing tests**

Append to `test/inventory.test.js` (after the `elk hide` describe):

```js
describe('pine tar', () => {
  it('is a carry-only stackable', () => {
    const tar = makeItem('tar', 3)
    assert.equal(tar.kind, 'tar')
    assert.equal(tar.stackable, true)
    assert.equal(tar.quest, true)
    assert.equal(tar.count, 3)
  })
  it('round-trips through contents', () => {
    assert.equal(itemFromContents({ type: 'tar', count: 2 })?.count, 2)
  })
})
```

Append inside the campfire describe in `test/campfire.test.js`, after the existing `spendLumber` test:

```js
  it('spendLumber takes an explicit count, leaving CAMPFIRE_COST as the default', () => {
    const p = mkPlayer([makeItem('lumber', 8)])
    spendLumber(p, 'lumber', 6)
    assert.equal(p.inventory[0].count, 2)
    const q = mkPlayer([makeItem('lumber', 4)]); spendLumber(q)
    assert.equal(q.inventory[0].count, 4 - CAMPFIRE_COST)
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/inventory.test.js test/campfire.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)"`
Expected: `pine tar` fails (`makeItem('tar')` returns an unknown-kind result, `kind !== 'tar'`); the count test fails with `p.inventory[0].count` = 5 (spent 3, not 6).

- [ ] **Step 3: Implement**

In `renderer/systems/inventory.js`, in `STACKABLE_KINDS` directly under the `elk_hide` row:

```js
  tar:         { name: 'Pine Tar',    emoji: '🛢', extra: { quest: true } },
```

In `renderer/systems/campfire.js` replace the `spendLumber` signature and first line:

```js
// Remove `count` of the given fuel (the campfire's cost by default); emptied
// stacks vanish. The tar pit passes its own count — it never touches
// CAMPFIRE_COST.
export function spendLumber(player, fuel = 'lumber', count = CAMPFIRE_COST) {
  let left = count
```

- [ ] **Step 4: Run to verify green**

Run: `node --test test/inventory.test.js test/campfire.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/inventory.js renderer/systems/campfire.js test/inventory.test.js test/campfire.test.js
git commit -m "feat: add Pine Tar and let spendLumber take a count"
```

---

### Task 2: The Tervajousi and its incendiary arrow

**Files:**
- Modify: `renderer/systems/entities.js` (`RANGED_WEAPON_TYPES` table around line 46-58; the `RANGED_FLAG_KEYS` array `makeRangedContents` iterates at line 69)
- Modify: `renderer/systems/ranged.js:88-110` (`tryFire`'s result block)
- Modify: `renderer/systems/projectiles.js:105,111,168` (the three `hooks.detonate(...)` calls)
- Modify: `renderer/game.js:349-372` (`detonateFireball`), `:405` (the `detonate` hook), `:1449-1456` (the projectile built from `shot`)
- Test: `test/entities.test.js`, `test/ranged.test.js`, `test/projectiles.test.js`

**Interfaces:**
- Produces: `RANGED_WEAPON_TYPES.tervajousi = { name: 'Tervajousi', damage: 3, cooldown: 0.7, color: '#b45309', kind: 'bow', ammoKind: 'arrow', bundle: 10, draw: true, fire: { tiles: 3 } }`; a successful `tryFire` on it returns `explodes: true, blastTiles: 3, fireOnly: true`; `hooks.detonate(px, py, blastTiles, { fireOnly })`.

- [ ] **Step 1: Write the failing tests**

In `test/entities.test.js`, find the `RANGED_WEAPON_TYPES (bows only)` describe (line ~251). Its key-list assertion at line ~261 enumerates every bow; add `'tervajousi'` to that sorted array so the invariant test keeps passing. Then append inside the same describe:

```js
  it('makeRangedContents("tervajousi") carries the fire flag', () => {
    const c = makeRangedContents('tervajousi')
    assert.deepEqual(c.fire, { tiles: 3 })
    assert.equal(c.draw, true)
    assert.equal(c.ammoKind, 'arrow')
  })
```

In `test/ranged.test.js`, append a describe. The passing tap-shot tests near line 136 show the player shape `tryFire` wants; this one is built the same way:

```js
describe('tervajousi', () => {
  it('a shot carries the fire-arrow detonation fields, and fire only', () => {
    const shot = tryFire(armedPlayer('tervajousi'))
    assert.equal(shot.ok, true)
    assert.equal(shot.explodes, true)
    assert.equal(shot.blastTiles, 3)
    assert.equal(shot.fireOnly, true)
  })
  it('an ordinary bow shot carries none of them', () => {
    const shot = tryFire(armedPlayer('shortbow'))
    assert.equal(shot.ok, true)
    assert.equal(shot.explodes, undefined)
    assert.equal(shot.fireOnly, undefined)
  })
})
```

(`armedPlayer(weaponType, extra)` is the file's own helper — the `tryFire — success shapes and flags per weapon` describe uses it; it builds a player with `ranged_stance`, the bow, arrows and a cold cooldown. `tryFire` checks nothing else.)

In `test/projectiles.test.js`, append after the `fireball direct-impact detonation` describe:

```js
describe('fire-only detonation', () => {
  it('hands fireOnly to the detonate hook on a direct hit', () => {
    const entities = [{ id: 'a', type: 'monster', px: 5, py: 0, hp: 10 }]
    const p = { px: 0, py: 0, dx: 100, dy: 0, damage: 3, friendly: true, explodes: true, blastTiles: 3, fireOnly: true }
    const calls = []
    const { hooks } = makeHooks({ detonate: (px, py, blastTiles, opts) => calls.push({ blastTiles, opts }) })
    stepProjectiles(baseState(entities, [p]), 0.1, hooks)
    assert.deepEqual(calls, [{ blastTiles: 3, opts: { fireOnly: true } }])
  })
  it('an ordinary fireball detonates with fireOnly false', () => {
    const entities = [{ id: 'a', type: 'monster', px: 5, py: 0, hp: 10 }]
    const p = { px: 0, py: 0, dx: 100, dy: 0, damage: 5, friendly: true, explodes: true, blastTiles: 16 }
    const calls = []
    const { hooks } = makeHooks({ detonate: (px, py, blastTiles, opts) => calls.push(opts) })
    stepProjectiles(baseState(entities, [p]), 0.1, hooks)
    assert.deepEqual(calls, [{ fireOnly: false }])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/entities.test.js test/ranged.test.js test/projectiles.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)"`
Expected: the entities key-list test fails until the row exists (`tervajousi` missing), `c.fire` is `undefined`, `shot.explodes` is `undefined`, and the projectile tests get `opts` `undefined`.

- [ ] **Step 3: Implement**

`renderer/systems/entities.js` — add the row to `RANGED_WEAPON_TYPES` after `longbow`:

```js
  // Tervahauta's reward (systems/quests/river.js): a longbow whose arrow
  // leaves a burning patch — `fire.tiles` is the fire zone's flood size.
  tervajousi: { name: 'Tervajousi', damage: 3, cooldown: 0.7, color: '#b45309', kind: 'bow', ammoKind: 'arrow', bundle: 10, draw: true, fire: { tiles: 3 } },
```

and append `'fire'` to the `RANGED_FLAG_KEYS` array (the list `makeRangedContents` loops over).

`renderer/systems/ranged.js` — in `tryFire`, after the `if (r.fork) result.fork = r.fork` line:

```js
  // An incendiary arrow borrows the fireball's detonation fields, flagged
  // fireOnly so game.js lays the fire zone without the burst damage.
  if (r.fire) { result.explodes = true; result.blastTiles = r.fire.tiles; result.fireOnly = true }
```

`renderer/systems/projectiles.js` — change all three `hooks.detonate(...)` calls (lines 105, 111, 168) to pass a fourth argument; e.g. line 168 becomes:

```js
        if (p.explodes) hooks.detonate(p.px, p.py, p.blastTiles, { fireOnly: !!p.fireOnly })
```

and lines 105/111 likewise with their existing `p.lastPx ?? p.px, p.lastPy ?? p.py` arguments. Update the header comment at line 84 to read `detonate(px, py, blastTiles, { fireOnly })`.

`renderer/game.js`:

1. The projectile built from `shot` (after `if (shot.piercesShield) proj.piercesShield = true`):

```js
    if (shot.explodes) { proj.explodes = true; proj.blastTiles = shot.blastTiles; if (shot.fireOnly) proj.fireOnly = true }
```

2. `detonateFireball` takes an options bag and returns before the burst when fire-only:

```js
function detonateFireball(px, py, blastTiles, { fireOnly = false } = {}) {
  const tx = Math.floor(px / TILE_SIZE), ty = Math.floor(py / TILE_SIZE)
  const tiles = computeBlastTiles(state.map, tx, ty, blastTiles)
  if (!tiles.length) return
  sfx(state, 'fire-burst', { px, py })
  // A tarred arrow only burns: the patch, no burst damage, no shockwave.
  if (fireOnly) { state.fireZones.push(makeFireZone(tiles)); return }
  const before = state.entities
```

(the rest of the function unchanged).

3. The hook at line ~405: `detonate: (px, py, blastTiles, opts) => detonateFireball(px, py, blastTiles, opts),`

- [ ] **Step 4: Run to verify green**

Run: `node --test test/entities.test.js test/ranged.test.js test/projectiles.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)"`
Expected: `# fail 0`. Then `npm test 2>&1 | grep -E "^# (pass|fail)"` — all green (the `bows only` invariant loop must accept the new row: `kind: 'bow'`, `ammoKind: 'arrow'`, `bundle: 10`).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/entities.js renderer/systems/ranged.js renderer/systems/projectiles.js renderer/game.js test/entities.test.js test/ranged.test.js test/projectiles.test.js
git commit -m "feat: add the Tervajousi, a bow whose arrows leave a burning patch"
```

---

### Task 3: The four River Split POIs

**Files:**
- Modify (by script): `tools/static-overworld/out/maps/forest-2-river.json`
- Regenerate: `renderer/data/open-maps.js`
- Test: `test/adventure-quest-maps.test.js`

**Interfaces:**
- Produces: landmark POIs `tar pit` (34,39), `bridge gap 1` (48,58), `bridge gap 2` (49,58), `bridge gap 3` (50,58) on `OPEN_MAPS[11]`.

- [ ] **Step 1: Write the failing test**

Append to `test/adventure-quest-maps.test.js` (add `import { PIT, GAPS, CAMP } from '../renderer/systems/quests/river.js'` — the module is created in Task 5; until then use string literals `'tar pit'`, `['bridge gap 1','bridge gap 2','bridge gap 3']`, `'lumber camp'` and switch to the import in Task 5):

```js
describe('the River Split tar pit and bridge gaps', () => {
  const river = OPEN_MAPS[11]
  const rp = label => river.pois.find(p => p.label === label)
  const skinAt = (x, y) => river.palette[river.ground[y][x]]
  it('declares the pit and three gaps as landmarks', () => {
    for (const label of ['tar pit', 'bridge gap 1', 'bridge gap 2', 'bridge gap 3']) {
      const p = rp(label)
      assert.ok(p, `missing ${label}`)
      assert.equal(p.kind, 'landmark', label)
    }
  })
  it('the pit is walkable ground four cells east of the camp', () => {
    const pit = rp('tar pit'), camp = rp('lumber camp')
    assert.ok(camp && camp.kind === 'camp')
    assert.deepEqual({ x: pit.x, y: pit.y }, { x: camp.x + 4, y: camp.y })
    assert.equal(river.walk[pit.y][pit.x], '1')
  })
  it('the gaps are the south bridge deck: baked walkable planks over water, in one east-west row', () => {
    const gaps = ['bridge gap 1', 'bridge gap 2', 'bridge gap 3'].map(rp)
    for (const g of gaps) {
      assert.equal(river.walk[g.y][g.x], '1', 'baked as planks')
      assert.ok(skinAt(g.x, g.y).startsWith('ow_water'), `${g.x},${g.y} is over water`)
    }
    assert.deepEqual(gaps.map(g => g.x), [48, 49, 50])
    assert.ok(gaps.every(g => g.y === 58))
    assert.equal(river.walk[58][47], '1', 'the west end of the deck is walkable')
    assert.equal(river.walk[58][51], '1', 'the east end of the deck is walkable')
  })
  it("leaves the north bridge, the bear cave and the shrine alone", () => {
    assert.deepEqual({ x: rp('north bridge').x, y: rp('north bridge').y }, { x: 67, y: 22 })
    assert.equal(river.pois.filter(p => p.kind === 'dungeon_entrance').length, 1)
    assert.ok(rp('river shrine'))
    assert.equal(river.pois.filter(p => p.kind === 'village' || p.kind === 'camp').length, 1)
  })
  it('takes no label a rite already claims', () => {
    const riteLabels = new Set((MAP_RITES[river.name] ?? []).map(r => r.fromPoi))
    for (const label of ['tar pit', 'bridge gap 1', 'bridge gap 2', 'bridge gap 3']) assert.equal(riteLabels.has(label), false, label)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/adventure-quest-maps.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)"`
Expected: `missing tar pit`.

- [ ] **Step 3: Add the POIs and re-export**

```bash
node -e "
const fs = require('fs'); const f = 'tools/static-overworld/out/maps/forest-2-river.json';
const m = JSON.parse(fs.readFileSync(f, 'utf8'));
for (const [label, x, y] of [['tar pit', 34, 39], ['bridge gap 1', 48, 58], ['bridge gap 2', 49, 58], ['bridge gap 3', 50, 58]])
  if (!m.pois.some(p => p.label === label)) m.pois.push({ kind: 'landmark', x, y, label });
fs.writeFileSync(f, JSON.stringify(m));
"
node tools/static-overworld/export-game-maps.mjs
git diff --stat tools/static-overworld/out/maps/ renderer/data/open-maps.js
```

Expected: exactly two files changed, one line each (the JSON files are single-line). If any other map changed, something regenerated terrain — `git checkout -- tools/static-overworld/out/maps/ renderer/data/open-maps.js` and re-run only the two commands above.

- [ ] **Step 4: Run to verify green**

Run: `node --test test/adventure-quest-maps.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add tools/static-overworld/out/maps/forest-2-river.json renderer/data/open-maps.js test/adventure-quest-maps.test.js
git commit -m "feat: add the tar pit and the three bridge gaps to the River Split"
```

---

### Task 4: The quest declaration

**Files:**
- Modify: `renderer/data/quests.js`
- Test: `test/quests.test.js`

**Interfaces:**
- Produces: `QUESTS['forest-2-river'] = { title: 'Tervahauta', villagerLines: [...], rule: f => !!f.bridge_done }`. The river map's roster is `villager × 2, chicken, goat` (no elder) — lines are keyed on `villager` only.

- [ ] **Step 1: Write the failing test**

Append to `test/quests.test.js`:

```js
describe('the River Split declaration', () => {
  const river = OPEN_MAPS[11]
  const quest = QUESTS['forest-2-river']
  it('is found for depth 11 and is done only on bridge_done', () => {
    assert.equal(questFor(river), quest)
    assert.equal(quest.title, 'Tervahauta')
    assert.equal(quest.rule({}), false)
    assert.equal(quest.rule({ pit_lit: true, plank_1: true, plank_2: true, plank_3: true }), false)
    assert.equal(quest.rule({ bridge_done: true }), true)
  })
  it('stages the crew\'s lines: opening, once the pit is lit, and when the deck is whole', () => {
    const open = questLines(quest, {})
    const lit = questLines(quest, { pit_lit: true })
    const done = questLines(quest, { bridge_done: true })
    for (const s of [open, lit, done]) assert.ok(s.villager?.length, 'the camp is villagers')
    assert.notDeepEqual(open, lit)
    assert.notDeepEqual(lit, done)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/quests.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)"`
Expected: `quest` is `undefined` → the first assertion throws.

- [ ] **Step 3: Implement**

Add to `QUESTS` in `renderer/data/quests.js`, after the `forest-1-clearings` entry:

```js
  'forest-2-river': {
    title: 'Tervahauta',
    villagerLines: [
      { when: f => f.bridge_done, by: {
        villager: ['Tarred and true. That deck will outlast the both of us.', 'A tarred bow. Mind where you loose it — it burns what it lands in.'],
      } },
      { when: f => f.pit_lit, by: {
        villager: ['Smell that? Pine tar. The deck wants three pots of it.', 'Stand at a gap with a pot in your sack and the planks go down.'],
      } },
      { when: () => true, by: {
        villager: ['The middle of the south bridge went in the spring flood. We will not lay planks that rot by autumn.', 'No bridge on this river ever held without tar. Six logs into the pit east of camp — it burns down to tar.'],
      } },
    ],
    rule: f => !!f.bridge_done,
  },
```

- [ ] **Step 4: Run to verify green**

Run: `node --test test/quests.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add renderer/data/quests.js test/quests.test.js
git commit -m "feat: declare Tervahauta, the River Split's tar-pit quest"
```

---

### Task 5: The River module — the gaps, from flags

**Files:**
- Create: `renderer/systems/quests/river.js`
- Test: `test/quest-river.test.js` (create)

**Interfaces:**
- Consumes: `poiCell` from `../quests.js`; `markTileDirty`; `TILE` from `../entities.js`; `makeCampfire`, `spendLumber` from `../campfire.js`; `makeItem`, `addItem`, `removeItem` from `../inventory.js`; `queueToast`, `think` from `../feedback.js`; `sfx` from `../sfx.js`.
- Produces: `PIT = 'tar pit'`, `CAMP = 'lumber camp'`, `GAPS = ['bridge gap 1', 'bridge gap 2', 'bridge gap 3']`, `TAR_PIT_COST = 6`, `TAR_YIELD = 3`, `BOW = 'tervajousi'`, `breakGap(map, cell)`, `plankGap(map, cell)`, `onArrive(ctx)`, `tick(ctx, delta)`. Flags: `bridge_seen`, `pit_lit`, `plank_1..3`, `bridge_done`, `bow_given`.

- [ ] **Step 1: Write the failing tests**

Create `test/quest-river.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { onArrive, tick, PIT, CAMP, GAPS, TAR_PIT_COST, TAR_YIELD, BOW, breakGap, plankGap } from '../renderer/systems/quests/river.js'
import { makeQuestCtx, questFlags } from '../renderer/systems/quests.js'
import { normalizeAdventureSave } from '../renderer/systems/adventure.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE, makeRangedContents } from '../renderer/systems/entities.js'
import { makeItem, itemFromContents } from '../renderer/systems/inventory.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const S = 32
const N = 40

// The deck runs east-west: 7,20 is the west bank, 8..10 the three gaps, 11 the east bank.
const CELLS = { [CAMP]: { x: 5, y: 5 }, [PIT]: { x: 9, y: 5 }, [GAPS[0]]: { x: 8, y: 20 }, [GAPS[1]]: { x: 9, y: 20 }, [GAPS[2]]: { x: 10, y: 20 } }
const WEST = { x: 7, y: 20 }

const mapData = {
  name: 'forest-2-river', w: N, h: N,
  pois: [
    { kind: 'camp', x: CELLS[CAMP].x, y: CELLS[CAMP].y, label: CAMP },
    ...Object.entries(CELLS).filter(([l]) => l !== CAMP).map(([label, c]) => ({ kind: 'landmark', x: c.x, y: c.y, label })),
  ],
  npcs: { village: ['villager', 'villager'], wild: [] },
}

// Grass everywhere; the three gap cells baked exactly as the real map bakes
// them — water skin under a walkable pier-log prop.
function makeMap() {
  const map = createMap(N, N)
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) { map[y][x].tile = TILE.FLOOR; map[y][x].skin = 'ow_grass_0' }
  for (const label of GAPS) { const c = CELLS[label]; map[c.y][c.x].skin = 'ow_water_0'; map[c.y][c.x].overlay = 'ow_pier_log' }
  return map
}

function spawnInto(state) {
  return spawns => {
    for (const s of spawns) {
      if (s.kind === 'floating_pickup') state.entities.push({ type: 'floating_item', contents: s.contents, x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16, progress: 1 })
    }
  }
}

function build({ flags = {}, at = CELLS[CAMP], inventory = [], entities = [], ranged = null } = {}) {
  const save = normalizeAdventureSave(null)
  Object.assign(questFlags(save, mapData.name), flags)
  const state = {
    map: makeMap(), entities: [...entities], feedback: makeFeedback(), sfx: makeSfx(),
    player: { x: at.x, y: at.y, px: at.x * S + 16, py: at.y * S + 16, hp: 10, talents: [], inventory, maxInventory: 10, ranged },
  }
  const calls = { persist: 0, refreshInventory: 0, flags: [] }
  const ctx = makeQuestCtx({
    getState: () => state, save, mapData,
    persist: () => { calls.persist++ }, refreshInventory: () => { calls.refreshInventory++ },
    spawn: spawnInto(state), onFlag: f => calls.flags.push(f),
  })
  return { ctx, state, save, calls }
}

const gapCell = (state, i) => state.map[CELLS[GAPS[i]].y][CELLS[GAPS[i]].x]
const isBroken = cell => cell.tile === TILE.WALL && cell.overlay === null && cell.losClear === true
const isPlanked = cell => cell.tile === TILE.FLOOR && cell.overlay === 'ow_pier_log' && cell.losClear === undefined
const fires = state => state.entities.filter(e => e.type === 'campfire')
const count = (player, kind) => player.inventory.filter(i => i.kind === kind).reduce((n, i) => n + (i.count ?? 1), 0)
const bowOf = state => state.entities.find(e => e.type === 'floating_item' && e.contents?.weaponType === BOW) ?? null
const moveTo = (state, c) => { state.player.x = c.x; state.player.y = c.y; state.player.px = c.x * S + 16; state.player.py = c.y * S + 16 }

describe('the gap cells', () => {
  it('breakGap turns a baked plank into water: WALL, no log, losClear, dirty', () => {
    const { state } = build()
    breakGap(state.map, CELLS[GAPS[0]])
    assert.ok(isBroken(gapCell(state, 0)))
    assert.equal(gapCell(state, 0).skin, 'ow_water_0', 'the water skin is untouched')
  })
  it('plankGap puts the log back over the water and clears losClear', () => {
    const { state } = build()
    breakGap(state.map, CELLS[GAPS[0]])
    plankGap(state.map, CELLS[GAPS[0]])
    assert.ok(isPlanked(gapCell(state, 0)))
  })
})

describe('arrival rebuilds the deck from the flags', () => {
  it('a fresh map breaks all three gaps', () => {
    const { ctx, state } = build()
    onArrive(ctx)
    for (let i = 0; i < 3; i++) assert.ok(isBroken(gapCell(state, i)), `gap ${i + 1} broken`)
  })
  it('restores exactly the planked cells', () => {
    const { ctx, state } = build({ flags: { pit_lit: true, plank_2: true } })
    onArrive(ctx)
    assert.ok(isBroken(gapCell(state, 0)))
    assert.ok(isPlanked(gapCell(state, 1)))
    assert.ok(isBroken(gapCell(state, 2)))
  })
  it('a finished bridge is left exactly as baked', () => {
    const { ctx, state } = build({ flags: { pit_lit: true, plank_1: true, plank_2: true, plank_3: true, bridge_done: true, bow_given: true } })
    onArrive(ctx)
    for (let i = 0; i < 3; i++) assert.ok(isPlanked(gapCell(state, i)))
  })
  it('a lit pit comes back as one eternal fire, never two', () => {
    const { ctx, state } = build({ flags: { pit_lit: true } })
    onArrive(ctx)
    onArrive(ctx)
    assert.equal(fires(state).length, 1)
    assert.equal(fires(state)[0].eternal, true)
    assert.deepEqual({ x: fires(state)[0].x, y: fires(state)[0].y }, CELLS[PIT])
  })
  it('an unlit pit has no fire', () => {
    const { ctx, state } = build()
    onArrive(ctx)
    assert.equal(fires(state).length, 0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/quest-river.test.js 2>&1 | grep -E "^    not ok|^not ok|# (pass|fail)|Error" | head`
Expected: `ERR_MODULE_NOT_FOUND` for `river.js`.

- [ ] **Step 3: Create the module — arrival and the gap helpers only**

Create `renderer/systems/quests/river.js`:

```js
// Tervahauta, the Tar Pit — the River Split quest (docs/superpowers/specs/
// 2026-09-10-adventure-quests-design.md §3). Six lumber into the pit for
// three Pine Tar; three tar into the south bridge's three missing deck
// cells; the crew's Tervajousi when the deck is whole. The pit's fire is
// permanent from the moment it is lit.
//
// The map is baked with the bridge whole. onArrive breaks the gap cells that
// no plank flag covers — the ferry episode's pier-gap treatment, inverted —
// so the bridge stands, permanently, from the flags on every future arrival.
// onArrive is idempotent; it runs on a fresh load and a waystone arrival, not
// on a cave return (game.js restores the stashed surface whole and gates the
// tick on !state.cave). Pure — no browser/Electron imports.
import { poiCell } from '../quests.js'
import { markTileDirty } from '../tile-dirty.js'
import { TILE } from '../entities.js'
import { makeCampfire, spendLumber } from '../campfire.js'
import { makeItem, addItem, removeItem } from '../inventory.js'
import { queueToast, think } from '../feedback.js'
import { sfx } from '../sfx.js'

export const PIT = 'tar pit'
export const CAMP = 'lumber camp'
export const GAPS = ['bridge gap 1', 'bridge gap 2', 'bridge gap 3']
export const TAR_PIT_COST = 6    // lumber per firing — this module's own, never CAMPFIRE_COST
export const TAR_YIELD = 3       // Pine Tar per firing
export const BOW = 'tervajousi'

const plankFlag = i => `plank_${i + 1}`
const onCell = (p, c) => !!c && p.x === c.x && p.y === c.y
const beside = (p, c) => !!c && Math.abs(p.x - c.x) + Math.abs(p.y - c.y) === 1
const count = (player, kind) => player.inventory.filter(i => i.kind === kind).reduce((n, i) => n + (i.count ?? 1), 0)
const fireAt = (state, c) => state.entities.some(e => e.type === 'campfire' && e.x === c.x && e.y === c.y)
const hasBow = player => player.ranged?.weaponType === BOW || player.inventory.some(i => i.kind === 'ranged' && i.payload?.weaponType === BOW)
const bowOnGround = state => state.entities.some(e => e.type === 'floating_item' && e.contents?.weaponType === BOW)

// A gap cell is baked as a walkable pier-log prop over a water skin. Broken,
// it is water: WALL and losClear, no log art, the skin untouched.
export function breakGap(map, c) {
  const cell = map[c.y]?.[c.x]
  if (!cell) return
  cell.tile = TILE.WALL
  cell.overlay = null
  cell.losClear = true
  markTileDirty(map, c.x, c.y)
}

export function plankGap(map, c) {
  const cell = map[c.y]?.[c.x]
  if (!cell) return
  cell.tile = TILE.FLOOR
  cell.overlay = 'ow_pier_log'
  delete cell.losClear
  markTileDirty(map, c.x, c.y)
}

// The pit's permanent cookfire — an eternal campfire entity on the pit cell.
function lightPit(ctx) {
  const { state } = ctx
  const c = poiCell(ctx.mapData, PIT)
  if (c && !fireAt(state, c)) state.entities.push(makeCampfire(c.x, c.y, { eternal: true }))
}

// The crew's bow waits at the camp until the player has it. Re-dropped on
// arrival if it was lost before it was ever picked up; never duplicated, and
// never again once `bow_given` records it in the player's hands.
function dropBow(ctx) {
  const { state } = ctx
  if (hasBow(state.player) || bowOnGround(state)) return
  const c = poiCell(ctx.mapData, CAMP)
  if (c) ctx.spawn([{ kind: 'floating_pickup', contents: { type: 'ranged', weaponType: BOW }, x: c.x, y: c.y }])
}

export function onArrive(ctx) {
  const { state, flags } = ctx
  if (!flags.bridge_done) GAPS.forEach((label, i) => {
    const c = poiCell(ctx.mapData, label)
    if (!c) return
    if (flags[plankFlag(i)]) plankGap(state.map, c); else breakGap(state.map, c)
  })
  if (flags.pit_lit) lightPit(ctx)
  if (flags.bridge_done && !flags.bow_given) dropBow(ctx)
}

export function tick(ctx, delta) {}
```

- [ ] **Step 4: Run to verify green**

Run: `node --test test/quest-river.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Switch the map test to the module's constants and commit**

In `test/adventure-quest-maps.test.js` replace the string literals from Task 3 with `PIT`, `GAPS`, `CAMP` imported from `../renderer/systems/quests/river.js`. Run `node --test test/adventure-quest-maps.test.js` — green.

```bash
git add renderer/systems/quests/river.js test/quest-river.test.js test/adventure-quest-maps.test.js
git commit -m "feat: add the River Split module — the bridge gaps rebuilt from flags"
```

---

### Task 6: The burn

**Files:**
- Modify: `renderer/systems/quests/river.js` (`tick`)
- Test: `test/quest-river.test.js`

**Interfaces:**
- Produces: standing on `tar pit` with ≥ `TAR_PIT_COST` lumber spends exactly that, adds `TAR_YIELD` tar (or drops it at the pit when the sack is full), sets `pit_lit` the first time and lights the eternal fire with a pausing toast; later firings yield tar with a thought bubble. The first tick of a visit while the deck is unfinished sets `bridge_seen` with a thought.

- [ ] **Step 1: Write the failing tests**

Append to `test/quest-river.test.js`:

```js
describe('the burn', () => {
  it('the first tick on the map notes the broken deck, once', () => {
    const { ctx, state, save, calls } = build()
    onArrive(ctx)
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).bridge_seen, true)
    assert.equal(state.feedback.bubble?.kind, 'thought', 'the beat is a thought bubble, not a toast')
    assert.equal(state.feedback.toasts.length, 0)
    const persists = calls.persist
    tick(ctx, 0.1)
    assert.equal(calls.persist, persists, 'no second beat')
  })
  it('six lumber on the pit become three tar, an eternal fire and a toast', () => {
    const { ctx, state, save, calls } = build({ at: CELLS[PIT], inventory: [makeItem('lumber', 7)] })
    onArrive(ctx)
    tick(ctx, 0.1)
    assert.equal(count(state.player, 'lumber'), 1)
    assert.equal(count(state.player, 'tar'), TAR_YIELD)
    assert.equal(questFlags(save, mapData.name).pit_lit, true)
    assert.equal(fires(state).length, 1)
    assert.equal(fires(state)[0].eternal, true)
    assert.equal(state.feedback.toasts.length, 1, 'lighting the pit is a pausing toast')
    assert.ok(state.sfx.cues.some(c => c.name === 'campfire-light'))
    assert.ok(calls.refreshInventory > 0 && calls.persist > 0)
  })
  it('five lumber is not enough', () => {
    const { ctx, state, save } = build({ at: CELLS[PIT], inventory: [makeItem('lumber', 5)] })
    onArrive(ctx)
    tick(ctx, 0.1)
    assert.equal(count(state.player, 'lumber'), 5)
    assert.equal(questFlags(save, mapData.name).pit_lit, undefined)
  })
  it('standing anywhere else with the lumber does nothing', () => {
    const { ctx, state } = build({ at: CELLS[CAMP], inventory: [makeItem('lumber', 6)] })
    onArrive(ctx)
    tick(ctx, 0.1)
    assert.equal(count(state.player, 'lumber'), 6)
  })
  it('re-fires for more tar while the deck is unfinished, without a second fire or toast', () => {
    const { ctx, state } = build({ flags: { pit_lit: true }, at: CELLS[PIT], inventory: [makeItem('lumber', 6)] })
    onArrive(ctx)
    tick(ctx, 0.1)
    assert.equal(count(state.player, 'tar'), TAR_YIELD)
    assert.equal(fires(state).length, 1)
    assert.equal(state.feedback.toasts.length, 0)
  })
  it('drops the tar at the pit when the sack has no room', () => {
    // Ten junk slots + the lumber stack: once the lumber is spent the sack is exactly full (maxInventory 10).
    const full = Array.from({ length: 10 }, (_, i) => ({ kind: `junk_${i}`, name: 'x', stackable: false }))
    const { ctx, state } = build({ at: CELLS[PIT], inventory: [...full, makeItem('lumber', 6)] })
    onArrive(ctx)
    tick(ctx, 0.1)
    assert.equal(count(state.player, 'tar'), 0)
    const drop = state.entities.find(e => e.type === 'floating_item' && e.contents?.type === 'tar')
    assert.ok(drop)
    assert.equal(drop.contents.count, TAR_YIELD)
    assert.deepEqual({ x: drop.x, y: drop.y }, CELLS[PIT])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/quest-river.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)"`
Expected: the five burn tests fail — `tick` is a no-op, lumber is unspent, `pit_lit` undefined.

- [ ] **Step 3: Implement `tick` — the seen beat and the burn**

Replace `export function tick(ctx, delta) {}` in `river.js`:

```js
export function tick(ctx, delta) {
  const { state, flags } = ctx
  const { player } = state

  if (flags.bridge_done) return   // Task 7 adds the bow beat here

  if (!flags.bridge_seen) {
    ctx.set('bridge_seen')
    think(state, 'The middle planks are gone. No bridge holds without tar.')
    ctx.persist()
  }

  // Burn: stand on the pit with the lumber. It re-fires for more tar while
  // the deck is unfinished; the cost is paid every time.
  const pit = poiCell(ctx.mapData, PIT)
  if (onCell(player, pit) && count(player, 'lumber') >= TAR_PIT_COST) {
    spendLumber(player, 'lumber', TAR_PIT_COST)
    if (!addItem(player, makeItem('tar', TAR_YIELD)).ok)
      ctx.spawn([{ kind: 'floating_pickup', contents: { type: 'tar', count: TAR_YIELD }, x: pit.x, y: pit.y }])
    sfx(state, 'campfire-light', { px: pit.x * 32 + 16, py: pit.y * 32 + 16 })
    if (!flags.pit_lit) {
      ctx.set('pit_lit')
      lightPit(ctx)
      queueToast(state, { title: 'The pit is burning', lines: ['Pine tar, three pots of it.', 'Now the deck.'] })
    } else {
      think(state, 'Three more pots of tar.')
    }
    ctx.refreshInventory()
    ctx.persist()
    return
  }
}
```

- [ ] **Step 4: Run to verify green**

Run: `node --test test/quest-river.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/quests/river.js test/quest-river.test.js
git commit -m "feat: fire the tar pit — six lumber for three tar and a permanent cookfire"
```

---

### Task 7: The planking, the whole deck, and the bow

**Files:**
- Modify: `renderer/systems/quests/river.js` (`tick`)
- Test: `test/quest-river.test.js`

**Interfaces:**
- Produces: standing **beside** a broken gap (Manhattan 1 — a broken gap is water, it cannot be stood on) with tar in the sack spends one tar, planks that cell, sets `plank_N`; when all three are set, `bridge_done` is set, the Tervajousi drops at the camp with a pausing toast; `bow_given` is set the first tick the player is seen with the bow.

- [ ] **Step 1: Write the failing tests**

Append to `test/quest-river.test.js`:

```js
describe('the planking', () => {
  it('standing beside a broken gap with tar spends one tar and planks that cell', () => {
    const { ctx, state, save } = build({ flags: { pit_lit: true, bridge_seen: true }, at: WEST, inventory: [makeItem('tar', 3)] })
    onArrive(ctx)
    tick(ctx, 0.1)
    assert.equal(count(state.player, 'tar'), 2)
    assert.ok(isPlanked(gapCell(state, 0)))
    assert.ok(isBroken(gapCell(state, 1)))
    assert.equal(questFlags(save, mapData.name).plank_1, true)
    assert.ok(state.sfx.cues.some(c => c.name === 'drop'))
  })
  it('one plank per tick, so a held stack lays the deck cell by cell as the player walks', () => {
    const { ctx, state, save } = build({ flags: { pit_lit: true, bridge_seen: true }, at: WEST, inventory: [makeItem('tar', 3)] })
    onArrive(ctx)
    tick(ctx, 0.1)
    moveTo(state, CELLS[GAPS[0]]); tick(ctx, 0.1)
    moveTo(state, CELLS[GAPS[1]]); tick(ctx, 0.1)
    const f = questFlags(save, mapData.name)
    assert.deepEqual([f.plank_1, f.plank_2, f.plank_3], [true, true, true])
    assert.equal(count(state.player, 'tar'), 0)
  })
  it('without tar, or away from a gap, nothing happens', () => {
    const noTar = build({ flags: { pit_lit: true, bridge_seen: true }, at: WEST })
    onArrive(noTar.ctx); tick(noTar.ctx, 0.1)
    assert.ok(isBroken(gapCell(noTar.state, 0)))
    const far = build({ flags: { pit_lit: true, bridge_seen: true }, at: CELLS[CAMP], inventory: [makeItem('tar', 1)] })
    onArrive(far.ctx); tick(far.ctx, 0.1)
    assert.equal(count(far.state.player, 'tar'), 1)
  })
  it('the third plank finishes the bridge: bridge_done, the bow at the camp, a toast', () => {
    const { ctx, state, save, calls } = build({
      flags: { pit_lit: true, bridge_seen: true, plank_1: true, plank_2: true }, at: CELLS[GAPS[1]], inventory: [makeItem('tar', 1)],
    })
    onArrive(ctx)
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).bridge_done, true)
    assert.deepEqual({ x: bowOf(state).x, y: bowOf(state).y }, CELLS[CAMP])
    assert.equal(state.feedback.toasts.length, 1)
    assert.ok(calls.persist > 0)
    assert.equal(itemFromContents(bowOf(state).contents)?.payload?.weaponType, BOW, 'the pickup rebuilds into the Tervajousi')
  })
  it('bow_given is set once the player is seen with the bow, in hand or in the sack', () => {
    const inHand = build({ flags: { bridge_done: true }, ranged: makeRangedContents(BOW) })
    tick(inHand.ctx, 0.1)
    assert.equal(questFlags(inHand.save, mapData.name).bow_given, true)
    const inSack = build({ flags: { bridge_done: true }, inventory: [itemFromContents({ type: 'ranged', weaponType: BOW })] })
    tick(inSack.ctx, 0.1)
    assert.equal(questFlags(inSack.save, mapData.name).bow_given, true)
  })
  it('a lost bow is re-dropped on arrival only until bow_given', () => {
    const lost = build({ flags: { bridge_done: true } })
    onArrive(lost.ctx)
    assert.ok(bowOf(lost.state))
    onArrive(lost.ctx)
    assert.equal(lost.state.entities.filter(e => e.type === 'floating_item').length, 1, 'never duplicated')
    const given = build({ flags: { bridge_done: true, bow_given: true } })
    onArrive(given.ctx)
    assert.equal(bowOf(given.state), null)
  })
  it('a finished quest ticks quietly', () => {
    const { ctx, calls } = build({ flags: { bridge_done: true, bow_given: true } })
    tick(ctx, 0.1)
    assert.equal(calls.persist, 0)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/quest-river.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)"`
Expected: the planking tests fail — tar unspent, gaps stay broken, `bridge_done` undefined, `bow_given` undefined.

- [ ] **Step 3: Implement**

In `river.js`'s `tick`, replace the line `if (flags.bridge_done) return   // Task 7 adds the bow beat here` with:

```js
  if (flags.bridge_done) {
    if (!flags.bow_given && hasBow(player)) { ctx.set('bow_given'); ctx.persist() }
    return
  }
```

and append at the end of `tick` (after the burn block's closing `}`):

```js
  // Plank: stand beside a broken gap with tar in the sack. A broken gap is
  // water — it cannot be stood on — so the deck is laid from its end, one
  // cell per tick, walking out onto each plank as it goes down.
  const ti = player.inventory.findIndex(i => i.kind === 'tar')
  if (ti === -1) return
  for (let i = 0; i < GAPS.length; i++) {
    if (flags[plankFlag(i)]) continue
    const c = poiCell(ctx.mapData, GAPS[i])
    if (!beside(player, c)) continue
    removeItem(player, ti)
    plankGap(state.map, c)
    ctx.set(plankFlag(i))
    sfx(state, 'drop', { px: c.x * 32 + 16, py: c.y * 32 + 16 })
    if (GAPS.every((_, j) => flags[plankFlag(j)])) {
      ctx.set('bridge_done')
      dropBow(ctx)
      queueToast(state, { title: 'The deck is whole', lines: ['Tarred, and it will hold.', 'The crew left something at the camp.'] })
    } else {
      think(state, 'One plank down.')
    }
    ctx.refreshInventory()
    ctx.persist()
    return
  }
```

- [ ] **Step 4: Run to verify green, then the whole suite**

Run: `node --test test/quest-river.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)"` → `# fail 0`.
Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"` → all pass.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/quests/river.js test/quest-river.test.js
git commit -m "feat: plank the south bridge with tar and hand over the Tervajousi"
```

---

### Task 8: Wire it in, amend the spec, and see it run

**Files:**
- Modify: `renderer/systems/quests/index.js`
- Modify: `docs/superpowers/specs/2026-09-10-adventure-quests-design.md` §3 step 4
- Test: `test/quests.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/quests.test.js`'s `QUEST_MODULES` coverage (there is a test that every declared quest has a module — extend it, or add):

```js
it('the River Split has a registered module with onArrive and tick', () => {
  const m = QUEST_MODULES['forest-2-river']
  assert.equal(typeof m?.onArrive, 'function')
  assert.equal(typeof m?.tick, 'function')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/quests.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)"` → `m` is undefined.

- [ ] **Step 3: Register the module**

`renderer/systems/quests/index.js`:

```js
import { onArrive as clearingsArrive, tick as clearingsTick } from './clearings.js'
import { onArrive as riverArrive, tick as riverTick } from './river.js'

export const QUEST_MODULES = {
  'forest-1-clearings': { onArrive: clearingsArrive, tick: clearingsTick },
  'forest-2-river':     { onArrive: riverArrive,     tick: riverTick },
}
```

- [ ] **Step 4: Amend the spec**

In §3 step 4 of the design, replace "Walk onto a broken gap carrying tar" with: "Stand **beside** a broken gap (a broken gap is water and cannot be stood on) carrying tar: one tar is spent, the log overlay returns, the cell goes walkable, `markTileDirty`. The deck is laid from its end, walking out onto each plank as it goes down." Add the flag `bow_given` to the flags list with: "set the first tick the player is seen holding or carrying the bow; the re-drop on arrival stops there, so a deliberately discarded bow is not a free bundle of arrows every visit."

- [ ] **Step 5: Run the suite, then a short live check**

`npm test` — green.

Live, time-boxed to the beats (the arena-test skill's LESSONS.md has the driver recipe; copy `.claude/skills/run-game/driver.mjs` to `.claude/skills/run-game/driver-dbg.mjs` with `'--dcdebug'` added to `args`, run it from a command file, delete the copy after):

1. Title → `level11`. `eval` `window.__dc.state.qCtx.flags` → `{}`; `window.__dc.state.map[58][48].tile` → `1` (WALL) and `.losClear === true`; the pier is visibly broken in a screenshot at the south bridge.
2. `eval` give lumber: `(s=>{ s.player.inventory.push({kind:'lumber',name:'Lumber',emoji:'🪵',stackable:true,count:6}); s.player.x=34; s.player.y=39; s.player.px=34*32+16; s.player.py=39*32+16 })(window.__dc.state)` → next eval: `flags.pit_lit === true`, a `campfire` entity with `eternal: true` at 34,39, the toast on screen (dismiss with Enter), `tar` ×3 in the sack.
3. Teleport to 47,58 → `plank_1`; 48,58 → `plank_2`; 49,58 → `plank_3` and `bridge_done`, the toast, a `floating_item` with `weaponType: 'tervajousi'` at 30,39.
4. Walk onto the bow at the camp: with Marksmanship it equips, without it goes to the sack (`canEquip`); either way the next tick sets `bow_given`.
5. With Marksmanship (`state.player.talents.push('ranged_stance')` then equip), switch to the ranged stance, fire at grass: a `fireZones` entry appears, **no** `-4` burst float, no shockwave.
6. Reload (`location.reload()` then `level11`): planks whole, fire burning, no second bow. Talk to a camp villager: the resolved line.
7. `git status --porcelain renderer/data/` must be empty afterwards; delete `driver-dbg.mjs`.

- [ ] **Step 6: Commit**

```bash
git add renderer/systems/quests/index.js test/quests.test.js docs/superpowers/specs/2026-09-10-adventure-quests-design.md
git commit -m "feat: run Tervahauta on the River Split"
```

---

## Notes for whoever executes this

- **"Walk onto a broken gap" in the spec is impossible** — a broken gap is `TILE.WALL` (water). The module uses *beside* (Manhattan 1); Task 8 amends the spec. Do not "fix" this by making broken gaps walkable.
- **The sack-panel campfire must still cost 3.** `spendLumber`'s new `count` parameter defaults to `CAMPFIRE_COST`; the pit passes `TAR_PIT_COST`. Never change `CAMPFIRE_COST`.
- **`fireOnly` skips the burst *and* the shockwave**, on purpose: an arrow that leaves a patch of fire is the reward; a fireball on a 0.7 s cooldown would not be.
- **Never regenerate `forest-2-river`.** Task 3's script appends POIs to the JSON; `export-game-maps.mjs` only re-exports. If `git diff --stat` shows any other map, revert and redo.
- **The bow's re-drop stops at `bow_given`** (set the first tick the player is seen with it), unlike the elk hide's re-drop which never stops — a bow is 10 arrows a visit if it re-dropped forever.
- **`npm test` occasionally dies with a lone SIGSEGV while every test passes.** Node's runner on this machine, ~1 run in 12. Re-run.
