# Self-Improving Test Arena — Design

**Date:** 2026-07-02
**Status:** Approved (pending spec review)

## Summary

Two halves that together make boss/enemy testing reusable and self-improving:

1. **Parametric arena (game side):** generalize the existing `level0` dragon-boss
   test arena so a test can spawn **any enemy set**, chest loadout, and player
   loadout from a gitignored `arena-config.json`. No config → today's dragon-boss
   arena, unchanged.
2. **Arena-test skill (agent side):** a project skill in `.claude/skills/arena-test/`
   that every testing agent follows. Before a run it **saves the key testing
   question and pass criteria** to a journal; after the run it **records the
   agent's own assessment of how well the criteria were met** (1–5 + reasoning),
   distills reusable insights into a lessons file, and captures feature
   suggestions the lessons point at. Knowledge compounds across runs — each
   agent starts smarter than the last.

## Background

- `level0` cheat (`parseLevelCheat`, `renderer/systems/cheats.js`) →
  `generateLevel(0, …)` → `buildBossTestArena(width, height)`
  (`renderer/systems/map.js:408`): 26×18 walled room, dragon boss center,
  20 alternating weapon/potion chests, player bottom-center. Spec:
  `2026-06-30-boss-test-arena-design.md`.
- The renderer reads files only through `contextBridge` IPC (`saveAPI.*` in
  `preload.cjs` → `ipcMain.handle` in `main.cjs`).
- `.claude/skills/run-game/driver.mjs` — existing interactive Electron driver
  (launch / press / ss / eval / text / quit) used by agents to drive the game.
- `buildEntities` (game.js) spawn kinds: guard, monster (+variant), dragon,
  crab, cyclops, wizard, dragon_boss, weapon, potion, … Unknown kinds are
  silently dropped.

## Unit 1 — Parametric arena (game side)

### Config file

`arena-config.json` at the **repo root**, **gitignored** (transient test input):

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

Every field optional:

- **No file / unreadable / malformed JSON** → default boss arena (identical to
  today), one `console.warn` when malformed. A test config can never brick the
  title screen.
- **`size`** clamped to sane bounds (min 8×8, max 40×30). Default 26×18.
- **`enemies[]`** — `kind` is any `buildEntities` enemy kind; `variant` for
  monsters; `x`/`y` optional (omitted → auto-spread around the arena center,
  never on walls or the player). Unknown kinds and out-of-bounds positions are
  **skipped with `console.warn`** — only the bad entry is dropped.
- **`chests[]`** — `weapon` (+ optional `weaponType`) or `potion`; positions
  optional (auto-placed on the interior perimeter ring like today).
- **`player`** — optional spawn `x`/`y` (clamped to floor; wins any position
  conflict, existing rule) plus optional `weaponType` and `hp` overrides.

### `buildArena(config)` — `renderer/systems/map.js`

Same contract as `generateLevel`: `{ map, entitySpawns, playerSpawn }`. Walled
rectangle, floor interior, spawns from config. The default boss preset is a
`DEFAULT_BOSS_ARENA` config constant; `buildBossTestArena(w, h)` becomes
`buildArena` applied to it, so the default path provably stays identical. The
module stays pure — config arrives as a parameter.

### Wiring

- **`main.cjs`**: `ipcMain.handle('load-arena-config', …)` — reads
  `<repo>/arena-config.json`, returns parsed JSON or `null` (missing/invalid).
  Read **fresh on every call** so an agent can edit the config and re-enter the
  arena without relaunching Electron.
- **`preload.cjs`**: expose `saveAPI.loadArenaConfig()`.
- **`renderer/game.js`**: when the `level0` cheat starts a run, `await
  saveAPI.loadArenaConfig()` and pass the result through to
  `generateLevel(0, …, arenaConfig)`; `generateLevel` routes depth 0 to
  `buildArena(config ?? DEFAULT_BOSS_ARENA)`. Player `weaponType`/`hp`
  overrides apply in `game.js` after entity build, **depth 0 only** — normal
  runs untouched.

## Unit 2 — Arena-test skill (agent side)

New project skill directory **`.claude/skills/arena-test/`**, checked into git:

### `SKILL.md` — the mandatory workflow

