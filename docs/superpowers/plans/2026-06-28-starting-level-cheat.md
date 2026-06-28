# Starting-Level Cheat Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player type `level<N>` (N = 1–5) on the title screen to start a new run at that depth; invisible input, invalid codes ignored.

**Architecture:** A pure matcher (`parseLevelCheat`) interprets a rolling keystroke buffer and returns a valid depth or `null`. The title screen's existing key handler feeds character keystrokes into that buffer and, on a match, calls a new `onCheat(depth)` callback. `game.js` generalizes its hardcoded `startNewRun()` / `beginRun()` to accept a depth, and wires `onCheat` to it.

**Tech Stack:** Vanilla ES modules (Electron renderer), `node:test` + `node:assert/strict` for unit tests.

## Global Constraints

- Valid depths: `1`–`5`; the upper bound MUST come from `FINAL_DEPTH` in `renderer/data/levels.js` (currently `5`), not a literal.
- Input is invisible — no on-screen echo of typed characters.
- Invalid / out-of-range codes are silently ignored (no clamping, no feedback).
- The normal "Play" button (and Restart / Play Again) MUST continue to start at depth 1 — achieved via depth-defaulting parameters.
- Pure logic stays free of DOM access so it is importable under `node --test` (existing pattern: `menu.js` keeps `document` access inside functions).

---

### Task 1: Pure cheat matcher `parseLevelCheat`

**Files:**
- Create: `renderer/systems/cheats.js`
- Test: `test/cheats.test.js`

**Interfaces:**
- Consumes: `FINAL_DEPTH` from `renderer/data/levels.js`.
- Produces: `parseLevelCheat(buffer: string) => number | null` — returns a depth in `1..FINAL_DEPTH` when `buffer` ends with `level<N>`, else `null`.

- [ ] **Step 1: Write the failing test**

Create `test/cheats.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseLevelCheat } from '../renderer/systems/cheats.js'

describe('parseLevelCheat', () => {
  it('matches level1 through level5', () => {
    for (let d = 1; d <= 5; d++) {
      assert.equal(parseLevelCheat(`level${d}`), d)
    }
  })

  it('ignores out-of-range depths', () => {
    assert.equal(parseLevelCheat('level0'), null)
    assert.equal(parseLevelCheat('level6'), null)
    assert.equal(parseLevelCheat('level9'), null)
    assert.equal(parseLevelCheat('level10'), null)
  })

  it('returns null for partial or empty input', () => {
    assert.equal(parseLevelCheat(''), null)
    assert.equal(parseLevelCheat('lev'), null)
    assert.equal(parseLevelCheat('level'), null)
  })

  it('matches a valid code at the end of a junk-prefixed buffer', () => {
    assert.equal(parseLevelCheat('xqlevel3'), 3)
  })

  it('is case-insensitive', () => {
    assert.equal(parseLevelCheat('LEVEL4'), 4)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/cheats.test.js`
Expected: FAIL — cannot find module `../renderer/systems/cheats.js`.

- [ ] **Step 3: Write the minimal implementation**

Create `renderer/systems/cheats.js`:

```js
import { FINAL_DEPTH } from '../data/levels.js'

// Returns a valid starting depth when `buffer` ends with "level<N>"
// (N in 1..FINAL_DEPTH), otherwise null. Matches on the suffix so stray
// earlier keystrokes don't block a later valid code. Case-insensitive.
export function parseLevelCheat(buffer) {
  const m = /level(\d+)$/.exec(String(buffer).toLowerCase())
  if (!m) return null
  const depth = Number(m[1])
  return depth >= 1 && depth <= FINAL_DEPTH ? depth : null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/cheats.test.js`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/cheats.js test/cheats.test.js
git commit -m "feat(cheats): parseLevelCheat matcher for level<N> codes"
```

---

### Task 2: Depth-parameterize `startNewRun` / `beginRun`

**Files:**
- Modify: `renderer/game.js:170-203` (`startNewRun`), `renderer/game.js:218-222` (`beginRun`)

**Interfaces:**
- Produces: `startNewRun(depth = 1)` and `beginRun(depth = 1)` — both default to depth 1 so existing callers (`onPlay`, `onRestart`, `onPlayAgain`) are unchanged.
- Consumes: existing `DEPTH_THEMES`, `LEVEL_CONFIG`, `generateLevel`, `makePlayer`, etc. (already imported in `game.js`).

This task has no standalone unit test (the `game.js` renderer entry pulls in DOM/Electron and is not imported by any `node:test` file). Its verification is that the existing suite stays green; the end-to-end behavior is verified in Task 3.

- [ ] **Step 1: Generalize `startNewRun`**

In `renderer/game.js`, replace the signature and the four depth-`1` literals. Change:

```js
function startNewRun() {
  const theme = DEPTH_THEMES.find(t => t.depths.includes(1)) ?? DEPTH_THEMES[0]
  const cfg = LEVEL_CONFIG.find(c => c.depth === 1) ?? LEVEL_CONFIG[0]
  const { map, entitySpawns, playerSpawn } =
    generateLevel(1, cfg.mapW, cfg.mapH, { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]), structures })
