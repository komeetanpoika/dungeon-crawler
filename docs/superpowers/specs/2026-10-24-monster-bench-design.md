# Monster bench and the monster-mechanics skill

Date: 2026-10-24. Status: design, awaiting approval.

## Why

The user wants to add monsters from their own drawings, and to build each
one's mechanics with Claude this way:

1. **The user describes** what the monster does.
2. **Claude builds it**: the mechanics, plus tests.
3. **The user tweaks it live**: they fight it and change its numbers while
   the game runs.

Most of the pieces already exist: monster JSON defs, rigs, hook modules
(`renderer/systems/monsters/<name>.js`), the monster lab for looks, and the
`arena-test` skill for live checks. Two things are missing. Nothing lets the
user watch the mechanics run and change numbers on the spot: the lab plays
poses only, and the arena is a cheat-typed level that races the monster's
AI. And no recipe makes Claude build every monster the same way.

This project adds both. The **monster bench** is a dev-only mode of the
Electron game that drops straight into an arena with one monster and a
tuning panel. The **monster-mechanics skill** is the recipe Claude follows.

The user's drawing for the first monster has not arrived yet. This project
builds the system, not that monster.

## Goals

- One command opens the bench on a named monster: `npm run bench -- <name>`.
- Every number in a monster's mechanics can be changed from the panel while
  it fights, and the change takes effect at once.
- Tweaks persist: a Save button writes them to the monster's JSON file,
  where Claude reads them back.
- Claude can edit the mechanics code while the user's bench is open, and
  the bench picks the change up by itself.
- The panel carries the switches past arena runs kept asking for
  (`.claude/skills/arena-test/SUGGESTIONS.md`): freeze the monster, an
  invulnerable player, hitboxes, a fresh respawn, slow motion.
- A scaffold makes a new monster's files in one go, with a placeholder look,
  so mechanics work never waits for art.
- A project skill, `.claude/skills/monster-mechanics/`, encodes the
  describe → build → self-check → hand over → tweak loop.

## Non-goals

- Turning the drawing into art. The sprite-sheet route already exists (the
  serpent, wraith and wolf extractors, `tools/sprite-sheet-lib.mjs`). The
  skill points at it but adds no new art tooling.
- Placing the monster in the world (spawn depths, open maps, quests). The
  def's existing `spawn` fields cover that later.
- Moving existing monsters (Podeboo's `LASER`, the Kivihiisi's `LASH`, …)
  onto the new tuning format. The bench still spawns them, with no tuning
  fields.
- A shared library of attack building blocks. Wait until the first monster
  built this way shows what is worth sharing.
- Any change to the web build or the public PvP server.

## Anti-goals (what would make this a failure even if it works)

- A tweak that looks applied but is silently lost: on reload, on save, or
  because the monster read a stale copy.
- Typing in the panel moves the hero or swings a weapon.
- The bench, or its Save, can be reached from the public web build.
- Saving rewrites any file other than the one monster's JSON (and
  `index.json` when the scaffold adds a name).
- The normal game boots slower, or behaves differently, when the bench is
  not in use.

## The tuning format (decided)

It mirrors the existing rig pattern (`PARAM_SCHEMA` in the rig, `params` in
the JSON, `clampParams` in `render/monster-rigs/schema.js`):

- A hook module may export `TUNING_SCHEMA`: an array in the same schema
  format as a rig's `PARAM_SCHEMA` (`range` / `toggle`, with `key`, `label`,
  `group`, `default`, and `min`/`max`/`step` for ranges). One optional extra
  field, `hint`, holds a one-line explanation the panel shows. `schemaErrors`
  must accept `hint`.
- The monster's JSON gains `tuning: { key: value, … }`.
- `registerMonsters` clamps `tuning` against the hook's `TUNING_SCHEMA` (as
  `params` are clamped against the rig's) and stores the result on the def.
  This means it now uses the hook module's exports instead of importing it
  for side effects only.
- The hook reads the def's tuning object **every frame** and never copies
  it, so a panel edit (which mutates that object in place) applies on the
  next frame.
