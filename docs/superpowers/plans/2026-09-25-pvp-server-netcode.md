# PvP Server + Netcode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two to six people in the web build play one PvP match, joined by a 4-letter room code. A Node WebSocket server runs the authoritative sim; clients predict their own movement, interpolate the other heroes, and melee hits are rewound by up to 200 ms.

**Architecture:**
- `tools/web-server.mjs` keeps serving `renderer/` and hands WebSocket upgrades on `/pvp` to `server/pvp-server.js`.
- `server/rooms.js` is pure room logic (codes, input queues, the tick step, position history, the next match); the socket layer stays thin.
- The shared, DOM-free `renderer/net/` holds:
  - the protocol and snapshot hydration (`protocol.js`);
  - prediction and reconciliation (`predict.js`);
  - interpolation (`interp.js`);
  - the client session (`client.js`, which takes a WebSocket constructor so Node tests can use `ws`);
  - the render-view adapter (`view.js`).
- `game.js` gains a `net` branch beside the local `pvp` one.

**Tech Stack:** vanilla ES modules, Node 22 (CI) / Node 20 (container), `ws@^8`, `node:test`, `playwright-core` for the live check.

**Spec:** `docs/superpowers/specs/2026-09-25-pvp-server-netcode-design.md` (roadmap `…-pvp-roadmap.md`; sub-project 1 spec `…-pvp-multi-hero-core-design.md`)

## Global Constraints

- Nothing under `renderer/pvp/`, `renderer/net/` or `renderer/data/` references `document`, `window`, `localStorage` or `render/*`. Browser APIs are passed in: `WebSocketImpl` (default `globalThis.WebSocket`), and a `location` object for `netUrl`.
- Every netcode number lives in `renderer/data/net.js` (`NET`). PvP tuning stays in `renderer/data/pvp.js` (`PVP`, now with `minHeroes: 2`).
- Protocol v1 exactly as the spec's table:
  - messages `hello`, `input`, `class`, `ping`, `welcome`, `snap`, `error`, `pong`;
  - error codes `version`, `no_room`, `room_full`, `bad_name`, `bad_hello`, `server_full`.
- Numbers from the spec:

  | What | Value |
  |---|---|
  | Sim tick / snapshot rate | 30 Hz sim (`PVP.tick`), 20 Hz snapshots |
  | Interpolation delay | 3 ticks |
  | Extrapolation cap | 3 ticks |
  | Rewind cap / history ring | 6 ticks / 8 ticks |
  | Input queue cap | 4 |
  | Stale input → neutral | after 15 ticks |
  | Results before the next match | 10 s |
  | Ping / heartbeat | 2 s / 5 s (terminate after 2 missed) |
  | Rooms / heroes per room | 50 / 6 |
  | `maxPayload` | 4096 bytes |
  | Names | 1–12 of `[A-Za-z0-9 _-]` |
  | Codes | 4 letters from `ABCDEFGHJKLMNPQRSTUVWXYZ` |
  | Correction thresholds | < 2 px snap, > 96 px snap, else blend over 100 ms |
- The local `pvp` vs-bots mode behaves exactly as today:
  - `match.hitPos` is never set locally;
  - with ≥ 2 heroes the clock always runs;
  - existing `test/pvp-*.test.js` pass unchanged.
- The server imports the sim straight from `renderer/pvp/sim.js`; there is no second copy of any game rule.
- Commits end with a `Co-Authored-By:` trailer naming the model that wrote them.
- Run the suite with `npm test`. A lone SIGSEGV from Node's runner on WSL is a known flake — re-run.

**Deliberate narrowing vs. the spec** (behaviour kept):
- **Cosmetic attack prediction** covers the tap swing (its animation starts locally) and the charge/cast wind-up (`charging`, which also keeps predicted movement exact). The blink trail comes from snapshots. The spec also listed blink.
- **Snapshot heroes** carry the offhand's kind (`off`) and the main hands' `weaponType`s instead of "outfit per stance". Outfits come from the class kit, which the client rebuilds with `applyKit`.
- **Damage floats and sounds on the client:** floats come from `hit` and `kill` events, and sounds from the server's sfx cue queue, which rides in each snapshot as `cues`.
- **The "Cost" check** runs in the rooms unit test (stepping a 6-hero room directly), not over sockets.
- **Deploying to Cloud Run is not a plan task.** The plan ends with `tools/deploy-web.sh` and a local two-browser check. The controller runs the deploy after the merge, with the user's go-ahead.

## Review Focus

The five uncovered inputs most likely to bite a player, each pinned by a test in the named task:
1. **A backgrounded tab** (the browser throttles `requestAnimationFrame`): the hero should stand still on the server rather than keep running, and the client shouldn't flood inputs when the tab returns → Task 3 "stale input goes neutral"; Task 6 "a 10 s frame gap sends at most maxFrame worth of inputs".
2. **The server going away mid-match** (a redeploy or crash): the client should show "Connection lost" and stop sending, with no exceptions → Task 6 "server close marks the session lost and frame() is a no-op".
3. **Joining while the results panel is up:** the newcomer should be in the next match → Task 3 "a hero joining during results is in the next match".
4. **Two players with the same name:** both allowed, told apart by id → Task 3 "same name twice joins fine".
5. **A room code typed in lowercase or with spaces:** it should still join → Task 2 `validateHello` normalises the code; Task 7 `normalizeCode`.

---

## File Structure

| File | Responsibility |
|---|---|
| `renderer/data/net.js` (new) | `NET` constants |
| `renderer/data/pvp.js` (edit) | `PVP.minHeroes = 2` |
| `renderer/pvp/sim.js` (edit) | `arenaMap`, `match.tick`, `match.waiting`, `matchLength` option, `addHero`, `removeHero` |
| `renderer/pvp/hero.js` (edit) | `moveHero` extracted from `tickHero` |
| `renderer/pvp/attacks.js` (edit) | the `swing` hit test reads `match.hitPos` |
| `renderer/net/protocol.js` (new) | message/error constants, `encode`/`decode`, `validateInput`/`validateName`/`validateClass`/`validateHello`, `heroSnap`, `hydrateHero`, `snapshotBody` |
| `server/rooms.js` (new) | `makeLobby`, `createRoom`, `joinRoom`, `leaveRoom`, `queueInput`, `setRoomClass`, `stepRoom`, `rewoundPos` |
| `server/pvp-server.js` (new) | `attachPvp(httpServer, opts)`, `heartbeatSweep` |
| `tools/web-server.mjs` (edit) | attaches `/pvp` |
| `renderer/net/predict.js` (new) | `makePredictor`, `predictStep`, `predictCosmetics`, `reconcile`, `tickCorrection`, `drawnPos` |
| `renderer/net/interp.js` (new) | `makeInterp`, `pushSnap`, `estServerTick`, `renderTick`, `sample`, `heroPoses`, `projectilesAt`, `newest` |
| `renderer/net/client.js` (new) | `connect`, `frame`, `sessionView`, `sendClass`, `leave`, `drainEvents`, `drainCues` |
| `renderer/net/view.js` (new) | `netUrl`, `normalizeCode`, `errorText`, `netViewOf` |
| `renderer/systems/cheats.js`, `renderer/ui/menu.js`, `renderer/ui/pvp-hud.js`, `renderer/game.js` (edit) | `host`/`join` cheats, text entry, message screen, HUD room and ping, the net loop branch |
| `package.json`, `package-lock.json`, `Dockerfile`, `.gcloudignore` (edit), `tools/deploy-web.sh` (new) | the `ws` dependency and the container |
| `test/net-helpers.js` (new, not a test) | `startServer`, `laggy`, `drive`, `waitFor` |
| `test/net-{sim,protocol,rooms,server,predict,interp,play,ui}.test.js` (new) | tests |

---

### Task 1: Sim support — tick counter, waiting clock, drop-in heroes, `moveHero`, `hitPos`

**Files:**
- Create: `renderer/data/net.js`
- Modify: `renderer/data/pvp.js`, `renderer/pvp/sim.js`, `renderer/pvp/hero.js`, `renderer/pvp/attacks.js`
- Test: `test/net-sim.test.js`

**Interfaces:**
- Produces:
  - `NET` (every field below);
  - `PVP.minHeroes = 2`;
  - `arenaMap(arena = PVP_ARENAS.pillars) → map`;
  - `makeMatch({ arena, roster, sfx, matchLength = PVP.matchLength })`, which sets `match.tick = 0`, `match.waiting = roster.length < PVP.minHeroes`, `match.matchLength`;
  - `addHero(match, { id, name, cls }) → hero`, which throws on a duplicate id or a full arena and pushes `{ type:'join', hero:id }`;
  - `removeHero(match, id) → boolean`, which returns a held rune to its pedestal and pushes `{ type:'leave', hero:id }`;
  - `moveHero(match, hero, input, dt) → { stunned, blocking, altEdge }`;
  - `tickHero` now calls `moveHero`;
  - `swing` reads `match.hitPos?.(foe, attacker) ?? foe` for its hit test only.

- [ ] **Step 1: Write the failing tests**

`test/net-sim.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeMatch, stepMatch, addHero, removeHero, arenaMap } from '../renderer/pvp/sim.js'
import { makeHero, placeHero, moveHero, tickHero, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { swing } from '../renderer/pvp/attacks.js'
import { resolveCharge } from '../renderer/systems/melee.js'
import { grantRune } from '../renderer/pvp/pickups.js'
import { PVP } from '../renderer/data/pvp.js'
import { NET } from '../renderer/data/net.js'
import { testMatch } from './pvp-helpers.js'

const roster = (...cls) => cls.map((c, i) => ({ id: `h${i}`, name: `H${i}`, cls: c }))
const ticks = (m, n, inputs = {}) => { const ev = []; for (let i = 0; i < n; i++) ev.push(...stepMatch(m, inputs, PVP.tick)); return ev }
const east = { ...NEUTRAL_INPUT, move: { x: 1, y: 0 }, facing: 'east' }

describe('NET constants', () => {
  it('carries the spec numbers', () => {
    assert.equal(NET.protocolVersion, 1)
    assert.equal(NET.snapshotHz, 20)
    assert.equal(NET.rewindMaxTicks, 6)
    assert.equal(NET.maxPayload, 4096)
    assert.equal(PVP.minHeroes, 2)
  })
})

describe('match tick and the waiting clock', () => {
  it('the tick counter counts every simulated tick', () => {
    const m = makeMatch({ roster: roster('mage', 'archer') })
    ticks(m, 5)
    assert.equal(m.tick, 5)
  })
  it('a lone hero waits: the clock stays at 0 and the match never ends', () => {
    const m = makeMatch({ roster: roster('mage'), matchLength: 1 })
    assert.equal(m.waiting, true)
    const ev = ticks(m, 60)
    assert.equal(m.clock, 0)
    assert.equal(m.tick, 60)
    assert.equal(ev.some(e => e.type === 'matchEnd'), false)
  })
  it('the clock runs once a second hero arrives, and matchLength ends it', () => {
    const m = makeMatch({ roster: roster('mage'), matchLength: 1 })
    addHero(m, { id: 'h9', name: 'N', cls: 'archer' })
    const ev = ticks(m, 40)
    assert.equal(m.waiting, false)
    assert.ok(ev.some(e => e.type === 'matchEnd'))
  })
})

describe('addHero / removeHero', () => {
  it('adds at the farthest spawn with spawn protection and a join event', () => {
    const m = makeMatch({ roster: roster('mage') })
    placeHero(m.heroes[0], { x: 2, y: 2 })
    const h = addHero(m, { id: 'p2', name: 'Two', cls: 'warrior' })
    assert.deepEqual([h.x, h.y], [29, 21])
    assert.equal(h.spawnProtect, PVP.spawnProtect)
    assert.ok(m.events.some(e => e.type === 'join' && e.hero === 'p2'))
    assert.equal(m.heroes.length, 2)
  })
  it('rejects a duplicate id and a full arena', () => {
    const m = makeMatch({ roster: roster('mage') })
    assert.throws(() => addHero(m, { id: 'h0', name: 'X', cls: 'mage' }))
    for (let i = 1; i < 6; i++) addHero(m, { id: `x${i}`, name: 'X', cls: 'mage' })
    assert.throws(() => addHero(m, { id: 'x9', name: 'X', cls: 'mage' }))
  })
  it('removes a hero, returns a held rune to its pedestal and emits leave', () => {
    const m = makeMatch({ roster: roster('warrior', 'archer') })
    const rune = m.pickups.find(p => p.kind === 'rune')
    rune.up = false; rune.t = 50
    grantRune(m, m.heroes[0])
    assert.equal(removeHero(m, 'h0'), true)
    assert.equal(m.heroes.length, 1)
    assert.equal(rune.up, true)
    assert.ok(m.events.some(e => e.type === 'leave' && e.hero === 'h0'))
    assert.equal(m.entities.some(e => e.id === 'h0'), false)
    assert.equal(removeHero(m, 'nope'), false)
  })
})

describe('arenaMap', () => {
  it('is the same map makeMatch builds', () => {
    const map = arenaMap()
    const m = makeMatch({ roster: roster('mage') })
    assert.equal(map.length, m.map.length)
    assert.equal(map[0].length, m.map[0].length)
    assert.deepEqual(map.map(r => r.map(c => c.tile)), m.map.map(r => r.map(c => c.tile)))
  })
})

describe('moveHero', () => {
  it('moves exactly as tickHero does but never attacks', () => {
    const a = makeHero({ id: 'a', name: 'a', cls: 'warrior' }); placeHero(a, { x: 5, y: 5 })
    const b = makeHero({ id: 'b', name: 'b', cls: 'warrior' }); placeHero(b, { x: 5, y: 5 })
    const ma = testMatch([a]), mb = testMatch([b])
    const input = { ...east, attack: true }
    for (let i = 0; i < 10; i++) { moveHero(ma, a, input, PVP.tick); tickHero(mb, b, input, PVP.tick) }
    assert.equal(a.px, b.px)
    assert.equal(a.py, b.py)
    assert.equal(a.meleeCooldown, 0)        // moveHero never swung
    assert.ok(b.meleeCooldown > 0)          // tickHero did
  })
})

describe('swing hitPos seam', () => {
  const pair = () => {
    const w = makeHero({ id: 'w', name: 'w', cls: 'warrior' }); placeHero(w, { x: 5, y: 5 }); w.facing = 'east'
    const a = makeHero({ id: 'a', name: 'a', cls: 'archer' }); placeHero(a, { x: 8, y: 5 })   // 96 px: out of reach
    return { w, a, m: testMatch([w, a]) }
  }
  it('without hitPos a foe out of reach is missed', () => {
    const { w, a, m } = pair()
    swing(m, w, resolveCharge('sword', 0))
    assert.equal(a.hp, 10)
  })
  it('hitPos moves only the hit test: the rewound position is hit, damage lands on the real hero', () => {
    const { w, a, m } = pair()
    m.hitPos = foe => ({ type: foe.type, px: w.px + 32, py: w.py })
    swing(m, w, resolveCharge('sword', 0))
    assert.equal(a.hp, 8)
    assert.equal(a.px, 8 * 32 + 16)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/net-sim.test.js`
Expected: FAIL. `data/net.js` is not found; `addHero`, `removeHero`, `arenaMap` and `moveHero` are not exported.

