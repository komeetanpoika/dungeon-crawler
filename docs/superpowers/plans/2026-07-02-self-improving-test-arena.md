# Self-Improving Test Arena Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the level-0 test arena spawn any enemy/chest/player loadout from a gitignored `arena-config.json`, and add an `arena-test` project skill whose journal records each run's key testing question before the run and the agent's criteria assessment after it.

**Architecture:** Game side: `buildArena(config)` in `renderer/systems/map.js` generalizes `buildBossTestArena` (which becomes a thin wrapper, so the default path is provably unchanged); a new `load-arena-config` IPC handler (main.cjs → preload.cjs → `saveAPI`) feeds the config into `generateLevel(0, …, { arena })` when the `level0` cheat fires. Agent side: `.claude/skills/arena-test/` holds `SKILL.md` (mandatory workflow), `arena-log.mjs` (journal/lessons/suggestions logger with pure, testable helpers), and the three markdown knowledge files, un-ignored from git.

**Tech Stack:** Vanilla JS (ES modules), Electron IPC via contextBridge, `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-02-self-improving-test-arena-design.md`

## Global Constraints

- **Default preserved:** with no `arena-config.json` (or a malformed one), `level0` must produce today's boss arena exactly: 26×18 walled room, 1 centered `dragon_boss` (`isBoss: true`), 20 alternating weapon/potion chests on the interior perimeter ring, player at bottom-center. `buildBossTestArena(w, h)` stays exported and behavior-identical (existing `test/boss-test-arena.test.js` must pass untouched).
- Config file: `arena-config.json` at the **repo root**, **gitignored**, plain strict JSON (no comments). Re-read fresh on every `level0` entry.
- Size clamped to min 8×8, max 40×30; default 26×18.
- Unknown enemy kinds / out-of-bounds explicit positions: **that entry skipped with a warning** — never a crash, never dropping the whole config.
- Player spawn wins position conflicts; player `weaponType`/`hp` overrides apply **only at depth 0**.
- Valid enemy kinds: `guard`, `monster` (+`variant`), `dragon`, `crab`, `cyclops`, `wizard`, `dragon_boss`. Chest kinds: `weapon` (+`weaponType`), `potion`.
- Journal score scale: **1–5** (5 = criteria fully met, 1 = not met / test couldn't answer the question). The question+criteria are written to `JOURNAL.md` **before** the run; the score+notes **after**.
- `renderer/systems/` modules stay pure — config reaches `map.js` as a parameter, never via IPC/fs.
- Run tests with `npm test` (= `node --test test/`) from `~/projects/dungeon-crawler`. Suite currently at 397 passing.
- Do not push without the user's say-so.

---

### Task 1: `buildArena(config)` + `generateLevel` arena option

**Files:**
- Modify: `renderer/systems/map.js` (replace `buildBossTestArena` body ~lines 404–442; extend `generateLevel` signature ~line 444)
- Test: `test/arena.test.js` (new)

**Interfaces:**
- Consumes: `createMap`, `TILE`, `WEAPON_TYPES` (already imported in map.js).
- Produces (used by Tasks 2 and 5):
  - `buildArena(config = {}, warn = console.warn)` → `{ map, entitySpawns, playerSpawn, rooms: [] }` — config shape `{ size?: {w,h}, enemies?: [{kind, variant?, x?, y?, isBoss?}], chests?: [{kind, weaponType?, x?, y?}], player?: {x?, y?, weaponType?, hp?} }` (weaponType/hp are consumed by game.js, not here).
  - `buildBossTestArena(width, height)` → unchanged contract (wrapper).
  - `generateLevel(depth, width, height, { skipProps, structures, arena = null })` — depth 0 routes to `buildArena({ size: { w: width, h: height }, ...(arena ?? {}) }, warn)`.

- [ ] **Step 1: Write the failing tests**

Create `test/arena.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildArena, buildBossTestArena, generateLevel } from '../renderer/systems/map.js'

describe('buildArena — default content', () => {
  it('reproduces the original boss arena when no enemies/chests are configured', () => {
    const a = buildArena({ size: { w: 26, h: 18 } })
    const b = buildBossTestArena(26, 18)
    assert.deepEqual(a.entitySpawns, b.entitySpawns)
    assert.deepEqual(a.playerSpawn, { x: 13, y: 16 })
    assert.equal(a.entitySpawns.filter(s => s.kind === 'dragon_boss').length, 1)
    assert.equal(a.entitySpawns.length, 21)
  })
})

describe('buildArena — configured content', () => {
  it('spawns enemies at explicit positions', () => {
    const { entitySpawns } = buildArena({ enemies: [{ kind: 'cyclops', x: 5, y: 5 }, { kind: 'crab', x: 7, y: 7 }] })
    assert.deepEqual(entitySpawns.map(s => [s.kind, s.x, s.y]), [['cyclops', 5, 5], ['crab', 7, 7]])
  })

  it('auto-places enemies without positions inside the walls, no overlaps', () => {
    const { entitySpawns, playerSpawn } = buildArena({ enemies: [{ kind: 'guard' }, { kind: 'guard' }, { kind: 'guard' }] })
    assert.equal(entitySpawns.length, 3)
    const seen = new Set(entitySpawns.map(s => `${s.x},${s.y}`))
    assert.equal(seen.size, 3, 'no two enemies share a cell')
    assert.ok(!seen.has(`${playerSpawn.x},${playerSpawn.y}`), 'none on the player')
    for (const s of entitySpawns) assert.ok(s.x >= 1 && s.x <= 24 && s.y >= 1 && s.y <= 16, 'inside the walls')
  })

  it('passes variant and isBoss through', () => {
    const { entitySpawns } = buildArena({ enemies: [
      { kind: 'monster', variant: 'medium', x: 4, y: 4 },
      { kind: 'wizard', x: 6, y: 6, isBoss: true },
    ] })
    assert.equal(entitySpawns[0].variant, 'medium')
    assert.equal(entitySpawns[1].isBoss, true)
  })

  it('skips unknown kinds and out-of-bounds positions with warnings, keeps the rest', () => {
    const warnings = []
    const { entitySpawns } = buildArena({ enemies: [
      { kind: 'balrog', x: 5, y: 5 },
      { kind: 'guard', x: 0, y: 5 },
      { kind: 'guard', x: 99, y: 5 },
      { kind: 'crab', x: 5, y: 6 },
    ] }, msg => warnings.push(msg))
    assert.deepEqual(entitySpawns.map(s => s.kind), ['crab'])
    assert.equal(warnings.length, 3)
  })

  it('empty enemies array yields a valid empty arena', () => {
    const { entitySpawns, map } = buildArena({ enemies: [] })
    assert.equal(entitySpawns.length, 0)
    assert.equal(map.length, 18)
    assert.equal(map[0].length, 26)
  })

  it('places configured chests (explicit position + auto on the perimeter ring)', () => {
    const { entitySpawns } = buildArena({ enemies: [], chests: [
      { kind: 'weapon', weaponType: 'axe', x: 3, y: 3 },
      { kind: 'potion' },
    ] })
    const w = entitySpawns.find(s => s.kind === 'weapon')
    const p = entitySpawns.find(s => s.kind === 'potion')
    assert.deepEqual([w.x, w.y, w.weaponType], [3, 3, 'axe'])
    assert.ok(p.x === 1 || p.x === 24 || p.y === 1 || p.y === 16, 'auto chest lands on the ring')
  })

  it('honors and clamps the player spawn', () => {
    assert.deepEqual(buildArena({ player: { x: 5, y: 5 } }).playerSpawn, { x: 5, y: 5 })
    assert.deepEqual(buildArena({ player: { x: -3, y: 99 } }).playerSpawn, { x: 1, y: 16 })
  })

  it('clamps size to 8×8 … 40×30', () => {
    assert.equal(buildArena({ size: { w: 4, h: 4 }, enemies: [] }).map.length, 8)
    assert.equal(buildArena({ size: { w: 100, h: 100 }, enemies: [] }).map.length, 30)
    assert.equal(buildArena({ size: { w: 100, h: 100 }, enemies: [] }).map[0].length, 40)
  })
})

describe('generateLevel — arena option', () => {
  it('routes a depth-0 arena config through buildArena', () => {
    const { entitySpawns } = generateLevel(0, 26, 18, { arena: { enemies: [{ kind: 'cyclops', x: 10, y: 9 }] } })
    assert.deepEqual(entitySpawns.map(s => [s.kind, s.x, s.y]), [['cyclops', 10, 9]])
  })

  it('defaults to the boss arena without a config', () => {
    const { entitySpawns } = generateLevel(0, 26, 18)
    assert.equal(entitySpawns.filter(s => s.kind === 'dragon_boss').length, 1)
    assert.equal(entitySpawns.length, 21)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/arena.test.js`
Expected: FAIL — `buildArena` is not exported.

- [ ] **Step 3: Implement `buildArena` in map.js**

Replace the whole `buildBossTestArena` function (`renderer/systems/map.js` lines 404–442, keeping the comment style) with:

```js
// Build the level-0 test arena: a single walled room with spawns taken from a
// config ({ size, enemies, chests, player } — every field optional). With
// neither enemies nor chests configured it produces the original debug arena:
// dragon boss centered, 20 weapon/potion chests ringed around the interior
// perimeter. Pure and deterministic; `warn` is injected so tests stay quiet.
export function buildArena(config = {}, warn = console.warn) {
  const clampInt = (v, lo, hi, dflt) =>
    Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : dflt
  const width  = clampInt(config.size?.w, 8, 40, 26)
  const height = clampInt(config.size?.h, 8, 30, 18)

  const map = createMap(width, height) // all TILE.WALL
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++)
      map[y][x].tile = TILE.FLOOR

  const cx = Math.floor(width / 2)
  const cy = Math.floor(height / 2)

  // Player spawn: configured (clamped to the interior) or bottom-center.
  const playerSpawn = {
    x: clampInt(config.player?.x, 1, width - 2, cx),
    y: clampInt(config.player?.y, 1, height - 2, height - 2),
  }

  // Ordered ring of interior-perimeter floor cells (clockwise from top-left),
  // minus the player-spawn cell so a chest never lands on the player.
  const ring = []
  for (let x = 1; x <= width - 2; x++)   ring.push({ x, y: 1 })           // top
  for (let y = 2; y <= height - 2; y++)  ring.push({ x: width - 2, y })   // right
  for (let x = width - 3; x >= 1; x--)   ring.push({ x, y: height - 2 })  // bottom
  for (let y = height - 3; y >= 2; y--)  ring.push({ x: 1, y })           // left
  const ringCells = ring.filter(c => !(c.x === playerSpawn.x && c.y === playerSpawn.y))

  const entitySpawns = []

  // Default content — exactly the original boss arena — when the config
  // specifies neither enemies nor chests.
  if (config.enemies === undefined && config.chests === undefined) {
    entitySpawns.push({ kind: 'dragon_boss', x: cx, y: cy, isBoss: true })
    const weaponKeys = Object.keys(WEAPON_TYPES)
    const CHEST_COUNT = 20
    for (let i = 0; i < CHEST_COUNT; i++) {
      const cell = ringCells[Math.round(i * ringCells.length / CHEST_COUNT) % ringCells.length]
      if (i % 2 === 0) {
        entitySpawns.push({ kind: 'weapon', x: cell.x, y: cell.y, weaponType: weaponKeys[(i / 2) % weaponKeys.length] })
      } else {
        entitySpawns.push({ kind: 'potion', x: cell.x, y: cell.y })
      }
    }
    return { map, entitySpawns, playerSpawn, rooms: [] }
  }

  const occupied = new Set([`${playerSpawn.x},${playerSpawn.y}`])
  const inBounds = (x, y) => x >= 1 && x <= width - 2 && y >= 1 && y <= height - 2

  // Deterministic auto-placement: the free interior cell closest to the
  // center (Chebyshev), row-major tie-break.
  function nextFreeCell() {
    let best = null, bestD = Infinity
    for (let y = 1; y <= height - 2; y++)
      for (let x = 1; x <= width - 2; x++) {
        if (occupied.has(`${x},${y}`)) continue
        const d = Math.max(Math.abs(x - cx), Math.abs(y - cy))
        if (d < bestD) { bestD = d; best = { x, y } }
      }
    return best
  }

  const ENEMY_KINDS = new Set(['guard', 'monster', 'dragon', 'crab', 'cyclops', 'wizard', 'dragon_boss'])
  for (const e of (Array.isArray(config.enemies) ? config.enemies : [])) {
    if (!e || !ENEMY_KINDS.has(e.kind)) { warn(`arena: unknown enemy kind "${e?.kind}" — skipped`); continue }
    let pos
    if (e.x !== undefined || e.y !== undefined) {
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !inBounds(Math.round(e.x), Math.round(e.y))) {
        warn(`arena: enemy ${e.kind} at (${e.x},${e.y}) out of bounds — skipped`); continue
      }
      pos = { x: Math.round(e.x), y: Math.round(e.y) }
    } else {
      pos = nextFreeCell()
      if (!pos) { warn(`arena: no free cell left for ${e.kind} — skipped`); continue }
    }
    occupied.add(`${pos.x},${pos.y}`)
    entitySpawns.push({
      kind: e.kind, x: pos.x, y: pos.y,
      ...(e.variant !== undefined && { variant: e.variant }),
      ...(e.isBoss && { isBoss: true }),
    })
  }

  // Chests: explicit positions honored; the rest spaced evenly on the ring.
  const chests = Array.isArray(config.chests) ? config.chests : []
  const autoChests = []
  for (const c of chests) {
    if (!c || (c.kind !== 'weapon' && c.kind !== 'potion')) { warn(`arena: unknown chest kind "${c?.kind}" — skipped`); continue }
    if (c.x !== undefined || c.y !== undefined) {
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !inBounds(Math.round(c.x), Math.round(c.y))) {
        warn(`arena: chest at (${c.x},${c.y}) out of bounds — skipped`); continue
      }
      entitySpawns.push({ kind: c.kind, x: Math.round(c.x), y: Math.round(c.y),
        ...(c.kind === 'weapon' && { weaponType: c.weaponType ?? 'dagger' }) })
    } else {
      autoChests.push(c)
    }
  }
  autoChests.forEach((c, i) => {
    const cell = ringCells[Math.round(i * ringCells.length / Math.max(autoChests.length, 1)) % ringCells.length]
    entitySpawns.push({ kind: c.kind, x: cell.x, y: cell.y,
      ...(c.kind === 'weapon' && { weaponType: c.weaponType ?? 'dagger' }) })
  })

  return { map, entitySpawns, playerSpawn, rooms: [] }
}

// Back-compat wrapper — the original debug-arena entry point.
export function buildBossTestArena(width, height) {
  return buildArena({ size: { w: width, h: height } })
}
```

- [ ] **Step 4: Extend `generateLevel`**

Change the signature and depth-0 route (line ~444):

```js
export function generateLevel(depth, width = MAP_W, height = MAP_H, { skipProps = false, structures = {}, arena = null } = {}) {
  if (depth === 0) return buildArena({ size: { w: width, h: height }, ...(arena ?? {}) })
```

(The rest of the function is untouched. When `arena` carries its own `size`, the spread lets it override the width/height arguments — intended.)

- [ ] **Step 5: Run the new tests**

Run: `node --test test/arena.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite (boss-arena tests must pass untouched)**

Run: `npm test`
Expected: PASS, including `test/boss-test-arena.test.js` with zero modifications.

- [ ] **Step 7: Commit**

```bash
git add renderer/systems/map.js test/arena.test.js
git commit -m "feat(arena): parametric buildArena config (enemies/chests/player/size)"
```

---

### Task 2: Config file plumbing (IPC → preload → game.js)

**Files:**
- Modify: `main.cjs` (constants ~line 13; handlers ~line 50)
- Modify: `preload.cjs` (saveAPI object)
- Modify: `renderer/game.js` (`beginRun` ~line 222, `startNewRun` ~line 172)
- Modify: `.gitignore` (add `arena-config.json`)

**Interfaces:**
- Consumes: `generateLevel(…, { arena })` and the config shape from Task 1; `WEAPON_TYPES` (already imported in game.js).
- Produces: `window.saveAPI.loadArenaConfig()` → `Promise<{ config: object|null, error: string|null }>`; `startNewRun(depth, arenaCfg)`; async `beginRun`.

- [ ] **Step 1: main.cjs — the IPC handler**

Add next to the other file constants (~line 13):

```js
const ARENA_CONFIG_FILE = path.join(__dirname, 'arena-config.json')
```

Add with the other `ipcMain.handle` calls (~line 50). Read fresh on every call — no caching — so a test can edit the config and re-enter the arena without relaunching:

```js
ipcMain.handle('load-arena-config', () => {
  if (!fs.existsSync(ARENA_CONFIG_FILE)) return { config: null, error: null }
  try { return { config: JSON.parse(fs.readFileSync(ARENA_CONFIG_FILE, 'utf8')), error: null } }
  catch (e) { return { config: null, error: `arena-config.json: ${e.message}` } }
})
```

- [ ] **Step 2: preload.cjs — expose it**

Add to the `saveAPI` object:

```js
  loadArenaConfig: () => ipcRenderer.invoke('load-arena-config'),
```

- [ ] **Step 3: game.js — fetch on level0 and pass through**

Replace `beginRun` (line ~222):

```js
async function beginRun(depth = 1) {
  setPhase(PHASE.PLAYING)
  menu.hide()
  let arenaCfg = null
  if (depth === 0 && window.saveAPI?.loadArenaConfig) {
    const res = await window.saveAPI.loadArenaConfig()
    if (res?.error) console.warn(res.error)
    arenaCfg = res?.config ?? null
  }
  startNewRun(depth, arenaCfg)
}
```

(`beginRun` is only used as a callback — `onPlay`, `onCheat`, `onRestart`, `onPlayAgain` — so making it async is safe.)

Change `startNewRun` (line ~172) to accept and forward the config:

```js
function startNewRun(depth = 1, arenaCfg = null) {
```

and pass it into `generateLevel` (line ~176):

```js
  const { map, entitySpawns, playerSpawn } =
    generateLevel(depth, cfg.mapW, cfg.mapH, { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]), structures, arena: arenaCfg })
