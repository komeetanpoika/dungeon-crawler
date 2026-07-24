# Ranged Attack Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shift becomes a melee/ranged stance toggle, Space attacks in the active stance, and firing requires a chest-looted projectile weapon (2 bows, 2 wands) whose ammo depletes per shot.

**Architecture:** New pure-logic modules `renderer/systems/ranged.js` (stance toggle + fire gating/ammo) and `renderer/systems/loot.js` (random chest loot table), new data in `renderer/systems/entities.js` (`RANGED_WEAPON_TYPES`, player `ranged`/`attackMode` fields), wired into `renderer/game.js` (input + combat + chest pickup). Rendering/HUD additions in `renderer/render/canvas.js`, `renderer/render/hud.js`, `renderer/index.html`, `renderer/render/sprites.js`.

**Tech Stack:** Vanilla JS ES modules (no bundler), Electron + web release, `node:test` in `test/`, `playwright-core` chromium for one-shot sprite generation.

**Spec:** `docs/superpowers/specs/2026-07-24-ranged-rework-design.md`

## Global Constraints

- Run tests with `npm test` (= `node --test test/`) from the repo root. The whole suite must be green at every commit.
- All game logic that needs unit tests lives in `renderer/systems/` modules — `renderer/game.js` has module-level `window` listeners and is NOT importable from node tests. Keep game.js changes to thin wiring.
- Roster (exact values): shortbow — Shortbow, 2 dmg, 12 ammo, 0.6s cooldown, color `#facc15`; longbow — Longbow, 3 dmg, 10 ammo, 0.7s, `#facc15`; sparkwand — Spark Wand, 2 dmg, 16 ammo, 0.45s, `#22d3ee`; stormwand — Storm Wand, 5 dmg, 6 ammo, 0.8s, `#a78bfa`.
- Loot table (exact): roll `r = rng()`; `r < 0.4` → potion(4); `r < 0.7` → melee weapon; else → ranged weapon. Depth tiers: depth ≤ 2 shallow (`dagger`/`sword`, `shortbow`/`sparkwand`), depth ≥ 3 deep (`longsword`/`axe`, `longbow`/`stormwand`).
- Stance toggle always works (even with no ranged weapon / zero ammo). Firing failures produce HUD log messages (`Nothing to shoot with!` / `Out of ammo!`), throttled; cooldown failures are silent.
- Do NOT touch `renderer/web-shim.js` — Shift has no browser default action, so `GAME_KEYS` needs no change (decision recorded in spec).
- Do NOT change enemy projectiles, wizard shield absorption, or dragon-boss ranged immunity — those code paths in game.js stay as-is.
- Commit after every task. If any automated run touches the editor, check `git status renderer/data/` afterwards (editor autosave hazard) — nothing there should change in this work.

---

### Task 1: Ranged weapon data + player slots (`entities.js`)

**Files:**
- Modify: `renderer/systems/entities.js` (after `WEAPON_TYPES`, ~line 26; and `makePlayer`, ~line 93)
- Test: `test/ranged.test.js` (create)

**Interfaces:**
- Produces: `RANGED_WEAPON_TYPES` (map of `{ name, damage, maxAmmo, cooldown, color, kind }`), `makeRangedContents(weaponType) → { type:'ranged', weaponType, name, damage, ammo, maxAmmo, cooldown, color, kind }`, and `makePlayer()` result gains `ranged: null`, `attackMode: 'melee'`. Later tasks import all three names from `../renderer/systems/entities.js`.

- [ ] **Step 1: Write the failing tests**