- [ ] **Step 3: Implement**

`renderer/data/net.js`:

```js
// Every netcode number (spec docs/superpowers/specs/2026-09-25-pvp-server-netcode-design.md).
// Shared by the server (server/) and the browser client (renderer/net/).
export const NET = {
  protocolVersion: 1,
  path: '/pvp',
  snapshotHz: 20,
  interpDelayTicks: 3,     // other heroes are drawn this many sim ticks behind the estimated server tick
  extrapolateTicks: 3,     // how long a hero keeps its last velocity when the snapshot buffer runs dry
  bufferTicks: 30,         // snapshots kept (1 s)
  rewindMaxTicks: 6,       // melee lag compensation cap (200 ms)
  historyTicks: 8,         // per-hero position ring on the server
  inputQueueMax: 4,
  staleInputTicks: 15,     // no input for this long: the hero stands still
  pendingMax: 90,          // unacknowledged inputs a client keeps (3 s)
  resultsDelay: 10,        // s from matchEnd to the next match
  pingMs: 2000,
  heartbeatMs: 5000,
  heartbeatMisses: 2,
  maxRooms: 50,
  maxHeroes: 6,
  maxPayload: 4096,
  nameMax: 12,
  codeLength: 4,
  codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  snapPx: 2,               // corrections smaller than this snap silently…
  bigSnapPx: 96,           // …and larger than this snap outright (respawn, blink)
  correctionMs: 100,       // everything between blends away over this long
}
```

`renderer/data/pvp.js`: add `minHeroes: 2,   // the match clock runs only with at least this many heroes` to `PVP`.

`renderer/pvp/sim.js`:
- Add `addHero`, `removeHero` and `arenaMap` exports, and import `heroById` (already imported).
- Replace `makeMatch` and the top of `tick`, and change the match-end check:

```js
export function arenaMap(arena = PVP_ARENAS.pillars) {
  return buildArena({ size: arena.size, columns: arena.columns, enemies: [], chests: [] }, () => {}).map
}

export function makeMatch({ arena = PVP_ARENAS.pillars, roster, sfx: sfxQueue = null, matchLength = PVP.matchLength } = {}) {
  if (!Array.isArray(roster) || roster.length < 1 || roster.length > arena.spawns.length)
    throw new Error(`pvp: roster must hold 1-${arena.spawns.length} heroes`)
  if (new Set(roster.map(r => r.id)).size !== roster.length) throw new Error('pvp: duplicate hero id')
  const match = {
    map: arenaMap(arena), arena, heroes: [], entities: [], projectiles: [], lightning: [], strikes: [], arcs: [],
    shockwaves: [], zones: [], fireZones: [], feedback: makeFeedback(), sfx: sfxQueue,
    pickups: makePickups(arena), clock: 0, tick: 0, acc: 0, ended: false, events: [], inputs: {}, standings: null,
    matchLength, waiting: roster.length < PVP.minHeroes,
  }
  roster.forEach((r, i) => {
    const h = makeHero(r)
    placeHero(h, arena.spawns[i])
    match.heroes.push(h)
  })
  refreshTargets(match)
  return match
}

// Drop-in: a hero joining a running match arrives at the spawn farthest from
// everyone, protected, with kills and deaths at zero.
export function addHero(match, { id, name, cls }) {
  if (heroById(match, id)) throw new Error(`pvp: duplicate hero id "${id}"`)
  if (match.heroes.length >= match.arena.spawns.length) throw new Error('pvp: arena is full')
  const h = makeHero({ id, name, cls })
  placeHero(h, farthestSpawn(match))
  h.spawnProtect = PVP.spawnProtect
  match.heroes.push(h)
  refreshTargets(match)
  match.events.push({ type: 'join', hero: id })
  return h
}

// A hero leaving mid-match; a rune it held goes straight back on its pedestal.
export function removeHero(match, id) {
  const i = match.heroes.findIndex(h => h.id === id)
  if (i === -1) return false
  if (match.heroes[i].rune) {
    const rune = match.pickups.find(p => p.kind === 'rune')
    if (rune) { rune.up = true; rune.t = 0 }
  }
  match.heroes.splice(i, 1)
  refreshTargets(match)
  match.events.push({ type: 'leave', hero: id })
  return true
}
```

  In `tick(match)`, replace `match.clock += dt` with:

```js
  match.tick++
  // Fewer than PVP.minHeroes heroes: everything runs but the clock, so a
  // lone player can warm up and the match never ends on them.
  match.waiting = match.heroes.length < PVP.minHeroes
  if (!match.waiting) match.clock += dt
```
  and the end check with `if (!match.waiting && match.clock >= match.matchLength - 1e-9) {`.

`renderer/pvp/hero.js`: split `tickHero`. The new `moveHero` holds everything from the cooldown decrements through `tickWalk(hero, dt)`, unchanged, and returns `{ stunned, blocking, altEdge }`:

```js
// The movement half of a hero's tick — timers, shield, facing, the walk —
// with no attacks. The server runs it inside tickHero; the client's
// predictor runs the very same code for its own hero.
export function moveHero(match, hero, input = NEUTRAL_INPUT, dt) {
  // … the existing body of tickHero from `hero.meleeCooldown = …` down to and including `tickWalk(hero, dt)` …
  return { stunned, blocking, altEdge }
}

export function tickHero(match, hero, input = NEUTRAL_INPUT, dt) {
  if (hero.dead) return
  const { stunned, blocking, altEdge } = moveHero(match, hero, input, dt)
  if (stunned) return
  const attacking = !!input.attack && !hero.needRelease && !blocking
  if (hero.attackMode === 'melee') tickMelee(match, hero, input, attacking, dt)
  else if (hero.attackMode === 'magic') tickMagic(match, hero, input, attacking, altEdge, dt)
  else if (hero.attackMode === 'ranged') tickRanged(match, hero, attacking)
}
```

`renderer/pvp/attacks.js`, in `swing`, the `bodyHit` helper:

```js
  // The server rewinds foes to where the attacker saw them (spec §2); only the
  // hit test moves — knockback, blocks and damage use the real hero.
  const bodyHit = e => {
    const at = match.hitPos?.(e, hero) ?? e
    const n = nearestPoint(at, hero.px, hero.py)
    return inSwing(arc.reach * mods.reachMul, arc.halfAngle, fa, n.x - hero.px, n.y - hero.py)
  }
```

- [ ] **Step 4: Run tests**

Run: `node --test test/net-sim.test.js test/pvp-*.test.js && npm test`
Expected: all PASS. The existing PvP tests are unchanged, which proves the local harness still behaves the same.

- [ ] **Step 5: Commit**

```bash
git add renderer/data/net.js renderer/data/pvp.js renderer/pvp/sim.js renderer/pvp/hero.js renderer/pvp/attacks.js test/net-sim.test.js
git commit -m "feat(net): sim support — tick counter, waiting clock, drop-in heroes, moveHero, hitPos seam

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 2: The protocol — validation, snapshots, hydration

**Files:**
- Create: `renderer/net/protocol.js`
- Test: `test/net-protocol.test.js`

**Interfaces:**
- Consumes: `NET` (Task 1); `makeHero`, `applyKit` (hero.js); `KITS`; entity factories.
- Produces:
  - `MSG = { HELLO, INPUT, CLASS, PING, WELCOME, SNAP, ERROR, PONG }` (the values are the spec's lowercase names), and `ERR` with the six codes;
  - `encode(msg) → string`, `decode(text) → object|null`;
  - `validateInput(raw) → { seq, view, move:{x,y}, facing, attack, alt, sprint } | null`;
  - `validateName(raw) → string|null`, `validateClass(raw) → boolean`;
  - `validateHello(raw) → { error } | { name, cls, create: true } | { name, cls, room }`;
  - `heroSnap(hero) → plain object`;
  - `hydrateHero(hero|null, snap) → hero`;
  - `snapshotBody(match, { events, cues }) → { type:'snap', tick, clock, waiting, ended, matchLength, heroes, projectiles, lightning, strikes, arcs, shockwaves, pickups, events, cues }`. The `ack` is added per client at send time.

- [ ] **Step 1: Write the failing tests**

`test/net-protocol.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MSG, ERR, encode, decode, validateInput, validateName, validateClass, validateHello,
  heroSnap, hydrateHero, snapshotBody } from '../renderer/net/protocol.js'
import { makeMatch } from '../renderer/pvp/sim.js'
import { grantRune } from '../renderer/pvp/pickups.js'
import { NET } from '../renderer/data/net.js'

describe('encode / decode', () => {
  it('round-trips a message', () => {
    assert.deepEqual(decode(encode({ type: MSG.PING, t: 5 })), { type: 'ping', t: 5 })
  })
  it('rejects garbage, non-objects and messages without a type', () => {
    for (const bad of ['{', '42', 'null', '[]', '{"t":1}']) assert.equal(decode(bad), null, bad)
  })
})

describe('validateInput', () => {
  it('clamps move to -1/0/1 and keeps a known facing', () => {
    assert.deepEqual(validateInput({ seq: 3, view: 10, move: { x: 50, y: -0.2 }, facing: 'west', attack: true, alt: false, sprint: true }),
      { seq: 3, view: 10, move: { x: 1, y: -1 }, facing: 'west', attack: true, alt: false, sprint: true })
  })
  it('drops an unknown facing, non-boolean flags and non-finite axes', () => {
    assert.deepEqual(validateInput({ seq: 1, view: 0, move: { x: 'a', y: NaN }, facing: 'up', attack: 'yes', alt: 1 }),
      { seq: 1, view: 0, move: { x: 0, y: 0 }, facing: null, attack: false, alt: false, sprint: false })
    assert.equal(validateInput({ seq: 1, view: 0, facing: 'toString' }).facing, null)
  })
  it('rejects a missing, negative or fractional seq/view', () => {
    for (const bad of [{ view: 0 }, { seq: -1, view: 0 }, { seq: 1.5, view: 0 }, { seq: 1 }, { seq: 1, view: 'x' }, null])
      assert.equal(validateInput(bad), null)
  })
})

describe('names, classes and hello', () => {
  it('names: trimmed, 1-12 of letters digits space _ -', () => {
    assert.equal(validateName('  Aino_2 '), 'Aino_2')
    for (const bad of ['', '   ', 'x'.repeat(13), 'a<b', 42, null]) assert.equal(validateName(bad), null)
  })
  it('classes are the three kits', () => {
    assert.equal(validateClass('mage'), true)
    assert.equal(validateClass('bard'), false)
    assert.equal(validateClass('toString'), false)
  })
  it('hello: version, name, class and exactly one of create/room', () => {
    const base = { type: 'hello', v: NET.protocolVersion, name: 'Aino', cls: 'mage' }
    assert.deepEqual(validateHello({ ...base, create: true }), { name: 'Aino', cls: 'mage', create: true })
    assert.deepEqual(validateHello({ ...base, room: ' kxpt ' }), { name: 'Aino', cls: 'mage', room: 'KXPT' })
    assert.deepEqual(validateHello({ ...base, v: 0, create: true }), { error: ERR.VERSION })
    assert.deepEqual(validateHello({ ...base, name: '<>', create: true }), { error: ERR.BAD_NAME })
    assert.deepEqual(validateHello({ ...base, cls: 'bard', create: true }), { error: ERR.BAD_HELLO })
    assert.deepEqual(validateHello({ ...base }), { error: ERR.BAD_HELLO })
    assert.deepEqual(validateHello({ ...base, room: 'KX1' }), { error: ERR.BAD_HELLO })
    assert.deepEqual(validateHello({ ...base, create: true, room: 'KXPT' }), { error: ERR.BAD_HELLO })
  })
})

