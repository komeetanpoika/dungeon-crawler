# Arena Test Journal

Append-only record of arena test runs, managed by `arena-log.mjs` — do not hand-edit entries. Each run saves its key testing question and criteria before the game runs, and the tester's 1–5 assessment of how well the criteria were met after.

## Run 1 — 2026-07-03 — CLOSED
**Question:** Does the parametric arena spawn a configured cyclops instead of the dragon boss?
**Criteria:** level0 with a cyclops config shows exactly one cyclops (with held club), no dragon boss, player spawn honored
**Config:** (default boss arena)
**Score:** 4/5
**Notes:** Cyclops arena config confirmed: title screen took the level0 cheat cleanly; the arena rendered exactly one cyclops at upper-middle carrying its club, player spawned lower-middle wielding the configured sword, and the molten-red boss theme was in effect with NO dragon boss anywhere on screen. The axe chest did not appear in the framed screenshot because it auto-places at ring index 0 (~top-left corner, far from the player's FOV radius) and the arena uses fog-of-war that blacks out unexplored tiles — code review of buildArena/ring placement in renderer/systems/map.js confirms the chest spawn entry is generated correctly. Two attempts to walk toward the chest to visually confirm it ended in 'You Died' (cyclops contact damage while crossing its path), so the chest's on-screen appearance was not directly observed, only confirmed by code. Default-path regression check passed: deleting arena-config.json and re-entering level0 produced the original dragon boss (breathing fire) with weapon/potion chests ringed around it, confirming absence-of-config still yields the old behavior.

## Run 2 — 2026-07-03 — CLOSED
**Question:** Across 10 arena fights, does the dragon boss render fully and does its tail strike telegraph and sweep visibly when the player flanks its rear?
**Criteria:** In every fight the boss rig renders complete (body/neck/head/wings/tail, no garbling); in fights where the player reaches the rear arc, a visible tail pull-back precedes a visible sweep (screenshot evidence of windup and swing frames).
**Config:** dragon_boss
**Score:** 2/5
**Notes:** 10 arena fights vs dragon_boss (longsword, hp bumped 60->200 mid-run to survive longer). Boss rig render criterion: FULLY MET in all 10 fights - body/neck/head/wings/tail/spikes and the breath cone rendered coherently in every screenshot, including while overlapping the player and mid-attack; no garbling or missing parts observed. Tail-strike criterion: UNRESOLVED, not failed - despite deliberate flanking via direct approach, diagonal approach, wide-radius strafing, and exploiting the facing-freeze during cone/sweep attacks, inTailArc was never satisfied at the moment attackCooldown hit 0, so tail_windup/tail never triggered in any of the 10 fights. Root causes (see SUGGESTIONS): boss facing tracks the player continuously at 0.8 rad/s outside committed attack states, requiring sustained high angular velocity to out-circle; the core capsule's ~1.5-tile block radius pins the player to the boss's front once in melee contact, defeating attempts to reposition; and stacked contact+cone damage forced repeated retreats/deaths (5 of 10 fights ended in death) before an orbit could complete. Score reflects: one half of the question answered solidly (render=yes), the other half genuinely untested (tail visuals unknown) after a good-faith 25-min effort.

## Run 3 — 2026-07-03 — CLOSED
**Question:** With TURN_RATE slowed to 0.1 (uncommitted), does the tail strike fire in a live fight and does the game stay responsive afterward?
**Criteria:** Tail sweep log line appears; after it, arrow-key input still moves the player and the frame keeps updating (two screenshots ~2s apart differ)
**Config:** dragon_boss
**Score:** 5/5
**Notes:** Tail fired at point-blank rear spawn ('Tail sweep! (-4)' in freeze-a.png, tail visibly swung, player knocked back). Four ArrowDown presses later freeze-b.png shows the camera scrolled, the player relocated well clear of the boss, and the boss mid-stomp - input processed, simulation advancing, no freeze. The killed agent's freeze suspicion did not reproduce with the current branch (which includes the async beginRun fix). NOTE: run used the UNCOMMITTED TURN_RATE 0.8->0.1 change in dragonboss.js - balance decision pending.

## Run 4 — 2026-07-05 — CLOSED
**Question:** Does a basic monster (new brain/act AI) chase the player in the live game and route around a 3-column wall stub to land a melee hit when the player hides behind it?
**Criteria:** Within ~20s: monster visibly closes distance while player is visible, then after the player moves behind the column stub the monster comes around the wall and a monster melee-hit message appears in #hud-log; monster is never permanently wedged against the columns
**Config:** monster(weak)
**Score:** 5/5
**Notes:** Final run definitive: bat aggroed at 4 tiles, pursued the player through a 4-up/4-right/3-down flee route, rounded the 7-column wall's only opening (row above its top) and re-engaged inside the pocket within ~3s of the player settling (screenshots r1f-pocket/plus2/plus4; melee-hit messages resumed in pocket). Never wedged against columns. Three earlier attempts ended in player death from harness latency (discrete presses too slow while a glued monster hits ~2-3x/s) — itself evidence the chase never drops. Held-key movement via eval dispatchEvent solved it.

## Run 5 — 2026-07-05 — CLOSED
**Question:** Does the medium (shooting spider) monster kite — keep a 70-120px standoff band from the player, backing away when the player advances, instead of walking into melee range?
**Criteria:** Across screenshots over ~10s with the player advancing toward it, the spider maintains visible separation (roughly 2-4 tiles), moves AWAY when the player closes below ~2 tiles, and its ranged shots appear (projectile or 'Hit for 1 damage!' at range); it never sits in melee contact
**Config:** monster(weak)
**Score:** 4/5
**Notes:** Spider maintained a 2.2-2.8 tile (~70-90px) standoff through spawn, player advance, and settle (screenshots r2-entry/advanced/retreat); purple projectile visible in flight at entry and ranged 'Hit for 1 damage!' landed with no melee contact ever; it slid laterally (N->W around the advancing player) exactly like band-strafe. Docked one point: the scripted advance stopped right at the band's lower edge so an unambiguous 'player inside 70px -> spider retreats' moment wasn't isolated, though the spider was never overrun.

## Run 6 — 2026-07-05 — CLOSED
**Question:** Does a guard flee (rout away from the player) when reduced to 1/4 HP, per the taxon-based low-HP flee rule?
**Criteria:** After exactly 3 dagger hits (guard 4hp -> 1hp = 0.25 <= fleeHp 0.3), the guard visibly disengages and increases distance from the player across consecutive screenshots instead of continuing to attack; before the 3rd hit it fights normally
**Config:** monster(medium)
**Score:** 5/5
**Notes:** Definitive with the new per-enemy hp override: a guard spawned at hp 1 (1/4 = fleeHp threshold) routed the moment it perceived the player — retreated 4->9+ tiles to the NE wall nook within ~4s of entry (r3e-entry/plus2/plus4), held there (cornered = stand), and when the player approached diagonally it slid along the north wall keeping ~5-6 tiles of separation (r3e-probe2). Zero contact, zero attacks. Earlier same-question attempts (r3a-r3d) failed on harness grounds: dagger snap whiffs at point-blank overlap, ranged bolts can't reliably hit a patrolling guard, and sustained melee contact kills even a 40hp scripted player (~2.5 hits/s) — hence the hp-override arena capability added mid-session.

## Run 7 — 2026-07-05 — CLOSED
**Question:** Do idle (unaggroed) enemies patrol between auto-generated points — purposeful walk, dwell pause, move to another point — instead of the old random-direction wander or standing still?
**Criteria:** Across ~4 screenshots over 12+ seconds with the player stationary and out of aggro range, the guard occupies distinct positions several tiles apart with at least one direction change (returning toward a previous area), consistent with rotating patrol points rather than monotone drift or jitter
**Config:** guard
**Score:** 5/5
**Notes:** Unaggroed guard (6 tiles, outside 180px sight) patrolled distinct multi-tile legs over 15s: NW area at t0, walked out of the player's FOV by t6, re-entered at upper-left facing WEST at t12, then moved ~3 tiles EAST by t15 — a clear direction reversal between dwell areas (r4c-t0/t6/t12/t15). Never aggroed, player untouched. One earlier attempt at 7.8 tiles (r4) aggroed within ~3s because a patrol leg crossed sight range — correct behavior, but it teaches that patrol observation needs spawn distance ~6 tiles AND luck with generated points; the out-of-FOV interlude also shows patrol points can leave the observable window.

## Run 8 — 2026-07-05 — CLOSED
**Question:** Does the crab orbit (strafe) the player around interior columns without wedging — the migrated 30/70 blend now wall-aware?
**Criteria:** Across screenshots over ~10s the crab's angular position around the stationary player changes by >90 degrees (visible orbiting); when its orbit path meets the column pair west of the player it passes around them (appears on the far side) rather than pressing into them for multiple consecutive shots
**Config:** guard
**Score:** 4/5
**Notes:** Crab orbited from spawn (due N of player) to NW past the 2-column pair without ever wedging (r5b-t0), then spiraled in (inward 0.3) and grabbed — pincer cycle messages from t4 on, crab correctly stationary while grabbing. Wall-awareness confirmed: its approach arc skirted the columns cleanly. Docked one point: the >90-degree continuous orbit sweep was cut short by the grab (correct signature behavior at 25px range vs a stationary player) and repeated grab cycles killed the player (~3.3 dps) before a post-grab strafe window opened.
