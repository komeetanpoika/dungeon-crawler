# Talents & Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ranged and magic stances (and heavy-weapon use) become learned talents unlocked by world events, supported by a slot-capped, stacking loot-sack inventory with a pause-overlay panel.

**Architecture:** Two new pure systems — `renderer/systems/inventory.js` (slots, stacking, equip rules) and `renderer/systems/talents.js` (registry, grants) — plus `renderer/systems/rites.js` (trance + ceremony logic) and a DOM overlay `renderer/ui/inventory-panel.js`. game.js wires walk-onto pickups, grants, and the rite state machine; `adventure.js` grows a v3 save carrying talents + body. Phase 1 builds the inventory; Phase 2 builds talents/rites on top of it.

**Tech Stack:** Vanilla JS ES modules, Electron + web (no bundler), `node:test` for tests. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-22-talents-and-inventory-design.md`

## Global Constraints

- No bundler: all imports are relative ES-module paths under `renderer/`.
- Systems in `renderer/systems/` must stay importable under `node --test` — no `document`/`window` access at module top level.
- Tests are `node:test` files in `test/`, one per system, style per `test/magic.test.js`.
- All user-facing feedback goes through `think`/`speak`/`announce` from `systems/feedback.js`; throttle repeatable messages with a `*MsgCooldown` field (pattern: `game.js:553-557`).
- Walk-onto interaction is the default; the only key-press interactions are F (existing fountains) and the new I (inventory panel).
- `renderer/data/open-maps.js` is generated ("do not edit") — never hand-edit it.
- **Spec deviations (approved rationale, surface in final report):** (1) rite/trigger placement is data-driven via `renderer/data/rites.js` + `openmap.js`, not the tile editor — open maps are not editor-authored; (2) dungeon keys stay as the existing per-level `state.hasKey`, not sack items — the stacking framework is exercised by potions and mushrooms instead.

---

## Phase 1 — Inventory

### Task 1: `inventory.js` pure module

**Files:**
- Create: `renderer/systems/inventory.js`
- Test: `test/inventory.test.js`
- Modify: `renderer/systems/entities.js:121` (slot cap), `renderer/systems/meta.js:33-35` (starting potion shape)

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by Tasks 2, 3, 5, 9, 10):
  - `makeItem(kind)` → item; kinds `'potion' | 'mushroom'`
  - `itemFromContents(contents)` → item | null (from chest/floating `contents`)
  - `contentsFromItem(item)` → contents object (for dropping as floating_item)
  - `addItem(player, item)` → `{ ok: true, stacked: boolean } | { ok: false, reason: 'full' }`
  - `removeItem(player, index)` → removed single item | null (decrements stacks, splices empties)
  - `canEquip(player, item)` → `{ ok: true } | { ok: false, reason: 'not_equippable' | 'heavy' }`
  - `equipItem(player, index)` → `{ ok: true, equipped: item } | { ok: false, reason }` (swaps hand ↔ sack)
  - `autoEquipOnPickup(player, item)` → `{ ok, equipped?: boolean, reason?: 'full' }`
  - `EQUIP_FAIL_MESSAGES` — `{ heavy: 'Too heavy — I lack the strength.', not_equippable: '…' }`

Item shape (the sack is `player.inventory`, one array element = one slot):

```js
// potion:   { kind: 'potion',   name: 'Potion',   emoji: '🧪', stackable: true, count: n, amount: 4 }
// mushroom: { kind: 'mushroom', name: 'Mushroom', emoji: '🍄', stackable: true, count: n }
// weapon:   { kind: 'weapon',   name, emoji: '⚔', stackable: false, payload: { weaponType, name, damage, heavy? } }
// ranged:   { kind: 'ranged',   name, emoji: '🏹', stackable: false, payload: { ...makeRangedContents fields } }
```

- [ ] **Step 1: Write the failing tests**

```js
// test/inventory.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeItem, itemFromContents, contentsFromItem, addItem, removeItem,
  canEquip, equipItem, autoEquipOnPickup, EQUIP_FAIL_MESSAGES,
} from '../renderer/systems/inventory.js'

const mkPlayer = (over = {}) => ({
  inventory: [], maxInventory: 10, weapon: null, ranged: null, talents: [], ...over,
})
const swordContents = () => ({ type: 'weapon', weaponType: 'sword', name: 'Sword', damage: 2 })
const bowContents = () => ({ type: 'ranged', weaponType: 'shortbow', name: 'Shortbow',
  damage: 2, ammo: 12, maxAmmo: 12, cooldown: 0.6, color: '#facc15', kind: 'bow' })

describe('stacking and capacity', () => {
  it('stackables merge into one slot with a growing count', () => {
    const p = mkPlayer()
    addItem(p, makeItem('potion'))
    addItem(p, makeItem('potion'))
    assert.equal(p.inventory.length, 1)
    assert.equal(p.inventory[0].count, 2)
  })

  it('weapons take one slot each', () => {
    const p = mkPlayer()
    addItem(p, itemFromContents(swordContents()))
    addItem(p, itemFromContents(swordContents()))
    assert.equal(p.inventory.length, 2)
  })

  it('a full sack refuses new slots but still stacks', () => {
    const p = mkPlayer({ maxInventory: 1 })
    assert.equal(addItem(p, makeItem('potion')).ok, true)
    assert.deepEqual(addItem(p, itemFromContents(swordContents())), { ok: false, reason: 'full' })
    assert.equal(addItem(p, makeItem('potion')).ok, true)   // stacking needs no new slot
    assert.equal(p.inventory[0].count, 2)
  })

  it('removeItem decrements a stack and splices the last one', () => {
    const p = mkPlayer()
    addItem(p, makeItem('mushroom')); addItem(p, makeItem('mushroom'))
    removeItem(p, 0)
    assert.equal(p.inventory[0].count, 1)
    removeItem(p, 0)
    assert.equal(p.inventory.length, 0)
  })
})

describe('equipping', () => {
  it('equipping a weapon from the sack fills the hand and empties the slot', () => {
    const p = mkPlayer()
    addItem(p, itemFromContents(swordContents()))
    const r = equipItem(p, 0)
    assert.equal(r.ok, true)
    assert.equal(p.weapon.weaponType, 'sword')
    assert.equal(p.inventory.length, 0)
  })

  it('equipping over a held weapon swaps it back into the sack', () => {
    const p = mkPlayer({ weapon: { weaponType: 'dagger', name: 'Dagger', damage: 1 } })
    addItem(p, itemFromContents(swordContents()))
    equipItem(p, 0)
    assert.equal(p.weapon.weaponType, 'sword')
    assert.equal(p.inventory.length, 1)
    assert.equal(p.inventory[0].payload.weaponType, 'dagger')
  })

  it('ranged items equip into the ranged hand', () => {
    const p = mkPlayer()
    addItem(p, itemFromContents(bowContents()))
    equipItem(p, 0)
    assert.equal(p.ranged.weaponType, 'shortbow')
  })

  it('potions are not equippable', () => {
    const p = mkPlayer()
    addItem(p, makeItem('potion'))
    assert.deepEqual(equipItem(p, 0), { ok: false, reason: 'not_equippable' })
  })

  it('a heavy weapon refuses without the heavy_weapons talent and equips with it', () => {
    const heavy = itemFromContents({ type: 'weapon', weaponType: 'axe', name: 'Axe', damage: 4, heavy: true })
    assert.deepEqual(canEquip(mkPlayer(), heavy), { ok: false, reason: 'heavy' })
    assert.equal(canEquip(mkPlayer({ talents: ['heavy_weapons'] }), heavy).ok, true)
    assert.ok(EQUIP_FAIL_MESSAGES.heavy)
  })
})

