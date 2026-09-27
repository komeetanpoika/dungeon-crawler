# PvP 2b — Tiered Pickups and Large Arenas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contesting the map pays off: five buffs (Haste, Might, Ward and the Ember and Venom edges) in a minor and a major tier spawn at buff spots, two large arenas (Keep and Wilds) join the rotation, and bots contest the spots.

**Architecture:**
- All new numbers live in `renderer/data/pvp.js` (`BUFF_KINDS`, `EDGE_KINDS`, `BUFFS`, `DOTS`, `BUFF_SPOTS`, `BUFF_COLORS`, `PVP.largeMinHeroes`, new `BOTS` fields).
- `renderer/pvp/rng.js` gives the match a seeded PRNG (`match.rng`, mulberry32); every roll stays inside the sim.
- `renderer/pvp/buffs.js` owns a hero's `buffs` (grant, stack, tick, clear, Ward's soak). The timers tick in `moveHero`, which the predictor shares, so Haste is predicted from the snapshot.
- `hurtHero` gains `direct`: Might adds to direct hits, the target's Ward soaks through a new optional `soak` hook on `damagePlayer`, and a landed direct hit applies the attacker's edge (`renderer/pvp/dots.js`). The sim's new `tickDots` deals burns and poisons.
- Buff spots are pickups of kind `buff` (grid letters `b`/`B`), rolled from `match.rng` at the start and whenever taken. Keep and Wilds are 55×39 grids; `playableIndex` skips a large arena for fewer than 4 heroes.
- Protocol v5 carries `buffs` and `dots` on heroes and `tier`/`buff`/`next`/`t` on pickups. `renderer/render/pvp-fx.js` draws the spots, their ghosts and the hero looks; `renderer/ui/pvp-hud.js` draws the HUD buff row.

**Tech Stack:** vanilla ES modules, Node 22 (CI) / Node 20 (container), `node:test`, `ws@^8`, `playwright-core` for the live check.

**Spec:** `docs/superpowers/specs/2026-09-27-pvp-2b-pickups-arenas-design.md`. Earlier plans in the same style: `docs/superpowers/plans/2026-09-26-pvp-2a-class-rework.md`, `docs/superpowers/plans/2026-09-26-pvp-4b-arenas-reconnect.md`.

## Global Constraints

- **Numbers from the spec** (all in `renderer/data/pvp.js`):

  | What | Value |
  |---|---|
  | Haste | minor ×1.2 for 8 s; major ×1.5 for 15 s |
  | Might | minor +1 per direct hit for 8 s; major +2 for 12 s |
  | Ward | minor absorbs 2, lasts until used up or 15 s; major absorbs 4 (also 15 s) |
  | Ember | minor 10 s, burn 1/s for 2 s; major 15 s, burn 3 s + a fire patch of `emberPatchTiles` = 5 tiles, 3 s at 1/s, credited to the attacker |
  | Venom | minor 10 s, poison 1 every 1.5 s for 3 s (2) and a 20 % slow; major 15 s, 4.5 s (3) and a 35 % slow |
  | `BUFF_SPOTS` | `minorRespawn` 20 s, `majorRespawn` 45 s, `majorFirstSpawn` 30 s |
  | `PVP.largeMinHeroes` | 4 |
  | `BOTS` | `buffSeekFoe` 4, `buffSeek` 6, `majorSeek` 10 (tiles) |
  | `buildArena` clamp | 8–60 × 8–44 (only the maximum moves) |
  | `PVP_ARENA_ORDER` | `pillars, glade, keep, tunnels, ruins, wilds` |
  | Large arenas | 6 spawns, 6 `b`, 1 `B`, 4 flasks, 3 quivers, 1 rune; spawns ≥ 10 apart; `B` ≥ 8 from every spawn |
  | Small arenas | exactly 2 `b` and 0 `B` each; every `b` ≥ 4 from every spawn |
  | `NET.protocolVersion` | **5** |
  | Performance | ≤ 2 ms per 30 Hz tick on a large arena with 6 bots |
