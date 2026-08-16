# Tile Editor UI Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip the unused hard-gate controls out of the tile editor, replace the heading-per-control chrome with group headings + inline rows, and make the Rules tab the single place tags are assigned.

**Architecture:** Pure ruleset mutations move into a new DOM-free module (`tag-edit.js`) with `node --test` coverage, following the existing `derive-rules.js` / `adjacency-view.js` pattern of pure core plus thin renderer. Everything else is markup, CSS and render-function changes across the four editor UI files. No engine, schema, or generation changes — `renderer/systems/decorate.js` and `renderer/data/rulesets.json` are not touched.

**Tech Stack:** Electron, vanilla ES modules, no bundler. Tests are `node:test` (`npm test`). UI verified with `playwright-core`'s `_electron` on WSLg (`DISPLAY=:0`).

**Spec:** `docs/superpowers/specs/2026-08-16-editor-ui-simplification-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `tools/tile-editor/tag-edit.js` | Pure ruleset mutations: assign/remove a tile's tag, list members, brush read-out | **Create** |
| `test/tag-edit.test.js` | Unit tests for the above | **Create** |
| `tools/tile-editor/index.html` | Markup + CSS for all three sidebars | Modify |
| `tools/tile-editor/rules-ui.js` | Rules tab: 3 groups, member add/remove, assign mode | Modify |
| `tools/tile-editor/adjacency-view.js` | Drop the explainer, merge the two learned blocks | Modify |
| `tools/tile-editor/library.js` | Pick mode on the bottom library strip | Modify |
| `tools/tile-editor/map-painter.js` | Build sidebar groups; tagging widget → brush status line | Modify |
| `tools/tile-editor/editor.js` | Draw save-tile no longer tags; wire pick mode + `assign-tile` | Modify |

**Must NOT be modified.** If any of these needs an edit, the work has drifted outside the spec — stop and raise it:
`renderer/systems/decorate.js`, `tools/tile-editor/derive-rules.js`, `renderer/data/rulesets.json`,
`test/decorate.test.js`, `test/derive-rules.test.js`, `test/adjacency-view.test.js`, `test/editor-lib.test.js`, `test/painter-maps.test.js`.

---

## Task 1: `tag-edit.js` — pure ruleset mutations

**Files:**
- Create: `tools/tile-editor/tag-edit.js`
- Test: `test/tag-edit.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/tag-edit.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { memberTiles, assignTileToTag, removeTileFromTag, brushStatus }
  from '../tools/tile-editor/tag-edit.js'

function fixture() {
  return {
    tiles: {
      a: { tags: ['floor.moss'], weight: 4 },
      b: { tags: ['floor.moss'], weight: 1 },
      c: { tags: ['wall.brick'], weight: 2, neighbors: { n: { a: 3 }, e: {}, s: {}, w: {} } },
    },
    tags: {
      'floor.moss': { role: 'floor', allow: ['*'], forbid: [], directional: {} },
      'wall.brick': { role: 'wall', allow: ['*'], forbid: ['floor.moss'], directional: { s: ['wall.brick'] } },
    },
  }
}

describe('memberTiles', () => {
  it('returns members in ruleset insertion order', () => {
    assert.deepEqual(memberTiles(fixture(), 'floor.moss').map(([n]) => n), ['a', 'b'])
  })
  it('returns [] for an unknown tag', () => {
    assert.deepEqual(memberTiles(fixture(), 'nope'), [])
  })
  it('tolerates a missing ruleset', () => {
    assert.deepEqual(memberTiles(undefined, 'x'), [])
  })
})

describe('assignTileToTag', () => {
  it('registers a brand-new tile at weight 1', () => {
    const rs = fixture()
    assert.equal(assignTileToTag(rs, 'fresh', 'floor.moss'), null)
    assert.deepEqual(rs.tiles.fresh, { tags: ['floor.moss'], weight: 1 })
  })
  it('keeps an existing weight when moving a tile', () => {
    const rs = fixture()
    assignTileToTag(rs, 'a', 'wall.brick')
    assert.equal(rs.tiles.a.weight, 4)
    assert.deepEqual(rs.tiles.a.tags, ['wall.brick'])
  })
  it('returns the tag the tile came from, so the caller can report the move', () => {
    const rs = fixture()
    assert.equal(assignTileToTag(rs, 'a', 'wall.brick'), 'floor.moss')
  })
  it('returns null when the tile is already in that tag', () => {
    const rs = fixture()
    assert.equal(assignTileToTag(rs, 'a', 'floor.moss'), null)
  })
  it('preserves a derived neighbors table across a move', () => {
    const rs = fixture()
    assignTileToTag(rs, 'c', 'floor.moss')
    assert.deepEqual(rs.tiles.c.neighbors.n, { a: 3 })
  })
  it('creates a missing tag with a permissive gate and empty adjacency', () => {
    const rs = fixture()
    assignTileToTag(rs, 'a', 'floor.new', 'overlay')
    assert.deepEqual(rs.tags['floor.new'], {
      role: 'overlay', allow: ['*'], forbid: [], directional: {},
      adjacency: { n: {}, e: {}, s: {}, w: {} },
    })
  })
  it('leaves an existing tag\'s hand-authored gate untouched', () => {
    const rs = fixture()
    assignTileToTag(rs, 'a', 'wall.brick')
    assert.deepEqual(rs.tags['wall.brick'].forbid, ['floor.moss'])
    assert.deepEqual(rs.tags['wall.brick'].directional, { s: ['wall.brick'] })
  })
  it('builds tiles/tags containers on an empty ruleset', () => {
    const rs = {}
    assignTileToTag(rs, 'a', 'floor.x')
    assert.deepEqual(rs.tiles.a, { tags: ['floor.x'], weight: 1 })
    assert.equal(rs.tags['floor.x'].role, 'floor')
  })
})

