# Enemy Weapons & Melee Slash Animations — Design

**Date:** 2026-07-02
**Status:** Approved (pending spec review)

## Summary

Give melee-attacking enemies (guard, monster, dragon, crab, cyclops — **not** the
dragon boss or wizard) visible weapons and slashing attack animations, built on a
small **attack framework** that supports telegraphs (wind-ups) and weapon-derived
stats. The framework is seeded with today's damage values and **zero wind-up**, so
combat behavior is frame-for-frame identical to the current game — this ships as a
visual upgrade whose numbers can be tuned later.

## Background

Relevant existing code:

- **Generic contact damage** — `renderer/game.js` (~line 568): guard / monster /
  dragon deal 1 HP (dragon 2) when within `CONTACT_RANGE` (20px) and
  `e.damageCooldown <= 0`; cooldown 0.8s is set **only if the hit lands**
  (`damagePlayer` returns true), so i-framed players cause silent per-frame retries.
- **Crab** (`renderer/systems/crab.js`): contact damage (1 HP, 20px) + a separate
  grab attack with its own state machine.
- **Cyclops** (`renderer/systems/cyclops.js`): contact damage (3 HP, 40px) + charge
  (5) and slam (4) state machines with existing visuals (shake, slam ring).
- **Player melee** — `drawMeleeSwing` in `renderer/render/canvas.js` (~line 259):
  weapon sprite rotated around the player + colored arc trails, four styles
  (`snap` / `arc` / `slash` / `spin`) with easing; damage is applied instantly at
  attack start, the animation is a retrospective flourish.
- **Sprites** — weapons are tiles: `weapon_sword` = `tile_0104`; `tile_0107` is a
  club-shaped sprite (currently unused). Enemies are static tile sprites with a
  `facing` field ('east'/'west').
- **Damage funnel** — `damagePlayer(state, amount, 'hit'|'dot', msg)` in
  `renderer/systems/player-damage.js` gates on i-frames and returns whether the
  hit landed.

## Design

### Unit 1 — Attack framework (`renderer/systems/enemy-attack.js`)

A pure system module (no DOM/canvas imports) with two config tables.

**`WEAPONS`** — each weapon defines visuals and base stats:

| Weapon | Sprite | Swing style | Damage | Windup (s) | Swing dur (s) |
|---|---|---|---|---|---|
| `sword` | `tile_0104` | `arc` sweep | 1 | 0 | 0.25 |
| `club` | `tile_0107` | `slash` overhead | 3 | 0 | 0.3 |
| `claw` | none (procedural) | `snap` | 1 | 0 | 0.2 |
| `dragon_claw` | none (procedural, wider) | `arc` | 2 | 0 | 0.25 |
| `pincer` | none (procedural) | `snap` | 1 | 0 | 0.2 |

**`ENEMY_MELEE`** — enemy type → default weapon id:
guard → `sword`, monster (all variants) → `claw`, dragon → `dragon_claw`,
crab → `pincer`, cyclops → `club`. Wizard and dragon boss have no entry.

**Weapon resolution:** `getEnemyWeapon(e)` returns the weapon for
`e.weaponId ?? ENEMY_MELEE[e.type]` (null when neither exists). The per-entity
`weaponId` override is the hook for varying enemy stats via weapons later
(different spawns carrying different weapons). Range and cooldown come from the
resolved weapon config, with optional per-enemy overrides (cyclops keeps its
40px contact range; others 20px; cooldown 0.8s everywhere, as today).

**Attack lifecycle** (the telegraph framework): `windup → strike → swing → done`.

