# PvP Arena — Roadmap

Date: 2026-09-25. Status: sub-project 1 built and deployed (PR #56, Cloud Run
rev 00062); sub-project 3 built and deployed (PR #57, rev 00063); 4a designed; 2 and 4b not yet designed.

## Goal

A public, online, free-for-all PvP arena in the web build. A stranger opens
the Cloud Run URL, types a nickname, and is fighting within ~10 seconds.
Hits feel fair at 50–100 ms latency, and an edited client cannot cheat.

## Decisions (agreed 2026-09-25)

| Question | Decision |
|---|---|
| Audience | Public — strangers in open lobbies |
| Match shape | Free-for-all, 2–6 players, short timed matches, quick-join |
| Gear | Class kit per life (Warrior / Archer / Mage) + contested map pickups |
| Platform | Web build only; Electron stays single-player |
| Identity | Anonymous nickname; no accounts, no chat (emotes at most), nothing persisted |
| Netcode | **Authoritative Node server** running the real `renderer/systems/*` code; clients send input intents, server sends snapshots; client prediction for the local hero, interpolation for the others, server-side lag compensation for hits |
| Single-player | Untouched — Adventure, Dungeon Rush and Timewarp keep their own `update()` |

Rejected: a relay with a host client (host can cheat or leave; latency hinges
on the host) and deterministic lockstep (14 systems call `Math.random`; action
combat stalls on the slowest peer).

## Sub-projects

Each gets its own spec → plan → implementation cycle, in this order.

1. **Multi-hero core + local harness.** A DOM-free PvP simulation
   (`renderer/pvp/`) stepping N heroes from explicit input intents at a fixed
   30 Hz, hero-vs-hero combat through the existing damage/hitbox/projectile
   paths, class kits, pickups, one arena map, rendering of N heroes, a PvP
   HUD, and bots. Playable offline via a `pvp` title cheat against bots.
   *Spec: `2026-09-25-pvp-multi-hero-core-design.md`.*
2. **Balance pass.** Tune `renderer/data/pvp.js` (kits, CC multiplier,
   timers, pickup values, plate override) using bot soaks and local play.
   Small; may be folded into playtesting between 1 and 3.
3. **Server + netcode.** *Spec: `2026-09-25-pvp-server-netcode-design.md` —
   decided 2026-09-25: room codes (hidden `host`/`join` cheats), drop-in humans
   only, the WebSocket served from the same Cloud Run service (max-instances=1).*
   A Node WebSocket server importing `renderer/pvp/sim.js`;
   input and snapshot protocol (with a version number), client-side prediction
   and reconciliation for the local hero, snapshot interpolation for the
   others, lag-compensated hit tests (rewind by the attacker's latency, capped),
   disconnect handling. Tested with simulated latency and packet loss.
4. **Lobby + public hardening + deploy.** *Split 2026-09-25:* **4a** public
   launch (spec `2026-09-25-pvp-public-launch-design.md`: Online menu, quick-join
   public rooms with server bots filling to 4, name filter, per-IP/per-connection
   limits, idle kick, leave confirm, phones via the touch controls); **4b** later:
   reconnect into your hero, smoothed interpolation clock, longer melee rewind,
   live respawn countdown, **more arenas**. *4a built + deployed (PR #58, rev 00065); 4b spec:
   `2026-09-26-pvp-4b-arenas-reconnect-design.md` (glade/tunnels/ruins in rotation,
   20 s reconnect grace, smoothed clock, 300 ms rewind, live countdown).* Quick-join and room lifecycle, bot
   fill when a room is short of humans, a nickname length/charset filter with
   a blocklist, per-connection rate limits and input validation, reconnect,
   a public menu entry in the web build, and deployment next to the existing
   web release (Europe region). Cost and abuse limits get decided here.

## Constraints carried forward

- `renderer/pvp/*` must never touch the DOM or `window` — the server imports it.
- Every PvP tuning number lives in `renderer/data/pvp.js`.
- The sim must stay authoritative-friendly: all randomness and all decisions
  happen inside `stepMatch`, never in rendering or input code.