describe('snapshots', () => {
  const match = () => makeMatch({ roster: [{ id: 'p1', name: 'A', cls: 'warrior' }, { id: 'p2', name: 'B', cls: 'archer' }] })
  it('a hero survives heroSnap → JSON → hydrateHero', () => {
    const m = match()
    const w = m.heroes[0]
    w.px = 123.5; w.hp = 7; w.charging = { t: 0.4 }; w.stunTimer = 0.3
    grantRune(m, w)                                       // hammer in hand, buckler parked
    const s = JSON.parse(JSON.stringify(heroSnap(w)))
    const h = hydrateHero(null, s)
    assert.equal(h.type, 'hero')
    assert.equal(h.px, 123.5); assert.equal(h.hp, 7); assert.equal(h.stunTimer, 0.3)
    assert.deepEqual(h.charging, { t: 0.4 })
    assert.equal(h.weapon.weaponType, 'ukonvasara')
    assert.equal(h.gear.melee.off, null)
    assert.equal(h.gear.melee.outfit.outfitType, 'plate')
    assert.deepEqual(h.rune, { t: w.rune.t })
  })
  it('hydrating an existing hero applies a class change first', () => {
    const m = match()
    const h = hydrateHero(null, heroSnap(m.heroes[0]))
    const s = heroSnap(m.heroes[1])
    s.id = h.id
    hydrateHero(h, s)
    assert.equal(h.cls, 'archer')
    assert.equal(h.ranged.weaponType, 'shortbow')
    assert.equal(h.gear.melee.outfit, null)
  })
  it('snapshotBody is plain JSON with every list the client draws', () => {
    const m = match()
    m.projectiles.push({ px: 1, py: 2, dx: 3, dy: 4, shape: 'arrow', color: '#fff', owner: 'p2', hitIds: new Set() })
    const body = JSON.parse(JSON.stringify(snapshotBody(m, { events: [{ type: 'join', hero: 'p2' }], cues: [{ name: 'x' }] })))
    assert.equal(body.type, MSG.SNAP)
    assert.equal(body.heroes.length, 2)
    assert.deepEqual(body.projectiles[0], { px: 1, py: 2, dx: 3, dy: 4, shape: 'arrow', color: '#fff' })
    assert.equal(body.pickups.length, 5)
    assert.equal(body.matchLength, m.matchLength)
    for (const k of ['tick', 'clock', 'waiting', 'ended', 'lightning', 'strikes', 'arcs', 'shockwaves', 'events', 'cues']) assert.ok(k in body, k)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/net-protocol.test.js`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

`renderer/net/protocol.js`:

```js
// PvP protocol v1 (spec 2026-09-25-pvp-server-netcode-design.md §1): message
// names, validation of everything a client sends, and the snapshot a server
// sends — plus hydrateHero, which turns a snapshot hero back into a hero the
// renderer and the predictor can use. Shared by server/ and the browser;
// pure, no DOM.
import { NET } from '../data/net.js'
import { KITS } from '../data/pvp.js'
import { DIRS, weaponContents, makeRangedContents, makeWandContents } from '../systems/entities.js'
import { gearOf, offhand } from '../systems/inventory.js'
import { makeHero, applyKit } from '../pvp/hero.js'

export const MSG = { HELLO: 'hello', INPUT: 'input', CLASS: 'class', PING: 'ping',
  WELCOME: 'welcome', SNAP: 'snap', ERROR: 'error', PONG: 'pong' }
export const ERR = { VERSION: 'version', NO_ROOM: 'no_room', ROOM_FULL: 'room_full',
  BAD_NAME: 'bad_name', BAD_HELLO: 'bad_hello', SERVER_FULL: 'server_full' }

export const encode = msg => JSON.stringify(msg)

export function decode(text) {
  try {
    const m = JSON.parse(String(text))
    return m && typeof m === 'object' && !Array.isArray(m) && typeof m.type === 'string' ? m : null
  } catch { return null }
}

const axis = v => Number.isFinite(v) ? Math.sign(v) : 0
const count = v => Number.isInteger(v) && v >= 0

// Everything a client may say about its hero: which way it pushes and which
// buttons are down. Nothing else — never a position, damage or ammo.
export function validateInput(raw) {
  if (!raw || typeof raw !== 'object' || !count(raw.seq) || !count(raw.view)) return null
  return {
    seq: raw.seq, view: raw.view,
    move: { x: axis(raw.move?.x), y: axis(raw.move?.y) },
    facing: typeof raw.facing === 'string' && Object.hasOwn(DIRS, raw.facing) ? raw.facing : null,
    attack: raw.attack === true, alt: raw.alt === true, sprint: raw.sprint === true,
  }
}

const NAME_RE = new RegExp(`^[A-Za-z0-9 _-]{1,${NET.nameMax}}$`)
export function validateName(raw) {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  return NAME_RE.test(name) ? name : null
}

export const validateClass = raw => typeof raw === 'string' && Object.hasOwn(KITS, raw)

const CODE_RE = new RegExp(`^[${NET.codeAlphabet}]{${NET.codeLength}}$`)
export function validateHello(raw) {
  if (raw?.v !== NET.protocolVersion) return { error: ERR.VERSION }
  const name = validateName(raw.name)
  if (!name) return { error: ERR.BAD_NAME }
  if (!validateClass(raw.cls)) return { error: ERR.BAD_HELLO }
  const create = raw.create === true
  const room = typeof raw.room === 'string' ? raw.room.trim().toUpperCase() : null
  if (create === !!room) return { error: ERR.BAD_HELLO }
  if (create) return { name, cls: raw.cls, create: true }
  return CODE_RE.test(room) ? { name, cls: raw.cls, room } : { error: ERR.BAD_HELLO }
}

// The hero fields a client needs to draw a hero and to predict its own. Gear
// is not sent: the class kit rebuilds it; only the offhand's kind (the
// rune parks the Warrior's buckler) and the main hands' types travel.
const HERO_FIELDS = ['id', 'name', 'cls', 'x', 'y', 'px', 'py', 'facing', 'hp', 'maxHp', 'stamina',
  'staminaRegenT', 'dead', 'respawnT', 'spawnProtect', 'invulnTimer', 'kills', 'deaths', 'attackMode',
  'attackTimer', 'attackDuration', 'attackStyle', 'attackFacing', 'attackReachMul', 'blocking',
  'shieldDropT', 'stunTimer', 'slowTimer', 'slowMul', 'rootTimer', 'frozen', 'needRelease',
  'meleeCooldown', 'rangedCooldown', 'magicCooldown', 'offCooldown']

export function heroSnap(h) {
  const s = {}
  for (const f of HERO_FIELDS) s[f] = h[f] ?? null
  s.charging = h.charging ? (h.charging.kind ? { t: h.charging.t, kind: h.charging.kind } : { t: h.charging.t }) : null
  s.rune = h.rune ? { t: h.rune.t } : null
  s.shock = h.shock ? { tickT: h.shock.tickT, left: h.shock.left } : null
  s.rain = h.rain ? { t: h.rain.t, dur: h.rain.dur } : null
  s.blinkTrail = h.blinkTrail ? { from: { ...h.blinkTrail.from }, to: { ...h.blinkTrail.to }, t: h.blinkTrail.t } : null
  s.knockback = h.knockback ? { vx: h.knockback.vx, vy: h.knockback.vy } : null
  s.ammo = { ...h.ammo }
  s.off = offhand(h)?.kind ?? null
  s.hands = { weapon: h.weapon?.weaponType ?? null, ranged: h.ranged?.weaponType ?? null, wand: h.wand?.weaponType ?? null }
  return s
}

export function hydrateHero(hero, s) {
  const h = hero ?? makeHero({ id: s.id, name: s.name, cls: s.cls })
  if (h.cls !== s.cls || (offhand(h)?.kind ?? null) !== s.off) {
    applyKit(h, s.cls)
    if (s.off === null) gearOf(h, h.attackMode).off = null
  }
  for (const f of HERO_FIELDS) if (s[f] !== undefined && s[f] !== null) h[f] = s[f]
  for (const f of ['dead', 'blocking', 'frozen', 'needRelease']) h[f] = !!s[f]
  h.charging = s.charging ? { ...s.charging } : null
  h.rune = s.rune ? { t: s.rune.t } : null
  h.shock = s.shock ? { ...s.shock } : undefined
  h.rain = s.rain ? { ...s.rain } : undefined
  h.blinkTrail = s.blinkTrail ? { from: { ...s.blinkTrail.from }, to: { ...s.blinkTrail.to }, t: s.blinkTrail.t } : null
  h.knockback = s.knockback ? { ...s.knockback } : null
  h.ammo = { ...h.ammo, ...s.ammo }
  const hands = s.hands ?? {}
  if ((h.weapon?.weaponType ?? null) !== (hands.weapon ?? null)) h.weapon = hands.weapon ? weaponContents(hands.weapon) : null
  if ((h.ranged?.weaponType ?? null) !== (hands.ranged ?? null)) h.ranged = hands.ranged ? makeRangedContents(hands.ranged) : null
  if ((h.wand?.weaponType ?? null) !== (hands.wand ?? null)) h.wand = hands.wand ? makeWandContents(hands.wand) : null
  return h
}

export function snapshotBody(match, { events = [], cues = [] } = {}) {
  return {
    type: MSG.SNAP, tick: match.tick, clock: match.clock, waiting: !!match.waiting, ended: !!match.ended,
    matchLength: match.matchLength,
    heroes: match.heroes.map(heroSnap),
    projectiles: match.projectiles.map(p => ({ px: p.px, py: p.py, dx: p.dx, dy: p.dy, shape: p.shape, color: p.color })),
    lightning: match.lightning.map(m => ({ x: m.x, y: m.y, t: m.t, delay: m.delay })),
    strikes: match.strikes.map(s => ({ x: s.x, y: s.y, t: s.t })),
    arcs: match.arcs.map(a => ({ ...a })),
    shockwaves: match.shockwaves.map(s => ({ ...s })),
    pickups: match.pickups.map(p => ({ kind: p.kind, x: p.x, y: p.y, px: p.px, py: p.py, up: p.up })),
    events, cues,
  }
}
```

Note for the implementer: `hydrateHero` leaves the `null` fields at the hero's own value on purpose. `heroSnap` writes `null` for a missing field, and a freshly built hero already has sensible defaults. Booleans are coerced explicitly.

- [ ] **Step 4: Run tests**

Run: `node --test test/net-protocol.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/net/protocol.js test/net-protocol.test.js
git commit -m "feat(net): protocol v1 — validation, snapshots and hero hydration

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 3: Rooms — codes, input queues, the tick step, rewind and the next match

**Files:**
- Create: `server/rooms.js`
- Test: `test/net-rooms.test.js`

**Interfaces:**
- Consumes: `makeMatch`, `stepMatch`, `addHero`, `removeHero`, `setClass`, `heroById` (sim/combat); `snapshotBody`, `ERR` (Task 2); `NET`; `makeSfx`, `drainSfx`.
- Produces:
  - `makeLobby({ random = Math.random, rewind = true, matchLength, resultsDelay = NET.resultsDelay } = {}) → lobby` (`lobby.rooms: Map<code, room>`);
  - `createRoom(lobby, { name, cls }) → { room, heroId } | { error }`;
  - `joinRoom(lobby, code, { name, cls }) → { room, heroId } | { error }`;
  - `leaveRoom(lobby, room, heroId)`;
  - `queueInput(room, heroId, input)`, `setRoomClass(room, heroId, cls)`;
  - `stepRoom(lobby, room) → snapshotBody | null` (one sim tick; a body on 2 of every 3 ticks);
  - `ackOf(room, heroId) → number`;
  - `rewoundPos(room, foe, attacker) → { type, px, py } | foe`.
  - Room shape: `{ code, nextId, tick, match, players: Map<heroId, { queue, last, lastInputTick, ack }>, history: Map<heroId, [{tick, px, py}]>, pendingEvents, pendingCues, nextMatchAt }`.

- [ ] **Step 1: Write the failing tests**

`test/net-rooms.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeLobby, createRoom, joinRoom, leaveRoom, queueInput, setRoomClass, stepRoom, ackOf, rewoundPos } from '../server/rooms.js'
import { placeHero, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { encode, ERR } from '../renderer/net/protocol.js'
import { NET } from '../renderer/data/net.js'
import { PVP } from '../renderer/data/pvp.js'

const who = (name, cls = 'archer') => ({ name, cls })
const input = (seq, over = {}) => ({ seq, view: 0, move: { x: 0, y: 0 }, facing: null, attack: false, alt: false, sprint: false, ...over })
const heroOf = (room, id) => room.match.heroes.find(h => h.id === id)
const steps = (lobby, room, n) => { const out = []; for (let i = 0; i < n; i++) { const b = stepRoom(lobby, room); if (b) out.push(b) } return out }

describe('creating and joining', () => {
  it('create gives a 4-letter code from the alphabet and hero p1', () => {
    const lobby = makeLobby()
    const { room, heroId } = createRoom(lobby, who('A'))
    assert.match(room.code, new RegExp(`^[${NET.codeAlphabet}]{4}$`))
    assert.equal(heroId, 'p1')
    assert.equal(lobby.rooms.get(room.code), room)
  })
  it('a code collision is retried', () => {
    const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0.99, 0, 0, 0]   // AAAA twice, then ZAAA
    let i = 0
    const lobby = makeLobby({ random: () => seq[i++ % seq.length] })
    const a = createRoom(lobby, who('A')).room
    const b = createRoom(lobby, who('B')).room
    assert.notEqual(a.code, b.code)
  })
  it('server_full past maxRooms', () => {
    const lobby = makeLobby()
    for (let i = 0; i < NET.maxRooms; i++) createRoom(lobby, who('A'))
    assert.deepEqual(createRoom(lobby, who('A')), { error: ERR.SERVER_FULL })
  })
  it('join: no_room, then p2, p3 … up to six, then room_full; same name twice is fine', () => {
    const lobby = makeLobby()
    assert.deepEqual(joinRoom(lobby, 'ZZZZ', who('B')), { error: ERR.NO_ROOM })
    const { room } = createRoom(lobby, who('A'))
    for (let i = 2; i <= 6; i++) assert.equal(joinRoom(lobby, room.code, who('Same')).heroId, `p${i}`)
    assert.deepEqual(joinRoom(lobby, room.code, who('B')), { error: ERR.ROOM_FULL })
  })
  it('leave removes the hero; the last one out destroys the room; ids are never reused', () => {
    const lobby = makeLobby()
    const { room } = createRoom(lobby, who('A'))
    joinRoom(lobby, room.code, who('B'))
    leaveRoom(lobby, room, 'p2')
    assert.equal(room.match.heroes.length, 1)
    assert.equal(joinRoom(lobby, room.code, who('C')).heroId, 'p3')
    leaveRoom(lobby, room, 'p1'); leaveRoom(lobby, room, 'p3')
    assert.equal(lobby.rooms.size, 0)
  })
})

describe('input queue', () => {
  const setup = () => { const lobby = makeLobby(); const { room } = createRoom(lobby, who('A')); joinRoom(lobby, room.code, who('B')); return { lobby, room } }
  it('one input per tick, acked by seq', () => {
    const { lobby, room } = setup()
    queueInput(room, 'p1', input(1, { move: { x: 1, y: 0 } }))
    queueInput(room, 'p1', input(2, { move: { x: 1, y: 0 } }))
    stepRoom(lobby, room)
    assert.equal(ackOf(room, 'p1'), 1)
    stepRoom(lobby, room)
    assert.equal(ackOf(room, 'p1'), 2)
  })
  it('caps the queue at inputQueueMax, dropping the oldest', () => {
    const { lobby, room } = setup()
    for (let s = 1; s <= 7; s++) queueInput(room, 'p1', input(s))
    stepRoom(lobby, room)
    assert.equal(ackOf(room, 'p1'), 7 - NET.inputQueueMax + 1)
  })
  it('an empty queue repeats the last input', () => {
    const { lobby, room } = setup()
    const h = heroOf(room, 'p1')
    queueInput(room, 'p1', input(1, { move: { x: 1, y: 0 } }))
    stepRoom(lobby, room)
    const x1 = h.px
    stepRoom(lobby, room)
    assert.ok(h.px > x1)
    assert.equal(ackOf(room, 'p1'), 1)
  })
  it('stale input goes neutral after staleInputTicks', () => {
    const { lobby, room } = setup()
    const h = heroOf(room, 'p1')
    queueInput(room, 'p1', input(1, { move: { x: 1, y: 0 } }))
    steps(lobby, room, NET.staleInputTicks + 2)
    const x = h.px
    steps(lobby, room, 3)
    assert.equal(h.px, x)
  })
  it('setRoomClass applies at respawn', () => {
    const { lobby, room } = setup()
    setRoomClass(room, 'p1', 'mage')
    assert.equal(heroOf(room, 'p1').pendingCls, 'mage')
  })
})

describe('snapshots', () => {
  it('two snapshots every three ticks, events and cues riding along once', () => {
    const lobby = makeLobby()
    const { room } = createRoom(lobby, who('A'))
    joinRoom(lobby, room.code, who('B'))
    const bodies = steps(lobby, room, 30)
    assert.equal(bodies.length, 20)
    const joins = bodies.flatMap(b => b.events).filter(e => e.type === 'join')
    assert.equal(joins.length, 1)
  })
})

describe('rewind', () => {
  const duel = () => {
    const lobby = makeLobby()
    const { room } = createRoom(lobby, who('A', 'warrior'))
    joinRoom(lobby, room.code, who('B', 'archer'))
    return { lobby, room, w: heroOf(room, 'p1'), a: heroOf(room, 'p2') }
  }
  it('records history and returns the foe where the attacker saw it, capped at rewindMaxTicks', () => {
    const { lobby, room, w, a } = duel()
    placeHero(a, { x: 10, y: 7 })
    steps(lobby, room, 8)                                   // history ticks 1..8 at x=10
    placeHero(a, { x: 14, y: 7 })
    steps(lobby, room, 1)                                   // tick 9 at x=14
    room.match.tick += 1                                    // simulate being inside tick 10
    w.viewTick = 8
    assert.equal(rewoundPos(room, a, w).px, 10 * 32 + 16)
    w.viewTick = 0                                          // too old: clamped to 6 ticks back → tick 4
    assert.equal(rewoundPos(room, a, w).px, 10 * 32 + 16)
    w.viewTick = 99                                         // the future: clamped to now
    assert.equal(rewoundPos(room, a, w), a)
    room.match.tick -= 1
  })
  it('makeLobby({ rewind: false }) installs no hitPos', () => {
    const lobby = makeLobby({ rewind: false })
    const { room } = createRoom(lobby, who('A'))
    assert.equal(room.match.hitPos, undefined)
    assert.equal(typeof createRoom(makeLobby(), who('A')).room.match.hitPos, 'function')
  })
})

describe('the next match', () => {
  it('after matchEnd and resultsDelay a new match starts with the same ids, pending classes and a matchStart event', () => {
    const lobby = makeLobby({ matchLength: 1, resultsDelay: 0.5 })
    const { room } = createRoom(lobby, who('A', 'warrior'))
    joinRoom(lobby, room.code, who('B', 'archer'))
    setRoomClass(room, 'p2', 'mage')
    const first = room.match
    const bodies = steps(lobby, room, 30 + 15 + 5)
    const events = bodies.flatMap(b => b.events)
    assert.ok(events.some(e => e.type === 'matchEnd'))
    assert.ok(events.some(e => e.type === 'matchStart'))
    assert.notEqual(room.match, first)
    assert.deepEqual(room.match.heroes.map(h => [h.id, h.cls]), [['p1', 'warrior'], ['p2', 'mage']])
    assert.ok(room.match.tick >= first.tick)
    assert.equal(typeof room.match.hitPos, 'function')
  })
  it('a hero joining during results is in the next match', () => {
    const lobby = makeLobby({ matchLength: 1, resultsDelay: 0.5 })
    const { room } = createRoom(lobby, who('A'))
    joinRoom(lobby, room.code, who('B'))
    steps(lobby, room, 32)                                  // matchEnd has fired
    assert.equal(room.match.ended, true)
    joinRoom(lobby, room.code, who('C'))
    steps(lobby, room, 20)
    assert.equal(room.match.ended, false)
    assert.ok(room.match.heroes.some(h => h.id === 'p3'))
  })
})

describe('cost', () => {
  it('a six-hero room steps and encodes in well under 2 ms a tick', () => {
    const lobby = makeLobby()
    const { room } = createRoom(lobby, who('A', 'warrior'))
    for (const c of ['archer', 'mage', 'warrior', 'archer', 'mage']) joinRoom(lobby, room.code, who('X', c))
    const t0 = performance.now()
    for (let i = 0; i < 300; i++) {
      for (const id of room.players.keys()) queueInput(room, id, input(i + 1, { move: { x: i % 2 ? 1 : -1, y: 0 }, attack: true }))
      const body = stepRoom(lobby, room)
      if (body) for (const id of room.players.keys()) encode({ ...body, ack: ackOf(room, id) })
    }
    const perTick = (performance.now() - t0) / 300
    console.log(`room cost: ${perTick.toFixed(3)} ms/tick`)
    assert.ok(perTick < 2, `${perTick} ms/tick`)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/net-rooms.test.js`
Expected: FAIL. `server/rooms.js` is not found.

- [ ] **Step 3: Implement**

`server/rooms.js`:

```js
// PvP rooms (spec §3): codes, the input queue per player, one simulated tick
// at a time, the position history melee rewinds into, and the next match
// after the results. Pure — no sockets; server/pvp-server.js drives it.
import { makeMatch, stepMatch, addHero, removeHero, setClass } from '../renderer/pvp/sim.js'
import { heroById } from '../renderer/pvp/combat.js'
import { NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { makeSfx, drainSfx } from '../renderer/systems/sfx.js'
import { snapshotBody, ERR } from '../renderer/net/protocol.js'
import { PVP } from '../renderer/data/pvp.js'
import { NET } from '../renderer/data/net.js'

export function makeLobby({ random = Math.random, rewind = true, matchLength = PVP.matchLength, resultsDelay = NET.resultsDelay } = {}) {
  return { rooms: new Map(), opts: { random, rewind, matchLength, resultsDelay } }
}

function newCode(lobby) {
  const A = NET.codeAlphabet
  for (;;) {
    let code = ''
    for (let i = 0; i < NET.codeLength; i++) code += A[Math.floor(lobby.opts.random() * A.length) % A.length]
    if (!lobby.rooms.has(code)) return code
  }
}

function newMatch(lobby, room, roster) {
  const match = makeMatch({ roster, sfx: makeSfx(false), matchLength: lobby.opts.matchLength })
  if (lobby.opts.rewind) match.hitPos = (foe, attacker) => rewoundPos(room, foe, attacker)
  room.history = new Map()
  return match
}

const freshPlayer = room => ({ queue: [], last: NEUTRAL_INPUT, lastInputTick: room.match.tick, ack: 0 })

export function createRoom(lobby, { name, cls }) {
  if (lobby.rooms.size >= NET.maxRooms) return { error: ERR.SERVER_FULL }
  const room = { code: newCode(lobby), nextId: 1, tick: 0, match: null, players: new Map(),
    history: new Map(), pendingEvents: [], pendingCues: [], nextMatchAt: null }
  const heroId = `p${room.nextId++}`
  room.match = newMatch(lobby, room, [{ id: heroId, name, cls }])
  room.players.set(heroId, freshPlayer(room))
  lobby.rooms.set(room.code, room)
  return { room, heroId }
}

export function joinRoom(lobby, code, { name, cls }) {
  const room = lobby.rooms.get(code)
  if (!room) return { error: ERR.NO_ROOM }
  if (room.match.heroes.length >= NET.maxHeroes) return { error: ERR.ROOM_FULL }
  const heroId = `p${room.nextId++}`
  addHero(room.match, { id: heroId, name, cls })
  room.players.set(heroId, freshPlayer(room))
  return { room, heroId }
}

export function leaveRoom(lobby, room, heroId) {
  removeHero(room.match, heroId)
  room.players.delete(heroId)
  room.history.delete(heroId)
  if (room.players.size === 0) lobby.rooms.delete(room.code)
}

export function queueInput(room, heroId, input) {
  const p = room.players.get(heroId)
  if (!p) return
  p.queue.push(input)
  if (p.queue.length > NET.inputQueueMax) p.queue.shift()
  p.lastInputTick = room.match.tick
}

export const setRoomClass = (room, heroId, cls) => setClass(room.match, heroId, cls)
export const ackOf = (room, heroId) => room.players.get(heroId)?.ack ?? 0

// Where `attacker` saw `foe`: its position `k` ticks ago, k = how far behind
// the attacker's view was, capped at NET.rewindMaxTicks. Only the melee hit
// test asks (attacks.js swing via match.hitPos).
export function rewoundPos(room, foe, attacker) {
  const now = room.match.tick
  const k = Math.max(0, Math.min(NET.rewindMaxTicks, now - (attacker.viewTick ?? now)))
  if (k === 0) return foe
  const at = room.history.get(foe.id)?.find(e => e.tick === now - k)
  return at ? { type: foe.type, px: at.px, py: at.py } : foe
}

function recordHistory(room) {
  for (const h of room.match.heroes) {
    let ring = room.history.get(h.id)
    if (!ring) room.history.set(h.id, ring = [])
    ring.push({ tick: room.match.tick, px: h.px, py: h.py })
    if (ring.length > NET.historyTicks) ring.shift()
  }
}

function startNextMatch(lobby, room) {
  const prev = room.match
  const roster = prev.heroes.map(h => ({ id: h.id, name: h.name, cls: h.pendingCls ?? h.cls }))
  room.match = newMatch(lobby, room, roster)
  room.match.tick = prev.tick
  for (const p of room.players.values()) p.lastInputTick = room.match.tick
  room.nextMatchAt = null
  room.pendingEvents.push({ type: 'matchStart' })
}

// One simulated tick. Returns the snapshot body when one is due (20 Hz of a
// 30 Hz loop), else null.
export function stepRoom(lobby, room) {
  const { match } = room
  const inputs = {}
  for (const [id, p] of room.players) {
    let input
    if (p.queue.length) { input = p.queue.shift(); p.last = input; p.ack = input.seq }
    else input = match.tick - p.lastInputTick > NET.staleInputTicks ? NEUTRAL_INPUT : p.last
    inputs[id] = input
    const hero = heroById(match, id)
    if (hero && input.view !== undefined) hero.viewTick = input.view
  }
  if (!match.ended) {
    const events = stepMatch(match, inputs, PVP.tick)
    recordHistory(room)
    room.pendingEvents.push(...events)
    if (events.some(e => e.type === 'matchEnd')) room.nextMatchAt = room.tick + Math.round(lobby.opts.resultsDelay / PVP.tick)
  }
  room.pendingCues.push(...drainSfx(room.match))
  if (room.match.ended && room.nextMatchAt !== null && room.tick >= room.nextMatchAt) startNextMatch(lobby, room)
  room.tick++
  const due = Math.floor(room.tick * NET.snapshotHz * PVP.tick) !== Math.floor((room.tick - 1) * NET.snapshotHz * PVP.tick)
  if (!due) return null
  const body = snapshotBody(room.match, { events: room.pendingEvents, cues: room.pendingCues })
  room.pendingEvents = []
  room.pendingCues = []
  return body
}
```

Note: `stepMatch` leaves the room's `match.events` accumulating for a joiner. `addHero` pushes `join` straight onto `match.events`, and the next `stepMatch` returns it, so join events reach clients with that tick's snapshot. Check this by the "events riding along once" test.

- [ ] **Step 4: Run tests**

Run: `node --test test/net-rooms.test.js`
Expected: PASS. The cost test prints its ms/tick; put the figure in the report.

- [ ] **Step 5: Commit**

```bash
git add server/rooms.js test/net-rooms.test.js
git commit -m "feat(net): rooms — codes, input queues, the tick step, rewind history, next match

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 4: The WebSocket server

**Files:**
- Create: `server/pvp-server.js`, `test/net-helpers.js`
- Modify: `tools/web-server.mjs`, `package.json`, `package-lock.json` (via `npm install ws@^8`)
- Test: `test/net-server.test.js`

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces:
  - `attachPvp(httpServer, { path = NET.path, heartbeatMs = NET.heartbeatMs, ...lobbyOpts }) → { lobby, wss, close() }`;
  - `heartbeatSweep(clients)` (pure over `{ missed, terminate(), ping() }`);
  - the test helpers `startServer(opts) → { url, pvp, close() }`, `rawClient(url) → { ws, messages, next(type, ms), send(obj) }` and `waitFor(fn, ms)`.

- [ ] **Step 1: Add the dependency**

Run: `npm install ws@^8`
Expected: `package.json` gains `"dependencies": { "ws": "^8.…" }` and `package-lock.json` updates. Electron and playwright stay in `devDependencies`.

- [ ] **Step 2: Write the helpers and the failing tests**

`test/net-helpers.js`:

```js
// Shared fixtures for the net tests (not itself a test file).
import http from 'node:http'
import WebSocket from 'ws'
import { attachPvp } from '../server/pvp-server.js'
import { encode, decode } from '../renderer/net/protocol.js'

export async function startServer(opts = {}) {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end() })
  const pvp = attachPvp(server, opts)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const url = `ws://127.0.0.1:${server.address().port}/pvp`
  return { url, pvp, close: () => new Promise(r => { pvp.close(); server.close(r) }) }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function waitFor(fn, ms = 2000, step = 10) {
  const end = Date.now() + ms
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() > end) throw new Error('waitFor timed out')
    await sleep(step)
  }
}

// A bare socket speaking the protocol by hand — for the server tests.
export async function rawClient(url) {
  const ws = new WebSocket(url)
  const messages = []
  let closed = null
  ws.on('message', d => { const m = decode(d.toString()); if (m) messages.push(m) })
  ws.on('close', code => { closed = code })
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
  return {
    ws, messages,
    get closed() { return closed },
    send: obj => ws.send(typeof obj === 'string' ? obj : encode(obj)),
    next: (type, ms = 2000) => waitFor(() => messages.find(m => m.type === type), ms),
    last: type => messages.filter(m => m.type === type).at(-1),
  }
}
```

`test/net-server.test.js`:

```js
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, rawClient, waitFor, sleep } from './net-helpers.js'
import { heartbeatSweep } from '../server/pvp-server.js'
import { NET } from '../renderer/data/net.js'

