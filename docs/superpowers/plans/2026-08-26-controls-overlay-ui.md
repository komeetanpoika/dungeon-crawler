# Controls-Driven Menus & Overlay UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Touch controls stay above every overlay and drive the menus; the HUD bars are replaced by floating 8-bit hearts, a blue pixel stamina bar, and a sprite-icon consumable slot; emoji item art becomes atlas-sprite icons in HUD and backpack; log-bar messages are re-routed into toast/bubble/sound tiers.

**Architecture:** Menus learn the controls' existing synthetic keys (`w`/`s`/Space) instead of the touch layer learning menus. A new pure `render/icons.js` maps inventory items to the sprite atlas's own PNG files (CSS `image-rendering: pixelated` upscales — simpler than the spec's data-URI mechanism, identical 8-bit result). Feedback gains a DOM-free toast queue that game.js drains into a pausing `ui/toast.js` panel; first-time gating persists in meta.

**Tech Stack:** Vanilla JS ES modules, `node:test`, playwright-core for live checks.

**Spec:** `docs/superpowers/specs/2026-08-26-controls-overlay-ui-design.md`

## Global Constraints

- Controls mapping: stick `w`/`s` = menu up/down; Space (red) = confirm/primary; Escape (Start) = back/close. Desktop keys are additive — arrows/Enter/Escape keep working.
- z-order: `#touch-controls` 15; `#hud-overlay` 4 (pointer-events: none); menu 10, inventory/sign/toast overlays 9; rotate 20 stays top.
- Stamina bar: fill `#7dd3fc` (blue), refusal flash `#f87171`, pixel frame with ticks at 25/50/75%.
- Toast events (pausing, dismiss Space/Enter/Escape/tap): first kill per boss type, first opening per overworld gate, waking after death, talent learned. First-time sets persist in meta as `bossToastsSeen`/`gateToastsSeen` (string arrays).
- Icon fallbacks: unknown melee weaponType → `weapon_sword`; unknown ranged → `weapon_shortbow`; non-item → null (callers fall back to `item.emoji` text).
- `#hud-consumable` keeps its id and keeps publishing `data-quick-emoji` (the touch layer's observer contract).
- `state.log` keeps accumulating (tests read it); it just has no on-screen strip.
- Tests: `node --test test/<file>`; full suite `npm test`. `test/map.test.js` "procedural item placement…" is a known RNG flake — re-run before concluding.
- Commit after every green task.

---

### Task 1: Icon mapping module

**Files:**
- Create: `renderer/render/icons.js`
- Test: `test/icons.test.js`

**Interfaces:**
- Consumes: `SPRITES` from `renderer/render/sprites.js` (exported name→file map; e.g. `weapon_dagger: 'tile_0103'`, `potion: 'tile_0116'`).
- Produces: `iconSpriteFor(item) -> string|null` (sprite key) and `iconSrcFor(item) -> string|null` (`./assets/tiles/<file>.png`).

- [ ] **Step 1: Write the failing tests**

```js
// test/icons.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { iconSpriteFor, iconSrcFor } from '../renderer/render/icons.js'
import { SPRITES } from '../renderer/render/sprites.js'

describe('iconSpriteFor', () => {
  it('maps consumables by kind', () => {
    assert.equal(iconSpriteFor({ kind: 'potion' }), 'potion')
    assert.equal(iconSpriteFor({ kind: 'mushroom' }), 'ow_mushroom')
  })
  it('maps weapons by payload weaponType', () => {
    assert.equal(iconSpriteFor({ kind: 'weapon', payload: { weaponType: 'axe' } }), 'weapon_axe')
    assert.equal(iconSpriteFor({ kind: 'ranged', payload: { weaponType: 'longbow' } }), 'weapon_longbow')
  })
  it('falls back to sword/shortbow for unknown weapon types', () => {
    assert.equal(iconSpriteFor({ kind: 'weapon', payload: { weaponType: 'nonsense' } }), 'weapon_sword')
    assert.equal(iconSpriteFor({ kind: 'ranged', payload: {} }), 'weapon_shortbow')
  })
  it('returns null for unknown kinds and missing items', () => {
    assert.equal(iconSpriteFor({ kind: 'key' }), null)
    assert.equal(iconSpriteFor(null), null)
  })
  it('every mappable sprite key resolves to a file in the atlas or itself', () => {
    for (const key of ['weapon_dagger', 'weapon_sword', 'weapon_longsword', 'weapon_axe',
      'weapon_club', 'weapon_maunonmiekka', 'weapon_shortbow', 'weapon_longbow',
      'weapon_sparkwand', 'weapon_stormwand', 'potion']) {
      assert.ok(SPRITES[key], `SPRITES lacks ${key}`)
    }
  })
})

describe('iconSrcFor', () => {
  it('builds the tile path through the SPRITES file map', () => {
    assert.equal(iconSrcFor({ kind: 'potion' }), `./assets/tiles/${SPRITES.potion}.png`)
  })
  it('uses the key itself when SPRITES has no entry (file-named sprites)', () => {
    const src = iconSrcFor({ kind: 'mushroom' })
    assert.ok(src === `./assets/tiles/${SPRITES.ow_mushroom ?? 'ow_mushroom'}.png`)
  })
  it('returns null when there is no icon', () => {
    assert.equal(iconSrcFor({ kind: 'key' }), null)
  })
})
```

- [ ] **Step 2: Run** `node --test test/icons.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// renderer/render/icons.js
// 8-bit item icons for DOM surfaces (HUD consumable slot, backpack panel).
// Reuses the game's own sprite atlas: an icon is just the sprite's PNG,
// upscaled crisply by CSS image-rendering: pixelated — the pack shows the
// same art the world does.
import { SPRITES } from './sprites.js'

const KIND_ICONS = { potion: 'potion', mushroom: 'ow_mushroom' }

export function iconSpriteFor(item) {
  if (!item) return null
  if (KIND_ICONS[item.kind]) return KIND_ICONS[item.kind]
  if (item.kind === 'weapon' || item.kind === 'ranged') {
    const key = `weapon_${item.payload?.weaponType}`
    if (SPRITES[key]) return key
    return item.kind === 'weapon' ? 'weapon_sword' : 'weapon_shortbow'
  }
  return null
}

export function iconSrcFor(item) {
  const key = iconSpriteFor(item)
  return key ? `./assets/tiles/${SPRITES[key] ?? key}.png` : null
}
```

If `ow_mushroom` is absent from `SPRITES` (it may be loaded via `extraNames`), the `SPRITES[key] ?? key` fallback resolves it to `ow_mushroom.png`, which exists on disk (the canvas renderer draws it) — verify with `ls renderer/assets/tiles/ow_mushroom.png` and note the result in your report.

- [ ] **Step 4: Run** `node --test test/icons.test.js` — Expected: pass.
- [ ] **Step 5: Commit** — `git add renderer/render/icons.js test/icons.test.js && git commit -m "feat(game): 8-bit item icons from the sprite atlas"`

---

### Task 2: Controls above overlays + menus driven by controls

**Files:**
- Modify: `renderer/index.html` (z-index), `renderer/ui/menu.js`, `renderer/ui/inventory-panel.js`, `renderer/ui/sign-panel.js`, `renderer/game.js` (Space swallow on overlay close)
- Test: `test/menu.test.js` (append)

**Interfaces:**
- Produces: `navActionFor(key) -> 'up'|'down'|'confirm'|null` exported from `menu.js` (pure, tested); menus/panels accepting `w`/`s`(/`a`/`d`) and Space.

- [ ] **Step 1: Write the failing tests** (append to `test/menu.test.js`)

```js
import { navActionFor } from '../renderer/ui/menu.js'   // extend the existing import line

describe('navActionFor', () => {
  it('maps arrows and stick keys to menu movement', () => {
    assert.equal(navActionFor('ArrowDown'), 'down')
    assert.equal(navActionFor('s'), 'down')
    assert.equal(navActionFor('ArrowUp'), 'up')
    assert.equal(navActionFor('w'), 'up')
  })
  it('maps Enter and Space (the red button) to confirm', () => {
    assert.equal(navActionFor('Enter'), 'confirm')
    assert.equal(navActionFor(' '), 'confirm')
  })
  it('leaves other keys to the cheat buffer', () => {
    assert.equal(navActionFor('m'), null)
    assert.equal(navActionFor('Escape'), null)
  })
})
```

- [ ] **Step 2: Run** `node --test test/menu.test.js` — Expected: FAIL (no export).

- [ ] **Step 3: Implement menu.js.** Add the pure map and rewrite the key handler to use it. Space must NOT fall through to the cheat buffer (`' '.length === 1`):

```js
// Menu navigation accepts the touch controls' synthetic keys alongside the
// desktop ones: stick w/s move, Space (the red button) confirms.
const NAV_ACTIONS = { ArrowDown: 'down', s: 'down', ArrowUp: 'up', w: 'up', Enter: 'confirm', ' ': 'confirm' }
export const navActionFor = key => NAV_ACTIONS[key] ?? null
```

In `renderScreen`'s `keyHandler`, replace the if/else chain's navigation part:

```js
  keyHandler = (e) => {
    const action = navActionFor(e.key)
    if (action === 'down') {
      selectedIndex = (selectedIndex + 1) % buttons.length; highlight(); e.preventDefault()
    } else if (action === 'up') {
      selectedIndex = (selectedIndex - 1 + buttons.length) % buttons.length; highlight(); e.preventDefault()
    } else if (action === 'confirm') {
      buttons[selectedIndex].onSelect(); e.preventDefault()
    } else if (onCheat && e.key.length === 1) {
      cheatBuffer = (cheatBuffer + e.key).toLowerCase().slice(-12)
      const depth = parseLevelCheat(cheatBuffer)
      if (depth !== null) { cheatBuffer = ''; onCheat(depth) } // depth 0 (boss arena) is valid but falsy
    }
  }
```

Note: `w`/`s` now navigate instead of feeding the cheat buffer. Check `renderer/systems/cheats.js` cheat strings (`level0`–`level9`, `mauno`, etc.): none contain `w` or `s` — verify with a grep and say so in your report; if one does, route nav keys to the cheat buffer as well as navigation.

- [ ] **Step 4: inventory-panel.js.** In its `keyHandler` (currently ArrowRight/Left/Down/Up, Enter, x): treat `d` as ArrowRight, `a` as ArrowLeft, `s` as ArrowDown, `w` as ArrowUp (normalize at the top: `const key = ({ d: 'ArrowRight', a: 'ArrowLeft', s: 'ArrowDown', w: 'ArrowUp' })[e.key] ?? e.key`), and let `' '` trigger the same path as `'Enter'` (primary action). Keep `x` = drop.

- [ ] **Step 5: sign-panel.js.** Extend the accepted-keys check to include `' '`:
`if (e.key !== 'f' && e.key !== 'F' && e.key !== ' ' && e.key !== 'Escape' && e.key !== 'Enter') return`

- [ ] **Step 6: game.js Space swallow.** A Space that confirmed a menu still sets `keys[' ']` via the global tracker (game.js:68), which would swing on the resume frame. Precedent: `closeSign` swallows `f` (game.js:~448). Add `keys[' '] = false` in: `resumeGame()`, `closeInventory()`, `closeSign()`, and wherever the title/game-over menu starts a run (the function that hides the menu and enters PLAYING — find it via `hide()` call sites). One line each, commented once at the first site: `// swallow the confirming Space so update() can't read it as an attack`.

- [ ] **Step 7: z-index.** In index.html CSS add `#touch-controls { position: relative; z-index: 15; }` — nested fixed children already stack by it. Confirm rotate-overlay stays 20.

- [ ] **Step 8: Run** `node --test test/menu.test.js` then `npm test` — Expected: green.
- [ ] **Step 9: Commit** — `git add renderer/index.html renderer/ui/menu.js renderer/ui/inventory-panel.js renderer/ui/sign-panel.js renderer/game.js test/menu.test.js && git commit -m "feat(game): controls stay on top and drive the menus — stick navigates, red confirms, start backs out"`

---

### Task 3: Overlay HUD (bars gone, hearts + blue bar + icon slot)

**Files:**
- Modify: `renderer/index.html`, `renderer/render/hud.js`
- Test: `test/hud.test.js` (update)

**Interfaces:**
- Consumes: `iconSrcFor` (Task 1), `findQuickUseIndex`/`quickUseSummary` from `systems/inventory.js`.
- Produces: element ids `hud-overlay`, `hud-hearts`, `hud-stamina`, `hud-stamina-fill`, `hud-consumable` (id and `data-quick-emoji` contract preserved). `hud-level`, `hud-log`, `hud-weapon-slot` are gone; `updateHUD(state)` signature unchanged.

- [ ] **Step 1: Update test/hud.test.js (failing first).** Delete the weapon-slot describe. Keep hearts describes as-is. Replace the consumable describe's textContent assertions and add an icon assertion; keep the stamina describes:

```js
describe('updateHUD consumable slot', () => {
  it('shows the next-up item icon with count and publishes the badge attribute', () => {
    const nodes = fakeDom()
    updateHUD(state({ inventory: [{ kind: 'potion', emoji: '🧪', stackable: true, count: 3 }] }))
    assert.match(nodes['hud-consumable'].innerHTML, /assets\/tiles\/.*\.png/)
    assert.match(nodes['hud-consumable'].innerHTML, /×3/)
    assert.equal(nodes['hud-consumable'].dataset.quickEmoji, '🧪')
  })
  it('empty sack renders empty and clears the badge', () => {
    const nodes = fakeDom()
    updateHUD(state())
    assert.equal(nodes['hud-consumable'].innerHTML, '')
    assert.equal(nodes['hud-consumable'].dataset.quickEmoji, '')
  })
})
```

Also delete any assertion touching `hud-log`, `hud-level`, or `hud-weapon-slot`.

- [ ] **Step 2: Run** `node --test test/hud.test.js` — Expected: FAIL.

- [ ] **Step 3: hud.js.** Remove the weapon-slot text, `hud-level`, and `hud-log` updates; consumable becomes icon markup:

```js
import { quickUseSummary, findQuickUseIndex } from '../systems/inventory.js'
import { iconSrcFor } from './icons.js'
```

```js
  const quick = quickUseSummary(player.inventory)
  const consumableEl = el('hud-consumable')
  if (quick) {
    const item = player.inventory[findQuickUseIndex(player.inventory)]
    const src = iconSrcFor(item)
    consumableEl.innerHTML = (src ? `<img class="hud-icon" src="${src}" alt="">` : item.emoji)
      + `<span class="hud-count">×${quick.count}</span>`
  } else consumableEl.innerHTML = ''
  consumableEl.dataset.quickEmoji = quick?.emoji ?? ''
```

Hearts and stamina logic stay exactly as they are.

- [ ] **Step 4: Run** `node --test test/hud.test.js` — Expected: pass.

- [ ] **Step 5: index.html.** Remove the `#hud-top` and `#hud-log` divs and their CSS (`body` becomes just the canvas: keep `display:flex` or simplify — `#canvas-wrap { position: fixed; inset: 0; }` is fine). Add before `#touch-controls`:

```html
  <div id="hud-overlay">
    <div id="hud-status">
      <span id="hud-hearts"></span>
      <span id="hud-stamina"><span id="hud-stamina-fill"></span></span>
    </div>
    <div id="hud-consumable"></div>
  </div>
```

CSS (replacing the old `#hud-top`/`#hud-stamina` rules):

```css
    #hud-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 4; }
    #hud-status {
      position: absolute;
      left: max(12px, env(safe-area-inset-left));
      top: max(10px, env(safe-area-inset-top));
      display: flex; flex-direction: column; gap: 6px;
    }
    #hud-hearts { display: flex; gap: 3px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.9)); }
    #hud-hearts .heart { image-rendering: pixelated; }
    /* Blue pixel-framed stamina bar: stepped 8-bit border + 25% ticks */
    #hud-stamina {
      width: 140px; height: 12px; position: relative;
      background: rgba(13,13,16,0.75);
      border: 2px solid #2a2a36; outline: 2px solid rgba(13,13,16,0.9);
      box-shadow: 0 1px 2px rgba(0,0,0,0.8);
    }
    #hud-stamina-fill {
      display: block; height: 100%; width: 100%;
      background: #7dd3fc; transition: width 0.1s linear;
    }
    #hud-stamina::after {
      content: ''; position: absolute; inset: 0; pointer-events: none;
      background:
        linear-gradient(#2a2a36, #2a2a36) 25% 0 / 2px 100%,
        linear-gradient(#2a2a36, #2a2a36) 50% 0 / 2px 100%,
        linear-gradient(#2a2a36, #2a2a36) 75% 0 / 2px 100%;
      background-repeat: no-repeat;
    }
    #hud-stamina[data-refused="1"] { border-color: #f87171; }
    #hud-stamina[data-refused="1"] #hud-stamina-fill { background: #f87171; }
    #hud-consumable {
      position: absolute;
      right: max(14px, env(safe-area-inset-right));
      top: max(10px, env(safe-area-inset-top));
      display: flex; align-items: flex-end; gap: 2px;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.9));
    }
    .hud-icon { width: 48px; height: 48px; image-rendering: pixelated; }
    .hud-count { font-size: 13px; color: #ccc; font-family: monospace; }
```

- [ ] **Step 6: Run** `npm test` (menu/canvas tests must not reference removed ids — fix any fixture that does, keeping test intent).
- [ ] **Step 7: Commit** — `git add renderer/index.html renderer/render/hud.js test/hud.test.js && git commit -m "feat(game): HUD floats over the game — hearts, blue pixel stamina bar, icon consumable; bars removed"`

---

### Task 4: Backpack pixel icons

**Files:**
- Modify: `renderer/ui/inventory-panel.js`, `renderer/index.html` (one CSS rule)

**Interfaces:**
- Consumes: `iconSrcFor` (Task 1).

- [ ] **Step 1: Slots.** In the slot render (currently `slot.textContent = item.emoji`):

```js
      const src = iconSrcFor(item)
      if (src) slot.innerHTML = `<img class="inv-icon" src="${src}" alt="${item.name}">`
      else slot.textContent = item.emoji
```

(then the existing count-badge append stays — note it uses `appendChild`, which works after innerHTML). Import `iconSrcFor` from `../render/icons.js`.

- [ ] **Step 2: Hand slots.** The hands row renders text (`⚔ Sword (2 dmg)` style). Prefix each hand's text with an icon img when the hand is filled: build the hand item shape `{ kind: 'weapon'|'ranged', payload: { weaponType: held.weaponType } }` and use `iconSrcFor` the same way; keep the text label after the icon.

- [ ] **Step 3: CSS.** Add next to `.inv-slot` rules: `.inv-icon { width: 40px; height: 40px; image-rendering: pixelated; }` and in `.inv-hand` context `.inv-hand .inv-icon { width: 22px; height: 22px; vertical-align: -4px; margin-right: 4px; }`.

- [ ] **Step 4: Run** `npm test` — Expected: green (panel has no unit tests; suite guards regressions).
- [ ] **Step 5: Commit** — `git add renderer/ui/inventory-panel.js renderer/index.html && git commit -m "feat(game): backpack shows atlas pixel icons instead of emoji"`

---

### Task 5: Toast system + meta first-time tracking

**Files:**
- Modify: `renderer/systems/feedback.js`, `renderer/systems/meta.js`, `renderer/index.html` (toast overlay DOM/CSS), `renderer/game.js`
- Create: `renderer/ui/toast.js`
- Test: `test/feedback.test.js` (append), `test/meta.test.js` (append)

**Interfaces:**
- Produces: `queueToast(state, { title, lines })` and `drainToasts(state) -> array` in feedback.js (`makeFeedback()` gains `toasts: []`); meta gains `bossToastsSeen: []`, `gateToastsSeen: []` (in `getInitialMeta` and tolerated by `validateMeta` — missing arrays default to `[]`); `showToast({ title, lines }, onClose)` / `hideToast()` in ui/toast.js (dismiss on Space/Enter/Escape/click; capture-phase listener like sign-panel).

- [ ] **Step 1: Failing tests.** Append to `test/feedback.test.js`:

```js
describe('toast queue', () => {
  it('queues and drains toasts in order', () => {
    const state = { log: [], feedback: makeFeedback() }
    queueToast(state, { title: 'Talent learned', lines: ['Gust'] })
    queueToast(state, { title: 'Second', lines: [] })
    const drained = drainToasts(state)
    assert.equal(drained.length, 2)
    assert.equal(drained[0].title, 'Talent learned')
    assert.deepEqual(drainToasts(state), [])
  })
  it('logs the toast title so state.log history stays complete', () => {
    const state = { log: [], feedback: makeFeedback() }
    queueToast(state, { title: 'You awaken back in Aspengrove…', lines: [] })
    assert.equal(state.log.at(-1), 'You awaken back in Aspengrove…')
  })
  it('is a no-op without feedback state', () => {
    assert.doesNotThrow(() => queueToast({ log: [] }, { title: 'x', lines: [] }))
  })
})
```

Append to `test/meta.test.js` (read its helpers first; follow its existing style):

```js
it('initial meta starts with empty toast-seen lists', () => {
  const m = getInitialMeta()
  assert.deepEqual(m.bossToastsSeen, [])
  assert.deepEqual(m.gateToastsSeen, [])
})
it('validateMeta tolerates saves that predate toast tracking', () => {
  const m = validateMeta({ ...getInitialMeta(), bossToastsSeen: undefined, gateToastsSeen: undefined })
  assert.deepEqual(m.bossToastsSeen, [])
  assert.deepEqual(m.gateToastsSeen, [])
})
```

- [ ] **Step 2: Run** both test files — Expected: FAIL.

- [ ] **Step 3: feedback.js.** `makeFeedback()` returns `{ floats: [], bubble: null, banner: null, toasts: [] }`;

```js
// Tier-A feedback: a pausing, dismissible panel. Systems queue; game.js
// drains once per frame and owns the pause/DOM around it.
export function queueToast(state, { title, lines = [] }) {
  log(state, title)
  if (state.feedback) state.feedback.toasts.push({ title, lines })
}

export function drainToasts(state) {
  if (!state?.feedback?.toasts?.length) return []
  const t = state.feedback.toasts
  state.feedback.toasts = []
  return t
}
```

- [ ] **Step 4: meta.js.** Add both arrays to `getInitialMeta()`; in `validateMeta`, coerce `bossToastsSeen`/`gateToastsSeen` to arrays of strings (`Array.isArray(x) ? x.filter(s => typeof s === 'string') : []`).

- [ ] **Step 5: ui/toast.js + DOM.** Model on sign-panel verbatim structure, ids `toast-overlay`/`toast-panel` classes reusing `.sign-panel` styling plus its own hint text ('Continue'); keys: `' '`, `'Enter'`, `'Escape'` dismiss (capture phase, preventDefault + stopPropagation); click dismisses. index.html: add `<div id="toast-overlay"></div>` beside `#sign-overlay` and CSS `#toast-overlay { position: fixed; inset: 0; display: none; z-index: 9; align-items: center; justify-content: center; background: rgba(8,8,12,0.7); }`.

- [ ] **Step 6: game.js wiring.** Mirror the sign flow:

```js
function openToast(t) {
  if (phase !== PHASE.PLAYING) { state.feedback.toasts.unshift(t); return }  // re-queue; drained next PLAYING frame
  setPhase(PHASE.PAUSED)
  sfx(state, 'ui-open')
  showToast(t, closeToast)
}
function closeToast() {
  keys[' '] = false; keys['f'] = false   // swallow the dismissing press
  sfx(state, 'ui-close')
  hideToast()
  setPhase(PHASE.PLAYING)
}
```

In `update()` while `phase === PHASE.PLAYING`, near the end of the frame: `const [toast] = drainToasts(state); if (toast) openToast(toast)` (one per frame; the rest stay queued because drainToasts empties — re-push the remainder: `const pending = drainToasts(state); if (pending.length) { openToast(pending[0]); state.feedback.toasts.push(...pending.slice(1)) }`).

- [ ] **Step 7: Run** `node --test test/feedback.test.js test/meta.test.js` then `npm test` — Expected: green.
- [ ] **Step 8: Commit** — `git add renderer/systems/feedback.js renderer/systems/meta.js renderer/ui/toast.js renderer/index.html renderer/game.js test/feedback.test.js test/meta.test.js && git commit -m "feat(game): pausing toast tier — queue in feedback, panel in ui, first-time lists in meta"`

---

### Task 6: Message routing (the audit table)

**Files:**
- Modify: `renderer/game.js`, `renderer/systems/talents.js`
- Test: affected existing tests (talents/gates tests asserting log lines — update assertions to the new sink, keeping intent)

Apply exactly this table. "drop" = delete the speak/think call (the event's sfx/visuals carry it); everything not listed stays as-is (bubbles for refusals, banners for run-flow announcements).

| Site | Current | New |
|---|---|---|
| talents.js:35 `Talent learned — X!` | announce | `queueToast(state, { title: 'Talent learned', lines: [def.name, def.description] })` (import from feedback.js; check `def.description` exists — grep TALENTS table; if not, lines: [def.name]) |
| game.js:1135 `You awaken back in Aspengrove…` | announce | `queueToast(state, { title: 'You awaken back in Aspengrove…', lines: ['The dark took its toll — but you are alive.'] })` |
| game.js:1155 boss falls / key drop | announce | first kill of this boss type (`state.entities` killer site knows the boss entity's `type`): `if (!meta.bossToastsSeen.includes(bossType)) { meta.bossToastsSeen.push(bossType); saveMeta-persist as the surrounding code does; queueToast(state, { title: isFinal ? 'The dragon falls!' : 'The boss falls!', lines: [isFinal ? 'Treasure gleams…' : 'It drops a key.'] }) } else announce(state, …unchanged…)` |
| game.js:740 `Water flows — the vined gate grinds open!` | speak | first opening of this gate (`basin.gateId`): `if (!meta.gateToastsSeen.includes(gateId)) { push + persist; queueToast(state, { title: 'A new area opens!', lines: ['Water flows — the vined gate grinds open.'] }) } else` nothing (gate-open sfx already plays) |
| game.js:264 `Picked up X!` / `into the pack.` | speak | drop (pickup sfx + held-weapon render carry it) |
| game.js:501 `Healed N HP!` | speak | drop (heal sfx + `+N` float carry it) |
| game.js:757 stance landed | think | drop (stance-switch sfx + character reshape carry it) |
| game.js:114 mute toggle | think | keep (it is the only mute feedback) |
| game.js:674 `You picked up the key!` | speak | keep as speak (key pickup is load-bearing information) |

Notes: `meta` persistence — reuse whatever the surrounding code uses (`persistMeta`/`saveMeta` call pattern near `applyRunResult` usage; find it before editing). All other think() sites (123, 134, 260, 453, 497, 508, 518, 639, 663, 705, 835, 888, 914) stay bubbles; all other announce() sites (148, 404, 1212, 1225, 1235, 1237, 1272, 1309) stay banners.

- [ ] **Step 1:** Apply the table. **Step 2:** `npm test`; update any test asserting a dropped/moved log line (e.g. talents tests asserting `state.log` — `queueToast` still logs the title, so most assertions survive; adjust text where it changed). **Step 3:** Commit — `git add -A renderer test && git commit -m "feat(game): message tiers — milestone toasts, refusal bubbles, sfx-only routine events"`

---

### Task 7: Live verification

**Files:** scratchpad scripts only (no repo changes unless something breaks).

- [ ] **Step 1: Menu nav check (emulated phone).** Serve with `node tools/web-server.mjs` (PORT env), context `{ viewport: {width: 915, height: 412}, hasTouch: true, isMobile: true }`. On the title screen, dispatch synthetic `keydown`/`keyup` for `'s'` then `' '` via `page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' })))` (this is exactly what the stick/buttons emit). Assert the selection moved (second `.menu-btn` gains `.selected`) and that Space started the selected mode (menu overlay hides). Also assert `#touch-controls` computed z-index is 15 and the controls are visible while the menu is open (screenshot).
- [ ] **Step 2: HUD + backpack screenshots.** Start a run (`level0` cheat), screenshot: hearts + blue stamina bar top-left, no top/bottom bars. Open the bag (synthetic `'i'`), screenshot the panel; if a test potion can be obtained quickly (chests in the arena), verify an `<img.inv-icon>` renders.
- [ ] **Step 3: Toast check.** Trigger the talent toast if reachable quickly (mushroom-circle is not in level0 arena — instead simulate: `page.evaluate` calling nothing in-page; skip live toast if no quick path and note it — the unit tests + suite cover the queue; visual check of the toast panel can be done by temporarily queueing one via the dev console equivalent: `window.dispatchEvent` cannot reach state, so accept unit coverage and say so).
- [ ] **Step 4:** `git status renderer/data/` — restore any autosaved files (`git checkout -- renderer/data/`). Report results with screenshots.

---

### Task 8: Docs

- [ ] **Step 1:** Update `/home/lappemikb/CLAUDE.md` dungeon-crawler section: mention `ui/toast.js` (pausing milestone toasts), `render/icons.js` (atlas-sprite item icons), controls-driven menus, and the overlay HUD replacing the top/bottom bars. This file is OUTSIDE the repo — edit only, do not commit.
- [ ] **Step 2:** `npm test` one final time; commit any straggling repo changes.
