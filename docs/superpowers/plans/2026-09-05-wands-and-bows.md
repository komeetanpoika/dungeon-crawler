# Wands and Bows Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bows/crossbow/sling fire from a pooled quiver in the ranged stance; wands in a new wand hand give the magic stance stamina-priced spells (six bows, six wands, Call Lightning bespoke).

**Architecture:** Data tables (`RANGED_WEAPON_TYPES`, `WAND_TYPES`, `SPELLS`) over four primitives (bolt, cone, zone, self) in pure `systems/` modules with node:test coverage; a new `systems/projectiles.js` owns friendly-projectile resolution; `systems/spells/lightning.js` is the one bespoke spell. game.js is touched only in the final wiring task so the module tasks can run in parallel without edit conflicts.

**Tech Stack:** Electron + vanilla ES modules, `node --test test/`, playwright-core for live checks.

**Spec:** `docs/superpowers/specs/2026-09-05-wands-and-bows-redesign.md` — read it first; every number and shape below comes from it.

## Global Constraints

- Pure `systems/` modules: no DOM, no canvas, no game.js imports. game.js owns feedback, SFX and spawning.
- Tests are `node:test` files in `test/`, one per system, run with `node --test test/<file>` (full suite: `npm test`). `test/map.test.js` "loot-roll chests" is a known random flake; ignore a single failure there.
- Keep the existing exports that other code imports (`tryGust`, `GUST_*`, `resolveGustTier`, `affordableGustTier`, `makeRangedContents`, `RANGED_WEAPON_TYPES`, `FIRE_FAIL_MESSAGES`, `canEquip`, `equipItem`, `autoEquipOnPickup`, `rollChestLoot`) working — extend, do not rename.
- Do **not** edit `renderer/game.js` in Tasks 1–10; Task 11 wires it. Do not commit; the coordinator commits per group.
- Comments explain *why*, in the voice of the existing files. No emoji in code except the existing hand-line glyphs.

---

## Parallel groups

- **Group 1:** Task 1.
- **Group 2 (parallel, disjoint files):** Tasks 2, 3, 4, 5, 6, 7, 8, 9, 10.
- **Group 3:** Task 11 (game.js wiring), then Task 12 (live verification, docs).

---

### Task 1: Weapon and wand tables

**Files:**
- Modify: `renderer/systems/entities.js` (`RANGED_WEAPON_TYPES`, `makeRangedContents`; add `WAND_TYPES`, `makeWandContents`, `AMMO_KINDS`, `AMMO_CAPS`)
- Modify: `renderer/render/icons.js` (`iconSrcFor` kinds)
- Test: `test/entities.test.js` (append), `test/icons.test.js` (append)

**Interfaces:**
- Produces:
  - `RANGED_WEAPON_TYPES` — exactly the six rows of the spec table with keys `name, damage, cooldown, color, kind, ammoKind, bundle` plus flags `draw`, `fork`, `heavy`, `knockback`, `piercesShield`, `stun` where the spec lists them. No `maxAmmo`.
  - `makeRangedContents(type = 'shortbow')` → `{ type: 'ranged', weaponType, name, damage, cooldown, color, kind, ammoKind, bundle, ...flags }` (unknown type → shortbow).
  - `WAND_TYPES` — six rows `{ name, spell, color }`.
  - `makeWandContents(type = 'sparkwand')` → `{ type: 'wand', weaponType, name, spell, color }` (unknown → sparkwand).
  - `AMMO_KINDS = ['arrow', 'bolt', 'stone']`, `AMMO_CAPS = { arrow: 40, bolt: 24, stone: 60 }`, `emptyAmmo()` → `{ arrow: 0, bolt: 0, stone: 0 }`.
  - `iconSrcFor({ kind: 'wand', payload: { weaponType } })` → sprite `weapon_<weaponType>`; `iconSrcFor({ kind: 'ammo', ammoKind })` → `item_arrows | item_bolts | item_stones`.

