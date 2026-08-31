# Three Game Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the game into three selectable modes — Adventure (free exploration, waystone travel between visited maps), Dungeon Rush (unchanged), and Timewarp (the three leap episodes as an episode-select mode with its own save).

**Architecture:** An explicit `runMode` value (`'adventure' | 'rush' | 'timewarp' | 'arena'`) set at `beginRun` replaces depth-range inference for mode decisions. Depths stay put (leap maps keep 8–10; no map rebake). A module-level `activeSave` points at the adventure save in adventure mode, or at the picked episode's **adventure-shaped mini-save** in timewarp mode — so every existing helper (leap flags, cave instances, NPC records, felled trees, cleared dungeons) works unchanged against whichever save is active. Adventure's `nextMapDepth` skips leap maps; its waystone opens a destination menu of visited maps.

**Tech Stack:** Electron + vanilla JS ESM, no bundler. Tests: `node:test` in `test/`. UI is DOM overlays (`renderer/ui/menu.js`) + canvas.

**Spec:** `docs/superpowers/specs/2026-08-31-three-game-modes-design.md`

## Global Constraints

- Vanilla JS ES modules; `renderer/systems/*` must stay importable under `node --test` (no `document`/`window` at module top level).
- Colour-only menu buttons — no text badges/emoji markers for resolved state (UI feedback philosophy).
- The timewarp mode must **never** read or write the adventure save (`caves.json` / `dungeon-crawler-caves`); it has its own file/key.
- Run the full suite with `npm test` (from the repo root) — it must stay green after every task.
- Commit after every task.
- Depth numbering is untouched: 0 arena, 1–5 rush, 6 legacy overworld cheat, 7–18 open maps (8–10 = leap), 19 interiors.

---

### Task 1: `modeForDepth` helper

**Files:**
- Create: `renderer/systems/mode.js`
- Test: `test/mode.test.js`

**Interfaces:**
- Consumes: `OPEN_MAPS` from `renderer/data/open-maps.js` (map defs keyed by depth; leap maps have `leap: true`).
- Produces: `modeForDepth(depth) -> 'arena' | 'rush' | 'adventure' | 'timewarp'` — used by `game.js` in Task 5 to infer the mode for cheats and defaults.

- [ ] **Step 1: Write the failing test**

Create `test/mode.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { modeForDepth } from '../renderer/systems/mode.js'

describe('modeForDepth', () => {
  it('depth 0 is the arena', () => {
    assert.equal(modeForDepth(0), 'arena')
  })
  it('dungeon depths 1-5 and the legacy overworld 6 are rush', () => {
    for (const d of [1, 2, 3, 4, 5, 6]) assert.equal(modeForDepth(d), 'rush', `depth ${d}`)
  })
  it('leap maps 8-10 are timewarp', () => {
    for (const d of [8, 9, 10]) assert.equal(modeForDepth(d), 'timewarp', `depth ${d}`)
  })
  it('the other open maps are adventure', () => {
    for (const d of [7, 11, 12, 13, 14, 15, 16, 17, 18]) assert.equal(modeForDepth(d), 'adventure', `depth ${d}`)
  })
  it('depths past the open maps fall back to rush', () => {
    assert.equal(modeForDepth(19), 'rush')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mode.test.js`
Expected: FAIL — cannot find module `renderer/systems/mode.js`.

- [ ] **Step 3: Write the implementation**

Create `renderer/systems/mode.js`:

```js
// The explicit game-mode seam: which of the three selectable modes (plus the
// depth-0 test arena) a run at `depth` belongs to. Title buttons pass the mode
// directly; this is for the level<N> cheat and defaults, where only the depth
// is known.
import { OPEN_MAPS } from '../data/open-maps.js'

export function modeForDepth(depth) {
  if (depth === 0) return 'arena'
  if (OPEN_MAPS[depth]?.leap) return 'timewarp'
  if (OPEN_MAPS[depth]) return 'adventure'
  return 'rush'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mode.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/mode.js test/mode.test.js
git commit -m "feat(modes): modeForDepth — explicit mode from starting depth"
```

---

### Task 2: Adventure chain skips leap maps; save v7 (visited + depth bump); waystone destinations

**Files:**
- Modify: `renderer/systems/adventure.js`
- Test: `test/adventure.test.js` (extend + update two existing expectations)

**Interfaces:**
- Consumes: `OPEN_MAPS`, existing `isMapComplete(progress, mapData)`, `normalizeAdventureSave(raw)`.
- Produces (used by `game.js` in Tasks 5–6):
  - `nextMapDepth(depth) -> number|null` — now skips `leap: true` maps (7 → 11; returns null for a leap-map argument).
  - `recordVisit(progress, mapName) -> void` — appends once to `progress.visited`.
  - `waystoneDestinations(save) -> [{depth, title}]` — visited non-leap maps in depth order, plus the next chain map when the frontier (deepest visited) map is complete.
  - `normalizeAdventureSave` now also guarantees `progress.visited` (array of map names) and the `v7` marker, bumping a leap-map `mapDepth` (8–10) to 11.

- [ ] **Step 1: Write the failing tests**

In `test/adventure.test.js`, change the `nextMapDepth` test (currently asserts `nextMapDepth(7) === 8`):

```js
  it('nextMapDepth walks the chain, skipping leap maps, and ends after the last map', () => {
    assert.equal(nextMapDepth(7), 11)
    assert.equal(nextMapDepth(11), 12)
    assert.equal(nextMapDepth(17), 18)
    assert.equal(nextMapDepth(18), null)
    assert.equal(nextMapDepth(8), null, 'leap maps are not on the chain')
  })
```

Add to the import list: `recordVisit, waystoneDestinations`.

Append these describes:

