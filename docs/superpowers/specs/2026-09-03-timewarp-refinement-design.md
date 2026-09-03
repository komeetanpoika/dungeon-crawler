# Timewarp refinement — design

Refines the three Timewarp (leap) episodes at depths 8–10. Builds on
`2026-08-29-leap-episodes-design.md` (episodes) and
`2026-08-31-monster-generator-design.md` (rigs); this document only states
what changes.

## Goal

Three complaints, from play:

1. The **Echo** reads as a statue. It stands on a POI cell and never moves.
2. The three episode **creatures look out of place**: flat, single-shade 2×2
   custom tiles with hard outlines and one frame each, beside shaded atlas art
   and animated generated monsters.
3. **Vanishing is glitchy.** Every creature transition is an alpha snap (Näkki
   surfaced→gone on a hit, Sammunut winking out at the firelight edge, the
   Maahinen teleporting under a 0.4 s half-fade) and every death is an
   immediate array cull with no death pose.

And a design change: two of the three puzzles are won by melee. That does not
fit the mode. Every episode is resolved by **luring or feeding**, with combat
left in only as a nearly impossible backup, and the Echo's hints become vague
observations rather than instructions.

## Non-goals

- No change to the runestone rules, flag names, or the Timewarp save shape.
  Existing `timewarp.json` mini-saves keep working.
- No new editor features. The custom-tile creature path is deleted, not
  extended.
- No new HUD. The Echo's bubbles and the world stay the only readout.
- Boarhound/podeboo/rappeluu keep their looks and stats; they only pick up the
  shared dying phase.

## 1. Creatures become generated monsters

The three creatures move onto the monster-generator pipeline so they get
shading, animation, poses, and monster-lab tuning like every other generated
monster.

### Definitions — `renderer/data/monsters/`

| name | rig | notes |
|---|---|---|
| `nakki` | `lurker` (new) | `behavior.passive: true`, `behavior.driver: 'hook'` |
| `maahinen` | `quadruped` | mole-shaped params (short legs, long snout, no tail, dark hide, no horns); `behavior.driver: 'hook'`, `stats.hp: 36` |
| `sammunut` | `wraith` (new) | `behavior.driver: 'hook'`, `stats.hp: 18` |

All three: `hooks: true`, `spawn: null` (never rolled by depth or outskirts —
the episodes own their casts), listed in `index.json`.

Two new `behavior` keys read by the game loader and `systems/factions.js`:

- `driver: 'hook'` — the hook module owns movement. The enemy loop runs
  `updateMonsterPose` and the `CREATURE_UPDATE` hook and **skips brain/act**.
  The hook calls `updateBrain`/`act` itself when it wants them (the Maahinen
  on the surface does exactly this today). Hook-driven monsters are updated
  even when they are not enemies (the passive Näkki), so the update dispatch
  sits before the `isEnemy` gate.
- `passive: true` — `isEnemy` is false (never chased, never brain-targeted,
  not counted as a threat), `isHittable` stays true.

Hook-driven monsters are excluded from gust and slam, exactly as
`CREATURE_TYPES` were. A helper `isStoryCreature(e)` (registry def with
`driver: 'hook'`) replaces every `isCreature(e)` call site.

### Hook modules — `renderer/systems/monsters/`