```

to:

```js
function startNewRun(depth = 1) {
  const theme = DEPTH_THEMES.find(t => t.depths.includes(depth)) ?? DEPTH_THEMES[0]
  const cfg = LEVEL_CONFIG.find(c => c.depth === depth) ?? LEVEL_CONFIG[0]
  const { map, entitySpawns, playerSpawn } =
    generateLevel(depth, cfg.mapW, cfg.mapH, { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]), structures })
```

Then in the `state = { ... }` object inside the same function, change:

```js
    level: 1,
```
to:
```js
    level: depth,
```

and change:

```js
    run: { deepestLevel: 1, won: false },
```
to:
```js
    run: { deepestLevel: depth, won: false },
```

- [ ] **Step 2: Generalize `beginRun`**

In `renderer/game.js`, change:

```js
function beginRun() {
  setPhase(PHASE.PLAYING)
  menu.hide()
  startNewRun()
}
```

to:

```js
function beginRun(depth = 1) {
  setPhase(PHASE.PLAYING)
  menu.hide()
  startNewRun(depth)
}
```

- [ ] **Step 3: Run the full test suite to verify no regressions**

Run: `npm test`
Expected: PASS — same result as before this task (existing tests unaffected; `beginRun`/`startNewRun` keep depth-1 defaults). Note: `onPlay: beginRun` is invoked by the menu as `onSelect()` with no arguments, so the Play button still passes `undefined` → defaults to depth 1.

- [ ] **Step 4: Commit**

```bash
git add renderer/game.js
git commit -m "feat(game): startNewRun/beginRun accept a starting depth"
```

---

### Task 3: Wire title-screen keystroke capture to `onCheat`

**Files:**
- Modify: `renderer/ui/menu.js:24-68` (`renderScreen`), `renderer/ui/menu.js:70-80` (`showTitle`)
- Modify: `renderer/game.js:209-216` (`goTitle`)

**Interfaces:**
- Consumes: `parseLevelCheat` from `../systems/cheats.js`; `beginRun(depth)` from Task 2.
- Produces: `showTitle(meta, { onPlay, onOpenEditor, onQuit, onCheat })` — `onCheat(depth)` is called when a valid `level<N>` is typed on the title screen.

This task is DOM/Electron-coupled, so its verification launches the real app with Playwright and asserts the menu overlay hides after the cheat is typed (the observable signal that `beginRun` ran).

- [ ] **Step 1: Import the matcher and add a rolling buffer in `menu.js`**

At the top of `renderer/ui/menu.js`, after the existing module-level `let` declarations (around line 7), add the import at the very top of the file and a buffer variable:

Add as the first line of the file:
```js
import { parseLevelCheat } from '../systems/cheats.js'
```

Add alongside the other module-level state (after `let selectedIndex = 0`):
```js
let cheatBuffer = ''
```

- [ ] **Step 2: Accept and handle `onCheat` in `renderScreen`**

In `renderScreen`, change the destructured parameter from:

```js
function renderScreen({ title, subtitle, buttons }) {
```
to:
```js
function renderScreen({ title, subtitle, buttons, onCheat }) {
```

Reset the buffer when a screen is built — immediately after `selectedIndex = 0` (around line 54), add:
```js
  cheatBuffer = ''
```

Then extend the `keyHandler` to buffer character keys. Change the handler's closing branch from:

```js
    } else if (e.key === 'Enter') {
      buttons[selectedIndex].onSelect(); e.preventDefault()
    }
```
to:
```js
    } else if (e.key === 'Enter') {
      buttons[selectedIndex].onSelect(); e.preventDefault()
    } else if (onCheat && e.key.length === 1) {
      cheatBuffer = (cheatBuffer + e.key).toLowerCase().slice(-12)
      const depth = parseLevelCheat(cheatBuffer)
      if (depth) { cheatBuffer = ''; onCheat(depth) }
    }
