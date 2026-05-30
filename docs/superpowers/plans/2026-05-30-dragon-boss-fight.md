# Dragon Boss Fight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a puzzle-based dragon boss fight to level 9 — wake the dragon, lure it onto a snare tile, then strike while it sleeps.

**Architecture:** Five sequential changes: (1) new tile constant + dragon fields in `entities.js`, (2) organic cave template + template parser in `levels.js` / `map.js`, (3) cyan snare rendering in `canvas.js`, (4) dragon combat rules in `turn.js`, (5) snare mechanics + dragon death wiring in `game.js`.

**Tech Stack:** Vanilla JS, HTML5 Canvas, Electron, Node built-in test runner (`node --test`)

---

## File Map

| File | Change |
|---|---|
| `renderer/systems/entities.js` | Add `TILE.SNARE = 9`; add `hp`, `maxHp`, `snareTimer`, `inCombat` to `makeDragon` |
| `renderer/data/levels.js` | Replace `DRAGON_LAIR` template with 24×20 organic cave cluster |
| `renderer/systems/map.js` | Add `'X'` → `TILE.SNARE` and `'C'` → `TILE.COLUMN` to `placeTemplate` |
| `renderer/render/canvas.js` | `drawTile` draws `TILE.SNARE` as floor + cyan overlay |
| `renderer/systems/turn.js` | Add dragon to blocker check; handle SLEEPING (deal damage) and AWAKE (block) |
| `renderer/game.js` | Snare timer + state override in dragon turn loop; `hideDragonMeter` on dragon death |
| `test/entities.test.js` | Add `makeDragon` and `TILE.SNARE` tests |
| `test/turn.test.js` | Add dragon combat tests |

---

## Task 1: Entity data model — TILE.SNARE + dragon fields

**Files:**
- Modify: `renderer/systems/entities.js`
- Modify: `test/entities.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/entities.test.js`:

```js
import { makeDragon, TILE } from '../renderer/systems/entities.js'

describe('TILE', () => {
  it('has a SNARE constant', () => {
    assert.equal(typeof TILE.SNARE, 'number')
    assert.notEqual(TILE.SNARE, TILE.WALL)
    assert.notEqual(TILE.SNARE, TILE.FLOOR)
    assert.notEqual(TILE.SNARE, TILE.COLUMN)
  })
})

describe('makeDragon', () => {
  it('has hp, maxHp, snareTimer, and inCombat fields', () => {
    const d = makeDragon(5, 5, 1)
    assert.equal(d.hp, 12)
    assert.equal(d.maxHp, 12)
    assert.equal(d.snareTimer, 0)
    assert.equal(d.inCombat, false)
  })
})
```

Note: the existing `test/entities.test.js` imports from `'../renderer/systems/entities.js'` — use the same import path. Add `makeDragon` and `TILE` to the existing import line at the top of the file.

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/entities.test.js
```

Expected: FAIL — `TILE.SNARE` is undefined.

- [ ] **Step 3: Add `TILE.SNARE` to `entities.js`**

In `renderer/systems/entities.js`, update the `TILE` object (line 1):

```js
export const TILE = {
  WALL: 0,
  FLOOR: 1,
  DOOR: 2,
  STAIRS_DOWN: 3,
  STAIRS_UP: 4,
  TREASURE: 5,
  SHRINE: 6,
  FLOOR_WOOD: 7,
  COLUMN: 8,
  SNARE: 9,
}
```

- [ ] **Step 4: Add `hp`, `maxHp`, `snareTimer`, `inCombat` to `makeDragon`**

In `renderer/systems/entities.js`, update `makeDragon` (currently near line 91):

```js
export function makeDragon(x, y, roomId) {
  return {
    type: 'dragon', x, y,
    sleepMeter: 0, dragonState: DRAGON_STATE.SLEEPING,
    roomId, moveTimer: 0,
    hp: 12, maxHp: 12,
    snareTimer: 0,
    inCombat: false,
  }
}
```

- [ ] **Step 5: Update the import in `test/entities.test.js`**

The top of `test/entities.test.js` currently imports `makeGuard` and `makeMonster`. Add `makeDragon` and `TILE`:

```js
import { makeGuard, makeMonster, makeDragon, TILE } from '../renderer/systems/entities.js'
```

- [ ] **Step 6: Run tests to confirm pass**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/entities.test.js
```

Expected: PASS (4 tests across all describe blocks).