- Tests set tuning by registering a def with a `tuning` block. No module
  constants need patching.

## The bench (decided behaviour)

**Launching.** `npm run bench -- <name>` runs `electron . --bench <name>`.
`main.cjs` passes the name to the renderer the way it passes `--dcdebug`.
The game skips the title, builds a level-0 arena (reusing `buildArena` with
an in-memory config, not `arena-config.json`), and spawns the monster a fair
distance from the hero. Bench mode also exposes `window.__dc`, as
`--dcdebug` does. The bench activates only when the Electron preload offers
the bench's IPC methods; `web-shim.js` never defines them, so the web build
cannot enter the bench even with a crafted URL. Bench code is loaded with a
dynamic import inside that path only, so normal boot does not load it.

**The hero.** Starts able to use all three loadouts (Warrior, Archer, Mage):
the outfits that gate them are worn or granted, with a sword, a bow with a
deep quiver, and a wand. Shift cycles loadouts as in the real game.

**The panel** is a collapsible overlay along one side of the window. It
must not cover the arena's centre. It has four sections:

- *Tuning*: one control per `TUNING_SCHEMA` entry, grouped by `group`, with
  its `hint`. Edits apply immediately.
- *Stats and behaviour*: `stats.hp`, `stats.dmg`, `stats.speed`, and every
  numeric field already present in the def's `behavior`. These take effect
  on the next respawn; the panel says so.
- *Switches*: freeze the monster (it stays drawn and hittable but its AI and
  hook skip their update); invulnerable hero (hits still show, with float
  and sound, but take no hp, and the panel tallies the damage they would
  have dealt); hitbox overlay (every entity's `hitShape` from
  `systems/hitbox.js`, plus anything the hook draws, see below); time scale
  (pause, step one frame, 0.25×, 0.5×, 1×); respawn (clear this monster's
  type and spawn a fresh count, default 1, with current values); full heal.
- *Readout*: the monster's hp and what its hook reports (see below).
- *Save*: writes the current tuning, stats and behaviour into
  `renderer/data/monsters/<name>.json` through the existing `writeMonster`
  in `tools/monster-lab/monster-files.cjs`, read-modify-write so every other
  field of the def survives. A dirty marker shows unsaved values.

While focus is inside the panel, game input ignores the keyboard. Clicking
back on the arena returns keys to the game.

**Optional hook exports for the bench**, both stubbed by the scaffold:
`debugState(e)` returns a short text or flat object for the readout (for
example `charge 0.42s`), and `debugDraw(ctx, e, S)` draws range rings and
aim lines while the hitbox overlay is on. A hook without them still works.

**Live code reload.** While the bench runs, the main process watches
`renderer/` for `.js` and `.json` changes. After a short debounce it reloads
the bench page, which re-enters the bench on the same monster. Switch
states, time scale and **unsaved panel values** survive the reload
(`sessionStorage`). After a reload, unsaved values are kept for keys still
in the schema, the rest come from disk, and the dirty marker stays. The
bench's own Save must not wipe the panel's state when its write trips the
watcher.

**The driver.** `.claude/skills/run-game/driver.mjs` gains a way to pass
extra launch args (for example `DC_EXTRA_ARGS="--bench <name>"`), so
Claude's self-check runs the same bench the user sees. Arena suggestions
from runs 18, 20 and 21 asked for this.

## The scaffold (decided)

`node tools/monster-bench/new-monster.mjs <name>` refuses a reserved or
existing name, then writes:

- `renderer/data/monsters/<name>.json`: placeholder look on the `quadruped`
  rig in a loud, obviously-temporary colour; `stats`; `hooks: true`;
  `spawn: null`; `tuning: {}`. Plus the name in `index.json`, through
  `writeMonster`.
- `renderer/systems/monsters/<name>.js`: a supplement hook in the repo's
  hook style, with a header comment describing the monster, a small
  example `TUNING_SCHEMA`, an `update` that reads tuning per frame,
  `debugState` and `debugDraw` stubs, registered on `CREATURE_UPDATE`.
- `test/<name>.test.js`: registers the def through `registerMonsters` with
  injected loaders (as `test/podeboo.test.js` does) and steps `update` a few
  frames. It passes as generated.

