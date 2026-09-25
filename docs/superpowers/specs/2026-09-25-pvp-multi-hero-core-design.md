# PvP Sub-project 1 — Multi-hero Core + Local Harness

Date: 2026-09-25. Roadmap: `2026-09-25-pvp-roadmap.md`.

## Goal

A PvP arena simulation that steps N heroes from explicit per-hero inputs,
runs headless under Node, and is playable locally against bots before any
networking exists. Single-player behaviour does not change.

Out of scope: networking, nicknames and their filter, lobbies,
prediction/interpolation, any public menu entry (sub-projects 3–4).

## 1. Architecture

**A separate PvP sim, not a multi-hero `update()`.** `game.js`'s `update()`
(~870 lines) interleaves the per-hero logic with single-player-only concerns
(rites, caves, waystones, quests, chests, doors, saves). PvP needs none of
them, so it gets its own composition of the same systems.

- **`renderer/pvp/sim.js`**:
  - `makeMatch(config)` builds the match state from an arena config plus a
    roster `[{ id, name, cls }]`.
  - `stepMatch(match, inputs, dt)` accumulates `dt` and advances in fixed
    ticks of `TICK = 1/30` s. It returns the tick's events.
  - `inputs` is `{ [heroId]: HeroInput }`, where
    `HeroInput = { move: {x, y}, facing, attack, alt, sprint }`: intents, not
    key names. `attack` is Space held, `alt` is Q held (offhand cast / shield).
    A hero with no input this tick gets a neutral input.
  - Events: `{ type: 'hit' | 'kill' | 'respawn' | 'pickup' | 'runeEnd' | 'matchEnd', ... }`.
- **`renderer/pvp/hero.js`**: `tickHero(match, hero, input, dt)`, the
  per-hero slice ported from `update()`: movement and walls (`canMoveTo`,
  `PLAYER_HALF`), sprint, the shield (`tickShield`), stamina, melee
  (tap, charge, offhand alternation), magic (charge/release, `tryCast`,
  offhand wand), ranged (`tryFire`, draw bows), cooldowns, walk animation. The
  original blocks in `game.js` stay as they are. Having `update()` call
  `tickHero` is a possible later cleanup, not part of this sub-project.
- **Match state is shaped like a normal `state`**: `map`, `projectiles`,
  `zones`, `fireZones`, `shockwaves`, `arcs`, `feedback`, `sfx`, `entities`
  (heroes + pickups), plus `heroes[]`, `clock`, `score`. So `stepProjectiles`,
  zones, lightning and knockback run unchanged; only the hooks decide who is hit.
- **Seams in shared systems.** About ten functions read `state.player`:
  `damagePlayer`, `tryBlock` (shield.js), `spells.js` (4 casters), `magic.js`
  (2), `hammer.js`, `spells/lightning.js`. Each gets an optional trailing
  `hero` argument defaulting to `state.player`, e.g.
  `damagePlayer(state, amount, kind, from = null, hero = state.player)`.
  Single-player call sites are not edited, and the existing suite must stay
  green unchanged.
- **`applyLoadout` moves** from `game.js` to `renderer/systems/loadout.js`
  (same body, `warn` injectable) so the sim can import it; `game.js` imports it.
- **Constraint:** nothing under `renderer/pvp/` may reference `document`,
  `window`, `keys` or the renderer. The headless soak test (§4) enforces this
  by importing it under Node.

## 2. Combat between heroes

- **Heroes are hittable entities.** Each hero is in `match.entities` as
  `{ type: 'hero', id, ... }`. Every attack a hero makes carries
  `owner: heroId`: projectiles, cone/zone casts, fire zones, bramble patches,
  lightning marks, melee sweeps.
- **Projectile seam:** in `stepProjectiles`'s friendly branch, skip an entity
  whose `id === p.owner`. Single-player projectiles have no `owner`, so the
  branch is a no-op there. With no enemies in a match, the enemy branch
  (`hooks.damagePlayer`) never runs.
- **The PvP `hooks.hurt(target, dmg, kind, from)`** routes a hit on a hero to
  `damagePlayer(state, dmg, kind, from, target)`. That gives identical
  defensive rules to single-player: frontal shield block within
  `BLOCK_HALF_ARC` with the shove, outfit `protect` on `'hit'`s,
  `INVULN_DURATION` (0.8 s) i-frames after each hit (also stops two attackers
  stun-locking a third), and `'dot'`/`'lightning'` hits unblockable.
