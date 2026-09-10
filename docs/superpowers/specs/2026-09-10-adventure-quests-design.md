# Adventure Quests — the first three maps

**Date:** 2026-09-10
**Status:** design, approved in chat

## Problem

Adventure mode's twelve open maps differ only in terrain, enemy mix and dungeon
difficulty. Every map reads the same: arrive, clear the caves, take the
waystone on. The leap maps (depths 8–10) each carry a story that makes the map
*about* something; the Adventure chain carries none, and the first three maps —
Clearings, River Split, Mountain Pass — are where a new player forms their
impression of the mode.

## Goal

One quest per map on depths 7, 11 and 12, each a different verb (hunt / build /
beast), each drawing on the same Finnish folklore well as the leap episodes,
each **optional** and **richly rewarded**.

### Decisions taken up front

| Question | Decision |
|---|---|
| Progression | Optional. `isMapComplete` (every dungeon cleared) stays the *only* waystone gate. A quest can never block a run. |
| Discovery & tracking | World-legible. No quest log, no HUD text, no new UI. You find the situation by walking into it; villagers' lines change as the story moves; each beat lands as a pausing toast. |
| Climax & payoff | Varied: a tracking hunt, a construction chore, a lair boss. Payoffs vary too — a talent, a weapon plus a permanent map change, a weapon. |
| Lore register | Finnish folklore, same well as Timewarp. |

### Non-goals

- No quest log, objective list, or marker UI.
- No new rig art: both new creatures ride the existing `quadruped` rig.
- No terrain regeneration. Map JSONs gain POIs only (see §7).
- Depths 13–18 are out of scope.

## 1. Architecture — extend the story engine the leap maps already run on

`systems/leap.js` already holds everything a quest needs: per-map story flags on
the save, `poiCell`, `checkDeliveries`, a per-map module with `onArrive`/`tick`,
villager lines that change with the story, and a resolution hook. The only thing
making it leap-only is `episodeFor()`'s `mapData.leap` test and the
persona/Echo/missing-villager trappings layered on top.

**Extract, don't fork.** Move the map-agnostic half of `leap.js` into
`systems/story.js`:

- `storyFlags(record, mapName)` — the `??= { flags: {} }` accessor, taking the
  save sub-record so leap keeps `save.leaps` and quests get `save.quests`
- `setFlag(record, mapName, flag, value)`
- `poiCell(mapData, label)`
- `checkDeliveries(ctx, deliveries)` — unchanged semantics
- `makeCtx({ getState, save, record, mapData, persist, refreshInventory, spawn, onFlag })`
  — the live-`state` getter ctx, generalised from `makeEpCtx` (the getter
  matters: `game.js` swaps `state` wholesale on a cave dive, and a captured
  reference goes stale). Two additions over `makeEpCtx`: `record` is the save
  sub-record to keep flags in (`save.leaps` or `save.quests`), and `onFlag` is
  an optional callback fired after every `ctx.set` — which is how the villagers'
  lines restage (§1.2). `ctx.save` stays exposed, because a module needs the
  wider save (the Mountain Pass reads `save.felled`).

`leap.js` keeps `episodeFor`, `isMapUnlocked`, `isResolved`, `missingSpawn`,
`echoSpawns`, `ruleCtx`, `wolvesAlive`, `echoLine` and re-exports the moved
helpers so the three episode modules' imports keep working unchanged.

New files:

- `renderer/data/quests.js` — one declaration per map, keyed by `OPEN_MAPS` map
  name: `{ title, villagerLines, rule }`. `rule(flags)` is the single
  done-predicate, read by `isQuestDone` and by the tests; the staged
  `villagerLines` carry the resolved state as their first entry, so there is no
  separate `resolvedLines`. No `persona`, no `missing`, no `kit`, no
  `echoSpots`, no `items` — Adventure has no Echo, no presumed-missing villager,
  and every quest item is placed by its module rather than pre-staged in a
  chest.
- `renderer/systems/quests.js` — `questFor(mapData)` (`!mapData.leap &&
  QUESTS[mapData.name]`), `questFlags(save, mapName)`, `isQuestDone`,
  `questLines(quest, flags)` (§1.2).
- `renderer/systems/quests/{clearings,river,pass}.js` — one module per map,
  each exporting `onArrive(ctx)` and `tick(ctx, delta)`.