```

- [ ] **Step 3: Pass `onCheat` through `showTitle`**

In `renderer/ui/menu.js`, change:

```js
export function showTitle(meta, { onPlay, onOpenEditor, onQuit }) {
  renderScreen({
    title: 'DUNGEON CRAWLER',
    subtitle: formatMetaSummary(meta),
    buttons: [
      { label: 'Play', onSelect: onPlay },
      { label: 'Open Editor', onSelect: onOpenEditor },
      { label: 'Quit', onSelect: onQuit },
    ],
  })
}
```
to:
```js
export function showTitle(meta, { onPlay, onOpenEditor, onQuit, onCheat }) {
  renderScreen({
    title: 'DUNGEON CRAWLER',
    subtitle: formatMetaSummary(meta),
    buttons: [
      { label: 'Play', onSelect: onPlay },
      { label: 'Open Editor', onSelect: onOpenEditor },
      { label: 'Quit', onSelect: onQuit },
    ],
    onCheat,
  })
}
```

- [ ] **Step 4: Wire `onCheat` in `game.js` `goTitle`**

In `renderer/game.js`, change:

```js
  menu.showTitle(meta, {
    onPlay: beginRun,
    onOpenEditor: () => window.saveAPI.openEditor(),
    onQuit: () => window.saveAPI.quitApp(),
  })
```
to:
```js
  menu.showTitle(meta, {
    onPlay: beginRun,
    onOpenEditor: () => window.saveAPI.openEditor(),
    onQuit: () => window.saveAPI.quitApp(),
    onCheat: (depth) => beginRun(depth),
  })
```

- [ ] **Step 5: Run the full unit-test suite (no regressions)**

Run: `npm test`
Expected: PASS — `menu.test.js` still passes (it imports only `formatMetaSummary`; the new top-level `import` of `cheats.js` must resolve cleanly).

- [ ] **Step 6: Verify the feature end-to-end with Playwright**

Create `scratchpad/verify-cheat.mjs` (in the scratchpad dir, not the repo):

```js
import { _electron as electron } from 'playwright-core'

const app = await electron.launch({ args: ['.'], env: { ...process.env, DISPLAY: ':0' } })
const win = await app.firstWindow()
await win.waitForSelector('#menu-overlay', { state: 'visible' })

// Type the cheat on the title screen.
for (const ch of 'level3') await win.keyboard.press(ch)

// The menu overlay hides once beginRun() runs.
await win.waitForFunction(() => {
  const el = document.getElementById('menu-overlay')
  return el && el.style.display === 'none'
}, { timeout: 5000 })

console.log('PASS: menu hidden after typing level3 (run started)')
await app.close()
```

Run: `DISPLAY=:0 node scratchpad/verify-cheat.mjs`
Expected: prints `PASS: menu hidden after typing level3 (run started)` and exits 0. (Per project setup, the Electron app runs under WSLg with `DISPLAY=:0`.)

Also manually confirm depth: run `npm start`, type `level3` at the title, and verify the in-game level indicator shows Level 3. Confirm typing `level9` does nothing.

- [ ] **Step 7: Commit**

```bash
git add renderer/ui/menu.js renderer/game.js
git commit -m "feat(menu): level<N> cheat code starts run at chosen depth"
```

---

## Self-Review

**Spec coverage:**
- Type `level<N>` starts run at depth N → Tasks 1 (parse) + 2 (start at depth) + 3 (wire). ✓
- Invisible input → no echo added anywhere; buffer is module-internal. ✓
- Invalid/out-of-range ignored → `parseLevelCheat` returns `null`; handler does nothing (Task 1 tests + Task 3 handler). ✓
- Rolling buffer / suffix match → `parseLevelCheat` suffix regex + `.slice(-12)` cap (Task 1 test `xqlevel3`, Task 3 Step 2). ✓
- Valid range from `FINAL_DEPTH` → imported in `cheats.js`. ✓
- Play button still depth 1 → depth-defaulting params (Task 2). ✓
- Pure logic importable under node → `cheats.js` has no DOM access. ✓
- Buffer reset on screen teardown → `cheatBuffer = ''` in `renderScreen` (Task 3 Step 2). ✓

**Placeholder scan:** No TBD/TODO/vague steps; every code step shows complete code. ✓

**Type consistency:** `parseLevelCheat(buffer) => number|null` defined in Task 1, consumed identically in Task 3. `onCheat(depth)` produced in Task 3, consumed by `beginRun(depth)` from Task 2. `startNewRun(depth=1)`/`beginRun(depth=1)` names consistent across Tasks 2–3. ✓
