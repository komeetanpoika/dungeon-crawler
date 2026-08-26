# Stamina System & Top-Bar Rework — Design

**Date:** 2026-08-26
**Status:** Approved (chat), pending spec review

## Summary

Replace mana with a single **stamina** resource that prices melee swings,
sprinting, and gust casts; add sprint and gust charging; and rework the top
HUD bar into hearts + equipped-item slots + a stamina bar.

## 1. Stamina resource

- `player.stamina` 0–100 (`maxStamina: 100`), new fields on the player in
  `systems/entities.js`. `mana`, `manaRegenT`, `MANA_MAX`, `MANA_REGEN_TIME`,
  and `tickMana` are **removed**.
- Regen: **18/s**, starting **0.7s** after the last spend or sprint drain
  (any spend resets the delay). Empty → full in ~6.3s of restraint.
- New pure module `systems/stamina.js`: init/spend/tick helpers plus all
  cost tables below. No SFX/DOM — game.js surfaces refusals.

## 2. Melee swing costs (spent on release)

| Weapon (dmg) | tap | full | over |
|---|---|---|---|
| dagger (1) | — | 8 | — |
| sword (2) | — | 12 | — |
| longsword (3) | 10 | 18 | 34 |
| axe (4) | 12 | 24 | **48** |
| maunonmiekka (10) | 14 | 30 | 60 |

- Light weapons have no charge tiers; their single price is the "full" row.
- **Starved swing rule:** if stamina < the resolved tier's cost, the swing
  still comes out but is forced to **tap** tier mods (0.7× dmg etc.) and
  drains all remaining stamina. Applies to light weapons too (their starved
  swing uses tap mods even though they normally have no tiers).
- Ranged shots cost nothing (ammo limits them). Walking costs nothing.

## 3. Charging & auto-release

- Existing heavy-weapon charge (`CHARGE` in melee.js: tiers, per-weapon
  `moveFactor` slowdown) is unchanged.
- **New:** holding **0.5s past the over threshold auto-releases** the swing.
  Constant lives beside `CHARGE`; applies to gust charging too.

## 4. Gust: charging tiers + wall slam

Magic stance gains hold-to-charge (`GUST_CHARGE = { full: 0.5, over: 1.1,
moveFactor: 0.5 }`), release casts at the reached tier:

| Tier | Cost | Reach/width | Stun | Shove |
|---|---|---|---|---|
| tap | 14 | 1× (today: 80px, 55°) | 1.0s | 30px |
| full | 22 | 1.25× | 1.5s | 45px |
| over | 40 | 1.5× | 2.0s | 70px + slam flag |

- Below the **tap** cost the cast refuses (existing refusal path, reason
  `'stamina'` replaces `'mana'`).
- Boss knockback scales with the same multipliers off `bossKnockback`.
- **Wall slam:** over-tier gust passes `slam: { damage: 3 }` into
  `startKnockback`. `stepKnockback` detects a wall-blocked axis while speed
  ≥ `SLAM_MIN_SPEED = 400` px/s and reports it once (flag consumed) — the
  70px over-tier shove launches at ~2800 px/s, so only a wall met early in
  the slide slams;
  return value changes from `void` to `null | { slammed: true }` so game.js
  can apply the damage, float, and a thud SFX cue. Pure, injected `canMove`
  unchanged.

## 5. Sprint

- Intent: **touch** — thumbstick deflection ≥ 90% of its radius while a
  direction is held (touch layer dispatches synthetic `keydown`/`keyup`
  with key `'sprint'`); **desktop** — double-tap a direction (≤ 0.3s gap)
  and hold. Detector is a pure helper (event timestamps injected) in
  `systems/stamina.js`.
- Stance-flavoured, using the **active attack mode**:
  - melee / ranged stance: **×1.55** speed, drains **22/s**
  - magic stance: **×1.25** speed, drains **8/s**
- Sprint needs stamina > 0; at zero it drops to walk speed (no lockout).
  Sprint drain also defers regen (counts as spending).
- Sprinting while charging is not a thing — charging's `moveFactor` wins
  (you cannot wind up and sprint simultaneously).

## 6. Top bar rework

New `#hud-top` layout (DOM in `index.html`, logic in `render/hud.js`):

```
[♥♥♥♥♥ hearts]  [LVL n]      [weapon: name (dmg) | ammo]  [🧪×3]      [stamina ███████░░]
```

- **Hearts:** `maxHp / 2` hearts, half-heart = 1 HP, drawn as inline SVG
  (full / half / empty states) so they match the pixel style; count derives
  from `maxHp` (arena overrides keep working).
- **Weapon slot:** the active stance's weapon — melee: `name (dmg)`;
  ranged: `name ammo/max`; magic: `Gust`. Unarmed melee shows `Unarmed`.
- **Consumable slot:** next-up quick-use emoji + count (reuses
  `quickUseSummary`). The **count bubble comes off the green touch button**
  (`#quickuse-count` removed; grey empty state stays, still driven by
  `data-quick-emoji`).
- **Stamina bar:** right-aligned gold bar, smooth fill; brief red flash
  when a spend is refused (HUD reads a short-lived `player.staminaRefusedT`
  timestamp set by game.js).
- Removed: the backpack emoji row and all three stance-slot texts
  (`hud-weapon` / `hud-ranged` / `hud-magic` / `hud-items` as they exist
  today; ids may be reused by the new slots).

## 7. Touchpoints

- `systems/stamina.js` (new): costs, spend/tick, sprint detector — pure.
- `systems/magic.js`: mana removal, gust tiers, slam flag.
- `systems/knockback.js`: slam detection + return value.
- `systems/melee.js`: auto-release constant only.
- `systems/entities.js`: player fields (`stamina`, `maxStamina`,
  `staminaRegenT`; drop `mana`, `manaRegenT`).
- `game.js`: sprint intent + speed, swing/cast spending, gust charge state
  (reuses `player.charging`), auto-release, slam application, refusal
  feedback.
- `render/hud.js` + `index.html`: new bar; `ui/touch-controls.js`: drop the
  count bubble mirror.
- SFX: reuse existing cues where sensible; one new `slam` cue in
  `systems/sfx.js` recipes.
- Tests: `stamina.test.js` (new), updates to `magic.test.js`,
  `knockback.test.js`, `melee.test.js`, `hud.test.js`, `entities.test.js`.
  Live check: short emulated-phone run (sprint via stick rim, bar drains).

## Out of scope

- No stamina cost for ranged shots, walking, or taking hits.
- No enemy stamina. No block/dodge moves.
- Saves: old saved players without `stamina` fields get defaults on load;
  stale `mana` fields are ignored.