`systems/nakki.js`, `systems/maahinen.js`, `systems/sammunut.js` move to
`systems/monsters/<name>.js` (the loader's hook path) and keep registering
into `CREATURE_HIT` / `CREATURE_UPDATE` / `CREATURE_ALPHA`. `CREATURE_MAKE`
is deleted: hooks lazily initialise their state on the entity on first update
(`e.lurk ??= {...}`), the way podeboo's `e.laser` does. Episodes spawn with
`ctx.spawn([{ kind: 'nakki', x, y }])`, which lands in `buildEntities`'
default case → `makeMonsterFromDef`. The ferry episode still stamps `pierEnd`
on the spawned entity.

### Removed

`CREATURE_TYPES`, `isCreature`, `makeCreature`, `CREATURE_MAKE`,
`drawCreature`, `CREATURE_SPRITES`, the twelve `custom_<name>_XY.png` tiles
and their `sprites.js` entries, and the `'creature'` kind in `buildEntities`.
The names `nakki`/`maahinen`/`sammunut` leave `RESERVED_NAMES` (they are now
registry names). `creature` stays reserved as a dead kind name.

### Registry monsters are hittable

`isHittable(e)` gains `|| !!getMonsterDef(e.type)` so the passive Näkki can
be swung at. `isEnemy` gains the `!def.behavior.passive` guard.

## 2. Rigs — `renderer/render/monster-rigs/`

Same contract as `quadruped`: `RIG_ID`, `PARAM_SCHEMA`, `drawMonster(ctx,
params, pose, S)`, `hitHalf(params)`, rect-only art through `withPixelStage`.
Rigs may read extra pose channels a hook writes (like `headAim`/`eyeGlow`):

| channel | range | meaning |
|---|---|---|
| `sink` | 0–1 | how far into the ground/water the body has gone (0 = fully up) |
| `burn` | 0–1 | how much of the wraith has burned away |
| `flicker` | 0–1 | per-frame visibility jitter strength |

`entityPose` passes them through with defaults (`sink: 0, burn: 0,
flicker: 0`).

### `lurker` (Näkki)

An upright creature seen from the waterline: a dome head with two wide-set
eyes, a fringe of weed hair hanging off the crown, a wide, low body silhouette
just under the head, and a ripple ring below it. Upright art — it does not
rotate with facing; `pose.facing` only flips it left/right. Idle: weed strands
sway on a 2-frame loop, the ripple ring grows and fades on a ~1.2 s loop.
`sink`: the whole figure translates down by `sink × height` and is clipped at
the waterline, so it goes under rather than fading. Hit: white flash (as
quadruped). Death: not used (the Näkki never dies).

Params: `headSize`, `headWidth`, `eyeSize`, `eyeGap`, `weedLength`,
`weedCount`, `sway`, `rippleSize`, colours `skinColor`, `weedColor`,
`eyeColor`, `rippleColor`.

### `wraith` (Sammunut)

A hooded, legless figure: rounded cowl, a dark hollow face with two ember
eyes, a body that tapers down into 3–5 tatters that flutter on a 4-frame loop.
Upright, flips with facing. `flicker`: per-frame alpha jitter from the pose
seed and `t` (the wraith shudders as it fades). `burn`: the body shortens from
the tatters up and the ember tint spreads over the cloak. Hit: white flash.
Death (`state === 'death'`): over `stateT` the tatters detach and drift up as
1-px ember pixels while the cowl collapses and fades.

Params: `height`, `width`, `cowl`, `tatterCount`, `tatterLength`,
`flutterFreq`, `eyeSize`, colours `cloakColor`, `emberColor`, `eyeColor`.

### `quadruped` additions

Reads `sink`: translates the body down and scales y toward 0.25 as sink → 1,
so the Maahinen squashes into the ground when submerging and rises out of it
when erupting. No schema change.

## 3. Transitions — fades and a dying phase

### Fade — `systems/fade.js`

```
stepFade(e, target, delta, { inTime = 0.5, outTime = 0.35 }) → e.fadeA
```

Moves `e.fadeA` (default: `target`, so a freshly spawned invisible creature
starts invisible) toward `target` at the matching rate. Every creature's
`CREATURE_ALPHA` returns `e.fadeA × base` (base: Näkki 1, Maahinen 1,
Sammunut 0.85). Hooks set the target from their state:

| creature | target 1 | target 0 |
|---|---|---|
| Näkki | surfaced, rising | submerged (sinking runs `sink` up first, then fades) |
| Maahinen | surfaced, erupting | submerged, submerging (with `sink`) |
| Sammunut | in any firelight, trance, or 0.5 s after touch | otherwise; `flicker` = 1 − fadeA while moving |

`drawGeneratedMonster` already applies `creatureAlpha`; a target of 0 is only
skipped once `fadeA` reaches 0.

### Dying phase — `systems/dying.js`

Registry monsters no longer vanish on the frame HP reaches 0.

```
beginDying(e)            → e.dying = DEATH_TIME (0.7 s), e.attack = null
tickDying(entities, dt)  → decrements; returns entities with expired ones removed
```

- `isDead(e)` is unchanged for non-registry entities. For registry monsters
  the three cull sites in `game.js` call `cullDead(state, delta)` (one shared
  function): a registry monster with `hp <= 0` enters dying instead of being
  filtered; everything else culls as before.
- While `dying > 0`: `isHittable` and `isEnemy` are false, the enemy loop skips
  AI (pose still updates), the rig draws `state: 'death'` (already derived
  from `hp <= 0`), and `creatureAlpha` ramps to 0 over the last 40 % of the
  phase.
- Kill recording is unchanged and happens at the strike (`hurtCreature`,
  §5), never at cull.
- The Näkki has no HP. Its exit is a `leaving` flag set by the ferry episode:
  the hook plays the sink, then removes itself.

### Per-creature exits

- **Näkki**: `surfaced → sinking (0.6 s, sink 0→1, cue drag) → submerged
  (4 s, invisible) → rising (0.6 s, sink 1→0) → surfaced`. Feeding and hits
  both start `sinking`. `leaving` skips the rise and removes the entity.
- **Maahinen**: `submerging` (0.4 s) drives `sink` 0→1 then fades; the
  relocation still happens while invisible; `erupting` keeps its dust ring
  and drives `sink` 1→0 over its last 0.3 s.
- **Sammunut**: firelight edge, trance end and touch reveal all go through
  `stepFade`; death goes through the dying phase with the wraith's ember
  scatter.

## 4. The Echo — a companion ghost

### Behaviour — `systems/echo.js` (pure)

One Echo per leap map, spawned on the player's arrival cell (fresh load or
waystone) and updated from the surface episode tick (it does not exist in caves or interiors; all echo spots
are surface POIs).

