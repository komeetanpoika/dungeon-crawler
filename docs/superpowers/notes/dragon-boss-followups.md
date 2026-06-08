# Dragon Boss — playtest follow-ups (not yet fixed)

From manual depth-10 playtest of `feat/dragon-boss` (2026-06-08). Recorded for later;
no fixes applied yet. The temporary warp key (`0` → depth 10) is still in place for testing.

## 1. Tail strike hitbox is in the wrong place
- **Observed:** the tail-sweep damage doesn't line up with where the tail visually is.
- **Root cause (code):** in `renderer/systems/dragonboss.js`, the `tail` state applies
  `TAIL_DMG` to any player within `TAIL_REACH` of the **body centre**, during the active
  window — it's omnidirectional and ignores the tail's actual swung position/angle. The
  renderer whips the tail through an arc (driven by `tailSwing`) on one side, so the visible
  tail and the damage region don't match.
- **Direction (TBD):** tie the hitbox to the tail's real swung arc/segment positions (or at
  least gate it to the side/arc the tail is actually sweeping through), rather than a plain
  radius around the body centre.
- **Open question:** confirm exactly where damage seemed to come from vs where the tail was.

## 2. Dragon rotates too fast
- **Observed:** the boss turns to face the player too quickly — feels twitchy, not weighty.
- **Root cause (code):** `TURN_RATE = 2.5` (rad/s) in `renderer/systems/dragonboss.js`.
- **Direction (TBD):** lower it (try ~1.0–1.5 rad/s) for a heavier, more telegraphed turn.
  Tune by feel.
- **Open question:** preferred turn speed.

## 3. Graphics need overhauling
- **Observed:** the dragon's visuals need work (general).
- **Status:** needs specifics before acting. Aspects to pin down when we tackle it:
  body silhouette/proportions, scale rendering (size/curve/shading), neck/tail/wing look,
  head, colour palette, animation smoothness (idle sway, breathing, wing flap), and how it
  reads against the depth-10 theme.
- **Open question:** which parts most need work — collect concrete notes from the user.

---
Other known follow-ups from the final code review (separate from playtest):
- `dmgAcc` serves two roles (cone fractional accumulator + tail one-shot flag) — split for
  clarity (`coneAcc` + boolean `tailHit`). Not a bug today.
- Rear-arc early reposition (spec mentioned it) not implemented; only the 10s timer is.
- Health bar is drawn at body centre, not above the (large) head.
- Arena `GREAT_LAIR` is 26×16 (spec loosely said ~26×22) — widen if it feels cramped.