- `renderer/systems/quests/index.js` — `QUEST_MODULES` registry, keyed by map
  name, exactly like `EPISODE_MODULES`.

### 1.1 Save shape

`normalizeAdventureSave` gains one additive line, no version bump (the same
treatment `clock` got):

```js
base.quests ??= {}          // { [mapName]: { flags: {...} } }
```

Quest flags are **permanent**: `resetNpcs(save)` (the Groundhog-Day wipe on
player death) must not touch them, and neither does the cave reset timer. A
player who kills the elk, dies, and comes back finds it dead — the same rule
`progress.cleared` and `felled` already follow.

Quest flags live on `savedAdventure` only. Timewarp's mini-saves are
adventure-shaped, so `normalizeAdventureSave` will default `quests: {}` there
too; `questFor` returns null on leap maps, so nothing ever writes it.

### 1.2 `game.js` wiring (~20 lines)

In `arriveOnMap`, beside the existing episode block:

```js
state.quest = questFor(mapData)
state.qCtx  = state.quest ? makeCtx({
  getState: () => state, save: activeSave, record: activeSave.quests, mapData,
  persist: persistRun, refreshInventory: afterInventoryChange,
  spawn: spawns => state.entities.push(...buildEntities(spawns, state.map, state.level)),
  onFlag: () => { state.villagerLines = questLines(state.quest, state.qCtx.flags) },
}) : null
if (state.quest) {
  state.villagerLines = questLines(state.quest, questFlags(activeSave, mapData.name))
  QUEST_MODULES[mapData.name]?.onArrive?.(state.qCtx)
}
```

In `update`, beside the episode tick and under the same `!state.cave` guard:

```js
if (state.qCtx && !state.cave) QUEST_MODULES[state.qCtx.mapData.name]?.tick(state.qCtx, delta)
```

**Villager lines are the quest log.** `state.villagerLines` is a flat
`{ species: [lines] }` map today. Quests declare *staged* lines —
`villagerLines: [{ when: f => …, by: { villager: […], elder: […] } }]`, first
match wins — and `questLines(quest, flags)` collapses that to the flat shape
`npc.js` already reads. `ctx.set` is the single funnel for every flag write, and its
`onFlag` callback recomputes `state.villagerLines` after each one; the villagers'
answers change the moment the story does, with no new UI and no polling.

A leap map's `state.villagerLines` handling is untouched: `questFor` is null
there, so the episode branch still owns it.

### 1.3 What each map's module may and may not do

- Mutating a cell (planking a gap, stamping a track, dropping a boulder) **must**
  call `markTileDirty(state.map, x, y)` — the tile-layer chunk cache will not
  otherwise rebake.
- Spawning is `ctx.spawn([...])`, which routes through `buildEntities`. An
  unknown `kind` is silently dropped, so both new creature names must be
  registered monsters before their module spawns them.
- A kill is read from `state.creatureKills[type]` (set once, in `hurtCreature`)
  and immediately written to a flag. `state.creatureKills` is per-visit;
  the flag is the durable record.
- Every module's `onArrive` must be **idempotent and resumable**: it runs on a
  fresh load, on a waystone arrival, and after every cave return. Each one
  rebuilds the world to match its flags rather than replaying beats.

## 2. Quest 1 — *Hiiden hirvi*, the Elk of Hiisi (depth 7, Clearings) — the hunt

**Fiction.** Lemminkäinen's first task, made local: Aspengrove's fields are
trampled and the forest shrine's offerings are scattered by something with
hooves. The elk cannot be caught on foot — and the player has no skis. Running
it to a standstill *is* the quest, and the reward is the legs to do it next time.

**Sites** (all verified walkable; new POIs, `kind: 'landmark'`):

| Label | Cell | Note |
|---|---|---|
| `forest shrine` | 88,18 | existing POI, also the map's `exitPoi` — the opening hint |
| `wallow 1` | 112,8 | 34 steps from the shrine |
| `wallow 2` | 54,6 | 70 steps from wallow 1 |
| `wallow 3` | 57,41 | 68 steps from wallow 2; 36 steps back to the village |

**Flow.**

1. **Arrival.** Villagers and the elder speak of the trampling. The module
   stamps a patch of trampled dirt overlays around the forest shrine and lays a
   track trail from there to `wallow 1`.