```js
describe('save v7 (mode split)', () => {
  it('a fresh save carries visited=[Clearings] and the v7 marker', () => {
    const s = normalizeAdventureSave(null)
    assert.deepEqual(s.progress.visited, ['forest-1-clearings'])
    assert.equal(s.v7, true)
  })
  it('a v6 save stranded on a leap map is moved to the river (depth 11)', () => {
    const v6 = { caves: {}, progress: { mapDepth: 9, cleared: {} }, talents: [], body: null,
      gates: {}, npcs: {}, felled: {}, leaps: {}, v6: true }
    const s = normalizeAdventureSave(v6)
    assert.equal(s.progress.mapDepth, 11)
    assert.equal(s.v7, true)
  })
  it('visited is seeded with every non-leap map at or below the current depth', () => {
    const v6 = { caves: {}, progress: { mapDepth: 12, cleared: {} }, talents: [], body: null,
      gates: {}, npcs: {}, felled: {}, leaps: {}, v6: true }
    const s = normalizeAdventureSave(v6)
    assert.deepEqual(s.progress.visited,
      ['forest-1-clearings', 'forest-2-river', 'forest-3-autumn'])
  })
  it('an existing visited list is kept, and the bump never runs twice', () => {
    const v7 = { caves: {}, progress: { mapDepth: 11, cleared: {}, visited: ['forest-1-clearings'] },
      talents: [], body: null, gates: {}, npcs: {}, felled: {}, leaps: {}, v6: true, v7: true }
    const s = normalizeAdventureSave(v7)
    assert.deepEqual(s.progress.visited, ['forest-1-clearings'])
    assert.equal(s.progress.mapDepth, 11)
  })
})

describe('recordVisit', () => {
  it('appends once, ignoring duplicates', () => {
    const progress = freshProgress()
    progress.visited = []
    recordVisit(progress, 'forest-2-river')
    recordVisit(progress, 'forest-2-river')
    assert.deepEqual(progress.visited, ['forest-2-river'])
  })
})

describe('waystoneDestinations', () => {
  it('lists only the visited map while its dungeons are uncleared', () => {
    const s = normalizeAdventureSave(null)   // visited: Clearings, nothing cleared
    assert.deepEqual(s.progress.visited, ['forest-1-clearings'])
    const dests = waystoneDestinations(s)
    assert.deepEqual(dests.map(d => d.depth), [7])
  })
  it('adds the next chain map once the frontier map is complete', () => {
    const s = normalizeAdventureSave(null)
    for (const label of dungeonLabels(OPEN_MAPS[7])) markCleared(s.progress, OPEN_MAPS[7].name, label)
    const dests = waystoneDestinations(s)
    assert.deepEqual(dests.map(d => d.depth), [7, 11], 'skips the leap maps')
    assert.equal(dests[1].title, OPEN_MAPS[11].title)
  })
  it('an uncleared frontier still allows hopping back through every visited map', () => {
    const s = normalizeAdventureSave(null)
    recordVisit(s.progress, OPEN_MAPS[11].name)
    recordVisit(s.progress, OPEN_MAPS[12].name)   // frontier: autumn, uncleared
    assert.deepEqual(waystoneDestinations(s).map(d => d.depth), [7, 11, 12])
  })
  it('the last map has no next entry even when complete', () => {
    const s = normalizeAdventureSave(null)
    for (const d of [11, 12, 13, 14, 15, 16, 17, 18]) recordVisit(s.progress, OPEN_MAPS[d].name)
    for (const label of dungeonLabels(OPEN_MAPS[18])) markCleared(s.progress, OPEN_MAPS[18].name, label)
    assert.deepEqual(waystoneDestinations(s).map(d => d.depth), [7, 11, 12, 13, 14, 15, 16, 17, 18])
  })
})
```

Also update the two existing exact-shape expectations, which will otherwise fail once `v7` exists (`base.progress` is mutated in place, so `visited` inside `progress` passes by shared reference — only the top-level `v7: true` needs adding):

- In `it('v3 saves pass through untouched, …')`: change the expectation to
  `{ ...v3, gates: {}, npcs: {}, felled: {}, leaps: {}, v6: true, v7: true }`
- In `it('v4 saves keep their npcs …')`: change the expectation to
  `{ ...v4, felled: {}, leaps: {}, v6: true, v7: true }`

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test test/adventure.test.js`
Expected: FAIL — `recordVisit` not exported; `nextMapDepth(7)` returns 8; v7 asserts fail.

- [ ] **Step 3: Implement in `renderer/systems/adventure.js`**

Replace `nextMapDepth`:

```js
// The chain follows depth order but skips the leap maps — those belong to
// timewarp mode now; null past the last map or off the chain entirely.
export function nextMapDepth(depth) {
  const depths = Object.keys(OPEN_MAPS).map(Number).sort((a, b) => a - b).filter(d => !OPEN_MAPS[d].leap)
  const i = depths.indexOf(Number(depth))
  return i >= 0 && i + 1 < depths.length ? depths[i + 1] : null
}
```

Extend the version-history comment above `normalizeAdventureSave` with:

```
// v7 splits the modes: leap maps leave the adventure chain (a mapDepth of
// 8-10 moves to 11), progress.visited lists every map reached (seeded with
// the non-leap maps at or below mapDepth), and the leaps record is only kept
// for seeding the separate timewarp save.
```

In `normalizeAdventureSave`, after the `v6` block, add:

```js
  if (!base.v7) {
    if (base.progress.mapDepth >= 8 && base.progress.mapDepth <= 10) base.progress.mapDepth = 11
    base.v7 = true
  }
  base.progress.visited ??= Object.keys(OPEN_MAPS).map(Number)
    .filter(d => !OPEN_MAPS[d].leap && d <= base.progress.mapDepth)
    .sort((a, b) => a - b)
    .map(d => OPEN_MAPS[d].name)