## The skill (decided outline)

`.claude/skills/monster-mechanics/SKILL.md`, plus a `LESSONS.md` that
starts with what this project learns and grows one imperative line per
session, the same self-improving pattern `arena-test` uses. The workflow:

1. Read `LESSONS.md`.
2. Get the description. Ask, one question at a time, what the monster does,
   how the player sees each attack coming, and how the player beats it.
   Settle that before writing code.
3. Scaffold, or open the existing monster.
4. Build the mechanics test-first (`superpowers:test-driven-development`).
   Every number the user might tweak goes in `TUNING_SCHEMA` with a hint;
   no magic numbers in the state machine. Fill in `debugState` and
   `debugDraw`. The module's header comment is the living description of
   the monster.
5. Self-check in the bench through the driver, time-boxed (the user cuts
   long runs off). Log it in the arena-test journal (`arena-log.mjs open` /
   `close`): same driver, same lessons.
6. Hand over: the bench command, and one line per tuning field on what it
   changes.
7. While the user tweaks: read their saved values from the JSON before
   changing code. Edit, and the bench reloads itself.
8. Wrap up: `npm test` green, `git status` shows only this monster's files
   plus intended changes, and a lesson line if the session taught one.
9. When the drawing arrives, point to the sprite-sheet route (check alpha
   first, copy the closest extractor, a sheet-drawing rig) as a separate
   step.

The skill is written and pressure-tested with `superpowers:writing-skills`.

## Constraints

- Vanilla JS, no bundler, no new dependencies.
- `npm test` stays green. CI requires the `test (22)` check on `main`.
- Generated monsters never join `CREATURE_TYPES`. Monster names stay out of
  `RESERVED_NAMES` (both hand-synced lists).
- Electron renders with a software canvas here, so overlay drawing must stay
  cheap: a few dozen shapes, not per-pixel work.
- Automated editor runs autosave into `renderer/data/painter-maps.json`.
  Check `git status renderer/data/` after any scripted run.

## Calls made after the builder check (Claude's, not the user's)

- **Respawn re-registers the AI row.** `stats.speed` and `behavior` reach
  the brain through `registerMonsterAI`, which runs once at load. So a
  respawn calls it again with the panel's current values, or behaviour
  edits would never land.
- **The monster lab keeps `tuning`.** The lab's Save rebuilds the def from
  the fields it knows and would drop `tuning`. It must carry `tuning` (and
  any field it does not edit) through unchanged.
- **Save leaves `index.json` alone when the name is already listed.**
  `writeMonster` rewrites the index on every call today. It only writes the
  index when it adds a name.
- **The hero never dies in the bench.** Invulnerable is off at start, so the
  user feels real damage. A hit that would drop hp to 0 refills it instead,
  and the readout counts the deaths. The run never ends.
- **The arena** is the plain level-0 arena at 26×18 with no columns or
  chests. Obstacles are a later addition if a monster needs line-of-sight
  play.

## Changes after approval (user, 2026-10-24)

- The monster-mechanics skill is postponed to a later session. The bench and the scaffold go first.
- The first monster is the user's drawing `monsteri.jpg` (repo root), working name `monsteri`. Turning that one drawing into a sprite rig is now in scope; general art tooling is still not.

## Left to the builder

- Where the bench code lives (`renderer/bench/` or `tools/monster-bench/`),
  as long as normal boot never imports it.
- The narrow seam game.js offers the bench: arena build, spawn, time scale,
  freeze, overlay draw, input gate.
- How invulnerability and the damage tally hook into `damagePlayer`.
- Panel look and the collapse key. Follow the project's UI rules: no text
  bars, colour-only buttons, controls not emoji (see the UI feedback
  memory).
- Placeholder colours and the example tuning keys in the scaffold.
- Whether to reuse `tools/monster-lab/params-panel.js` for the controls.
- A small line about the bench and the skill in the dungeon-crawler section
  of `~/CLAUDE.md`, and the `arena-test` SKILL.md syntax block gaining
  registry monster kinds.