- [ ] **Step 7: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/entities.js test/entities.test.js && git commit -m "feat: add TILE.SNARE and dragon hp/snareTimer/inCombat fields"
```

---

## Task 2: Dragon lair template + template parser

**Files:**
- Modify: `renderer/data/levels.js`
- Modify: `renderer/systems/map.js`

No automated tests — visual verification by running the game on level 9.

- [ ] **Step 1: Add `'X'` and `'C'` handlers to `placeTemplate` in `map.js`**

In `renderer/systems/map.js`, find the `placeTemplate` function. It currently handles `'D'`, `'T'`, `'S'`, `'W'`, `'P'`, `'L'`. Add two new handlers immediately after the `'L'` block (around line 108):

```js
} else if (ch === 'X') {
  map[ty][tx].tile = TILE.SNARE
  map[ty][tx].roomId = roomId
} else if (ch === 'C') {
  map[ty][tx].tile = TILE.COLUMN
  map[ty][tx].roomId = roomId
}
```

- [ ] **Step 2: Replace `DRAGON_LAIR` in `levels.js`**

In `renderer/data/levels.js`, replace the entire `DRAGON_LAIR` entry in `TEMPLATES`:

```js
DRAGON_LAIR: {
  tiles: [
    '########################',
    '##.....##########.....##',
    '#.......########.......#',
    '##.....##########.....##',
    '###...####.....####...##',
    '######.####...####.#####',
    '#######.##.....##.######',
    '########.........#######',
    '#########.......########',
    '##########.#############',
    '######................##',
    '####..................##',
    '###...................##',
    '##.....D...............#',
    '##...C...X...C.........#',
    '##.....T...............#',
    '###...................##',
    '####................####',
    '#########......#########',
    '########################',
  ],
  width: 24, height: 20,
},
```

Key positions (0-indexed):
- `D` (dragon spawn): row 13, col 7
- `X` (snare): row 14, col 9
- `C` (columns): row 14, cols 5 and 13
- `T` (treasure): row 15, col 7
- Template center (where the dungeon corridor connects): row 10, col 12 — a walkable floor tile ✓

- [ ] **Step 3: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/data/levels.js renderer/systems/map.js && git commit -m "feat: replace DRAGON_LAIR with organic cave cluster; add X/C template parsers"
```

---

## Task 3: Snare tile rendering

**Files:**
- Modify: `renderer/render/canvas.js`

No automated tests — visual verification.

- [ ] **Step 1: Add snare rendering to `drawTile` in `canvas.js`**

In `renderer/render/canvas.js`, find `drawTile` (line 6). Add a snare check at the very top of the function, before the existing switch:

```js
function drawTile(ctx, tileId, px, py, S, sprites) {
  if (tileId === TILE.SNARE) {
    if (sprites.floor) ctx.drawImage(sprites.floor, px, py, S, S)
    ctx.fillStyle = 'rgba(0, 200, 200, 0.35)'
    ctx.fillRect(px, py, S, S)
    return
  }
  const s = (() => {
    // ... existing switch unchanged ...
```

`TILE` is already imported at the top of `canvas.js` via `import { TILE, ALERT } from '../systems/entities.js'`. No import change needed.