- [ ] **Step 1: Write failing tests** — in `test/entities.test.js`: every `RANGED_WEAPON_TYPES` row has `ammoKind` in `AMMO_KINDS` and a positive `bundle`; `makeRangedContents('crossbow')` carries `heavy: true`, `ammoKind: 'bolt'`, no `ammo`/`maxAmmo` keys; `makeWandContents('stormwand').spell === 'lightning'`; `makeWandContents('nope').weaponType === 'sparkwand'`; `emptyAmmo()` deep-equals zeros. In `test/icons.test.js`: wand and ammo icon lookups.
- [ ] **Step 2: Run** `node --test test/entities.test.js test/icons.test.js` — expect failures on the missing exports.
- [ ] **Step 3: Implement** the tables and makers per the spec tables; move the old wand rows out of `RANGED_WEAPON_TYPES`.
- [ ] **Step 4: Run** the two test files and `npm test`; other failures in `loot`/`inventory`/`ranged` tests are expected until Tasks 2 and 4 land — list them in your report rather than fixing them.

---

### Task 2: Ammo pool, wand hand, pickups, loot

**Files:**
- Modify: `renderer/systems/inventory.js`
- Modify: `renderer/systems/loot.js`
- Test: `test/inventory.test.js`, `test/loot.test.js`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  - `addAmmo(player, ammoKind, count)` → number actually added (capped by `AMMO_CAPS`, `player.ammo` created via `emptyAmmo()` if missing).
  - `spendAmmo(player, ammoKind, n = 1)` → boolean.
  - `canEquip(player, item)` — `wand` needs `magic_stance` (`not_learned`); `ranged` needs `ranged_stance`; `payload.heavy` needs `heavy_weapons` (`heavy`); other kinds `not_equippable`.
  - `equipItem(player, index)` routes `wand` → `player.wand`, swapping the held wand back as `{ kind: 'wand', name, emoji: '🪄', stackable: false, payload }`.
  - `autoEquipOnPickup(player, item)`:
    - `item.kind === 'ammo'` (`{ kind: 'ammo', ammoKind, count }`) → `{ ok: true, equipped: false, ammo: added, ammoKind }`, never a sack item.
    - `ranged`: add `payload.bundle` to the pool first; if the same `weaponType` is in hand or sack → `{ ok: true, equipped: false, merged: 'hand'|'sack', ammo, ammoKind }` and the weapon is discarded; else empty allowed hand → equip; else sack.
    - `wand`: empty allowed hand → equip; else sack.
  - `rollChestLoot(depth, rng)` distribution and pools exactly per spec; ammo results are `{ type: 'ammo', ammoKind, count }`, wands `{ type: 'wand', ... }`.
  - Remove `mergeRangedAmmo` and `AMMO_CAP_MULT` (ammo no longer lives on weapons).

