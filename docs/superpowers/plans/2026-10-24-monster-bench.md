# Monster Bench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run bench -- <name>` opens the Electron game in an arena with one monster and a live tuning panel. Edits apply at once and Save writes them to the monster's JSON. A scaffold creates new monsters, and a `monster-mechanics` skill holds the workflow.

**Architecture:** Tuning lives in the monster JSON (`tuning`), validated against a `TUNING_SCHEMA` the hook module exports. This is the rig `PARAM_SCHEMA` pattern again, reusing `schema.js`. All bench runtime code lives in `tools/monster-bench/`. The web root is `renderer/`, so none of it is ever served. `game.js` imports it dynamically, only when `?bench=` is set and the preload offers `benchSave`. `game.js` hands it a small seam object and consults three bench hooks per frame: frame delta, freeze test and overlay draw. Damage goes through a new observer hook in `player-damage.js`. `main.cjs` owns save (read-modify-write through `monster-files.cjs`) and the file watcher that reloads the page.

**Tech Stack:** Electron 30, vanilla ES modules (no bundler), `node:test`, `playwright-core` driver.

**Spec:** `docs/superpowers/specs/2026-10-24-monster-bench-design.md`

## Global Constraints

- Vanilla JS, no bundler, no new dependencies.
- `npm test` stays green; CI requires the `test (22)` check on `main`.
- Generated monsters never join `CREATURE_TYPES`; names stay out of `RESERVED_NAMES` (two hand-synced lists: `renderer/systems/monsters.js`, `tools/monster-lab/monster-files.cjs`).
- Normal boot never imports bench code; the web build (`renderer/` + `web-shim.js`) cannot enter the bench.
- Save rewrites only `renderer/data/monsters/<name>.json`, plus `index.json` only when it adds a name.
- Overlay drawing stays cheap (software canvas): a few dozen shapes per frame.
- After any scripted Electron run: `git status --porcelain renderer/data/` must show only intended changes; restore `painter-maps.json` if touched.
- UI rules: no text bars, colour-only buttons, no emoji in controls.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **A key held while clicking into the panel.** The hero must not keep walking: focusing the panel clears held keys. *(Test in Task 5.)*
2. **The JSON changes on disk while the panel has unsaved edits** (Claude edits the file). After the reload, the unsaved values win for keys still in the schema, and the dirty marker stays. *(Test in Task 4.)*
3. **A tuning value in the JSON out of range, or a key not in the schema** (hand-edited, or left over after Claude renames a key). It is clamped or dropped with a warning, and never crashes the load. *(Test in Task 1.)*
4. **A hook module with no `TUNING_SCHEMA`, or an invalid one,** like Podeboo today, or a typo. The monster still loads with `tuning = {}`, and the panel shows no tuning section. *(Test in Task 1.)*
5. **Save while the bench's own watcher is live.** The write must not reload the page and wipe the panel. *(Test in Task 3.)*

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `renderer/systems/monsters.js` | modify | read `TUNING_SCHEMA`, store `tuning`/`tuningSchema`/`hookModule` on the def; `tuningOf`, `retuneMonster` |
| `renderer/systems/player-damage.js` | modify | `setDamageObserver` hook |
| `tools/monster-lab/monster-files.cjs` | modify | skip unchanged index write; `updateMonster` read-modify-write |
| `tools/monster-lab/save-body.js` | create | pure: def body the lab saves (keeps unknown fields like `tuning`) |
| `tools/monster-lab/main.js` | modify | use `saveBody` |
| `tools/monster-bench/watch-filter.cjs` | create | pure: which file changes reload the bench |
| `tools/monster-bench/bench-state.js` | create | pure: panel model (values, dirty keys, switches), sessionStorage round trip, save patch |
| `tools/monster-bench/bench-core.js` | create | pure-ish: damage observer, frame delta, freeze test, respawn spawn list, bench arena config |
| `tools/monster-bench/overlay.js` | create | hitbox + hook `debugDraw` drawing |
| `tools/monster-bench/panel.js` | create | DOM panel (reuses `tools/monster-lab/params-panel.js`) |
| `tools/monster-bench/bench.js` | create | `startBench(seam)`: wires core + panel + overlay + reload |
| `tools/monster-bench/scaffold.mjs` | create | `scaffoldMonster`, `hookSource`, `testSource`, `defFor` |
| `tools/monster-bench/new-monster.mjs` | create | CLI wrapper for the scaffold |
| `main.cjs`, `preload.cjs`, `package.json` | modify | `--bench`, IPC, watcher, npm script |
| `renderer/game.js` | modify | bench boot + seam + three per-frame hook calls + restart keeps bench config |
| `.claude/skills/run-game/driver.mjs` | modify | `DC_EXTRA_ARGS` |
| `.claude/skills/monster-mechanics/SKILL.md`, `LESSONS.md` | create | the skill |
| `.claude/skills/arena-test/SKILL.md` | modify | registry kinds, `DC_EXTRA_ARGS` |

