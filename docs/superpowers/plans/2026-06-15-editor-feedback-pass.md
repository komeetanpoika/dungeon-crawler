# Editor Feedback Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every editor action consistent, non-modal feedback: a shared toast for confirmations and surfaced errors, a live `tile-name` validity hint that disables Save when unusable, and a Build-tab erase active-state.

**Architecture:** A new dependency-free `toast.js` renders transient messages. A pure `tileNameHint()` in `lib.js` drives the name hint + Save-disable. Existing `alert()` confirmations/errors in `editor.js` and `rules-ui.js` become toasts; console-only init failures gain error toasts. Destructive `confirm()` dialogs are unchanged.

**Tech Stack:** Vanilla ES modules, Electron renderer DOM, `node --test` + `node:assert/strict`, Playwright (`playwright-core` `_electron`) for DOM-flow verification.

**Spec:** `docs/superpowers/specs/2026-06-15-editor-feedback-pass-design.md`

---

## File Structure

- **Create** `tools/tile-editor/toast.js` — transient message helper (`toast(message, type)`).
- **Create** `test/tile-name-hint.test.js` — unit tests for `tileNameHint`.
- **Modify** `tools/tile-editor/lib.js` — add pure `tileNameHint(raw)`.
- **Modify** `tools/tile-editor/index.html` — `#tile-name-hint` element + `button:disabled` style.
- **Modify** `tools/tile-editor/editor.js` — toast import, init error toasts, name hint + Save-disable, Save tile / Save rules toasts.
- **Modify** `tools/tile-editor/map-painter.js` — toast import, load-error toasts, erase active-state.
- **Modify** `tools/tile-editor/rules-ui.js` — add-tag guard toast.

---

## Task 1: Pure `tileNameHint` helper

**Files:**
- Modify: `tools/tile-editor/lib.js`
- Test: `test/tile-name-hint.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/tile-name-hint.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tileNameHint } from '../tools/tile-editor/lib.js'

describe('tileNameHint', () => {
  it('is invalid with a warning for empty/whitespace input', () => {
    assert.deepEqual(tileNameHint(''), { valid: false, text: '⚠ enter a tile name' })
    assert.deepEqual(tileNameHint('   '), { valid: false, text: '⚠ enter a tile name' })
    assert.deepEqual(tileNameHint('!!!'), { valid: false, text: '⚠ enter a tile name' })
  })

  it('is valid and shows the sanitized save name', () => {
    assert.deepEqual(tileNameHint('Moss Floor'),
      { valid: true, text: 'saves as: custom_moss_floor.png' })
  })

  it('does not double-prefix an already custom_ name', () => {
    assert.deepEqual(tileNameHint('custom_brick'),
      { valid: true, text: 'saves as: custom_brick.png' })
  })
})
```

- [ ] **Step 2: Run it and confirm it FAILS**

Run: `npm test -- test/tile-name-hint.test.js`
Expected: FAIL — `tileNameHint` is not exported.

- [ ] **Step 3: Implement**

In `tools/tile-editor/lib.js`, immediately after the `sanitizeTileName` function (after its closing `}` on the line `  return \`custom_${cleaned.replace(/^custom_/, '')}\``... `}`), add:

```js
// Live hint for the tile-name input: what it will save as, or why it can't.
export function tileNameHint(raw) {
  const name = sanitizeTileName(raw)
  return name
    ? { valid: true, text: `saves as: ${name}.png` }
    : { valid: false, text: '⚠ enter a tile name' }
}
```

- [ ] **Step 4: Run it and confirm it PASSES**

Run: `npm test -- test/tile-name-hint.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/tile-editor/lib.js test/tile-name-hint.test.js
git commit -m "feat(tile-editor): tileNameHint pure helper (#5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Toast module

**Files:**
- Create: `tools/tile-editor/toast.js`

No unit test — this is DOM glue with no jsdom available; it is exercised by the Playwright check in Task 6.

- [ ] **Step 1: Create `tools/tile-editor/toast.js`**

```js
// Transient, non-modal status messages for the editor. No deps, no imports.
// toast(message, type) where type is 'ok' | 'error' | 'info'.
let container = null

