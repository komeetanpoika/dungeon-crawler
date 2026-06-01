# Enemy HP Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display a solid colored HP bar above enemies while they are `inCombat`, invisible otherwise.

**Architecture:** Add `maxHp` and `inCombat` fields to enemy factories; set/clear `inCombat` at the two combat-entry points (player attacks enemy, guard attacks player) and one exit point (guard drops below ALERTED); render bars in a dedicated second pass in the canvas renderer.

**Tech Stack:** Vanilla JS, HTML5 Canvas, Electron, Node built-in test runner (`node --test`)

---

## File Map

| File | Change |
|---|---|
| `renderer/systems/entities.js` | Add `maxHp` and `inCombat: false` to `makeGuard` and `makeMonster` |
| `renderer/systems/turn.js` | Set `inCombat: true` on entity when player attacks it |
| `renderer/game.js` | Set `inCombat: true` on guards that attack the player; clear `inCombat` on guards that drop below `ALERTED` |
| `renderer/render/canvas.js` | Add `drawHealthBars` function; call it in `Renderer.render()` |
| `test/entities.test.js` | New file — tests for `maxHp` and `inCombat` on entity factories |
| `test/turn.test.js` | Add tests for `inCombat: true` being set on attacked entities |

---

## Task 1: Entity data model

**Files:**
- Modify: `renderer/systems/entities.js`
- Create: `test/entities.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/entities.test.js`:

```js
// test/entities.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeGuard, makeMonster } from '../renderer/systems/entities.js'

describe('makeGuard', () => {
  it('has maxHp: 4 and inCombat: false', () => {
    const g = makeGuard(5, 5)
    assert.equal(g.maxHp, 4)
    assert.equal(g.inCombat, false)
  })
})

describe('makeMonster', () => {
  it('has maxHp matching hp for each variant and inCombat: false', () => {
    const cases = [['weak', 1], ['medium', 2], ['strong', 3], ['boss', 5]]
    for (const [variant, expectedHp] of cases) {
      const m = makeMonster(5, 5, variant)
      assert.equal(m.maxHp, expectedHp, `maxHp for variant ${variant}`)
      assert.equal(m.inCombat, false, `inCombat for variant ${variant}`)
    }
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/entities.test.js
```

Expected: FAIL — `makeGuard` has no `maxHp` or `inCombat` field yet.

- [ ] **Step 3: Add `maxHp` and `inCombat` to `makeGuard`**

In `renderer/systems/entities.js`, find `makeGuard` (line 53) and update the returned object:

```js
export function makeGuard(x, y, patrol = []) {
  return {
    type: 'guard', x, y,
    facing: 'south', fovAngle: 90, fovRange: 5,
    patrol, patrolIndex: 0,
    alertState: ALERT.UNAWARE,
    hearingRadius: 4, hp: 4, maxHp: 4,
    moveCooldown: 2, moveTimer: 0,
    inCombat: false,
  }
}
```

- [ ] **Step 4: Add `maxHp` and `inCombat` to `makeMonster`**

In `renderer/systems/entities.js`, find `makeMonster` (line 71) and update:

```js
export function makeMonster(x, y, variant = 'weak') {
  const stats = MONSTER_VARIANTS[variant] ?? MONSTER_VARIANTS.weak
  return {
    type: 'monster', x, y, variant,
    wanderRadius: 3,
    alertState: ALERT.UNAWARE,
    hearingRadius: 3,
    hp: stats.hp, maxHp: stats.hp,
    damage: stats.damage,
    inCombat: false,
  }
}
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/entities.test.js
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/entities.js test/entities.test.js && git commit -m "feat: add maxHp and inCombat fields to guard and monster"
```

---

## Task 2: Set `inCombat: true` when player attacks an enemy

**Files:**
- Modify: `renderer/systems/turn.js`
- Modify: `test/turn.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/turn.test.js`:

