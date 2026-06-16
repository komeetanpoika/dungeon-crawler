# Adjacency UI Rethink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the painter-learned `adjacency` and `overlays` data for the selected tag in the Rules tab as read-only per-direction bar lists, beside the editable hard-gate rules, with an explainer of how the two layers combine.

**Architecture:** A new `adjacency-view.js` holds pure view-model builders (unit-tested) plus a thin DOM renderer. `rules-ui.js` calls the renderer for the selected tag and gains an `overlay` role option. Read-only — no engine or data-model changes.

**Tech Stack:** Vanilla ES modules, Electron renderer DOM, `node --test` + `node:assert/strict`, Playwright (`playwright-core` `_electron`) for the DOM-flow check.

**Spec:** `docs/superpowers/specs/2026-06-16-adjacency-ui-rethink-design.md`

---

## File Structure

- **Create** `tools/tile-editor/adjacency-view.js` — pure `adjacencyViewModel` / `overlaysViewModel` + thin `renderLearned` DOM renderer.
- **Create** `test/adjacency-view.test.js` — unit tests for the two pure builders.
- **Modify** `tools/tile-editor/index.html` — CSS for the learned bars.
- **Modify** `tools/tile-editor/rules-ui.js` — import + call `renderLearned`; add `overlay` role option.

---

## Task 1: Pure view-model builders

**Files:**
- Create: `tools/tile-editor/adjacency-view.js`
- Test: `test/adjacency-view.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/adjacency-view.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { adjacencyViewModel, overlaysViewModel } from '../tools/tile-editor/adjacency-view.js'

describe('adjacencyViewModel', () => {
  it('sorts each direction by count desc (name tie-break), frac vs per-dir max', () => {
    const def = { adjacency: {
      n: { 'floor.moss': 8, 'floor.dirt': 2 },
      e: { 'b.tag': 3, 'a.tag': 3 },   // tie → name asc
      s: {},
      w: { x: 0 },                     // zero dropped
    } }
    const vm = adjacencyViewModel(def)
    assert.deepEqual(vm.n, [
      { tag: 'floor.moss', count: 8, frac: 1 },
      { tag: 'floor.dirt', count: 2, frac: 0.25 },
    ])
    assert.deepEqual(vm.e.map(r => r.tag), ['a.tag', 'b.tag'])
    assert.equal(vm.e[0].frac, 1)
    assert.deepEqual(vm.s, [])
    assert.deepEqual(vm.w, [])
  })

  it('returns four empty lists when adjacency is absent', () => {
    assert.deepEqual(adjacencyViewModel({ role: 'floor' }), { n: [], e: [], s: [], w: [] })
  })
})

describe('overlaysViewModel', () => {
  it('is null when the tag has no overlays', () => {
    assert.equal(overlaysViewModel({ role: 'floor' }), null)
  })

  it('renders the empty key as (none), sorted desc, frac vs max', () => {
    const vm = overlaysViewModel({ overlays: { '': 6, 'overlay.barrel': 2, x: 0 } })
    assert.deepEqual(vm, [
      { tag: '(none)', count: 6, frac: 1 },
      { tag: 'overlay.barrel', count: 2, frac: 1 / 3 },
    ])
  })

  it('is an empty array for an empty overlays object', () => {
    assert.deepEqual(overlaysViewModel({ overlays: {} }), [])
  })
})
```

- [ ] **Step 2: Run it, confirm it FAILS**

Run: `npm test -- test/adjacency-view.test.js`
Expected: FAIL — module / exports not found.

- [ ] **Step 3: Implement — create `tools/tile-editor/adjacency-view.js`:**

```js
// Pure view-models for the Rules-tab "learned" section, plus a thin DOM renderer.
// A Row is { tag, count, frac } where frac = count / (max count in its group),
// so the largest bar in a group is full width. No DOM in the pure builders.

const DIRS = ['n', 'e', 's', 'w']

function rowsFrom(countMap) {
  const rows = Object.entries(countMap ?? {})
    .filter(([, c]) => c > 0)
    .map(([tag, count]) => ({ tag, count }))
  rows.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  const max = rows.length ? rows[0].count : 0
  return rows.map(r => ({ tag: r.tag, count: r.count, frac: max ? r.count / max : 0 }))
}

export function adjacencyViewModel(tagDef) {
  const adj = tagDef?.adjacency
  const out = {}
  for (const d of DIRS) out[d] = rowsFrom(adj?.[d])
  return out
}

export function overlaysViewModel(tagDef) {
  if (!tagDef?.overlays) return null
  return rowsFrom(tagDef.overlays).map(r => r.tag === '' ? { ...r, tag: '(none)' } : r)
}
```

- [ ] **Step 4: Run it, confirm it PASSES**