```
updateEcho(echo, state, episode, mapData, flags, ctx, delta)
```

- **Follow**: target = one tile behind the player (against `player.facing`),
  6 px up. Position eases toward it (`k = min(1, 6·delta)`); a 2.2 Hz sine
  bob of ±3 px is added at draw time. It ignores walls and never blocks.
- **Visibility**: the nearest echo spot within `ECHO_RANGE` (5 tiles, px
  distance) whose current `echoLine` is non-null is the active spot. Fade
  target is 1 with an active spot, else 0 (`stepFade`, in 0.5 s, out 0.8 s).
- **Speech**: when visible and `(activeSpot, lineText)` differs from
  `echo.said`, `speakFrom` the line with the `echo` cue and store it. Leaving
  range clears `said`. Result: one line per entry, and a fresh line the
  moment progress changes while you stand there.
- **Trail**: every 0.08 s push `{px, py}` onto a 3-deep ring buffer for the
  afterimages.

`echoSpawns(mapData, at)` returns one spawn at the given arrival cell; `echoAdjacent` and
`state.echoHold` are removed.

### Look — `render/canvas.js`

Skipped while `fadeA` is 0. Otherwise: a soft radial glow ellipse under the
figure (cyan, alpha 0.18 × fade), two afterimages at the trail positions at
0.25× and 0.12× of the figure's alpha, then the figure itself: the wizard
sprite with the existing hue-rotate/saturate filter at `0.55 × fadeA`, drawn
at `py + bob`.

## 5. Puzzles without direct combat

### Shared: `hurtCreature`

```
hurtCreature(state, e, dmg, { source: 'player' | 'wolf' | 'fire' }) → { absorbed, cue, killed }
```

in `systems/creatures.js`. Runs the type's `CREATURE_HIT` hook, applies the
result to the live entity, records `state.creatureKills[type]` when HP reaches
0, and returns what the caller should cue. Both player strike sites in
`game.js` and the new wolf bite and fire burn call it; `recordCreatureKill`
goes away.

### 5.1 Ferry — unchanged rules, vaguer words

Feeding stays the solution. Hits still sink the Näkki. Only the lines change
(§6).

### 5.2 Fold — the wolves do the fighting