```js
describe('resolvePlayerAction — inCombat', () => {
  it('sets inCombat:true on a guard that survives a player attack', () => {
    const guard = makeGuard(6, 5) // hp: 4
    const player = { ...makePlayer(5, 5), weapon: { weaponType: 'dagger', name: 'Dagger', damage: 1 } }
    const state = makeState({ player, entities: [guard] })
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    const updated = next.entities.find(e => e.type === 'guard')
    assert.equal(updated.inCombat, true)
  })

  it('sets inCombat:true on a monster that survives a player attack', () => {
    const monster = makeMonster(6, 5, 'strong') // hp: 3, survives a 1-dmg hit
    const player = { ...makePlayer(5, 5), weapon: { weaponType: 'dagger', name: 'Dagger', damage: 1 } }
    const state = makeState({ player, entities: [monster] })
    const next = resolvePlayerAction(state, { type: 'move', dx: 1, dy: 0 })
    const updated = next.entities.find(e => e.type === 'monster')
    assert.equal(updated.inCombat, true)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/turn.test.js 2>&1 | grep -A2 'inCombat'
```

Expected: FAIL — `inCombat` is `false` on both entities.

- [ ] **Step 3: Set `inCombat: true` on the updated blocker in `turn.js`**

In `renderer/systems/turn.js`, find the attack block (around line 66) and add `inCombat: true` to `updatedBlocker`:

```js
const blocker = newEntities[blockerIdx]
const dmg = player.weapon.damage
const updatedBlocker = { ...blocker, hp: blocker.hp - dmg, inCombat: true }
if (updatedBlocker.hp <= 0) {
  newEntities = newEntities.filter((_, i) => i !== blockerIdx)
  logs.push(`You slay the ${blocker.type} with your ${player.weapon.name}!`)
} else {
  newEntities = newEntities.map((e, i) => i === blockerIdx ? updatedBlocker : e)
  logs.push(`You strike the ${blocker.type} for ${dmg} damage!`)
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/turn.test.js
```

Expected: all tests PASS (including the new inCombat tests).

- [ ] **Step 5: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/systems/turn.js test/turn.test.js && git commit -m "feat: set inCombat:true on enemy when player attacks"
```

---

## Task 3: Combat entry/exit in the game loop

**Files:**
- Modify: `renderer/game.js`

No unit tests — `game.js` depends on browser globals (`window`, `document`). Verification is manual (run the game).

- [ ] **Step 1: Clear `inCombat` when a guard drops below ALERTED**

In `renderer/game.js`, find the `alertedEntities` map (around line 138):

```js
const alertedEntities = state.entities.map(e =>
  e.type === 'guard' ? updateGuardAlert(e, state.noiseMap, state.map, state.player) : e
)
```

Add a pass immediately after to clear `inCombat` on guards that are no longer ALERTED:

```js
const alertedEntities = state.entities.map(e =>
  e.type === 'guard' ? updateGuardAlert(e, state.noiseMap, state.map, state.player) : e
)
const combatClearedEntities = alertedEntities.map(e =>
  e.type === 'guard' && e.alertState !== ALERT.ALERTED ? { ...e, inCombat: false } : e
)
```

Then replace `alertedEntities` with `combatClearedEntities` in the `steppedEntities` map that follows:

```js
const steppedEntities = combatClearedEntities.map(e => {
  if (e.type === 'guard') {
    if (e.moveTimer > 0) return { ...e, moveTimer: e.moveTimer - 1 }
    return { ...stepGuard(e, state.map, state.player), moveTimer: e.moveCooldown }
  }
  if (e.type === 'monster') return stepMonster(e, state.map)
  return e
})
```

- [ ] **Step 2: Set `inCombat: true` when a guard attacks the player**

Find the guard-attacks-player block (around line 151). Replace it so attacking guards are also marked in the entities array. The current `state = { ...state, player: ..., log: ... }` block does not update entities — we need to track attacking guards separately:

```js
const attackers = steppedEntities.filter(e =>
  e.type === 'guard' &&
  e.alertState === ALERT.ALERTED &&
  Math.abs(e.x - state.player.x) + Math.abs(e.y - state.player.y) === 1
)
let entitiesAfterGuardAttack = steppedEntities
if (attackers.length > 0) {
  const dmg = attackers.length
  const attackerSet = new Set(attackers)
  entitiesAfterGuardAttack = steppedEntities.map(e =>
    attackerSet.has(e) ? { ...e, inCombat: true } : e
  )
  state = {
    ...state,
    player: { ...state.player, hp: state.player.hp - dmg },
    log: [...state.log, `A guard strikes you! (${dmg} damage)`].slice(-5),
  }
}
```

- [ ] **Step 3: Thread `entitiesAfterGuardAttack` into dragon handling**

Find the dragon handling block immediately after (around line 165). Replace `steppedEntities` with `entitiesAfterGuardAttack`:

```js
const dragon = entitiesAfterGuardAttack.find(e => e.type === 'dragon')
const finalEntities = dragon
  ? entitiesAfterGuardAttack.map(e => e.type === 'dragon'
      ? stepDragon(updateDragonSleep(e, state.noiseMap), state.map, state.player)
      : e)
  : entitiesAfterGuardAttack