- [ ] **Step 1: Write failing tests** covering each bullet above (pool caps, duplicate bow discards the weapon but keeps its bundle, wand equip gate, wand swap back to sack, loot bands at rng 0.1/0.45/0.6/0.75/0.9 for depth 1 and depth 4).
- [ ] **Step 2: Run** and confirm failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test test/inventory.test.js test/loot.test.js`.

---

### Task 3: Save body migration and loadouts

**Files:**
- Modify: `renderer/systems/adventure.js` (add `normalizeBody`, call it from `normalizeAdventureSave`)
- Modify: `renderer/systems/timewarp.js` (call `normalizeBody` on each mini-save's body — find where mini-saves are normalised)
- Test: `test/adventure.test.js`, `test/timewarp.test.js`

**Interfaces:**
- Consumes: `makeWandContents`, `WAND_TYPES`, `RANGED_WEAPON_TYPES`, `emptyAmmo` from Task 1.
- Produces: `normalizeBody(body)` → body with `wand` and `ammo` defaulted; legacy `ranged` wands moved to `wand`; legacy `ranged.ammo` folded into `ammo[ammoKind]` and dropped from the weapon along with `maxAmmo`; sack `ranged` items with wand payloads become kind `wand`; unknown weapon types dropped. `null` stays `null`.

- [ ] **Step 1: Write failing tests**: legacy body `{ weapon: null, ranged: { weaponType: 'sparkwand', ammo: 5 }, inventory: [] }` → `wand.weaponType === 'sparkwand'`, `ranged === null`; legacy `{ ranged: { weaponType: 'longbow', ammo: 7, maxAmmo: 10 } }` → `ammo.arrow === 7`, no `ammo` key on `ranged`; sack item conversion; idempotence (normalising twice equals once).
- [ ] **Step 2–4:** fail, implement, pass. Run `node --test test/adventure.test.js test/timewarp.test.js`.

---

### Task 4: Ranged firing from the pool, longbow draw

**Files:**
- Modify: `renderer/systems/ranged.js`
- Test: `test/ranged.test.js` (create if absent — check `ls test | grep ranged`)

**Interfaces:**
- Consumes: `spendAmmo` from Task 2 (import from `./inventory.js`).
- Produces:
  - `DRAW_CHARGE = { full: 0.4, over: 0.9, moveFactor: 0.6 }`, `resolveDrawTier(held)` → `'tap'|'full'|'over'`, `shouldAutoReleaseDraw(held)` (held > over + 0.5).
  - `tryFire(player, tier = 'tap')` → on success `{ ok: true, damage, color, shape, ammoKind, pierce?, fork?, onHit?, piercesShield? }` where `shape` is `arrow` for bows, `bolt` for the crossbow, `stone` for the sling; `onHit` = `{ stun }` for the sling, `{ knockback }` for the crossbow; longbow full → `damage + 1, pierce: 1`, over → `damage + 2, pierce: Infinity`. Fail reasons `not_learned | no_weapon | no_ammo | cooldown`.
  - `FIRE_FAIL_MESSAGES` keeps `no_weapon`/`not_learned`; add `noAmmoMessage(ammoKind)` → `'Out of arrows!' | 'Out of bolts!' | 'Out of stones!'`.

- [ ] **Step 1: Write failing tests** for each shape/onHit/pierce case, the pool gating (`player.ammo.arrow === 0` → `no_ammo`), cooldown, and the draw tiers.
- [ ] **Step 2–4:** fail, implement, pass.

---

### Task 5: Projectile module

**Files:**
- Create: `renderer/systems/projectiles.js`
- Test: `test/projectiles.test.js`

**Interfaces:**
- Produces: `stepProjectiles(state, delta, hooks)` where `hooks = { hurt(e, damage, p) → struckEntityOrSame, detonate(px, py, blastTiles), damagePlayer(damage), isHittable(e) }`. Mutates `state.projectiles` (keeps live ones) and `state.entities` (via `hurt` results), returns `{ hits: n }`. Implements movement, `maxDist`, wall stop (with fireball detonation at `lastPx/lastPy`), `fork`, `pierce`/`hitIds`, `chain`, `onHit` (`stun` → `e.stunTimer = max`, `knockback` → `startKnockback(e, dx, dy, amount)` from `./knockback.js`), `piercesShield` vs `wizard.shieldTimer`, dragon boss immunity, enemy projectiles hitting the player at radius 10. Also `makeForks(p)` and `retargetChain(p, entities)` exported for tests.
- Hit radius stays 8. `isHittable` is injected so the module needs no game.js import.

- [ ] **Step 1: Write failing tests**: pierce budget hits two enemies in a line and stops at the third; `hitIds` prevents double hits; fork spawns three after 32 px with the middle one on the original heading; chain retargets to the nearest unhit enemy within range and ends when none; sling stun sets `stunTimer`; shielded wizard absorbs unless `piercesShield`; boss immune; enemy bolt damages the player.
- [ ] **Step 2–4:** fail, implement, pass.

---

### Task 6: Enemy status effects

**Files:**
- Create: `renderer/systems/status.js`
- Modify: `renderer/systems/act.js` (speed multiplier and root gate)
- Test: `test/status.test.js`, `test/act.test.js` (append)

**Interfaces:**
- Produces:
  - `applySlow(e, mul, dur)`, `applyRoot(e, dur)`, `applyFreeze(e, dur)` (sets `stunTimer = max(stunTimer, dur)` and `frozen = true`).
  - `tickStatus(e, delta)` — decrements `slowTimer`, `rootTimer`; clears `frozen` when `stunTimer <= 0`.
  - `shatterBonus(e)` → 2 if `e.frozen` (and clears `frozen`), else 0.
  - `act()`: `speed = (intent.speed ?? 60) * (e.slowTimer > 0 ? e.slowMul : 1)`; returns early (no movement) while `e.rootTimer > 0`.

- [ ] **Step 1: Write failing tests** (slowed enemy covers 40% of the distance in `act` over one tick; rooted enemy does not move; freeze then tick to zero clears `frozen`; `shatterBonus` returns 2 once then 0).
- [ ] **Step 2–4:** fail, implement, pass.

---

### Task 7: Spells and primitives

**Files:**
- Create: `renderer/systems/spells.js`, `renderer/systems/zones.js`
- Modify: `renderer/systems/magic.js` (cone effects `slow`/`freeze`; export `castCone(state, tierDef)` used by both Gust and Rime), `renderer/systems/stamina.js` (spell costs live in `SPELLS`; keep `GUST_COSTS` equal to `SPELLS.gust.cost`)
- Test: `test/spells.test.js`, `test/zones.test.js`, `test/magic.test.js` (keep green)

**Interfaces:**
- Consumes: `applySlow`, `applyFreeze` (Task 6), `computeBlastTiles` from `./fire.js`, `isWalkable` from `./entities.js`, `startKnockback`.
- Produces:
  - `SPELLS` per the spec table (`gust, spark, rime, fireball, bramble, blink, lightning`), `spellFor(player)` → `player.wand ? SPELLS[WAND_TYPES[player.wand.weaponType].spell] : SPELLS.gust`.
  - `affordableTier(stamina, cost, tier)`.
  - `tryCast(state, spellId, tier, { modules } = {})` → gating and dispatch as the spec describes; `modules.lightning(state, tier)` is injected by game.js for the bespoke spell (so this file never imports lightning.js).
  - Primitive results: bolt → `{ projectiles: [...] }` (specs include `px, py, dx, dy` from player position/facing at the spell's speed, `shape: 'spark'|'bolt'`, `chain: { left, range: 96 }`, fireball `explodes: true, blastTiles, maxDist: FIREBALL_RANGE_TILES * 32, distTraveled: 0, lastPx, lastPy`); cone → `{ caught }`; zone → `{ zone }` pushed to `state.zones`; self (blink) → `{ from, to }`, player moved to the last walkable cell up to N tiles along facing, `invulnTimer` set on full, `gustBack: true` on over (game.js casts the backwards Gust).
  - `zones.js`: `makeBrambleZone(map, cx, cy, radius, dur, root, dps)` (walkable cells only), `tickZones(state, delta, hooks)` with `hooks.hurt(e, dmg)`; applies `applyRoot` on entry (tracked per zone via `inside: Set` of entity ids — use `e.id`, assigning one if missing), `dps` once per second per enemy inside; drops expired zones.

- [ ] **Step 1: Write failing tests**: every `SPELLS` row has three costs and tiers; `tryCast` refuses `not_learned`/`cooldown`/`stamina` and degrades over→full when the tank is short; spark tap returns one projectile with `chain` absent, over returns `chain.left === 4`; rime tap slows a caught enemy, over freezes; bramble zone contains only walkable cells and roots an enemy that enters; blink stops before a wall and skips over an enemy; lightning dispatches to the injected module.
- [ ] **Step 2–4:** fail, implement, pass. `node --test test/spells.test.js test/zones.test.js test/magic.test.js`.

---

### Task 8: Call Lightning module and weather hook

**Files:**
- Create: `renderer/systems/spells/lightning.js`
- Modify: `renderer/systems/weather.js` (`weatherLook` returns `dark: 0` while `state.weather.lightningT > 0`; `tickWeather`/wherever the per-frame weather advance lives decrements it)
- Test: `test/lightning.test.js`, `test/weather.test.js` (append)

**Interfaces:**
- Produces:
  - `LIGHTNING = { delay: 0.6, damage: 5, stun: 1.0, flash: 0.12, lit: 0.25, waterCap: 400, dists: { tap: [3], full: [6], over: [4, 6, 8] } }`.
  - `castLightning(state, tier)` → pushes marks `{ x, y, t: 0, delay, struck: false }` into `state.lightning` (created if missing), clamped along the player's facing to the last walkable cell; returns `{ marks }`.
  - `isWaterCell(cell)`, `connectedWater(map, x, y, cap)` → Set of `"x,y"`.
  - `tickLightning(state, delta, hooks)` with `hooks.hurt(e, damage, { source: 'lightning' })`: on strike applies damage + stun to enemies in the 3×3 and to every creature in the connected water when the mark is water; sets `state.flash = 0.12`, `state.weather.lightningT = 0.25` when `state.weather` exists; pushes `{ x, y, t: 0 }` to `state.strikes` for rendering and returns `{ struck: n }`. Strikes are removed once `t >= 0.15`.

- [ ] **Step 1: Write failing tests**: marks land at the tier distances and clamp at walls; strike hits the 3×3 and not a cell outside; water conduction hits an entity across a connected pond but not across land; flash and weather hooks set; strike entries expire.
- [ ] **Step 2–4:** fail, implement, pass.

---

### Task 9: HUD tool slot and sack panel wand hand

**Files:**
- Modify: `renderer/render/hud.js` (`#hud-ammo` rule from the spec), `renderer/ui/inventory-panel.js` (third hand line, pooled count on the bow line, `wand` items get the Equip action)
- Test: `test/hud.test.js`