- **Wolves are neutral.** `EPISODES['highland-2-fold'].tame = ['wolf']`:
  NPCs of a tame species spawn with `hostile: false` on that map (applied
  where the map's NPC spawns are built). They still turn hostile if struck
  (`onNpcHit`, unchanged), so killing wolves remains the way to fail the rule.
- **Wolves hunt the Maahinen.** `NPC_SPECIES.wolf.prey = ['maahinen']` and a
  new goal `hunt_prey` ahead of `attack_hostile`:
  - `when`: a prey entity is surfaced (`state === 'surfaced'`, not dying)
    within `HUNT_RANGE` (8 tiles) with line of sight.
  - `run`: beyond `BITE_REACH` (30 px) → `{ mode: 'patrol', target: preyTile,
    speed }`; within reach → hold, and every `BITE_INTERVAL` (0.8 s) set a
    claw `attack` aimed at the prey (so `drawEnemySwing` shows it) and
    `hurtCreature(state, prey, BITE_DMG = 2, { source: 'wolf' })`, cue
    `melee-hit`.
- **Maahinen** (`hp 36`):
  - `source: 'player'` → takes the damage and immediately submerges (one hit
    per surfacing; it resurfaces 4–6 tiles from the player as today).
  - `source: 'wolf'` → takes the damage, no forced dive. The half/quarter HP
    dives stay, so the player has to lure it back to the den twice.
  - It never fights wolves; its brain still hunts the player.
  - `LEASH_TILES` 10 → 24 (lair to den is 18 tiles).
- Rule unchanged: `maahinen_dead && wolvesAlive >= 1`. Weapons-only kill
  needs 36 HP at one hit per surfacing — the nearly impossible backup.

### 5.3 Hermit — his own wood

- **Grey wood.** New sack kind `deadwood` ("Grey wood", icon `item_deadwood`
  — a grey recolour of the lumber placeholder). `HARVEST` gets a `drop` field
  (default `lumber`); `ow_deadtree_0/1` drop `deadwood`. The knoll's dead-tree
  ring supplies it; the hermit-hut woodpile prefab carries 3 deadwood instead
  of 3 lumber.
- **Campfires take either fuel.** `canBuildCampfire` / `spendLumber` accept
  `lumber` or `deadwood` (whichever stack the Build action was pressed on);
  `makeCampfire(x, y, { fuel })` stamps `fuel: 'deadwood'` → a grey fire
  (pale, blue-white flame: the campfire sprite drawn with a hue/desaturate
  filter). Both cook meat, both burn 60 s.
- **The hearth.** `hearth_lit` is set only by a **deadwood** fire on the
  hearth cell; that fire becomes `eternal`. `relightHearth` re-derives it as
  a deadwood eternal fire on later arrivals. A lumber fire there burns out
  normally (think: *"It gutters. Not his wood."*).
- **Sammunut** (`hp 18`, `BURN_DPS 4`, thirds at 12 and 6 HP):
  - Drawn to the nearest fire as today. **Ordinary fires** it snuffs on reach
    (unchanged). **Deadwood fires** it cannot snuff; inside their light
    (`FIRELIGHT`) it burns: `hurtCreature(…, BURN_DPS × delta, { source:
    'fire' })`, `burn` channel = 1 − hp/maxHp.
  - Crossing a third (hp ≤ 12, then ≤ 6) → `fleeing`: drifts away from the
    fire at 160 px/s to a far wander point and sets `shun = true`: deadwood
    fires stop being targets until it snuffs an ordinary fire (`shun =
    false`). So the player lures it back with lumber campfires; one built
    inside the hearth light burns it while it snuffs.
  - hp ≤ 0 → dying phase (ember scatter) → `wraith_dead` via `creatureKills`.
  - **Player hits** land only inside deadwood-fire light: flat 1 damage and
    the same flee + shun. Elsewhere absorbed (`chop` cue, a flicker). A
    weapons-only kill is 18 lures — the nearly impossible backup.
- Wood economy for the intended route: 3 deadwood (hearth) + 6 lumber (two
  lure fires). Extra deadwood fires anywhere also burn it, so a player who
  chops the whole knoll has a second route.

## 6. Echo lines

Vague and observational; still Ziggy-flavoured, never an instruction. Each
spot keeps its `when` ladder; texts replace the current ones.

**Ferry**
- runestone: `nakki_gone` → "The lake's gone flat. Oh boy — that's a wrap."
  · `bell_hung` → "Ziggy says whatever's out there isn't angry. It's hungry."
  · `clapper` → "The bell's been silent a long time. Toivo never let it."
  · default → "Oh boy. They call you Toivo. Ferryman. Something out on that
  pier has stopped."
- bell: `fed ≥ 1 && !nakki_gone` → "It liked that. Ziggy says Toivo never
  served anything raw." · `bell_hung` → "It's watching the end of the pier.
  It looks hungry." · default → "No clapper. Ziggy is oddly fond of the
  islet."
- Toivo's hut: "A fish rack, and a cold hearth. He fed the lake every dusk."

**Fold**
- runestone: dead + no wolves → "It's gone, and so are they. Ziggy's at 0 %,
  Sam. That isn't the fix." · `maahinen_dead` → "Quiet night at the fold.
  Oh boy." · `fleece_shown` → "Torches are down. Whatever's under the ridge
  keeps to its own ground — Ziggy thinks it dislikes company." · `burn ≥ 3`
  → "They're burning toward the den. Ziggy gives the wolves 40 %." · default
  → "Oh boy. You're Aino. They blame the wolves. Ziggy puts that at 12 %."
- den: "Wolves. No bones, no wool. Ziggy says they'd fight anything that
  came near their pups."
- burrow: `fleece_shown` → "Break the rocks and it'll come up after you.
  Somewhere with teeth would be nice." · default → "Lamb's fleece, and the
  prospector's mess. The elder should see this."

**Hermit**
- runestone: `wraith_dead` → "Hearths are lit. The old man is talking again.
  Oh boy." · `hearth_lit` → "That fire it can't put out. It hates it, and it
  can't leave a flame alone." · default → "Oh boy. You're Lauri. Something
  walks through here and eats the fires. Ziggy says only his own wood ever
  burned on that hearth."
- hearth: `hearth_lit` → "Stay in the light. Out there you can't touch it,
  and it drains you." · default → "His hearth. The grey trees on the knoll
  were his woodpile."
- mushroom ring: "The ring. A trance shows you where it walks, even in the
  dark."

Player `think` lines on absorbed hits: Maahinen "It just dives." · Sammunut
out of light "Your blade passes through it." · Näkki unchanged.

## 7. Sound cues

New: `sink` (Näkki going under), `wraith-burn` (crackling hiss while it
burns), `grey-fire` (deadwood fire lit). Existing `drag`, `erupt`,
`campfire-out`, `wraith-touch`, `echo` stay.

## 8. Testing

`node:test` files, one per changed system:

- `fade.test.js` — rates, default start, clamping.
- `dying.test.js` — registry monster enters dying at 0 HP, is not hittable or
  an enemy while dying, culls after `DEATH_TIME`; non-registry entities cull
  immediately.
- `echo.test.js` — follow easing, visibility by spot range, one line per
  entry, re-speak on line change, no line without an active spot.
- `npc.test.js` — `hunt_prey` selection, chase intent, bite cadence and
  damage via `hurtCreature`; tame species spawn non-hostile.
- `maahinen.test.js` — player hit forces a dive, wolf bite does not,
  threshold dives, leash 24, `sink` channel ramps.
- `sammunut.test.js` — burn in deadwood light only, thirds → flee + shun,
  shun clears on snuffing an ordinary fire, player hit in light = 1 dmg +
  flee, absorbed elsewhere, fade targets.
- `nakki.test.js` — sink/rise cycle, `leaving` removal.
- `campfire.test.js`, `lumber.test.js` — fuel kinds, `drop`, grey fire flag.
- `monster-rigs.test.js` — `lurker` and `wraith` schemas validate, draw on a
  stub context for every state and channel without throwing, `hitHalf`
  within nav range.
- `monsters.test.js` — the three defs load, `driver`/`passive` respected by
  `isEnemy`/`isHittable`.
- `episodes-fold.test.js`, `episodes-hermit.test.js`, `leap.test.js` — updated
  for the new spawn kind, tame wolves and the deadwood hearth.
- Live: one short arena/leap-map run per creature via the `arena-test`
  skill, time-boxed (transitions, Echo follow, wolf bites, grey fire).

## 9. Build order

1. Fade + dying phase (shared, no visible change yet).
2. `lurker` and `wraith` rigs, `quadruped` sink channel, monster-lab check.
3. Migrate the three creatures to registry monsters; delete the tile path.
4. Per-creature transitions (sink/rise, squash/rise, flicker/embers).
5. Echo follow/fade/speak + look.
6. Fold: tame wolves, `hunt_prey`, Maahinen hit sources, leash.
7. Hermit: deadwood, grey fires, deadwood hearth, burn/flee/shun.
8. Lines, cues, think texts.
9. Live verification.
