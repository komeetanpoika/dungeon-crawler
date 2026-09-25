# PvP Sub-project 4a — Public Launch

Date: 2026-09-25. Roadmap: `2026-09-25-pvp-roadmap.md`. Builds on sub-project 3
(`2026-09-25-pvp-server-netcode-design.md`, merged in PR #57, live as Cloud Run
rev 00063).

## Goal

A stranger on a phone or a laptop opens the public URL, taps **Online**, types
a name and is fighting within about 10 seconds, even when nobody else is
online. An abusive client can neither crash the server, flood it, nor lock
others out.

## Decisions (agreed 2026-09-25)

| Question | Decision |
|---|---|
| Public entry | An **Online** button: *Quick match* (quick-join a public room with bot fill), or *Play with friends* (host/join a private, humans-only room by code, as in sub-project 3) |
| Bots | Server-side, using `renderer/pvp/bots.js`, filling public rooms to 4 heroes; humans take bots' seats, up to 6 |
| Phones | Supported at launch through the existing touch controls; landscape only (the existing rotate overlay) |
| Split | **4a** (this spec): public rooms, bots, the name filter, limits, the idle kick, the Online menu, the leave confirm, touch, deploy. **4b** (later): reconnecting into your hero, a smoothed interpolation clock, a longer melee rewind, a live respawn countdown, **more arenas** |

## 1. Public rooms and bots

**Three ways in.** `hello` has exactly one of:
- `{ create: true }`: a private room;
- `{ room: CODE }`: join by code;
- `{ quick: true }` (new): a public room.

`validateHello` enforces "exactly one". `PROTOCOL_VERSION` becomes **2**.

**Rooms** gain `public: boolean`.
- **Private rooms** (create): unchanged from sub-project 3. They are humans only and closed when the last socket leaves.
- **Public rooms** (quick):
  - They have a code, shown in the HUD; joining a public room by code is allowed and counts as a human join.
  - They count toward `NET.maxRooms`.
  - A public room is closed when its last **human** leaves; bots never keep a room alive.

**Quick-join matchmaking (`quickJoin(lobby, hello)`):**
- Among public rooms with fewer than `NET.maxHeroes` humans, pick the one with the most humans, breaking ties by the oldest room.
- With none, create a public room.
- Joining during the results screen is allowed; the newcomer is in the next match (as today).

**Bot fill (`balanceBots(lobby, room)`, public rooms only):**
- It runs after every human join or leave and after every new match. The target hero count is `max(NET.botFill, humans)`, with `NET.botFill = 4`.
  - **Too few heroes:** add a bot via `addHero` (farthest spawn, spawn protection).
  - **Too many:** remove the most recently added bot via `removeHero`; a rune it held returns to its pedestal.
- The effect: 1 human plays with 3 bots; a second human replaces one bot (2 + 2); 4 or more humans means no bots, and the room can hold up to 6.
- **Bots** are sim heroes with ids `b1, b2, …` (never reused within a room) and no `players` entry. `stepRoom` gives each one `botInput(match, hero)` every tick.
- **Bot names:** `"Bot " + name`, drawn from `NET.botNames` (Finnish mythology: Ukko, Ilmatar, Tapio, Mielikki, Ahti, Tuoni, Louhi, Otso, Pellervo, Kalma, Vellamo, Hiisi), unique within the room.
- **Bot class:** the one least represented among the room's current heroes, with ties broken in `CLASSES` order.
- Bot kills and deaths count like anyone else's. The results table shows bots under their names.

**Code changes:**
- `server/rooms.js`: `public`, `quickJoin`, `balanceBots`, bot inputs in `stepRoom`, closing on no humans.
- `renderer/net/protocol.js`: `quick`, and the version bump.
- `renderer/data/net.js`: `botFill`, `botNames`.
- The sim itself is unchanged.

## 2. Names and abuse limits

**Names:**
- `validateName` is unchanged: 1–12 characters of `[A-Za-z0-9 _-]`.
- The server additionally calls `acceptableName(name)` (`server/names.js`):
  - **Normalise:** lowercase; drop spaces, `_` and `-`; map `0→o 1→i 3→e 4→a 5→s 7→t`; collapse runs of the same letter.
  - **Refuse** when the normalised text *contains* any stem from `server/blocklist.js` (hand-curated Finnish and English slurs and hard profanity, about 150 stems, kept server-side only).
  - **Refuse** reserved names: those whose normalised form starts with `bot`, `admin`, `mod` or `moderator`.
  - A refusal answers `bad_name`, the same as a malformed name; the reason is not revealed.