```

Add at the end of the file:

```js
export function recordVisit(progress, mapName) {
  progress.visited ??= []
  if (!progress.visited.includes(mapName)) progress.visited.push(mapName)
}

// The waystone's destination list: every visited (non-leap) map in depth
// order, plus the next chain map once the frontier — the deepest visited
// map — has all its dungeons finished. The gate rides on the frontier only;
// visited maps are always hoppable.
export function waystoneDestinations(save) {
  const visited = save.progress.visited ?? []
  const depths = Object.keys(OPEN_MAPS).map(Number).sort((a, b) => a - b)
    .filter(d => !OPEN_MAPS[d].leap && visited.includes(OPEN_MAPS[d].name))
  const frontier = depths[depths.length - 1]
  const next = frontier != null ? nextMapDepth(frontier) : null
  if (next !== null && isMapComplete(save.progress, OPEN_MAPS[frontier])) depths.push(next)
  return depths.map(d => ({ depth: d, title: OPEN_MAPS[d].title }))
}
```

- [ ] **Step 4: Run the file's tests, then the whole suite**

Run: `node --test test/adventure.test.js` — expected PASS.
Run: `npm test` — expected PASS. If `test/leap.test.js` or the episode tests assert on `nextMapDepth` chain order through 8–10, update those assertions to the new skip behavior (the leap episode logic itself does not use `nextMapDepth`).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/adventure.js test/adventure.test.js
git commit -m "feat(adventure): leap-free chain, save v7 visited list, waystone destinations"
```

---

### Task 3: Timewarp save module + per-episode kits

**Files:**
- Create: `renderer/systems/timewarp.js`
- Modify: `renderer/data/leaps.js` (add `kit` to each episode)
- Test: `test/timewarp.test.js`

**Interfaces:**
- Consumes: `normalizeAdventureSave` (Task 2 shape), `isResolved(save, mapData)` from `renderer/systems/leap.js`, `OPEN_MAPS`, `EPISODES` from `renderer/data/leaps.js`.
- Produces (used by `game.js` in Tasks 5–6):
  - `normalizeTimewarpSave(raw, legacyLeaps?, legacyNpcs?) -> { episodes: { [mapName]: { resolved, save } } }` — `save` is an adventure-shaped mini-save (`normalizeAdventureSave` output) scoped to that one map. When `raw` is null and legacy adventure `leaps`/`npcs` records exist, they seed the episode records and `resolved` is derived with the real `isResolved` rule.
  - `enterEpisode(tw, depth) -> record` — get-or-create; a `resolved` record re-enters **fresh** (its mini-save is replaced, `resolved` kept).
  - `episodeEntries(tw) -> [{depth, title, persona, resolved}]` — for the episode-select menu, in depth order.
  - `kit` on each `EPISODES` entry: same shape as the arena player override — `{ weaponType?, rangedType?, hp?, talents? }`; `{}` = plain new-game loadout.

- [ ] **Step 1: Write the failing tests**

Create `test/timewarp.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTimewarpSave, enterEpisode, episodeEntries } from '../renderer/systems/timewarp.js'
import { EPISODES } from '../renderer/data/leaps.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'

describe('normalizeTimewarpSave', () => {
  it('starts empty from nothing', () => {
    assert.deepEqual(normalizeTimewarpSave(null), { episodes: {} })
  })
  it('keeps existing episode records', () => {
    const rec = { resolved: true, save: { caves: {}, progress: { mapDepth: 8, cleared: {} } } }
    const tw = normalizeTimewarpSave({ episodes: { 'lake-1-ferry': rec } })
    assert.equal(tw.episodes['lake-1-ferry'].resolved, true)
  })
  it('seeds from a legacy adventure leaps record, deriving resolved via the rule', () => {
    const legacy = {
      'lake-1-ferry': { flags: { nakki_gone: true, bell_hung: true } },   // rule: nakki_gone
      'marsh-3-hermit': { flags: { wraith_dead: false } },                 // rule: wraith_dead
    }
    const tw = normalizeTimewarpSave(null, legacy, {})
    assert.equal(tw.episodes['lake-1-ferry'].resolved, true)
    assert.equal(tw.episodes['lake-1-ferry'].save.leaps['lake-1-ferry'].flags.bell_hung, true)
    assert.equal(tw.episodes['marsh-3-hermit'].resolved, false)
    assert.equal(tw.episodes['highland-2-fold'], undefined, 'untouched episodes stay absent')
  })
  it('legacy seeding copies the map npc record so wolf-dependent rules see it', () => {
    const legacy = { 'highland-2-fold': { flags: { maahinen_dead: true } } }
    const npcs = { 'highland-2-fold': { dead: ['npc:highland-2-fold:0'], hostile: false } }
    const tw = normalizeTimewarpSave(null, legacy, npcs)
    assert.deepEqual(tw.episodes['highland-2-fold'].save.npcs['highland-2-fold'], npcs['highland-2-fold'])
  })
})

describe('enterEpisode', () => {
  it('creates a fresh adventure-shaped mini-save pinned to the episode depth', () => {
    const tw = normalizeTimewarpSave(null)
    const rec = enterEpisode(tw, 8)
    assert.equal(rec.resolved, false)
    assert.equal(rec.save.progress.mapDepth, 8)
    assert.deepEqual(rec.save.caves, {})
    assert.equal(rec.save.body, null)
    assert.equal(tw.episodes['lake-1-ferry'], rec, 'stored under the map name')
  })
  it('an unresolved episode resumes: the same record comes back', () => {
    const tw = normalizeTimewarpSave(null)
    const rec = enterEpisode(tw, 9)
    rec.save.leaps['highland-2-fold'] = { flags: { fleece_shown: true } }
    assert.equal(enterEpisode(tw, 9), rec)
    assert.equal(enterEpisode(tw, 9).save.leaps['highland-2-fold'].flags.fleece_shown, true)
  })
  it('a resolved episode re-enters fresh, keeping only the checkmark', () => {
    const tw = normalizeTimewarpSave(null)
    const rec = enterEpisode(tw, 8)
    rec.save.leaps['lake-1-ferry'] = { flags: { nakki_gone: true } }
    rec.resolved = true
    const again = enterEpisode(tw, 8)
    assert.equal(again.resolved, true)
    assert.deepEqual(again.save.leaps, {}, 'flags wiped for replay')
  })
})

describe('episodeEntries', () => {
  it('lists the three leap maps in depth order with resolved state', () => {
    const tw = normalizeTimewarpSave(null)
    enterEpisode(tw, 9).resolved = true
    const entries = episodeEntries(tw)
    assert.deepEqual(entries.map(e => e.depth), [8, 9, 10])
    assert.deepEqual(entries.map(e => e.resolved), [false, true, false])
    assert.equal(entries[0].title, OPEN_MAPS[8].title)
    assert.equal(entries[0].persona, 'Toivo')
  })
})

describe('episode kits', () => {
  it('every episode declares a kit (arena player-override shape)', () => {
    for (const [name, ep] of Object.entries(EPISODES)) {
      assert.ok(ep.kit && typeof ep.kit === 'object', `${name} needs a kit`)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/timewarp.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `renderer/systems/timewarp.js`:

```js
// Timewarp mode's save: one record per leap episode, each carrying an
// adventure-shaped mini-save scoped to that single map — so every helper
// that reads a save (leap flags, cave instances, npc records, felled trees,
// cleared dungeons, the traveling body) works unchanged against it.
// Fully independent of the adventure save by design.
import { OPEN_MAPS } from '../data/open-maps.js'
import { EPISODES } from '../data/leaps.js'
import { normalizeAdventureSave } from './adventure.js'
import { isResolved } from './leap.js'

