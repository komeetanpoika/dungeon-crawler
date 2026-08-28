# NPC wanderers — villagers and animals on the forest maps

**Date:** 2026-08-28
**Status:** Approved design, pending implementation plan

## Goal

Friendly characters — villagers and animals — that live on the first three
Adventure maps (the forest maps at depths 7–9: Clearings, River, Autumn) and go
about their own business. They wander, react to the interaction button, and
respond to being attacked: animals and the frail flee, able villagers fight
back, and hurting anyone in a village turns the whole village against the
player. Player death resets every NPC on every map — Groundhog Day.

The first iteration keeps behaviour small (wander, flee when hurt, attack when
hostile) but is built as a **priority list of goals** so later objectives —
"go here", "follow", "work at the bench" — are one new goal entry and one name
in a species list, never a change to the update loop.

## Decisions

| Question | Decision |
|---|---|
| Which levels | The three forest maps, depths 7–9 (`OPEN_MAPS["7".."9"]`). Dungeon Rush untouched. |
| Art | Existing unused tileset faces (`tile_0086`, `0098`, `0099`, `0100`) and the mouse (`tile_0124`); further animals cropped from the CC0 **Tiny Creatures** pack (same 16×16 thick-outline style as Kenney Tiny Dungeon); hand-drawn 32-px placeholders where a species has no sprite yet. |
| Behaviour | Priority-list goals. First iteration: `flee_hurt`, `attack_hostile`, `startle`, `go_to`, `wander`. |
| Interaction | The existing **F / blue diamond** button. Villagers speak a line; animals do a species reaction (hop / bolt / scurry) with a sound cue. No quests, shops or healing. |
| Being attacked | Per-species `onHit`: `flee` or `fight`. Any hit on a `village`-faction NPC makes every villager on that map hostile. |
| Persistence | Dead NPCs and a provoked village persist across map changes and sessions (adventure save v4). **Player death clears all of it.** |
| Architecture | NPCs reuse the enemy movement pipeline (`brain.js` intents → `act.js`), the enemy melee-attack framework and the enemy death/culling path. A hostile NPC *is* an enemy as far as `isEnemy` is concerned. |

## Non-goals

- No NPCs in caves or in Dungeon Rush.
- No dialogue trees, quests, trading, or healers.
- No schedule / day-night; "their own business" is wandering around a home tile.
- No fleeing-into-houses or door logic; homes are open tiles.
- No changes to how existing enemies behave.

## 1. Data — `renderer/data/npcs.js`

A species table in the spirit of `enemy-ai.js`:

```js
export const NPC_SPECIES = {
  villager: { faction: 'village', sprite: 'npc_villager', walker: true,
              hp: 3, onHit: 'fight', fleeHp: 0.3,
              speed: 70, wanderSpeed: 40, roam: 6,
              priorities: ['flee_hurt', 'attack_hostile', 'go_to', 'wander'],
              lines: ['Fine weather for it.', 'Mind the caves, stranger.', 'Aspengrove keeps to itself.'] },
  elder:    { faction: 'village', sprite: 'npc_elder', walker: true,
              hp: 2, onHit: 'flee', fleeHp: 1,
              speed: 50, wanderSpeed: 25, roam: 3,
              priorities: ['flee_hurt', 'go_to', 'wander'],
              lines: ['These woods were older than the village once.', 'Rest a while.'] },
  chicken:  { faction: 'wild', sprite: 'npc_chicken',
              hp: 1, onHit: 'flee', fleeHp: 1, startle: 48, react: 'hop',
              speed: 90, wanderSpeed: 30, roam: 3,
              priorities: ['flee_hurt', 'startle', 'go_to', 'wander'] },
  deer:     { faction: 'wild', sprite: 'npc_deer',
              hp: 2, onHit: 'flee', fleeHp: 1, startle: 96, react: 'bolt',
              speed: 130, wanderSpeed: 35, roam: 8,
              priorities: ['flee_hurt', 'startle', 'go_to', 'wander'] },
  mouse:    { faction: 'wild', sprite: 'npc_mouse',
              hp: 1, onHit: 'flee', fleeHp: 1, startle: 40, react: 'scurry',
              speed: 110, wanderSpeed: 40, roam: 4,
              priorities: ['flee_hurt', 'startle', 'go_to', 'wander'] },
}
```