- **Melee:** `tickHero`'s swing ports the existing sweep (`nearestPoint`
  against the target's hitbox capsule, `meleeHit` arc, charge tiers, offhand
  alternation, `shatterBonus`) over every hero except the swinger.
- **Status on heroes:** slow/root/freeze from rime, bramble and the
  thunderclap apply to heroes through `status.js`, with every duration
  multiplied by `PVP_CC_MUL = 0.5`. `tickStatus` runs on heroes, and movement
  honours slow/root/freeze. Knockback runs through `stepKnockback` as usual.
- **No self-damage.** A hero's own burst, fire zone, bramble, lightning and
  hammer chain never hit that hero. The Ukonvasara chain's final hop onto its
  wielder is dropped in PvP. A whiff's rain cloud still applies (it is a
  miss penalty, not damage).
- **Death:** at `hp <= 0` a hero is `dead` for `RESPAWN_DELAY = 3` s, drops
  the rune if holding it (§3), then respawns at the spawn point with the
  greatest distance to the nearest living hero. Respawning gives full kit HP
  and ammo plus `SPAWN_PROTECT = 1.5` s of immunity that ends early the moment
  the hero attacks, casts or fires. A class change chosen while dead applies
  at the respawn.
- **Kill credit:** each hero records `lastHitBy = { id, t }` on any damage
  from another hero. On death, credit goes to `lastHitBy.id` if within
  `CREDIT_WINDOW = 5` s, and that hero's kills +1. Otherwise the victim's
  kills −1 (a self-kill; rare with no self-damage, but map hazards may exist
  later). Deaths +1 either way.
- **Match:** `MATCH_LENGTH = 240` s. At time-up a `matchEnd` event carries
  the table sorted by kills, then fewer deaths; heroes still tied share the
  rank. After `matchEnd`, `stepMatch` stops advancing the world.

## 3. Class kits and pickups

**One outfit per kit, so one loadout per life, with stance switching
disabled** (`tickHero` ignores stance-switch input in PvP). The class is picked
before the match and can be changed while dead. Kits are defined in
`renderer/data/pvp.js` in the `applyLoadout` shape:

| Class | Outfit | Main hand | Offhand | Extra |
|---|---|---|---|---|
| Warrior | plate | sword | buckler (shield) | — |
| Archer | ranger | shortbow | — (bows are two-handed) | 24 arrows |
| Mage | robe | sparkwand | blinkwand (wand, Q) | — |

- Every hero has 10 max HP.
- `outfitOverrides: { plate: { protect: 1 } }` applies inside the match only
  (the sim reads protect through an override lookup; single-player's
  `OUTFIT_TYPES.plate.protect` stays 2).

