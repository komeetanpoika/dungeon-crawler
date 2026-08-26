# Ranged Attack Rework — Design

**Date:** 2026-07-24
**Status:** Approved

## Goal

Replace the always-available Shift-to-fire ranged attack with a mode-based system:
Shift toggles between melee and ranged stance, Space attacks in the active stance,
and firing requires a projectile weapon looted from a chest. Each projectile weapon
carries a finite ammo count that depletes per shot.

## Current behavior being replaced

- Shift fires a projectile at any time (cooldown-gated), damage = melee weapon
  damage (or 1 unarmed). There is no ranged weapon item. (`game.js:456-462`)
- Space performs the melee attack. (`game.js:409-454`)
- Player holds exactly one weapon (`player.weapon`); chest pickups overwrite it.
- Generic `'chest'` spawns always contain a potion. (`game.js:168-176`)
- HUD shows weapon name/damage only; no ammo display.

## Approach

Two independent slots plus a mode flag (chosen over a unified weapon array — YAGNI):

- `player.weapon` — melee slot, unchanged in shape and behavior.
- `player.ranged` — projectile weapon or `null`. Shape:
  `{ weaponType, name, damage, ammo, maxAmmo, cooldown, color }`.
- `player.attackMode` — `'melee' | 'ranged'`, starts `'melee'`.

## Ranged weapon roster

New `RANGED_WEAPON_TYPES` table in `renderer/systems/entities.js`, separate from
melee `WEAPON_TYPES`. All four shoot straight-line projectiles; wands differ from
bows by stats and projectile visuals only (behaviors like piercing are out of scope
for this iteration). Numbers are tunable starting points:

| type | name | damage | maxAmmo | cooldown | bolt color |
|---|---|---|---|---|---|
| `shortbow` | Shortbow | 2 | 12 | 0.6s | yellow `#facc15` |
| `longbow` | Longbow | 3 | 10 | 0.7s | yellow `#facc15` |
| `sparkwand` | Spark Wand | 2 | 16 | 0.45s | cyan `#22d3ee` |
| `stormwand` | Storm Wand | 5 | 6 | 0.8s | purple `#a78bfa` |

Cooldown is per-weapon; the global `RANGED_COOLDOWN` constant is removed.

## Input & combat flow

- **Shift (keydown, edge-triggered)** toggles `player.attackMode`. The toggle
  always works, including with no ranged weapon or zero ammo ("toggle but can't
  fire"). Held Shift must not flap the mode — toggle on the keydown event, not
  the held-key map.
- **Space in melee mode** — existing melee attack, unchanged (styles, knockback,
  Maunonmiekka shockwave all as-is).
- **Space in ranged mode** — fire iff `player.ranged` exists, `ammo > 0`, and the
  ranged cooldown has elapsed. Otherwise no projectile and a HUD log message
  ("Nothing to shoot with" when no weapon, "Out of ammo" at 0).
- Each successful shot decrements `player.ranged.ammo` by 1. Reaching 0 does not
  auto-switch the mode back to melee.
- Projectile damage comes from the ranged weapon, never the melee weapon. The
  unarmed 1-damage default fire is removed entirely.
- `renderer/web-shim.js` `GAME_KEYS` gains Shift if needed to prevent browser
  side effects.

## Chest loot

- Generic `'chest'` spawn kind rolls a loot table instead of always potion:
  **potion 40% / melee weapon 30% / ranged weapon 30%**, with weapon tier scaling
  by depth (shortbow/sparkwand on shallow levels, longbow/stormwand deeper).
- Hand-placed `'weapon'` and `'potion'` spawn kinds keep their fixed contents.
- Ranged chest contents shape: `{ type: 'ranged', weaponType, name, damage,
  ammo, maxAmmo, cooldown, color }` with `ammo = maxAmmo` (drops arrive full).
- Pickup (walk-onto, existing floating-item flow): `player.ranged = { ...contents }`
  — one slot, replace; remaining ammo on the old weapon is lost. Melee pickups
  keep overwriting `player.weapon` as today.
- The loot roll takes an injectable RNG so tests are deterministic.

## Rendering & HUD

- **Held weapon:** in ranged mode, `drawHeldWeapon` renders the equipped ranged
  weapon gripped in-hand (same path as melee weapons, ~0.8S, never a corner
  icon). Requires 4 new sprites (`weapon_shortbow`, `weapon_longbow`,
  `weapon_sparkwand`, `weapon_stormwand`) — palette-matched pixel-art
  placeholders drawn for this iteration, iterated on later. In ranged mode with
  no ranged weapon, the hand is empty.
- **Projectiles:** reuse the existing projectile renderer with per-weapon
  `color`; arrows (bows) render slightly elongated along their travel axis,
  wand bolts stay square.
- **HUD:** the weapon area shows both slots with the active mode marked, e.g.
  `▶ Shortbow (2 dmg) — 8/12` above `Sword (2 dmg)`; mode toggles and fire
  failures surface in the HUD log.

## Saves & persistence

No changes. Weapons (melee and ranged) and ammo reset every run; only existing
meta-progression persists.

## Out of scope

- Piercing / spread / special projectile behaviors for wands.
- Separate ammo pickups or ammo-refill-on-same-type (one slot, replace only).
- Gamepad support, weapon cycling beyond the two slots, save persistence of
  weapons.

## Testing

- `node:test` units: mode toggle behavior (including edge-trigger, no-weapon
  toggling), fire gating (no weapon / no ammo / cooldown), ammo depletion,
  projectile damage sourced from ranged weapon, loot-table roll distribution and
  depth tiering with injected RNG, chest contents → pickup slot routing.
- Runtime verification via the arena-test skill: toggle stance, loot a chest,
  fire until empty, confirm HUD and held-weapon rendering.