const hello = (over = {}) => ({ type: 'hello', v: NET.protocolVersion, name: 'Aino', cls: 'archer', ...over })
const input = (seq, over = {}) => ({ type: 'input', seq, view: 0, move: { x: 0, y: 0 }, facing: null, attack: false, alt: false, sprint: false, ...over })

describe('pvp server', async () => {
  const srv = await startServer()
  after(() => srv.close())

  it('create → welcome with a room code, then snapshots with ack', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    const w = await a.next('welcome')
    assert.match(w.room, /^[A-Z]{4}$/)
    assert.equal(w.heroId, 'p1')
    const s = await a.next('snap')
    assert.equal(s.heroes.length, 1)
    assert.equal(s.waiting, true)
    assert.equal(s.ack, 0)
    a.ws.close()
  })

  it('join with the code (any case) → p2, and both see two heroes, clock running', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    const { room } = await a.next('welcome')
    const b = await rawClient(srv.url)
    b.send(hello({ room: room.toLowerCase(), name: 'Aino' }))
    assert.equal((await b.next('welcome')).heroId, 'p2')
    await waitFor(() => a.last('snap')?.heroes.length === 2 && a.last('snap').waiting === false)
    a.ws.close(); b.ws.close()
  })

  it('refuses a bad hello with an error code and closes', async () => {
    for (const [msg, code] of [[hello({ room: 'ZZZZ' }), 'no_room'], [hello({ v: 99, create: true }), 'version'], [hello({ name: '<x>', create: true }), 'bad_name']]) {
      const c = await rawClient(srv.url)
      c.send(msg)
      assert.equal((await c.next('error')).code, code)
      await waitFor(() => c.closed !== null)
    }
  })

  it('closes a socket that speaks before hello, sends garbage, or sends an oversized frame', async () => {
    const early = await rawClient(srv.url)
    early.send(input(1))
    await waitFor(() => early.closed !== null)
    const junk = await rawClient(srv.url)
    junk.send('{nope')
    await waitFor(() => junk.closed !== null)
    const big = await rawClient(srv.url)
    big.send(hello({ create: true }))
    await big.next('welcome')
    big.send('x'.repeat(NET.maxPayload + 100))
    await waitFor(() => big.closed !== null)
  })

  it('out-of-range input only ever moves the hero at walking speed', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    const { heroId } = await a.next('welcome')
    const start = (await a.next('snap')).heroes.find(h => h.id === heroId).px
    for (let s = 1; s <= 15; s++) { a.send(input(s, { move: { x: 50, y: 0 }, facing: 'up' })); await sleep(33) }
    await sleep(100)
    const end = a.last('snap').heroes.find(h => h.id === heroId).px
    assert.ok(end > start, 'it moved')
    assert.ok(end - start <= 120 * 0.7 + 8, `moved ${end - start} px in ~0.6 s`)
    a.ws.close()
  })

  it('answers ping with pong', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    await a.next('welcome')
    a.send({ type: 'ping', t: 42 })
    assert.equal((await a.next('pong')).t, 42)
    a.ws.close()
  })

  it('the last socket out destroys the room', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    const { room } = await a.next('welcome')
    assert.ok(srv.pvp.lobby.rooms.has(room))
    a.ws.close()
    await waitFor(() => !srv.pvp.lobby.rooms.has(room))
  })
})