function ensure() {
  if (container) return container
  const style = document.createElement('style')
  style.textContent = `
    #editor-toasts { position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
      display: flex; flex-direction: column; gap: 6px; align-items: center;
      z-index: 1000; pointer-events: none; }
    #editor-toasts .toast { pointer-events: auto; cursor: pointer; max-width: 70vw;
      padding: 6px 14px; border-radius: 4px; font: 13px/1.4 monospace; color: #fff;
      box-shadow: 0 2px 8px #0008; opacity: 0; transition: opacity .2s; }
    #editor-toasts .toast.show { opacity: 1; }
    #editor-toasts .toast.ok { background: #226633; }
    #editor-toasts .toast.error { background: #aa3333; }
    #editor-toasts .toast.info { background: #33415a; }`
  document.head.appendChild(style)
  container = document.createElement('div')
  container.id = 'editor-toasts'
  document.body.appendChild(container)
  return container
}

export function toast(message, type = 'ok') {
  const el = document.createElement('div')
  el.className = `toast ${type}`
  el.textContent = message
  let removed = false
  const dismiss = () => {
    if (removed) return
    removed = true
    el.classList.remove('show')
    setTimeout(() => el.remove(), 250)
  }
  el.addEventListener('click', dismiss)
  ensure().appendChild(el)
  requestAnimationFrame(() => el.classList.add('show'))
  setTimeout(dismiss, type === 'error' ? 5000 : 2600)
  return el
}
```

- [ ] **Step 2: Sanity-check it parses (no runtime errors on import)**

Run: `node --check tools/tile-editor/toast.js`
Expected: no output (valid syntax). (Full behavior is verified in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add tools/tile-editor/toast.js
git commit -m "feat(tile-editor): non-modal toast helper (#5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Draw-tab feedback wiring (`index.html` + `editor.js`)

**Files:**
- Modify: `tools/tile-editor/index.html`
- Modify: `tools/tile-editor/editor.js`

### index.html

- [ ] **Step 1: Add the hint element under the tile-name input**

Find (in `#sidebar`):
```html
      <div class="label">Tile name (saved as custom_&lt;name&gt;)</div>
      <input id="tile-name" placeholder="moss_floor_1" style="width:100%">
```
Replace with:
```html
      <div class="label">Tile name (saved as custom_&lt;name&gt;)</div>
      <input id="tile-name" placeholder="moss_floor_1" style="width:100%">
      <div id="tile-name-hint" style="font-size:11px; min-height:14px; color:#888"></div>
```

- [ ] **Step 2: Add a disabled-button style**

Find the existing button style rule:
```css
  button.on { background: #254438; color: #7fd; }
```
Add immediately after it:
```css
  button:disabled { opacity: 0.45; cursor: not-allowed; }
```

### editor.js

- [ ] **Step 3: Update imports**

Find:
```js
import { sanitizeTileName } from './lib.js'
```
Replace with:
```js
import { sanitizeTileName, tileNameHint } from './lib.js'
```

Find:
```js
import { initMapPainter } from './map-painter.js'
```
Add immediately after it:
```js
import { toast } from './toast.js'
```

- [ ] **Step 4: Add the tile-name hint + Save-disable wiring**

Find:
```js
renderPreviews()
```
Add immediately after it:
```js

// Live validity hint for the tile name; Save tile stays disabled until usable.
const tileNameInput = document.getElementById('tile-name')
const tileNameHintEl = document.getElementById('tile-name-hint')
function updateTileNameHint() {
  const { valid, text } = tileNameHint(tileNameInput.value)
  tileNameHintEl.textContent = text
  tileNameHintEl.style.color = valid ? '#7a7' : '#c66'
  saveTileBtn.disabled = !valid
}
tileNameInput.addEventListener('input', updateTileNameHint)
updateTileNameHint()
```

