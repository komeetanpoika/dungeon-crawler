# PvP 4b — Arenas, Reconnect and Netcode Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Online and local PvP rotate through four arenas with their own looks; a dropped connection gets the same hero back within 20 s; other heroes stop twitching backwards on jittery links; melee hits land for players with up to ~300 ms of view lag; and the death screen counts the respawn down live.

**Architecture:**
- `renderer/data/pvp-arenas.js` gains three grid-authored arenas (`parseArena`), a theme per arena and the rotation (`PVP_ARENA_ORDER`, `arenaAt`, `nextArenaIndex`). `buildArena` takes a small additive `config.walls`; `arenaMap` pins its player spawn and lays sand for a sand theme.
- Rooms (`server/rooms.js`) and the local harness (`renderer/pvp/local.js`, via `game.js`) play the next arena each match. Protocol v3 names the arena on `welcome` and every `snap`; the client rebuilds its map when it changes, and `game.js` decorates each new map with its arena's theme.
- `renderer/net/interp.js` gets a smoothed, monotonic interpolation clock. `NET.rewindMaxTicks`/`historyTicks` go to 9/11.
- Reconnect: the server hands out a seat token in `welcome` (memory only), keeps a dropped human's seat `away` for `NET.reconnectGraceMs` (room ticks, like the idle timer), and re-seats it on `hello { resume }`; `bye` gives a seat up at once. The client retries on a fixed schedule from its frame loop, and `game.js` shows **Reconnecting…**, keeps the token in `sessionStorage` and brings a reloaded tab back into its seat.
- `menu.setSubtitle` updates the death picker's **Back in N** in place.

**Tech Stack:** vanilla ES modules, Node 22 (CI) / Node 20 (container), `ws@^8`, `node:test`, `node:crypto`, `playwright-core` for the live checks.

**Spec:** `docs/superpowers/specs/2026-09-26-pvp-4b-arenas-reconnect-design.md`. Earlier: `…-pvp-public-launch-design.md` and its plan `docs/superpowers/plans/2026-09-25-pvp-public-launch.md`.

## Global Constraints

- **Numbers from the spec, all in `renderer/data/net.js` (`NET`) unless noted:**

  | What | Value |
  |---|---|
  | `protocolVersion` | **3** |
  | `reconnectGraceMs` | 20 000 — a dropped human's seat is held `away` this long |
  | `reconnectDelaysMs` (client) | `[500, 1000, 2000, 4000, 8000]` — `hello { resume }` tries at 0.5, 1.5, 3.5, 7.5 and 15.5 s after the drop |
  | seat token | 128 random bits from `crypto.randomBytes(16)`, hex: exactly 32 characters `[0-9a-f]` (`TOKEN_RE` in `protocol.js`) |
  | client storage | `sessionStorage['dc-pvp-seat']` (per tab, gone with the tab) |
  | `clockSlew` | 0.1 — the interpolation clock runs at most 10 % fast or slow while catching up |
  | `clockSnapTicks` | 15 — a larger clock error snaps instead |
  | `rewindMaxTicks` | **9** (300 ms), was 6 |
  | `historyTicks` | **11**, was 8 |
  | new `MSG` / `ERR` | `MSG.BYE = 'bye'`, `ERR.RESUME_FAILED = 'resume_failed'` |
- **Arena invariants** (checked for every id in `PVP_ARENA_ORDER = ['pillars', 'glade', 'tunnels', 'ruins']`):
  - size within `buildArena`'s clamp: 8–40 wide × 8–30 tall;
  - rectangular rows, the border all walls;
  - exactly **6 spawns, 2 flasks (F), 2 quivers (Q), 1 rune (R)**, all on walkable cells;
  - every spawn and pickup reachable (4-neighbour BFS) from spawn 1 (the first `S` in reading order);
  - minimum spawn-to-spawn distance **≥ 6 tiles** (Euclidean);
  - the rune **≥ 5 tiles** from every spawn.
- **Themes** are `{ ruleset?, floorTile, bgColor, tint, fogAlpha }`, the shape of a `DEPTH_THEMES` entry. `pillars` keeps today's depth-0 look. No new tilesets or art.
- **Privacy:** seat tokens live only in the server's in-memory `tokens` map and the tab's `sessionStorage`. **Tokens and IP addresses are never logged**, and a token is never sent to anyone but its own seat's client.
- `renderer/net/`, `renderer/pvp/`, `renderer/data/` and `renderer/ui/net-panels.js` stay DOM-free: nothing in them may reference `document`, `window`, `localStorage`, `sessionStorage` or `render/*`. `sessionStorage` is touched only in `game.js`.
- **Unchanged behaviour:** single-player; limits (a resuming socket passes the per-IP gate and spends a hello like any other); the idle kick for players who are present; private rooms (humans only).
- **Out of scope:** a map vote, new modes, new tilesets or art.
- **No deploy inside tasks.** The controller deploys after the merge, with the user's go-ahead (see "After merge" at the end).
- Commits end with a `Co-Authored-By:` trailer naming the model that wrote them.
- Run the suite with `npm test`. Two known flakes, both to be re-run rather than chased: a lone SIGSEGV from Node's test runner on WSL; `npc.test.js` "deer never moved".

**Spec readings (ambiguities resolved here; binding for every task):**
1. **Spawn order and distance.** `parseArena` lists spawns and pickups in reading order (row by row, left to right); "spawn 1" is the first `S`. Distances are Euclidean, in tiles.
2. **`arenaMap`** passes `player: arena.spawns[0]` to `buildArena` (a floor cell, so no column or wall is ever skipped for standing on `buildArena`'s default player spawn), and a theme with `floorTile: 'sand'` swaps `FLOOR` for `SAND` (walkable), as `generateLevel` does for depth 3.
3. **Theme values.** Glade: `{ ruleset: 'outdoors', floorTile: 'floor', bgColor: '#0a1208' (the forest maps' green-dark), tint: null, fogAlpha: 0.65 }`. Tunnels: `{ ruleset: 'catacombs', floorTile: 'floor', bgColor: '#07070f', tint: 'rgba(0,0,20,0.35)', fogAlpha: 0.80 }` (depth 4). Ruins: `{ floorTile: 'sand', bgColor: '#1a1206', tint: 'rgba(40,20,0,0.2)', fogAlpha: 0.65 }` (depth 3).
4. **Rotation.** A room starts on index 0 (`pillars`); `startNextMatch` advances first, then builds. Locally, `game.js` keeps `pvp.arenaIndex`; the first local match is on `pillars` and "Next match" plays `nextArenaIndex` of the last.
5. **An unknown or missing `arena`** on a `welcome` or `snap` is refused exactly like a `version` error (`ERR.VERSION`, "The game was updated — reload the page.").
6. **The clock.** "Ticks since the last arrival" is measured on the local clock and the slew is applied on every estimate rather than as a step at arrival, so no single frame runs more than 10 % fast or slow. A snapshot whose tick is not newer than the last one the clock used (the results screen repeats one tick) leaves the clock alone. The first snapshot, and any error over 15 ticks, re-anchor the clock ("snap"); only then may `renderTick` step back.
7. **The grace period is counted in room ticks** (like the idle timer): `makeLobby({ reconnectGraceMs })` / `attachPvp(server, { reconnectGraceMs })` override it in tests.
8. **What gets the grace.** A socket that closes without `bye` while seated — a plain close, a network drop, a heartbeat termination — leaves its seat `away`. A `bye`, an idle kick, a flood refusal (close 1008) and a message that crashed its handler (1011) free the seat at once. A socket refused at `hello` never had a seat.
9. **Resume resets the ack.** Besides the input queue and the idle clock, `resumeSeat` sets the seat's `ack` to 0: the new client numbers its inputs from 1 again.
10. **`hello { resume }`** carries no name or class (the seat keeps its own); if sent, they are ignored. Exactly one of `create`/`room`/`quick`/`resume` is still required.
11. **The retry schedule.** The delays are gaps between successive tries (tries at 0.5, 1.5, 3.5, 7.5 and 15.5 s after the drop). A try still hanging when the next is due is abandoned for it. The client gives up after the fifth try fails, or at the first frame more than `reconnectGraceMs` after the drop (a tab hidden that long gives up at once, opening nothing).
12. **Refusals during a resume.** `resume_failed` ends it as "Connection lost" (no extra line). `version` ends it as "Connection lost" with the reload line. Any other refusal (`rate_limited`, `server_full`) costs that one try only.
13. **`bye`** is sent only while the session is `open` (before the welcome there is no seat to give up).
14. **The stored token is used on page load:** a web tab that starts with `sessionStorage['dc-pvp-seat']` set goes straight into `startNet({ resume })` behind the same **Reconnecting…** overlay. The key is written on every welcome and removed on any leave, loss or refusal.
15. **The death picker's subtitle** is `Back in ${ceil(respawnT)}`; a hero whose `respawnT` is not positive yet (the frame its kill event lands, before its first dead snapshot) reads the full `PVP.respawnDelay` (3).

## Review Focus

The five uncovered inputs most likely to bite a player, each pinned by a test in the named task:
1. **A drop while the death picker, the results or the "Leave the match?" confirm is up.** When the seat comes back, that same panel must come back — not a bare arena, and not a stale overlay → Task 7, "refresh() draws again whatever the Reconnecting overlay covered".
2. **The match rotated to a new arena while the player was away** (a drop across a results screen). The resumed client must walk and draw on the new arena, not the old map → Task 7, "resuming into a match that has moved to another arena rebuilds the map".
3. **The resumed client numbers its inputs from 1 again.** If the server kept the old ack, every new input would count as already acknowledged and the player's own hero would freeze or rubber-band → Task 5, "resumeSeat puts the same hero back … queue, ack and idle clock start over".
4. **A phone tab put in the background past the grace.** Coming back, it must say "Connection lost" at once instead of spending hellos on a seat that is surely gone → Task 7, "a tab hidden past the grace gives up at its first frame back, opening no socket".
5. **A household behind one IP that already spent its hello bucket.** A `rate_limited` answer to one resume try must not end the reconnect; the next try still goes out → Task 7, "a rate-limited attempt costs that attempt only".

---

## File Structure

| File | Responsibility |
|---|---|
| `renderer/data/pvp-arenas.js` (edit) | the four arenas, `parseArena`, `ARENA_ROWS`, themes, `PVP_ARENA_ORDER`, `arenaAt`, `nextArenaIndex` |
| `renderer/systems/map.js` (edit) | `buildArena` `config.walls` (interior `TILE.WALL`) |
| `renderer/pvp/sim.js` (edit) | `arenaMap`: walls, pinned player spawn, sand floor |
| `renderer/pvp/local.js` (edit) | `makeLocalMatch({ arenaIndex })` |
| `server/rooms.js` (edit) | `room.arenaIndex` rotation; `markAway`, `resumeSeat`, `drainExpired`, away inputs, idle suspended while away |
| `server/pvp-server.js` (edit) | `arena` + `token` on `welcome`; the `tokens` map; `hello.resume`; `bye`; close → away or vacate; expiry |
| `renderer/data/net.js` (edit) | the 4b numbers |
| `renderer/net/protocol.js` (edit) | v3: `MSG.BYE`, `ERR.RESUME_FAILED`, `TOKEN_RE`, `validateHello` with `resume`, `snapshotBody.arena` |
| `renderer/net/interp.js` (edit) | the smoothed, monotonic clock |
| `renderer/net/client.js` (edit) | arena on the wire; `bye` on leave; the reconnect state machine |
| `renderer/net/view.js` (edit) | `errorText('resume_failed')` |
| `renderer/ui/net-panels.js` (edit) | `showing`, `refresh()` |
| `renderer/ui/menu.js` (edit) | `setSubtitle`, `showClassPicker({ lines })` |
| `renderer/ui/pvp-hud.js` (edit) | `respawnLine` |
| `renderer/game.js` (edit) | themes per arena, local rotation, the countdown, Reconnecting…, `sessionStorage`, resume on load |
| `test/net-helpers.js` (edit) | `rawClient().bye()`; `laggy` close keeps order behind pending sends |
| `test/pvp-arenas.test.js` (new, replaces `test/pvp-arena.test.js`), `test/net-reconnect.test.js` (new) | tests |
| `test/arena.test.js`, `test/net-client.test.js`, `test/net-interp.test.js`, `test/net-panels.test.js`, `test/net-play.test.js`, `test/net-protocol.test.js`, `test/net-public.test.js`, `test/net-public-rooms.test.js`, `test/net-rooms.test.js`, `test/net-server.test.js`, `test/net-sim.test.js`, `test/net-ui.test.js`, `test/menu.test.js`, `test/pvp-ui.test.js` (edit) | tests |

Task order: 1 → 2 → (3, 4 independent) → 5 → 6 → 7 → 8 → 9.

---

### Task 1: The arenas — data, `parseArena`, `buildArena` walls and the invariants

**Files:**
- Modify: `renderer/data/pvp-arenas.js` (whole file), `renderer/systems/map.js` (`buildArena`, after the columns loop), `renderer/pvp/sim.js` (`arenaMap` + one import)
- Create: `test/pvp-arenas.test.js`
- Delete: `test/pvp-arena.test.js` (its checks move into the new file, generalised to every arena)
- Test: `test/pvp-arenas.test.js`, `test/arena.test.js`

**Interfaces:**
- Produces:
  - `parseArena(id: string, rows: string[], theme: object) → { id, size: { w, h }, columns: {x,y}[], walls: {x,y}[], spawns: {x,y}[], pickups: { kind: 'flask'|'quiver'|'rune', x, y }[], theme }`; throws on ragged rows, a non-wall border cell or an unknown character;
  - `PVP_ARENAS.{pillars,glade,tunnels,ruins}`, each with `id`, `size`, `columns`, `walls`, `spawns`, `pickups`, `theme`;
  - `ARENA_ROWS: { glade, tunnels, ruins }` (the raw grids);
  - `PVP_ARENA_ORDER = ['pillars', 'glade', 'tunnels', 'ruins']`;
  - `arenaAt(i) → arena` (wrapping), `nextArenaIndex(i) → (i + 1) % 4`;
  - `buildArena({ walls: {x,y}[] })`: interior cells become `TILE.WALL`, validated like `columns`;
  - `arenaMap(arena)`: the built tiles, sand for a sand theme.

- [ ] **Step 1: Write the failing tests**

Delete `test/pvp-arena.test.js` (`git rm test/pvp-arena.test.js`). Create `test/pvp-arenas.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PVP_ARENAS, PVP_ARENA_ORDER, ARENA_ROWS, parseArena, arenaAt, nextArenaIndex } from '../renderer/data/pvp-arenas.js'
import { DEPTH_THEMES } from '../renderer/data/levels.js'
import { KITS, CLASSES, RUNE_POWER, PVP } from '../renderer/data/pvp.js'
import { arenaMap } from '../renderer/pvp/sim.js'
import { isWalkable, TILE } from '../renderer/systems/entities.js'

const tiles = d => Math.hypot(d.a.x - d.b.x, d.a.y - d.b.y)
const pairs = list => list.flatMap((a, i) => list.slice(i + 1).map(b => ({ a, b })))

describe('parseArena', () => {
  it('turns a grid into the arena shape: interior # walls, o columns, S spawns, F/Q/R pickups in reading order', () => {
    const a = parseArena('t', [
      '#######',
      '#S.o.F#',
      '#.#R#.#',
      '#Q...S#',
      '#######',
    ], { floorTile: 'floor' })
    assert.equal(a.id, 't')
    assert.deepEqual(a.size, { w: 7, h: 5 })
    assert.deepEqual(a.columns, [{ x: 3, y: 1 }])
    assert.deepEqual(a.walls, [{ x: 2, y: 2 }, { x: 4, y: 2 }])
    assert.deepEqual(a.spawns, [{ x: 1, y: 1 }, { x: 5, y: 3 }])
    assert.deepEqual(a.pickups, [{ kind: 'flask', x: 5, y: 1 }, { kind: 'rune', x: 3, y: 2 }, { kind: 'quiver', x: 1, y: 3 }])
    assert.deepEqual(a.theme, { floorTile: 'floor' })
  })
  it('refuses ragged rows, an open border and an unknown cell', () => {
    assert.throws(() => parseArena('t', ['###', '#.', '###']), /equal-length/)
    assert.throws(() => parseArena('t', ['###', '..#', '###']), /border/)
    assert.throws(() => parseArena('t', ['###', '#x#', '###']), /unknown cell/)
  })
})

describe('the rotation', () => {
  it('is pillars, glade, tunnels, ruins, and wraps', () => {
    assert.deepEqual(PVP_ARENA_ORDER, ['pillars', 'glade', 'tunnels', 'ruins'])
    assert.deepEqual([0, 1, 2, 3].map(nextArenaIndex), [1, 2, 3, 0])
    assert.deepEqual([0, 1, 2, 3, 4].map(i => arenaAt(i).id), ['pillars', 'glade', 'tunnels', 'ruins', 'pillars'])
  })
  it('every arena carries its own id and a theme in the DEPTH_THEMES shape', () => {
    for (const id of PVP_ARENA_ORDER) {
      const { theme } = PVP_ARENAS[id]
      assert.equal(PVP_ARENAS[id].id, id)
      assert.equal(typeof theme.bgColor, 'string', id)
      assert.equal(typeof theme.fogAlpha, 'number', id)
      assert.ok(['floor', 'sand'].includes(theme.floorTile), id)
    }
  })
  it("pillars keeps today's depth-0 look", () => {
    const d0 = DEPTH_THEMES.find(t => t.depths.includes(0))
    const { theme } = PVP_ARENAS.pillars
    for (const k of ['floorTile', 'bgColor', 'tint', 'fogAlpha']) assert.equal(theme[k], d0[k], k)
    assert.equal(theme.ruleset, d0.ruleset)
  })
  it('the themes: glade outdoors, tunnels catacombs with the depth-4 tint and fog, ruins the depth-3 sand', () => {
    const d = n => DEPTH_THEMES.find(t => t.depths.includes(n))
    assert.equal(PVP_ARENAS.glade.theme.ruleset, 'outdoors')
    assert.equal(PVP_ARENAS.tunnels.theme.ruleset, 'catacombs')
    assert.equal(PVP_ARENAS.tunnels.theme.tint, d(4).tint)
    assert.equal(PVP_ARENAS.tunnels.theme.fogAlpha, 0.80)
    assert.equal(PVP_ARENAS.ruins.theme.floorTile, 'sand')
    assert.equal(PVP_ARENAS.ruins.theme.tint, d(3).tint)
  })
})

for (const id of PVP_ARENA_ORDER) {
  const arena = PVP_ARENAS[id]
  const map = arenaMap(arena)
  const walk = ({ x, y }) => isWalkable(map[y]?.[x]?.tile, map[y]?.[x])
  describe(`arena invariants: ${id}`, () => {
    it("fits buildArena's size clamp (8-40 × 8-30) and builds at that size", () => {
      assert.ok(arena.size.w >= 8 && arena.size.w <= 40, `w ${arena.size.w}`)
      assert.ok(arena.size.h >= 8 && arena.size.h <= 30, `h ${arena.size.h}`)
      assert.equal(map.length, arena.size.h)
      assert.equal(map[0].length, arena.size.w)
    })
    it('is rectangular with an all-wall border', () => {
      const rows = ARENA_ROWS[id]
      if (rows) for (const r of rows) assert.equal(r.length, arena.size.w)
      for (let x = 0; x < arena.size.w; x++) {
        assert.equal(map[0][x].tile, TILE.WALL); assert.equal(map[arena.size.h - 1][x].tile, TILE.WALL)
      }
      for (let y = 0; y < arena.size.h; y++) {
        assert.equal(map[y][0].tile, TILE.WALL); assert.equal(map[y][arena.size.w - 1].tile, TILE.WALL)
      }
    })
    if (ARENA_ROWS[id]) it('builds tile for tile what the grid says', () => {
      ARENA_ROWS[id].forEach((row, y) => [...row].forEach((ch, x) => {
        const want = ch === '#' ? TILE.WALL : ch === 'o' ? TILE.COLUMN : arena.theme.floorTile === 'sand' ? TILE.SAND : TILE.FLOOR
        assert.equal(map[y][x].tile, want, `${ch} at ${x},${y}`)
      }))
    })
    it('has exactly 6 spawns, 2 flasks, 2 quivers and 1 rune, all on walkable cells', () => {
      const n = k => arena.pickups.filter(p => p.kind === k).length
      assert.equal(arena.spawns.length, 6)
      assert.deepEqual([n('flask'), n('quiver'), n('rune')], [2, 2, 1])
      assert.equal(arena.pickups.length, 5)
      for (const c of [...arena.spawns, ...arena.pickups]) assert.ok(walk(c), `${c.kind ?? 'spawn'} ${c.x},${c.y}`)
    })
    it('every spawn and pickup is reachable from spawn 1', () => {
      const start = arena.spawns[0]
      const seen = new Set([`${start.x},${start.y}`])
      const queue = [start]
      for (let i = 0; i < queue.length; i++) {
        const c = queue[i]
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = { x: c.x + dx, y: c.y + dy }, k = `${n.x},${n.y}`
          if (!seen.has(k) && walk(n)) { seen.add(k); queue.push(n) }
        }
      }
      for (const c of [...arena.spawns, ...arena.pickups]) assert.ok(seen.has(`${c.x},${c.y}`), `${c.x},${c.y} unreachable`)
    })
    it('spawns are at least 6 tiles apart', () => {
      for (const d of pairs(arena.spawns)) assert.ok(tiles(d) >= 6, `${JSON.stringify(d)} ${tiles(d)}`)
    })
    it('the rune is at least 5 tiles from every spawn', () => {
      const rune = arena.pickups.find(p => p.kind === 'rune')
      for (const s of arena.spawns) assert.ok(tiles({ a: s, b: rune }) >= 5, `spawn ${s.x},${s.y}`)
    })
  })
}

describe('pvp data', () => {
  it('has a kit and a rune power for every class', () => {
    assert.deepEqual(CLASSES, ['warrior', 'archer', 'mage'])
    for (const c of CLASSES) { assert.ok(KITS[c]); assert.ok(RUNE_POWER[c]) }
  })
  it('matches the spec numbers', () => {
    assert.equal(PVP.matchLength, 240)
    assert.equal(PVP.ccMul, 0.5)
    assert.equal(PVP.creditWindow, 5)
  })
})
```

In `test/arena.test.js`, insert this block right before `describe('buildArena — enemy hp override', () => {`:

```js
describe('buildArena — interior walls', () => {
  it('places WALL tiles, keeps spawns and chests off them, and warn-skips bad entries', () => {
    const warns = []
    const { map, entitySpawns } = buildArena({
      size: { w: 12, h: 10 },
      walls: [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 11, y: 4 }, { x: 6, y: 8 }, null],
      enemies: [{ kind: 'guard', x: 3, y: 3 }],                  // on a wall -> skipped
      chests: Array.from({ length: 30 }, () => ({ kind: 'potion' })),
      player: { x: 6, y: 8 },                                    // a wall there -> that wall skipped
    }, w => warns.push(w))
    assert.equal(map[3][3].tile, TILE.WALL)
    assert.equal(map[3][4].tile, TILE.WALL)
    assert.equal(map[8][6].tile, TILE.FLOOR, 'player spawn cell protected')
    assert.equal(map[4][11].tile, TILE.WALL, 'the border is a wall anyway')
    for (const s of entitySpawns) assert.notEqual(map[s.y][s.x].tile, TILE.WALL, `${s.kind} at ${s.x},${s.y}`)
    assert.ok(!entitySpawns.some(s => s.kind === 'guard'), 'enemy overlapping a wall is skipped')
    assert.ok(warns.some(w => w.includes('wall at (11,4) out of bounds')))
    assert.ok(warns.some(w => w.includes('wall at (6,8) overlaps player spawn')))
    assert.ok(warns.some(w => w.includes('wall at (undefined,undefined) invalid')))
  })
  it('no walls configured: the arena is unchanged', () => {
    const a = buildArena({ size: { w: 12, h: 10 }, enemies: [] }, () => {}).map
    const b = buildArena({ size: { w: 12, h: 10 }, walls: [], enemies: [] }, () => {}).map
    assert.deepEqual(a.map(r => r.map(c => c.tile)), b.map(r => r.map(c => c.tile)))
  })
})

```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/pvp-arenas.test.js test/arena.test.js`
Expected: FAIL. `parseArena`, `ARENA_ROWS`, `PVP_ARENA_ORDER`, `arenaAt` and `nextArenaIndex` are not exported (a SyntaxError on import fails the whole new file), and the wall test finds `TILE.FLOOR` at (3,3).

- [ ] **Step 3: Implement**

Replace the whole of `renderer/data/pvp-arenas.js` with:

```js
// Hand-authored PvP arenas (4b spec §1). buildArena makes the walled room,
// its `columns` and interior `walls`; the sim reads `spawns` and `pickups`
// itself; the client decorates the map with the arena's `theme` (the shape
// of a DEPTH_THEMES entry). Matches rotate through PVP_ARENA_ORDER.
const rect = (x, y, w, h) => {
  const cells = []
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.push({ x: x + dx, y: y + dy })
  return cells
}

// Today's depth-0 look (DEPTH_THEMES' depths [0, 5] entry): no ruleset.
const PILLARS_THEME = { floorTile: 'floor', bgColor: '#0a0406', tint: 'rgba(60,10,0,0.35)', fogAlpha: 0.80 }

const PICKUP_KIND = { F: 'flask', Q: 'quiver', R: 'rune' }

// A grid of equal-length strings → the arena shape. Legend: # wall (the
// border must be walls), o column, . floor, S spawn, F flask, Q quiver,
// R rune. Spawns and pickups are listed in reading order.
export function parseArena(id, rows, theme) {
  const h = rows.length, w = rows[0]?.length ?? 0
  if (!h || rows.some(r => r.length !== w)) throw new Error(`arena ${id}: rows must be equal-length strings`)
  const columns = [], walls = [], spawns = [], pickups = []
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
    if (ch === '#') { if (!edge) walls.push({ x, y }); return }
    if (edge) throw new Error(`arena ${id}: border cell ${x},${y} must be a wall`)
    if (ch === 'o') columns.push({ x, y })
    else if (ch === 'S') spawns.push({ x, y })
    else if (PICKUP_KIND[ch]) pickups.push({ kind: PICKUP_KIND[ch], x, y })
    else if (ch !== '.') throw new Error(`arena ${id}: unknown cell '${ch}' at ${x},${y}`)
  }))
  return { id, size: { w, h }, columns, walls, spawns, pickups, theme }
}

