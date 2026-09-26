# PvP Sub-project 4b — Arenas, Reconnect and Netcode Polish

Date: 2026-09-26. Roadmap: `2026-09-25-pvp-roadmap.md`. Builds on 4a
(`2026-09-25-pvp-public-launch-design.md`, merged in PR #58, live as rev 00065).

## Goal

Online and local PvP get variety and resilience:
- matches rotate through four arenas with different looks and tactics;
- a dropped connection resumes the same hero within 20 s;
- other heroes no longer twitch backwards on jittery links;
- melee hits land for players with up to about 300 ms of view lag;
- the death screen counts the respawn down live.

## Decisions (agreed 2026-09-26)

| Question | Decision |
|---|---|
| Arenas | 3 new hand-authored themed arenas plus today's `pillars`. Each new match takes the next one in a fixed rotation, online and in the local `pvp` mode. No vote. |
| Reconnect | A seat token and a 20 s grace period during which the hero stays in the match |
| Clock | A smoothed, monotonic interpolation clock |
| Rewind | Cap raised from 200 ms to 300 ms |
| Countdown | Live subtitle update without re-rendering the menu |

Out of scope: a map vote, new modes, and new tilesets or art.

## 1. Arenas and rotation

**Format.** The arenas live in `renderer/data/pvp-arenas.js`.
- `PVP_ARENAS` gains `glade`, `tunnels` and `ruins`.
- `PVP_ARENA_ORDER = ['pillars', 'glade', 'tunnels', 'ruins']`.
- Each new arena is written as an array of equal-length strings, with this legend:

  | Char | Meaning |
  |---|---|
  | `#` | wall (the outer border must be walls) |
  | `o` | column |
  | `.` | floor |
  | `S` | spawn (exactly 6) |
  | `F` | flask (exactly 2) |
  | `Q` | quiver (exactly 2) |
  | `R` | rune (exactly 1) |

- A pure `parseArena(id, rows, theme)` turns a grid into the existing arena shape: `{ id, size, columns, walls, spawns, pickups, theme }`. `pillars` keeps its current definition, gains `id: 'pillars'`, and gets the default theme (today's depth-0 look).
- `buildArena` already builds a walled room with `columns`. Interior `#` cells are passed as `walls` and placed as `TILE.WALL`; this is a small, additive `buildArena` option (`config.walls`) that no other caller uses.

**Themes.** An arena's `theme` is `{ ruleset?, floorTile, bgColor, tint, fogAlpha }`, in the same shape as a `DEPTH_THEMES` entry. The client decorates the map with that ruleset exactly as it decorates the pillars arena today.

| Arena | Look | Size | Layout intent |
|---|---|---|---|
| **Glade** | `ruleset: 'outdoors'`, green-dark background | about 30×22 | Broken rings of cover and short sightlines; melee-friendly |
| **Tunnels** | `ruleset: 'catacombs'`, the depth-4 dark tint and fog 0.80 | about 34×24 | Narrow corridors of width 2 joining small chambers; blink and chokepoints |
| **Ruins** | the depth-3 sand floor and warm tint | about 36×26 | Long open lanes with scattered columns; archer-friendly |

**Arena invariants.** `test/pvp-arenas.test.js` checks every arena in `PVP_ARENA_ORDER`:
- it fits `buildArena`'s size clamp (8–40 × 8–30);
- the rows are rectangular and the border is all walls;
- there are exactly 6 spawns, 2 flasks, 2 quivers and 1 rune, all on walkable cells;
- every spawn and pickup is reachable from spawn 1;
- the minimum spawn-to-spawn distance is at least 6 tiles;
- the rune is at least 5 tiles from every spawn.

**Rotation:**
- `makeMatch({ arena })` already accepts an arena.
- **Online:** a room keeps `arenaIndex`, starting at 0. `startNextMatch` builds the next match on `PVP_ARENA_ORDER[(arenaIndex + 1) % n]`.
- **Local `pvp` mode:** "Next match" does the same.
- Bots path on any layout already; `farthestSpawn` works for any spawn list.

**Protocol v3.** `welcome` and every `snap` carry `arena: id`.
- The client builds and decorates that arena's map with `arenaMap(PVP_ARENAS[id])` and the arena's theme.
- When a snapshot's `arena` differs from the current one (at `matchStart`), the client rebuilds its map. It also resets the predictor's map and the renderer's tile cache: a new map object drops the chunk cache.
- An unknown `arena` id is treated as a protocol error: "The game was updated — reload the page".

## 2. Reconnect into your hero

**Tokens:**
- `welcome` gains `token`: 128 random bits from `crypto.randomBytes`, hex-encoded.
- The server keeps `tokens: Map<token, { roomCode, heroId }>` in memory only.
- The client stores the token in `sessionStorage['dc-pvp-seat']`, so it is per tab and gone when the tab closes.

**Grace period:**
- When a seated human's socket closes unexpectedly (not a clean leave, and not an idle kick or refusal), the server does not call `leaveRoom` at once. It marks the player `away` with `awayUntil = now + NET.reconnectGraceMs` (20 000 ms).
- **While away:**
  - the hero stays in the match and takes neutral input, so it stands still and can be hit and killed;
  - the seat counts as human, so no bot replaces it and the room stays open;
  - the idle kick is suspended.
- When the grace period expires, the server calls `leaveRoom` as today: a public room refills with a bot, and an empty room closes. The token is deleted.
- **Clean leave:** a client that leaves deliberately (Escape → Leave, or "Next"/Quit) first sends `bye`, a new client message. That releases the seat at once with no grace period.

**Resume:**
- `hello { v, resume: token }` is a fourth hello form. `validateHello` enforces exactly one of create/room/quick/resume, and the token must be 32 hex characters.
- A resume spends a hello-bucket token like any hello.
- If the token maps to an `away` seat in a live room, the server re-seats it on the new socket:
  - same hero id, name, class, kills and deaths;
  - its input queue reset and its idle clock reset;
  - a fresh `welcome` with a new token (the old one is deleted);
  - then snapshots resume.
- Otherwise it answers `error: resume_failed`: the token is unknown, expired, already used, or the room is gone.
- A seat that is not `away` (its original socket is still open) is refused with `resume_failed` too, so a copied token cannot hijack a live player.

**Client:**
- On an unexpected close after `welcome`, the client shows **"Reconnecting…"** (with *Leave*) instead of "Connection lost".
- It retries `connect` with `hello { resume }` after 0.5, 1, 2, 4 and 8 s, as long as the grace period can still be alive.
- On success the session continues: the predictor and interpolation buffer are reset, and the next snapshot rebuilds the view.
- After the last try, or on `resume_failed`, it shows "Connection lost".
- A "Connection lost" caused by an older build (`version`) still shows the reload line.

**Limits:** unchanged. A resuming client passes the per-IP gate like any new socket.

## 3. Smoothed interpolation clock

`renderer/net/interp.js` gains a clock that `estServerTick` uses:
- **Target:** on each snapshot arrival, `target = snap.tick − arrivalMs / tickMs` (the offset between the server tick and local time).
- **First snapshot:** the offset is set to the target outright.
- **After that:** each arrival moves the offset toward the target by at most `NET.clockSlew × ticksSinceLastArrival` ticks, with `NET.clockSlew = 0.1`, so the rendered clock runs at most 10 % fast or slow while it catches up. If the error is larger than `NET.clockSnapTicks` (15), it snaps instead: a stall, a tab that was hidden, a new match.
- **`estServerTick(now)`** is `now / tickMs + offset`, capped at the newest tick + `extrapolateTicks + interpDelayTicks`, as today.
- **Monotonic:** `renderTick` never decreases between calls. It is clamped to the last value returned, except after a snap, which may move it either way.

Existing interpolation tests keep their meaning. New tests cover: jittered arrivals give a monotonic `renderTick` whose step per frame stays within ±10 % of the nominal rate after settling; a 1 s stall snaps; and equal-tick results snapshots don't drift the clock.

## 4. Longer melee rewind

- `NET.rewindMaxTicks` goes from 6 to **9** and `NET.historyTicks` from 8 to **11**.
- The rewind maths is unchanged.
- The trade-off: a victim on a fast link is occasionally hit just after stepping behind cover.
- The existing lag test pair (hit with rewind, miss without) gains a 150 ms each-way variant that must hit with rewind.

## 5. Live respawn countdown

- `menu.setSubtitle(text)` updates only the current screen's subtitle node. It creates the node if missing, never re-renders the buttons, and keeps the selection.
- The death picker, both local and online, shows `"Back in N"`, where N is `ceil(respawnT)` from the local hero's view. `game.js` calls `setSubtitle` whenever N changes.
- The picker's own class-hint text moves to a second line (`lines`), so the countdown stays readable.

## Testing summary

- **Unit:**
  - `parseArena` and every arena's invariants, plus a golden screenshot per arena in the final live check;
  - rotation, online and local;
  - protocol v3 (`arena`, `token`, `resume`, `bye`, `resume_failed`);
  - the grace period (away, suspended idle, expiry → leaveRoom and bot refill, clean `bye`);
  - resume (success; expired, reused or unknown token; the seat still live; the room gone);
  - clock smoothing and monotonicity;
  - the rewind cap;
  - `setSubtitle`.
- **Real sockets:**
  - drop a client mid-match (terminate its socket), resume within 20 s: same hero id and kills, and snapshots continue;
  - resume after the grace period: `resume_failed`, and the seat is refilled by a bot in a public room;
  - a `bye` releases at once;
  - an arena change at `matchStart` reaches clients.
- **Live (time-boxed):**
  - local screenshots of all four arenas (desktop);
  - a local drop-and-resume in the browser (the socket is killed from the page, and the "Reconnecting…" overlay leads back into the match);
  - after deploy, a public two-browser quick match.