**Interfaces:**
- Consumes: `player.wand`, `player.ammo`, `SPELLS`/`spellFor` (Task 7) for the tap cost dim rule — import `spellFor` from `../systems/spells.js`; if Task 7 has not landed when you start, stub the import locally and note it.
- Produces: `updateHUD` behaviour: magic stance → wand icon, `hud-icon-empty` when `player.stamina < spell.cost.tap`, no count; other stances → bow icon with `×<player.ammo[ammoKind]>`, `hud-icon-empty` at 0; hidden when the shown hand is empty; `data-active` when stance matches.

- [ ] **Step 1: Write failing tests** for each rule.
- [ ] **Step 2–4:** fail, implement, pass. Keep the existing change-gated `setHTML`.

---

### Task 10: Art and rendering

**Files:**
- Create: `tools/make-ranged-tiles.mjs`; generated PNGs under `renderer/assets/tiles/` (`weapon_hunterbow, weapon_splitbow, weapon_crossbow, weapon_sling, weapon_frostwand, weapon_bramblewand, weapon_blinkwand, item_arrows, item_bolts, item_stones`)
- Modify: `renderer/render/sprites.js` (register the ten), `renderer/render/canvas.js` (held wand in magic stance; projectile shapes `bolt`/`stone`/`spark`; bramble zones; frozen tint; blink trail from `state.blinkTrail`; lightning sigils, bolts and the `state.flash` white fill after the weather passes)
- Test: `test/canvas.test.js` (append), `test/png-read.test.js` pattern for the PNGs if useful

