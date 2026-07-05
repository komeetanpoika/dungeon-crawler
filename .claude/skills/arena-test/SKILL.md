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

3. Write `arena-config.json` at the repo root (gitignored, strict JSON). Syntax:

   ```json
   {
     "size": { "w": 26, "h": 18 },
     "enemies": [
       { "kind": "cyclops", "x": 13, "y": 6 },
       { "kind": "monster", "variant": "medium" }
     ],
     "chests": [ { "kind": "weapon", "weaponType": "axe" }, { "kind": "potion" } ],
     "columns": [ { "x": 10, "y": 8 }, { "x": 10, "y": 9 } ],
     "player": { "x": 13, "y": 16, "weaponType": "sword", "hp": 20 }
   }
   ```

   - Every field optional; omit the file entirely for the default dragon-boss arena.
   - Enemy kinds: `guard`, `monster` (variants `weak`/`medium`/`strong`/`boss`), `dragon`, `crab`, `cyclops`, `wizard`, `dragon_boss`. Omit `x`/`y` to auto-place near the center. Optional `hp` spawns the enemy pre-damaged (clamped 1..maxHp) — e.g. `{ "kind": "guard", "hp": 1 }` to observe low-HP fleeing.
   - Chest kinds: `weapon` (`weaponType`: `dagger`/`sword`/`longsword`/`axe`), `potion`. Omit positions to auto-place on the perimeter.
   - `player`: spawn position plus optional `weaponType` and `hp` overrides.
   - `columns`: interior COLUMN tiles (block movement AND line of sight) — build walls/obstacles for pathfinding and LOS-break tests; never placed on the player spawn; spawns never land on them.
   - Size clamps to 8×8 … 40×30. Bad entries are skipped with a console warning, never a crash.
   - The file is re-read every time the level0 cheat fires — edit and re-enter the arena, no relaunch needed.

4. Open the journal entry BEFORE running anything (the question must survive a crashed run):

   ```bash
   node .claude/skills/arena-test/arena-log.mjs open --question "…" --criteria "…"
   ```

   If it warns about OPEN entries, a past run skipped its assessment — mention that in your final report.

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