describe('pickup auto-equip', () => {
  it('auto-equips into an empty allowed hand', () => {
    const p = mkPlayer()
    const r = autoEquipOnPickup(p, itemFromContents(swordContents()))
    assert.deepEqual(r, { ok: true, equipped: true })
    assert.equal(p.weapon.weaponType, 'sword')
    assert.equal(p.inventory.length, 0)
  })

  it('goes to the sack when the hand is full', () => {
    const p = mkPlayer({ weapon: { weaponType: 'dagger', name: 'Dagger', damage: 1 } })
    const r = autoEquipOnPickup(p, itemFromContents(swordContents()))
    assert.deepEqual(r, { ok: true, equipped: false })
    assert.equal(p.inventory.length, 1)
  })

  it('a heavy pickup with an empty hand still goes to the sack untrained', () => {
    const p = mkPlayer()
    const heavy = itemFromContents({ type: 'weapon', weaponType: 'axe', name: 'Axe', damage: 4, heavy: true })
    const r = autoEquipOnPickup(p, heavy)
    assert.deepEqual(r, { ok: true, equipped: false })
    assert.equal(p.weapon, null)
  })

  it('reports full when neither hand nor sack can take it', () => {
    const p = mkPlayer({ maxInventory: 0, weapon: { weaponType: 'dagger', name: 'Dagger', damage: 1 } })
    assert.deepEqual(autoEquipOnPickup(p, itemFromContents(swordContents())), { ok: false, reason: 'full' })
  })

  it('round-trips contents for dropping', () => {
    const item = itemFromContents(bowContents())
    assert.deepEqual(contentsFromItem(item), bowContents())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/inventory.test.js`
Expected: FAIL — cannot find module `renderer/systems/inventory.js`.

- [ ] **Step 3: Implement `renderer/systems/inventory.js`**

```js
// The loot sack: slot-capped inventory with stacking, plus the equip rules
// between sack and the two hand slots (player.weapon / player.ranged).
// Pure player-state logic — game.js owns pickups, drops, and messages.

const STACKABLE_KINDS = {
  potion:   { name: 'Potion',   emoji: '🧪', extra: { amount: 4 } },
  mushroom: { name: 'Mushroom', emoji: '🍄', extra: {} },
}

export function makeItem(kind) {
  const def = STACKABLE_KINDS[kind]
  return { kind, name: def.name, emoji: def.emoji, stackable: true, count: 1, ...def.extra }
}

// Chest/floating `contents` -> sack item. Unknown types return null.
export function itemFromContents(contents) {
  if (contents.type === 'weapon' || contents.type === 'ranged') {
    const { type, ...payload } = contents
    return { kind: type, name: contents.name, emoji: type === 'weapon' ? '⚔' : '🏹', stackable: false, payload }
  }
  if (contents.type === 'potion') return makeItem('potion')
  if (contents.type === 'mushroom') return makeItem('mushroom')
  return null
}

export function contentsFromItem(item) {
  if (item.kind === 'weapon') return { ...item.payload, type: 'weapon' }
  if (item.kind === 'ranged') return { ...item.payload, type: 'ranged' }
  if (item.kind === 'potion') return { type: 'potion', amount: item.amount }
  return { type: 'mushroom' }
}

export function addItem(player, item) {
  if (item.stackable) {
    const slot = player.inventory.find(i => i.kind === item.kind)
    if (slot) { slot.count += item.count ?? 1; return { ok: true, stacked: true } }
  }
  if (player.inventory.length >= player.maxInventory) return { ok: false, reason: 'full' }
  player.inventory.push(item)
  return { ok: true, stacked: false }
}

// Remove one unit from the slot at `index`; returns a count-1 copy or null.
export function removeItem(player, index) {
  const slot = player.inventory[index]
  if (!slot) return null
  if (slot.stackable && slot.count > 1) { slot.count -= 1; return { ...slot, count: 1 } }
  player.inventory.splice(index, 1)
  return { ...slot, count: 1 }
}

export function canEquip(player, item) {
  if (item.kind !== 'weapon' && item.kind !== 'ranged') return { ok: false, reason: 'not_equippable' }
  if (item.payload.heavy && !(player.talents ?? []).includes('heavy_weapons'))
    return { ok: false, reason: 'heavy' }
  return { ok: true }
}

// Equip the sack slot at `index` into its hand; a held item swaps back in.
export function equipItem(player, index) {
  const item = player.inventory[index]
  if (!item) return { ok: false, reason: 'not_equippable' }
  const gate = canEquip(player, item)
  if (!gate.ok) return gate
  const hand = item.kind === 'weapon' ? 'weapon' : 'ranged'
  const held = player[hand]
  player[hand] = { ...item.payload }
  player.inventory.splice(index, 1)
  if (held) {
    const kind = hand
    player.inventory.push({ kind, name: held.name, emoji: kind === 'weapon' ? '⚔' : '🏹',
      stackable: false, payload: { ...held } })
  }
  return { ok: true, equipped: item }
}

// Walk-onto pickup policy: empty allowed hand -> equip; otherwise -> sack.
export function autoEquipOnPickup(player, item) {
  const hand = item.kind === 'weapon' ? 'weapon' : item.kind === 'ranged' ? 'ranged' : null
  if (hand && !player[hand] && canEquip(player, item).ok) {
    player[hand] = { ...item.payload }
    return { ok: true, equipped: true }
  }
  const r = addItem(player, item)
  return r.ok ? { ok: true, equipped: false } : r
}

export const EQUIP_FAIL_MESSAGES = {
  heavy: 'Too heavy — I lack the strength.',
  not_equippable: "I can't wield that.",
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/inventory.test.js`
Expected: PASS (all).

- [ ] **Step 5: Raise the slot cap and convert the starting potion**

In `renderer/systems/entities.js:121` change:

```js
    inventory: [], maxInventory: 10 + extraSlots,
```

In `renderer/systems/meta.js` replace the `getStartingItems` body (and drop the now-unused `ITEMS` import if nothing else uses it):

```js
import { makeItem } from './inventory.js'
// …
export function getStartingItems(meta) {
  return meta.unlockedBonuses.includes('starting_potion') ? [makeItem('potion')] : []
}
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS. If a meta test asserts the old `ITEMS.POTION` shape, update it to expect `{ kind: 'potion', count: 1 }` fields.

- [ ] **Step 7: Commit**

```bash
git add renderer/systems/inventory.js test/inventory.test.js renderer/systems/entities.js renderer/systems/meta.js
git commit -m "feat(inventory): loot-sack module — slots, stacking, equip rules"
```

---

### Task 2: Route pickups through the sack

**Files:**
- Modify: `renderer/game.js:348-405` (chest + floating-item pickup), `renderer/game.js:29-33` (imports)

**Interfaces:**
- Consumes: `itemFromContents`, `autoEquipOnPickup`, `addItem` from Task 1.
- Produces: pickups never overwrite hands; potions no longer insta-heal (they go to the sack; drinking comes in Task 3). A full sack leaves the floating item on the ground.

- [ ] **Step 1: Add the import in game.js**

```js
import { itemFromContents, contentsFromItem, autoEquipOnPickup, addItem, removeItem, equipItem, canEquip, EQUIP_FAIL_MESSAGES } from './systems/inventory.js'
```

- [ ] **Step 2: Replace both grant sites with one helper**

Add near `detonateFireball` in game.js:

```js
// Walk-onto item grant: hand if free, else sack. Returns false when the sack
// is full so the caller can leave the item in the world.
function grantContents(contents) {
  const item = itemFromContents(contents)
  if (!item) return true
  const r = autoEquipOnPickup(state.player, item)
  if (!r.ok) {
    state.packMsgCooldown = state.packMsgCooldown ?? 0
    if (state.packMsgCooldown <= 0) { think(state, 'My pack is full.'); state.packMsgCooldown = 2 }
    return false
  }
  const ammo = contents.type === 'ranged' ? ` (${contents.ammo} shots)` : ''
  speak(state, r.equipped ? `Picked up ${item.name}!${ammo}` : `${item.name} — into the pack.`)
  return true
}
```

In the chest block (`game.js:369-383`), replace the whole `else { … }` direct-grant branch body with `grantContents(chest.contents)` (chest still opens either way). In the floating-item block (`game.js:390-404`), replace the `if/else if` chain with:

```js
    if (grantContents(item.contents)) {
      state.entities = state.entities.filter((_, i) => i !== floatIdx)
    }
```

Also add `state.packMsgCooldown = Math.max(0, (state.packMsgCooldown ?? 0) - delta)` next to the other message-cooldown decrements (`game.js:571`).

- [ ] **Step 3: Run the suite and boot the game**

Run: `npm test` — expected PASS (game.js has no unit tests; systems must stay green).
Then a quick launch sanity check (time-boxed, per project preference): `npm start`, open a chest on level 1, confirm the weapon equips when unarmed and a second weapon lands in the HUD emoji strip instead of replacing the first. Close the app.

- [ ] **Step 4: Commit**

```bash
git add renderer/game.js
git commit -m "feat(inventory): pickups route through the sack, never overwrite hands"
```

---

### Task 3: Inventory panel UI

**Files:**
- Create: `renderer/ui/inventory-panel.js`
- Modify: `renderer/index.html` (markup + styles + 🎒 touch button), `renderer/game.js` (I-key + Escape wiring, drop/use/equip handlers), `renderer/ui/touch-controls.js` (bind 🎒)

**Interfaces:**
- Consumes: Task 1 API; `PHASE`/`setPhase` and `think/speak` already in game.js.
- Produces: `showInventory(state, handlers)`, `hideInventory()`, `refreshInventory(state)` from `ui/inventory-panel.js`; game.js keeps an `inventoryOpen` boolean. `handlers = { onEquip(i), onUse(i), onDrop(i), onClose() }`. Task 10 reuses `onUse` for mushrooms.

- [ ] **Step 1: Markup + styles in index.html**

Before `</style>` (matches menu styling):

```css
    #inv-overlay {
      position: fixed; inset: 0; display: none; z-index: 9;
      align-items: center; justify-content: center;
      background: rgba(8, 8, 12, 0.85);
    }
    .inv-panel { background: #1a1a22; border: 1px solid #3a3a44; padding: 16px 20px;
      min-width: 340px; max-width: 90vw; font-size: 14px; }
    .inv-title { color: #e8b84b; font-size: 18px; margin-bottom: 10px; letter-spacing: 2px; }
    .inv-hands { display: flex; gap: 10px; margin-bottom: 10px; }
    .inv-hand { border: 1px solid #3a3a44; padding: 6px 10px; color: #f6ad55; }
    .inv-grid { display: grid; grid-template-columns: repeat(5, 52px); gap: 6px; }
    .inv-slot { width: 52px; height: 52px; border: 1px solid #3a3a44; background: #14141a;
      display: flex; align-items: center; justify-content: center; font-size: 22px;
      position: relative; cursor: pointer; }
    .inv-slot.selected { border-color: #e8b84b; background: #2a2a36; }
    .inv-count { position: absolute; right: 3px; bottom: 1px; font-size: 11px; color: #ccc; }
    .inv-detail { margin-top: 10px; min-height: 34px; color: #ccc; }
    .inv-detail .warn { color: #f87171; }
    .inv-actions { margin-top: 6px; display: flex; gap: 8px; }
    .inv-actions button { font-family: monospace; font-size: 13px; color: #ccc;
      background: #1a1a22; border: 1px solid #3a3a44; padding: 4px 14px; cursor: pointer; }
    .inv-actions button:hover { border-color: #e8b84b; color: #fff; }
```

Before `<div id="rotate-overlay">`: `<div id="inv-overlay"></div>`.
Inside `#touch-actions`, after the fountain button: `<div id="touch-bag" class="touch-btn">🎒</div>` and a size rule alongside `#touch-fountain`'s: `#touch-bag { width: 48px; height: 48px; font-size: 20px; opacity: 0.55; }`.

- [ ] **Step 2: Implement `renderer/ui/inventory-panel.js`**

DOM-only module, callback-driven like `ui/menu.js` (keep document access inside functions):

```js
// Pause-overlay loot sack panel. Renders player.inventory + the two hand
// slots; all mutations happen in game.js via the handlers.
import { canEquip, EQUIP_FAIL_MESSAGES } from '../systems/inventory.js'

let keyHandler = null
let selected = 0
let lastState = null
let lastHandlers = null

const el = () => document.getElementById('inv-overlay')

function primaryAction(item) {
  if (!item) return null
  if (item.kind === 'weapon' || item.kind === 'ranged') return { label: 'Equip', fn: 'onEquip' }
  if (item.kind === 'potion') return { label: 'Drink', fn: 'onUse' }
  if (item.kind === 'mushroom') return { label: 'Eat', fn: 'onUse' }
  return null
}

function detailText(player, item) {
  if (!item) return ' '
  const stats = item.payload?.damage != null ? ` (${item.payload.damage} dmg)` : ''
  const gate = (item.kind === 'weapon' || item.kind === 'ranged') ? canEquip(player, item) : { ok: true }
  const warn = gate.ok ? '' : ` — <span class="warn">${EQUIP_FAIL_MESSAGES[gate.reason]}</span>`
  return `${item.name}${stats}${warn}`
}

export function refreshInventory(state) {
  if (!lastHandlers) return
  const { player } = state
  lastState = state
  selected = Math.min(selected, Math.max(0, player.inventory.length - 1))
  const root = el()
  root.innerHTML = ''
  const panel = document.createElement('div')
  panel.className = 'inv-panel'
  panel.innerHTML = `<div class="inv-title">PACK ${player.inventory.length}/${player.maxInventory}</div>`
  const hands = document.createElement('div')
  hands.className = 'inv-hands'
  const handTexts = [`⚔ ${player.weapon ? player.weapon.name : 'Unarmed'}`]
  if ((player.talents ?? []).includes('ranged_stance') || player.ranged)
    handTexts.push(`🏹 ${player.ranged ? player.ranged.name : 'Empty'}`)
  for (const t of handTexts) {
    const h = document.createElement('div'); h.className = 'inv-hand'; h.textContent = t; hands.appendChild(h)
  }
  panel.appendChild(hands)
  const grid = document.createElement('div')
  grid.className = 'inv-grid'
  for (let i = 0; i < player.maxInventory; i++) {
    const slot = document.createElement('div')
    slot.className = 'inv-slot' + (i === selected ? ' selected' : '')
    const item = player.inventory[i]
    if (item) {
      slot.textContent = item.emoji
      if (item.stackable && item.count > 1) {
        const c = document.createElement('span'); c.className = 'inv-count'; c.textContent = `×${item.count}`
        slot.appendChild(c)
      }
      slot.addEventListener('click', () => { selected = i; refreshInventory(lastState) })
    }
    grid.appendChild(slot)
  }
  panel.appendChild(grid)
  const detail = document.createElement('div')
  detail.className = 'inv-detail'
  detail.innerHTML = detailText(player, player.inventory[selected])
  panel.appendChild(detail)
  const actions = document.createElement('div')
  actions.className = 'inv-actions'
  const item = player.inventory[selected]
  const primary = primaryAction(item)
  if (primary) {
    const b = document.createElement('button')
    b.textContent = primary.label
    b.addEventListener('click', () => lastHandlers[primary.fn](selected))
    actions.appendChild(b)
  }
  if (item) {
    const d = document.createElement('button')
    d.textContent = 'Drop'
    d.addEventListener('click', () => lastHandlers.onDrop(selected))
    actions.appendChild(d)
  }
  const close = document.createElement('button')
  close.textContent = 'Close (I)'
  close.addEventListener('click', () => lastHandlers.onClose())
  actions.appendChild(close)
  panel.appendChild(actions)
  root.appendChild(panel)
  root.style.display = 'flex'
}

export function showInventory(state, handlers) {
  lastHandlers = handlers
  selected = 0
  refreshInventory(state)
  keyHandler = (e) => {
    const n = state.player.inventory.length
    const cols = 5
    if (e.key === 'ArrowRight') selected = Math.min(Math.max(0, n - 1), selected + 1)
    else if (e.key === 'ArrowLeft') selected = Math.max(0, selected - 1)
    else if (e.key === 'ArrowDown') selected = Math.min(Math.max(0, n - 1), selected + cols)
    else if (e.key === 'ArrowUp') selected = Math.max(0, selected - cols)
    else if (e.key === 'Enter') {
      const p = primaryAction(state.player.inventory[selected])
      if (p) lastHandlers[p.fn](selected)
    } else if (e.key === 'x' || e.key === 'X') {
      if (state.player.inventory[selected]) lastHandlers.onDrop(selected)
    } else return
    e.preventDefault(); e.stopPropagation()
    refreshInventory(state)
  }
  window.addEventListener('keydown', keyHandler, true)   // capture: outrank game key handlers
}

export function hideInventory() {
  if (keyHandler) { window.removeEventListener('keydown', keyHandler, true); keyHandler = null }
  lastHandlers = null
  const root = el()
  root.style.display = 'none'
  root.innerHTML = ''
}
```

- [ ] **Step 3: Wire game.js**

Imports: `import { showInventory, hideInventory, refreshInventory } from './ui/inventory-panel.js'`.

Add module state `let inventoryOpen = false` next to `let state = null`, and these functions near `pauseGame`:

```js
function openInventory() {
  if (phase !== PHASE.PLAYING || !state) return
  setPhase(PHASE.PAUSED)
  inventoryOpen = true
  showInventory(state, {
    onEquip: (i) => {
      const r = equipItem(state.player, i)
      if (!r.ok) think(state, EQUIP_FAIL_MESSAGES[r.reason] ?? "Can't equip that.")
      afterInventoryChange()
    },
    onUse: (i) => useInventoryItem(i),
    onDrop: (i) => dropInventoryItem(i),
    onClose: closeInventory,
  })
}

function closeInventory() {
  inventoryOpen = false
  hideInventory()
  setPhase(PHASE.PLAYING)
}

function afterInventoryChange() {
  refreshInventory(state)
  updateHUD(state)
  if (OPEN_MAPS[state.cave ? state.cave.surface.level : state.level]) persistAdventure()
}

function useInventoryItem(i) {
  const item = state.player.inventory[i]
  if (!item) return
  if (item.kind === 'potion') {
    const healed = Math.min(state.player.maxHp - state.player.hp, item.amount)
    if (healed <= 0) { think(state, 'Already full.'); return }
    removeItem(state.player, i)
    state.player.hp += healed
    addFloat(state.feedback, { px: state.player.px, py: state.player.py, text: `+${healed}`, kind: 'heal' })
    speak(state, `Healed ${healed} HP!`)
    closeInventory()                      // see the effect land
  }
  // mushroom handling arrives with the rites task
  afterInventoryChange()
}

function dropInventoryItem(i) {
  const { player, map } = state
  const adj = [[-1,0],[1,0],[0,-1],[0,1]].map(([dx,dy]) => ({ x: player.x+dx, y: player.y+dy }))
    .find(t => isWalkable(map[t.y]?.[t.x]?.tile, map[t.y]?.[t.x]) && !state.entities.some(e => e.x===t.x && e.y===t.y))
  if (!adj) { think(state, 'No room to drop here.'); return }
  const item = removeItem(player, i)
  state.entities.push({
    type: 'floating_item', contents: contentsFromItem(item),
    x: adj.x, y: adj.y,
    startPx: player.px, startPy: player.py,
    targetPx: adj.x * TILE_SIZE + TILE_SIZE / 2, targetPy: adj.y * TILE_SIZE + TILE_SIZE / 2,
    px: player.px, py: player.py, progress: 0, duration: 0.35,
  })
  afterInventoryChange()
}
```

(No re-pickup guard is needed: the item lands on an adjacent tile, not the player's own.)

Key wiring: a new listener beside the Shift listener —

```js
window.addEventListener('keydown', e => {
  if ((e.key !== 'i' && e.key !== 'I') || e.repeat) return
  if (phase === PHASE.PLAYING) openInventory()
  else if (inventoryOpen) closeInventory()
})
```

And extend the Escape listener (`game.js:53-58`): when `inventoryOpen`, Escape calls `closeInventory()` instead of `pauseGame()`/`resumeGame()`.

Also: a dropped-then-walked-over `mushroom`/`potion` floating item now flows through `grantContents` (Task 2) — already handled since `itemFromContents` knows both.

`floating_item` rendering for non-weapon contents: in `renderer/render/canvas.js:172-180`, add after the potion branch:

```js
    } else if (c.type === 'mushroom') {
      const s = sprites.ow_mushroom
      if (s) ctx.drawImage(s, px, py, S, S)
      else { ctx.font = `${Math.round(S*0.8)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🍄', px + S/2, py + S/2) }
    }
```

Touch: in `ui/touch-controls.js` add `bindHold(document.getElementById('touch-bag'), 'i')` beside the fountain binding.

- [ ] **Step 4: Verify**

Run: `npm test` — PASS expected.
Runtime (time-boxed): `npm start`; press I → panel opens and the game freezes; arrow/Enter equips a sack weapon (swap visible in hands row); Drink heals and closes; X drops an item that arcs to a neighbor tile and can be re-picked. Esc and I both close.

- [ ] **Step 5: Commit**

```bash
git add renderer/ui/inventory-panel.js renderer/index.html renderer/game.js renderer/ui/touch-controls.js renderer/render/canvas.js
git commit -m "feat(inventory): pause-overlay pack panel — equip, drink, drop"
```

---

### Task 4: Adventure save v3 — talents + body persist

**Files:**
- Modify: `renderer/systems/adventure.js` (v3 shape + migration), `renderer/game.js` (`persistAdventure`, `startNewRun` restore)
- Test: `test/adventure.test.js` (extend; create if missing)

**Interfaces:**
- Consumes: nothing new.
- Produces: save shape `{ caves, progress, talents: [], body: null | { weapon, ranged, inventory } }`; `normalizeAdventureSave` migrates v1/v2 saves additively. game.js restores talents+body when starting an Adventure run and writes them in `persistAdventure`. Task 5's `grantTalent` persists through the same path.

- [ ] **Step 1: Write failing tests** (append to `test/adventure.test.js`, matching its existing import style)

```js
describe('v3 save shape', () => {
  it('fresh saves carry empty talents and no body', () => {
    const s = normalizeAdventureSave(null)
    assert.deepEqual(s.talents, [])
    assert.equal(s.body, null)
  })

  it('v2 saves migrate additively, keeping caves and progress', () => {
    const v2 = { caves: { m: {} }, progress: { mapDepth: 7, cleared: { m: ['a'] } } }
    const s = normalizeAdventureSave(v2)
    assert.deepEqual(s.talents, [])
    assert.equal(s.body, null)
    assert.deepEqual(s.progress.cleared, { m: ['a'] })
  })

  it('v1 bare-caves saves still migrate', () => {
    const s = normalizeAdventureSave({ somemap: { cave1: {} } })
    assert.ok(s.progress)
    assert.deepEqual(s.talents, [])
  })

  it('v3 saves pass through untouched', () => {
    const v3 = { caves: {}, progress: { mapDepth: 7, cleared: {} },
      talents: ['magic_stance'], body: { weapon: null, ranged: null, inventory: [] } }
    assert.deepEqual(normalizeAdventureSave(v3), v3)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `node --test test/adventure.test.js` → FAIL (`talents` undefined).

- [ ] **Step 3: Implement in `adventure.js`** — replace `normalizeAdventureSave` (lines 34-40):

```js
// Save-file shapes: v1 was the bare caves map ({mapName: {label: instance}});
// v2 added { caves, progress }; v3 adds learned talents and the traveling
// body (hands + sack). Migration is additive — missing fields default.
export function normalizeAdventureSave(raw) {
  const base = (raw && typeof raw === 'object' && raw.progress) ? { ...raw }
    : (raw && typeof raw === 'object' && !raw.caves) ? { caves: raw, progress: freshProgress() }
    : { caves: {}, progress: freshProgress() }
  base.talents ??= []
  base.body ??= null
  return base
}
```

- [ ] **Step 4: Run tests** — `node --test test/adventure.test.js` → PASS.

- [ ] **Step 5: Wire game.js**

`persistAdventure` (`game.js:96-101`) — also snapshot the body and talents (the player object is shared between surface and cave states, so `state.player` is always current):

```js
function persistAdventure() {
  const surface = state?.cave ? state.cave.surface : state
  const mapName = surface ? OPEN_MAPS[surface.level]?.name : null
  if (mapName) savedAdventure.caves[mapName] = surface.caveInstances ?? {}
  if (mapName && state.player) {
    savedAdventure.talents = [...(state.player.talents ?? [])]
    savedAdventure.body = {
      weapon: state.player.weapon ? { ...state.player.weapon } : null,
      ranged: state.player.ranged ? { ...state.player.ranged } : null,
      inventory: state.player.inventory.map(i => ({ ...i })),
    }
  }
  window.saveAPI.saveCaves?.(savedAdventure)
}
```

`startNewRun` — after the `player.inventory.push(...getStartingItems(meta))` line (`game.js:235`), restore for Adventure maps only:

```js
  if (OPEN_MAPS[depth]) {
    player.talents = [...savedAdventure.talents]
    if (savedAdventure.body) {
      player.weapon = savedAdventure.body.weapon ? { ...savedAdventure.body.weapon } : null
      player.ranged = savedAdventure.body.ranged ? { ...savedAdventure.body.ranged } : null
      player.inventory = savedAdventure.body.inventory.map(i => ({ ...i }))
    }
  }
```

(`player.talents` for non-adventure runs is initialized by Task 6's `makePlayer` change; until then it is simply absent, which every `?? []` guard tolerates.)

- [ ] **Step 6: Verify** — `npm test` PASS; runtime: start Adventure, grab a weapon, quit to title, relaunch Adventure → weapon still in hand. (Web parity is automatic: `web-shim.js` implements the same `saveAPI` over localStorage.)

- [ ] **Step 7: Commit**

```bash
git add renderer/systems/adventure.js test/adventure.test.js renderer/game.js
git commit -m "feat(save): adventure save v3 — talents and body travel across sessions"
```

---

## Phase 2 — Talents

### Task 5: `talents.js` registry

**Files:**
- Create: `renderer/systems/talents.js`
- Test: `test/talents.test.js`

**Interfaces:**
- Consumes: `announce` from `systems/feedback.js`.
- Produces (used by Tasks 6-10):
  - `TALENTS` — `{ ranged_stance: {name:'Marksmanship', desc}, magic_stance: {name:'Gust of Wind', desc}, heavy_weapons: {name:'Might', desc} }`
  - `hasTalent(player, id)` → boolean (`player.talents` array)
  - `grantTalent(state, id)` → boolean (true if newly learned; announces `Talent learned — <name>!`)
  - `RUSH_TALENT_LADDER` — `{ 1: 'ranged_stance', 2: 'magic_stance', 3: 'heavy_weapons' }`
  - `MAP_CLEAR_TALENTS` — `{ 'forest-1-clearings': 'ranged_stance', 'forest-3-autumn': 'heavy_weapons' }` (granted on the first dungeon cleared on that map)

- [ ] **Step 1: Write failing tests**

```js
// test/talents.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TALENTS, hasTalent, grantTalent, RUSH_TALENT_LADDER, MAP_CLEAR_TALENTS } from '../renderer/systems/talents.js'
import { makeFeedback } from '../renderer/systems/feedback.js'

const mkState = () => ({ player: { talents: [] }, feedback: makeFeedback(), log: [] })

describe('talent registry', () => {
  it('defines the three launch talents', () => {
    for (const id of ['ranged_stance', 'magic_stance', 'heavy_weapons']) {
      assert.ok(TALENTS[id]?.name, id)
    }
  })

  it('rush ladder and map rewards reference real talents', () => {
    for (const id of [...Object.values(RUSH_TALENT_LADDER), ...Object.values(MAP_CLEAR_TALENTS)])
      assert.ok(TALENTS[id], id)
  })
})

describe('grantTalent', () => {
  it('grants once, reports newness, and celebrates', () => {
    const state = mkState()
    assert.equal(grantTalent(state, 'magic_stance'), true)
    assert.ok(hasTalent(state.player, 'magic_stance'))
    assert.equal(grantTalent(state, 'magic_stance'), false)     // idempotent
    assert.deepEqual(state.player.talents, ['magic_stance'])
  })

  it('refuses unknown ids', () => {
    const state = mkState()
    assert.equal(grantTalent(state, 'levitation'), false)
    assert.deepEqual(state.player.talents, [])
  })

  it('tolerates a player without a talents array', () => {
    const state = { player: {}, feedback: makeFeedback(), log: [] }
    assert.equal(grantTalent(state, 'ranged_stance'), true)
    assert.ok(hasTalent(state.player, 'ranged_stance'))
    assert.equal(hasTalent({ }, 'ranged_stance'), false)
  })
})
```

- [ ] **Step 2: Run** — `node --test test/talents.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement `renderer/systems/talents.js`**

```js
// Learned abilities. Everything that unlocks a talent — rite, boss kill,
// dungeon clear, future NPC — funnels through grantTalent. Persistence is
// the caller's job (game.js persists for Adventure; Dungeon Rush never does).
import { announce } from './feedback.js'

export const TALENTS = {
  ranged_stance: { name: 'Marksmanship', desc: 'Use bows and wands in the ranged stance.' },
  magic_stance:  { name: 'Gust of Wind', desc: 'Channel mana in the magic stance.' },
  heavy_weapons: { name: 'Might',        desc: 'Wield heavy weapons.' },
}

// Dungeon Rush: per-run talents taught by the depth ladder's boss kills.
export const RUSH_TALENT_LADDER = { 1: 'ranged_stance', 2: 'magic_stance', 3: 'heavy_weapons' }

// Adventure interim sources: first dungeon cleared on the named map.
// (magic_stance comes from the mushroom-circle rite instead — see rites.js.)
export const MAP_CLEAR_TALENTS = {
  'forest-1-clearings': 'ranged_stance',
  'forest-3-autumn':    'heavy_weapons',
}

export function hasTalent(player, id) {
  return (player?.talents ?? []).includes(id)
}

// Returns true only when newly learned, so callers know to persist.
export function grantTalent(state, id) {
  const def = TALENTS[id]
  if (!def) return false
  const p = state.player
  p.talents ??= []
  if (p.talents.includes(id)) return false
  p.talents.push(id)
  announce(state, `Talent learned — ${def.name}!`)
  return true
}
```

- [ ] **Step 4: Run** — `node --test test/talents.test.js` → PASS. Then `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/talents.js test/talents.test.js
git commit -m "feat(talents): registry, grants, rush ladder, map-clear rewards"
```

---

### Task 6: Stance gates — cycle skips, `not_learned` refusals

**Files:**
- Modify: `renderer/systems/ranged.js`, `renderer/systems/magic.js`, `renderer/systems/entities.js:115-126`, `renderer/game.js:62-68` (Shift listener), `renderer/game.js:575-591` (magic branch)
- Test: `test/ranged.test.js`, `test/magic.test.js` (update + extend)

**Interfaces:**
- Consumes: `hasTalent` from Task 5.
- Produces: `toggleAttackMode(player)` returns the new mode, or `null` when no other stance is learned; `tryFire`/`tryGust` gain a `not_learned` refusal ahead of all others; `makePlayer` initializes `talents: []`.

- [ ] **Step 1: Update/extend tests**

In `test/magic.test.js`, `mkPlayer` gains `talents: ['magic_stance']` and the stance-cycle describe becomes:

```js
describe('stance cycle', () => {
  it('cycles through every learned stance', () => {
    const p = { attackMode: 'melee', talents: ['ranged_stance', 'magic_stance'] }
    assert.equal(toggleAttackMode(p), 'ranged')
    assert.equal(toggleAttackMode(p), 'magic')
    assert.equal(toggleAttackMode(p), 'melee')
  })

  it('skips unlearned stances', () => {
    const p = { attackMode: 'melee', talents: ['magic_stance'] }
    assert.equal(toggleAttackMode(p), 'magic')
    assert.equal(toggleAttackMode(p), 'melee')
  })

  it('returns null with nothing else learned', () => {
    const p = { attackMode: 'melee', talents: [] }
    assert.equal(toggleAttackMode(p), null)
    assert.equal(p.attackMode, 'melee')
  })
})
```

Add to the `tryGust` describe:

```js
  it('refuses without the magic_stance talent', () => {
    const state = mkState([])
    state.player.talents = []
    assert.deepEqual(tryGust(state), { ok: false, reason: 'not_learned' })
    assert.equal(state.player.mana, MANA_MAX)
  })
```

In `test/ranged.test.js`, give existing `tryFire` test players `talents: ['ranged_stance']` and add:

```js
  it('refuses without the ranged_stance talent', () => {
    const p = { talents: [], ranged: { ammo: 5, cooldown: 0.5, damage: 2, color: '#fff', kind: 'bow' }, rangedCooldown: 0 }
    assert.deepEqual(tryFire(p), { ok: false, reason: 'not_learned' })
    assert.equal(p.ranged.ammo, 5)
  })
```

- [ ] **Step 2: Run** — `node --test test/magic.test.js test/ranged.test.js` → FAIL.

- [ ] **Step 3: Implement**

`ranged.js` — replace `toggleAttackMode` and gate `tryFire`:

```js
import { hasTalent } from './talents.js'

const STANCE_ORDER = ['melee', 'ranged', 'magic']
const STANCE_TALENT = { ranged: 'ranged_stance', magic: 'magic_stance' }

// Cycle to the next learned stance; null (no change) when only melee is known.
export function toggleAttackMode(player) {
  const from = STANCE_ORDER.indexOf(player.attackMode)
  for (let step = 1; step <= STANCE_ORDER.length; step++) {
    const mode = STANCE_ORDER[(from + step) % STANCE_ORDER.length]
    if (mode === player.attackMode) break
    if (!STANCE_TALENT[mode] || hasTalent(player, STANCE_TALENT[mode])) {
      player.attackMode = mode
      return mode
    }
  }
  return null
}

export function tryFire(player) {
  if (!hasTalent(player, 'ranged_stance')) return { ok: false, reason: 'not_learned' }
  // …existing body unchanged…
}
```

Add `not_learned: "I don't know how to use this."` to `FIRE_FAIL_MESSAGES`.

`magic.js` `tryGust` — first line of the gate stack:

```js
import { hasTalent } from './talents.js'
// …
  if (!hasTalent(p, 'magic_stance')) return { ok: false, reason: 'not_learned' }
```

`entities.js` `makePlayer` — add `talents: [],` to the returned object (line 123 area) and update the mana comment (`// gust unlocks via the magic_stance talent`).

game.js Shift listener (`game.js:62-68`):

```js
  const mode = toggleAttackMode(state.player)
  if (!mode) { think(state, 'I know no other ways to fight.'); return }
  state.player.charging = null
  think(state, { melee: 'Melee stance.', ranged: 'Ranged stance.', magic: 'Magic stance.' }[mode])
```

game.js magic branch (`game.js:584`): the `cast.reason === 'mana'` message stays; `not_learned` needs no message there (an unlearned stance is unreachable via the cycle — the gate is belt-and-braces).

- [ ] **Step 4: Run** — `npm test` → PASS (fix any other test that built players without `talents`; give combat-test players the talent they exercise).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/ranged.js renderer/systems/magic.js renderer/systems/entities.js renderer/game.js test/ranged.test.js test/magic.test.js
git commit -m "feat(talents): stances are learned — cycle skips, gates refuse"
```

---

### Task 7: HUD and touch — no spoilers

**Files:**
- Modify: `renderer/render/hud.js`, `renderer/ui/touch-controls.js:93-101`
- Test: `test/hud.test.js` (extend)

**Interfaces:**
- Consumes: `player.talents` (plain array read — hud.js stays dependency-light).
- Produces: `#hud-ranged`/`#hud-magic` hidden (`style.display = 'none'`) until the talent is learned; touch stance button shows 🗡/🏹/✨ for the active stance.

- [ ] **Step 1: Extend `test/hud.test.js`** — follow its existing DOM-stub pattern; add:

```js
  it('hides the ranged and magic slots until their talents are learned', () => {
    const els = stubEls()   // reuse the file's existing element-stub helper
    const state = mkState()
    state.player.talents = []
    updateHUD(state)
    assert.equal(els['hud-ranged'].style.display, 'none')
    assert.equal(els['hud-magic'].style.display, 'none')
    state.player.talents = ['ranged_stance', 'magic_stance']
    updateHUD(state)
    assert.equal(els['hud-ranged'].style.display, '')
    assert.equal(els['hud-magic'].style.display, '')
  })
```

(Adapt `stubEls`/`mkState` names to the file's actual helpers; the stub elements need a `style` object if they lack one.)

- [ ] **Step 2: Run** — `node --test test/hud.test.js` → FAIL.

- [ ] **Step 3: Implement in `hud.js`** — inside `updateHUD`, around the existing lines 18-22:

```js
  const talents = player.talents ?? []
  const rangedEl = el('hud-ranged'), magicEl = el('hud-magic')
  rangedEl.style.display = talents.includes('ranged_stance') ? '' : 'none'
  magicEl.style.display = talents.includes('magic_stance') ? '' : 'none'
```

(keep the textContent assignments; they just may be invisible).

- [ ] **Step 4: Touch stance icon** — replace the MutationObserver block (`touch-controls.js:93-101`): observe `#hud-top` and derive the icon from whichever slot carries the `▶` prefix:

```js
  const hudTop = document.getElementById('hud-top')
  const stanceBtn = document.getElementById('touch-stance')
  new MutationObserver(() => {
    const active = ['hud-magic', 'hud-ranged'].find(id =>
      document.getElementById(id).textContent.startsWith('▶'))
    const icon = active === 'hud-magic' ? '✨' : active === 'hud-ranged' ? '🏹' : '🗡'
    if (stanceBtn.textContent !== icon) stanceBtn.textContent = icon
  }).observe(hudTop, { childList: true, characterData: true, subtree: true })
```

- [ ] **Step 5: Run** — `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add renderer/render/hud.js renderer/ui/touch-controls.js test/hud.test.js
git commit -m "feat(hud): locked stances stay hidden; touch icon knows magic"
```

---

### Task 8: Grant wiring — rush ladder, map-clear rewards, arena pre-grants

**Files:**
- Modify: `renderer/game.js:236-248` (arena), `renderer/game.js:838-853` (boss-drop block)

**Interfaces:**
- Consumes: `grantTalent`, `RUSH_TALENT_LADDER`, `MAP_CLEAR_TALENTS`, `TALENTS` from Task 5.
- Produces: talent grants fire in play; Adventure grants persist immediately.

- [ ] **Step 1: Implement the three wirings**

Imports: `import { TALENTS, grantTalent, hasTalent, RUSH_TALENT_LADDER, MAP_CLEAR_TALENTS } from './systems/talents.js'`.

**Arena pre-grant** — in `startNewRun`'s `if (depth === 0 && arenaCfg?.player)` block:

```js
    if (Array.isArray(po.talents)) {
      for (const t of po.talents) {
        if (TALENTS[t]) player.talents.push(t)
        else console.warn(`arena: unknown talent "${t}" — skipped`)
      }
    }
```

**Rush ladder** — in the boss-death block (`game.js:838-853`), after `state.dropSpawned = true`; a rush dungeon is `!state.cave && !OPEN_MAPS[state.level]`:

```js
    if (!state.cave && !OPEN_MAPS[state.level] && RUSH_TALENT_LADDER[state.level]) {
      grantTalent(state, RUSH_TALENT_LADDER[state.level])
    }
```

**Adventure map-clear reward** — same block, inside the existing `if (state.cave) { … }` after `markCleared(…)`:

```js
      const reward = MAP_CLEAR_TALENTS[mapData.name]
      if (reward && grantTalent(state, reward)) { /* persistAdventure() below already runs */ }
```

(the block already ends with `persistAdventure()`, which now snapshots talents — Task 4.)

- [ ] **Step 2: Verify** — `npm test` → PASS. Runtime (rush): `npm start`, Dungeon Rush, `mauno` cheat, kill the depth-1 boss → "Talent learned — Marksmanship!" and the ranged HUD slot appears.

- [ ] **Step 3: Commit**

```bash
git add renderer/game.js
git commit -m "feat(talents): boss ladder, map-clear rewards, arena pre-grants"
```

---

### Task 9: Heavy weapons

**Files:**
- Modify: `renderer/systems/entities.js:18-26` (WEAPON_TYPES), `renderer/systems/loot.js:17-21`, `renderer/game.js:191-195` (buildEntities weapon case)
- Test: `test/inventory.test.js` (already covers the gate), `test/loot.test.js` (extend if present)

**Interfaces:**
- Consumes: `canEquip`'s existing `heavy` gate (Task 1), `hasTalent`.
- Produces: `longsword` and `axe` carry `heavy: true` through every contents path; the Maunonmiekka cheat stays ungated (it writes `player.weapon` directly — deliberate).

- [ ] **Step 1: Flag the weapons** — `entities.js` WEAPON_TYPES:

```js
  longsword: { name: 'Longsword', damage: 3, heavy: true },
  axe:       { name: 'Axe',       damage: 4, heavy: true },
```

- [ ] **Step 2: Carry the flag through contents** — every place a melee-weapon `contents` object is built from `WEAPON_TYPES` must include it:
  - `loot.js:20`: `return { type: 'weapon', weaponType, name: def.name, damage: def.damage, ...(def.heavy && { heavy: true }) }`
  - `game.js` buildEntities `case 'weapon'` (line 194): same spread added to the chest contents object.
  - `entities.js` `makeWeapon` (line 156-159): same spread.

- [ ] **Step 3: Test the flow** — add to `test/inventory.test.js`:

```js
  it('a looted longsword refuses to equip untrained end-to-end', () => {
    const p = mkPlayer()
    const contents = { type: 'weapon', weaponType: 'longsword', name: 'Longsword', damage: 3, heavy: true }
    autoEquipOnPickup(p, itemFromContents(contents))
    assert.equal(p.weapon, null)
    assert.equal(p.inventory.length, 1)
    p.talents = ['heavy_weapons']
    assert.equal(equipItem(p, 0).ok, true)
    assert.equal(p.weapon.heavy, true)
  })
```

- [ ] **Step 4: Run** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/entities.js renderer/systems/loot.js renderer/game.js test/inventory.test.js
git commit -m "feat(talents): longsword and axe are heavy — Might gates the grip"
```

---

### Task 10: Rites — trance, mushroom circle, wild mushrooms

**Files:**
- Create: `renderer/systems/rites.js`, `renderer/data/rites.js`
- Modify: `renderer/systems/openmap.js`, `renderer/game.js` (buildEntities cases, pickup, eat, trigger check)
- Test: `test/rites.test.js`, `test/openmap.test.js` (extend or create)

**Interfaces:**
- Consumes: `grantTalent`, `hasTalent` (Task 5); `makeItem`, `removeItem` (Task 1).
- Produces:
  - `data/rites.js`: `MAP_RITES = { 'forest-1-clearings': [{ fromPoi: 'mushroom ring', talent: 'magic_stance', rite: 'mushroom_circle' }] }`
  - `systems/rites.js`: `TRANCE_DURATION = 60`, `RITE_DURATION = 3.5`, `startTrance(player)`, `tickTrance(player, dt)`, `riteConditionMet(riteId, state)`, `riteVisuals(state)` → `{ wobbleX, wobbleY, blur, greenAlpha }` (Task 11 renders these)
  - `openmap.js` emits `talent_trigger` spawns from `MAP_RITES` and deterministic `wild_mushroom` spawns
  - game.js: walk-onto mushroom pickup; Eat starts the trance; stepping on a trigger while entranced runs the ceremony and grants.

- [ ] **Step 1: Write failing tests**

```js
// test/rites.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TRANCE_DURATION, RITE_DURATION, startTrance, tickTrance, riteConditionMet, riteVisuals }
  from '../renderer/systems/rites.js'

describe('trance', () => {
  it('lasts TRANCE_DURATION seconds and then fades', () => {
    const p = {}
    startTrance(p)
    assert.equal(p.trance, TRANCE_DURATION)
    tickTrance(p, TRANCE_DURATION - 1)
    assert.ok(p.trance > 0)
    tickTrance(p, 2)
    assert.equal(p.trance, 0)
  })

  it('eating again refreshes the timer', () => {
    const p = {}
    startTrance(p); tickTrance(p, 50); startTrance(p)
    assert.equal(p.trance, TRANCE_DURATION)
  })
})

describe('mushroom_circle condition', () => {
  it('is met only while entranced', () => {
    assert.equal(riteConditionMet('mushroom_circle', { player: { trance: 10 } }), true)
    assert.equal(riteConditionMet('mushroom_circle', { player: { trance: 0 } }), false)
    assert.equal(riteConditionMet('mushroom_circle', { player: {} }), false)
  })

  it('unknown rites are never met', () => {
    assert.equal(riteConditionMet('moon_dance', { player: { trance: 10 } }), false)
  })
})

describe('riteVisuals', () => {
  it('is inert with no trance and no rite', () => {
    const v = riteVisuals({ player: {} })
    assert.deepEqual(v, { wobbleX: 0, wobbleY: 0, blur: 0, greenAlpha: 0 })
  })

  it('trance wobbles subtly without blur', () => {
    const v = riteVisuals({ player: { trance: 30, tranceT: 1.3 } })
    assert.ok(Math.abs(v.wobbleX) <= 2)
    assert.equal(v.blur, 0)
    assert.equal(v.greenAlpha, 0)
  })

  it('the ceremony ramps blur and green up and back down', () => {
    const mk = t => riteVisuals({ player: {}, rite: { t, dur: RITE_DURATION } })
    assert.ok(mk(RITE_DURATION / 2).blur > mk(0.1).blur)
    assert.ok(mk(RITE_DURATION / 2).greenAlpha > 0)
    assert.ok(mk(RITE_DURATION - 0.05).blur < mk(RITE_DURATION / 2).blur)
  })
})
```

```js
// test/openmap.test.js — append (create with this if missing)
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildOpenMap } from '../renderer/systems/openmap.js'

// Synthetic 8x8 map: a mushroom-ring poi at (4,4) and two ow_mushroom props.
const mkData = () => ({
  name: 'forest-1-clearings', w: 8, h: 8,
  palette: ['ow_grass_0', 'ow_mushroom'],
  ground: Array.from({ length: 8 }, () => Array(8).fill(0)),
  prop:   Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) =>
    (y === 2 && (x === 2 || x === 5)) ? 1 : -1)),
  walk:   Array.from({ length: 8 }, () => '11111111'),
  pois: [{ kind: 'landmark', x: 4, y: 4, label: 'mushroom ring' }],
  playerSpawn: { x: 1, y: 1 },
})

describe('rite spawns on open maps', () => {
  it('emits a talent_trigger at the rite poi', () => {
    const { entitySpawns } = buildOpenMap(mkData())
    const trig = entitySpawns.find(s => s.kind === 'talent_trigger')
    assert.deepEqual(trig, { kind: 'talent_trigger', x: 4, y: 4, talent: 'magic_stance', rite: 'mushroom_circle' })
  })

  it('spawns wild mushrooms beside mushroom props, deterministically', () => {
    const a = buildOpenMap(mkData()).entitySpawns.filter(s => s.kind === 'wild_mushroom')
    const b = buildOpenMap(mkData()).entitySpawns.filter(s => s.kind === 'wild_mushroom')
    assert.ok(a.length >= 1)
    assert.deepEqual(a, b)
  })

  it('maps without rites emit neither', () => {
    const data = { ...mkData(), name: 'desert-1-dunes', pois: [] }
    const spawns = buildOpenMap(data).entitySpawns
    assert.equal(spawns.some(s => s.kind === 'talent_trigger'), false)
  })
})
```

- [ ] **Step 2: Run** — both files FAIL (modules/spawns missing).

- [ ] **Step 3: Implement**

`renderer/data/rites.js`:

```js
// Rite placements per open map: which landmark POI anchors which ceremony.
// The trigger is invisible in play — the world art (the mushroom ring) is
// the only clue. See systems/rites.js for conditions and visuals.
export const MAP_RITES = {
  'forest-1-clearings': [
    { fromPoi: 'mushroom ring', talent: 'magic_stance', rite: 'mushroom_circle' },
  ],
}
```

`renderer/systems/rites.js`:

```js
// Secret unlock ceremonies. A rite is a named condition + a short screen
// ceremony; the trigger tiles come from data/rites.js via openmap.js.
// Pure: no DOM, no canvas — riteVisuals returns numbers for the renderer.

export const TRANCE_DURATION = 60   // s of mushroom trance
export const RITE_DURATION = 3.5    // s of ceremony lock

export function startTrance(player) {
  player.trance = TRANCE_DURATION
  player.tranceT = player.tranceT ?? 0
}

export function tickTrance(player, dt) {
  if (!(player.trance > 0)) return
  player.trance = Math.max(0, player.trance - dt)
  player.tranceT = (player.tranceT ?? 0) + dt
}

const CONDITIONS = {
  mushroom_circle: state => (state.player.trance ?? 0) > 0,
}

export function riteConditionMet(riteId, state) {
  return CONDITIONS[riteId]?.(state) ?? false
}

// One number bundle for the renderer: subtle sine wobble while entranced;
// during the ceremony a sin(pi*t) envelope ramps wobble, blur and the sickly
// green up and back down.
export function riteVisuals(state) {
  const out = { wobbleX: 0, wobbleY: 0, blur: 0, greenAlpha: 0 }
  const p = state.player
  if (p.trance > 0) {
    const t = p.tranceT ?? 0
    out.wobbleX = Math.sin(t * 1.7) * 1.5
    out.wobbleY = Math.cos(t * 1.3) * 1.5
  }
  if (state.rite) {
    const k = Math.sin(Math.PI * Math.min(1, state.rite.t / state.rite.dur))
    out.wobbleX = Math.sin(state.rite.t * 9) * 6 * k
    out.wobbleY = Math.cos(state.rite.t * 7) * 6 * k
    out.blur = 3 * k
    out.greenAlpha = 0.35 * k
  }
  return out
}
```

`openmap.js` — imports `MAP_RITES` from `../data/rites.js`; before the `return`:

```js
  // Rite triggers: invisible walk-onto spawns anchored to named landmark POIs.
  for (const rite of MAP_RITES[data.name] ?? []) {
    const poi = data.pois.find(p => p.kind === 'landmark' && p.label === rite.fromPoi)
    if (poi) entitySpawns.push({ kind: 'talent_trigger', x: poi.x, y: poi.y, talent: rite.talent, rite: rite.rite })
    else console.warn(`rites: poi "${rite.fromPoi}" not found on ${data.name}`)
  }
  // Wild mushrooms: pickable, colour-shifting. Deterministic — every third
  // walkable cell adjacent to a mushroom prop, row-major, capped at 8.
  if (MAP_RITES[data.name]) {
    const spots = []
    const mushroomProp = i => i >= 0 && data.palette[i] === 'ow_mushroom'
    for (let y = 1; y < data.h - 1; y++) for (let x = 1; x < data.w - 1; x++) {
      if (!mushroomProp(data.prop[y][x])) continue
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (map[ny][nx].tile === TILE.FLOOR && data.prop[ny][nx] < 0) { spots.push({ x: nx, y: ny }); break }
      }
    }
    spots.filter((_, i) => i % 3 === 0).slice(0, 8)
      .forEach(s => entitySpawns.push({ kind: 'wild_mushroom', x: s.x, y: s.y }))
  }
```

game.js `buildEntities` — two new cases before `default`:

```js
      case 'talent_trigger': return [{ type: 'talent_trigger', x: s.x, y: s.y, talent: s.talent, rite: s.rite }]
      case 'wild_mushroom':  return [{ type: 'wild_mushroom', x: s.x, y: s.y, hueT: (s.x * 7 + s.y * 13) % 10 }]
```

game.js update loop — walk-onto mushroom pickup (next to the key pickup block):

```js
  // Wild mushrooms: walk-onto pickup into the sack
  const shroomIdx = state.entities.findIndex(e => e.type === 'wild_mushroom' && e.x === player.x && e.y === player.y)
  if (shroomIdx !== -1 && grantContents({ type: 'mushroom' })) {
    state.entities = state.entities.filter((_, i) => i !== shroomIdx)
  }
```

game.js — eating (extend Task 3's `useInventoryItem`):

```js
  if (item.kind === 'mushroom') {
    removeItem(state.player, i)
    startTrance(state.player)
    think(state, 'It tastes… strange.')
    closeInventory()
  }
```

game.js update loop — tick + trigger + ceremony. At the very top of `update(delta)`, after `if (!state) return`:

```js
  // A running rite is a short cutscene: the world holds its breath.
  if (state.rite) {
    state.rite.t += delta
    if (state.rite.t >= state.rite.dur) {
      const talent = state.rite.talent
      state.rite = null
      state.player.trance = 0
      if (grantTalent(state, talent) && OPEN_MAPS[state.cave ? state.cave.surface.level : state.level]) persistAdventure()
    }
    tickFeedback(state.feedback, delta)
    return
  }
```

And next to the other walk-onto checks:

```js
  // Rite triggers: silent unless the rite's condition holds
  tickTrance(player, delta)
  const trigger = state.entities.find(e => e.type === 'talent_trigger' && e.x === player.x && e.y === player.y)
  if (trigger && !hasTalent(player, trigger.talent) && riteConditionMet(trigger.rite, state)) {
    state.rite = { t: 0, dur: RITE_DURATION, talent: trigger.talent }
  }
```

Imports: `import { startTrance, tickTrance, riteConditionMet, RITE_DURATION, riteVisuals } from './systems/rites.js'`.

- [ ] **Step 4: Run** — `node --test test/rites.test.js test/openmap.test.js` → PASS; `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/rites.js renderer/data/rites.js renderer/systems/openmap.js renderer/game.js test/rites.test.js test/openmap.test.js
git commit -m "feat(rites): mushroom-circle rite — trance, trigger, ceremony grant"
```

---

### Task 11: Rite & mushroom visuals

**Files:**
- Modify: `renderer/render/canvas.js` (`updateCamera` wobble, post-blur + green overlay, player tint, `wild_mushroom` draw), `renderer/game.js:868-873` (`render()`)

**Interfaces:**
- Consumes: `riteVisuals(state)` from Task 10 (numbers only — all canvas work lives here).
- Produces: trance = subtle world wobble; ceremony = wobble + whole-frame blur + green vignette + green-tinted player; wild mushrooms hue-cycle in place.

- [ ] **Step 1: Camera wobble** — in game.js `render()`:

```js
function render() {
  maybeComputeFOV(state.map, state.player)
  const fx = riteVisuals(state)
  renderer.updateCamera(state.player, state.shake ?? 0, fx)
  renderer.render(state, fx)
  updateHUD(state)
}
```

`canvas.js updateCamera(player, shake = 0, fx = null)` — add `if (fx) { this.camX += fx.wobbleX; this.camY += fx.wobbleY }` after the shake offset.

- [ ] **Step 2: Post-effects in `Renderer.render(state, fx = null)`** — at the end of the scene draw (after health bars/projectiles, before returning):

```js
    // Rite ceremony: blur the finished frame onto itself, wash it green.
    if (fx && (fx.blur > 0 || fx.greenAlpha > 0)) {
      if (fx.blur > 0) {
        ctx.save()
        ctx.filter = `blur(${fx.blur.toFixed(1)}px)`
        ctx.drawImage(this.canvas, 0, 0, this.viewW, this.viewH)
        ctx.restore()
      }
      if (fx.greenAlpha > 0) {
        ctx.fillStyle = `rgba(74, 222, 128, ${fx.greenAlpha})`
        ctx.fillRect(0, 0, this.viewW, this.viewH)
      }
    }
```

Note: `ctx.drawImage(this.canvas, …)` self-draw uses the DPR-scaled backing store — draw with explicit destination `0, 0, this.viewW, this.viewH` and source `0, 0, this.canvas.width, this.canvas.height` (9-arg form) so the blur pass doesn't rescale.

- [ ] **Step 3: Sickly player** — beside the existing `player.grabbed` red flash (`canvas.js:787-793`), add:

```js
    if (fx && fx.greenAlpha > 0) {
      ctx.save()
      ctx.globalAlpha = Math.min(0.6, fx.greenAlpha * 1.6)
      ctx.fillStyle = '#4ade80'
      ctx.fillRect(ppx, ppy, S, S)
      ctx.restore()
    }
```

- [ ] **Step 4: Wild mushroom draw** — in `drawEntity`, before the final switch:

```js
  if (entity.type === 'wild_mushroom') {
    const s = sprites.ow_mushroom
    const deg = Math.round(((entity.hueT ?? 0) * 60) % 360)
    ctx.save()
    ctx.filter = `hue-rotate(${deg}deg) saturate(1.6)`
    if (s) ctx.drawImage(s, px, py, S, S)
    else { ctx.font = `${Math.round(S * 0.8)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🍄', px + S / 2, py + S / 2) }
    ctx.restore()
    return
  }
```

And advance the hue in game.js next to the fountain timers (`game.js:788-792`):

```js
    if (e.type === 'wild_mushroom') e.hueT = (e.hueT ?? 0) + delta
```

(`talent_trigger` gets **no** draw case — invisible by design.)

- [ ] **Step 5: Verify at runtime** — `npm test` (PASS), then the full rite loop: `npm start` → Adventure on forest-1 → find a colour-shifting mushroom, pick it up, eat via I-panel (notice the subtle wobble), walk to the mushroom ring center → blur/swerve/green ceremony → "Talent learned — Gust of Wind!" and the magic HUD slot appears. Keep the session short; if the map makes this slow, verify trance visuals in an arena run and the trigger via the openmap tests.

- [ ] **Step 6: Commit**

```bash
git add renderer/render/canvas.js renderer/game.js
git commit -m "feat(rites): trance wobble, ceremony blur and sickly green, hue-shifting mushrooms"
```

---

### Task 12: Integration pass & docs

**Files:**
- Modify: `CLAUDE.md` (dungeon-crawler architecture bullet), memory index if warranted
- No new code — verification and cleanup.

- [ ] **Step 1: Full suite** — `npm test` → all green.

- [ ] **Step 2: Runtime sweep (time-boxed, ≤10 min)** — using the arena-test skill where possible:
  - Arena config with `player: { talents: ['magic_stance'] }` → gust works; without → Shift says "I know no other ways to fight." and Space in melee still swings.
  - Dungeon Rush depth 1: bow from a chest lands in the pack (ranged HUD hidden), boss kill announces Marksmanship, bow equips from the panel.
  - Adventure: save v3 round-trip (quit + relaunch keeps talents, hands, sack).
  - Check `git status renderer/data/` afterwards (editor autosave hazard).

- [ ] **Step 3: Update CLAUDE.md** — in the dungeon-crawler architecture section's systems list, extend with: `talents` (learned stances/abilities, rite + ladder grants), `inventory` (loot sack + equip rules), `rites` (trance & ceremonies); note the `ui/inventory-panel.js` overlay.

- [ ] **Step 4: Spec future-tasks reminder** — confirm the spec's future-task list (death-drop retrieval, consumable quick-slot, rites for ranged/heavy, shield, NPCs, gems) still matches what shipped; amend the spec if any interim behavior differs.

- [ ] **Step 5: Final commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs: talents & inventory shipped — architecture notes updated"
```