describe('heartbeatSweep', () => {
  it('pings live sockets and terminates one that missed two sweeps', () => {
    const log = []
    const sock = name => ({ name, missed: 0, ping: () => log.push(`ping ${name}`), terminate: () => log.push(`kill ${name}`) })
    const a = sock('a'), b = sock('b')
    heartbeatSweep([a, b]); a.missed = 0            // a answered, b didn't
    heartbeatSweep([a, b])
    heartbeatSweep([a, b])
    assert.ok(log.includes('kill b'))
    assert.ok(!log.includes('kill a'))
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test test/net-server.test.js`
Expected: FAIL. `server/pvp-server.js` is not found.

- [ ] **Step 4: Implement**

`server/pvp-server.js`:

```js
// The PvP WebSocket endpoint (spec §1, §3): upgrades /pvp on the web server,
// turns hello into a room seat, feeds validated inputs to server/rooms.js,
// runs each room's 30 Hz loop and broadcasts snapshots. Heartbeat pings drop
// dead sockets.
import { WebSocketServer } from 'ws'
import { makeLobby, createRoom, joinRoom, leaveRoom, queueInput, setRoomClass, stepRoom, ackOf } from './rooms.js'
import { MSG, encode, decode, validateHello, validateInput, validateClass } from '../renderer/net/protocol.js'
import { PVP } from '../renderer/data/pvp.js'
import { NET } from '../renderer/data/net.js'

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(encode(msg)) }

export function heartbeatSweep(clients) {
  for (const ws of clients) {
    if (ws.missed >= NET.heartbeatMisses) { ws.terminate(); continue }
    ws.missed = (ws.missed ?? 0) + 1
    ws.ping()
  }
}

export function attachPvp(httpServer, { path = NET.path, heartbeatMs = NET.heartbeatMs, ...lobbyOpts } = {}) {
  const lobby = makeLobby(lobbyOpts)
  const wss = new WebSocketServer({ noServer: true, maxPayload: NET.maxPayload })
  const loops = new Map()

  httpServer.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== path) { socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  })

  function broadcast(room, body) {
    for (const [id, ws] of room.sockets) send(ws, { ...body, ack: ackOf(room, id) })
  }

  function ensureLoop(room) {
    if (loops.has(room.code)) return
    const tickMs = PVP.tick * 1000
    let last = performance.now(), acc = 0
    loops.set(room.code, setInterval(() => {
      const now = performance.now()
      acc += Math.min(now - last, PVP.maxFrame * 1000)
      last = now
      while (acc >= tickMs) {
        acc -= tickMs
        const body = stepRoom(lobby, room)
        if (body) broadcast(room, body)
      }
    }, tickMs))
  }

  function stopLoop(code) {
    clearInterval(loops.get(code))
    loops.delete(code)
  }

  wss.on('connection', ws => {
    ws.missed = 0
    ws.on('pong', () => { ws.missed = 0 })
    let room = null, heroId = null
    ws.on('message', (data, isBinary) => {
      const msg = isBinary ? null : decode(data)
      if (!msg) { ws.close(1003); return }
      if (!room) {
        if (msg.type !== MSG.HELLO) { ws.close(1008); return }
        const hello = validateHello(msg)
        const res = hello.error ? hello : hello.create ? createRoom(lobby, hello) : joinRoom(lobby, hello.room, hello)
        if (res.error) { send(ws, { type: MSG.ERROR, code: res.error }); ws.close(1008); return }
        room = res.room; heroId = res.heroId
        room.sockets ??= new Map()
        room.sockets.set(heroId, ws)
        ensureLoop(room)
        send(ws, { type: MSG.WELCOME, v: NET.protocolVersion, room: room.code, heroId, tick: room.match.tick })
        return
      }
      if (msg.type === MSG.INPUT) { const input = validateInput(msg); if (input) queueInput(room, heroId, input) }
      else if (msg.type === MSG.CLASS) { if (validateClass(msg.cls)) setRoomClass(room, heroId, msg.cls) }
      else if (msg.type === MSG.PING) { if (Number.isFinite(msg.t)) send(ws, { type: MSG.PONG, t: msg.t }) }
    })
    ws.on('close', () => {
      if (!room) return
      room.sockets.delete(heroId)
      leaveRoom(lobby, room, heroId)
      if (!lobby.rooms.has(room.code)) stopLoop(room.code)
    })
  })

  const heartbeat = setInterval(() => heartbeatSweep(wss.clients), heartbeatMs)

  return {
    lobby, wss,
    close() {
      clearInterval(heartbeat)
      for (const code of [...loops.keys()]) stopLoop(code)
      for (const ws of wss.clients) ws.terminate()
      wss.close()
    },
  }
}
```

`tools/web-server.mjs`: keep the handler, but assign the server and attach PvP before `listen`:

```js
import { attachPvp } from '../server/pvp-server.js'
// …
const server = http.createServer((req, res) => {
  // … unchanged static handler …
})
attachPvp(server)
server.listen(PORT, () => console.log(`dungeon-crawler web: http://localhost:${PORT}  (pvp on ws://localhost:${PORT}/pvp)`))
```
Update the header comment: the same server now also carries the PvP WebSocket on `/pvp` (spec `…-pvp-server-netcode-design.md`).

- [ ] **Step 5: Run tests**

Run: `node --test test/net-server.test.js && npm test`
Expected: PASS. Then start `npm run web` for a moment and confirm it prints the pvp line and still serves `/` (for example `curl -s localhost:8080/ | head -3`). Stop it.

- [ ] **Step 6: Commit**

```bash
git add server/pvp-server.js tools/web-server.mjs package.json package-lock.json test/net-helpers.js test/net-server.test.js
git commit -m "feat(net): the /pvp WebSocket server — hello, rooms loop, snapshots, heartbeat

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 5: Prediction and interpolation

**Files:**
- Create: `renderer/net/predict.js`, `renderer/net/interp.js`
- Test: `test/net-predict.test.js`, `test/net-interp.test.js`

**Interfaces:**
- Consumes: `moveHero`, `tickHeroStatus`, `makeHero` (hero.js); `hydrateHero`, `heroSnap` (protocol); `getAttack`, `isChargeWeapon`, `shouldAutoRelease` (melee.js); `shouldAutoReleaseGust` (magic.js); `NET`, `PVP`.
- Produces:
  - **predict.js:**
    - `makePredictor({ map, heroSnap }) → pred` (`pred = { map, hero, pending: [], corr: { x, y, age }, swing: null, swingCooldown: 0 }`);
    - `predictStep(pred, input, dt = PVP.tick)` (movement plus the charge wind-up);
    - `predictCosmetics(pred, input, dt)` (the local tap-swing animation);
    - `reconcile(pred, snapHero, ack)`;
    - `tickCorrection(pred, dtMs)`, `drawnPos(pred) → { x, y }`.
  - **interp.js:**
    - `makeInterp() → buf`, `pushSnap(buf, snap, nowMs)`;
    - `estServerTick(buf, nowMs)`, `renderTick(buf, nowMs)`;
    - `sample(buf, rt) → { a, b, f }`;
    - `heroPoses(buf, rt) → Map<id, { snap, px, py }>`;
    - `projectilesAt(buf, rt) → projectile[]`, `newest(buf) → snap|null`.

- [ ] **Step 1: Write the failing tests**

`test/net-predict.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makePredictor, predictStep, predictCosmetics, reconcile, tickCorrection, drawnPos } from '../renderer/net/predict.js'
import { heroSnap } from '../renderer/net/protocol.js'
import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'
import { NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { PVP } from '../renderer/data/pvp.js'
import { NET } from '../renderer/data/net.js'

const east = { ...NEUTRAL_INPUT, move: { x: 1, y: 0 }, facing: 'east' }
const lone = cls => makeMatch({ roster: [{ id: 'p1', name: 'A', cls }] })

describe('prediction', () => {
  it('replaying the same inputs reproduces the server exactly', () => {
    const m = lone('mage')
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    for (let seq = 1; seq <= 20; seq++) {
      const input = { ...east, seq, attack: seq > 5 && seq < 12 }   // a spell wind-up slows the walk
      stepMatch(m, { p1: input }, PVP.tick)
      predictStep(pred, input)
      pred.pending.push({ seq, input })
    }
    assert.ok(Math.abs(pred.hero.px - m.heroes[0].px) < 1e-9)
    reconcile(pred, heroSnap(m.heroes[0]), 20)
    assert.equal(pred.pending.length, 0)
    assert.deepEqual(pred.corr, { x: 0, y: 0, age: 0 })
    assert.ok(Math.abs(drawnPos(pred).x - m.heroes[0].px) < 1e-9)
  })
  it('reconcile replays the unacknowledged inputs on top of the server state', () => {
    const m = lone('archer')
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    for (let seq = 1; seq <= 10; seq++) { const input = { ...east, seq }; predictStep(pred, input); pred.pending.push({ seq, input }) }
    const predicted = pred.hero.px
    for (let seq = 1; seq <= 6; seq++) stepMatch(m, { p1: { ...east, seq } }, PVP.tick)
    reconcile(pred, heroSnap(m.heroes[0]), 6)
    assert.equal(pred.pending.length, 4)
    assert.ok(Math.abs(pred.hero.px - predicted) < 1e-9)
  })
  it('a small error blends away over correctionMs; a huge one snaps', () => {
    const m = lone('archer')
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    const s = heroSnap(m.heroes[0])
    reconcile(pred, { ...s, px: s.px + 10 }, 0)       // the server says we are 10 px further on
    assert.ok(Math.abs(drawnPos(pred).x - s.px) < 1e-9, 'drawn stays put at first')
    tickCorrection(pred, NET.correctionMs / 2)
    assert.ok(Math.abs(drawnPos(pred).x - (s.px + 5)) < 1e-9)
    tickCorrection(pred, NET.correctionMs)
    assert.ok(Math.abs(drawnPos(pred).x - (s.px + 10)) < 1e-9)
    reconcile(pred, { ...s, px: s.px + 500 }, 0)
    assert.equal(drawnPos(pred).x, s.px + 500)
  })
  it('draws the hero alpha of the way through its last step', () => {
    const m = lone('archer')
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    const x0 = pred.hero.px
    pred.from = { x: x0, y: pred.hero.py }
    predictStep(pred, east)
    const x1 = pred.hero.px
    pred.alpha = 0.5
    assert.ok(Math.abs(drawnPos(pred).x - (x0 + x1) / 2) < 1e-9)
  })
  it('the tap swing animates locally at once and not again until its cooldown passes', () => {
    const m = makeMatch({ roster: [{ id: 'p1', name: 'A', cls: 'warrior' }] })
    const pred = makePredictor({ map: m.map, heroSnap: heroSnap(m.heroes[0]) })
    const swing = { ...NEUTRAL_INPUT, attack: true, facing: 'east' }
    predictCosmetics(pred, swing, PVP.tick)
    assert.ok(pred.swing)
    const first = pred.swing
    predictCosmetics(pred, swing, PVP.tick)
    assert.equal(pred.swing, first)
    reconcile(pred, heroSnap(m.heroes[0]), 0)          // a snapshot that has not seen the swing yet
    predictCosmetics(pred, swing, PVP.tick)
    assert.equal(pred.swing, first, 'reconcile does not restart the local swing')
  })
})
```

`test/net-interp.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeInterp, pushSnap, estServerTick, renderTick, sample, heroPoses, projectilesAt, newest } from '../renderer/net/interp.js'
import { PVP } from '../renderer/data/pvp.js'
import { NET } from '../renderer/data/net.js'

const snap = (tick, px, extra = {}) => ({ tick, heroes: [{ id: 'b', px, py: 100, dead: false }], projectiles: [], pickups: [], ...extra })
const tickMs = PVP.tick * 1000

describe('interpolation', () => {
  it('estimates the server tick from the last arrival, capped', () => {
    const buf = makeInterp()
    pushSnap(buf, snap(30, 0), 1000)
    assert.equal(estServerTick(buf, 1000), 30)
    assert.ok(Math.abs(estServerTick(buf, 1000 + 2 * tickMs) - 32) < 1e-9)
    assert.equal(estServerTick(buf, 1000 + 999 * tickMs), 30 + NET.extrapolateTicks + NET.interpDelayTicks)
    assert.equal(renderTick(buf, 1000), 30 - NET.interpDelayTicks)
  })
  it('lerps a hero between the snapshots around renderTick', () => {
    const buf = makeInterp()
    pushSnap(buf, snap(10, 0), 0); pushSnap(buf, snap(12, 64), 0)
    const { a, b, f } = sample(buf, 11)
    assert.equal(a.tick, 10); assert.equal(b.tick, 12); assert.equal(f, 0.5)
    assert.equal(heroPoses(buf, 11).get('b').px, 32)
  })
  it('extrapolates on its last velocity for at most extrapolateTicks, then holds', () => {
    const buf = makeInterp()
    pushSnap(buf, snap(10, 0), 0); pushSnap(buf, snap(12, 20), 0)   // 10 px/tick
    assert.equal(heroPoses(buf, 13).get('b').px, 30)
    assert.equal(heroPoses(buf, 12 + NET.extrapolateTicks + 5).get('b').px, 20 + 10 * NET.extrapolateTicks)
  })
  it('does not lerp across a teleport (respawn)', () => {
    const buf = makeInterp()
    pushSnap(buf, snap(10, 0), 0); pushSnap(buf, snap(12, 800), 0)
    assert.equal(heroPoses(buf, 11).get('b').px, 800)
  })
  it('advances projectiles from the older snapshot along their velocity', () => {
    const buf = makeInterp()
    pushSnap(buf, snap(10, 0, { projectiles: [{ px: 100, py: 0, dx: 300, dy: 0 }] }), 0)
    pushSnap(buf, snap(12, 0, { projectiles: [] }), 0)
    assert.equal(projectilesAt(buf, 11)[0].px, 100 + 300 * PVP.tick)
  })
  it('keeps about a second of snapshots and hands back the newest', () => {
    const buf = makeInterp()
    for (let t = 0; t < 100; t++) pushSnap(buf, snap(t, t), 0)
    assert.ok(buf.snaps.length <= NET.bufferTicks + 1)
    assert.equal(newest(buf).tick, 99)
  })
  it('equal ticks (a frozen match during results) never divide by zero', () => {
    const buf = makeInterp()
    pushSnap(buf, snap(50, 5), 0); pushSnap(buf, snap(50, 5), 0)
    assert.equal(heroPoses(buf, 50).get('b').px, 5)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/net-predict.test.js test/net-interp.test.js`
Expected: FAIL. The modules are not found.

- [ ] **Step 3: Implement**

`renderer/net/predict.js`:

```js
// Client-side prediction for your own hero (spec §2): the same moveHero the
// server runs, applied at once to every input you send, then corrected
// against each snapshot by replaying what the server has not acknowledged.
// Damage is never predicted; the tap swing's animation and the charge
// wind-up are. Pure.
import { moveHero, tickHeroStatus } from '../pvp/hero.js'
import { hydrateHero, heroSnap } from './protocol.js'
import { getAttack, isChargeWeapon, shouldAutoRelease } from '../systems/melee.js'
import { shouldAutoReleaseGust } from '../systems/magic.js'
import { PVP } from '../data/pvp.js'
import { NET } from '../data/net.js'

export function makePredictor({ map, heroSnap: s }) {
  // from/alpha: the hero is drawn between where it was before the last live
  // step (`from`) and where it is now, `alpha` of the way — the sim moves in
  // 33 ms steps, the screen in 16 ms frames. client.js sets both.
  return { map, hero: hydrateHero(null, s), pending: [], corr: { x: 0, y: 0, age: 0 }, swing: null, swingCooldown: 0,
    from: null, alpha: 1 }
}

// The charge half of tickMelee/tickMagic without its effects: start, hold,
// release. It keeps the predicted walk exact (a wind-up slows you) — the
// cast or blow itself arrives from the server.
function predictCharge(h, input, dt) {
  const wt = h.weapon?.weaponType
  const kind = h.attackMode === 'magic' ? 'spell' : h.attackMode === 'melee' && isChargeWeapon(wt) ? 'melee' : null
  if (!kind) return
  if (h.charging) {
    const over = kind === 'spell' ? shouldAutoReleaseGust(h.charging.t) : shouldAutoRelease(wt, h.charging.t)
    if (input.attack && !over) h.charging.t += dt
    else { h.charging = null; h.needRelease = true }
  } else if (input.attack && !h.needRelease && !h.blocking &&
             (kind === 'spell' ? h.magicCooldown <= 0 : h.meleeCooldown <= 0)) {
    h.charging = kind === 'spell' ? { t: 0, kind: 'spell' } : { t: 0 }
  }
}

export function predictStep(pred, input, dt = PVP.tick) {
  const h = pred.hero
  if (h.dead) return
  tickHeroStatus(h, dt)
  const { stunned } = moveHero({ map: pred.map }, h, input, dt)
  if (stunned) { h.charging = null; return }
  predictCharge(h, input, dt)
}

// The tap swing starts drawing the moment the key goes down. Its own
// cooldown lives on the predictor, so a snapshot that has not seen the swing
// yet cannot restart it.
export function predictCosmetics(pred, input, dt = PVP.tick) {
  pred.swingCooldown = Math.max(0, pred.swingCooldown - dt)
  if (pred.swing) { pred.swing.t += dt; if (pred.swing.t >= pred.swing.dur) pred.swing = null }
  const h = pred.hero
  const wt = h.weapon?.weaponType
  if (h.dead || h.attackMode !== 'melee' || !wt || isChargeWeapon(wt) || h.blocking || h.stunTimer > 0) return
  if (!input.attack || pred.swingCooldown > 0) return
  const atk = getAttack(wt)
  pred.swing = { t: 0, dur: atk.duration, style: atk.style, facing: h.facing }
  pred.swingCooldown = atk.cooldown
}

export function drawnPos(pred) {
  const k = Math.max(0, 1 - pred.corr.age / NET.correctionMs)
  const h = pred.hero, f = pred.from ?? { x: h.px, y: h.py }, a = pred.alpha ?? 1
  return { x: f.x + (h.px - f.x) * a + pred.corr.x * k, y: f.y + (h.py - f.y) * a + pred.corr.y * k }
}

export function tickCorrection(pred, dtMs) {
  pred.corr.age = Math.min(NET.correctionMs, pred.corr.age + dtMs)
}

export function reconcile(pred, snapHero, ack) {
  const before = drawnPos(pred)
  const old = { x: pred.hero.px, y: pred.hero.py }
  hydrateHero(pred.hero, snapHero)
  pred.pending = pred.pending.filter(p => p.seq > ack)
  for (const p of pred.pending) predictStep(pred, p.input)
  // Carry the sub-tick segment along with the corrected hero, so the
  // smoothing keeps its shape and only the correction below is new.
  if (pred.from) { pred.from.x += pred.hero.px - old.x; pred.from.y += pred.hero.py - old.y }
  pred.corr = { x: 0, y: 0, age: 0 }
  const after = drawnPos(pred)
  const ex = before.x - after.x, ey = before.y - after.y
  const err = Math.hypot(ex, ey)
  if (err >= NET.snapPx && err <= NET.bigSnapPx) pred.corr = { x: ex, y: ey, age: 0 }
}

export { heroSnap }
```

`renderer/net/interp.js`:

```js
// Snapshot interpolation for everything that is not your own hero (spec §2):
// drawn NET.interpDelayTicks behind the estimated server tick, lerped
// between the two snapshots around that moment; a dry buffer extrapolates
// briefly, then holds. Pure.
import { PVP } from '../data/pvp.js'
import { NET } from '../data/net.js'

export function makeInterp() { return { snaps: [], lastArrival: 0 } }

export function pushSnap(buf, snap, nowMs) {
  buf.snaps.push(snap)
  buf.lastArrival = nowMs
  const oldest = snap.tick - NET.bufferTicks
  while (buf.snaps.length > 2 && buf.snaps[0].tick < oldest) buf.snaps.shift()
}

export const newest = buf => buf.snaps.at(-1) ?? null

export function estServerTick(buf, nowMs) {
  const last = newest(buf)
  if (!last) return 0
  const ahead = (nowMs - buf.lastArrival) / 1000 / PVP.tick
  return last.tick + Math.min(ahead, NET.extrapolateTicks + NET.interpDelayTicks)
}

export const renderTick = (buf, nowMs) => estServerTick(buf, nowMs) - NET.interpDelayTicks

// a: the newest snapshot at or before rt; b: the first one after it (null on
// a dry buffer); f: how far between them.
export function sample(buf, rt) {
  const s = buf.snaps
  if (!s.length) return { a: null, b: null, f: 0 }
  let i = s.length - 1
  while (i > 0 && s[i].tick > rt) i--
  const a = s[i]
  const b = s.slice(i + 1).find(x => x.tick > a.tick) ?? null
  if (a.tick > rt) return { a, b: null, f: 0 }
  const f = b ? Math.min(1, (rt - a.tick) / (b.tick - a.tick)) : 0
  return { a, b, f }
}

function previousOf(buf, snap) {
  const i = buf.snaps.indexOf(snap)
  for (let j = i - 1; j >= 0; j--) if (buf.snaps[j].tick < snap.tick) return buf.snaps[j]
  return null
}

export function heroPoses(buf, rt) {
  const out = new Map()
  const { a, b, f } = sample(buf, rt)
  if (!a) return out
  if (b) {
    for (const hb of b.heroes) {
      const ha = a.heroes.find(h => h.id === hb.id)
      const jump = ha ? Math.hypot(hb.px - ha.px, hb.py - ha.py) : Infinity
      if (!ha || ha.dead || hb.dead || jump > NET.bigSnapPx) out.set(hb.id, { snap: hb, px: hb.px, py: hb.py })
      else out.set(hb.id, { snap: hb, px: ha.px + (hb.px - ha.px) * f, py: ha.py + (hb.py - ha.py) * f })
    }
    return out
  }
  const prev = previousOf(buf, a)
  const ext = Math.min(Math.max(0, rt - a.tick), NET.extrapolateTicks)
  for (const ha of a.heroes) {
    const hp = prev?.heroes.find(h => h.id === ha.id)
    const span = prev ? a.tick - prev.tick : 0
    const vx = hp && span && !ha.dead ? (ha.px - hp.px) / span : 0
    const vy = hp && span && !ha.dead ? (ha.py - hp.py) / span : 0
    const fast = Math.hypot(vx, vy) * NET.extrapolateTicks > NET.bigSnapPx
    out.set(ha.id, { snap: ha, px: fast ? ha.px : ha.px + vx * ext, py: fast ? ha.py : ha.py + vy * ext })
  }
  return out
}

export function projectilesAt(buf, rt) {
  const { a } = sample(buf, rt)
  if (!a) return []
  const dt = Math.max(0, rt - a.tick) * PVP.tick
  return a.projectiles.map(p => ({ ...p, px: p.px + p.dx * dt, py: p.py + p.dy * dt }))
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/net-predict.test.js test/net-interp.test.js`
Expected: PASS. If "replaying reproduces the server exactly" fails, diff `pred.hero` against the server hero field by field. The cause is a field `hydrateHero` doesn't carry that `moveHero` reads. Fix it in `heroSnap`/`hydrateHero` (Task 2's file) and name the fix in the report.