Run: `npm test -- test/adjacency-view.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/tile-editor/adjacency-view.js test/adjacency-view.test.js
git commit -m "feat(tile-editor): adjacency-view pure view-models (#3)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Learned-section DOM renderer + CSS

**Files:**
- Modify: `tools/tile-editor/adjacency-view.js`
- Modify: `tools/tile-editor/index.html`

No unit test (DOM glue, no jsdom) — verified by Playwright in Task 4.

- [ ] **Step 1: Append the renderer to `adjacency-view.js`**

Add at the end of `tools/tile-editor/adjacency-view.js`:

```js
function adjRow({ tag, count, frac }) {
  const row = document.createElement('div')
  row.className = 'adj-row'
  const name = document.createElement('span')
  name.className = 'adj-name'
  name.textContent = tag
  const bar = document.createElement('span')
  bar.className = 'adj-bar'
  bar.style.width = Math.round(frac * 100) + '%'
  const num = document.createElement('span')
  num.className = 'adj-count'
  num.textContent = count
  row.append(name, bar, num)
  return row
}

function dirBlock(label, rows) {
  const wrap = document.createElement('div')
  wrap.className = 'adj-dir'
  const lab = document.createElement('span')
  lab.className = 'adj-dirlabel'
  lab.textContent = label
  wrap.appendChild(lab)
  const list = document.createElement('div')
  list.className = 'adj-rows'
  for (const r of rows) list.appendChild(adjRow(r))
  wrap.appendChild(list)
  return wrap
}

// Render the read-only learned section for `tagDef` into `container` (cleared).
export function renderLearned(container, tagDef) {
  container.innerHTML = ''

  const explain = document.createElement('div')
  explain.className = 'label'
  explain.textContent = 'Rules above gate adjacency; learned values below only bias the pick.'
  container.appendChild(explain)

  const head = document.createElement('div')
  head.className = 'label'
  head.textContent = 'Learned neighbors (from painting)'
  container.appendChild(head)

  const adj = adjacencyViewModel(tagDef)
  if (!['n', 'e', 's', 'w'].some(d => adj[d].length)) {
    const none = document.createElement('div')
    none.className = 'adj-empty'
    none.textContent = 'No learned data — derive from a painting (Build tab).'
    container.appendChild(none)
  } else {
    for (const d of ['n', 'e', 's', 'w']) {
      if (adj[d].length) container.appendChild(dirBlock(d.toUpperCase(), adj[d]))
    }
  }

  const ov = overlaysViewModel(tagDef)
  if (ov && ov.length) {
    const oh = document.createElement('div')
    oh.className = 'label'
    oh.textContent = 'Learned overlays'
    container.appendChild(oh)
    container.appendChild(dirBlock('', ov))
  }
}
```

- [ ] **Step 2: Add CSS in `index.html`**

In the `<style>` block, find:
```css
  input.small { width: 60px; }
  input.dir { width: 130px; }
