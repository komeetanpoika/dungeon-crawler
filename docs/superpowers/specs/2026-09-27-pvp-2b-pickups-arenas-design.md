# PvP Sub-project 2b — Tiered Pickups and Large Arenas

Date: 2026-09-27. Roadmap: `2026-09-25-pvp-roadmap.md`. Builds on 2a
(`2026-09-26-pvp-2a-class-rework-design.md`, merged in PR #60, live as Cloud Run rev 00067).

## Goal

Contesting the map pays off:
- Five buffs, each in a minor and a major tier, spawn at buff spots.
- Two new large arenas give the pickups room.
- Bots contest them too.

## Decisions (agreed 2026-09-27)

| Question | Decision |
|---|---|
| Tiers | Minor and major variants: minor is common, short and mild; major is rare, contested and strong. |
| Elements | Ember and Venom are an "elemental edge" for any class: they coat whatever the hero hits with. |
| Shielding | Ward is an absorb pool that soaks the next N damage, until used or timed out. |
| Arenas | Two new large arenas (about 56×40) in the rotation, with rooms still capped at 6 heroes. The four current arenas stay, each gaining 2 minor spots. |

Out of scope: a minimap, new tile types (water), more than 6 heroes, and changes to the flask, quiver or rune.

## 1. Buffs

All numbers are in `renderer/data/pvp.js` (`BUFFS`, `BUFF_SPOTS`).

| Buff | Minor | Major |
|---|---|---|
| **Haste** | move speed ×1.2 for 8 s | ×1.5 for 15 s |
| **Might** | +1 damage per direct hit for 8 s | +2 for 12 s |
| **Ward** | absorbs the next 2 damage; lasts until used up or 15 s | absorbs 4 |
| **Ember** (edge) | 10 s during which each landed direct hit burns the victim for 1 damage a second for 2 s | 15 s; burns for 3 s and lays a fire patch of `emberPatchTiles` (5) tiles under the victim, burning 3 s at 1 damage a second, credited to the attacker |
| **Venom** (edge) | 10 s during which each landed direct hit poisons for 1 damage every 1.5 s for 3 s (2 damage) and slows by 20 % for 3 s | 15 s; 1 damage every 1.5 s for 4.5 s (3 damage), and a 35 % slow |

**Rules:**
- **State.** A hero carries `buffs: { haste, might, ward, edge }`. Each is null or `{ tier, t }`. Ward also carries `pool`. Edge also carries `kind: 'ember' | 'venom'`. Timers count down each tick.
- **Stacking.**
  - Different buffs stack.
  - Taking the same buff again keeps the higher of the two tiers and the longer of the two remaining times. For Ward, it keeps the larger pool.
  - A new edge replaces the old one, even one of the other kind.
- **Clearing.** A death clears buffs and damage-over-time. So does `applyKit` (a new life). The rune and buffs coexist.
- **Direct hits.** A direct hit is a melee blow or combo hit, a projectile hit, a lightning strike, or the fireball's burst. These are not direct hits:
  - damage-over-time ticks (burn, poison, the hammer's shock);
  - fire-patch ticks;
  - the thunderclap and chain.
- **Might** adds its bonus to the attacker's direct hits before blocks and Ward.
- **Ward** soaks damage of every kind after a buckler block and before hp. An absorbed hit counts as landed: it grants the usual i-frames and kill-credit bookkeeping. When the pool reaches 0, the ward breaks.
- **Edges** apply on a landed direct hit, meaning one that was not blocked and not absorbed in full.
  - Ember sets the victim's `burn = { owner, t, next }`.
  - Venom sets `poison = { owner, t, next }` plus the slow, through the existing slow timer, so `PVP.ccMul` applies to it.
  - Re-applying refreshes the timer; it does not stack.
- **Ticks.**
  - A new `tickDots` in the sim deals burn and poison ticks as unblockable `'dot'` damage credited to the owner. A damage-over-time kill counts for the owner.
  - An owner who has left credits nobody.
  - A caster is never hurt by their own damage-over-time (`hurtHero` already refuses self-damage).
- **Haste** multiplies walk speed in `moveHero`, which the predictor shares. It stacks multiplicatively with sprint and with slows.

## 2. Buff spots

- **Grid letters.** Arena grids gain two letters:
  - `b` is a minor spot, respawning after `BUFF_SPOTS.minorRespawn` (20 s).
  - `B` is a major spot, respawning after `majorRespawn` (45 s), with a `majorFirstSpawn` of 30 s.
- **Rolls.**
  - At match start and at each respawn, a spot rolls its next buff uniformly from the five kinds, using `match.rng`.
  - `match.rng` is a seeded PRNG (mulberry32) made by `makeMatch({ seed })`. The server passes a random seed at match creation, the local mode uses `Math.random` once for the seed, and tests use fixed seeds.
  - All randomness stays inside the sim.
- **While down,** a spot shows a faint ghost of its coming buff (`next`).
- **Walking onto an up spot** takes it, with the same rule as flasks: the hero's tile. Any class can take any buff.
- **Existing arenas.** Pillars, Glade, Tunnels and Ruins each gain 2 `b` spots, placed symmetrically. The arena invariants still hold.
- **Visuals.**
  - Each buff has its own icon from the item atlas. Majors are drawn larger, with a gold rim and a slow pulse.
  - Ghosts are drawn at 30 % alpha.

## 3. Hero visuals and HUD

- **Hero looks:**
  - Haste: a faint speed trail.
  - Might: a red glint on the weapon hand.
  - Ward: a translucent bubble whose opacity follows the remaining pool.
  - Ember edge: embers rising.
  - Venom edge: green drips.
  - A burning hero flickers orange; a poisoned hero is tinted green.
- **Local HUD:** a row of buff icons, each with a countdown ring. There is no text, following the UI feedback tiers.
- **Pickup feedback:** taking a buff plays the `pickup` cue and shows a float of the buff's icon colour.

## 4. Large arenas

- **Keep** (castle ruleset, about 56×40):
  - A walled fort in the centre, with four gates into a courtyard that holds the `B` spot.
  - Around it, a ring of broken outer walls and yards.
- **Wilds** (the Glade's grass look via `floorSkins`, about 56×40):
  - Four corner clearings, joined by winding paths 2–3 tiles wide through thickets of walls and columns.
  - The `B` spot sits in an open central meadow.
- **Per large arena:** 6 spawns, 6 `b`, 1 `B`, 4 flasks, 3 quivers and 1 rune.
- **Invariants** (extended in `test/pvp-arenas.test.js`; the existing invariants keep applying to every arena):
  - The counts above; the small arenas need exactly 2 `b` and 0 `B`.
  - Every spot is reachable.
  - Spawns are at least 10 tiles apart in large arenas (6 in small ones).
  - `B` is at least 8 tiles from every spawn, and every `b` at least 4.
  - **No chokepoint** (large arenas only). Removing any single walkable cell cuts off at most 4 cells from the rest. That allows a small nook, but no region hangs off one cell, and in practice it forces paths 2+ tiles wide.
- **Size clamp.** `buildArena` raises its clamp from 8–40 × 8–30 to 8–60 × 8–44. Only the maximum moves, so every existing config is built as before, and a test pins that.
- **Rotation.**
  - `PVP_ARENA_ORDER` becomes `pillars, glade, keep, tunnels, ruins, wilds`.
  - Each arena gains `large: true | false`.
  - At match start, a large arena is skipped when the room (or local match) has fewer than `PVP.largeMinHeroes` (4) heroes; the rotation takes the next arena.
  - Public rooms always have 4 or more heroes through bot fill.
- **Performance.** Before the arenas ship, a plan task measures the server step and bot pathing on a large arena with 6 bots. The budget is ≤ 2 ms per 30 Hz tick on the dev machine.

## 5. Bots

- **Minor spots:** with no foe within `BOTS.buffSeekFoe` (4) tiles, a bot detours to an up `b` within `BOTS.buffSeek` (6) tiles.
- **Major spot:** a bot heads for an up `B` within `BOTS.majorSeek` (10) tiles, even with foes near.
- **Priorities:** flask-seeking when hurt keeps priority. Buffs change no attack logic.

## 6. Netcode (protocol v5)

- **Hero snapshot:** gains `buffs` and `dots` (`{ burn: t | 0, poison: t | 0 }`, for the visuals).
- **Pickup snapshot:** gains `tier` (`'minor' | 'major'` for spots), `buff` (the kind up now), `next` (the ghost) and `t`.
- **Version:** `NET.protocolVersion` becomes 5, so an older client gets the reload line.
- **Prediction:**
  - The predictor applies Haste from the snapshotted buffs through `moveHero`.
  - Pickups are never predicted: a take shows up on the next snapshot.
  - Venom's slow is on the existing `slowTimer`/`slowMul` wire fields.

## Testing

- **Unit:**
  - `BUFFS` numbers.
  - The seeded roll is repeatable for a seed, and all five kinds come up over many rolls.
  - Stacking and refresh; the edge replacing the other edge.
  - Might on each direct-hit kind and not on damage-over-time.
  - Ward soaking, breaking and granting i-frames.
  - Ember and Venom applying on a landed hit, and not on a blocked or fully absorbed one.
  - Damage-over-time ticks, credit, kills, and an owner who has left.
  - Venom's slow × ccMul.
  - Haste in `moveHero`, with predictor parity.
  - Death and a new kit clearing everything.
  - Buff spots: taking, respawn, ghost and the major's first spawn.
  - Bots seeking minor and major spots.
  - Protocol v5.
  - Large-arena invariants, including the chokepoint rule.
  - Rotation skipping large arenas under 4 heroes.
  - The raised clamp leaving existing maps unchanged.
- **Bot soak:** 20 matches. Report buffs taken per kind and tier, time-to-kill (target: within about ±25 % of 2a's 8.3 s), and per-class K/D.
- **Performance:** a step benchmark on Keep and Wilds with 6 bots.
- **Live (time-boxed):** screenshots of Keep and Wilds, spots up and ghosted, each hero look, and the HUD buff row, from a local online match on an in-process server.