- [ ] **Step 5: Commit**

```bash
git add renderer/net/predict.js renderer/net/interp.js test/net-predict.test.js test/net-interp.test.js
git commit -m "feat(net): client prediction with reconciliation, snapshot interpolation

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 6: The client session and play under lag

**Files:**
- Create: `renderer/net/client.js`
- Modify: `test/net-helpers.js` (add `laggy`, `drive`)
- Test: `test/net-play.test.js`

**Interfaces:**
- Consumes: Tasks 2, 4 and 5; `arenaMap` (Task 1); `makeFeedback`, `addFloat`, `tickFeedback`; `tickWalk`.
- Produces:
  - `connect({ url, hello, WebSocketImpl = globalThis.WebSocket, now = () => performance.now() }) → session`;
  - `frame(session, input, nowMs)`;
  - `sessionView(session, nowMs) → { me, others, projectiles, lightning, strikes, arcs, shockwaves, pickups, clock, waiting, ended, matchLength, room, ping, feedback } | null` (null until the first snapshot);
  - `sendClass(session, cls)`, `leave(session)`, `drainEvents(session) → event[]`, `drainCues(session) → cue[]`.
  - Session fields used by tests and the UI: `status` (`'connecting' | 'open' | 'error' | 'left' | 'lost'`), `error`, `room`, `heroId`, `map`, `pred`, `interp`, `ping`.
  - Test helpers: `laggy({ up, down, jitter = 0, stallChance = 0, stallMs = 0, seed = 1 }) → WebSocket class`, and `drive(session, inputAt(t), ms, onFrame?)`, which calls `frame` + `sessionView` every 16 ms.

- [ ] **Step 1: Add the helpers**

Append to `test/net-helpers.js`:

```js
// A WebSocket that behaves like a laggy link: every message waits `up`/`down`
// ms (+ jitter, + an occasional stall) and order is kept — a TCP link never
// drops, it stalls.
export function laggy({ up = 0, down = 0, jitter = 0, stallChance = 0, stallMs = 0, seed = 1 } = {}) {
  let s = seed >>> 0
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const delay = base => base + jitter * rnd() + (rnd() < stallChance ? stallMs : 0)
  return class LaggyWebSocket {
    constructor(url) {
      this.inner = new WebSocket(url)
      this.upAt = 0; this.downAt = 0
      this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null
      this.inner.on('open', () => this.onopen?.())
      this.inner.on('error', e => this.onerror?.(e))
      this.inner.on('message', data => {
        const at = this.downAt = Math.max(this.downAt, Date.now() + delay(down))
        const text = data.toString()
        setTimeout(() => this.onmessage?.({ data: text }), at - Date.now())
      })
      this.inner.on('close', () => {
        const at = Math.max(this.downAt, Date.now()) + 1
        setTimeout(() => this.onclose?.(), at - Date.now())
      })
    }
    get readyState() { return this.inner.readyState }
    send(text) {
      const at = this.upAt = Math.max(this.upAt, Date.now() + delay(up))
      setTimeout(() => { if (this.inner.readyState === 1) this.inner.send(text) }, at - Date.now())
    }
    close() { this.inner.close() }
  }
}

// Run a client like the game loop would: a frame every 16 ms for `ms`.
export async function drive(session, inputAt, ms, onFrame = () => {}) {
  const { frame, sessionView } = await import('../renderer/net/client.js')
  const start = Date.now()
  while (Date.now() - start < ms) {
    const t = Date.now()
    frame(session, inputAt(t - start), t)
    onFrame(sessionView(session, t), t - start)
    await sleep(16)
  }
}
```

- [ ] **Step 2: Write the failing tests**

`test/net-play.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, laggy, drive, waitFor, sleep } from './net-helpers.js'
import { connect, frame, sessionView, leave, drainEvents } from '../renderer/net/client.js'
import { placeHero } from '../renderer/pvp/hero.js'
import { NEUTRAL_INPUT } from '../renderer/pvp/hero.js'

const idle = () => NEUTRAL_INPUT
const east = () => ({ ...NEUTRAL_INPUT, move: { x: 1, y: 0 }, facing: 'east' })
const open = async s => { await waitFor(() => s.status === 'open' && s.pred, 3000); return s }
const host = (url, W, cls = 'archer') => open(connect({ url, WebSocketImpl: W, now: Date.now, hello: { name: 'Host', cls, create: true } }))
const join = (url, W, room, cls = 'archer') => open(connect({ url, WebSocketImpl: W, now: Date.now, hello: { name: 'Guest', cls, room } }))
const serverHero = (srv, s) => srv.pvp.lobby.rooms.get(s.room).match.heroes.find(h => h.id === s.heroId)

describe('play under lag', () => {
  it('walk: prediction ends within 2 px of the server and never jumps more than 4 px per 16 ms frame', async () => {
    const srv = await startServer()
    const W = laggy({ up: 60, down: 60, jitter: 60, stallChance: 0.02, stallMs: 300 })
    const a = await host(srv.url, W)
    // Normalised to a 16 ms frame: a slow test-runner frame may cover more
    // ground, but never faster than the hero walks plus a small correction.
    let lastX = null, lastT = null, maxJump = 0
    const track = (v, t) => {
      if (!v) return
      if (lastX !== null) maxJump = Math.max(maxJump, Math.abs(v.me.px - lastX) * 16 / Math.max(16, t - lastT))
      lastX = v.me.px; lastT = t
    }
    await drive(a, t => t < 1000 ? east() : idle(), 1800, track)
    const v = sessionView(a, Date.now())
    assert.ok(Math.abs(v.me.px - serverHero(srv, a).px) < 2, `${v.me.px} vs ${serverHero(srv, a).px}`)
    assert.ok(maxJump <= 4, `max jump ${maxJump}`)
    leave(a); await srv.close()
  })

  it("interpolation: B's view of A never steps more than a tile per frame", async () => {
    const srv = await startServer()
    const W = laggy({ up: 80, down: 80, jitter: 40 })
    const a = await host(srv.url, W)
    const b = await join(srv.url, W, a.room)
    let last = null, maxStep = 0
    const bFrames = drive(b, idle, 1600, v => {
      const other = v?.others.find(h => h.id === a.heroId)
      if (!other) return
      if (last) maxStep = Math.max(maxStep, Math.hypot(other.px - last.px, other.py - last.py))
      last = { px: other.px, py: other.py }
    })
    await drive(a, t => t < 1200 ? east() : idle(), 1600)
    await bFrames
    assert.ok(last, 'B saw A')
    assert.ok(maxStep <= 32, `max step ${maxStep}`)
    leave(a); leave(b); await srv.close()
  })

  for (const rewind of [true, false]) {
    it(`melee under 100 ms lag ${rewind ? 'hits with rewind' : 'misses without rewind'}`, async () => {
      const srv = await startServer({ rewind })
      const W = laggy({ up: 100, down: 100 })
      const a = await host(srv.url, W, 'warrior')
      const b = await join(srv.url, W, a.room, 'archer')
      const [wa, hb] = [serverHero(srv, a), serverHero(srv, b)]
      placeHero(wa, { x: 9, y: 7 }); placeHero(hb, { x: 10, y: 7 })
      wa.spawnProtect = 0; hb.spawnProtect = 0; wa.facing = 'east'
      await sleep(400)                                      // both views settle on the new places
      let swung = false
      const bWalk = drive(b, east, 1500)
      await drive(a, () => {
        const v = sessionView(a, Date.now())
        const seen = v?.others.find(h => h.id === b.heroId)
        const go = !swung && seen && Math.hypot(seen.px - v.me.px, seen.py - v.me.py) >= 40
        if (go) swung = true
        return { ...NEUTRAL_INPUT, facing: 'east', attack: go }
      }, 1500)
      await bWalk
      assert.ok(swung, 'A swung')
      assert.equal(hb.hp < 10, rewind, `B hp ${hb.hp}`)
      leave(a); leave(b); await srv.close()
    })
  }

  it('lifecycle: matchEnd then matchStart; leaving empties the room', async () => {
    const srv = await startServer({ matchLength: 1.5, resultsDelay: 0.5 })
    const a = await host(srv.url, WebSocketNoLag())
    const b = await join(srv.url, WebSocketNoLag(), a.room)
    const seen = []
    await drive(a, idle, 2800, () => seen.push(...drainEvents(a).map(e => e.type)))
    assert.ok(seen.includes('matchEnd'), seen.join(','))
    assert.ok(seen.includes('matchStart'), seen.join(','))
    leave(b)
    await waitFor(() => sessionView(a, Date.now())?.others.length === 0 && sessionView(a, Date.now()).waiting)
    leave(a)
    await waitFor(() => srv.pvp.lobby.rooms.size === 0)
    await srv.close()
  })

  it('server close marks the session lost and frame() is a no-op', async () => {
    const srv = await startServer()
    const a = await host(srv.url, WebSocketNoLag())
    await srv.close()
    await waitFor(() => a.status === 'lost')
    assert.doesNotThrow(() => frame(a, idle(), Date.now()))
    assert.ok(drainEvents(a).some(e => e.type === 'closed' && e.status === 'lost'))
  })

  it('a 10 s frame gap sends at most maxFrame worth of inputs', async () => {
    const srv = await startServer()
    const a = await host(srv.url, WebSocketNoLag())
    const t = Date.now()
    frame(a, idle(), t)
    const before = a.seq
    frame(a, idle(), t + 10_000)
    assert.ok(a.seq - before <= 8, `${a.seq - before} inputs`)
    leave(a); await srv.close()
  })
})