export function leapDepths() {
  return Object.keys(OPEN_MAPS).map(Number).filter(d => OPEN_MAPS[d].leap).sort((a, b) => a - b)
}

function freshEpisodeSave(depth) {
  const s = normalizeAdventureSave(null)
  s.progress.mapDepth = depth
  return s
}

// legacyLeaps/legacyNpcs: the pre-split adventure save's records, used once
// to seed episodes so pre-v7 progress isn't lost. resolved is derived with
// the episode's real rule (fold's needs the npc record for wolvesAlive).
export function normalizeTimewarpSave(raw, legacyLeaps = null, legacyNpcs = null) {
  if (raw && typeof raw === 'object' && raw.episodes) return { episodes: { ...raw.episodes } }
  const tw = { episodes: {} }
  for (const depth of leapDepths()) {
    const name = OPEN_MAPS[depth].name
    const flags = legacyLeaps?.[name]?.flags
    if (!flags || Object.keys(flags).length === 0) continue
    const rec = enterEpisode(tw, depth)
    rec.save.leaps[name] = { flags: { ...flags } }
    if (legacyNpcs?.[name]) rec.save.npcs[name] = { dead: [...legacyNpcs[name].dead], hostile: !!legacyNpcs[name].hostile }
    rec.resolved = isResolved(rec.save, OPEN_MAPS[depth])
  }
  return tw
}

// Get-or-create the record for the episode at `depth`. A resolved episode
// re-enters fresh — replay from the top, only the checkmark survives.
export function enterEpisode(tw, depth) {
  const name = OPEN_MAPS[depth].name
  const rec = tw.episodes[name] ??= { resolved: false, save: freshEpisodeSave(depth) }
  if (rec.resolved) rec.save = freshEpisodeSave(depth)
  return rec
}

export function episodeEntries(tw) {
  return leapDepths().map(d => {
    const name = OPEN_MAPS[d].name
    return { depth: d, title: OPEN_MAPS[d].title, persona: EPISODES[name]?.persona, resolved: !!tw.episodes[name]?.resolved }
  })
}
```

In `renderer/data/leaps.js`, add to each of the three episode objects (right after the `missing:` line) a kit field. All three start as the plain new-game loadout; the shape matches the arena player override (`weaponType`, `rangedType`, `hp`, `talents`) so tuning later is a data edit:

```js
    kit: {},   // fixed per-episode loadout (arena player-override shape); {} = plain new-game kit
```

- [ ] **Step 4: Run tests**

Run: `node --test test/timewarp.test.js` — expected PASS.
Run: `npm test` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/timewarp.js renderer/data/leaps.js test/timewarp.test.js
git commit -m "feat(timewarp): episode save store with adventure-shaped mini-saves + kits"
```

---

### Task 4: Menu screens — Timewarp button, episode select, waystone destinations

**Files:**
- Modify: `renderer/ui/menu.js`
- Modify: `renderer/index.html` (one CSS rule)
- Test: `test/menu.test.js` (extend)

**Interfaces:**
- Consumes: existing `renderScreen` internals.
- Produces (used by `game.js` in Tasks 5–6):
  - `showTitle(meta, { onAdventure, onTimewarp, onRush, onOpenEditor, onQuit, onCheat })` — new `onTimewarp` callback, button between Adventure and Dungeon Rush.
  - `showEpisodeSelect(entries, { onPick, onBack })` — `entries` from `episodeEntries` (Task 3); `onPick(depth)`.
  - `showDestinations(entries, { onPick, onCancel })` — `entries` from `waystoneDestinations` (Task 2); `onPick(depth)`.
  - `renderScreen` buttons accept an optional `className` (added to `menu-btn`).