// Glade (30×22): two broken rings of trees around the rune and thickets
// by the walls — short sightlines, melee-friendly.
const GLADE = [
  '##############################',
  '#.............##.............#',
  '#.S...........##...........S.#',
  '#...##..................##...#',
  '#...##..oooo......oooo..##...#',
  '#.............F..............#',
  '#.....o................o.....#',
  '#.....o....ooo..ooo....o.....#',
  '#.....o....o......o....o..Q..#',
  '#............................#',
  '#.##....S.....R...........##.#',
  '#.##.................S....##.#',
  '#.....o....o......o....o.....#',
  '#..Q..o....ooo..ooo....o.....#',
  '#.....o................o.....#',
  '#..............F.............#',
  '#.......oooo......oooo.......#',
  '#...##..................##...#',
  '#...##..................##...#',
  '#.S...........##...........S.#',
  '#.............##.............#',
  '##############################',
]
// Tunnels (34×24): six small chambers in solid rock, joined by corridors two
// tiles wide, and a hall with the rune in the middle — chokepoints and blink.
const TUNNELS = [
  '##################################',
  '##################################',
  '##S.....######.....S######......##',
  '##...o..######...o..######.....S##',
  '##..........................o...##',
  '##..............................##',
  '##.....Q######......######......##',
  '##......######......######......##',
  '####..##########..##########..####',
  '####..##########..##########..####',
  '####..#######........#######..####',
  '####............R............F####',
  '####F.........................####',
  '####..#######........#######..####',
  '####..##########..##########..####',
  '####..##########..##########..####',
  '##......######......######......##',
  '##......######......######Q.....##',
  '##..............................##',
  '##..o...........................##',
  '##S.....######..o...######...o..##',
  '##......######S.....######.....S##',
  '##################################',
  '##################################',
]
// Ruins (36×26): open sand with scattered columns and a few broken walls;
// long clear lanes on rows 5-7, 12-13 and 18-20 — archer-friendly.
const RUINS = [
  '####################################',
  '#..................................#',
  '#.S..............................S.#',
  '#.....o..........o......o..........#',
  '#...........o................o.....#',
  '#..................................#',
  '#................Q.................#',
  '#..................................#',
  '#........###............###........#',
  '#...o..........o....o..........o...#',
  '#.........o.....#........o.........#',
  '#...............#..................#',
  '#.................R..............S.#',
  '#.S......F................F........#',
  '#..................#...............#',
  '#..................#...............#',
  '#......o.....o........o.....o......#',
  '#........###............###........#',
  '#..................................#',
  '#.................Q................#',
  '#..................................#',
  '#..........o...................o...#',
  '#...o.............o.....o..........#',
  '#.S..............................S.#',
  '#..................................#',
  '####################################',
]

// The grids as written, for the invariant tests.
export const ARENA_ROWS = { glade: GLADE, tunnels: TUNNELS, ruins: RUINS }

export const PVP_ARENAS = {
  // Four corner pillars, wall segments on each side for cover, four posts
  // ringing the exposed centre where the rune sits. 32×24 tiles: interior
  // x 1..30, y 1..22.
  pillars: {
    id: 'pillars',
    size: { w: 32, h: 24 },
    columns: [
      ...rect(6, 5, 2, 2), ...rect(24, 5, 2, 2), ...rect(6, 17, 2, 2), ...rect(24, 17, 2, 2),
      ...rect(13, 4, 6, 1), ...rect(13, 19, 6, 1),
      ...rect(4, 9, 1, 6), ...rect(27, 9, 1, 6),
      ...rect(11, 9, 2, 1), ...rect(19, 9, 2, 1), ...rect(11, 14, 2, 1), ...rect(19, 14, 2, 1),
      ...rect(9, 11, 1, 2), ...rect(22, 11, 1, 2),
    ],
    walls: [],
    spawns: [{ x: 2, y: 2 }, { x: 29, y: 2 }, { x: 2, y: 21 }, { x: 29, y: 21 }, { x: 15, y: 2 }, { x: 16, y: 21 }],
    pickups: [
      { kind: 'flask', x: 7, y: 12 }, { kind: 'flask', x: 24, y: 11 },
      { kind: 'quiver', x: 15, y: 6 }, { kind: 'quiver', x: 16, y: 17 },
      { kind: 'rune', x: 16, y: 12 },
    ],
    theme: PILLARS_THEME,
  },
  glade: parseArena('glade', GLADE, { ruleset: 'outdoors', floorTile: 'floor', bgColor: '#0a1208', tint: null, fogAlpha: 0.65 }),
  tunnels: parseArena('tunnels', TUNNELS, { ruleset: 'catacombs', floorTile: 'floor', bgColor: '#07070f', tint: 'rgba(0,0,20,0.35)', fogAlpha: 0.80 }),
  ruins: parseArena('ruins', RUINS, { floorTile: 'sand', bgColor: '#1a1206', tint: 'rgba(40,20,0,0.2)', fogAlpha: 0.65 }),
}

export const PVP_ARENA_ORDER = ['pillars', 'glade', 'tunnels', 'ruins']

// The rotation: the arena at a (wrapping) index, and the index after it.
const N_ARENAS = PVP_ARENA_ORDER.length
export const arenaAt = i => PVP_ARENAS[PVP_ARENA_ORDER[((i % N_ARENAS) + N_ARENAS) % N_ARENAS]]
export const nextArenaIndex = i => (i + 1) % N_ARENAS
```

In `renderer/systems/map.js`, in `buildArena`, directly after the columns loop — i.e. after

```js
    map[y][x].tile = TILE.COLUMN
    columnCells.add(`${x},${y}`)
  }
```

insert:

```js

  // Interior walls: config.walls = [{x, y}, ...] become WALL tiles (a PvP
  // arena's interior `#` cells). Validated like columns; tracked with them,
  // so nothing is ever placed on one.
  for (const c of (Array.isArray(config.walls) ? config.walls : [])) {
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) { warn(`arena: wall at (${c?.x},${c?.y}) invalid — skipped`); continue }
    const x = Math.round(c.x), y = Math.round(c.y)
    if (x < 1 || x > width - 2 || y < 1 || y > height - 2) { warn(`arena: wall at (${x},${y}) out of bounds — skipped`); continue }
    if (x === playerSpawn.x && y === playerSpawn.y) { warn(`arena: wall at (${x},${y}) overlaps player spawn — skipped`); continue }
    map[y][x].tile = TILE.WALL
    columnCells.add(`${x},${y}`)
  }