```
Add immediately after those two lines:
```css
  .adj-dir { display: flex; gap: 6px; margin: 3px 0; }
  .adj-dirlabel { flex: 0 0 16px; color: #888; }
  .adj-rows { flex: 1; min-width: 0; }
  .adj-row { display: flex; align-items: center; gap: 6px; margin: 1px 0; }
  .adj-name { flex: 0 0 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .adj-bar { height: 9px; background: #3a6; border-radius: 2px; min-width: 1px; }
  .adj-count { flex: 0 0 auto; color: #9a9; }
  .adj-empty { color: #888; font-style: italic; margin: 3px 0; }
```

- [ ] **Step 3: Sanity-check syntax + suite**

Run: `node --check tools/tile-editor/adjacency-view.js && npm test`
Expected: no syntax output; all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tools/tile-editor/adjacency-view.js tools/tile-editor/index.html
git commit -m "feat(tile-editor): learned-section renderer + bar CSS (#3)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire into the Rules tab

**Files:**
- Modify: `tools/tile-editor/rules-ui.js`

- [ ] **Step 1: Import the renderer**

Find:
```js
import { textPrompt } from './text-prompt.js'
```
Replace with:
```js
import { textPrompt } from './text-prompt.js'
import { renderLearned } from './adjacency-view.js'
```

- [ ] **Step 2: Add the `overlay` role option**

Find:
```js
    for (const r of ['floor', 'wall']) {
      const o = document.createElement('option')
      o.value = r; o.textContent = r; o.selected = rule.role === r
      roleSel.appendChild(o)
    }
```
Replace with:
```js
    for (const r of ['floor', 'wall', 'overlay']) {
      const o = document.createElement('option')
      o.value = r; o.textContent = r; o.selected = rule.role === r
      roleSel.appendChild(o)
    }
```

- [ ] **Step 3: Render the learned section after member weights**

Find:
```js
    rulePanel.appendChild(wWrap)

    const del = document.createElement('button')
```
Replace with:
```js
    rulePanel.appendChild(wWrap)

    const learned = document.createElement('div')
    learned.style.marginTop = '10px'
    renderLearned(learned, rule)
    rulePanel.appendChild(learned)

    const del = document.createElement('button')
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS (all green; this task adds no unit tests — DOM verified in Task 4).

- [ ] **Step 5: Commit**

```bash
git add tools/tile-editor/rules-ui.js
git commit -m "feat(tile-editor): show learned adjacency in Rules tab + overlay role (#3)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: DOM-flow verification (Playwright)

**Files:**
- Create (throwaway, not committed): `verify-adjacency.mjs`

- [ ] **Step 1: Write the verification script**

Create `verify-adjacency.mjs` at the repo root:

```js
import { _electron as electron } from 'playwright-core'
import { execSync } from 'node:child_process'

const app = await electron.launch({ args: ['.', '--editor'] })
const page = await app.firstWindow()
const errs = []
page.on('pageerror', e => errs.push(e.message))
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1500)
const $ = (s) => page.locator(s)
const results = {}

// --- Build a derived tag with adjacency (Build tab) ---
await $('#tab-build').click()
await page.waitForTimeout(300)
await $('#paint-palette img').first().click()          // select a brush tile
await page.waitForTimeout(100)
await $('#paint-tagging input').fill('floor.vtest')
await $('#paint-tagging button').click()               // apply tag (role floor)
await page.waitForTimeout(100)
const box = await $('#paint-canvas').boundingBox()     // paint a horizontal stroke
await page.mouse.move(box.x + 13, box.y + 13)
await page.mouse.down()
await page.mouse.move(box.x + 130, box.y + 13, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(200)
await $('#derive-btn').click()
await page.waitForTimeout(400)
results.deriveReport = await $('#derive-report').textContent()

// --- Rules tab: select the derived tag, expect learned bars ---
await $('#tab-rules').click()
await page.waitForTimeout(200)
await $('#tag-rows .tag-row').filter({ hasText: 'floor.vtest' }).first().click()
await page.waitForTimeout(150)
const panelText = await $('#rule-panel').textContent()
results.hasLearnedHeader = panelText.includes('Learned neighbors')
results.barCount = await $('#rule-panel .adj-bar').count()
results.hasFullBar = await page.evaluate(() =>
  [...document.querySelectorAll('#rule-panel .adj-bar')].some(b => b.style.width === '100%'))
results.roleOptionCount = await $('#rule-panel select option').count()  // expect 3

// --- hand-authored tag → "No learned data" ---
await $('#add-tag').click()
await page.waitForTimeout(150)
const pin = page.locator('body > div input').last()
await pin.fill('floor.handtest'); await pin.press('Enter')
await page.waitForTimeout(200)
results.handNoLearned = (await $('#rule-panel').textContent()).includes('No learned data')

await app.close()

// restore mutated/created files
execSync('git checkout -- renderer/data/rulesets.json 2>/dev/null || true')
execSync('rm -f renderer/data/painter-maps.json')

console.log(JSON.stringify(results, null, 2))
console.log('errors:', errs.length ? errs.join('\n') : '(none)')
```

- [ ] **Step 2: Run the verification**

Run: `timeout 90 node verify-adjacency.mjs`
Expected:
- `deriveReport` contains "Derived" (adjacencies > 0),
- `hasLearnedHeader`: `true`,
- `barCount` ≥ 1, `hasFullBar`: `true`,
- `roleOptionCount`: 3 (floor/wall/overlay),
- `handNoLearned`: `true`,
- `errors`: `(none)`.

- [ ] **Step 3: Confirm clean tree, remove the script**

Run: `git status --short` (no `rulesets.json` change, no `painter-maps.json`), then `rm verify-adjacency.mjs`.
Expected: working tree clean apart from the committed source changes.

---

## Self-Review

**Spec coverage:**
- `adjacencyViewModel` / `overlaysViewModel` (sort, frac-vs-max, `''`→`(none)`, null/empty) → Task 1. ✅
- `renderLearned` (explainer, per-direction blocks, "no learned data", overlays block) → Task 2. ✅
- Bar CSS → Task 2 Step 2. ✅
- Rules-tab wiring (call after member weights, before delete) → Task 3 Step 3. ✅
- `overlay` role option → Task 3 Step 2. ✅
- Read-only (no writes/saves added) → no task introduces a save path. ✅
- Testing: unit builders + Playwright DOM flow (derived tag bars, hand-authored "no learned data", role option) → Task 1, Task 4. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full content. ✅

**Type consistency:** `Row = { tag, count, frac }` is produced by `rowsFrom` and consumed identically by `adjRow` (Task 2). `adjacencyViewModel` returns `{ n, e, s, w }` of `Row[]`, consumed by `renderLearned`'s `['n','e','s','w']` loop. `overlaysViewModel` returns `Row[] | null`, guarded with `if (ov && ov.length)`. `renderLearned(container, tagDef)` signature matches its Task 3 call `renderLearned(learned, rule)`. ✅