- [ ] **Step 2: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/render/canvas.js && git commit -m "feat: render TILE.SNARE as cyan-tinted floor"
```

---

## Task 4: Dragon combat in turn.js

**Files:**
- Modify: `renderer/systems/turn.js`
- Modify: `test/turn.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/turn.test.js`. First, update the import at the top of `test/turn.test.js` to include `makeDragon` and `DRAGON_STATE`:

```js
import { TILE, makePlayer, makeGuard, makeMonster, makeTrap, makePuzzle, makeDragon, DRAGON_STATE } from '../renderer/systems/entities.js'
```

Then append the new describe block:

```js
describe('resolvePlayerAction — dragon combat', () => {
  it('blocks movement into sleeping dragon without a weapon', () => {
    const dragon = makeDragon(6, 5, 1)
    const state = makeState({ entities: [dragon] })
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    assert.equal(next.player.x, 5)
    assert.ok(next.log[next.log.length - 1].includes('weapon'))
  })

  it('damages a sleeping dragon when player has a weapon', () => {
    const dragon = makeDragon(6, 5, 1)
    const player = { ...makePlayer(5, 5), weapon: { weaponType: 'dagger', name: 'Dagger', damage: 1 } }
    const state = makeState({ player, entities: [dragon] })
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    const updated = next.entities.find(e => e.type === 'dragon')
    assert.equal(updated.hp, 11)
    assert.equal(updated.inCombat, true)
  })

  it('blocks movement into an awake dragon', () => {
    const dragon = { ...makeDragon(6, 5, 1), dragonState: DRAGON_STATE.AWAKE }
    const player = { ...makePlayer(5, 5), weapon: { weaponType: 'axe', name: 'Axe', damage: 4 } }
    const state = makeState({ player, entities: [dragon] })
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    assert.equal(next.player.x, 5)
    assert.ok(next.log[next.log.length - 1].includes('alert'))
  })

  it('removes dragon from entities when it reaches 0 HP', () => {
    const dragon = { ...makeDragon(6, 5, 1), hp: 1 }
    const player = { ...makePlayer(5, 5), weapon: { weaponType: 'dagger', name: 'Dagger', damage: 1 } }
    const state = makeState({ player, entities: [dragon] })
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    assert.equal(next.entities.filter(e => e.type === 'dragon').length, 0)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/turn.test.js 2>&1 | grep -A3 'dragon combat'
```

Expected: FAIL — dragon is not in the blocker list yet.

- [ ] **Step 3: Add dragon to the blocker check in `turn.js`**

In `renderer/systems/turn.js`, find the `blockerIdx` line (around line 27). Add `e.type === 'dragon'` to the filter:

```js
const blockerIdx = newEntities.findIndex(e =>
  e.x === nx && e.y === ny &&
  (e.type === 'guard' || e.type === 'monster' || e.type === 'chest' || e.type === 'door' || e.type === 'dragon')
)
```

- [ ] **Step 4: Add the dragon combat handler in `turn.js`**

In `renderer/systems/turn.js`, directly after the `if (blockerIdx !== -1) {` opening and before the `if (newEntities[blockerIdx].type === 'door')` check, add:

```js
if (newEntities[blockerIdx].type === 'dragon') {
  const dragon = newEntities[blockerIdx]
  if (dragon.dragonState !== DRAGON_STATE.SLEEPING) {
    return {
      ...state,
      hitEffects: null,
      log: [...state.log, "The dragon is too alert — you can't get close!"].slice(-5),
    }
  }
  if (!player.weapon) {
    return { ...state, hitEffects: null, log: [...state.log, 'You need a weapon to fight!'].slice(-5) }
  }
  const dmg = player.weapon.damage
  const updatedDragon = { ...dragon, hp: dragon.hp - dmg, inCombat: true }
  if (updatedDragon.hp <= 0) {
    newEntities = newEntities.filter((_, i) => i !== blockerIdx)
    logs.push('The dragon collapses! The treasure is yours!')
  } else {
    newEntities = newEntities.map((e, i) => i === blockerIdx ? updatedDragon : e)
    logs.push(`You strike the sleeping dragon for ${dmg} damage! (${updatedDragon.hp}/${dragon.maxHp} HP)`)
  }
  noiseAmount = ACTION_NOISE.attack
  return {
    ...state,
    player: newPlayer,
    entities: newEntities,
    hitEffects: [{ x: nx, y: ny }],
    pendingNoise: { source: { x: newPlayer.x, y: newPlayer.y }, amount: noiseAmount },
    log: [...state.log, ...logs].slice(-5),
  }
}
```

`DRAGON_STATE` is already imported at the top of `turn.js` via `import { TILE, ALERT, DRAGON_STATE, isWalkable } from './entities.js'`. No import change needed.

- [ ] **Step 5: Run tests to confirm pass**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/turn.test.js
```

Expected: all tests PASS (including the 4 new dragon combat tests; the 2 pre-existing failures from the no-weapon-attack tests are unrelated).

- [ ] **Step 6: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/turn.js test/turn.test.js && git commit -m "feat: add dragon combat to resolvePlayerAction"
```

---

## Task 5: Snare mechanics + dragon death in game.js

**Files:**
- Modify: `renderer/game.js`

No unit tests — `game.js` uses browser globals. Verified by running the game.

- [ ] **Step 1: Replace the dragon turn processing block in `game.js`**

Find this block in `renderer/game.js` (around lines 175–203):

```js
const dragon = entitiesAfterGuardAttack.find(e => e.type === 'dragon')
const finalEntities = dragon
  ? entitiesAfterGuardAttack.map(e => e.type === 'dragon'
      ? stepDragon(updateDragonSleep(e, state.noiseMap), state.map, state.player)
      : e)
  : entitiesAfterGuardAttack

state = { ...state, entities: finalEntities }

if (dragon) {
  const updatedDragon = finalEntities.find(e => e.type === 'dragon')
  showDragonMeter(updatedDragon)
  if (updatedDragon.dragonState !== DRAGON_STATE.SLEEPING) {
    if (dragon.dragonState === DRAGON_STATE.SLEEPING && updatedDragon.dragonState === DRAGON_STATE.STIRRING) {
      state = { ...state, log: [...state.log, 'The dragon stirs… move quietly!'].slice(-5) }
    } else if (dragon.dragonState !== DRAGON_STATE.AWAKE && updatedDragon.dragonState === DRAGON_STATE.AWAKE) {
      state = { ...state, log: [...state.log, 'The dragon AWAKENS and hunts you!'].slice(-5) }
    }
    if (updatedDragon.dragonState === DRAGON_STATE.AWAKE) {
      const dist = Math.abs(updatedDragon.x - state.player.x) + Math.abs(updatedDragon.y - state.player.y)
      if (dist <= 1) {
        state = {
          ...state,
          player: { ...state.player, hp: state.player.hp - 3 },
          log: [...state.log, 'The dragon breathes fire! (-3 HP)'].slice(-5),
        }
      }
    }
  }
}
```

Replace it entirely with:

```js
const dragon = entitiesAfterGuardAttack.find(e => e.type === 'dragon')
const finalEntities = dragon
  ? entitiesAfterGuardAttack.map(e => {
      if (e.type !== 'dragon') return e
      // Snare timer: keeps dragon sleeping for N turns, ignoring noise
      const d = e.snareTimer > 0
        ? { ...e, snareTimer: e.snareTimer - 1, dragonState: DRAGON_STATE.SLEEPING }
        : updateDragonSleep(e, state.noiseMap)
      // Move dragon
      const moved = stepDragon(d, state.map, state.player)
      // If dragon stepped onto the snare, trigger it
      if (state.map[moved.y]?.[moved.x]?.tile === TILE.SNARE) {
        return { ...moved, snareTimer: 10, dragonState: DRAGON_STATE.SLEEPING }
      }
      return moved
    })
  : entitiesAfterGuardAttack

state = { ...state, entities: finalEntities }

if (dragon) {
  const updatedDragon = finalEntities.find(e => e.type === 'dragon')
  if (!updatedDragon) {
    hideDragonMeter()
  } else {
    showDragonMeter(updatedDragon)
    if (updatedDragon.dragonState !== DRAGON_STATE.SLEEPING) {
      if (dragon.dragonState === DRAGON_STATE.SLEEPING && updatedDragon.dragonState === DRAGON_STATE.STIRRING) {
        state = { ...state, log: [...state.log, 'The dragon stirs… move quietly!'].slice(-5) }
      } else if (dragon.dragonState !== DRAGON_STATE.AWAKE && updatedDragon.dragonState === DRAGON_STATE.AWAKE) {
        state = { ...state, log: [...state.log, 'The dragon AWAKENS and hunts you!'].slice(-5) }
      }
      if (updatedDragon.dragonState === DRAGON_STATE.AWAKE) {
        const dist = Math.abs(updatedDragon.x - state.player.x) + Math.abs(updatedDragon.y - state.player.y)
        if (dist <= 1) {
          state = {
            ...state,
            player: { ...state.player, hp: state.player.hp - 3 },
            log: [...state.log, 'The dragon breathes fire! (-3 HP)'].slice(-5),
          }
        }
      }
    }
  }
}
```

`TILE` and `DRAGON_STATE` are already imported at the top of `game.js`. `hideDragonMeter` is already imported from `'./render/hud.js'`. No import changes needed.

- [ ] **Step 2: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/game.js && git commit -m "feat: snare mechanic + dragon death wiring in game loop"
```

---

## Final check

Run the full test suite to confirm no regressions:

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: 54 pass, 2 fail (the same 2 pre-existing failures — no new failures).

Then run the game and verify on level 9:

```bash
cd /home/lappemikb/projects/dungeon-crawler && npm start
```

Checklist:
- [ ] Level 9 generates with the organic cave layout
- [ ] The snare tile renders as a cyan-tinted floor
- [ ] Dragon renders as the pixel art sprite (not emoji)
- [ ] Making noise wakes the dragon
- [ ] Running across the snare causes the dragon to step on it and collapse to SLEEPING
- [ ] Attacking the sleeping dragon deals damage and shows the HP bar
- [ ] Attacking the awake dragon shows "too alert" message with no damage
- [ ] When dragon HP hits 0, it disappears and the dragon meter hides