2. **Tracks.** A trail is a line of `ow_dirt_*` overlays on every second cell of
   the BFS path between two sites — art only, walkability untouched, each cell
   `markTileDirty`'d. A cell that already carries an overlay (a bush, a flower,
   a rock) is skipped rather than overwritten, so a trail thins out through
   clutter instead of erasing the map's decoration. Trails are cosmetic and re-stamped from flags on arrival,
   so they survive reload without a save record of their own.
3. **Flush.** The elk stands at the current wallow. Inside `FLUSH_RANGE` (6
   tiles) it bolts: `leaving = true`, it runs a few tiles, despawns; the module
   increments `flush`, stamps the trail to the next wallow, and re-homes the elk
   there. A pausing toast marks each flush.
4. **Stand.** At `wallow 3` (`flush === 3`) it does not flee. It turns hostile
   and fights: hp 30, dmg 2, fast, with a charge that knocks the player back.
5. **Hide.** Death sets `hirvi_dead` and drops an `elk_hide` floating pickup.
6. **Delivery.** `checkDeliveries` with `{ item: 'elk_hide', to: { species:
   'elder' }, sets: 'hide_given' }` — stand beside Aspengrove's elder carrying
   the hide. He cuts it into Hiisi-hide boots.

**Reward:** the new talent **Ski-legs** — sprint drains 40 % less stamina, for
the rest of the game, on every map and in every mode that persists talents.

**Flags:** `hunt_seen`, `flush` (0–3), `hirvi_dead`, `hide_given`.
**Rule:** `f => !!f.hide_given`.

**Failure modes.**

- *Hide dropped or lost.* The pickup is re-spawned at `wallow 3` by `onArrive`
  whenever `hirvi_dead && !hide_given`. The quest cannot dead-end.
- *Player leaves mid-chase.* `flush` is on the save; `onArrive` re-homes the elk
  at the wallow that flag names and re-stamps the current trail.
- *Elk killed early.* It cannot be: while `flush < 3` it is a story creature
  (`driver: 'hook'`) that flees on approach and takes no damage — `CREATURE_HIT`
  absorbs everything until it makes its stand. This is deliberate: the hunt is
  the content, and a lucky longbow shot at wallow 1 would delete it.
- *Total chase length* is ~170 steps plus a 36-step walk back. Sprint makes that
  brisk; if it plays long in a live check, move `wallow 2` in (leg 2 is the
  longest at 70).

## 3. Quest 2 — *Tervahauta*, the Tar Pit (depth 11, River Split) — the build

**Fiction.** Tar-burning, the most Finnish industry there is. You arrive to find
the south bridge's middle planks gone and the lumber camp idle: the crew will
not lay planks that rot by autumn, and no bridge on this river ever held without
tar. Fell the trees, burn the pit, tar the deck.

**Sites** (new POIs, `kind: 'landmark'`):

| Label | Cell | Note |
|---|---|---|
| `lumber camp` | 30,39 | existing `camp` POI — **do not add another `camp`/`village` POI to any map**: `openmap.js` anchors the whole village NPC roster on the first one it finds |
| `tar pit` | 34,39 | walkable, 4 cells east of the camp |
| `bridge gap 1..3` | 48,58 / 49,58 / 50,58 | the three water cells of the south bridge deck (`ow_water_0/1/0` under `ow_pier_log`) |

**Flow.**

