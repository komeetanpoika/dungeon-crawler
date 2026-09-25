# PvP Sub-project 3 — Server + Netcode

Date: 2026-09-25. Roadmap: `2026-09-25-pvp-roadmap.md`. Builds on sub-project 1
(`2026-09-25-pvp-multi-hero-core-design.md`, merged in PR #56).

## Goal

Two to six people on different machines play one PvP match in the web
build, joined by a room code. With 50–100 ms of ping to europe-west4:
- your own movement feels instant;
- the other heroes move smoothly;
- a sword swing that looked like a hit on screen counts as one;
- an edited client can't give itself speed, damage or ammo.

## Decisions (agreed 2026-09-25)

| Question | Decision |
|---|---|
| Done means | Deployed to the web release; a room is created and joined with a 4-letter code; not public or discoverable yet |
| Hosting | The existing Cloud Run service `dungeon-crawler` serves the static game *and* WebSockets on `/pvp`, same origin, `max-instances=1` |
| Match flow | Drop-in, humans only: creating a room starts a match at once; friends join mid-match; no bots in online rooms |
| Netcode | Server-authoritative 30 Hz sim; 20 Hz snapshots; client-side prediction and reconciliation for your own hero's movement; interpolation of the other heroes about 100 ms in the past; melee-only lag compensation (rewind capped at 200 ms) |
| Staging | 1. protocol + server with no prediction (already playable), 2. prediction + interpolation, 3. melee rewind — each tested under simulated lag |

Rejected:
- **No prediction:** it lags visibly at 80 ms.
- **Full rollback:** it needs a deterministic sim across browsers and heavy CPU on a software canvas.

Out of scope (sub-project 4):
- quick-join and public lobbies
- bot fill
- the nickname blocklist
- per-connection rate limits beyond `maxPayload` and the input clamps
- reconnecting into your old hero
- a public menu entry

## 1. Architecture and protocol

**One process, one origin.** `tools/web-server.mjs` keeps serving `renderer/`
and hands WebSocket upgrades on `/pvp` to `server/pvp-server.js`. The
browser connects to `wss://<page host>/pvp` (`ws://` on http). The runtime
gains exactly one dependency, `ws` (in `dependencies`; the container runs
`npm ci --omit=dev`).

**Modules**
- **`renderer/net/protocol.js`** (DOM-free, shared by server and client):
  - `PROTOCOL_VERSION = 1`, the message type constants, `encode`/`decode` (JSON);
  - `validateInput(raw) → HeroInput & { seq, view } | null`: `move.x`/`move.y` clamped to −1/0/1 via `Math.sign` of a finite number (else 0), `facing` one of the four directions or null, the flags coerced to booleans, `seq` and `view` non-negative integers (else the input is rejected);
  - `validateName(raw) → string | null`: trimmed, 1–12 characters of `[A-Za-z0-9 _-]`;
  - `snapshotOf(match, forHeroId, ack)` and `applySnapshot`.
- **`server/rooms.js`**:
  - `createRoom`, `joinRoom`, `leaveRoom`, `roomOf`;
  - a `Map` of code → `{ code, match, clients: Map<heroId, client>, queues, history, lastInputTick }`;
  - codes are 4 letters from `ABCDEFGHJKLMNPQRSTUVWXYZ` (no I or O), retried on collision;
  - `MAX_ROOMS = 50`, `MAX_HEROES = 6`.
- **`server/pvp-server.js`**:
  - `attachPvp(httpServer, opts)` upgrades `/pvp` via `ws` (`maxPayload: 4096`);
  - it handles messages and heartbeats, and runs each room's tick loop.
- **`renderer/net/client.js`**:
  - `connect({ url, WebSocketImpl, hello }) → NetSession`, taking the WebSocket constructor as a parameter so Node tests can pass `ws`'s;
  - it keeps the fixed-step send loop, the pending inputs, the snapshot buffer and the ping.
- **`renderer/net/predict.js`** and **`renderer/net/interp.js`**: pure (§2).

**Sim changes (in `renderer/pvp/`)**
- `makeMatch` accepts a roster of 1–6 heroes.
- `addHero(match, { id, name, cls }) → hero` places the new hero at `farthestSpawn` with `PVP.spawnProtect`, and refreshes the targets.
- `removeHero(match, id)`: if the hero held the rune, the rune pickup returns to `up = true` immediately. The hero is removed from `heroes` and the targets are refreshed.
- The match clock (and so match end) only advances while `match.heroes.length >= PVP.minHeroes` (`minHeroes: 2`). Everything else keeps ticking.
- `moveHero(match, hero, input, dt)` is extracted from `tickHero`: timers → shield → facing → movement → walk. `tickHero` calls it, and so does the client predictor.
- The `swing` hit test reads positions through `match.hitPos?.(foe, attacker) ?? foe` (§2).

**Protocol v1 (JSON text frames)**

| Direction | Type | Body |
|---|---|---|
| C→S | `hello` | `{ v, name, cls, create: true }` or `{ v, name, cls, room }` |
| C→S | `input` | `{ seq, move, facing, attack, alt, sprint, view }`, one per client tick |
| C→S | `class` | `{ cls }`, which calls `setClass` (applied at respawn) |
| C→S | `ping` | `{ t }` |
| S→C | `welcome` | `{ v, room, heroId, tick }` |
| S→C | `snap` | `{ tick, ack, clock, waiting, heroes, projectiles, lightning, strikes, arcs, shockwaves, pickups, events }` |
| S→C | `error` | `{ code }`, one of `version`, `no_room`, `room_full`, `bad_name`, `bad_hello`, `server_full` |
| S→C | `pong` | `{ t }` |

- A snapshot hero carries only what drawing and prediction need: `id, name, cls, x, y, px, py, facing, hp, maxHp, stamina, dead, respawnT, spawnProtect, invulnTimer, kills, deaths, attackMode, attackTimer, attackDuration, attackStyle, attackFacing, attackReachMul, charging, blocking, stunTimer, slowTimer, slowMul, rootTimer, rain, shock, rune (as { t }), blinkTrail, knockback, meleeCooldown, rangedCooldown, magicCooldown, offCooldown, ammo, weapon/ranged/wand (weaponType only), outfit per stance (outfitType only)`.
- `ack` is the last input `seq` the server applied for the receiving client.
- Clients send only intents: position, damage, ammo and cooldowns are never accepted from a client.
- An invalid `input` is dropped silently. An unparseable frame or an invalid `hello` closes the socket.

## 2. Netcode

**Fixed step on both ends.** The client keeps a 30 Hz accumulator (`PVP.tick`).
Each client tick builds one input from the keys, stamps it with `seq` (+1) and
`view` (the server tick the other heroes are currently drawn at), sends it,
and hands it to the predictor.

**Server input handling**
- Each client has a queue, capped at 4 (the oldest is dropped).
- Each server tick shifts one input per client. If the queue is empty, the client's last input is repeated.
- If no input has arrived from a client for 15 ticks, that hero gets `NEUTRAL_INPUT` until one does.
- `ack` = the `seq` of the input applied this tick (unchanged when an input is repeated).

**Prediction and reconciliation (`predict.js`)**
- The client keeps a predicted copy of its own hero and a local copy of the map. The map is built by `makeMatch`'s arena from the same `PVP_ARENAS` data, so no map is sent.
- The predicted hero is built with `makeHero({ id, name, cls })`, so it has the kit's gear: the shield offhand and the outfit's sprint drain that `moveHero` reads. Snapshot fields are copied over it.
  - When a snapshot's `cls` differs from the predicted hero's (a class change at respawn), the client calls `applyKit` first.
  - Hands come from the snapshot's `weaponType`s via `weaponContents` / `makeRangedContents` / `makeWandContents`, so the rune's heavy hammer slows the predicted charge exactly as it does on the server.
- Each client tick runs `moveHero` on the predicted hero and appends `{ seq, input }` to `pending`.
- **On each snapshot:**
  1. Copy the server's state for your own hero onto the predicted hero.
  2. Drop the `pending` entries with `seq <= ack`.
  3. Replay the rest through `moveHero`.
- **Visual correction:**
  - `err` is the distance between the drawn position and the new prediction.
  - Below 2 px the drawn position snaps.
  - Above 96 px (a respawn, a blink, a knockback surprise) it also snaps.
  - Otherwise a render offset carries the error and decays to zero over 100 ms.
- **Cosmetic attack prediction:** on an attack press that the predicted cooldown allows, the client starts the swing animation, the charge ring and the blink trail locally. Damage, projectiles and lightning appear only from snapshots.

**Interpolation (`interp.js`)**
- Snapshots are buffered with their `tick`, keeping the last 1 s.
- `estServerTick` = the last snapshot's tick + (now − its arrival time) × 30.
- `renderTick = estServerTick − 3`, about 100 ms back.
- **Other heroes:** positions are lerped between the two buffered snapshots around `renderTick`. Everything else comes from the newer one.
- **Buffer underrun:** continue along the last velocity for at most 3 ticks, then hold.
- **Projectiles** (no ids): each one from the older snapshot of the pair is advanced along `dx`/`dy` by `(renderTick − older.tick) × PVP.tick`.
- **Lightning, strikes, arcs and shockwaves** come from the newer snapshot.

**Melee rewind (server)**
- Each room records every hero's `{ px, py }` per tick in a ring buffer of 8 ticks.
- When a hero's input is applied, the server stores `hero.viewTick = input.view`.
- The room installs `match.hitPos = (foe, attacker) => …`:
  - `k = clamp(tick − attacker.viewTick, 0, 6)`, i.e. at most 200 ms;
  - it returns the foe's recorded position `k` ticks back, or the current one if there is no record.
- Only `swing`'s hit test uses `hitPos`. Knockback direction, shield arcs and damage use real positions.
- Projectiles and lightning are never rewound.
- The local harness never sets `hitPos`, so bot matches are unchanged.

**Ping:** the client sends `ping` every 2 s. The round-trip time is shown in the
PvP HUD strip and exposed to tests.

## 3. Rooms and lifecycle

**Entry (web build only; hidden cheats until sub-project 4)**
- **`host`:** a name screen (prefilled from localStorage `dc-pvp-name`), then the class picker, then `hello { create: true }`.
- **`join`:** the name screen, then a code screen (4 letters, uppercased), then the class picker, then `hello { room }`.
- The text entry is a new `menu.showTextEntry({ title, value, maxLength, onSubmit, onBack })`, built on `renderScreen` with an `<input>`.
- In Electron (`!window.saveAPI?.isWeb`), both cheats show "Online play is in the web build" and do nothing else.
- The local `pvp` mode is unchanged.

**Room lifecycle**
- **`create`:** a new code and `makeMatch({ roster: [creator] })`; `server_full` beyond `MAX_ROOMS`.
- **`join`:**
  - `no_room` if the code is unknown, `room_full` at 6 heroes;
  - otherwise `addHero`. The newcomer's hero id is unique within the room (`p1`, `p2`, …, never reused).
- **Waiting:** below 2 heroes the snapshot's `waiting: true` and the HUD timer shows `--:--`.
- **Match end:**
  - Clients show the results panel from the `matchEnd` event.
  - After `RESULTS_DELAY = 10` s the server builds a new match with the room's current heroes. Each keeps name and id, takes `pendingCls ?? cls`, and starts on a new spawn.
  - It pushes a `{ type: 'matchStart' }` event, and clients close the results panel when it arrives.
- **Leave:**
  - A socket close (Escape, *Leave*, a closed tab) calls `removeHero`, frees the queue and history, and destroys the room when it is empty.
  - Rejoining with the code creates a fresh hero.
- **Heartbeat:** the server sends WebSocket pings every 5 s and terminates a socket that misses two.

**Client lifecycle**
- The HUD strip shows `ROOM · time · your kills · leader's kills · ping`.
- **Death:** the class picker, which sends `class`. The respawn countdown goes in the picker's subtitle, so the overlay no longer hides it.
- **Unexpected close:** "Connection lost" with an OK button that goes back to the title.
- **An `error` before `welcome`:** one line of text, with a *Back* button to the title:
  - `version`: "The game was updated — reload the page"
  - `no_room`: "No such room"
  - `room_full`: "Room is full"
  - `bad_name`: "Name: 1–12 letters, digits, space, _ or -"
  - `server_full`: "Server is full"
- **Escape:** leaves the room and returns to the title.

**Server tick loop (per room)**
- `setInterval(step, 1000 / 30)` with a `performance.now` accumulator. Each simulated tick:
  1. Pop one input per client.
  2. Call `stepMatch(match, inputs, PVP.tick)`.
  3. Record the position history.
  4. Collect the events.
  5. If `floor(tick × 20 / 30)` changed, send each client its `snap` with its own `ack` and the events collected since the last snapshot.
- Catch-up is capped at `PVP.maxFrame` per interval.
- The timer is cleared when the room is destroyed.

## 4. Hosting and testing

**Cloud Run** (service `dungeon-crawler`, project `delimaster`, region `europe-west4`):
- deploy flags: `--max-instances=1 --timeout=3600 --concurrency=1000`, plus the existing `--allow-unauthenticated`;
- CPU stays allocated while any socket is open, and the service still scales to zero when idle;
- a deploy closes live sockets, and clients show "Connection lost" or the `version` message;
- a connection older than 60 minutes (Cloud Run's ceiling) drops, which is accepted.

**Container:** the `Dockerfile` copies `package.json`, `package-lock.json`,
`server/`, `tools/web-server.mjs` and `renderer/`, runs `npm ci --omit=dev`,
and starts `node tools/web-server.mjs`. `ws` moves to `dependencies`.
Electron is unaffected.

**Tests**
- **Unit:**
  - protocol validation and round-trip;
  - `addHero`/`removeHero` (including a rune held at removal) and the clock pausing;
  - rooms (codes, full, leave, destroy);
  - the input queue (the cap, repeat, the stale switch to neutral);
  - rewind (the ring buffer, the clamp both ways, the `hitPos` seam, and no change without `hitPos`);
  - `predict.js` (exact replay with no loss, snap vs blend);
  - `interp.js` (bracketing, the extrapolation cap, projectile advance).
- **Integration (Node, `test/net-*.test.js`):**
  - The real server on an ephemeral port, and clients from the real `client.js` using `ws`.
  - Everything goes through a lag-proxy helper: 60–120 ms of delay per direction, with jitter and occasional 300 ms stalls.
  - **Walk:** A walks right for 1 s. Its prediction ends within 2 px of the server's, with no drawn jump over 4 px.
  - **Interpolation:** B's view of A never steps more than one tile per frame.
  - **Melee under lag:** A swings at B where A sees B while B walks away. It hits with rewind, and the control run with rewind disabled misses.
  - **Lifecycle:** join and leave mid-match, and match end followed by the next match. This test injects a short match length and results delay.
  - **Cheat resistance:**
    - out-of-range `move`, a bogus `facing` and a non-integer `seq` produce only normal movement;
    - an oversized frame closes the socket.
  - **Cost:** the integration run logs server `stepMatch` + snapshot time per tick for a 6-hero room. The target is under 2 ms.
- **Live check after deploy (time-boxed):**
  - Two Playwright contexts on the public URL: one `host`s, the test reads the code from the HUD, and the other `join`s.
  - Both walk for about 5 s.
  - It takes a screenshot of each and checks for zero page errors.