**Interfaces:**
- Consumes: `state.zones`, `state.lightning`, `state.strikes`, `state.flash`, `state.blinkTrail = { from, to, t }`, `player.wand`, `e.frozen`.
- Produces: `drawEntity` for the player in magic stance draws `sprites['weapon_' + player.wand.weaponType]` via `drawHeldWeapon`; new `drawZones`, `drawLightning`, `drawFlash` helpers called from `Renderer.render` at the spec's layer order (zones after tiles/fog and before entities; sigils with zones; bolts and flash after weather pass one; trail with entities).

- [ ] **Step 1:** Write the tile tool from the existing `tools/make-firewand-tile.mjs` pixel-map style (transcribe shapes; wands reuse its straight/wavy wand maps with new tip palettes; bows recolour the existing custom bow PNGs by reading them with `tools/png-read` helpers if they are 8-bit, else transcribe). Run it and confirm ten 16×16 PNGs.
- [ ] **Step 2: Write failing canvas tests**: held wand sprite drawn in magic stance; `stone` projectile is a 4×4 fillRect; a frozen enemy draw sets the icy filter; a strike draws a white full-screen fill when `state.flash > 0`.
- [ ] **Step 3–4:** implement, pass.

---

### Task 11: game.js wiring

**Files:**
- Modify: `renderer/game.js`
- Test: full suite