- [ ] **Step 5: Refresh the hint after a library tile clears the name**

Find:
```js
      const data = tileImageData.get(name)
      if (data) pixelEditor.loadImageData(data)
      // Force a conscious new name — originals are never overwritten.
      document.getElementById('tile-name').value = ''
```
Replace with:
```js
      const data = tileImageData.get(name)
      if (data) pixelEditor.loadImageData(data)
      // Force a conscious new name — originals are never overwritten.
      tileNameInput.value = ''
      updateTileNameHint()
```

- [ ] **Step 6: Surface palette-load failure as a toast**

Find:
```js
tilesReady.catch(err => console.error('[tile-editor] palette load failed:', err))
```
Replace with:
```js
tilesReady.catch(err => {
  console.error('[tile-editor] palette load failed:', err)
  toast('Could not load tiles: ' + err.message, 'error')
})
```

- [ ] **Step 7: Surface ruleset-load failure as a toast**

Find:
```js
async function initRulesets() {
  state.rulesets = (await window.editorAPI.loadRulesets()) ?? {}
  state.active = Object.keys(state.rulesets)[0] ?? null
  renderRulesetSelect()
  document.dispatchEvent(new Event('ruleset-changed'))
}
```
Replace with:
```js
async function initRulesets() {
  try {
    state.rulesets = (await window.editorAPI.loadRulesets()) ?? {}
  } catch (err) {
    console.error('[tile-editor] ruleset load failed:', err)
    toast('Could not load rulesets: ' + err.message, 'error')
    state.rulesets = {}
  }
  state.active = Object.keys(state.rulesets)[0] ?? null
  renderRulesetSelect()
  document.dispatchEvent(new Event('ruleset-changed'))
}
```

- [ ] **Step 8: Replace the Save-tile alerts (and drop the empty-name alert)**

Find:
```js
  const name = sanitizeTileName(document.getElementById('tile-name').value)
  if (!name) { alert('Enter a tile name first.'); return }
```
Replace with:
```js
  const name = sanitizeTileName(tileNameInput.value)
  if (!name) return   // Save is disabled while the name is invalid
```

Find:
```js
      alert(`${where}, and registered in ruleset '${state.active}'.`)
    } else {
      alert(`${where}. (No tags or no active ruleset, so it wasn't registered in a ruleset.)`)
    }
  } catch (err) {
    alert(`Save failed: ${err.message}`)
  }
```
Replace with:
```js
      toast(`${where}, and registered in ruleset '${state.active}'.`, 'ok')
    } else {
      toast(`${where}. (No tags / no active ruleset — not registered in a ruleset.)`, 'ok')
    }
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error')
  }
```

- [ ] **Step 9: Replace the Save-rules alerts**

Find:
```js
    await window.editorAPI.saveRulesets(state.rulesets)
    alert('Rules saved to renderer/data/rulesets.json')
  } catch (err) {
    alert(`Save failed: ${err.message}`)
  }
```
Replace with:
```js
    await window.editorAPI.saveRulesets(state.rulesets)
    toast('Rules saved to renderer/data/rulesets.json', 'ok')
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error')
  }
```

- [ ] **Step 10: Run the unit suite (no regressions)**

Run: `npm test`
Expected: PASS — all tests green (Task 1's hint tests included).

- [ ] **Step 11: Commit**

```bash
git add tools/tile-editor/index.html tools/tile-editor/editor.js
git commit -m "feat(tile-editor): toasts + tile-name hint/Save-disable (#5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Map-painter load-error toasts + erase active-state

**Files:**
- Modify: `tools/tile-editor/map-painter.js`

- [ ] **Step 1: Import toast**

Find:
```js
import { textPrompt } from './text-prompt.js'
```
Add immediately after it:
```js
import { toast } from './toast.js'
```