- [ ] **Step 1: Write the failing test**

`menu.js` keeps DOM access inside functions, so the new screens are exercised with a minimal document stub. Append to `test/menu.test.js`:

```js
import { showEpisodeSelect, showDestinations, hide } from '../renderer/ui/menu.js'

// Minimal DOM stub: enough for renderScreen (createElement, overlay lookup).
function stubDom() {
  const makeEl = (tag) => {
    const el = {
      tag, children: [], className: '', textContent: '', style: {}, innerHTML: '',
      listeners: {},
      appendChild(c) { el.children.push(c); return c },
      addEventListener(ev, fn) { el.listeners[ev] = fn },
      classList: { toggle() {} },
    }
    return el
  }
  const overlay = makeEl('div')
  globalThis.document = {
    getElementById: id => (id === 'menu-overlay' ? overlay : null),
    createElement: makeEl,
  }
  globalThis.window = { addEventListener() {}, removeEventListener() {} }
  return overlay
}

function buttonsOf(overlay) {
  const panel = overlay.children[0]
  return panel.children.filter(c => c.tag === 'button')
}

describe('showEpisodeSelect', () => {
  it('renders one button per episode plus Back, tinting resolved ones', () => {
    const overlay = stubDom()
    const picks = []
    showEpisodeSelect(
      [{ depth: 8, title: 'Ferry', resolved: true }, { depth: 9, title: 'Fold', resolved: false }],
      { onPick: d => picks.push(d), onBack: () => picks.push('back') },
    )
    const btns = buttonsOf(overlay)
    assert.deepEqual(btns.map(b => b.textContent), ['Ferry', 'Fold', 'Back'])
    assert.equal(btns[0].className, 'menu-btn done')
    assert.equal(btns[1].className, 'menu-btn')
    btns[1].listeners.click()
    btns[2].listeners.click()
    assert.deepEqual(picks, [9, 'back'])
    hide()
    delete globalThis.document
    delete globalThis.window
  })
})

describe('showDestinations', () => {
  it('renders one button per destination plus Stay', () => {
    const overlay = stubDom()
    const picks = []
    showDestinations(
      [{ depth: 7, title: 'Clearings' }, { depth: 11, title: 'River' }],
      { onPick: d => picks.push(d), onCancel: () => picks.push('stay') },
    )
    const btns = buttonsOf(overlay)
    assert.deepEqual(btns.map(b => b.textContent), ['Clearings', 'River', 'Stay'])
    btns[0].listeners.click()
    btns[2].listeners.click()
    assert.deepEqual(picks, [7, 'stay'])
    hide()
    delete globalThis.document
    delete globalThis.window
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/menu.test.js`
Expected: FAIL — `showEpisodeSelect` / `showDestinations` not exported.

- [ ] **Step 3: Implement in `renderer/ui/menu.js`**

In `renderScreen`, change the button construction to honor `className`:

```js
  currentButtons = buttons.map(({ label, onSelect, className }) => {
    const btn = document.createElement('button')
    btn.className = className ? `menu-btn ${className}` : 'menu-btn'
    btn.textContent = label
    btn.addEventListener('click', () => onSelect())
    panel.appendChild(btn)
    return btn
  })
```

In `showTitle`, add `onTimewarp` to the destructured callbacks and a button between Adventure and Dungeon Rush:

```js
      { label: 'Adventure', onSelect: onAdventure },
      { label: 'Timewarp', onSelect: onTimewarp },
      { label: 'Dungeon Rush', onSelect: onRush },
```

Add the two screens after `showTitle`:

```js
// Timewarp's episode picker. Resolved episodes are tinted (colour only, no
// badges) via the `done` class; entries come from timewarp.js's episodeEntries.
export function showEpisodeSelect(entries, { onPick, onBack }) {
  renderScreen({
    title: 'Timewarp',
    subtitle: 'Set right what once went wrong',
    buttons: [
      ...entries.map(e => ({ label: e.title, className: e.resolved ? 'done' : undefined, onSelect: () => onPick(e.depth) })),
      { label: 'Back', onSelect: onBack },
    ],
  })
}

// The adventure waystone's destination list; entries from waystoneDestinations.
export function showDestinations(entries, { onPick, onCancel }) {
  renderScreen({
    title: 'Waystone',
    buttons: [
      ...entries.map(e => ({ label: e.title, onSelect: () => onPick(e.depth) })),
      { label: 'Stay', onSelect: onCancel },
    ],
  })
}
```

In `renderer/index.html`, after the `.menu-btn:hover, .menu-btn.selected` rule, add:

```css
    .menu-btn.done { color: #7fd18a; border-color: #3f6b48; }
    .menu-btn.done:hover, .menu-btn.done.selected { color: #b8f0c0; border-color: #7fd18a; }
```

- [ ] **Step 4: Run tests**