1. **Read `LESSONS.md`** first — non-negotiable; this is where past runs pay off.
2. Formulate **one key testing question** and explicit pass criteria
   (e.g. question: "Does the cyclops charge telegraph give the player time to
   dodge?"; criteria: "charge windup visibly renders ≥1s before movement").
3. `node arena-log.mjs open --question "…" --criteria "…"` — the question is
   saved **before** the run, so it survives a crashed test.
4. Write `arena-config.json` with the enemy set/loadout the question needs.
5. Drive the game with the existing `run-game/driver.mjs`
   (launch → title screen → type `level0` → observe / screenshot).
6. `node arena-log.mjs close --score <1-5> --notes "…"` — the self-assessment
   of **how well the criteria were met**: 5 = fully met, 1 = not met or the
   test could not answer the question. Notes must say *why*.
7. **Lesson step:** if the run taught something reusable (spawn-placement
   trick, timing gotcha, driver pitfall), append one imperative line to
   `LESSONS.md`.
8. **Suggestion step:** if the run exposed friction or an opportunity — a
   missing arena capability, a harness limitation, a game bug or UX improvement
   the lessons point at — record it:
   `node arena-log.mjs suggest --text "…"` (or `--suggest "…"` on `close`).
9. Cleanup: check `git status --porcelain renderer/data/` (editor-autosave
   hazard) and quit the app.

### `arena-log.mjs` — owns the log formats

- `open` — appends a numbered entry to `JOURNAL.md`: id, date, question,
  criteria, one-line config summary, status **OPEN**. Prints any still-OPEN
  entries as a loud warning (an unclosed entry = a past agent skipped its
  assessment — visible debt).
- `close` — fills the newest OPEN entry with score + notes, flips it to
  **CLOSED**. Optional `--suggest "…"` forwards to the suggestions file.
- `suggest` — appends to `SUGGESTIONS.md`: date, linked run id (newest entry),
  one-line suggestion, status **NEW** (flipped to DONE manually when
  implemented).
- Entry format/parse logic lives in exported pure helpers so it is unit-testable.

### The three files (all in `.claude/skills/arena-test/`, checked in)

| File | Role |
|---|---|
| `JOURNAL.md` | Append-only run record: every saved question, criteria, score, reasoning |
| `LESSONS.md` | Short curated list agents must read before testing and extend when a run teaches something |
| `SUGGESTIONS.md` | Reviewable backlog of feature ideas derived from runs — the lessons→features loop |

## Data Flow

```
testing agent
  → reads LESSONS.md                                  [reuse past knowledge]
  → arena-log open (question + criteria → JOURNAL)    [question saved pre-run]
  → writes arena-config.json
  → driver.mjs: launch → "level0" → observe
       game: cheat → loadArenaConfig (IPC) → generateLevel(0,…,config)
             → buildArena(config ?? DEFAULT_BOSS_ARENA)
  → arena-log close (score 1–5 + notes → JOURNAL)     [assessment saved post-run]
  → optional lesson  → LESSONS.md                     [knowledge compounds]
  → optional suggest → SUGGESTIONS.md                 [lessons → feature backlog]
```

## Error / Edge Handling

- Malformed/missing config → default boss arena (warn on malformed only).
- `size` clamped 8×8 … 40×30; degenerate maps impossible.
- Unknown enemy kind / out-of-bounds position → that entry skipped with a warn.
- Player spawn wins position conflicts; overrides never leak past depth 0.
- Config is re-read on each `level0` entry (edit-and-retest without relaunch).
- Journal/lessons/suggestions are plain markdown, serial writes — no locking.
- `close` with no OPEN entry → clear error, nothing written.

## Testing

- **`buildArena`** (`test/arena.test.js`): default config reproduces the current
  boss arena exactly (1 centered `dragon_boss` + 20 alternating chests +
  bottom-center player); custom enemies spawn at given positions; omitted
  positions auto-spread on floor without overlap; unknown kinds / OOB positions
  dropped (only those); empty `enemies` yields a valid empty arena; player
  override honored with clamping; size clamping.
- **`arena-log`** (`test/arena-log.test.js`): `open` writes a well-formed OPEN
  entry; `close` closes the newest OPEN entry with score/notes; `--suggest`
  appends a linked suggestion; `open` reports existing OPEN entries; `close`
  with none errors. Run against a temp dir.
- **Existing tests:** `parseLevelCheat('level0')` unchanged; current
  `buildBossTestArena` assertions re-pointed at the default-config path.
- **Manual:** one end-to-end skill run (cyclops config) as the first real
  journal entry.

## Out of Scope (YAGNI)

- Multiple simultaneous arenas; a second debug level.
- In-game config UI; scripting enemy behavior overrides.
- Automatic pass/fail detection — the score is the agent's judgment by design.
- CI integration; auto-summarizing the journal.
- Acting on SUGGESTIONS.md entries (that's future work the backlog exists for).