1. **Arrival.** While `bridge_done` is false, the module breaks the three gap
   cells: drop the `ow_pier_log` overlay, set `TILE.WALL` + `losClear` (water,
   exactly the ferry's pier-gap treatment, inverted), `markTileDirty`. The crew
   explain what tar is for.
2. **Fell.** Six lumber, from the existing `systems/lumber.js` chop.
3. **Burn.** Standing on the `tar pit` carrying 6 lumber lights it: the lumber
   is spent through `spendLumber`'s own path with the module's own
   `TAR_PIT_COST = 6` (never by mutating the shared `CAMPFIRE_COST`), and the
   pit yields **3 Pine Tar** on the spot, with a toast. The pit becomes an
   `eternal` campfire entity at that moment and stays one for good.

   *No burn timer.* An earlier draft made the tar take 90 s of world time. The
   day clock wraps every `DAY_LENGTH` (360 s) and only advances on surface
   frames, so a wait gate built on it misreads any absence longer than a day,
   and a self-advanced counter would need persisting every frame. The chore is
   already six trees' worth of chopping and three carries; the timer bought
   nothing and is cut.
4. **Plank.** Walk onto a broken gap carrying tar: one tar is spent, the log
   overlay returns, the cell goes walkable, `markTileDirty`. Three tar, three
   cells, and the bridge stands — permanently, from the flag, on every future
   arrival.

**Reward:** the **Tervajousi** (Tarred Bow) from the crew when the deck is
whole. The permanent cookfire arrives earlier, the moment the pit is lit — a
reward for building, re-created from `pit_lit` on every arrival.

**Honest accounting of the bridge.** A flood fill of the map says the repaired
south bridge saves *no* steps to any POI: both banks are reachable around it,
and no distance to the shrine, the bear cave or any cache changes by one step.
It is a visible, permanent change the player made with their own hands — not a
shortcut, and it will not be sold as one. The Tervajousi and the permanent
cookfire are the reward.

**The north bridge is off limits.** It is the map's only route to the bear cave
(its sole dungeon) and to the river shrine's waystone. Breaking it would
hard-block progression. Never target it.

**Flags:** `bridge_seen`, `pit_lit`, `plank_1`, `plank_2`, `plank_3`,
`bridge_done`.
**Rule:** `f => !!f.bridge_done`.

**Failure modes.**

- *Tar dropped or lost.* The pit can be re-fired for another 3 tar as long as
  `bridge_done` is false. No dead end at any lumber count.
- *Player plants tar in the wrong place.* Tar is `quest: true`, so the sack
  panel offers it no action but Drop; the only thing that consumes it is
  standing on a gap cell.
- *Partial progress.* `plank_N` flags are independent; the module restores
  exactly the cells whose flags are set.

## 4. Quest 3 — *Kivihiisi*, the Hiisi of the Pass (depth 12, Mountain Pass) — the beast

**Fiction.** A *hiidenkiuas* — a giant's oven — sits among the boulders west of
the pass. The hermit has boarded his door and his goats are gone. Break the
capstone and the thing under it gets up.

**Site.** New POI `hiidenkiuas` at **38,30** (`kind: 'landmark'`): a wide-open
walkable bowl, 50 steps from the hermit hut, 60 from the stone circle, 42 from
the nearest existing POI.

**Not the stone circle.** `stone circle` (84,22) is this map's `exitPoi` — the
waystone stands there. A boss camped on the exit is a nuisance at best and an
escape hatch at worst. The kiuas gets its own site.

**Flow.**

1. **Arrival.** While `hiisi_dead` is false the module stamps its own arena:
   the first `stones` cells of a fixed six-cell ring at radius 3 around the
   kiuas get an `ow_mtn_rock_*` boulder, plus a capstone prop at the centre.
   Stamping the ring rather than relying on the generator's incidental rock
   scatter makes the fight's mechanic terrain-independent and testable.

   `stones` (a flag, 6 down to 0) is the standing-boulder count, decremented
   when the player mines one. Counting rather than reading the map is
   deliberate: a module-stamped boulder is not in the map JSON, so
   `applyFelled` cannot restore its cleared state on the next build (it finds
   no harvestable art there and skips the cell), and a re-stamp that trusted
   the felled record alone would regrow the ring. The count is the truth; the
   stray `cleared: 'rock'` the mine leaves in `save.felled` is harmless.
2. **Wake.** Mining the capstone (`systems/lumber.js` `HARVEST`, `tool: 'mine'`,
   so a pick is needed — the Mountain Pass mines already hand them out) sets
   `hiisi_woken` and spawns the Kivihiisi.
3. **The stone cladding.** The Hiisi carries `clad` (0–3). While `clad > 0`,
   `CREATURE_HIT.kivihiisi` absorbs the damage and strips one layer per hit
   (`absorbed: true`, a stone cue). Every 6 s it re-clads by one — but never
   above `stones`, **the number of boulders still standing in the ring**. Mine the ring
   out and it cannot re-clad; then it is a fair, hard fight (hp 40, dmg 3,
   slow, heavy hits). A frozen Hiisi loses all cladding on the next hit, which
   is the magic build's route in (`systems/status.js`'s shatter rule).
4. **Death.** Sets `hiisi_dead` and drops the reward at the kiuas.