Create `test/ranged.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RANGED_WEAPON_TYPES, makeRangedContents, makePlayer } from '../renderer/systems/entities.js'

describe('RANGED_WEAPON_TYPES', () => {
  it('defines the four-weapon roster with full stat blocks', () => {
    assert.deepEqual(Object.keys(RANGED_WEAPON_TYPES), ['shortbow', 'longbow', 'sparkwand', 'stormwand'])
    for (const [wt, def] of Object.entries(RANGED_WEAPON_TYPES)) {
      assert.equal(typeof def.name, 'string', wt)
      assert.ok(def.damage > 0 && def.maxAmmo > 0 && def.cooldown > 0, wt)
      assert.match(def.color, /^#[0-9a-f]{6}$/, wt)
      assert.ok(def.kind === 'bow' || def.kind === 'wand', wt)
    }
  })

  it('bows are bows and wands are wands', () => {
    assert.equal(RANGED_WEAPON_TYPES.shortbow.kind, 'bow')
    assert.equal(RANGED_WEAPON_TYPES.longbow.kind, 'bow')
    assert.equal(RANGED_WEAPON_TYPES.sparkwand.kind, 'wand')
    assert.equal(RANGED_WEAPON_TYPES.stormwand.kind, 'wand')
  })
})

describe('makeRangedContents', () => {
  it('builds full-ammo chest contents from a weapon type', () => {
    const c = makeRangedContents('stormwand')
    assert.deepEqual(c, {
      type: 'ranged', weaponType: 'stormwand', name: 'Storm Wand',
      damage: 5, ammo: 6, maxAmmo: 6, cooldown: 0.8, color: '#a78bfa', kind: 'wand',
    })
  })

  it('falls back to shortbow for unknown types', () => {
    assert.equal(makeRangedContents('bazooka').weaponType, 'shortbow')
    assert.equal(makeRangedContents().weaponType, 'shortbow')
  })
})

describe('makePlayer ranged fields', () => {
  it('starts with no ranged weapon, in melee stance', () => {
    const p = makePlayer(1, 1)
    assert.equal(p.ranged, null)
    assert.equal(p.attackMode, 'melee')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/ranged.test.js` — if flags don't pass through, use `node --test test/ranged.test.js`.
Expected: FAIL — `RANGED_WEAPON_TYPES` / `makeRangedContents` not exported.

- [ ] **Step 3: Implement**

In `renderer/systems/entities.js`, directly after the `WEAPON_TYPES` block (ends line 26), add:

```js
// Projectile weapons — looted from chests, never a starting item. `ammo`
// depletes per shot and is only refilled by picking up a new weapon.
// `kind` drives projectile rendering (arrows are elongated, wand bolts square).
export const RANGED_WEAPON_TYPES = {
  shortbow:  { name: 'Shortbow',   damage: 2, maxAmmo: 12, cooldown: 0.6,  color: '#facc15', kind: 'bow' },
  longbow:   { name: 'Longbow',    damage: 3, maxAmmo: 10, cooldown: 0.7,  color: '#facc15', kind: 'bow' },
  sparkwand: { name: 'Spark Wand', damage: 2, maxAmmo: 16, cooldown: 0.45, color: '#22d3ee', kind: 'wand' },
  stormwand: { name: 'Storm Wand', damage: 5, maxAmmo: 6,  cooldown: 0.8,  color: '#a78bfa', kind: 'wand' },
}

export function makeRangedContents(weaponType = 'shortbow') {
  const wt = RANGED_WEAPON_TYPES[weaponType] ? weaponType : 'shortbow'
  const def = RANGED_WEAPON_TYPES[wt]
  return {
    type: 'ranged', weaponType: wt, name: def.name, damage: def.damage,
    ammo: def.maxAmmo, maxAmmo: def.maxAmmo, cooldown: def.cooldown,
    color: def.color, kind: def.kind,
  }
}
```

In `makePlayer` (line 96-102), extend the returned object's last line:

```js
    bonuses, weapon: null, ranged: null, attackMode: 'melee',
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS (all files).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/entities.js test/ranged.test.js
git commit -m "feat(ranged): projectile weapon roster + player ranged slot and stance field"
```

---

### Task 2: Stance toggle + fire logic (`systems/ranged.js`)

**Files:**
- Create: `renderer/systems/ranged.js`
- Test: `test/ranged.test.js` (extend)