Field meanings:

- `faction` — `village` (shares wrath) or `wild` (each animal for itself).
- `onHit` — `fight` sets `hostile`; `flee` triggers a timed flee. `fleeHp` is the
  HP fraction at or below which `flee_hurt` may take over (1 = any damage).
- `roam` — tiles from the home tile that `wander` may pick points in.
- `startle` — pixel radius at which a wild animal bolts even if untouched.
  Absent on villagers.
- `react` — the animal's response to the interaction button. Villagers have
  `lines` instead.
- `walker` — draw through `drawWalker` (walk tilt, facing flip) and tick
  `tickWalk`; animals draw as a plain flipped sprite.
- `priorities` — ordered goal names; see §3.

`enemy-ai.js` gains one `npc` row whose numeric fields are read from the
species (`getAIConfig` for an `npc` merges `BASE.npc` with the species' `speed`,
`wanderSpeed`, `fleeHp`, `half: 4`, `sightRange: 200`, `stopRange: 20`), so
the existing brain works unchanged once an NPC is hostile.

### Per-map population

Declared beside the map, in `tools/static-overworld/export-game-maps.mjs`, and
exported into `open-maps.js` as `npcs` on each map record:

```js
npcs: {
  village: ['villager', 'villager', 'villager', 'elder', 'chicken', 'chicken'],  // anchored on the village/camp POI
  wild:    ['deer', 'deer', 'mouse', 'mouse', 'chicken'],                        // scattered
}
```

Forest 1 (Clearings) has a `village` POI (Aspengrove); Forest 2 (River) has a
`camp` POI (lumber camp) which serves as the village anchor; Forest 3 (Autumn)
has a `village` POI (hermit hut) — its village group is small (one villager,
one elder). Maps without a `village`/`camp` POI get no village group.

## 2. Spawning — `renderer/systems/openmap.js`

`buildOpenMap` emits NPCs as ordinary entity spawns:

```js
{ kind: 'npc', species: 'villager', x, y, id: 'npc:forest-1-clearings:3', hostile: false }
```