---

### Task 1: Tuning in the monster registry

**Files:**
- Modify: `renderer/systems/monsters.js` (`registerMonsters`, new exports)
- Test: `test/monsters.test.js` (add a `describe('tuning', …)` block)

**Interfaces:**
- Produces:
  - Registry entry (`getMonsterDef(name)`) gains `tuningSchema: Array|null`, `tuning: object` (the live object, mutated in place by the bench), `hookModule: object|null`.
  - `tuningOf(type: string) -> object`: the live `tuning` object, or a shared frozen `{}` for unknown types.
  - `retuneMonster(name: string, { stats?: object, behavior?: object }) -> boolean`: merges into the def's `stats`/`behavior` (replacing `behavior` numeric fields given), re-derives `stats.half` from `rig.hitHalf(params)` when the rig has one, and calls `registerMonsterAI(name, { speed, half, ...behavior })` again. Returns false for an unknown name.

- [ ] **Step 1: Write the failing tests** in `test/monsters.test.js`, using the injected `loadRig`/`loadHooks` pattern the file already uses. The `loadHooks` stub returns a module object:

```js
const SCHEMA = [
  { key: 'cooldown', label: 'Cooldown', group: 'attack', type: 'range', min: 0.5, max: 10, step: 0.1, default: 2, hint: 's between attacks' },
  { key: 'enraged', label: 'Enraged', group: 'attack', type: 'toggle', default: false },
]
it('clamps def tuning against the hook TUNING_SCHEMA', async () => {
  const warns = []
  await registerMonsters([{ name: 'tuned', rig: 'quadruped', hooks: true, tuning: { cooldown: 99, bogus: 1 } }],
    { loadRig, loadHooks: async () => ({ TUNING_SCHEMA: SCHEMA }), warn: m => warns.push(m) })
  assert.deepEqual(getMonsterDef('tuned').tuning, { cooldown: 10, enraged: false })
  assert.ok(warns.some(w => /clamped/.test(w)) && warns.some(w => /bogus/.test(w)))
})
it('tuningOf returns the same live object the def holds', …)          // tuningOf('tuned') === getMonsterDef('tuned').tuning
it('a hook without TUNING_SCHEMA loads with empty tuning', …)          // loadHooks: async () => ({}) → tuning {}, tuningSchema null
it('a legacy loadHooks returning undefined still loads', …)            // loadHooks: async () => undefined → loaded count 1, tuning {}
it('an invalid TUNING_SCHEMA warns and is ignored', …)                 // schema [{ key: 'x', type: 'range' }] → warn matches /TUNING_SCHEMA/, tuningSchema null
it('accepts a hint field in the schema', …)                            // schemaErrors(SCHEMA) deepEqual []
it('retuneMonster re-registers the AI row with new speed', …)          // retuneMonster('tuned', { stats: { speed: 140 } }) → getAIConfig({ type: 'tuned' }).speed === 140
it('tuningOf on an unknown type is an empty object', …)                // deepEqual {}
```