state = { ...state, entities: finalEntities }
```

- [ ] **Step 4: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/game.js && git commit -m "feat: set and clear inCombat on guards in game loop"
```

---

## Task 4: HP bar rendering

**Files:**
- Modify: `renderer/render/canvas.js`

No automated tests — pure canvas drawing. Verification is visual (run the game and attack an enemy).

- [ ] **Step 1: Add `drawHealthBars` function to `canvas.js`**

In `renderer/render/canvas.js`, add this function after `drawHitEffect` (after line 99, before the `Renderer` class):

```js
function drawHealthBars(ctx, entities, map, camX, camY, S) {
  for (const e of entities) {
    if (!e.inCombat || e.hp === undefined || e.maxHp === undefined) continue
    if (!map[e.y]?.[e.x]?.visible) continue
    const px = Math.round(e.x * S - camX)
    const py = Math.round(e.y * S - camY)
    const ratio = Math.max(0, Math.min(1, e.hp / e.maxHp))
    const color = ratio > 0.6 ? '#22c55e' : ratio > 0.3 ? '#facc15' : '#ef4444'
    ctx.fillStyle = '#111'
    ctx.fillRect(px, py - 7, S, 4)
    ctx.fillStyle = color
    ctx.fillRect(px, py - 7, Math.round(ratio * S), 4)
  }
}
```

- [ ] **Step 2: Call `drawHealthBars` in `Renderer.render()`**

In `Renderer.render()`, find the entity drawing loop (around line 160–164):

```js
for (const e of entities) {
  ...
  drawEntity(ctx, e, Math.round(e.x * S - camX), Math.round(e.y * S - camY), S, sprites)
}
drawEntity(ctx, player, Math.round(player.x * S - camX), Math.round(player.y * S - camY), S, sprites)
```

Add `drawHealthBars` immediately after the player draw, before hit effects:

```js
for (const e of entities) {
  const margin = e.type === 'dragon' ? 5 : 0
  if (e.x + margin < c0 || e.x - margin >= c1 || e.y + margin < r0 || e.y - margin >= r1) continue
  if (!map[e.y]?.[e.x]?.visible) continue
  drawEntity(ctx, e, Math.round(e.x * S - camX), Math.round(e.y * S - camY), S, sprites)
}
drawEntity(ctx, player, Math.round(player.x * S - camX), Math.round(player.y * S - camY), S, sprites)
drawHealthBars(ctx, entities, map, camX, camY, S)

if (state.hitEffects?.length > 0) {
```

- [ ] **Step 3: Run the game and verify visually**

```bash
cd /home/lappemikb/projects/dungeon-crawler && npm start
```

Verification checklist:
- Pick up a weapon (move into a chest or weapon pickup)
- Move into a guard or monster to attack it
- A green bar should appear above the enemy immediately after the hit
- If the enemy's HP drops to ~30% or below, the bar should turn red
- Enemies at full HP with no combat interaction should show no bar
- Moving away from a visible enemy in combat: bar stays (combat persists until enemy dies or logic exits)

- [ ] **Step 4: Commit**

```bash
cd /home/lappemikb/projects/dungeon-crawler && git add renderer/render/canvas.js && git commit -m "feat: render HP bar above enemies in combat"
```

---

## Final check

Run the full test suite to confirm no regressions:

```bash
cd /home/lappemikb/projects/dungeon-crawler && node --test test/
```

Expected: all tests pass.