- **Village group** — the anchor is the first `village` or `camp` POI. Each NPC
  gets a random walkable home tile within `roam` tiles of the anchor
  (rejection-sample on the map's `walk` grid, fall back to `nearestPassable`),
  never the player spawn tile and never a tile already holding a spawn.
- **Wild group** — homes on random walkable tiles at least 12 tiles from the
  village anchor and at least 4 tiles from every `dungeon_entrance` POI, so
  animals do not clog cave mouths or wander through the village.
- `id` is `npc:<mapName>:<index>` over the concatenated village+wild list, so
  it is stable across spawns even though homes reroll every time.
- `rng` is injectable (default `Math.random`), following `generateOverworld`.
- Spawns whose id is in the saved `dead` list are skipped; if the saved map
  record says `hostile`, village-faction spawns are emitted with
  `hostile: true`.

`buildEntities` (`game.js`) gets `case 'npc'` → `makeNpc(spawn)` from
`npc.js`, which returns:

```js
{ type: 'npc', species, id, x, y, px, py, hp, maxHp, hostile, faction,
  home: { x, y }, objective: null, facing: 'east', inCombat: false, ai: { goals: {}, current: null } }
```

Per the `build-entities-no-chest-kind` note: an unknown kind is silently
dropped, so the `case` and the arena allowlist are both part of the task.

## 3. Goals — `renderer/systems/npc.js`

The update loop is a priority list. Each frame, for each NPC:

1. Build `ctx` once: `playerDist` (px), `canSeePlayer` (`hasLineOfSight`),
   `hpFrac`, `def` (the species entry), `cfg` (`getAIConfig`).
2. Walk `def.priorities` top-down; the first goal whose `when(e, ctx)` is true
   is the active goal. If it differs from `e.ai.current`, call the goal's
   `enter(e, ctx)` (resets that goal's scratch state) and record it.
3. `run(e, ctx, delta)` returns a movement intent (`hold` / `patrol` / `flee` /
   `approach`, the shapes `act()` already understands) and `act()` moves the
   NPC. Goals may also start attacks or speech as side effects.

```js
export const GOALS = {
  flee_hurt: {
    when: (e, ctx) => e.ai.fleeTimer > 0 || (ctx.hpFrac <= ctx.def.fleeHp && e.hp < e.maxHp && ctx.playerDist < 240),
    enter: e => { e.ai.fleeTimer = Math.max(e.ai.fleeTimer ?? 0, FLEE_TIME) },
    run: (e, ctx, dt) => { e.ai.fleeTimer -= dt; return { mode: 'flee', speed: ctx.cfg.speed } },
  },
  attack_hostile: {
    when: (e, ctx) => e.hostile,
    run: (e, ctx) => {                      // the enemy brain does the work
      const intent = updateBrain(e, ctx.state, ctx.delta)
      tryStartEnemyAttack(e, ctx.state)
      return intent
    },
  },
  startle: {
    when: (e, ctx) => ctx.def.startle && (e.ai.startleTimer > 0 || ctx.playerDist < ctx.def.startle),
    enter: e => { e.ai.startleTimer = STARTLE_TIME },
    run: (e, ctx, dt) => { e.ai.startleTimer -= dt; return { mode: 'flee', speed: ctx.cfg.speed } },
  },
  go_to: {
    when: e => !!e.objective,
    run: (e, ctx) => {
      if (atTile(e, e.objective)) { e.objective = null; return { mode: 'hold' } }
      return { mode: 'patrol', target: e.objective, speed: ctx.cfg.speed }
    },
  },
  wander: {
    when: () => true,
    enter: e => { e.ai.wanderPt = null; e.ai.dwell = 0 },
    run: (e, ctx, dt) => {
      // no point: pick a reachable tile within roam of home (findPath check), dwell first
      // at point: dwell 1–4 s (villagers up to 6 s), then drop the point
      // else: { mode: 'patrol', target: pt, speed: cfg.wanderSpeed }
    },
  },
}
```

Notes:

- `attack_hostile` delegates to `updateBrain` from `brain.js`, so hostile
  NPCs chase, hunt lost players, and flee at low HP exactly like a guard. The
  species' `fleeHp` flows in through `getAIConfig`.
- `flee_hurt` uses the existing flow-field `flee` intent; when it returns
  `false` (cornered) the NPC stands, which for a `fight` species falls through
  to `attack_hostile` next frame because its `fleeTimer` keeps draining.
- `go_to` is the expansion hook: **setting a target is `e.objective = { x, y }`**
  from anywhere (a future quest script, a rite, a test). It clears itself on
  arrival. Later goals (`follow`, `work_at`) are new registry entries.
- `wander` re-anchors nothing: home never moves, so a startled deer drifts back
  toward its meadow over time.
- Per-goal scratch lives on `e.ai` (timers) and `e.ai.goals[name]` for anything
  richer; `enter` is the reset point.

### Interaction — F / blue diamond

The existing F handler in `game.js` checks fountain basin, then sign, then
(new) **the nearest peaceful NPC within 1.5 tiles**:

- Villager species: NPC faces the player, `wander` dwells for 3 s, and a speech
  bubble with a random `line` appears **above the NPC**. `feedback.bubble`
  gains an optional `anchorId`; `_drawBubble` in `canvas.js` looks up the
  entity by id and draws there, defaulting to the player as today.
- Animal species: `e.ai.reactTimer = REACT_TIME` and a species sound cue
  (`npc-chicken`, `npc-deer`, `npc-mouse` recipes in `audio.js`). `react`
  drives a small draw-time offset: `hop` = 6 px vertical bounce, `bolt` =
  immediate `startle`, `scurry` = quick zig-zag flee for 1 s.

Hostile NPCs ignore the button.

## 4. Combat & wrath

**Hittable versus targeted.** Two predicates in `game.js`:

```js
function isEnemy(e)    { return <existing list> || (e.type === 'npc' && e.hostile) }
function isHittable(e) { return isEnemy(e) || e.type === 'npc' }
```

`isHittable` replaces `isEnemy` at the **damage** sites — player melee,
projectiles (`ranged.js` hits), gust knockback slams, and the type sets in
`magic.js` (`!e.hp` check already admits NPCs), `fire.js` (`BURNABLE`) and
`shockwave.js` (`SPLASHABLE`). Everything that *targets* — enemy AI, HP bar on
sight, `inCombat` music/feedback, the "any enemies left" checks — keeps using
`isEnemy`, so a peaceful NPC is never chased or counted.

**On hit.** One hook, `onNpcHit(e, state)` in `npc.js`, called from every
damage site right after HP is reduced (the same place `inCombat = true` is set
today):

- `onHit: 'flee'` → `e.ai.fleeTimer = FLEE_TIME` (the `flee_hurt` goal takes
  over regardless of HP because `fleeHp` is 1 for these species).
- `onHit: 'fight'` → `e.hostile = true`.
- If `e.faction === 'village'`: **every `npc` on the map with
  `faction === 'village'` and `onHit === 'fight'` becomes hostile**, and
  `state.npcWrath = true` (drives persistence and a one-time `announce`:
  "Aspengrove turns on you!"). Fleeing villagers (elders) stay fleeing.
- Sound: `enemy-hit` for villagers, `npc-hurt` (lighter) for animals.

**Hostile villagers fight with fists.** `enemy-attack.js` weapon map gains
`npc: 'fists'` (damage 1, short range, guard-like cooldown) so a mob is
dangerous by numbers, not per blow. They use the guard's windup→strike→swing
animation through `stepEnemyAttack`.

**Death.** Dead NPCs are culled by the existing `hp > 0` filters (which use
`isHittable`). Villager death plays `enemy-death`; animal death plays
`npc-death`. No loot.

## 5. Persistence — Groundhog Day

Adventure save **v4**, additive as before:

```js
npcs: { [mapName]: { dead: ['npc:forest-1-clearings:3'], hostile: true } }
```

- `normalizeAdventureSave` adds `base.npcs ??= {}`.
- `persistAdventure` writes the current surface map's record: `dead` = ids
  present in the spawn list but absent from `state.entities`; `hostile` =
  `state.npcWrath === true`.
- `buildOpenMap` receives the map's record and skips dead ids / pre-flags
  village NPCs hostile (§2). The record for a map is read whenever that map is
  built, so leaving and returning keeps the consequences.
- **Player death** — in the death branch of `update()` in `game.js`, before
  `adventureRespawn`: `savedAdventure.npcs = {}`, then the respawned surface
  state's NPC entities are rebuilt from a fresh `buildOpenMap` spawn list (all
  alive, none hostile, new homes). `adventureRespawn` itself stays a pure
  state rebuild; the reset is a caller step so `cave.js` needs no NPC
  knowledge. Caves, gates, talents, body, progress are untouched.
- Entering a cave stashes the surface state wholesale (`buildCaveState`), so
  NPCs freeze mid-wander and resume on return — no extra work.

## 6. Rendering & art

- `drawEntity` in `canvas.js` gets an `npc` branch: `walker` species go
  through `drawWalker` with `walkTilt` and facing flip; when `hostile` they
  use the species' `spriteAlert` if one is registered (villager → the
  existing `guard_alert` treatment: the alert face) so the mob visibly changes
  mood. Animals draw as a plain sprite, flipped by facing, with the `react`
  hop offset while `reactTimer > 0`.