Run: `node --test test/menu.test.js` — expected PASS.
Run: `npm test` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/ui/menu.js renderer/index.html test/menu.test.js
git commit -m "feat(menu): Timewarp title button, episode select and waystone destination screens"
```

---

### Task 5: Mode + save routing in game.js, and the timewarp save channel

**Files:**
- Modify: `renderer/game.js`
- Modify: `main.cjs`, `preload.cjs`, `renderer/web-shim.js`

This task has no new unit test of its own — `game.js` is not importable under node (DOM at top level); its routing is covered by the pure-module tests above and the runtime smoke in Task 7. The suite must stay green and the game must still boot.

**Interfaces:**
- Consumes: `modeForDepth` (Task 1), `recordVisit`/`waystoneDestinations` (Task 2 — used in Task 6), `normalizeTimewarpSave`/`enterEpisode`/`episodeEntries` (Task 3), menu screens (Task 4).
- Produces: module-level `runMode` + `activeSave` in `game.js`; `persistRun()` replacing `persistAdventure()`; `beginRun(depth, mode)`; `window.saveAPI.saveTimewarp(data)` / `loadTimewarp()` on both Electron and web builds.

- [ ] **Step 1: Save channel plumbing**

`main.cjs` — next to `CAVES_FILE`:

```js
const TIMEWARP_FILE = path.join(SAVE_DIR, 'timewarp.json')
```

and next to the `save-caves` handlers:

```js
ipcMain.handle('save-timewarp', (_e, data) => fs.writeFileSync(TIMEWARP_FILE, JSON.stringify(data)))
ipcMain.handle('load-timewarp', () => {
  try { return JSON.parse(fs.readFileSync(TIMEWARP_FILE, 'utf8')) } catch { return null }
})
```

`preload.cjs` — in the exposed object:

```js
  saveTimewarp: (data) => ipcRenderer.invoke('save-timewarp', data),
  loadTimewarp: () => ipcRenderer.invoke('load-timewarp'),
```

`renderer/web-shim.js` — add `const TIMEWARP_KEY = 'dungeon-crawler-timewarp'` next to `CAVES_KEY`, and in the shim object:

```js
    saveTimewarp: async (data) => { try { localStorage.setItem(TIMEWARP_KEY, JSON.stringify(data)) } catch {} },
    loadTimewarp: async () => {
      try { return JSON.parse(localStorage.getItem(TIMEWARP_KEY)) } catch { return null }
    },
```

- [ ] **Step 2: Mode state and imports in `renderer/game.js`**

Add imports (top of file, alongside the existing systems imports):

```js
import { modeForDepth } from './systems/mode.js'
import { normalizeTimewarpSave, enterEpisode, episodeEntries } from './systems/timewarp.js'
```

and extend the existing `./systems/adventure.js` import with `recordVisit, waystoneDestinations`.

Below `let savedAdventure = normalizeAdventureSave(null)` add:

```js
// Which of the three modes (plus the arena) this run is. Set in beginRun;
// mode decisions read this, never depth ranges.
let runMode = 'rush'
let savedTimewarp = normalizeTimewarpSave(null)
// The save the current run reads and writes: the adventure save, or — in
// timewarp — the picked episode's own adventure-shaped mini-save. Every
// map-state helper goes through this so the two modes can't cross-write.
let activeSave = savedAdventure
```

- [ ] **Step 3: `persistAdventure` → `persistRun`**

Rename the function and route by mode; writes go to `activeSave`:

```js
function persistRun() {
  if (runMode !== 'adventure' && runMode !== 'timewarp') return
  const surface = state?.cave ? state.cave.surface : state
  const mapName = surface ? OPEN_MAPS[surface.level]?.name : null
  if (mapName) activeSave.caves[mapName] = surface.caveInstances ?? {}
  if (mapName) activeSave.gates[mapName] =
    Object.entries(surface.gates ?? {}).filter(([, g]) => g.open).map(([id]) => id)
  if (mapName) recordNpcState(activeSave, mapName, surface.npcSpawnIds ?? [], surface.entities, surface.npcWrath)
  if (mapName) activeSave.felled[mapName] = felledCells(surface.map)
  if (mapName && state.player) {
    activeSave.talents = [...(state.player.talents ?? [])]
    activeSave.body = {
      weapon: state.player.weapon ? { ...state.player.weapon } : null,
      ranged: state.player.ranged ? { ...state.player.ranged } : null,
      inventory: state.player.inventory.map(i => i.payload ? { ...i, payload: { ...i.payload } } : { ...i }),
    }
  }
  if (runMode === 'timewarp') window.saveAPI.saveTimewarp?.(savedTimewarp)
  else window.saveAPI.saveCaves?.(savedAdventure)
}
```

Update **every** `persistAdventure()` call site to `persistRun()` (currently at the makeEpCtx `persist:` field, `resolveEpisode`, the mushroom pickup, `tickCaveInstances`, player death, the cave-boss clear, the NPC flush, and twice in `travelToMap`).

- [ ] **Step 4: Swap the per-run save reads to `activeSave`**

Replace `savedAdventure` with `activeSave` at these game.js sites (and only these — the title-screen `onAdventure` depth lookup and the `init()` assignment keep `savedAdventure`):

- `respawnNpcs`: `isResolved(activeSave, data)`
- `arriveOnMap`: `makeEpCtx({ … save: activeSave, … })` and `isResolved(activeSave, mapData)`
- `resolveEpisode`: `isResolved(activeSave, mapData)`
- `startNewRun`: `npcRecordFor(activeSave, …)`, `activeSave.felled[…]`, `player.talents = [...activeSave.talents]`, the whole `activeSave.body` restore block, `caveInstances: … { ...activeSave.caves[…] }`, and the gates loop `activeSave.gates[…]`
- the Echo dialogue line: `ruleCtx(activeSave, state.epCtx.mapData)`
- the waystone block: `isMapUnlocked(activeSave, mapData)` and `activeSave.progress.cleared[…]`
- player death: `resetNpcs(activeSave)`
- cave-boss clear: `isMapComplete(activeSave.progress, mapData)` (both calls) and `markCleared(activeSave.progress, …)`
- `travelToMap`: `npcRecordFor(activeSave, …)`, `activeSave.felled[…]`, `{ ...activeSave.caves[…] }`, `activeSave.progress.mapDepth = depth`

- [ ] **Step 5: `beginRun` gains the mode; callers pass it**

```js
async function beginRun(depth = 1, mode = modeForDepth(depth)) {
  runMode = mode
  activeSave = mode === 'timewarp' ? enterEpisode(savedTimewarp, depth).save : savedAdventure
  let arenaCfg = null
  if (depth === 0 && window.saveAPI?.loadArenaConfig) {
    const res = await window.saveAPI.loadArenaConfig()
    if (res?.error) console.warn(res.error)
    arenaCfg = res?.config ?? null
  }
  setPhase(PHASE.PLAYING)
  menu.hide()
  keys[' '] = false   // swallow the confirming Space so update() can't read it as an attack
  startNewRun(depth, arenaCfg)
}
```

In `goTitle`, pass modes explicitly and wire the new button:

```js
    onAdventure: () => beginRun(OPEN_MAPS[savedAdventure.progress.mapDepth] ? savedAdventure.progress.mapDepth : ADVENTURE_DEPTH, 'adventure'),
    onTimewarp: () => goEpisodeSelect(),
    onRush: () => beginRun(1, 'rush'),