**Reward:** **Ukonvasara**, Ukko's hammer — heavy, damage 5, and on hit it calls
a lightning strike on the struck cell (4 s cooldown).

**Flags:** `kiuas_found`, `hiisi_woken`, `stones` (6→0), `hiisi_dead`.
**Rule:** `f => !!f.hiisi_dead`.

**Failure modes.**

- *No pick.* The capstone needs `mine`; a player without one simply hasn't
  started the quest. The hermit's line says so ("nothing but a pick opens that").
- *Player flees mid-fight.* `hiisi_woken` persists; `onArrive` re-spawns the
  Hiisi at the kiuas with cladding capped by `stones`, and re-stamps only that
  many boulders — the mined ones stay mined.
- *Reward lost.* Re-spawned by `onArrive` while `hiisi_dead` and the hammer is
  neither carried nor in the sack.

## 5. New content

### Creatures (`renderer/data/monsters/`, both on the existing `quadruped` rig)

| Name | Rig params | Stats | Behaviour |
|---|---|---|---|
| `hirvi` | long body, long legs, `horns: true`, grey-brown hide | hp 30, dmg 2, speed 95 | `driver: 'hook'`, `taxon: 'beast'` — the module owns its whole per-frame update (flee / stand), like the Näkki |
| `kivihiisi` | squat, huge, thick short legs, stone-grey, `horns: true` | hp 40, dmg 3, speed 45, half 12 | ordinary brain (chase/attack) plus a `CREATURE_HIT` hook for the cladding, like the Podeboo |

Both names pass `^[a-z0-9_]+$` and collide with nothing in `RESERVED_NAMES`.
Both need an entry in `renderer/data/monsters/index.json`. Both hook modules go
in `renderer/systems/monsters/`. Tuning happens in `npm run monster-lab`.

### Weapons (`renderer/systems/entities.js`)

| Type | Table | Row |
|---|---|---|
| `tervajousi` | `RANGED_WEAPON_TYPES` | Tarred Bow — damage 3, cooldown 0.7, `draw: true`, `fire: { tiles: 3 }` |
| `ukonvasara` | `WEAPON_TYPES` | Ukonvasara — damage 5, `heavy: true`, `lightning: { cooldown: 4 }` |

- **Incendiary arrows.** `RANGED_FLAG_KEYS` gains `'fire'`. `ranged.js` stamps
  the arrow with the fireball's own detonation fields (`explodes`,
  `blastTiles: 3`) plus `fireOnly: true`; `game.js`'s existing `detonate` hook
  lays `makeFireZone(computeBlastTiles(...))` and skips `applyBurst` for a
  `fireOnly` projectile. An arrow leaves a small burning patch; it does not
  carry a fireball's burst damage.
- **Ukonvasara's strike.** `spells/lightning.js` gains `markStrike(state, x, y)`
  — the mark-push `castLightning` already does, extracted and callable at an
  arbitrary cell. `game.js`'s melee block already collects `struck` enemies for
  the Maunonmiekka's shockwave (game.js:1315-1325); the hammer hooks in beside
  it, on a cooldown stored on the player. `tickLightning` already runs every
  frame, so the delayed strike, the flash and the thunder all come for free.
- **Icons.** `iconSpriteFor` falls back to `weapon_sword` / `weapon_shortbow`
  for an unknown `weaponType`, so both weapons show sensible art on day one; a
  proper atlas sprite for each can follow.

### Talent (`renderer/systems/talents.js`)

```js
ski_legs: { name: 'Ski-legs', desc: 'Sprinting costs far less stamina.' }
```

`stamina.js` grows `sprintProfile(mode, { skiLegs } = {})`, multiplying `drain`
by `SKI_LEGS_DRAIN = 0.6` when the talent is held — pure, unit-testable, and the
only call site is `game.js`'s sprint handling.

**Note the side effect:** `RUSH_START_TALENTS = Object.keys(TALENTS)`, so a new
`TALENTS` entry silently joins Dungeon Rush's starting kit. That is wanted here
(Rush is about the descent, not the unlocks) but it must be a deliberate
statement, not a surprise. `MAP_CLEAR_TALENTS` is unchanged.

### Items (`renderer/systems/inventory.js`, `STACKABLE_KINDS`)

