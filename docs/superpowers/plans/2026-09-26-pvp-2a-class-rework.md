# PvP 2a — Class Rework and Time-to-Kill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each class gets a signature move (the Warrior's gesture combos, the Archer's charged double shot, the Mage's Storm Wand with a Fireball rune) and fights end sooner (hp 8, plate protect 0).

**Architecture:**
- All new numbers live in `renderer/data/pvp.js` (`WARRIOR_COMBOS`, `DOUBLE_SHOT`, `SPELL_OVERRIDES`, `CLASS_HINTS`, new `BOTS` fields).
- A pure recogniser, `renderer/pvp/combos.js`, turns the stick into moves while the attack is held. `hero.js` runs the hold (a slide in `moveHero`, which the predictor shares) and the release. `attacks.js` runs the effects (lunge, fence, whirlwind) as `hero.move`, stepped once a tick, and the double shot.
- The shared spell code takes PvP numbers through an optional `override` on `tryCast`/`castCost`. Call Lightning marks carry their own `delay`/`damage`/`stun`. The sim builds the fireball's `detonate` hook (burst and fire zones credited to the caster); `stepProjectiles` hands the hook a fifth argument `{ owner, struck }`.
- Protocol v4 carries `combo` and `move` on heroes, `fireZones` and an arrow `trail` flag on snapshots. The predictor mirrors the hold, the gesture's stamina, the draw and every release's cooldown. The client stops latching releases.
- Bots use the lunge, the whirlwind, the double shot and a distance-matched lightning tier. `renderer/render/pvp-fx.js` draws the moves from snapshot state. The class picker shows one hint per class.

**Tech Stack:** vanilla ES modules, Node 22 (CI) / Node 20 (container), `node:test`, `ws@^8`, `playwright-core` for the live check.

**Spec:** `docs/superpowers/specs/2026-09-26-pvp-2a-class-rework-design.md`. Earlier plans in the same style: `docs/superpowers/plans/2026-09-26-pvp-4b-arenas-reconnect.md`.

## Global Constraints

- **Numbers from the spec** (all in `renderer/data/pvp.js`):

  | What | Value |
  |---|---|
  | `PVP.hp` | **8** (was 10) |
  | `OUTFIT_OVERRIDES.plate.protect` | **0** (was 1) |
  | `KITS.mage` main hand | `stormwand` (offhand stays `blinkwand`) |
  | `RUNE_POWER.mage` | `{ wandType: 'firewand' }` |
  | `WARRIOR_COMBOS` | `holdMoveMul` 0.5, `moveCost` 25, at most 4 moves; `lunge` `{ tiles: 2.5, dur: 0.15, reach: 20, damage: 3 }`; `fence` `{ times: [0, 0.12, 0.24], reach: 40, damage: 1 }`; `whirl` `{ reach: 44, damage: 2, knockback: 40, cooldownMul: 1.5 }` |
  | `DOUBLE_SHOT` | `full` 1.2 s, `moveMul` 0.6, `gap` 12 (±6 px), `cooldown` 0.8 s, nothing below 30 %; bands 30/40/55/70/85 % → 1/2/3/4/5 per arrow |
  | `SPELL_OVERRIDES.lightning` | `{ cooldown: 1.5, delay: 0.4, damage: 3, stun: 0.6 }` (× `PVP.ccMul` in a match = 0.3 s) |
  | `SPELL_OVERRIDES.fireball` | `{ burst: 2 }`; patch 3 s at 1 dmg/s (`FIRE_*`); fireball cooldown 1.0 s and stamina 18/26/40 unchanged |
  | `NET.protocolVersion` | **4** |
  | Class hints | Warrior "Hold attack + stick: combos"; Archer "Hold Q: double shot"; Mage "Storm Wand · Q: blink" |
- **Single-player is untouched.** `SPELLS`, `LIGHTNING`, `ATTACK_STYLES`, `OUTFIT_TYPES` and `game.js`'s single-player paths keep their numbers. Every shared-system change is an optional parameter whose default is today's behaviour, and a test asserts single-player's Call Lightning (cooldown 4, delay 0.6, damage 5, stun 1.0).
- `renderer/pvp/`, `renderer/net/` and `renderer/data/` stay DOM-free: nothing in them may reference `document`, `window`, `localStorage`, `sessionStorage` or `render/*` (the server imports them).
- **Out of scope (2b):** new pickups, pickup tiers, bigger arenas, and the rune's duration and spawn timers.
- **No deploy inside tasks.** The controller deploys after the merge, with the user's go-ahead.
- Commits end with a `Co-Authored-By:` trailer naming the model that wrote them.
- Run the suite with `npm test` (2954 tests before this plan, about 3046 after). Two known flakes, both to be re-run rather than chased: a lone SIGSEGV from Node's test runner on WSL, and `npc.test.js` "deer never moved".

## Spec readings

These resolve the spec's ambiguities and bind every task.