- `tickWalk` runs for `walker` NPCs in the same loop that ticks guards and
  wizards.
- Sprite registry (`sprites.js`): `npc_villager: 'tile_0098'`,
  `npc_villager_2: 'tile_0086'`, `npc_villager_3: 'tile_0099'`,
  `npc_elder: 'tile_0100'`, `npc_mouse: 'tile_0124'`, `npc_chicken`,
  `npc_deer`. Villagers rotate through the three villager sprites by spawn
  index so a village is not four clones.
- **Chicken and deer art** comes from Tiny Creatures (CC0). The user downloads
  `tiny-creatures.zip` by hand (itch.io blocks scripted downloads) into
  `tools/static-overworld/vendor/`; a new `tools/extract-npc-sprites.mjs`
  crops named cells out of the sheet into `renderer/assets/tiles/npc_*.png`
  at the tileset's native 16×16 (the renderer already scales tiles to 32 px).
  Until the zip is present the script is skipped and a hand-drawn 16×16
  placeholder (`npc_chicken.png`, `npc_deer.png`) ships so the feature runs.
- HP bar: hostile NPCs show the standard enemy HP bar (they satisfy
  `isEnemy`); peaceful NPCs show one only while `hp < maxHp`.

## 7. Error handling

- A species name not in `NPC_SPECIES` at spawn time logs a warning and is
  dropped, mirroring the unknown-kind rule.