| Kind | Name | Emoji | Extra |
|---|---|---|---|
| `elk_hide` | Elk Hide | 🦌 | `{ quest: true }` |
| `tar` | Pine Tar | 🛢 | `{ quest: true }` |

`quest: true` means carry-only: `primaryAction` returns null, Drop stays. No
inventory-panel changes at all.

## 6. Tiles and art

Nothing new is drawn. Trails and trampled ground reuse `ow_dirt_0..3`; the
boulder ring reuses `ow_mtn_rock_0..5` (already in `HARVEST` as `tool: 'mine'`);
the bridge planks reuse `ow_pier_log`; the tar pit's flame is the existing
campfire render.

## 7. Map data changes

POIs are added to `tools/static-overworld/out/maps/*.json` and the game module
re-exported with `node tools/static-overworld/export-game-maps.mjs`. **No
terrain regeneration**: `forest-2-river` is hand-painted and `gen-forest.mjs`
would overwrite it, and `mountain.mjs` owns depth 12's terrain. Only the `pois`
arrays change.

| Map | POIs added |
|---|---|
| `forest-1-clearings` | `wallow 1` (112,8), `wallow 2` (54,6), `wallow 3` (57,41) |
| `forest-2-river` | `tar pit` (34,39), `bridge gap 1` (48,58), `bridge gap 2` (49,58), `bridge gap 3` (50,58) |
| `forest-3-autumn` | `hiidenkiuas` (38,30) |

Two collision rules, both load-bearing:

- Every new POI is `kind: 'landmark'`. Never `village` or `camp` — `openmap.js`
  anchors the entire village NPC roster on the first POI of those kinds.
- Never reuse a label a rite names (`renderer/data/rites.js` matches
  `kind: 'landmark'` by label and would plant a talent trigger on it).

`caveDepths` pairs with `dungeon_entrance` POIs in POI order, so adding
landmarks cannot disturb it. `exitPoi` resolves by label and is likewise
unaffected.

## 8. Testing

**Unit (`node:test`, `test/`)** — everything below is pure and gets a test file:

- `test/story.test.js` — the extracted helpers: flag accessor creates and
  persists, `checkDeliveries` spends exactly one item and sets one flag,
  `makeCtx`'s `state` getter follows a swapped state object.
- `test/quests.test.js` — `questFor` is null on leap maps and on maps with no
  declaration; `questLines` picks the first matching stage; `isQuestDone`
  matches each map's rule; `normalizeAdventureSave` defaults `quests` and
  `resetNpcs` leaves it alone.
- `test/quest-clearings.test.js` — flush progression 0→3, the elk absorbs all
  damage before its stand and none after, trail cells are stamped and marked
  dirty, `onArrive` re-homes from any flag state, hide re-spawn when lost.
- `test/quest-river.test.js` — gaps break and re-plank from flags, the pit needs
  6 lumber and yields 3 tar, lighting it leaves an eternal fire that `onArrive`
  restores, each plank spends exactly one tar, `bridge_done` only at three
  planks, re-firing works while unfinished.
- `test/quest-pass.test.js` — ring stamping is idempotent and honours `stones`,
  cladding absorbs and strips, re-clad is capped by `stones`, zero boulders
  means no re-clad, frozen loses all cladding, death sets the flag once.
- Extensions to existing suites: `sprintProfile` with and without `ski_legs`;
  `markStrike` places one mark at the named cell; a `fireOnly` projectile lays a
  fire zone and deals no burst damage.

**Live** — each quest gets one short Electron check via the level cheats
(`level7`, `level11`, `level12`) with `--dcdebug`, time-boxed: walk the beats,
confirm the toasts, the villagers' changed lines, the persisted flags across a
reload, and that the waystone is unaffected. Keep these short; the unit tests
carry the logic.

## 9. Phasing

Three slices, each shippable on its own:

1. **Engine + the hunt.** `systems/story.js` extraction, `quests.js`, save
   field, `game.js` wiring, `hirvi`, tracks, Ski-legs, the Clearings module.
2. **The build.** Tar, the pit, the gap cells, `tervajousi` and its incendiary
   arrow, the River Split module.
3. **The beast.** `kivihiisi`, the cladding hook, the boulder ring,
   `markStrike`, `ukonvasara`, the Mountain Pass module.

Slice 1 carries the shared engine, so it lands first. Slices 2 and 3 are
independent of each other.