- **Single-player is untouched.** `damagePlayer`'s new `soak` parameter defaults to none, and `buildArena` builds every config inside the old 40×30 clamp byte-for-byte as before (Task 5 pins fingerprints taken before the change).
- `renderer/pvp/`, `renderer/net/` and `renderer/data/` stay DOM-free: nothing in them may reference `document`, `window`, `localStorage`, `sessionStorage` or `render/*` (the server imports them).
- **All randomness in a match comes from `match.rng`.** No `Math.random` in `renderer/pvp/` outside `rng.js`'s default argument and `local.js`'s one seed per match.
- **Lessons from 2a, binding on every task:**
  - Every bot press gates on `!hero.needRelease`, and nothing new sets `needRelease`.
  - Every new hero field (`buffs`, `burn`, `poison`) is cleared on death and by `applyKit`; the rune neither reads nor clears them.
  - Anything that changes movement (Haste, Venom's slow) flows through the shared `moveHero` from snapshot state, with a parity replay test.
  - Bots are soak-tested for stalls (Task 6: 60 s on each large arena; Task 10: 20 matches).
- **Out of scope:** a minimap, new tile types, more than 6 heroes, and any change to the flask, quiver or rune.
- **No deploy inside tasks.** The controller deploys after the merge, with the user's go-ahead.
- Commits end with a `Co-Authored-By:` trailer naming the model that wrote them.
- Run the suite with `npm test` (3067 tests before this plan, 3179 after). Three known flakes, all to be re-run rather than chased: a lone SIGSEGV from Node's test runner on WSL, `npc.test.js` "deer never moved", and the retry-wrapped 150 ms rewind test in `net-play.test.js`.

## Spec readings

These resolve the spec's ambiguities and bind every task.

1. **Direct hits are flagged by the caller.** `hurtHero(…, { direct: true })` marks a direct hit. The callers that pass it are the sword/hammer swing, the lunge, each fence thrust, the whirlwind, the projectile hook (arrows, bolts, the fireball's direct hit), the lightning strike hook and the fireball's burst. Fire-patch ticks, the hammer's shock ticks, the chain and `tickDots` do not pass it. The thunderclap deals no damage, so it never reaches `hurtHero`.
2. **Might is read when the hit lands.** An arrow or a lightning mark in flight adds the attacker's Might as it is at impact, so a Might that ran out mid-flight adds nothing.
3. **The damage order is:** i-frames → buckler block → outfit protect → Ward → hp. Might is added before all of them. A hit that the Ward soaks whole still lands: it grants i-frames (for a `'hit'`), sets `lastHitBy`, and pushes a `'hit'` event with `amount: 0`. The online client draws no float for a 0, and the local sim floats `0`.
4. **"Landed" for an edge** means `hurtHero` landed the hit *and* the target's hp dropped. A block, i-frames, or a Ward that soaked it whole coat nothing. A hit that the Ward only dents does coat.
5. **Edges stack like buffs within a kind.** A second Ember while holding Ember follows the same-buff rule: the higher tier and the longer time. An edge of the other kind replaces the held one outright, even a major. The spec's "even one of the other kind" is read as extending the replacement to the other kind, not as letting a minor downgrade a major of the same kind.
6. **Venom's slow lasts as long as its poison** (3 s minor, 4.5 s major, before `PVP.ccMul`, so 1.5 s and 2.25 s in a match). A stronger slow already running (a lower `slowMul`) stays untouched.
7. **A burn or poison is `{ owner, t, next }`.** It ticks `DOTS[kind].damage` each time `next` runs out and ends when `t` does, with 1e-9 epsilons like the fire zones. Totals are: minor burn 2, major burn 3, minor poison 2, major poison 3. Re-applying sets `t` to the larger of what is left and the new duration, takes the new owner, and **keeps `next` running**. Otherwise hits landing faster than the interval would push the tick away for ever.
8. **Credit for damage-over-time.** A tick credits the owner while the owner is in the match (alive or dead). Once the owner has left, a tick credits nobody (`by: null`). A victim who then dies falls under the existing uncredited-death rule, as with a departed caster's fire patch.
9. **One Ember patch per attacker.** A major Ember hit lays a patch of 5 tiles (`computeBlastTiles` from the victim's tile) that replaces the same attacker's earlier Ember patch. The spec is silent on stacking, and without this rule a flurry of hits would stack 1 damage a second per patch. The fireball rune's own patches are untouched.
10. **Buff timers tick at the top of `moveHero`**, before the speed is computed. The server and the predictor therefore run a Haste out on the same tick.
11. **When spots roll.** A spot rolls at match start and at the moment it is taken, so the ghost shows what is coming for the whole wait. An up spot has `buff` set and `next: null`. A down spot has `buff: null` and `next` set. The major spot starts down, for `majorFirstSpawn`, with its first roll as the ghost.
12. **Taking a spot.** The first living hero (in match order) standing on the spot's tile takes it. A buff is always taken, even one the hero already holds stronger (the stacking rule decides what is kept). The event is `{ type: 'pickup', kind: 'buff', hero, buff, tier }`.
13. **The pickup float** is the text `+` in the buff's colour (the float's `kind` is the buff's name; `canvas.js` looks it up in `BUFF_COLORS`). The local sim adds it on the take. The online client adds it from the pickup event, over the taker's snapshot position.
14. **Bot priorities, in order:** a flask when hurt, then an up `B` within 10 tiles, then the rune (as today), then an up `b` within 6 tiles when no foe is within 4, then the fight. Distances are straight-line tiles, as the existing bot code measures them.
15. **The rotation.** `playableIndex(i, heroes)` returns the first index from `i` on (wrapping) whose arena is small, or any index once `heroes ≥ 4`. The server counts the finished match's roster, bots included, so a public room (bot fill 4) never skips. The local mode counts its roster and stores the index it played as `match.arenaIndex`, and game.js's "Next match" steps from that index. A new room starts on pillars, which is small.
16. **The large arenas are 55×39.** An odd size gives a true centre cell for `B` and a mirror axis, and it is "about 56×40". Keep is mirrored left–right. Wilds is symmetric under a half turn. The one rune and the third quiver sit on the axis (Keep) or at a half-turn pair (Wilds).
17. **Seeds.** `makeMatch({ seed = 1 })` keeps `match.seed` and `match.rng`. The server seeds each match with `randomSeed(lobby.opts.random)`, so a test lobby with a fixed `random` is repeatable. The local mode seeds with `randomSeed()` (Math.random) once per match.
18. **The performance budget** applies to the mean and the 95th percentile per tick. Single-tick maxima (GC, JIT warm-up) are reported, not gated. The unit test gates the mean at 2 ms after a warm-up.
19. **The soak** runs 4 bots a match, as 2a's soak did, so time-to-kill is comparable. Matches rotate through `arenaAt(m)` (all six arenas: 4 heroes may play the large ones), with seeds `1000 + m`. Time-to-kill is measured from the first damage a hero takes in a life (`amount > 0`) to its death.
20. **The HUD ring** shows the time left over the tier's full time, for Ward too. The bubble shows Ward's pool.
21. **The Haste trail is drawn whenever Haste is held.** A snapshot carries no motion history to draw it only while moving.
22. **Damage-over-time on the client.** The snapshot's `dots: { burn: t | 0, poison: t | 0 }` is hydrated into `hero.burn`/`hero.poison` as `{ owner: null, t, next: 0 }`. The client never ticks them (only the server's `tickDots` does), so the one renderer path reads `hero.burn?.t` for the local and the online match alike.

## Spec deviations

None. Two additions sit on top of the spec's wire list, both inside §6's intent. First, every pickup (not only spots) sends `t`. Second, `damagePlayer` gains an optional sixth parameter, `soak`, the seam through which Ward sits between the block and hp without touching single-player.

## Review Focus

The five uncovered inputs most likely to bite a player, each pinned by a test in the named task:
1. **Two heroes standing on one spot on the same tick.** Only the first takes it, and exactly one pickup event is sent → Task 4, "two heroes on one spot in one tick: only the first takes it, and there is one event".
2. **A burn whose owner died (rather than left) before it killed.** The dead owner still gets the kill → Task 3, "an owner who has died (not left) still gets the kill".
3. **Haste and the Warrior's lunge.** The dash is its own constant-speed move, and Haste must not lengthen it → Task 2, "does not lengthen the Warrior's lunge".
4. **A major Ember hit on a hero backed into a corner.** The patch spills only onto floor, never into the walls → Task 3, "a major Ember hit on a hero in a corner lays its patch only on floor".
5. **A pickup event whose taker left before the snapshot.** The client finds no hero for the float, draws nothing and carries on → Task 8, "a buff taken by a hero no longer in the snapshot … draws no float and breaks nothing".

---

## File Structure

| File | Responsibility |
|---|---|
| `renderer/data/pvp.js` (edit) | the 2b numbers: `BUFF_KINDS`, `EDGE_KINDS`, `BUFFS`, `DOTS`, `BUFF_SPOTS`, `BUFF_COLORS`, `PVP.largeMinHeroes`, the `BOTS` seek fields |
| `renderer/pvp/rng.js` (new) | `mulberry32`, `randomSeed`, `rollBuff` |
| `renderer/pvp/buffs.js` (new) | a hero's buffs: `emptyBuffs`, `slotOf`, `grantBuff`, `tickBuffs`, `clearBuffs`, `hasteMul`, `mightBonus`, `soakWard`, `copyBuffs` |
| `renderer/pvp/dots.js` (new) | the edges: `setDot`, `applyEdge` (burn, poison, Venom's slow, the Ember patch) |
| `renderer/pvp/hero.js` (edit) | buffs cleared by `applyKit`; `tickBuffs` and Haste in `moveHero` |
| `renderer/pvp/combat.js` (edit) | `hurtHero({ direct })`: Might, the Ward soak, the edge |
| `renderer/pvp/attacks.js` (edit) | `direct: true` on every melee hit |
| `renderer/pvp/sim.js` (edit) | the seed, `direct` on the projectile, lightning and burst hooks, `tickDots`, buffs cleared on death, spots rolled from `match.rng` |
| `renderer/pvp/pickups.js` (edit) | buff spots: `makePickups(arena, rng)`, taking, respawn and rolls |
| `renderer/pvp/bots.js` (edit) | seeking `B` and `b` spots |
| `renderer/pvp/local.js` (edit) | the local seed, `playableIndex`, the ghosts in `viewOf` |
| `renderer/systems/player-damage.js` (edit) | the optional `soak` |
| `renderer/systems/map.js` (edit) | `buildArena`'s 60×44 clamp |
| `renderer/data/pvp-arenas.js` (edit) | `b`/`B` letters, 2 `b` in each small arena, Keep and Wilds, `large`, the new order, `playableIndex` |
| `server/rooms.js` (edit) | a seed per match; the rotation's large-arena skip |
| `renderer/net/protocol.js`, `renderer/data/net.js` (edit) | v5: `buffs`, `dots`, the spots' `tier`/`buff`/`next`/`t` |
| `renderer/net/view.js`, `renderer/net/client.js` (edit) | `pickupEntities` (ghosts); the buff pickup float |
| `renderer/render/sprites.js`, `renderer/render/pvp-fx.js`, `renderer/render/canvas.js` (edit) | the buff icons; spots, ghosts and hero looks; buff float colours |
| `renderer/ui/pvp-hud.js`, `renderer/game.js` (edit) | the HUD buff row; `match.arenaIndex` |
| `tools/perf/pvp-step.mjs` (new) | the large-arena step benchmark |
| `tools/pvp-soak.mjs` (new) | the 20-match bot soak report |
| `test/pvp-buffs.test.js`, `test/pvp-buff-state.test.js`, `test/pvp-edges.test.js` (new) | tests |
| `test/pvp-helpers.js`, `test/pvp-pickups.test.js`, `test/pvp-arenas.test.js`, `test/arena.test.js`, `test/pvp-ui.test.js`, `test/pvp-bots.test.js`, `test/pvp-soak.test.js`, `test/pvp-fx.test.js`, `test/net-rooms.test.js`, `test/net-protocol.test.js`, `test/net-sim.test.js`, `test/net-ui.test.js`, `test/net-client.test.js`, `test/net-predict.test.js` (edit) | tests |

Task order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Each task leaves `npm test` green.

---
### Task 1: The 2b numbers and the match's seeded PRNG

**Files:**
- Modify: `renderer/data/pvp.js` (`PVP`, `BOTS`, and new tables appended at the end)
- Create: `renderer/pvp/rng.js`
- Modify: `renderer/pvp/sim.js` (`makeMatch`), `server/rooms.js` (`newMatch`), `renderer/pvp/local.js` (`makeLocalMatch`)
- Create: `test/pvp-buffs.test.js`

**Interfaces:**
- Produces:
  - from `renderer/data/pvp.js`: `PVP.largeMinHeroes === 4`; `BOTS.buffSeekFoe`/`buffSeek`/`majorSeek`; `BUFF_KINDS` (the five names, in that order); `EDGE_KINDS = ['ember', 'venom']`; `BUFFS[kind][tier]` = `{ dur, mul? , bonus?, pool?, burn?, emberPatchTiles?, poison?, slow? }`; `DOTS = { burn: { interval, damage }, poison: { interval, damage } }`; `BUFF_SPOTS = { minorRespawn, majorRespawn, majorFirstSpawn }`; `BUFF_COLORS[kind]` (a `#rrggbb` string);
  - from `renderer/pvp/rng.js`: `mulberry32(seed) → () => [0, 1)`, `randomSeed(random = Math.random) → uint32`, `rollBuff(rng) → one of BUFF_KINDS`;
  - `makeMatch({ …, seed = 1 })` sets `match.seed` (uint32) and `match.rng`; `makeLocalMatch({ …, seed = randomSeed() })`; the server's `newMatch` seeds with `randomSeed(lobby.opts.random)`.

- [ ] **Step 1: Write the failing test**

Create `test/pvp-buffs.test.js`:

```js
// Sub-project 2b: the buff numbers and the match's seeded rolls.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PVP, BOTS, BUFF_KINDS, EDGE_KINDS, BUFFS, DOTS, BUFF_SPOTS, BUFF_COLORS } from '../renderer/data/pvp.js'
import { mulberry32, randomSeed, rollBuff } from '../renderer/pvp/rng.js'
import { makeMatch } from '../renderer/pvp/sim.js'
import { makeLocalMatch } from '../renderer/pvp/local.js'
import { makeLobby, createRoom } from '../server/rooms.js'

describe('2b numbers', () => {
  it('the five buffs, minor and major', () => {
    assert.deepEqual(BUFF_KINDS, ['haste', 'might', 'ward', 'ember', 'venom'])
    assert.deepEqual(EDGE_KINDS, ['ember', 'venom'])
    assert.deepEqual(BUFFS.haste, { minor: { dur: 8, mul: 1.2 }, major: { dur: 15, mul: 1.5 } })
    assert.deepEqual(BUFFS.might, { minor: { dur: 8, bonus: 1 }, major: { dur: 12, bonus: 2 } })
    assert.deepEqual(BUFFS.ward, { minor: { dur: 15, pool: 2 }, major: { dur: 15, pool: 4 } })
    assert.deepEqual(BUFFS.ember, { minor: { dur: 10, burn: 2 }, major: { dur: 15, burn: 3, emberPatchTiles: 5 } })
    assert.deepEqual(BUFFS.venom, { minor: { dur: 10, poison: 3, slow: 0.2 }, major: { dur: 15, poison: 4.5, slow: 0.35 } })
    assert.deepEqual(DOTS, { burn: { interval: 1, damage: 1 }, poison: { interval: 1.5, damage: 1 } })
    for (const k of BUFF_KINDS) assert.match(BUFF_COLORS[k], /^#[0-9a-f]{6}$/)
  })
  it('the spots, the large-arena floor and the bots', () => {
    assert.deepEqual(BUFF_SPOTS, { minorRespawn: 20, majorRespawn: 45, majorFirstSpawn: 30 })
    assert.equal(PVP.largeMinHeroes, 4)
    assert.equal(BOTS.buffSeekFoe, 4)
    assert.equal(BOTS.buffSeek, 6)
    assert.equal(BOTS.majorSeek, 10)
  })
})

describe('the seeded rolls', () => {
  it('mulberry32 is repeatable for a seed and differs between seeds', () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43)
    const xs = Array.from({ length: 5 }, () => a())
    assert.deepEqual(Array.from({ length: 5 }, () => b()), xs)
    assert.notDeepEqual(Array.from({ length: 5 }, () => c()), xs)
    for (const x of xs) assert.ok(x >= 0 && x < 1)
  })
  it('rollBuff: all five kinds come up, none far off a fifth over 5000 rolls', () => {
    const rng = mulberry32(7)
    const n = Object.fromEntries(BUFF_KINDS.map(k => [k, 0]))
    for (let i = 0; i < 5000; i++) n[rollBuff(rng)]++
    for (const k of BUFF_KINDS) assert.ok(n[k] > 900 && n[k] < 1100, `${k} ${n[k]}`)
    assert.equal(rollBuff(() => 0.999999999), 'venom')
    assert.equal(rollBuff(() => 0), 'haste')
  })
  it('randomSeed maps a [0, 1) source onto 32 bits', () => {
    assert.equal(randomSeed(() => 0), 0)
    assert.equal(randomSeed(() => 0.5), 2147483648)
    assert.equal(randomSeed(() => 0.9999999999), 4294967295)
  })
  it('makeMatch keeps the seed and a PRNG seeded with it; the default seed is 1', () => {
    const roster = [{ id: 'a', name: 'A', cls: 'mage' }]
    const m = makeMatch({ roster, seed: 99 }), n = makeMatch({ roster, seed: 99 })
    assert.equal(m.seed, 99)
    assert.equal(m.rng(), n.rng())
    assert.equal(makeMatch({ roster }).seed, 1)
  })
  it('the server seeds each match from the lobby random; the local mode takes one or makes one', () => {
    const lobby = makeLobby({ random: () => 0.5 })
    const { room } = createRoom(lobby, { name: 'Aino', cls: 'mage' })
    assert.equal(room.match.seed, 2147483648)
    assert.equal(makeLocalMatch({ cls: 'mage', seed: 7 }).seed, 7)
    assert.ok(Number.isInteger(makeLocalMatch({ cls: 'mage' }).seed))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pvp-buffs.test.js`
Expected: FAIL — `SyntaxError: The requested module '../renderer/data/pvp.js' does not provide an export named 'BUFF_COLORS'`.

- [ ] **Step 3: Write the data**

In `renderer/data/pvp.js`, in `PVP`, replace

```js
  minHeroes: 2,   // the match clock runs only with at least this many heroes
}
```

with

```js
  minHeroes: 2,   // the match clock runs only with at least this many heroes
  largeMinHeroes: 4,     // 2b: a large arena is skipped for a match with fewer heroes
}
```

In `BOTS`, replace

```js
  doubleMin: 5,      // tiles — an archer bot draws the double shot at a lined-up foe this far or further
}
```

with

```js
  doubleMin: 5,      // tiles — an archer bot draws the double shot at a lined-up foe this far or further
  // 2b buff spots
  buffSeekFoe: 4,    // tiles — with no foe this close, a bot detours to a minor spot…
  buffSeek: 6,       // …that is up and within this many tiles
  majorSeek: 10,     // tiles — a bot heads for an up major spot this close, foes or not
}
```

Append at the end of the file:

```js
// Sub-project 2b (spec 2026-09-27-pvp-2b-pickups-arenas-design.md) — buffs
// in a minor and a major tier, taken from buff spots (renderer/pvp/buffs.js).
// dur: s the buff lasts. Haste multiplies walk speed by `mul`; Might adds
// `bonus` to each direct hit; Ward soaks the next `pool` damage (until used
// up or `dur`); the two edges coat each landed direct hit: Ember burns the
// victim for `burn` s (a major also lays a fire patch of `emberPatchTiles`
// tiles under it), Venom poisons for `poison` s and slows by `slow` for as
// long.
export const BUFF_KINDS = ['haste', 'might', 'ward', 'ember', 'venom']
export const EDGE_KINDS = ['ember', 'venom']
export const BUFFS = {
  haste: { minor: { dur: 8, mul: 1.2 }, major: { dur: 15, mul: 1.5 } },
  might: { minor: { dur: 8, bonus: 1 }, major: { dur: 12, bonus: 2 } },
  ward:  { minor: { dur: 15, pool: 2 }, major: { dur: 15, pool: 4 } },
  ember: { minor: { dur: 10, burn: 2 }, major: { dur: 15, burn: 3, emberPatchTiles: 5 } },
  venom: { minor: { dur: 10, poison: 3, slow: 0.2 }, major: { dur: 15, poison: 4.5, slow: 0.35 } },
}
// The damage-over-time the edges leave: `damage` every `interval` s,
// unblockable 'dot' damage credited to whoever applied it.
export const DOTS = {
  burn:   { interval: 1, damage: 1 },
  poison: { interval: 1.5, damage: 1 },
}
// Buff spots: grid letter b (minor) and B (major). s.
export const BUFF_SPOTS = { minorRespawn: 20, majorRespawn: 45, majorFirstSpawn: 30 }
// Each buff's colour: its icon's rim, the pickup float, the hero look.
export const BUFF_COLORS = { haste: '#38bdf8', might: '#ef4444', ward: '#c7d2fe', ember: '#f97316', venom: '#4ade80' }
```

- [ ] **Step 4: The PRNG and the seeds**

Create `renderer/pvp/rng.js`:

```js
// The match's seeded randomness (2b spec §2): mulberry32, a tiny 32-bit
// PRNG. makeMatch({ seed }) keeps one as match.rng, so a buff spot's rolls
// are repeatable for a seed and never touch Math.random. Pure.
import { BUFF_KINDS } from '../data/pvp.js'

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A seed for a new match, from any [0, 1) source (Math.random, a lobby's).
export const randomSeed = (random = Math.random) => Math.floor(random() * 4294967296) >>> 0

// One of the five buffs, uniformly.
export const rollBuff = rng => BUFF_KINDS[Math.min(BUFF_KINDS.length - 1, Math.floor(rng() * BUFF_KINDS.length))]
```

In `renderer/pvp/sim.js`:
- Below `import { makePickups, tickPickups, tickRunes, endRune } from './pickups.js'` add `import { mulberry32 } from './rng.js'`.
- Replace the `makeMatch` signature line

```js
export function makeMatch({ arena = PVP_ARENAS.pillars, roster, sfx: sfxQueue = null, matchLength = PVP.matchLength } = {}) {
```

with

```js
// seed: the match's PRNG seed (match.rng, 2b spec §2) — the server and the
// local mode pass a random one, tests a fixed one.
export function makeMatch({ arena = PVP_ARENAS.pillars, roster, sfx: sfxQueue = null, matchLength = PVP.matchLength, seed = 1 } = {}) {
```

- Replace

```js
  const match = {
    map: arenaMap(arena),
```

with

```js
  const rng = mulberry32(seed)
  const match = {
    map: arenaMap(arena),
```

- and replace `    matchLength, waiting: roster.length < PVP.minHeroes,` with `    matchLength, waiting: roster.length < PVP.minHeroes, seed: seed >>> 0, rng,`.

In `server/rooms.js`:
- Below `import { arenaAt, nextArenaIndex } from '../renderer/data/pvp-arenas.js'` add `import { randomSeed } from '../renderer/pvp/rng.js'`.
- Replace

```js
// Each match is played on the room's current arena (4b spec §1).
function newMatch(lobby, room, roster) {
  const match = makeMatch({ roster, arena: arenaAt(room.arenaIndex), sfx: makeSfx(false), matchLength: lobby.opts.matchLength })
```

with

```js
// Each match is played on the room's current arena (4b spec §1), with a
// fresh seed for its buff rolls (2b spec §2).
function newMatch(lobby, room, roster) {
  const match = makeMatch({ roster, arena: arenaAt(room.arenaIndex), sfx: makeSfx(false), matchLength: lobby.opts.matchLength,
    seed: randomSeed(lobby.opts.random) })
```

In `renderer/pvp/local.js`:
- Below `import { arenaAt } from '../data/pvp-arenas.js'` add `import { randomSeed } from './rng.js'`.
- Replace

```js
// arenaIndex: where in PVP_ARENA_ORDER this match is played; game.js's
// "Next match" passes nextArenaIndex of the last one.
export function makeLocalMatch({ cls, bots = PVP.localBots, sfx = null, arenaIndex = 0 }) {
```

with

```js
// arenaIndex: where in PVP_ARENA_ORDER this match is played; game.js's
// "Next match" passes nextArenaIndex of the last one. seed: the buff rolls'
// (2b spec §2), Math.random's once per match unless a test fixes it.
export function makeLocalMatch({ cls, bots = PVP.localBots, sfx = null, arenaIndex = 0, seed = randomSeed() }) {
```

- and replace `  return makeMatch({ roster, sfx, arena: arenaAt(arenaIndex) })` with `  return makeMatch({ roster, sfx, arena: arenaAt(arenaIndex), seed })`.

- [ ] **Step 5: Run the tests**

Run: `node --test test/pvp-buffs.test.js`
Expected: PASS (7 tests).

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0`. The server's `newMatch` now draws one number from `lobby.opts.random` per match, after the room code. No existing test pins a bot name that this reorders; if one does, it is a test that fixed a `random` sequence — recount its draws, do not change the seeding order.

- [ ] **Step 6: Commit**

```bash
git add renderer/data/pvp.js renderer/pvp/rng.js renderer/pvp/sim.js server/rooms.js renderer/pvp/local.js test/pvp-buffs.test.js
git commit -m "feat(pvp): 2b numbers and a seeded match PRNG

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 2: A hero's buffs — stacking, timers, clearing, Haste in the walk and on the wire

**Files:**
- Create: `renderer/pvp/buffs.js`
- Modify: `renderer/pvp/hero.js` (`applyKit`, `moveHero`), `renderer/pvp/sim.js` (`resolveDeaths`), `renderer/net/protocol.js` (`heroSnap`, `hydrateHero`)
- Create: `test/pvp-buff-state.test.js`
- Modify: `test/net-predict.test.js`

**Interfaces:**
- Consumes: `BUFFS`, `EDGE_KINDS` (Task 1).
- Produces (from `renderer/pvp/buffs.js`):
  - `emptyBuffs() → { haste: null, might: null, ward: null, edge: null }`;
  - `slotOf(kind) → 'haste' | 'might' | 'ward' | 'edge'`;
  - `grantBuff(hero, kind, tier) → slot state`: `{ tier, t }`, Ward `{ tier, t, pool }`, an edge `{ kind, tier, t }`; throws `unknown buff` for a bad kind or tier;
  - `tickBuffs(hero, dt)`; `clearBuffs(hero)` (sets `buffs` empty, `burn` and `poison` null);
  - `hasteMul(hero) → number` (1 without Haste); `mightBonus(hero) → number` (0 without Might);
  - `copyBuffs(b) → a deep copy` (an empty set for null);
  - every hero has `buffs`, `burn: null`, `poison: null` from `applyKit`; `moveHero` ticks the buffs first and multiplies the walk by `hasteMul`; a snapshot hero carries `buffs`.

- [ ] **Step 1: Write the failing tests**

Create `test/pvp-buff-state.test.js`:

```js
// Sub-project 2b §1: a hero's buffs — taking, stacking, timing out,
// clearing — Haste in the walk, and the buffs on the wire.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PVP } from '../renderer/data/pvp.js'
import { grantBuff, tickBuffs, clearBuffs, hasteMul, mightBonus, emptyBuffs } from '../renderer/pvp/buffs.js'
import { makeHero, placeHero, tickHero, applyKit, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'
import { grantRune, endRune } from '../renderer/pvp/pickups.js'
import { startCombo, stepCombo } from '../renderer/pvp/attacks.js'
import { heroSnap, hydrateHero } from '../renderer/net/protocol.js'
import { testMatch } from './pvp-helpers.js'

const dt = PVP.tick
const hero = (id = 'h', cls = 'warrior', cell = { x: 5, y: 5 }) => { const h = makeHero({ id, name: id, cls }); placeHero(h, cell); return h }
const walkEast = (m, h, n, over = {}) => { for (let i = 0; i < n; i++) tickHero(m, h, { ...NEUTRAL_INPUT, move: { x: 1, y: 0 }, facing: 'east', ...over }, dt) }

describe('buff state', () => {
  it('a new hero has no buffs, burn or poison', () => {
    const h = hero()
    assert.deepEqual(h.buffs, emptyBuffs())
    assert.equal(h.burn, null)
    assert.equal(h.poison, null)
  })
  it('taking a buff sets its tier and full time; Ward its pool; an edge its kind', () => {
    const h = hero()
    assert.deepEqual(grantBuff(h, 'haste', 'minor'), { tier: 'minor', t: 8 })
    assert.deepEqual(grantBuff(h, 'ward', 'major'), { tier: 'major', t: 15, pool: 4 })
    assert.deepEqual(grantBuff(h, 'venom', 'minor'), { kind: 'venom', tier: 'minor', t: 10 })
    assert.deepEqual(Object.keys(h.buffs).filter(k => h.buffs[k]), ['haste', 'ward', 'edge'], 'different buffs stack')
    assert.throws(() => grantBuff(h, 'luck', 'minor'), /unknown buff/)
  })
  it('the same buff again keeps the higher tier and the longer time', () => {
    const h = hero()
    grantBuff(h, 'might', 'major'); h.buffs.might.t = 3
    assert.deepEqual(grantBuff(h, 'might', 'minor'), { tier: 'major', t: 8 }, 'major kept, the minor\'s 8 s is longer')
    grantBuff(h, 'haste', 'minor'); h.buffs.haste.t = 7
    assert.deepEqual(grantBuff(h, 'haste', 'major'), { tier: 'major', t: 15 })
    assert.deepEqual(grantBuff(h, 'haste', 'minor'), { tier: 'major', t: 15 }, 'nothing shortens')
  })
  it('Ward keeps the larger pool', () => {
    const h = hero()
    grantBuff(h, 'ward', 'major'); h.buffs.ward.pool = 1; h.buffs.ward.t = 2
    assert.deepEqual(grantBuff(h, 'ward', 'minor'), { tier: 'major', t: 15, pool: 2 })
    grantBuff(h, 'ward', 'major')
    assert.equal(h.buffs.ward.pool, 4)
  })
  it('an edge of the other kind replaces the one held, even a major; the same kind stacks like any buff', () => {
    const h = hero()
    grantBuff(h, 'ember', 'major')
    assert.deepEqual(grantBuff(h, 'venom', 'minor'), { kind: 'venom', tier: 'minor', t: 10 })
    h.buffs.edge.t = 4
    assert.deepEqual(grantBuff(h, 'venom', 'major'), { kind: 'venom', tier: 'major', t: 15 })
    assert.deepEqual(grantBuff(h, 'venom', 'minor'), { kind: 'venom', tier: 'major', t: 15 })
  })
  it('timers count down in the hero tick, and a buff whose time is up is gone', () => {
    const h = hero(); const m = testMatch([h])
    grantBuff(h, 'haste', 'minor'); grantBuff(h, 'ward', 'minor')
    for (let i = 0; i < 239; i++) tickHero(m, h, NEUTRAL_INPUT, dt)
    assert.ok(h.buffs.haste, 'still up a tick before 8 s')
    tickHero(m, h, NEUTRAL_INPUT, dt)
    assert.equal(h.buffs.haste, null)
    assert.ok(Math.abs(h.buffs.ward.t - 7) < 1e-6)
    tickBuffs(h, 7)
    assert.equal(h.buffs.ward, null, 'Ward times out at 15 s unused')
  })
  it('hasteMul and mightBonus by tier, neutral without', () => {
    const h = hero()
    assert.equal(hasteMul(h), 1); assert.equal(mightBonus(h), 0)
    grantBuff(h, 'haste', 'minor'); grantBuff(h, 'might', 'minor')
    assert.equal(hasteMul(h), 1.2); assert.equal(mightBonus(h), 1)
    grantBuff(h, 'haste', 'major'); grantBuff(h, 'might', 'major')
    assert.equal(hasteMul(h), 1.5); assert.equal(mightBonus(h), 2)
  })
})

describe('Haste', () => {
  it('multiplies the walk by 1.2 / 1.5', () => {
    for (const [tier, mul] of [[null, 1], ['minor', 1.2], ['major', 1.5]]) {
      const h = hero('h', 'archer'); const m = testMatch([h])
      if (tier) grantBuff(h, 'haste', tier)
      const x0 = h.px
      walkEast(m, h, 15)
      assert.ok(Math.abs(h.px - x0 - 120 * mul * 15 * dt) < 1e-6, `${tier}: ${h.px - x0}`)
    }
  })
  it("does not lengthen the Warrior's lunge: the dash is its own, not a walk", () => {
    const dash = haste => {
      const h = hero('h', 'warrior'); const m = testMatch([h])
      if (haste) grantBuff(h, 'haste', 'major')
      const x0 = h.px
      startCombo(m, h, { kind: 'lunge', dir: 'e' })
      for (let i = 0; i < 12; i++) stepCombo(m, h, dt)
      return h.px - x0
    }
    assert.equal(dash(true), dash(false))
    assert.ok(Math.abs(dash(false) - 2.5 * 32) < 1e-6)
  })
  it('stacks multiplicatively with sprint and with a slow', () => {
    const run = (buff, over, setup = () => {}) => {
      const h = hero('h', 'archer'); const m = testMatch([h]); setup(h)
      if (buff) grantBuff(h, 'haste', 'major')
      const x0 = h.px
      walkEast(m, h, 6, over)
      return h.px - x0
    }
    const sprint = { sprint: true }
    assert.ok(Math.abs(run(true, sprint) / run(false, sprint) - 1.5) < 1e-9, 'with sprint')
    const slowed = h => { h.slowTimer = 5; h.slowMul = 0.5 }
    assert.ok(Math.abs(run(true, {}, slowed) / run(false, {}, slowed) - 1.5) < 1e-9, 'under a slow')
  })
})

describe('clearing buffs', () => {
  it('a death clears buffs, burn and poison', () => {
    const m = makeMatch({ roster: [{ id: 'a', name: 'A', cls: 'warrior' }, { id: 'b', name: 'B', cls: 'mage' }] })
    const h = m.heroes[0]
    grantBuff(h, 'might', 'major'); grantBuff(h, 'ember', 'minor')
    h.burn = { owner: 'b', t: 1, next: 1 }; h.poison = { owner: 'b', t: 1, next: 1 }
    h.hp = 0
    stepMatch(m, {}, dt)
    assert.equal(h.dead, true)
    assert.deepEqual(h.buffs, emptyBuffs())
    assert.equal(h.burn, null); assert.equal(h.poison, null)
  })
  it('applyKit (a new life) clears them too', () => {
    const h = hero()
    grantBuff(h, 'ward', 'minor'); h.poison = { owner: 'x', t: 1, next: 1 }
    applyKit(h, 'mage')
    assert.deepEqual(h.buffs, emptyBuffs()); assert.equal(h.poison, null)
  })
  it('the rune and buffs coexist: taking or losing the rune leaves the buffs alone', () => {
    const h = hero(); const m = testMatch([h])
    grantBuff(h, 'haste', 'major'); grantBuff(h, 'venom', 'minor')
    const before = JSON.stringify(h.buffs)
    grantRune(m, h)
    assert.equal(JSON.stringify(h.buffs), before)
    endRune(m, h)
    assert.equal(JSON.stringify(h.buffs), before)
  })
  it('clearBuffs is idempotent on a hero that never had any', () => {
    const h = {}
    clearBuffs(h)
    assert.deepEqual(h, { buffs: emptyBuffs(), burn: null, poison: null })
  })
})

describe('buffs on the wire', () => {
  it('heroSnap carries a deep copy of the buffs, and hydrateHero takes it back', () => {
    const h = hero()
    grantBuff(h, 'ward', 'major'); grantBuff(h, 'ember', 'minor')
    const s = heroSnap(h)
    assert.deepEqual(s.buffs, h.buffs)
    h.buffs.ward.pool = 1
    assert.equal(s.buffs.ward.pool, 4, 'a copy, not the live object')
    const back = hydrateHero(null, JSON.parse(JSON.stringify(s)))
    assert.deepEqual(back.buffs, { haste: null, might: null, ward: { tier: 'major', t: 15, pool: 4 }, edge: { kind: 'ember', tier: 'minor', t: 10 } })
  })
})
```

In `test/net-predict.test.js`, below `import { weaponContents } from '../renderer/systems/entities.js'` add `import { grantBuff } from '../renderer/pvp/buffs.js'`, and append at the end of the file:

```js
describe('2b prediction: Haste', () => {
  // The server hero takes a Haste at the end of tick `at` (as tickPickups
  // would); the snapshot of that tick carries it, and the predictor — which
  // walked those ticks without it — replays the rest with it.
  const run = (tier, t, total = 40, at = 5) => {
    const m = lone('archer')
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    let snap = null
    for (let seq = 1; seq <= total; seq++) {
      const input = { ...east, seq, sprint: seq > 20 }
      stepMatch(m, { p1: input }, PVP.tick)
      predictStep(pred, input)
      pred.pending.push({ seq, input })
      if (seq === at) { grantBuff(m.heroes[0], 'haste', tier); m.heroes[0].buffs.haste.t = t; snap = heroSnap(m.heroes[0]) }
    }
    reconcile(pred, snap, at)
    return { server: m.heroes[0], pred: pred.hero }
  }
  it('a Haste taken before the snapshot is replayed through moveHero: the walk matches the server', () => {
    const { server, pred } = run('major', 15)
    assert.ok(Math.abs(pred.px - server.px) < 1e-9, `px ${pred.px} vs ${server.px}`)
    assert.ok(Math.abs(pred.stamina - server.stamina) < 1e-9)
    assert.deepEqual(pred.buffs, server.buffs)
  })
  it('a Haste that runs out mid-replay runs out on the same tick on both sides', () => {
    const { server, pred } = run('minor', 0.4)
    assert.equal(server.buffs.haste, null)
    assert.equal(pred.buffs.haste, null)
    assert.ok(Math.abs(pred.px - server.px) < 1e-9, `px ${pred.px} vs ${server.px}`)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/pvp-buff-state.test.js test/net-predict.test.js 2>&1 | grep -E "^# (pass|fail)|Error"`
Expected: FAIL — `Cannot find module '…/renderer/pvp/buffs.js'`.

- [ ] **Step 3: The buff state**

Create `renderer/pvp/buffs.js`:

```js
// A hero's buffs (2b spec §1): hero.buffs = { haste, might, ward, edge },
// each null or { tier, t } — Ward also carries `pool`, the edge `kind`
// ('ember' | 'venom'). Timers count down in moveHero, which the client's
// predictor shares, so a Haste runs out on both sides on the same tick.
// Pure: no DOM.
import { BUFFS, EDGE_KINDS } from '../data/pvp.js'

export const emptyBuffs = () => ({ haste: null, might: null, ward: null, edge: null })
const SLOTS = ['haste', 'might', 'ward', 'edge']
const RANK = { minor: 0, major: 1 }

// The slot a buff kind lives in: the two edges share one.
export const slotOf = kind => EDGE_KINDS.includes(kind) ? 'edge' : kind

// Taking a buff. A different buff stacks beside the others. The same buff
// again keeps the higher tier and the longer remaining time (Ward: the
// larger pool too). An edge of the other kind replaces the one held.
// Returns the slot's new state.
export function grantBuff(hero, kind, tier) {
  const def = BUFFS[kind]?.[tier]
  if (!def) throw new Error(`pvp: unknown buff ${kind}/${tier}`)
  hero.buffs ??= emptyBuffs()
  const slot = slotOf(kind)
  const cur = hero.buffs[slot]
  if (!cur || (slot === 'edge' && cur.kind !== kind)) {
    const fresh = slot === 'edge' ? { kind, tier, t: def.dur } : { tier, t: def.dur }
    if (kind === 'ward') fresh.pool = def.pool
    hero.buffs[slot] = fresh
    return fresh
  }
  if (RANK[tier] > RANK[cur.tier]) cur.tier = tier
  cur.t = Math.max(cur.t, def.dur)
  if (kind === 'ward') cur.pool = Math.max(cur.pool, def.pool)
  return cur
}

// Counts every buff down; one whose time is up is gone.
export function tickBuffs(hero, dt) {
  const b = hero.buffs
  if (!b) return
  for (const s of SLOTS) {
    if (!b[s]) continue
    b[s].t -= dt
    if (b[s].t <= 1e-9) b[s] = null
  }
}

// Death and a new kit: no buffs, and no burn or poison left running.
export function clearBuffs(hero) {
  hero.buffs = emptyBuffs()
  hero.burn = null
  hero.poison = null
}

// The walk-speed factor Haste gives (1 without it).
export const hasteMul = hero => hero.buffs?.haste ? BUFFS.haste[hero.buffs.haste.tier].mul : 1
// What Might adds to each of the hero's direct hits (0 without it).
export const mightBonus = hero => hero.buffs?.might ? BUFFS.might[hero.buffs.might.tier].bonus : 0

// A deep copy, for the snapshot and for hydrating one.
export function copyBuffs(b) {
  const out = emptyBuffs()
  for (const s of SLOTS) if (b?.[s]) out[s] = { ...b[s] }
  return out
}
```

- [ ] **Step 4: Wire it into the hero, the death and the snapshot**

In `renderer/pvp/hero.js`:
- Above `import { KITS, OUTFIT_OVERRIDES, PVP, WARRIOR_COMBOS, DOUBLE_SHOT, drawFrac } from '../data/pvp.js'` add `import { clearBuffs, tickBuffs, hasteMul } from './buffs.js'`.
- At the end of `applyKit`, replace

```js
  hero.prevAlt = false
}
```

(the first occurrence in the file, the last line of `applyKit`) with

```js
  hero.prevAlt = false
  clearBuffs(hero)   // 2b: a new life starts with no buffs, burn or poison
}
```

- In `moveHero`, replace

```js
  tickStamina(hero, dt)
  tickRain(hero, dt)
```

with

```js
  tickStamina(hero, dt)
  tickRain(hero, dt)
  tickBuffs(hero, dt)
```

- and replace

```js
  const speed = PLAYER_SPEED * chargeFactor * rainSlow(hero) * slow *
    (blocking ? BLOCK_SPEED_MUL : 1) * (sprinting ? profile.speedMul : 1)
```

with

```js
  // Haste (2b) multiplies with everything else: sprint, slows, a hold.
  const speed = PLAYER_SPEED * chargeFactor * rainSlow(hero) * slow * hasteMul(hero) *
    (blocking ? BLOCK_SPEED_MUL : 1) * (sprinting ? profile.speedMul : 1)
```

In `renderer/pvp/sim.js`:
- Below `import { mulberry32 } from './rng.js'` add `import { clearBuffs } from './buffs.js'`.
- In `resolveDeaths`, replace

```js
    h.shock = undefined
    h.blocking = false
  }
```

with

```js
    h.shock = undefined
    h.blocking = false
    clearBuffs(h)      // 2b: buffs, burn and poison die with the hero
  }
```

In `renderer/net/protocol.js`:
- Below `import { makeHero, applyKit } from '../pvp/hero.js'` add `import { copyBuffs } from '../pvp/buffs.js'`.
- In `heroSnap`, replace `  s.shock = h.shock ? { tickT: h.shock.tickT, left: h.shock.left } : null` with

```js
  // 2b: the buffs, for the looks, the HUD and the predictor's Haste.
  s.buffs = copyBuffs(h.buffs)
  s.shock = h.shock ? { tickT: h.shock.tickT, left: h.shock.left } : null
```

- In `hydrateHero`, replace `  h.shock = s.shock ? { ...s.shock } : undefined` with

```js
  h.buffs = copyBuffs(s.buffs)
  h.shock = s.shock ? { ...s.shock } : undefined
```

The predictor needs no change of its own: `predictStep` already runs `moveHero` on the hydrated hero, which now carries the buffs.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/pvp-buff-state.test.js test/net-predict.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: PASS. (Prototyping showed the two parity tests fail without the `hydrateHero` line: the replayed walk comes out short.)

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add renderer/pvp/buffs.js renderer/pvp/hero.js renderer/pvp/sim.js renderer/net/protocol.js test/pvp-buff-state.test.js test/net-predict.test.js
git commit -m "feat(pvp): hero buffs — stacking, timers, clearing, Haste in moveHero and on the wire

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---
### Task 3: Might, Ward and the edges in the damage path; `tickDots`

**Files:**
- Modify: `renderer/systems/player-damage.js` (`damagePlayer`'s `soak`)
- Modify: `renderer/pvp/buffs.js` (`soakWard`)
- Create: `renderer/pvp/dots.js`
- Modify: `renderer/pvp/combat.js` (`hurtHero`), `renderer/pvp/attacks.js` (four melee hits), `renderer/pvp/sim.js` (three hooks, `tickDots`)
- Create: `test/pvp-edges.test.js`

**Interfaces:**
- Consumes: `grantBuff`, `mightBonus`, `hero.buffs` (Task 2); `BUFFS`, `DOTS` (Task 1).
- Produces:
  - `damagePlayer(state, amount, kind, from = null, hero = state.player, soak = null)`: `soak(hero, amount) → amount left`, run after the block and the outfit's protect, before hp;
  - `soakWard(hero, amount) → amount left` (from `buffs.js`; empties and breaks the ward);
  - `hurtHero(match, target, amount, { kind, by, from, melee, group, direct = false })`: Might added to a direct hit, `soakWard` passed to `damagePlayer`, `applyEdge` on a landed direct hit that took hp;
  - from `renderer/pvp/dots.js`: `setDot(target, 'burn' | 'poison', ownerId, dur) → { owner, t, next }`, `applyEdge(match, by, target)`;
  - from `renderer/pvp/sim.js`: `tickDots(match, dt)`, run each tick straight after `tickFireZones`; an Ember patch is a fire zone with `edge: true` and `owner`.

- [ ] **Step 1: Write the failing test**

Create `test/pvp-edges.test.js`:

```js
// Sub-project 2b §1: Might, Ward and the elemental edges in the damage path,
// and the damage-over-time they leave (renderer/pvp/combat.js, dots.js and
// the sim's tickDots).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeHero, placeHero } from '../renderer/pvp/hero.js'
import { hurtHero } from '../renderer/pvp/combat.js'
import { swing, startCombo, stepCombo } from '../renderer/pvp/attacks.js'
import { grantBuff } from '../renderer/pvp/buffs.js'
import { setDot } from '../renderer/pvp/dots.js'
import { makeMatch, stepMatch, removeHero, detonateFireball, tickFireZones, tickDots } from '../renderer/pvp/sim.js'
import { damagePlayer, INVULN_DURATION } from '../renderer/systems/player-damage.js'
import { resolveCharge } from '../renderer/systems/melee.js'
import { applyShock } from '../renderer/systems/hammer.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makePlayer } from '../renderer/systems/entities.js'
import { PVP } from '../renderer/data/pvp.js'
import { testMatch } from './pvp-helpers.js'

const dt = PVP.tick
const hero = (id, cls, cell) => { const h = makeHero({ id, name: id, cls }); placeHero(h, cell); return h }
// An attacker at 5,5 facing east and a foe one tile east, in a test match.
const pair = (cls = 'warrior', foeCls = 'archer') => {
  const a = hero('a', cls, { x: 5, y: 5 }), f = hero('f', foeCls, { x: 6, y: 5 })
  a.facing = 'east'
  return { a, f, m: testMatch([a, f]) }
}
const blow = (m, a) => swing(m, a, resolveCharge('sword', 0))
// A real match (so CC scaling and the tick order apply) with two heroes placed.
const duel = (cls = 'archer', foeCls = 'mage', at = { x: 3, y: 8 }, foeAt = { x: 6, y: 8 }) => {
  const m = makeMatch({ roster: [{ id: 'a', name: 'a', cls }, { id: 'f', name: 'f', cls: foeCls }] })
  const [a, f] = m.heroes
  placeHero(a, at); placeHero(f, foeAt)
  a.spawnProtect = 0; f.spawnProtect = 0; a.facing = 'east'
  return { m, a, f }
}
const ticks = (m, n, inputs = () => ({})) => { for (let i = 0; i < n; i++) stepMatch(m, inputs(i), dt) }
const shoot = i => ({ a: { move: { x: 0, y: 0 }, facing: 'east', attack: i === 0, alt: false, sprint: false } })

describe('Might', () => {
  it('adds its bonus to a sword blow (2 → 3 minor, 4 major)', () => {
    for (const [tier, dealt] of [[null, 2], ['minor', 3], ['major', 4]]) {
      const { a, f, m } = pair()
      if (tier) grantBuff(a, 'might', tier)
      blow(m, a)
      assert.equal(PVP.hp - f.hp, dealt, `${tier}`)
    }
  })
  it('adds to a direct hit of every kind hurtHero is told is direct, and to none of the rest', () => {
    const dealt = opts => {
      const { a, f, m } = pair()
      grantBuff(a, 'might', 'minor')
      hurtHero(m, f, 1, { by: a, ...opts })
      return PVP.hp - f.hp
    }
    assert.equal(dealt({ direct: true }), 2, 'a projectile or a combo hit')
    assert.equal(dealt({ kind: 'lightning', direct: true }), 2, 'a lightning strike')
    assert.equal(dealt({ kind: 'fire', direct: true }), 2, "the fireball's burst")
    assert.equal(dealt({ kind: 'dot' }), 1, 'a burn or poison tick')
    assert.equal(dealt({ kind: 'fire' }), 1, 'a fire-patch tick')
    assert.equal(dealt({ kind: 'lightning' }), 1, "a shock tick or the hammer's chain")
  })
  it("the Warrior's combos carry it: the lunge's 3, each fence thrust's 1, the whirlwind's 2", () => {
    for (const [kind, dealt] of [['lunge', 3 + 1], ['fence', 3 * (1 + 1)], ['whirl', 2 + 1]]) {
      const { a, f, m } = pair()
      grantBuff(a, 'might', 'minor')
      startCombo(m, a, { kind, dir: 'e' })
      for (let i = 0; i < 12; i++) stepCombo(m, a, dt)
      assert.equal(PVP.hp - f.hp, dealt, kind)
    }
  })
  it("a lightning strike in a match carries it; a hammer shock's tick does not", () => {
    const { m, a, f } = duel('mage', 'archer')
    grantBuff(a, 'might', 'minor')
    m.lightning.push({ x: f.x, y: f.y, t: 0, delay: 0, owner: 'a', damage: 3, stun: 0 })
    ticks(m, 1)
    assert.equal(PVP.hp - f.hp, 3 + 1)
    applyShock(f); f.shock.owner = 'a'
    ticks(m, 31)                                  // the first stroke at 1 s
    assert.equal(PVP.hp - f.hp, 3 + 1 + 1)
  })
  it("an arrow in a match carries the archer's Might when it lands", () => {
    const { m, a, f } = duel('archer', 'mage')
    grantBuff(a, 'might', 'major')
    ticks(m, 20, shoot)
    assert.equal(PVP.hp - f.hp, 2 + 2)            // the shortbow's 2 + 2
  })
  it("the fireball's burst carries it; the patch it lays does not", () => {
    const { a, f, m } = pair('mage', 'archer')
    grantBuff(a, 'might', 'minor')
    detonateFireball(m, f.px, f.py, 3, {}, { owner: 'a', struck: null })
    assert.equal(PVP.hp - f.hp, 2 + 1)
    for (let i = 0; i < 30; i++) tickFireZones(m, dt)
    assert.equal(PVP.hp - f.hp, 2 + 1 + 1, 'the first patch tick is a plain 1')
  })
  it('comes from the attacker: a Might on the victim adds nothing', () => {
    const { a, f, m } = pair()
    grantBuff(f, 'might', 'major')
    blow(m, a)
    assert.equal(PVP.hp - f.hp, 2)
  })
})

describe('Ward', () => {
  it('soaks a whole hit: no hp lost, yet the hit lands — i-frames and credit — and the pool is spent', () => {
    const { a, f, m } = pair()
    grantBuff(f, 'ward', 'minor')
    assert.equal(hurtHero(m, f, 2, { by: a, direct: true }), true)
    assert.equal(f.hp, PVP.hp)
    assert.equal(f.invulnTimer, INVULN_DURATION)
    assert.equal(f.lastHitBy.id, 'a')
    assert.equal(f.buffs.ward, null, 'a pool at 0 breaks the ward')
  })
  it('a major pool of 4 soaks 3 and keeps 1; the next hit spills over', () => {
    const { a, f, m } = pair()
    grantBuff(f, 'ward', 'major')
    hurtHero(m, f, 3, { by: a })
    assert.equal(f.hp, PVP.hp); assert.equal(f.buffs.ward.pool, 1)
    f.invulnTimer = 0
    hurtHero(m, f, 3, { by: a })
    assert.equal(f.hp, PVP.hp - 2); assert.equal(f.buffs.ward, null)
  })
  it('soaks every kind: a burn tick and a fire-patch tick too', () => {
    const { a, f, m } = pair()
    grantBuff(f, 'ward', 'minor')
    hurtHero(m, f, 1, { kind: 'dot', by: a })
    hurtHero(m, f, 1, { kind: 'fire', by: a })
    assert.equal(f.hp, PVP.hp); assert.equal(f.buffs.ward, null)
  })
  it("a buckler's block comes first: a blocked blow leaves the pool alone", () => {
    const { a, f, m } = pair('warrior', 'warrior')
    grantBuff(f, 'ward', 'minor')
    f.facing = 'west'; f.blocking = true
    blow(m, a)
    assert.equal(f.hp, PVP.hp)
    assert.equal(f.buffs.ward.pool, 2)
  })
  it("Might is added before the ward: a 2 blow + 1 against a pool of 2 takes 1 hp", () => {
    const { a, f, m } = pair()
    grantBuff(a, 'might', 'minor'); grantBuff(f, 'ward', 'minor')
    blow(m, a)
    assert.equal(PVP.hp - f.hp, 1)
  })
  it("damagePlayer's soak is optional: single-player's damage is untouched", () => {
    const p = makePlayer(0, 0)
    p.hp = 10
    damagePlayer({ player: p, feedback: makeFeedback() }, 3, 'dot')
    assert.equal(p.hp, 7)
  })
})

describe('the edges', () => {
  it('Ember: a landed direct hit burns the victim for 2 s (minor), credited to the attacker', () => {
    const { a, f, m } = pair()
    grantBuff(a, 'ember', 'minor')
    blow(m, a)
    assert.deepEqual(f.burn, { owner: 'a', t: 2, next: 1 })
    assert.equal(m.fireZones.length, 0, 'a minor lays no patch')
  })
  it('Ember major: a 3 s burn and a 5-tile fire patch under the victim, credited to the attacker', () => {
    const { a, f, m } = pair()
    grantBuff(a, 'ember', 'major')
    blow(m, a)
    assert.equal(f.burn.t, 3)
    assert.equal(m.fireZones.length, 1)
    assert.equal(m.fireZones[0].owner, 'a')
    assert.equal(m.fireZones[0].tiles.length, 5)
    assert.ok(m.fireZones[0].tiles.some(t => t.x === f.x && t.y === f.y))
  })
  it('a major Ember hit on a hero in a corner lays its patch only on floor', () => {
    const a = hero('a', 'warrior', { x: 2, y: 1 }), f = hero('f', 'archer', { x: 1, y: 1 })
    a.facing = 'west'
    const m = testMatch([a, f])
    grantBuff(a, 'ember', 'major')
    blow(m, a)
    const tiles = m.fireZones[0].tiles
    assert.equal(tiles.length, 5)
    for (const t of tiles) assert.ok(t.x >= 1 && t.y >= 1, `${t.x},${t.y} is a wall`)
  })
  it("a newer Ember patch replaces the same attacker's older one; another's stays", () => {
    const { a, f, m } = pair()
    grantBuff(a, 'ember', 'major')
    m.fireZones.push({ tiles: [{ x: 1, y: 1 }], age: 0, tickTimer: 1, owner: 'z' })
    blow(m, a); f.invulnTimer = 0; a.meleeCooldown = 0
    blow(m, a)
    assert.deepEqual(m.fireZones.map(z => z.owner), ['z', 'a'])
  })
  it('Venom: a poison for 3 s and a 20 % slow (minor); 4.5 s and 35 % (major)', () => {
    for (const [tier, t, mul] of [['minor', 3, 0.8], ['major', 4.5, 0.65]]) {
      const { a, f, m } = pair()
      grantBuff(a, 'venom', tier)
      blow(m, a)
      assert.deepEqual(f.poison, { owner: 'a', t, next: 1.5 }, tier)
      assert.ok(Math.abs(f.slowMul - mul) < 1e-9); assert.equal(f.slowTimer, t)
    }
  })
  it('a stronger slow already running stays', () => {
    const { a, f, m } = pair()
    grantBuff(a, 'venom', 'minor')
    f.slowTimer = 1; f.slowMul = 0.4
    blow(m, a)
    assert.equal(f.slowMul, 0.4); assert.equal(f.slowTimer, 1)
  })
  it('no edge on a blocked hit, nor on one a Ward soaks whole; a hit the Ward only dents does coat', () => {
    const blocked = pair('warrior', 'warrior')
    grantBuff(blocked.a, 'ember', 'minor')
    blocked.f.facing = 'west'; blocked.f.blocking = true
    blow(blocked.m, blocked.a)
    assert.equal(blocked.f.burn, null)

    const soaked = pair()
    grantBuff(soaked.a, 'venom', 'minor'); grantBuff(soaked.f, 'ward', 'major')
    blow(soaked.m, soaked.a)
    assert.equal(soaked.f.poison, null); assert.equal(soaked.f.slowTimer, 0)

    const dented = pair()
    grantBuff(dented.a, 'venom', 'minor'); grantBuff(dented.f, 'ward', 'minor')
    grantBuff(dented.a, 'might', 'minor')
    blow(dented.m, dented.a)
    assert.equal(PVP.hp - dented.f.hp, 1)
    assert.equal(dented.f.poison.owner, 'a')
  })
  it('no edge from a damage-over-time or patch tick', () => {
    const { a, f, m } = pair()
    grantBuff(a, 'venom', 'major')
    hurtHero(m, f, 1, { kind: 'dot', by: a })
    hurtHero(m, f, 1, { kind: 'fire', by: a })
    assert.equal(f.poison, null)
  })
  it('re-applying refreshes the time, takes the new owner and keeps the tick clock', () => {
    const f = hero('f', 'mage', { x: 5, y: 5 })
    setDot(f, 'burn', 'a', 2)
    f.burn.t = 0.5; f.burn.next = 0.5
    setDot(f, 'burn', 'b', 2)
    assert.deepEqual(f.burn, { owner: 'b', t: 2, next: 0.5 })
    setDot(f, 'burn', 'b', 2); f.burn.t = 3
    setDot(f, 'burn', 'a', 2)
    assert.equal(f.burn.t, 3, 'never shortened')
  })
  it("Venom's slow in a match lasts PVP.ccMul of its 3 s", () => {
    const { m, a, f } = duel('archer', 'mage')
    grantBuff(a, 'venom', 'minor')
    for (let i = 0; i < 20 && !f.poison; i++) stepMatch(m, shoot(i), dt)
    assert.ok(f.poison, 'the arrow landed')
    assert.ok(Math.abs(f.slowTimer - 3 * PVP.ccMul) < 1e-9, `slowTimer ${f.slowTimer}`)
    assert.ok(Math.abs(f.slowMul - 0.8) < 1e-9)
  })
})

describe('tickDots', () => {
  const burning = (kind, dur) => {
    const { m, a, f } = duel('warrior', 'mage', { x: 3, y: 8 }, { x: 12, y: 8 })
    setDot(f, kind, 'a', dur)
    return { m, a, f }
  }
  it('a minor burn deals 1 a second for 2 s — 2 in all — then ends', () => {
    const { m, f } = burning('burn', 2)
    ticks(m, 29); assert.equal(f.hp, PVP.hp)
    ticks(m, 1); assert.equal(f.hp, PVP.hp - 1)
    ticks(m, 30); assert.equal(f.hp, PVP.hp - 2); assert.equal(f.burn, null)
    ticks(m, 60); assert.equal(f.hp, PVP.hp - 2)
  })
  it('a 3 s burn deals 3; poison deals 1 every 1.5 s: 2 over 3 s, 3 over 4.5 s', () => {
    for (const [kind, dur, total] of [['burn', 3, 3], ['poison', 3, 2], ['poison', 4.5, 3]]) {
      const { m, f } = burning(kind, dur)
      ticks(m, Math.round(dur / dt) + 30)
      assert.equal(PVP.hp - f.hp, total, `${kind} ${dur}`)
      assert.equal(f[kind], null)
    }
  })
  it("ticks are unblockable 'dot' damage credited to the owner, and do not reset i-frames", () => {
    const { m, f } = burning('burn', 2)
    f.blocking = true; f.invulnTimer = 5
    const ev = []
    for (let i = 0; i < 30; i++) ev.push(...stepMatch(m, {}, dt))
    assert.equal(f.hp, PVP.hp - 1)
    assert.deepEqual(ev.filter(e => e.type === 'hit').map(e => [e.target, e.by, e.amount]), [['f', 'a', 1]])
    assert.equal(f.lastHitBy.id, 'a')
  })
  it('a damage-over-time kill counts for the owner', () => {
    const { m, a, f } = burning('poison', 3)
    f.hp = 1
    const ev = []
    for (let i = 0; i < 50; i++) ev.push(...stepMatch(m, {}, dt))
    assert.deepEqual(ev.filter(e => e.type === 'kill'), [{ type: 'kill', victim: 'f', killer: 'a' }])
    assert.equal(a.kills, 1)
    assert.equal(f.poison, null, 'the death cleared it')
  })
  it('an owner who has died (not left) still gets the kill', () => {
    const { m, a, f } = burning('burn', 2)
    a.hp = 0; stepMatch(m, {}, dt)                 // the owner dies first
    assert.equal(a.dead, true)
    f.hp = 1
    const ev = []
    for (let i = 0; i < 30; i++) ev.push(...stepMatch(m, {}, dt))
    assert.deepEqual(ev.filter(e => e.type === 'kill' && e.victim === 'f'), [{ type: 'kill', victim: 'f', killer: 'a' }])
  })
  it('an owner who has left credits nobody, and the burn still burns', () => {
    const { m, f } = burning('burn', 2)
    m.heroes.push(makeHero({ id: 'x', name: 'x', cls: 'mage' }))   // a third hero, so the match keeps two
    placeHero(m.heroes[2], { x: 20, y: 20 })
    removeHero(m, 'a')
    const ev = []
    for (let i = 0; i < 30; i++) ev.push(...stepMatch(m, {}, dt))
    assert.equal(f.hp, PVP.hp - 1)
    assert.deepEqual(ev.filter(e => e.type === 'hit').map(e => e.by), [null])
    assert.equal(f.lastHitBy, null)
  })
  it('a spawn-protected hero takes no tick, and the dot runs on', () => {
    const { m, f } = burning('burn', 2)
    f.spawnProtect = 5
    tickDots(m, 1)
    assert.equal(f.hp, PVP.hp)
    assert.ok(Math.abs(f.burn.t - 1) < 1e-9)
  })
  it('a dead hero is skipped', () => {
    const { m, f } = burning('burn', 2)
    f.dead = true
    tickDots(m, 1)
    assert.equal(f.burn.t, 2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pvp-edges.test.js 2>&1 | grep -E "^# (pass|fail)|Error"`
Expected: FAIL — `Cannot find module '…/renderer/pvp/dots.js'`.

- [ ] **Step 3: The soak seam and the Ward**

In `renderer/systems/player-damage.js`:
- Replace

```js
// untouched. Returns whether damage landed (a block returns false and sets
// player.blockedHit for the striker).
```

with

```js
// untouched. Returns whether damage landed (a block returns false and sets
// player.blockedHit for the striker). `soak` (PvP's Ward, 2b) may take some
// or all of what gets past the block and the outfit before hp does: it
// returns what is left. Single-player never passes one.
```

- Replace the signature line `export function damagePlayer(state, amount, kind, from = null, hero = state.player) {` with `export function damagePlayer(state, amount, kind, from = null, hero = state.player, soak = null) {`.
- Directly after the line `  if (kind === 'hit') amount = Math.max(0, amount - (outfitOf(player, player.attackMode ?? 'melee')?.protect ?? 0))` add `  if (soak) amount = soak(player, amount)`.

In `renderer/pvp/buffs.js`, directly above `// A deep copy, for the snapshot and for hydrating one.` add:

```js
// Ward (damagePlayer's `soak`): takes what it can of `amount` from the pool
// and returns the rest; a pool emptied breaks the ward.
export function soakWard(hero, amount) {
  const w = hero.buffs?.ward
  if (!w || amount <= 0) return amount
  const soaked = Math.min(w.pool, amount)
  w.pool -= soaked
  if (w.pool <= 0) hero.buffs.ward = null
  return amount - soaked
}
```

- [ ] **Step 4: The edges**

Create `renderer/pvp/dots.js`:

```js
// The elemental edges (2b spec §1): what a landed direct hit from a hero
// holding Ember or Venom leaves on the victim — a burn or a poison
// (`hero.burn` / `hero.poison` = { owner, t, next }, dealt by the sim's
// tickDots), Venom's slow, and a major Ember's fire patch. Pure: no DOM.
import { computeBlastTiles, makeFireZone } from '../systems/fire.js'
import { applySlow } from '../systems/status.js'
import { BUFFS, DOTS } from '../data/pvp.js'

// A burn or a poison from `owner` for `dur` s. Re-applying refreshes the
// time (never shortening it) and takes the new owner, but keeps the tick
// clock running: hits landing faster than the interval must not keep
// pushing the next tick away.
export function setDot(target, kind, owner, dur) {
  const d = target[kind]
  if (d) { d.owner = owner; d.t = Math.max(d.t, dur); return d }
  return (target[kind] = { owner, t: dur, next: DOTS[kind].interval })
}

// Called by hurtHero on a landed direct hit that took hp (not blocked, not
// soaked whole by a Ward), when the attacker holds an edge.
export function applyEdge(match, by, target) {
  const edge = by.buffs?.edge
  if (!edge) return
  const def = BUFFS[edge.kind][edge.tier]
  if (edge.kind === 'ember') {
    setDot(target, 'burn', by.id, def.burn)
    if (def.emberPatchTiles) layEmberPatch(match, by, target, def.emberPatchTiles)
    return
  }
  setDot(target, 'poison', by.id, def.poison)
  // Venom's slow rides the ordinary slow timer (so PVP.ccMul scales it in a
  // match) for as long as the poison; a stronger slow already running stays.
  const mul = 1 - def.slow
  if (!(target.slowTimer > 0) || target.slowMul >= mul) applySlow(target, mul, def.poison)
}

// A major Ember's patch under the victim: a fire zone of emberPatchTiles
// tiles credited to the attacker, burning like the fireball's. One per
// attacker: a newer one replaces the older, so a flurry of hits does not
// stack patches.
function layEmberPatch(match, by, target, n) {
  const tiles = computeBlastTiles(match.map, target.x, target.y, n)
  if (!tiles.length) return
  match.fireZones = match.fireZones.filter(z => !(z.edge && z.owner === by.id))
  match.fireZones.push({ ...makeFireZone(tiles), owner: by.id, edge: true })
}
```

In `renderer/pvp/combat.js`:
- Below `import { BLOCK_SHOVE } from '../systems/shield.js'` add

```js
import { mightBonus, soakWard } from './buffs.js'
import { applyEdge } from './dots.js'
```

- Replace

```js
// Blocks still apply to each.
export function hurtHero(match, target, amount, { kind = 'hit', by = null, from = null, melee = false, group = null } = {}) {
  if (!isTargetable(target)) return false
  if (by && by === target) return false
```

with

```js
// Blocks still apply to each.
//
// direct (2b): a melee blow or combo hit, a projectile, a lightning strike or
// the fireball's burst — the hits the attacker's Might adds to (before the
// block and the Ward) and its edge coats. Damage-over-time, fire-patch and
// shock ticks, and the hammer's chain, are not direct. The target's Ward
// soaks every kind, after the block; a hit it soaks whole still lands
// (i-frames, credit) but coats nothing.
export function hurtHero(match, target, amount, { kind = 'hit', by = null, from = null, melee = false, group = null, direct = false } = {}) {
  if (!isTargetable(target)) return false
  if (by && by === target) return false
  if (direct && by) amount += mightBonus(by)
```

- Replace `  const landed = damagePlayer(match, amount, kind, at, target)` with `  const landed = damagePlayer(match, amount, kind, at, target, soakWard)`.
- Replace

```js
  match.events.push({ type: 'hit', target: target.id, by: by?.id ?? null, amount: before - target.hp })
  return true
```

with

```js
  match.events.push({ type: 'hit', target: target.id, by: by?.id ?? null, amount: before - target.hp })
  if (direct && by && target.hp < before) applyEdge(match, by, target)
  return true
```

`combat.js` and `dots.js` do not import each other in a cycle: `dots.js` needs nothing from `combat.js`.

- [ ] **Step 5: Mark every direct hit**

In `renderer/pvp/attacks.js`, add `direct: true` to the four melee hits:
- in `lungeHit`: `if (hurtHero(match, first, L.damage, { by: hero, melee: true }))` → `if (hurtHero(match, first, L.damage, { by: hero, melee: true, direct: true }))`;
- in `thrust`: `if (hurtHero(match, e, F.damage, { by: hero, melee: true, group: mv.group }))` → `if (hurtHero(match, e, F.damage, { by: hero, melee: true, group: mv.group, direct: true }))`;
- in `whirl`: `if (!hurtHero(match, e, Wh.damage, { by: hero, melee: true })) continue` → `if (!hurtHero(match, e, Wh.damage, { by: hero, melee: true, direct: true })) continue`;
- in `swing`: `if (!hurtHero(match, e, dmg + shatterBonus(e), { by: hero, melee: true })) continue` → `if (!hurtHero(match, e, dmg + shatterBonus(e), { by: hero, melee: true, direct: true })) continue`.

The hammer's chain (`applyChain`'s `hurt`) stays as it is: not direct.

In `renderer/pvp/sim.js`:
- Replace `import { PVP, KITS, SPELL_OVERRIDES } from '../data/pvp.js'` with `import { PVP, KITS, SPELL_OVERRIDES, DOTS } from '../data/pvp.js'`.
- In `projectileHooks`, replace

```js
    const landed = hurtHero(match, target, damage, { by: heroById(match, p?.owner), from: { px: p.px, py: p.py }, group: p?.group ?? null })
```

with

```js
    const landed = hurtHero(match, target, damage, { by: heroById(match, p?.owner), from: { px: p.px, py: p.py }, group: p?.group ?? null, direct: true })
```

- In `detonateFireball`, replace

```js
      if (h !== struck && overlapsTiles(h, keys)) hurtHero(match, h, SPELL_OVERRIDES.fireball.burst, { kind: 'fire', by })
```

with

```js
      if (h !== struck && overlapsTiles(h, keys)) hurtHero(match, h, SPELL_OVERRIDES.fireball.burst, { kind: 'fire', by, direct: true })
```

- In `tick`, replace

```js
    hurt: (e, d, info) => { hurtHero(match, e, d, { kind: 'lightning', by: heroById(match, info?.owner) }) },
```

with

```js
    hurt: (e, d, info) => { hurtHero(match, e, d, { kind: 'lightning', by: heroById(match, info?.owner), direct: true }) },
```

(`tickFireZones`' hurt and the `tickShock` hurt stay as they are.)

- [ ] **Step 6: Burns and poisons tick**

In `renderer/pvp/sim.js`, directly above `const CC_FIELDS = ['stunTimer', 'slowTimer', 'rootTimer']` add:

```js
// Burns and poisons (2b): DOTS[kind].damage every DOTS[kind].interval as
// unblockable 'dot' damage credited to whoever applied it — nobody, once
// they have left the match — until the time runs out.
export function tickDots(match, dt) {
  for (const h of match.heroes) {
    if (h.dead) continue
    for (const kind of ['burn', 'poison']) {
      const d = h[kind]
      if (!d) continue
      d.t -= dt
      d.next -= dt
      if (d.next <= 1e-9) {
        d.next += DOTS[kind].interval
        hurtHero(match, h, DOTS[kind].damage, { kind: 'dot', by: heroById(match, d.owner) })
      }
      if (d.t <= 1e-9) h[kind] = null
    }
  }
}
```

In `tick`, replace

```js
  tickFireZones(match, dt)
  for (const h of match.heroes) {
```

with

```js
  tickFireZones(match, dt)
  tickDots(match, dt)
  for (const h of match.heroes) {
```

`tickDots` runs before `scaleNewCC`, which is what scales a Venom slow landed this tick; and it runs before `resolveDeaths`, so a damage-over-time kill is resolved on its own tick.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test test/pvp-edges.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: PASS (31 tests).

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0` (single-player's damage path is unchanged: nothing passes a `soak`).

- [ ] **Step 8: Commit**

```bash
git add renderer/systems/player-damage.js renderer/pvp/buffs.js renderer/pvp/dots.js renderer/pvp/combat.js renderer/pvp/attacks.js renderer/pvp/sim.js test/pvp-edges.test.js
git commit -m "feat(pvp): Might, Ward and the Ember/Venom edges in hurtHero; tickDots

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 4: Buff spots — the `b`/`B` letters, rolls, taking, respawn and ghosts; two `b` per small arena

**Files:**
- Modify: `renderer/data/pvp-arenas.js` (`parseArena`, the Glade/Tunnels/Ruins grids, Pillars' pickups)
- Modify: `renderer/pvp/pickups.js` (`makePickups`, `take`, `tickPickups`), `renderer/pvp/sim.js` (`makePickups(arena, rng)`)
- Modify: `test/pvp-helpers.js` (`testMatch` gets `rng`)
- Modify: `test/pvp-pickups.test.js`, `test/pvp-arenas.test.js`, `test/pvp-ui.test.js`, `test/net-protocol.test.js`

**Interfaces:**
- Consumes: `rollBuff`, `mulberry32` (Task 1); `grantBuff` (Task 2); `BUFF_SPOTS`.
- Produces:
  - an arena pickup `{ kind: 'buff', tier: 'minor' | 'major', x, y }` (grid `b` / `B`);
  - `makePickups(arena, rng = mulberry32(1))`: a spot is `{ kind: 'buff', tier, x, y, px, py, up, t, buff, next }` — up: `buff` set, `next: null`; down: `buff: null`, `next` set (the ghost);
  - `tickPickups(match, dt)` rolls from `match.rng`; a take pushes `{ type: 'pickup', kind: 'buff', hero, buff, tier }`, the `pickup` cue, and a float `{ text: '+', kind: <buff> }`;
  - every small arena has exactly 2 minor spots (Pillars `22,5` and `9,18`; Glade `20,3`/`9,18`; Tunnels `10,11`/`23,12`; Ruins `24,2`/`11,23`), each point-symmetric about the arena's centre.

- [ ] **Step 1: Write the failing tests**

In `test/pvp-helpers.js`:
- Below `import { refreshTargets } from '../renderer/pvp/combat.js'` add `import { mulberry32 } from '../renderer/pvp/rng.js'`.
- In `testMatch`, replace `    clock: 0, acc: 0, ended: false, events: [], inputs: {} }` with `    clock: 0, acc: 0, ended: false, events: [], inputs: {}, rng: mulberry32(1) }`.

In `test/pvp-pickups.test.js`, replace

```js
import { PICKUPS, PVP } from '../renderer/data/pvp.js'
import { testMatch } from './pvp-helpers.js'
```

with

```js
import { PICKUPS, PVP, BUFF_SPOTS, BUFF_KINDS } from '../renderer/data/pvp.js'
import { mulberry32 } from '../renderer/pvp/rng.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { testMatch } from './pvp-helpers.js'
```

and append at the end of the file:

```js
describe('buff spots (2b)', () => {
  const spots = [{ kind: 'buff', tier: 'minor', x: 3, y: 3 }, { kind: 'buff', tier: 'major', x: 8, y: 8 }]
  const spotMatch = (heroes, rngSeed = 5) => { const m = testMatch(heroes); m.rng = mulberry32(rngSeed); m.pickups = makePickups({ pickups: spots }, m.rng); return m }
  it('a minor spot starts up with a rolled buff; a major waits majorFirstSpawn with its roll as the ghost', () => {
    const [b, B] = makePickups({ pickups: spots }, mulberry32(5))
    assert.equal(b.kind, 'buff'); assert.equal(b.tier, 'minor')
    assert.equal(b.up, true); assert.equal(b.t, 0); assert.equal(b.next, null)
    assert.ok(BUFF_KINDS.includes(b.buff))
    assert.equal(B.up, false); assert.equal(B.t, BUFF_SPOTS.majorFirstSpawn); assert.equal(B.buff, null)
    assert.ok(BUFF_KINDS.includes(B.next))
    assert.deepEqual(makePickups({ pickups: spots }, mulberry32(5)), [b, B], 'the same seed rolls the same')
  })
  it('walking onto an up spot takes it: the buff, the event, the cue and a float of its colour', () => {
    const h = hero('a', 'warrior')
    const m = spotMatch([h])
    m.sfx = makeSfx(false)
    const kind = m.pickups[0].buff
    tickPickups(m, 0.1)
    assert.equal(h.buffs[kind === 'ember' || kind === 'venom' ? 'edge' : kind].tier, 'minor')
    assert.deepEqual(m.events, [{ type: 'pickup', kind: 'buff', hero: 'a', buff: kind, tier: 'minor' }])
    assert.deepEqual(m.sfx.cues.map(c => c.name), ['pickup'])
    assert.deepEqual(m.feedback.floats.map(f => [f.text, f.kind]), [['+', kind]])
  })
  it('a taken spot goes down for its respawn with the next roll showing, then comes back with that buff', () => {
    const h = hero('a', 'mage')
    const m = spotMatch([h])
    tickPickups(m, 0.1)
    const b = m.pickups[0]
    assert.equal(b.up, false); assert.equal(b.t, BUFF_SPOTS.minorRespawn); assert.equal(b.buff, null)
    const ghost = b.next
    assert.ok(BUFF_KINDS.includes(ghost))
    placeHero(h, { x: 12, y: 12 })
    tickPickups(m, BUFF_SPOTS.minorRespawn - 0.5)
    assert.equal(b.up, false)
    tickPickups(m, 0.5)
    assert.equal(b.up, true); assert.equal(b.buff, ghost); assert.equal(b.next, null)
  })
  it('the major spot comes up at majorFirstSpawn and, taken, stays down majorRespawn', () => {
    const h = hero('a', 'archer', { x: 8, y: 8 })
    const m = spotMatch([h])
    tickPickups(m, BUFF_SPOTS.majorFirstSpawn - 0.1)
    assert.equal(m.pickups[1].up, false)
    assert.equal(h.buffs.haste ?? h.buffs.might ?? h.buffs.ward ?? h.buffs.edge, null)
    tickPickups(m, 0.2)                        // up this tick
    tickPickups(m, PVP.tick)                   // taken by the hero standing on it
    assert.equal(m.pickups[1].up, false)
    assert.equal(m.pickups[1].t, BUFF_SPOTS.majorRespawn)
    assert.equal(m.events.at(-1).tier, 'major')
  })
  it('two heroes on one spot in one tick: only the first takes it, and there is one event', () => {
    const a = hero('a', 'warrior'), b = hero('b', 'mage')
    const m = spotMatch([a, b])
    const kind = m.pickups[0].buff
    tickPickups(m, 0.1)
    const holds = h => Object.values(h.buffs).some(Boolean)
    assert.equal(holds(a), true); assert.equal(holds(b), false)
    assert.deepEqual(m.events.map(e => e.hero), ['a'])
    assert.equal(m.events[0].buff, kind)
  })
  it('any class takes any buff; a dead hero takes nothing', () => {
    for (const cls of ['warrior', 'archer', 'mage']) {
      const m = spotMatch([hero('a', cls)])
      tickPickups(m, 0.1)
      assert.equal(m.pickups[0].up, false, cls)
    }
    const d = hero('d', 'warrior'); d.dead = true
    const m = spotMatch([d])
    tickPickups(m, 0.1)
    assert.equal(m.pickups[0].up, true)
  })
  it("every roll comes from match.rng: one seed replays one sequence, and all five kinds come up", () => {
    const run = seed => {
      const h = hero('a', 'warrior')
      const m = spotMatch([h], seed)
      const got = []
      for (let i = 0; i < 60; i++) { got.push(m.pickups[0].buff); tickPickups(m, 0.1); tickPickups(m, BUFF_SPOTS.minorRespawn) }
      return got
    }
    assert.deepEqual(run(11), run(11))
    assert.notDeepEqual(run(11), run(12))
    assert.deepEqual(new Set(run(11)).size, 5)
  })
})
```

In `test/pvp-arenas.test.js`:
- Directly above `  it('turns a grid into the arena shape: interior # walls, o columns, S spawns, F/Q/R pickups in reading order', () => {` add

```js
  it('b and B are minor and major buff spots, in reading order with the other pickups (2b)', () => {
    const a = parseArena('t', [
      '######',
      '#SbF.#',
      '#.B.S#',
      '######',
    ], { floorTile: 'floor' })
    assert.deepEqual(a.pickups, [{ kind: 'buff', tier: 'minor', x: 2, y: 1 }, { kind: 'flask', x: 3, y: 1 },
      { kind: 'buff', tier: 'major', x: 2, y: 2 }])
  })
```

- Replace

```js
    it('has exactly 6 spawns, 2 flasks, 2 quivers and 1 rune, all on walkable cells', () => {
      const n = k => arena.pickups.filter(p => p.kind === k).length
      assert.equal(arena.spawns.length, 6)
      assert.deepEqual([n('flask'), n('quiver'), n('rune')], [2, 2, 1])
      assert.equal(arena.pickups.length, 5)
```

with

```js
    it('has exactly 6 spawns, 2 flasks, 2 quivers, 1 rune and 2 minor buff spots, all on walkable cells', () => {
      const n = k => arena.pickups.filter(p => p.kind === k).length
      const spots = tier => arena.pickups.filter(p => p.kind === 'buff' && p.tier === tier).length
      assert.equal(arena.spawns.length, 6)
      assert.deepEqual([n('flask'), n('quiver'), n('rune'), spots('minor'), spots('major')], [2, 2, 1, 2, 0])
      assert.equal(arena.pickups.length, 7)
```

(the loop body that follows, checking each cell is walkable, stays).
- Directly after the `'the rune is at least 5 tiles from every spawn'` test add

```js
    it('every minor buff spot is at least 4 tiles from every spawn, and no two pickups share a cell', () => {
      for (const b of arena.pickups.filter(p => p.kind === 'buff' && p.tier === 'minor'))
        for (const s of arena.spawns) assert.ok(tiles({ a: s, b }) >= 4, `b ${b.x},${b.y} spawn ${s.x},${s.y}`)
      const cells = [...arena.spawns, ...arena.pickups].map(c => `${c.x},${c.y}`)
      assert.equal(new Set(cells).size, cells.length)
    })
```

In `test/pvp-ui.test.js`, replace `    assert.equal(v.entities.length, 4)   // the rune is not up yet` with `    assert.equal(v.entities.length, 6)   // 2 flasks, 2 quivers and 2 minor buff spots; the rune is not up yet`.

In `test/net-protocol.test.js`, replace `    assert.equal(body.pickups.length, 5)` with `    assert.equal(body.pickups.length, 7)   // pillars: 2 flasks, 2 quivers, the rune, 2 minor buff spots (2b)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/pvp-pickups.test.js test/pvp-arenas.test.js test/pvp-ui.test.js test/net-protocol.test.js 2>&1 | grep -E "^# (pass|fail)|    not ok"`
Expected: FAIL — the buff-spot tests (`makePickups` ignores the rng; no spot is `kind: 'buff'`), `parseArena` refuses `b` ("unknown cell 'b'"), every arena has 0 minor spots, and the view/snapshot counts are 4 and 5.

- [ ] **Step 3: The letters and the spots on the four small arenas**

In `renderer/data/pvp-arenas.js`:
- Replace

```js
const PICKUP_KIND = { F: 'flask', Q: 'quiver', R: 'rune' }

// A grid of equal-length strings → the arena shape. Legend: # wall (the
// border must be walls), o column, . floor, S spawn, F flask, Q quiver,
// R rune. Spawns and pickups are listed in reading order.
```

with

```js
const PICKUP_KIND = { F: 'flask', Q: 'quiver', R: 'rune' }
const BUFF_TIER = { b: 'minor', B: 'major' }

// A grid of equal-length strings → the arena shape. Legend: # wall (the
// border must be walls), o column, . floor, S spawn, F flask, Q quiver,
// R rune, b a minor buff spot, B a major one (2b). Spawns and pickups are
// listed in reading order.
```

- In `parseArena`, directly after `    else if (PICKUP_KIND[ch]) pickups.push({ kind: PICKUP_KIND[ch], x, y })` add `    else if (BUFF_TIER[ch]) pickups.push({ kind: 'buff', tier: BUFF_TIER[ch], x, y })`.
- In `GLADE`, row 3 (the first `'#...##..................##...#',`) becomes `'#...##..............b...##...#',` and row 18 (the third such row, directly above the lower `'#.S...........##...........S.#',`) becomes `'#...##...b..............##...#',`.
- In `TUNNELS`, replace the two rows

```js
  '####............R............F####',
  '####F.........................####',
```

with

```js
  '####......b.....R............F####',
  '####F..................b......####',
```

- In `RUINS`, row 2 (the first `'#.S..............................S.#',`) becomes `'#.S.....................b........S.#',` and row 23 (the second) becomes `'#.S........b.....................S.#',`.
- In Pillars' `pickups`, directly after `      { kind: 'rune', x: 16, y: 12 },` add `      { kind: 'buff', tier: 'minor', x: 22, y: 5 }, { kind: 'buff', tier: 'minor', x: 9, y: 18 },`.

The spots were chosen by script over every point-symmetric pair of floor cells: at least 5 tiles from every spawn and 4 from every other pickup, open on most sides.

- [ ] **Step 4: Spots in the sim**

In `renderer/pvp/pickups.js`:
- Replace the header comment's first three lines with

```js
// Contested pickups: walk-onto flasks, Archer-only quivers, the power rune
// and the buff spots (2b), each on its own respawn timer; and the rune's
// swap of a hero's main hand for its class's power weapon. Pure: no DOM.
```

- Replace

```js
import { PICKUPS, RUNE_POWER } from '../data/pvp.js'

export function makePickups(arena) {
  return arena.pickups.map(p => ({
    kind: p.kind, x: p.x, y: p.y, px: p.x * TILE_SIZE + TILE_SIZE / 2, py: p.y * TILE_SIZE + TILE_SIZE / 2,
    up: p.kind !== 'rune', t: p.kind === 'rune' ? PICKUPS.rune.firstSpawn : 0,
  }))
}
```

with

```js
import { PICKUPS, RUNE_POWER, BUFF_SPOTS } from '../data/pvp.js'
import { grantBuff } from './buffs.js'
import { mulberry32, rollBuff } from './rng.js'

// A buff spot also carries its tier, `buff` (the kind up now, null while
// down) and `next` (the kind it will bring back: the ghost drawn while it
// is down). A minor spot starts up; a major one waits majorFirstSpawn.
// Every roll draws from `rng` — the match's own (makeMatch passes it).
export function makePickups(arena, rng = mulberry32(1)) {
  return arena.pickups.map(p => {
    const base = { kind: p.kind, x: p.x, y: p.y, px: p.x * TILE_SIZE + TILE_SIZE / 2, py: p.y * TILE_SIZE + TILE_SIZE / 2 }
    if (p.kind !== 'buff') return { ...base, up: p.kind !== 'rune', t: p.kind === 'rune' ? PICKUPS.rune.firstSpawn : 0 }
    const major = p.tier === 'major'
    const kind = rollBuff(rng)
    return { ...base, tier: p.tier, up: !major, t: major ? BUFF_SPOTS.majorFirstSpawn : 0,
      buff: major ? null : kind, next: major ? kind : null }
  })
}

// How long a taken pickup stays down.
const respawnOf = p => p.kind === 'buff'
  ? (p.tier === 'major' ? BUFF_SPOTS.majorRespawn : BUFF_SPOTS.minorRespawn)
  : PICKUPS[p.kind].respawn
```

- In `take`, replace

```js
  if (p.kind === 'rune') return grantRune(match, hero)
  return false
}
```

with

```js
  if (p.kind === 'rune') return grantRune(match, hero)
  if (p.kind === 'buff') {
    // Any class takes any buff, whatever it already holds (buffs.js stacks it).
    grantBuff(hero, p.buff, p.tier)
    addFloat(match.feedback, { px: hero.px, py: hero.py - 10, text: '+', kind: p.buff })
    return true
  }
  return false
}
```

- In `tickPickups`, replace

```js
    if (!p.up) {
      p.t -= dt
      if (p.t <= 0) { p.up = true; p.t = 0 }
      continue
    }
    const taker = match.heroes.find(h => !h.dead && h.x === p.x && h.y === p.y && take(match, h, p))
    if (!taker) continue
    p.up = false
    p.t = PICKUPS[p.kind].respawn
    match.events.push({ type: 'pickup', kind: p.kind, hero: taker.id })
```

with

```js
    if (!p.up) {
      p.t -= dt
      if (p.t <= 0) {
        p.up = true; p.t = 0
        if (p.kind === 'buff') { p.buff = p.next; p.next = null }
      }
      continue
    }
    const taker = match.heroes.find(h => !h.dead && h.x === p.x && h.y === p.y && take(match, h, p))
    if (!taker) continue
    p.up = false
    p.t = respawnOf(p)
    const taken = p.kind === 'buff' ? { buff: p.buff, tier: p.tier } : {}
    // A buff spot rolls what it brings back the moment it is taken, so the
    // ghost shows it for the whole wait.
    if (p.kind === 'buff') { p.next = rollBuff(match.rng); p.buff = null }
    match.events.push({ type: 'pickup', kind: p.kind, hero: taker.id, ...taken })
```

In `renderer/pvp/sim.js`, in `makeMatch`, replace `pickups: makePickups(arena), clock` with `pickups: makePickups(arena, rng), clock`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/pvp-pickups.test.js test/pvp-arenas.test.js test/pvp-ui.test.js test/net-protocol.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: PASS.

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0`. The six-bot soak (`test/pvp-soak.test.js`) now plays through buff spots too. Bots do not seek them yet, but they take whatever they walk over.

- [ ] **Step 6: Commit**

```bash
git add renderer/data/pvp-arenas.js renderer/pvp/pickups.js renderer/pvp/sim.js test/pvp-helpers.js test/pvp-pickups.test.js test/pvp-arenas.test.js test/pvp-ui.test.js test/net-protocol.test.js
git commit -m "feat(pvp): buff spots — b/B letters, seeded rolls, taking, respawn, ghosts; two per small arena

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---
### Task 5: Large arenas — the 60×44 clamp, Keep and Wilds, their invariants, and the rotation's skip

**Files:**
- Modify: `renderer/systems/map.js` (`buildArena`'s clamp)
- Modify: `renderer/data/pvp-arenas.js` (header, `GLADE_THEME`, `KEEP`, `WILDS`, `ARENA_ROWS`, `PVP_ARENAS`, `PVP_ARENA_ORDER`, `playableIndex`)
- Modify: `server/rooms.js` (`startNextMatch`), `renderer/pvp/local.js` (`makeLocalMatch`), `renderer/game.js` (`startPvp`)
- Modify: `test/arena.test.js`, `test/pvp-arenas.test.js`, `test/pvp-ui.test.js`, `test/net-rooms.test.js`

**Interfaces:**
- Consumes: `PVP.largeMinHeroes` (Task 1); the `b`/`B` letters (Task 4).
- Produces:
  - `buildArena` clamps `size` to 8–60 × 8–44;
  - every `PVP_ARENAS` entry has `large: boolean`; `keep` and `wilds` (55×39) are the large ones; `PVP_ARENA_ORDER = ['pillars', 'glade', 'keep', 'tunnels', 'ruins', 'wilds']`;
  - `playableIndex(i, heroes) → index` (from `renderer/data/pvp-arenas.js`);
  - `makeLocalMatch` returns a match with `arenaIndex` (the index actually played).

The two grids below were drawn by generator scripts (mirror/half-turn symmetry, walls and columns stamped, paths carved with a 3×3 or 2×2 brush along waypoints) and then checked by script against every invariant in Step 1. Removing any one walkable cell cuts off at most 0 cells in Keep and at most 1 in Wilds. Keep's fort walls are 2 thick with 3-wide gates. Wilds' paths are 2–3 tiles wide.

- [ ] **Step 1: Write the failing tests**

In `test/arena.test.js`:
- Below `import { TILE } from '../renderer/systems/entities.js'` add

```js
import { PVP_ARENAS } from '../renderer/data/pvp-arenas.js'
import { createHash } from 'node:crypto'
```

- Replace

```js
  it('clamps size to 8×8 … 40×30', () => {
    assert.equal(buildArena({ size: { w: 4, h: 4 }, enemies: [] }).map.length, 8)
    assert.equal(buildArena({ size: { w: 100, h: 100 }, enemies: [] }).map.length, 30)
    assert.equal(buildArena({ size: { w: 100, h: 100 }, enemies: [] }).map[0].length, 40)
  })
```

with

```js
  it('clamps size to 8×8 … 60×44 (2b raised the maximum from 40×30)', () => {
    assert.equal(buildArena({ size: { w: 4, h: 4 }, enemies: [] }).map.length, 8)
    assert.equal(buildArena({ size: { w: 4, h: 4 }, enemies: [] }).map[0].length, 8)
    assert.equal(buildArena({ size: { w: 100, h: 100 }, enemies: [] }).map.length, 44)
    assert.equal(buildArena({ size: { w: 100, h: 100 }, enemies: [] }).map[0].length, 60)
  })

  it('every config inside the old 40×30 clamp builds exactly as before (fingerprints taken before 2b)', () => {
    const print = o => createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12)
    const sizes = { '8x8': 'c02cbf483c53', '26x18': '27645ecded8f', '30x22': '16f64ae34384', '40x30': 'bb0aaeb2f2c5' }
    for (const [k, want] of Object.entries(sizes)) {
      const [w, h] = k.split('x').map(Number)
      assert.equal(print(buildArena({ size: { w, h } }, () => {})), want, k)
    }
    const arenas = { pillars: 'e3ae2a1b1243', glade: '6cb87fdfb79f', tunnels: '8103b0001069', ruins: '5168e926bf13' }
    for (const [id, want] of Object.entries(arenas)) {
      const a = PVP_ARENAS[id]
      const { map } = buildArena({ size: a.size, columns: a.columns, walls: a.walls, player: a.spawns[0], enemies: [], chests: [] }, () => {})
      assert.equal(print(map), want, id)
    }
  })
```

The fingerprints were taken with the code before this task. Every config the repo ships sits inside the old clamp: depth 0's 26×18, `arena-config.json`'s 30×22, the arena-test skill's 26×18 and the four small PvP arenas. So only the maximum moving must leave each of them identical.

In `test/pvp-arenas.test.js`:
- Replace the import of `../renderer/data/pvp-arenas.js` with `import { PVP_ARENAS, PVP_ARENA_ORDER, ARENA_ROWS, parseArena, arenaAt, nextArenaIndex, playableIndex } from '../renderer/data/pvp-arenas.js'`.
- Replace

```js
  it('is pillars, glade, tunnels, ruins, and wraps', () => {
    assert.deepEqual(PVP_ARENA_ORDER, ['pillars', 'glade', 'tunnels', 'ruins'])
    assert.deepEqual([0, 1, 2, 3].map(nextArenaIndex), [1, 2, 3, 0])
    assert.deepEqual([0, 1, 2, 3, 4].map(i => arenaAt(i).id), ['pillars', 'glade', 'tunnels', 'ruins', 'pillars'])
  })
```

with

```js
  it('is pillars, glade, keep, tunnels, ruins, wilds, and wraps', () => {
    assert.deepEqual(PVP_ARENA_ORDER, ['pillars', 'glade', 'keep', 'tunnels', 'ruins', 'wilds'])
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(nextArenaIndex), [1, 2, 3, 4, 5, 0])
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(i => arenaAt(i).id), ['pillars', 'glade', 'keep', 'tunnels', 'ruins', 'wilds', 'pillars'])
  })
  it('keep and wilds are the large arenas', () => {
    assert.deepEqual(PVP_ARENA_ORDER.filter(id => PVP_ARENAS[id].large), ['keep', 'wilds'])
    for (const id of PVP_ARENA_ORDER) assert.equal(typeof PVP_ARENAS[id].large, 'boolean', id)
  })
  it('playableIndex skips a large arena for fewer than PVP.largeMinHeroes heroes, taking the next', () => {
    assert.equal(PVP.largeMinHeroes, 4)
    assert.equal(playableIndex(2, 3), 3, 'keep → tunnels')
    assert.equal(playableIndex(5, 2), 0, 'wilds → pillars, wrapping')
    assert.equal(playableIndex(2, 4), 2)
    assert.equal(playableIndex(5, 6), 5)
    assert.equal(playableIndex(1, 1), 1, 'a small arena is never skipped')
    assert.equal(playableIndex(8, 2), 3, 'an index past the end wraps first')
  })
```

- Directly above `  it('the themes: glade outdoors, tunnels catacombs with the depth-4 tint and fog, ruins the depth-3 sand', () => {` add

```js
  it('the large themes: keep the depth-6 castle look, wilds the glade grass', () => {
    const d6 = DEPTH_THEMES.find(t => t.depths.includes(6))
    for (const k of ['ruleset', 'floorTile', 'bgColor', 'tint', 'fogAlpha']) assert.equal(PVP_ARENAS.keep.theme[k], d6[k], k)
    assert.deepEqual(PVP_ARENAS.wilds.theme, PVP_ARENAS.glade.theme)
  })
```

- In the per-arena loop, replace

```js
  describe(`arena invariants: ${id}`, () => {
    it("fits buildArena's size clamp (8-40 × 8-30) and builds at that size", () => {
      assert.ok(arena.size.w >= 8 && arena.size.w <= 40, `w ${arena.size.w}`)
      assert.ok(arena.size.h >= 8 && arena.size.h <= 30, `h ${arena.size.h}`)
```

with

```js
  const { large } = arena
  describe(`arena invariants: ${id}`, () => {
    it(large ? "a large arena: about 56×40, inside buildArena's 60×44 clamp" : 'a small arena: inside the old 40×30 clamp', () => {
      const [w0, w1, h0, h1] = large ? [50, 60, 36, 44] : [8, 40, 8, 30]
      assert.ok(arena.size.w >= w0 && arena.size.w <= w1, `w ${arena.size.w}`)
      assert.ok(arena.size.h >= h0 && arena.size.h <= h1, `h ${arena.size.h}`)
```

- Replace (Task 4's version)

```js
    it('has exactly 6 spawns, 2 flasks, 2 quivers, 1 rune and 2 minor buff spots, all on walkable cells', () => {
      const n = k => arena.pickups.filter(p => p.kind === k).length
      const spots = tier => arena.pickups.filter(p => p.kind === 'buff' && p.tier === tier).length
      assert.equal(arena.spawns.length, 6)
      assert.deepEqual([n('flask'), n('quiver'), n('rune'), spots('minor'), spots('major')], [2, 2, 1, 2, 0])
      assert.equal(arena.pickups.length, 7)
```

with

```js
    const want = large ? [4, 3, 1, 6, 1] : [2, 2, 1, 2, 0]
    it(`has 6 spawns and ${want.join('/')} flasks/quivers/runes/minor/major spots, all on walkable cells`, () => {
      const n = k => arena.pickups.filter(p => p.kind === k).length
      const spots = tier => arena.pickups.filter(p => p.kind === 'buff' && p.tier === tier).length
      assert.equal(arena.spawns.length, 6)
      assert.deepEqual([n('flask'), n('quiver'), n('rune'), spots('minor'), spots('major')], want)
      assert.equal(arena.pickups.length, want.reduce((t, k) => t + k, 0))
```

- Replace

```js
    it('spawns are at least 6 tiles apart', () => {
      for (const d of pairs(arena.spawns)) assert.ok(tiles(d) >= 6, `${JSON.stringify(d)} ${tiles(d)}`)
    })
```

with

```js
    const gap = large ? 10 : 6
    it(`spawns are at least ${gap} tiles apart`, () => {
      for (const d of pairs(arena.spawns)) assert.ok(tiles(d) >= gap, `${JSON.stringify(d)} ${tiles(d)}`)
    })
```

- Directly above Task 4's `    it('every minor buff spot is at least 4 tiles from every spawn, and no two pickups share a cell', () => {` add

```js
    if (large) it('the major buff spot is at least 8 tiles from every spawn', () => {
      const B = arena.pickups.find(p => p.kind === 'buff' && p.tier === 'major')
      for (const s of arena.spawns) assert.ok(tiles({ a: s, b: B }) >= 8, `spawn ${s.x},${s.y}`)
    })
    if (large) it('has no chokepoint: taking away any one walkable cell cuts at most 4 cells off the rest', () => {
      const W = arena.size.w, H = arena.size.h
      const open = []
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (walk({ x, y })) open.push(y * W + x)
      // The cells cut off with `gone` removed: everything outside the largest piece left.
      const cutOff = gone => {
        const seen = new Set([gone]), sizes = []
        for (const start of open) {
          if (seen.has(start)) continue
          seen.add(start)
          let size = 0
          const stack = [start]
          while (stack.length) {
            const k = stack.pop(); size++
            const x = k % W, y = (k - x) / W
            for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
              const nk = ny * W + nx
              if (!seen.has(nk) && walk({ x: nx, y: ny })) { seen.add(nk); stack.push(nk) }
            }
          }
          sizes.push(size)
        }
        return sizes.reduce((t, s) => t + s, 0) - Math.max(0, ...sizes)
      }
      const bad = open.map(k => [k, cutOff(k)]).filter(([, n]) => n > 4)
      assert.deepEqual(bad.map(([k, n]) => `${k % W},${(k - k % W) / W} cuts ${n}`), [])
    })
```

(A prototype check: walling off Keep's top-left corner so that 18 cells hang off `7,2` makes this test fail with `'7,2 cuts 18'`.)

In `test/pvp-ui.test.js`, replace

```js
    for (let i = 0, k = 0; k < 5; k++, i = nextArenaIndex(i)) ids.push(makeLocalMatch({ cls: 'mage', arenaIndex: i }).arena.id)
    assert.deepEqual(ids, ['pillars', 'glade', 'tunnels', 'ruins', 'pillars'])
```

with

```js
    for (let i = 0, k = 0; k < 7; k++, i = nextArenaIndex(i)) ids.push(makeLocalMatch({ cls: 'mage', arenaIndex: i }).arena.id)
    assert.deepEqual(ids, ['pillars', 'glade', 'keep', 'tunnels', 'ruins', 'wilds', 'pillars'], 'you and 3 bots: large arenas too')
```

and directly above `  it('clamps the bot count to 1-5', () => {` add

```js
  it('a match of fewer than 4 heroes skips the large arenas, and match.arenaIndex is the one played (2b)', () => {
    const ids = []
    for (let i = 0, k = 0; k < 5; k++) {
      const m = makeLocalMatch({ cls: 'mage', bots: 2, arenaIndex: i })
      ids.push(m.arena.id)
      i = nextArenaIndex(m.arenaIndex)
    }
    assert.deepEqual(ids, ['pillars', 'glade', 'tunnels', 'ruins', 'pillars'])
    assert.equal(makeLocalMatch({ cls: 'mage', bots: 2, arenaIndex: 2 }).arenaIndex, 3)
    assert.equal(makeLocalMatch({ cls: 'mage', arenaIndex: 2 }).arenaIndex, 2)
  })
```

In `test/net-rooms.test.js`:
- Add `quickJoin` to the import from `../server/rooms.js`.
- Replace

```js
    assert.deepEqual(ids, ['pillars', 'glade', 'tunnels', 'ruins', 'pillars'])
    assert.equal(room.arenaIndex, 0)
  })
```

with

```js
    assert.deepEqual(ids, ['pillars', 'glade', 'tunnels', 'ruins', 'pillars'], 'two heroes: keep and wilds are skipped (2b)')
    assert.equal(room.arenaIndex, 0)
  })
  it('a room of 4 or more heroes plays the large arenas too: a public room always has, through its bots (2b)', () => {
    const lobby = makeLobby({ matchLength: 1, resultsDelay: 0.5 })
    const { room } = quickJoin(lobby, who('A', 'warrior'))
    assert.equal(room.match.heroes.length, 4)
    const ids = [room.match.arena.id]
    for (let i = 0; i < 6; i++) { nextMatch(lobby, room); ids.push(room.match.arena.id) }
    assert.deepEqual(ids, ['pillars', 'glade', 'keep', 'tunnels', 'ruins', 'wilds', 'pillars'])
    nextMatch(lobby, room); nextMatch(lobby, room)
    assert.equal(room.match.arena.id, 'keep')
    for (const h of room.match.heroes) assert.ok(room.match.arena.spawns.some(s => s.x === h.x && s.y === h.y), h.id)
  })
```

(The 2-hero test's expected list does not change: with two heroes Keep and Wilds are skipped. Only its message is new.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/arena.test.js test/pvp-arenas.test.js test/pvp-ui.test.js test/net-rooms.test.js 2>&1 | grep -E "^# (pass|fail)|Error"`
Expected: FAIL — `playableIndex` is not exported; the clamp test gets 30×40.

- [ ] **Step 3: The clamp**

In `renderer/systems/map.js`, in `buildArena`, replace

```js
  const width  = clampInt(config.size?.w, 8, 40, 26)
  const height = clampInt(config.size?.h, 8, 30, 18)
```

with

```js
  // 60 × 44 at most (raised from 40 × 30 for PvP 2b's large arenas; only
  // the maximum moved, so every smaller config builds as before).
  const width  = clampInt(config.size?.w, 8, 60, 26)
  const height = clampInt(config.size?.h, 8, 44, 18)
```

- [ ] **Step 4: Keep and Wilds**

In `renderer/data/pvp-arenas.js`:
- Replace the header's last line `// of a DEPTH_THEMES entry). Matches rotate through PVP_ARENA_ORDER.` with

```js
// of a DEPTH_THEMES entry). Matches rotate through PVP_ARENA_ORDER; a
// `large` arena (2b) is skipped for a match of fewer than
// PVP.largeMinHeroes heroes.
import { PVP } from './pvp.js'
```

(`pvp.js` imports nothing from here, so there is no cycle.)
- Directly after the `PILLARS_THEME` line add

```js
// The glade's grass, shared by the Wilds (2b).
const GLADE_THEME = { ruleset: 'outdoors', floorTile: 'floor', floorSkins: GRASS, bgColor: '#0a1208', tint: null, fogAlpha: 0.65 }
```

- Replace

```js
// The grids as written, for the invariant tests.
export const ARENA_ROWS = { glade: GLADE, tunnels: TUNNELS, ruins: RUINS }
```

with

```js
// Keep (55×39, 2b): a walled fort in the centre, 2-thick walls with four
// 3-wide gates into a courtyard holding the major buff spot; around it a
// ring of broken outer walls and rubble-strewn yards. Mirrored left-right.
const KEEP = [
  '#######################################################',
  '#.....................................................#',
  '#.S.............o...##...........##...o.............S.#',
  '#.....................................................#',
  '#......#####....######...........######....#####......#',
  '#......#.......................................#......#',
  '#...##.#.b...................................b.#.##...#',
  '#......#.............#.....R.....#.............#......#',
  '#......#...##...........o.....o...........##...#......#',
  '#..o...............................................o..#',
  '#.....................................................#',
  '#................#########...#########................#',
  '#................#########...#########................#',
  '#......#.........####.............####.........#......#',
  '#.#....#...o.....####.............####.....o...#....#.#',
  '#......#.........##.................##.........#......#',
  '#......#.........##....o.......o....##.........#......#',
  '#................##.................##................#',
  '#............#.......F...........F.......#............#',
  '#...S.....Q................B................Q.....S...#',
  '#............#...........................#............#',
  '#................##..b...........b..##................#',
  '#......#.........##....o.......o....##.........#......#',
  '#......#.........##.................##.........#......#',
  '#.#....#...o.....####.............####.....o...#....#.#',
  '#......#.........####.............####.........#......#',
  '#.............b..#########...#########..b.............#',
  '#................#########...#########................#',
  '#.....................................................#',
  '#..o...............................................o..#',
  '#......#...##...........o.....o...........##...#......#',
  '#......#.............#.....Q.....#.............#......#',
  '#...##.#.......................................#.##...#',
  '#......#.......................................#......#',
  '#......#####....######...........######....#####......#',
  '#.....................................................#',
  '#.S..........F..o....##.........##....o..F..........S.#',
  '#.....................................................#',
  '#######################################################',
]
// Wilds (55×39, 2b): four corner clearings joined by winding paths 2-3
// tiles wide through thickets of walls and trees, the major buff spot in
// the open central meadow. Symmetric under a half turn.
const WILDS = [
  '#######################################################',
  '##########################o####################o#######',
  '####o##.##o##o###########....###########o#####o.#o#####',
  '###o.......#....##o##o#....R...#####o#....o#.......o###',
  '##o.S..............#o.....o#.....##...............S.###',
  '#o.......o...o#.........#o##o#.........#o............##',
  '##...........##o##..b.########o#....o#####...........##',
  '#.............o#####o###########o##o#####....Q........#',
  '#o...........o############################...........##',
  '##...o.....F...o#########################............##',
  '##o............#########################............###',
  '###............#########################............o##',
  '###.....#o#....o###########o###########o....#o#.....###',
  '##o....####....########o##o.#o###########...o##o.b..###',
  '###....o##o.b..#o#####o.........##o##o#......###....o##',
  '###o....###.......o##......o.................o#....o###',
  '####.....##..................................#.....####',
  '####o....####....F.....o.......o.........##o##....#####',
  '######....#####o....................o##o#####....######',
  '#####o.S..#######o.........B.........#o#####o..S.######',
  '######....o#####o##....................#o####....o#####',
  '#####....o##o#.........o.......o.....F....o##o....#####',
  '####.....#..................................o#.....####',
  '####....##.................o......o##.......##o....####',
  '###....##o......##o##o#.........#o#####o..b.####....###',
  '##o..b.####...o########o##o.#o##########....o##o....###',
  '###.....##o....#########################....##o.....o##',
  '###............o#######################o............###',
  '##o............#########################............###',
  '#o............##########################...F.....o...##',
  '##...........#############################...........##',
  '#........Q....o#####o##############o#####.............#',
  '#o...........o##o##....########o#.b..o####...........##',
  '##............#o.........#####o.........##...o.......##',
  '##o.S...............o#.....##.....#o..............S.###',
  '####.......##....##o##o#...Q....#####o#....o.......####',
  '######o.#o#####o########o#....o########o##o##o#.o######',
  '##########################o##o#################o#######',
  '#######################################################',
]

// The grids as written, for the invariant tests.
export const ARENA_ROWS = { glade: GLADE, tunnels: TUNNELS, ruins: RUINS, keep: KEEP, wilds: WILDS }
```

- In `PVP_ARENAS`, in the `pillars` entry, replace `    theme: PILLARS_THEME,` with

```js
    theme: PILLARS_THEME,
    large: false,
```

- and replace the three `parseArena` entries and the order

```js
  glade: parseArena('glade', GLADE, { ruleset: 'outdoors', floorTile: 'floor', floorSkins: GRASS, bgColor: '#0a1208', tint: null, fogAlpha: 0.65 }),
  tunnels: parseArena('tunnels', TUNNELS, { ruleset: 'catacombs', floorTile: 'floor', bgColor: '#07070f', tint: 'rgba(0,0,20,0.35)', fogAlpha: 0.80 }),
  ruins: parseArena('ruins', RUINS, { floorTile: 'sand', bgColor: '#1a1206', tint: 'rgba(40,20,0,0.2)', fogAlpha: 0.65 }),
}

export const PVP_ARENA_ORDER = ['pillars', 'glade', 'tunnels', 'ruins']
```

with

```js
  glade: { ...parseArena('glade', GLADE, GLADE_THEME), large: false },
  tunnels: { ...parseArena('tunnels', TUNNELS, { ruleset: 'catacombs', floorTile: 'floor', bgColor: '#07070f', tint: 'rgba(0,0,20,0.35)', fogAlpha: 0.80 }), large: false },
  ruins: { ...parseArena('ruins', RUINS, { floorTile: 'sand', bgColor: '#1a1206', tint: 'rgba(40,20,0,0.2)', fogAlpha: 0.65 }), large: false },
  // The castle ruleset's look (DEPTH_THEMES' depth-6 entry).
  keep: { ...parseArena('keep', KEEP, { ruleset: 'castle', floorTile: 'floor', bgColor: '#141008', tint: null, fogAlpha: 0.65 }), large: true },
  wilds: { ...parseArena('wilds', WILDS, GLADE_THEME), large: true },
}

export const PVP_ARENA_ORDER = ['pillars', 'glade', 'keep', 'tunnels', 'ruins', 'wilds']
```

- Append at the end of the file:

```js
// The index a match of `heroes` heroes is played at, from index `i` on: the
// first arena (wrapping) that is not large, or any once the match has
// PVP.largeMinHeroes heroes (2b spec §4).
export function playableIndex(i, heroes) {
  for (let k = 0; k < N_ARENAS; k++) {
    const j = (((i + k) % N_ARENAS) + N_ARENAS) % N_ARENAS
    if (!arenaAt(j).large || heroes >= PVP.largeMinHeroes) return j
  }
  return 0
}
```

- [ ] **Step 5: The rotation skips large arenas for small matches**

In `server/rooms.js`:
- Replace the pvp-arenas import with `import { arenaAt, nextArenaIndex, playableIndex } from '../renderer/data/pvp-arenas.js'`.
- In `startNextMatch`, replace `  room.arenaIndex = nextArenaIndex(room.arenaIndex)` with

```js
  // A large arena needs PVP.largeMinHeroes heroes (2b spec §4); a public
  // room always has them, bots included.
  room.arenaIndex = playableIndex(nextArenaIndex(room.arenaIndex), roster.length)
```

In `renderer/pvp/local.js`:
- Replace `import { arenaAt } from '../data/pvp-arenas.js'` with `import { arenaAt, playableIndex } from '../data/pvp-arenas.js'`.
- Replace the comment above `makeLocalMatch` (Task 1's version) with

```js
// arenaIndex: where in PVP_ARENA_ORDER this match is played — or the next
// arena on, when it is large and the match is too small for it (2b); the
// index used is match.arenaIndex, and game.js's "Next match" passes
// nextArenaIndex of it. seed: the buff rolls' (2b spec §2), Math.random's
// once per match unless a test fixes it.
```

- Replace `  return makeMatch({ roster, sfx, arena: arenaAt(arenaIndex), seed })` with

```js
  const index = playableIndex(arenaIndex, roster.length)
  const match = makeMatch({ roster, sfx, arena: arenaAt(index), seed })
  match.arenaIndex = index
  return match
```

In `renderer/game.js`, in `startPvp`, replace `  pvp = { match, theme, cls, arenaIndex, picking: false }` with `  pvp = { match, theme, cls, arenaIndex: match.arenaIndex, picking: false }` (so "Next match" steps on from the arena actually played).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/arena.test.js test/pvp-arenas.test.js test/pvp-ui.test.js test/net-rooms.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: PASS.

Run: `node --check renderer/game.js && npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0`. `test/net-client.test.js` already accepts any arena id in `PVP_ARENAS`, so a `keep` or `wilds` welcome builds its map on the client unchanged.

- [ ] **Step 7: Commit**

```bash
git add renderer/systems/map.js renderer/data/pvp-arenas.js server/rooms.js renderer/pvp/local.js renderer/game.js test/arena.test.js test/pvp-arenas.test.js test/pvp-ui.test.js test/net-rooms.test.js
git commit -m "feat(pvp): Keep and Wilds large arenas, a 60x44 arena clamp, and a rotation that skips them under 4 heroes

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 6: Bots contest the buff spots

**Files:**
- Modify: `renderer/pvp/bots.js` (`botInput`)
- Modify: `test/pvp-bots.test.js`

**Interfaces:**
- Consumes: spots `{ kind: 'buff', tier, up, x, y, px, py }` (Task 4); `BOTS.buffSeekFoe`/`buffSeek`/`majorSeek` (Task 1); Keep and Wilds (Task 5).
- Produces: `botInput` priorities — flask when hurt, then an up major within `majorSeek`, then the rune, then an up minor within `buffSeek` when no foe is within `buffSeekFoe`, then the fight. It never presses attack on a seek tick, so no seek can latch `needRelease`.

- [ ] **Step 1: Write the failing tests**

In `test/pvp-bots.test.js`:
- Replace `import { grantRune } from '../renderer/pvp/pickups.js'` with

```js
import { grantRune, makePickups } from '../renderer/pvp/pickups.js'
import { PVP_ARENAS } from '../renderer/data/pvp-arenas.js'
```

- Replace `import { DOUBLE_SHOT } from '../renderer/data/pvp.js'` with `import { DOUBLE_SHOT, PVP, BOTS } from '../renderer/data/pvp.js'`.
- Append at the end of the file:

```js
describe('bots and buff spots (2b)', () => {
  // A match on pillars whose only pickups are `list` (up unless said), the
  // bot b0 at `at` and a foe b1 at `foeAt`.
  const setup = (list, at, foeAt, cls = 'archer') => {
    const m = makeMatch({ roster: roster(cls, 'warrior'), seed: 4 })
    m.pickups = makePickups({ pickups: list }, m.rng)
    for (const p of m.pickups) if (p.kind === 'buff') { p.up = true; p.t = 0; p.buff = 'haste'; p.next = null }
    placeHero(m.heroes[0], at); placeHero(m.heroes[1], foeAt)
    return m
  }
  const minor = (x, y) => ({ kind: 'buff', tier: 'minor', x, y })
  const major = (x, y) => ({ kind: 'buff', tier: 'major', x, y })
  // Steps only the bot (the foe stands still) until it takes a pickup.
  const takes = (m, ticks = 200) => {
    for (let i = 0; i < ticks; i++) {
      for (const e of stepMatch(m, { b0: botInput(m, m.heroes[0]) }, PVP.tick))
        if (e.type === 'pickup') return e
    }
    return null
  }
  it('with no foe within 4 tiles, a bot detours to an up minor spot within 6 and takes it', () => {
    const m = setup([minor(4, 2)], { x: 9, y: 2 }, { x: 29, y: 21 })     // the spot away from the foe
    assert.deepEqual(botInput(m, m.heroes[0]).move, { x: -1, y: 0 })
    assert.deepEqual(takes(m), { type: 'pickup', kind: 'buff', hero: 'b0', buff: 'haste', tier: 'minor' })
    assert.equal(m.heroes[0].buffs.haste.tier, 'minor')
  })
  it('a minor spot farther than 6 tiles, or down, draws no detour', () => {
    const far = setup([minor(2, 2)], { x: 9, y: 2 }, { x: 29, y: 21 })
    assert.equal(tileDist(far), 7)
    assert.notDeepEqual(botInput(far, far.heroes[0]).move, { x: -1, y: 0 })
    assert.equal(takes(far, 20), null)
    const down = setup([minor(5, 2)], { x: 9, y: 2 }, { x: 29, y: 21 })
    down.pickups[0].up = false; down.pickups[0].t = 99
    assert.equal(takes(down, 30), null)
  })
  it('a foe within 4 tiles: the bot fights instead of detouring to a minor spot', () => {
    const m = setup([minor(2, 5)], { x: 2, y: 2 }, { x: 5, y: 2 })
    const inp = botInput(m, m.heroes[0])
    assert.equal(inp.facing, 'east')
    assert.equal(inp.attack, true)
  })
  it('a major spot within 10 tiles draws the bot even with a foe beside it', () => {
    const m = setup([major(11, 2)], { x: 2, y: 2 }, { x: 3, y: 2 }, 'warrior')
    const inp = botInput(m, m.heroes[0])
    assert.deepEqual(inp.move, { x: 1, y: 0 })
    assert.equal(inp.attack, false)
    const out = setup([major(13, 2)], { x: 2, y: 2 }, { x: 3, y: 2 }, 'warrior')
    assert.equal(botInput(out, out.heroes[0]).attack, true, 'at 11 tiles it fights')
  })
  it('a hurt bot still goes for a flask first', () => {
    const m = setup([major(2, 8), { kind: 'flask', x: 8, y: 2 }], { x: 2, y: 2 }, { x: 29, y: 21 })
    m.heroes[0].hp = 1
    assert.deepEqual(botInput(m, m.heroes[0]).move, { x: 1, y: 0 })
  })
  const tileDist = m => Math.hypot(m.heroes[0].x - m.pickups[0].x, m.heroes[0].y - m.pickups[0].y)

  for (const id of ['keep', 'wilds']) {
    it(`six bots on ${id} for 60 s take buffs of both tiers, never latch the attack, never stand idle`, () => {
      const m = makeMatch({ roster: roster('warrior', 'archer', 'mage', 'warrior', 'archer', 'mage'), arena: PVP_ARENAS[id], seed: 3 })
      const taken = new Set(), latch = {}, idle = {}, last = {}
      let worstLatch = 0, worstIdle = 0
      for (let i = 0; i < 60 / PVP.tick; i++) {
        const inputs = Object.fromEntries(m.heroes.map(h => [h.id, botInput(m, h)]))
        for (const h of m.heroes) {
          const inp = inputs[h.id]
          latch[h.id] = !h.dead && h.needRelease && inp.attack ? (latch[h.id] ?? 0) + PVP.tick : 0
          const moved = last[h.id] && (last[h.id].px !== h.px || last[h.id].py !== h.py)
          idle[h.id] = !h.dead && !moved && !inp.attack && !inp.alt ? (idle[h.id] ?? 0) + PVP.tick : 0
          worstLatch = Math.max(worstLatch, latch[h.id]); worstIdle = Math.max(worstIdle, idle[h.id])
          last[h.id] = { px: h.px, py: h.py }
        }
        for (const e of stepMatch(m, inputs, PVP.tick)) if (e.type === 'pickup' && e.kind === 'buff') taken.add(e.tier)
      }
      assert.deepEqual([...taken].sort(), ['major', 'minor'])
      assert.ok(worstLatch < 1, `attack held against needRelease for ${worstLatch.toFixed(2)} s`)
      assert.ok(worstIdle < 5, `a bot stood idle ${worstIdle.toFixed(2)} s`)
    })
  }
})
```

The two soak tests are the stall checks the 2a bugs call for: over 60 simulated seconds on each large arena, no bot sends attack against `needRelease` for a second, and none stands idle (no move, no attack, no alt) for 5 s. The prototype's worst values were 0 s and 1.1 s.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/pvp-bots.test.js 2>&1 | grep -E "^# (pass|fail)|    not ok"`
Expected: FAIL — 4 tests: the minor-spot detour (the bot walks toward the foe instead), the major spot beside a foe (the warrior swings), and both 60 s soaks (no major is ever taken).

- [ ] **Step 3: Seek the spots**

In `renderer/pvp/bots.js`, directly above `export function botInput(match, hero) {` add

```js
// The up buff spots of a tier within `range` tiles of the hero.
const spots = (match, hero, tier, range) =>
  match.pickups.filter(p => p.up && p.kind === 'buff' && p.tier === tier && tileDist(hero, p) <= range)
```

and in `botInput` replace

```js
  const rune = hero.rune ? null : nearest(hero, up('rune'))
  if (rune && (!foe || tileDist(hero, rune) < tileDist(hero, foe))) { steer(match, hero, rune, input); return input }
  if (!foe) return input
```

with

```js
  // Buff spots (2b spec §5): an up major spot within majorSeek is worth a
  // fight — the bot heads there with foes about; a minor one only draws a
  // detour when no foe is within buffSeekFoe.
  const major = nearest(hero, spots(match, hero, 'major', BOTS.majorSeek))
  if (major) { steer(match, hero, major, input); return input }
  const rune = hero.rune ? null : nearest(hero, up('rune'))
  if (rune && (!foe || tileDist(hero, rune) < tileDist(hero, foe))) { steer(match, hero, rune, input); return input }
  if (!foe || tileDist(hero, foe) > BOTS.buffSeekFoe) {
    const minor = nearest(hero, spots(match, hero, 'minor', BOTS.buffSeek))
    if (minor) { steer(match, hero, minor, input); return input }
  }
  if (!foe) return input
```

(A warrior mid-hold or an archer mid-draw that turns to seek lets go of its attack. That releases a swing or a partial double shot, exactly as steering to a flask does today.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/pvp-bots.test.js test/pvp-soak.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: PASS (about 2 s for the file).

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add renderer/pvp/bots.js test/pvp-bots.test.js
git commit -m "feat(pvp): bots head for major buff spots and detour to minor ones when no foe is near

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 7: The large-arena performance check

**Files:**
- Create: `tools/perf/pvp-step.mjs`
- Modify: `test/pvp-soak.test.js`

**Interfaces:**
- Consumes: Keep and Wilds (Task 5), seeking bots (Task 6).
- Produces: `node tools/perf/pvp-step.mjs [arena…]` prints per-tick bots/step/snapshot/total mean, p95 and max for a whole 6-bot match.

- [ ] **Step 1: The gate in the suite**

In `test/pvp-soak.test.js`, replace `import { isWalkable } from '../renderer/systems/entities.js'` with

```js
import { isWalkable } from '../renderer/systems/entities.js'
import { PVP_ARENAS } from '../renderer/data/pvp-arenas.js'
import { snapshotBody, encode } from '../renderer/net/protocol.js'
```

and append at the end of the file:

```js
describe('large-arena cost (2b spec §4)', () => {
  for (const id of ['keep', 'wilds']) {
    it(`six bots on ${id}: pathing, the step and the snapshot average well under the 2 ms tick budget`, () => {
      const roster = ['warrior', 'archer', 'mage', 'warrior', 'archer', 'mage'].map((cls, i) => ({ id: `b${i}`, name: `B${i}`, cls }))
      const m = makeMatch({ roster, arena: PVP_ARENAS[id], seed: 2 })
      const tick = () => {
        const inputs = Object.fromEntries(m.heroes.map(h => [h.id, botInput(m, h)]))
        stepMatch(m, inputs, PVP.tick)
        encode(snapshotBody(m))            // every tick: the server encodes 2 in 3
      }
      for (let i = 0; i < 150; i++) tick()   // warm up the JIT
      const t0 = performance.now()
      for (let i = 0; i < 900; i++) tick()
      const perTick = (performance.now() - t0) / 900
      console.log(`${id}: ${perTick.toFixed(3)} ms/tick`)
      assert.ok(perTick < 2, `${perTick} ms/tick`)
    })
  }
})
```

- [ ] **Step 2: Run it**

Run: `node --test test/pvp-soak.test.js 2>&1 | grep -E "^# (pass|fail)|ms/tick"`
Expected: PASS, printing about `keep: 0.5 ms/tick` and `wilds: 0.3 ms/tick` (the prototype, i7-7500U under WSL; about 0.95 and 0.64 inside the full parallel suite). The test passes as soon as it is written, because it gates what Tasks 5–6 built. It is the spec's performance measure, not a TDD cycle. If it fails, profile `nextStep` in `bots.js` (a `Map`-keyed BFS per bot per tick) before touching anything else.

- [ ] **Step 3: The benchmark tool**

Create `tools/perf/pvp-step.mjs`:

```js
// The server's per-tick cost on a PvP arena with six bots (2b spec §4: the
// budget is 2 ms per 30 Hz tick): a whole match of botInput for every hero
// (the bots' pathing), stepMatch, and a snapshot encoded at the server's
// 20 Hz — each timed on its own. Pure Node, no browser.
//
//   node tools/perf/pvp-step.mjs [arena…]      (default: pillars keep wilds)
import { makeMatch, stepMatch } from '../../renderer/pvp/sim.js'
import { botInput } from '../../renderer/pvp/bots.js'
import { snapshotBody, encode } from '../../renderer/net/protocol.js'
import { PVP, CLASSES } from '../../renderer/data/pvp.js'
import { NET } from '../../renderer/data/net.js'
import { PVP_ARENAS } from '../../renderer/data/pvp-arenas.js'

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['pillars', 'keep', 'wilds']
const stat = xs => {
  const s = [...xs].sort((a, b) => a - b)
  return { mean: s.reduce((t, x) => t + x, 0) / s.length, p95: s[Math.floor(s.length * 0.95)], max: s.at(-1) }
}
const fmt = ({ mean, p95, max }) => `mean ${mean.toFixed(3)} p95 ${p95.toFixed(3)} max ${max.toFixed(2)}`
for (const id of ids) {
  const roster = Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, name: `Bot ${i}`, cls: CLASSES[i % 3] }))
  const m = makeMatch({ roster, arena: PVP_ARENAS[id], seed: 1 })
  const bots = [], step = [], snap = [], total = []
  for (let tick = 1; !m.ended; tick++) {
    const t0 = performance.now()
    const inputs = {}
    for (const h of m.heroes) inputs[h.id] = botInput(m, h)
    const t1 = performance.now()
    stepMatch(m, inputs, PVP.tick)
    const t2 = performance.now()
    if (Math.floor(tick * NET.snapshotHz * PVP.tick) !== Math.floor((tick - 1) * NET.snapshotHz * PVP.tick)) encode(snapshotBody(m))
    const t3 = performance.now()
    bots.push(t1 - t0); step.push(t2 - t1); snap.push(t3 - t2); total.push(t3 - t0)
  }
  console.log(`${id} (${m.arena.size.w}×${m.arena.size.h}, ${total.length} ticks)`)
  console.log(`  bots  ${fmt(stat(bots))} ms`)
  console.log(`  step  ${fmt(stat(step))} ms`)
  console.log(`  snap  ${fmt(stat(snap))} ms`)
  console.log(`  tick  ${fmt(stat(total))} ms  (budget 2)`)
}
```

Run: `node tools/perf/pvp-step.mjs`
Expected (the prototype's numbers, yours will differ a little; the bots/step/snap lines are shown for Keep only):

```
pillars (32×24, 7200 ticks)
  tick  mean 0.296 p95 0.732 max 6.93 ms  (budget 2)
keep (55×39, 7200 ticks)
  bots  mean 0.352 p95 0.857 max 4.24 ms
  step  mean 0.031 p95 0.078 max 0.96 ms
  snap  mean 0.072 p95 0.171 max 0.78 ms
  tick  mean 0.456 p95 1.000 max 4.71 ms  (budget 2)
wilds (55×39, 7200 ticks)
  tick  mean 0.329 p95 0.621 max 2.02 ms  (budget 2)
```

The mean and the p95 must be under 2 ms on both large arenas. The maxima are GC pauses and JIT warm-up (pillars shows the same), and Spec reading 18 leaves them ungated. Bot pathing dominates: `nextStep` is a whole-map BFS, and Keep's open yards make it the slower of the two. Record the numbers in the PR description.

- [ ] **Step 4: Commit**

```bash
git add tools/perf/pvp-step.mjs test/pvp-soak.test.js
git commit -m "perf(pvp): large-arena step benchmark and a 2 ms/tick gate with six bots

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---
### Task 8: Protocol v5 — damage-over-time and the spots on the wire, ghosts in the view, the pickup float online

**Files:**
- Modify: `renderer/net/protocol.js` (header, `heroSnap`, `hydrateHero`, `snapshotBody`), `renderer/data/net.js` (`protocolVersion`)
- Modify: `renderer/net/view.js` (`pickupEntities`, `netViewOf`), `renderer/pvp/local.js` (`viewOf`), `renderer/net/client.js` (`onSnap`)
- Modify: `test/net-protocol.test.js`, `test/net-sim.test.js`, `test/net-ui.test.js`, `test/pvp-ui.test.js`, `test/net-client.test.js`, `test/net-predict.test.js`

**Interfaces:**
- Consumes: `buffs` on the wire (Task 2); `hero.burn`/`hero.poison`, `applyEdge` (Task 3); spot fields (Task 4).
- Produces:
  - `NET.protocolVersion === 5`;
  - a snapshot hero carries `dots: { burn: number, poison: number }` (seconds left, 0 for none); `hydrateHero` turns them back into `hero.burn`/`hero.poison` = `{ owner: null, t, next: 0 }` or null;
  - a snapshot pickup carries `t`, and a spot also `tier`, `buff`, `next`;
  - `pickupEntities(pickups) → render entities` (from `renderer/net/view.js`): every pickup that is up plus every buff spot that is down (drawn as its ghost), each with `type: 'pvp_pickup'` — shared by `netViewOf` and the local `viewOf`;
  - the client turns `{ type: 'pickup', kind: 'buff', hero, buff }` into a float `{ text: '+', kind: buff }` over the taker's snapshot position (nothing when the taker is not in the snapshot).

- [ ] **Step 1: Write the failing tests**

In `test/net-protocol.test.js`:
- Below `import { grantRune } from '../renderer/pvp/pickups.js'` add

```js
import { grantBuff } from '../renderer/pvp/buffs.js'
import { setDot } from '../renderer/pvp/dots.js'
import { PVP_ARENAS } from '../renderer/data/pvp-arenas.js'
```

- In the `'hello v3: resume is a fourth way in…'` test, replace `    assert.equal(v, 4)` with `    assert.equal(v, 5)`, and directly after the line ending `'a 4b client gets the reload line')` add

```js
    assert.deepEqual(validateHello({ type: 'hello', v: 4, resume: tok }), { error: ERR.VERSION }, 'a 2a client gets the reload line')
```

- Directly above `describe('4a numbers', () => {` add

```js
describe('protocol v5 (2b)', () => {
  const match = () => makeMatch({ roster: [{ id: 'p1', name: 'A', cls: 'warrior' }, { id: 'p2', name: 'B', cls: 'archer' }] })
  it('a hero carries its buffs and the burn and poison it has left; a hydrated hero gets them back', () => {
    const m = match()
    const [w, a] = m.heroes
    grantBuff(w, 'haste', 'major'); grantBuff(w, 'ward', 'minor'); grantBuff(w, 'venom', 'minor')
    setDot(a, 'burn', 'p1', 2); a.burn.t = 1.25
    const body = JSON.parse(JSON.stringify(snapshotBody(m)))
    const [ws, as] = body.heroes
    assert.deepEqual(ws.buffs, { haste: { tier: 'major', t: 15 }, might: null, ward: { tier: 'minor', t: 15, pool: 2 },
      edge: { kind: 'venom', tier: 'minor', t: 10 } })
    assert.deepEqual(ws.dots, { burn: 0, poison: 0 })
    assert.deepEqual(as.dots, { burn: 1.25, poison: 0 })
    const h = hydrateHero(null, as)
    assert.equal(h.burn.t, 1.25); assert.equal(h.poison, null)
    assert.deepEqual(hydrateHero(null, ws).buffs, w.buffs)
    a.burn = null
    hydrateHero(h, JSON.parse(JSON.stringify(heroSnap(a))))
    assert.equal(h.burn, null, 'a burn that ended is gone on the client too')
  })
  it("a buff spot sends its tier, the buff up now, the ghost and its timer; other pickups their timer", () => {
    const m = makeMatch({ roster: [{ id: 'p1', name: 'A', cls: 'warrior' }], arena: PVP_ARENAS.keep, seed: 9 })
    const body = JSON.parse(JSON.stringify(snapshotBody(m)))
    const b = body.pickups.find(p => p.kind === 'buff' && p.tier === 'minor')
    const B = body.pickups.find(p => p.kind === 'buff' && p.tier === 'major')
    const rune = body.pickups.find(p => p.kind === 'rune')
    assert.deepEqual(Object.keys(b).sort(), ['buff', 'kind', 'next', 'px', 'py', 't', 'tier', 'up', 'x', 'y'])
    assert.equal(b.up, true); assert.equal(b.next, null); assert.equal(b.buff, m.pickups.find(p => p.tier === 'minor').buff)
    assert.equal(B.up, false); assert.equal(B.buff, null); assert.equal(B.t, 30)
    assert.equal(B.next, m.pickups.find(p => p.tier === 'major').next)
    assert.deepEqual(Object.keys(rune).sort(), ['kind', 'px', 'py', 't', 'up', 'x', 'y'])
    assert.equal(rune.t, 45)
  })
})
```

In `test/net-sim.test.js`, replace `    assert.equal(NET.protocolVersion, 4)` with `    assert.equal(NET.protocolVersion, 5)`.

In `test/net-ui.test.js`, directly above `  it('netViewOf builds a render view: you as player, everyone in heroes, pickups up only', () => {` add

```js
  it('netViewOf draws every buff spot: one up as itself, one down as the ghost of its next buff (2b)', () => {
    const me = makeHero({ id: 'p1', name: 'A', cls: 'mage' })
    const v = { me, others: [], projectiles: [], lightning: [], strikes: [], arcs: [], shockwaves: [], feedback: { floats: [] },
      pickups: [{ kind: 'buff', tier: 'minor', x: 1, y: 1, px: 48, py: 48, up: true, t: 0, buff: 'ward', next: null },
        { kind: 'buff', tier: 'major', x: 2, y: 2, px: 80, py: 80, up: false, t: 12, buff: null, next: 'haste' },
        { kind: 'flask', x: 3, y: 3, px: 112, py: 112, up: false, t: 4 }] }
    const view = netViewOf(v, { bgColor: '#000' }, [[{}]])
    assert.deepEqual(view.entities.map(e => [e.type, e.kind, e.up, e.buff, e.next]),
      [['pvp_pickup', 'buff', true, 'ward', null], ['pvp_pickup', 'buff', false, null, 'haste']])
  })
```

In `test/pvp-ui.test.js`, replace

```js
  it('the view centres on you and shows only pickups that are up', () => {
```

with

```js
  it('the view centres on you and shows the pickups that are up, and buff spots that are down as ghosts', () => {
```

and replace

```js
    assert.equal(v.entities.length, 6)   // 2 flasks, 2 quivers and 2 minor buff spots; the rune is not up yet
  })
```

with

```js
    assert.equal(v.entities.length, 6)   // 2 flasks, 2 quivers and 2 minor buff spots; the rune is not up yet
    m.pickups.find(p => p.kind === 'buff').up = false
    m.pickups.find(p => p.kind === 'flask').up = false
    assert.equal(viewOf(m, { bgColor: '#000' }).entities.length, 5, 'the down spot stays, as a ghost; the flask goes')
  })
```

In `test/net-client.test.js`, directly above `describe('client backgrounded-tab caps', () => {` add

```js
describe('buff pickups (2b)', () => {
  it("a buff taken shows a float of the buff's kind over whoever took it", () => {
    const s = open()
    welcome(s)
    const hero = lone()
    s.ws.onmessage({ data: JSON.stringify(snapBody(hero, { tick: 1,
      events: [{ type: 'pickup', kind: 'buff', hero: 'p1', buff: 'venom', tier: 'major' }, { type: 'pickup', kind: 'flask', hero: 'p1' }] })) })
    assert.deepEqual(s.feedback.floats.map(f => [f.text, f.kind, f.px, f.py]), [['+', 'venom', hero.px, hero.py - 10]])
  })
  it('a buff taken by a hero no longer in the snapshot (left since) draws no float and breaks nothing', () => {
    const s = open()
    welcome(s)
    const hero = lone()
    s.ws.onmessage({ data: JSON.stringify(snapBody(hero, { tick: 1, events: [{ type: 'pickup', kind: 'buff', hero: 'p9', buff: 'ward', tier: 'minor' }] })) })
    assert.deepEqual(s.feedback.floats, [])
    assert.ok(sessionView(s, 100))
  })
})
```

In `test/net-predict.test.js`:
- Below Task 2's `import { grantBuff } from '../renderer/pvp/buffs.js'` add

```js
import { applyEdge } from '../renderer/pvp/dots.js'
import { makeHero } from '../renderer/pvp/hero.js'
```

- Append at the end of the file:

```js
describe('2b prediction: Venom', () => {
  it("a Venom slow rides the snapshot's slowTimer/slowMul: the replayed walk slows and recovers with the server's", () => {
    const m = lone('warrior')
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    const foe = makeHero({ id: 'x', name: 'X', cls: 'archer' })
    grantBuff(foe, 'venom', 'major')
    let snap = null
    for (let seq = 1; seq <= 90; seq++) {
      const input = { ...east, seq }
      stepMatch(m, { p1: input }, PVP.tick)
      predictStep(pred, input)
      pred.pending.push({ seq, input })
      if (seq === 5) {
        applyEdge(m, foe, m.heroes[0])                  // as a landed venom arrow would, halved by ccMul in a match tick
        m.heroes[0].slowTimer *= PVP.ccMul
        snap = heroSnap(m.heroes[0])
      }
    }
    reconcile(pred, snap, 5)
    assert.ok(snap.slowTimer > 0 && snap.slowMul < 1)
    assert.ok(Math.abs(pred.hero.px - m.heroes[0].px) < 1e-9, `px ${pred.hero.px} vs ${m.heroes[0].px}`)
    assert.equal(pred.hero.slowTimer <= 0, true, 'worn off by tick 90 on both sides')
  })
})
```

(The Venom test passes as soon as it is written, because the slow already travels on `slowTimer`/`slowMul`. It pins the spec's §6 promise that it keeps doing so.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/net-protocol.test.js test/net-sim.test.js test/net-ui.test.js test/pvp-ui.test.js test/net-client.test.js test/net-predict.test.js 2>&1 | grep -E "^# (pass|fail)|    not ok"`
Expected: FAIL — the version (4), `dots` missing, spot fields missing, the ghosts left out of both views, and no buff float on the client.

- [ ] **Step 3: The wire**

In `renderer/net/protocol.js`:
- In the header comment, replace

```js
// a hero's combo and move and the snapshot's fire zones, 2a spec §5): message
```

with

```js
// a hero's combo and move and the snapshot's fire zones, 2a spec §5; v5 adds a hero's buffs and
// damage-over-time and the buff spots' tier, buff, ghost and timer, 2b spec §6): message
```

- In `heroSnap`, replace Task 2's

```js
  // 2b: the buffs, for the looks, the HUD and the predictor's Haste.
  s.buffs = copyBuffs(h.buffs)
```

with

```js
  // 2b: the buffs, for the looks, the HUD and the predictor's Haste; the
  // burn and poison left (s), for the looks only.
  s.buffs = copyBuffs(h.buffs)
  s.dots = { burn: h.burn?.t ?? 0, poison: h.poison?.t ?? 0 }
```

- In `hydrateHero`, directly after `  h.buffs = copyBuffs(s.buffs)` add

```js
  // What a burn or poison looks like client-side: its time left. The client
  // never ticks one (tickDots is the server's), so owner and next are inert.
  h.burn = s.dots?.burn > 0 ? { owner: null, t: s.dots.burn, next: 0 } : null
  h.poison = s.dots?.poison > 0 ? { owner: null, t: s.dots.poison, next: 0 } : null
```

- In `snapshotBody`, replace

```js
    pickups: match.pickups.map(p => ({ kind: p.kind, x: p.x, y: p.y, px: p.px, py: p.py, up: p.up })),
```

with

```js
    // t: how long a pickup that is down stays down; a buff spot also sends
    // its tier, the buff up now and the ghost it brings back (2b).
    pickups: match.pickups.map(p => ({ kind: p.kind, x: p.x, y: p.y, px: p.px, py: p.py, up: p.up, t: p.t,
      ...(p.kind === 'buff' && { tier: p.tier, buff: p.buff, next: p.next }) })),
```

In `renderer/data/net.js`, replace `  protocolVersion: 4,      // 2a: combo/move on heroes, fire zones on snapshots` with `  protocolVersion: 5,      // 2b: buffs/dots on heroes, buff spots on snapshots`.

- [ ] **Step 4: The views and the float**

In `renderer/net/view.js`, directly above `// What Renderer.render and updateHUD read: a single-player-shaped state whose` add

```js
// The pickups drawn: every one that is up, plus each buff spot that is
// down, drawn as the ghost of what it brings back (2b). Shared with the
// local view (pvp/local.js).
export const pickupEntities = pickups => pickups.filter(p => p.up || p.kind === 'buff').map(p => ({ ...p, type: 'pvp_pickup' }))

```

and in `netViewOf` replace `    entities: v.pickups.filter(p => p.up).map(p => ({ ...p, type: 'pvp_pickup' })),` with `    entities: pickupEntities(v.pickups),`.

In `renderer/pvp/local.js`:
- Below `import { randomSeed } from './rng.js'` add `import { pickupEntities } from '../net/view.js'` (`view.js` is DOM-free; it imports only `data/net.js`).
- In `viewOf`, replace `    entities: match.pickups.filter(p => p.up).map(p => ({ ...p, type: 'pvp_pickup' })),` with `    entities: pickupEntities(match.pickups),`.

In `renderer/net/client.js`, in `onSnap`, directly after the line `    if (e.type === 'kill' && at) addFloat(s.feedback, { px: at.px, py: at.py - 16, text: '+1', kind: 'heal' })` add

```js
    // A buff taken (2b): a float of the buff's colour over whoever took it.
    if (e.type === 'pickup' && e.kind === 'buff') {
      const by = snap.heroes.find(h => h.id === e.hero)
      if (by) addFloat(s.feedback, { px: by.px, py: by.py - 10, text: '+', kind: e.buff })
    }
```

The predictor needs nothing new. Haste already flows through `buffs` (Task 2) and Venom's slow through `slowTimer`/`slowMul`. Pickups are never predicted: a take shows on the next snapshot.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/net-protocol.test.js test/net-sim.test.js test/net-ui.test.js test/pvp-ui.test.js test/net-client.test.js test/net-predict.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: PASS.

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0` (every hello in the net tests uses `NET.protocolVersion`, so the bump needs no other edit).

- [ ] **Step 6: Commit**

```bash
git add renderer/net/protocol.js renderer/data/net.js renderer/net/view.js renderer/pvp/local.js renderer/net/client.js test/net-protocol.test.js test/net-sim.test.js test/net-ui.test.js test/pvp-ui.test.js test/net-client.test.js test/net-predict.test.js
git commit -m "feat(pvp): protocol v5 — buffs and damage-over-time on heroes, buff spots with ghosts, the pickup float online

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 9: The visuals — spot icons and ghosts, hero looks, the HUD buff row; the live check and the docs

**Files:**
- Modify: `renderer/render/sprites.js` (five `buff_*` keys)
- Modify: `renderer/render/pvp-fx.js` (the 2b section), `renderer/render/canvas.js` (three calls, the float colours)
- Modify: `renderer/ui/pvp-hud.js` (`buffRowModel`, `updateBuffRow`, `hidePvpHud`), `renderer/game.js` (two calls)
- Modify: `test/pvp-fx.test.js`
- Scratch (not committed): `/tmp/claude-1000/-home-lappemikb-projects-dungeon-crawler/170eab54-57f1-4834-98b0-cda083c36a9c/scratchpad/live-2b.mjs`, run from a git-ignored copy `debug-2b-live.mjs` in the repo root (`debug*.mjs` is in `.gitignore`)
- Modify (not committed): `/home/lappemikb/CLAUDE.md`

**Interfaces:**
- Consumes: `BUFFS`, `BUFF_COLORS` (Task 1); `hero.buffs` (Task 2); `hero.burn`/`poison` (Tasks 3, 8); spots and ghosts in the view (Task 8).
- Produces:
  - `SPRITES.buff_haste` (`tile_0113`, a pale draught), `buff_might` (`tile_0118`, a war axe), `buff_ward` (`tile_0101`, the kite shield), `buff_ember` (`weapon_firewand`), `buff_venom` (`tile_0114`, a green draught);
  - `pvp-fx.js`: `BUFF_ICON[kind] → sprite key`; pure `spotLook(p, t) → { key, kind, alpha, scale, rim, pulse }` and `heroLooks(hero) → { haste, might, ward (0-1), edge, burning, poisoned }`; draw calls `drawBuffSpot(ctx, p, sprites, px, py, S, t?)`, `drawBuffUnder(ctx, hero, cx, cy, S, t?)`, `drawBuffOver(ctx, hero, hx, hy, S, t?)`;
  - `pvp-hud.js`: pure `buffRowModel(hero) → [{ kind, tier, frac, color, src }]`; `updateBuffRow(row)` (DOM, `#pvp-buffs`); `hidePvpHud` also removes `#pvp-buffs`.

`canvas.js`, `pvp-hud.js`'s DOM half and `game.js` have no unit tests. They are checked with `node --check` plus the time-boxed live run in Step 5.

- [ ] **Step 1: Write the failing tests**

In `test/pvp-fx.test.js`, replace its two imports from `pvp-fx.js` and `data/pvp.js` with

```js
import { comboShake, holdArrows, fenceGlints, drawGlow, BUFF_ICON, spotLook, heroLooks } from '../renderer/render/pvp-fx.js'
import { WARRIOR_COMBOS, DOUBLE_SHOT, BUFF_KINDS, BUFF_COLORS } from '../renderer/data/pvp.js'
import { SPRITES } from '../renderer/render/sprites.js'
import { makeHero } from '../renderer/pvp/hero.js'
import { grantBuff } from '../renderer/pvp/buffs.js'
import { buffRowModel } from '../renderer/ui/pvp-hud.js'
```

and append at the end of the file:

```js
describe('2b looks', () => {
  it('every buff has its own atlas icon', () => {
    assert.deepEqual(Object.keys(BUFF_ICON), BUFF_KINDS)
    for (const k of BUFF_KINDS) assert.ok(SPRITES[BUFF_ICON[k]], k)
    assert.equal(new Set(BUFF_KINDS.map(k => SPRITES[BUFF_ICON[k]])).size, 5, 'five different pictures')
  })
  it('spotLook: an up spot shows its buff; a down one the ghost of its next at 30 %; a major is larger, rimmed and pulsing', () => {
    const up = spotLook({ tier: 'minor', up: true, buff: 'ward', next: null })
    assert.deepEqual(up, { key: 'buff_ward', kind: 'ward', alpha: 1, scale: 1, rim: false, pulse: 0 })
    const ghost = spotLook({ tier: 'minor', up: false, buff: null, next: 'venom' })
    assert.equal(ghost.key, 'buff_venom'); assert.equal(ghost.alpha, 0.3)
    const a = spotLook({ tier: 'major', up: true, buff: 'haste' }, 0), b = spotLook({ tier: 'major', up: true, buff: 'haste' }, 0.6)
    assert.equal(a.rim, true)
    assert.ok(a.scale > 1.25 && b.scale > 1.25)
    assert.notEqual(a.scale, b.scale, 'the pulse moves')
  })
  it('heroLooks: each buff, the ward bubble by the pool left, the burn and the poison', () => {
    const h = makeHero({ id: 'a', name: 'A', cls: 'mage' })
    assert.deepEqual(heroLooks(h), { haste: false, might: false, ward: 0, edge: null, burning: false, poisoned: false })
    grantBuff(h, 'haste', 'minor'); grantBuff(h, 'might', 'major'); grantBuff(h, 'ward', 'major'); grantBuff(h, 'ember', 'minor')
    h.buffs.ward.pool = 1
    h.burn = { owner: 'x', t: 1, next: 1 }; h.poison = { owner: 'x', t: 0.5, next: 1 }
    assert.deepEqual(heroLooks(h), { haste: true, might: true, ward: 0.25, edge: 'ember', burning: true, poisoned: true })
  })
  it("buffRowModel: one icon per buff held, a countdown fraction, the buff's colour; nothing when dead", () => {
    const h = makeHero({ id: 'a', name: 'A', cls: 'archer' })
    assert.deepEqual(buffRowModel(h), [])
    grantBuff(h, 'venom', 'major'); grantBuff(h, 'haste', 'minor')
    h.buffs.haste.t = 2
    const row = buffRowModel(h)
    assert.deepEqual(row.map(b => [b.kind, b.tier, b.frac, b.color]), [['haste', 'minor', 0.25, BUFF_COLORS.haste], ['venom', 'major', 1, BUFF_COLORS.venom]])
    assert.equal(row[1].src, `./assets/tiles/${SPRITES.buff_venom}.png`)
    h.dead = true
    assert.deepEqual(buffRowModel(h), [])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/pvp-fx.test.js 2>&1 | grep -E "^# (pass|fail)|Error"`
Expected: FAIL — `pvp-fx.js` does not export `BUFF_ICON`.

- [ ] **Step 3: The icons, the spots and the hero looks**

In `renderer/render/sprites.js`, directly after `  potion:           'tile_0116',` add

```js
  // PvP 2b buff icons (the spots and the HUD row): Haste a pale draught,
  // Might a war axe, Ward a kite shield, Ember the fire wand, Venom a green one.
  buff_haste:       'tile_0113',
  buff_might:       'tile_0118',
  buff_ward:        'tile_0101',
  buff_ember:       'weapon_firewand',
  buff_venom:       'tile_0114',
```

(`test/sprites.test.js` already checks that every key's file exists.)

In `renderer/render/pvp-fx.js`, replace `import { WARRIOR_COMBOS, drawFrac, doubleShotBand } from '../data/pvp.js'` with `import { WARRIOR_COMBOS, drawFrac, doubleShotBand, BUFFS, BUFF_COLORS } from '../data/pvp.js'`, and append at the end of the file:

```js
// --- 2b: buff spots, buff looks ---------------------------------------
// (spec 2026-09-27-pvp-2b-pickups-arenas-design.md §2-§3)

// Each buff's icon in the sprite atlas.
export const BUFF_ICON = { haste: 'buff_haste', might: 'buff_might', ward: 'buff_ward', ember: 'buff_ember', venom: 'buff_venom' }

// How a buff spot is drawn: the icon of the buff up now, or — while the
// spot is down — the ghost of the one it brings back at 30 % alpha. A
// major is drawn larger, with a gold rim and a slow pulse (`t`: seconds,
// the renderer's clock).
export function spotLook(p, t = 0) {
  const major = p.tier === 'major'
  const kind = p.up ? p.buff : p.next
  const pulse = major ? 0.5 + 0.5 * Math.sin(t * 2.5) : 0
  return { key: BUFF_ICON[kind] ?? null, kind, alpha: p.up ? 1 : 0.3, scale: major ? 1.3 + 0.08 * pulse : 1,
    rim: major, pulse }
}

// What a hero's buffs and damage-over-time look like: the Haste trail,
// the Might glint, the Ward bubble (its opacity the pool left, 0-1), the
// edge's embers or drips, a burn's flicker, a poison's tint.
export function heroLooks(hero) {
  const b = hero?.buffs ?? {}
  const ward = b.ward ? b.ward.pool / BUFFS.ward[b.ward.tier].pool : 0
  return { haste: !!b.haste, might: !!b.might, ward, edge: b.edge?.kind ?? null,
    burning: (hero?.burn?.t ?? 0) > 0, poisoned: (hero?.poison?.t ?? 0) > 0 }
}

// A buff spot, at its tile's top-left (px, py).
export function drawBuffSpot(ctx, p, sprites, px, py, S, t = performance.now() / 1000) {
  const look = spotLook(p, t)
  const img = look.key && sprites[look.key]
  const size = S * look.scale, x = px + (S - size) / 2, y = py + (S - size) / 2
  ctx.save()
  // A soft disc in the buff's colour under the icon, so each kind reads at a glance.
  ctx.fillStyle = BUFF_COLORS[look.kind] ?? '#ffffff'
  ctx.globalAlpha = look.alpha * 0.25
  ctx.beginPath(); ctx.arc(px + S / 2, py + S / 2, size * 0.45, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = look.alpha
  if (look.rim) {
    ctx.strokeStyle = '#facc15'
    ctx.lineWidth = 2 + look.pulse
    ctx.beginPath(); ctx.arc(px + S / 2, py + S / 2, size * 0.55, 0, Math.PI * 2); ctx.stroke()
  }
  if (img) ctx.drawImage(img, x, y, size, size)
  ctx.restore()
}

// Under the sprite: Haste's speed trail, three streaks behind the facing.
export function drawBuffUnder(ctx, hero, cx, cy, S, t = performance.now() / 1000) {
  if (!heroLooks(hero).haste) return
  const a = (FACING_ANGLE[hero.facing] ?? 0) + Math.PI
  const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux
  ctx.save()
  ctx.strokeStyle = BUFF_COLORS.haste
  ctx.lineCap = 'round'
  ctx.lineWidth = 3
  for (let i = -1; i <= 1; i++) {
    const len = 14 + 5 * Math.sin(t * 18 + i * 2)
    const sx = cx + ux * S * 0.3 + nx * i * 8, sy = cy + uy * S * 0.3 + ny * i * 8
    ctx.globalAlpha = i === 0 ? 0.75 : 0.5
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + ux * len, sy + uy * len); ctx.stroke()
  }
  ctx.restore()
}

// Over the sprite: the Ward bubble, the Might glint, the edge's embers or
// drips, and a burn's flicker or a poison's tint over the hero's square.
export function drawBuffOver(ctx, hero, hx, hy, S, t = performance.now() / 1000) {
  const look = heroLooks(hero)
  const cx = hx + S / 2, cy = hy + S / 2
  ctx.save()
  if (look.burning) {
    ctx.globalAlpha = 0.3 + 0.2 * Math.sin(t * 18)
    ctx.fillStyle = '#f97316'
    ctx.fillRect(hx, hy, S, S)
    ctx.fillStyle = '#fde047'                         // two licks of flame at the feet
    for (let i = 0; i < 2; i++) {
      const h = 6 + 4 * Math.sin(t * 14 + i * 3)
      ctx.globalAlpha = 0.85
      ctx.fillRect(hx + 8 + i * 12, hy + S - h, 4, h)
    }
  }
  if (look.poisoned) {
    ctx.globalAlpha = 0.35
    ctx.fillStyle = '#22c55e'
    ctx.fillRect(hx, hy, S, S)
  }
  if (look.ward > 0) {
    ctx.globalAlpha = 0.15 + 0.3 * look.ward
    ctx.fillStyle = BUFF_COLORS.ward
    ctx.beginPath(); ctx.arc(cx, cy, S * 0.62, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 0.4 + 0.5 * look.ward
    ctx.strokeStyle = '#e0e7ff'
    ctx.lineWidth = 2
    ctx.stroke()
  }
  if (look.might) {
    // A red four-point glint at the weapon hand, on the side the hero faces.
    const side = hero.facing === 'west' ? -1 : 1
    const gx = cx + side * S * 0.32, gy = cy + S * 0.1
    const r = 4 + 2 * Math.sin(t * 9)
    ctx.globalAlpha = 1
    ctx.fillStyle = BUFF_COLORS.might
    ctx.beginPath()
    ctx.moveTo(gx, gy - r * 1.8); ctx.lineTo(gx + r * 0.5, gy); ctx.lineTo(gx, gy + r * 1.8); ctx.lineTo(gx - r * 0.5, gy); ctx.closePath()
    ctx.moveTo(gx - r * 1.8, gy); ctx.lineTo(gx, gy + r * 0.5); ctx.lineTo(gx + r * 1.8, gy); ctx.lineTo(gx, gy - r * 0.5); ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillRect(gx - 1, gy - 1, 2, 2)
  }
  if (look.edge === 'ember') {
    ctx.fillStyle = BUFF_COLORS.ember
    for (let i = 0; i < 6; i++) {
      const k = (t * 0.9 + i / 6) % 1
      ctx.globalAlpha = 0.95 * (1 - k)
      ctx.fillRect(cx - 13 + i * 5 + Math.sin(t * 5 + i) * 2, cy + S * 0.35 - k * S, 3, 3)
    }
  } else if (look.edge === 'venom') {
    ctx.fillStyle = BUFF_COLORS.venom
    for (let i = 0; i < 4; i++) {
      const k = (t * 0.8 + i / 4) % 1
      ctx.globalAlpha = 0.95 * (1 - k)
      ctx.fillRect(cx - 11 + i * 7, cy - S * 0.1 + k * S * 0.6, 3, 4)
    }
  }
  ctx.restore()
}
```

In `renderer/render/canvas.js`:
- Replace `import { drawComboFx, drawArrowTrail } from './pvp-fx.js'` with

```js
import { drawComboFx, drawArrowTrail, drawBuffSpot, drawBuffUnder, drawBuffOver } from './pvp-fx.js'
import { BUFF_COLORS } from '../data/pvp.js'
```

- In `drawEntity`, replace

```js
  if (entity.type === 'pvp_pickup') {
    const key = { flask: 'potion', quiver: 'item_arrows', rune: 'weapon_ukonvasara' }[entity.kind]
```

with

```js
  if (entity.type === 'pvp_pickup') {
    if (entity.kind === 'buff') { drawBuffSpot(ctx, entity, sprites, px, py, S); return }
    const key = { flask: 'potion', quiver: 'item_arrows', rune: 'weapon_ukonvasara' }[entity.kind]
```

- In `drawHero`, replace

```js
  if (hero.rune) drawRuneGlow(ctx, hx + S / 2, hy + S / 2, S)
  if (isFlickerVisible(hero.invulnTimer)) drawEntity(ctx, hero, hx, hy, S, sprites)
```

with

```js
  if (hero.rune) drawRuneGlow(ctx, hx + S / 2, hy + S / 2, S)
  if (hero.buffs) drawBuffUnder(ctx, hero, hx + S / 2, hy + S / 2, S)
  if (isFlickerVisible(hero.invulnTimer)) drawEntity(ctx, hero, hx, hy, S, sprites)
  if (hero.buffs) drawBuffOver(ctx, hero, hx, hy, S)
```

(single-player's player has no `buffs`, so neither call runs for it).
- In `_drawFeedback`, replace `      const COLORS = { taken: '#ef4444', dealt: '#f8fafc', heal: '#4ade80' }` with `      const COLORS = { taken: '#ef4444', dealt: '#f8fafc', heal: '#4ade80', ...BUFF_COLORS }   // a buff float is its buff's colour (2b)`.

- [ ] **Step 4: The HUD buff row**

In `renderer/ui/pvp-hud.js`, replace `import { PVP } from '../data/pvp.js'` with

```js
import { PVP, BUFFS, BUFF_COLORS } from '../data/pvp.js'
import { SPRITES } from '../render/sprites.js'
import { BUFF_ICON } from '../render/pvp-fx.js'
```

and replace

```js
export function hidePvpHud() {
  document.getElementById('pvp-hud')?.remove()
}
```

with

```js
export function hidePvpHud() {
  document.getElementById('pvp-hud')?.remove()
  document.getElementById('pvp-buffs')?.remove()
}

// The local hero's buff row (2b spec §3): one icon per buff held, in slot
// order, each with a countdown ring (`frac`: the time left of its tier's
// full time) — no text. A major is rimmed in gold.
export function buffRowModel(hero) {
  const b = hero?.buffs
  if (!b || hero.dead) return []
  return ['haste', 'might', 'ward', 'edge'].filter(s => b[s]).map(s => {
    const kind = s === 'edge' ? b.edge.kind : s
    const { tier, t } = b[s]
    return { kind, tier, frac: Math.max(0, Math.min(1, t / BUFFS[kind][tier].dur)), color: BUFF_COLORS[kind],
      src: `./assets/tiles/${SPRITES[BUFF_ICON[kind]]}.png` }
  })
}

// The row sits under the time strip. The ring's angle is rounded to 10°,
// so the markup (and the DOM) changes a few times a second, not every frame.
export function updateBuffRow(row) {
  let node = document.getElementById('pvp-buffs')
  if (!node) {
    node = document.createElement('div')
    node.id = 'pvp-buffs'
    node.style.cssText = 'position:absolute;top:34px;left:50%;transform:translateX(-50%);display:flex;gap:6px;pointer-events:none'
    document.getElementById('hud-overlay').appendChild(node)
  }
  const html = row.map(b => {
    const deg = Math.round(b.frac * 36) * 10
    const rim = b.tier === 'major' ? '#facc15' : 'rgba(0,0,0,0.6)'
    return `<div style="width:30px;height:30px;border-radius:50%;padding:3px;box-sizing:border-box;border:2px solid ${rim};` +
      `background:conic-gradient(${b.color} ${deg}deg, rgba(15,23,42,0.75) 0)">` +
      `<img src="${b.src}" style="width:100%;height:100%;image-rendering:pixelated;display:block"></div>`
  }).join('')
  if (node._html === html) return
  node._html = html
  node.innerHTML = html
}
```

In `renderer/game.js`:
- Replace the pvp-hud import with `import { pvpHudModel, updatePvpHud, hidePvpHud, netHudModel, respawnLine, buffRowModel, updateBuffRow } from './ui/pvp-hud.js'`.
- In `pvpFrame`, directly after `  updatePvpHud(pvpHudModel(match, LOCAL_ID))` add `  updateBuffRow(buffRowModel(view.player))`.
- In `netFrame`, directly after `  updatePvpHud(netHudModel(v, s.heroId))` add `  updateBuffRow(buffRowModel(view.player))`.

Run: `node --test test/pvp-fx.test.js test/sprites.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: PASS.

Run: `node --check renderer/game.js && node --check renderer/render/canvas.js && node --check renderer/render/pvp-fx.js && node --check renderer/ui/pvp-hud.js && echo ok`
Expected: `ok`.

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# fail 0`.

- [ ] **Step 5: The live check (time-boxed, about 2 minutes)**

The script runs the web server **in-process** on port 8094 with a 10-minute match and a 0.5 s results delay. Aino (the page) quick-joins as a Warrior against three bots. The script stages every shot server-side: it places Aino and freezes the bots with a long stun, sets spots up or down, grants buffs and burns, and jumps the room to Keep and then Wilds by setting `room.arenaIndex` and ending the match. Write it in the scratchpad as `live-2b.mjs`:

```js
// Local 2b checks, online through an in-process server so the script can
// stage heroes and spots: buff spots up and ghosted, every hero look, the
// HUD buff row, a real take, then Keep and Wilds. Run from the repo root:
//   node debug-2b-live.mjs <outdir>
import http from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { attachPvp } from './server/pvp-server.js'
import { makeStaticHandler } from './server/static.js'
import { placeHero } from './renderer/pvp/hero.js'
import { grantBuff } from './renderer/pvp/buffs.js'

const out = process.argv[2]
const server = http.createServer(makeStaticHandler(path.resolve('renderer')))
const pvp = attachPvp(server, { matchLength: 600, resultsDelay: 0.5 })
await new Promise(r => server.listen(8094, '127.0.0.1', r))
const errors = []
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(fn, ms = 15000) {
  const end = Date.now() + ms
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await sleep(50) }
}
const room = () => [...pvp.lobby.rooms.values()][0]
const me = () => room()?.match.heroes.find(h => h.name === 'Aino')
const bots = () => room().match.heroes.filter(h => h.name !== 'Aino')
const freeze = () => { for (const b of bots()) { b.dead = false; b.respawnT = 0; b.stunTimer = 1e9; b.spawnProtect = 0; b.hp = b.maxHp } }
const stage = (at, foes) => {
  const m = me()
  m.spawnProtect = 1e9; m.hp = m.maxHp
  placeHero(m, at)
  bots().forEach((b, i) => placeHero(b, foes[i]))
  freeze()
}
const spot = (tier, i = 0) => room().match.pickups.filter(p => p.kind === 'buff' && p.tier === tier)[i]
const nextArena = async (index, id) => {
  room().arenaIndex = index
  room().match.clock = room().match.matchLength
  await until(() => room().match.arena.id === id && !room().match.ended)
  await sleep(1200)
}
const browser = await chromium.launch()
const p = await browser.newPage({ viewport: { width: 1280, height: 720 } })
p.on('pageerror', e => errors.push(e.message))
await p.goto('http://127.0.0.1:8094'); await p.waitForSelector('.menu-btn')
await p.click('.menu-btn:has-text("Online")')
await p.click('.menu-btn:has-text("Quick match")')
await p.fill('.menu-input', 'Aino'); await p.keyboard.press('Enter')
await p.click('.menu-btn:has-text("Warrior")')
await until(() => me() && bots().length >= 3)
await until(async () => await p.locator('#menu-overlay').isHidden())
const result = {}

// 1. Pillars: one minor spot up (ward), the other down showing a venom ghost.
const [b0, b1] = [spot('minor', 0), spot('minor', 1)]
b0.up = true; b0.buff = 'ward'; b0.next = null
b1.up = false; b1.buff = null; b1.next = 'venom'; b1.t = 500
stage({ x: 19, y: 5 }, [{ x: 28, y: 20 }, { x: 29, y: 21 }, { x: 27, y: 21 }])
await sleep(600)
await p.screenshot({ path: `${out}/spot-up.png` })
stage({ x: 12, y: 18 }, [{ x: 28, y: 20 }, { x: 29, y: 21 }, { x: 27, y: 21 }])
await sleep(600)
await p.screenshot({ path: `${out}/spot-ghost.png` })

// 2. A real take: Aino walks east onto the ward spot at 22,5.
stage({ x: 20, y: 5 }, [{ x: 28, y: 20 }, { x: 29, y: 21 }, { x: 27, y: 21 }])
await sleep(300)
await p.keyboard.down('d'); await sleep(450); await p.keyboard.up('d')
await sleep(150)
await p.screenshot({ path: `${out}/take.png` })
result.take = { ward: { ...me().buffs.ward }, spotUp: b0.up, ghost: b0.next }

// 3. Every hero look and the HUD row: Aino with all four slots; the bots
// burning, poisoned and warded, around her.
stage({ x: 15, y: 11 }, [{ x: 18, y: 11 }, { x: 15, y: 14 }, { x: 12, y: 11 }])
const [x, y, z] = bots()
grantBuff(me(), 'haste', 'major'); grantBuff(me(), 'might', 'minor'); grantBuff(me(), 'ward', 'major'); grantBuff(me(), 'ember', 'major')
x.burn = { owner: me().id, t: 1e9, next: 1e9 }
y.poison = { owner: me().id, t: 1e9, next: 1e9 }; grantBuff(y, 'venom', 'minor')
grantBuff(z, 'ward', 'minor'); z.buffs.ward.t = 1e9
await sleep(600)
await p.screenshot({ path: `${out}/looks.png` })
await p.screenshot({ path: `${out}/looks-zoom.png`, clip: { x: 360, y: 250, width: 560, height: 260 } })
result.hud = await p.locator('#pvp-buffs img').count()

// 4. Keep: the courtyard and its major spot, up.
await nextArena(1, 'keep')
spot('major').up = true; spot('major').buff = 'might'; spot('major').next = null
stage({ x: 25, y: 21 }, [{ x: 2, y: 36 }, { x: 52, y: 36 }, { x: 52, y: 2 }])
await sleep(800)
await p.screenshot({ path: `${out}/keep.png` })
stage({ x: 9, y: 8 }, [{ x: 2, y: 36 }, { x: 52, y: 36 }, { x: 52, y: 2 }])
await sleep(800)
await p.screenshot({ path: `${out}/keep-yard.png` })
result.keep = room().match.arena.id

// 5. Wilds: the meadow's major spot, still down, as a ghost; then a corner clearing.
await nextArena(4, 'wilds')
stage({ x: 24, y: 19 }, [{ x: 50, y: 34 }, { x: 4, y: 34 }, { x: 50, y: 4 }])
await sleep(800)
await p.screenshot({ path: `${out}/wilds.png` })
stage({ x: 8, y: 7 }, [{ x: 50, y: 34 }, { x: 4, y: 34 }, { x: 50, y: 4 }])
await sleep(800)
await p.screenshot({ path: `${out}/wilds-corner.png` })
result.wilds = room().match.arena.id

// 6. The local mode (the `pvp` title cheat): a few seconds against the
// page's own bots, for page errors and the spots drawn.
const q = await browser.newPage({ viewport: { width: 1280, height: 720 } })
q.on('pageerror', e => errors.push(`local: ${e.message}`))
await q.goto('http://127.0.0.1:8094'); await q.waitForSelector('.menu-btn')
await q.keyboard.type('pvp'); await q.waitForSelector('.menu-btn:has-text("Mage")')
await q.click('.menu-btn:has-text("Mage")')
await q.keyboard.down('s'); await sleep(1500); await q.keyboard.up('s')
await q.screenshot({ path: `${out}/local.png` })
result.local = await q.locator('#menu-overlay').isHidden()

console.log(JSON.stringify({ ...result, errors }, null, 1))
await browser.close()
pvp.close(); server.close()
```

Run:

```bash
SP=/tmp/claude-1000/-home-lappemikb-projects-dungeon-crawler/170eab54-57f1-4834-98b0-cda083c36a9c/scratchpad
cd /home/lappemikb/projects/dungeon-crawler && mkdir -p "$SP/shots2b" && cp "$SP/live-2b.mjs" debug-2b-live.mjs && timeout 180 node debug-2b-live.mjs "$SP/shots2b"; rm -f debug-2b-live.mjs
```

Expected output:
- `take`: `ward` is `{ tier: 'minor', t: ≈14.8, pool: 2 }` (Aino walked onto the spot), `spotUp: false`, and `ghost` is one of the five buff names (the server seeds with Math.random);
- `hud`: `4`;
- `keep`: `"keep"`, `wilds`: `"wilds"`, `local`: `true`;
- `errors`: `[]`.

Read the screenshots in `/tmp/claude-1000/-home-lappemikb-projects-dungeon-crawler/170eab54-57f1-4834-98b0-cda083c36a9c/scratchpad/shots2b`:
- `spot-up.png`: the kite-shield Ward icon on a soft lavender disc, three tiles east of Aino;
- `spot-ghost.png`: a faint green draught (the Venom ghost) at 30 %;
- `take.png`: Aino on the spot with a lavender `+` float, the spot now a faint ghost, and the HUD row showing one ringed icon under the time strip;
- `looks.png` and `looks-zoom.png`: Aino with a blue speed trail behind her, a red glint at her sword hand, a lavender bubble and orange embers; the bot to the east burning (an orange flicker and licks of flame), the one to the south poisoned (green tint and drips), the one to the west in a bubble; the HUD row showing four ringed icons, Haste, Ward and Ember rimmed gold as majors and Might not;
- `keep.png`, `keep-yard.png`: Keep's sand courtyard with the gold-rimmed, pulsing Might axe (`B`) at the centre, the fort walls, and the yards and rubble outside;
- `wilds.png`, `wilds-corner.png`: the grass meadow with the major spot's ghost, and a corner clearing between the thickets;
- `local.png`: a local `pvp` match with the two minor spots drawn and no error overlay.

If anything fails, fix the cause (with a test where the cause lies in pure code) and re-run once. Do not extend the time box beyond that. Report to the user, without changing any number, how the looks read. The prototype found them clear at 1:1 but modest at full-screen distance, and the castle ruleset draws some of Keep's wall cells with door, stair and gargoyle art, which reads as clutter. Both are look-only follow-ups.

- [ ] **Step 6: Docs (outside the repo, not committed)**

In `/home/lappemikb/CLAUDE.md`, in the dungeon-crawler `renderer/pvp/` bullet:
- change `the shared protocol v4 (`protocol.js`)` to `the shared protocol v5 (`protocol.js`)`;
- after the sentence that ends `Visuals are in `renderer/render/pvp-fx.js`.`, add:

```markdown
Sub-project 2b (spec `docs/superpowers/specs/2026-09-27-pvp-2b-pickups-arenas-design.md`): buff spots (grid `b` minor, `B` major) roll one of five buffs from the match's seeded PRNG (`renderer/pvp/rng.js`, `makeMatch({ seed })`) at the start and whenever taken, showing the coming one as a ghost. `renderer/pvp/buffs.js` keeps `hero.buffs = { haste, might, ward, edge }` (same buff: higher tier, longer time; the other edge replaces), ticked in `moveHero` so the predictor runs Haste too. `hurtHero({ direct })` adds Might to direct hits, soaks through the Ward via `damagePlayer`'s optional `soak`, and on a landed direct hit applies the Ember/Venom edge (`renderer/pvp/dots.js`: burn/poison `{ owner, t, next }` dealt by the sim's `tickDots`, Venom's slow on the ordinary slow timer, a major Ember's patch one per attacker). The large arenas Keep (castle) and Wilds (grass) are 55×39 (`buildArena` clamps to 60×44) and `playableIndex` skips them for a match under 4 heroes; bots head for a major spot within 10 tiles and detour to a minor one within 6 when no foe is within 4. Protocol v5 carries `buffs`/`dots` and the spots' `tier`/`buff`/`next`/`t`. Measure with `node tools/perf/pvp-step.mjs` and `node tools/pvp-soak.mjs`.
```

- [ ] **Step 7: Commit**

```bash
git add renderer/render/sprites.js renderer/render/pvp-fx.js renderer/render/canvas.js renderer/ui/pvp-hud.js renderer/game.js test/pvp-fx.test.js
git commit -m "feat(pvp): 2b visuals — buff spot icons and ghosts, hero buff looks, the HUD buff row

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 10: The bot soak report

**Files:**
- Create: `tools/pvp-soak.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: `node tools/pvp-soak.mjs [matches=20]`, a report of buffs taken per kind and tier, per-class K/D and time-to-kill, and the two stall measures.

- [ ] **Step 1: The tool**

Create `tools/pvp-soak.mjs`:

```js
// A bot soak of PvP matches (2b spec, Testing): four bots a match through
// the arena rotation, seeded, headless. Prints the buffs taken per kind and
// tier, time-to-kill (first damage taken in a life → death; 2a's soak was
// 8.3 s) and per-class K/D, plus the stall checks the 2a bugs taught: the
// longest a bot sent attack against needRelease, and the longest it stood
// idle (no move, no attack or alt) with a foe within 5 tiles.
//
//   node tools/pvp-soak.mjs [matches=20]
import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'
import { botInput } from '../renderer/pvp/bots.js'
import { PVP, CLASSES } from '../renderer/data/pvp.js'
import { arenaAt } from '../renderer/data/pvp-arenas.js'
import { TILE_SIZE } from '../renderer/systems/movement.js'

const N = Number(process.argv[2] ?? 20)
const cls = Object.fromEntries(CLASSES.map(c => [c, { kills: 0, deaths: 0, ttk: [] }]))
const buffs = {}, arenas = {}
let latchMax = 0, idleMax = 0
for (let m = 0; m < N; m++) {
  // Class mixes rotate with the match number, as 2a's soak did.
  const roster = [0, 1, 2, 3].map(i => ({ id: `b${i}`, name: `B${i}`, cls: CLASSES[(m + i * (1 + (m % 2))) % 3] }))
  const match = makeMatch({ roster, arena: arenaAt(m), seed: 1000 + m })
  arenas[match.arena.id] = (arenas[match.arena.id] ?? 0) + 1
  const byId = id => match.heroes.find(h => h.id === id)
  const firstHit = {}, latch = {}, idle = {}, last = {}
  while (!match.ended) {
    const inputs = Object.fromEntries(match.heroes.map(h => [h.id, botInput(match, h)]))
    for (const h of match.heroes) {
      const i = inputs[h.id]
      latch[h.id] = !h.dead && h.needRelease && i.attack ? (latch[h.id] ?? 0) + PVP.tick : 0
      const near = match.heroes.some(f => f !== h && !f.dead && Math.hypot(f.px - h.px, f.py - h.py) < 5 * TILE_SIZE)
      const moved = last[h.id] && (last[h.id].px !== h.px || last[h.id].py !== h.py)
      idle[h.id] = !h.dead && near && !moved && !i.attack && !i.alt ? (idle[h.id] ?? 0) + PVP.tick : 0
      latchMax = Math.max(latchMax, latch[h.id]); idleMax = Math.max(idleMax, idle[h.id])
      last[h.id] = { px: h.px, py: h.py }
    }
    const t = (match.tick + 1) * PVP.tick
    for (const e of stepMatch(match, inputs, PVP.tick)) {
      if (e.type === 'hit' && e.amount > 0 && firstHit[e.target] == null) firstHit[e.target] = t
      if (e.type === 'pickup' && e.kind === 'buff') buffs[`${e.buff} ${e.tier}`] = (buffs[`${e.buff} ${e.tier}`] ?? 0) + 1
      if (e.type === 'respawn') firstHit[e.hero] = null
      if (e.type === 'kill') {
        const v = byId(e.victim), k = byId(e.killer)
        cls[v.cls].deaths++
        if (firstHit[v.id] != null) cls[v.cls].ttk.push(t - firstHit[v.id])
        firstHit[v.id] = null
        if (k) cls[k.cls].kills++
      }
    }
  }
}
const mean = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? NaN
console.log(`${N} matches: ${JSON.stringify(arenas)}`)
console.log('buffs taken:', Object.entries(buffs).sort().map(([k, n]) => `${k} ${n}`).join(', '))
for (const c of CLASSES) {
  const s = cls[c]
  console.log(`${c.padEnd(8)} K/D ${(s.kills / Math.max(1, s.deaths)).toFixed(2)} (${s.kills}/${s.deaths})  TTK mean ${mean(s.ttk).toFixed(2)} s`)
}
const all = CLASSES.flatMap(c => cls[c].ttk)
console.log(`TTK mean ${mean(all).toFixed(2)} s, median ${median(all).toFixed(2)} s (n ${all.length}; 2a: 8.3 s, target 6.2-10.4 s)`)
console.log(`longest attack-against-needRelease ${latchMax.toFixed(2)} s, longest idle near a foe ${idleMax.toFixed(2)} s`)
```

- [ ] **Step 2: Run the soak**

Run: `node tools/pvp-soak.mjs 20` (about 25 s)
Expected (the prototype's run, which is exactly repeatable: every match is seeded):

```
20 matches: {"pillars":4,"glade":4,"keep":3,"tunnels":3,"ruins":3,"wilds":3}
buffs taken: ember minor 79, haste major 5, haste minor 83, might major 4, might minor 96, venom major 8, venom minor 88, ward major 12, ward minor 72
warrior  K/D 1.05 (308/293)  TTK mean 9.68 s
archer   K/D 1.03 (334/323)  TTK mean 8.20 s
mage     K/D 0.90 (244/270)  TTK mean 10.46 s
TTK mean 9.38 s, median 6.93 s (n 886; 2a: 8.3 s, target 6.2-10.4 s)
longest attack-against-needRelease 0.00 s, longest idle near a foe 1.07 s
```

Pass criteria:
- the overall TTK mean inside 6.2–10.4 s (2a's 8.3 s ± 25 %);
- every class K/D between 0.8 and 1.25;
- both tiers taken; minor spots taken of every kind;
- `attack-against-needRelease` under 1 s;
- `idle near a foe` under 5 s.

Ember major not coming up in these 20 seeds is chance: a major spot rolls about five times per large-arena match. Its path is covered by Task 3's tests. If a criterion fails, find the cause before touching any number, and report the tuning question to the user rather than retuning `BUFFS` on your own: the numbers are the spec's.

The TTK rises about 13 % from 2a. The expected causes are Ward soaking hits and Haste letting the hurt escape to flasks, against Might and the edges shortening fights. That is inside the band.

- [ ] **Step 3: Commit**

```bash
git add tools/pvp-soak.mjs
git commit -m "tools(pvp): 20-match bot soak report — buffs per kind and tier, TTK, K/D, stall checks

Co-Authored-By: <model> <noreply@anthropic.com>"
```

Put the soak output and the Task 7 benchmark numbers in the PR description.

**After merge (controller, with the user's go-ahead — not part of any task):** fast-forward `web-release` from `main`, push both branches, and run `tools/deploy-web.sh` (see the web-release memory). Then on the public URL: quick-join, take a minor spot, watch a major spot's ghost pulse into life, and play a match on Keep or Wilds (the rotation reaches Keep third). Update the deploy memory.

---

## Self-review

- **Spec coverage.**
  - §1 Buffs:
    - the numbers → Task 1;
    - the state, stacking and refresh, the edge replacing the other edge, clearing on death and `applyKit`, the rune coexisting, Haste in `moveHero` with predictor parity → Task 2;
    - direct hits, Might, Ward (after the block, before hp, i-frames and credit when absorbed), the edges on a landed hit only, `tickDots` with credit, an owner who left, and self-immunity through `hurtHero` → Task 3;
    - Venom's slow × `ccMul` → Task 3, with parity in Task 8.
  - §2 Buff spots:
    - the letters, rolls from `match.rng`, the seed from the server, the local mode and the tests → Tasks 1 and 4;
    - taking on the hero's tile, respawns, the major's first spawn, the ghost → Task 4;
    - 2 symmetric `b` in each small arena, with the invariants → Task 4;
    - icons, majors larger with a gold rim and pulse, ghosts at 30 % → Task 9.
  - §3 Hero looks, the HUD row (no text, countdown rings), the pickup cue and float → Tasks 4 (cue, local float), 8 (online float) and 9 (colours and drawing).
  - §4 Large arenas:
    - Keep and Wilds with the counts, reachability, spawn gaps, `B`/`b` distances and the chokepoint rule → Task 5;
    - the clamp raised with existing configs pinned → Task 5;
    - the rotation, `large`, the skip for fewer than 4 heroes, server and local → Task 5;
    - performance ≤ 2 ms → Task 7.
  - §5 Bots: minor and major seeking, the flask keeping priority → Task 6.
  - §6 Protocol v5: `buffs` → Task 2; `dots`, the pickup fields, the version, never predicting pickups, Venom on the slow fields → Task 8.
  - Testing: the unit tests in each task, the bot soak (Task 10), the benchmark (Task 7), and the live screenshots (Task 9).
- **Prototyped.** The whole plan was built task by task in a scratch worktree (branch `proto-2b`) before this document was written. Each task's new tests failed before its implementation step, where a failure was expected, and passed after it. `npm test` stayed green after every task and ended at 3179/3179. The code and test blocks above were generated from that worktree's files, so they are the ones that ran. The Task 7 benchmark, the Task 10 soak and the Task 9 live script printed the numbers quoted in them, and the live script's screenshots were read.
- **Placeholders:** none. Every code step carries its code, and every path is spelled out.
- **Type consistency:**
  - `grantBuff`/`tickBuffs`/`clearBuffs`/`hasteMul`/`mightBonus`/`copyBuffs` (Task 2) are what `moveHero`, `resolveDeaths`, `applyKit` and the protocol use. `soakWard` (Task 3) is added to the same file and passed to `damagePlayer`.
  - `setDot`/`applyEdge` (Task 3) write the `{ owner, t, next }` that `tickDots` reads, `heroSnap`'s `dots` sends (Task 8) and `heroLooks` draws (Task 9).
  - `makePickups(arena, rng)` and the spot fields `{ tier, buff, next, t }` (Task 4) are what the bots (Task 6), `snapshotBody` and `pickupEntities` (Task 8), and `spotLook` (Task 9) read.
  - `playableIndex` (Task 5) is used by `startNextMatch` and `makeLocalMatch`, and `match.arenaIndex` by game.js.
- **Review Focus:** each of the five lines has its test in the owning task (Tasks 2, 3, 4 and 8).