```

After the `player.inventory.push(...getStartingItems(meta))` line (~187), add the depth-0-only player overrides:

```js
  if (depth === 0 && arenaCfg?.player) {
    const po = arenaCfg.player
    const def = WEAPON_TYPES[po.weaponType]
    if (def) player.weapon = { weaponType: po.weaponType, name: def.name, damage: def.damage }
    if (Number.isFinite(po.hp) && po.hp >= 1) {
      player.maxHp = Math.max(player.maxHp, Math.round(po.hp))
      player.hp = Math.round(po.hp)
    }
  }
```

Before writing this block, confirm the held-weapon shape with `grep -n "player.weapon =" renderer/game.js` — the chest-pickup path assigns the chest contents object (`{ type: 'weapon', weaponType, name, damage }` from `buildEntities`' weapon case). The override above matches the fields the game reads (`player.weapon.weaponType` for attacks and sprites); if the grep shows a different shape, mirror that shape instead and note the deviation in your report.

- [ ] **Step 4: gitignore the config**

Add to `.gitignore`:

```
arena-config.json
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (no unit tests cover game.js/main.cjs; end-to-end verification is Task 5).

- [ ] **Step 6: Commit**

```bash
git add main.cjs preload.cjs renderer/game.js .gitignore
git commit -m "feat(arena): load arena-config.json via IPC into the level0 cheat"
```