```

In `renderer/pvp/sim.js`:
- After `import { buildArena } from '../systems/map.js'` add `import { TILE } from '../systems/entities.js'`.
- Replace `arenaMap`:

```js
// The arena's tiles. The player spawn is pinned to the first hero spawn, a
// floor cell, so buildArena never skips a column or wall for standing on its
// default spawn; a sand-floored theme swaps FLOOR for SAND (still walkable),
// as generateLevel does for the sand depth.
export function arenaMap(arena = PVP_ARENAS.pillars) {
  const { map } = buildArena({ size: arena.size, columns: arena.columns, walls: arena.walls, player: arena.spawns[0],
    enemies: [], chests: [] }, () => {})
  if (arena.theme?.floorTile === 'sand')
    for (const row of map) for (const c of row) if (c.tile === TILE.FLOOR) c.tile = TILE.SAND
  return map
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/pvp-arenas.test.js test/arena.test.js test/net-sim.test.js test/pvp-*.test.js`
Expected: PASS (every arena passes every invariant; `arenaMap` still equals the map `makeMatch` builds).

- [ ] **Step 5: Commit**

```bash
git add renderer/data/pvp-arenas.js renderer/systems/map.js renderer/pvp/sim.js test/pvp-arenas.test.js test/arena.test.js   # the git rm in Step 1 already staged the deletion
git commit -m "feat(pvp): glade, tunnels and ruins arenas — grid format, themes, buildArena walls, invariant tests

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 2: The rotation and the arena on the wire (protocol v3)

**Files:**
- Modify: `server/rooms.js`, `server/pvp-server.js` (the welcome), `renderer/pvp/local.js`, `renderer/net/protocol.js` (header, `snapshotBody`), `renderer/data/net.js` (header, `protocolVersion`), `renderer/net/client.js`, `renderer/game.js`
- Test: `test/net-rooms.test.js`, `test/pvp-ui.test.js`, `test/net-client.test.js`, `test/net-protocol.test.js`, `test/net-sim.test.js`, `test/net-play.test.js`, `test/net-public.test.js`

**Interfaces:**
- Consumes: `arenaAt`, `nextArenaIndex`, `PVP_ARENAS` (Task 1), `arenaMap(arena)` (Task 1).
- Produces:
  - `NET.protocolVersion === 3`;
  - `room.arenaIndex` (starts 0; `startNextMatch` advances it before building);
  - `makeLocalMatch({ cls, bots?, sfx?, arenaIndex = 0 })` plays `arenaAt(arenaIndex)`;
  - `snapshotBody(match).arena === match.arena.id`; `welcome.arena === room.match.arena.id`;
  - client session fields `s.arena` (id) and `s.map` (a new object whenever the arena changes; `s.pred.map` follows); an unknown arena → `s.status === 'error'`, `s.error === 'version'`, an `{ type: 'error', code: 'version' }` event;
  - `game.js`: `net.map` (the session map last decorated), `pvp.arenaIndex`.

- [ ] **Step 1: Write the failing tests**

`test/net-rooms.test.js` — insert before `describe('cost', () => {`:

```js
describe('arena rotation', () => {
  const nextMatch = (lobby, room) => { const m = room.match; const out = []; while (room.match === m) { const b = stepRoom(lobby, room); if (b) out.push(b) } return out }
  it('a room starts on pillars and each new match takes the next arena, wrapping', () => {
    const lobby = makeLobby({ matchLength: 1, resultsDelay: 0.5 })
    const { room } = createRoom(lobby, who('A', 'warrior'))
    joinRoom(lobby, room.code, who('B', 'archer'))
    const ids = [room.match.arena.id]
    for (let i = 0; i < 4; i++) { nextMatch(lobby, room); ids.push(room.match.arena.id) }
    assert.deepEqual(ids, ['pillars', 'glade', 'tunnels', 'ruins', 'pillars'])
    assert.equal(room.arenaIndex, 0)
  })
  it("the new match puts every hero on the new arena's spawns and its snapshots name it", () => {
    const lobby = makeLobby({ matchLength: 1, resultsDelay: 0.5 })
    const { room } = createRoom(lobby, who('A', 'warrior'))
    joinRoom(lobby, room.code, who('B', 'archer'))
    nextMatch(lobby, room)
    const { arena } = room.match
    assert.equal(arena.id, 'glade')
    for (const h of room.match.heroes) assert.ok(arena.spawns.some(s => s.x === h.x && s.y === h.y), `${h.id} at ${h.x},${h.y}`)
    assert.equal(room.match.map[0].length, arena.size.w)
    const body = steps(lobby, room, 3).at(-1)
    assert.equal(body.arena, 'glade')
  })
})

```

`test/pvp-ui.test.js`:
- After `import { PVP } from '../renderer/data/pvp.js'` add `import { nextArenaIndex } from '../renderer/data/pvp-arenas.js'`.
- Insert before `  it('clamps the bot count to 1-5', () => {`:

```js
  it('plays the arena at arenaIndex in the rotation, pillars by default; "Next match" steps it', () => {
    assert.equal(makeLocalMatch({ cls: 'mage' }).arena.id, 'pillars')
    const ids = []
    for (let i = 0, k = 0; k < 5; k++, i = nextArenaIndex(i)) ids.push(makeLocalMatch({ cls: 'mage', arenaIndex: i }).arena.id)
    assert.deepEqual(ids, ['pillars', 'glade', 'tunnels', 'ruins', 'pillars'])
    const m = makeLocalMatch({ cls: 'mage', arenaIndex: 3 })
    assert.equal(m.map[0].length, m.arena.size.w)
    for (const h of m.heroes) assert.ok(m.arena.spawns.some(s => s.x === h.x && s.y === h.y), h.id)
  })
```

`test/net-client.test.js`:
- After `import { NET } from '../renderer/data/net.js'` add `import { PVP_ARENAS } from '../renderer/data/pvp-arenas.js'`.
- Replace the `welcome` helper and the first line of `snapBody`:

```js
const welcome = (s, over = {}) => s.ws.onmessage({ data: JSON.stringify({ type: 'welcome', room: 'ABCD', heroId: 'p1', arena: 'pillars', ...over }) })
```

```js
  type: 'snap', arena: 'pillars', tick: 0, clock: 0, waiting: false, ended: false, matchLength: 240,
```

- Append:

```js

describe('the arena on the wire (protocol v3)', () => {
  it("welcome builds the named arena's map", () => {
    const s = open()
    welcome(s, { arena: 'glade' })
    assert.equal(s.status, 'open')
    assert.equal(s.arena, 'glade')
    assert.equal(s.map.length, PVP_ARENAS.glade.size.h)
    assert.equal(s.map[0].length, PVP_ARENAS.glade.size.w)
  })
  it('a snapshot naming another arena rebuilds the map, and the predictor walks on the new one', () => {
    const s = open()
    welcome(s)
    const hero = lone()
    s.ws.onmessage({ data: JSON.stringify(snapBody(hero, { tick: 0 })) })
    const first = s.map
    s.ws.onmessage({ data: JSON.stringify(snapBody(hero, { tick: 1 })) })
    assert.equal(s.map, first, 'the same arena keeps its map object')
    s.ws.onmessage({ data: JSON.stringify(snapBody(hero, { tick: 2, arena: 'tunnels', events: [{ type: 'matchStart' }] })) })
    assert.notEqual(s.map, first)
    assert.equal(s.arena, 'tunnels')
    assert.equal(s.map[0].length, PVP_ARENAS.tunnels.size.w)
    assert.equal(s.pred.map, s.map)
  })
  it('an arena this build does not know is a version refusal', () => {
    for (const arena of ['volcano', 'toString', undefined]) {
      const s = open()
      welcome(s)
      s.ws.onmessage({ data: JSON.stringify(snapBody(lone(), { tick: 0, arena })) })
      assert.equal(s.status, 'error', String(arena))
      assert.equal(s.error, 'version')
      assert.ok(drainEvents(s).some(e => e.type === 'error' && e.code === 'version'))
      assert.equal(s.pred, null, 'the refused snapshot is not applied')
    }
  })
  it('an unknown arena in the welcome refuses before the session opens', () => {
    const s = open()
    welcome(s, { arena: 'volcano' })
    assert.equal(s.status, 'error')
    assert.equal(s.heroId, null)
  })
})
```

`test/net-play.test.js`: in the "one-frame press" test, change the fake welcome to

```js
    a.ws.onmessage({ data: JSON.stringify({ type: 'welcome', room: 'ABCD', heroId: 1, arena: 'pillars' }) })
```

`test/net-protocol.test.js`:
- In the `hello v2` test, delete the line `    assert.equal(NET.protocolVersion, 2)`.
- In `snapshotBody is plain JSON…`, before the `for (const k of ['tick', 'clock', …` line add `    assert.equal(body.arena, 'pillars')`.

`test/net-sim.test.js`: change `assert.equal(NET.protocolVersion, 2)` to `assert.equal(NET.protocolVersion, 3)`.

`test/net-public.test.js` — append:

```js

describe('arena rotation over sockets', async () => {
  const srv = await startServer({ matchLength: 1, resultsDelay: 0.3 })
  after(() => srv.close())

  it('welcome names the arena; after matchStart the snapshots name the next one', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ quick: true }))
    assert.equal((await a.next('welcome')).arena, 'pillars')
    assert.equal((await a.next('snap')).arena, 'pillars')
    const glade = await waitFor(() => a.messages.find(m => m.type === 'snap' && m.arena === 'glade'), 4000)
    const started = a.messages.filter(m => m.type === 'snap' && m.tick <= glade.tick).flatMap(m => m.events)
    assert.ok(started.some(e => e.type === 'matchStart'), 'the arena changed at a matchStart')
    a.ws.close()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/net-rooms.test.js test/pvp-ui.test.js test/net-client.test.js test/net-protocol.test.js test/net-sim.test.js test/net-public.test.js`
Expected: FAIL. Rooms stay on pillars, `makeLocalMatch` ignores `arenaIndex`, snapshots and welcomes carry no `arena`, the client ignores it, and the version is 2.

- [ ] **Step 3: Implement**

`renderer/data/net.js`:
- Header line 1 becomes `// Every netcode number (specs …-pvp-server-netcode-design.md, …-pvp-public-launch-design.md and` followed by a new line `// …-pvp-4b-arenas-reconnect-design.md).`
- `protocolVersion: 2,` → `protocolVersion: 3,`.

`renderer/net/protocol.js`:
- Header line 1 becomes the two lines:

```js
// PvP protocol v3 (v1 in 2026-09-25-pvp-server-netcode-design.md §1; v2 adds hello.quick, 4a spec §1;
// v3 adds the arena id on welcome and snap, seat tokens, hello.resume and bye, 4b spec §1-§2): message
```

- In `snapshotBody`, `type: MSG.SNAP, tick: match.tick, clock: match.clock,` → `type: MSG.SNAP, arena: match.arena.id, tick: match.tick, clock: match.clock,`.

`server/rooms.js`:
- After `import { NET } from '../renderer/data/net.js'` add `import { arenaAt, nextArenaIndex } from '../renderer/data/pvp-arenas.js'`.
- `newMatch` becomes:

```js
// Each match is played on the room's current arena (4b spec §1).
function newMatch(lobby, room, roster) {
  const match = makeMatch({ roster, arena: arenaAt(room.arenaIndex), sfx: makeSfx(false), matchLength: lobby.opts.matchLength })
```

  (the rest of the function is unchanged).
- In `createRoom`'s room literal, `pendingEvents: [], pendingCues: [], nextMatchAt: null, aloneSince: null }` → `pendingEvents: [], pendingCues: [], nextMatchAt: null, aloneSince: null, arenaIndex: 0 }`.
- In `startNextMatch`, between the `const roster = …` line and `room.match = newMatch(lobby, room, roster)`, add `  room.arenaIndex = nextArenaIndex(room.arenaIndex)`.

`server/pvp-server.js` — the welcome send becomes:

```js
          send(ws, { type: MSG.WELCOME, v: NET.protocolVersion, room: room.code, heroId, tick: room.match.tick, arena: room.match.arena.id })
```

`renderer/pvp/local.js`:
- After `import { PVP, CLASSES } from '../data/pvp.js'` add `import { arenaAt } from '../data/pvp-arenas.js'`.
- Replace the `makeLocalMatch` signature line with:

```js
// arenaIndex: where in PVP_ARENA_ORDER this match is played; game.js's
// "Next match" passes nextArenaIndex of the last one.
export function makeLocalMatch({ cls, bots = PVP.localBots, sfx = null, arenaIndex = 0 }) {
```

- Its last line `  return makeMatch({ roster, sfx })` → `  return makeMatch({ roster, sfx, arena: arenaAt(arenaIndex) })`.

`renderer/net/client.js`:
- `import { MSG, encode, decode, hydrateHero, heroSnap } from './protocol.js'` → `import { MSG, ERR, encode, decode, hydrateHero, heroSnap } from './protocol.js'`.
- After `import { arenaMap } from '../pvp/sim.js'` add `import { PVP_ARENAS } from '../data/pvp-arenas.js'`.
- In `connect`'s session literal, `heroId: null, map: arenaMap(), now,` → `heroId: null, arena: 'pillars', map: arenaMap(), now,`.
- Insert before `function onMessage(s, msg, t) {`:

```js
// The arena a welcome or snapshot names (protocol v3). A new one gets a new
// map object — which also drops the renderer's tile-chunk cache and makes
// game.js decorate it — and the predictor walks on it from then on. An id
// this build does not know means the server is newer: the same refusal as a
// version mismatch.
function setArena(s, id) {
  if (typeof id !== 'string' || !Object.hasOwn(PVP_ARENAS, id)) {
    s.status = 'error'; s.error = ERR.VERSION
    pushEvent(s, { type: 'error', code: ERR.VERSION })
    s.ws.close()
    return false
  }
  if (id !== s.arena) {
    s.arena = id
    s.map = arenaMap(PVP_ARENAS[id])
    if (s.pred) s.pred.map = s.map
  }
  return true
}

```

- In `onMessage`, replace

```js
  if (!msg) return
  if (msg.type === MSG.WELCOME) {
    s.status = 'open'; s.room = msg.room; s.heroId = msg.heroId
```

  with

```js
  // After a refusal nothing more is read: the socket is closing.
  if (!msg || s.status === 'error') return
  if (msg.type === MSG.WELCOME) {
    if (!setArena(s, msg.arena)) return
    s.status = 'open'; s.room = msg.room; s.heroId = msg.heroId
```

- `onSnap`'s first line becomes two:

```js
function onSnap(s, snap, t) {
  if (!setArena(s, snap.arena)) return
  pushSnap(s.interp, snap, t)
```

`renderer/game.js`:
- After `import { makeNetPanels } from './ui/net-panels.js'` add `import { PVP_ARENAS, nextArenaIndex } from './data/pvp-arenas.js'`.
- Replace the head of `startPvp`:

```js
function startPvp(cls) {
  const theme = DEPTH_THEMES.find(t => t.depths.includes(0)) ?? DEPTH_THEMES[0]
  const match = makeLocalMatch({ cls, sfx: makeSfx(loadMutedPref()) })
  decorateMap(match.map, rulesets[theme.ruleset])
  pvp = { match, theme, cls, picking: false }
```

  with

```js
// arenaIndex: this match's place in PVP_ARENA_ORDER; "Next match" plays the
// one after it (4b spec §1).
function startPvp(cls, arenaIndex = 0) {
  const match = makeLocalMatch({ cls, sfx: makeSfx(loadMutedPref()), arenaIndex })
  const { theme } = match.arena
  decorateMap(match.map, rulesets[theme.ruleset])
  pvp = { match, theme, cls, arenaIndex, picking: false }
```

- In `pvpFrame`, `onNext: () => startPvp(pvp.cls)` → `onNext: () => startPvp(pvp.cls, nextArenaIndex(pvp.arenaIndex))`.
- In `startNet`, delete the line `  const theme = DEPTH_THEMES.find(t => t.depths.includes(0)) ?? DEPTH_THEMES[0]`, and replace

```js
  const s = connect({ url: netUrl(location), hello })
  decorateMap(s.map, rulesets[theme.ruleset])
  net = { s, theme, muted: loadMutedPref(), kind, panels: makeNetPanels(netPanelUi(s)) }
```

  with

```js
  const s = connect({ url: netUrl(location), hello })
  // net.map: the session map last decorated; netFrame decorates each new one.
  net = { s, theme: PVP_ARENAS.pillars.theme, map: null, muted: loadMutedPref(), kind, panels: makeNetPanels(netPanelUi(s)) }
```

- In `netFrame`, replace

```js
  panels.sync({ ended: v.ended, dead: v.me.dead })
  const view = netViewOf(v, net.theme, s.map)
```

  with

```js
  panels.sync({ ended: v.ended, dead: v.me.dead })
  // The session builds a new map object whenever the arena changes (a
  // welcome, a matchStart); decorate it with that arena's theme once.
  if (net.map !== s.map) {
    net.map = s.map
    net.theme = PVP_ARENAS[s.arena].theme
    decorateMap(s.map, rulesets[net.theme.ruleset])
  }
  const view = netViewOf(v, net.theme, s.map)
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --check renderer/game.js && node --test test/net-*.test.js test/pvp-*.test.js test/arena.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/rooms.js server/pvp-server.js renderer/pvp/local.js renderer/net/protocol.js renderer/data/net.js renderer/net/client.js renderer/game.js test/net-rooms.test.js test/pvp-ui.test.js test/net-client.test.js test/net-protocol.test.js test/net-sim.test.js test/net-play.test.js test/net-public.test.js
git commit -m "feat(net): arena rotation online and local; protocol v3 names the arena, the client rebuilds and re-themes its map

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 3: The smoothed, monotonic interpolation clock

**Files:**
- Modify: `renderer/net/interp.js`, `renderer/data/net.js`
- Test: `test/net-interp.test.js`

**Interfaces:**
- Produces:
  - `NET.clockSlew === 0.1`, `NET.clockSnapTicks === 15`;
  - `makeInterp() → { snaps: [], clock: null, lastRt: null, snapped: false }` (the `lastArrival` field is gone; nothing outside `interp.js` reads it);
  - `buf.clock = { tick0, at0, adj, target, slewAt, lastTick }` — `estServerTick(buf, now) = min(tick0 + (now − at0) / tickMs + adj, newest.tick + extrapolateTicks + interpDelayTicks)`;
  - `renderTick(buf, now)` never returns less than its previous return, except on the first call after a snap.
- The signatures of `pushSnap`, `estServerTick`, `renderTick`, `sample`, `heroPoses`, `projectilesAt`, `newest` are unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `test/net-interp.test.js`:

```js

// A server stepping 30 ticks a second and sending a snapshot whenever its
// 20 Hz schedule says so (server/rooms.js stepRoom), over a link whose delay
// is `base` ms plus up to `jitter` ms, order kept (TCP stalls, never
// reorders). Returns [{ tick, at }] sorted by arrival.
function link({ seconds, base, jitter, seed = 7 }) {
  let s = seed
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const out = []
  let at = 0
  for (let tick = 1; tick <= seconds * 30; tick++) {
    const due = Math.floor(tick * NET.snapshotHz * PVP.tick) !== Math.floor((tick - 1) * NET.snapshotHz * PVP.tick)
    if (!due) continue
    at = Math.max(at, tick * tickMs + base + jitter * rnd())
    out.push({ tick, at })
  }
  return out
}

describe('the smoothed clock', () => {
  it('carries the spec numbers', () => {
    assert.equal(NET.clockSlew, 0.1)
    assert.equal(NET.clockSnapTicks, 15)
  })
  it('jittered arrivals: renderTick never goes back, and each 60 Hz frame advances it within ±10 % of the nominal rate once settled', () => {
    const buf = makeInterp()
    const arrivals = link({ seconds: 6, base: 80, jitter: 60 })
    const frameMs = 1000 / 60, nominal = frameMs / tickMs
    let next = 0, last = null, worst = 0
    for (let t = 0; t < 6000; t += frameMs) {
      while (next < arrivals.length && arrivals[next].at <= t) { pushSnap(buf, snap(arrivals[next].tick, 0), arrivals[next].at); next++ }
      if (!newest(buf)) continue
      const rt = renderTick(buf, t)
      if (last !== null) {
        assert.ok(rt >= last, `went back at ${t.toFixed(0)} ms: ${last} → ${rt}`)
        if (t > 1000) worst = Math.max(worst, Math.abs((rt - last) / nominal - 1))
      }
      last = rt
    }
    assert.ok(worst <= 0.1 + 1e-9, `worst frame off the nominal rate by ${(worst * 100).toFixed(1)} %`)
  })
  it('a 1 s stall snaps the clock, which may then step back', () => {
    const buf = makeInterp()
    for (let tick = 0; tick <= 60; tick++) pushSnap(buf, snap(tick, 0), tick * tickMs)
    const before = renderTick(buf, 60 * tickMs)
    assert.ok(Math.abs(before - 57) < 1e-6, `${before}`)
    const during = renderTick(buf, 61 * tickMs + 1000)          // nothing for a second: extrapolation cap
    assert.equal(during, 60 + NET.extrapolateTicks)
    pushSnap(buf, snap(61, 0), 61 * tickMs + 1000)               // tick 61 arrives a second late
    assert.equal(buf.clock.tick0, 61, 're-anchored')
    assert.equal(renderTick(buf, 61 * tickMs + 1000), 61 - NET.interpDelayTicks)
  })
  it('equal-tick snapshots (the results screen) leave the clock alone', () => {
    const buf = makeInterp()
    pushSnap(buf, snap(50, 5), 0)
    const clock = { ...buf.clock }
    let last = renderTick(buf, 0)
    for (let i = 1; i <= 40; i++) {
      pushSnap(buf, snap(50, 5), i * 50)
      const rt = renderTick(buf, i * 50)
      assert.ok(rt >= last)
      last = rt
    }
    assert.deepEqual({ ...buf.clock, slewAt: 0 }, { ...clock, slewAt: 0 })
  })
  it('a small error is walked off, not jumped: a snapshot 3 ticks early moves the clock by at most 10 % of the time since', () => {
    const buf = makeInterp()
    pushSnap(buf, snap(30, 0), 1000)
    pushSnap(buf, snap(36, 0), 1000 + 3 * tickMs)                // 3 ticks ahead of the clock
    const a = estServerTick(buf, 1000 + 3 * tickMs)
    const b = estServerTick(buf, 1000 + 8 * tickMs)              // 5 ticks later
    assert.ok(Math.abs(a - 33) < 1e-9, `${a}`)                  // no jump on arrival
    assert.ok(Math.abs(b - 38.5) < 1e-9, `${b}`)                // 5 ticks, plus 10 % of 5 caught up
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/net-interp.test.js`
Expected: FAIL: the NET numbers are undefined, the jittered `renderTick` goes back, there is no `buf.clock`, and the early snapshot jumps the estimate to 36.

- [ ] **Step 3: Implement**

`renderer/data/net.js` — after the `bufferTicks` line add:

```js
  clockSlew: 0.1,          // the interpolation clock runs at most 10 % fast or slow while it catches up (4b)…
  clockSnapTicks: 15,      // …and snaps when it is off by more than this (a stall, a hidden tab, a new match)
```

`renderer/net/interp.js` — replace everything from the top of the file down to and including the `renderTick` line (the header comment, the imports, `makeInterp`, `pushSnap`, `newest`, `estServerTick`, `renderTick`) with:

```js
// Snapshot interpolation for everything that is not your own hero (spec §2):
// drawn NET.interpDelayTicks behind the estimated server tick, lerped
// between the two snapshots around that moment; a dry buffer extrapolates
// briefly, then holds. The estimate runs on a smoothed, monotonic clock
// (4b spec §3), so jittery arrivals no longer drag other heroes backwards.
// Pure.
import { PVP } from '../data/pvp.js'
import { NET } from '../data/net.js'

const TICK_MS = PVP.tick * 1000

// clock: the estimate is tick0 + (now - at0) / TICK_MS + adj — the spec's
// `now / tickMs + offset`, with offset = tick0 - at0 / TICK_MS + adj, kept as
// an anchor so the first snapshot's estimate is exact. Each newer arrival
// sets `target`, the adj it says is right; slew() walks adj toward it by at
// most NET.clockSlew ticks per tick of local time, applied every call rather
// than as a step on arrival, so the drawn clock runs at most 10 % fast or
// slow on every frame. An error past NET.clockSnapTicks re-anchors instead.
// lastRt / snapped: renderTick never goes back, except right after a snap.
export function makeInterp() { return { snaps: [], clock: null, lastRt: null, snapped: false } }

function anchor(buf, tick, nowMs) {
  buf.clock = { tick0: tick, at0: nowMs, adj: 0, target: 0, slewAt: nowMs, lastTick: tick }
  buf.snapped = true
}

function slew(c, nowMs) {
  if (nowMs <= c.slewAt) return
  const max = NET.clockSlew * (nowMs - c.slewAt) / TICK_MS
  c.adj += Math.max(-max, Math.min(max, c.target - c.adj))
  c.slewAt = nowMs
}

function arrive(buf, tick, nowMs) {
  const c = buf.clock
  if (!c) { anchor(buf, tick, nowMs); return }
  // The results screen repeats one tick; it says nothing new about the clock.
  if (tick <= c.lastTick) return
  slew(c, nowMs)
  const target = tick - c.tick0 - (nowMs - c.at0) / TICK_MS
  // A stall, a hidden tab, the next match after the results: snap.
  if (Math.abs(target - c.adj) > NET.clockSnapTicks) { anchor(buf, tick, nowMs); return }
  c.target = target
  c.lastTick = tick
}

export function pushSnap(buf, snap, nowMs) {
  buf.snaps.push(snap)
  arrive(buf, snap.tick, nowMs)
  const oldest = snap.tick - NET.bufferTicks
  // A results screen freezes match.tick, so consecutive snapshots can share
  // one tick forever — the tick-age trim below never fires on its own, so a
  // raw count cap backs it up.
  while (buf.snaps.length > 2 && (buf.snaps[0].tick < oldest || buf.snaps.length > NET.bufferTicks + 2)) buf.snaps.shift()
}

export const newest = buf => buf.snaps.at(-1) ?? null

export function estServerTick(buf, nowMs) {
  const last = newest(buf)
  if (!last || !buf.clock) return 0
  const c = buf.clock
  slew(c, nowMs)
  const est = c.tick0 + (nowMs - c.at0) / TICK_MS + c.adj
  return Math.min(est, last.tick + NET.extrapolateTicks + NET.interpDelayTicks)
}

export function renderTick(buf, nowMs) {
  let rt = estServerTick(buf, nowMs) - NET.interpDelayTicks
  if (buf.lastRt !== null && !buf.snapped) rt = Math.max(rt, buf.lastRt)
  buf.snapped = false
  buf.lastRt = rt
  return rt
}
```

(`sample`, `previousOf`, `heroPoses` and `projectilesAt` below it are unchanged.)

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/net-interp.test.js test/net-client.test.js test/net-play.test.js`
Expected: PASS — the existing interpolation tests keep their meaning (the first snapshot's estimate is exact, the cap is unchanged).

- [ ] **Step 5: Commit**

```bash
git add renderer/net/interp.js renderer/data/net.js test/net-interp.test.js
git commit -m "feat(net): a smoothed, monotonic interpolation clock — 10 % slew, snap past 15 ticks

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 4: The 300 ms melee rewind

**Files:**
- Modify: `renderer/data/net.js`
- Test: `test/net-sim.test.js`, `test/net-rooms.test.js`, `test/net-play.test.js`

**Interfaces:**
- Produces: `NET.rewindMaxTicks === 9`, `NET.historyTicks === 11`. `rewoundPos` and the swing maths are unchanged.

- [ ] **Step 1: Write the failing tests**

`test/net-sim.test.js`, in `NET constants`: replace `assert.equal(NET.rewindMaxTicks, 6)` with

```js
    assert.equal(NET.rewindMaxTicks, 9)
    assert.equal(NET.historyTicks, 11)
```

`test/net-rooms.test.js`, in `describe('rewind')`:
- In the first test, change the comment `// too old: clamped to 6 ticks back → tick 4` to `// too old: clamped to 9 ticks back → tick 1` (the assertion is unchanged).
- Insert before `  it('makeLobby({ rewind: false }) installs no hitPos', () => {`:

```js
  it('the cap is 9 ticks (300 ms): a view 11 ticks old is tested 9 ticks back, not 6', () => {
    const { lobby, room, w, a } = duel()
    placeHero(a, { x: 10, y: 7 })
    steps(lobby, room, 5)                                   // history ticks 1..5 at x=10
    placeHero(a, { x: 14, y: 7 })
    steps(lobby, room, 8)                                   // ticks 6..13 at x=14
    room.match.tick += 1                                    // inside tick 14
    w.viewTick = 3                                          // 11 ticks behind → capped at 9 → tick 5
    assert.equal(rewoundPos(room, a, w).px, 10 * 32 + 16)
    w.viewTick = 6                                          // 8 ticks behind → tick 6
    assert.equal(rewoundPos(room, a, w).px, 14 * 32 + 16)
    assert.equal(room.history.get(a.id).length, NET.historyTicks)
    room.match.tick -= 1
  })
```

`test/net-play.test.js` — the lag pair becomes a trio. Replace

```js
  for (const rewind of [true, false]) {
    it(`melee under 100 ms lag ${rewind ? 'hits with rewind' : 'misses without rewind'}`, async () => {
      const srv = await startServer({ rewind })
      const W = laggy({ up: 100, down: 100 })
```

with

```js
  for (const [lag, rewind] of [[100, true], [100, false], [150, true]]) {
    it(`melee under ${lag} ms lag ${rewind ? 'hits with rewind' : 'misses without rewind'}`, async () => {
      const srv = await startServer({ rewind })
      const W = laggy({ up: lag, down: lag })
```

and its comment block (`// A swings the moment it sees B step just out of point-blank …` through `… 36 leaves one tick of slack under the reach.`) with:

```js
      // A swings the moment it sees B step just out of point-blank (36 px,
      // within the sword's 58 px centre reach). At 100 ms each way A's view
      // is ~10 ticks old, inside the 9-tick rewind cap but for a tick, so the
      // server tests B ~4 px beyond where A saw it: ~40 px with rewind (a
      // hit), ~72 px without (a miss). At 150 ms each way the view is ~13
      // ticks old, so the capped rewind tests B 4 ticks (16 px) beyond: ~52
      // px, still a hit. 36 leaves one tick of slack under the reach.
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-name-pattern='NET constants|cap is 9|melee under' test/net-sim.test.js test/net-rooms.test.js test/net-play.test.js`
Expected: FAIL: the constants; "the cap is 9 ticks" (x=14 instead of 10); "melee under 150 ms lag hits with rewind" (B hp stays 10).

- [ ] **Step 3: Implement**

`renderer/data/net.js` — replace the two lines

```js
  rewindMaxTicks: 6,       // melee lag compensation cap (200 ms)
  historyTicks: 8,         // per-hero position ring on the server
```

with

```js
  rewindMaxTicks: 9,       // melee lag compensation cap (300 ms; 4b)
  historyTicks: 11,        // per-hero position ring on the server (the cap + 2)
```

- [ ] **Step 4: Run to verify they pass**

Run the Step 2 command three times.
Expected: PASS each time (all three lag cases, the cap test and the constants).

- [ ] **Step 5: Commit**

```bash
git add renderer/data/net.js test/net-sim.test.js test/net-rooms.test.js test/net-play.test.js
git commit -m "feat(net): melee rewind cap 300 ms (9 ticks, history 11) — a 150 ms each-way swing hits

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 5: Away seats and resume — protocol and rooms (pure)

**Files:**
- Modify: `renderer/net/protocol.js`, `renderer/data/net.js`, `renderer/net/view.js`, `server/rooms.js`
- Test: `test/net-protocol.test.js`, `test/net-ui.test.js`, `test/net-public-rooms.test.js`

**Interfaces:**
- Produces:
  - `MSG.BYE === 'bye'`, `ERR.RESUME_FAILED === 'resume_failed'`, `TOKEN_RE = /^[0-9a-f]{32}$/` (exported from `protocol.js`);
  - `validateHello(raw)` → additionally `{ resume: token }`;
  - `NET.reconnectGraceMs === 20000`; `makeLobby({ reconnectGraceMs })`;
  - player record fields `away: boolean`, `awayUntil: number | null` (a room tick);
  - `markAway(lobby, room, heroId) → boolean`;
  - `resumeSeat(room, heroId) → { room, heroId } | { error: 'resume_failed' }`;
  - `drainExpired(room) → heroId[]` (each away seat whose grace ran out, once);
  - `errorText('resume_failed') === 'Your seat is gone — join a new match.'`.

- [ ] **Step 1: Write the failing tests**

`test/net-protocol.test.js` — insert before `  it('the new error codes', () => {`:

```js
  it('hello v3: resume is a fourth way in — exactly one of create/room/quick/resume, the token 32 hex characters', () => {
    const v = NET.protocolVersion
    const tok = '0123456789abcdef0123456789abcdef'
    assert.equal(v, 3)
    assert.deepEqual(validateHello({ type: 'hello', v, resume: tok }), { resume: tok })
    assert.deepEqual(validateHello({ type: 'hello', v, resume: tok, name: '<>', cls: 'bard' }), { resume: tok }, 'the seat keeps its own name and class')
    for (const bad of ['a'.repeat(31), 'a'.repeat(33), 'A'.repeat(32), 'g'.repeat(32), '', 42, true, {}])
      assert.deepEqual(validateHello({ type: 'hello', v, resume: bad }), { error: ERR.BAD_HELLO }, JSON.stringify(bad))
    for (const way of [{ create: true }, { quick: true }, { room: 'KXPT' }])
      assert.deepEqual(validateHello({ type: 'hello', v, name: 'Aino', cls: 'mage', resume: tok, ...way }), { error: ERR.BAD_HELLO })
    assert.deepEqual(validateHello({ type: 'hello', v: 2, resume: tok }), { error: ERR.VERSION })
  })
  it('bye and resume_failed', () => {
    assert.equal(MSG.BYE, 'bye')
    assert.equal(ERR.RESUME_FAILED, 'resume_failed')
  })
```

`test/net-ui.test.js` — in `errorText has a line for every error code and a fallback`, replace the first two lines of the body with:

```js
    for (const code of ['version', 'no_room', 'room_full', 'bad_name', 'bad_hello', 'server_full', 'rate_limited', 'idle', 'resume_failed'])
      assert.ok(errorText(code).length > 3, code)
    assert.equal(errorText('resume_failed'), 'Your seat is gone — join a new match.')
```

`test/net-public-rooms.test.js`:
- The rooms import becomes:

```js
import { makeLobby, createRoom, joinRoom, leaveRoom, quickJoin, balanceBots, queueInput, setRoomClass,
  stepRoom, drainKicks, markAway, resumeSeat, drainExpired, ackOf } from '../server/rooms.js'
```

- Append:

```js

describe('away seats (reconnect grace)', () => {
  const two = opts => { const lobby = makeLobby(opts); const { room } = quickJoin(lobby, who('A')); quickJoin(lobby, who('B')); return { lobby, room } }
  const hero = (room, id) => room.match.heroes.find(h => h.id === id)
  it('carries the spec number', () => {
    assert.equal(NET.reconnectGraceMs, 20000)
  })
  it('an away hero stays in the match on neutral input, and its seat still counts as human', () => {
    const { lobby, room } = two()
    for (let i = 1; i <= 3; i++) queueInput(room, 'p1', input(i, { move: { x: 1, y: 0 }, facing: 'east' }))
    assert.equal(markAway(lobby, room, 'p1'), true)
    const px = hero(room, 'p1').px
    steps(lobby, room, 10)
    assert.equal(hero(room, 'p1').px, px, 'stands still')
    assert.equal(humansOf(room).length, 2)
    assert.equal(botsOf(room).length, 2, 'no bot took the seat')
    assert.equal(room.players.get('p1').away, true)
  })
  it('an away hero can still be killed', () => {
    const { lobby, room } = two()
    markAway(lobby, room, 'p1')
    hero(room, 'p1').spawnProtect = 0
    hero(room, 'p1').hp = 0
    steps(lobby, room, 1)
    assert.equal(hero(room, 'p1').dead, true)
    assert.equal(hero(room, 'p1').deaths, 1)
  })
  it('the idle kick is suspended while away', () => {
    const { lobby, room } = two({ idleKickMs: 1000, reconnectGraceMs: 5000 })   // 30 and 150 ticks
    markAway(lobby, room, 'p1')
    for (let i = 1; i <= 100; i++) { queueInput(room, 'p2', input(i, { attack: true })); stepRoom(lobby, room) }
    assert.deepEqual(drainKicks(room), [])
    assert.deepEqual(drainExpired(room), [])
  })
  it('the grace runs out after reconnectGraceMs of room ticks: expired once; freeing the seat refills it with a bot', () => {
    const { lobby, room } = two({ reconnectGraceMs: 1000 })                        // 30 ticks
    markAway(lobby, room, 'p1')
    steps(lobby, room, 29)
    assert.deepEqual(drainExpired(room), [])
    steps(lobby, room, 1)
    assert.deepEqual(drainExpired(room), ['p1'])
    steps(lobby, room, 5)
    assert.deepEqual(drainExpired(room), [], 'queued once')
    leaveRoom(lobby, room, 'p1')                                                   // what the socket layer does
    assert.equal(humansOf(room).length, 1)
    assert.equal(botsOf(room).length, 3)
  })
  it('a lone private host who drops keeps the room open while away', () => {
    const lobby = makeLobby()
    const { room } = createRoom(lobby, who('A'))
    markAway(lobby, room, 'p1')
    steps(lobby, room, 30)
    assert.ok(lobby.rooms.has(room.code))
  })
  it('resumeSeat puts the same hero back: kills, deaths and class kept; queue, ack and idle clock start over', () => {
    const { lobby, room } = two({ idleKickMs: 1000 })
    for (let i = 1; i <= 5; i++) { queueInput(room, 'p1', input(500 + i, { move: { x: 1, y: 0 } })); stepRoom(lobby, room) }
    assert.equal(ackOf(room, 'p1'), 505)
    Object.assign(hero(room, 'p1'), { kills: 2, deaths: 1 })
    markAway(lobby, room, 'p1')
    steps(lobby, room, 40)
    assert.deepEqual(resumeSeat(room, 'p1'), { room, heroId: 'p1' })
    const p = room.players.get('p1')
    assert.equal(p.away, false)
    assert.deepEqual(p.queue, [])
    assert.equal(ackOf(room, 'p1'), 0)
    assert.equal(p.activeTick, room.tick)
    assert.deepEqual([hero(room, 'p1').kills, hero(room, 'p1').deaths, hero(room, 'p1').cls], [2, 1, 'archer'])
    // The new client numbers its inputs from 1 again, and they are acked.
    queueInput(room, 'p1', input(1)); stepRoom(lobby, room)
    assert.equal(ackOf(room, 'p1'), 1)
  })
  it('resumeSeat refuses a seat that is not away, an unknown one, and one already freed', () => {
    const { lobby, room } = two({ reconnectGraceMs: 1000 })
    assert.deepEqual(resumeSeat(room, 'p1'), { error: ERR.RESUME_FAILED }, 'its socket is still open')
    assert.deepEqual(resumeSeat(room, 'p9'), { error: ERR.RESUME_FAILED })
    markAway(lobby, room, 'p2')
    steps(lobby, room, 30)
    for (const id of drainExpired(room)) leaveRoom(lobby, room, id)
    assert.deepEqual(resumeSeat(room, 'p2'), { error: ERR.RESUME_FAILED })
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/net-protocol.test.js test/net-ui.test.js test/net-public-rooms.test.js`
Expected: FAIL: `resume` is refused as `bad_hello`, `MSG.BYE`/`ERR.RESUME_FAILED` are undefined, there is no `resume_failed` line, and `markAway`/`resumeSeat`/`drainExpired` are not exported (the rooms test file fails to load).

- [ ] **Step 3: Implement**

`renderer/net/protocol.js` — replace `MSG` and `ERR`:

```js
export const MSG = { HELLO: 'hello', INPUT: 'input', CLASS: 'class', PING: 'ping', BYE: 'bye',
  WELCOME: 'welcome', SNAP: 'snap', ERROR: 'error', PONG: 'pong' }
export const ERR = { VERSION: 'version', NO_ROOM: 'no_room', ROOM_FULL: 'room_full',
  BAD_NAME: 'bad_name', BAD_HELLO: 'bad_hello', SERVER_FULL: 'server_full',
  RATE_LIMITED: 'rate_limited', IDLE: 'idle', RESUME_FAILED: 'resume_failed' }
```

and replace the comment above `validateHello` and the function's first eleven lines — from `// Exactly one way in: …` down to and including `  if (create) return { name, cls: raw.cls, create: true }` — with:

```js
// A seat token: 128 random bits, hex (server: crypto.randomBytes(16)).
export const TOKEN_RE = /^[0-9a-f]{32}$/
// Exactly one way in: { create: true } a private room, { room: CODE } join
// by code, { quick: true } a public room with bot fill (protocol v2), or
// { resume: TOKEN } back into your own seat after a drop (v3) — which needs
// no name or class: the seat keeps its own.
export function validateHello(raw) {
  if (raw?.v !== NET.protocolVersion) return { error: ERR.VERSION }
  const create = raw.create === true
  const quick = raw.quick === true
  const room = typeof raw.room === 'string' ? raw.room.trim().toUpperCase() : null
  const resume = raw.resume !== undefined && raw.resume !== null
  if (Number(create) + Number(quick) + Number(!!room) + Number(resume) !== 1) return { error: ERR.BAD_HELLO }
  if (resume) return typeof raw.resume === 'string' && TOKEN_RE.test(raw.resume) ? { resume: raw.resume } : { error: ERR.BAD_HELLO }
  const name = validateName(raw.name)
  if (!name) return { error: ERR.BAD_NAME }
  if (!validateClass(raw.cls)) return { error: ERR.BAD_HELLO }
  if (create) return { name, cls: raw.cls, create: true }
```

(the two lines after it — the `quick` and `room` returns — are unchanged).

`renderer/data/net.js` — replace the closing of the object:

```js
  refusalLogMs: 60000,     // refusal counts are logged this often, when non-zero
}
```

with

```js
  refusalLogMs: 60000,     // refusal counts are logged this often, when non-zero

  // Arenas, reconnect and netcode polish (4b).
  reconnectGraceMs: 20000, // a dropped human's hero stays in the match this long, waiting for hello.resume
}
```

`renderer/net/view.js` — add to `ERROR_TEXT`, after the `idle` line:

```js
  resume_failed: 'Your seat is gone — join a new match.',
```

`server/rooms.js`:
- Replace `makeLobby`:

```js
export function makeLobby({ random = Math.random, rewind = true, matchLength = PVP.matchLength,
  resultsDelay = NET.resultsDelay, idleKickMs = NET.idleKickMs, lonelyHostKickMs = NET.lonelyHostKickMs,
  reconnectGraceMs = NET.reconnectGraceMs } = {}) {
  return { rooms: new Map(), serial: 0,
    opts: { random, rewind, matchLength, resultsDelay, idleKickMs, lonelyHostKickMs, reconnectGraceMs } }
}
```

- Replace `freshPlayer` and its comment:

```js
// activeTick: the room tick of this human's last real input (a move,
// attack, alt or sprint) or class pick — what the idle timer measures.
// away / awayUntil: the socket dropped and the seat waits (a room tick) for
// hello.resume (4b spec §2).
const freshPlayer = room => ({ queue: [], last: NEUTRAL_INPUT, lastInputTick: room.match.tick, ack: 0,
  activeTick: room.tick, kicked: false, away: false, awayUntil: null })
```

- In `createRoom`'s room literal, `bots: [], kicks: [], tick: 0,` → `bots: [], kicks: [], expired: [], tick: 0,`.
- After the `export const ackOf = …` line, insert:

```js

// A seated human's socket dropped without a bye (4b spec §2). The hero stays
// in the match on neutral input — it stands still and can be hit and killed
// — and the seat still counts as human (no bot takes it, the room stays
// open), with the idle kick suspended, until reconnectGraceMs of room ticks
// have passed; then stepRoom queues it on room.expired for the socket layer
// to free. False when there is no such seat.
export function markAway(lobby, room, heroId) {
  const p = room.players.get(heroId)
  if (!p) return false
  p.away = true
  p.awayUntil = room.tick + Math.round(lobby.opts.reconnectGraceMs / 1000 / PVP.tick)
  p.queue = []
  p.last = NEUTRAL_INPUT
  return true
}

// hello.resume found this seat: back on a new socket as the same hero (id,
// name, class, kills, deaths untouched). The new client numbers its inputs
// from 1 again, so the queue and the ack start over; the idle clock restarts.
// A seat that is not away — its socket is still open — is refused, so a
// copied token cannot take over a live player.
export function resumeSeat(room, heroId) {
  const p = room.players.get(heroId)
  if (!p?.away) return { error: ERR.RESUME_FAILED }
  Object.assign(p, { away: false, awayUntil: null, queue: [], last: NEUTRAL_INPUT, ack: 0,
    lastInputTick: room.match.tick, activeTick: room.tick })
  return { room, heroId }
}

export function drainExpired(room) {
  const e = room.expired
  room.expired = []
  return e
}
```

- In `checkIdle`, the second loop becomes:

```js
  const holding = room.match.waiting || room.match.ended
  for (const [id, p] of room.players) {
    if (p.away) continue                    // suspended while the seat waits for its player
    if (holding) p.activeTick = room.tick
    else if (!p.kicked && room.tick - p.activeTick >= limit) { p.kicked = true; room.kicks.push(id) }
  }
```

- Insert before `export function drainKicks(room) {`:

```js
// An away seat whose grace has run out is queued on room.expired, once.
function checkAway(room) {
  for (const [id, p] of room.players) {
    if (!p.away || p.awayUntil === null || room.tick < p.awayUntil) continue
    p.awayUntil = null
    room.expired.push(id)
  }
}

```

- In `stepRoom`'s input loop, replace

```js
    let input
    if (p.queue.length) { input = p.queue.shift(); p.last = input; p.ack = input.seq }
```

  with

```js
    let input
    if (p.away) input = NEUTRAL_INPUT
    else if (p.queue.length) { input = p.queue.shift(); p.last = input; p.ack = input.seq }
```

- In `stepRoom`, after `  checkIdle(lobby, room)` add `  checkAway(room)`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/net-*.test.js`
Expected: PASS. (Nothing calls `markAway` yet, so every socket test behaves as before.)

- [ ] **Step 5: Commit**

```bash
git add renderer/net/protocol.js renderer/data/net.js renderer/net/view.js server/rooms.js test/net-protocol.test.js test/net-ui.test.js test/net-public-rooms.test.js
git commit -m "feat(net): away seats with a 20 s grace, resumeSeat and hello.resume in the protocol

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 6: Seat tokens, resume and bye over the socket

**Files:**
- Modify: `server/pvp-server.js`, `renderer/net/client.js` (`leave`), `test/net-helpers.js`
- Create: `test/net-reconnect.test.js`
- Test: `test/net-reconnect.test.js`, `test/net-client.test.js`; `test/net-server.test.js` and `test/net-public.test.js` switch the closes that must free a seat at once to `bye`

**Interfaces:**
- Consumes: `markAway`, `resumeSeat`, `drainExpired` (Task 5); `MSG.BYE`, `ERR.RESUME_FAILED`, `validateHello` → `{ resume }` (Task 5).
- Produces:
  - `welcome = { type, v, room, heroId, tick, arena, token }` — `token` a fresh 32-hex string per welcome;
  - `attachPvp(...)` returns `tokens: Map<token, { roomCode, heroId }>` too (for tests); `attachPvp(server, { reconnectGraceMs })` passes through to `makeLobby`;
  - `hello { resume }` → a welcome for the same `heroId`, or `error: resume_failed` then close;
  - `bye` → the seat is freed now (bot fill, room close) and the socket closed 1000;
  - client `leave(s)` sends `{ type: 'bye' }` first when `s.status === 'open'`;
  - test helpers: `rawClient(...).bye()`; `laggy(...)`'s `close()` waits behind its pending sends.

- [ ] **Step 1: Write the failing tests**

`test/net-helpers.js`:
- In `rawClient`'s returned object, after the `send:` line add:

```js
    // A deliberate leave: bye, then close — the seat goes at once.
    bye: () => { ws.send(encode({ type: 'bye' })); ws.close() },
```

- In `laggy`, replace `    close() { this.inner.close() }` with:

```js
    // Queued behind whatever send() is still delaying, as on a real link, so
    // a bye sent just before close() is not overtaken by the close.
    close() {
      const at = Math.max(this.upAt, performance.now())
      setTimeout(() => this.inner.close(), at - performance.now())
    }
```

Existing socket tests that close a seated client and then expect its room to close (or its creator's room slot to free) must now say `bye`, since a bare close keeps the seat for the grace:
- `test/net-server.test.js`: rename `'the last socket out destroys the room'` to `'the last socket out with a bye destroys the room at once'`, and change its `a.ws.close()` to `a.bye()`.
- `test/net-public.test.js`:
  - in `a lone quick-join gets a running match…`: `a.ws.close(); b.ws.close()` → `a.bye(); b.bye()`;
  - in `a private room never has bots`: `a.ws.close()` → `a.bye()`;
  - in `the 11th hello from one IP…`: `c.ws.close()` → `c.bye()                                               // frees the room, so roomsPerIp never bites`;
  - in `closing a room frees its creator's slot`: `rooms[0].ws.close()` → `rooms[0].bye()`.

`test/net-client.test.js`:
- The client import becomes `import { connect, frame, sessionView, drainCues, drainEvents, leave } from '../renderer/net/client.js'`.
- Append:

```js

describe('leaving', () => {
  it('leave() says bye before closing an open session', () => {
    const s = open()
    welcome(s)
    let closed = false
    s.ws.close = () => { closed = true }
    leave(s)
    assert.equal(s.ws.sent.at(-1).type, 'bye')
    assert.equal(closed, true)
  })
  it('before the welcome there is no seat to give up: no bye', () => {
    const s = open()
    leave(s)
    assert.ok(!s.ws.sent.some(m => m.type === 'bye'))
  })
})
```

Create `test/net-reconnect.test.js`:

```js
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, rawClient, waitFor, sleep } from './net-helpers.js'
import { NET } from '../renderer/data/net.js'

const hello = (over = {}) => ({ type: 'hello', v: NET.protocolVersion, name: 'Aino', cls: 'archer', ...over })
const resumeHello = token => ({ type: 'hello', v: NET.protocolVersion, resume: token })
const botsIn = snap => snap.heroes.filter(h => h.name.startsWith('Bot '))
const roomOf = (srv, code) => srv.pvp.lobby.rooms.get(code)

describe('seat tokens and resume over sockets', async () => {
  const srv = await startServer()
  after(() => srv.close())

  it('welcome carries a fresh 32-hex-character token, held only in memory', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    const w = await a.next('welcome')
    assert.match(w.token, /^[0-9a-f]{32}$/)
    assert.deepEqual(srv.pvp.tokens.get(w.token), { roomCode: w.room, heroId: w.heroId })
    a.bye()
    await waitFor(() => !srv.pvp.tokens.has(w.token))
  })

  it('a dropped client resumes within the grace: same hero, kills kept, a new token, snapshots again', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ quick: true }))
    const w = await a.next('welcome')
    const room = roomOf(srv, w.room)
    room.match.heroes.find(h => h.id === w.heroId).kills = 2
    a.ws.terminate()                                        // no bye, no close handshake
    await waitFor(() => room.players.get(w.heroId)?.away)
    assert.equal(room.match.heroes.filter(h => h.id === w.heroId).length, 1, 'the hero stays in the match')
    const b = await rawClient(srv.url)
    b.send(resumeHello(w.token))
    const w2 = await b.next('welcome')
    assert.equal(w2.heroId, w.heroId)
    assert.equal(w2.room, w.room)
    assert.match(w2.token, /^[0-9a-f]{32}$/)
    assert.notEqual(w2.token, w.token)
    assert.equal(srv.pvp.tokens.has(w.token), false, 'the old token is spent')
    const snap = await b.next('snap')
    assert.equal(snap.heroes.find(h => h.id === w.heroId).kills, 2)
    assert.equal(room.players.get(w.heroId).away, false)
    b.bye()
  })

  it('a spent token, a made-up token and a live seat all get resume_failed', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ quick: true }))
    const w = await a.next('welcome')
    const copy = await rawClient(srv.url)
    copy.send(resumeHello(w.token))                         // a's socket is still open
    assert.equal((await copy.next('error')).code, 'resume_failed')
    await waitFor(() => copy.closed !== null)
    assert.equal(a.closed, null, 'the live player is untouched')
    assert.ok(srv.pvp.tokens.has(w.token), 'and keeps its token')
    a.ws.terminate()
    await waitFor(() => roomOf(srv, w.room).players.get(w.heroId)?.away)
    const back = await rawClient(srv.url)
    back.send(resumeHello(w.token))
    await back.next('welcome')
    for (const token of [w.token, 'f'.repeat(32)]) {
      const c = await rawClient(srv.url)
      c.send(resumeHello(token))
      assert.equal((await c.next('error')).code, 'resume_failed')
    }
    back.bye()
  })

  it('a bye releases the seat at once: a bot takes it and the token is dead', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ quick: true }))
    const wa = await a.next('welcome')
    const b = await rawClient(srv.url)
    b.send(hello({ quick: true, name: 'Ilmari' }))
    await b.next('welcome')
    await waitFor(() => botsIn(b.last('snap') ?? { heroes: [] }).length === 2)
    const t0 = performance.now()
    a.bye()
    await waitFor(() => botsIn(b.last('snap')).length === 3)
    assert.ok(performance.now() - t0 < NET.reconnectGraceMs / 4, 'no grace period')
    const c = await rawClient(srv.url)
    c.send(resumeHello(wa.token))
    assert.equal((await c.next('error')).code, 'resume_failed')
    b.bye()
  })

  it('a flood refusal is not a drop: the seat goes at once, with no grace', async () => {
    const c = await rawClient(srv.url)
    c.send(hello({ create: true }))
    const w = await c.next('welcome')
    for (let i = 0; i < NET.msgBurst + 50; i++) c.send({ type: 'ping', t: i })
    await waitFor(() => c.closed !== null)
    assert.equal(c.closed, 1008)
    await waitFor(() => !roomOf(srv, w.room), 1000)
    assert.equal(srv.pvp.tokens.has(w.token), false)
  })

  it('a resume spends a hello like any other', async () => {
    const ip = '198.51.100.40'
    for (let i = 0; i < NET.helloBurst; i++) {
      const c = await rawClient(srv.url, { ip })
      c.send(resumeHello('0'.repeat(32)))
      assert.equal((await c.next('error')).code, 'resume_failed')
      await waitFor(() => c.closed !== null)
    }
    const late = await rawClient(srv.url, { ip })
    late.send(resumeHello('0'.repeat(32)))
    assert.equal((await late.next('error')).code, 'rate_limited')
  })
})

describe('the grace period over sockets', async () => {
  const srv = await startServer({ reconnectGraceMs: 300 })
  after(() => srv.close())

  it('after the grace: resume_failed, and in a public room a bot takes the seat', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ quick: true }))
    const wa = await a.next('welcome')
    const b = await rawClient(srv.url)
    b.send(hello({ quick: true, name: 'Ilmari' }))
    await b.next('welcome')
    await waitFor(() => botsIn(b.last('snap') ?? { heroes: [] }).length === 2)
    a.ws.terminate()
    await sleep(100)
    assert.equal(botsIn(b.last('snap')).length, 2, 'the seat is held during the grace')
    await waitFor(() => botsIn(b.last('snap')).length === 3, 3000)
    assert.equal(srv.pvp.tokens.has(wa.token), false)
    const c = await rawClient(srv.url)
    c.send(resumeHello(wa.token))
    assert.equal((await c.next('error')).code, 'resume_failed')
    b.bye()
  })

  it('a lone player who never comes back: the room closes when the grace runs out', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    const w = await a.next('welcome')
    a.ws.terminate()
    await sleep(100)
    assert.ok(roomOf(srv, w.room), 'still open during the grace')
    await waitFor(() => !roomOf(srv, w.room), 3000)
    const c = await rawClient(srv.url)
    c.send(resumeHello(w.token))
    assert.equal((await c.next('error')).code, 'resume_failed')
  })

  it('an idle kick is not a drop: the seat goes at once, with no grace', async () => {
    const lazy = await startServer({ idleKickMs: 300 })
    try {
      const a = await rawClient(lazy.url)
      a.send(hello({ quick: true }))
      const w = await a.next('welcome')
      assert.equal((await a.next('error', 3000)).code, 'idle')
      await waitFor(() => !lazy.pvp.lobby.rooms.has(w.room))
      assert.equal(lazy.pvp.tokens.size, 0)
    } finally { await lazy.close() }
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/net-reconnect.test.js test/net-client.test.js`
Expected: FAIL: the welcome has no `token`, `srv.pvp.tokens` is undefined, a `resume` hello finds no seat, `bye` is ignored, and `leave()` sends no bye.

- [ ] **Step 3: Implement**

`server/pvp-server.js`:
- Replace the privacy paragraph at the end of the header comment and the two imports that follow it:

```js
// Privacy: a caller's IP is used only as a key into the gate's in-memory
// counters (server/limits.js). It is never logged and never sent anywhere;
// the only log line about refusals is a count per period.
import { WebSocketServer } from 'ws'
import { makeLobby, createRoom, joinRoom, quickJoin, leaveRoom, queueInput, setRoomClass, stepRoom, ackOf, drainKicks } from './rooms.js'
```

  with

```js
// A seat outlives a dropped socket by NET.reconnectGraceMs (4b spec §2): the
// welcome hands out a seat token, and hello.resume with it re-seats the same
// hero on a new socket; a bye gives the seat up at once.
//
// Privacy: a caller's IP is used only as a key into the gate's in-memory
// counters (server/limits.js). It is never logged and never sent anywhere;
// the only log line about refusals is a count per period. Seat tokens live
// only in memory, only in `tokens`, and are never logged either.
import { randomBytes } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { makeLobby, createRoom, joinRoom, quickJoin, leaveRoom, queueInput, setRoomClass, stepRoom, ackOf, drainKicks,
  markAway, resumeSeat, drainExpired } from './rooms.js'
```

- After `  const loops = new Map()` (in `attachPvp`), insert:

```js
  // Seat token → { roomCode, heroId }. One live token per seat: a resume
  // spends the old one, and a seat given up takes its token with it.
  const tokens = new Map()

  function issueToken(room, heroId) {
    const token = randomBytes(16).toString('hex')
    tokens.set(token, { roomCode: room.code, heroId })
    return token
  }

  // Every token of one seat, or (heroId null) of a whole room.
  function dropTokens(code, heroId = null) {
    for (const [token, at] of tokens) if (at.roomCode === code && (heroId === null || at.heroId === heroId)) tokens.delete(token)
  }
```

- In `crashRoom`, after `    lobby.rooms.delete(room.code)` add `    dropTokens(room.code)`.
- Replace `kick` and its comment with:

```js
  // Give a seat up for good: its token, its hero (a public room's bot fill
  // takes the seat) and, with the last seat, the room.
  function vacate(room, heroId) {
    dropTokens(room.code, heroId)
    leaveRoom(lobby, room, heroId)
    if (!lobby.rooms.has(room.code)) roomGone(room)
  }

  // Free a seat from the server side (the idle kick): tell the client why,
  // leave the room now and close. The socket's own 'close' handler runs
  // later and finds the seat no longer its own: nothing to do.
  function kick(room, heroId, code) {
    const ws = room.sockets.get(heroId)
    room.sockets.delete(heroId)
    vacate(room, heroId)
    if (ws) { send(ws, { type: MSG.ERROR, code }); ws.close(1000) }
  }

  // hello.resume: back into an away seat of a live room, or resume_failed —
  // the token unknown, spent or expired, the room gone, or the seat's own
  // socket still open.
  function resume(token) {
    const at = tokens.get(token)
    const room = at && lobby.rooms.get(at.roomCode)
    if (!room) return { error: ERR.RESUME_FAILED }
    const res = resumeSeat(room, at.heroId)
    if (res.error) return res
    tokens.delete(token)
    return res
  }
```

- In `ensureLoop`, after `          for (const id of drainKicks(room)) kick(room, id, ERR.IDLE)` add `          for (const id of drainExpired(room)) vacate(room, id)`.
- In the connection handler, replace `    let room = null, heroId = null` with:

```js
    let room = null, heroId = null
    // Set when this socket's seat must go the moment it closes, with no
    // grace: a flood refusal or a message that crashed its handler.
    let leaveNow = false
```

- The flood line becomes `      if (!allowMessage(budget, now())) { noteFlood(gate); leaveNow = true; closeAndReap(ws); return }`.
- Replace the hello-to-welcome block

```js
          const res = seat(validateHello(msg), ip)
          if (res.error) { closeAndReap(ws, res.error); return }
          room = res.room; heroId = res.heroId
          clearTimeout(helloTimer)
          room.sockets ??= new Map()
          room.sockets.set(heroId, ws)
          ensureLoop(room)
          send(ws, { type: MSG.WELCOME, v: NET.protocolVersion, room: room.code, heroId, tick: room.match.tick, arena: room.match.arena.id })
          return
        }
```

  with

```js
          const hello = validateHello(msg)
          const res = hello.resume ? resume(hello.resume) : seat(hello, ip)
          if (res.error) { closeAndReap(ws, res.error); return }
          room = res.room; heroId = res.heroId
          clearTimeout(helloTimer)
          room.sockets ??= new Map()
          room.sockets.set(heroId, ws)
          ensureLoop(room)
          send(ws, { type: MSG.WELCOME, v: NET.protocolVersion, room: room.code, heroId, tick: room.match.tick,
            arena: room.match.arena.id, token: issueToken(room, heroId) })
          return
        }
        // A deliberate leave: the seat goes now, with no grace. The close
        // handler then finds the seat no longer this socket's.
        if (msg.type === MSG.BYE) {
          room.sockets.delete(heroId)
          vacate(room, heroId)
          ws.close(1000)
          return
        }
```

- In the message `catch`, after the `console.error(…)` line add `        leaveNow = true`.
- In the `close` handler, replace

```js
      if (!room) return
      room.sockets.delete(heroId)
      // The room may already have been torn down by crashRoom(); its own
      // sockets are being closed right now, so leaveRoom must not run again
      // against a room the lobby no longer holds.
      if (lobby.rooms.get(room.code) !== room) return
      try {
        leaveRoom(lobby, room, heroId)
        if (!lobby.rooms.has(room.code)) roomGone(room)
      } catch (err) {
```

  with

```js
      if (!room) return
      // A kick or a bye already freed this seat, or a resume moved it to a
      // newer socket: this one owns nothing any more.
      if (room.sockets.get(heroId) !== ws) return
      room.sockets.delete(heroId)
      // The room may already have been torn down by crashRoom(); its own
      // sockets are being closed right now, so leaveRoom must not run again
      // against a room the lobby no longer holds.
      if (lobby.rooms.get(room.code) !== room) return
      try {
        // An unexpected drop keeps the seat for NET.reconnectGraceMs.
        if (leaveNow) vacate(room, heroId)
        else markAway(lobby, room, heroId)
      } catch (err) {
```

- The returned object's first line `    lobby, wss, gate,` → `    lobby, wss, gate, tokens,`.

`renderer/net/client.js` — replace `export function leave(s) { s.closedByUs = true; s.ws.close() }` with:

```js
// A deliberate leave says bye first, so the server frees the seat at once
// instead of holding it for the reconnect grace.
export function leave(s) {
  if (s.status === 'open') s.ws.send(encode({ type: MSG.BYE }))
  s.closedByUs = true
  s.ws.close()
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/net-*.test.js`
Expected: PASS, including the existing `net-play` lifecycle test (its `leave()` now says bye, and the laggy close no longer overtakes it) and the updated `net-server`/`net-public` tests.

Then: `grep -n "console\.\(log\|error\)" server/pvp-server.js`
Expected: no log line mentions `token`, `tokens` or `ip`.

- [ ] **Step 5: Commit**

```bash
git add server/pvp-server.js renderer/net/client.js test/net-helpers.js test/net-reconnect.test.js test/net-client.test.js test/net-server.test.js test/net-public.test.js
git commit -m "feat(net): seat tokens, hello.resume back into an away seat, bye frees it at once

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 7: The client gets its seat back — retry schedule, reset, panels

**Files:**
- Modify: `renderer/net/client.js`, `renderer/data/net.js`, `renderer/ui/net-panels.js`
- Test: `test/net-client.test.js`, `test/net-panels.test.js`, `test/net-play.test.js`, `test/net-reconnect.test.js`

**Interfaces:**
- Consumes: `welcome.token`, `hello { resume }`, `resume_failed` (Tasks 5–6).
- Produces:
  - `NET.reconnectDelaysMs = [500, 1000, 2000, 4000, 8000]`;
  - session status `'reconnecting'`; session fields `token`, `lostAt`, `attempt`, `retryAt`, `url`, `WebSocketImpl`, `over`;
  - events: `{ type: 'reconnecting' }` (never trimmed); `{ type: 'welcome', room, heroId, token, resumed: boolean }`; `{ type: 'error', code, reconnect?: true }`; one `{ type: 'closed', status }` when the session ends;
  - `connect({ hello: { resume: token } })` works from the start (a reloaded tab);
  - `frame(s, …)` drives the retries while reconnecting (and sends no input);
  - `leave(s)` while reconnecting ends the session as `'left'`;
  - `panels.showing → 'confirm' | 'results' | 'wait' | 'picker' | null`; `panels.refresh()` redraws the current panel.

- [ ] **Step 1: Write the failing tests**

`test/net-client.test.js` — append:

```js

describe('reconnect', () => {
  // A hand-driven socket that remembers every instance: open() and recv()
  // play the server, close() fires onclose as a real drop would.
  class Sock {
    static all = []
    constructor(url) { this.url = url; this.sent = []; this.closed = false; Sock.all.push(this) }
    send(text) { this.sent.push(JSON.parse(text)) }
    close() { if (this.closed) return; this.closed = true; this.onclose?.() }
    open() { this.onopen?.() }
    recv(msg) { this.onmessage?.({ data: JSON.stringify(msg) }) }
  }
  const TOK = 'a'.repeat(32), TOK2 = 'b'.repeat(32)
  const hi = (token, over = {}) => ({ type: 'welcome', room: 'ABCD', heroId: 'p1', arena: 'pillars', token, ...over })
  let t = 0
  const start = (hello = { name: 'A', cls: 'archer', quick: true }) => {
    Sock.all = []
    t = 0
    const s = connect({ url: 'ws://x', WebSocketImpl: Sock, now: () => t, hello })
    Sock.all[0].open()
    Sock.all[0].recv(hi(TOK))
    drainEvents(s)
    return s
  }
  const drop = s => { t = 1000; Sock.all.at(-1).close(); return s }
  // Frames every 50 ms from now until `until`; each new socket is handed to onSocket.
  const run = (s, until, onSocket = () => {}) => {
    for (; t <= until; t += 50) {
      const n = Sock.all.length
      frame(s, NEUTRAL_INPUT, t)
      if (Sock.all.length > n) onSocket(Sock.all.at(-1), t)
    }
  }

  it('carries the spec numbers', () => {
    assert.deepEqual(NET.reconnectDelaysMs, [500, 1000, 2000, 4000, 8000])
    assert.equal(NET.reconnectGraceMs, 20000)
  })
  it('an unexpected drop after the welcome: Reconnecting, then hello.resume at 0.5, 1.5, 3.5, 7.5 and 15.5 s, then lost', () => {
    const s = drop(start())
    assert.equal(s.status, 'reconnecting')
    assert.deepEqual(drainEvents(s).map(e => e.type), ['reconnecting'])
    const at = []
    run(s, 25000, (sock, when) => {
      at.push(when - 1000)
      sock.open()
      assert.deepEqual(sock.sent[0], { type: 'hello', v: NET.protocolVersion, resume: TOK })
      sock.close()                                           // the attempt fails
    })
    assert.deepEqual(at, [500, 1500, 3500, 7500, 15500])
    assert.equal(s.status, 'lost')
    assert.deepEqual(drainEvents(s).filter(e => e.type === 'closed'), [{ type: 'closed', status: 'lost' }])
  })
  it('a resume that works: open again with a new token, the session reset, and the next snapshot rebuilds the view', () => {
    const s = start()
    Sock.all[0].recv(snapBody(lone(), { tick: 5 }))
    frame(s, NEUTRAL_INPUT, 0); frame(s, NEUTRAL_INPUT, 100)
    assert.ok(s.pred && s.seq > 0)
    drop(s)
    run(s, 1500, sock => { sock.open(); sock.recv(hi(TOK2)) })
    assert.equal(s.status, 'open')
    assert.equal(s.token, TOK2)
    assert.equal(s.heroId, 'p1')
    assert.equal(s.pred, null)
    assert.equal(s.seq, 0)
    assert.equal(Sock.all.length, 2, 'one attempt was enough')
    assert.deepEqual(drainEvents(s).filter(e => e.type === 'welcome').map(e => [e.resumed, e.token]), [[true, TOK2]])
    Sock.all[1].recv(snapBody(lone(), { tick: 50 }))
    assert.ok(sessionView(s, t))
    frame(s, NEUTRAL_INPUT, t)
    frame(s, NEUTRAL_INPUT, t + 40)
    assert.equal(Sock.all[1].sent.find(m => m.type === 'input').seq, 1, 'inputs are numbered afresh')
  })
  it('resuming into a match that has moved to another arena rebuilds the map', () => {
    const s = drop(start())
    const before = s.map
    run(s, 1500, sock => { sock.open(); sock.recv(hi(TOK2, { arena: 'glade' })) })
    assert.equal(s.status, 'open')
    assert.equal(s.arena, 'glade')
    assert.notEqual(s.map, before)
    assert.equal(s.map[0].length, PVP_ARENAS.glade.size.w)
  })
  it('resume_failed ends it: Connection lost', () => {
    const s = drop(start())
    run(s, 1500, sock => { sock.open(); sock.recv({ type: 'error', code: 'resume_failed' }); sock.close() })
    assert.equal(s.status, 'lost')
    assert.equal(Sock.all.length, 2, 'no more attempts')
    assert.deepEqual(drainEvents(s).filter(e => e.type === 'closed').map(e => e.status), ['lost'])
  })
  it('a newer server during a resume: a version error flagged as a reconnect', () => {
    const s = drop(start())
    run(s, 1500, sock => { sock.open(); sock.recv({ type: 'error', code: 'version' }); sock.close() })
    assert.equal(s.status, 'error')
    assert.deepEqual(drainEvents(s).find(e => e.type === 'error'), { type: 'error', code: 'version', reconnect: true })
  })
  it('a rate-limited attempt costs that attempt only: the next one still goes out', () => {
    const s = drop(start())
    let n = 0
    run(s, 3000, sock => {
      sock.open()
      if (n++ === 0) { sock.recv({ type: 'error', code: 'rate_limited' }); sock.close() }
      else sock.recv(hi(TOK2))
    })
    assert.equal(n, 2)
    assert.equal(s.status, 'open')
  })
  it('a tab hidden past the grace gives up at its first frame back, opening no socket', () => {
    const s = drop(start())
    frame(s, NEUTRAL_INPUT, 1000 + NET.reconnectGraceMs + 5000)
    assert.equal(s.status, 'lost')
    assert.equal(Sock.all.length, 1)
  })
  it('an attempt still hanging when the next is due is abandoned for it', () => {
    const s = drop(start())
    const opened = []
    run(s, 3000, sock => opened.push(sock))                 // never answers
    assert.equal(opened.length, 2)
    assert.equal(opened[0].closed, true)
    assert.equal(s.ws, opened[1])
    opened[0].recv(hi(TOK2))                                 // a late answer on the abandoned one is ignored
    assert.equal(s.status, 'reconnecting')
  })
  it('Leave while reconnecting stops the retries', () => {
    const s = drop(start())
    drainEvents(s)
    leave(s)
    assert.equal(s.status, 'left')
    run(s, 25000)
    assert.equal(Sock.all.length, 1)
    assert.deepEqual(drainEvents(s), [{ type: 'closed', status: 'left' }])
  })
  it('a clean leave or a drop before the welcome never reconnects', () => {
    const a = start()
    leave(a)
    assert.equal(a.status, 'left')
    assert.ok(!drainEvents(a).some(e => e.type === 'reconnecting'))
    Sock.all = []
    const b = connect({ url: 'ws://x', WebSocketImpl: Sock, now: () => t, hello: { name: 'A', cls: 'archer', quick: true } })
    Sock.all[0].open()
    Sock.all[0].close()
    assert.equal(b.status, 'lost')
  })
  it('hello { resume } from the start (a reloaded tab) sends it and keeps the token for later drops', () => {
    Sock.all = []
    const s = connect({ url: 'ws://x', WebSocketImpl: Sock, now: () => t, hello: { resume: TOK } })
    Sock.all[0].open()
    assert.deepEqual(Sock.all[0].sent[0], { type: 'hello', v: NET.protocolVersion, resume: TOK })
    Sock.all[0].recv(hi(TOK2))
    assert.equal(s.status, 'open')
    assert.equal(s.token, TOK2)
  })
})
```

`test/net-panels.test.js` — append:

```js

describe('after a reconnect', () => {
  it('showing names the panel that is up', () => {
    const { ui } = fakeUi()
    const p = makeNetPanels(ui)
    assert.equal(p.showing, null)
    p.died(); assert.equal(p.showing, 'picker')
    p.escape(); assert.equal(p.showing, 'confirm')
    p.stay(); p.matchEnd(ROWS); assert.equal(p.showing, 'results')
    p.matchStart(); p.sync({ ended: true, dead: false }); assert.equal(p.showing, 'wait')
  })
  it('refresh() draws again whatever the Reconnecting overlay covered: picker, results, wait, the confirm, or nothing', () => {
    const cases = [
      [p => p.died(), 'picker'],
      [p => p.matchEnd(ROWS), ['results', ROWS]],
      [p => p.sync({ ended: true, dead: false }), 'wait'],
      [p => { p.died(); p.escape() }, 'confirm'],
      [() => {}, 'hide'],
    ]
    for (const [setup, want] of cases) {
      const { ui, calls } = fakeUi()
      const p = makeNetPanels(ui)
      setup(p)
      calls.length = 0
      p.refresh()
      assert.deepEqual(calls, [want])
    }
  })
})
```

`test/net-play.test.js`:
- After the line `import { NEUTRAL_INPUT } from '../renderer/pvp/hero.js'` add `import { NET } from '../renderer/data/net.js'`.
- Replace the test `'server close marks the session lost and frame() is a no-op'` with:

```js
  it('server close: the session tries to get its seat back, sends no input meanwhile, and is lost past the grace', async () => {
    const srv = await startServer()
    const a = await host(srv.url, WebSocketNoLag())
    await srv.close()
    await waitFor(() => a.status === 'reconnecting')
    const seq = a.seq
    assert.doesNotThrow(() => frame(a, idle(), performance.now()))
    assert.equal(a.seq, seq, 'no input while reconnecting')
    frame(a, idle(), a.lostAt + NET.reconnectGraceMs + 1)
    assert.equal(a.status, 'lost')
    const events = drainEvents(a)
    assert.ok(events.some(e => e.type === 'reconnecting'))
    assert.ok(events.some(e => e.type === 'closed' && e.status === 'lost'))
  })
```

`test/net-reconnect.test.js`:
- Replace its two helper/NET import lines

```js
import { startServer, rawClient, waitFor, sleep } from './net-helpers.js'
import { NET } from '../renderer/data/net.js'
```

  with

```js
import WebSocket from 'ws'
import { startServer, rawClient, waitFor, sleep, drive } from './net-helpers.js'
import { connect, sessionView, drainEvents, leave } from '../renderer/net/client.js'
import { NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { NET } from '../renderer/data/net.js'
```

- Append:

```js

describe('the client gets its seat back over a real socket', async () => {
  const srv = await startServer()
  after(() => srv.close())
  // ws's WebSocket, from its own made-up address like rawClient's.
  class FromIp extends WebSocket { constructor(url) { super(url, { headers: { 'x-forwarded-for': '10.7.0.1' } }) } }

  it('a socket killed mid-match: Reconnecting, then the same hero within a second, and snapshots again', async () => {
    const s = connect({ url: srv.url, WebSocketImpl: FromIp, now: () => performance.now(), hello: { name: 'Aino', cls: 'mage', quick: true } })
    await waitFor(() => s.status === 'open' && s.pred, 3000)
    const heroId = s.heroId
    srv.pvp.lobby.rooms.get(s.room).match.heroes.find(h => h.id === heroId).kills = 3
    s.ws.terminate()
    await waitFor(() => s.status === 'reconnecting')
    const t0 = performance.now()
    await drive(s, () => NEUTRAL_INPUT, 1500)
    assert.equal(s.status, 'open')
    assert.equal(s.heroId, heroId)
    assert.ok(performance.now() - t0 < 2000)
    const v = await waitFor(() => sessionView(s, performance.now()), 2000)
    assert.equal(v.me.id, heroId)
    assert.equal(v.me.kills, 3)
    const types = drainEvents(s).map(e => e.type)
    assert.ok(types.includes('reconnecting') && types.includes('welcome'), types.join(','))
    leave(s)
    await waitFor(() => srv.pvp.lobby.rooms.size === 0)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/net-client.test.js test/net-panels.test.js test/net-play.test.js test/net-reconnect.test.js`
Expected: FAIL: a drop goes straight to `lost`, `NET.reconnectDelaysMs` is undefined, no `reconnecting` event, `panels.showing`/`refresh` are undefined.

- [ ] **Step 3: Implement**

`renderer/data/net.js` — after the `reconnectGraceMs` line add:

```js
  reconnectDelaysMs: [500, 1000, 2000, 4000, 8000], // client: hello.resume tries after a drop, each this long after the last
```

`renderer/ui/net-panels.js` — replace `    get confirming() { return p.confirming },` with:

```js
    get confirming() { return p.confirming },
    // What is up right now: 'confirm', 'results', 'wait', 'picker' or null
    // (game.js updates the picker's live countdown only while it is shown).
    get showing() { return p.confirming ? 'confirm' : p.ended ? (p.standings ? 'results' : 'wait') : p.picker ? 'picker' : null },
    // Draw the current panel again after something else covered it — the
    // Reconnecting… overlay, once the seat is back (4b spec §2).
    refresh() { if (p.confirming) ui.confirm(); else show() },
```

`renderer/net/client.js`:
- Replace the header comment (the first four lines) with:

```js
// The browser side of a PvP room (spec §2-§3): the connection, a fixed 30 Hz
// input loop, your predicted hero, everyone else interpolated, and a
// ready-to-draw view — and, when the socket drops after the welcome, the
// way back into the same seat (4b spec §2). The WebSocket constructor and
// the clock are passed in, so Node tests run the very same code with `ws`.
// No DOM.
```

- Replace the whole `connect` function with:

```js
// status: 'connecting' → 'open' (welcomed) → 'reconnecting' (dropped, trying
// hello.resume) → 'open' again, or it ends in 'left' (we closed it), 'lost'
// or 'error' (a refusal). `hello` may itself be { resume: token } (a
// reloaded tab going back to its seat). token: the seat token from the
// latest welcome. lostAt/attempt/retryAt: the reconnect schedule.
export function connect({ url, hello, WebSocketImpl = globalThis.WebSocket, now = () => performance.now() }) {
  const s = {
    status: 'connecting', error: null, room: null, heroId: null, arena: 'pillars', map: arenaMap(), now,
    url, WebSocketImpl, token: hello?.resume ?? null, lostAt: null, attempt: 0, retryAt: null,
    pred: null, interp: makeInterp(), others: new Map(), meView: null, seq: 0, acc: 0, held: { attack: false, alt: false },
    lastFrame: null, lastView: null, lastPingAt: -Infinity, ping: null,
    events: [], cues: [], feedback: makeFeedback(), closedByUs: false, over: false,
  }
  openSocket(s, hello)
  return s
}

// Every socket's handlers check it is still the session's own: an attempt
// that was abandoned for a newer one, or the socket that dropped, is
// ignored from then on.
function openSocket(s, hello) {
  const ws = s.ws = new s.WebSocketImpl(s.url)
  ws.onopen = () => ws.send(encode({ type: MSG.HELLO, v: NET.protocolVersion, ...hello }))
  ws.onmessage = ev => { if (s.ws === ws) onMessage(s, decode(ev.data), s.now()) }
  ws.onclose = () => { if (s.ws === ws) onClose(s, s.now()) }
}

// The session is over for good: one 'closed' event, then nothing more.
function end(s, status) {
  if (s.over) return
  s.over = true
  if (s.status !== 'error') s.status = status
  pushEvent(s, { type: 'closed', status: s.status })
}

function onClose(s, t) {
  // A resume attempt that got no welcome: tickReconnect starts the next one
  // when its time comes; after the last one there is nothing left to try.
  if (s.status === 'reconnecting') {
    if (s.attempt >= NET.reconnectDelaysMs.length) end(s, 'lost')
    return
  }
  // An unexpected drop after the welcome: try to get the seat back.
  if (s.status === 'open' && !s.closedByUs && s.token) {
    s.status = 'reconnecting'
    s.lostAt = t
    s.attempt = 0
    s.retryAt = t + NET.reconnectDelaysMs[0]
    pushEvent(s, { type: 'reconnecting' })
    return
  }
  end(s, s.closedByUs ? 'left' : 'lost')
}

// Called every frame while reconnecting: the next hello.resume when its
// time comes — 0.5, 1, 2, 4 and 8 s apart — for as long as the server can
// still be holding the seat. A tab that comes back after the grace (rAF
// stops while it is hidden) gives up at once instead of trying a seat that
// is surely gone.
function tickReconnect(s, t) {
  if (t < s.retryAt) return
  const delays = NET.reconnectDelaysMs
  if (s.attempt >= delays.length || t - s.lostAt > NET.reconnectGraceMs) {
    const hanging = s.ws
    end(s, 'lost')
    hanging.close()
    return
  }
  const abandoned = s.ws
  s.attempt++
  s.retryAt = s.attempt < delays.length ? t + delays[s.attempt] : s.lostAt + NET.reconnectGraceMs
  openSocket(s, { resume: s.token })
  abandoned.close()                                    // the dropped socket, or an attempt still hanging
}

// Back in: the old predictor and snapshot buffer describe a connection that
// is gone, and the server numbers this socket's inputs afresh. The next
// snapshot rebuilds the view.
function resetSession(s) {
  s.pred = null
  s.interp = makeInterp()
  s.others = new Map()
  s.meView = null
  s.seq = 0
  s.acc = 0
  s.held = { attack: false, alt: false }
  s.lastFrame = null
  s.lastPingAt = -Infinity
}

function refuse(s, code) {
  const reconnect = s.status === 'reconnecting'
  s.status = 'error'
  s.error = code
  pushEvent(s, { type: 'error', code, ...(reconnect && { reconnect: true }) })
}
```

- `const ALWAYS_KEPT_EVENTS = new Set(['closed', 'error', 'welcome', 'matchEnd', 'matchStart'])` → `const ALWAYS_KEPT_EVENTS = new Set(['closed', 'error', 'welcome', 'reconnecting', 'matchEnd', 'matchStart'])`.
- In `setArena`, replace its refusal branch body

```js
    s.status = 'error'; s.error = ERR.VERSION
    pushEvent(s, { type: 'error', code: ERR.VERSION })
    s.ws.close()
    return false
```

  with

```js
    refuse(s, ERR.VERSION)
    s.ws.close()
    return false
```

- In `onMessage`, replace the `WELCOME` and `ERROR` branches

```js
  if (msg.type === MSG.WELCOME) {
    if (!setArena(s, msg.arena)) return
    s.status = 'open'; s.room = msg.room; s.heroId = msg.heroId
    pushEvent(s, { type: 'welcome', room: msg.room, heroId: msg.heroId })
  } else if (msg.type === MSG.ERROR) {
    s.status = 'error'; s.error = msg.code
    pushEvent(s, { type: 'error', code: msg.code })
  }
```

  with

```js
  if (msg.type === MSG.WELCOME) {
    if (!setArena(s, msg.arena)) return
    const resumed = s.status === 'reconnecting'
    if (resumed) resetSession(s)
    s.status = 'open'; s.room = msg.room; s.heroId = msg.heroId; s.token = msg.token ?? null
    s.lostAt = null; s.attempt = 0; s.retryAt = null
    pushEvent(s, { type: 'welcome', room: msg.room, heroId: msg.heroId, token: s.token, resumed })
  } else if (msg.type === MSG.ERROR) {
    // While reconnecting, only two refusals are final: the seat is gone, or
    // the server is a newer build. Anything else (rate_limited, server_full)
    // costs just that one attempt.
    if (s.status === 'reconnecting') {
      if (msg.code === ERR.RESUME_FAILED) end(s, 'lost')
      else if (msg.code === ERR.VERSION) refuse(s, msg.code)
      return
    }
    refuse(s, msg.code)
  }
```

  (the `PONG` and `SNAP` branches after it are unchanged).
- The first line of `frame`'s body `  if (s.status !== 'open') return` becomes:

```js
  if (s.status === 'reconnecting') { tickReconnect(s, t); return }
  if (s.status !== 'open') return
```

- Replace `leave` with:

```js
// A deliberate leave says bye first, so the server frees the seat at once
// instead of holding it for the reconnect grace.
export function leave(s) {
  if (s.status === 'open') s.ws.send(encode({ type: MSG.BYE }))
  s.closedByUs = true
  // Leave on the Reconnecting… overlay: no further attempts.
  if (s.status === 'reconnecting') end(s, 'left')
  s.ws.close()
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/net-*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/net/client.js renderer/data/net.js renderer/ui/net-panels.js test/net-client.test.js test/net-panels.test.js test/net-play.test.js test/net-reconnect.test.js
git commit -m "feat(net): the client reconnects into its seat — resume at 0.5/1/2/4/8 s, session reset, panels refresh

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 8: The live countdown, the Reconnecting… overlay and the stored seat (menu + game.js)

**Files:**
- Modify: `renderer/ui/menu.js`, `renderer/ui/pvp-hud.js`, `renderer/game.js`
- Test: `test/menu.test.js`, `test/pvp-ui.test.js`

**Interfaces:**
- Consumes: `panels.showing`, `panels.refresh()` (Task 7); session events `reconnecting`, `welcome { token, resumed }`, `error { code, reconnect? }`, `closed { status }` (Task 7); `connect({ hello: { resume } })` (Task 7).
- Produces:
  - `menu.setSubtitle(text)`: updates (or creates, right under the title) the current screen's subtitle node; never re-renders; a no-op with no screen up;
  - `menu.showClassPicker({ title, subtitle, lines = [], onPick, onBack })`;
  - `respawnLine(respawnT) → 'Back in N'` (in `renderer/ui/pvp-hud.js`);
  - `game.js`: `startNet({ …, resume })`, `showReconnecting()`, `showNetEnd(ev)`, the `sessionStorage` key `'dc-pvp-seat'`.

- [ ] **Step 1: Write the failing tests**

`test/menu.test.js`:
- The first menu import becomes `import { formatMetaSummary, navActionFor, showTitle, showClassPicker, showTextEntry, showMessage, setSubtitle } from '../renderer/ui/menu.js'`.
- In `stubDomWithKeys`'s `makeEl`, replace `      appendChild(c) { el.children.push(c); return c },` with:

```js
      appendChild(c) { el.children.push(c); c.parent = el; return c },
      after(n) { const sib = el.parent.children; sib.splice(sib.indexOf(el) + 1, 0, n); n.parent = el.parent },
```

- Append:

```js

describe('setSubtitle', () => {
  const texts = overlay => overlay.children[0].children.map(c => `${c.tag}:${c.textContent}`)
  it('updates the subtitle in place: same buttons, same selection', () => {
    const { overlay, press } = stubDomWithKeys()
    try {
      let picked = null
      showClassPicker({ title: 'Down!', subtitle: 'Back in 3', lines: ['Class for your next life'], onPick: c => { picked = c } })
      const before = overlay.children[0].children.filter(c => c.tag === 'button')
      press('s')                                            // select Archer
      setSubtitle('Back in 2')
      assert.deepEqual(texts(overlay).slice(0, 3), ['h1:Down!', 'div:Back in 2', 'div:Class for your next life'])
      assert.deepEqual(overlay.children[0].children.filter(c => c.tag === 'button'), before)
      press('Enter')
      assert.equal(picked, 'archer')
    } finally {
      delete globalThis.document
      delete globalThis.window
    }
  })
  it('a screen without a subtitle gets one right under the title; after hide() it does nothing', () => {
    const { overlay } = stubDomWithKeys()
    try {
      showMessage({ title: 'Reconnecting…', lines: ['a line'] })
      setSubtitle('x')
      assert.deepEqual(texts(overlay).slice(0, 3), ['h1:Reconnecting…', 'div:x', 'div:a line'])
      setSubtitle('y')
      assert.equal(texts(overlay).filter(t => t === 'div:y').length, 1)
      hide()
      assert.doesNotThrow(() => setSubtitle('z'))
    } finally {
      delete globalThis.document
      delete globalThis.window
    }
  })
})
```

`test/pvp-ui.test.js`:
- `import { pvpHudModel } from '../renderer/ui/pvp-hud.js'` → `import { pvpHudModel, respawnLine } from '../renderer/ui/pvp-hud.js'`.
- Append:

```js

describe('respawnLine', () => {
  it('counts the respawn down in whole seconds, rounding up', () => {
    assert.equal(PVP.respawnDelay, 3)
    assert.deepEqual([3, 2.01, 2, 1.5, 0.2].map(respawnLine), ['Back in 3', 'Back in 3', 'Back in 2', 'Back in 2', 'Back in 1'])
  })
  it('a hero not counting down yet (alive, or its first dead snapshot not in) reads the full delay', () => {
    for (const t of [0, -0.03, null, undefined]) assert.equal(respawnLine(t), `Back in ${PVP.respawnDelay}`)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/menu.test.js test/pvp-ui.test.js`
Expected: FAIL: `setSubtitle` and `respawnLine` are not exported.

- [ ] **Step 3: Implement**

`renderer/ui/menu.js`:
- After `let currentInput = null` (top of file) add:

```js
// The current screen's title and subtitle nodes, for setSubtitle.
let currentTitle = null
let currentSubtitle = null
```

- In `renderScreen`, replace

```js
  panel.appendChild(h)

  if (subtitle) {
    const s = document.createElement('div')
    s.className = 'menu-subtitle'
    s.textContent = subtitle
    panel.appendChild(s)
  }
```

  with

```js
  panel.appendChild(h)
  currentTitle = h
  currentSubtitle = null

  if (subtitle) {
    const s = document.createElement('div')
    s.className = 'menu-subtitle'
    s.textContent = subtitle
    panel.appendChild(s)
    currentSubtitle = s
  }
```

- Replace the head of `hide`

```js
export function hide() {
  clearKeyHandler()
  currentInput = null
```

  with

```js
// Change the current screen's subtitle in place (the death picker's live
// "Back in N"): no re-render, so the buttons, the selection and the key
// handler stay as they are. A screen without one gets it right under the
// title. No screen up: nothing to do.
export function setSubtitle(text) {
  if (!currentTitle) return
  if (!currentSubtitle) {
    currentSubtitle = document.createElement('div')
    currentSubtitle.className = 'menu-subtitle'
    currentTitle.after(currentSubtitle)
  }
  currentSubtitle.textContent = text
}

export function hide() {
  clearKeyHandler()
  currentInput = null
  currentTitle = null
  currentSubtitle = null
```

- Replace the head of `showClassPicker`

```js
// PvP: pick a class — before a local match, and while dead (applies at respawn).
export function showClassPicker({ title = 'Arena', subtitle = 'Pick a class', onPick, onBack }) {
  renderScreen({
    title, subtitle,
```

  with

```js
// PvP: pick a class — before a local match, and while dead (applies at
// respawn; the subtitle then counts down, the hint sits in `lines`).
export function showClassPicker({ title = 'Arena', subtitle = 'Pick a class', lines = [], onPick, onBack }) {
  renderScreen({
    title, subtitle, lines,
```

`renderer/ui/pvp-hud.js` — insert before `// The online counterpart to pvpHudModel`:

```js
// The death picker's live subtitle, from the local hero's respawnT. A hero
// not (yet) counting down — the frame the kill event lands, before its
// first dead snapshot — reads as the full PVP.respawnDelay.
export const respawnLine = respawnT => `Back in ${Math.ceil(respawnT > 0 ? respawnT : PVP.respawnDelay)}`

```

`renderer/game.js`:
- `import { pvpHudModel, updatePvpHud, hidePvpHud, netHudModel } from './ui/pvp-hud.js'` → `import { pvpHudModel, updatePvpHud, hidePvpHud, netHudModel, respawnLine } from './ui/pvp-hud.js'`.
- In `pvpFrame`, replace the local kill branch

```js
    if (ev.type === 'kill' && ev.victim === LOCAL_ID) {
      pvp.picking = true
      keys[' '] = false
      menu.showClassPicker({ title: 'Down!', subtitle: 'Class for your next life — back in 3 s',
        onPick: cls => { setClass(match, LOCAL_ID, cls); pvp.cls = cls; pvp.picking = false; menu.hide(); keys[' '] = false } })
    }
```

  with

```js
    if (ev.type === 'kill' && ev.victim === LOCAL_ID) {
      pvp.picking = true
      keys[' '] = false
      pvp.backLine = respawnLine(match.heroes.find(h => h.id === LOCAL_ID)?.respawnT)
      menu.showClassPicker({ title: 'Down!', subtitle: pvp.backLine, lines: ['Class for your next life'],
        onPick: cls => { setClass(match, LOCAL_ID, cls); pvp.cls = cls; pvp.picking = false; menu.hide(); keys[' '] = false } })
    }
```

- In `pvpFrame`, right after the events loop (before the comment `// Once the results panel is up the match world is frozen …`), insert:

```js
  // The death picker counts the respawn down live (4b spec §5).
  if (pvp.picking) {
    const line = respawnLine(match.heroes.find(h => h.id === LOCAL_ID)?.respawnT)
    if (line !== pvp.backLine) { pvp.backLine = line; menu.setSubtitle(line) }
  }
```

- After the `saveName` line add:

```js
// The seat token of the online match this tab is in (4b spec §2): per tab,
// gone with the tab, so a reload can take the same hero back.
const SEAT_KEY = 'dc-pvp-seat'
const loadSeat = () => { try { return sessionStorage.getItem(SEAT_KEY) } catch { return null } }
const saveSeat = t => { try { if (t) sessionStorage.setItem(SEAT_KEY, t) } catch {} }
const clearSeat = () => { try { sessionStorage.removeItem(SEAT_KEY) } catch {} }
```

- In `netPanelUi`, replace the `picker:` entry

```js
    picker: () => { drop(); menu.showClassPicker({ title: 'Down!', subtitle: 'Class for your next life — back in 3 s',
      onPick: cls => { sendClass(s, cls); net?.panels.picked() } }) },
```

  with

```js
    picker: () => {
      drop()
      if (net) net.backLine = respawnLine(net.respawnT)
      menu.showClassPicker({ title: 'Down!', subtitle: net?.backLine ?? respawnLine(0), lines: ['Class for your next life'],
        onPick: cls => { sendClass(s, cls); net?.panels.picked() } })
    },
```

- Replace the head of `startNet`

```js
function startNet({ name, cls, kind, room }) {
  const hello = kind === 'quick' ? { name, cls, quick: true }
```

  with

```js
// resume: a stored seat token — a reloaded tab going back to its hero.
function startNet({ name, cls, kind, room, resume }) {
  const hello = resume ? { resume }
    : kind === 'quick' ? { name, cls, quick: true }
```

- In `startNet`, replace

```js
  net = { s, theme: PVP_ARENAS.pillars.theme, map: null, muted: loadMutedPref(), kind, panels: makeNetPanels(netPanelUi(s)) }
  state = null
  menu.showMessage({ title: kind === 'quick' ? 'Finding a match…' : 'Connecting…', onOk: stopNet, okLabel: 'Cancel' })
```

  with

```js
  // respawnT / backLine: the local hero's last respawnT and the death
  // picker's subtitle as last drawn, for the live countdown.
  net = { s, theme: PVP_ARENAS.pillars.theme, map: null, muted: loadMutedPref(), kind, panels: makeNetPanels(netPanelUi(s)),
    respawnT: 0, backLine: null }
  state = null
  if (resume) showReconnecting()
  else menu.showMessage({ title: kind === 'quick' ? 'Finding a match…' : 'Connecting…', onOk: stopNet, okLabel: 'Cancel' })
```

- Replace the head of `stopNet`

```js
function stopNet() {
  if (net) netLeave(net.s)
  net = null
```

  with

```js
const showReconnecting = () => menu.showMessage({ title: 'Reconnecting…', onOk: stopNet, okLabel: 'Leave' })

// The refusal or loss that ends an online session. A drop that could not be
// resumed is "Connection lost" — with the reload line when the server turned
// out to be a newer build.
function showNetEnd(ev) {
  clearSeat()
  const lost = ev.type === 'closed' || ev.reconnect || ev.code === 'resume_failed'
  const lines = ev.type === 'closed' || ev.code === 'resume_failed' ? [] : [errorText(ev.code)]
  menu.showMessage({ title: lost ? 'Connection lost' : errorTitle(ev.code, net.kind), lines, onOk: stopNet })
}

function stopNet() {
  if (net) netLeave(net.s)
  clearSeat()
  net = null
```

- In `netFrame`'s events loop, replace the first three branches

```js
    if (ev.type === 'welcome') menu.hide()
    else if (ev.type === 'error') { menu.showMessage({ title: errorTitle(ev.code, net.kind), lines: [errorText(ev.code)], onOk: stopNet }); return }
    else if (ev.type === 'closed' && ev.status === 'lost') { menu.showMessage({ title: 'Connection lost', onOk: stopNet }); return }
```

  with

```js
    if (ev.type === 'welcome') {
      saveSeat(ev.token)
      // Back from a drop: whatever the overlay covered (the picker, the
      // results, the leave confirm) comes back.
      if (ev.resumed) panels.refresh()
      else menu.hide()
    }
    else if (ev.type === 'reconnecting') showReconnecting()
    else if (ev.type === 'error' || (ev.type === 'closed' && ev.status === 'lost')) { showNetEnd(ev); return }
```

  (the `kill`/`respawn`/`matchEnd`/`matchStart` branches after them are unchanged).
- In `netFrame`, after `  panels.sync({ ended: v.ended, dead: v.me.dead })` insert:

```js
  net.respawnT = v.me.respawnT
  if (panels.showing === 'picker') {
    const line = respawnLine(v.me.respawnT)
    if (line !== net.backLine) { net.backLine = line; menu.setSubtitle(line) }
  }
```

- In `init()`, after the `goTitle()` call add:

```js
  // A tab reloaded mid-match goes straight back to its hero (4b spec §2).
  const seat = window.saveAPI?.isWeb ? loadSeat() : null
  if (seat) startNet({ kind: 'quick', resume: seat })
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --check renderer/game.js && node --test test/menu.test.js test/pvp-ui.test.js test/net-*.test.js`
Expected: PASS.

Then: `grep -rnE '\b(document|window|localStorage|sessionStorage)\b' renderer/net renderer/pvp renderer/data renderer/ui/net-panels.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add renderer/ui/menu.js renderer/ui/pvp-hud.js renderer/game.js test/menu.test.js test/pvp-ui.test.js
git commit -m "feat(pvp): live respawn countdown, Reconnecting… overlay, seat kept in sessionStorage and resumed on reload

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 9: Local live checks and docs

**Files:**
- Scratch (not committed): `/tmp/claude-1000/-home-lappemikb-projects-dungeon-crawler/170eab54-57f1-4834-98b0-cda083c36a9c/scratchpad/live-4b.mjs`, run from a git-ignored copy `debug-4b-live.mjs` in the repo root (`debug*.mjs` is in `.gitignore`)
- Modify (not committed): `/home/lappemikb/CLAUDE.md`

- [ ] **Step 1: The live-check script**

The script runs the web server **in-process** on port 8092, with 8 s matches and a 1 s results screen so the rotation comes round quickly, and reads the lobby directly. Write it in the scratchpad as `live-4b.mjs`:

```js
// Local 4b checks: the four arenas in rotation, the live respawn countdown,
// a drop-and-resume through the Reconnecting… overlay, a reload back into
// the same hero, and a clean leave. Run from the repo root:
//   node debug-4b-live.mjs <outdir>
import http from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { attachPvp } from './server/pvp-server.js'
import { makeStaticHandler } from './server/static.js'

const out = process.argv[2]
const server = http.createServer(makeStaticHandler(path.resolve('renderer')))
const pvp = attachPvp(server, { matchLength: 8, resultsDelay: 1 })
await new Promise(r => server.listen(8092, '127.0.0.1', r))
const BASE = 'http://127.0.0.1:8092'
const errors = []
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(fn, ms = 15000) {
  const end = Date.now() + ms
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await sleep(50) }
}
const room = () => [...pvp.lobby.rooms.values()][0]
const aino = () => room()?.match.heroes.find(h => h.name === 'Aino')
const browser = await chromium.launch()
const p = await browser.newPage({ viewport: { width: 1280, height: 720 } })
p.on('pageerror', e => errors.push(e.message))
// Every WebSocket the page opens, so the check can kill one from the page.
await p.addInitScript(() => {
  const W = window.WebSocket
  window.__sockets = []
  window.WebSocket = class extends W { constructor(...a) { super(...a); window.__sockets.push(this) } }
})
await p.goto(BASE); await p.waitForSelector('.menu-btn')
await p.click('.menu-btn:has-text("Online")')
await p.click('.menu-btn:has-text("Quick match")')
await p.fill('.menu-input', 'Aino'); await p.keyboard.press('Enter')
await p.click('.menu-btn:has-text("Warrior")')
await until(() => aino())
const heroId = aino().id
const protect = () => { aino().spawnProtect = 1e9 }             // no deaths in the screenshots
protect()
await sleep(1500)

// 1. The live countdown: die, read the subtitle twice a second apart.
Object.assign(aino(), { spawnProtect: 0, hp: 0 })
await p.waitForSelector('.menu-title:has-text("Down!")')
const count1 = await p.locator('.menu-subtitle').first().textContent()
await sleep(1100)
const count2 = await p.locator('.menu-subtitle').first().textContent()
await p.screenshot({ path: `${out}/countdown.png` })
await until(async () => await p.locator('#menu-overlay').isHidden())
protect()

// 2. The four arenas, in rotation.
const arenas = []
for (const id of ['pillars', 'glade', 'tunnels', 'ruins']) {
  await until(() => room().match.arena.id === id && !room().match.ended, 30000)
  protect()
  await until(async () => await p.locator('#menu-overlay').isHidden())
  await sleep(800)
  await p.screenshot({ path: `${out}/arena-${id}.png` })
  arenas.push(id)
}

// 3. Drop and resume: kill the socket from the page.
const seatBefore = await p.evaluate(() => sessionStorage.getItem('dc-pvp-seat'))
await p.evaluate(() => window.__sockets.at(-1).close())
await p.waitForSelector('.menu-title:has-text("Reconnecting…")', { timeout: 2000 })
const awayDuring = room().players.get(heroId)?.away
await p.screenshot({ path: `${out}/reconnecting.png` })
await until(async () => await p.locator('#menu-overlay').isHidden(), 5000)
const afterResume = { away: room().players.get(heroId)?.away, sameHero: !!room().match.heroes.find(h => h.id === heroId && h.name === 'Aino'),
  sockets: room().sockets.size, humans: room().players.size }
const seatAfter = await p.evaluate(() => sessionStorage.getItem('dc-pvp-seat'))
await sleep(500)
await p.screenshot({ path: `${out}/resumed.png` })

// 4. A reload goes back to the same hero.
await p.reload()
await until(() => room().players.get(heroId)?.away === false && room().sockets.size === 1, 8000)
await until(async () => await p.locator('#menu-overlay').isHidden(), 5000)
const afterReload = { humans: room().players.size, heroIds: [...room().players.keys()] }

// 5. A clean leave frees the seat at once and forgets the token.
await p.keyboard.press('Escape'); await p.click('.menu-btn:has-text("Leave")')
const t0 = Date.now()
await until(() => pvp.lobby.rooms.size === 0, 3000)
const leftMs = Date.now() - t0
const seatAfterLeave = await p.evaluate(() => sessionStorage.getItem('dc-pvp-seat'))

console.log(JSON.stringify({ heroId, count1, count2, arenas, seatBefore, awayDuring, afterResume, seatAfter, afterReload, leftMs,
  seatAfterLeave, tokens: pvp.tokens.size, errors }, null, 1))
await browser.close()
pvp.close(); server.close()
```

- [ ] **Step 2: Run it (time-boxed, about 2 minutes)**

```bash
SP=/tmp/claude-1000/-home-lappemikb-projects-dungeon-crawler/170eab54-57f1-4834-98b0-cda083c36a9c/scratchpad
cd /home/lappemikb/projects/dungeon-crawler && cp "$SP/live-4b.mjs" debug-4b-live.mjs && timeout 180 node debug-4b-live.mjs "$SP"; rm -f debug-4b-live.mjs
```

Expected:
- `count1` is `"Back in 3"` and `count2` is `"Back in 2"` (the subtitle counts down without a re-render);
- `arenas` is `["pillars","glade","tunnels","ruins"]`;
- `seatBefore` and `seatAfter` are both 32 hex characters, and differ;
- `awayDuring` is `true`; `afterResume` is `{ away: false, sameHero: true, sockets: 1, humans: 1 }`;
- `afterReload` is `{ humans: 1, heroIds: ["p1"] }` (the same hero id as `heroId`);
- `leftMs` is under 500; `seatAfterLeave` is `null`; `tokens` is 0;
- `errors` is `[]`.

Read the screenshots in the scratchpad:
- `arena-pillars.png`: today's dark red look;
- `arena-glade.png`: the outdoors ruleset over the green-dark background, rings of columns;
- `arena-tunnels.png`: the catacombs moss floor, dark blue tint, heavy fog, narrow corridors;
- `arena-ruins.png`: sand floor, warm tint, open lanes;
- `countdown.png`: "Down!", "Back in N", then "Class for your next life" on its own line;
- `reconnecting.png`: the Reconnecting… overlay with Leave; `resumed.png`: the match again, no overlay.

If anything fails, fix the cause (with a test where the cause lies in pure code) and re-run once. Do not extend the time box beyond that. Report to the user, without changing the theme, if the glade's outdoors floor (the ruleset's `tile_0048`) reads too close to the ruins' sand.

- [ ] **Step 3: Docs (outside the repo, not committed)**

In `/home/lappemikb/CLAUDE.md`, in the dungeon-crawler `renderer/pvp/` bullet:
- change `the shared protocol v2 (`protocol.js`)` to `the shared protocol v3 (`protocol.js`)`;
- after the sentence ending `…with your input neutral while it is up.` add:

```markdown
Sub-project 4b (spec `docs/superpowers/specs/2026-09-26-pvp-4b-arenas-reconnect-design.md`): matches rotate through `PVP_ARENA_ORDER` = pillars, glade, tunnels, ruins (`renderer/data/pvp-arenas.js`; the new three are `parseArena` grids — `#` wall, `o` column, `S`/`F`/`Q`/`R` — with a `DEPTH_THEMES`-shaped `theme`; `test/pvp-arenas.test.js` holds every arena to 6 spawns ≥ 6 tiles apart, 2 F, 2 Q, 1 R ≥ 5 tiles from spawns, all reachable), online per room (`room.arenaIndex`) and in the local mode's "Next match"; `welcome`/`snap` carry `arena` and the client rebuilds and re-themes its map. A dropped socket keeps its seat `away` for `NET.reconnectGraceMs` = 20 s (hero stands still, no bot fill, idle kick suspended): `welcome.token` (128-bit hex, server memory + the tab's `sessionStorage['dc-pvp-seat']`, never logged) → `hello { resume }`, retried at 0.5/1/2/4/8 s behind a "Reconnecting…" overlay, and a reloaded tab resumes too; `bye` (Leave) frees the seat at once. `interp.js` runs a smoothed, monotonic clock (10 % slew, snap past 15 ticks); melee rewind is capped at 9 ticks (300 ms); the death picker counts "Back in N" live via `menu.setSubtitle`.
```

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: PASS. `git status` shows no stray `debug-4b-*.mjs` files.

**After merge (controller, with the user's go-ahead — not part of any task):**
1. Fast-forward `web-release` from `main` in the `.claude/worktrees/three-game-modes` worktree, push both branches, and run `tools/deploy-web.sh`. See the web-release memory for the public URL.
2. **Public-URL check:** two browsers quick-join the public URL (the same room: both HUDs show the same code); play into the next match and see the arena change on both; kill one tab's socket from its DevTools console (or toggle the network off for ~3 s) and see "Reconnecting…" lead back into the same hero.
3. Update the deploy memory (new revision, 4b live).

---

## Self-review

- **Spec coverage.** §1 arenas and rotation → Tasks 1–2 (format, legend, `parseArena`, `config.walls`, themes, invariants, online/local rotation, protocol v3 `arena`, map rebuild + chunk-cache drop via a new map object, unknown id → the version line). §2 reconnect → Tasks 5–8 (tokens from `crypto.randomBytes`, in-memory `tokens` map, `sessionStorage['dc-pvp-seat']`, away/grace with neutral input and suspended idle kick, expiry → `leaveRoom` + bot refill, `bye`, the fourth hello form with a 32-hex token, the hello bucket, re-seat with a fresh token, `resume_failed` for unknown/expired/reused/live/room-gone, the client's overlay, retries, reset and "Connection lost" incl. the version line). §3 clock → Task 3. §4 rewind → Task 4 (incl. the 150 ms each-way variant). §5 countdown → Task 8. Testing summary: unit and real-socket tests in Tasks 1–8; live checks in Task 9; the public two-browser check in "After merge".
- **Arena grids verified.** The three grids above were checked with a throwaway script before this plan was committed: parsed, counted, built with the real `buildArena` (walls fed in as blockers), BFS-reached and measured. Results: glade 30×22 (min spawn distance 10.00, rune ≥ 6.00 from every spawn, 484/484 floor cells reachable); tunnels 34×24 (12.04, 9.49, 358/358); ruins 36×26 (10.00, 15.00, 780/780). All three have exactly 6 S, 2 F, 2 Q, 1 R, an all-wall border and no unreachable floor. The whole plan was also prototyped task by task in a scratch worktree: every task's tests failed before and passed after its step, `npm test` passed (2936/2936), and the Task 9 live script produced the expected values.
- **Placeholders:** none; every code step carries its code.
- **Type consistency:** `arenaAt`/`nextArenaIndex` (Task 1) are used by rooms, local and `game.js`; `markAway(lobby, room, heroId)`, `resumeSeat(room, heroId)`, `drainExpired(room)` (Task 5) are the names Task 6 imports; `welcome.token`/`resumed`, `reconnecting`, `error.reconnect` (Task 7) are what Task 8 reads; `panels.showing`/`refresh()` (Task 7) are what Task 8 calls; `respawnLine` and `setSubtitle` (Task 8) are defined and used in the same task.
- **Review Focus:** each of the five lines has its test in the owning task (Tasks 5 and 7).