**Consumes everything above.** Wire, in order:
1. Imports; `startNewRun` copies `wand` and `ammo` from the body (default `emptyAmmo()`); `persistRun` writes them; `applyLoadout` accepts `wandType` and `ammo`.
2. Chest/floating item helpers (`contentsFromItem`/`itemFromContents`) handle `wand` and `ammo`; pickup path uses `autoEquipOnPickup` results to float `+n` for ammo (kind icon via `iconSrcFor`).
3. Ranged stance: draw charge for `player.ranged?.draw` (`player.charging = { t: 0, kind: 'draw' }`, `moveFactor` in the sprint/charge speed calc, release → `tryFire(player, resolveDrawTier(t))`); other bows as today; `noAmmoMessage`.
4. Magic stance: replace the direct `tryGust` calls with `tryCast(state, spellFor(player).id, tier, { modules: { lightning: castLightning } })`; spawn returned projectiles, ring for cones (`#bfdbfe` for rime), `state.blinkTrail` and the backwards Gust for blink over, log lines per spell; `player.charging.kind = 'spell'` (rename from `'gust'`, keeping `GUST_CHARGE` thresholds).
5. Replace the friendly projectile loop with `stepProjectiles(state, delta, hooks)`; `detonateFireball(px, py, blastTiles)` takes the count.
6. Enemy loop: `tickStatus(e, delta)` next to the stun tick; `tickZones`, `tickLightning`, `state.flash` decay; melee hit applies `shatterBonus`.
7. Harvest: a rock cleared with the pick adds 3 stones (`addAmmo`) and floats `+3`.
8. `sfx` recipes `thunder` and `crackle` in `render/audio.js`.
9. Talents `desc` copy: `ranged_stance` → "Use bows, crossbows and slings in the ranged stance."; `magic_stance` → "Shape spells in the magic stance — wands give new ones."

- [ ] **Step 1:** `npm test` green (bar the known flake).
- [ ] **Step 2:** Launch with `--dcdebug` and `level1`; via `window.__dc.state` give the player each bow and wand (`applyLoadout` shapes) and confirm: pooled ammo decrements, longbow over-draw pierces, splitbow forks, sling stuns, crossbow knocks back; each spell casts and the HUD slot follows the stance.

---

### Task 12: Live verification, docs, memory

- [ ] Arena-test skill run: every bow and wand against a guard pack; screenshots of a bramble patch, a frozen enemy, a lightning strike at night on `level8` (Ferry) over the lake.
- [ ] Update `~/CLAUDE.md` dungeon-crawler section (ranged/wand model, new modules) and the memory index.
- [ ] `npm test` green; commit; PR.