- [ ] **Step 2: Add an erase-button reference**

Find:
```js
  let active = null          // active brush tile name; null = eraser
```
Add immediately after it:
```js
  let eraseBtn = null        // the ✖ erase palette button (for active styling)
```

- [ ] **Step 3: Highlight erase when it is the active brush**

Find:
```js
  function markActive(name) {
    paletteEl.querySelectorAll('img').forEach(i => i.classList.toggle('active', i.dataset.name === name))
  }
```
Replace with:
```js
  function markActive(name) {
    paletteEl.querySelectorAll('img').forEach(i => i.classList.toggle('active', i.dataset.name === name))
    if (eraseBtn) eraseBtn.classList.toggle('active', name == null)
  }
```

- [ ] **Step 4: Capture the erase button and show its initial active state**

Find:
```js
  async function buildPalette(names) {
    paletteEl.innerHTML = ''
    const erase = document.createElement('button')
    erase.className = 'erase'
    erase.textContent = '✖ erase'
    erase.addEventListener('click', () => setActive(null))
    paletteEl.appendChild(erase)
    for (const name of names) await addPaletteTile(name)
  }
```
Replace with:
```js
  async function buildPalette(names) {
    paletteEl.innerHTML = ''
    eraseBtn = document.createElement('button')
    eraseBtn.className = 'erase'
    eraseBtn.textContent = '✖ erase'
    eraseBtn.addEventListener('click', () => setActive(null))
    paletteEl.appendChild(eraseBtn)
    for (const name of names) await addPaletteTile(name)
    markActive(active)   // reflect the current brush (null = erase) after a rebuild
  }
```

- [ ] **Step 5: Toast the palette-load failure**

Find:
```js
  tilesReady.then(buildPalette).catch(err => console.error('[map-painter] palette load failed:', err))
```
Replace with:
```js
  tilesReady.then(buildPalette).catch(err => {
    console.error('[map-painter] palette load failed:', err)
    toast('Could not load Build palette: ' + err.message, 'error')
  })
```

- [ ] **Step 6: Toast the painter-maps load failure**

Find:
```js
    } catch (err) {
      console.error('[map-painter] painter-maps load failed:', err)
      store = {}
    }
```
Replace with:
```js
    } catch (err) {
      console.error('[map-painter] painter-maps load failed:', err)
      toast('Could not load saved maps: ' + err.message, 'error')
      store = {}
    }
```

- [ ] **Step 7: Run the unit suite (no regressions)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tools/tile-editor/map-painter.js
git commit -m "feat(tile-editor): erase active-state + load-error toasts (#5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Rules-tab add-tag guard toast

**Files:**
- Modify: `tools/tile-editor/rules-ui.js`

- [ ] **Step 1: Import toast**

Find:
```js
import { textPrompt } from './text-prompt.js'
```
Replace with:
```js
import { textPrompt } from './text-prompt.js'
import { toast } from './toast.js'
```

- [ ] **Step 2: Replace the add-tag guard alert**

Find:
```js
    const rs = activeRs()
    if (!rs) { alert('Create a ruleset first (+ new in the header).'); return }
```
Replace with:
```js
    const rs = activeRs()
    if (!rs) { toast('Create a ruleset first (+ new in the header).', 'error'); return }
```

- [ ] **Step 3: Run the unit suite (no regressions)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tools/tile-editor/rules-ui.js
git commit -m "feat(tile-editor): toast the add-tag no-ruleset guard (#5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: DOM-flow verification (Playwright)

**Files:**
- Create (throwaway, not committed): `verify-feedback.mjs`

- [ ] **Step 1: Write the verification script**

Create `verify-feedback.mjs` at the repo root:

```js
import { _electron as electron } from 'playwright-core'

const app = await electron.launch({ args: ['.', '--editor'] })
const page = await app.firstWindow()
const pageErrors = []
page.on('pageerror', e => pageErrors.push(e.message))
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1500)
const $ = (s) => page.locator(s)
const results = {}

// tile-name hint + Save-disable
results.saveDisabledEmpty = await $('#save-tile').isDisabled()
results.hintEmpty = await $('#tile-name-hint').textContent()
await $('#tile-name').fill('Moss Floor')
await page.waitForTimeout(100)
results.saveDisabledNamed = await $('#save-tile').isDisabled()
results.hintNamed = await $('#tile-name-hint').textContent()

// Save tile → ok toast
await $('#save-tile').click()
await page.waitForTimeout(400)
results.toastAfterSave = await $('#editor-toasts .toast.ok').count()
results.toastTextAfterSave = await $('#editor-toasts .toast').first().textContent().catch(() => '')

// Build-tab erase active-state
await $('#tab-build').click()
await page.waitForTimeout(300)
const firstTile = $('#paint-palette img').first()
await firstTile.click()                       // select a tile → erase NOT active
await page.waitForTimeout(100)
results.eraseActiveWhenTile = await $('#paint-palette .erase').evaluate(e => e.classList.contains('active'))
await $('#paint-palette .erase').click()       // select erase → active
await page.waitForTimeout(100)
results.eraseActiveWhenErase = await $('#paint-palette .erase').evaluate(e => e.classList.contains('active'))

await app.close()

// clean up the tile this script saved + its ruleset mutation
import { execSync } from 'node:child_process'
execSync('rm -f renderer/assets/tiles/custom_moss_floor.png')
execSync('git checkout -- renderer/data/rulesets.json 2>/dev/null || true')

console.log(JSON.stringify(results, null, 2))
console.log('pageErrors:', pageErrors.length ? pageErrors.join('\n') : '(none)')
```

- [ ] **Step 2: Run the verification**

Run: `timeout 90 node verify-feedback.mjs`
Expected:
- `saveDisabledEmpty`: `true`, `hintEmpty`: `"⚠ enter a tile name"`
- `saveDisabledNamed`: `false`, `hintNamed`: `"saves as: custom_moss_floor.png"`
- `toastAfterSave`: ≥ 1, `toastTextAfterSave` mentions `Saved to renderer/assets/tiles/custom_moss_floor.png`
- `eraseActiveWhenTile`: `false`, `eraseActiveWhenErase`: `true`
- `pageErrors`: `(none)`

- [ ] **Step 3: Confirm no stray side effects, then remove the script**

Run: `git status --short` (confirm no `custom_moss_floor.png`, no `rulesets.json` change), then `rm verify-feedback.mjs`.
Expected: working tree clean apart from the committed source changes.

---

## Self-Review

**Spec coverage:**
- Toast module (lazy container, color-coded, auto-dismiss, click-dismiss, error lingers) → Task 2. ✅
- Surface init/IO errors (palette, rulesets, painter-maps) → Task 3 Steps 6–7, Task 4 Steps 5–6. ✅
- Save tile success/failure toasts; empty-name → Save disabled (no alert) → Task 3 Steps 4, 8. ✅
- Save rules toasts → Task 3 Step 9. ✅
- Add-tag guard toast → Task 5. ✅
- `tile-name` live hint + `#tile-name-hint` element → Task 1 (`tileNameHint`), Task 3 Steps 1, 4, 5. ✅
- Build erase active-state → Task 4 Steps 2–4. ✅
- `confirm()` for overwrite/delete unchanged → not touched by any task. ✅
- Testing: unit `tileNameHint` + Playwright DOM flow → Task 1, Task 6. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full before/after. ✅

**Type consistency:** `tileNameHint(raw)` returns `{ valid, text }` — defined in Task 1, consumed identically in Task 3 Step 4. `toast(message, type)` signature is identical across editor.js, map-painter.js, rules-ui.js. `eraseBtn` declared in Task 4 Step 2, used in Steps 3–4. ✅