```

(`goEpisodeSelect` lands in Task 6. For this task's commit, add the forward stub `function goEpisodeSelect() { /* replaced in the episode-flow task */ }` near `goTitle`; Task 6 replaces it with the real function.)

In `pauseGame`, restarting keeps the mode: `onRestart: () => beginRun(restartDepth, runMode)`.

In `startNewRun`, add `mode: runMode,` to the `state = { … }` literal (right after `level: depth,`).

- [ ] **Step 6: Kit application via a shared `applyLoadout`**

Extract the arena player-override block in `startNewRun` (the `if (depth === 0 && arenaCfg?.player) { … }` body) into:

```js
// Apply a loadout override (arena config's `player`, or a timewarp episode's
// kit — same shape): weaponType/rangedType/hp/talents, each optional.
function applyLoadout(player, po) {
  if (!po) return
  const def = WEAPON_TYPES[po.weaponType]
  if (def) player.weapon = weaponContents(po.weaponType)
  else if (po.weaponType !== undefined) console.warn(`loadout: unknown player weaponType "${po.weaponType}" — keeping current weapon`)
  const rdef = RANGED_WEAPON_TYPES[po.rangedType]
  if (rdef) player.ranged = makeRangedContents(po.rangedType)
  else if (po.rangedType !== undefined) console.warn(`loadout: unknown player rangedType "${po.rangedType}" — no ranged weapon`)
  if (Number.isFinite(po.hp) && po.hp >= 1) {
    player.maxHp = Math.max(player.maxHp, Math.round(po.hp))
    player.hp = Math.round(po.hp)
  }
  if (Array.isArray(po.talents)) {
    for (const t of po.talents) {
      if (TALENTS[t]) player.talents.push(t)
      else console.warn(`loadout: unknown talent "${t}" — skipped`)
    }
  }
}
```

and replace the block with:

```js
  if (depth === 0 && arenaCfg?.player) applyLoadout(player, arenaCfg.player)
  // First entry into an episode: the fixed kit, not the adventure body.
  // A mid-episode resume has a body in the mini-save and restored it above.
  if (runMode === 'timewarp' && !activeSave.body) applyLoadout(player, episodeFor(OPEN_MAPS[depth])?.kit)
