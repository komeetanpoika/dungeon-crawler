# Leap episodes — design

Date: 2026-08-29

## Goal

Three new open maps, inserted into the Adventure chain right after Clearings,
whose runestones (the waystone arches) each wake by a **different, discovered
condition** instead of "clear every dungeon". The structure is borrowed from
*Quantum Leap*: on arrival the villagers greet the player as a **missing
local**; the player is standing in that person's life; the stone stays dark
until the thing that person left broken is put right; the moment it is, the
missing person walks back into the village and the stone hums. A guide only
the player can see — the **Echo** — gives odds, never answers.

Each episode has one custom creature drawn with the game's asset builder (the
tile editor's Draw tab), and the fix is rarely "hit it until it dies".

## Non-goals

- No day/night cycle. "Dusk" in the ferry story is dropped; the bell rings
  whenever the clapper is hung.
- No quest log, no objective text, no HUD widgets. The Echo's bubbles and the
  world are the only readout.
- No fail state. Adventure has no game-over; every episode stays finishable
  from any reachable state (see Wolves for the one near-miss).
- The nine existing maps keep the "all dungeons cleared" rule unchanged.
- No new editor features: creature art uses the editor's existing 16×16
  custom-tile format, assembled 2×2 at draw time.
- No AI-assisted monster generator (still a separate, undesigned project).

## 1. Chain insertion and save migration

The three maps take depths **8, 9, 10**; the existing maps at 8–15 shift to
**11–18**. `LEVEL_CONFIG` grows its open-map block from 9 to 12 entries
(depths 7–18), which also enables the `level8`…`level18` cheats.

Adventure save → **v6**: `leaps: { [mapName]: { flags: {} } }` (additive,
defaults to `{}`) plus a one-time depth remap: on normalise, if the save has
no `v6` marker and `progress.mapDepth >= 8`, add 3 and set `v6: true`. Caves,
gates, npcs, felled and cleared are keyed by map *name* and need no change.

`export-game-maps.mjs` gains the three entries with `depth`, `caveDepths`
(one cave each), `exitPoi`, `npcs`, and a new `leap: true` flag copied into
the exported map data.

## 2. Leap framework — `systems/leap.js` + `data/leaps.js`

`data/leaps.js` — one **episode** per leap map:

```
{
  persona: { name: 'Toivo', missing: { species, sprite } },
  villagerLines: [...],          // replace species lines while the episode is open
  echo: { spots: [{ fromPoi, lines: [{ when: flags => bool, text }] }] },
  creature: { type: 'nakki', fromPoi: 'pier end' },
  items: [{ kind: 'clapper', fromPoi: 'islet cache' }],
  deliveries: [{ item: 'clapper', toPoi: 'bell', sets: 'bell_hung' }, ...],
  rule: flags => bool,           // when the stone wakes
}
```

`systems/leap.js` (pure): `episodeFor(mapData)`, `leapFlags(save, mapName)`,
`setFlag(save, mapName, flag, value)`, `isMapUnlocked(save, mapData)` =
episode ? `episode.rule(flags)` : `isMapComplete(...)`, `isResolved(save,
mapData)`, `echoLine(episode, spot, flags)`, plus the tick helpers each
episode needs (below). `game.js` wiring: the waystone check calls
`isMapUnlocked`; on resolution `resolveEpisode` spawns the missing person at
the village POI, restores villager lines and cues `leap`.

### Shared mechanics

- **Persona greeting** — `interactNpc` and the spawn-time greeting pick lines
  from `episode.villagerLines` while unresolved. The missing person is a
  villager species with a distinct sprite (`npc_villager_2/3`) and a `role:
  'missing'`; it spawns only when resolved.
- **The Echo** — an entity `{ type: 'echo', spot }` at each `echo.spots` POI,
  drawn at 50 % alpha with the wizard sprite tinted blue, never hittable,
  never a blocker, ignored by enemy perception. Walking orthogonally adjacent
  triggers `speakFrom` with the first `lines` entry whose `when(flags)` holds;
  re-triggers only after stepping away (`state.echoHold`). Lines are the
  progress meter: `"Ziggy puts it at 72% this is about the bell."`
- **Carry-items** — `clapper`, `fleece`, `pick` are sack kinds. `clapper` and
  `fleece` are non-consumable stackables (`quest: true`, panel action none,
  droppable). `pick` is a **weapon** (`damage: 2, chop: 1, mine: 1`).
- **Delivery** — walking onto a delivery target while carrying the item.
  Targets are a POI cell (bell) or an NPC with a `role` (elder). The item is
  removed, the flag set, a cue plays, and any `gives` item drops beside the
  player as a `floating_item`.
