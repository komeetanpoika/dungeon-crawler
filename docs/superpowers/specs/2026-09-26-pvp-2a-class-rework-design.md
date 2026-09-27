# PvP Sub-project 2a — Class Rework and Time-to-Kill

Date: 2026-09-26. Roadmap: `2026-09-25-pvp-roadmap.md`. Builds on sub-projects
1, 3, 4a and 4b (all merged and deployed; live as Cloud Run rev 00066).

## Goal

Each class gets a signature move worth mastering, and fights end sooner:
- **Warrior:** gesture combos entered with the stick while the attack is held.
- **Archer:** a charged double shot on Q.
- **Mage:** the Storm Wand as the main weapon, and the Fireball Wand as the rune.

## Decisions (agreed 2026-09-26, from the user's play impressions)

| Question | Decision |
|---|---|
| Evidence | The user's own play: fights drag (above all Warrior vs Warrior); the Warrior needs a charge mechanic; the Spark Wand is boring and the Storm Wand underwhelming; the Archer needs a charged double shot. |
| Split | Sub-project 2 splits in two. **2a** (this spec): the class rework and time-to-kill. **2b** (later): tiered pickups (speed, damage, shielding, fiery/toxic arrows) and bigger arenas. |
| Warrior | Gesture combos on the held attack: moves on the screen's four directions, each costing 25 % stamina, fired on release. The three combos are Lunge, Fence and Whirlwind. |
| Archer | Hold Q for a 1.2 s draw that fires two parallel arrows, with per-arrow damage by draw. |
| Mage | The Storm Wand is the main weapon, with PvP-only numbers: faster and snappier. The Fireball Wand is the rune power-up. |
| Time-to-kill | Hero hp 10 → 8; plate's protection in a match 1 → 0. |

Out of scope (2b): new pickups, pickup tiers, bigger arenas, and the rune's duration and spawn timers.

## 1. Time-to-kill

- `PVP.hp` goes from 10 to **8**.
- `OUTFIT_OVERRIDES.plate.protect` goes from 1 to **0**. The buckler is now the Warrior's defence.
- The result: a sword kills a Warrior in 4 hits (it took 10), and an Archer or Mage in 4.
- Flasks still heal 4 (half of 8). The quiver and the rune are unchanged in 2a.

## 2. Warrior — gesture combos

The kit is unchanged: sword and buckler. In a match the sword becomes a **combo weapon**. Single-player's sword is untouched.

**Holding the attack:**
- A combo starts on an attack press when the melee cooldown is ready, the shield is down and the hero is not stunned. Pressing records `lockDir`, the unit vector of the hero's input move at that moment (zero when standing still).
- **While the attack is held:**
  - The hero moves along `lockDir` at `WARRIOR_COMBOS.holdMoveMul` (0.5) of walk speed.
  - The input move no longer steers, and facing is locked.
  - The hero cannot sprint.
- A stun or a raised shield cancels the hold. No combo fires, and the stamina already spent stays spent.

**Moves:**
- **Sector.** Each tick, the input move is read as a sector: `n`, `e`, `s`, `w`, or `null` (neutral).
  - The dominant axis wins.
  - A diagonal with equal axes keeps the previous sector, so pressing W and then adding D does not register until W is let go.
- **When a move registers.** A move is recorded when the sector changes to a non-null sector different from the last one seen, or when it leaves neutral.
  - The same direction twice therefore needs neutral in between.
  - Sweeping the stick around registers each quarter as a move.
- **Cost.** Each move costs `WARRIOR_COMBOS.moveCost` (25) stamina; `STAMINA_MAX` is 100.
  - A move the hero cannot afford is not recorded.
  - At most 4 moves are recorded; later ones are ignored and free.
- **Pure recogniser.** The recogniser is a pure module, `renderer/pvp/combos.js`: `stepGesture(state, move) → state` and `classify(moves) → combo`. The sim and the client's predictor both call it.

**Release fires what was entered.** The combo's direction becomes the hero's facing, so the combo aims the strike:

| Moves | Combo | Effect |
|---|---|---|
| none | **Swing** | The plain sword swing, as today (2 damage, the `arc` style), in the facing held. |
| `d, d` | **Lunge** | The hero dashes `lunge.tiles` (2.5) toward `d` over `lunge.dur` (0.15 s), stopping at walls. The first hero whose hit shape comes within `lunge.reach` (20 px) ahead during the dash takes `lunge.damage` (3), and the dash ends there. |
| `d, opposite(d)` | **Fence** | Three thrusts toward `d` at 0, 0.12 and 0.24 s. Each is a narrow `snap`-style wedge of reach `fence.reach` (40 px) and deals `fence.damage` (1). A hero can be hit by all three. |
| 4 moves, each turning 90° in one rotational sense | **Whirlwind** | A 360° spin: every foe within `whirl.reach` (44 px) takes `whirl.damage` (2) and a knockback of `whirl.knockback` (40). Needs the full tank, 4 × 25. |
| anything else | **Swing** | The plain swing in the facing held; the stamina spent stays spent. |

- **Blocks.** Every combo hit goes through `hurtHero` as a `'hit'` from the attacker's position. A raised buckler facing the attacker therefore blocks it like any blow. The whirlwind's hits come from the spinner's centre, so a shield facing the spinner blocks.
- **Cooldown.** After any release, `meleeCooldown` is the sword's normal cooldown. The whirlwind is the exception: 1.5 × the normal cooldown.
- **Rune.** While the rune's Ukonvasara is held, the hammer keeps its own charge tiers, and combos are off.
- **Timing change.** A plain swing now lands on release instead of on press. Its animation and hit start the tick the attack is let go.

**Visuals:** flashy, drawn from snapshot state.
- **While holding:** the moves entered so far show as small arrows above the hero, and a ring pulses with each move.
- **Lunge:** a bright blade-trail streak along the dash path.
- **Fence:** three zig-zag steel glints.
- **Whirlwind:** a spinning ring of steel with sparks flying off, plus a short screen shake for the spinner only.
- **Sounds:** the existing cues where they fit (`melee-swing`, `melee-hit`), plus a new `whirl` cue.

## 3. Archer — double shot

- **The wind-up.**
  - Holding **Q** (the touch green button) starts the draw when the ranged cooldown is ready: `hero.charging = { kind: 'double', t }`.
  - While drawing, the hero moves at `DOUBLE_SHOT.moveMul` (0.6) and steers normally.
  - Space does nothing during the draw.
- **Draw fraction.** The draw fraction is `min(t / DOUBLE_SHOT.full, 1)`, with `full` = 1.2 s. Holding past full keeps it at 1; there is no auto-release.
- **On release:**
  - **Below 30 %:** nothing fires, and no ammo or cooldown is spent.
  - **Otherwise:** two arrows fire straight ahead, offset ±`DOUBLE_SHOT.gap / 2` (6 px) across the facing, each dealing the damage from `DOUBLE_SHOT.bands`:

    | Draw | Damage per arrow |
    |---|---|
    | 30–40 % | 1 |
    | 40–55 % | 2 |
    | 55–70 % | 3 |
    | 70–85 % | 4 |
    | 85–100 % | 5 |

  - The shot spends 2 arrows, or fires one if only one is left, and sets `rangedCooldown` = `DOUBLE_SHOT.cooldown` (0.8 s).
  - Both arrows can hit the same hero.
- **Blocks.** The arrows are ordinary arrows, so a raised buckler blocks them.
- **Strength.** A full double hit deals 8–10, a kill from full hp. That is the payoff for a slow, visible wind-up of 1.2 s. If play shows it is too strong, the first lever is capping the top band at 4.
- **While the rune's crossbow is held, Q does nothing:** the double shot is a bow technique.
- **Visuals.** A glow on the bow steps up through the five bands while drawing. The arrow trails are tinted by band, from white through gold.

## 4. Mage — Storm Wand main, Fireball rune

**Kit.** The Mage's main hand is the `stormwand` (Call Lightning), and the offhand stays the `blinkwand` (Q). The rune's `RUNE_POWER.mage` becomes `{ wandType: 'firewand' }`.

**Call Lightning in a match.** `SPELL_OVERRIDES.lightning` in `renderer/data/pvp.js`:

| | Single-player (unchanged) | PvP |
|---|---|---|
| Cooldown | 4 s | 1.5 s |
| Delay before the strike | 0.6 s | 0.4 s |
| Damage | 5 | 3 |
| Stun | 1.0 s | 0.6 s (× `PVP.ccMul`, so 0.3 s) |

- The tiers aim as today: a tap strikes 3 tiles ahead, a full charge 6, an overcharge the line of 4, 6 and 8.
- The stamina costs (20/30/50) are unchanged, and they are what limits spam.

**Fireball in a match.** The fireball rune needs PvP's `detonate` hook built; today it is a no-op.
- **Direct hit:** the spell's own 4 damage.
- **Burst:** on detonation, every other hero whose hit shape overlaps the blast tiles (`computeBlastTiles`, the tier's `blastTiles`) takes `SPELL_OVERRIDES.fireball.burst` (2) as an unblockable `'fire'` hit credited to the caster. The hero struck directly is not burst.
- **Fire patch:** a fire zone of those tiles burns for 3 s, dealing 1 damage per second (the `FIRE_*` constants) to heroes standing in it, credited to the caster.
- **Caster immunity:** the caster takes neither the burst nor the patch. `hurtHero` already refuses self-damage.
- **Cost:** a 1.0 s cooldown and stamina 18/26/40, unchanged.

**How the overrides reach the shared systems.** The shared spell code takes the PvP numbers through an optional parameter, the way it already takes `caster`:
- `tryCast` gets an optional spell override.
- A lightning mark carries its own `delay`, `damage` and `stun`.

Defaults keep single-player byte-for-byte as it is, and a test asserts single-player's numbers.

## 5. Netcode, bots, HUD

- **Protocol v4.**
  - The hero snapshot carries `combo`: `{ moves, lockDir }` while holding, else null.
  - It carries `move`: `{ kind: 'lunge' | 'fence' | 'whirl', dir, t }` while a combo effect runs, else null.
  - The double-shot draw rides on the existing `charging` (`kind: 'double'`).
  - `NET.protocolVersion` becomes 4, so an older client gets the reload line.
- **Prediction.**
  - The predictor mirrors the movement parts exactly: the Warrior's locked slide, the gesture's stamina spend through the same `stepGesture`, and the Archer's slowed draw.
  - It mirrors each release's cooldown.
  - The lunge dash is server-driven and reconciles the way knockback does today. It is not predicted.
- **Bots** (`renderer/pvp/bots.js`, tuning in `BOTS`):
  - A Warrior bot lunges at a foe 2–3 tiles away on a straight line, and whirls when two or more foes are within 1.5 tiles and its tank is full. Otherwise it taps.
  - An Archer bot uses the double shot at a full draw when lined up with a foe 5 or more tiles away that is not closing.
  - A Mage bot casts lightning at the tier whose distance best matches the foe's.
- **HUD.** The class picker's hints describe each signature move:
  - Warrior: "Hold attack + stick: combos".
  - Archer: "Hold Q: double shot".
  - Mage: "Storm Wand · Q: blink".

## Testing

- **Unit:**
  - `stepGesture`/`classify`: sectors, the diagonal tie, neutral needed for a repeat, both rotation senses, the 4-move cap, stamina refusal.
  - Each combo: the Lunge hits the first foe, ends on a hit and stops at walls; the Fence lands 3 hits; the Whirlwind hits all around with knockback; blocks by a facing buckler; the cooldowns; the release swing for no moves or an unknown pattern; the hold cancelled by a stun or the shield.
  - The double shot: each band, under 30 %, ammo 2 or 1, the cooldown, 1.2 s cap, the crossbow rune.
  - Lightning overrides in a match, and single-player's numbers unchanged.
  - The fireball's burst, fire patch, caster immunity, and no double-burn of the direct target.
  - The TTK numbers.
  - Protocol v4 fields.
  - Predictor parity: the slide, the draw and the gesture stamina match the server over a replay.
  - Bots use the lunge, the whirlwind and the double shot.
- **Live (time-boxed):** local `pvp` screenshots of the lunge, fence, whirlwind, the double-shot draw and a fireball, plus a local online quick match to check prediction feel.