```

The `player.talents` / body restore block guarded by `if (OPEN_MAPS[depth])` already reads `activeSave`, so a timewarp resume restores the episode's own body — no further change.

- [ ] **Step 7: Rush ladder, meta, init**

The rush talent grant condition becomes explicit:

```js
    if (!state.cave && runMode === 'rush' && RUSH_TALENT_LADDER[state.level]) {
```

In `endRun`, the meta profile is rush-only (today an arena death also counts a run — the depth guard in `applyRunResult` only excludes depths past `FINAL_DEPTH`):

```js
  if (runMode === 'rush') meta = applyRunResult(meta, { deepestLevel: state.run.deepestLevel, won })
```

In `init()`, right after `savedAdventure = normalizeAdventureSave(…)`:

```js
  savedTimewarp = normalizeTimewarpSave(await window.saveAPI.loadTimewarp?.(), savedAdventure.leaps, savedAdventure.npcs)
```

- [ ] **Step 8: Verify**

Run: `npm test` — expected PASS.
Boot check (WSLg): `DISPLAY=:0 npm start` briefly, or defer to the Task 7 smoke if the display is unavailable. The game must reach the title screen without console errors.

- [ ] **Step 9: Commit** (may be combined with Task 6 if `goEpisodeSelect` is not stubbed)

```bash
git add renderer/game.js main.cjs preload.cjs renderer/web-shim.js
git commit -m "feat(modes): explicit runMode + activeSave routing, timewarp save channel"
```

---

### Task 6: Waystone destination menu + timewarp episode flow

**Files:**
- Modify: `renderer/game.js`

**Interfaces:**
- Consumes: `waystoneDestinations`/`recordVisit` (Task 2), `episodeEntries` (Task 3), `menu.showEpisodeSelect`/`menu.showDestinations` (Task 4), `runMode`/`activeSave`/`persistRun` (Task 5).
- Produces: `goEpisodeSelect()` (title-screen Timewarp target), the in-game waystone menu, episode resolution marking `resolved`.

- [ ] **Step 1: Episode select screen**

Add near `goTitle`:

```js
function goEpisodeSelect() {
  phase = PHASE.TITLE
  menu.showEpisodeSelect(episodeEntries(savedTimewarp), {
    onPick: depth => beginRun(depth, 'timewarp'),
    onBack: goTitle,
  })
}
```

(If Task 5 left `onTimewarp` pointing at a stub, replace the stub with this.)

- [ ] **Step 2: Rewrite the waystone block in `update()`**

Replace the whole `// Waystone: …` block (the `if (!state.cave && state.mapExit && …)` statement) with:

```js
  // Waystone. Timewarp: a resolved episode's runestone leads back to the
  // episode select. Adventure: the arch opens a destination menu — every
  // visited map, plus the next chain map once the frontier is cleared; the
  // hold flag keeps a cancelled menu from instantly reopening until the
  // player steps off and back on.
  if (!state.cave && state.mapExit && player.x === state.mapExit.x && player.y === state.mapExit.y) {
    const mapData = OPEN_MAPS[state.level]
    if (mapData && runMode === 'timewarp') {
      if (isMapUnlocked(activeSave, mapData)) { persistRun(); goEpisodeSelect(); return }
      state.exitMsgCooldown = (state.exitMsgCooldown ?? 0) - delta
      if (state.exitMsgCooldown <= 0) {
        think(state, 'The runestone is dark. Something here is still wrong.')
        state.exitMsgCooldown = 2
      }
    } else if (mapData) {
      const dests = waystoneDestinations(activeSave).filter(d => d.depth !== state.level)
      if (dests.length && !state.exitMenuHold) { openWaystoneMenu(dests); return }
      if (!dests.length) {
        state.exitMsgCooldown = (state.exitMsgCooldown ?? 0) - delta
        if (state.exitMsgCooldown <= 0) {
          const done = activeSave.progress.cleared[mapData.name] ?? []
          const remain = dungeonLabels(mapData).filter(l => !done.includes(l)).length
          think(state, `The waystone is silent — ${remain} dungeon${remain === 1 ? '' : 's'} remain${remain === 1 ? 's' : ''}.`)
          state.exitMsgCooldown = 2
        }
      }
    }
  } else state.exitMenuHold = false
```

Add the menu opener near `pauseGame`:

```js
function openWaystoneMenu(dests) {
  setPhase(PHASE.PAUSED)
  state.exitMenuHold = true
  menu.showDestinations(dests, {
    onPick: depth => { resumeGame(); travelToMap(depth) },
    onCancel: resumeGame,
  })
}
```

Note: `isMapUnlocked` and `nextMapDepth` may now be unused in game.js's adventure path — remove `nextMapDepth` from game.js's imports if nothing references it after this change (`isMapUnlocked` is still used by the timewarp branch).

- [ ] **Step 3: Record visits**

In `startNewRun`, right before the `if (OPEN_MAPS[depth]) arriveOnMap()` line:

```js
  if (runMode === 'adventure' && OPEN_MAPS[depth]) recordVisit(activeSave.progress, OPEN_MAPS[depth].name)
```

In `travelToMap`, extend the arrival bookkeeping (currently `activeSave.progress.mapDepth = depth` then `persistRun()`):

```js
  activeSave.progress.mapDepth = depth
  recordVisit(activeSave.progress, OPEN_MAPS[depth].name)
  persistRun()
```

- [ ] **Step 4: Mark episodes resolved**

In `resolveEpisode`, before the final `persistRun()` call, add:

```js
  if (runMode === 'timewarp') savedTimewarp.episodes[mapData.name].resolved = true
```

(The record always exists in timewarp mode — `enterEpisode` created it in `beginRun`.)

- [ ] **Step 5: Verify + commit**

Run: `npm test` — expected PASS.

```bash
git add renderer/game.js
git commit -m "feat(modes): adventure waystone destination menu + timewarp episode flow"
```

---

### Task 7: Runtime smoke, docs

**Files:**
- Modify: `/home/lappemikb/CLAUDE.md` (dungeon-crawler section)
- Throwaway: a smoke script in the scratchpad (NOT committed)

- [ ] **Step 1: Playwright smoke (time-boxed, throwaway script)**

Write a scratchpad script driving the Electron app with `playwright-core`'s `_electron` (WSLg needs `DISPLAY=:0`; pattern per `test/` playwright usages — launch `electron .` with `--dcdebug`). Keep the whole run under ~2 minutes. Checks, reading the DOM overlay and `window.__dc.state`:

1. Title screen shows buttons `Adventure / Timewarp / Dungeon Rush / Open Editor / Quit` in that order.
2. Click **Timewarp** → overlay shows `Ferry…/Fold…/Hermit…` titles (from `OPEN_MAPS[8..10].title`) + Back; click the first episode → overlay hides, `__dc.state.mode === 'timewarp'`, `__dc.state.level === 8`.
3. Relaunch (or Quit-to-title via Escape/pause) → **Adventure** → `__dc.state.mode === 'adventure'`, `__dc.state.level === 7`.
4. **Dungeon Rush** → `__dc.state.mode === 'rush'`, `__dc.state.level === 1`.

IMPORTANT (per the editor-autosave hazard): after any automated Electron run, check `git status renderer/data/` and restore any autosaved files. Note: the smoke run writes real save files under the Electron `userData` dir (`caves.json`, `timewarp.json`) — that's the user's own save; if a pre-existing `caves.json` exists, note before/after that its `progress` was only migrated (v7), not reset.

If the display is unavailable, report that the smoke could not run and stop — do not claim runtime verification.

- [ ] **Step 2: Update CLAUDE.md**

In `/home/lappemikb/CLAUDE.md`'s dungeon-crawler architecture section: rewrite the sentence describing the depth 7–18 chain to say the game has three title-screen modes — Adventure (open-map chain 7, 11–18 with a waystone destination menu over `progress.visited`), Dungeon Rush (1–5), and Timewarp (leap maps 8–10 via episode select, per-episode kits, own `timewarp.json`/`dungeon-crawler-timewarp` save of adventure-shaped mini-saves; `renderer/systems/mode.js` + `runMode`/`activeSave` in game.js). Keep it to 3–4 sentences in the existing style.

- [ ] **Step 3: Full suite + commit**

Run: `npm test` — expected PASS.

```bash
git add /home/lappemikb/CLAUDE.md
git commit -m "docs: three game modes in CLAUDE.md"
```