- `tryStartEnemyAttack(e, state)` — when the player is within the weapon's range
  and `e.damageCooldown <= 0`, begins the attack.
  - **Windup** (duration from config): a visible tell before the strike. All
    weapons seed at **0**, so this phase is skipped today — but the code path,
    rendering, and tests exist.
  - **Strike** (the frame windup ends; immediately on start when windup = 0):
    range is re-checked (matters once windups exist — the player can dodge out),
    then `damagePlayer(state, dmg, 'hit', msg)` is called.
    - Lands → `e.damageCooldown = 0.8` and the swing animation starts.
    - Blocked by i-frames → the attack cancels silently, cooldown stays 0, and
      the enemy retries next frame — **exactly today's behavior**, and no
      animation spam.
    - Out of range at strike (windup > 0 future) → **whiff**: the swing plays,
      no damage, cooldown is still set — telegraphed attacks are dodgeable.
  - **Swing**: pure animation over the swing duration; damage was already applied
    at the strike frame (mirrors the player's own attack).
- `stepEnemyAttack(e, state, delta)` — advances phases/timers each frame; clears
  `e.attack` when the swing finishes. Safe no-op without an active attack.

**State shape:** `e.attack = { weaponId, phase, timer, duration, angle }` where
`angle` is `atan2` toward the player, captured at attack start (windup) and used
for the swing. The renderer only reads this object.

### Unit 2 — Per-enemy assignments & rendering (`renderer/render/canvas.js`)

| Enemy | Held visibly? | Attack visual |
|---|---|---|
| Guard | Yes — sword at its side, flips with `facing` | 140° sword sweep toward the player, blue-white trail (player-sword feel) |
| Cyclops | Yes — club at its side, scaled ~1.3× | Overhead club slam, heavy amber trail |
| Monster (all variants) | No | Quick claw swipe — 2–3 short procedural claw-mark lines + small pale arc trail |
| Dragon (normal) | No | Wider claw sweep, orange-tinted trail |
| Crab | No | Snappy pincer click — short red-tinted snap arc at the target point |
| Wizard, dragon boss | — | Untouched |

1. **Shared swing renderer.** Extract the guts of `drawMeleeSwing` (the `trail` +
   `weapon` rotation helpers and the four style blocks) into a shared
   `drawSwing(ctx, cx, cy, sprite, style, t, S, tint)` used by both the player
   (visuals unchanged) and enemies. Claw/pincer weapons pass no sprite and draw
   procedural claw/pincer marks instead of a blade. The swing anchors to the
   entity's live `px/py` each frame.
2. **Held weapon at idle.** For guard and cyclops, `drawEntity` draws the weapon
   sprite resting at the entity's side (small tilt, offset mirrored by `facing`).
   Hidden while a swing is playing (the swing draws the weapon instead).
3. **Windup telegraph rendering.** When `e.attack.phase === 'windup'`: the weapon
   is drawn raised/pulled back at the swing's start angle with a slight quiver
   that intensifies as the strike nears. Dormant today (all windups 0) but
   implemented and testable.
4. **Cyclops slam polish.** During the existing `slam_windup` / `slam` states the
   club is drawn raised overhead, so the club participates in the move the
   cyclops already has. Charge visuals stay as-is.

### Unit 3 — Integration

- **`renderer/game.js`** — the generic contact-damage block (guard/monster/dragon)
  is replaced by `tryStartEnemyAttack(e, state)`; `stepEnemyAttack(e, state, delta)`
  runs each frame alongside the existing cooldown decay.
- **`renderer/systems/crab.js`** — the contact-damage branch routes through the
  framework (pincer). The grab attack keeps its own mechanics and visuals.
- **`renderer/systems/cyclops.js`** — the contact-damage branch routes through the
  framework (club, 40px range, 3 dmg). Charge and slam keep their mechanics; the
  slam gains only the raised-club drawing (Unit 2.4).
- **`renderer/systems/wizard.js`, `dragonboss.js`** — untouched.

## Data Flow

```
update() per enemy:
  player in weapon range && damageCooldown <= 0
    → tryStartEnemyAttack(e, state)          [windup=0 → strike immediately]
        strike: damagePlayer(...)
          landed  → damageCooldown = 0.8, e.attack enters 'swing'
          blocked → attack cancelled, cooldown stays 0 (retry next frame)
  stepEnemyAttack(e, state, delta)            [advance windup/swing timers]

render() per enemy:
  e.attack?         → drawSwing(...) at live px/py using e.attack.angle
  else weapon-carrier → held weapon drawn at side (facing-mirrored)
  cyclops slam states → club raised overhead
```

## Edge Cases

- **I-framed player:** strike blocked → no cooldown, no animation, retry next
  frame (identical to today).
- **Enemy dies mid-swing:** the entity is filtered out of `state.entities`; its
  attack state goes with it — no orphaned animation.
- **Player dodges during windup** (future): strike re-checks range → whiff; swing
  plays, no damage, cooldown still set.
- **Knockback during attack:** swing anchors to live `px/py`, so it moves with a
  knocked-back enemy — no special handling.
- **Facing:** attack angle captured via atan2 at attack start; idle held weapon
  uses the existing `facing` field with a safe default ('east').
- **Missing sprite:** the swing renderer already falls back to a drawn line when
  a weapon sprite is unavailable; claw/pincer are procedural by design.

## Constants (seed values — behavior-preserving)

- Damages: guard 1, monster 1, dragon 2, crab 1, cyclops contact 3 (unchanged).
- Ranges: 20px (`CONTACT_RANGE`) for all except cyclops 40px (unchanged).
- Cooldown: 0.8s (`CONTACT_DAMAGE_COOLDOWN`, unchanged).
- Windup: 0 for every weapon (framework-only for now).
- Swing durations: sword 0.25s, club 0.3s, claw/pincer 0.2s, dragon_claw 0.25s.

## Testing

- **New `test/enemy-attack.test.js`:**
  - Weapon resolution: type default; `e.weaponId` override wins; wizard/boss → null.
  - Windup 0 lifecycle: strike on the start frame; damage matches current values
    (guard 1, monster 1, dragon 2, crab 1, cyclops 3); cooldown 0.8 set on land.
  - Windup > 0 lifecycle: no damage during windup; strike after windup elapses;
    moving the player out of range before the strike → whiff (no damage,
    cooldown still set).
  - I-frame block: no HP change, cooldown stays 0, no `e.attack` set.
  - Attack state cleared after the swing completes.
- **Updated tests:** `test/crab.test.js` / `test/cyclops.test.js` where contact
  damage is asserted directly.
- **`test/canvas.test.js`:** held weapon sprite drawn for guard/cyclops (mock-ctx
  `drawImage` recording); player `drawMeleeSwing` still renders after the
  `drawSwing` extraction.
- **Manual:** runtime eyeball via playwright-core Electron on WSLg; check
  `git status renderer/data/` afterward (editor autosave hazard).

## Out of Scope (YAGNI)

- Weapon drops / pickups; enemies switching weapons at runtime.
- Nonzero windup values (framework only; tuning is a follow-up).
- Hit sounds, damage numbers, screen shake on enemy hits.
- Dragon boss and wizard changes.
- Changing crab grab / cyclops charge / cyclops slam mechanics.
