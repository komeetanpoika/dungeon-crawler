# Wands and Bows Redesign — Design

**Date:** 2026-09-05
**Status:** Approved (user: "sounds good, work freely from this stage onwards")

## Goal

Split the one "ranged" toolset into two. Bows, the crossbow and the sling are
the ranged player's weapons, fired in the ranged stance from a shared ammo
pool per ammo kind. Wands are what the wizard casts through: each wand held
in a new wand hand gives the magic stance a spell, priced in stamina like
Gust of Wind, with Gust remaining the wandless cast. The roster grows from
two bows and three wands to six ranged weapons and six wands, one of which
(Call Lightning) is a bespoke module with effects the shared primitives do
not cover.

## Decisions taken with the user

- Spells cost **stamina**, the one tank (no charges, no mana bar).
- Wands get their **own hand slot** (melee, bow, wand). A run can be
  swordsman, archer and wizard at once.
- Roster built as **data tables over a few primitives** (bolt, cone, zone,
  self); **Call Lightning is a bespoke module** with two extra effects (the
  flash through the weather layer, conduction through water).
- Rush starts with every talent (PR #29), so every drop is usable from depth 1.

## Player model

```
player.weapon   melee hand, unchanged
player.ranged   { weaponType, name, damage, cooldown, color, kind, ammoKind, ...def flags }  | null
player.wand     { weaponType, name, spell, color }                                           | null
player.ammo     { arrow: n, bolt: n, stone: n }     the quiver/pouch, shared by every bow
player.attackMode  'melee' | 'ranged' | 'magic'    unchanged
```

`player.ranged.ammo` / `maxAmmo` are gone. Ammo lives only in `player.ammo`.
Caps (`AMMO_CAPS`): arrow 40, bolt 24, stone 60.

## Tables

### `RANGED_WEAPON_TYPES` (`systems/entities.js`) — bows only

| type | name | dmg | cooldown | kind | ammoKind | bundle | flags |
|---|---|---|---|---|---|---|---|
| `shortbow` | Shortbow | 2 | 0.6 | bow | arrow | 12 | — |
| `hunterbow` | Hunter's Bow | 1 | 0.3 | bow | arrow | 20 | — (hold Space streams; the short cooldown is the feature) |
| `longbow` | Longbow | 3 | 0.7 | bow | arrow | 10 | `draw: true` (hold-to-draw tiers) |
| `splitbow` | Splitbow | 2 | 0.8 | bow | arrow | 10 | `fork: { after: 32, count: 3, spread: Math.PI / 9 }` |
| `crossbow` | Crossbow | 5 | 1.2 | crossbow | bolt | 8 | `heavy: true, knockback: 45, piercesShield: true` |
| `sling` | Sling | 1 | 0.5 | sling | stone | 20 | `stun: 0.5` |

`bundle` is the ammo a weapon pickup brings. Colours: bows `#facc15`,
crossbow `#e5e7eb`, sling `#a8a29e`. `makeRangedContents(type)` returns
`{ type: 'ranged', weaponType, name, damage, cooldown, color, kind, ammoKind, bundle, ...flags }`.

Longbow draw tiers (`DRAW_CHARGE = { full: 0.4, over: 0.9, moveFactor: 0.6 }`,
`resolveDrawTier(held)`): tap = plain shot; full = +1 dmg, `pierce: 1`;
over = +2 dmg, `pierce: Infinity`. Auto-release after `over + 0.5 s`.

### `WAND_TYPES` (`systems/entities.js`)

| type | name | spell | color |
|---|---|---|---|
| `sparkwand` | Spark Wand | `spark` | `#22d3ee` |
| `frostwand` | Frost Wand | `rime` | `#93c5fd` |
| `firewand` | Fireball Wand | `fireball` | `#f97316` |
| `bramblewand` | Bramble Wand | `bramble` | `#65a30d` |
| `blinkwand` | Blink Wand | `blink` | `#c084fc` |
| `stormwand` | Storm Wand | `lightning` | `#a78bfa` |

`makeWandContents(type)` → `{ type: 'wand', weaponType, name, spell, color }`.

### `SPELLS` (`systems/spells.js`)

Every spell: `{ id, name, primitive, cooldown, cost: { tap, full, over }, tiers: { tap, full, over } }`.
Charge tiers reuse `GUST_CHARGE` thresholds and `resolveGustTier`; the
affordable-tier degrade (`affordableGustTier`) generalises to
`affordableTier(stamina, cost, tier)`.

| id | primitive | cooldown | cost tap/full/over | tap | full | over |
|---|---|---|---|---|---|---|
| `gust` | cone | 3 | 14/22/40 | existing GUST_TIERS.tap | .full | .over |
| `spark` | bolt | 0.5 | 8/14/22 | 2 dmg, speed 340 | +`chain: 2` (arcs to 2 more enemies within 3 tiles, 2 dmg each) | `chain: 4` |
| `rime` | cone | 3 | 12/18/30 | reach 80, half-angle 55°, `slow: { mul: 0.4, dur: 3 }` | reach ×1.25, dur 4 | reach ×1.5, `freeze: 2` (stun 2 s + `frozen` flag; next melee hit on a frozen enemy deals +2 and clears it) |
| `fireball` | bolt | 1.0 | 18/26/40 | existing fireball, `blastTiles: 16` | 24 | 32 |
| `bramble` | zone | 4 | 14/20/32 | patch 3 tiles ahead, radius 1 (3×3 walkable cells), 6 s, `root: 2`, `dps: 1` | radius 1, 8 s, root 3 | radius 2, 10 s, root 3 |
| `blink` | self | 2.5 | 12/18/30 | teleport 4 tiles along facing; stops short at the last walkable cell; passes over enemies | +`invuln: 0.5` on arrival | + a tap-tier Gust cast from the origin, facing backwards |
| `lightning` | module | 4 | 20/30/50 | mark at 3 tiles | mark at 6 tiles | marks at 4, 6 and 8 tiles |

`tryCast(state, spellId, tier)` gates in this order: `magic_stance` talent →
`player.magicCooldown` → stamina (degrading the tier via `affordableTier`;
`{ ok: false, reason: 'stamina' }` when even tap is unaffordable) → spends,
sets `player.magicCooldown = spell.cooldown`, dispatches on `primitive`, and
returns `{ ok: true, spell, tier, ...primitive result }`. Fail reasons:
`not_learned`, `cooldown`, `stamina`.

`tryGust(state, tier)` in `magic.js` stays as the cone primitive's
implementation and is what `tryCast('gust')` calls; existing tests keep
passing. The cone primitive gains `slow` and `freeze` effects alongside
stun/knockback.

Primitive results (so game.js can spawn/feedback without knowing spells):
- **bolt** → `{ projectiles: [spec, ...] }`, each spec a projectile object
  ready to push (see Projectiles).
- **cone** → `{ caught }`.
- **zone** → pushes into `state.zones` and returns `{ zone }`.
- **self** → mutates the player (position, `invulnTimer`) and returns
  `{ from: {px,py}, to: {px,py} }` for the trail effect.
- **module** → the module's own return.

### Ground zones (`state.zones`)

`{ kind: 'bramble', tiles: [{x,y}], age, dur, root, dps, tickT }`. Ticked in
game.js next to fire zones: every enemy (not player, not story creature)
whose cell is in the zone gets `rootTimer = max(rootTimer, root)` on entry
and takes `dps` once per second while inside. Zones expire at `dur`.
The fireball's `state.fireZones` stays as is (out of scope to merge).

## Enemy status effects

New fields on enemies, ticked in the enemy update loop where `stunTimer` is:
- `slowTimer`, `slowMul` — `act()` multiplies `intent.speed` by `slowMul`
  while `slowTimer > 0`.
- `rootTimer` — `act()` performs no movement while `rootTimer > 0`; the
  enemy may still attack.
- `frozen` — set with a stun by Rime's over tier; cleared when the stun ends
  or by a melee shatter (+2 damage, applied in the player's melee hit path).
  Rendered as an icy tint (`filter: saturate(0.4) brightness(1.3)` plus a
  pale-blue overlay at 35% alpha).
- Sling `stun` and crossbow `knockback` apply through projectile `onHit`.

## Projectiles (`systems/projectiles.js`)

The friendly-projectile hit resolution moves out of game.js into
`stepProjectiles(state, delta, hooks)` with hooks
`{ hurt(e, dmg, p) → struck entity, detonate(px, py, blastTiles), damagePlayer(dmg) }`
so the module stays free of game.js internals. Projectile shape:

```
{ px, py, dx, dy, damage, color, shape: 'arrow'|'bolt'|'stone'|'spark', friendly,
  pierce?: n | Infinity,  hitIds: Set,      // pierce: keep flying after a hit
  fork?: { after, count, spread }, forked?: true,
  chain?: { left, range },                  // on hit, retarget to nearest unhit enemy within range
  onHit?: { stun?, knockback? },
  piercesShield?: true,
  explodes?: true, blastTiles?, maxDist?, distTraveled?, lastPx?, lastPy? }
```

Rules: a hit on an enemy applies damage via `hurt`, then `onHit`; a
`pierce` budget > 0 decrements and the projectile continues, adding the
enemy to `hitIds` so it is not hit twice; a `chain` with `left > 0` swaps
`dx,dy` toward the nearest enemy within `range` not in `hitIds` (else the
projectile ends); `fork` replaces the projectile with `count` copies fanned
by `spread` once `distTraveled >= after`; wizards with `shieldTimer > 0`
absorb hits unless `piercesShield`; the dragon boss is immune to all
friendly projectiles (unchanged). Enemy projectiles keep their current
player-hit logic.

## Firing in the ranged stance

`tryFire(player, tier = 'tap')` in `ranged.js`: gates on `ranged_stance`,
weapon, `player.ammo[ammoKind] > 0`, cooldown; spends one ammo; returns the
projectile spec fields (`damage, color, shape, pierce, fork, onHit,
piercesShield`) with the longbow's draw tier applied. game.js: with a `draw`
weapon, Space starts `player.charging = { t: 0, kind: 'draw' }` and release
fires at `resolveDrawTier(t)`; other bows fire on held Space at their
cooldown as today. `FIRE_FAIL_MESSAGES.no_ammo` becomes per kind: "Out of
arrows!", "Out of bolts!", "Out of stones!".

## Inventory, pickups, loot

- Sack item kinds: `weapon`, `ranged`, `wand`, plus consumables. Ammo is
  never a sack item: an ammo pickup goes straight into `player.ammo`
  (capped) and the float shows `+n`.
- `canEquip`: `ranged` needs `ranged_stance`; `wand` needs `magic_stance`;
  `payload.heavy` (crossbow, heavy melee) needs `heavy_weapons`. `equipItem`
  routes `wand` → `player.wand`.
- Walk-onto pickup of a ranged weapon: its `bundle` is added to
  `player.ammo[ammoKind]`; if the same `weaponType` is already carried (hand
  or sack) the weapon itself is discarded (ammo only); else empty allowed
  hand → equip, else sack. Wands: empty allowed hand → equip, else sack;
  a duplicate wand goes to the sack like any item.
- Chest contents shapes: `{ type: 'ammo', ammoKind, count }` and
  `{ type: 'wand', ...makeWandContents }` join the existing ones.
  `contentsFromItem` / `itemFromContents` handle `wand`.
- `rollChestLoot(depth, rng)`: potion 40% / melee 15% / ranged 15% /
  wand 15% / ammo 15%. Pools: shallow (depth < 3) ranged `shortbow,
  hunterbow, sling`, wands `sparkwand, frostwand`, ammo `arrow ×10, stone ×15`;
  deep ranged `longbow, splitbow, crossbow`, wands `firewand, bramblewand,
  blinkwand, stormwand`, ammo `arrow ×10, bolt ×6, stone ×15`.
- Mining a rock (`harvest` with a pick on an `ow_rock_*` cell) also adds
  3 stones to `player.ammo.stone` (game.js harvest path; float `+3`).
- Icons: `iconSrcFor` maps `wand` → `weapon_${weaponType}` and the ammo
  float uses `item_arrows` / `item_bolts` / `item_stones`.

## Saves

The travelling body (`activeSave.body`, Adventure and Timewarp mini-saves)
gains `wand` and `ammo`. `normalizeBody(body)` in `systems/adventure.js`
(called from `normalizeAdventureSave` and by the timewarp save loader):
- `body.wand ??= null`, `body.ammo ??= { arrow: 0, bolt: 0, stone: 0 }`.
- A pre-redesign `body.ranged` whose `weaponType` is a wand moves to
  `body.wand` (`makeWandContents`), else its `ammo` count is added to
  `body.ammo[ammoKind]` and the fields dropped.
- Sack items of kind `ranged` with a wand payload become kind `wand`.
- Unknown weapon types are dropped rather than crashing.

`startNewRun` copies `wand` and `ammo` alongside the existing hands.
`applyLoadout` (arena and episode kits) accepts `wandType` and `ammo`.

## HUD and sack panel

- `#hud-ammo` becomes the tool slot: in magic stance it shows the wand
  icon (dimmed via `hud-icon-empty` while stamina is below the spell's tap
  cost, no count); in ranged or melee stance it shows the bow with the
  pooled count of its `ammoKind`; hidden when the relevant hand is empty.
  `data-active="1"` when the stance matches the shown tool.
- Sack panel: a third hand line `🪄 <wand name | Empty>` when the player has
  `magic_stance` or a wand; the bow line shows `×<pool count>`.
- The magic stance draws the held wand sprite in hand (same `drawHeldWeapon`
  path); the ranged stance the bow. Sprite names `weapon_<type>`.

## Rendering

- Projectile shapes: `arrow` elongated (as now), `bolt` a 3×8 grey dart,
  `stone` a 4×4 grey square, `spark` a 4×4 in the wand colour with a
  2 px trail.
- Bramble zones: per tile a thorn scribble (three dark-green strokes) at
  60% alpha, fading over the final second.
- Blink: a 0.2 s trail of three fading player silhouettes between `from`
  and `to`.
- Rime cone: the existing gust shockwave ring in `#bfdbfe`.
- Frozen enemies: icy tint (above).

## Call Lightning (bespoke, `systems/spells/lightning.js`)

`castLightning(state, tier)` places marks: `state.lightning.push({ x, y,
t: 0, delay: 0.6, struck: false })` for each target tile (cells along the
facing at the tier's distances, clamped to the last walkable cell).
`tickLightning(state, delta, hooks)` advances marks; at `delay` a strike:
- Damage 5 and `stunTimer = 1.0` to every enemy in the 3×3 around the mark
  (`hooks.hurt`).
- **Conduction:** if the mark's cell is water (`skin` prefixed `ow_water_`
  or `ow_pond_`, or `overlay` `ow_pier_log` over water), flood-fill the
  connected water cells (cap 400) and hit every creature whose cell is in
  the set, story creatures included (`hurtCreature` handles absorption).
- `state.flash = 0.12` (seconds left of a white full-screen flash, alpha
  `flash / 0.12 × 0.85`, drawn after the weather passes).
- `state.weather.lightningT = 0.25` if the map has weather: while > 0,
  `weatherLook` returns `dark: 0` (the map is lit as day for that instant).
- SFX `thunder` (new recipe: low noise burst, 0.6 s) at the strike, `crackle`
  at the mark.
- Rendering: a crackling sigil on marked tiles (a rotating dashed ring in
  `#a78bfa`), and for 0.15 s after a strike a jagged white polyline from the
  top of the screen to the tile plus the 3×3 lit in `#e9d5ff` at 50%.

Over tier drops its three marks with the same delay so they strike as one
line.

## Timewarp

Wands and bows are ordinary loot; the leap puzzles stay lure-only and the
story creatures keep their existing absorb rules through `hurtCreature`.
Lightning conduction is the one deliberate exception: it is a real way to
hurt the Näkki in the lake, so `nakki`'s hit hook receives `source:
'lightning'` and may decide (this spec leaves its current behaviour: a
registry creature absorbs or takes damage per its own hook).

## Art

`tools/make-ranged-tiles.mjs` (pixel-map style like `make-firewand-tile.mjs`)
writes: `weapon_hunterbow`, `weapon_splitbow` (recoloured shortbow/longbow
shapes), `weapon_crossbow`, `weapon_sling`, `weapon_frostwand`,
`weapon_bramblewand`, `weapon_blinkwand` (the straight/wavy wand shapes with
new tip colours), `item_arrows`, `item_bolts`, `item_stones`. Registered in
`render/sprites.js`.

## Out of scope

- Enemy pathing around bramble patches.
- Merging `fireZones` into `zones`.
- New enemy types or enemy use of the new weapons.
- Gamepad bindings beyond the existing Space/Shift mapping.

## Testing

`node:test` per module: `entities` (tables, contents makers), `inventory`
(wand hand, ammo pool, duplicate-bow-to-ammo, equip gates), `loot`
(distribution with injected RNG), `adventure` (body migration), `ranged`
(pool gating, draw tiers), `projectiles` (pierce, fork, chain, onHit,
shield, boss immunity), `act`/enemy (slow, root, frozen shatter), `spells`
(tryCast gating and every primitive), `lightning` (marks, strike, water
conduction, flash and weather hooks), `hud` (tool slot rule), `canvas`
(held wand, projectile shapes). Runtime verification with the arena-test
skill and the `level<N>` cheats: fire every bow, cast every wand, watch a
lightning strike on the Ferry lake at night.