- **Harvestable rocks** — `lumber.js` generalises to a `HARVEST` table keyed
  by overlay: trees need `chop`, `ow_rock_*` overlays need `mine` (hp 3, no
  yield, cell becomes plain floor). `findTreeHit`/`chopTree` become
  `findHarvestHit(map, player, hitAt, reach, tool)` / `harvest(...)`;
  `felledCells` records both (stump or cleared rock) as before.

## 3. Episodes

### 3.1 The Ferryman's Bell — `lake-1-ferry` (depth 8)

Persona: **Toivo**, the ferryman who "drowned last spring". The village on the
west shore has an orchard on the east bank; the pier that joins them is where
the **Näkki** waits.

Map: west-shore village (well, sign, houses), a lake through the middle with a
pier of `ow_pier_*` tiles from the west shore to a mid-lake bell post (POI
`bell`), an east-bank orchard (apple trees) reachable only across the pier, an
islet ringed by trees holding the cache with the clapper (POI `islet cache`,
reached by chopping a shore tree line), Toivo's hut with a fish-rack sign,
one cave.

Flags: `clapper` (carried), `bell_hung`, `fed` (0–3), `nakki_gone`.

- Deliver `clapper` → `bell` cell: `bell_hung`, cue `bell`; the Näkki
  spawns at `pier end` in state `surfaced`.
- **Näkki** (`systems/nakki.js`): stationary water creature beside the pier.
  States `submerged` (invisible, 4 s) ↔ `surfaced` (visible). Surfaced and the
  player on the pier-end cell: a *drag* attack every 2 s — 1 damage and a
  knockback toward the shore. Unkillable: any hit sinks it (`submerged`),
  no HP bar (`maxHp` undefined). The Echo, when swung at: *"That's not it,
  Sam. Ziggy says you're 91 % more likely to feed it than beat it."*
- **Feeding**: player on the pier-end cell, Näkki surfaced, sack holds
  `cooked_meat` → one cooked meat is removed, `fed++`, cue `sizzle`, the
  Näkki submerges. Raw meat does nothing (Echo: *"Toivo smoked his fish."*).
- `fed === 3` → `nakki_gone`: the creature is removed, the pier's last two
  cells (baked as water) turn to pier tiles (walkable), Toivo spawns.
- Rule: `flags.nakki_gone`.

### 3.2 Wolves at the Fold — `highland-2-fold` (depth 9)

Persona: **Aino**, the shepherd's daughter who "ran off to the city". Lambs
vanish nightly; the village blames the wolves and is preparing to burn the
forest.

Map: highland village with a fenced sheep fold, a wolf den (rock hollow with
three wolves declared in `npcs.wild`), an old mine cave, a dirt-trail of
`ow_dirt_*` cells from the fold past the den to a rock-sealed burrow (POI
`burrow`, three `ow_rock_gray_*` cells across its mouth), the lamb fleece cache
at the burrow mouth, one cave.

Flags: `burn` (0–4), `fleece` (carried), `fleece_shown`, `pick`,
`maahinen_dead`.

- **Burn timer** (`tickBurn`): while `!fleece_shown`, every 120 s of map
  time `burn++` (max 4): a pre-authored band of forest (four POIs `burn 1..4`,
  radius 6) converts its trees to `ow_deadtree_*` overlays, cue `fire-burst`,
  and the Echo's line changes. At `burn === 4` the village faction turns
  hostile (existing wrath). `burn` persists in flags; converted cells persist
  via `felled`-style keys (`burnt: ['x,y']`).
- Deliver `fleece` → elder (`role: 'elder'`): `fleece_shown`, wrath clears,
  the elder drops the `pick` (weapon) beside the player, cue `talent-learned`.
- Break the burrow rocks with the pick (harvest, `mine`) to enter the lair.
- **Maahinen** (`systems/maahinen.js`): 2×2 burrower. States `submerged`
  (invisible, invulnerable, moves under ground toward the player at 60 px/s),
  `erupting` (0.6 s telegraph: dust ring), `surfaced` (melee `maul`, chases
  with the enemy brain, `half: 28`), and at ≤ 50 % HP `submerging` then
  resurfaces 4–6 tiles away. HP 24. Dies on the surface only.
- Rule: `flags.maahinen_dead && wolvesAlive(save, map) >= 1`, where
  `wolvesAlive` counts declared wolves not in the npc `dead` record. With all
  three wolves dead the Echo says the odds are 0 % and the stone stays dark
  until the player dies (death resets `npcs`, respawning the wolves — the
  existing Groundhog-Day rule makes this recoverable).

### 3.3 The Hermit's Fire — `marsh-3-hermit` (depth 10)

Persona: **Lauri**, the hermit's apprentice who "left after the argument".
Every hearth in the village is cold; the hermit sits silent in a hut ringed by
dead trees.