1. **The press does not count as a move.** `beginHold` sets the gesture's `last` to the sector already held at the press. Walking into the press is therefore not itself a move; the stick must change. Otherwise every attack made while walking would cost 25 stamina and mis-classify.
2. **`stepGesture(state, move, stamina = Infinity) → { moves, last, cost }`.** The spec's two-argument signature is extended with the stamina available and the `cost` to pay this tick (0 or 25). A move that cannot be paid, or one past the fourth, still updates `last`, so a stick held through a regen refill never registers late.
3. **The diagonal tie.** The input is sign-only (`validateInput` clamps each axis to −1/0/1), so any diagonal is a tie and keeps the previous sector. A diagonal from neutral stays neutral.
4. **Classification.** An empty move list gives `swing`. Two equal moves give `lunge` toward that direction. `d` then its opposite gives `fence` toward `d`. Exactly four moves, each turning 90° the same way round (both senses), give `whirl`, aimed at its **last** move. Anything else gives `swing`. A combo's `dir` becomes the facing; a swing keeps the facing held.
5. **Cancels.** A stun or a raised shield drops the hold (`hero.combo = null`) and sets `needRelease`, so the attack must be let go before the next hold. A stun also ends a running combo effect (`hero.move = null`). Death, `applyKit`, `grantRune` and `endRune` clear both.
6. **Spawn protection** ends on the release (the swing or the combo), not on the press, the way the Mage's charge ends it on the cast.
7. **The effects are `hero.move = { kind, dir, t, from, done, dist, fired, group }`.** It is stepped once a tick (the release tick included) by `stepCombo` at the end of `tickHero`, and lives `WARRIOR_COMBOS.fxDur` = 0.35 s. That value is the plan's own number: it outlasts the last thrust at 0.24 s and is also how long the renderer draws the effect.
8. **The lunge is its own constant-speed dash, not knockback.** It moves `tiles × 32 / dur` px/s along `dir` for up to 80 px. The first foe (the nearest one, if several qualify on one tick) whose body's nearest point is within `lunge.reach` in the forward half-plane is checked before and after each step. That foe takes the damage through `hurtHero` as a melee `'hit'`, and the dash ends (`done`). A wall ends the dash flush against it: the step shrinks a pixel at a time and is never negative. While the dash runs (`isDashing`), `moveHero` neither walks nor turns the hero. There is no knockback on the lunge or on the thrusts (the spec names knockback only for the whirlwind).
9. **The fence** fires thrust *i* on the first tick where `move.t ≥ times[i]`, which at 30 Hz is ticks 0, 4 and 8 after the release. Each thrust is the `snap` style's half-angle (50°) at `fence.reach` and is drawn with the dagger's quick poke animation.
10. **The whirlwind** hits everyone whose nearest point is within 44 px. It knocks back only the foes it actually hurt (a blocked hit instead shoves the spinner, as any blocked melee blow does). It animates as the `spin` swing style at 44 px reach.
11. **"All three can land" and "both arrows can hit".** The existing 0.8 s i-frames (`INVULN_DURATION`) would swallow the second thrust or arrow. `hurtHero` gains `group`: a hit from the same attack (one fence, one double shot) passes the i-frames that the same group's earlier hit granted. Blocks still apply to each hit. A group id is `${hero.id}#${match.groupSeq}`.
12. **Combo hit tests use `match.hitPos`** (the server's melee rewind) exactly as the swing does. Damage, knockback and blocks use the real hero.
13. **The double shot** needs a bow (`ranged.kind === 'bow'`, so not the rune's crossbow), at least one arrow and the ranged cooldown ready. The draw is level-triggered on alt. `t` is capped at `full` (1.2 s), and there is no auto-release. With one arrow left, the one arrow flies from the centre. Double-shot arrows carry `trail: true` for the band-tinted tail.
14. **Fireball `detonate` knows the shooter and the direct target** through a fifth argument, `{ owner, struck }`, that `stepProjectiles` passes (`struck: null` at a wall or at the end of range). Single-player's `detonateFireball` ignores it. The burst skips `struck` even when a buckler blocked the direct hit. The fire patch burns everyone standing in it, the direct target included, and credits the zone's `owner` (nobody, once the caster has left). The caster is immune through `hurtHero`'s self-refusal. Zones tick at 1, 2 and 3 s (3 damage in all), with 1e-9 epsilons so the float sum never drops the third tick.
15. **Prediction.** `predictStep` returns `{ released }` (the classified combo on a release tick). `predictCosmetics(pred, input, dt, released)` starts the local sword swing only on a `swing` release. The predictor mirrors the hold, the gesture's stamina, each release's stamina and cooldown, the draw's start, hold, cap and release (ammo and `rangedCooldown` through `payDoubleShot`, plain shots through `tryFire`), and the Mage's overridden cooldown. It does not run the dash. It does age a `hero.move` that a snapshot showed, so a replayed dash stops the walk exactly as long as the server's did.
16. **The mage bot's tier** is the tier whose strike distance (`LIGHTNING.dists`: tap 3, full 6, over 4/6/8) is nearest the foe's distance in tiles. Ties go to the cheaper tier. The **archer bot's "not closing"** test is that the foe is not facing the archer (a hero walks the way it faces).

## Spec deviations

- **Protocol v4 carries more than §5 lists.**
  - `combo` also carries `last` (the gesture's last sector). Without it, a reconcile replay would read a direction held across a snapshot as a new move and charge 25 stamina the server never charged.
  - `move` also carries `from` (for the lunge's streak) and `done` (so a replayed dash stops when the server's did).
  - Snapshots gain `fireZones: [{ tiles, age }]`, without which an online client could not draw the fire patch (`netViewOf` hard-codes `fireZones: []` today).
  - Projectiles gain an optional `trail: true` for the double shot's tinted trails.
- **The client input latch stops latching releases** (`renderer/net/client.js`). Today a press seen by any frame since the last send is sent, and the frame state is carried into the next send. That delays a release by one input (33 ms). Now that the sword and the double shot fire on the release, the delay makes every release late, and prototyping showed it made the existing 150 ms melee-rewind test (`net-play.test.js`) flaky. The spec does not mention the latch. Presses are still latched; releases are sent at once.
- **The live screenshots come from an online match on an in-process server, not from the local `pvp` cheat.** The spec asks for local `pvp` screenshots, but the page's own match cannot be staged from a script: it cannot place heroes or freeze bots. The same renderer draws both modes. The local mode still gets a smoke check (a Warrior gesture, no page errors).

## Review Focus

The five uncovered inputs most likely to bite a player, each pinned by a test in the named task:
1. **The rune picked up mid-hold, or ending mid-wind-up.** The dropped hold must not fire a swing on the next release, and the sword must hold cleanly again afterwards (no stale hammer `charging`) → Task 3, "the rune picked up mid-hold drops the hold; when it ends mid-wind-up the sword is back, clean".
2. **Pressing attack while walking diagonally.** The hold slides that diagonal at half speed, and keeping the diagonal held is not a move that costs 25 → Task 3, "pressed while walking diagonally…".
3. **A lunge started flush against a wall.** It must go nowhere, end, and never spin the wall-clamp loop forever → Task 4, "flush against a wall the lunge goes nowhere, ends, and does not hang".
4. **A stun in the middle of a draw.** The draw drops, and nothing fires or is spent → Task 5, "a stun mid-draw drops the draw: nothing fires, nothing is spent".
5. **A fire patch whose caster has left the match.** It keeps burning without crashing on the missing owner → Task 7, "a patch whose caster has left the match burns on, crediting nobody".

---

## File Structure

| File | Responsibility |
|---|---|
| `renderer/data/pvp.js` (edit) | the 2a numbers: `PVP.hp`, plate, kits, rune, `WARRIOR_COMBOS`, `DOUBLE_SHOT` + `drawFrac`/`doubleShotBand`, `SPELL_OVERRIDES`, `CLASS_HINTS`, `BOTS` fields |
| `renderer/pvp/combos.js` (new) | the pure recogniser (`sectorOf`, `unitMove`, `startGesture`, `stepGesture`, `classify`) and the hold helpers (`isComboWeapon`, `beginHold`, `holdGesture`, `isDashing`) |
| `renderer/pvp/hero.js` (edit) | the slide in `moveHero`; hold, release and cancel in `tickMelee`; the draw in `tickRanged`; `stepCombo` each tick |
| `renderer/pvp/attacks.js` (edit) | `comboCooldown`, `startCombo`/`stepCombo` (lunge, fence, whirl), `canDrawDouble`/`payDoubleShot`/`looseDouble`, spell override on `castSpell` |
| `renderer/pvp/combat.js` (edit) | `hurtHero({ group })` |
| `renderer/pvp/sim.js` (edit) | clears on death, projectile `group`, `detonateFireball`, `tickFireZones` |
| `renderer/pvp/pickups.js` (edit) | the rune clears a hold |
| `renderer/pvp/bots.js` (edit) | lunge, whirl, double shot, lightning tier |
| `renderer/systems/spells.js`, `renderer/systems/spells/lightning.js` (edit) | the `override` seam; marks carrying their own numbers |
| `renderer/systems/projectiles.js` (edit) | `detonate`'s fifth argument |
| `renderer/systems/sfx.js`, `renderer/render/audio.js` (edit) | the `whirl` cue |
| `renderer/net/protocol.js`, `renderer/data/net.js` (edit) | v4: `combo`, `move`, `fireZones`, `trail` |
| `renderer/net/predict.js`, `renderer/net/client.js`, `renderer/net/view.js` (edit) | the hold, draw and cooldown mirrors; `released`; the latch; `fireZones` into the view |
| `renderer/render/pvp-fx.js` (new), `renderer/render/canvas.js` (edit) | the move visuals |
| `renderer/ui/menu.js`, `renderer/index.html`, `renderer/game.js` (edit) | class hints; the whirl's screen shake |
| `test/pvp-classes.test.js`, `test/pvp-combos.test.js`, `test/pvp-warrior.test.js`, `test/pvp-archer.test.js`, `test/pvp-mage.test.js`, `test/pvp-fx.test.js` (new) | tests |
| `test/pvp-attacks.test.js`, `test/pvp-hero.test.js`, `test/pvp-pickups.test.js`, `test/pvp-sim.test.js`, `test/pvp-bots.test.js`, `test/net-sim.test.js`, `test/net-play.test.js`, `test/net-predict.test.js`, `test/net-client.test.js`, `test/net-protocol.test.js`, `test/net-ui.test.js`, `test/projectiles.test.js`, `test/menu.test.js` (edit) | tests |

Task order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Each task leaves `npm test` green.

---
### Task 1: The 2a numbers, the kit and rune swaps, time-to-kill

**Files:**
- Modify: `renderer/data/pvp.js` (`PVP.hp`, `KITS.mage`, `OUTFIT_OVERRIDES`, `RUNE_POWER.mage`, and new tables appended at the end)
- Create: `test/pvp-classes.test.js`
- Modify (numbers only): `test/pvp-attacks.test.js`, `test/pvp-hero.test.js`, `test/pvp-pickups.test.js`, `test/pvp-sim.test.js`, `test/net-sim.test.js`, `test/net-play.test.js`

**Interfaces:**
- Produces (all from `renderer/data/pvp.js`):
  - `PVP.hp === 8`; `OUTFIT_OVERRIDES.plate.protect === 0`; `KITS.mage.loadout.wandType === 'stormwand'`; `RUNE_POWER.mage` is `{ wandType: 'firewand' }`;
  - `WARRIOR_COMBOS = { weapon: 'sword', holdMoveMul, moveCost, maxMoves, fxDur, lunge: { tiles, dur, reach, damage }, fence: { times, reach, damage }, whirl: { reach, damage, knockback, cooldownMul } }`;
  - `DOUBLE_SHOT = { full, min, moveMul, gap, cooldown, bands: { from, damage, color }[] }` (highest band first);
  - `drawFrac(t: number) → number` in [0, 1]; `doubleShotBand(frac: number) → band | null`;
  - `SPELL_OVERRIDES = { lightning: { cooldown, delay, damage, stun }, fireball: { burst } }`;
  - `CLASS_HINTS = { warrior, archer, mage }` (strings).

- [ ] **Step 1: Write the failing test**

Create `test/pvp-classes.test.js`:

```js
// Sub-project 2a: the numbers, the kits and the time-to-kill.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PVP, KITS, RUNE_POWER, OUTFIT_OVERRIDES, PICKUPS, WARRIOR_COMBOS, DOUBLE_SHOT, SPELL_OVERRIDES,
  CLASS_HINTS, drawFrac, doubleShotBand } from '../renderer/data/pvp.js'
import { makeHero, placeHero } from '../renderer/pvp/hero.js'
import { hurtHero } from '../renderer/pvp/combat.js'
import { STAMINA_MAX } from '../renderer/systems/stamina.js'
import { testMatch } from './pvp-helpers.js'

describe('2a numbers', () => {
  it('time-to-kill: hp 8, plate protect 0, flasks heal half', () => {
    assert.equal(PVP.hp, 8)
    assert.deepEqual(OUTFIT_OVERRIDES.plate, { protect: 0 })
    assert.equal(PICKUPS.flask.heal, 4)
  })
  it('kits and rune: the mage mains the Storm Wand, the rune is the Fireball Wand', () => {
    assert.equal(KITS.mage.loadout.wandType, 'stormwand')
    assert.equal(KITS.mage.loadout.offhand.weaponType, 'blinkwand')
    assert.deepEqual(RUNE_POWER.mage, { wandType: 'firewand' })
    assert.equal(KITS.warrior.loadout.weaponType, 'sword')
    assert.equal(KITS.warrior.loadout.offhand.weaponType, 'buckler')
  })
  it('warrior combos', () => {
    assert.equal(WARRIOR_COMBOS.holdMoveMul, 0.5)
    assert.equal(WARRIOR_COMBOS.moveCost, 25)
    assert.equal(WARRIOR_COMBOS.maxMoves * WARRIOR_COMBOS.moveCost, STAMINA_MAX)
    assert.deepEqual(WARRIOR_COMBOS.lunge, { tiles: 2.5, dur: 0.15, reach: 20, damage: 3 })
    assert.deepEqual(WARRIOR_COMBOS.fence, { times: [0, 0.12, 0.24], reach: 40, damage: 1 })
    assert.deepEqual(WARRIOR_COMBOS.whirl, { reach: 44, damage: 2, knockback: 40, cooldownMul: 1.5 })
    assert.ok(WARRIOR_COMBOS.fxDur > WARRIOR_COMBOS.fence.times.at(-1) + PVP.tick, 'the last thrust fires inside the effect')
  })
  it('double shot: 1.2 s draw, bands 1-5 from 30 %, 0.8 s cooldown, arrows 12 px apart', () => {
    assert.equal(DOUBLE_SHOT.full, 1.2); assert.equal(DOUBLE_SHOT.moveMul, 0.6)
    assert.equal(DOUBLE_SHOT.gap, 12); assert.equal(DOUBLE_SHOT.cooldown, 0.8)
    const dmg = f => doubleShotBand(f)?.damage ?? null
    assert.deepEqual([0, 0.29, 0.3, 0.39, 0.4, 0.54, 0.55, 0.69, 0.7, 0.84, 0.85, 1].map(dmg),
      [null, null, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
    assert.equal(drawFrac(0.6), 0.5); assert.equal(drawFrac(5), 1)
  })
  it('spell overrides and class hints', () => {
    assert.deepEqual(SPELL_OVERRIDES.lightning, { cooldown: 1.5, delay: 0.4, damage: 3, stun: 0.6 })
    assert.deepEqual(SPELL_OVERRIDES.fireball, { burst: 2 })
    assert.deepEqual(CLASS_HINTS, { warrior: 'Hold attack + stick: combos', archer: 'Hold Q: double shot', mage: 'Storm Wand · Q: blink' })
  })
})

describe('time-to-kill', () => {
  // Sword blows (2 damage) until the target drops; i-frames are waited out.
  const blowsToKill = cls => {
    const w = makeHero({ id: 'w', name: 'w', cls: 'warrior' }); placeHero(w, { x: 4, y: 5 })
    const t = makeHero({ id: 't', name: 't', cls }); placeHero(t, { x: 5, y: 5 })
    const m = testMatch([w, t])
    let n = 0
    while (t.hp > 0 && n < 20) { t.invulnTimer = 0; hurtHero(m, t, 2, { by: w, melee: true }); n++ }
    return n
  }
  it('a sword kills a Warrior, an Archer and a Mage in 4 hits each', () => {
    assert.equal(blowsToKill('warrior'), 4)
    assert.equal(blowsToKill('archer'), 4)
    assert.equal(blowsToKill('mage'), 4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pvp-classes.test.js`
Expected: FAIL — `SyntaxError: The requested module '../renderer/data/pvp.js' does not provide an export named 'CLASS_HINTS'`.

- [ ] **Step 3: Write the data**

In `renderer/data/pvp.js`:

Replace `  hp: 10,` with:

```js
  hp: 8,                 // 2a: fights end sooner (a sword kills anyone in 4)
```

In `KITS`, change the mage's `wandType: 'sparkwand'` to `wandType: 'stormwand'` (the rest of the line stays as it is).

Replace the `OUTFIT_OVERRIDES` block (its comment and the export) with:

```js
// Plate's protect 2 would make every 1-2 damage weapon near-useless on the
// Warrior; in a match it is 0 (2a: the buckler is the Warrior's defence).
// Single-player's OUTFIT_TYPES stays as it is.
export const OUTFIT_OVERRIDES = { plate: { protect: 0 } }
```

In `RUNE_POWER`, replace `  mage:    { wandType: 'stormwand' },` with `  mage:    { wandType: 'firewand' },`.

Append at the end of the file:

```js

// Sub-project 2a (spec 2026-09-26-pvp-2a-class-rework-design.md) — each
// class's signature move.

// The Warrior's gesture combos: moves entered with the stick while the attack
// is held, fired on release (renderer/pvp/combos.js recognises them, hero.js
// runs the hold, attacks.js the effects). px unless named otherwise.
export const WARRIOR_COMBOS = {
  weapon: 'sword',     // the one combo weapon; the rune's hammer keeps its own charge tiers
  holdMoveMul: 0.5,    // walk speed while the attack is held, along lockDir
  moveCost: 25,        // stamina per recorded move (STAMINA_MAX is 100)
  maxMoves: 4,         // later moves are ignored, and free
  fxDur: 0.35,         // s a combo effect (hero.move) lives: the dash, the thrusts, and what is drawn
  lunge: { tiles: 2.5, dur: 0.15, reach: 20, damage: 3 },
  fence: { times: [0, 0.12, 0.24], reach: 40, damage: 1 },   // each thrust a snap-style wedge
  whirl: { reach: 44, damage: 2, knockback: 40, cooldownMul: 1.5 },
}

// The Archer's double shot on Q: a draw of `full` s; below `min` of it a
// release fires nothing. Two arrows `gap` px apart across the facing, each
// dealing its band's damage (bands by draw fraction, highest first), trails
// tinted white → gold.
export const DOUBLE_SHOT = {
  full: 1.2, min: 0.3, moveMul: 0.6, gap: 12, cooldown: 0.8,
  bands: [
    { from: 0.85, damage: 5, color: '#facc15' },
    { from: 0.70, damage: 4, color: '#fcd34d' },
    { from: 0.55, damage: 3, color: '#fde68a' },
    { from: 0.40, damage: 2, color: '#fef3c7' },
    { from: 0.30, damage: 1, color: '#ffffff' },
  ],
}
export const drawFrac = t => Math.min(Math.max(t, 0) / DOUBLE_SHOT.full, 1)
// The band a draw fraction falls in, or null below DOUBLE_SHOT.min.
export const doubleShotBand = frac => DOUBLE_SHOT.bands.find(b => frac >= b.from - 1e-9) ?? null

// PvP numbers for shared spells, passed to tryCast as its `override`
// (single-player's SPELLS rows stay as they are). The fireball's `burst` is
// read by the sim's detonate hook.
export const SPELL_OVERRIDES = {
  lightning: { cooldown: 1.5, delay: 0.4, damage: 3, stun: 0.6 },
  fireball: { burst: 2 },
}

// The class picker's line under each class button.
export const CLASS_HINTS = {
  warrior: 'Hold attack + stick: combos',
  archer: 'Hold Q: double shot',
  mage: 'Storm Wand · Q: blink',
}
```

- [ ] **Step 4: Run the new test, then the suite, and see which old expectations moved**

Run: `node --test test/pvp-classes.test.js`
Expected: PASS (6 tests).

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: about 21 failures, all in the files listed below: old hp-10, protect-1 and spark-wand expectations.

- [ ] **Step 5: Update the old expectations**

Each change is an exact replacement (old → new) in the named file.

`test/pvp-attacks.test.js`:
- In "a sword tap hits the foe in front for 2…": `assert.equal(a.hp, 8)` → `assert.equal(a.hp, 6)`.
- In "misses a foe behind the swinger": `assert.equal(a.hp, 10)` → `assert.equal(a.hp, 8)`.
- In "an overcharged hammer chains 4/3…": `assert.equal(a.hp, 6)` / `assert.equal(b.hp, 7)` / `assert.equal(w.hp, 10)` → `4` / `5` / `8`.
- In "an overcharged whiff rains…": `assert.equal(w.hp, 10)` → `assert.equal(w.hp, 8)`.
- Replace the first two tests of `describe('magic', …)` with:

```js
  it('holding then releasing attack calls lightning owned by the mage (the Storm Wand is the main hand)', () => {
    const mg = hero('m', 'mage', { x: 5, y: 5 })
    const m = testMatch([mg])
    tickHero(m, mg, input({ attack: true, facing: 'east' }), dt)
    assert.equal(mg.charging?.kind, 'spell')
    tickHero(m, mg, input({ attack: false }), dt)
    assert.equal(m.lightning.length, 1)
    assert.equal(m.lightning[0].owner, 'm')
    assert.equal(mg.charging, null)
  })
  it('a held attack auto-releases once and waits for a let-go before charging again', () => {
    const mg = hero('m', 'mage', { x: 5, y: 5 })
    const m = testMatch([mg])
    for (let i = 0; i < 90; i++) tickHero(m, mg, input({ attack: true, facing: 'east' }), dt)
    assert.equal(m.lightning.length, 3)   // one overcharge release: three marks on one line
    assert.equal(mg.charging, null)
  })
```

`test/pvp-hero.test.js`:
- Test title `'a warrior wears plate at protect 1, …'` → `'a warrior wears plate at protect 0, …'`; in it `outfit.protect, 1)` → `outfit.protect, 0)` and `assert.equal(h.hp, 10)` → `assert.equal(h.hp, 8)`.
- Test title `'an archer has a shortbow and 24 arrows; a mage a spark wand and a blink offhand'` → `'… a mage a storm wand and a blink offhand'`; in it `'sparkwand'` → `'stormwand'`.
- In "applyKit fully resets…": `assert.equal(h.hp, 10)` → `assert.equal(h.hp, 8)`.
- In "hurtHero damages, records the attacker…": `assert.equal(b.hp, 8)` → `assert.equal(b.hp, 6)`.
- Replace the body of "a hit event reports the damage that actually landed, after outfit protect" with:

```js
    const a = hero('a', 'archer', { x: 4, y: 5 }), w = hero('w', 'warrior'); const m = testMatch([a, w])
    w.gear.melee.outfit.protect = 1   // a match's plate is 0 (2a); any protect still comes off
    assert.equal(hurtHero(m, w, 2, { by: a }), true)
    assert.equal(w.hp, 7)   // protect 1 reduces the raw 2 to 1
    assert.deepEqual(m.events[0], { type: 'hit', target: 'w', by: 'a', amount: 1 })
```

- In "never hurts the attacker itself…": `assert.equal(a.hp, 10)` → `assert.equal(a.hp, 8)`.

`test/pvp-pickups.test.js`:
- In "heals 4 (capped)…": `h.hp = 8` → `h.hp = 6`, and `assert.equal(h.hp, 10)` → `assert.equal(h.hp, 8)`.
- In "comes back after its timer…": `assert.equal(h.hp, 10)` → `assert.equal(h.hp, 8)`.
- In "turns each class main hand into its power weapon and back": `assert.equal(mg.wand.weaponType, 'stormwand')` → `'firewand'`, and after the loop `assert.equal(mg.wand.weaponType, 'sparkwand')` → `'stormwand'`.

`test/pvp-sim.test.js`: `assert.equal(b.hp, 10)` (two places: "respawns after the delay…" and "a spawn-protected hero cannot be hit") → `assert.equal(b.hp, 8)`; in "a shield-blocked crossbow bolt does zero damage…": `assert.equal(w.hp, 10)` → `assert.equal(w.hp, 8)`.

`test/net-sim.test.js` (`describe('swing hitPos seam')`): `assert.equal(a.hp, 10)` → `8`; `assert.equal(a.hp, 8)` (the rewound hit) → `6`.

`test/net-play.test.js`: `assert.equal(hb.hp < 10, rewind, …)` → `assert.equal(hb.hp < hb.maxHp, rewind, …)`.

- [ ] **Step 6: Run the suite**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0` (2960 passing).

- [ ] **Step 7: Commit**

```bash
git add renderer/data/pvp.js test/pvp-classes.test.js test/pvp-attacks.test.js test/pvp-hero.test.js test/pvp-pickups.test.js test/pvp-sim.test.js test/net-sim.test.js test/net-play.test.js
git commit -m "feat(pvp): 2a numbers — hp 8, plate 0, Storm Wand main, Fireball rune, combo/double-shot/spell tables

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 2: The gesture recogniser (`renderer/pvp/combos.js`)

**Files:**
- Create: `renderer/pvp/combos.js`
- Create: `test/pvp-combos.test.js`

**Interfaces:**
- Consumes: `WARRIOR_COMBOS` (Task 1).
- Produces (from `renderer/pvp/combos.js`):
  - `OPPOSITE: { n: 's', s: 'n', e: 'w', w: 'e' }`, `SECTOR_FACING: { n: 'north', e: 'east', s: 'south', w: 'west' }`;
  - `unitMove(move: {x, y}) → { x, y }` (each axis signed, a diagonal divided by √2);
  - `sectorOf(move, prev = null) → 'n' | 'e' | 's' | 'w' | null`;
  - `startGesture(move) → { moves: [], last: sector | null, cost: 0 }`;
  - `stepGesture(state, move, stamina = Infinity) → { moves: string[], last, cost: 0 | 25 }` (never mutates `state`);
  - `classify(moves: string[]) → { kind: 'swing' | 'lunge' | 'fence' | 'whirl', dir: sector | null }`.

- [ ] **Step 1: Write the failing test**

Create `test/pvp-combos.test.js`:

```js
// The Warrior's gesture recogniser (renderer/pvp/combos.js).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sectorOf, startGesture, stepGesture, classify, unitMove } from '../renderer/pvp/combos.js'

const N = { x: 0, y: -1 }, E = { x: 1, y: 0 }, S = { x: 0, y: 1 }, W = { x: -1, y: 0 }, O = { x: 0, y: 0 }
const NE = { x: 1, y: -1 }
// Feed a list of stick positions to a fresh gesture, stamina unlimited.
const feed = (moves, stamina = Infinity, start = O) => {
  let g = startGesture(start)
  let spent = 0
  for (const m of moves) { g = stepGesture(g, m, stamina - spent); spent += g.cost }
  return { g, spent }
}

describe('sectorOf', () => {
  it('reads the four sectors and neutral', () => {
    assert.deepEqual([N, E, S, W, O].map(m => sectorOf(m)), ['n', 'e', 's', 'w', null])
  })
  it('a diagonal with equal axes keeps the previous sector', () => {
    assert.equal(sectorOf(NE, 'n'), 'n')
    assert.equal(sectorOf(NE, 'e'), 'e')
    assert.equal(sectorOf(NE, null), null)
  })
  it('unitMove normalises a diagonal', () => {
    const u = unitMove(NE)
    assert.ok(Math.abs(Math.hypot(u.x, u.y) - 1) < 1e-12)
    assert.deepEqual(unitMove(O), { x: 0, y: 0 })
  })
})

describe('stepGesture', () => {
  it('leaving neutral and every change of sector is a move, costing 25', () => {
    const { g, spent } = feed([E, O, E])
    assert.deepEqual(g.moves, ['e', 'e'])
    assert.equal(spent, 50)
  })
  it('holding a direction registers once; the same direction again needs neutral between', () => {
    assert.deepEqual(feed([E, E, E]).g.moves, ['e'])
    assert.deepEqual(feed([E, O, O, E]).g.moves, ['e', 'e'])
  })
  it('W then adding D does not register until W is let go', () => {
    const up = { x: 0, y: -1 }, upRight = { x: 1, y: -1 }, right = { x: 1, y: 0 }
    assert.deepEqual(feed([up, upRight, upRight]).g.moves, ['n'])
    assert.deepEqual(feed([up, upRight, right]).g.moves, ['n', 'e'])
  })
  it('sweeping the stick around registers each quarter', () => {
    assert.deepEqual(feed([N, E, S, W]).g.moves, ['n', 'e', 's', 'w'])
  })
  it('the direction held at the press is not a move', () => {
    assert.deepEqual(feed([E, E], Infinity, E).g.moves, [])
    assert.deepEqual(feed([O, E], Infinity, E).g.moves, ['e'])
  })
  it('records at most four moves; later ones are ignored and free', () => {
    const { g, spent } = feed([N, E, S, W, N, E])
    assert.equal(g.moves.length, 4)
    assert.equal(spent, 100)
  })
  it('a move the hero cannot afford is not recorded, and still counts as seen', () => {
    const { g, spent } = feed([E, O, E, O, E], 60)
    assert.deepEqual(g.moves, ['e', 'e'])
    assert.equal(spent, 50)
    assert.equal(g.last, 'e')
  })
})

describe('classify', () => {
  it('no moves is the plain swing', () => {
    assert.deepEqual(classify([]), { kind: 'swing', dir: null })
  })
  it('d, d is a lunge toward d', () => {
    for (const d of ['n', 'e', 's', 'w']) assert.deepEqual(classify([d, d]), { kind: 'lunge', dir: d })
  })
  it('d, opposite is a fence toward d', () => {
    assert.deepEqual(classify(['e', 'w']), { kind: 'fence', dir: 'e' })
    assert.deepEqual(classify(['s', 'n']), { kind: 'fence', dir: 's' })
  })
  it('four quarter turns in one sense, either sense, is a whirlwind', () => {
    assert.deepEqual(classify(['n', 'e', 's', 'w']), { kind: 'whirl', dir: 'w' })
    assert.deepEqual(classify(['e', 'n', 'w', 's']), { kind: 'whirl', dir: 's' })
    assert.deepEqual(classify(['w', 'n', 'e', 's']), { kind: 'whirl', dir: 's' })
  })
  it('anything else is the plain swing', () => {
    for (const m of [['e'], ['e', 'n'], ['n', 'e', 's'], ['n', 'e', 'n', 'e'], ['n', 'e', 's', 'e'], ['e', 'e', 'e']])
      assert.deepEqual(classify(m), { kind: 'swing', dir: null }, m.join(','))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pvp-combos.test.js`
Expected: FAIL — `Cannot find module '…/renderer/pvp/combos.js'`.

- [ ] **Step 3: Write the recogniser**

Create `renderer/pvp/combos.js`:

```js
// The Warrior's gesture recogniser (spec 2a §2): while the attack is held,
// the stick's direction each tick is read as one of the screen's four
// sectors, and every change to a new sector is a move. Release classifies
// the moves into a combo. Pure: the sim and the client's predictor both run
// it, so a predicted hold spends exactly the stamina the server's does.
import { WARRIOR_COMBOS } from '../data/pvp.js'

const ORDER = ['n', 'e', 's', 'w']
export const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' }
export const SECTOR_FACING = { n: 'north', e: 'east', s: 'south', w: 'west' }

// The unit vector of an input move (each axis clamped to -1/0/1, a diagonal
// normalised): the walk direction moveHero uses, and a hold's lockDir.
export function unitMove(move) {
  let x = Math.sign(move?.x ?? 0), y = Math.sign(move?.y ?? 0)
  if (x !== 0 && y !== 0) { x /= Math.SQRT2; y /= Math.SQRT2 }
  return { x, y }
}

// The sector a move points into: the dominant axis wins; neutral is null; a
// diagonal with equal axes keeps `prev`, so adding D to a held W changes
// nothing until W is let go.
export function sectorOf(move, prev = null) {
  const x = Math.sign(move?.x ?? 0), y = Math.sign(move?.y ?? 0)
  if (x === 0 && y === 0) return null
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'e' : 'w'
  if (Math.abs(y) > Math.abs(x)) return y > 0 ? 's' : 'n'
  return prev
}

// A fresh gesture at the press. `last` starts as the sector already held, so
// walking into the press is not itself a move — the stick must change.
export const startGesture = move => ({ moves: [], last: sectorOf(move, null), cost: 0 })

// One tick of the held attack. A move registers when the sector changes to a
// non-null sector other than the last one seen (leaving neutral included),
// costs WARRIOR_COMBOS.moveCost, and is refused when `stamina` cannot pay it.
// Past WARRIOR_COMBOS.maxMoves moves are ignored and free. `cost` is what
// this tick spends (0 or moveCost); the caller pays it.
export function stepGesture(state, move, stamina = Infinity) {
  const sector = sectorOf(move, state.last)
  const next = { moves: state.moves, last: sector, cost: 0 }
  if (sector === null || sector === state.last) return next
  if (state.moves.length >= WARRIOR_COMBOS.maxMoves) return next
  if (stamina < WARRIOR_COMBOS.moveCost) return next
  return { moves: [...state.moves, sector], last: sector, cost: WARRIOR_COMBOS.moveCost }
}

const turn = (a, b) => (ORDER.indexOf(b) - ORDER.indexOf(a) + 4) % 4

// What a release fires: { kind: 'swing' | 'lunge' | 'fence' | 'whirl', dir }
// — dir is the sector the combo aims (null for a swing: the facing held).
// d,d a lunge toward d; d,opposite(d) a fence toward d; four moves each
// turning 90° the same way round a whirlwind (aimed at its last move);
// anything else a plain swing.
export function classify(moves) {
  if (moves.length === 2 && moves[0] === moves[1]) return { kind: 'lunge', dir: moves[0] }
  if (moves.length === 2 && moves[1] === OPPOSITE[moves[0]]) return { kind: 'fence', dir: moves[0] }
  if (moves.length === 4) {
    const turns = moves.slice(1).map((m, i) => turn(moves[i], m))
    if (turns.every(t => t === 1) || turns.every(t => t === 3)) return { kind: 'whirl', dir: moves[3] }
  }
  return { kind: 'swing', dir: null }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/pvp-combos.test.js`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add renderer/pvp/combos.js test/pvp-combos.test.js
git commit -m "feat(pvp): the Warrior's gesture recogniser — sectors, moves, combo classification

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---
### Task 3: The Warrior's hold and release — sim, predictor, protocol `combo`, input latch

The sword becomes a combo weapon. The press begins a hold, the hold slides the hero at half speed along the move held at the press, moves are paid as they register, and the release fires a plain swing (for no moves or an unknown pattern) or starts the combo's cooldown. The combo *effects* come in Task 4. The predictor mirrors all of it, the snapshot carries `combo`, and the client stops delaying releases.

**Files:**
- Modify: `renderer/pvp/combos.js` (append the hold helpers), `renderer/pvp/hero.js`, `renderer/pvp/attacks.js` (`comboCooldown`), `renderer/pvp/pickups.js`, `renderer/pvp/sim.js` (`resolveDeaths`), `renderer/pvp/bots.js` (warrior taps)
- Modify: `renderer/net/protocol.js` (`combo`), `renderer/net/predict.js`, `renderer/net/client.js`
- Create: `test/pvp-warrior.test.js`
- Modify: `test/net-predict.test.js`, `test/net-client.test.js`, `test/pvp-attacks.test.js`, `test/net-sim.test.js`, `test/net-play.test.js`, `test/pvp-bots.test.js`

**Interfaces:**
- Consumes: `WARRIOR_COMBOS` (Task 1); `unitMove`, `startGesture`, `stepGesture`, `classify`, `SECTOR_FACING` (Task 2).
- Produces:
  - `combos.js`: `isComboWeapon(weaponType) → boolean` (`'sword'`); `beginHold(hero, move)` sets `hero.combo = { moves: [], last, lockDir: {x, y} }`; `holdGesture(hero, move)` steps the gesture and pays its cost;
  - `hero.combo: { moves: string[], last: sector | null, lockDir: { x, y } } | null` on every hero;
  - `attacks.js`: `comboCooldown(weaponType, kind) → number` (the weapon's cooldown; × `whirl.cooldownMul` for `'whirl'`);
  - `predict.js`: `predictStep(pred, input, dt?) → { released: { kind, dir } | null }`; `predictCosmetics(pred, input, dt = PVP.tick, released = null)`;
  - protocol: hero snapshot field `combo: { moves, lockDir, last } | null`, hydrated back onto `hero.combo`.

- [ ] **Step 1: Write the failing tests**

Create `test/pvp-warrior.test.js` (Task 4 extends it):

```js
// The Warrior's hold and release (spec 2a §2): renderer/pvp/hero.js.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeHero, placeHero, tickHero, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { grantRune, endRune } from '../renderer/pvp/pickups.js'
import { getAttack } from '../renderer/systems/melee.js'
import { PLAYER_SPEED } from '../renderer/systems/movement.js'
import { PVP, WARRIOR_COMBOS } from '../renderer/data/pvp.js'
import { testMatch } from './pvp-helpers.js'

const dt = PVP.tick
const hero = (id, cls, cell) => { const h = makeHero({ id, name: id, cls }); placeHero(h, cell); return h }
const input = over => ({ ...NEUTRAL_INPUT, move: { x: 0, y: 0 }, ...over })
const N = { x: 0, y: -1 }, E = { x: 1, y: 0 }, S = { x: 0, y: 1 }, W = { x: -1, y: 0 }, O = { x: 0, y: 0 }
// Hold the attack through `moves` (one stick position a tick), then let go.
const gesture = (m, h, moves, over = {}) => {
  for (const move of moves) tickHero(m, h, input({ attack: true, move, ...over }), dt)
  tickHero(m, h, input({ attack: false }), dt)
}
const SWORD_CD = getAttack('sword').cooldown

describe('the hold', () => {
  it('a press begins a hold that records the move held at that moment as lockDir', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    tickHero(m, w, input({ attack: true, move: E, facing: 'east' }), dt)
    assert.deepEqual(w.combo, { moves: [], last: 'e', lockDir: { x: 1, y: 0 } })
  })
  it('while held the hero slides along lockDir at half speed, the stick does not steer or turn, and there is no sprint', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    tickHero(m, w, input({ attack: true, move: E, facing: 'east' }), dt)
    const x0 = w.px, y0 = w.py
    tickHero(m, w, input({ attack: true, move: N, facing: 'north', sprint: true }), dt)
    assert.ok(Math.abs(w.px - x0 - PLAYER_SPEED * WARRIOR_COMBOS.holdMoveMul * dt) < 1e-9)
    assert.equal(w.py, y0)
    assert.equal(w.facing, 'east')
    assert.equal(w.stamina, 100 - WARRIOR_COMBOS.moveCost)   // the move to N paid 25, and no sprint drain
  })
  it('standing still at the press, the hold stands still', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    tickHero(m, w, input({ attack: true }), dt)
    const x0 = w.px
    tickHero(m, w, input({ attack: true, move: E }), dt)
    assert.equal(w.px, x0)
  })
  it('each move costs 25 stamina; a move the tank cannot pay is not recorded', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    tickHero(m, w, input({ attack: true }), dt)
    for (const move of [E, O, E]) tickHero(m, w, input({ attack: true, move }), dt)
    assert.deepEqual(w.combo.moves, ['e', 'e'])
    assert.equal(w.stamina, 50)
    w.stamina = 20
    for (const move of [O, S]) tickHero(m, w, input({ attack: true, move }), dt)
    assert.deepEqual(w.combo.moves, ['e', 'e'])
    assert.equal(w.stamina, 20)
  })
  it('a hold does not begin inside the melee cooldown', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w]); w.meleeCooldown = 0.3
    tickHero(m, w, input({ attack: true }), dt)
    assert.equal(w.combo, null)
  })
  it('a stun cancels the hold: nothing fires, the stamina stays spent, and the attack must be let go', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }); const m = testMatch([w, a])
    w.facing = 'east'
    tickHero(m, w, input({ attack: true }), dt)
    tickHero(m, w, input({ attack: true, move: E }), dt)
    w.stunTimer = 0.1
    tickHero(m, w, input({ attack: true }), dt)
    assert.equal(w.combo, null)
    assert.equal(w.stamina, 75)
    w.stunTimer = 0
    tickHero(m, w, input({ attack: true }), dt)
    assert.equal(w.combo, null, 'still held since the cancel: no new hold')
    tickHero(m, w, input({ attack: false }), dt)
    assert.equal(a.hp, PVP.hp)
    assert.equal(w.attackTimer, 0)
  })
  it('raising the shield cancels the hold', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }); const m = testMatch([w, a])
    w.facing = 'east'
    tickHero(m, w, input({ attack: true }), dt)
    tickHero(m, w, input({ attack: true, alt: true }), dt)
    assert.equal(w.combo, null)
    assert.equal(w.blocking, true)
    tickHero(m, w, input({ attack: false }), dt)
    assert.equal(a.hp, PVP.hp)
  })
  it("the rune's hammer keeps its charge tiers: no combo", () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    grantRune(m, w)
    tickHero(m, w, input({ attack: true }), dt)
    assert.equal(w.combo, null)
    assert.deepEqual(w.charging, { t: 0 })
  })
})

describe('review focus: the hold meets the rune and the diagonal', () => {
  it('the rune picked up mid-hold drops the hold; when it ends mid-wind-up the sword is back, clean', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }); const m = testMatch([w, a])
    tickHero(m, w, input({ attack: true, facing: 'east' }), dt)
    grantRune(m, w)
    assert.equal(w.combo, null)
    tickHero(m, w, input({ attack: false }), dt)
    assert.equal(a.hp, PVP.hp, 'no swing from the dropped hold')
    tickHero(m, w, input({ attack: true }), dt)
    assert.deepEqual(w.charging, { t: 0 })
    endRune(m, w)
    assert.equal(w.charging, null)
    tickHero(m, w, input({ attack: true }), dt)
    assert.ok(w.combo, 'the sword holds again')
  })
  it('pressed while walking diagonally: the hold slides that diagonal, and the diagonal held on is not a move', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    const NE = { x: 1, y: -1 }
    tickHero(m, w, input({ attack: true, move: NE }), dt)
    const x0 = w.px, y0 = w.py
    for (let i = 0; i < 3; i++) tickHero(m, w, input({ attack: true, move: NE }), dt)
    const step = PLAYER_SPEED * WARRIOR_COMBOS.holdMoveMul * dt * 3 / Math.SQRT2
    assert.ok(Math.abs(w.px - x0 - step) < 1e-9 && Math.abs(y0 - w.py - step) < 1e-9)
    assert.deepEqual(w.combo.moves, [])
    assert.equal(w.stamina, 100)
  })
})

describe('the release', () => {
  it('a plain swing lands on the release, not on the press', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }); const m = testMatch([w, a])
    tickHero(m, w, input({ attack: true, facing: 'east' }), dt)
    assert.equal(a.hp, PVP.hp)
    assert.equal(w.attackTimer, 0)
    tickHero(m, w, input({ attack: false }), dt)
    assert.equal(a.hp, PVP.hp - 2)
    assert.ok(w.attackTimer > 0)
    assert.equal(w.combo, null)
    assert.ok(Math.abs(w.meleeCooldown - SWORD_CD) < 1e-9)
  })
  it('an unknown pattern is the plain swing in the facing held; the moves stay paid', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }); const m = testMatch([w, a])
    tickHero(m, w, input({ attack: true, facing: 'east' }), dt)
    gesture(m, w, [N, O, E])                     // n, e: a quarter turn, not a combo
    assert.equal(w.facing, 'east')
    assert.equal(a.hp, PVP.hp - 2)
    assert.equal(w.stamina, 100 - 50 - 12)     // two moves, then the swing's own 12
  })
  it('a combo turns the hero toward its direction and starts the sword cooldown; the whirlwind 1.5 times it', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    tickHero(m, w, input({ attack: true }), dt)
    gesture(m, w, [S, O, S])
    assert.equal(w.facing, 'south')
    assert.ok(Math.abs(w.meleeCooldown - SWORD_CD) < 1e-9)
    const v = hero('v', 'warrior', { x: 10, y: 10 }); const m2 = testMatch([v])
    tickHero(m2, v, input({ attack: true }), dt)
    gesture(m2, v, [N, E, S, W])
    assert.equal(v.facing, 'west')
    assert.equal(v.stamina, 0)
    assert.ok(Math.abs(v.meleeCooldown - SWORD_CD * 1.5) < 1e-9)
  })
  it('the release ends spawn protection', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w]); w.spawnProtect = 1
    tickHero(m, w, input({ attack: true }), dt)
    assert.ok(w.spawnProtect > 0)
    tickHero(m, w, input({ attack: false }), dt)
    assert.equal(w.spawnProtect, 0)
  })
})
```

In `test/net-predict.test.js`:

Change the hero import line to `import { NEUTRAL_INPUT, placeHero } from '../renderer/pvp/hero.js'` (`placeHero` is used in Task 4's test).

Replace the whole test `'the tap swing animates locally at once and not again until its cooldown passes'` with:

```js
  it('the sword swing animates locally on the release that fires it, not on the press, and once', () => {
    const m = makeMatch({ roster: [{ id: 'p1', name: 'A', cls: 'warrior' }] })
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    const press = { ...NEUTRAL_INPUT, attack: true, facing: 'east' }, let_go = { ...NEUTRAL_INPUT }
    let r = predictStep(pred, press)
    assert.equal(r.released, null)
    predictCosmetics(pred, press, PVP.tick, r.released)
    assert.equal(pred.swing, null, 'the press only begins the hold')
    r = predictStep(pred, let_go)
    assert.deepEqual(r.released, { kind: 'swing', dir: null })
    predictCosmetics(pred, let_go, PVP.tick, r.released)
    assert.ok(pred.swing)
    const first = pred.swing
    predictCosmetics(pred, let_go, PVP.tick, predictStep(pred, let_go).released)
    assert.equal(pred.swing, first)
    reconcile(pred, heroSnap(m.heroes[0]), 0)          // a snapshot that has not seen the swing yet
    predictCosmetics(pred, let_go, PVP.tick, null)
    assert.equal(pred.swing, first, 'reconcile does not restart the local swing')
  })
  it('a combo release draws no local swing: the server draws the combo', () => {
    const m = makeMatch({ roster: [{ id: 'p1', name: 'A', cls: 'warrior' }] })
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    predictCosmetics(pred, NEUTRAL_INPUT, PVP.tick, { kind: 'lunge', dir: 'e' })
    assert.equal(pred.swing, null)
  })
```

In the test `'a tap swing spends stamina under reconcile replay too, …'`, replace

```js
    const sprintAttack = { ...east, sprint: true, attack: true }
    let seq = 0, snapAt10 = null
    const step = () => {
      seq++
      const input = { ...sprintAttack, seq }
```

with

```js
    let seq = 0, snapAt10 = null
    const step = () => {
      seq++
      const input = { ...east, sprint: true, attack: seq % 2 === 1, seq }   // tap, tap, tap: press and release
```

Append at the end of `test/net-predict.test.js`:

```js

describe('2a prediction parity', () => {
  // Server and predictor fed the same inputs; `snapAt` takes a snapshot to
  // reconcile from mid-sequence, exactly reconcile's real shape.
  const replay = (cls, inputs, snapAt, setup = () => {}) => {
    const m = lone(cls)
    setup(m.heroes[0])
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    let snap = null
    inputs.forEach((over, i) => {
      const input = { ...NEUTRAL_INPUT, move: { x: 0, y: 0 }, ...over, seq: i + 1 }
      stepMatch(m, { p1: input }, PVP.tick)
      predictStep(pred, input)
      pred.pending.push({ seq: i + 1, input })
      if (i + 1 === snapAt) snap = heroSnap(m.heroes[0])
    })
    reconcile(pred, snap, snapAt)
    return { server: m.heroes[0], pred: pred.hero }
  }
  const same = ({ server, pred }) => {
    assert.ok(Math.abs(pred.px - server.px) < 1e-9, `px ${pred.px} vs ${server.px}`)
    assert.ok(Math.abs(pred.py - server.py) < 1e-9, `py ${pred.py} vs ${server.py}`)
    assert.ok(Math.abs(pred.stamina - server.stamina) < 1e-9, `stamina ${pred.stamina} vs ${server.stamina}`)
    assert.ok(Math.abs(pred.meleeCooldown - server.meleeCooldown) < 1e-9, 'meleeCooldown')
    assert.equal(pred.facing, server.facing)
    assert.deepEqual(pred.combo, server.combo)
  }
  const E = { x: 1, y: 0 }, N = { x: 0, y: -1 }, S = { x: 0, y: 1 }, O = { x: 0, y: 0 }
  it("the Warrior's slide and the gesture's stamina match the server, reconciled mid-hold", () => {
    const hold = [{ move: E, attack: true }, ...[N, O, N, S, O, S, S, O].map(move => ({ move, attack: true }))]
    same(replay('warrior', [...hold, { move: E }, { move: E }, { move: E }], 4))
  })
  it('a snapshot taken mid-hold carries the gesture, so a direction held across it is not a second move', () => {
    const inputs = [{ move: O, attack: true }, { move: E, attack: true }, ...Array(8).fill({ move: E, attack: true }), { move: O }]
    const r = replay('warrior', inputs, 3)
    same(r)
    assert.equal(r.server.stamina, 100 - 25 - 12)   // one move, then the plain swing (e alone is no combo)
  })
})
```

Append at the end of `test/net-client.test.js`:

```js

describe('input latch (2a: releases fire)', () => {
  const sentInputs = s => s.ws.sent.filter(m => m.type === 'input')
  it('a one-frame tap between two sends is carried by the next input', () => {
    const s = open(); welcome(s)
    frame(s, NEUTRAL_INPUT, 0)
    frame(s, { ...NEUTRAL_INPUT, attack: true }, 10)      // no send yet: 10 ms < one tick
    frame(s, NEUTRAL_INPUT, 40)                           // this send carries the tap
    frame(s, NEUTRAL_INPUT, 80)
    assert.deepEqual(sentInputs(s).map(m => m.attack), [true, false])
  })
  it('a release is sent at once: the input after the key comes up is not a latched press', () => {
    const s = open(); welcome(s)
    frame(s, NEUTRAL_INPUT, 0)
    frame(s, { ...NEUTRAL_INPUT, attack: true }, 34)      // send 1: held
    frame(s, NEUTRAL_INPUT, 50)                           // let go between sends
    frame(s, NEUTRAL_INPUT, 68)                           // send 2: released
    assert.deepEqual(sentInputs(s).map(m => m.attack), [true, false])
  })
  it('a key held through a frame that sends two inputs is down in both', () => {
    const s = open(); welcome(s)
    frame(s, NEUTRAL_INPUT, 0)
    frame(s, { ...NEUTRAL_INPUT, alt: true }, 70)         // two ticks' worth in one frame
    assert.deepEqual(sentInputs(s).map(m => m.alt), [true, true])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/pvp-warrior.test.js test/net-predict.test.js test/net-client.test.js 2>&1 | grep -E "^# (pass|fail)|    not ok"`
Expected: FAIL — `pvp-warrior` fails on `w.combo` (undefined) and on swings landing on the press; `net-predict` fails on `r.released` (predictStep returns undefined) and on the parity tests; `net-client` fails "a release is sent at once" (`[true, true]`).

- [ ] **Step 3: The hold helpers and `comboCooldown`**

In `renderer/pvp/combos.js`, change the import block to:

```js
import { WARRIOR_COMBOS } from '../data/pvp.js'
import { spendStamina } from '../systems/stamina.js'
```

and append at the end:

```js

export const isComboWeapon = weaponType => weaponType === WARRIOR_COMBOS.weapon

// The press: a hold begins, sliding along the move held at that moment.
export function beginHold(hero, move) {
  const { moves, last } = startGesture(move)
  hero.combo = { moves, last, lockDir: unitMove(move) }
}

// One held tick: read the stick, pay for a move that registers.
export function holdGesture(hero, move) {
  const g = stepGesture(hero.combo, move, hero.stamina ?? 0)
  hero.combo = { moves: g.moves, last: g.last, lockDir: hero.combo.lockDir }
  if (g.cost) spendStamina(hero, g.cost)
}
```

In `renderer/pvp/attacks.js`, change `import { PVP } from '../data/pvp.js'` to `import { PVP, WARRIOR_COMBOS } from '../data/pvp.js'`, and insert directly above `export function swing(match, hero, mods) {`:

```js
// The melee cooldown a combo's release starts: the weapon's own, and the
// whirlwind's 1.5 times it. predict.js calls this too.
export function comboCooldown(weaponType, kind) {
  const cd = getAttack(weaponType).cooldown
  return kind === 'whirl' ? cd * WARRIOR_COMBOS.whirl.cooldownMul : cd
}

```

- [ ] **Step 4: The hold in `renderer/pvp/hero.js`**

Replace the two import lines

```js
import { swing, castSpell, loose } from './attacks.js'
import { KITS, OUTFIT_OVERRIDES, PVP } from '../data/pvp.js'
```

with

```js
import { swing, castSpell, loose, comboCooldown } from './attacks.js'
import { isComboWeapon, beginHold, holdGesture, classify, unitMove, SECTOR_FACING } from './combos.js'
import { KITS, OUTFIT_OVERRIDES, PVP, WARRIOR_COMBOS } from '../data/pvp.js'
```

In `applyKit`, replace `  hero.charging = null; hero.rune = null; hero.shock = undefined; hero.rain = undefined` with

```js
  hero.charging = null; hero.combo = null; hero.rune = null; hero.shock = undefined; hero.rain = undefined
```

In `moveHero`, replace everything from `  const stunned = hero.stunTimer > 0` down to and including the `const chargeFactor = …` statement (it ends `    : 1`) with:

```js
  const stunned = hero.stunTimer > 0
  // After a release the attack must be let go before it can wind up again
  // (game.js does this by clearing keys[' ']).
  if (!input.attack) hero.needRelease = false
  if (stunned) { hero.charging = null; cancelHold(hero) }
  const altEdge = !!input.alt && !hero.prevAlt
  hero.prevAlt = !!input.alt
  hero.blockedHit = false
  const blocking = tickShield(hero, !!input.alt && !stunned, dt)
  if (blocking) { hero.charging = null; cancelHold(hero) }
  // A held combo locks the facing: the moves aim the strike, not the stick.
  if (!stunned && !hero.combo && input.facing && DIRS[input.facing]) hero.facing = input.facing

  // While the attack is held the Warrior slides along the move held at the
  // press, at half speed, whatever the stick does now (spec 2a §2).
  const { x: vx, y: vy } = hero.combo ? hero.combo.lockDir : unitMove(input.move)
  const moving = vx !== 0 || vy !== 0
  const profile = sprintProfile(hero.attackMode, { drainMul: outfitOf(hero, hero.attackMode)?.sprintDrain ?? 1 })
  const sprinting = moving && !!input.sprint && !hero.charging && !hero.combo && !blocking && hero.stamina > 0
  const chargeFactor = hero.combo ? WARRIOR_COMBOS.holdMoveMul
    : hero.charging
      ? (hero.charging.kind === 'spell' ? GUST_CHARGE.moveFactor : chargeMoveFactor(hero.weapon?.weaponType))
      : 1
```

(The `slow`/`speed`/`moveEntity` lines below it stay as they are.)

Replace the comment and first two lines of `tickMelee`:

```js
// Light blades swing the instant attack lands; charge weapons (the rune's
// hammer) wind up while it is held and swing on release, tiered by hold.
function tickMelee(match, hero, input, attacking, dt) {
  const wt = hero.weapon?.weaponType
  if (!wt) { hero.charging = null; return }
```

with

```js
// A stun or a raised shield ends a hold: no combo fires, the stamina spent
// stays spent, and the attack must be let go before the next hold.
function cancelHold(hero) {
  if (!hero.combo) return
  hero.combo = null
  hero.needRelease = true
}

// The sword is a combo weapon (spec 2a §2): the press begins a hold, moves
// are entered while it is held, and the release fires what was entered —
// a plain swing when nothing was. Charge weapons (the rune's hammer) wind up
// while held and swing on release, tiered by hold; any other light blade
// swings the instant attack lands.
function tickMelee(match, hero, input, attacking, dt) {
  const wt = hero.weapon?.weaponType
  if (!wt) { hero.charging = null; hero.combo = null; return }
  if (isComboWeapon(wt)) {
    if (hero.charging && !hero.charging.kind) hero.charging = null
    if (hero.combo) {
      if (input.attack) holdGesture(hero, input.move)
      else releaseCombo(match, hero)
    } else if (attacking && hero.meleeCooldown <= 0) beginHold(hero, input.move)
    return
  }
  hero.combo = null
```

(the `if (isChargeWeapon(wt)) {` block and the `else` below it stay as they are.)

Insert directly above `// Hold to charge the main wand, release to cast; …` (the comment over `tickMagic`):

```js
// The release: the combo's direction becomes the facing, then the plain
// swing or the combo's cooldown. Returns the classified combo.
function releaseCombo(match, hero) {
  const combo = classify(hero.combo.moves)
  hero.combo = null
  if (combo.dir) hero.facing = SECTOR_FACING[combo.dir]
  if (combo.kind === 'swing') swing(match, hero, resolveCharge(hero.weapon.weaponType, 0))
  else {
    hero.spawnProtect = 0
    hero.meleeCooldown = comboCooldown(hero.weapon.weaponType, combo.kind)
  }
  return combo
}

```

- [ ] **Step 5: Clear the hold on the rune and on death**

`renderer/pvp/pickups.js`: in `grantRune`, replace the two lines

```js
  hero.charging = null
  hero.rune = { t: PICKUPS.rune.duration, saved }
```

with

```js
  hero.charging = null
  hero.combo = null
  hero.rune = { t: PICKUPS.rune.duration, saved }
```

and in `endRune`, replace the two lines

```js
  hero.charging = null
  hero.rune = null
```

with

```js
  hero.charging = null
  hero.combo = null
  hero.rune = null
```

`renderer/pvp/sim.js`: in `resolveDeaths`' second loop, replace the two lines

```js
    h.charging = null
    h.knockback = null
```

with

```js
    h.charging = null
    h.combo = null
    h.knockback = null
```

- [ ] **Step 6: Protocol `combo`, the predictor, the latch**

`renderer/net/protocol.js`: in `heroSnap`, directly after `  s.rune = h.rune ? { t: h.rune.t } : null`, add

```js
  // A Warrior's hold (2a): the moves so far, the slide, and the last sector
  // seen — the predictor's replay needs `last`, or a direction held across a
  // snapshot would read as a new move.
  s.combo = h.combo ? { moves: [...h.combo.moves], lockDir: { ...h.combo.lockDir }, last: h.combo.last } : null
```

and in `hydrateHero`, directly after `  h.rune = s.rune ? { t: s.rune.t } : null`, add

```js
  h.combo = s.combo ? { moves: [...s.combo.moves], lockDir: { ...s.combo.lockDir }, last: s.combo.last ?? null } : null
```

`renderer/net/predict.js`: replace `import { swingCost } from '../pvp/attacks.js'` with

```js
import { swingCost, comboCooldown } from '../pvp/attacks.js'
import { isComboWeapon, beginHold, holdGesture, classify, SECTOR_FACING } from '../pvp/combos.js'
```

In `predictSwing`, change its guard line to

```js
  if (h.attackMode !== 'melee' || !wt || isChargeWeapon(wt) || isComboWeapon(wt)) return
```

Replace the whole `predictStep` function with:

```js
// The Warrior's hold, as hero.js's tickMelee runs it for a combo weapon,
// effects excluded: the press begins the hold, each held tick reads the
// stick through the same holdGesture (so a move pays the same 25 stamina),
// and the release turns the hero, pays the swing's stamina and cooldown or
// the combo's cooldown. The combo effect itself (the lunge's dash, the
// thrusts, the whirl) is the server's; it reconciles like knockback.
// Returns the classified combo on the release tick, else null.
function predictCombo(h, input, attacking) {
  const wt = h.weapon?.weaponType
  if (h.attackMode !== 'melee' || !isComboWeapon(wt)) return null
  if (h.charging && !h.charging.kind) h.charging = null
  if (!h.combo) {
    if (attacking && h.meleeCooldown <= 0) beginHold(h, input.move)
    return null
  }
  if (input.attack) { holdGesture(h, input.move); return null }
  const combo = classify(h.combo.moves)
  h.combo = null
  if (combo.dir) h.facing = SECTOR_FACING[combo.dir]
  if (combo.kind === 'swing') {
    const { stamina, cooldown } = swingCost(h, resolveCharge(wt, 0))
    spendStamina(h, stamina)
    h.meleeCooldown = cooldown
  } else h.meleeCooldown = comboCooldown(wt, combo.kind)
  return combo
}

// One predicted tick. Returns { released }: the combo a Warrior's release
// fired this tick (for predictCosmetics' local swing), else null.
export function predictStep(pred, input, dt = PVP.tick) {
  const h = pred.hero
  if (h.dead) return { released: null }
  tickHeroStatus(h, dt)
  const { stunned, blocking } = moveHero({ map: pred.map }, h, input, dt)
  if (stunned) { h.charging = null; return { released: null } }
  predictCharge(h, input, dt)
  const attacking = !!input.attack && !h.needRelease && !blocking
  const released = predictCombo(h, input, attacking)
  predictSwing(h, attacking)
  return { released }
}
```

Replace the comment above `predictCosmetics` and its first six lines (through `  if (!input.attack || pred.swingCooldown > 0) return`) with:

```js
// The local swing starts drawing at once: for the sword (a combo weapon)
// on the release that fired a plain swing — `released`, what the live
// predictStep just returned — and for any other light blade the moment the
// key goes down. Its own cooldown lives on the predictor (not the hero's
// meleeCooldown, which predictStep owns), so a snapshot that has not seen
// the swing yet cannot restart it. Animation only — no stamina or cooldown
// write here; predictStep pays those, on both the live path and
// reconcile's replay. Combos draw from the server's hero.move instead.
export function predictCosmetics(pred, input, dt = PVP.tick, released = null) {
  pred.swingCooldown = Math.max(0, pred.swingCooldown - dt)
  if (pred.swing) { pred.swing.t += dt; if (pred.swing.t >= pred.swing.dur) pred.swing = null }
  const h = pred.hero
  const wt = h.weapon?.weaponType
  if (h.dead || h.attackMode !== 'melee' || !wt || isChargeWeapon(wt) || h.blocking || h.stunTimer > 0) return
  const pressed = isComboWeapon(wt) ? released?.kind === 'swing' : !!input.attack
  if (!pressed || pred.swingCooldown > 0) return
```

(the last three lines of `predictCosmetics`, from `const atk = getAttack(wt)`, stay.)

`renderer/net/client.js`: in `frame`, replace

```js
  // Frames run faster than the 30 Hz input step, so a press that lasts one
  // frame can fall between two sends; it is latched until the next input
  // carries it, and a tap is never lost.
  s.held.attack ||= !!input.attack
  s.held.alt ||= !!input.alt
  while (s.acc >= tickMs) {
    s.acc -= tickMs
    const msg = {
      type: MSG.INPUT, seq: ++s.seq, view: Math.max(0, Math.floor(renderTick(s.interp, t))),
      move: { x: input.move?.x ?? 0, y: input.move?.y ?? 0 }, facing: input.facing ?? null,
      attack: s.held.attack, alt: s.held.alt, sprint: !!input.sprint,
    }
    s.held = { attack: !!input.attack, alt: !!input.alt }
```

with

```js
  // Frames run faster than the 30 Hz input step, so a press that lasts one
  // frame can fall between two sends; it is latched until the next input
  // carries it, and a tap is never lost. A release is not latched: the
  // sword swings and the double shot looses on the release (2a), so the
  // first input after the key comes up says so.
  s.held.attack ||= !!input.attack
  s.held.alt ||= !!input.alt
  while (s.acc >= tickMs) {
    s.acc -= tickMs
    const msg = {
      type: MSG.INPUT, seq: ++s.seq, view: Math.max(0, Math.floor(renderTick(s.interp, t))),
      move: { x: input.move?.x ?? 0, y: input.move?.y ?? 0 }, facing: input.facing ?? null,
      attack: s.held.attack || !!input.attack, alt: s.held.alt || !!input.alt, sprint: !!input.sprint,
    }
    s.held = { attack: false, alt: false }
```

and, further down in the same loop, replace

```js
      predictStep(s.pred, msg)
      predictCosmetics(s.pred, msg)
```

with

```js
      const { released } = predictStep(s.pred, msg)
      predictCosmetics(s.pred, msg, PVP.tick, released)
```

- [ ] **Step 7: The warrior bot taps**

In `renderer/pvp/bots.js`, replace

```js
    if (d <= BOTS.meleeRange) { input.facing = faceToward(hero, foe); input.attack = true; return input }
```

with

```js
    // The sword swings on the release (2a): press on one tick, let go the next.
    if (d <= BOTS.meleeRange) { input.facing = faceToward(hero, foe); input.attack = !hero.combo; return input }
```

(Task 9 replaces this with the combo-aware warrior bot.)

- [ ] **Step 8: Update the old tests that swing on the press**

`test/pvp-attacks.test.js`:
- Rename `'a sword tap hits the foe in front for 2, …'` to `'a sword tap (press, release) hits the foe in front for 2, knocks it back and credits the swinger'`, and after its `tickHero(m, w, input({ attack: true, facing: 'east' }), dt)` add `    tickHero(m, w, input({ attack: false }), dt)`.
- In `'misses a foe behind the swinger'`, after its `tickHero(…attack: true…)` add `    tickHero(m, w, input({ attack: false }), dt)`.
- Replace the body of `'attacking ends spawn protection'` with:

```js
    const w = hero('w', 'warrior', { x: 5, y: 5 }); w.spawnProtect = 1
    const m = testMatch([w])
    tickHero(m, w, input({ attack: true, facing: 'east' }), dt)
    tickHero(m, w, input({ attack: false }), dt)
    assert.equal(w.spawnProtect, 0)
```

`test/net-sim.test.js`: replace the body of `'moves exactly as tickHero does but never attacks'` with:

```js
    // An archer: its shots do not change how it walks (a Warrior's held
    // attack does — the hold is movement, and runs in moveHero for both).
    const a = makeHero({ id: 'a', name: 'a', cls: 'archer' }); placeHero(a, { x: 5, y: 5 })
    const b = makeHero({ id: 'b', name: 'b', cls: 'archer' }); placeHero(b, { x: 5, y: 5 })
    const ma = testMatch([a]), mb = testMatch([b])
    const input = { ...east, attack: true }
    for (let i = 0; i < 10; i++) { moveHero(ma, a, input, PVP.tick); tickHero(mb, b, input, PVP.tick) }
    assert.equal(a.px, b.px)
    assert.equal(a.py, b.py)
    assert.equal(a.ammo.arrow, 24)          // moveHero never shot
    assert.ok(b.ammo.arrow < 24)            // tickHero did
```

`test/net-play.test.js` (`melee under … lag`): replace the comment's first line `      // A swings the moment it sees B step just out of point-blank (36 px,` with the two lines

```js
      // A holds the attack and lets go — the sword swings on the release
      // (2a) — the moment it sees B step just out of point-blank (36 px,
```

and replace

```js
        const go = !swung && seen && Math.hypot(seen.px - v.me.px, seen.py - v.me.py) >= 36
        if (go) swung = true
        return { ...NEUTRAL_INPUT, facing: 'east', attack: go }
```

with

```js
        if (!swung && seen && Math.hypot(seen.px - v.me.px, seen.py - v.me.py) >= 36) swung = true
        return { ...NEUTRAL_INPUT, facing: 'east', attack: !swung }
```

`test/pvp-bots.test.js`: change `import { placeHero } from '../renderer/pvp/hero.js'` to `import { placeHero, tickHero } from '../renderer/pvp/hero.js'` and append:

```js

describe('the warrior bot taps the sword (2a: it swings on release)', () => {
  it('presses, lets go, and the swing lands', () => {
    const m = makeMatch({ roster: roster('warrior', 'archer') })
    const [w, a] = m.heroes
    placeHero(w, { x: 10, y: 2 }); placeHero(a, { x: 11, y: 2 }); a.spawnProtect = 0; w.spawnProtect = 0
    const first = botInput(m, w)
    assert.equal(first.attack, true)
    tickHero(m, w, first, 1 / 30)
    assert.ok(w.combo)
    const second = botInput(m, w)
    assert.equal(second.attack, false)
    tickHero(m, w, second, 1 / 30)
    assert.ok(a.hp < a.maxHp)
  })
})
```

- [ ] **Step 9: Run the tests**

Run: `node --test test/pvp-warrior.test.js test/net-predict.test.js test/net-client.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: PASS.

Run: `for i in 1 2 3; do node --test test/net-play.test.js 2>&1 | grep -E "^# fail"; done`
Expected: `# fail 0` three times (the 150 ms rewind case is the one the latch fix steadies).

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0`.

- [ ] **Step 10: Commit**

```bash
git add renderer/pvp/combos.js renderer/pvp/hero.js renderer/pvp/attacks.js renderer/pvp/pickups.js renderer/pvp/sim.js renderer/pvp/bots.js renderer/net/protocol.js renderer/net/predict.js renderer/net/client.js test/pvp-warrior.test.js test/net-predict.test.js test/net-client.test.js test/pvp-attacks.test.js test/net-sim.test.js test/net-play.test.js test/pvp-bots.test.js
git commit -m "feat(pvp): the Warrior's hold — slide, paid moves, swing on release; predicted, on the wire, releases unlatched

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---
### Task 4: The combo effects — lunge, fence, whirlwind (`hero.move`), hit groups, protocol `move`

**Files:**
- Modify: `renderer/pvp/combos.js` (`isDashing`), `renderer/pvp/attacks.js` (`startCombo`, `stepCombo` and helpers), `renderer/pvp/combat.js` (`group`), `renderer/pvp/hero.js`, `renderer/pvp/sim.js` (`resolveDeaths`)
- Modify: `renderer/systems/sfx.js`, `renderer/render/audio.js` (the `whirl` cue)
- Modify: `renderer/net/protocol.js` (`move`), `renderer/net/predict.js` (ages `move`)
- Modify: `test/pvp-warrior.test.js`, `test/net-predict.test.js`

**Interfaces:**
- Consumes: `comboCooldown`, `hero.combo`, `releaseCombo` (Task 3); `SECTOR_FACING` (Task 2).
- Produces:
  - `hero.move: { kind: 'lunge' | 'fence' | 'whirl', dir, t, from: { px, py }, done, dist, fired, group } | null` on every hero (reset by `applyKit`, death and a stun);
  - `combos.js`: `isDashing(hero) → boolean` (a lunge, not `done`, `t < lunge.dur`);
  - `attacks.js`: `startCombo(match, hero, { kind, dir })`, `stepCombo(match, hero, dt)` (called at the end of every `tickHero`);
  - `combat.js`: `hurtHero(match, target, amount, { kind, by, from, melee, group })`: `group` a string or null; `hero.invulnGroup` records the group whose hit last granted i-frames;
  - `match.groupSeq`: a counter for group ids (`${hero.id}#${n}`);
  - sfx cue `'whirl'`;
  - protocol: hero snapshot field `move: { kind, dir, t, from: { px, py }, done } | null`.

- [ ] **Step 1: Write the failing tests**

In `test/pvp-warrior.test.js`, replace the import block (from `import { makeHero, placeHero, tickHero, NEUTRAL_INPUT } …` through `import { testMatch } from './pvp-helpers.js'`) with:

```js
import { makeHero, placeHero, tickHero, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'
import { grantRune, endRune } from '../renderer/pvp/pickups.js'
import { getAttack } from '../renderer/systems/melee.js'
import { PLAYER_SPEED, PLAYER_HALF, canMoveTo } from '../renderer/systems/movement.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { TILE } from '../renderer/systems/entities.js'
import { PVP, WARRIOR_COMBOS } from '../renderer/data/pvp.js'
import { testMatch } from './pvp-helpers.js'
```

and append at the end of the file:

```js

// Press standing still, enter `moves`, let go, then `after` neutral ticks.
const combo = (m, h, moves, after = 12) => {
  tickHero(m, h, input({ attack: true }), dt)
  gesture(m, h, moves)
  for (let i = 0; i < after; i++) tickHero(m, h, input({}), dt)
}
const LUNGE = [E, O, E], FENCE = [E, O, W], WHIRL = [N, E, S, W]
const hits = m => m.events.filter(e => e.type === 'hit')
// A 12×12 room with a wall column at x = 5.
const walledAt5 = () => Array.from({ length: 12 }, (_, y) => Array.from({ length: 12 }, (_, x) =>
  ({ tile: x === 0 || y === 0 || x === 11 || y === 11 || x === 5 ? TILE.WALL : TILE.FLOOR })))

describe('the lunge', () => {
  it('dashes 2.5 tiles toward its direction with nobody in the way, and walks no step of its own', () => {
    const w = hero('w', 'warrior', { x: 3, y: 5 }); const m = testMatch([w])
    const x0 = w.px, y0 = w.py
    tickHero(m, w, input({ attack: true }), dt)
    gesture(m, w, LUNGE)
    for (let i = 0; i < 12; i++) tickHero(m, w, input({ move: N }), dt)   // pushing north during the dash
    assert.ok(Math.abs(w.px - x0 - 2.5 * 32) < 1e-9, `moved ${w.px - x0}`)
    assert.ok(w.py < y0, 'walks again once the dash is over')
    assert.equal(w.x, Math.floor(w.px / 32))
  })
  it('the first foe within reach ahead takes 3, and the dash ends there', () => {
    const w = hero('w', 'warrior', { x: 3, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }), b = hero('b', 'archer', { x: 7, y: 5 })
    const m = testMatch([w, a, b])
    combo(m, w, LUNGE)
    assert.equal(a.hp, PVP.hp - 3)
    assert.equal(b.hp, PVP.hp)
    assert.ok(a.px - w.px <= 12 + 20 + 1e-9, 'stopped at the foe')
    assert.ok(w.px < 3 * 32 + 16 + 80, 'short of the full dash')
    assert.equal(a.lastHitBy.id, 'w')
  })
  it('stops flush against a wall', () => {
    const map = walledAt5()
    const w = hero('w', 'warrior', { x: 3, y: 5 }); const m = testMatch([w], map)
    combo(m, w, LUNGE)
    assert.equal(w.x, 4)
    assert.ok(canMoveTo(map, w.px, w.py, PLAYER_HALF))
    assert.ok(5 * 32 - (w.px + PLAYER_HALF) < 1, `gap ${5 * 32 - (w.px + PLAYER_HALF)}`)
  })
  it('flush against a wall the lunge goes nowhere, ends, and does not hang', () => {
    const map = walledAt5()
    const w = hero('w', 'warrior', { x: 4, y: 5 }); const m = testMatch([w], map)
    w.px = 5 * 32 - PLAYER_HALF                          // touching the wall
    combo(m, w, LUNGE)
    assert.equal(w.px, 5 * 32 - PLAYER_HALF)
    assert.equal(w.move, null)
  })
  it('a buckler raised toward the lunge blocks it and still ends the dash', () => {
    const w = hero('w', 'warrior', { x: 3, y: 5 }), v = hero('v', 'warrior', { x: 6, y: 5 }); const m = testMatch([w, v])
    v.facing = 'west'; v.blocking = true
    tickHero(m, w, input({ attack: true }), dt)
    gesture(m, w, LUNGE)
    for (let i = 0; i < 12; i++) tickHero(m, w, input({}), dt)
    assert.equal(v.hp, PVP.hp)
    assert.ok(v.px - w.px < 64)
  })
})

describe('the fence', () => {
  it('three thrusts toward d, 1 each: all three land on one hero', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }); const m = testMatch([w, a])
    combo(m, w, FENCE)
    assert.equal(a.hp, PVP.hp - 3)
    assert.deepEqual(hits(m).map(e => e.amount), [1, 1, 1])
    assert.equal(w.facing, 'east')
  })
  it('the thrusts come at 0, 0.12 and 0.24 s after the release', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }); const m = testMatch([w, a])
    tickHero(m, w, input({ attack: true }), dt)
    gesture(m, w, FENCE)                                   // the release tick: the first thrust
    const at = [hits(m).length]
    for (let i = 1; i <= 8; i++) { tickHero(m, w, input({}), dt); at.push(hits(m).length) }
    // ticks after the release: 0.12 s falls on tick 4 (0.133 s), 0.24 s on tick 8 (0.267 s)
    assert.deepEqual(at, [1, 1, 1, 1, 2, 2, 2, 2, 3])
  })
  it('reaches 40 px: a foe two tiles off is untouched', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 7, y: 5 }); const m = testMatch([w, a])
    combo(m, w, FENCE)
    assert.equal(a.hp, PVP.hp)
  })
})

describe('the whirlwind', () => {
  it('needs the full tank, hits every foe all round within 44 px for 2 and throws them 40 px away', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 })
    const e = hero('e', 'archer', { x: 6, y: 5 }), wv = hero('wv', 'archer', { x: 4, y: 5 }), n = hero('n', 'mage', { x: 5, y: 4 })
    const far = hero('far', 'archer', { x: 5, y: 7 })
    const m = testMatch([w, e, wv, n, far]); m.sfx = makeSfx()
    tickHero(m, w, input({ attack: true }), dt)
    gesture(m, w, WHIRL)
    for (const h of [e, wv, n]) assert.equal(h.hp, PVP.hp - 2, h.id)
    assert.equal(far.hp, PVP.hp)
    assert.ok(e.knockback.vx > 0 && wv.knockback.vx < 0 && n.knockback.vy < 0)
    assert.equal(w.stamina, 0)
    assert.ok(m.sfx.cues.some(c => c.name === 'whirl'))
  })
  it('a buckler facing the spinner blocks it, and the spinner is shoved', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), v = hero('v', 'warrior', { x: 6, y: 5 }); const m = testMatch([w, v])
    tickHero(m, w, input({ attack: true }), dt)
    for (const move of WHIRL) tickHero(m, w, input({ attack: true, move }), dt)
    v.facing = 'west'; v.blocking = true
    tickHero(m, w, input({ attack: false }), dt)
    assert.equal(v.hp, PVP.hp)
    assert.ok(w.knockback && w.knockback.vx < 0)
  })
  it('a buckler facing away does not', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), v = hero('v', 'warrior', { x: 6, y: 5 }); const m = testMatch([w, v])
    tickHero(m, w, input({ attack: true }), dt)
    for (const move of WHIRL) tickHero(m, w, input({ attack: true, move }), dt)
    v.facing = 'east'; v.blocking = true
    tickHero(m, w, input({ attack: false }), dt)
    assert.equal(v.hp, PVP.hp - 2)
  })
})

describe('combo bookkeeping', () => {
  it("a combo's hero.move names its kind and direction, and a stun ends it", () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    tickHero(m, w, input({ attack: true }), dt)
    gesture(m, w, FENCE)
    assert.equal(w.move.kind, 'fence')
    assert.equal(w.move.dir, 'e')
    w.stunTimer = 0.2
    tickHero(m, w, input({}), dt)
    assert.equal(w.move, null)
  })
  it('death clears a hold and a running combo', () => {
    const m = makeMatch({ roster: [{ id: 'w', name: 'w', cls: 'warrior' }, { id: 'a', name: 'a', cls: 'archer' }] })
    const w = m.heroes[0]
    w.combo = { moves: ['e'], last: 'e', lockDir: { x: 0, y: 0 } }
    w.move = { kind: 'fence', dir: 'e', t: 0, from: { px: w.px, py: w.py }, done: false, dist: 0, fired: 3, group: 'x' }
    w.hp = 0
    stepMatch(m, {}, PVP.tick)
    assert.equal(w.combo, null); assert.equal(w.move, null)
  })
})
```

Append at the end of `test/net-predict.test.js`:

```js

describe('2a prediction: the lunge', () => {
  it('a lunge a snapshot shows mid-dash stops the replayed walk as long as the server stopped it; the dash itself is not predicted', () => {
    const m = lone('warrior')
    placeHero(m.heroes[0], { x: 8, y: 8 })
    const E = { x: 1, y: 0 }, N = { x: 0, y: -1 }, O = { x: 0, y: 0 }
    const inputs = [{ attack: true }, ...[E, O, E].map(move => ({ attack: true, move })), {}, ...Array(10).fill({ move: N })]
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    let snap = null
    inputs.forEach((over, i) => {
      const input = { ...NEUTRAL_INPUT, move: O, ...over, seq: i + 1 }
      stepMatch(m, { p1: input }, PVP.tick)
      predictStep(pred, input)
      pred.pending.push({ seq: i + 1, input })
      if (i + 1 === 6) snap = heroSnap(m.heroes[0])      // the tick after the release: dashing
    })
    assert.equal(snap.move.kind, 'lunge')
    reconcile(pred, snap, 6)
    const server = m.heroes[0]
    assert.ok(Math.abs(pred.hero.py - server.py) < 1e-9, `py pred ${pred.hero.py} server ${server.py}`)
    assert.ok(server.py < snap.py, 'the server walked north after the dash')
    assert.equal(pred.hero.px, snap.px, 'the rest of the dash comes with the next snapshot')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/pvp-warrior.test.js test/net-predict.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: FAIL — the lunge, fence, whirlwind and bookkeeping tests (no `hero.move`, no damage), and the lunge prediction test (`snap.move` undefined).

- [ ] **Step 3: Hit groups in `hurtHero`**

In `renderer/pvp/combat.js`, replace

```js
export function hurtHero(match, target, amount, { kind = 'hit', by = null, from = null, melee = false } = {}) {
  if (!isTargetable(target)) return false
  if (by && by === target) return false
  const at = from ?? (by ? { px: by.px, py: by.py } : null)
  const before = target.hp
  const landed = damagePlayer(match, amount, kind, at, target)
  if (!landed) {
```

with

```js
// group: hits of one attack (a fence's three thrusts, a double shot's two
// arrows — spec 2a) share a group id; a later hit of the group passes the
// i-frames the group's own earlier hit granted, so all of them can land.
// Blocks still apply to each.
export function hurtHero(match, target, amount, { kind = 'hit', by = null, from = null, melee = false, group = null } = {}) {
  if (!isTargetable(target)) return false
  if (by && by === target) return false
  const at = from ?? (by ? { px: by.px, py: by.py } : null)
  const before = target.hp
  const reopen = kind === 'hit' && group !== null && target.invulnGroup === group
  const invuln = target.invulnTimer
  if (reopen) target.invulnTimer = 0
  const landed = damagePlayer(match, amount, kind, at, target)
  if (landed && kind === 'hit') target.invulnGroup = group
  if (!landed) {
    if (reopen) target.invulnTimer = invuln
```

(the rest of the `if (!landed)` block — the shove and `return false` — stays.)

- [ ] **Step 4: `isDashing` and the effects**

In `renderer/pvp/combos.js`, replace `export const isComboWeapon = weaponType => weaponType === WARRIOR_COMBOS.weapon` with:

```js
export const isComboWeapon = weaponType => weaponType === WARRIOR_COMBOS.weapon

// The lunge's dash is running: the hero neither walks nor turns. The server
// ends it early on a hit or a wall (move.done); the predictor, which never
// sees those, ends it on time.
export const isDashing = hero => hero.move?.kind === 'lunge' && !hero.move.done && hero.move.t < WARRIOR_COMBOS.lunge.dur
```

In `renderer/pvp/attacks.js`, replace

```js
import { hurtHero, foesOf } from './combat.js'
```

with

```js
import { canMoveTo, PLAYER_HALF, TILE_SIZE } from '../systems/movement.js'
import { hurtHero, foesOf } from './combat.js'
import { SECTOR_FACING } from './combos.js'
```

and insert directly above `export function swing(match, hero, mods) {` (below `comboCooldown`):

```js
// --- the Warrior's combos (spec 2a §2) --------------------------------
// A release that classified as a combo starts hero.move = { kind, dir, t,
// from, done, dist, fired, group }; stepCombo runs it once a tick (the
// release tick included) until WARRIOR_COMBOS.fxDur, which is also how long
// the renderer draws it. Every hit is a 'hit' from the attacker's position
// through hurtHero (melee: a facing buckler blocks it and shoves back), and
// every hit test asks match.hitPos like the swing does.

// Where the hit test sees `e` (the server's rewind), and the vector from
// the hero to the nearest point of that body.
const reachTo = (match, hero, e) => {
  const n = nearestPoint(match.hitPos?.(e, hero) ?? e, hero.px, hero.py)
  return { dx: n.x - hero.px, dy: n.y - hero.py }
}

export function startCombo(match, hero, combo) {
  hero.spawnProtect = 0
  hero.meleeCooldown = comboCooldown(hero.weapon.weaponType, combo.kind)
  match.groupSeq = (match.groupSeq ?? 0) + 1
  hero.move = { kind: combo.kind, dir: combo.dir, t: 0, from: { px: hero.px, py: hero.py }, done: false,
    dist: 0, fired: 0, group: `${hero.id}#${match.groupSeq}` }
  if (combo.kind === 'whirl') whirl(match, hero)
  else sfx(match, 'melee-swing', { px: hero.px, py: hero.py })
}

export function stepCombo(match, hero, dt) {
  const mv = hero.move
  if (!mv) return
  if (mv.kind === 'lunge' && !mv.done) stepLunge(match, hero, mv, dt)
  if (mv.kind === 'fence') {
    const { times } = WARRIOR_COMBOS.fence
    while (mv.fired < times.length && mv.t >= times[mv.fired] - 1e-9) { thrust(match, hero, mv); mv.fired++ }
  }
  mv.t += dt
  if (mv.t >= WARRIOR_COMBOS.fxDur - 1e-9) hero.move = null
}

// The lunge: a dash of lunge.tiles toward dir over lunge.dur. The first foe
// whose body comes within lunge.reach ahead (the half-plane in front, checked
// before and after each step) takes lunge.damage, and the dash ends there;
// a wall ends it too, the hero stopped flush against it.
function stepLunge(match, hero, mv, dt) {
  const L = WARRIOR_COMBOS.lunge
  const [dx, dy] = DIRS[SECTOR_FACING[mv.dir]]
  if (lungeHit(match, hero, mv, dx, dy)) return
  const total = L.tiles * TILE_SIZE
  let step = Math.min(total / L.dur * dt, total - mv.dist)
  while (step > 0 && !canMoveTo(match.map, hero.px + dx * step, hero.py + dy * step, PLAYER_HALF)) {
    step = Math.max(0, Math.ceil(step) - 1)       // a wall: close the gap a pixel at a time
    mv.done = true
  }
  hero.px += dx * step; hero.py += dy * step
  hero.x = Math.floor(hero.px / TILE_SIZE); hero.y = Math.floor(hero.py / TILE_SIZE)
  mv.dist += step
  if (mv.dist >= total - 1e-9) mv.done = true
  lungeHit(match, hero, mv, dx, dy)
}

function lungeHit(match, hero, mv, dx, dy) {
  const L = WARRIOR_COMBOS.lunge
  const fa = Math.atan2(dy, dx)
  let first = null, best = Infinity
  for (const e of foesOf(match, hero)) {
    const v = reachTo(match, hero, e)
    const d = Math.hypot(v.dx, v.dy)
    if (d < best && inSwing(L.reach, Math.PI / 2, fa, v.dx, v.dy)) { first = e; best = d }
  }
  if (!first) return false
  mv.done = true
  if (hurtHero(match, first, L.damage, { by: hero, melee: true })) sfx(match, 'melee-hit', { px: first.px, py: first.py })
  return true
}

// One of the fence's three thrusts: a snap-style wedge of fence.reach toward
// dir. The three share one hit group, so all three can land on one hero.
function thrust(match, hero, mv) {
  const F = WARRIOR_COMBOS.fence
  const arc = getSwingArc('snap')
  const facing = SECTOR_FACING[mv.dir]
  const fa = FACING_ANGLE[facing]
  for (const e of foesOf(match, hero)) {
    const v = reachTo(match, hero, e)
    if (!inSwing(F.reach, arc.halfAngle, fa, v.dx, v.dy)) continue
    if (hurtHero(match, e, F.damage, { by: hero, melee: true, group: mv.group })) sfx(match, 'melee-hit', { px: e.px, py: e.py })
  }
  const atk = getAttack('dagger')                // the snap's own quick poke, drawn at the fence's reach
  Object.assign(hero, { swingHand: 'main', attackTimer: atk.duration, attackDuration: atk.duration, attackStyle: 'snap',
    attackFacing: facing, attackReachMul: F.reach / arc.reach })
  sfx(match, 'melee-swing', { px: hero.px, py: hero.py })
}

// The whirlwind: at the release, every foe within whirl.reach all round takes
// whirl.damage and is thrown whirl.knockback px away from the spinner.
function whirl(match, hero) {
  const Wh = WARRIOR_COMBOS.whirl
  for (const e of foesOf(match, hero)) {
    const v = reachTo(match, hero, e)
    if (Math.hypot(v.dx, v.dy) > Wh.reach) continue
    if (!hurtHero(match, e, Wh.damage, { by: hero, melee: true })) continue
    startKnockback(e, e.px - hero.px, e.py - hero.py, Wh.knockback)
    sfx(match, 'melee-hit', { px: e.px, py: e.py })
  }
  const dur = WARRIOR_COMBOS.fxDur
  Object.assign(hero, { swingHand: 'main', attackTimer: dur, attackDuration: dur, attackStyle: 'spin',
    attackFacing: hero.facing, attackReachMul: Wh.reach / getSwingArc('spin').reach })
  sfx(match, 'whirl', { px: hero.px, py: hero.py })
}

```

- [ ] **Step 5: Wire the effects into `renderer/pvp/hero.js`**

Replace

```js
import { swing, castSpell, loose, comboCooldown } from './attacks.js'
import { isComboWeapon, beginHold, holdGesture, classify, unitMove, SECTOR_FACING } from './combos.js'
```

with

```js
import { swing, castSpell, loose, startCombo, stepCombo } from './attacks.js'
import { isComboWeapon, beginHold, holdGesture, classify, unitMove, isDashing, SECTOR_FACING } from './combos.js'
```

In `applyKit`, replace `  hero.charging = null; hero.combo = null; hero.rune = null; hero.shock = undefined; hero.rain = undefined` with

```js
  hero.charging = null; hero.combo = null; hero.move = null; hero.invulnGroup = null; hero.rune = null; hero.shock = undefined; hero.rain = undefined
```

In `moveHero`, replace `  if (stunned) { hero.charging = null; cancelHold(hero) }` with

```js
  // A stun also ends a running combo effect (the lunge's dash, the thrusts).
  if (stunned) { hero.charging = null; hero.move = null; cancelHold(hero) }
```

and replace

```js
  // A held combo locks the facing: the moves aim the strike, not the stick.
  if (!stunned && !hero.combo && input.facing && DIRS[input.facing]) hero.facing = input.facing

  // While the attack is held the Warrior slides along the move held at the
  // press, at half speed, whatever the stick does now (spec 2a §2).
  const { x: vx, y: vy } = hero.combo ? hero.combo.lockDir : unitMove(input.move)
```

with

```js
  // A held combo locks the facing (the moves aim the strike, not the stick),
  // and so does the lunge's dash.
  const dashing = isDashing(hero)
  if (!stunned && !hero.combo && !dashing && input.facing && DIRS[input.facing]) hero.facing = input.facing

  // While the attack is held the Warrior slides along the move held at the
  // press, at half speed, whatever the stick does now (spec 2a §2); during
  // the lunge's dash the dash alone moves the hero.
  const { x: vx, y: vy } = hero.combo ? hero.combo.lockDir : dashing ? { x: 0, y: 0 } : unitMove(input.move)
```

In `tickHero`, add `  stepCombo(match, hero, dt)` as the last line of the function (after the `else if (hero.attackMode === 'ranged') …` line).

In `releaseCombo`, replace

```js
  else {
    hero.spawnProtect = 0
    hero.meleeCooldown = comboCooldown(hero.weapon.weaponType, combo.kind)
  }
```

with

```js
  else startCombo(match, hero, combo)
```

In `renderer/pvp/sim.js` (`resolveDeaths`), replace the two lines

```js
    h.charging = null
    h.combo = null
```

with

```js
    h.charging = null
    h.combo = null
    h.move = null
```

- [ ] **Step 6: The `whirl` cue**

`renderer/systems/sfx.js`: in `CUE_NAMES`, replace `  'thunder', 'crackle',` with

```js
  'thunder', 'crackle',
  // PvP
  'whirl',
```

`renderer/render/audio.js`: in `RECIPES`, directly after the `'melee-swing'` line add

```js
  'whirl':          { kind: 'swoosh', f0: 300,  f1: 1400, dur: 0.30, vol: 0.7 },
```

- [ ] **Step 7: Protocol `move` and the predictor's aging**

`renderer/net/protocol.js`: in `heroSnap`, directly after the `s.combo = …` line add

```js
  // A combo effect while it runs (2a): what it is, where it aims, how far
  // in, where it started (the lunge's streak) and whether the dash is over.
  s.move = h.move ? { kind: h.move.kind, dir: h.move.dir, t: h.move.t, from: { ...h.move.from }, done: !!h.move.done } : null
```

and in `hydrateHero`, directly after the `h.combo = …` line add

```js
  h.move = s.move ? { kind: s.move.kind, dir: s.move.dir, t: s.move.t, from: { ...s.move.from }, done: !!s.move.done } : null
```

`renderer/net/predict.js`: change `import { PVP } from '../data/pvp.js'` to `import { PVP, WARRIOR_COMBOS } from '../data/pvp.js'`, and in `predictStep` replace

```js
  predictSwing(h, attacking)
  return { released }
```

with

```js
  predictSwing(h, attacking)
  // A combo effect a snapshot showed runs out on the server's clock, so a
  // replayed lunge stops the walk exactly as long as the server's dash did.
  if (h.move) { h.move.t += dt; if (h.move.t >= WARRIOR_COMBOS.fxDur - 1e-9) h.move = null }
  return { released }
```

- [ ] **Step 8: Run the tests**

Run: `node --test test/pvp-warrior.test.js test/net-predict.test.js test/audio.test.js test/sfx.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: PASS.

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0` (the soak test's "inside a wall" invariant now also covers the lunge).

- [ ] **Step 9: Commit**

```bash
git add renderer/pvp/combos.js renderer/pvp/attacks.js renderer/pvp/combat.js renderer/pvp/hero.js renderer/pvp/sim.js renderer/systems/sfx.js renderer/render/audio.js renderer/net/protocol.js renderer/net/predict.js test/pvp-warrior.test.js test/net-predict.test.js
git commit -m "feat(pvp): lunge, fence and whirlwind — hero.move stepped each tick, hit groups past i-frames, move on the wire

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---
### Task 5: The Archer's double shot (sim and predictor)

**Files:**
- Modify: `renderer/pvp/attacks.js` (`canDrawDouble`, `payDoubleShot`, `looseDouble`), `renderer/pvp/hero.js` (`tickRanged`, the draw's move factor), `renderer/pvp/sim.js` (projectile `group`)
- Modify: `renderer/net/predict.js` (`predictRanged`)
- Create: `test/pvp-archer.test.js`
- Modify: `test/net-predict.test.js`

**Interfaces:**
- Consumes: `DOUBLE_SHOT`, `drawFrac`, `doubleShotBand` (Task 1); `hurtHero({ group })`, `match.groupSeq` (Task 4).
- Produces:
  - `hero.charging = { t, kind: 'double' }` while drawing (`t` capped at `DOUBLE_SHOT.full`);
  - `attacks.js`: `canDrawDouble(hero) → boolean`; `payDoubleShot(hero, frac) → { band, arrows } | null` (spends the arrows and sets `rangedCooldown`); `looseDouble(match, hero, frac) → { band, arrows } | null` (pushes the projectiles);
  - double-shot projectiles: `{ px, py, dx, dy, damage, color, shape: 'arrow', trail: true, friendly: true, owner, group }`;
  - `projectileHooks.hurt` passes `group: p.group ?? null` to `hurtHero`.

- [ ] **Step 1: Write the failing tests**

Create `test/pvp-archer.test.js`:

```js
// The Archer's double shot (spec 2a §3).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeHero, placeHero, tickHero, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'
import { grantRune } from '../renderer/pvp/pickups.js'
import { PLAYER_SPEED } from '../renderer/systems/movement.js'
import { PVP, DOUBLE_SHOT } from '../renderer/data/pvp.js'
import { testMatch } from './pvp-helpers.js'

const dt = PVP.tick
const hero = (id, cls, cell) => { const h = makeHero({ id, name: id, cls }); placeHero(h, cell); return h }
const input = over => ({ ...NEUTRAL_INPUT, move: { x: 0, y: 0 }, ...over })
// Hold Q for `ticks` ticks after the one that starts the draw, then let go.
const draw = (m, h, ticks, over = {}) => {
  for (let i = 0; i <= ticks; i++) tickHero(m, h, input({ alt: true, facing: 'east', ...over }), dt)
  tickHero(m, h, input({ facing: 'east' }), dt)
}
const archer = () => { const a = hero('a', 'archer', { x: 3, y: 5 }); return { a, m: testMatch([a]) } }

describe('the draw', () => {
  it('holding Q draws (kind double) with the ranged cooldown ready, at 0.6 speed, steering normally', () => {
    const { a, m } = archer()
    tickHero(m, a, input({ alt: true }), dt)
    assert.deepEqual(a.charging, { t: 0, kind: 'double' })
    const x0 = a.px, y0 = a.py
    tickHero(m, a, input({ alt: true, move: { x: 0, y: 1 }, facing: 'south' }), dt)
    assert.ok(Math.abs(a.py - y0 - PLAYER_SPEED * DOUBLE_SHOT.moveMul * dt) < 1e-9)
    assert.equal(a.px, x0)
    assert.equal(a.facing, 'south')
  })
  it('does not start inside the ranged cooldown or with no arrows', () => {
    const { a, m } = archer(); a.rangedCooldown = 0.3
    tickHero(m, a, input({ alt: true }), dt)
    assert.equal(a.charging, null)
    const b = hero('b', 'archer', { x: 3, y: 7 }); b.ammo.arrow = 0
    tickHero(testMatch([b]), b, input({ alt: true }), dt)
    assert.equal(b.charging, null)
  })
  it('the draw stops at 1.2 s: no auto-release', () => {
    const { a, m } = archer()
    for (let i = 0; i < 90; i++) tickHero(m, a, input({ alt: true }), dt)
    assert.deepEqual(a.charging, { t: DOUBLE_SHOT.full, kind: 'double' })
    assert.equal(m.projectiles.length, 0)
  })
  it('the attack does nothing during the draw', () => {
    const { a, m } = archer()
    tickHero(m, a, input({ alt: true }), dt)
    for (let i = 0; i < 20; i++) tickHero(m, a, input({ alt: true, attack: true }), dt)
    assert.equal(m.projectiles.length, 0)
    assert.equal(a.ammo.arrow, 24)
  })
  it('a stun mid-draw drops the draw: nothing fires, nothing is spent', () => {
    const { a, m } = archer()
    for (let i = 0; i < 30; i++) tickHero(m, a, input({ alt: true }), dt)
    a.stunTimer = 0.2
    tickHero(m, a, input({ alt: true }), dt)
    assert.equal(a.charging, null)
    a.stunTimer = 0
    tickHero(m, a, input({}), dt)
    assert.equal(m.projectiles.length, 0)
    assert.equal(a.ammo.arrow, 24)
  })
  it("Q does nothing while the rune's crossbow is held", () => {
    const { a, m } = archer()
    grantRune(m, a)
    tickHero(m, a, input({ alt: true }), dt)
    assert.equal(a.charging, null)
  })
})

describe('the release', () => {
  it('below 30 % nothing fires and nothing is spent', () => {
    const { a, m } = archer()
    draw(m, a, 10)                                         // 10 ticks: 0.33 s = 28 %
    assert.equal(m.projectiles.length, 0)
    assert.equal(a.ammo.arrow, 24)
    assert.equal(a.rangedCooldown, 0)
    assert.equal(a.charging, null)
  })
  it('each band: two parallel arrows 12 px apart, each dealing the band damage', () => {
    // ticks held → draw fraction: 11 → 0.31, 13 → 0.36 (1); 15 → 0.42 (2); 20 → 0.56 (3); 26 → 0.72 (4); 36 → 1 (5)
    for (const [ticks, damage] of [[11, 1], [13, 1], [15, 2], [20, 3], [26, 4], [36, 5], [60, 5]]) {
      const { a, m } = archer()
      draw(m, a, ticks)
      assert.equal(m.projectiles.length, 2, `${ticks}`)
      const [p, q] = m.projectiles
      assert.deepEqual([p.damage, q.damage], [damage, damage], `${ticks} ticks`)
      assert.ok(p.dx > 0 && q.dx > 0 && p.dy === 0 && q.dy === 0)
      assert.equal(Math.abs(p.py - q.py), DOUBLE_SHOT.gap)
      assert.equal((p.py + q.py) / 2, a.py)
      assert.equal(p.owner, 'a')
      assert.ok(p.trail && p.color === q.color)
      assert.equal(a.ammo.arrow, 22)
      assert.equal(a.rangedCooldown, DOUBLE_SHOT.cooldown)
    }
  })
  it('with one arrow left it fires one, from the centre', () => {
    const { a, m } = archer(); a.ammo.arrow = 1
    draw(m, a, 36)
    assert.equal(m.projectiles.length, 1)
    assert.equal(m.projectiles[0].py, a.py)
    assert.equal(a.ammo.arrow, 0)
  })
})

describe('in a match', () => {
  const duel = () => {
    const m = makeMatch({ roster: [{ id: 'a', name: 'a', cls: 'archer' }, { id: 'v', name: 'v', cls: 'warrior' }] })
    const [a, v] = m.heroes
    placeHero(a, { x: 3, y: 8 }); placeHero(v, { x: 9, y: 8 })
    a.spawnProtect = 0; v.spawnProtect = 0
    return { m, a, v }
  }
  const play = (m, inputs, ticks) => { for (let i = 0; i < ticks; i++) stepMatch(m, inputs(i), PVP.tick) }
  it('both arrows hit one hero: a full draw deals 10 and kills from full hp', () => {
    const { m, a, v } = duel()
    play(m, i => ({ a: input({ alt: i <= 36, facing: 'east' }) }), 80)
    assert.equal(v.deaths, 1)
    assert.equal(a.kills, 1)
  })
  it('a buckler raised toward the shot blocks both arrows', () => {
    const { m, v } = duel()
    play(m, i => ({ a: input({ alt: i <= 36, facing: 'east' }), v: input({ alt: true, facing: 'west' }) }), 80)
    assert.equal(v.hp, PVP.hp)
  })
})
```

In `test/net-predict.test.js`, inside `describe('2a prediction parity', …)`, add after its last test:

```js
  it("the Archer's slowed draw, its release and a re-press inside the cooldown match the server", () => {
    const E = { x: 1, y: 0 }
    const inputs = [
      { move: E, attack: true }, { move: E, attack: true },                 // a plain shot: cooldown 0.6
      ...Array(8).fill({ move: E, alt: true }),                             // Q inside that cooldown: no draw yet
      ...Array(30).fill({ move: E, alt: true }),                            // the draw
      { move: E }, ...Array(5).fill({ move: E, alt: true }),               // release; Q again inside 0.8 s
      ...Array(30).fill({ move: E, alt: true }),
    ]
    const r = replay('archer', inputs, 20)
    same(r)
    assert.deepEqual(r.pred.charging, r.server.charging)
    assert.equal(r.pred.ammo.arrow, r.server.ammo.arrow)
    assert.ok(Math.abs(r.pred.rangedCooldown - r.server.rangedCooldown) < 1e-9)
    assert.equal(r.server.ammo.arrow, 24 - 1 - 2)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/pvp-archer.test.js test/net-predict.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: FAIL — no draw starts (`a.charging` null) and the archer parity test mismatches.

- [ ] **Step 3: The shot in `renderer/pvp/attacks.js`**

Replace `import { tryFire } from '../systems/ranged.js'` with

```js
import { tryFire } from '../systems/ranged.js'
import { spendAmmo } from '../systems/inventory.js'
```

and `import { PVP, WARRIOR_COMBOS } from '../data/pvp.js'` with

```js
import { PVP, WARRIOR_COMBOS, DOUBLE_SHOT, doubleShotBand } from '../data/pvp.js'
```

Append at the end of the file:

```js

// --- the Archer's double shot (spec 2a §3) -----------------------------

// Q starts a draw only with a bow (not the rune's crossbow), an arrow to
// shoot and the ranged cooldown ready.
export const canDrawDouble = hero =>
  hero.ranged?.kind === 'bow' && (hero.ammo?.arrow ?? 0) > 0 && hero.rangedCooldown <= 0

// Pays for a release at draw fraction `frac`: two arrows (or the one left)
// and DOUBLE_SHOT.cooldown — or nothing, returning null, below
// DOUBLE_SHOT.min. predict.js calls this too, for the same ammo and cooldown.
export function payDoubleShot(hero, frac) {
  const band = doubleShotBand(frac)
  const arrows = Math.min(2, hero.ammo?.arrow ?? 0)
  if (!band || arrows <= 0) return null
  spendAmmo(hero, 'arrow', arrows)
  hero.rangedCooldown = DOUBLE_SHOT.cooldown
  return { band, arrows }
}

// The release: two arrows straight ahead, DOUBLE_SHOT.gap apart across the
// facing (one from the centre if only one was left), each dealing the band's
// damage in the band's colour. Ordinary arrows — a raised buckler blocks
// them — sharing one hit group, so both can land on one hero.
export function looseDouble(match, hero, frac) {
  const shot = payDoubleShot(hero, frac)
  if (!shot) return null
  hero.spawnProtect = 0
  const [dx, dy] = DIRS[hero.facing] ?? DIRS.east
  match.groupSeq = (match.groupSeq ?? 0) + 1
  const group = `${hero.id}#${match.groupSeq}`
  const half = DOUBLE_SHOT.gap / 2
  for (const k of shot.arrows === 2 ? [-1, 1] : [0]) {
    match.projectiles.push({ px: hero.px - dy * half * k, py: hero.py + dx * half * k,
      dx: dx * PVP.arrowSpeed, dy: dy * PVP.arrowSpeed, damage: shot.band.damage, color: shot.band.color,
      shape: 'arrow', trail: true, friendly: true, owner: hero.id, group })
  }
  sfx(match, 'ranged-shot', { px: hero.px, py: hero.py })
  return shot
}
```

- [ ] **Step 4: The draw in `renderer/pvp/hero.js` and the arrow's group in the sim**

Replace the two import lines

```js
import { swing, castSpell, loose, startCombo, stepCombo } from './attacks.js'
```

and

```js
import { KITS, OUTFIT_OVERRIDES, PVP, WARRIOR_COMBOS } from '../data/pvp.js'
```

with

```js
import { swing, castSpell, loose, startCombo, stepCombo, canDrawDouble, looseDouble } from './attacks.js'
```

and

```js
import { KITS, OUTFIT_OVERRIDES, PVP, WARRIOR_COMBOS, DOUBLE_SHOT, drawFrac } from '../data/pvp.js'
```

In `moveHero`, replace

```js
      ? (hero.charging.kind === 'spell' ? GUST_CHARGE.moveFactor : chargeMoveFactor(hero.weapon?.weaponType))
```

with

```js
      ? (hero.charging.kind === 'spell' ? GUST_CHARGE.moveFactor
        : hero.charging.kind === 'double' ? DOUBLE_SHOT.moveMul
        : chargeMoveFactor(hero.weapon?.weaponType))
```

In `tickHero`, replace `  else if (hero.attackMode === 'ranged') tickRanged(match, hero, attacking)` with

```js
  else if (hero.attackMode === 'ranged') tickRanged(match, hero, input, attacking, dt)
```

Replace the whole `tickRanged` function (and its one-line comment) with:

```js
// Every PvP bow fires on its cooldown while attack is held. Holding alt (Q)
// draws the double shot (spec 2a §3): the draw counts up to
// DOUBLE_SHOT.full and holds there (no auto-release), the attack does
// nothing meanwhile, and letting go looses both arrows at the draw reached.
function tickRanged(match, hero, input, attacking, dt) {
  if (hero.charging?.kind === 'double') {
    if (input.alt) { hero.charging.t = Math.min(hero.charging.t + dt, DOUBLE_SHOT.full); return }
    const frac = drawFrac(hero.charging.t)
    hero.charging = null
    looseDouble(match, hero, frac)
    return
  }
  if (input.alt && canDrawDouble(hero)) { hero.charging = { t: 0, kind: 'double' }; return }
  if (attacking) loose(match, hero)
}
```

In `renderer/pvp/sim.js` (`projectileHooks`), replace

```js
    const landed = hurtHero(match, target, damage, { by: heroById(match, p?.owner), from: { px: p.px, py: p.py } })
```

with

```js
    const landed = hurtHero(match, target, damage, { by: heroById(match, p?.owner), from: { px: p.px, py: p.py }, group: p?.group ?? null })
```

- [ ] **Step 5: The predictor's draw**

In `renderer/net/predict.js`, replace

```js
import { swingCost, comboCooldown } from '../pvp/attacks.js'
```

with

```js
import { swingCost, comboCooldown, canDrawDouble, payDoubleShot } from '../pvp/attacks.js'
import { tryFire } from '../systems/ranged.js'
```

and `import { PVP, WARRIOR_COMBOS } from '../data/pvp.js'` with

```js
import { PVP, WARRIOR_COMBOS, DOUBLE_SHOT, drawFrac } from '../data/pvp.js'
```

Insert directly above `// One predicted tick. Returns { released }: …`:

```js
// The Archer's draw, as hero.js's tickRanged runs it, effects excluded: the
// draw slows the walk, so it must start, hold and end exactly when the
// server's does — which needs the ammo and ranged cooldown every shot pays
// (payDoubleShot, and tryFire for a plain shot) mirrored too.
function predictRanged(h, input, attacking, dt) {
  if (h.attackMode !== 'ranged') return
  if (h.charging?.kind === 'double') {
    if (input.alt) { h.charging.t = Math.min(h.charging.t + dt, DOUBLE_SHOT.full); return }
    const frac = drawFrac(h.charging.t)
    h.charging = null
    payDoubleShot(h, frac)
    return
  }
  if (input.alt && canDrawDouble(h)) { h.charging = { t: 0, kind: 'double' }; return }
  if (attacking) tryFire(h)
}

```

and in `predictStep`, directly after `  predictSwing(h, attacking)` add

```js
  predictRanged(h, input, attacking, dt)
```

- [ ] **Step 6: Run the tests**

Run: `node --test test/pvp-archer.test.js test/net-predict.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: PASS.

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add renderer/pvp/attacks.js renderer/pvp/hero.js renderer/pvp/sim.js renderer/net/predict.js test/pvp-archer.test.js test/net-predict.test.js
git commit -m "feat(pvp): the Archer's double shot on Q — slowed draw, five bands, two arrows in one hit group; predicted

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 6: The spell override seam and Call Lightning's PvP numbers

**Files:**
- Modify: `renderer/systems/spells.js` (`castCost`, `tryCast`), `renderer/systems/spells/lightning.js` (`markStrike`, `castLightning`, `strike`)
- Modify: `renderer/pvp/attacks.js` (`castSpell`), `renderer/net/predict.js` (`predictCharge`)
- Create: `test/pvp-mage.test.js`
- Modify: `test/net-predict.test.js`

**Interfaces:**
- Consumes: `SPELL_OVERRIDES` (Task 1).
- Produces:
  - `castCost(hero, spellId, tier, override = null)`: the override's fields replace the row's (its `cooldown` here);
  - `tryCast(state, spellId, tier, { modules, hand, caster, override = null })`: `cast.spell` is the merged row (single-player: the very `SPELLS` row); a bespoke module is called `module(state, tier, caster, spell)`;
  - `castLightning(state, tier, p, spell = null)`: every mark carries `spell.delay` (else `LIGHTNING.delay`) and, when present, `damage`/`stun`;
  - `markStrike(state, x, y, owner, numbers = {})`;
  - `strike` uses `mark.damage ?? LIGHTNING.damage` and `mark.stun ?? LIGHTNING.stun`;
  - `castSpell` (PvP) passes `override: SPELL_OVERRIDES[spellId] ?? null`.

- [ ] **Step 1: Write the failing tests**

Create `test/pvp-mage.test.js` (Task 7 extends it):

```js
// The Mage (spec 2a §4): Call Lightning with a match's numbers, and the
// fireball rune.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'
import { placeHero, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { tryCast, castCost, SPELLS } from '../renderer/systems/spells.js'
import { castLightning, tickLightning, LIGHTNING } from '../renderer/systems/spells/lightning.js'
import { makePlayer } from '../renderer/systems/entities.js'
import { applyLoadout } from '../renderer/systems/loadout.js'
import { PVP, SPELL_OVERRIDES } from '../renderer/data/pvp.js'
import { openMap } from './pvp-helpers.js'

const input = over => ({ ...NEUTRAL_INPUT, move: { x: 0, y: 0 }, ...over })
const play = (m, inputs, ticks) => { const ev = []; for (let i = 0; i < ticks; i++) ev.push(...stepMatch(m, inputs(i), PVP.tick)); return ev }
const duel = (cls = 'archer', foeCell = { x: 6, y: 8 }) => {
  const m = makeMatch({ roster: [{ id: 'm', name: 'm', cls: 'mage' }, { id: 'f', name: 'f', cls }] })
  const [mg, f] = m.heroes
  placeHero(mg, { x: 3, y: 8 }); placeHero(f, foeCell)
  mg.spawnProtect = 0; f.spawnProtect = 0; mg.facing = 'east'
  return { m, mg, f }
}

describe('Call Lightning in a match', () => {
  it('a tap marks 3 tiles ahead with a 0.4 s delay and a 1.5 s cooldown; the strike deals 3 and stuns 0.3 s', () => {
    const { m, mg, f } = duel()
    play(m, i => ({ m: input({ attack: i === 0, facing: 'east' }) }), 2)   // press, release
    assert.equal(m.lightning.length, 1)
    assert.deepEqual([m.lightning[0].x, m.lightning[0].y, m.lightning[0].delay], [6, 8, 0.4])
    assert.equal(mg.magicCooldown, 1.5)                       // set on the release tick
    let stunned = 0
    for (let i = 0; i < 15 && f.hp === PVP.hp; i++) { stepMatch(m, {}, PVP.tick); stunned = f.stunTimer }
    assert.equal(f.hp, PVP.hp - 3)
    assert.ok(Math.abs(stunned - 0.6 * PVP.ccMul) < 1e-9, `stun ${stunned}`)
    assert.equal(f.lastHitBy.id, 'm')
  })
  it('the tiers aim as before: a full charge 6 tiles ahead, an overcharge the line of 4, 6 and 8', () => {
    const tiles = hold => {
      const { m } = duel('archer', { x: 20, y: 3 })
      play(m, i => ({ m: input({ attack: i < hold, facing: 'east' }) }), hold + 1)
      return m.lightning.map(k => k.x - 3)
    }
    assert.deepEqual(tiles(18), [6])
    assert.deepEqual(tiles(40), [4, 6, 8])
  })
  it('the stamina costs are unchanged: 20, 30, 50', () => {
    const h = makePlayer(0, 0)
    for (const [tier, cost] of [['tap', 20], ['full', 30], ['over', 50]]) {
      h.stamina = 100
      assert.equal(castCost(h, 'lightning', tier, SPELL_OVERRIDES.lightning).stamina, cost)
    }
    assert.equal(castCost(h, 'lightning', 'tap', SPELL_OVERRIDES.lightning).cooldown, 1.5)
  })
})

describe("single-player's Call Lightning is unchanged", () => {
  it('no override: cooldown 4, delay 0.6, damage 5, stun 1', () => {
    const p = makePlayer(3, 5)
    p.px = 3 * 32 + 16; p.py = 5 * 32 + 16; p.facing = 'east'
    applyLoadout(p, { wandType: 'stormwand', outfits: ['robe'] })
    const foe = { type: 'monster', x: 6, y: 5, px: 6 * 32 + 16, py: 5 * 32 + 16, hp: 9 }
    const state = { map: openMap(), player: p, entities: [foe], lightning: [], strikes: [] }
    const cast = tryCast(state, 'lightning', 'tap', { modules: { lightning: castLightning } })
    assert.equal(cast.ok, true)
    assert.equal(cast.spell, SPELLS.lightning)
    assert.equal(p.magicCooldown, 4)
    assert.deepEqual(state.lightning[0], { x: 6, y: 5, t: 0, delay: LIGHTNING.delay, struck: false })
    const hurt = []
    tickLightning(state, LIGHTNING.delay, { hurt: (e, d) => hurt.push(d) })
    assert.deepEqual(hurt, [5])
    assert.equal(foe.stunTimer, 1.0)
  })
})
```

In `test/net-predict.test.js`, inside `describe('2a prediction parity', …)`, add after its last test:

```js
  it("the Mage's lightning cooldown is the match's 1.5 s: a re-press after 1.7 s charges (and slows) on both", () => {
    const E = { x: 1, y: 0 }
    const inputs = [{ move: E, attack: true }, { move: E }, ...Array(50).fill({ move: E }), ...Array(6).fill({ move: E, attack: true })]
    const r = replay('mage', inputs, 1)            // the release is replayed, not read off a snapshot
    same(r)
    assert.ok(r.server.charging, 'the server is charging again')
    assert.deepEqual(r.pred.charging, r.server.charging)
    assert.ok(Math.abs(r.pred.magicCooldown - r.server.magicCooldown) < 1e-9)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/pvp-mage.test.js test/net-predict.test.js 2>&1 | grep -E "^# (pass|fail)|    not ok"`
Expected: FAIL — the match's mark has delay 0.6 and the cooldown is 4; the stamina-costs test fails on the cooldown (4, not 1.5); the Mage parity test finds the server charging and the predictor not. The single-player test already passes.

- [ ] **Step 3: The override seam in `renderer/systems/spells.js`**

Replace

```js
// primitive. predict.js calls this too, so a charge spell's predicted
// release pays exactly what the server would.
export function castCost(hero, spellId, tier) {
  const spell = SPELLS[spellId] ?? SPELLS.gust
```

with

```js
// primitive. predict.js calls this too, so a charge spell's predicted
// release pays exactly what the server would. `override` (PvP's
// SPELL_OVERRIDES row) replaces fields of the spell's row, its cooldown here.
const withOverride = (spellId, override) => {
  const spell = SPELLS[spellId] ?? SPELLS.gust
  return override ? { ...spell, ...override } : spell
}

export function castCost(hero, spellId, tier, override = null) {
  const spell = withOverride(spellId, override)
```

Replace

```js
// `caster` defaults to state.player; PvP passes the hero casting.
export function tryCast(state, spellId, tier = 'tap', { modules, hand = 'main', caster = state.player } = {}) {
  const p = caster
  const spell = SPELLS[spellId] ?? SPELLS.gust
```

with

```js
// `caster` defaults to state.player; PvP passes the hero casting, and its
// SPELL_OVERRIDES row as `override`: fields that replace the row's own (the
// cooldown), handed on whole to a bespoke module (Call Lightning reads its
// delay, damage and stun there). Without one, single-player's numbers.
export function tryCast(state, spellId, tier = 'tap', { modules, hand = 'main', caster = state.player, override = null } = {}) {
  const p = caster
  const spell = withOverride(spellId, override)
```

In `tryCast`, replace `  const resolved = castCost(p, spellId, tier)` with `  const resolved = castCost(p, spellId, tier, override)` and `    default:     result = module(state, resolved.tier, p); break` with `    default:     result = module(state, resolved.tier, p, spell); break`.

- [ ] **Step 4: Marks that carry their own numbers (`renderer/systems/spells/lightning.js`)**

Replace the `markStrike` function's comment tail and first two lines

```js
// that must not stack marks (the hammer) keeps its own cooldown.
export function markStrike(state, x, y, owner) {
  const mark = { x, y, t: 0, delay: LIGHTNING.delay, struck: false, ...(owner !== undefined && { owner }) }
```

with

```js
// that must not stack marks (the hammer) keeps its own cooldown.
// `numbers` ({ delay, damage, stun }, each optional) is PvP's: a mark
// carries its own, and one without them strikes with LIGHTNING's.
export function markStrike(state, x, y, owner, numbers = {}) {
  const mark = { x, y, t: 0, delay: numbers.delay ?? LIGHTNING.delay, struck: false, ...(owner !== undefined && { owner }),
    ...(numbers.damage !== undefined && { damage: numbers.damage }), ...(numbers.stun !== undefined && { stun: numbers.stun }) }
```

Replace

```js
// strike, not triple damage on one tile. Returns the marks it added.
export function castLightning(state, tier = 'tap', p = state.player) {
```

with

```js
// strike, not triple damage on one tile. Returns the marks it added.
// `spell` is the row tryCast cast (with PvP's override merged in); its
// delay/damage/stun, when present, ride on every mark.
export function castLightning(state, tier = 'tap', p = state.player, spell = null) {
  const numbers = { delay: spell?.delay, damage: spell?.damage, stun: spell?.stun }
```

and inside it `    marks.push(markStrike(state, hit.x, hit.y, p?.id))` with `    marks.push(markStrike(state, hit.x, hit.y, p?.id, numbers))`.

In `strike`, replace

```js
    hooks?.hurt?.(e, LIGHTNING.damage, { source: 'lightning', ...(mark.owner !== undefined && { owner: mark.owner }) })
    if (stunnable(e)) e.stunTimer = Math.max(e.stunTimer ?? 0, LIGHTNING.stun)
```

with

```js
    hooks?.hurt?.(e, mark.damage ?? LIGHTNING.damage, { source: 'lightning', ...(mark.owner !== undefined && { owner: mark.owner }) })
    if (stunnable(e)) e.stunTimer = Math.max(e.stunTimer ?? 0, mark.stun ?? LIGHTNING.stun)
```

- [ ] **Step 5: PvP passes its numbers; the predictor pays them**

`renderer/pvp/attacks.js`: change the data import to

```js
import { PVP, WARRIOR_COMBOS, DOUBLE_SHOT, doubleShotBand, SPELL_OVERRIDES } from '../data/pvp.js'
```

and in `castSpell` replace

```js
  const cast = tryCast(match, spellId, tier, { modules: MODULES, hand, caster: hero })
```

with

```js
  // A match's numbers for the shared spells (spec 2a §4): SPELL_OVERRIDES.
  const cast = tryCast(match, spellId, tier, { modules: MODULES, hand, caster: hero, override: SPELL_OVERRIDES[spellId] ?? null })
```

`renderer/net/predict.js`: change the data import to

```js
import { PVP, WARRIOR_COMBOS, DOUBLE_SHOT, drawFrac, SPELL_OVERRIDES } from '../data/pvp.js'
```

and in `predictCharge` replace

```js
      const resolved = castCost(h, spellFor(h).id, resolveGustTier(held))
```

with

```js
      const id = spellFor(h).id
      const resolved = castCost(h, id, resolveGustTier(held), SPELL_OVERRIDES[id] ?? null)
```

- [ ] **Step 6: Run the tests**

Run: `node --test test/pvp-mage.test.js test/net-predict.test.js test/lightning.test.js test/spells.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: PASS (the single-player lightning and spell suites are unchanged).

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add renderer/systems/spells.js renderer/systems/spells/lightning.js renderer/pvp/attacks.js renderer/net/predict.js test/pvp-mage.test.js test/net-predict.test.js
git commit -m "feat(pvp): spell overrides — a match's Call Lightning is 1.5 s / 0.4 s / 3 dmg / 0.6 s stun; single-player unchanged

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---
### Task 7: The fireball rune — detonate, burst, fire patches credited to the caster

**Files:**
- Modify: `renderer/systems/projectiles.js` (the fifth `detonate` argument)
- Modify: `renderer/pvp/sim.js` (`detonateFireball`, `tickFireZones`, the hook, the tick)
- Modify: `test/projectiles.test.js`, `test/pvp-mage.test.js`

**Interfaces:**
- Consumes: `SPELL_OVERRIDES.fireball.burst` (Task 1); `RUNE_POWER.mage` = firewand (Task 1); `hurtHero` (existing; `'fire'` is neither blocked nor i-framed).
- Produces:
  - `hooks.detonate(px, py, blastTiles, { fireOnly }, { owner, struck })`: `struck` is the entity hit directly, `null` at a wall or the end of range;
  - `sim.js`: `detonateFireball(match, px, py, blastTiles, opts, hit)`, `tickFireZones(match, dt)`;
  - `match.fireZones: { tiles: {x, y}[], age, tickTimer, owner: heroId | null }[]` (Task 8 puts `{ tiles, age }` on the wire).

- [ ] **Step 1: Write the failing tests**

Append at the end of `test/projectiles.test.js`:

```js

describe('detonate names the shooter and the entity struck (PvP)', () => {
  it('a direct hit hands { owner, struck }; a wall stop hands struck null', () => {
    const target = { id: 'a', type: 'monster', px: 5, py: 0, hp: 10 }
    const hitCalls = []
    const { hooks } = makeHooks({ detonate: (px, py, blastTiles, opts, hit) => hitCalls.push(hit) })
    stepProjectiles(baseState([target], [{ px: 0, py: 0, dx: 100, dy: 0, damage: 4, friendly: true, explodes: true, blastTiles: 16, owner: 'm' }]), 0.1, hooks)
    assert.equal(hitCalls.length, 1)
    assert.equal(hitCalls[0].owner, 'm')
    assert.equal(hitCalls[0].struck.id, 'a')
    const wallCalls = []
    const { hooks: h2 } = makeHooks({ detonate: (px, py, blastTiles, opts, hit) => wallCalls.push(hit) })
    stepProjectiles(baseState([], [{ px: 0, py: 0, dx: 100, dy: 0, damage: 4, friendly: true, explodes: true, blastTiles: 16, owner: 'm', maxDist: 5 }]), 0.1, h2)
    assert.deepEqual(wallCalls, [{ owner: 'm', struck: null }])
  })
})
```

In `test/pvp-mage.test.js`, change `import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'` to `import { makeMatch, stepMatch, removeHero } from '../renderer/pvp/sim.js'` and `import { makePlayer } from '../renderer/systems/entities.js'` to `import { makePlayer, makeWandContents } from '../renderer/systems/entities.js'`, then append:

```js

describe('the fireball rune', () => {
  const fireball = (foes, facing = 'east') => {
    const m = makeMatch({ roster: [{ id: 'm', name: 'm', cls: 'mage' }, ...foes.map((c, i) => ({ id: `f${i}`, name: `f${i}`, cls: 'archer' }))] })
    const [mg, ...fs] = m.heroes
    placeHero(mg, { x: 3, y: 8 }); mg.spawnProtect = 0
    foes.forEach((cell, i) => { placeHero(fs[i], cell); fs[i].spawnProtect = 0 })
    mg.rune = { t: 30, saved: {} }; mg.wand = makeWandContents('firewand')
    play(m, i => ({ m: input({ attack: i === 0, facing }) }), 2)         // press, release: a tap
    return { m, mg, fs }
  }
  const untilGone = m => { for (let i = 0; i < 60 && m.projectiles.length; i++) stepMatch(m, {}, PVP.tick) }
  it("the direct hit is the spell's 4 and no burst; a neighbour takes the 2 burst, credited to the caster", () => {
    const { m, fs: [direct, near] } = fireball([{ x: 7, y: 8 }, { x: 7, y: 9 }])
    untilGone(m)
    assert.equal(direct.hp, PVP.hp - 4)
    assert.equal(near.hp, PVP.hp - 2)
    assert.equal(near.lastHitBy.id, 'm')
    assert.equal(m.fireZones.length, 1)
    assert.equal(m.fireZones[0].owner, 'm')
  })
  it('the patch burns 1 a second for 3 s into whoever stands in it, then goes out', () => {
    const { m, fs: [direct, near] } = fireball([{ x: 7, y: 8 }, { x: 7, y: 9 }])
    untilGone(m)
    for (let i = 0; i < Math.round(3 / PVP.tick); i++) stepMatch(m, {}, PVP.tick)
    assert.equal(direct.hp, PVP.hp - 4 - 3)
    assert.equal(near.hp, PVP.hp - 2 - 3)
    assert.equal(m.fireZones.length, 0)
  })
  it('the burst is unblockable: a buckler raised toward the caster still burns', () => {
    const m = makeMatch({ roster: [{ id: 'm', name: 'm', cls: 'mage' }, { id: 'a', name: 'a', cls: 'archer' }, { id: 'w', name: 'w', cls: 'warrior' }] })
    const [mg, a, w] = m.heroes
    placeHero(mg, { x: 3, y: 8 }); placeHero(a, { x: 7, y: 8 }); placeHero(w, { x: 7, y: 9 })
    for (const h of m.heroes) h.spawnProtect = 0
    mg.rune = { t: 30, saved: {} }; mg.wand = makeWandContents('firewand')
    for (let i = 0; i < 40; i++) stepMatch(m, { m: input({ attack: i === 0, facing: 'east' }), w: input({ alt: true, facing: 'west' }) }, PVP.tick)
    assert.equal(w.hp, PVP.hp - 2)
  })
  it('a patch whose caster has left the match burns on, crediting nobody', () => {
    const { m, fs: [direct] } = fireball([{ x: 7, y: 8 }])
    untilGone(m)
    removeHero(m, 'm')
    for (let i = 0; i < Math.round(1.1 / PVP.tick); i++) stepMatch(m, {}, PVP.tick)
    assert.equal(direct.hp, PVP.hp - 4 - 1)
    assert.equal(direct.lastHitBy.id, 'm', 'the last credited hit is still the fireball itself')
  })
  it('the caster takes neither the burst nor the patch', () => {
    const { m, mg } = fireball([{ x: 20, y: 20 }], 'west')      // straight into the wall beside the caster
    untilGone(m)
    assert.equal(m.fireZones.length, 1)
    assert.ok(m.fireZones[0].tiles.some(t => t.x === 3 && t.y === 8), 'the caster stands in the blast')
    for (let i = 0; i < Math.round(3 / PVP.tick); i++) stepMatch(m, {}, PVP.tick)
    assert.equal(mg.hp, PVP.hp)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/projectiles.test.js test/pvp-mage.test.js 2>&1 | grep -E "^# (pass|fail)|    not ok"`
Expected: FAIL — the projectile test (`hit` undefined), and every fireball test (no burst, no zone).

- [ ] **Step 3: The fifth argument in `renderer/systems/projectiles.js`**

Replace both occurrences of

```js
      if (p.explodes) hooks.detonate(p.lastPx ?? p.px, p.lastPy ?? p.py, p.blastTiles, { fireOnly: !!p.fireOnly })
```

(the end-of-range stop and the wall stop) with

```js
      if (p.explodes) hooks.detonate(p.lastPx ?? p.px, p.lastPy ?? p.py, p.blastTiles, { fireOnly: !!p.fireOnly }, { owner: p.owner, struck: null })
```

and the direct-impact call

```js
        if (p.explodes) hooks.detonate(p.px, p.py, p.blastTiles, { fireOnly: !!p.fireOnly })
```

with

```js
        if (p.explodes) hooks.detonate(p.px, p.py, p.blastTiles, { fireOnly: !!p.fireOnly }, { owner: p.owner, struck: target })
```

In the comment above `stepProjectiles`, replace

```js
// a count (e.g. combo/sfx bookkeeping upstream). hooks: { hurt(e, damage, p)
// -> entity, detonate(px, py, blastTiles, { fireOnly }), damagePlayer(damage, from),
```

with

```js
// a count (e.g. combo/sfx bookkeeping upstream). hooks: { hurt(e, damage, p)
// -> entity, detonate(px, py, blastTiles, { fireOnly }, { owner, struck }) —
// the fifth argument names the shooter and the entity struck directly (null
// at a wall or the end of range), for PvP's burst and kill credit —
// damagePlayer(damage, from),
```

- [ ] **Step 4: Detonation and fire zones in `renderer/pvp/sim.js`**

Replace `import { stepKnockback } from '../systems/knockback.js'` with

```js
import { stepKnockback } from '../systems/knockback.js'
import { computeBlastTiles, makeFireZone, FIRE_DURATION, FIRE_TICK_INTERVAL, FIRE_TICK_DAMAGE } from '../systems/fire.js'
import { overlapsTiles } from '../systems/hitbox.js'
```

and `import { PVP, KITS } from '../data/pvp.js'` with `import { PVP, KITS, SPELL_OVERRIDES } from '../data/pvp.js'`.

In `projectileHooks`, replace `  detonate: () => {},        // no PvP kit fires an exploding projectile` with

```js
  detonate: (px, py, blastTiles, opts, hit) => detonateFireball(match, px, py, blastTiles, opts, hit),
```

Insert directly above `const CC_FIELDS = ['stunTimer', 'slowTimer', 'rootTimer']`:

```js
const tileKeys = tiles => new Set(tiles.map(t => `${t.x},${t.y}`))

// The fireball rune's detonation (spec 2a §4): every hero but the one struck
// directly whose body overlaps the blast tiles takes SPELL_OVERRIDES.fireball
// .burst as unblockable 'fire', credited to the caster; the tiles burn as a
// fire zone for FIRE_DURATION. The caster is never hurt by either: hurtHero
// refuses self-damage. A tarred (fireOnly) projectile only lays the zone.
export function detonateFireball(match, px, py, blastTiles, { fireOnly = false } = {}, { owner, struck = null } = {}) {
  const tx = Math.floor(px / TILE_SIZE), ty = Math.floor(py / TILE_SIZE)
  const tiles = computeBlastTiles(match.map, tx, ty, blastTiles)
  if (!tiles.length) return
  const by = heroById(match, owner)
  sfx(match, 'fire-burst', { px, py })
  if (!fireOnly) {
    const keys = tileKeys(tiles)
    for (const h of match.heroes) {
      if (h !== struck && overlapsTiles(h, keys)) hurtHero(match, h, SPELL_OVERRIDES.fireball.burst, { kind: 'fire', by })
    }
    match.shockwaves.push({ px: tx * TILE_SIZE + TILE_SIZE / 2, py: ty * TILE_SIZE + TILE_SIZE / 2,
      t: 0, dur: 0.35, maxRadius: TILE_SIZE * 2.5, color: '#f97316' })
  }
  match.fireZones.push({ ...makeFireZone(tiles), owner: owner ?? null })
}

// Fire zones burn FIRE_TICK_DAMAGE every FIRE_TICK_INTERVAL into every hero
// standing in them, credited to the zone's caster, for FIRE_DURATION.
export function tickFireZones(match, dt) {
  const live = []
  for (const z of match.fireZones) {
    z.age += dt
    z.tickTimer -= dt
    while (z.tickTimer <= 1e-9) {
      z.tickTimer += FIRE_TICK_INTERVAL
      const keys = tileKeys(z.tiles)
      const by = heroById(match, z.owner)
      for (const h of match.heroes) if (overlapsTiles(h, keys)) hurtHero(match, h, FIRE_TICK_DAMAGE, { kind: 'fire', by })
    }
    if (z.age < FIRE_DURATION - 1e-9) live.push(z)
  }
  match.fireZones = live
}

```

In `tick`, directly above

```js
  for (const h of match.heroes) {
    if (h.dead || !h.shock) continue
```

add `  tickFireZones(match, dt)`.

- [ ] **Step 5: Run the tests**

Run: `node --test test/projectiles.test.js test/pvp-mage.test.js test/fire.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: PASS (the single-player fire and projectile suites unchanged).

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add renderer/systems/projectiles.js renderer/pvp/sim.js test/projectiles.test.js test/pvp-mage.test.js
git commit -m "feat(pvp): the fireball rune detonates — 2 burst past the direct target, 3 s fire patch, credited to the caster

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 8: Protocol v4 — the version, fire zones and arrow trails on the wire, into the client view

**Files:**
- Modify: `renderer/data/net.js` (`protocolVersion`), `renderer/net/protocol.js` (header comment, `snapshotBody`), `renderer/net/client.js` (`sessionView`), `renderer/net/view.js` (`netViewOf`)
- Modify: `test/net-protocol.test.js`, `test/net-sim.test.js`, `test/net-client.test.js`, `test/net-ui.test.js`

**Interfaces:**
- Consumes: `hero.combo`/`hero.move` snapshot fields (Tasks 3–4), `match.fireZones` (Task 7), `trail` on double-shot projectiles (Task 5).
- Produces:
  - `NET.protocolVersion === 4`;
  - snapshot `fireZones: { tiles: {x, y}[], age }[]`; snapshot projectiles gain `trail: true` when set;
  - `sessionView(s).fireZones` (the newest snapshot's, `[]` when absent); `netViewOf(v, …).fireZones` = `v.fireZones ?? []`.

- [ ] **Step 1: Write the failing tests**

`test/net-protocol.test.js`:
- In `'hello v3: resume is a fourth way in …'`, replace `    assert.equal(v, 3)` with `    assert.equal(v, 4)`, and replace `    assert.deepEqual(validateHello({ type: 'hello', v: 2, resume: tok }), { error: ERR.VERSION })` with

```js
    assert.deepEqual(validateHello({ type: 'hello', v: 3, resume: tok }), { error: ERR.VERSION }, 'a 4b client gets the reload line')
```

- In `'snapshotBody is plain JSON with every list the client draws'`, add `'fireZones'` to the key list (after `'shockwaves'`).
- Add, as the last test of `describe('snapshots', …)`:

```js
  it('v4: a hero carries its combo and move, a double-shot draw rides on charging, and fire zones travel', () => {
    const m = match()
    const [w, a] = m.heroes
    w.combo = { moves: ['e', 'e'], last: 'e', lockDir: { x: 1, y: 0 } }
    w.move = { kind: 'lunge', dir: 'e', t: 0.1, from: { px: 10, py: 20 }, done: false, dist: 30, fired: 0, group: 'p1#1' }
    a.charging = { t: 0.9, kind: 'double' }
    m.fireZones.push({ tiles: [{ x: 3, y: 4 }], age: 0.5, tickTimer: 0.5, owner: 'p1' })
    const body = JSON.parse(JSON.stringify(snapshotBody(m)))
    const [ws, as] = body.heroes
    assert.deepEqual(ws.combo, { moves: ['e', 'e'], lockDir: { x: 1, y: 0 }, last: 'e' })
    assert.deepEqual(ws.move, { kind: 'lunge', dir: 'e', t: 0.1, from: { px: 10, py: 20 }, done: false })
    assert.deepEqual(as.charging, { t: 0.9, kind: 'double' })
    assert.deepEqual(body.fireZones, [{ tiles: [{ x: 3, y: 4 }], age: 0.5 }])
    m.projectiles.push({ px: 1, py: 2, dx: 3, dy: 0, shape: 'arrow', color: '#facc15', trail: true, owner: 'p2', group: 'p2#1' })
    assert.deepEqual(snapshotBody(m).projectiles[0], { px: 1, py: 2, dx: 3, dy: 0, shape: 'arrow', color: '#facc15', trail: true })
    const h = hydrateHero(null, ws)
    assert.deepEqual(h.combo, w.combo)
    assert.deepEqual(h.move, { kind: 'lunge', dir: 'e', t: 0.1, from: { px: 10, py: 20 }, done: false })
    w.combo = null; w.move = null
    hydrateHero(h, JSON.parse(JSON.stringify(heroSnap(w))))
    assert.equal(h.combo, null); assert.equal(h.move, null)
  })
```

`test/net-sim.test.js` (`describe('NET constants')`): `assert.equal(NET.protocolVersion, 3)` → `assert.equal(NET.protocolVersion, 4)`.

`test/net-ui.test.js`: in `'netViewOf builds a render view: …'`, after its last assertion add

```js
    assert.deepEqual(view.fireZones, [])
    const burning = netViewOf({ ...v, fireZones: [{ tiles: [{ x: 1, y: 1 }], age: 0.2 }] }, { bgColor: '#000' }, [[{}]])
    assert.deepEqual(burning.fireZones, [{ tiles: [{ x: 1, y: 1 }], age: 0.2 }])
```

Append at the end of `test/net-client.test.js`:

```js

describe('fire zones on the wire (protocol v4)', () => {
  it("sessionView hands on the newest snapshot's fire zones", () => {
    const s = open(); welcome(s)
    const hero = lone()
    s.ws.onmessage({ data: JSON.stringify(snapBody(hero, { fireZones: [{ tiles: [{ x: 2, y: 3 }], age: 1 }] })) })
    assert.deepEqual(sessionView(s, 0).fireZones, [{ tiles: [{ x: 2, y: 3 }], age: 1 }])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/net-protocol.test.js test/net-sim.test.js test/net-client.test.js test/net-ui.test.js 2>&1 | grep -E "^# (pass|fail)|    not ok"`
Expected: FAIL — the version (3), `fireZones` missing from the snapshot, the view and the session view, and the projectile's `trail`.

- [ ] **Step 3: Implement**

`renderer/data/net.js`: replace `  protocolVersion: 3,` with

```js
  protocolVersion: 4,      // 2a: combo/move on heroes, fire zones on snapshots
```

`renderer/net/protocol.js`: replace the header's first two lines

```js
// PvP protocol v3 (v1 in 2026-09-25-pvp-server-netcode-design.md §1; v2 adds hello.quick, 4a spec §1;
// v3 adds the arena id on welcome and snap, seat tokens, hello.resume and bye, 4b spec §1-§2): message
```

with

```js
// PvP protocol v4 (v1 in 2026-09-25-pvp-server-netcode-design.md §1; v2 adds hello.quick, 4a spec §1;
// v3 adds the arena id on welcome and snap, seat tokens, hello.resume and bye, 4b spec §1-§2; v4 adds
// a hero's combo and move and the snapshot's fire zones, 2a spec §5): message
```

In `snapshotBody`, replace

```js
    projectiles: match.projectiles.map(p => ({ px: p.px, py: p.py, dx: p.dx, dy: p.dy, shape: p.shape, color: p.color })),
```

with

```js
    projectiles: match.projectiles.map(p => ({ px: p.px, py: p.py, dx: p.dx, dy: p.dy, shape: p.shape, color: p.color,
      ...(p.trail && { trail: true }) })),
```

and directly after `    shockwaves: match.shockwaves.map(s => ({ ...s })),` add

```js
    fireZones: match.fireZones.map(z => ({ tiles: z.tiles.map(t => ({ x: t.x, y: t.y })), age: z.age })),
```

`renderer/net/client.js` (`sessionView`'s return): directly after the line `    lightning: last.lightning, strikes: last.strikes, arcs: last.arcs, shockwaves: last.shockwaves, pickups: last.pickups,` add

```js
    fireZones: last.fireZones ?? [],
```

`renderer/net/view.js` (`netViewOf`): replace `    arcs: v.arcs, shockwaves: v.shockwaves, zones: [], fireZones: [],` with

```js
    arcs: v.arcs, shockwaves: v.shockwaves, zones: [], fireZones: v.fireZones ?? [],
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/net-protocol.test.js test/net-sim.test.js test/net-client.test.js test/net-ui.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: PASS.

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0` (the real-socket tests all speak `NET.protocolVersion`, so they move to v4 together).

- [ ] **Step 5: Commit**

```bash
git add renderer/data/net.js renderer/net/protocol.js renderer/net/client.js renderer/net/view.js test/net-protocol.test.js test/net-sim.test.js test/net-client.test.js test/net-ui.test.js
git commit -m "feat(net): protocol v4 — combo/move on heroes, fire zones and arrow trails on snapshots, into the view

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---
### Task 9: Bots use the signature moves

**Files:**
- Modify: `renderer/data/pvp.js` (`BOTS`), `renderer/pvp/bots.js`
- Modify: `test/pvp-bots.test.js`

**Interfaces:**
- Consumes: `hero.combo` and the combo rules (Tasks 2–4), `canDrawDouble` and `hero.charging.kind === 'double'` (Task 5), `LIGHTNING.dists`, `GUST_CHARGE`.
- Produces:
  - `BOTS.lungeMin` 2, `lungeMax` 3, `whirlRange` 1.5, `whirlFoes` 2, `doubleMin` 5;
  - `bots.js`: `lightningTier(d: number) → 'tap' | 'full' | 'over'` (exported for its test); `botInput` unchanged in signature.

- [ ] **Step 1: Write the failing tests**

In `test/pvp-bots.test.js`:
- Replace `import { botInput, nextStep } from '../renderer/pvp/bots.js'` and `import { makeMatch } from '../renderer/pvp/sim.js'` with

```js
import { botInput, nextStep, lightningTier } from '../renderer/pvp/bots.js'
import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'
import { DOUBLE_SHOT } from '../renderer/data/pvp.js'
import { GUST_CHARGE } from '../renderer/systems/magic.js'
```

- In `'an archer aligned with a foe in the open shoots along the line'`, replace `placeHero(m.heroes[1], { x: 8, y: 2 })` with `placeHero(m.heroes[1], { x: 6, y: 2 })   // 4 tiles: inside the double shot's 5`.
- Append:

```js

describe('bots use the signature moves (2a)', () => {
  // Bot `id` plays against foes that stand still; returns every tick's value
  // of `watch(bot)`.
  const run = (m, id, ticks, watch) => {
    const bot = m.heroes.find(h => h.id === id)
    const seen = []
    for (let i = 0; i < ticks; i++) {
      stepMatch(m, { [id]: botInput(m, bot) }, 1 / 30)
      seen.push(watch(bot))
    }
    return seen
  }
  const setup = (cls, botCell, foes) => {
    const m = makeMatch({ roster: roster(cls, ...foes.map(f => f.cls)) })
    placeHero(m.heroes[0], botCell)
    foes.forEach((f, i) => { placeHero(m.heroes[i + 1], f.cell); if (f.facing) m.heroes[i + 1].facing = f.facing })
    for (const h of m.heroes) h.spawnProtect = 0
    return m
  }
  it('a warrior lunges at a foe lined up 2-3 tiles away', () => {
    const m = setup('warrior', { x: 10, y: 2 }, [{ cls: 'archer', cell: { x: 13, y: 2 } }])
    const kinds = run(m, 'b0', 20, h => h.move?.kind ?? null)
    assert.ok(kinds.includes('lunge'), kinds.join(','))
    assert.equal(m.heroes[1].hp, m.heroes[1].maxHp - 3)
  })
  it('a warrior with a full tank whirls between two close foes', () => {
    const m = setup('warrior', { x: 10, y: 2 }, [{ cls: 'archer', cell: { x: 11, y: 2 } }, { cls: 'archer', cell: { x: 9, y: 2 } }])
    const kinds = run(m, 'b0', 20, h => h.move?.kind ?? null)
    assert.ok(kinds.includes('whirl'), kinds.join(','))
    assert.ok(m.heroes[1].hp < m.heroes[1].maxHp && m.heroes[2].hp < m.heroes[2].maxHp)
  })
  it('an archer draws the double shot to full at a lined-up foe 5+ tiles off that is not closing', () => {
    const m = setup('archer', { x: 2, y: 2 }, [{ cls: 'warrior', cell: { x: 9, y: 2 }, facing: 'east' }])
    const draws = run(m, 'b0', 45, h => h.charging?.kind === 'double' ? h.charging.t : null)
    assert.ok(draws.some(t => t === DOUBLE_SHOT.full), 'drew to full')
    const shots = m.projectiles.filter(p => p.owner === 'b0')
    assert.equal(shots.length, 2)
    assert.ok(shots.every(p => p.damage === 5))
  })
  it('an archer streams at a foe walking toward it', () => {
    const m = setup('archer', { x: 2, y: 2 }, [{ cls: 'warrior', cell: { x: 9, y: 2 }, facing: 'west' }])
    const inp = botInput(m, m.heroes[0])
    assert.equal(inp.alt, false); assert.equal(inp.attack, true)
  })
  it('lightningTier: the tier whose strike lands nearest the foe, ties to the cheaper', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(lightningTier), ['tap', 'tap', 'tap', 'over', 'full', 'full', 'full', 'over', 'over'])
  })
  it('a mage charges to the full tier for a foe 6 tiles off, then lets go', () => {
    const m = setup('mage', { x: 2, y: 2 }, [{ cls: 'archer', cell: { x: 8, y: 2 } }])
    const held = run(m, 'b0', 25, h => h.charging?.t ?? null)
    const peak = Math.max(...held.filter(t => t !== null))
    assert.ok(peak >= GUST_CHARGE.full - 1e-9 && peak < GUST_CHARGE.over, `peak ${peak}`)
    assert.ok(m.lightning.length + m.strikes.length > 0 || m.heroes[1].hp < m.heroes[1].maxHp)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/pvp-bots.test.js 2>&1 | grep -E "^# (pass|fail)|    not ok"`
Expected: FAIL — `lightningTier` is not exported (the module fails to load).

- [ ] **Step 3: The bot numbers**

In `renderer/data/pvp.js`, replace the last line of `BOTS`

```js
  hurt: 0.4,         // hp fraction — below this, a bot breaks off to head for a flask
}
```

with

```js
  hurt: 0.4,         // hp fraction — below this, a bot breaks off to head for a flask
  // 2a signature moves
  lungeMin: 2,       // tiles — a warrior bot lunges at a foe lined up this far…
  lungeMax: 3,       // …to this far
  whirlRange: 1.5,   // tiles — foes this close count toward a whirlwind…
  whirlFoes: 2,      // …and it whirls (with a full tank) at this many
  doubleMin: 5,      // tiles — an archer bot draws the double shot at a lined-up foe this far or further
}
```

- [ ] **Step 4: The bots (`renderer/pvp/bots.js`)**

Replace the import block from `import { foesOf } from './combat.js'` through `import { BOTS } from '../data/pvp.js'` with:

```js
import { foesOf } from './combat.js'
import { NEUTRAL_INPUT } from './hero.js'
import { isComboWeapon } from './combos.js'
import { canDrawDouble } from './attacks.js'
import { GUST_CHARGE } from '../systems/magic.js'
import { LIGHTNING } from '../systems/spells/lightning.js'
import { STAMINA_MAX } from '../systems/stamina.js'
import { TILE_SIZE } from '../systems/movement.js'
import { BOTS, WARRIOR_COMBOS, DOUBLE_SHOT } from '../data/pvp.js'
```

Insert directly above `function incoming(match, hero) {`:

```js
const SECTOR_MOVE = { n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } }
const FACING_SECTOR = { north: 'n', east: 'e', south: 's', west: 'w' }
const CLOCKWISE = { n: 'e', e: 's', s: 'w', w: 'n' }
const aligned = (a, b) => Math.abs(a.px - b.px) < BOTS.alignSlack || Math.abs(a.py - b.py) < BOTS.alignSlack
const inLine = (match, a, b) => aligned(a, b) && hasLineOfSight(match.map, a.y, a.x, b.y, b.x)

// What a warrior bot wants to enter with the attack held (spec 2a §5): a
// whirlwind with two foes close and a full tank, a lunge at a foe lined up
// 2-3 tiles off, a tap (no moves) at a foe in reach; null when out of range.
// `tank` is the stamina it had at the press (moves already paid added back).
function warriorPlan(match, hero, foe, d, tank) {
  const close = foesOf(match, hero).filter(f => tileDist(hero, f) <= BOTS.whirlRange).length
  if (close >= BOTS.whirlFoes && tank >= STAMINA_MAX) {
    const plan = [FACING_SECTOR[hero.facing] ?? 'n']
    while (plan.length < 4) plan.push(CLOCKWISE[plan.at(-1)])
    return plan
  }
  if (d >= BOTS.lungeMin && d <= BOTS.lungeMax && inLine(match, hero, foe) && tank >= 2 * WARRIOR_COMBOS.moveCost) {
    const s = FACING_SECTOR[faceToward(hero, foe)]
    return [s, s]
  }
  return d <= BOTS.meleeRange ? [] : null
}

// One tick of entering `plan`: press standing still (so the hold does not
// slide), then each move in turn — neutral first when the next move repeats
// the sector last seen — and let go once the plan is in (or it no longer
// matches what was entered: that releases a plain swing).
function enterPlan(hero, plan, input) {
  input.move = { x: 0, y: 0 }
  if (!hero.combo) { input.attack = true; return }
  const moves = hero.combo.moves
  if (moves.length >= plan.length || moves.some((m, i) => m !== plan[i])) { input.attack = false; return }
  const next = plan[moves.length]
  input.attack = true
  if (hero.combo.last !== next) input.move = { ...SECTOR_MOVE[next] }
}

// The Call Lightning tier whose strike distance best matches `d` tiles:
// the tap's 3, the full charge's 6, the overcharge's line of 4, 6 and 8;
// ties go to the cheaper tier.
export function lightningTier(d) {
  let best = 'tap', bestErr = Infinity
  for (const tier of ['tap', 'full', 'over']) {
    const err = Math.min(...LIGHTNING.dists[tier].map(x => Math.abs(d - x)))
    if (err < bestErr) { best = tier; bestErr = err }
  }
  return best
}
const TIER_HOLD = { tap: 0, full: GUST_CHARGE.full, over: GUST_CHARGE.over }

```

In `botInput`, replace the warrior block (as Task 3 left it)

```js
  if (hero.cls === 'warrior') {
    const shot = incoming(match, hero)
    if (shot) { input.alt = true; input.facing = faceToward(hero, shot); return input }
    // The sword swings on the release (2a): press on one tick, let go the next.
    if (d <= BOTS.meleeRange) { input.facing = faceToward(hero, foe); input.attack = !hero.combo; return input }
    steer(match, hero, foe, input)
    return input
  }
```

with

```js
  if (hero.cls === 'warrior') {
    const shot = incoming(match, hero)
    if (shot && !hero.combo) { input.alt = true; input.facing = faceToward(hero, shot); return input }
    if (!isComboWeapon(hero.weapon?.weaponType)) {        // the rune's hammer: hold, and it swings itself
      if (d <= BOTS.meleeRange) { input.facing = faceToward(hero, foe); input.attack = true; return input }
      steer(match, hero, foe, input)
      return input
    }
    const tank = (hero.stamina ?? 0) + WARRIOR_COMBOS.moveCost * (hero.combo?.moves.length ?? 0)
    const plan = warriorPlan(match, hero, foe, d, tank)
    if (hero.combo || plan) {
      input.facing = faceToward(hero, foe)
      enterPlan(hero, plan ?? [], input)
      return input
    }
    steer(match, hero, foe, input)
    return input
  }
```

Replace the aligned-shot block

```js
  const aligned = Math.abs(hero.px - foe.px) < BOTS.alignSlack || Math.abs(hero.py - foe.py) < BOTS.alignSlack
  if (aligned && d <= BOTS.shootRange && hasLineOfSight(match.map, hero.y, hero.x, foe.y, foe.x)) {
    input.facing = faceToward(hero, foe)
    // A mage releases once the charge reaches the full tier; an archer streams.
    input.attack = hero.cls === 'mage' ? !(hero.charging?.t >= GUST_CHARGE.full) : true
    if (d < BOTS.keepAway - 1) input.move = { x: 0, y: 0 }
    return input
  }
```

with

```js
  // An archer mid-draw holds Q to the full draw, then lets go.
  if (hero.charging?.kind === 'double') {
    input.facing = faceToward(hero, foe)
    input.alt = hero.charging.t < DOUBLE_SHOT.full
    return input
  }
  if (inLine(match, hero, foe) && d <= BOTS.shootRange) {
    input.facing = faceToward(hero, foe)
    if (d < BOTS.keepAway - 1) input.move = { x: 0, y: 0 }
    if (hero.cls === 'mage') {
      // The Storm Wand: charge to the tier that strikes nearest the foe.
      // Any other wand (the rune's fireball) releases at the full tier.
      const hold = hero.wand?.weaponType === 'stormwand' ? TIER_HOLD[lightningTier(d)] : GUST_CHARGE.full
      input.attack = !(hero.charging && hero.charging.t >= hold)
      return input
    }
    // A foe far off and not closing (a hero walks the way it faces) gets the
    // double shot; otherwise the archer streams.
    const closing = foe.facing === faceToward(foe, hero)
    if (d >= BOTS.doubleMin && !closing && canDrawDouble(hero)) { input.alt = true; return input }
    input.attack = true
    return input
  }
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/pvp-bots.test.js test/pvp-soak.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: PASS (the soak's six bots play a full match through lunges, whirlwinds, double shots and lightning without breaking an invariant).

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add renderer/data/pvp.js renderer/pvp/bots.js test/pvp-bots.test.js
git commit -m "feat(pvp): bots lunge, whirl, draw the double shot and pick the lightning tier by distance

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---
### Task 10: The visuals, the class hints, the live check and the docs

**Files:**
- Create: `renderer/render/pvp-fx.js`, `test/pvp-fx.test.js`
- Modify: `renderer/render/canvas.js` (two calls and an import), `renderer/game.js` (the whirl's screen shake), `renderer/ui/menu.js` (button hints), `renderer/index.html` (`.menu-hint`)
- Modify: `test/menu.test.js`
- Scratch (not committed): `/tmp/claude-1000/-home-lappemikb-projects-dungeon-crawler/170eab54-57f1-4834-98b0-cda083c36a9c/scratchpad/live-2a.mjs`, run from a git-ignored copy `debug-2a-live.mjs` in the repo root (`debug*.mjs` is in `.gitignore`)
- Modify (not committed): `/home/lappemikb/CLAUDE.md`

**Interfaces:**
- Consumes: `hero.combo`, `hero.move` (Tasks 3–4), `hero.charging.kind === 'double'` and `trail` projectiles (Task 5), `fireZones` in the view (Task 8), `CLASS_HINTS` (Task 1).
- Produces:
  - `pvp-fx.js`: pure `comboShake(hero) → px`, `holdArrows(combo) → { dir, angle, dx }[]`, `fenceGlints(move) → { i, alpha }[]`, `drawGlow(hero) → { color, frac, full } | null`; draw calls `drawComboFx(ctx, hero, camX, camY)` (every hero, from `drawHero`) and `drawArrowTrail(ctx, p, bpx, bpy)`;
  - `renderScreen` buttons accept `hint` (a `span.menu-hint` inside the button); `showClassPicker` passes `CLASS_HINTS`.

`game.js` has no unit tests: it is checked with `node --check` plus the time-boxed live run in Step 6.

- [ ] **Step 1: Write the failing tests**

Create `test/pvp-fx.test.js`:

```js
// PvP 2a's visuals: the pure helpers in renderer/render/pvp-fx.js.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { comboShake, holdArrows, fenceGlints, drawGlow } from '../renderer/render/pvp-fx.js'
import { WARRIOR_COMBOS, DOUBLE_SHOT } from '../renderer/data/pvp.js'

describe('pvp fx helpers', () => {
  it('comboShake: only a whirl shakes, fading over its life', () => {
    assert.equal(comboShake({ move: null }), 0)
    assert.equal(comboShake({ move: { kind: 'lunge', t: 0 } }), 0)
    assert.equal(comboShake({ move: { kind: 'whirl', t: 0 } }), 5)
    assert.equal(comboShake({ move: { kind: 'whirl', t: WARRIOR_COMBOS.fxDur } }), 0)
    assert.equal(comboShake(null), 0)
  })
  it('holdArrows: one per move, centred over the head', () => {
    assert.deepEqual(holdArrows({ moves: [] }), [])
    const a = holdArrows({ moves: ['e', 'w'] })
    assert.deepEqual(a.map(x => [x.dir, x.dx]), [['e', -4], ['w', 4]])
    assert.equal(a[1].angle, Math.PI)
  })
  it('fenceGlints: each thrust glints for 0.12 s from its time', () => {
    assert.deepEqual(fenceGlints({ kind: 'fence', t: 0 }).map(g => g.i), [0])
    assert.deepEqual(fenceGlints({ kind: 'fence', t: 0.13 }).map(g => g.i), [1])
    assert.deepEqual(fenceGlints({ kind: 'fence', t: 0.25 }).map(g => g.i), [2])
    assert.deepEqual(fenceGlints({ kind: 'lunge', t: 0 }), [])
  })
  it('drawGlow: the band colour of the draw reached, dim below 30 %', () => {
    assert.equal(drawGlow({ charging: null }), null)
    assert.equal(drawGlow({ charging: { t: 0.1, kind: 'double' } }).color, 'rgba(255,255,255,0.35)')
    const full = drawGlow({ charging: { t: DOUBLE_SHOT.full, kind: 'double' } })
    assert.equal(full.color, DOUBLE_SHOT.bands[0].color)
    assert.equal(full.full, true)
  })
})
```

Append at the end of `test/menu.test.js`:

```js

describe('class picker hints (2a)', () => {
  it("each class button carries its signature move's hint", () => {
    const overlay = stubDom()
    try {
      showClassPicker({ onPick: () => {} })
      const hints = buttonsOf(overlay).map(b => [b.textContent, b.children[0]?.className, b.children[0]?.textContent])
      assert.deepEqual(hints, [
        ['Warrior', 'menu-hint', 'Hold attack + stick: combos'],
        ['Archer', 'menu-hint', 'Hold Q: double shot'],
        ['Mage', 'menu-hint', 'Storm Wand · Q: blink'],
      ])
    } finally {
      delete globalThis.document
      delete globalThis.window
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/pvp-fx.test.js test/menu.test.js 2>&1 | grep -E "^# (pass|fail)|    not ok"`
Expected: FAIL — `pvp-fx.js` does not exist, and the class buttons have no hint child.

- [ ] **Step 3: The visuals**

Create `renderer/render/pvp-fx.js`:

```js
// PvP 2a's signature-move visuals, drawn from snapshot state alone (a
// hero's combo, move and charging), so the local match and an online view
// draw the same thing: the Warrior's hold (move arrows and a pulsing ring),
// the lunge's streak, the fence's glints, the whirlwind's ring and sparks,
// and the Archer's draw glow. The pure helpers up top are node-tested; the
// draw calls below them only touch the canvas they are handed.
import { FACING_ANGLE } from '../systems/entities.js'
import { WARRIOR_COMBOS, drawFrac, doubleShotBand } from '../data/pvp.js'

const SECTOR_ANGLE = { e: 0, s: Math.PI / 2, w: Math.PI, n: -Math.PI / 2 }
const SECTOR_FACING = { n: 'north', e: 'east', s: 'south', w: 'west' }
// The hold ring's colour by moves entered: white, gold, orange, red, crimson.
const HOLD_COLORS = ['#e6e8e3', '#facc15', '#f59e0b', '#ef4444', '#dc2626']

// The local hero's screen shake: a short one while its own whirlwind spins.
export function comboShake(hero) {
  const mv = hero?.move
  if (mv?.kind !== 'whirl') return 0
  return 5 * Math.max(0, 1 - mv.t / WARRIOR_COMBOS.fxDur)
}

// The hold's arrows above the head: one per move, centred, 8 px apart.
export function holdArrows(combo) {
  const n = combo?.moves?.length ?? 0
  return (combo?.moves ?? []).map((dir, i) => ({ dir, angle: SECTOR_ANGLE[dir], dx: (i - (n - 1) / 2) * 8 }))
}

// The fence thrusts fired by now, each with its fade (1 fresh → 0 gone after 0.12 s).
export function fenceGlints(move) {
  if (move?.kind !== 'fence') return []
  return WARRIOR_COMBOS.fence.times
    .map((at, i) => ({ i, age: move.t - at }))
    .filter(g => g.age >= -1e-9 && g.age < 0.12)
    .map(g => ({ i: g.i, alpha: 1 - Math.max(0, g.age) / 0.12 }))
}

// The draw glow's colour: the band the draw has reached, dim white below it.
export function drawGlow(hero) {
  if (hero?.charging?.kind !== 'double') return null
  const frac = drawFrac(hero.charging.t)
  const band = doubleShotBand(frac)
  return { color: band?.color ?? 'rgba(255,255,255,0.35)', frac, full: frac >= 1 - 1e-9 }
}

// --- drawing -----------------------------------------------------------

export function drawComboFx(ctx, hero, camX, camY) {
  const cx = hero.px - camX, cy = hero.py - camY
  if (hero.combo) drawHold(ctx, hero.combo, cx, cy)
  const mv = hero.move
  if (mv?.kind === 'lunge') drawLunge(ctx, mv, cx, cy, camX, camY)
  else if (mv?.kind === 'fence') drawFence(ctx, mv, cx, cy)
  else if (mv?.kind === 'whirl') drawWhirl(ctx, mv, cx, cy)
  const glow = drawGlow(hero)
  if (glow) drawBowGlow(ctx, hero, glow, cx, cy)
}

function drawHold(ctx, combo, cx, cy) {
  const n = combo.moves.length
  ctx.save()
  // The ring swells a step with each move and breathes while held.
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.012)
  ctx.strokeStyle = HOLD_COLORS[Math.min(n, HOLD_COLORS.length - 1)]
  ctx.lineWidth = 2 + n * 0.5
  ctx.globalAlpha = 0.45 + 0.35 * pulse
  ctx.beginPath(); ctx.arc(cx, cy, 15 + n * 2 + pulse * 1.5, 0, Math.PI * 2); ctx.stroke()
  // One small arrow per move, above the head.
  ctx.globalAlpha = 0.95
  ctx.fillStyle = '#f8fafc'
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = 1
  for (const a of holdArrows(combo)) {
    ctx.save()
    ctx.translate(cx + a.dx, cy - 26)
    ctx.rotate(a.angle)
    ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(-3, -3.5); ctx.lineTo(-3, 3.5); ctx.closePath()
    ctx.fill(); ctx.stroke()
    ctx.restore()
  }
  ctx.restore()
}

// A bright blade-trail from where the dash began to where the hero is.
function drawLunge(ctx, mv, cx, cy, camX, camY) {
  const fx = mv.from.px - camX, fy = mv.from.py - camY
  const fade = Math.max(0, 1 - mv.t / WARRIOR_COMBOS.fxDur)
  if (Math.hypot(cx - fx, cy - fy) < 1) return
  ctx.save()
  const g = ctx.createLinearGradient(fx, fy, cx, cy)
  g.addColorStop(0, 'rgba(186,230,253,0)')
  g.addColorStop(1, `rgba(255,255,255,${(0.9 * fade).toFixed(3)})`)
  ctx.strokeStyle = g
  ctx.lineCap = 'round'
  ctx.lineWidth = 8
  ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(cx, cy); ctx.stroke()
  ctx.strokeStyle = `rgba(125,211,252,${(0.8 * fade).toFixed(3)})`
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(cx, cy); ctx.stroke()
  ctx.restore()
}

// Three zig-zag steel glints, one per thrust, ahead along the fence's line.
function drawFence(ctx, mv, cx, cy) {
  const a = FACING_ANGLE[SECTOR_FACING[mv.dir]] ?? 0
  const reach = WARRIOR_COMBOS.fence.reach
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(a)
  ctx.lineJoin = 'miter'
  for (const g of fenceGlints(mv)) {
    const side = g.i % 2 === 0 ? 1 : -1               // alternate high and low
    ctx.globalAlpha = g.alpha
    ctx.strokeStyle = '#f1f5f9'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(14, 0)
    ctx.lineTo(22, -5 * side); ctx.lineTo(30, 5 * side); ctx.lineTo(reach, 0)
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(reach, 0, 2.5, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

// A spinning ring of steel at the whirlwind's reach, sparks flying off it.
function drawWhirl(ctx, mv, cx, cy) {
  const k = Math.min(1, mv.t / WARRIOR_COMBOS.fxDur)
  const r = WARRIOR_COMBOS.whirl.reach
  const spin = k * Math.PI * 4
  ctx.save()
  ctx.globalAlpha = 1 - k
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 4
  for (let i = 0; i < 4; i++) {                       // four blades of steel chasing round
    const a0 = spin + i * Math.PI / 2
    ctx.beginPath(); ctx.arc(cx, cy, r * (0.7 + 0.3 * k), a0, a0 + Math.PI / 3); ctx.stroke()
  }
  ctx.fillStyle = '#fde68a'
  for (let i = 0; i < 10; i++) {                      // sparks thrown outward
    const a = i * 2.39996 + spin * 0.5
    const d = r * (0.8 + k * 0.9)
    ctx.fillRect(cx + Math.cos(a) * d - 1, cy + Math.sin(a) * d - 1, 2, 2)
  }
  ctx.restore()
}

// A glow on the bow side, stepping through the bands; a steady ring at full.
function drawBowGlow(ctx, hero, glow, cx, cy) {
  const a = FACING_ANGLE[hero.facing] ?? 0
  const bx = cx + Math.cos(a) * 12, by = cy + Math.sin(a) * 12
  ctx.save()
  ctx.globalAlpha = 0.35 + 0.5 * glow.frac
  ctx.fillStyle = glow.color
  ctx.beginPath(); ctx.arc(bx, by, 3 + 5 * glow.frac, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = glow.color
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(cx, cy, 15, -Math.PI / 2, -Math.PI / 2 + glow.frac * Math.PI * 2); ctx.stroke()
  if (glow.full) {
    ctx.globalAlpha = 0.3 + 0.3 * Math.sin(Date.now() * 0.02)
    ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2); ctx.stroke()
  }
  ctx.restore()
}

// A double-shot arrow's tail, in its band's colour.
export function drawArrowTrail(ctx, p, bpx, bpy) {
  const len = Math.hypot(p.dx, p.dy) || 1
  ctx.save()
  ctx.globalAlpha = 0.55
  ctx.strokeStyle = p.color ?? '#ffffff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(bpx - (p.dx / len) * 12, bpy - (p.dy / len) * 12)
  ctx.lineTo(bpx, bpy)
  ctx.stroke()
  ctx.restore()
}
```

In `renderer/render/canvas.js`:
- Below `import { makeTileLayer, makeDirectTileLayer } from './tile-layer.js'` add `import { drawComboFx, drawArrowTrail } from './pvp-fx.js'`.
- In `drawHero`, directly after `  drawChargeRing(ctx, hero, camX, camY)` add `  drawComboFx(ctx, hero, camX, camY)`.
- In the projectile loop, replace

```js
      if (p.shape === 'arrow') {
        if (flat)
```

with

```js
      if (p.shape === 'arrow') {
        if (p.trail) drawArrowTrail(ctx, p, bpx, bpy)   // a double shot's band-tinted tail
        if (flat)
```

(The fire patch needs no new drawing: `canvas.js` already draws `state.fireZones`, and Task 8 fills them online.)

In `renderer/game.js`:
- Below `import { PVP_ARENAS, nextArenaIndex } from './data/pvp-arenas.js'` add `import { comboShake } from './render/pvp-fx.js'`.
- In both `pvpFrame` and `netFrame`, replace `  renderer.updateCamera(view.player, 0, null)` with `  renderer.updateCamera(view.player, comboShake(view.player), null)` (two places; the shake is the local hero's own whirlwind only).

- [ ] **Step 4: The class hints**

In `renderer/ui/menu.js`:
- Below `import { CHEAT_HOLD_MS, cheatStep } from '../systems/cheats.js'` add `import { CLASS_HINTS } from '../data/pvp.js'`.
- In `renderScreen`, replace

```js
  currentButtons = buttons.map(({ label, onSelect, className }) => {
    const btn = document.createElement('button')
    btn.className = className ? `menu-btn ${className}` : 'menu-btn'
    btn.textContent = label
```

with

```js
  currentButtons = buttons.map(({ label, onSelect, className, hint }) => {
    const btn = document.createElement('button')
    btn.className = className ? `menu-btn ${className}` : 'menu-btn'
    btn.textContent = label
    // A second, smaller line inside the button (the class picker's hints).
    if (hint) {
      const small = document.createElement('span')
      small.className = 'menu-hint'
      small.textContent = hint
      btn.appendChild(small)
    }
```

- In `showClassPicker`, replace the three class buttons with

```js
      { label: 'Warrior', hint: CLASS_HINTS.warrior, onSelect: () => onPick('warrior') },
      { label: 'Archer', hint: CLASS_HINTS.archer, onSelect: () => onPick('archer') },
      { label: 'Mage', hint: CLASS_HINTS.mage, onSelect: () => onPick('mage') },
```

In `renderer/index.html`, directly after the `.menu-btn.done { … }` rule add

```css
    .menu-hint { display: block; font-size: 12px; color: #9a9aa6; margin-top: 3px; }
```

- [ ] **Step 5: Run the tests and check the page scripts**

Run: `node --test test/pvp-fx.test.js test/menu.test.js test/pvp-render.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: PASS.

Run: `node --check renderer/game.js && node --check renderer/render/canvas.js && node --check renderer/render/pvp-fx.js && echo ok`
Expected: `ok`.

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0`.

- [ ] **Step 6: The live check (time-boxed, about 2 minutes)**

The script runs the web server **in-process** on port 8093 with a 10-minute match. Aino (the page) quick-joins as a Warrior. The script stages every shot server-side: it places Aino and the bots, freezes the bots with a long stun, protects Aino, and switches her class with `applyKit`. The page enters each move on the real keyboard. Write it in the scratchpad as `live-2a.mjs`:

```js
// Local 2a checks, online through an in-process server so the script can
// place and freeze heroes: the Warrior's lunge, fence and whirlwind entered
// on the keyboard, the Archer's double-shot draw and release, the Mage's
// lightning and the fireball rune's fire patch. Run from the repo root:
//   node debug-2a-live.mjs <outdir>
import http from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { attachPvp } from './server/pvp-server.js'
import { makeStaticHandler } from './server/static.js'
import { applyKit, placeHero } from './renderer/pvp/hero.js'
import { grantRune } from './renderer/pvp/pickups.js'

const out = process.argv[2]
const server = http.createServer(makeStaticHandler(path.resolve('renderer')))
const pvp = attachPvp(server, { matchLength: 600 })
await new Promise(r => server.listen(8093, '127.0.0.1', r))
const BASE = 'http://127.0.0.1:8093'
const errors = []
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(fn, ms = 15000) {
  const end = Date.now() + ms
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await sleep(50) }
}
const room = () => [...pvp.lobby.rooms.values()][0]
const me = () => room()?.match.heroes.find(h => h.name === 'Aino')
const bots = () => room().match.heroes.filter(h => h.name !== 'Aino')
// Bots stand where they are put: stunned for good, never protected.
const freeze = () => { for (const b of bots()) { b.dead = false; b.respawnT = 0; b.stunTimer = 1e9; b.spawnProtect = 0; b.hp = b.maxHp } }
const stage = (at, foes) => {
  const m = me()
  m.spawnProtect = 1e9; m.hp = m.maxHp; m.stamina = 100; m.meleeCooldown = 0; m.rangedCooldown = 0; m.magicCooldown = 0
  placeHero(m, at)
  bots().forEach((b, i) => placeHero(b, foes[i] ?? { x: 29, y: 21 - i }))
  freeze()
}
const browser = await chromium.launch()
const p = await browser.newPage({ viewport: { width: 1280, height: 720 } })
p.on('pageerror', e => errors.push(e.message))
await p.goto(BASE); await p.waitForSelector('.menu-btn')
await p.click('.menu-btn:has-text("Online")')
await p.click('.menu-btn:has-text("Quick match")')
await p.fill('.menu-input', 'Aino'); await p.keyboard.press('Enter')
const hints = await p.locator('.menu-hint').allTextContents()
await p.screenshot({ path: `${out}/picker.png` })
await p.click('.menu-btn:has-text("Warrior")')
await until(() => me() && bots().length >= 3)
await until(async () => await p.locator('#menu-overlay').isHidden())
const key = async (k, ms = 70) => { await p.keyboard.down(k); await sleep(ms); await p.keyboard.up(k); await sleep(70) }
const gesture = async (keys, shotAt) => {
  await p.keyboard.down(' '); await sleep(100)
  for (const k of keys) await key(k)
  await p.keyboard.up(' ')
  await sleep(shotAt)
}
const result = {}

// 1. Lunge: a frozen bot 3 tiles east.
stage({ x: 3, y: 8 }, [{ x: 6, y: 8 }]); await sleep(400)
let hp0 = bots()[0].hp
await gesture(['d', 'd'], 200)
await p.screenshot({ path: `${out}/lunge.png` })
await sleep(300)
result.lunge = { dealt: hp0 - bots()[0].hp, heroX: me().x }

// 2. Fence: a bot one tile east.
stage({ x: 3, y: 8 }, [{ x: 4, y: 8 }]); await sleep(500)
hp0 = bots()[0].hp
await gesture(['d', 'a'], 150)
await p.screenshot({ path: `${out}/fence.png` })
await sleep(300)
result.fence = { dealt: hp0 - bots()[0].hp }

// 3. Whirlwind: bots east, west and north.
stage({ x: 10, y: 2 }, [{ x: 11, y: 2 }, { x: 9, y: 2 }, { x: 10, y: 1 }]); await sleep(500)
const before = bots().map(b => b.hp)
await p.keyboard.down(' '); await sleep(100)
for (const k of ['w', 'd', 's', 'a']) { await p.keyboard.down(k); await sleep(70); await p.keyboard.up(k) }
await p.keyboard.up(' '); await sleep(90)
await p.screenshot({ path: `${out}/whirl.png` })
await sleep(300)
result.whirl = { dealt: bots().map((b, i) => before[i] - b.hp) }

// 4. The double shot: the Archer draws on Q.
applyKit(me(), 'archer'); stage({ x: 3, y: 8 }, [{ x: 12, y: 8 }]); await sleep(500)
await key('d', 40)
hp0 = bots()[0].hp
await p.keyboard.down('q'); await sleep(900)
await p.screenshot({ path: `${out}/draw.png` })
await sleep(500)
await p.keyboard.up('q'); await sleep(230)
await p.screenshot({ path: `${out}/double.png` })
await sleep(1200)
result.double = { dealt: hp0 - bots()[0].hp, arrows: me().ammo.arrow }

// 5. Lightning: a tap 3 tiles ahead.
applyKit(me(), 'mage'); stage({ x: 3, y: 8 }, [{ x: 6, y: 8 }]); await sleep(500)
await key('d', 40)
hp0 = bots()[0].hp
await key(' ', 60); await sleep(200)
await p.screenshot({ path: `${out}/mark.png` })
await sleep(500)
result.lightning = { dealt: hp0 - bots()[0].hp, cooldown: me().magicCooldown }

// 6. The fireball rune: burst and patch.
stage({ x: 3, y: 8 }, [{ x: 7, y: 8 }, { x: 7, y: 9 }]); grantRune(room().match, me()); await sleep(500)
const fb = bots().map(b => b.hp)
await key(' ', 60); await sleep(700)
await p.screenshot({ path: `${out}/fireball.png` })
await sleep(1600)
result.fireball = { dealt: bots().slice(0, 2).map((b, i) => fb[i] - b.hp), zones: room().match.fireZones.length }

// 7. The local mode (the `pvp` title cheat): a Warrior gesture against the
// page's own bots, for page errors only.
const q = await browser.newPage({ viewport: { width: 1280, height: 720 } })
q.on('pageerror', e => errors.push(`local: ${e.message}`))
await q.goto(BASE); await q.waitForSelector('.menu-btn')
await q.keyboard.type('pvp'); await q.waitForSelector('.menu-btn:has-text("Warrior")')
await q.click('.menu-btn:has-text("Warrior")')
await sleep(500)
await q.keyboard.down(' '); await sleep(100)
for (const k of ['d', 'a']) { await q.keyboard.down(k); await sleep(70); await q.keyboard.up(k); await sleep(70) }
await q.keyboard.up(' '); await sleep(150)
await q.screenshot({ path: `${out}/local.png` })
result.local = await q.locator('#menu-overlay').isHidden()

console.log(JSON.stringify({ hints, ...result, errors }, null, 1))
await browser.close()
pvp.close(); server.close()
```

Run:

```bash
SP=/tmp/claude-1000/-home-lappemikb-projects-dungeon-crawler/170eab54-57f1-4834-98b0-cda083c36a9c/scratchpad
cd /home/lappemikb/projects/dungeon-crawler && mkdir -p "$SP/shots" && cp "$SP/live-2a.mjs" debug-2a-live.mjs && timeout 180 node debug-2a-live.mjs "$SP/shots"; rm -f debug-2a-live.mjs
```

Expected output:
- `hints`: the three class hints;
- `lunge`: `{ dealt: 3, heroX: 5 }` (the dash from x 3 stopped at the bot on x 6);
- `fence`: `{ dealt: 3 }`;
- `whirl`: `{ dealt: [2, 2, 2] }`;
- `double`: `{ dealt: 8, arrows: 22 }` (a full draw's two 5s, capped by the bot's 8 hp);
- `lightning`: `dealt` 3 and a `cooldown` under 1.5;
- `fireball`: `dealt` `[6, 4]` (the direct target 4 + 2 patch ticks, the neighbour 2 burst + 2 patch ticks) and `zones` 1;
- `local`: `true`;
- `errors`: `[]`.

Read the screenshots in `/tmp/claude-1000/-home-lappemikb-projects-dungeon-crawler/170eab54-57f1-4834-98b0-cda083c36a9c/scratchpad/shots`:
- `picker.png`: each class button has its hint line under the name;
- `lunge.png`: a pale blade streak from where Aino started to the bot, `-3` over it;
- `fence.png`: the sword's quick poke at the bot, `-1`;
- `whirl.png`: a ring of four steel arcs around Aino with sparks, `-2` over three bots;
- `draw.png`: the Archer with a gold glow ring on the bow side;
- `double.png`: two parallel arrows with tails, flying east;
- `mark.png`: the lightning mark three tiles ahead;
- `fireball.png`: the burning patch around the two bots;
- `local.png`: a local `pvp` match, no error overlay.

If anything fails, fix the cause (with a test where the cause lies in pure code) and re-run once. Do not extend the time box beyond that. Report to the user, without changing any number, if the lunge streak or the draw glow reads too faint: those are colour tweaks in `pvp-fx.js`.

- [ ] **Step 7: Docs (outside the repo, not committed)**

In `/home/lappemikb/CLAUDE.md`, in the dungeon-crawler `renderer/pvp/` bullet:
- change `the shared protocol v3 (`protocol.js`)` to `the shared protocol v4 (`protocol.js`)`;
- after the sentence that ends `…the death picker counts "Back in N" live via `menu.setSubtitle`.`, add:

```markdown
Sub-project 2a (spec `docs/superpowers/specs/2026-09-26-pvp-2a-class-rework-design.md`): hero hp 8 and plate protect 0 in a match; every class has a signature move, all tuned in `renderer/data/pvp.js`. The Warrior's sword is a combo weapon: holding attack slides the hero at half speed along the move held at the press, and each change of stick sector is a move costing 25 stamina (`renderer/pvp/combos.js`: `stepGesture`/`classify`, shared with the predictor). The release fires a plain swing, a Lunge (`d,d`: a 2.5-tile dash, 3 to the first foe), a Fence (`d,opposite`: three 1-damage thrusts) or a Whirlwind (four quarter turns: 2 to all within 44 px, knockback 40). The effects run as `hero.move`, stepped by `stepCombo`, and share hit groups that pass i-frames (`hurtHero({ group })`). The Archer holds Q for a 1.2 s double shot (two arrows, 1–5 damage each by draw band). The Mage mains the Storm Wand with PvP numbers via `tryCast({ override })` (`SPELL_OVERRIDES`); the rune is the Fireball Wand, whose PvP `detonate` bursts 2 into everyone but the direct target and lays a 3 s fire patch credited to the caster. Protocol v4 carries `combo`/`move`/`fireZones`; the client latches presses but not releases. Visuals are in `renderer/render/pvp-fx.js`.
```

- [ ] **Step 8: Commit**

```bash
git add renderer/render/pvp-fx.js renderer/render/canvas.js renderer/game.js renderer/ui/menu.js renderer/index.html test/pvp-fx.test.js test/menu.test.js
git commit -m "feat(pvp): 2a visuals — hold arrows and ring, lunge streak, fence glints, whirl ring and shake, draw glow, arrow trails; class hints

Co-Authored-By: <model> <noreply@anthropic.com>"
```

**After merge (controller, with the user's go-ahead — not part of any task):** fast-forward `web-release` from `main`, push both branches, and run `tools/deploy-web.sh` (see the web-release memory). Then on the public URL: quick-join as each class and try the lunge, fence, whirlwind, double shot, lightning and a fireball rune against the bots. Update the deploy memory.

---
## Self-review

- **Spec coverage.**
  - §1 time-to-kill → Task 1 (hp 8, plate 0, flasks 4, and the 4-hit TTK test).
  - §2 Warrior:
    - the hold → Task 3: press conditions, `lockDir`, the half-speed slide, the facing lock, no sprint, cancels by stun and shield;
    - the moves → Task 2: sectors, the diagonal tie, neutral needed to repeat, 25 stamina each, the refusal, at most 4 moves free after that;
    - the release and the classification → Tasks 2–3: the swing on the release, unknown patterns, the facing set from the combo;
    - the effects → Task 4: the lunge's first hit, the dash ending there, walls; the fence's three hits at 0/0.12/0.24 s; the whirlwind's reach, knockback and full-tank cost; blocks, and the whirl's 1.5 × cooldown;
    - the rune's hammer → Task 3;
    - visuals and sounds → Tasks 4 and 10.
  - §3 Archer → Task 5: the draw, `moveMul`, steering, Space ignored, the 1.2 s cap with no auto-release, the 30 % floor, the five bands, 2-or-1 arrows, the 0.8 s cooldown, both arrows landing, blocks, the crossbow rune. Visuals in Task 10.
  - §4 Mage:
    - the kit and the rune → Task 1;
    - Call Lightning's overrides → Task 6: cooldown, delay, damage, stun × `ccMul`, the tiers aiming as before, the costs unchanged, single-player byte-for-byte;
    - the fireball → Task 7: the direct 4, the burst to others only, the patch, credit, caster immunity.
  - §5:
    - protocol v4 → Tasks 3, 4 and 8;
    - prediction (slide, gesture stamina, draw, each release's cooldown, the lunge not predicted) → Tasks 3–6;
    - bots → Task 9;
    - HUD hints → Task 10.
  - Testing summary → the unit tests in each task, and the time-boxed live check in Task 10.
- **Prototyped.** The whole plan was built task by task in a scratch worktree before this document was written. Each task's new tests failed before its implementation step and passed after it, `npm test` ended at 3046/3046, and the Task 10 live script printed exactly the expected values, with a clean screenshot for every move. The test files above were extracted from this document back into the prototype and re-run green, so the code blocks are the ones that ran.
- **Placeholders:** none. Every code step carries its code. `SCRATCH`-style paths are spelled out in full.
- **Type consistency:**
  - `stepGesture`/`startGesture`/`classify`/`unitMove`/`SECTOR_FACING` (Task 2) are what `beginHold`/`holdGesture` (Task 3) and `predictCombo` use.
  - `comboCooldown` (Task 3) is used by `startCombo` (Task 4) and the predictor. `hero.move`'s fields (Task 4) are what the protocol (Task 4), `isDashing` and `pvp-fx.js` (Task 10) read.
  - `hurtHero({ group })` (Task 4) is what `looseDouble`'s projectiles use via the sim hook (Task 5). `payDoubleShot`/`canDrawDouble` (Task 5) are shared by the sim, the predictor and the bots (Task 9).
  - `SPELL_OVERRIDES` (Task 1) reaches `tryCast`/`castCost` (Task 6) and `detonateFireball` (Task 7).
  - `predictStep → { released }` and the four-argument `predictCosmetics` (Task 3) are what `client.js` calls.
- **Review Focus:** each of the five lines has its test in the owning task (Tasks 3, 4, 5 and 7).