**Client IP (`clientIp(req)`):**
- Behind Cloud Run: the last entry of `X-Forwarded-For` (Google's front end appends the real address).
- Otherwise: `req.socket.remoteAddress`.
- `NET.trustProxy` (default `true`) switches the first behaviour; tests set it.

**Limits** (all numbers in `NET`; token buckets take an injected clock for tests):

| Limit | Value | On breach |
|---|---|---|
| Open sockets per IP | 8 | the upgrade is accepted, then `error: rate_limited` and close |
| Hellos per IP | bucket of 10, refilling 10 per minute | `error: rate_limited`, close |
| Messages per connection | bucket of 90, refilling 60/s | close 1008 |
| `class` messages per connection | 2/s | extra ones ignored |
| Total sockets | 600 | `error: server_full`, close |
| Idle kick | no input message for `NET.idleKickMs` = 60 000 | `error: idle`, close; the hero is removed (in a public room a bot takes the seat) |

- New error codes: `rate_limited`, `idle`.
- **Privacy:** IPs are held only in memory, for the counters, and each entry is dropped when its bucket is full again and it has no sockets. IPs are never logged. The server logs refusal counts once a minute when there were any.

## 3. The client flow (desktop and phone)

**Title screen:**
- In the web build only (`window.saveAPI?.isWeb`), the title shows an **Online** button after *Dungeon Rush*. It opens:
  - **Quick match:** name (prefilled) → class → a "Finding a match…" message → the match.
  - **Play with friends:** a submenu with *Host a room* (name → class → private room), *Join with code* (name → code → class) and *Back*.
  - **Back.**
- The hidden `host` / `join` cheats remain as shortcuts into the same screens.

**Class picker (online):** its subtitle shows a control hint. With a coarse pointer (`matchMedia('(pointer: coarse)')`, the check `ui/touch-controls.js` uses): "Stick: move · Red: attack · Green: shield / blink". Otherwise: "WASD: move · Space: attack · Q: shield / blink".

**In a match:**
- **Leave confirm:** Escape, or the touch START pill (which sends Escape), opens **"Leave the match?"** with *Stay* and *Leave*.
  - While it is open, your input is neutral: you stand still.
  - Escape or *Stay* closes it; *Leave* calls `stopNet`.
  - The death picker and the results panel are unaffected: Escape on them opens the confirm too.
- **Results panel:** the table plus *Leave*; the next match starts by itself, as today.
- **HUD:** room code · time · your kills · leader's kills · ping (unchanged).
- **New error lines:**
  - `rate_limited`: "Too many attempts — wait a minute and try again."
  - `idle`: "Removed for inactivity."
  - Both have an OK button that returns to the title.

**Touch:**
- The existing touch controls stay visible during online matches.
- **Text fields:** a tap focuses the field and brings up the phone keyboard; the keyboard's Enter submits.
  - The code field uses `autocapitalize="characters"`, and both fields use `autocomplete="off"`.
  - The touch layer must not swallow taps on the field.
- **Stick** moves you and its rim sprints. **Red** attacks (hold to charge). **Green** is Q. The stance button and SELECT do nothing online. **START** opens the leave confirm.

**Unchanged:** single-player and the local `pvp` mode.

## 4. Deploy and testing

**Deploy:**
- `tools/deploy-web.sh` as today.
- Before any public announcement:
  - **IP probe:** a temporary `?ipcheck` on one upgrade logs the address `clientIp` resolved. Compare it to the machine's public address, then remove the probe.
  - **Memory:** confirm the service memory is at least 512 MiB; otherwise add `--memory=512Mi` to the script.

**Tests (`node:test`):**
- **Protocol:** `validateHello` with `quick` and "exactly one"; the version is 2.
- **`quickJoin`:** most humans wins, the oldest room breaks a tie, a room is created when there is none, and private rooms are never picked.
- **`balanceBots`:**
  - 1 human → 3 bots; a second human replaces a bot; ≥ 4 humans → no bots;
  - a leaving human brings a bot back;
  - a room with no humans closes;
  - a new match rebalances;
  - a removed bot's rune returns;
  - bot names are prefixed and unique, and classes go to the least represented;
  - private rooms never get bots.
- **`acceptableName`:** stems, look-alike and spacing tricks, and the reserved prefixes are refused; ordinary Finnish and English names such as Aino, Ilmari, Väinö-like ASCII names, Sam, Alex and Kalle_99 all pass.
- **Limiters:** sockets per IP, hellos per IP, messages per connection, class spam, total sockets, the idle kick (clock injected), and `clientIp` with and without `X-Forwarded-For`.
- **Integration (real sockets):**
  - a lone quick-join gets a running match with 3 "Bot" heroes;
  - a second quick-join lands in the same room and a bot leaves;
  - the 9th socket and the 11th hello from one IP are refused;
  - flooding closes the socket;
  - an idle client gets `idle`;
  - a private room never has bots.
- **Menu:** the Online menu's structure (and its absence off the web), the leave confirm (open, Stay, Escape again, Leave), and the new error texts.
- **Live checks (time-boxed):**
  1. **Desktop, local:** a quick-join shows 3 bots and a running clock; a second browser joins the same room.
  2. **Phone, local:** a Playwright landscape phone profile (844×390, touch) taps *Online → Quick match*, types a name, taps a class, moves with the stick and attacks, then START → *Leave the match?* → *Stay*. Take screenshots; there must be no page errors.
  3. **After deploy, public URL:** the two-browser quick-join, plus the IP probe.
