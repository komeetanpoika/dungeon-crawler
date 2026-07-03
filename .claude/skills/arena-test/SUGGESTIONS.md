# Arena Test Suggestions

Feature ideas harvested from test runs (`arena-log.mjs suggest`). Format: `- [NEW|DONE] date (run N): suggestion`. Flip NEW → DONE when implemented.
- [NEW] 2026-07-03 (run 1): Single-chest auto-placement always lands at ring index 0 (top-left corner), which sits outside the player's starting FOV in a default-sized arena and is guarded by an aggressive cyclops's attack path — makes chests hard to verify visually without walking into enemy range. Consider seeding auto-chest ring start near the player's spawn, or documenting in SKILL.md that testers should give explicit x/y to chests they need to see on screen.