`getAIConfig(e)` (it takes an entity) comes from `renderer/data/enemy-ai.js`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/monsters.test.js`
Expected: FAIL (`tuningOf` / `retuneMonster` not exported; `tuning` undefined).

- [ ] **Step 3: Implement in `renderer/systems/monsters.js`**

`registerMonsters` keeps the module `loadHooks` returns, `mod`. If `Array.isArray(mod?.TUNING_SCHEMA)` and `schemaErrors(...)` is empty, then `tuningSchema = mod.TUNING_SCHEMA` and `tuning = clampParams(schema, raw.tuning ?? {}, m => warn(\`monsters: ${name}: tuning ${m}\`))`. If the schema has errors, warn `monsters: ${name}: bad TUNING_SCHEMA (…) — ignored` and use `{}`. Set the three fields on the registry entry after the hooks load. The entry still exists when hooks fail to load, with `tuning: {}`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/monsters.test.js test/podeboo.test.js test/kivihiisi.test.js test/hirvi.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `feat(monsters): tuning values validated against a hook's TUNING_SCHEMA`

---

### Task 2: Damage observer

**Files:**
- Modify: `renderer/systems/player-damage.js`
- Test: `test/player-damage.test.js` (exists; add a `describe('damage observer', …)` block using its helpers)

**Interfaces:**
- Produces: `setDamageObserver(fn | null)`. `fn(state, player, amount, kind) -> number` runs after block, protect and soak, and before `player.hp -= amount`. Its return value is what `hp` loses; a non-finite return means "unchanged". The float text shows the pre-observer amount. I-frames (`invulnTimer`) are set as before for `'hit'`.

- [ ] **Step 1: Write the failing tests**

```js
afterEach(() => setDamageObserver(null))
it('observer can zero the hp loss but the float shows the would-be damage', () => {
  setDamageObserver(() => 0)
  const state = mkState(); damagePlayer(state, 3, 'hit')
  assert.equal(state.player.hp, 10)
  assert.equal(lastFloat(state).text, '-3')
  assert.ok(state.player.invulnTimer > 0)
})
it('observer sees the amount after outfit protect', …)   // player wearing protect 1, damage 3 → observer receives 2
it('no observer: behaviour unchanged', …)                // hp 10 → 7
it('observer not called for a blocked hit', …)
```

Reuse the file's existing state/player helpers. `lastFloat` reads the newest entry of `state.feedback`'s float list (`systems/feedback.js`).

- [ ] **Step 2: Run** `node --test test/player-damage.test.js`. Expected: FAIL (no export).
- [ ] **Step 3: Implement** a module-level `let observer = null`, `export function setDamageObserver(fn) { observer = fn }`, and the call site as specified.
- [ ] **Step 4: Run** `node --test test/player-damage.test.js test/shield.test.js`. Expected: PASS
- [ ] **Step 5: Commit** — `feat(damage): observer hook between mitigation and hp`

---

### Task 3: Monster file IO: save patch, quiet index, lab keeps tuning, watch filter

**Files:**
- Modify: `tools/monster-lab/monster-files.cjs`
- Create: `tools/monster-lab/save-body.js`, `tools/monster-bench/watch-filter.cjs`
- Modify: `tools/monster-lab/main.js` (`els.save.onclick` uses `saveBody`; `renderLibrary`'s click keeps the def's other fields as `work.extra`)
- Test: `test/monster-files.test.js`, `test/monster-lab-save-body.test.js`, `test/bench-watch-filter.test.js`

**Interfaces:**
- Produces:
  - `writeMonster(dir, name, data)`: unchanged signature. It now writes `index.json` only when `name` is not already listed.
  - `updateMonster(dir, name, patch: { tuning?, stats?, behavior? }) -> { ok: true, name }`. Reads `<name>.json` and throws `no monster "<name>"` if it is missing. It shallow-merges `stats` and `behavior` into the existing objects, replaces `tuning` whole, and writes through `writeMonster`. Every other field survives byte-for-byte as a JSON value.
  - `saveBody(work) -> object` (ESM): `{ ...work.extra, rig, params, stats, behavior, ...(spawn?.depths ? { spawn } : {}), ...(hooks ? { hooks: true } : {}) }`, with `name` stripped from `extra`.
  - `shouldReload(relPath: string, now: number, lastWrite: { rel: string, at: number } | null) -> boolean` (CJS). True for `.js`/`.json` paths under `renderer/` (POSIX separators after normalising), except `renderer/data/painter-maps.json`, and except `lastWrite.rel` when `now - lastWrite.at < 1500`.

- [ ] **Step 1: Write the failing tests**

```js
it('does not rewrite index.json when the name is already listed', () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'index.json'), '["a"]'); writeMonster(dir, 'a', { rig: 'quadruped' })
  assert.equal(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'), '["a"]')
})
it('updateMonster merges stats/behavior, replaces tuning, keeps the rest', () => {
  // seed { rig:'quadruped', params:{ a:1 }, stats:{ hp:5, dmg:1 }, behavior:{ taxon:'beast', sightRange:200 }, spawn:null, hooks:true, tuning:{ x:1, y:2 } }
  updateMonster(dir, 'm', { stats: { hp: 9 }, behavior: { sightRange: 300 }, tuning: { x: 5 } })
  // expect stats { hp:9, dmg:1 }, behavior { taxon:'beast', sightRange:300 }, tuning { x:5 }, params/spawn/hooks unchanged
})
it('updateMonster refuses a missing monster', …)                         // throws /no monster "nope"/
// save-body
it('keeps tuning and unknown fields the lab does not edit', …)           // extra { tuning:{ a:1 }, foo:2, name:'x' } → body has tuning, foo, no name
// watch-filter
it('reloads on renderer js/json', …)                                    // 'renderer/systems/monsters/x.js' → true
it('ignores non-renderer paths and other extensions', …)               // 'tools/x.js', 'renderer/assets/a.png' → false
it('ignores painter-maps.json', …)
it('ignores the bench\'s own write for 1.5 s', …)                       // rel 'renderer/data/monsters/m.json', at 1000: now 2000 → false, now 2600 → true
```

- [ ] **Step 2: Run** `node --test test/monster-files.test.js test/monster-lab-save-body.test.js test/bench-watch-filter.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the three modules, then switch `tools/monster-lab/main.js` to `saveBody(work)`. In `renderLibrary`'s `li.onclick`, set `extra: d` (the raw def) on the work object. For a new monster, `extra: {}`.
- [ ] **Step 4: Run** the same command plus `node --test test/monster-lab-server.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(monster-files): updateMonster patch save; lab keeps tuning; quiet index`

---

### Task 4: Bench state model (pure)

**Files:**
- Create: `tools/monster-bench/bench-state.js`
- Test: `test/bench-state.test.js`

**Interfaces:**
- Consumes: registry entry fields from Task 1 (`tuning`, `tuningSchema`, `stats`, `behavior`).
- Produces:
  - `makeBenchModel(def) -> model` with `model.values = { tuning, stats: { hp, dmg, speed }, behavior: { <numeric fields of def.behavior> } }` (copies), `model.dirty: Set<string>` of `'tuning.cooldown'`-style keys, and `model.switches = { frozen: false, invulnerable: false, hitboxes: false, timeScale: 1, paused: false, count: 1, collapsed: false }`.
  - `edit(model, section: 'tuning'|'stats'|'behavior', key, value)`: sets the value and marks the key dirty.
  - `snapshot(model) -> string` (JSON for sessionStorage): the dirty values only, plus the switches. `paused` is not persisted; a reload resumes play.
  - `restore(model, text: string|null, schema)`: applies the switches. For each dirty key in the snapshot that still exists in this model (for tuning: a key in the schema, value re-clamped by `clampParams`), it takes the snapshot value and stays dirty. Snapshot keys that no longer exist are dropped. Bad or empty JSON is ignored.
  - `savePatch(model) -> { tuning, stats, behavior }`: full current values, for `updateMonster`.
  - `markSaved(model)`: clears `dirty`.
  - `storageKey(name) -> 'dc-bench:' + name`.

- [ ] **Step 1: Write the failing tests**

```js
it('restore keeps unsaved tuning over disk values and stays dirty', () => {
  const m1 = makeBenchModel(def({ cooldown: 2 })); edit(m1, 'tuning', 'cooldown', 4.5)
  const m2 = makeBenchModel(def({ cooldown: 3 }))            // disk changed under us
  restore(m2, snapshot(m1), SCHEMA)
  assert.equal(m2.values.tuning.cooldown, 4.5); assert.ok(m2.dirty.has('tuning.cooldown'))
})
it('restore takes disk values for keys not edited', …)
it('restore drops keys no longer in the schema', …)          // snapshot has tuning.gone → absent, not dirty
it('restore re-clamps a value to the current schema range', …)
it('restore applies switches but not paused', …)
it('restore ignores null and malformed text', …)
it('behavior section holds only numeric fields', …)          // def.behavior { taxon:'beast', sightRange:300 } → { sightRange:300 }
it('savePatch returns full values; markSaved clears dirty', …)
```

- [ ] **Step 2: Run** `node --test test/bench-state.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the pure model. No DOM and no game imports except `clampParams` from `renderer/render/monster-rigs/schema.js`.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(bench): panel state model with reload-safe snapshots`

---

### Task 5: Bench core: observer, time, freeze, respawn, arena config, input gate

**Files:**
- Create: `tools/monster-bench/bench-core.js`
- Test: `test/bench-core.test.js`

**Interfaces:**
- Consumes: `setDamageObserver` (Task 2), `retuneMonster` (Task 1), the model from Task 4.
- Produces:
  - `BENCH_KIT = { weaponType: 'sword', rangedType: 'shortbow', wandType: 'sparkwand', ammo: { arrow: 999 }, outfits: ['ranger', 'robe'] }`. No plate, so a hit lands at face value.
  - `benchArenaConfig(name, count) -> object`: `{ size: { w: 26, h: 18 }, player: { x: 13, y: 15, ...BENCH_KIT }, enemies: respawnSpots(count).map(p => ({ kind: name, ...p })) }`.
  - `respawnSpots(count) -> [{x, y}]`: row `y: 4`, x = `13, 10, 16, 7, 19, 4, 22` (first `count`, clamped 1..7).
  - `makeBenchCore(model) -> core` with:
    - `core.tally = { taken: 0, deaths: 0 }`
    - `core.observe(state, player, amount, kind) -> number`: ignores any `player !== state.player`. Otherwise it adds `amount` to `taken`. If `invulnerable`, returns 0. If `amount >= player.hp`, it adds a death, sets `player.hp = player.maxHp`, and returns 0. Else returns `amount`.
    - `core.frameDelta(delta) -> number|null`: `null` while paused, except that one pending step returns `1/60` once. Otherwise returns `delta * timeScale`.
    - `core.step()`: queue one frame while paused.
    - `core.isFrozen(e, name) -> boolean`: `switches.frozen && e.type === name`.
    - `core.respawn(seam, name)`: calls `retuneMonster(name, { stats: model.values.stats, behavior: model.values.behavior })`, removes `state.entities` of type `name`, then `seam.spawn(respawnSpots(count).map(p => ({ kind: name, ...p })))`.
  - `gateKeys(root: HTMLElement, win = window)`: on `focusin` dispatches `new Event('blur')` on `win`, which clears game.js's held keys. It stops propagation of `keydown`/`keyup` at `root`. `Escape` inside the root blurs the active element.

- [ ] **Step 1: Write the failing tests** (node; `gateKeys` with a minimal fake EventTarget pair, a root and a win):

```js
it('invulnerable: tallies, deals nothing', …)                 // observe(state, state.player, 3) → 0, tally.taken 3
it('a killing blow refills hp and counts a death', …)        // hp 2, amount 3 → returns 0, hp === maxHp, deaths 1
it('ignores heroes other than state.player', …)              // returns amount untouched, tally unchanged
it('paused returns null; step yields one 1/60 frame', …)
it('time scale multiplies delta', …)                          // timeScale 0.25, 0.04 → 0.01
it('respawn retunes, removes the type, spawns count fresh', …)// fake seam records spawn list; other entities survive
it('arena config puts the monster 11 rows from the hero', …)  // enemies[0].y 4, player.y 15
it('focusing the panel clears held keys and swallows typing', …) // win receives 'blur'; keydown dispatched on root not seen by a win listener
```

- [ ] **Step 2: Run** `node --test test/bench-core.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(bench): core — damage observer, time scale, freeze, respawn`

---

### Task 6: Electron plumbing, game.js seam, bench boot

**Files:**
- Modify: `main.cjs`, `preload.cjs`, `package.json`, `renderer/game.js`
- Create: `tools/monster-bench/argv.cjs`, `tools/monster-bench/bench.js`
- Test: `test/bench-boot.test.js` (pure parts only: `benchNameFrom(argv)` and `benchQuery(argv)` live in `argv.cjs` so main.cjs and the test share them)

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `argv.cjs`: `benchNameFrom(argv) -> string|null`, which returns the arg after `--bench` if it matches `^[a-z0-9_]+$`, else null. `benchQuery(argv) -> string|undefined` returns `'bench=<name>&dcdebug=1'` in bench mode, `'dcdebug=1'` with `--dcdebug`, and undefined otherwise.
  - `package.json` script: `"bench": "electron . --bench"`.
  - `main.cjs`: `win.loadFile(..., search ? { search } : undefined)`. In bench mode only:
    - `ipcMain.handle('bench-save-monster', (_e, name, patch))`: rejects any name other than the bench's; records `lastWrite = { rel: 'renderer/data/monsters/<name>.json', at: Date.now() }` before calling `updateMonster`.
    - `fs.watch(path.join(__dirname, 'renderer'), { recursive: true })`: builds `rel = 'renderer/' + file`, filters with `shouldReload`, debounces 300 ms, then `win.webContents.send('bench-files-changed', rel)`.
  - `preload.cjs`: `benchSave: (name, patch) => ipcRenderer.invoke('bench-save-monster', name, patch)` and `onBenchFilesChanged: cb => ipcRenderer.on('bench-files-changed', (_e, rel) => cb(rel))`.
  - `game.js`:
    - In `init()`: `const benchName = new URLSearchParams(location.search).get('bench')`. If `benchName && window.saveAPI?.benchSave`, then `bench = await (await import('../tools/monster-bench/bench.js')).startBench(seam)` instead of `goTitle()`.
    - Module `let bench = null`.
    - `seam = { name, getState: () => state, renderer, goTitle, startArena: cfg => beginRun(0, 'arena', cfg), spawn: spawns => state.entities.push(...buildEntities(spawns, state.map, state.level, state.player)) }`.
    - `beginRun(depth, mode, arenaOverride = null)`: when depth is 0, `arenaOverride ?? bench?.arenaConfig() ??` the file read. A pause-menu Restart therefore stays on the bench.
    - `gameLoop`: `const d = bench ? bench.frameDelta(delta) : delta; if (d !== null) update(d)`, and render either way.
    - Enemy loop, right after the npc line: `if (bench?.isFrozen(e)) continue`.
    - `render()`: after `renderer.render(state, fx)`, `bench?.drawOverlay(renderer.ctx, state, renderer)`.
  - `bench.js`: `startBench(seam) -> { arenaConfig(), frameDelta(d), isFrozen(e), drawOverlay(ctx, state, renderer) }`. The order matters, because a restored tweak must be what the monster runs on, not just what the panel shows:
    1. Build the model from `getMonsterDef(seam.name)`.
    2. `restore` it from `sessionStorage[storageKey(name)]` (try/catch).
    3. `Object.assign(def.tuning, model.values.tuning)`.
    4. `retuneMonster(name, { stats, behavior })` from the model.
    5. `setDamageObserver(core.observe)`.
    6. `seam.startArena(benchArenaConfig(name, count))`.
    7. Subscribe `onBenchFilesChanged` to write `snapshot(model)` and call `location.reload()`.

    In this task `drawOverlay` is a no-op. An unknown name logs `monsterNames()` with `console.warn` and falls back to `goTitle()` (the seam carries `goTitle`).

- [ ] **Step 1: Write the failing test** for `argv.cjs`:

```js
it('reads a valid bench name', …)          // ['electron','.','--bench','glorp'] → 'glorp'; query 'bench=glorp&dcdebug=1'
it('rejects a bad bench name', …)          // '--bench','../x' → null
it('keeps --dcdebug alone working', …)     // → 'dcdebug=1'
it('no flags: undefined', …)
```

- [ ] **Step 2: Run** `node --test test/bench-boot.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `argv.cjs`, then the main/preload/package changes, then the game.js seam (keep each edit to the lines named above), then `bench.js`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS, the whole suite. A lone SIGSEGV is the known WSL runner crash, so re-run.
- [ ] **Step 5: Smoke-launch.**
  - Run `DISPLAY=:0 npm run bench -- boarhound`. The arena opens with the boarhound 11 rows north and the hero holding a sword, and Shift reaches Archer and Mage. Close the window.
  - Run `DISPLAY=:0 npm start`. The title screen appears as before. Close it.
  - Check `git status --porcelain renderer/data/` is clean.
- [ ] **Step 6: Commit** — `feat(bench): npm run bench boots an arena on a named monster`

---

### Task 7: Panel and overlay

**Files:**
- Create: `tools/monster-bench/panel.js`, `tools/monster-bench/overlay.js`
- Modify: `tools/monster-bench/bench.js` (mount the panel, real `drawOverlay`)

**Interfaces:**
- Consumes: the model (Task 4), the core and `gateKeys` (Task 5), `bench.js` (Task 6), `buildParamsPanel(container, schema, params, onChange)` from `tools/monster-lab/params-panel.js`, `hitShape(e)` from `renderer/systems/hitbox.js` (returns `{ ax, ay, bx, by, r }`).
- Produces:
  - `panel.js`: `mountPanel(model, core, handlers) -> { refresh(readout) }`. Fixed right-side column, 280 px wide and collapsible, so the arena's centre stays clear.
    - Sections: Tuning (via `buildParamsPanel`, each `hint` as the row's `title`, edits write into the def's live `tuning` object and the model); Stats and behaviour (number inputs with the note "applies on respawn"); Switches; Readout (hp, `hookModule.debugState?.(e)`, tally taken/deaths); Save (dirty marker).
    - Switches: freeze, invulnerable, hitboxes, pause, step, 0.25×/0.5×/1×, count + respawn, full heal.
    - `gateKeys(root)` is applied.
    - The collapse key is `` ` ``, or Tab if the backtick is awkward on the user's Finnish layout. Implementer's choice; document it in the skill.
  - Save handler: `await saveAPI.benchSave(name, savePatch(model))`, then `markSaved(model)`. On a rejection, the dirty marker stays and the error shows in the readout.
  - `overlay.js`: `drawOverlay(ctx, state, renderer, name)`. When hitboxes are on, it strokes every entity's and the player's `hitShape` capsule, in screen space at `x - renderer.camX`. For each entity of type `name` it calls `hookModule.debugDraw?.(ctx, e, renderer.S)` with the ctx translated to the entity's screen centre and wrapped in save/restore. `bench.drawOverlay` also calls `panel.refresh(readout)` at most every 100 ms. The panel writes a DOM node only when its text changed, the same diffing the HUD uses.

- [ ] **Step 1: Write the failing test** for the one pure piece, `capsuleToScreen(shape, camX, camY) -> { ax, ay, bx, by, r }` in `overlay.js`. Test: `test/bench-overlay.test.js`, shape `{ ax: 100, ay: 50, bx: 120, by: 50, r: 8 }` with cam `(40, 10)` gives `{ ax: 60, ay: 40, bx: 80, by: 40, r: 8 }`.
- [ ] **Step 2: Run** `node --test test/bench-overlay.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `overlay.js`, then `panel.js`, then wire both into `bench.js`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Smoke-launch** with `DISPLAY=:0 npm run bench -- podeboo`:
  - The panel shows Stats and behaviour, Switches and Readout, but no Tuning section (Podeboo has no schema).
  - Invulnerable plus a laser hit raises the tally, and hp stays put.
  - Freeze stops it mid-stride.
  - Hitboxes draw capsules.
  - 0.25× slows the laser charge visibly.
  - Typing `20` into hp moves nothing, and Respawn gives it 20 hp.
  - Close the window, and check `git status --porcelain renderer/data/` is clean (no Save was pressed).
- [ ] **Step 6: Commit** — `feat(bench): tuning panel, switches, readout, hitbox overlay`

---

### Task 8: Scaffold

**Files:**
- Create: `tools/monster-bench/scaffold.mjs`, `tools/monster-bench/new-monster.mjs`
- Test: `test/bench-scaffold.test.js`

**Interfaces:**
- Consumes: `writeMonster` (Task 3), `TUNING_SCHEMA`/`tuningOf` contract (Task 1).
- Produces:
  - `defFor(name) -> object`: rig `quadruped`, loud placeholder params (`hideColor '#ff00ff'`, `bellyColor '#00e5ff'`, others at rig defaults), `stats { hp: 10, dmg: 1, speed: 70 }`, `behavior {}`, `hooks: true`, `spawn: null`, `tuning {}`.
  - `hookSource(name) -> string`: the hook module text. Header comment placeholder `// <Name>: describe what it does, how the player sees it coming, how to beat it.` It imports `CREATURE_UPDATE` from `'../creatures.js'` and `tuningOf` from `'../monsters.js'`, and exports `TUNING_SCHEMA` with one `range`: `{ key: 'cooldown', label: 'Cooldown', group: 'attack', type: 'range', min: 0.2, max: 10, step: 0.1, default: 2, hint: 'seconds between attacks' }`. Its `update(e, state, delta)` keeps `e.mech = { state: 'idle', cd }` ticking `cd` down from `tuningOf(e.type).cooldown`, read every frame. It also has `debugState(e) -> string` (`` `${e.mech?.state ?? '-'} cd ${(e.mech?.cd ?? 0).toFixed(2)}` ``), a `debugDraw(ctx, e, S)` stub (empty body with a comment), and `CREATURE_UPDATE.<name> = update`.
  - `testSource(name) -> string`: a `node:test` file that registers the def through `registerMonsters` (injected `loadRig` → the real quadruped rig, `loadHooks` → the real module), then steps `updateMonsterPose` + `update` for 30 frames. It asserts `debugState` returns a string and `tuningOf(name).cooldown === 2`.
  - `scaffoldMonster(name, { monstersDir, hooksDir, testsDir }) -> { files: string[] }`. Throws on an invalid or reserved name (via `writeMonster`), or if any of the three target files already exists (`<name>: already exists (<path>)`). Writes the hook and the test before the JSON, so a refused name leaves nothing behind.
  - `new-monster.mjs <name>`: calls it with the repo dirs, prints the three paths and the bench command.

- [ ] **Step 1: Write the failing tests**

```js
it('writes def, hook and test into the given dirs', …)        // tmp dirs; JSON has hooks:true, tuning:{}, spawn:null; index lists name
it('refuses an existing monster and writes nothing new', …)
it('refuses a reserved name', …)                              // 'guard' → throws /reserved/
it('the generated hook runs in the real registry', async () => {
  // write hookSource('zz_scaffold_probe') to renderer/systems/monsters/zz_scaffold_probe.js,
  // registerMonsters([defFor('zz_scaffold_probe')], { loadHooks: n => import(<file url>) }),
  // step 30 frames, assert debugState string and tuningOf(...).cooldown === 2;
  // finally: unlink the file, clearMonsters()
})
```

- [ ] **Step 2: Run** `node --test test/bench-scaffold.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same, then do an end-to-end check. Run `node tools/monster-bench/new-monster.mjs zz_tmp`, then `node --test test/zz_tmp.test.js` (expected PASS). Then remove the three files and the `index.json` entry, and confirm `git status` is clean.
- [ ] **Step 5: Commit** — `feat(bench): new-monster scaffold`

---

### Task 9: Driver passthrough and arena-test docs

**Files:**
- Modify: `.claude/skills/run-game/driver.mjs` (`launch` args), `.claude/skills/arena-test/SKILL.md`, `.claude/skills/arena-test/SUGGESTIONS.md`

**Interfaces:**
- Produces: `DC_EXTRA_ARGS` (whitespace-split) appended after `APP_DIR` in `launch`.

- [ ] **Step 1:** Implement `args: ['--no-sandbox', APP_DIR, ...(process.env.DC_EXTRA_ARGS?.split(/\s+/).filter(Boolean) ?? [])]`.
- [ ] **Step 2:** Verify by running `printf 'launch\neval location.search\nquit\n' | DISPLAY=:0 DC_EXTRA_ARGS="--bench boarhound" node .claude/skills/run-game/driver.mjs`. Expected output contains `"?bench=boarhound&dcdebug=1"`.
- [ ] **Step 3:** In arena-test `SKILL.md`: the enemy kinds line gains "any registry monster name from `renderer/data/monsters/index.json`". Add a line on `DC_EXTRA_ARGS` (`--dcdebug`, `--bench <name>`). In `SUGGESTIONS.md`, flip runs 18/20/21 (driver args), 4/19 (invulnerable), 13/27/28 (freeze, hitbox overlay) to `[DONE]` with "(monster bench)".
- [ ] **Step 4: Commit** — `chore(skills): driver DC_EXTRA_ARGS; arena-test notes the bench`

---

### Task 10: The monster-mechanics skill

**Files:**
- Create: `.claude/skills/monster-mechanics/SKILL.md`, `.claude/skills/monster-mechanics/LESSONS.md`

- [ ] **Step 1:** Invoke `superpowers:writing-skills` and follow it. That includes its baseline-without-skill pressure test and its with-skill test.
- [ ] **Step 2:** The skill body follows the spec's nine-step outline exactly: lessons, description questions (what it does, how the player sees it coming, how the player beats it), scaffold, test-first build with every number in `TUNING_SCHEMA` plus `debugState`/`debugDraw`, time-boxed self-check in the bench via `DC_EXTRA_ARGS="--bench <name>"` logged with `arena-log.mjs`, handover (`npm run bench -- <name>` + one line per tuning field), tweak loop (read saved JSON first; the bench reloads on edit), wrap-up (`npm test`, `git status`, lesson line), drawing → sprite-sheet pointer. Frontmatter description: "Use when designing, building or tuning a dungeon-crawler monster's mechanics — attacks, movement, telegraphs — with the user describing and tweaking live in the monster bench." It also lists the files the bench touches and the panel's collapse key.
- [ ] **Step 3:** `LESSONS.md` header (copy arena-test's), seeded with the lessons this build taught: for example the reload-on-edit behaviour and the `tuningOf` read-every-frame rule.
- [ ] **Step 4: Commit** — `feat(skills): monster-mechanics skill`

---

### Task 11: Live verification and wrap-up

- [ ] **Step 1:** Open an arena-test journal entry (`arena-log.mjs open`) with the question "Does the bench tune, save and reload a scaffolded monster live?" and the criteria "a panel cooldown edit changes debugState's cd on the next frame; Save writes it to the JSON; editing the hook file reloads the page with the edit kept and the dirty marker gone".
- [ ] **Step 2:** Scaffold `zz_benchcheck`. Launch the driver with `DC_EXTRA_ARGS="--bench zz_benchcheck"`. Drive the panel with `eval`: set cooldown, read the readout, click Save, `cat` the JSON, then touch the hook file and screenshot after the reload. Time-box to about 10 minutes.
- [ ] **Step 3:** Close the journal entry with a score and notes. Remove `zz_benchcheck` (three files plus its `index.json` entry). `git status --porcelain renderer/data/` must be clean.
- [ ] **Step 4:** Add one line to the dungeon-crawler section of `~/CLAUDE.md` (outside the repo, so not committed): "`npm run bench -- <name>` — monster bench (arena + live tuning panel); `node tools/monster-bench/new-monster.mjs <name>` scaffolds; workflow skill `.claude/skills/monster-mechanics/`."
- [ ] **Step 5:** `npm test` green, then use `superpowers:finishing-a-development-branch`.