- A map whose village anchor has no walkable tile within `roam` falls back to
  `nearestPassable`; if the wild sampler cannot satisfy the distance rules
  after 200 tries it relaxes the village distance to 6, then places anywhere
  walkable — never fails to spawn.
- `wander` rejects points `findPath` cannot reach; ten rejections in a row
  hold for a dwell and retry (so an NPC boxed in by a prop never spins).
- An `objective` on an unreachable tile is dropped after
  `UNREACHABLE_GIVEUP` seconds, using the same `ai.path === null` signal the
  enemy brain reads.

## 8. Testing

`node:test`, one file per system, following the existing suite:

- `test/npc.test.js`
  - goal selection returns the first satisfied goal; `enter` fires once on
    switch, not every frame.
  - `go_to` emits a `patrol` intent toward `objective` and clears it on
    arrival.
  - `wander` never picks a point outside `roam` of home or unreachable from it.
  - `startle` engages inside the species radius and not outside.
  - `onNpcHit`: `flee` species get a flee timer and stay peaceful; `fight`
    species become hostile; hitting any village NPC flips every `fight`
    villager on the map and sets `npcWrath`; wild hits flip nobody else.
  - `makeNpc` shapes: hp/maxHp from species, `hostile` from spawn, stable id.
- `test/openmap.test.js` additions
  - each forest map spawns the declared counts; ids stable across two builds
    with different rngs.
  - wild homes are ≥ 12 tiles from the village anchor and ≥ 4 from every
    dungeon entrance; village homes within `roam`.
  - dead ids are skipped; a hostile record spawns villagers hostile.
- `test/adventure.test.js` additions
  - v3 save migrates with `npcs: {}`; the death-reset step empties it.
- `test/game-predicates` (wherever `isEnemy` is covered today): hostile NPCs
  are enemies, peaceful NPCs are hittable but not enemies.
- Runtime check (time-boxed, per the `keep-runtime-verification-short` note):
  launch Adventure on Clearings via Playwright, confirm NPCs are present and
  move over ~5 s, press F beside a villager and assert a bubble is drawn.

## Files touched

| File | Change |
|---|---|
| `renderer/data/npcs.js` | new — species table |
| `renderer/data/enemy-ai.js` | `npc` row merged from species |
| `renderer/systems/npc.js` | new — `makeNpc`, `GOALS`, `updateNpc`, `onNpcHit`, `interactNpc` |
| `renderer/systems/openmap.js` | NPC spawn sampling, dead/hostile filtering |
| `renderer/systems/adventure.js` | save v4 `npcs` field |
| `renderer/systems/enemy-attack.js` | `npc: 'fists'` weapon |
| `renderer/systems/feedback.js` | bubble `anchorId` |
| `renderer/game.js` | `case 'npc'`, `isHittable`, update loop call, F-key branch, death reset, persistence |
| `renderer/render/canvas.js` | `npc` draw branch, anchored bubble |
| `renderer/render/sprites.js` | `npc_*` entries |
| `renderer/render/audio.js` | `npc-*` cue recipes |
| `renderer/systems/{fire,shockwave}.js` | admit `npc` to the hittable type sets |
| `tools/static-overworld/export-game-maps.mjs` | per-map `npcs` population |
| `renderer/data/open-maps.js` | regenerated |
| `tools/extract-npc-sprites.mjs` | new — Tiny Creatures cropper |
| `renderer/assets/tiles/npc_*.png` | new sprites / placeholders |
| `test/npc.test.js`, `test/openmap.test.js`, `test/adventure.test.js` | tests |