---

### Task 3: `arena-log.mjs` — journal/lessons/suggestions logger

**Files:**
- Create: `.claude/skills/arena-test/arena-log.mjs`
- Test: `test/arena-log.test.js` (new)

**Interfaces:**
- Produces (used by Task 4's SKILL.md and Task 5):
  - CLI: `node .claude/skills/arena-test/arena-log.mjs open --question "…" --criteria "…"` / `close --score <1-5> --notes "…" [--suggest "…"]` / `suggest --text "…"`
  - Env override `ARENA_LOG_DIR` points the CLI at a different directory (used by tests).
  - Pure exports: `parseEntries(text)`, `formatEntry({id,date,question,criteria,config})`, `closeEntry(text, {score,notes})`, `formatSuggestion({date,runId,text})`, `summarizeConfig(rawJsonOrNull)`.

- [ ] **Step 1: Write the failing tests**

Create `test/arena-log.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawnSync } from 'node:child_process'
import { parseEntries, formatEntry, closeEntry, formatSuggestion, summarizeConfig } from '../.claude/skills/arena-test/arena-log.mjs'

const HEADER = '# Arena Test Journal\n'

describe('arena-log pure helpers', () => {
  it('formatEntry → parseEntries roundtrip', () => {
    const text = HEADER + formatEntry({ id: 1, date: '2026-07-02', question: 'Q?', criteria: 'C', config: 'cyclops' })
    const entries = parseEntries(text)
    assert.equal(entries.length, 1)
    assert.deepEqual([entries[0].id, entries[0].date, entries[0].status], [1, '2026-07-02', 'OPEN'])
  })

  it('closeEntry closes the newest OPEN entry with score and notes', () => {
    let text = HEADER
      + formatEntry({ id: 1, date: '2026-07-01', question: 'A?', criteria: 'a', config: '-' })
      + formatEntry({ id: 2, date: '2026-07-02', question: 'B?', criteria: 'b', config: '-' })
    text = closeEntry(text, { score: 4, notes: 'mostly met' })
    const entries = parseEntries(text)
    assert.equal(entries[0].status, 'OPEN', 'older entry untouched')
    assert.equal(entries[1].status, 'CLOSED')
    assert.ok(text.includes('**Score:** 4/5'))
    assert.ok(text.includes('**Notes:** mostly met'))
  })

  it('closeEntry throws when nothing is OPEN', () => {
    const closed = closeEntry(HEADER + formatEntry({ id: 1, date: 'd', question: 'q', criteria: 'c', config: '-' }), { score: 5, notes: 'n' })
    assert.throws(() => closeEntry(closed, { score: 5, notes: 'n' }), /no OPEN/)
  })

  it('formatSuggestion links the run id', () => {
    assert.equal(formatSuggestion({ date: '2026-07-02', runId: 3, text: 'add hp per enemy' }),
      '- [NEW] 2026-07-02 (run 3): add hp per enemy\n')
  })

  it('summarizeConfig lists enemy kinds, handles missing/invalid input', () => {
    assert.equal(summarizeConfig('{"enemies":[{"kind":"cyclops"},{"kind":"monster","variant":"medium"}]}'), 'cyclops, monster(medium)')
    assert.equal(summarizeConfig('{"enemies":[]}'), '(no enemies)')
    assert.equal(summarizeConfig(null), '(default boss arena)')
    assert.equal(summarizeConfig('not json'), '(default boss arena)')
  })
})

describe('arena-log CLI', () => {
  it('open appends an entry; close closes it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-log-'))
    fs.writeFileSync(path.join(dir, 'JOURNAL.md'), HEADER)
    fs.writeFileSync(path.join(dir, 'SUGGESTIONS.md'), '# Suggestions\n')
    const script = path.resolve('.claude/skills/arena-test/arena-log.mjs')
    const env = { ...process.env, ARENA_LOG_DIR: dir }

    let r = spawnSync('node', [script, 'open', '--question', 'Q?', '--criteria', 'C'], { env, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    let journal = fs.readFileSync(path.join(dir, 'JOURNAL.md'), 'utf8')
    assert.equal(parseEntries(journal)[0].status, 'OPEN')

    r = spawnSync('node', [script, 'close', '--score', '5', '--notes', 'met', '--suggest', 'idea'], { env, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    journal = fs.readFileSync(path.join(dir, 'JOURNAL.md'), 'utf8')
    assert.equal(parseEntries(journal)[0].status, 'CLOSED')
    assert.ok(fs.readFileSync(path.join(dir, 'SUGGESTIONS.md'), 'utf8').includes('idea'))
  })

  it('open warns about existing OPEN entries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-log-'))
    fs.writeFileSync(path.join(dir, 'JOURNAL.md'), HEADER + formatEntry({ id: 1, date: 'd', question: 'q', criteria: 'c', config: '-' }))
    fs.writeFileSync(path.join(dir, 'SUGGESTIONS.md'), '# Suggestions\n')
    const script = path.resolve('.claude/skills/arena-test/arena-log.mjs')
    const r = spawnSync('node', [script, 'open', '--question', 'Q2?', '--criteria', 'C2'],
      { env: { ...process.env, ARENA_LOG_DIR: dir }, encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.match(r.stderr, /OPEN/, 'warning about the unclosed entry goes to stderr')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/arena-log.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the script**

Create `.claude/skills/arena-test/arena-log.mjs`:

```js
#!/usr/bin/env node
// Arena-test journal/lessons/suggestions logger — see SKILL.md for the
// workflow. Pure text helpers are exported for tests; the CLI wraps them
// with file I/O rooted at this directory (override with ARENA_LOG_DIR).
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const DIR = process.env.ARENA_LOG_DIR ?? path.dirname(SELF)
const REPO = path.resolve(path.dirname(SELF), '../../..')
const JOURNAL = path.join(DIR, 'JOURNAL.md')
const SUGGESTIONS = path.join(DIR, 'SUGGESTIONS.md')
const CONFIG = path.join(REPO, 'arena-config.json')

// ── pure helpers ───────────────────────────────────────────────────────────

export function parseEntries(text) {
  const out = []
  const re = /^## Run (\d+) — (\S+) — (OPEN|CLOSED)$/gm
  let m
  while ((m = re.exec(text))) out.push({ id: Number(m[1]), date: m[2], status: m[3], index: m.index })
  return out
}

export function formatEntry({ id, date, question, criteria, config }) {
  return `\n## Run ${id} — ${date} — OPEN\n**Question:** ${question}\n**Criteria:** ${criteria}\n**Config:** ${config}\n**Score:** —\n**Notes:** —\n`
}

export function closeEntry(text, { score, notes }) {
  const entries = parseEntries(text)
  const open = entries.filter(e => e.status === 'OPEN')
  if (open.length === 0) throw new Error('no OPEN journal entry to close')
  const last = open[open.length - 1]
  const next = entries.find(e => e.index > last.index)
  const end = next ? next.index : text.length
  let block = text.slice(last.index, end)
  block = block.replace(' — OPEN', ' — CLOSED')
  block = block.replace('**Score:** —', `**Score:** ${score}/5`)
  block = block.replace('**Notes:** —', `**Notes:** ${notes}`)
  return text.slice(0, last.index) + block + text.slice(end)
}

export function formatSuggestion({ date, runId, text }) {
  return `- [NEW] ${date} (run ${runId ?? '—'}): ${text}\n`
}

export function summarizeConfig(raw) {
  if (raw == null) return '(default boss arena)'
  try {
    const cfg = JSON.parse(raw)
    const kinds = (cfg.enemies ?? []).map(e => e.kind + (e.variant ? `(${e.variant})` : ''))
    return kinds.length ? kinds.join(', ') : '(no enemies)'
  } catch { return '(default boss arena)' }
}

// ── CLI ────────────────────────────────────────────────────────────────────

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const today = () => new Date().toISOString().slice(0, 10)
const die = (msg) => { console.error(msg); process.exit(1) }

function cmdOpen() {
  const question = arg('question'), criteria = arg('criteria')
  if (!question || !criteria) die('usage: arena-log.mjs open --question "…" --criteria "…"')
  const text = fs.readFileSync(JOURNAL, 'utf8')
  const entries = parseEntries(text)
  const open = entries.filter(e => e.status === 'OPEN')
  if (open.length) console.error(
    `WARNING: ${open.length} OPEN entr${open.length > 1 ? 'ies' : 'y'} never closed (run ${open.map(e => e.id).join(', ')}) — a past test skipped its assessment.`)
  const id = (entries[entries.length - 1]?.id ?? 0) + 1
  const config = summarizeConfig(fs.existsSync(CONFIG) ? fs.readFileSync(CONFIG, 'utf8') : null)
  fs.appendFileSync(JOURNAL, formatEntry({ id, date: today(), question, criteria, config }))
  console.log(`opened run ${id}`)
}

function cmdClose() {
  const score = Number(arg('score')), notes = arg('notes')
  if (!Number.isInteger(score) || score < 1 || score > 5 || !notes)
    die('usage: arena-log.mjs close --score <1-5> --notes "…" [--suggest "…"]')
  const text = fs.readFileSync(JOURNAL, 'utf8')
  let closed
  try { closed = closeEntry(text, { score, notes }) } catch (e) { die(e.message) }
  fs.writeFileSync(JOURNAL, closed)
  const entries = parseEntries(closed)
  const runId = entries[entries.length - 1]?.id
  console.log(`closed run ${runId}: ${score}/5`)
  const suggestion = arg('suggest')
  if (suggestion) {
    fs.appendFileSync(SUGGESTIONS, formatSuggestion({ date: today(), runId, text: suggestion }))
    console.log('suggestion recorded')
  }
}

function cmdSuggest() {
  const text = arg('text')
  if (!text) die('usage: arena-log.mjs suggest --text "…"')
  const entries = parseEntries(fs.readFileSync(JOURNAL, 'utf8'))
  const runId = entries[entries.length - 1]?.id ?? null
  fs.appendFileSync(SUGGESTIONS, formatSuggestion({ date: today(), runId, text }))
  console.log('suggestion recorded')
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const cmd = process.argv[2]
  if (cmd === 'open') cmdOpen()
  else if (cmd === 'close') cmdClose()
  else if (cmd === 'suggest') cmdSuggest()
  else die('usage: arena-log.mjs <open|close|suggest> …')
}
```

Note: `JOURNAL.md`/`SUGGESTIONS.md` don't exist in the real directory until Task 4 — the tests use `ARENA_LOG_DIR` temp dirs, so ordering is fine.

- [ ] **Step 4: Run the tests**

Run: `node --test test/arena-log.test.js`
Expected: PASS.

- [ ] **Step 5: Full suite, commit**

Run: `npm test` — expected PASS. Then (the `-f` is because `.claude/` is still fully gitignored until Task 4 — force-add just this script):

```bash
git add -f .claude/skills/arena-test/arena-log.mjs
git add test/arena-log.test.js
git commit -m "feat(arena-test): journal/lessons/suggestions logger with pure helpers"
```

---

### Task 4: The arena-test skill (SKILL.md + knowledge files + gitignore)

**Files:**
- Create: `.claude/skills/arena-test/SKILL.md`, `.claude/skills/arena-test/JOURNAL.md`, `.claude/skills/arena-test/LESSONS.md`, `.claude/skills/arena-test/SUGGESTIONS.md`
- Modify: `.gitignore` (un-ignore `.claude/skills/`)

**Interfaces:**
- Consumes: the CLI commands from Task 3; the config schema from Task 1; the existing `.claude/skills/run-game/driver.mjs`.
- Produces: the skill workflow agents follow; the three knowledge files at their permanent paths.

- [ ] **Step 1: Un-ignore the skills directory**

In `.gitignore`, replace the `.claude/` line:

```
.claude/*
!.claude/skills/
```

(A parent-excluded directory can't have children re-included, so `.claude/` must become `.claude/*` for the negation to work. This also starts tracking the existing `.claude/skills/run-game/driver.mjs` — intended: the arena workflow depends on it. `.claude/worktrees`, locks, etc. stay ignored via `.claude/*`.)

Verify: `git check-ignore .claude/skills/arena-test/SKILL.md` → exits 1 (not ignored); `git check-ignore .claude/worktrees` → exits 0 (still ignored).

- [ ] **Step 2: Write SKILL.md**

Create `.claude/skills/arena-test/SKILL.md`:

````markdown
---
name: arena-test
description: Use when testing bosses, enemies, combat, or rendering in the running dungeon-crawler game — spawns a configurable level-0 arena and enforces the self-improving test journal (question saved before the run, criteria assessment after).
---

# Arena Test

Run gameplay tests in the configurable level-0 arena. The workflow below is
mandatory — the journal is how arena testing improves itself across sessions.

## Workflow

1. **Read `LESSONS.md` in this directory. Always. Before anything else.**

2. Formulate ONE key testing question and explicit pass criteria:
   - Question — what you need to find out: "Does the cyclops charge telegraph give the player time to dodge?"
   - Criteria — the observable outcome that means "yes": "charge windup renders visibly for ≥1s before movement starts"

3. Open the journal entry BEFORE running anything (the question must survive a crashed run):

   ```bash
   node .claude/skills/arena-test/arena-log.mjs open --question "…" --criteria "…"
   ```

   If it warns about OPEN entries, a past run skipped its assessment — mention that in your final report.

4. Write `arena-config.json` at the repo root (gitignored, strict JSON). Syntax:

   ```json
   {
     "size": { "w": 26, "h": 18 },
     "enemies": [
       { "kind": "cyclops", "x": 13, "y": 6 },
       { "kind": "monster", "variant": "medium" }
     ],
     "chests": [ { "kind": "weapon", "weaponType": "axe" }, { "kind": "potion" } ],
     "player": { "x": 13, "y": 16, "weaponType": "sword", "hp": 20 }
   }
   ```

   - Every field optional; omit the file entirely for the default dragon-boss arena.
   - Enemy kinds: `guard`, `monster` (variants `weak`/`medium`/`strong`/`boss`), `dragon`, `crab`, `cyclops`, `wizard`, `dragon_boss`. Omit `x`/`y` to auto-place near the center.
   - Chest kinds: `weapon` (`weaponType`: `dagger`/`sword`/`longsword`/`axe`), `potion`. Omit positions to auto-place on the perimeter.
   - `player`: spawn position plus optional `weaponType` and `hp` overrides.
   - Size clamps to 8×8 … 40×30. Bad entries are skipped with a console warning, never a crash.
   - The file is re-read every time the level0 cheat fires — edit and re-enter the arena, no relaunch needed.

5. Run the game with the driver:

   ```bash
   node .claude/skills/run-game/driver.mjs
   ```

   Then on its prompt: `launch`, wait for the title screen, type the cheat with
   `press l`, `press e`, `press v`, `press e`, `press l`, `press 0` — the arena
   starts immediately. Observe with `ss <name>` (screenshots) and `eval <expr>`.
   On WSLg set `DISPLAY=:0`.

6. Close the entry with your assessment of how well the criteria were met:

   ```bash
   node .claude/skills/arena-test/arena-log.mjs close --score <1-5> --notes "why"
   ```

   Score: 5 = criteria fully met · 3 = partially met / ambiguous · 1 = not met, or the test could not answer the question. The notes must say **why**.

7. **Lesson step:** if the run taught something reusable (spawn-placement trick, timing gotcha, driver pitfall), append ONE imperative line to `LESSONS.md`.

8. **Suggestion step:** if the run exposed friction or an opportunity — a missing arena capability, a harness limitation, a game bug — record it:

   ```bash
   node .claude/skills/arena-test/arena-log.mjs suggest --text "…"
   ```

   (or add `--suggest "…"` to the close command).

9. Cleanup: `quit` the driver; `git status --porcelain renderer/data/` must be empty (restore `painter-maps.json` if not — editor autosave hazard). `arena-config.json` may stay (gitignored) or be deleted.
````

- [ ] **Step 3: Seed the knowledge files**

Create `.claude/skills/arena-test/JOURNAL.md`:

```markdown
# Arena Test Journal

Append-only record of arena test runs, managed by `arena-log.mjs` — do not hand-edit entries. Each run saves its key testing question and criteria before the game runs, and the tester's 1–5 assessment of how well the criteria were met after.
```

Create `.claude/skills/arena-test/LESSONS.md`:

```markdown
# Arena Test Lessons

Read this before every arena test. Append one imperative line when a run teaches something reusable — this file is why run N+1 goes better than run N.

- Launch via `.claude/skills/run-game/driver.mjs` (`launch` → `press`/`ss`/`eval`/`quit`); on WSLg set `DISPLAY=:0`.
- Type the level0 cheat on the title screen one key at a time: `press l`, `press e`, `press v`, `press e`, `press l`, `press 0`.
- `arena-config.json` is re-read on every level0 entry — edit the config and re-enter the arena instead of relaunching Electron.
- Screenshots land in `$SCREENSHOT_DIR` (default `/tmp/shots`) via the driver's `ss` command.
- After any automated run, `git status --porcelain renderer/data/` must be clean (editor autosave hazard) — restore `painter-maps.json` if it changed.
```

Create `.claude/skills/arena-test/SUGGESTIONS.md`:

```markdown
# Arena Test Suggestions

Feature ideas harvested from test runs (`arena-log.mjs suggest`). Format: `- [NEW|DONE] date (run N): suggestion`. Flip NEW → DONE when implemented.
```

- [ ] **Step 4: Verify tracking and run the suite**

```bash
git add .gitignore .claude/skills/
git status --short   # arena-test files + run-game/driver.mjs staged; nothing else from .claude/
npm test             # expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(arena-test): self-improving test-arena skill (journal, lessons, suggestions)"
```

---

### Task 5: End-to-end verification (first real journal run)

**Files:**
- No repo files. Creates the transient `arena-config.json` and the first real `JOURNAL.md` entry.

This task executes the skill's own workflow once, for real — it verifies the game plumbing AND exercises the journal loop end-to-end.

- [ ] **Step 1: Full suite**

Run: `npm test` — record the summary (expect all passing).

- [ ] **Step 2: Open a journal entry**

```bash
node .claude/skills/arena-test/arena-log.mjs open \
  --question "Does the parametric arena spawn a configured cyclops instead of the dragon boss?" \
  --criteria "level0 with a cyclops config shows exactly one cyclops (with held club), no dragon boss, player spawn honored"
```

- [ ] **Step 3: Write the config**

Create `arena-config.json` at the repo root:

```json
{
  "enemies": [ { "kind": "cyclops", "x": 13, "y": 6 } ],
  "chests": [ { "kind": "weapon", "weaponType": "axe" } ],
  "player": { "x": 13, "y": 15, "weaponType": "sword" }
}
```

- [ ] **Step 4: Drive the game and observe**

Use the run-game driver (per SKILL.md step 5; `DISPLAY=:0` on this machine): `launch`, screenshot the title, `press l e v e l 0` (one `press` per key), screenshot the arena. Read the screenshots: expect one cyclops (carrying its club) in the upper-middle, an axe chest on the ring, the player at bottom-center, NO dragon boss. Also verify the default path: `quit`, delete `arena-config.json`, relaunch, `level0` again, screenshot — the dragon boss arena with its 20 chests must appear (config absence → old behavior).

- [ ] **Step 5: Close the journal entry honestly**

```bash
node .claude/skills/arena-test/arena-log.mjs close --score <observed 1-5> --notes "<what the screenshots actually showed>"
```

If the run surfaced a lesson or a suggestion, record them per SKILL.md steps 7–8.

- [ ] **Step 6: Cleanup checks**

```bash
git status --porcelain renderer/data/   # must be empty
git status --short                       # only .claude/skills/arena-test/JOURNAL.md (and possibly LESSONS/SUGGESTIONS) modified
rm -f arena-config.json
```

- [ ] **Step 7: Commit the journal's first entry**

```bash
git add .claude/skills/arena-test/
git commit -m "test(arena-test): first end-to-end arena run recorded in the journal"
```