**Interfaces:**
- Consumes: player object fields from Task 1 (`ranged`, `attackMode`) plus the existing `rangedCooldown` number game.js maintains.
- Produces: `toggleAttackMode(player) → 'melee'|'ranged'`; `tryFire(player) → { ok:true, damage, color, shape:'arrow'|'bolt' } | { ok:false, reason:'no_weapon'|'no_ammo'|'cooldown' }` (on success mutates `player.ranged.ammo` down 1 and sets `player.rangedCooldown` to the weapon's cooldown); `FIRE_FAIL_MESSAGES` map keyed by `no_weapon`/`no_ammo`. Task 7 imports all three from `./systems/ranged.js`.

- [ ] **Step 1: Write the failing tests**

Append to `test/ranged.test.js`:

```js
import { toggleAttackMode, tryFire, FIRE_FAIL_MESSAGES } from '../renderer/systems/ranged.js'

function armedPlayer(over = {}) {
  return { ...makePlayer(1, 1), rangedCooldown: 0, ranged: makeRangedContents('shortbow'), ...over }
}

describe('toggleAttackMode', () => {
  it('flips melee <-> ranged and returns the new mode', () => {
    const p = makePlayer(1, 1)
    assert.equal(toggleAttackMode(p), 'ranged')
    assert.equal(p.attackMode, 'ranged')
    assert.equal(toggleAttackMode(p), 'melee')
  })

  it('toggles even with no ranged weapon or empty ammo', () => {
    const bare = makePlayer(1, 1)
    assert.equal(toggleAttackMode(bare), 'ranged')
    const empty = armedPlayer()
    empty.ranged.ammo = 0
    assert.equal(toggleAttackMode(empty), 'ranged')
    assert.equal(empty.attackMode, 'ranged')  // running dry never snaps back
  })
})

describe('tryFire', () => {
  it('fires: returns projectile stats, spends 1 ammo, starts the weapon cooldown', () => {
    const p = armedPlayer()
    const res = tryFire(p)
    assert.deepEqual(res, { ok: true, damage: 2, color: '#facc15', shape: 'arrow' })
    assert.equal(p.ranged.ammo, 11)
    assert.equal(p.rangedCooldown, 0.6)
  })

  it('wands fire square bolts', () => {
    const p = armedPlayer({ ranged: makeRangedContents('sparkwand') })
    assert.equal(tryFire(p).shape, 'bolt')
  })

  it('refuses without a weapon and spends nothing', () => {
    const p = armedPlayer({ ranged: null })
    assert.deepEqual(tryFire(p), { ok: false, reason: 'no_weapon' })
    assert.equal(p.rangedCooldown, 0)
  })

  it('refuses at 0 ammo', () => {
    const p = armedPlayer()
    p.ranged.ammo = 0
    assert.deepEqual(tryFire(p), { ok: false, reason: 'no_ammo' })
  })

  it('refuses during cooldown without spending ammo', () => {
    const p = armedPlayer({ rangedCooldown: 0.3 })
    assert.deepEqual(tryFire(p), { ok: false, reason: 'cooldown' })
    assert.equal(p.ranged.ammo, 12)
  })

  it('projectile damage comes from the ranged weapon, never the melee weapon', () => {
    const p = armedPlayer({ weapon: { weaponType: 'maunonmiekka', name: 'Maunonmiekka', damage: 10 } })
    assert.equal(tryFire(p).damage, 2)
  })

  it('has HUD messages for weaponless and empty fails, none for cooldown', () => {
    assert.equal(typeof FIRE_FAIL_MESSAGES.no_weapon, 'string')
    assert.equal(typeof FIRE_FAIL_MESSAGES.no_ammo, 'string')
    assert.equal(FIRE_FAIL_MESSAGES.cooldown, undefined)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/ranged.test.js`
Expected: FAIL — cannot resolve `../renderer/systems/ranged.js`.

- [ ] **Step 3: Implement**

Create `renderer/systems/ranged.js`:

```js
// Melee/ranged stance and projectile firing. Pure player-state logic —
// game.js owns projectile spawning, log messages, and input.

export function toggleAttackMode(player) {
  player.attackMode = player.attackMode === 'ranged' ? 'melee' : 'ranged'
  return player.attackMode
}

// Attempt to fire the equipped ranged weapon. On success spends 1 ammo,
// starts the weapon's cooldown, and returns the projectile's combat stats.
export function tryFire(player) {
  if (!player.ranged) return { ok: false, reason: 'no_weapon' }
  if (player.ranged.ammo <= 0) return { ok: false, reason: 'no_ammo' }
  if (player.rangedCooldown > 0) return { ok: false, reason: 'cooldown' }
  player.ranged.ammo -= 1
  player.rangedCooldown = player.ranged.cooldown
  return {
    ok: true,
    damage: player.ranged.damage,
    color: player.ranged.color,
    shape: player.ranged.kind === 'bow' ? 'arrow' : 'bolt',
  }
}

// HUD log lines per fail reason. Cooldown fails stay silent.
export const FIRE_FAIL_MESSAGES = {
  no_weapon: 'Nothing to shoot with!',
  no_ammo: 'Out of ammo!',
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/ranged.js test/ranged.test.js
git commit -m "feat(ranged): stance toggle and ammo-gated fire logic"
```

---

### Task 3: Random chest loot (`systems/loot.js`)

**Files:**
- Create: `renderer/systems/loot.js`
- Test: `test/loot.test.js` (create)

**Interfaces:**
- Consumes: `WEAPON_TYPES`, `makeRangedContents` from `./entities.js` (Task 1).
- Produces: `rollChestLoot(depth, rng = Math.random) → contents` where contents is one of `{ type:'potion', amount:4 }`, `{ type:'weapon', weaponType, name, damage }`, or the Task-1 `type:'ranged'` shape. Task 7 imports it from `./systems/loot.js`. `rng` is called up to twice: category roll, then weapon pick.

- [ ] **Step 1: Write the failing tests**

Create `test/loot.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rollChestLoot } from '../renderer/systems/loot.js'

// rng stub that returns the given values in order.
function seq(...vals) { let i = 0; return () => vals[i++] ?? 0 }

describe('rollChestLoot categories', () => {
  it('r < 0.4 is a potion', () => {
    assert.deepEqual(rollChestLoot(1, seq(0.0)), { type: 'potion', amount: 4 })
    assert.deepEqual(rollChestLoot(1, seq(0.399)), { type: 'potion', amount: 4 })
  })

  it('0.4 <= r < 0.7 is a melee weapon with full stats', () => {
    const c = rollChestLoot(1, seq(0.4, 0.0))
    assert.deepEqual(c, { type: 'weapon', weaponType: 'dagger', name: 'Dagger', damage: 1 })
  })

  it('r >= 0.7 is a full-ammo ranged weapon', () => {
    const c = rollChestLoot(1, seq(0.7, 0.0))
    assert.equal(c.type, 'ranged')
    assert.equal(c.weaponType, 'shortbow')
    assert.equal(c.ammo, c.maxAmmo)
  })
})

describe('rollChestLoot depth tiers', () => {
  it('shallow (depth <= 2) draws from the light pools', () => {
    assert.equal(rollChestLoot(2, seq(0.4, 0.99)).weaponType, 'sword')
    assert.equal(rollChestLoot(2, seq(0.99, 0.99)).weaponType, 'sparkwand')
  })

  it('deep (depth >= 3) draws from the heavy pools', () => {
    assert.equal(rollChestLoot(3, seq(0.4, 0.0)).weaponType, 'longsword')
    assert.equal(rollChestLoot(3, seq(0.4, 0.99)).weaponType, 'axe')
    assert.equal(rollChestLoot(5, seq(0.99, 0.0)).weaponType, 'longbow')
    assert.equal(rollChestLoot(5, seq(0.99, 0.99)).weaponType, 'stormwand')
  })

  it('never yields the cheat sword', () => {
    for (let i = 0; i < 200; i++) {
      const c = rollChestLoot(5)
      assert.notEqual(c.weaponType, 'maunonmiekka')
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/loot.test.js`
Expected: FAIL — cannot resolve `../renderer/systems/loot.js`.

- [ ] **Step 3: Implement**

Create `renderer/systems/loot.js`:

```js
import { WEAPON_TYPES, makeRangedContents } from './entities.js'

// Random chest loot: potion 40% / melee weapon 30% / ranged weapon 30%.
// Weapon tier scales with depth, mirroring LEVEL_CONFIG's melee progression.
const MELEE_POOLS  = { shallow: ['dagger', 'sword'],       deep: ['longsword', 'axe'] }
const RANGED_POOLS = { shallow: ['shortbow', 'sparkwand'], deep: ['longbow', 'stormwand'] }
const DEEP_FROM = 3

function pick(pool, rng) {
  return pool[Math.min(Math.floor(rng() * pool.length), pool.length - 1)]
}

export function rollChestLoot(depth, rng = Math.random) {
  const tier = depth >= DEEP_FROM ? 'deep' : 'shallow'
  const r = rng()
  if (r < 0.4) return { type: 'potion', amount: 4 }
  if (r < 0.7) {
    const weaponType = pick(MELEE_POOLS[tier], rng)
    const def = WEAPON_TYPES[weaponType]
    return { type: 'weapon', weaponType, name: def.name, damage: def.damage }
  }
  return makeRangedContents(pick(RANGED_POOLS[tier], rng))
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/loot.js test/loot.test.js
git commit -m "feat(loot): depth-tiered random chest loot table"
```

---

### Task 4: Sprites — wand tile mappings + generated bow art

**Files:**
- Modify: `renderer/render/sprites.js:49-55` (items block)
- Create: `renderer/assets/tiles/weapon_shortbow.png`, `renderer/assets/tiles/weapon_longbow.png` (generated)
- Test: `test/sprites.test.js` (extend)

**Interfaces:**
- Produces: sprite keys `weapon_shortbow`, `weapon_longbow`, `weapon_sparkwand`, `weapon_stormwand` resolvable in the loaded sprites map — canvas.js already looks up `weapon_${weaponType}` generically, so no canvas change is needed for these to render.

Background: the Kenney Tiny Dungeon sheet has two staff/wand tiles — `tile_0129` (purple-tipped) and `tile_0130` (cyan-tipped) — but **no bow**, so the bows get custom 16×16 pixel-art PNGs generated once via headless chromium (same pattern as the repo's other custom art, e.g. `weapon_maunonmiekka.png`).

- [ ] **Step 1: Write the failing tests**

In `test/sprites.test.js`, after the existing weapons assertions, add a new describe block (the file's existing "every sprite key points to a real file" test will also start failing until the PNGs exist — that is the point):

```js
describe('ranged weapons', () => {
  it('weapon_sparkwand = tile_0130 (cyan-tipped wand)',   () => assert.equal(SPRITES.weapon_sparkwand, 'tile_0130'))
  it('weapon_stormwand = tile_0129 (purple-tipped wand)', () => assert.equal(SPRITES.weapon_stormwand, 'tile_0129'))
  it('bows use custom art (no bow in the tileset)', () => {
    assert.equal(SPRITES.weapon_shortbow, 'weapon_shortbow')
    assert.equal(SPRITES.weapon_longbow, 'weapon_longbow')
  })
})
```

- [ ] **Step 2: Add the sprite mappings, run tests to see the asset-existence failure**

In `renderer/render/sprites.js`, after line 54 (`weapon_maunonmiekka: ...`), add:

```js
  weapon_shortbow:  'weapon_shortbow',    // custom art — tileset has no bow
  weapon_longbow:   'weapon_longbow',     // custom art — tileset has no bow
  weapon_sparkwand: 'tile_0130',
  weapon_stormwand: 'tile_0129',
```

Run: `node --test test/sprites.test.js`
Expected: FAIL — "every sprite key points to a real file" reports `weapon_shortbow → weapon_shortbow.png` and `weapon_longbow → weapon_longbow.png` missing. The three mapping assertions pass.

- [ ] **Step 3: Generate the bow PNGs**

Write this one-shot script to the session scratchpad directory (NOT the repo) as `gen-bows.mjs` and run it **from the repo root** (playwright-core resolves there):

```js
import { chromium } from 'playwright-core'
import fs from 'node:fs'

// 16x16 pixel maps. '.'=transparent  w=wood  d=dark wood  s=string  g=gold tip
const PAL = { w: '#8a5a2b', d: '#5c3a1e', s: '#e8e0cf', g: '#e8b84b' }
const ART = {
  weapon_shortbow: [
    '................',
    '......ww........',
    '.....wdds.......',
    '.....wd.s.......',
    '......wd.s......',
    '......wd.s......',
    '......wd..s.....',
    '.......wd.s.....',
    '......wd..s.....',
    '......wd.s......',
    '......wd.s......',
    '.....wd.s.......',
    '.....wdds.......',
    '......ww........',
    '................',
    '................',
  ],
  weapon_longbow: [
    '......gg........',
    '.....gdds.......',
    '.....wd.s.......',
    '.....wd..s......',
    '......wd.s......',
    '......wd..s.....',
    '......wd..s.....',
    '.......wd.s.....',
    '.......wd.s.....',
    '......wd..s.....',
    '......wd..s.....',
    '......wd.s......',
    '.....wd..s......',
    '.....wd.s.......',
    '.....gdds.......',
    '......gg........',
  ],
}

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [name, rows] of Object.entries(ART)) {
  const dataUrl = await page.evaluate(({ rows, PAL }) => {
    const c = document.createElement('canvas')
    c.width = 16; c.height = 16
    const g = c.getContext('2d')
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (PAL[ch]) { g.fillStyle = PAL[ch]; g.fillRect(x, y, 1, 1) }
    }))
    return c.toDataURL('image/png')
  }, { rows, PAL })
  fs.writeFileSync(`renderer/assets/tiles/${name}.png`,
    Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log(`wrote renderer/assets/tiles/${name}.png`)
}
await browser.close()
```

Run: `node <scratchpad>/gen-bows.mjs` (from the repo root)
Expected output: both `wrote renderer/assets/tiles/...` lines.

Then eyeball the results: Read both generated PNGs (they are images) and confirm each looks like a strung bow (wood arc on the left, string on the right), not garbage. Adjust the pixel maps and re-run if needed.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, including the sprite asset-existence test.

- [ ] **Step 5: Commit**

```bash
git add renderer/render/sprites.js renderer/assets/tiles/weapon_shortbow.png renderer/assets/tiles/weapon_longbow.png test/sprites.test.js
git commit -m "feat(sprites): wand tile mappings + generated pixel-art bow sprites"
```

---

### Task 5: Rendering — mode-aware held weapon, floating ranged items, arrow projectiles (`canvas.js`)

**Files:**
- Modify: `renderer/render/canvas.js:252-255` (player held weapon), `:168-177` (floating_item), `:718-724` (projectile draw)
- Test: `test/canvas.test.js` (extend)

**Interfaces:**
- Consumes: player fields `ranged`, `attackMode` (Task 1); projectile fields `shape` (`'arrow'|'bolt'`, from Task 2's `tryFire` via Task 7) and existing `color`.
- Produces: nothing new for other tasks — pure rendering.

- [ ] **Step 1: Write the failing tests**

In `test/canvas.test.js`, inside the `describe('drawEntity — held idle weapons', ...)` block, add:

```js
  it('player carries the ranged weapon in ranged stance', () => {
    const psprites = { player: 'PLAYER', weapon_sword: 'SWORD', weapon_shortbow: 'BOW' }
    const p = { type: 'player', facing: 'east', walkPhase: 0, swayAmp: 0,
                weapon: { weaponType: 'sword' }, ranged: { weaponType: 'shortbow' }, attackMode: 'ranged' }
    const ctx = swingCtx()
    drawEntity(ctx, p, 0, 0, 32, psprites)
    assert.deepEqual(ctx.images, ['PLAYER', 'BOW'])
  })

  it('ranged stance with no ranged weapon shows an empty hand', () => {
    const psprites = { player: 'PLAYER', weapon_sword: 'SWORD' }
    const p = { type: 'player', facing: 'east', walkPhase: 0, swayAmp: 0,
                weapon: { weaponType: 'sword' }, ranged: null, attackMode: 'ranged' }
    const ctx = swingCtx()
    drawEntity(ctx, p, 0, 0, 32, psprites)
    assert.deepEqual(ctx.images, ['PLAYER'])
  })

  it('a floating ranged weapon renders its sprite', () => {
    const ctx = swingCtx()
    drawEntity(ctx, { type: 'floating_item', progress: 1,
                      contents: { type: 'ranged', weaponType: 'shortbow' } },
               0, 0, 32, { weapon_shortbow: 'BOW' })
    assert.deepEqual(ctx.images, ['BOW'])
  })
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test test/canvas.test.js`
Expected: FAIL — ranged-stance test draws `['PLAYER', 'SWORD']` (melee weapon), floating ranged item draws nothing.

- [ ] **Step 3: Implement**

In `renderer/render/canvas.js`, replace the player held-weapon block (lines 252-255):

```js
    if (!(entity.attackTimer > 0)) {   // the swing animation draws the melee weapon instead
      const held = entity.attackMode === 'ranged' ? entity.ranged : entity.weapon
      const ws = held && sprites[`weapon_${held.weaponType}`]
      if (ws) drawHeldWeapon(ctx, ws, S)
    }
```

In the `floating_item` branch (line 170), widen the weapon condition:

```js
    if (c.type === 'weapon' || c.type === 'ranged') {
```

Replace the projectile loop (lines 718-724):

```js
    // Draw projectiles. Arrows are elongated along their travel axis;
    // wand bolts and enemy shots stay 4x4 squares.
    for (const p of state.projectiles ?? []) {
      const bpx = Math.round(p.px - camX)
      const bpy = Math.round(p.py - camY)
      ctx.fillStyle = p.color ?? '#facc15'
      if (p.shape === 'arrow') {
        if (Math.abs(p.dx) >= Math.abs(p.dy)) ctx.fillRect(bpx - 4, bpy - 1, 8, 2)
        else ctx.fillRect(bpx - 1, bpy - 4, 2, 8)
      } else {
        ctx.fillRect(bpx - 2, bpy - 2, 4, 4)
      }
    }
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — including the pre-existing "player carries their weapon at idle" test (an idle player without `attackMode` falls through to `entity.weapon`).

- [ ] **Step 5: Commit**

```bash
git add renderer/render/canvas.js test/canvas.test.js
git commit -m "feat(render): stance-aware held weapon, floating ranged items, elongated arrows"
```

---

### Task 6: HUD ranged slot (`hud.js` + `index.html`)

**Files:**
- Modify: `renderer/render/hud.js:9-20`, `renderer/index.html:46-47`
- Test: `test/hud.test.js` (create)

**Interfaces:**
- Consumes: player fields `ranged`, `attackMode`, `ammo`/`maxAmmo` (Task 1).
- Produces: a `#hud-ranged` span; `▶ ` prefix marks the active stance's slot.

- [ ] **Step 1: Write the failing tests**

Create `test/hud.test.js` (`el()` runs inside `updateHUD`, so installing a fake `document` before calling is enough — no DOM needed):

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { updateHUD } from '../renderer/render/hud.js'

function fakeDom() {
  const nodes = {}
  globalThis.document = { getElementById: (id) => (nodes[id] ??= { textContent: '' }) }
  return nodes
}

function state(playerOver = {}) {
  return {
    level: 1, log: ['hi'],
    player: { hp: 10, maxHp: 10, inventory: [], weapon: null, ranged: null, attackMode: 'melee', ...playerOver },
  }
}

describe('updateHUD stance slots', () => {
  it('marks the melee slot active and shows a ranged placeholder', () => {
    const nodes = fakeDom()
    updateHUD(state())
    assert.equal(nodes['hud-weapon'].textContent, '▶ Unarmed')
    assert.equal(nodes['hud-ranged'].textContent, 'No ranged weapon')
  })

  it('marks the ranged slot active and shows the ammo count', () => {
    const nodes = fakeDom()
    updateHUD(state({
      weapon: { name: 'Sword', damage: 2 },
      ranged: { name: 'Shortbow', damage: 2, ammo: 8, maxAmmo: 12 },
      attackMode: 'ranged',
    }))
    assert.equal(nodes['hud-weapon'].textContent, 'Sword (2 dmg)')
    assert.equal(nodes['hud-ranged'].textContent, '▶ Shortbow 8/12')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/hud.test.js`
Expected: FAIL — no `▶ ` prefix and `hud-ranged` stays `''`.

- [ ] **Step 3: Implement**

Replace the weapon lines in `renderer/render/hud.js` (lines 14-16) with:

```js
  const rangedMode = player.attackMode === 'ranged'
  el('hud-weapon').textContent = (rangedMode ? '' : '▶ ') + (player.weapon
    ? `${player.weapon.name} (${player.weapon.damage} dmg)`
    : 'Unarmed')
  el('hud-ranged').textContent = (rangedMode ? '▶ ' : '') + (player.ranged
    ? `${player.ranged.name} ${player.ranged.ammo}/${player.ranged.maxAmmo}`
    : 'No ranged weapon')
```

In `renderer/index.html`, after the `hud-weapon` span (line 46), add:

```html
    <span id="hud-ranged" style="color:#7dd3fc">No ranged weapon</span>
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/render/hud.js renderer/index.html test/hud.test.js
git commit -m "feat(hud): dual weapon slots with active-stance marker and ammo count"
```

---

### Task 7: Wire it all into `game.js`

**Files:**
- Modify: `renderer/game.js` — imports (lines 2, 22-23), constants (line 28), keydown listeners (~line 75), `buildEntities` (lines 147, 168-176), `startNewRun` arena hook (lines 207-216) and state init (~line 234), chest/floating pickup (lines 304-353), combat branches (lines 409-462), `buildEntities` call site (line 223)

**Interfaces:**
- Consumes: `toggleAttackMode`, `tryFire`, `FIRE_FAIL_MESSAGES` (Task 2); `rollChestLoot` (Task 3); `RANGED_WEAPON_TYPES`, `makeRangedContents` (Task 1).
- Produces: the playable feature. No exports — game.js is not importable from tests; this task is verified by the full suite staying green plus Task 8's runtime check.

- [ ] **Step 1: Update imports and remove the dead constant**

Line 2 — add the two new names to the entities import:

```js
import { maybeComputeFOV, hasLineOfSight, makePlayer, makeGuard, makeMonster, makeTrap, makeDragon, makePuzzle, makeChest, makeDoor, makeExitDoor, WEAPON_TYPES, RANGED_WEAPON_TYPES, makeRangedContents, TILE, isWalkable } from './systems/entities.js'
```

After line 23 (`import { applyShockwave, ... }`), add:

```js
import { toggleAttackMode, tryFire, FIRE_FAIL_MESSAGES } from './systems/ranged.js'
import { rollChestLoot } from './systems/loot.js'
```

Delete line 28 (`const RANGED_COOLDOWN = 0.6`). Keep `PROJECTILE_SPEED`.

- [ ] **Step 2: Add the Shift stance toggle**

After the Escape listener (ends line 75), add:

```js
// Shift toggles melee/ranged stance. Edge-triggered: e.repeat filters the
// held-key auto-repeat so holding Shift doesn't flap the mode.
window.addEventListener('keydown', e => {
  if (e.key !== 'Shift' || e.repeat) return
  if (phase !== PHASE.PLAYING || !state) return
  const mode = toggleAttackMode(state.player)
  state.log = [...state.log, mode === 'ranged' ? 'Ranged stance.' : 'Melee stance.'].slice(-5)
})
```

- [ ] **Step 3: Rework the combat branches**

Gate the melee branch (line 410) on stance:

```js
  if (keys[' '] && player.attackMode !== 'ranged' && player.meleeCooldown <= 0) {
```

Replace the entire `// Ranged (Shift)` block (lines 456-462) with:

```js
  // Ranged (Space while in ranged stance). tryFire gates on weapon presence,
  // ammo, and the per-weapon cooldown; failures (except cooldown) get a
  // throttled HUD message so holding Space doesn't spam the log.
  state.fireMsgCooldown = Math.max(0, (state.fireMsgCooldown ?? 0) - delta)
  if (keys[' '] && player.attackMode === 'ranged') {
    const shot = tryFire(player)
    if (shot.ok) {
      const dir = { north: [0,-1], south: [0,1], east: [1,0], west: [-1,0] }[player.facing]
      state.projectiles.push({ px: player.px, py: player.py,
        dx: dir[0]*PROJECTILE_SPEED, dy: dir[1]*PROJECTILE_SPEED,
        damage: shot.damage, color: shot.color, shape: shot.shape, friendly: true })
    } else if (FIRE_FAIL_MESSAGES[shot.reason] && state.fireMsgCooldown <= 0) {
      state.log = [...state.log, FIRE_FAIL_MESSAGES[shot.reason]].slice(-5)
      state.fireMsgCooldown = 1.5
    }
  }
```

- [ ] **Step 4: Chest loot and pickups**

Change the `buildEntities` signature (line 147) and its call site (line 223):

```js
function buildEntities(spawns, map, depth) {
```
```js
    entities: buildEntities(entitySpawns, map, depth),
```

In the spawn-kind switch, replace the `'chest'` case (line 176) and add a `'ranged'` case next to `'weapon'` (for hand-placed/arena/editor use):

```js
      case 'ranged':  return [makeChest(s.x, s.y, makeRangedContents(s.weaponType))]
```
```js
      case 'chest':   return [makeChest(s.x, s.y, rollChestLoot(depth))]
```

In the chest direct-give branch (after the `'weapon'` branch ending line 329), add:

```js
      } else if (chest.contents.type === 'ranged') {
        player.ranged = { ...chest.contents }
        state.log = [...state.log, `Found ${chest.contents.name}! (${chest.contents.ammo} shots)`].slice(-5)
```

In the floating-item pickup (after the `'weapon'` branch ending line 346), add:

```js
    } else if (item.contents.type === 'ranged') {
      player.ranged = { ...item.contents }
      state.log = [...state.log, `Picked up ${item.contents.name}! (${item.contents.ammo} shots)`].slice(-5)
```

Add `fireMsgCooldown: 0,` to the state object in `startNewRun` (next to `lockedMsgCooldown: 0,` line 234).

- [ ] **Step 5: Arena hook**

In `startNewRun`'s depth-0 arena block (after the `po.weaponType` handling, line 211), add:

```js
    const rdef = RANGED_WEAPON_TYPES[po.rangedType]
    if (rdef) player.ranged = makeRangedContents(po.rangedType)
    else if (po.rangedType !== undefined) console.warn(`arena: unknown player rangedType "${po.rangedType}" — no ranged weapon`)
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — this task adds no unit tests (game.js is wiring), so green here means no regressions.

- [ ] **Step 7: Commit**

```bash
git add renderer/game.js
git commit -m "feat(ranged): Shift toggles stance, Space fires looted ammo-limited weapons, chests roll loot"
```

---

### Task 8: Runtime verification + finish

**Files:**
- No source changes expected (fixes only if verification finds bugs).

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: PASS, zero failures.

- [ ] **Step 2: Runtime check via the arena**

Use the **arena-test skill** (it manages the level-0 arena config, playwright-core Electron launch on WSLg, and the test journal). Verify, with screenshots:

1. Arena config giving the player `weaponType: 'sword'` and `rangedType: 'shortbow'` plus a `'ranged'` chest spawn (`weaponType: 'stormwand'`) and a couple of `'monster'` spawns.
2. Shift toggles the HUD `▶` marker between the two slots; held Shift does not flap.
3. In ranged stance the player holds the bow sprite; Space fires an elongated yellow arrow; HUD ammo counts down `12/12 → 11/12 …`; an arrow kills a monster.
4. In melee stance Space swings as before and never spends ammo.
5. Walking onto the ranged chest → floating item → pickup replaces the bow with the Storm Wand at `6/6`.
6. Firing the wand shows a square purple bolt; firing until empty logs `Out of ammo!` and stays in ranged stance.

After the run: `git status renderer/data/` must be clean (editor autosave hazard).

- [ ] **Step 3: Fix anything found, re-run, commit fixes**

Any bug found goes through: failing/adjusted test where the logic is testable → fix → `npm test` green → commit.

- [ ] **Step 4: Wrap up the branch**

Use the **superpowers:finishing-a-development-branch** skill to decide merge/PR/cleanup with the user.