function WebSocketNoLag() { return laggy({}) }
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test test/net-play.test.js`
Expected: FAIL. `renderer/net/client.js` is not found.

- [ ] **Step 4: Implement**

`renderer/net/client.js`:

```js
// The browser side of a PvP room (spec §2-§3): the connection, a fixed 30 Hz
// input loop, your predicted hero, everyone else interpolated, and a
// ready-to-draw view. The WebSocket constructor and the clock are passed in,
// so Node tests run the very same code with `ws`. No DOM.
import { MSG, encode, decode, hydrateHero, heroSnap } from './protocol.js'
import { makePredictor, predictStep, predictCosmetics, reconcile, tickCorrection, drawnPos } from './predict.js'
import { makeInterp, pushSnap, renderTick, heroPoses, projectilesAt, newest } from './interp.js'
import { arenaMap } from '../pvp/sim.js'
import { makeFeedback, addFloat, tickFeedback } from '../systems/feedback.js'
import { tickWalk } from '../systems/walk.js'
import { PVP } from '../data/pvp.js'
import { NET } from '../data/net.js'

export function connect({ url, hello, WebSocketImpl = globalThis.WebSocket, now = () => performance.now() }) {
  const s = {
    status: 'connecting', error: null, room: null, heroId: null, map: arenaMap(), now,
    pred: null, interp: makeInterp(), others: new Map(), meView: null, seq: 0, acc: 0,
    lastFrame: null, lastView: null, lastPingAt: -Infinity, ping: null,
    events: [], cues: [], feedback: makeFeedback(), closedByUs: false,
  }
  const ws = s.ws = new WebSocketImpl(url)
  ws.onopen = () => ws.send(encode({ type: MSG.HELLO, v: NET.protocolVersion, ...hello }))
  ws.onmessage = ev => onMessage(s, decode(ev.data), s.now())
  ws.onclose = () => {
    if (s.status !== 'error') s.status = s.closedByUs ? 'left' : 'lost'
    s.events.push({ type: 'closed', status: s.status })
  }
  return s
}

function onMessage(s, msg, t) {
  if (!msg) return
  if (msg.type === MSG.WELCOME) {
    s.status = 'open'; s.room = msg.room; s.heroId = msg.heroId
    s.events.push({ type: 'welcome', room: msg.room, heroId: msg.heroId })
  } else if (msg.type === MSG.ERROR) {
    s.status = 'error'; s.error = msg.code
    s.events.push({ type: 'error', code: msg.code })
  } else if (msg.type === MSG.PONG) {
    if (Number.isFinite(msg.t)) s.ping = t - msg.t
  } else if (msg.type === MSG.SNAP) {
    onSnap(s, msg, t)
  }
}

function onSnap(s, snap, t) {
  pushSnap(s.interp, snap, t)
  const mine = snap.heroes.find(h => h.id === s.heroId)
  if (mine) {
    if (!s.pred) s.pred = makePredictor({ map: s.map, heroSnap: mine })
    reconcile(s.pred, mine, snap.ack)
  }
  for (const e of snap.events) {
    s.events.push(e)
    const at = snap.heroes.find(h => h.id === (e.type === 'hit' ? e.target : e.killer))
    if (e.type === 'hit' && at && e.amount > 0) addFloat(s.feedback, { px: at.px, py: at.py - 10, text: `-${e.amount}`, kind: e.target === s.heroId ? 'taken' : 'dealt' })
    if (e.type === 'kill' && at) addFloat(s.feedback, { px: at.px, py: at.py - 16, text: '+1', kind: 'heal' })
  }
  s.cues.push(...snap.cues)
}

export function frame(s, input, t = s.now()) {
  if (s.status !== 'open') return
  const dt = s.lastFrame === null ? 0 : Math.min(t - s.lastFrame, PVP.maxFrame * 1000)
  s.lastFrame = t
  if (s.pred) tickCorrection(s.pred, dt)
  s.acc += dt
  const tickMs = PVP.tick * 1000
  while (s.acc >= tickMs) {
    s.acc -= tickMs
    const msg = {
      type: MSG.INPUT, seq: ++s.seq, view: Math.max(0, Math.floor(renderTick(s.interp, t))),
      move: { x: input.move?.x ?? 0, y: input.move?.y ?? 0 }, facing: input.facing ?? null,
      attack: !!input.attack, alt: !!input.alt, sprint: !!input.sprint,
    }
    s.ws.send(encode(msg))
    if (s.pred) {
      s.pred.from = { x: s.pred.hero.px, y: s.pred.hero.py }
      predictStep(s.pred, msg)
      predictCosmetics(s.pred, msg)
      s.pred.pending.push({ seq: msg.seq, input: msg })
      if (s.pred.pending.length > NET.pendingMax) s.pred.pending.shift()
    }
  }
  if (s.pred) s.pred.alpha = s.acc / tickMs
  if (t - s.lastPingAt >= NET.pingMs) { s.lastPingAt = t; s.ws.send(encode({ type: MSG.PING, t })) }
}

const TILE = 32
const place = (h, px, py) => { h.px = px; h.py = py; h.x = Math.floor(px / TILE); h.y = Math.floor(py / TILE) }

export function sessionView(s, t = s.now()) {
  const last = newest(s.interp)
  if (!s.pred || !last) return null
  const dt = s.lastView === null ? 0 : Math.min(t - s.lastView, PVP.maxFrame * 1000) / 1000
  s.lastView = t
  tickFeedback(s.feedback, dt)
  const rt = renderTick(s.interp, t)
  const others = []
  const poses = heroPoses(s.interp, rt)
  for (const [id, pose] of poses) {
    if (id === s.heroId) continue
    const h = hydrateHero(s.others.get(id) ?? null, pose.snap)
    place(h, pose.px, pose.py)
    tickWalk(h, dt)
    s.others.set(id, h)
    others.push(h)
  }
  for (const id of [...s.others.keys()]) if (!poses.has(id)) s.others.delete(id)
  const me = s.meView = hydrateHero(s.meView, heroSnap(s.pred.hero))
  const d = drawnPos(s.pred)
  place(me, d.x, d.y)
  const sw = s.pred.swing
  if (sw) Object.assign(me, { attackTimer: sw.dur - sw.t, attackDuration: sw.dur, attackStyle: sw.style, attackFacing: sw.facing })
  tickWalk(me, dt)
  return {
    me, others, projectiles: projectilesAt(s.interp, rt),
    lightning: last.lightning, strikes: last.strikes, arcs: last.arcs, shockwaves: last.shockwaves, pickups: last.pickups,
    clock: last.clock, waiting: last.waiting, ended: last.ended, matchLength: last.matchLength,
    room: s.room, ping: s.ping, feedback: s.feedback,
  }
}

export function sendClass(s, cls) { if (s.status === 'open') s.ws.send(encode({ type: MSG.CLASS, cls })) }
export function leave(s) { s.closedByUs = true; s.ws.close() }
export function drainEvents(s) { const e = s.events; s.events = []; return e }
export function drainCues(s) { const c = s.cues; s.cues = []; return c }
```

- [ ] **Step 5: Run tests (real time, under about 20 s)**

Run: `time node --test test/net-play.test.js`
Expected: PASS.
- **If the rewind pair fails,** print the attacker's `viewTick` and `room.match.tick` at the swing, plus B's history ring. The likely causes are `view` being computed before any snapshot arrived, or `hitPos` missing from a new match. Fix the cause and keep the assertions.
- **If "walk" shows jumps over 4 px,** check that `tickCorrection` runs every frame and that `reconcile` computes the error against the *drawn* position.

- [ ] **Step 6: Commit**

```bash
git add renderer/net/client.js test/net-helpers.js test/net-play.test.js
git commit -m "feat(net): client session — fixed-step inputs, prediction, interpolation, play tested under lag

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 7: In the game — `host`/`join`, text entry, HUD and the net loop

**Files:**
- Create: `renderer/net/view.js`
- Modify: `renderer/systems/cheats.js`, `renderer/ui/menu.js`, `renderer/ui/pvp-hud.js`, `renderer/game.js`
- Test: `test/net-ui.test.js`

**Interfaces:**
- Consumes: `connect`, `frame`, `sessionView`, `sendClass`, `leave`, `drainEvents`, `drainCues` (Task 6); `inputFromKeys` (`pvp/local.js`); `NET`.
- Produces:
  - `parseNetCheat(buffer) → 'host' | 'join' | null`;
  - `netUrl(loc) → string`, `normalizeCode(raw) → string`, `errorText(code) → string`, `netViewOf(v, theme) → render view`;
  - `netHudModel(v, heroId) → { room, time, kills, leaderKills, leading, dead, respawnIn, ping }`;
  - `menu.showTextEntry({ title, subtitle, value, maxLength, onSubmit, onBack })`, `menu.showMessage({ title, lines, onOk })`;
  - `menu.showPvpResults(rows, { onNext, onQuit })`: `onNext` is now optional;
  - `renderScreen` gains `onNet(kind)`, and `showTitle` passes it.

- [ ] **Step 1: Write the failing tests**

`test/net-ui.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseNetCheat, parsePvpCheat } from '../renderer/systems/cheats.js'
import { netUrl, normalizeCode, errorText, netViewOf } from '../renderer/net/view.js'
import { netHudModel } from '../renderer/ui/pvp-hud.js'
import { makeHero } from '../renderer/pvp/hero.js'

describe('net cheats', () => {
  it('host and join, suffix-matched, any case; pvp still its own', () => {
    assert.equal(parseNetCheat('xxHOST'), 'host')
    assert.equal(parseNetCheat('join'), 'join')
    assert.equal(parseNetCheat('pvp'), null)
    assert.equal(parsePvpCheat('pvp'), true)
  })
})

describe('view helpers', () => {
  it('netUrl follows the page protocol and host', () => {
    assert.equal(netUrl({ protocol: 'https:', host: 'x.run.app' }), 'wss://x.run.app/pvp')
    assert.equal(netUrl({ protocol: 'http:', host: 'localhost:8080' }), 'ws://localhost:8080/pvp')
  })
  it('normalizeCode uppercases and strips spaces', () => {
    assert.equal(normalizeCode(' kx pt '), 'KXPT')
  })
  it('errorText has a line for every error code and a fallback', () => {
    for (const code of ['version', 'no_room', 'room_full', 'bad_name', 'bad_hello', 'server_full'])
      assert.ok(errorText(code).length > 3, code)
    assert.ok(errorText('???').length > 3)
  })
  it('netViewOf builds a render view: you as player, everyone in heroes, pickups up only', () => {
    const me = makeHero({ id: 'p1', name: 'A', cls: 'mage' })
    const other = makeHero({ id: 'p2', name: 'B', cls: 'archer' })
    const v = { me, others: [other], projectiles: [], lightning: [], strikes: [], arcs: [], shockwaves: [],
      pickups: [{ kind: 'flask', x: 1, y: 1, px: 48, py: 48, up: true }, { kind: 'rune', x: 2, y: 2, px: 80, py: 80, up: false }],
      feedback: { floats: [] } }
    const view = netViewOf(v, { bgColor: '#000' }, [[{}]])
    assert.equal(view.player, me)
    assert.deepEqual(view.heroes.map(h => h.id), ['p1', 'p2'])
    assert.deepEqual(view.entities.map(e => [e.type, e.kind]), [['pvp_pickup', 'flask']])
  })
})

describe('netHudModel', () => {
  const view = (over = {}) => {
    const me = makeHero({ id: 'p1', name: 'A', cls: 'mage' })
    const other = makeHero({ id: 'p2', name: 'B', cls: 'archer' }); other.kills = 2
    return { me, others: [other], clock: 65.5, matchLength: 240, waiting: false, room: 'KXPT', ping: 48.4, ...over }
  }
  it('room, time left, kills, leader and ping', () => {
    const m = netHudModel(view(), 'p1')
    assert.equal(m.room, 'KXPT')
    assert.equal(m.time, '2:54')
    assert.equal(m.kills, 0)
    assert.equal(m.leaderKills, 2)
    assert.equal(m.leading, false)
    assert.equal(m.ping, 48)
  })
  it('--:-- while waiting for a second player', () => {
    assert.equal(netHudModel(view({ waiting: true, others: [] }), 'p1').time, '--:--')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/net-ui.test.js`
Expected: FAIL. `parseNetCheat` is not exported and `view.js` is not found.

- [ ] **Step 3: Implement the pure pieces**

`renderer/systems/cheats.js`, appended:

```js
// Title-screen cheats for online PvP (web build): "host" creates a room,
// "join" asks for a code. Suffix-matched like the others.
export function parseNetCheat(buffer) {
  const m = /(host|join)$/.exec(String(buffer).toLowerCase())
  return m ? m[1] : null
}
```

`renderer/net/view.js`:

```js
// Small pure helpers between the net session and the game: the socket URL,
// the typed room code, the refusal lines, and the render view.
import { NET } from '../data/net.js'

export const netUrl = loc => `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}${NET.path}`

export const normalizeCode = raw => String(raw ?? '').replace(/\s+/g, '').toUpperCase()

const ERROR_TEXT = {
  version: 'The game was updated — reload the page.',
  no_room: 'No such room.',
  room_full: 'That room is full.',
  bad_name: 'Name: 1–12 letters, digits, space, _ or -.',
  bad_hello: 'Could not join — check the code.',
  server_full: 'The server is full — try again soon.',
}
export const errorText = code => ERROR_TEXT[code] ?? 'Could not connect.'

// What Renderer.render and updateHUD read: a single-player-shaped state whose
// player is your (predicted) hero, plus every hero for the multi-hero draw.
export function netViewOf(v, theme, map) {
  return {
    map, theme, level: 0,
    player: v.me,
    heroes: [v.me, ...v.others],
    entities: v.pickups.filter(p => p.up).map(p => ({ ...p, type: 'pvp_pickup' })),
    projectiles: v.projectiles, lightning: v.lightning, strikes: v.strikes,
    arcs: v.arcs, shockwaves: v.shockwaves, zones: [], fireZones: [],
    feedback: v.feedback, hitEffects: [], flash: 0,
  }
}
```

`renderer/ui/pvp-hud.js`: add `netHudModel`, and let `updatePvpHud` show the optional `room` and `ping`:

```js
export function netHudModel(v, heroId) {
  const all = [v.me, ...v.others]
  const leader = [...all].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0]
  const left = Math.max(0, (v.matchLength ?? PVP.matchLength) - v.clock)
  return {
    room: v.room,
    time: v.waiting ? '--:--' : `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`,
    kills: v.me.kills, leaderKills: leader.kills, leading: leader.id === heroId,
    dead: v.me.dead, respawnIn: v.me.dead ? Math.ceil(v.me.respawnT) : 0,
    ping: v.ping === null || v.ping === undefined ? null : Math.round(v.ping),
  }
}
```
In `updatePvpHud`, prefix `m.room ? `<span>${m.room}</span>` : ''` to the markup and suffix `m.ping !== null && m.ping !== undefined ? `<span style="opacity:0.5;font-size:12px">${m.ping}ms</span>` : ''`. Local matches pass neither field, so their strip is unchanged.

- [ ] **Step 4: Run the pure tests**

Run: `node --test test/net-ui.test.js`
Expected: PASS.

- [ ] **Step 5: The menu**

In `renderer/ui/menu.js`:
- Import `parseNetCheat`.
- `renderScreen({ …, onNet, input })`:
  - After the lines, if `input` is given, append `<input class="menu-input" maxlength=…>` with `value` and `autocomplete="off"`, keep it as `currentInput`, and focus it after the overlay shows.
  - In the key handler's first line, `if (currentInput && e.target === currentInput && e.key !== 'Enter' && e.key !== 'Escape') return`. Typed letters (w, s, space) then reach the field instead of moving the selection.
  - In the cheat branch, after the `onPvp` check, add `const net = onNet && parseNetCheat(cheatBuffer); if (net) { clearCheatTimer(); cheatBuffer = ''; onNet(net); return }`.
  - Clear `currentInput = null` at the start of every `renderScreen` and in `hide()`.
- `showTitle(meta, { …, onNet })` passes `onNet`.
- Add:

```js
// A one-field form (name, room code): Enter or OK submits the text.
export function showTextEntry({ title, subtitle, value = '', maxLength = 12, onSubmit, onBack }) {
  renderScreen({
    title, subtitle, input: { value, maxLength },
    buttons: [
      { label: 'OK', onSelect: () => onSubmit(currentInput?.value ?? '') },
      ...(onBack ? [{ label: 'Back', onSelect: onBack }] : []),
    ],
  })
}

// A message with one button (connection lost, refused, web-only).
export function showMessage({ title, lines = [], onOk }) {
  renderScreen({ title, lines, buttons: [{ label: 'OK', onSelect: onOk }] })
}
```
- In `showPvpResults`, include the "Next match" button only when `onNext` is given.
- Add `.menu-input` styling next to the existing menu styles in `renderer/index.html`: `font: 18px monospace; padding: 6px 10px; margin: 8px 0; width: 12em; text-align: center; background: #111; color: #eee; border: 1px solid #555;`.

- [ ] **Step 6: game.js**

Imports:

```js
import { connect, frame as netFrameStep, sessionView, sendClass, leave as netLeave, drainEvents, drainCues } from './net/client.js'
import { netUrl, normalizeCode, errorText, netViewOf } from './net/view.js'
import { netHudModel } from './ui/pvp-hud.js'   // merge into the existing pvp-hud import
import { inputFromKeys } from './pvp/local.js'   // merge into the existing local.js import
```

State next to `let pvp = null`:

```js
// An online PvP room (renderer/net/) while one is joined. Like `pvp`, it
// keeps `state` null so every single-player handler no-ops.
let net = null
```

Flow functions (after `stopPvp`):

```js
const loadName = () => { try { return localStorage.getItem('dc-pvp-name') ?? '' } catch { return '' } }
const saveName = n => { try { localStorage.setItem('dc-pvp-name', n) } catch {} }

function goNet(kind) {
  phase = PHASE.TITLE
  if (!window.saveAPI?.isWeb) {
    menu.showMessage({ title: 'Online play', lines: ['Online play is in the web build.'], onOk: goTitle })
    return
  }
  menu.showTextEntry({ title: kind === 'host' ? 'Host a room' : 'Join a room', subtitle: 'Your name', value: loadName(),
    onBack: goTitle,
    onSubmit: name => {
      saveName(name)
      const pick = room => menu.showClassPicker({ onBack: goTitle, onPick: cls => startNet({ name, cls, room }) })
      if (kind === 'host') pick(null)
      else menu.showTextEntry({ title: 'Join a room', subtitle: 'Room code', maxLength: 6, onBack: goTitle,
        onSubmit: code => pick(normalizeCode(code)) })
    } })
}

function startNet({ name, cls, room }) {
  const theme = DEPTH_THEMES.find(t => t.depths.includes(0)) ?? DEPTH_THEMES[0]
  const s = connect({ url: netUrl(location), hello: room ? { name, cls, room } : { name, cls, create: true } })
  decorateMap(s.map, rulesets[theme.ruleset])
  net = { s, theme, muted: loadMutedPref() }
  state = null
  menu.showMessage({ title: 'Connecting…', onOk: stopNet })
  setPhase(PHASE.PLAYING)
  keys[' '] = false
}

function stopNet() {
  if (net) netLeave(net.s)
  net = null
  hidePvpHud()
  goTitle()
}

function netFrame() {
  const now = performance.now()
  const { s } = net
  netFrameStep(s, inputFromKeys(keys, sprintDetector.sprinting()), now)
  for (const ev of drainEvents(s)) {
    if (ev.type === 'welcome') menu.hide()
    else if (ev.type === 'error') { menu.showMessage({ title: 'Could not join', lines: [errorText(ev.code)], onOk: stopNet }); return }
    else if (ev.type === 'closed' && ev.status === 'lost') { menu.showMessage({ title: 'Connection lost', onOk: stopNet }); return }
    else if (ev.type === 'kill' && ev.victim === s.heroId)
      menu.showClassPicker({ title: 'Down!', subtitle: 'Class for your next life — back in 3 s',
        onPick: cls => { sendClass(s, cls); menu.hide(); keys[' '] = false } })
    else if (ev.type === 'respawn' && ev.hero === s.heroId) menu.hide()
    else if (ev.type === 'matchEnd') menu.showPvpResults(ev.standings, { onQuit: stopNet })
    else if (ev.type === 'matchStart') menu.hide()
  }
  const v = sessionView(s, now)
  if (!v) return
  const view = netViewOf(v, net.theme, s.map)
  maybeComputeFOV(view.map, view.player, 12, { los: true })
  renderer.updateCamera(view.player, 0, null)
  renderer.render(view, null)
  updateHUD(view)
  updatePvpHud(netHudModel(v, s.heroId))
  playCues(audio, drainCues(s), view.player, net.muted)
}
```

Note: a `showMessage`/`showPvpResults` open during PLAYING leaves the sim running underneath. `netFrame` returns early only on the terminal messages.

Wiring:
- `gameLoop`: `if (pvp) pvpFrame(delta) else if (net) netFrame() else { update(delta); if (state) render() }`.
- `goTitle`'s `showTitle` options: add `onNet: goNet`.
- Escape handler: `if (net) { stopNet(); return }` next to the `pvp` line.
- I handler: `if (pvp || net) return`.
- M handler: `if (net) { net.muted = !net.muted; saveMutedPref(net.muted); return }` next to the `pvp` line.
- The local death picker (`pvpFrame`): change its subtitle to `'Class for your next life — back in 3 s'` so the countdown isn't lost under the overlay.

- [ ] **Step 7: Verify**

Run: `npm test && node --check renderer/game.js renderer/ui/menu.js`
Expected: PASS. Then grep `renderer/game.js` for every new identifier (`goNet`, `startNet`, `stopNet`, `netFrame`, `netFrameStep`, `sessionView`, `netViewOf`, `netHudModel`, `normalizeCode`, `errorText`, `netUrl`, `inputFromKeys`) and confirm each is defined or imported.

- [ ] **Step 8: Commit**

```bash
git add renderer/net/view.js renderer/systems/cheats.js renderer/ui/menu.js renderer/ui/pvp-hud.js renderer/index.html renderer/game.js test/net-ui.test.js
git commit -m "feat(net): host/join in the web build — name and code entry, room HUD, the online loop

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 8: Container, deploy script, a local two-browser check, and docs

**Files:**
- Modify: `Dockerfile`, `.gcloudignore`, `CLAUDE.md` (at `/home/lappemikb/CLAUDE.md`, outside the repo)
- Create: `tools/deploy-web.sh`
- Scratch (not committed): a Playwright script in the session scratchpad

- [ ] **Step 1: Container files**

`.gcloudignore`: delete the `/package.json` and `/package-lock.json` lines. The build now needs them.

`Dockerfile`:

```dockerfile
# Web-release container: the static game plus the PvP WebSocket server.
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY tools/web-server.mjs tools/
COPY server/ server/
COPY renderer/ renderer/
ENV PORT=8080
EXPOSE 8080
CMD ["node", "tools/web-server.mjs"]
```

`tools/deploy-web.sh` (make it executable):

```bash
#!/usr/bin/env bash
# Deploy the web release (static game + /pvp WebSocket) to Cloud Run.
# One instance holds every room; sockets may live an hour; many per instance.
set -euo pipefail
cd "$(dirname "$0")/.."
gcloud run deploy dungeon-crawler --source . --project delimaster --region europe-west4 \
  --allow-unauthenticated --max-instances=1 --timeout=3600 --concurrency=1000 --quiet
```

- [ ] **Step 2: Check the production install path**

Run, from a temp copy so `node_modules` in the repo is untouched:

```bash
TMP=$(mktemp -d) && cp package.json package-lock.json "$TMP"/ && cp -r server tools renderer "$TMP"/ \
  && (cd "$TMP" && npm ci --omit=dev --ignore-scripts --silent && timeout 3 node tools/web-server.mjs; true) ; rm -rf "$TMP"
```
Expected: it prints `dungeon-crawler web: http://localhost:8080 (pvp on …/pvp)`, with no module-not-found error. That proves `ws` is in `dependencies` and nothing on the server imports a devDependency.

- [ ] **Step 3: Local two-browser check (time-boxed, about 2 minutes)**

Start `npm run web` in the background, then run this script from the repo root. Write it in the scratchpad and copy it to a git-ignored temp file in the repo root to run, since `playwright-core` resolves from the repo.

```js
import { chromium } from 'playwright-core'
const browser = await chromium.launch()
const errors = []
const page = async () => { const p = await browser.newPage({ viewport: { width: 1280, height: 720 } }); p.on('pageerror', e => errors.push(e.message)); await p.goto('http://localhost:8080'); await p.waitForTimeout(2500); return p }
const typeCheat = async (p, word) => { for (const k of word) await p.keyboard.press(k); await p.waitForTimeout(300) }
const a = await page()
await typeCheat(a, 'host')
await a.keyboard.type('Aino'); await a.keyboard.press('Enter'); await a.waitForTimeout(200)
await a.keyboard.press('Enter')                                   // Warrior
await a.waitForTimeout(1500)
const code = (await a.locator('#pvp-hud span').first().textContent()).trim()
const b = await page()
await typeCheat(b, 'join')
await b.keyboard.type('Ilmari'); await b.keyboard.press('Enter'); await b.waitForTimeout(200)
await b.keyboard.type(code); await b.keyboard.press('Enter'); await b.waitForTimeout(200)
await b.keyboard.press('ArrowDown'); await b.keyboard.press('Enter')   // Archer
await b.waitForTimeout(1500)
await a.keyboard.down('d'); await b.keyboard.down('a'); await a.waitForTimeout(1500); await a.keyboard.up('d'); await b.keyboard.up('a')
await a.waitForTimeout(1000)
await a.screenshot({ path: process.argv[2] + '/host.png' }); await b.screenshot({ path: process.argv[2] + '/guest.png' })
const hudA = await a.locator('#pvp-hud').textContent(), hudB = await b.locator('#pvp-hud').textContent()
await b.keyboard.press('Escape'); await b.waitForTimeout(500)
console.log(JSON.stringify({ code, hudA, hudB, errors, guestTitle: await b.locator('.menu-title').textContent() }))
await browser.close()
```
Expected:
- `code` is 4 letters;
- both HUDs start with it and show a running timer (not `--:--`) once the guest has joined;
- `errors` is `[]`;
- `guestTitle` is `DUNGEON CRAWLER`.

Read both screenshots: each should show the other hero with its name tag. Stop the web server afterwards. If anything fails, fix the cause (with a test where it lies in pure code) and re-run once.

- [ ] **Step 4: Docs**

In `/home/lappemikb/CLAUDE.md`, in the dungeon-crawler section, append to the `renderer/pvp/` bullet:

```markdown
 Online play (spec `docs/superpowers/specs/2026-09-25-pvp-server-netcode-design.md`): `server/` (`rooms.js` pure room logic — codes, input queues, the 30 Hz step, melee rewind history, the next match; `pvp-server.js` the `/pvp` WebSocket on `tools/web-server.mjs`, dependency `ws`) runs the same `renderer/pvp/sim.js`; `renderer/net/` holds the shared protocol v1 (`protocol.js`), client prediction (`predict.js`), interpolation (`interp.js`), the session (`client.js`, WebSocket injected) and view helpers; netcode numbers in `renderer/data/net.js`. In the web build, `host`/`join` title cheats create or join a 4-letter room. Deploy with `tools/deploy-web.sh` (Cloud Run: max-instances 1, timeout 3600, concurrency 1000).
```
The file is outside the repo; edit it without committing it.

- [ ] **Step 5: Full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add Dockerfile .gcloudignore tools/deploy-web.sh
git commit -m "chore(net): container ships server/ and ws; Cloud Run deploy script with socket settings

Co-Authored-By: <model> <noreply@anthropic.com>"
```

**After merge (controller, with the user's go-ahead — not part of this task):**
1. Fast-forward `web-release` from `main` in the `.claude/worktrees/three-game-modes` worktree.
2. Push both branches.
3. Run `tools/deploy-web.sh`.
4. Repeat Step 3's check against the public URL.
5. Update the deploy memory with the new flags.