describe('removeTileFromTag', () => {
  it('drops the tile from the ruleset when it has no tags left', () => {
    const rs = fixture()
    assert.equal(removeTileFromTag(rs, 'a', 'floor.moss'), true)
    assert.equal(rs.tiles.a, undefined)
  })
  it('keeps the tile when other tags remain', () => {
    const rs = fixture()
    rs.tiles.a.tags = ['floor.moss', 'floor.extra']
    removeTileFromTag(rs, 'a', 'floor.moss')
    assert.deepEqual(rs.tiles.a.tags, ['floor.extra'])
  })
  it('is a no-op for a tile that is not a member', () => {
    const rs = fixture()
    assert.equal(removeTileFromTag(rs, 'c', 'floor.moss'), false)
    assert.ok(rs.tiles.c)
  })
  it('is a no-op for an unknown tile', () => {
    assert.equal(removeTileFromTag(fixture(), 'ghost', 'floor.moss'), false)
  })
})

describe('brushStatus', () => {
  it('reports the tag of a registered tile', () => {
    assert.deepEqual(brushStatus(fixture(), 'a'),
      { tile: 'a', tag: 'floor.moss', untagged: false, text: 'a · floor.moss →' })
  })
  it('reports an unregistered tile as untagged', () => {
    assert.deepEqual(brushStatus(fixture(), 'ghost'),
      { tile: 'ghost', tag: null, untagged: true, text: 'ghost · untagged →' })
  })
  it('reports no brush at all', () => {
    assert.deepEqual(brushStatus(fixture(), null),
      { tile: null, tag: null, untagged: false, text: 'no brush selected' })
  })
  it('tolerates a missing ruleset', () => {
    assert.equal(brushStatus(undefined, 'a').untagged, true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/tag-edit.test.js`
Expected: FAIL — `Cannot find module '../tools/tile-editor/tag-edit.js'`

- [ ] **Step 3: Write the implementation**

Create `tools/tile-editor/tag-edit.js`:

```js
// Pure ruleset mutations behind the Rules tab's tag editor. No DOM —
// unit-tested with node --test.
//
// The editor is single-tag-per-tile: assigning a tag REPLACES every tag the
// tile had. The schema's `tags` array is honoured on read — memberTiles
// matches any position, removeTileFromTag drops one tag at a time — so a
// hand-edited rulesets.json survives being viewed and edited tag-by-tag, but
// a reassignment collapses it to one tag by design.
//
// `ruleset` must be an object; the mutators do not tolerate undefined. Every
// caller already guards on an active ruleset before reaching them.

// Tiles carrying `tag`, in ruleset insertion order: [[name, def], ...].
export function memberTiles(ruleset, tag) {
  return Object.entries(ruleset?.tiles ?? {})
    .filter(([, def]) => (def.tags ?? []).includes(tag))
}

// A tag the editor invents on demand: permissive gate, no learned data yet.
// Exported so every "make me a fresh tag" path in the editor produces the same
// shape that deriveRules does.
export function blankTag(role) {
  return {
    role, allow: ['*'], forbid: [], directional: {},
    adjacency: { n: {}, e: {}, s: {}, w: {} },
  }
}

// Median weight across `tag`'s current members, or 1 for an empty tag. Used to
// seed a tile added by hand: weights are paint frequencies, so a fresh tile at
// weight 1 beside tag-mates at 160 would effectively never be picked.
export function medianMemberWeight(ruleset, tag) {
  const weights = memberTiles(ruleset, tag).map(([, def]) => def.weight ?? 1).sort((a, b) => a - b)
  if (weights.length === 0) return 1
  const mid = Math.floor(weights.length / 2)
  return weights.length % 2 ? weights[mid] : (weights[mid - 1] + weights[mid]) / 2
}

// Put `tileName` in `tag`. Keeps an existing weight (and any derived
// `neighbors` table — the next ⚙ Derive rules regenerates those wholesale);
// `weight` seeds only a tile the ruleset has not seen before. `tag` is created
// only if missing, so a hand-authored allow/forbid/directional on an existing
// tag survives — via Object.hasOwn, because a `??=` would not fire for a
// user-typed tag name colliding with an Object.prototype key.
// Returns the tag the tile came from, or null if it was untagged or already
// there — the caller uses this to report a move.
export function assignTileToTag(ruleset, tileName, tag, role = 'floor', weight = 1) {
  ruleset.tiles ??= {}
  ruleset.tags ??= {}
  const existing = ruleset.tiles[tileName]
  const previous = existing?.tags?.[0] ?? null
  if (!Object.hasOwn(ruleset.tags, tag)) ruleset.tags[tag] = blankTag(role)
  ruleset.tiles[tileName] = { ...existing, tags: [tag], weight: existing?.weight ?? weight }
  return previous === tag ? null : previous
}

// Drop `tag` from `tileName`. A tile left with no tags leaves the ruleset
// entirely: a ruleset's tile list is exactly its tagged tiles, so there is no
// orphan state to explain. Returns whether anything changed.
export function removeTileFromTag(ruleset, tileName, tag) {
  const def = ruleset?.tiles?.[tileName]
  if (!def || !(def.tags ?? []).includes(tag)) return false
  def.tags = def.tags.filter(t => t !== tag)
  if (def.tags.length === 0) delete ruleset.tiles[tileName]
  return true
}

// One-line read-out for the Build tab's brush.
export function brushStatus(ruleset, tileName) {
  if (!tileName) return { tile: null, tag: null, untagged: false, text: 'no brush selected' }
  const tag = ruleset?.tiles?.[tileName]?.tags?.[0] ?? null
  return { tile: tileName, tag, untagged: !tag, text: `${tileName} · ${tag ?? 'untagged'} →` }
}
```

**Amended after code review.** The block above is the final shape. Eight test cases
were added on top of the 19 listed in Step 1, covering: a multi-tag tile collapsing
to the assigned tag; a tag name colliding with an `Object.prototype` key; the seed
weight applying to a new tile and being ignored for a known one; and
`medianMemberWeight` for odd, even, empty and missing-weight cases. Total 27.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/tag-edit.test.js`
Expected: PASS, 27 tests

- [ ] **Step 5: Run the whole suite**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# fail 0`, total count 655 + 27 = 682

- [ ] **Step 6: Commit**

```bash
git add tools/tile-editor/tag-edit.js test/tag-edit.test.js
git commit -m "feat(editor): add tag-edit, the pure core of the unified tag editor"
```

---

## Task 2: Shared chrome CSS + Draw sidebar + save-tile

**Files:**
- Modify: `tools/tile-editor/index.html:6-66` (CSS), `:95-109` (Draw sidebar), `:185-191` (library bar)
- Modify: `tools/tile-editor/editor.js:139` (hoist `library`), `:194-229` (save-tile)

- [ ] **Step 1: Add the shared chrome CSS**

In `tools/tile-editor/index.html`, immediately after the existing `.label` rule (line 20), insert:

```css
  /* Group heading: one per SET of controls, replacing the old heading-per-control. */
  .grp { color: #8a8a98; font-size: 11px; text-transform: uppercase; letter-spacing: .5px;
         border-bottom: 1px solid #2a2a36; padding-bottom: 3px; margin: 11px 0 6px;
         display: flex; justify-content: space-between; align-items: baseline; }
  .grp:first-child { margin-top: 0; }
  /* Inline row: label and control share a line. */
  .row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
  .rlab { color: #8a8a98; font-size: 11px; flex: 0 0 52px; text-align: right; }
  .cap { color: #777; font-size: 10px; margin-top: 2px; }
  .thumb { width: 22px; height: 22px; image-rendering: pixelated; border: 1px solid #333;
           border-radius: 2px; flex: 0 0 auto; }
  .x { color: #966; cursor: pointer; font-size: 11px; }
  .x:hover { color: #e88; }
  .assign-banner { color: #7fd; font-size: 11px; margin-bottom: 4px; }
  #library-mode { color: #7fd; font-size: 11px; }
  #library.picking img { cursor: crosshair; }
  #library.picking img:hover { border-color: #7fd; box-shadow: 0 0 0 2px #7fd3; }
```

- [ ] **Step 2: Restructure the Draw sidebar**

Replace `tools/tile-editor/index.html` lines 95-109 (the whole `<div id="sidebar" …>` block) with:

```html
    <div id="sidebar" class="panel">
      <div class="grp">Preview</div>
      <div style="display:flex; gap:8px; align-items:flex-end">
        <div>
          <canvas id="preview-1x" width="16" height="16"></canvas>
          <div class="cap">1:1</div>
        </div>
        <div>
          <canvas id="preview-3x" width="96" height="96"></canvas>
          <div class="cap">3×3 seamless</div>
        </div>
      </div>
      <div class="grp">Colour</div>
      <div id="palette"></div>
      <div class="row">
        <span class="rlab">custom</span>
        <input type="color" id="custom-color" value="#5a5a72">
      </div>
      <div class="grp">Tile</div>
      <div class="row">
        <span class="rlab">name</span>
        <input id="tile-name" placeholder="moss_floor_1" style="flex:1; min-width:0">
      </div>
      <div id="tile-name-hint" style="font-size:11px; min-height:14px; color:#888; margin-left:58px"></div>
    </div>
```

Note what is gone: the `Tags (comma-separated)` label and the `#tile-tags` input.

- [ ] **Step 3: Add the pick-mode prompt slot to the library bar**

In `tools/tile-editor/index.html`, replace line 187 (the library-bar header `<span class="label">` line) so the row reads:

```html
      <span class="label" style="margin:0">Library (click = load as base)</span>
      <span id="library-mode"></span>
      <input id="library-filter" placeholder="filter…" style="width:140px">
```

- [ ] **Step 4: Hoist the `library` declaration in editor.js**

`showTab()` will need to cancel pick mode, and it runs at module load — before the current `let library` on line 139, which would throw a temporal-dead-zone `ReferenceError`.

In `tools/tile-editor/editor.js`, delete the bare `let library` on line 139, and add it to the const block at the top, right after line 18 (`const tabBuild = …`):

```js
let library   // set once buildLibrary resolves; declared here so showTab can reach it
```

- [ ] **Step 5: Stop save-tile from writing tags**

In `tools/tile-editor/editor.js`, replace everything from `document.dispatchEvent(new CustomEvent('tile-saved'…` through the closing `}` of the `catch` block (lines 206-228) with:

```js
    // Surface the new tile everywhere it can be used (Draw library above + Build palette).
    document.dispatchEvent(new CustomEvent('tile-saved', { detail: { name } }))
    // Tagging lives in the Rules tab now — a ruleset's tile list is exactly its
    // tagged tiles, so a freshly drawn tile is just a library sprite until it
    // is assigned there.
    toast(`Saved ${name}.png — add it to a tag in Rules.`, 'ok')
  } catch (err) {
    toast(`Save failed: ${err?.message ?? err}`, 'error')
  }
```

- [ ] **Step 6: Verify the editor still loads and the sidebar fits**

Create `debug-editor-ui.mjs` in the repo root (`debug*.mjs` is gitignored):

```js
import { _electron as electron } from 'playwright-core'
const app = await electron.launch({
  args: ['.', '--editor'], cwd: process.cwd(),
  env: { ...process.env, DISPLAY: ':0' },
})
const win = await app.firstWindow()
// Attach before the page settles, or module-load errors are missed.
const errors = []
win.on('pageerror', e => errors.push(String(e)))
await win.waitForLoadState('domcontentloaded')
await win.setViewportSize({ width: 1440, height: 900 })
await win.waitForTimeout(2500)

// Draw tab
await win.click('#tab-draw'); await win.waitForTimeout(600)
console.log('tags input removed:', await win.locator('#tile-tags').count() === 0)
const sb = await win.locator('#sidebar').evaluate(el => ({ h: el.scrollHeight, box: el.clientHeight }))
console.log('draw sidebar fits without scrolling:', sb.h <= sb.box, sb)
await win.screenshot({ path: 'debug-draw.png' })

console.log('page errors:', errors)
await app.close()
```

Run: `node debug-editor-ui.mjs`
Expected: `tags input removed: true`, `draw sidebar fits without scrolling: true`, `page errors: []`

- [ ] **Step 7: Look at the screenshot**

Open `debug-draw.png`. Expected: three group headings (Preview / Colour / Tile) with a rule under each, the two preview canvases side by side with small captions, and the name field visible without scrolling.

- [ ] **Step 8: Run the whole suite**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 9: Commit**

```bash
git add tools/tile-editor/index.html tools/tile-editor/editor.js
git commit -m "refactor(editor): group headings + inline rows in the Draw sidebar

Adds the shared .grp/.row/.rlab/.cap chrome used by all three tabs, drops the
tags field (tagging moves to Rules), and stops save-tile registering tiles in
the active ruleset."
```

---

## Task 3: Rules tab — drop the hard gate, three groups, member rows

**Files:**
- Modify: `tools/tile-editor/adjacency-view.js:59-92` (`renderLearned`)
- Modify: `tools/tile-editor/rules-ui.js` (whole `render()` / `renderTagList()`)

- [ ] **Step 1: Rewrite `renderLearned`**

In `tools/tile-editor/adjacency-view.js`, replace the whole `renderLearned` function (lines 58-92) with:

```js
// Render the read-only learned section for `tagDef` into `container` (cleared).
// The explainer line that used to sit here existed only to distinguish the
// learned bias from the hand-authored hard gate above it; with the gate gone
// from the UI there is nothing left to disambiguate.
export function renderLearned(container, tagDef) {
  container.innerHTML = ''

  const head = document.createElement('div')
  head.className = 'grp'
  head.textContent = 'Learned from painting'
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
    const cap = document.createElement('div')
    cap.className = 'cap'
    cap.style.marginTop = '8px'
    cap.textContent = 'overlays'
    container.append(cap, dirBlock('', ov))
  }
}
```

- [ ] **Step 2: Verify the pure view-model tests still pass**

Run: `node --test test/adjacency-view.test.js`
Expected: PASS — `renderLearned` is not unit-tested, only `adjacencyViewModel` / `overlaysViewModel`, and neither changed.

- [ ] **Step 3: Rewrite rules-ui.js**

Replace the whole of `tools/tile-editor/rules-ui.js` with the following.

**Amended after code review.** This is the final shape, incorporating three fixes to
the assign-mode contract as originally specified: assign mode now exits on a tab
switch (via the `tab-changed` event `showTab` dispatches), `+ add tile` cancels assign
mode so the two are genuinely mutually exclusive, and a single `assign()` helper guards
the no-op case — previously, clicking a tile's *current* tag while assigning still
rewrote its def and could silently collapse a hand-edited multi-tag tile. Also folded
in: a thumbnail data-URL memo (16 IPC round trips per re-render otherwise blanked every
thumbnail for a frame), a visible failure state for a missing sprite, a two-span tag row
so the member count right-aligns, `+ new tag` completing an in-flight assignment, and
delete-tag unlinking its members instead of stranding them in `ruleset.tiles`.

```js
// Rules tab: the editor's single tag editor. Per tag it shows the role, its
// member tiles (add / remove / weight) and the read-only data derived from a
// painting. The hand-authored hard gate (allow / forbid / directional) is no
// longer editable here — it is unused by every shipped ruleset and lives on in
// decorate.js for hand-edited JSON. Mutates the shared state object; emits
// 'rules-edited' on every change so the sample preview re-renders.
import { textPrompt } from './text-prompt.js'
import { renderLearned } from './adjacency-view.js'
import { toast } from './toast.js'
import { memberTiles, assignTileToTag, removeTileFromTag, medianMemberWeight, blankTag } from './tag-edit.js'

export function initRulesUI(state, { pickTile } = {}) {
  const tagRows = document.getElementById('tag-rows')
  const rulePanel = document.getElementById('rule-panel')
  let selectedTag = null
  let assigning = null      // tile name awaiting a tag, set by the Build tab

  function edited() { document.dispatchEvent(new Event('rules-edited')) }
  function activeRs() { return state.rulesets[state.active] }

  // Single assignment path, so the "already there" guard and the move report
  // cannot drift between the tag list and + add tile. Returns whether it wrote.
  function assign(rs, tile, tag, seed = medianMemberWeight(rs, tag)) {
    if (rs.tiles[tile]?.tags?.[0] === tag) return false
    const prev = assignTileToTag(rs, tile, tag, rs.tags[tag].role, seed)
    if (prev) toast(`${tile} moved from ${prev} to ${tag}`, 'info')
    edited()
    return true
  }

  // data-URL memo: without it every re-render blanks all thumbnails for a frame
  // while the IPC round trips resolve.
  const thumbSrc = new Map()
  function thumb(name) {
    const img = document.createElement('img')
    img.className = 'thumb'
    img.title = name
    const cached = thumbSrc.get(name)
    if (cached) { img.src = cached; return img }
    window.editorAPI.readTile(name)
      .then(src => { thumbSrc.set(name, src); img.src = src })
      .catch(() => { img.title = `${name} — sprite missing`; img.style.borderColor = '#c66' })
    return img
  }
  // A redrawn tile must not keep a stale thumbnail.
  document.addEventListener('tile-saved', e => thumbSrc.delete(e.detail.name))

  function renderTagList() {
    const rs = activeRs()
    tagRows.innerHTML = ''
    if (assigning) {
      const banner = document.createElement('div')
      banner.className = 'assign-banner'
      banner.textContent = `assigning ${assigning} — pick a tag (esc to cancel)`
      tagRows.appendChild(banner)
    }
    if (!rs) return
    for (const tag of Object.keys(rs.tags)) {
      const row = document.createElement('div')
      row.className = 'tag-row' + (tag === selectedTag ? ' active' : '')
      const nameEl = document.createElement('span')
      nameEl.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap'
      nameEl.textContent = tag
      const countEl = document.createElement('span')
      countEl.style.color = '#889'
      countEl.textContent = memberTiles(rs, tag).length
      row.append(nameEl, countEl)
      row.addEventListener('click', () => {
        if (assigning) {
          const tile = assigning
          assigning = null
          assign(rs, tile, tag)
        }
        selectedTag = tag
        render()
      })
      tagRows.appendChild(row)
    }
  }

  function render() {
    renderTagList()
    rulePanel.innerHTML = ''
    const rs = activeRs()
    if (!rs || !selectedTag || !rs.tags[selectedTag]) {
      rulePanel.innerHTML = '<div class="label">Select a tag (or create one via + new tag)</div>'
      return
    }
    const rule = rs.tags[selectedTag]

    // --- identity: tag name, then role + delete on one row ---
    const head = document.createElement('div')
    // `ident` opts out of .grp's uppercase transform: this heading shows a
    // case-sensitive ruleset key, and CASTLE.FLOOR is not the tag's name.
    head.className = 'grp ident'
    head.textContent = selectedTag
    rulePanel.appendChild(head)

    const idRow = document.createElement('div')
    idRow.className = 'row'
    const roleLab = document.createElement('span')
    roleLab.className = 'rlab'
    roleLab.textContent = 'role'
    const roleSel = document.createElement('select')
    for (const r of ['floor', 'wall', 'overlay']) {
      const o = document.createElement('option')
      o.value = r; o.textContent = r; o.selected = rule.role === r
      roleSel.appendChild(o)
    }
    roleSel.addEventListener('change', () => { rule.role = roleSel.value; edited() })
    const spacer = document.createElement('span')
    spacer.style.flex = '1'
    const del = document.createElement('span')
    del.className = 'x'
    del.textContent = '🗑 delete'
    del.addEventListener('click', () => {
      const tag = selectedTag
      if (!confirm(`Delete tag ${tag}? Its member tiles leave the ruleset — re-add them to another tag to keep them.`)) return
      for (const [name] of memberTiles(rs, tag)) removeTileFromTag(rs, name, tag)
      delete rs.tags[tag]
      selectedTag = null
      render(); edited()
    })
    idRow.append(roleLab, roleSel, spacer, del)
    rulePanel.appendChild(idRow)

    // --- member tiles ---
    const memHead = document.createElement('div')
    memHead.className = 'grp'
    const memTitle = document.createElement('span')
    memTitle.textContent = 'Member tiles'
    const addBtn = document.createElement('span')
    addBtn.className = 'add-chip'
    addBtn.id = 'add-tile'
    addBtn.textContent = '+ add tile'
    addBtn.addEventListener('click', () => {
      if (!pickTile) return
      assigning = null                       // the two modes are mutually exclusive
      const tag = selectedTag                // capture: the list stays clickable while picking
      const seed = medianMemberWeight(rs, tag)
      pickTile(`pick a tile for ${tag}`, (name) => {
        assign(rs, name, tag, seed)
        render()
      })
    })
    memHead.append(memTitle, addBtn)
    rulePanel.appendChild(memHead)

    for (const [name, def] of memberTiles(rs, selectedTag)) {
      const row = document.createElement('div')
      row.className = 'row'
      const nameEl = document.createElement('span')
      nameEl.style.cssText = 'flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap'
      nameEl.textContent = name
      const w = document.createElement('input')
      w.className = 'small'
      w.type = 'number'
      w.min = '0.1'
      w.step = '0.1'
      w.value = def.weight ?? 1
      w.addEventListener('change', () => { def.weight = Math.max(0.1, Number(w.value) || 1); edited() })
      const rm = document.createElement('span')
      rm.className = 'x'
      rm.title = `remove ${name} from ${selectedTag}`
      rm.textContent = '✕'
      rm.addEventListener('click', () => {
        removeTileFromTag(rs, name, selectedTag)
        render(); edited()
      })
      row.append(thumb(name), nameEl, w, rm)
      rulePanel.appendChild(row)
    }

    // --- learned (read-only; re-paint + re-derive to change it) ---
    const learned = document.createElement('div')
    renderLearned(learned, rule)
    rulePanel.appendChild(learned)
  }

  document.getElementById('add-tag').addEventListener('click', async () => {
    const rs = activeRs()
    if (!rs) { toast('Create a ruleset first (+ new in the header).', 'error'); return }
    const tag = ((await textPrompt('New tag (e.g. floor.moss):')) ?? '').trim()
    if (!tag) return
    // blankTag, not a local literal: one shape for every "fresh tag" path.
    // Object.hasOwn, not ??=, so a tag named e.g. "constructor" is still created.
    if (!Object.hasOwn(rs.tags, tag)) rs.tags[tag] = blankTag(tag.startsWith('wall') ? 'wall' : 'floor')
    selectedTag = tag
    if (assigning) { const tile = assigning; assigning = null; assign(rs, tile, tag) }
    render(); edited()
  })

  // The Build tab hands a brush over here to be tagged.
  document.addEventListener('assign-tile', (e) => {
    assigning = e.detail.tile
    selectedTag = e.detail.tag ?? selectedTag
    render()
  })

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && assigning) { assigning = null; render() }
  })

  // A mode must never survive leaving the tab that set it.
  document.addEventListener('tab-changed', (e) => {
    if (e.detail.tab !== 'rules' && assigning) { assigning = null; render() }
  })

  document.addEventListener('ruleset-changed', () => { selectedTag = null; assigning = null; render() })
  render()
}
```

- [ ] **Step 4: Verify in the running editor**

Append to `debug-editor-ui.mjs` before `await app.close()`:

```js
await win.click('#tab-rules'); await win.waitForTimeout(600)
await win.locator('#tag-rows .tag-row').first().click(); await win.waitForTimeout(400)
console.log('hard-gate chips gone:', await win.locator('#rule-panel .chip').count() === 0)
console.log('directional inputs gone:', await win.locator('#rule-panel input.dir').count() === 0)
console.log('group headings:', await win.locator('#rule-panel .grp').allTextContents())
console.log('member thumbnails:', await win.locator('#rule-panel img.thumb').count())
await win.screenshot({ path: 'debug-rules.png' })
```

Run: `node debug-editor-ui.mjs`
Expected: `hard-gate chips gone: true`, `directional inputs gone: true`, group headings listing the tag name plus `Member tiles` and `Learned from painting`, and a non-zero thumbnail count.

- [ ] **Step 5: Run the whole suite**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add tools/tile-editor/rules-ui.js tools/tile-editor/adjacency-view.js
git commit -m "refactor(editor): cut the hard gate from the Rules tab

Six control groups become three. allow/forbid/directional are unused by every
shipped ruleset and stay honoured by decorate.js for hand-edited JSON, so this
is UI-only. Member rows gain thumbnails and a remove control."
```

---

## Task 4: Library pick mode — `+ add tile`

**Files:**
- Modify: `tools/tile-editor/library.js` (whole file)
- Modify: `tools/tile-editor/editor.js:20-31` (`showTab`), `:140-150` (buildLibrary call), `:231` (initRulesUI call)

- [ ] **Step 1: Rewrite library.js**

Replace the whole of `tools/tile-editor/library.js` with the following.

**Amended after code review.** Final shape. Two spec requirements had been dropped from
the task text and are now restored: pick mode must also cancel on a **ruleset change**
(a pick started in one ruleset could otherwise write into it after switching away, and
persist on Save), and a **second click on `+ add tile` cancels** rather than silently
re-arming. `get picking()` exists to support that toggle. `addThumb` also respects an
active filter, so a tile appended by Save tile can't appear in a filtered view.

```js
// Bottom strip: thumbnails of every tile. A click normally loads the tile into
// the pixel editor; while pick mode is active it instead answers whoever asked
// for a tile (the Rules tab's "+ add tile"), then leaves pick mode.
export async function buildLibrary(names, { onPick }) {
  const container = document.getElementById('library')
  const filter = document.getElementById('library-filter')
  const modeEl = document.getElementById('library-mode')
  const items = []
  let pick = null                       // { handler } while picking

  function setPickMode(handler, prompt = '') {
    pick = handler ? { handler } : null
    modeEl.textContent = pick ? `${prompt} · esc to cancel` : ''
    container.classList.toggle('picking', !!pick)
  }

  // One click funnel so pick mode also applies to tiles added after the initial
  // build (the Draw tab's Save tile appends to this strip at runtime).
  function fire(name) {
    if (!pick) { onPick(name); return }
    const { handler } = pick
    setPickMode(null)                   // leave the mode before the handler re-renders
    handler(name)
  }

  function addThumb(name, src) {
    const img = document.createElement('img')
    img.src = src
    img.title = name
    img.dataset.name = name
    // Respect an active filter — Save tile can append while one is typed in.
    const q = filter.value.toLowerCase()
    if (q && !name.toLowerCase().includes(q)) img.style.display = 'none'
    img.addEventListener('click', () => fire(name))
    container.appendChild(img)
    items.push({ name, img })
  }

  for (const name of names) addThumb(name, await window.editorAPI.readTile(name))

  filter.addEventListener('input', () => {
    const q = filter.value.toLowerCase()
    for (const { name, img } of items)
      img.style.display = name.toLowerCase().includes(q) ? '' : 'none'
  })
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setPickMode(null) })

  return {
    add(name, dataURL) {
      const existing = items.find(it => it.name === name)
      if (existing) { existing.img.src = dataURL; return }
      addThumb(name, dataURL)
    },
    setPickMode,
    get picking() { return !!pick },
  }
}
```

- [ ] **Step 2: Cancel pick mode on any tab switch**

In `tools/tile-editor/editor.js`, add this inside `showTab()` after the `library-bar` display line and **before** the `tab-changed` dispatch that Task 3 added:

```js
  library?.setPickMode(null)   // a mode must never survive leaving the tab that set it
```

- [ ] **Step 3: Hand a pick-mode entry point to the Rules tab**

In `tools/tile-editor/editor.js`, replace line 231 (`initRulesUI(state)`) with:

```js
initRulesUI(state, {
  pickTile: (prompt, handler) => {
    // buildLibrary resolves after ~139 IPC reads; the Rules tab isn't gated on it.
    if (!library) { toast('Library still loading — try again in a moment.', 'info'); return }
    if (library.picking) { library.setPickMode(null); return }   // a second click cancels
    library.setPickMode(handler, prompt)
  },
})

// A pick belongs to the ruleset it was started in — never let it land in another.
document.addEventListener('ruleset-changed', () => library?.setPickMode(null))
```

- [ ] **Step 4: Verify in the running editor**

Append to `debug-editor-ui.mjs` before `await app.close()`:

```js
await win.click('#tab-rules'); await win.waitForTimeout(400)
await win.locator('#tag-rows .tag-row').first().click(); await win.waitForTimeout(300)
const before = await win.locator('#rule-panel img.thumb').count()
await win.click('#add-tile'); await win.waitForTimeout(300)
console.log('pick prompt:', await win.locator('#library-mode').textContent())
await win.locator('#library img').first().click(); await win.waitForTimeout(400)
const after = await win.locator('#rule-panel img.thumb').count()
console.log('member added:', after === before + 1 || after === before, { before, after })
console.log('pick mode cleared:', (await win.locator('#library-mode').textContent()) === '')
```

Run: `node debug-editor-ui.mjs`
Expected: `pick prompt: pick a tile for <tag> · esc to cancel`, then an empty prompt after the click. `after === before` is a valid pass when the clicked tile was already a member of that tag.

- [ ] **Step 5: Run the whole suite**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add tools/tile-editor/library.js tools/tile-editor/editor.js
git commit -m "feat(editor): pick a tile from the library to add it to a tag"
```

---

## Task 5: Build sidebar — four groups

**Files:**
- Modify: `tools/tile-editor/index.html:131-182` (`#paint-sidebar`)
- Modify: `tools/tile-editor/map-painter.js:236-245` (property-mode toggle)

- [ ] **Step 1: Restructure the Build sidebar markup**

Replace `tools/tile-editor/index.html` lines 131-182 (the whole `<div id="paint-sidebar" …>` block) with:

```html
    <div id="paint-sidebar" class="panel" style="width:240px; display:flex; flex-direction:column; overflow-y:auto">
      <div class="grp">Map</div>
      <div id="paint-map-picker" style="display:flex; gap:4px; align-items:center; flex-wrap:wrap"></div>
      <div class="row">
        <span class="rlab">size</span>
        <input id="paint-w" class="small" type="number" min="2" max="60" value="16" style="width:44px">
        <span>×</span>
        <input id="paint-h" class="small" type="number" min="2" max="40" value="12" style="width:44px">
        <button id="paint-resize">resize</button>
      </div>
      <div class="row" id="paint-history">
        <span class="rlab">history</span>
        <button id="paint-undo" style="flex:1" disabled>↶ undo</button>
        <button id="paint-redo" style="flex:1" disabled>↷ redo</button>
      </div>

      <div class="grp">Layer</div>
      <div id="paint-layers" style="display:flex; gap:4px">
        <button id="layer-base" class="on" style="flex:1">base</button>
        <button id="layer-overlay" style="flex:1">overlay</button>
        <button id="layer-properties" style="flex:1">props</button>
      </div>
      <div id="prop-controls" style="display:none">
        <div class="row" id="prop-mode" style="flex-wrap:wrap">
          <span class="rlab">mode</span>
          <button data-prop="collision" class="on">collision</button>
          <button data-prop="interaction">interact</button>
          <button data-prop="structure">structure</button>
        </div>
        <div class="row" id="prop-collision-vals">
          <span class="rlab">value</span>
          <button data-collision="walkable" class="on">walkable</button>
          <button data-collision="wall">wall</button>
        </div>
        <div class="row" id="prop-interaction-vals" style="display:none">
          <span class="rlab">value</span>
          <button data-interaction="door" class="on">door</button>
          <button data-interaction="chest">chest</button>
        </div>
        <div class="row">
          <span class="rlab">export</span>
          <input id="structure-name" placeholder="castle" style="flex:1; min-width:0">
          <input id="structure-depth" class="small" type="number" min="1" max="10"
                 style="width:44px" title="target depth (1-10)">
          <button id="export-structure" style="background:#664a22; color:#fff" title="Export structure">⛫</button>
        </div>
        <div id="export-report" style="font-size:11px; color:#9a9"></div>
      </div>

      <div class="grp">Rules</div>
      <div id="paint-tagging" class="row"></div>
      <button id="derive-btn" class="save" style="background:#2a4a66">⚙ Derive rules</button>
      <div id="derive-report" style="font-size:11px; color:#9a9"></div>

      <div class="grp">Preview</div>
      <canvas id="paint-preview" width="222" height="140"></canvas>
      <button id="paint-reroll" style="margin-top:4px">⟳ re-roll</button>
    </div>
```

`#prop-mode` keeps `flex-wrap` — three buttons plus a 52 px label do not fit across 240 px, so `structure` wraps onto a second line under the label. That is still one labelled row instead of a heading plus two rows. `#prop-collision` and `#prop-interaction` (the standalone label divs) are gone — the next step removes their JS references.

- [ ] **Step 2: Update the property-mode toggle**

In `tools/tile-editor/map-painter.js`, replace lines 236-245 (the `#prop-mode [data-prop]` listener) with:

```js
  document.querySelectorAll('#prop-mode [data-prop]').forEach(btn =>
    btn.addEventListener('click', () => {
      propMode = btn.dataset.prop
      document.querySelectorAll('#prop-mode [data-prop]').forEach(b => b.classList.toggle('on', b === btn))
      // The label now lives inside each value row, so only the rows toggle.
      document.getElementById('prop-collision-vals').style.display = propMode === 'collision' ? 'flex' : 'none'
      document.getElementById('prop-interaction-vals').style.display = propMode === 'interaction' ? 'flex' : 'none'
    }))
```

- [ ] **Step 3: Verify in the running editor**

Append to `debug-editor-ui.mjs` before `await app.close()`:

```js
await win.click('#tab-build'); await win.waitForTimeout(600)
console.log('build group headings:', await win.locator('#paint-sidebar .grp').allTextContents())
await win.click('#layer-properties'); await win.waitForTimeout(300)
console.log('collision row visible:', await win.locator('#prop-collision-vals').isVisible())
await win.click('#prop-mode [data-prop="interaction"]'); await win.waitForTimeout(300)
console.log('interaction row visible:', await win.locator('#prop-interaction-vals').isVisible())
console.log('collision row hidden:', !(await win.locator('#prop-collision-vals').isVisible()))
await win.click('#layer-base'); await win.waitForTimeout(200)
await win.screenshot({ path: 'debug-build.png' })
```

Run: `node debug-editor-ui.mjs`
Expected: `build group headings: [ 'Map', 'Layer', 'Rules', 'Preview' ]`, then `true`, `true`, `true`, and no page errors.

**Careful — two autosave triggers, not one.** Clicking the *paint canvas* autosaves into
`renderer/data/painter-maps.json` after a 400 ms debounce. So does **switching the header
ruleset dropdown**: `map-painter.js` `loadActiveMapFor()` seeds a `main` map from the
currently loaded grid and calls `saveStore()` for any ruleset with no painter-map entry yet
(`castle` has none, so selecting it writes a new key). The scripts in this plan touch
neither — but confirm with `git status --short renderer/data/` after every run, and
`git checkout -- renderer/data/` if it is dirty.

- [ ] **Step 4: Run the whole suite**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 5: Commit**

```bash
git status --short renderer/data/   # must be empty before committing
git add tools/tile-editor/index.html tools/tile-editor/map-painter.js
git commit -m "refactor(editor): four group headings in the Build sidebar

Size, history, property mode/value and structure export become inline rows;
eight heading lines become four."
```

---

## Task 6: Build brush status line + assign-mode click-through

**Files:**
- Modify: `tools/tile-editor/map-painter.js:411-451` (`ensureRuleset`, `renderTagging`), `:197` (call site)
- Modify: `tools/tile-editor/editor.js` (listen for `assign-tile`)

- [ ] **Step 1: Import the pure helper**

In `tools/tile-editor/map-painter.js`, add to the import block at the top (after the `structure-lib.js` import on line 17):

```js
import { brushStatus } from './tag-edit.js'
```

- [ ] **Step 2: Replace the tagging widget with a status line**

In `tools/tile-editor/map-painter.js`, delete `ensureRuleset()` (lines 411-418) and replace `renderTagging()` (lines 420-451) with:

```js
  // Read-only read-out of the active brush. Tag editing lives in the Rules tab;
  // clicking here hands this tile over to it, so retagging mid-paint is one
  // click out and one click back.
  function renderBrushStatus() {
    const rs = state.rulesets[state.active]
    const st = brushStatus(rs, active)
    // The markup still carries .label from before this migration: display:block
    // makes .rlab's flex basis inert, and text-transform:uppercase would render
    // TILE_0048 · CASTLE.FLOOR — the identifier case-folding .grp.ident exists
    // to prevent. Claim the element as a .row here.
    taggingEl.className = 'row'
    taggingEl.innerHTML = ''
    const lab = document.createElement('span')
    lab.className = 'rlab'
    lab.textContent = 'brush'
    const val = document.createElement('span')
    val.style.cssText = 'flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap'
    // `untagged` already means "there is a brush and it has no tag", so no
    // separate emptiness check is needed here.
    val.style.color = st.untagged ? '#d9a441' : '#9a9'
    val.textContent = st.text
    if (active) {
      val.style.cursor = 'pointer'
      val.title = 'open in Rules'
      val.addEventListener('click', () => {
        if (!rs) { toast('Create a ruleset first (+ new in the header).', 'error'); return }
        document.dispatchEvent(new CustomEvent('assign-tile', { detail: { tile: active, tag: st.tag } }))
      })
    }
    taggingEl.append(lab, val)
  }
```

- [ ] **Step 3: Update the call sites**

In `tools/tile-editor/map-painter.js`, inside `setActive()`, change the `renderTagging()` call on line 197 to `renderBrushStatus()`.

Then add these two lines directly above the `tilesReady.then(buildPalette)` call near the bottom of `initMapPainter`, so the status follows tag changes made in the Rules tab and ruleset switches:

```js
  document.addEventListener('rules-edited', renderBrushStatus)
  document.addEventListener('ruleset-changed', renderBrushStatus)
  renderBrushStatus()
```

- [ ] **Step 4: Switch to Rules when a brush is handed over**

In `tools/tile-editor/editor.js`, add directly beneath the `tabBuild.addEventListener` line (line 34):

```js
// The Build tab hands its brush to the Rules tab to be tagged.
document.addEventListener('assign-tile', () => showTab('rules'))
```

- [ ] **Step 5: Verify the round trip in the running editor**

Append to `debug-editor-ui.mjs` before `await app.close()`:

```js
await win.click('#tab-build'); await win.waitForTimeout(600)
console.log('no role select left in the sidebar:', await win.locator('#paint-tagging select').count() === 0)
console.log('brush status (no brush):', await win.locator('#paint-tagging').textContent())
await win.locator('#paint-palette img').first().click(); await win.waitForTimeout(400)
const status = await win.locator('#paint-tagging').textContent()
console.log('brush status (brush picked):', status)
await win.locator('#paint-tagging span').nth(1).click(); await win.waitForTimeout(600)
console.log('landed on Rules tab:', await win.locator('#rules-view').isVisible())
console.log('assign banner:', await win.locator('.assign-banner').count() === 1)
await win.locator('#tag-rows .tag-row').first().click(); await win.waitForTimeout(400)
console.log('assign banner cleared:', await win.locator('.assign-banner').count() === 0)
await win.screenshot({ path: 'debug-assign.png' })
```

Run: `node debug-editor-ui.mjs`
Expected: `no role select left in the sidebar: true`, a status like `brush tile_0048 · castle.floor →`, `landed on Rules tab: true`, `assign banner: true`, `assign banner cleared: true`.

- [ ] **Step 6: Confirm no painter data was written**

Run: `git status --short renderer/data/`
Expected: empty output. If `painter-maps.json` shows as modified, run `git checkout renderer/data/painter-maps.json` and remove whatever step clicked the paint canvas.

- [ ] **Step 7: Run the whole suite**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 8: Commit**

```bash
git add tools/tile-editor/map-painter.js tools/tile-editor/editor.js
git commit -m "refactor(editor): Build tab shows a brush status line, not a tagging widget

Four controls become one read-out. Clicking it hands the brush to the Rules
tab in assign mode, so tagging now lives in exactly one place."
```

---

## Task 7: Final verification pass

**Files:**
- Modify: `debug-editor-ui.mjs` (throwaway, gitignored by `debug*.mjs`)

- [ ] **Step 1: Confirm the untouched-files guarantee held**

Run:

```bash
git diff --stat HEAD~6 -- renderer/ test/decorate.test.js test/derive-rules.test.js \
  test/adjacency-view.test.js test/editor-lib.test.js test/painter-maps.test.js \
  tools/tile-editor/derive-rules.js
```

Expected: empty output. Any file listed here means the change exceeded the spec — stop and raise it.

- [ ] **Step 2: Run the whole suite one more time**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# fail 0`, 682 tests (655 pre-existing + 27 from Task 1).

- [ ] **Step 3: Screenshot all three tabs and check them by eye**

Run: `node debug-editor-ui.mjs`

Open `debug-draw.png`, `debug-rules.png`, `debug-build.png` and confirm against the spec:
- Draw: three group headings, previews side by side, no tags field, nothing below the fold.
- Rules: tag name / Member tiles / Learned from painting — three headings, no chips, no directional boxes, thumbnails on member rows.
- Build: Map / Layer / Rules / Preview — four headings, a one-line brush status, a single-line derive button.

- [ ] **Step 4: Confirm the editor logged no page errors**

The script prints `page errors:`. Expected: `[]`.

- [ ] **Step 5: Confirm no editor data was mutated**

Run: `git status --short renderer/data/ tools/tile-editor/`
Expected: empty output (all edits committed, no painter-maps or ruleset writes).

- [ ] **Step 6: Remove the throwaway script**

```bash
rm -f debug-editor-ui.mjs debug-draw.png debug-rules.png debug-build.png debug-assign.png
```

---

## Self-Review Notes

Checked against `docs/superpowers/specs/2026-08-16-editor-ui-simplification-design.md`:

- **Spec coverage.** Hard gate removal → Task 3. Explainer removal → Task 3 Step 1. Group headings + inline rows → Tasks 2, 3, 5. Member thumbnails and ✕ → Task 3. `+ add tile` / pick mode → Task 4. Draw tags field + save-tile → Task 2. Build four groups → Task 5. Brush status + assign mode → Task 6. `tag-edit.js` with all four exports → Task 1. `#export-report` / `#derive-report` kept → Task 5 markup. Esc cancels pick mode → Task 4 Step 1; Esc cancels assign mode → Task 3 Step 3. Tab switch cancels pick mode → Task 4 Step 2. "Create a ruleset first" guard → Task 6 Step 2. Move toast → Tasks 3 and 4.
- **Naming consistency.** `assignTileToTag(ruleset, tileName, tag, role)`, `removeTileFromTag(ruleset, tileName, tag)`, `memberTiles(ruleset, tag)`, `brushStatus(ruleset, tileName)`, `setPickMode(handler, prompt)`, `renderBrushStatus()`, event `assign-tile` with `{ tile, tag }` — used identically in every task that references them.
- **Ordering hazard handled.** `let library` is hoisted in Task 2 Step 4, before Task 4 Step 2 makes `showTab` reach for it; without that, `showTab('draw')` at module load hits the temporal dead zone.
- **Data hazard flagged** in Tasks 5 and 6: scripted clicks on the Build *canvas* autosave into `renderer/data/painter-maps.json`. The verification scripts only touch sidebar controls, and each task checks `git status renderer/data/`.