**Pickups** are entities of `type: 'pvp_pickup'`, walk-onto (the hero's tile
equals the pickup's tile), and live at fixed points from the arena config.
When taken, a pickup hides and reappears after its respawn timer:

| Pickup | Count | Effect | Respawn |
|---|---|---|---|
| Health flask | 2 | +4 HP, capped at max; **not taken at full HP** | 20 s |
| Quiver | 2 | +12 arrows; **Archers only** (others walk over it) | 15 s |
| Power rune | 1 (centre) | For `RUNE_DURATION = 30` s or until death, the main hand becomes the class power weapon; the kit weapon is restored after | first spawn at 45 s, then 60 s after pickup |

Power weapons: Warrior gets `ukonvasara`; Archer gets `crossbow` plus 10 bolts
(unused bolts are removed when the rune ends); Mage gets `stormwand`. The
holder carries `hero.rune = { t }` for the glow.

**Arena map:** one hand-authored map in `renderer/data/pvp-arenas.js`, about
32×24 tiles, built through `buildArena` with a new `pvp` block:
`{ spawns: [{x,y}×6], pickups: [{ kind, x, y }] }`. Pillars and wall segments
give line-of-sight cover (projectiles already stop on walls); the rune sits in
the most exposed spot. The format allows more maps later.

All numbers in §2–§3 live in `renderer/data/pvp.js`.

## 4. Rendering, harness, testing

**Rendering**
- Extract the hero block of `Renderer.render` (`canvas.js` ~1213–1241: flicker
  sprite, blink trail, grab, melee swing, charge ring, rain cloud) into
  `drawHero(ctx, hero, sprites, camX, camY, S)`. `render()` calls it for
  `state.player` exactly as before, then for each entry of optional
  `state.heroes` that is not `state.player` and not dead. With no `heroes`
  (single-player) the output is unchanged.
- The PvP view passes an adapter `{ ...match, player: localHero, heroes }`,
  so the camera, fog and line of sight follow the local hero. Other heroes
  get a small name tag and a thin HP bar; the rune holder gets a glow.
- **`renderer/ui/pvp-hud.js`**: the match timer, own kills, and the leader's
  kills. A kill floats `+1` over the killer. `matchEnd` opens one results
  panel (name, class, kills, deaths) with "Next match", driven by controls
  like the other overlay menus. There is no kill-feed text. The class picker
  (at start and while dead) is a three-button controls-driven menu.

**Local harness**
- **`renderer/pvp/bots.js`**: `botInput(match, hero) → HeroInput`, reading only
  the match state. Per-class logic: close in (Warrior) or hold range (Archer,
  Mage); attack when in reach and line of sight; raise the shield when an
  enemy is winding up within reach; head for a flask below 40 % HP; contest
  the rune when it is up. Sub-project 4 reuses it to fill lobbies.
- **`renderer/pvp/local.js`**: the browser-side loop. It maps `keys` to the
  local hero's `HeroInput`, asks `bots.js` for the rest, calls `stepMatch`,
  renders, and updates the HUD.
- **Entry:** a `pvp` title-screen cheat, handled by the same watcher as
  `level<N>` in `systems/cheats.js`, opens the class picker, then a match of
  you against `PVP_LOCAL_BOTS = 3` bots (1–5 via the arena config). It
  works in Electron and on the web; there is no public menu entry yet.

**Testing**
- Unit tests `test/pvp-sim.test.js`, `test/pvp-pickups.test.js`,
  `test/pvp-bots.test.js`:
  - damage routing: frontal block vs a hit from behind, plate override
    (2 damage → 1), i-frames, owner skip, no self-damage, `PVP_CC_MUL` halving
  - kill credit inside and outside the 5 s window
  - respawn at the farthest spawn; spawn protection lasting 1.5 s and ending
    on attack
  - class change applying at respawn
  - pickups: flask ignored at full HP, quiver Archer-only, rune swap/restore
    on timeout and on death, crossbow bolts removed, respawn timers
  - fixed-tick accumulation: `stepMatch` with dt 0.1 runs 3 ticks
  - match end and tiebreaks
  - bots produce valid inputs and move toward a target
- Seam tests: existing `damagePlayer` / `tryBlock` / `tryCast` tests stay
  green untouched; one new test per seam shows an explicit `hero` argument is
  honoured.
- **Headless soak** (`test/pvp-soak.test.js`): 6 bots (2 per class), 240
  simulated seconds at `TICK`, in Node. It asserts no exceptions; HP within
  [0, max]; no living hero on a non-walkable tile; kills > 0; the score
  table's kills and deaths match the emitted `kill` events. Importing
  `renderer/pvp/sim.js` under Node is itself the DOM-free check.
- Full `npm test` green.
- **Live check, kept short:** one Playwright pass through the web build
  (`npm run web`): type `pvp`, pick Warrior, wait ~10 s, screenshot showing
  heroes, name tags and the HUD. Plus one `node tools/perf/trace.mjs` style
  reading with 6 heroes, to stay within the software-canvas frame budget.

## Files

New: `renderer/pvp/{sim,hero,bots,local}.js`, `renderer/data/pvp.js`,
`renderer/data/pvp-arenas.js`, `renderer/systems/loadout.js`,
`renderer/ui/pvp-hud.js`, `test/pvp-{sim,pickups,bots,soak}.test.js`.

Edited (thin seams only): `systems/player-damage.js`, `systems/shield.js`,
`systems/spells.js`, `systems/magic.js`, `systems/hammer.js`,
`systems/spells/lightning.js`, `systems/projectiles.js` (owner skip),
`systems/map.js` (`buildArena` accepts the `pvp` block), `systems/cheats.js`
(`pvp`), `render/canvas.js` (`drawHero`, `heroes`), `game.js` (import
`applyLoadout`, start a local PvP match from the cheat).