Map: marsh village with three cold hearth props (`prop_hearth_cold`, new
tiles), a mushroom ring (rite anchor — reuse `mushroom_circle` visuals with no
talent), the hermit's hut on a knoll ringed by `ow_deadtree_*`, the hearth cell
in front of the hut (POI `hearth`), one cave.

Flags: `hearth_lit`, `wraith_dead`.

- **Sammunut** (`systems/sammunut.js`): 2×2 wraith. Drifts (80 px/s) toward
  the nearest campfire entity; on reaching it the fire is removed
  (`campfire-out`). With no fire it wanders. **Visibility**: drawn only when
  within 5 tiles of a burning campfire, or while the player is in a mushroom
  trance (`player.trance`), or for 0.5 s after touching the player.
  **Touch**: within 20 px of the player drains 12 stamina/s (no HP damage).
  **Vulnerability**: takes damage only within 5 tiles of a burning campfire;
  elsewhere hits sink into it with a `chop`-style dull cue and the Echo
  comments. HP 18.
- **Hearth fire**: building a campfire whose spot is the `hearth` cell sets
  `hearth_lit`; that campfire is flagged `eternal` (never ticks out, the
  wraith cannot snuff it). The wraith is drawn toward it and becomes
  vulnerable there — the fight happens in the firelight.
- `wraith_dead` → the three `prop_hearth_cold` overlays switch to
  `prop_hearth_lit`, the hermit (`role: 'hermit'`, previously silent — one
  line "…") gains lines, Lauri spawns, cue `leap`.
- Rule: `flags.wraith_dead`.

## 4. Creature art — the asset builder

Each creature is four `custom_<name>_{00,01,10,11}.png` 16×16 tiles saved in
the tile editor's custom-tile format (`renderer/assets/tiles/`), drawn in the
Draw tab (transparent background, Kenney palette). The renderer assembles
them 2×2 (`drawCreature(ctx, sprites, name, px, py, S)`), the same 64 px
footprint the cyclops uses. Näkki: green-black, weed-hair, two pale eyes, only
head and shoulders (it is always in water). Maahinen: brown, blunt snout, two
digging claws, dust. Sammunut: blue-grey, ragged, no feet, one ember eye.

## 5. Maps — `tools/static-overworld/gen-leap.mjs`

Built with `MapBuilder` and validated by `validate()`; the lib invariants
hold (border ring blocked, edges dressed, 2-tall trees pruned). Each map
declares the POIs the episode references (`village`, `bell`, `pier end`,
`islet cache`, `burrow`, `burn 1..4`, `hearth`, `mushroom ring`, one
`dungeon_entrance`, 3–4 `chest` caches) and a `playerSpawn` beside the
arrival runestone (a second stone arch on the entry side; the exit arch is
`exitPoi`). Rendered PNG previews go to `out/png/` like the others.

## 6. Sound cues

`bell` (blip, triangle, long decay), `leap` (swoosh up + rumble), `echo`
(soft triangle blip), `drag` (rumble, short), `erupt` (rumble 0.4 s),
`wraith-touch` (swoosh down, quiet).

## 7. Testing

- `test/leap.test.js` — episode lookup, flag set/get, each rule, v6 depth
  remap, `wolvesAlive`, `echoLine` selection.
- `test/nakki.test.js`, `test/maahinen.test.js`, `test/sammunut.test.js` —
  state machines against a fake state (pattern: `test/cyclops.test.js`):
  surface/sink, feed counting, erupt telegraph and half-HP submerge,
  fire-seeking, visibility and vulnerability rules, stamina drain.
- `test/lumber.test.js` — harvest table, `mine` vs `chop` gating, rocks
  clear to floor without yield.
- `test/leap-maps.test.js` — the three exported maps pass `validate()`,
  contain every POI the episodes reference, and their leap maps are at
  depths 8–10 with the old maps shifted.
- `test/sprites.test.js` — the twelve creature tiles and two hearth props
  exist.
- Live: one Playwright driver per episode (teleport + set flags via
  `window.__dc.state`), time-boxed; screenshots of each creature.

## 8. Build order

1. Framework: save v6 + depth remap, `LEVEL_CONFIG` growth, `data/leaps.js`
   shape, `systems/leap.js`, waystone gate, Echo entity, carry-items and
   delivery, harvestable rocks + `pick`.
2. Creatures: art tiles, `nakki.js`, `maahinen.js`, `sammunut.js`, renderer
   2×2 assembly, cues.
3. Maps + episodes: `gen-leap.mjs`, export, the three episode records, burn
   timer, feeding, hearth fire, resolution spawns.
4. Live checks per episode; docs.
