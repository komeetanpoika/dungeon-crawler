# PvP Public Launch (Sub-project 4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stranger on a phone or a laptop opens the public URL, taps **Online → Quick match**, types a name and is fighting bots (or people) within about 10 seconds, and an abusive client can neither crash the server, flood it, nor lock others out.

**Architecture:**
- `server/rooms.js` stays pure. It gains public rooms, `quickJoin`, `balanceBots` (server-side bots driven by `renderer/pvp/bots.js`), and an idle timer measured in room ticks.
- Two new pure server modules:
  - `server/names.js` + `server/blocklist.js`: the name screen;
  - `server/limits.js`: token buckets with an injected clock, the per-IP gate, per-socket budgets and `clientIp`.
- `server/pvp-server.js` wires them into the socket layer. It also kicks idle humans and logs refusal counts, never addresses.
- The protocol goes to v2 with `hello.quick`.
- On the client:
  - `menu.js` gains the Online menus and the leave confirm;
  - a pure `renderer/ui/net-panels.js` decides which in-match panel is up;
  - `game.js` wires the flows.

**Tech Stack:** vanilla ES modules, Node 22 (CI) / Node 20 (container), `ws@^8`, `node:test`, `playwright-core` for the live checks.

**Spec:** `docs/superpowers/specs/2026-09-25-pvp-public-launch-design.md`. Earlier: `…-pvp-server-netcode-design.md` and its plan `docs/superpowers/plans/2026-09-25-pvp-server-netcode.md`.

## Global Constraints

- **Numbers from the spec, all in `renderer/data/net.js` (`NET`):**

  | What | Value |
  |---|---|
  | `protocolVersion` | **2** |
  | `botFill` (public rooms topped up to this many heroes) | 4 |
  | `maxHeroes` (humans per room) | 6 (unchanged) |
  | `botNames` | `Ukko, Ilmatar, Tapio, Mielikki, Ahti, Tuoni, Louhi, Otso, Pellervo, Kalma, Vellamo, Hiisi`; a bot is named `"Bot " + name`, unique in its room |
  | `perIpSockets` | 8 open sockets per IP. The 9th upgrade is accepted, then gets `error: rate_limited` and is closed |
  | `helloBurst` / `helloPerMin` | a bucket of 10 hellos per IP, refilling 10 per minute. On breach: `error: rate_limited`, then close |
  | `msgBurst` / `msgPerSec` | a bucket of 90 messages per connection, refilling 60/s. On breach: close 1008 |
  | `classPerSec` | 2 `class` messages per second per connection; extra ones are ignored |
  | `maxSockets` | 600 sockets in total. On breach: `error: server_full`, then close |
  | `idleKickMs` | 60 000. On breach: `error: idle`, close, and the hero is removed; in a public room a bot takes the seat |
  | `trustProxy` | `true`: `clientIp` takes the **last** `X-Forwarded-For` entry, else `req.socket.remoteAddress` |
  | `refusalLogMs` | 60 000. Refusal counts are logged once per period, only when non-zero |
- **New error codes:** `rate_limited`, `idle`. The new client lines are:
  - "Too many attempts — wait a minute and try again.";
  - "Removed for inactivity.".
- **Names:**
  - `validateName` is unchanged: 1–12 characters of `[A-Za-z0-9 _-]`.
  - The server also requires `acceptableName(name)`. It normalises the name: lowercase; drop spaces, `_` and `-`; map `0→o 1→i 3→e 4→a 5→s 7→t`; collapse runs of the same letter.
  - It refuses a name that *contains* any stem from `server/blocklist.js`.
  - It refuses a normalised name that starts with a reserved prefix: `bot`, `admin`, `mod` or `moderator`.
  - A refusal answers `bad_name`, the same as a malformed name.
  - The blocklist lives in `server/` only and is never served to browsers. `server/static.js` serves `renderer/` only.
- **Privacy:**
  - IP addresses are held only in memory, in the gate's counters.
  - An entry is dropped when it has no sockets and its hello bucket is full again.
  - **IPs are never logged, and never sent to a client.** Only refusal counts are logged.
- `renderer/net/` stays DOM-free, and so do `renderer/pvp/`, `renderer/data/` and the new `renderer/ui/net-panels.js`: nothing in them may reference `document`, `window`, `localStorage` or `render/*`.
- **Unchanged behaviour:**
  - single-player;
  - the local `pvp` vs-bots mode (`renderer/pvp/local.js`, the sim);
  - private rooms (create / join by code: humans only, closed when the last socket leaves).
  - The sim (`renderer/pvp/sim.js`) is not edited. The existing `test/pvp-*.test.js` must pass unchanged.
- The `host` / `join` title cheats remain, as shortcuts into the same screens.
- **No deploy inside tasks.** The controller deploys after the merge, with the user's go-ahead (see "After merge" at the end).
- Commits end with a `Co-Authored-By:` trailer naming the model that wrote them.
- Run the suite with `npm test`. Two known flakes, both to be re-run rather than chased:
  - a lone SIGSEGV from Node's test runner on WSL;
  - `npc.test.js` "deer never moved".

**Spec readings (ambiguities resolved here; behaviour binding for every task):**
1. **What counts as activity for the idle kick.** The client sends an `input` message 30 times a second even when the player touches nothing, so read literally "no input message" would only catch a closed tab. Activity is therefore:
   - an `input` whose `move`, `attack`, `alt` or `sprint` is non-neutral;
   - or a `class` message.

   The idle timer is held while the match is `waiting` (a lone host in a private room, waiting for a friend) or `ended` (the results screen).
2. **The idle clock** is the room's own tick counter, `idleKickMs` converted to ticks (60 000 ms = 1 800 ticks), so tests "inject" it by stepping the room. `makeLobby({ idleKickMs })` overrides it for tests.
3. **The hello bucket** is spent by every `hello` message, before it is validated. The socket counters count admitted sockets only.
4. **The refusal log** keeps three counters:
   - `rate_limited` (the socket cap and the hello cap);
   - `server_full`;
   - `flood` (the message cap).
5. **Stay / a second Escape** puts back whatever the confirm covered: the death picker, the results table or the wait panel. It uses the latest state, so a death or a match end during the confirm shows once it closes.
6. **The touch layer and text fields.** While a text field is on screen, the touch layer is hidden (`body.menu-typing`), so no stick or pill can sit over the field or swallow its taps.
7. **Error titles:**
   - `idle` → "Removed";
   - `rate_limited` → "Slow down";
   - any other refusal → "Could not host" (host) or "Could not join" (quick, join).
8. **A bot's name** is picked at random (`lobby.opts.random`) among the `botNames` not already used by a hero in the room.
9. **Back** on the name/code entry returns to the Online menu (quick) or the Play-with-friends menu (host/join). It no longer returns to the title.
10. **Service memory.** The final task only *reads* the memory setting. It adds `--memory=512Mi` to `tools/deploy-web.sh` only if the service has less.
11. **What the blocklist covers:** slurs and hard profanity. It leaves out mild oaths that are part of everyday Finnish and English (`perkele`, `saatana`, `helvetti`, `hitto`, `damn`, `hell`, `crap`).

## Review Focus

The five uncovered inputs most likely to bite a player, each pinned by a test in the named task:
1. **A phone on flaky mobile data.** Its link stalls for 2.5 s, then delivers the queued inputs all at once. It must not be closed as a flood → Task 3, "a phone whose link stalled 2.5 s delivers its backlog at once and is not refused".
2. **A household or classroom behind one address.** Four players on one IP join, and each rejoins once within the minute. None of them may be refused → Task 3, "a household behind one IP: four players join, each rejoins once, within a minute".
3. **A private-room host waiting alone** for longer than `idleKickMs` while a friend types the code. They must not be kicked as idle → Task 4, "a lone host waiting in a private room is never idle".
4. **The last human leaving during the results screen.** The room must close, and no bots may be left ticking in it → Task 4, "the last human leaving during the results closes the room".
5. **Joining a public room by the code shown in its HUD.** This must count as a human join, with a bot giving up its seat, and must never be refused as full → Task 4, "joining a public room by its code counts as a human join".

---

## File Structure

| File | Responsibility |
|---|---|
| `renderer/data/net.js` (edit) | protocol v2 and the 4a numbers |
| `renderer/net/protocol.js` (edit) | `ERR.RATE_LIMITED`, `ERR.IDLE`, `validateHello` with `quick` |
| `renderer/net/view.js` (edit) | the new `errorText` lines; `errorTitle`, `controlHint` |
| `server/blocklist.js` (new) | `BLOCKLIST`: hand-curated, normalised stems (server-only) |
| `server/names.js` (new) | `normalizeName`, `acceptableName`, `RESERVED_PREFIXES` |
| `server/limits.js` (new) | token buckets, the per-IP gate, per-socket budgets, `clientIp` |
| `server/rooms.js` (edit) | public rooms, `quickJoin`, `balanceBots`, bot inputs, the idle timer, `drainKicks` |
| `server/pvp-server.js` (edit) | the gate, the budgets, name screening, `quick`, idle kicks, the refusal log |
| `test/net-helpers.js` (edit) | `rawClient(url, { ip })` gives each client its own `X-Forwarded-For` |
| `renderer/ui/net-panels.js` (new) | pure: which in-match panel is up, and the leave confirm over it |
| `renderer/ui/menu.js` (edit) | the Online button, `showOnline`, `showFriends`, `showLeaveConfirm`, phone-friendly text entry, the results' `quitLabel` |
| `renderer/game.js`, `renderer/index.html` (edit) | the flows, the panels, neutral input under the confirm, Escape/START, `body.menu-typing` CSS |
| `test/net-names.test.js`, `test/net-limits.test.js`, `test/net-public-rooms.test.js`, `test/net-public.test.js`, `test/net-panels.test.js` (new) | tests |
| `test/net-protocol.test.js`, `test/net-sim.test.js`, `test/net-ui.test.js`, `test/menu.test.js` (edit) | tests |

Task order: 1 → (2, 3 independent) → 4 → 5 → 6 → 7 → 8.

---

### Task 1: Protocol v2 — `quick`, the new error codes and the 4a numbers

**Files:**
- Modify: `renderer/data/net.js`, `renderer/net/protocol.js`, `renderer/net/view.js`
- Test: `test/net-protocol.test.js`, `test/net-sim.test.js`, `test/net-ui.test.js`

**Interfaces:**
- Produces:
  - `NET.protocolVersion === 2`;
  - `NET.botFill`, `NET.botNames`, `NET.trustProxy`, `NET.maxSockets`, `NET.perIpSockets`, `NET.helloBurst`, `NET.helloPerMin`, `NET.msgBurst`, `NET.msgPerSec`, `NET.classPerSec`, `NET.idleKickMs`, `NET.refusalLogMs`;
  - `ERR.RATE_LIMITED === 'rate_limited'`, `ERR.IDLE === 'idle'`;
  - `validateHello(raw)`, which returns `{ error } | { name, cls, create: true } | { name, cls, quick: true } | { name, cls, room }`;
  - `errorText('rate_limited')` and `errorText('idle')` return the spec's lines.

- [ ] **Step 1: Write the failing tests**

In `test/net-protocol.test.js`, add after the existing `hello` test (inside `describe('names, classes and hello', …)`):

```js
  it('hello v2: quick is a third way in, and exactly one of create/room/quick', () => {
    const base = { type: 'hello', v: NET.protocolVersion, name: 'Aino', cls: 'mage' }
    assert.equal(NET.protocolVersion, 2)
    assert.deepEqual(validateHello({ ...base, quick: true }), { name: 'Aino', cls: 'mage', quick: true })
    assert.deepEqual(validateHello({ ...base, quick: true, create: true }), { error: ERR.BAD_HELLO })
    assert.deepEqual(validateHello({ ...base, quick: true, room: 'KXPT' }), { error: ERR.BAD_HELLO })
    assert.deepEqual(validateHello({ ...base, quick: 'yes' }), { error: ERR.BAD_HELLO })
    assert.deepEqual(validateHello({ ...base, v: 1, quick: true }), { error: ERR.VERSION })
    assert.deepEqual(validateHello({ ...base, room: '', quick: true }), { name: 'Aino', cls: 'mage', quick: true })
  })
  it('the new error codes', () => {
    assert.equal(ERR.RATE_LIMITED, 'rate_limited')
    assert.equal(ERR.IDLE, 'idle')
  })
```

And a new block at the end of the file:

```js
describe('4a numbers', () => {
  it('carries the spec numbers', () => {
    assert.equal(NET.botFill, 4)
    assert.equal(NET.maxHeroes, 6)
    assert.deepEqual(NET.botNames, ['Ukko', 'Ilmatar', 'Tapio', 'Mielikki', 'Ahti', 'Tuoni', 'Louhi', 'Otso', 'Pellervo', 'Kalma', 'Vellamo', 'Hiisi'])
    assert.equal(NET.trustProxy, true)
    assert.equal(NET.maxSockets, 600)
    assert.equal(NET.perIpSockets, 8)
    assert.equal(NET.helloBurst, 10)
    assert.equal(NET.helloPerMin, 10)
    assert.equal(NET.msgBurst, 90)
    assert.equal(NET.msgPerSec, 60)
    assert.equal(NET.classPerSec, 2)
    assert.equal(NET.idleKickMs, 60000)
    assert.equal(NET.refusalLogMs, 60000)
  })
})
```

In `test/net-sim.test.js`, in `describe('NET constants')`, change `assert.equal(NET.protocolVersion, 1)` to `assert.equal(NET.protocolVersion, 2)`.

In `test/net-ui.test.js`, replace the `errorText` test with:

```js
  it('errorText has a line for every error code and a fallback', () => {
    for (const code of ['version', 'no_room', 'room_full', 'bad_name', 'bad_hello', 'server_full', 'rate_limited', 'idle'])
      assert.ok(errorText(code).length > 3, code)
    assert.equal(errorText('rate_limited'), 'Too many attempts — wait a minute and try again.')
    assert.equal(errorText('idle'), 'Removed for inactivity.')
    assert.ok(errorText('???').length > 3)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/net-protocol.test.js test/net-sim.test.js test/net-ui.test.js`
Expected: FAIL. The protocol version is 1, `validateHello` refuses `quick`, the new NET fields are undefined, and there are no `rate_limited`/`idle` lines.

- [ ] **Step 3: Implement**

`renderer/data/net.js`:
- Change the header comment's first line to `// Every netcode number (specs …-pvp-server-netcode-design.md and …-pvp-public-launch-design.md).`
- Change `protocolVersion: 1,` to `protocolVersion: 2,`.
- Append, before the closing `}`:

```js
  // Public launch (4a): public rooms, bots, abuse limits.
  botFill: 4,              // a public room is topped up with bots to this many heroes
  botNames: ['Ukko', 'Ilmatar', 'Tapio', 'Mielikki', 'Ahti', 'Tuoni', 'Louhi', 'Otso', 'Pellervo', 'Kalma', 'Vellamo', 'Hiisi'],
  trustProxy: true,        // clientIp: the last X-Forwarded-For entry (Cloud Run's front end appends the caller)
  maxSockets: 600,         // every open socket on the server
  perIpSockets: 8,         // open sockets per IP
  helloBurst: 10,          // hellos per IP: a bucket of 10…
  helloPerMin: 10,         // …refilling 10 a minute
  msgBurst: 90,            // messages per connection: a bucket of 90…
  msgPerSec: 60,           // …refilling 60 a second (a client sends ~31)
  classPerSec: 2,          // class messages per connection per second; extras are ignored
  idleKickMs: 60000,       // no real input for this long: error idle, and the seat is freed
  refusalLogMs: 60000,     // refusal counts are logged this often, when non-zero
```

`renderer/net/protocol.js`:
- Header: change `PvP protocol v1` to `PvP protocol v2 (v1 in 2026-09-25-pvp-server-netcode-design.md §1; v2 adds hello.quick, 4a spec §1)`.
- Replace `ERR`:

```js
export const ERR = { VERSION: 'version', NO_ROOM: 'no_room', ROOM_FULL: 'room_full',
  BAD_NAME: 'bad_name', BAD_HELLO: 'bad_hello', SERVER_FULL: 'server_full',
  RATE_LIMITED: 'rate_limited', IDLE: 'idle' }
```

- Replace `validateHello`:

```js
// Exactly one way in: { create: true } a private room, { room: CODE } join
// by code, { quick: true } a public room with bot fill (protocol v2).
export function validateHello(raw) {
  if (raw?.v !== NET.protocolVersion) return { error: ERR.VERSION }
  const name = validateName(raw.name)
  if (!name) return { error: ERR.BAD_NAME }
  if (!validateClass(raw.cls)) return { error: ERR.BAD_HELLO }
  const create = raw.create === true
  const quick = raw.quick === true
  const room = typeof raw.room === 'string' ? raw.room.trim().toUpperCase() : null
  if (Number(create) + Number(quick) + Number(!!room) !== 1) return { error: ERR.BAD_HELLO }
  if (create) return { name, cls: raw.cls, create: true }
  if (quick) return { name, cls: raw.cls, quick: true }
  return CODE_RE.test(room) ? { name, cls: raw.cls, room } : { error: ERR.BAD_HELLO }
}
```

`renderer/net/view.js`: add two entries to `ERROR_TEXT`:

```js
  rate_limited: 'Too many attempts — wait a minute and try again.',
  idle: 'Removed for inactivity.',
```

- [ ] **Step 4: Run tests**

Run: `node --test test/net-*.test.js`
Expected: all PASS. The server tests build their hellos from `NET.protocolVersion`, so they follow the bump.

- [ ] **Step 5: Commit**

```bash
git add renderer/data/net.js renderer/net/protocol.js renderer/net/view.js test/net-protocol.test.js test/net-sim.test.js test/net-ui.test.js
git commit -m "feat(net): protocol v2 — hello.quick, rate_limited/idle codes, 4a numbers

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 2: The name screen — `server/names.js` and `server/blocklist.js`

**Files:**
- Create: `server/names.js`, `server/blocklist.js`
- Test: `test/net-names.test.js`

**Interfaces:**
- Produces:
  - `BLOCKLIST: readonly string[]`, a frozen array of 120–200 stems;
  - `normalizeName(name: string) → string`;
  - `acceptableName(name: string) → boolean`;
  - `RESERVED_PREFIXES = ['bot', 'admin', 'mod', 'moderator']`.

- [ ] **Step 1: Write the failing test**

`test/net-names.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BLOCKLIST } from '../server/blocklist.js'
import { normalizeName, acceptableName, RESERVED_PREFIXES } from '../server/names.js'

// Ordinary names and words a substring filter could trip on (the Scunthorpe
// problem). Every one must pass: a stem that hits any of these is too short
// or too generic, so drop it or lengthen it.
const INNOCENT = ['Aino', 'Ilmari', 'Vaino', 'Sam', 'Alex', 'Kalle_99', 'Pasi', 'Kassi', 'Lasse', 'Tassu',
  'Hannu', 'Jussi', 'Matti', 'Pekka', 'Mika', 'Sakari', 'Tuomas', 'Thomas', 'Kasper', 'Sukka', 'Pakila',
  'Vesa', 'Grape', 'Hancock', 'Dickens', 'Spicer', 'Cassandra', 'Essi', 'Titta', 'Kukka', 'Pippa', 'Ninja 7',
  'Shadow', 'Karhu', 'Susi', 'Ahti', 'Ukko', 'Tapio', 'Abbot', 'Tabot', 'Otto', 'Helmi', 'Lumikki', 'Ronja',
  'Peppi', 'Mustikka', 'Kristian', 'Therese', 'Hilkka', 'Raparperi', 'Analyysi', 'Sussex', 'Essex',
  'Arsenal', 'Kalevala', 'Perkele', 'Saatana']

// Each must be refused: the stems themselves, and the tricks normalisation
// exists for (look-alike digits, spacing, underscores, stretched letters,
// a stem inside a longer name).
const REFUSED = ['vittu', 'V1TTU', 'v i t t u', 'Vi_ttu', 'VITTUUU', 'xVittux', 'paska', 'P4sk4', 'kyrpa',
  'mulkku', 'huora', 'neekeri', 'N33k3ri', 'fuck', 'FUUUCK', 'f_u_c_k', 'Fuck3r', 'motherfucker', 'cunt',
  'nigger', 'N1gg3r', 'nigga', 'faggot', 'whore']

describe('normalizeName', () => {
  it('lowercases, drops space _ -, maps look-alike digits and collapses runs', () => {
    assert.equal(normalizeName('V1_t-T u'), 'vitu')
    assert.equal(normalizeName('Kalle_99'), 'kale9')
    assert.equal(normalizeName('0137 45'), 'oietas')
    assert.equal(normalizeName('Aino'), 'aino')
  })
})

describe('BLOCKLIST', () => {
  it('holds 120-200 unique stems, each already normalised and at least 4 letters', () => {
    assert.ok(Object.isFrozen(BLOCKLIST))
    assert.ok(BLOCKLIST.length >= 120 && BLOCKLIST.length <= 200, `${BLOCKLIST.length} stems`)
    assert.equal(new Set(BLOCKLIST).size, BLOCKLIST.length)
    for (const stem of BLOCKLIST) {
      assert.match(stem, /^[a-z]{4,}$/, stem)
      assert.equal(normalizeName(stem), stem, `${stem} is not in normalised form`)
    }
  })
  it('no stem sits inside an ordinary name', () => {
    for (const name of INNOCENT) {
      const n = normalizeName(name)
      for (const stem of BLOCKLIST) assert.ok(!n.includes(stem), `stem "${stem}" hits "${name}"`)
    }
  })
})

describe('acceptableName', () => {
  it('ordinary Finnish and English names pass', () => {
    for (const name of INNOCENT) assert.equal(acceptableName(name), true, name)
  })
  it('slurs and hard profanity are refused, through look-alikes, spacing and stretching', () => {
    for (const name of REFUSED) assert.equal(acceptableName(name), false, name)
  })
  it('names posing as a bot or staff are refused', () => {
    assert.deepEqual(RESERVED_PREFIXES, ['bot', 'admin', 'mod', 'moderator'])
    for (const name of ['Bot', 'Bot Ukko', 'B0t', 'bot_7', 'B o t', 'Admin', '4dmin', 'Mod', 'M0d3rator', 'moderator'])
      assert.equal(acceptableName(name), false, name)
    for (const name of ['Abbot', 'Tabot', 'Ukko']) assert.equal(acceptableName(name), true, name)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/net-names.test.js`
Expected: FAIL, because `server/blocklist.js` and `server/names.js` are not found.

- [ ] **Step 3: Implement `server/names.js`**

```js
// Name screening for public play (4a spec §2). validateName
// (renderer/net/protocol.js) already limits a name to 1-12 of [A-Za-z0-9 _-];
// this is the server-only second gate: no slurs or hard profanity — matched
// as stems through look-alike digits, spacing and stretched letters — and no
// name that poses as a bot or staff. The list lives in server/ and is never
// served to a browser.
import { BLOCKLIST } from './blocklist.js'

const LOOKALIKE = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' }
export const RESERVED_PREFIXES = Object.freeze(['bot', 'admin', 'mod', 'moderator'])

export function normalizeName(name) {
  return String(name).toLowerCase()
    .replace(/[\s_-]/g, '')
    .replace(/[013457]/g, d => LOOKALIKE[d])
    .replace(/(.)\1+/g, '$1')
}

// false → the server answers bad_name, exactly as for a malformed name, so
// the reason is never revealed.
export function acceptableName(name) {
  const n = normalizeName(name)
  if (RESERVED_PREFIXES.some(p => n.startsWith(p))) return false
  return !BLOCKLIST.some(stem => n.includes(stem))
}
```

- [ ] **Step 4: Build `server/blocklist.js`**

The file has this exact shape. The implementer writes the stems. This plan deliberately does not list them.

```js
// Hand-curated stems for acceptableName (server/names.js): slurs and hard
// profanity in Finnish and English. Server-side only — never import this
// from renderer/. Each stem is stored in normalizeName form (lowercase a-z,
// no digits, no doubled letters: "vittu" is stored as "vitu"), is at least 4
// letters, and must not occur inside any name in test/net-names.test.js's
// INNOCENT list. Mild everyday oaths (perkele, saatana, helvetti, hitto,
// damn, hell, crap) are deliberately absent.
export const BLOCKLIST = Object.freeze([
  // — Finnish: slurs —
  // — Finnish: hard profanity and sexual terms —
  // — English: slurs —
  // — English: hard profanity and sexual terms —
])
```

How to fill it (about 150 stems in all):
1. Aim for roughly the following, under the four comment headings, one stem per line, sorted within each group:
   - about 20 Finnish slurs: ethnic, homophobic and ableist;
   - about 40 Finnish hard-profanity and sexual stems;
   - about 50 English slurs: racial and ethnic, homophobic and transphobic, and hard ableist;
   - about 40 English hard-profanity and sexual stems.
2. Write every stem in ASCII. Names are ASCII only, so `ä`/`ö` become `a`/`o` (e.g. the stem for *kyrpä* is `kyrpa`).
3. Store every stem in normalised form: run `normalizeName` over your draft and keep its output. For example, `faggot` is stored as `fagot` and `nigga` as `niga`.
4. Prefer the **shortest stem that is still unambiguous**, so inflections are caught: one stem such as `vitu` covers *vittu*, *vitun* and *vittuun*.
5. Add a separate stem only where normalisation cannot bridge a spelling (e.g. `nigga` → `niga` alongside `nigger` → `niger`).
6. Don't use a generic short stem that the INNOCENT list shows up. `ass`, `anal`, `arse`, `rape`, `cock`, `dick`, `spic`, `paki` and `homo` substrings are all traps; use longer forms such as `rapist`, `cocksucker` and `asshole`.
7. Every word in the test's `REFUSED` list must be caught.

- [ ] **Step 5: Run tests**

Run: `node --test test/net-names.test.js`
Expected: PASS. If "no stem sits inside an ordinary name" fails, the message names the stem and the name. Lengthen or drop the stem; never edit INNOCENT to make a stem fit.

- [ ] **Step 6: Commit**

```bash
git add server/names.js server/blocklist.js test/net-names.test.js
git commit -m "feat(server): name screen — normalised blocklist stems and reserved prefixes

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 3: Abuse limits — `server/limits.js`

**Files:**
- Create: `server/limits.js`
- Test: `test/net-limits.test.js`

**Interfaces:**
- Consumes: `NET` fields (Task 1); `ERR.RATE_LIMITED`, `ERR.SERVER_FULL`.
- Produces. Every time `t` is in milliseconds and supplied by the caller:
  - `makeBucket(capacity, perMs, t) → bucket`, `take(bucket, t) → boolean`, `bucketFull(bucket, t) → boolean`;
  - `makeGate() → { ips: Map<ip, { sockets, hello: bucket }>, total, refused: { rate_limited, server_full, flood } }`;
  - `admit(gate, ip, t) → null | 'rate_limited' | 'server_full'`, which counts the socket only when admitted;
  - `release(gate, ip)`;
  - `takeHello(gate, ip, t) → boolean`;
  - `noteFlood(gate)`;
  - `sweepGate(gate, t) → { rate_limited, server_full, flood }`, which returns the counts and resets them, and forgets idle IPs;
  - `makeConnLimits(t) → { msg, cls }`, `allowMessage(conn, t) → boolean`, `allowClass(conn, t) → boolean`;
  - `clientIp(req, trustProxy = NET.trustProxy) → string`.

- [ ] **Step 1: Write the failing test**

`test/net-limits.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeBucket, take, bucketFull, makeGate, admit, release, takeHello, noteFlood, sweepGate,
  makeConnLimits, allowMessage, allowClass, clientIp } from '../server/limits.js'
import { ERR } from '../renderer/net/protocol.js'
import { NET } from '../renderer/data/net.js'

describe('token bucket', () => {
  it('spends up to capacity at once, then refills at its rate, never above capacity', () => {
    const b = makeBucket(3, 1 / 1000, 0)                 // 3 tokens, one a second
    for (let i = 0; i < 3; i++) assert.equal(take(b, 0), true)
    assert.equal(take(b, 0), false)
    assert.equal(take(b, 500), false)
    assert.equal(take(b, 1500), true)
    assert.equal(bucketFull(b, 1_000_000), true)
    assert.equal(b.tokens, 3)
  })
  it('a clock that steps back refills nothing', () => {
    const b = makeBucket(1, 1, 100)
    assert.equal(take(b, 100), true)
    assert.equal(take(b, 50), false)
  })
})

describe('the per-IP gate', () => {
  it('8 open sockets per IP; the 9th is rate_limited; another IP is unaffected; a release frees a slot', () => {
    const g = makeGate()
    for (let i = 0; i < NET.perIpSockets; i++) assert.equal(admit(g, 'A', 0), null)
    assert.equal(admit(g, 'A', 0), ERR.RATE_LIMITED)
    assert.equal(admit(g, 'B', 0), null)
    release(g, 'A')
    assert.equal(admit(g, 'A', 0), null)
    assert.equal(g.total, NET.perIpSockets + 1)
  })
  it('600 sockets in total, then server_full', () => {
    const g = makeGate()
    for (let i = 0; i < NET.maxSockets; i++) assert.equal(admit(g, `ip${i}`, 0), null)
    assert.equal(admit(g, 'late', 0), ERR.SERVER_FULL)
    assert.equal(g.total, NET.maxSockets)
  })
  it('release of an unknown or empty IP changes nothing', () => {
    const g = makeGate()
    release(g, 'nobody')
    admit(g, 'A', 0); release(g, 'A'); release(g, 'A')
    assert.equal(g.total, 0)
  })
  it('10 hellos per IP at once, then one more every 6 s', () => {
    const g = makeGate()
    admit(g, 'A', 0)
    for (let i = 0; i < NET.helloBurst; i++) assert.equal(takeHello(g, 'A', 0), true)
    assert.equal(takeHello(g, 'A', 0), false)
    assert.equal(takeHello(g, 'A', 5999), false)
    assert.equal(takeHello(g, 'A', 6001), true)
    assert.equal(takeHello(g, 'never-admitted', 0), false)
  })
  it('a household behind one IP: four players join, each rejoins once, within a minute', () => {
    const g = makeGate()
    for (let i = 0; i < 4; i++) { assert.equal(admit(g, 'home', 0), null); assert.equal(takeHello(g, 'home', 0), true) }
    for (let i = 0; i < 4; i++) {
      release(g, 'home')
      assert.equal(admit(g, 'home', 30000), null)
      assert.equal(takeHello(g, 'home', 30000), true)
    }
    assert.equal(g.ips.get('home').sockets, 4)
  })
  it('sweepGate forgets an IP once it has no sockets and a full hello bucket, and hands back only counts', () => {
    const g = makeGate()
    admit(g, '203.0.113.9', 0); takeHello(g, '203.0.113.9', 0)
    for (let i = 0; i < NET.perIpSockets + 1; i++) admit(g, 'X', 0)   // the last one is refused
    noteFlood(g)
    release(g, '203.0.113.9')
    assert.deepEqual(sweepGate(g, 1000), { rate_limited: 1, server_full: 0, flood: 1 })
    assert.equal(g.ips.has('203.0.113.9'), true)     // its hello bucket is not full again yet
    sweepGate(g, 7000)
    assert.equal(g.ips.has('203.0.113.9'), false)
    assert.equal(g.ips.has('X'), true)               // still has sockets
    assert.deepEqual(sweepGate(g, 8000), { rate_limited: 0, server_full: 0, flood: 0 })
  })
})

describe('per-connection budgets', () => {
  it('90 messages at once, then about 60 a second', () => {
    const c = makeConnLimits(0)
    for (let i = 0; i < NET.msgBurst; i++) assert.equal(allowMessage(c, 0), true)
    assert.equal(allowMessage(c, 0), false)
    let ok = 0
    for (let i = 0; i < 100; i++) if (allowMessage(c, 1000)) ok++
    assert.ok(Math.abs(ok - NET.msgPerSec) <= 1, `${ok}`)   // ±1 for float rounding in the refill
  })
  it('a phone whose link stalled 2.5 s delivers its backlog at once and is not refused', () => {
    const c = makeConnLimits(0)
    for (let t = 0; t < 1000; t += 1000 / 30) assert.equal(allowMessage(c, t), true)   // a second of normal play
    for (let i = 0; i < 77; i++) assert.equal(allowMessage(c, 3500), true)            // 75 inputs + 2 pings, all at once
  })
  it('class: 2 at once, extras refused until the bucket refills', () => {
    const c = makeConnLimits(0)
    assert.equal(allowClass(c, 0), true)
    assert.equal(allowClass(c, 0), true)
    assert.equal(allowClass(c, 0), false)
    assert.equal(allowClass(c, 600), true)
  })
})

describe('clientIp', () => {
  const req = (xff, addr = '10.0.0.5') => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: addr } })
  it('behind the proxy: the last X-Forwarded-For entry', () => {
    assert.equal(clientIp(req('1.2.3.4, 198.51.100.7'), true), '198.51.100.7')
    assert.equal(clientIp(req(' 198.51.100.7 '), true), '198.51.100.7')
  })
  it('without the header, with an empty last entry, or with trustProxy off: the socket address', () => {
    assert.equal(clientIp(req(undefined), true), '10.0.0.5')
    assert.equal(clientIp(req(''), true), '10.0.0.5')
    assert.equal(clientIp(req('1.2.3.4, '), true), '10.0.0.5')
    assert.equal(clientIp(req('1.2.3.4'), false), '10.0.0.5')
  })
  it('defaults to NET.trustProxy', () => {
    assert.equal(clientIp(req('198.51.100.7')), '198.51.100.7')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/net-limits.test.js`
Expected: FAIL, because `server/limits.js` is not found.

- [ ] **Step 3: Implement**

`server/limits.js`:

```js
// Abuse limits for the public server (4a spec §2): token buckets with an
// injected clock, the per-IP gate (open sockets, hello rate), the per-socket
// message and class budgets, and the caller's address. Pure — no sockets, no
// timers; server/pvp-server.js calls in with `t` = its clock in ms.
//
// Privacy: IP addresses live only in gate.ips, only for these counters, and
// sweepGate drops an entry once it has no sockets and a full hello bucket.
// Nothing in this module logs, and sweepGate hands back counts, never keys.
import { NET } from '../renderer/data/net.js'
import { ERR } from '../renderer/net/protocol.js'

export const makeBucket = (capacity, perMs, t) => ({ capacity, perMs, tokens: capacity, at: t })

// A clock that steps back refills nothing (and never drains a token).
function refill(b, t) {
  if (t <= b.at) return
  b.tokens = Math.min(b.capacity, b.tokens + (t - b.at) * b.perMs)
  b.at = t
}

export function take(b, t) {
  refill(b, t)
  if (b.tokens < 1) return false
  b.tokens -= 1
  return true
}

export function bucketFull(b, t) {
  refill(b, t)
  return b.tokens >= b.capacity
}

const noRefusals = () => ({ rate_limited: 0, server_full: 0, flood: 0 })
const helloBucket = t => makeBucket(NET.helloBurst, NET.helloPerMin / 60000, t)

export const makeGate = () => ({ ips: new Map(), total: 0, refused: noRefusals() })

// A new socket: null when admitted (and counted), else the error code to
// send before closing it. A refused socket is not counted, so its close must
// not release().
export function admit(gate, ip, t) {
  if (gate.total >= NET.maxSockets) { gate.refused.server_full++; return ERR.SERVER_FULL }
  let e = gate.ips.get(ip)
  if (e && e.sockets >= NET.perIpSockets) { gate.refused.rate_limited++; return ERR.RATE_LIMITED }
  if (!e) gate.ips.set(ip, e = { sockets: 0, hello: helloBucket(t) })
  e.sockets++
  gate.total++
  return null
}

export function release(gate, ip) {
  const e = gate.ips.get(ip)
  if (!e || e.sockets === 0) return
  e.sockets--
  gate.total--
}

// Every hello message spends one, before it is validated.
export function takeHello(gate, ip, t) {
  const e = gate.ips.get(ip)
  if (e && take(e.hello, t)) return true
  gate.refused.rate_limited++
  return false
}

export function noteFlood(gate) { gate.refused.flood++ }

export function sweepGate(gate, t) {
  for (const [ip, e] of gate.ips) if (e.sockets === 0 && bucketFull(e.hello, t)) gate.ips.delete(ip)
  const counts = gate.refused
  gate.refused = noRefusals()
  return counts
}

export const makeConnLimits = t => ({
  msg: makeBucket(NET.msgBurst, NET.msgPerSec / 1000, t),
  cls: makeBucket(NET.classPerSec, NET.classPerSec / 1000, t),
})
export const allowMessage = (conn, t) => take(conn.msg, t)
export const allowClass = (conn, t) => take(conn.cls, t)

// Behind Cloud Run the caller is the last X-Forwarded-For entry (Google's
// front end appends the address it saw); anything earlier is client-supplied
// and spoofable. Without the header — or with trustProxy off — the socket's
// own address.
export function clientIp(req, trustProxy = NET.trustProxy) {
  if (trustProxy) {
    const xff = req.headers?.['x-forwarded-for']
    const last = typeof xff === 'string' ? xff.split(',').at(-1).trim() : ''
    if (last) return last
  }
  return req.socket?.remoteAddress ?? 'unknown'
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/net-limits.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/limits.js test/net-limits.test.js
git commit -m "feat(server): token-bucket limits — per-IP gate, per-socket budgets, clientIp

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 4: Public rooms, quick-join, bot fill and the idle timer — `server/rooms.js`

**Files:**
- Modify: `server/rooms.js`
- Test: `test/net-public-rooms.test.js` (new); `test/net-rooms.test.js` must keep passing unchanged

**Interfaces:**
- Consumes:
  - `botInput(match, hero)` (renderer/pvp/bots.js);
  - `addHero`, `removeHero` (sim.js);
  - `CLASSES` (data/pvp.js);
  - `NET.botFill`, `NET.botNames`, `NET.idleKickMs` (Task 1).
- Produces:
  - `makeLobby({ random, rewind, matchLength, resultsDelay, idleKickMs = NET.idleKickMs })`;
  - `lobby.serial` (a creation counter);
  - `createRoom(lobby, { name, cls, public = false }) → { room, heroId } | { error }`. The room has `public`, `serial`, `bots: string[]` (ids in the order they were added), `nextBot`, `kicks: string[]`;
  - `joinRoom(lobby, code, { name, cls })`, which is full at `room.players.size >= NET.maxHeroes` and rebalances bots;
  - `quickJoin(lobby, { name, cls }) → { room, heroId } | { error }`;
  - `balanceBots(lobby, room)`;
  - `leaveRoom(lobby, room, heroId)`, now idempotent: it closes the room at 0 humans and rebalances otherwise;
  - `setRoomClass(room, heroId, cls)`, which also marks the human active;
  - `queueInput`, which marks the human active on a non-neutral input;
  - `stepRoom`, which gives every bot `botInput` and pushes idle heroIds onto `room.kicks` once each;
  - `drainKicks(room) → string[]`.

- [ ] **Step 1: Write the failing test**

`test/net-public-rooms.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeLobby, createRoom, joinRoom, leaveRoom, quickJoin, balanceBots, queueInput, setRoomClass,
  stepRoom, drainKicks } from '../server/rooms.js'
import { removeHero } from '../renderer/pvp/sim.js'
import { grantRune } from '../renderer/pvp/pickups.js'
import { ERR } from '../renderer/net/protocol.js'
import { NET } from '../renderer/data/net.js'

const who = (name, cls = 'archer') => ({ name, cls })
const input = (seq, over = {}) => ({ seq, view: 0, move: { x: 0, y: 0 }, facing: null, attack: false, alt: false, sprint: false, ...over })
const steps = (lobby, room, n) => { for (let i = 0; i < n; i++) stepRoom(lobby, room) }
const botsOf = room => room.match.heroes.filter(h => room.bots.includes(h.id))
const humansOf = room => room.match.heroes.filter(h => room.players.has(h.id))
const pub = (opts) => { const lobby = makeLobby(opts); const { room } = quickJoin(lobby, who('A')); return { lobby, room } }

describe('quickJoin', () => {
  it('with no public room, creates one: public, the human is p1, bots fill it to NET.botFill', () => {
    const { room } = pub()
    assert.equal(room.public, true)
    assert.equal(room.players.size, 1)
    assert.ok(room.players.has('p1'))
    assert.equal(room.match.heroes.length, NET.botFill)
    assert.deepEqual(room.bots, ['b1', 'b2', 'b3'])
  })
  it('never picks a private room', () => {
    const lobby = makeLobby()
    const priv = createRoom(lobby, who('A')).room
    const { room } = quickJoin(lobby, who('B'))
    assert.notEqual(room, priv)
    assert.equal(priv.public, false)
    assert.equal(priv.match.heroes.length, 1)
  })
  it('picks the public room with the most humans; a tie goes to the oldest', () => {
    const lobby = makeLobby()
    const older = createRoom(lobby, { ...who('A'), public: true }).room
    const newer = createRoom(lobby, { ...who('B'), public: true }).room
    assert.equal(quickJoin(lobby, who('C')).room, older)                          // 1 vs 1: the older
    joinRoom(lobby, newer.code, who('D')); joinRoom(lobby, newer.code, who('E'))  // newer 3, older 2
    assert.equal(quickJoin(lobby, who('F')).room, newer)
  })
  it('a room with NET.maxHeroes humans is skipped', () => {
    const lobby = makeLobby()
    const full = createRoom(lobby, { ...who('A'), public: true }).room
    for (let i = 1; i < NET.maxHeroes; i++) joinRoom(lobby, full.code, who('X'))
    assert.equal(full.players.size, NET.maxHeroes)
    assert.notEqual(quickJoin(lobby, who('B')).room, full)
  })
  it('server_full when a new room is needed past maxRooms', () => {
    const lobby = makeLobby()
    for (let i = 0; i < NET.maxRooms; i++) createRoom(lobby, who('A'))
    assert.deepEqual(quickJoin(lobby, who('B')), { error: ERR.SERVER_FULL })
  })
})

describe('balanceBots', () => {
  it('1 human → 3 bots; a second human replaces a bot; four humans → no bots; up to six', () => {
    const { lobby, room } = pub()
    assert.equal(quickJoin(lobby, who('B')).room, room)
    assert.deepEqual([humansOf(room).length, botsOf(room).length], [2, 2])
    joinRoom(lobby, room.code, who('C')); joinRoom(lobby, room.code, who('D'))
    assert.deepEqual([humansOf(room).length, botsOf(room).length], [4, 0])
    joinRoom(lobby, room.code, who('E')); joinRoom(lobby, room.code, who('F'))
    assert.equal(room.match.heroes.length, 6)
    assert.deepEqual(joinRoom(lobby, room.code, who('G')), { error: ERR.ROOM_FULL })
  })
  it('the most recently added bot leaves first', () => {
    const { lobby, room } = pub()
    quickJoin(lobby, who('B'))
    assert.deepEqual(room.bots, ['b1', 'b2'])
    assert.deepEqual(botsOf(room).map(h => h.id).sort(), ['b1', 'b2'])
  })
  it('a leaving human brings a bot back, with a fresh id', () => {
    const { lobby, room } = pub()
    const { heroId } = quickJoin(lobby, who('B'))
    leaveRoom(lobby, room, heroId)
    assert.deepEqual(room.bots, ['b1', 'b2', 'b4'])
    assert.equal(room.match.heroes.length, NET.botFill)
  })
  it('the last human out closes the room; bots never keep it', () => {
    const { lobby, room } = pub()
    leaveRoom(lobby, room, 'p1')
    assert.equal(lobby.rooms.size, 0)
  })
  it('the last human leaving during the results closes the room', () => {
    const { lobby, room } = pub({ matchLength: 1, resultsDelay: 0.5 })
    steps(lobby, room, 32)
    assert.equal(room.match.ended, true)
    leaveRoom(lobby, room, 'p1')
    assert.equal(lobby.rooms.size, 0)
    assert.equal(room.players.size, 0)
  })
  it('leaveRoom twice is harmless', () => {
    const { lobby, room } = pub()
    const { heroId } = quickJoin(lobby, who('B'))
    leaveRoom(lobby, room, heroId)
    leaveRoom(lobby, room, heroId)
    assert.deepEqual(room.bots, ['b1', 'b2', 'b4'])
    assert.equal(lobby.rooms.size, 1)
  })
  it('joining a public room by its code counts as a human join: a bot gives up its seat', () => {
    const { lobby, room } = pub()
    const { heroId } = joinRoom(lobby, room.code, who('B'))
    assert.equal(heroId, 'p2')
    assert.equal(botsOf(room).length, 2)
    assert.equal(room.match.heroes.length, NET.botFill)
  })
  it('a new match rebalances', () => {
    const { lobby, room } = pub({ matchLength: 1, resultsDelay: 0.5 })
    steps(lobby, room, 32)
    assert.equal(room.match.ended, true)
    removeHero(room.match, room.bots.pop())          // a seat lost without a rebalance
    assert.equal(room.match.heroes.length, 3)
    steps(lobby, room, 20)
    assert.equal(room.match.ended, false)
    assert.equal(room.match.heroes.length, NET.botFill)
    assert.deepEqual(room.bots, ['b1', 'b2', 'b4'])
  })
  it("a removed bot's rune goes back on its pedestal", () => {
    const { lobby, room } = pub()
    const rune = room.match.pickups.find(p => p.kind === 'rune')
    rune.up = false; rune.t = 50
    grantRune(room.match, room.match.heroes.find(h => h.id === 'b3'))
    quickJoin(lobby, who('B'))
    assert.equal(room.match.heroes.some(h => h.id === 'b3'), false)
    assert.equal(rune.up, true)
  })
  it('bot names are "Bot " + a NET.botNames name, unique in the room', () => {
    const { room } = pub()
    const names = botsOf(room).map(h => h.name)
    for (const n of names) assert.ok(n.startsWith('Bot ') && NET.botNames.includes(n.slice(4)), n)
    assert.equal(new Set(names).size, names.length)
  })
  it('bot classes go to the least represented class, ties in CLASSES order', () => {
    const lobby = makeLobby()
    const { room } = quickJoin(lobby, who('A', 'archer'))
    assert.deepEqual(botsOf(room).map(h => h.cls), ['warrior', 'mage', 'warrior'])
  })
  it('private rooms never get bots', () => {
    const lobby = makeLobby()
    const { room } = createRoom(lobby, who('A'))
    balanceBots(lobby, room)
    joinRoom(lobby, room.code, who('B'))
    leaveRoom(lobby, room, 'p2')
    assert.deepEqual(room.bots, [])
    assert.equal(room.match.heroes.length, 1)
  })
  it('bots play: each gets botInput every tick', () => {
    const { lobby, room } = pub()
    const before = botsOf(room).map(h => `${h.px},${h.py}`)
    steps(lobby, room, 90)
    const after = botsOf(room).map(h => `${h.px},${h.py}`)
    assert.ok(after.some((p, i) => p !== before[i]))
  })
})

describe('the idle timer', () => {
  const idleLobby = () => makeLobby({ idleKickMs: 1000 })     // 30 ticks
  it('a human with no real input for idleKickMs is kicked once; neutral inputs do not count', () => {
    const lobby = idleLobby()
    const { room } = quickJoin(lobby, who('A'))
    for (let i = 1; i <= 29; i++) { queueInput(room, 'p1', input(i)); stepRoom(lobby, room) }
    assert.deepEqual(drainKicks(room), [])
    queueInput(room, 'p1', input(30)); stepRoom(lobby, room)
    assert.deepEqual(drainKicks(room), ['p1'])
    steps(lobby, room, 5)
    assert.deepEqual(drainKicks(room), [])
  })
  it('moving, attacking or picking a class keeps a human in', () => {
    const lobby = idleLobby()
    const { room } = quickJoin(lobby, who('A'))
    steps(lobby, room, 20); queueInput(room, 'p1', input(1, { move: { x: 1, y: 0 } }))
    steps(lobby, room, 20); queueInput(room, 'p1', input(2, { attack: true }))
    steps(lobby, room, 20); setRoomClass(room, 'p1', 'mage')
    steps(lobby, room, 20)
    assert.deepEqual(drainKicks(room), [])
  })
  it('a lone host waiting in a private room is never idle (the clock is not running)', () => {
    const lobby = idleLobby()
    const { room } = createRoom(lobby, who('A'))
    steps(lobby, room, 120)
    assert.deepEqual(drainKicks(room), [])
    joinRoom(lobby, room.code, who('B'))
    steps(lobby, room, 31)
    assert.deepEqual(drainKicks(room).sort(), ['p1', 'p2'])
  })
  it('the results screen holds the timer', () => {
    const lobby = makeLobby({ idleKickMs: 1000, matchLength: 0.5, resultsDelay: 3 })
    const { room } = quickJoin(lobby, who('A'))
    queueInput(room, 'p1', input(1, { move: { x: 1, y: 0 } }))
    steps(lobby, room, 16)
    assert.equal(room.match.ended, true)
    steps(lobby, room, 60)                                // 2 s of results, well past 30 ticks
    assert.deepEqual(drainKicks(room), [])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/net-public-rooms.test.js`
Expected: FAIL, because `quickJoin`, `balanceBots` and `drainKicks` are not exported.

- [ ] **Step 3: Implement**

In `server/rooms.js`:

Update the header comment's first two lines to:

```js
// PvP rooms (spec §3; public rooms, bots and the idle timer from the 4a
// spec §1-§2): codes, the input queue per player, one simulated tick at a
// time, the position history melee rewinds into, and the next match after
// the results. Pure — no sockets; server/pvp-server.js drives it.
```

Replace the imports:

```js
import { makeMatch, stepMatch, addHero, removeHero, setClass } from '../renderer/pvp/sim.js'
import { heroById } from '../renderer/pvp/combat.js'
import { NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { botInput } from '../renderer/pvp/bots.js'
import { makeSfx, drainSfx } from '../renderer/systems/sfx.js'
import { snapshotBody, ERR } from '../renderer/net/protocol.js'
import { PVP, CLASSES } from '../renderer/data/pvp.js'
import { NET } from '../renderer/data/net.js'
```

Replace `makeLobby`:

```js
export function makeLobby({ random = Math.random, rewind = true, matchLength = PVP.matchLength,
  resultsDelay = NET.resultsDelay, idleKickMs = NET.idleKickMs } = {}) {
  return { rooms: new Map(), serial: 0, opts: { random, rewind, matchLength, resultsDelay, idleKickMs } }
}
```

Replace `freshPlayer`, `createRoom`, `joinRoom` and `leaveRoom`, and add `quickJoin`, `balanceBots` and their helpers:

```js
// activeTick: the room tick of this human's last real input (a move,
// attack, alt or sprint) or class pick — what the idle timer measures.
const freshPlayer = room => ({ queue: [], last: NEUTRAL_INPUT, lastInputTick: room.match.tick, ack: 0,
  activeTick: room.tick, kicked: false })

// public: a quick-join room with bot fill; private (the default): humans
// only, reached by code.
export function createRoom(lobby, { name, cls, public: isPublic = false }) {
  if (lobby.rooms.size >= NET.maxRooms) return { error: ERR.SERVER_FULL }
  const room = { code: newCode(lobby), public: isPublic, serial: lobby.serial++, nextId: 1, nextBot: 1,
    bots: [], kicks: [], tick: 0, match: null, players: new Map(), history: new Map(),
    pendingEvents: [], pendingCues: [], nextMatchAt: null }
  const heroId = `p${room.nextId++}`
  room.match = newMatch(lobby, room, [{ id: heroId, name, cls }])
  room.players.set(heroId, freshPlayer(room))
  lobby.rooms.set(room.code, room)
  balanceBots(lobby, room)
  return { room, heroId }
}

// By code — private or public. In a public room a bot gives up its seat.
// A public room below NET.botFill humans holds exactly NET.botFill heroes,
// and one at or above it holds only humans, so the new hero always has a
// spawn (≤ NET.maxHeroes).
export function joinRoom(lobby, code, { name, cls }) {
  const room = lobby.rooms.get(code)
  if (!room) return { error: ERR.NO_ROOM }
  if (room.players.size >= NET.maxHeroes) return { error: ERR.ROOM_FULL }
  const heroId = `p${room.nextId++}`
  addHero(room.match, { id: heroId, name, cls })
  room.players.set(heroId, freshPlayer(room))
  balanceBots(lobby, room)
  return { room, heroId }
}

// The public room with the most humans that still has a seat, the oldest on
// a tie; with none, a new public room.
export function quickJoin(lobby, { name, cls }) {
  let best = null
  for (const room of lobby.rooms.values()) {
    if (!room.public || room.players.size >= NET.maxHeroes) continue
    if (!best || room.players.size > best.players.size ||
        (room.players.size === best.players.size && room.serial < best.serial)) best = room
  }
  return best ? joinRoom(lobby, best.code, { name, cls }) : createRoom(lobby, { name, cls, public: true })
}

// Idempotent: a socket's close after an idle kick already removed it is a no-op.
export function leaveRoom(lobby, room, heroId) {
  if (!room.players.has(heroId)) return
  removeHero(room.match, heroId)
  room.players.delete(heroId)
  room.history.delete(heroId)
  if (room.players.size === 0) lobby.rooms.delete(room.code)   // bots never keep a room alive
  else balanceBots(lobby, room)
}

function botName(lobby, room) {
  const taken = new Set(room.match.heroes.map(h => h.name))
  const free = NET.botNames.map(n => `Bot ${n}`).filter(n => !taken.has(n))
  return free.length ? free[Math.floor(lobby.opts.random() * free.length) % free.length] : `Bot ${room.nextBot}`
}

// The class fewest heroes are playing, ties in CLASSES order.
function botClass(room) {
  const count = Object.fromEntries(CLASSES.map(c => [c, 0]))
  for (const h of room.match.heroes) if (h.cls in count) count[h.cls]++
  return CLASSES.reduce((best, c) => (count[c] < count[best] ? c : best), CLASSES[0])
}

// Public rooms only: top the room up to max(NET.botFill, humans) heroes with
// bots (farthest spawn, spawn protection — addHero), or send the most
// recently added bots home (removeHero returns a rune they held).
export function balanceBots(lobby, room) {
  if (!room.public) return
  const { match } = room
  const target = Math.max(NET.botFill, room.players.size)
  while (match.heroes.length < target && match.heroes.length < match.arena.spawns.length) {
    const id = `b${room.nextBot++}`
    addHero(match, { id, name: botName(lobby, room), cls: botClass(room) })
    room.bots.push(id)
  }
  while (match.heroes.length > target && room.bots.length) {
    const id = room.bots.pop()
    removeHero(match, id)
    room.history.delete(id)
  }
}
```

Replace `queueInput` and `setRoomClass`:

```js
const isActive = input => !!(input.move?.x || input.move?.y || input.attack || input.alt || input.sprint)

export function queueInput(room, heroId, input) {
  const p = room.players.get(heroId)
  if (!p) return
  p.queue.push(input)
  if (p.queue.length > NET.inputQueueMax) p.queue.shift()
  p.lastInputTick = room.match.tick
  if (isActive(input)) p.activeTick = room.tick
}

export function setRoomClass(room, heroId, cls) {
  setClass(room.match, heroId, cls)
  const p = room.players.get(heroId)
  if (p) p.activeTick = room.tick
}
```

In `startNextMatch`, after `room.nextMatchAt = null`, add:

```js
  balanceBots(lobby, room)
```

In `stepRoom`, change the `if (!match.ended) {` block to feed the bots first:

```js
  if (!match.ended) {
    for (const id of room.bots) {
      const hero = heroById(match, id)
      if (hero) inputs[id] = botInput(match, hero)
    }
    const events = stepMatch(match, inputs, PVP.tick)
    recordHistory(room)
    room.pendingEvents.push(...events)
    if (events.some(e => e.type === 'matchEnd')) room.nextMatchAt = room.tick + Math.round(lobby.opts.resultsDelay / PVP.tick)
  }
```

In `stepRoom`, right after `room.tick++`, add `checkIdle(lobby, room)`. Then define, above `stepRoom`:

```js
// A human with no real input for idleKickMs is queued on room.kicks, once;
// the socket layer sends error idle and frees the seat. The timer is held
// while the match waits for a second hero (a lone private host) and while
// the results are up.
function checkIdle(lobby, room) {
  const limit = Math.round(lobby.opts.idleKickMs / 1000 / PVP.tick)
  const holding = room.match.waiting || room.match.ended
  for (const [id, p] of room.players) {
    if (holding) p.activeTick = room.tick
    else if (!p.kicked && room.tick - p.activeTick >= limit) { p.kicked = true; room.kicks.push(id) }
  }
}

export function drainKicks(room) {
  const k = room.kicks
  room.kicks = []
  return k
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/net-*.test.js`
Expected: all PASS. `net-rooms.test.js` is unchanged; private rooms behave as before.

- [ ] **Step 5: Commit**

```bash
git add server/rooms.js test/net-public-rooms.test.js
git commit -m "feat(server): public rooms — quickJoin, bot fill with botInput, idle timer

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 5: The socket layer — limits, name screening, quick-join, idle kicks, the refusal log

**Files:**
- Modify: `server/pvp-server.js`, `test/net-helpers.js`
- Test: `test/net-public.test.js` (new); `test/net-server.test.js` and `test/net-play.test.js` must keep passing

**Interfaces:**
- Consumes:
  - Task 2: `acceptableName`;
  - Task 3: `makeGate`, `admit`, `release`, `takeHello`, `noteFlood`, `sweepGate`, `makeConnLimits`, `allowMessage`, `allowClass`, `clientIp`;
  - Task 4: `quickJoin`, `drainKicks`, the idempotent `leaveRoom`.
- Produces:
  - `attachPvp(httpServer, { path, heartbeatMs, helloTimeoutMs, trustProxy = NET.trustProxy, refusalLogMs = NET.refusalLogMs, log = console.log, now = () => performance.now(), ...lobbyOpts })`, where `lobbyOpts` includes `idleKickMs`;
  - `rawClient(url, { ip } = {})` in the test helpers. It gives each client its own `X-Forwarded-For`; `{ ip: null }` sends none.

- [ ] **Step 1: Give each test client its own address**

In `test/net-helpers.js`, replace `rawClient`'s first two lines (the doc comment and the `export async function rawClient(url) {` / `const ws = new WebSocket(url)` lines) with:

```js
// Each raw client comes from its own made-up address, via X-Forwarded-For,
// which the server trusts by default, so a test file's many sockets never
// trip the per-IP limits. Pass { ip } to pin one, or { ip: null } for none.
let ipSeq = 0
const nextIp = () => { const n = ipSeq++; return `10.9.${(n >> 8) & 255}.${n & 255}` }

// A bare socket speaking the protocol by hand — for the server tests.
export async function rawClient(url, { ip = nextIp() } = {}) {
  const ws = new WebSocket(url, ip ? { headers: { 'x-forwarded-for': ip } } : undefined)
```

The rest of `rawClient` stays as it is.

- [ ] **Step 2: Write the failing test**

`test/net-public.test.js`:

```js
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, rawClient, waitFor, sleep } from './net-helpers.js'
import { NET } from '../renderer/data/net.js'

const hello = (over = {}) => ({ type: 'hello', v: NET.protocolVersion, name: 'Aino', cls: 'archer', ...over })
const move = seq => ({ type: 'input', seq, view: 0, move: { x: seq % 2 ? 1 : -1, y: 0 }, facing: null, attack: false, alt: false, sprint: false })
const botsIn = snap => snap.heroes.filter(h => h.name.startsWith('Bot '))

describe('public rooms over sockets', async () => {
  const srv = await startServer()
  after(() => srv.close())

  it('a lone quick-join gets a running match with three bots; a second lands in the same room and a bot leaves', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ quick: true }))
    const w = await a.next('welcome')
    const s = await waitFor(() => a.last('snap')?.heroes.length === NET.botFill && a.last('snap'))
    assert.equal(botsIn(s).length, 3)
    assert.equal(s.waiting, false)
    await waitFor(() => a.last('snap').clock > 0)
    const b = await rawClient(srv.url)
    b.send(hello({ quick: true, name: 'Ilmari' }))
    assert.equal((await b.next('welcome')).room, w.room)
    await waitFor(() => { const t = a.last('snap'); return t.heroes.length === NET.botFill && botsIn(t).length === 2 })
    a.ws.close(); b.ws.close()
    await waitFor(() => srv.pvp.lobby.rooms.size === 0)
  })

  it('a private room never has bots', async () => {
    const a = await rawClient(srv.url)
    a.send(hello({ create: true }))
    await a.next('welcome')
    await sleep(300)
    assert.equal(a.last('snap').heroes.length, 1)
    a.ws.close()
    await waitFor(() => srv.pvp.lobby.rooms.size === 0)
  })

  it('a blocked or reserved name is refused as bad_name, like a malformed one', async () => {
    for (const name of ['Bot Ukko', 'V1ttu', 'Admin']) {
      const c = await rawClient(srv.url)
      c.send(hello({ quick: true, name }))
      assert.equal((await c.next('error')).code, 'bad_name')
      await waitFor(() => c.closed !== null)
    }
  })

  it('the 9th socket from one IP is refused with rate_limited; another IP still gets in', async () => {
    const ip = '198.51.100.9'
    const open = []
    for (let i = 0; i < NET.perIpSockets; i++) open.push(await rawClient(srv.url, { ip }))
    const ninth = await rawClient(srv.url, { ip })
    assert.equal((await ninth.next('error')).code, 'rate_limited')
    await waitFor(() => ninth.closed !== null)
    const other = await rawClient(srv.url, { ip: '198.51.100.10' })
    other.send(hello({ create: true }))
    await other.next('welcome')
    for (const c of [...open, other]) c.ws.close()
  })

  it('the 11th hello from one IP inside a minute is refused with rate_limited', async () => {
    const ip = '198.51.100.11'
    for (let i = 0; i < NET.helloBurst; i++) {
      const c = await rawClient(srv.url, { ip })
      c.send(hello({ create: true }))
      await c.next('welcome')
      c.ws.close()
      await waitFor(() => c.closed !== null)
    }
    const late = await rawClient(srv.url, { ip })
    late.send(hello({ create: true }))
    assert.equal((await late.next('error')).code, 'rate_limited')
    await waitFor(() => late.closed !== null)
  })

  it('flooding closes the socket with 1008', async () => {
    const c = await rawClient(srv.url)
    c.send(hello({ quick: true }))
    await c.next('welcome')
    for (let i = 0; i < NET.msgBurst + 50; i++) c.send({ type: 'ping', t: i })
    await waitFor(() => c.closed !== null)
    assert.equal(c.closed, 1008)
  })

  it('class spam is ignored, not punished', async () => {
    const c = await rawClient(srv.url)
    c.send(hello({ quick: true }))
    await c.next('welcome')
    for (let i = 0; i < 10; i++) c.send({ type: 'class', cls: i % 2 ? 'mage' : 'warrior' })
    await sleep(200)
    assert.equal(c.closed, null)
    c.ws.close()
  })
})

describe('the idle kick over sockets', async () => {
  const srv = await startServer({ idleKickMs: 300 })
  after(() => srv.close())

  it('an idle client gets error idle and is closed; its room goes with it', async () => {
    const c = await rawClient(srv.url)
    c.send(hello({ quick: true }))
    await c.next('welcome')
    assert.equal((await c.next('error', 3000)).code, 'idle')
    await waitFor(() => c.closed !== null)
    await waitFor(() => srv.pvp.lobby.rooms.size === 0)
  })

  it("in a shared public room the idle human's seat goes to a bot", async () => {
    const idle = await rawClient(srv.url)
    idle.send(hello({ quick: true }))
    await idle.next('welcome')
    const busy = await rawClient(srv.url)
    busy.send(hello({ quick: true, name: 'Ilmari' }))
    await busy.next('welcome')
    let seq = 0
    const timer = setInterval(() => busy.send(move(++seq)), 50)
    try {
      assert.equal((await idle.next('error', 3000)).code, 'idle')
      await waitFor(() => { const s = busy.last('snap'); return s && s.heroes.length === NET.botFill && botsIn(s).length === 3 })
      assert.equal(busy.closed, null)
    } finally {
      clearInterval(timer)
      busy.ws.close()
    }
  })
})

describe('the refusal log', () => {
  it('logs counts once per period, and never an address', async () => {
    const lines = []
    const srv = await startServer({ refusalLogMs: 100, log: l => lines.push(l) })
    try {
      const ip = '198.51.100.77'
      const open = []
      for (let i = 0; i < NET.perIpSockets + 1; i++) open.push(await rawClient(srv.url, { ip }))
      await waitFor(() => lines.length > 0)
      assert.match(lines[0], /rate_limited 1/)
      assert.ok(!lines.some(l => l.includes(ip) || l.includes('127.0.0.1')))
      for (const c of open) c.ws.close()
    } finally {
      await srv.close()
    }
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test test/net-public.test.js`
Expected: FAIL. A quick hello reaches `joinRoom(lobby, undefined, …)` and is answered `no_room`; nothing limits sockets or hellos; nothing kicks or logs.

- [ ] **Step 4: Implement**

`server/pvp-server.js`. Replace the header comment and imports:

```js
// The PvP WebSocket endpoint (spec §1, §3; public launch 4a §1-§2):
// upgrades /pvp on the web server, screens every socket (limits.js) and
// every name (names.js), turns hello into a room seat — private, by code, or
// a quick-joined public room — feeds validated inputs to server/rooms.js,
// runs each room's 30 Hz loop, broadcasts snapshots and kicks idle humans.
// Heartbeat pings drop dead sockets.
//
// Privacy: a caller's IP is used only as a key into the gate's in-memory
// counters (server/limits.js). It is never logged and never sent anywhere;
// the only log line about refusals is a count per period.
import { WebSocketServer } from 'ws'
import { makeLobby, createRoom, joinRoom, quickJoin, leaveRoom, queueInput, setRoomClass, stepRoom, ackOf, drainKicks } from './rooms.js'
import { makeGate, admit, release, takeHello, noteFlood, sweepGate, makeConnLimits, allowMessage, allowClass, clientIp } from './limits.js'
import { acceptableName } from './names.js'
import { MSG, ERR, encode, decode, validateHello, validateInput, validateClass } from '../renderer/net/protocol.js'
import { PVP } from '../renderer/data/pvp.js'
import { NET } from '../renderer/data/net.js'
```

Replace the `attachPvp` signature and its first lines:

```js
export function attachPvp(httpServer, { path = NET.path, heartbeatMs = NET.heartbeatMs, helloTimeoutMs = NET.helloTimeoutMs,
  trustProxy = NET.trustProxy, refusalLogMs = NET.refusalLogMs, log = console.log, now = () => performance.now(),
  ...lobbyOpts } = {}) {
  const lobby = makeLobby(lobbyOpts)
  const gate = makeGate()
  const wss = new WebSocketServer({ noServer: true, maxPayload: NET.maxPayload })
  const loops = new Map()
```

After `crashRoom`, add `kick` and `seat`:

```js
  // Free a seat from the server side (the idle kick): tell the client why,
  // leave the room now — a public room's bot fill takes the seat — and close.
  // The socket's own 'close' handler runs later and finds nothing to do:
  // leaveRoom is idempotent.
  function kick(room, heroId, code) {
    const ws = room.sockets.get(heroId)
    room.sockets.delete(heroId)
    leaveRoom(lobby, room, heroId)
    if (!lobby.rooms.has(room.code)) stopLoop(room.code)
    if (ws) { send(ws, { type: MSG.ERROR, code }); ws.close(1000) }
  }

  // A validated hello → a seat, or { error }. A name that fails the screen
  // answers bad_name, the same as a malformed one.
  function seat(hello) {
    if (hello.error) return hello
    if (!acceptableName(hello.name)) return { error: ERR.BAD_NAME }
    if (hello.create) return createRoom(lobby, hello)
    if (hello.quick) return quickJoin(lobby, hello)
    return joinRoom(lobby, hello.room, hello)
  }
```

In `ensureLoop`, replace the `while` loop body so it handles kicks and stops stepping a room that has closed:

```js
        while (acc >= tickMs) {
          acc -= tickMs
          const body = stepRoom(lobby, room)
          if (body) broadcast(room, body)
          for (const id of drainKicks(room)) kick(room, id, ERR.IDLE)
          if (lobby.rooms.get(room.code) !== room) return
        }
```

Replace the whole `wss.on('connection', …)` handler with:

```js
  wss.on('connection', (ws, req) => {
    // An oversized frame (over maxPayload) surfaces here as a RangeError,
    // not a 'close' — without this handler it is an uncaught exception.
    // Installed first, before any early return.
    ws.on('error', () => { try { ws.terminate() } catch { /* already gone */ } })
    // The upgrade is accepted, then a socket over the per-IP or total cap is
    // told why and closed. A refused socket is never counted, so nothing
    // releases it.
    const ip = clientIp(req, trustProxy)
    const refused = admit(gate, ip, now())
    if (refused) { send(ws, { type: MSG.ERROR, code: refused }); ws.close(1008); return }
    ws.missed = 0
    ws.on('pong', () => { ws.missed = 0 })
    const budget = makeConnLimits(now())
    let room = null, heroId = null
    // A socket that never sends hello would otherwise sit open forever.
    const helloTimer = setTimeout(() => { if (!room) ws.close(1008) }, helloTimeoutMs)
    ws.on('message', (data, isBinary) => {
      // Closing (a kick, a flood): anything still arriving is ignored.
      if (ws.readyState !== 1) return
      if (!allowMessage(budget, now())) { noteFlood(gate); ws.close(1008); return }
      const msg = isBinary ? null : decode(data)
      if (!msg) { ws.close(1003); return }
      // A message can arrive from this socket after its room has already
      // been torn down (crashRoom) but before the close handshake finishes;
      // room is still set, so without this it would reach queueInput/
      // setRoomClass on a dead room (e.g. room.match is gone) and throw.
      if (room && lobby.rooms.get(room.code) !== room) return
      // Hello handling shares this try with message dispatch below: a future
      // arena with fewer spawns than NET.maxHeroes (or any other bug in
      // createRoom/joinRoom/quickJoin) must close just this socket with 1011,
      // not take the process down.
      try {
        if (!room) {
          if (msg.type !== MSG.HELLO) { ws.close(1008); return }
          if (!takeHello(gate, ip, now())) { send(ws, { type: MSG.ERROR, code: ERR.RATE_LIMITED }); ws.close(1008); return }
          const res = seat(validateHello(msg))
          if (res.error) { send(ws, { type: MSG.ERROR, code: res.error }); ws.close(1008); return }
          room = res.room; heroId = res.heroId
          clearTimeout(helloTimer)
          room.sockets ??= new Map()
          room.sockets.set(heroId, ws)
          ensureLoop(room)
          send(ws, { type: MSG.WELCOME, v: NET.protocolVersion, room: room.code, heroId, tick: room.match.tick })
          return
        }
        if (msg.type === MSG.INPUT) { const input = validateInput(msg); if (input) queueInput(room, heroId, input) }
        else if (msg.type === MSG.CLASS) { if (validateClass(msg.cls) && allowClass(budget, now())) setRoomClass(room, heroId, msg.cls) }
        else if (msg.type === MSG.PING) { if (Number.isFinite(msg.t)) send(ws, { type: MSG.PONG, t: msg.t }) }
      } catch (err) {
        console.error(`[pvp] message handling failed (room ${room?.code}, hero ${heroId}):`, err)
        try { ws.close(1011) } catch { /* already gone */ }
      }
    })
    ws.on('close', () => {
      release(gate, ip)
      clearTimeout(helloTimer)
      if (!room) return
      room.sockets.delete(heroId)
      // The room may already have been torn down by crashRoom(); its own
      // sockets are being closed right now, so leaveRoom must not run again
      // against a room the lobby no longer holds.
      if (lobby.rooms.get(room.code) !== room) return
      try {
        leaveRoom(lobby, room, heroId)
        if (!lobby.rooms.has(room.code)) stopLoop(room.code)
      } catch (err) {
        // Belt-and-braces: leaveRoom touches room.match too, so if this room
        // is in some other unexpected broken state, don't let tearing down
        // one departing socket take the process down. crashRoom logs, stops
        // the loop, drops the room and closes every socket still in it.
        crashRoom(room, err)
      }
    })
  })
```

Replace the heartbeat line and the returned object:

```js
  const heartbeat = setInterval(() => heartbeatSweep(wss.clients), heartbeatMs)
  // Refusal counts once a period, only when there were any — never an address.
  const sweeper = setInterval(() => {
    const counts = Object.entries(sweepGate(gate, now())).filter(([, n]) => n > 0)
    if (counts.length) log(`[pvp] refused in the last ${Math.round(refusalLogMs / 1000)} s: ${counts.map(([k, n]) => `${k} ${n}`).join(', ')}`)
  }, refusalLogMs)

  return {
    lobby, wss, gate,
    close() {
      clearInterval(heartbeat)
      clearInterval(sweeper)
      for (const code of [...loops.keys()]) stopLoop(code)
      for (const ws of wss.clients) ws.terminate()
      wss.close()
    },
  }
```

- [ ] **Step 5: Run tests**

Run: `node --test test/net-public.test.js test/net-server.test.js test/net-play.test.js && npm test`
Expected: all PASS. `net-server.test.js` sends well over 10 hellos through one server; it passes because each `rawClient` now has its own address.

- [ ] **Step 6: Commit**

```bash
git add server/pvp-server.js test/net-helpers.js test/net-public.test.js
git commit -m "feat(server): socket limits, name screen, quick-join, idle kicks and an address-free refusal log

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 6: The Online menus, the leave confirm and the in-match panels (pure + menu.js)

**Files:**
- Create: `renderer/ui/net-panels.js`
- Modify: `renderer/ui/menu.js`, `renderer/net/view.js`
- Test: `test/net-panels.test.js` (new), `test/menu.test.js`, `test/net-ui.test.js`

**Interfaces:**
- Consumes: `errorText` (Task 1).
- Produces:
  - `makeNetPanels(ui) → panels`:
    - `ui` has `{ hide(), picker(), results(rows), wait(), confirm() }`;
    - `panels` has `{ confirming (getter), escape(), stay(), died(), picked(), matchEnd(rows), matchStart(), sync({ ended, dead }) }`.
  - `errorTitle(code, kind) → string`, where `kind` is `'quick' | 'host' | 'join'`.
  - `controlHint(coarse: boolean) → string`.
  - In menu.js:
    - `showTitle(meta, { …, onOnline })`, which adds an **Online** button after *Dungeon Rush* in the web build only;
    - `showOnline({ onQuick, onFriends, onBack })`;
    - `showFriends({ onHost, onJoin, onBack })`;
    - `showLeaveConfirm({ onStay, onLeave })`;
    - `showTextEntry({ …, autocapitalize })`;
    - `showPvpResults(rows, { onNext, onQuit, quitLabel = 'Quit' })`.
  - While a text field is up, `body` has the class `menu-typing`. `hide()` and any screen without a field remove it.

- [ ] **Step 1: Write the failing tests**

`test/net-panels.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeNetPanels } from '../renderer/ui/net-panels.js'

const fakeUi = () => {
  const calls = []
  const ui = {
    hide: () => calls.push('hide'), picker: () => calls.push('picker'), wait: () => calls.push('wait'),
    confirm: () => calls.push('confirm'), results: rows => calls.push(['results', rows]),
  }
  return { ui, calls }
}
const ROWS = [{ rank: 1, name: 'Aino', cls: 'mage', kills: 3, deaths: 1 }]

describe('makeNetPanels', () => {
  it('Escape opens the confirm; Stay closes it back to the bare arena', () => {
    const { ui, calls } = fakeUi()
    const p = makeNetPanels(ui)
    p.escape()
    assert.equal(p.confirming, true)
    p.stay()
    assert.equal(p.confirming, false)
    assert.deepEqual(calls, ['confirm', 'hide'])
  })
  it('a second Escape closes it too, and a third opens it again', () => {
    const { ui, calls } = fakeUi()
    const p = makeNetPanels(ui)
    p.escape(); p.escape(); p.escape()
    assert.deepEqual(calls, ['confirm', 'hide', 'confirm'])
    assert.equal(p.confirming, true)
  })
  it('Stay with no confirm open does nothing', () => {
    const { ui, calls } = fakeUi()
    makeNetPanels(ui).stay()
    assert.deepEqual(calls, [])
  })
  it('over the death picker: Escape, then Stay, brings the picker back', () => {
    const { ui, calls } = fakeUi()
    const p = makeNetPanels(ui)
    p.died(); p.escape(); p.stay()
    assert.deepEqual(calls, ['picker', 'confirm', 'picker'])
  })
  it('over the results: Stay brings the table back with its rows', () => {
    const { ui, calls } = fakeUi()
    const p = makeNetPanels(ui)
    p.matchEnd(ROWS); p.escape(); p.stay()
    assert.deepEqual(calls, [['results', ROWS], 'confirm', ['results', ROWS]])
  })
  it('a death or a match end while the confirm is open waits under it, and shows on Stay', () => {
    const { ui, calls } = fakeUi()
    const p = makeNetPanels(ui)
    p.escape(); p.died(); p.matchEnd(ROWS)
    assert.deepEqual(calls, ['confirm'])
    p.stay()
    assert.deepEqual(calls, ['confirm', ['results', ROWS]])
  })
  it('picking a class clears the picker; matchStart clears the results and the picker', () => {
    const { ui, calls } = fakeUi()
    const p = makeNetPanels(ui)
    p.died(); p.picked()
    p.died(); p.matchEnd(ROWS); p.matchStart()
    assert.deepEqual(calls, ['picker', 'hide', 'picker', ['results', ROWS], 'hide'])
  })
  it('sync backstops: ended without a matchEnd shows the wait panel; a live snapshot clears it; alive clears the picker', () => {
    const { ui, calls } = fakeUi()
    const p = makeNetPanels(ui)
    p.sync({ ended: true, dead: false })
    p.sync({ ended: true, dead: false })          // no change, no redraw
    p.sync({ ended: false, dead: false })
    p.died()
    p.sync({ ended: false, dead: true })
    p.sync({ ended: false, dead: false })
    assert.deepEqual(calls, ['wait', 'hide', 'picker', 'hide'])
  })
})
```

Append to `test/menu.test.js`. First extend the top import to also import `showOnline, showFriends, showLeaveConfirm, showPvpResults`, via a new import line placed with the second import:

```js
import { showOnline, showFriends, showLeaveConfirm, showPvpResults } from '../renderer/ui/menu.js'
```

Then add at the end of the file:

```js
// A DOM stub with a body (for the menu-typing class), setAttribute on
// elements, a captured keydown listener, and an optional web saveAPI.
function stubDomFull({ isWeb = false } = {}) {
  const bodyClasses = new Set()
  const makeEl = (tag) => {
    const el = {
      tag, children: [], className: '', textContent: '', style: {}, innerHTML: '', listeners: {}, attrs: {},
      value: '', maxLength: 0, autocomplete: '',
      appendChild(c) { el.children.push(c); return c },
      addEventListener(ev, fn) { el.listeners[ev] = fn },
      setAttribute(k, v) { el.attrs[k] = String(v) },
      classList: { toggle() {} },
      focus() {},
    }
    return el
  }
  const overlay = makeEl('div')
  let keydownHandler = null
  globalThis.document = {
    getElementById: id => (id === 'menu-overlay' ? overlay : null),
    createElement: makeEl,
    body: { classList: { toggle: (c, on) => (on ? bodyClasses.add(c) : bodyClasses.delete(c)), remove: c => bodyClasses.delete(c) } },
  }
  globalThis.window = {
    addEventListener: (ev, fn) => { if (ev === 'keydown') keydownHandler = fn },
    removeEventListener: (ev) => { if (ev === 'keydown') keydownHandler = null },
    saveAPI: isWeb ? { isWeb: true } : undefined,
  }
  const press = (key, opts = {}) => {
    const e = { key, repeat: false, target: null, defaultPrevented: false, preventDefault() { e.defaultPrevented = true }, ...opts }
    keydownHandler?.(e)
    return e
  }
  const cleanup = () => { hide(); delete globalThis.document; delete globalThis.window }
  return { overlay, press, bodyClasses, cleanup }
}
const labelsOf = overlay => buttonsOf(overlay).map(b => b.textContent)
const titleOf = overlay => overlay.children[0].children[0].textContent
const inputOf = overlay => overlay.children[0].children.find(c => c.tag === 'input')
const META = { deepestReached: 0, runsCompleted: 0, treasureStolen: false }

describe('the Online menu', () => {
  it('the web title has Online right after Dungeon Rush, and it calls onOnline', () => {
    const d = stubDomFull({ isWeb: true })
    try {
      let online = false
      showTitle(META, { onOnline: () => { online = true } })
      assert.deepEqual(labelsOf(d.overlay), ['Adventure', 'Timewarp', 'Dungeon Rush', 'Online'])
      buttonsOf(d.overlay)[3].listeners.click()
      assert.equal(online, true)
    } finally { d.cleanup() }
  })
  it('the desktop title has no Online button', () => {
    const d = stubDomFull({ isWeb: false })
    try {
      showTitle(META, {})
      assert.deepEqual(labelsOf(d.overlay), ['Adventure', 'Timewarp', 'Dungeon Rush', 'Open Editor', 'Quit'])
    } finally { d.cleanup() }
  })
  it('Online: Quick match, Play with friends, Back — and Escape goes back', () => {
    const d = stubDomFull({ isWeb: true })
    try {
      const got = []
      showOnline({ onQuick: () => got.push('quick'), onFriends: () => got.push('friends'), onBack: () => got.push('back') })
      assert.equal(titleOf(d.overlay), 'Online')
      assert.deepEqual(labelsOf(d.overlay), ['Quick match', 'Play with friends', 'Back'])
      buttonsOf(d.overlay).forEach(b => b.listeners.click())
      d.press('Escape')
      assert.deepEqual(got, ['quick', 'friends', 'back', 'back'])
    } finally { d.cleanup() }
  })
  it('Play with friends: Host a room, Join with code, Back — and Escape goes back', () => {
    const d = stubDomFull({ isWeb: true })
    try {
      const got = []
      showFriends({ onHost: () => got.push('host'), onJoin: () => got.push('join'), onBack: () => got.push('back') })
      assert.equal(titleOf(d.overlay), 'Play with friends')
      assert.deepEqual(labelsOf(d.overlay), ['Host a room', 'Join with code', 'Back'])
      buttonsOf(d.overlay).forEach(b => b.listeners.click())
      d.press('Escape')
      assert.deepEqual(got, ['host', 'join', 'back', 'back'])
    } finally { d.cleanup() }
  })
})

describe('the leave confirm', () => {
  it('asks "Leave the match?" with Stay then Leave, each calling its handler', () => {
    const d = stubDomFull()
    try {
      const got = []
      showLeaveConfirm({ onStay: () => got.push('stay'), onLeave: () => got.push('leave') })
      assert.equal(titleOf(d.overlay), 'Leave the match?')
      assert.deepEqual(labelsOf(d.overlay), ['Stay', 'Leave'])
      buttonsOf(d.overlay).forEach(b => b.listeners.click())
      assert.deepEqual(got, ['stay', 'leave'])
    } finally { d.cleanup() }
  })
  it('Space (the red touch button) confirms the selected Stay, never Leave', () => {
    const d = stubDomFull()
    try {
      const got = []
      showLeaveConfirm({ onStay: () => got.push('stay'), onLeave: () => got.push('leave') })
      d.press(' ')
      assert.deepEqual(got, ['stay'])
    } finally { d.cleanup() }
  })
  it('Escape on it calls neither handler: game.js owns Escape in a match', () => {
    const d = stubDomFull()
    try {
      const got = []
      showLeaveConfirm({ onStay: () => got.push('stay'), onLeave: () => got.push('leave') })
      d.press('Escape')
      assert.deepEqual(got, [])
    } finally { d.cleanup() }
  })
})

describe('text entry on a phone', () => {
  it('the code field asks for capitals with no autocomplete, and the touch layer is hidden while typing', () => {
    const d = stubDomFull({ isWeb: true })
    try {
      showTextEntry({ title: 'Join with code', subtitle: 'Room code', autocapitalize: 'characters', onSubmit: () => {} })
      const inp = inputOf(d.overlay)
      assert.equal(inp.attrs.autocapitalize, 'characters')
      assert.equal(inp.autocomplete, 'off')
      assert.equal(d.bodyClasses.has('menu-typing'), true)
      showMessage({ title: 'Finding a match…', onOk: () => {} })
      assert.equal(d.bodyClasses.has('menu-typing'), false)
      showTextEntry({ title: 'Quick match', subtitle: 'Your name', onSubmit: () => {} })
      assert.equal(d.bodyClasses.has('menu-typing'), true)
      hide()
      assert.equal(d.bodyClasses.has('menu-typing'), false)
    } finally { d.cleanup() }
  })
  it("the keyboard's Enter in the field submits its text", () => {
    const d = stubDomFull({ isWeb: true })
    try {
      let got = null
      showTextEntry({ title: 'Quick match', subtitle: 'Your name', value: 'Aino', onSubmit: v => { got = v } })
      const inp = inputOf(d.overlay)
      inp.value = 'Ilmari'
      d.press('Enter', { target: inp })
      assert.equal(got, 'Ilmari')
    } finally { d.cleanup() }
  })
})

describe('online results', () => {
  it('the online table ends in Leave, and has no Next match', () => {
    const d = stubDomFull()
    try {
      let left = false
      showPvpResults([{ rank: 1, name: 'Bot Ukko', cls: 'mage', kills: 3, deaths: 1 }], { onQuit: () => { left = true }, quitLabel: 'Leave' })
      assert.deepEqual(labelsOf(d.overlay), ['Leave'])
      buttonsOf(d.overlay)[0].listeners.click()
      assert.equal(left, true)
    } finally { d.cleanup() }
  })
})
```

In `test/net-ui.test.js`, extend the view import to `import { netUrl, normalizeCode, validCode, errorText, errorTitle, controlHint, netViewOf } from '../renderer/net/view.js'`, and add inside `describe('view helpers', …)`:

```js
  it('errorTitle: removed for idle, slow down for rate_limited, otherwise by the way in', () => {
    assert.equal(errorTitle('idle', 'quick'), 'Removed')
    assert.equal(errorTitle('rate_limited', 'join'), 'Slow down')
    assert.equal(errorTitle('server_full', 'quick'), 'Could not join')
    assert.equal(errorTitle('bad_name', 'host'), 'Could not host')
    assert.equal(errorTitle('no_room', 'join'), 'Could not join')
    assert.equal(errorTitle('version', undefined), 'Could not connect')
  })
  it('controlHint: touch or keyboard', () => {
    assert.equal(controlHint(true), 'Stick: move · Red: attack · Green: shield / blink')
    assert.equal(controlHint(false), 'WASD: move · Space: attack · Q: shield / blink')
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/net-panels.test.js test/menu.test.js test/net-ui.test.js`
Expected: FAIL:
- `renderer/ui/net-panels.js` is not found;
- `showOnline`, `showFriends` and `showLeaveConfirm` are not exported;
- `errorTitle` and `controlHint` are not exported.

- [ ] **Step 3: Implement `renderer/ui/net-panels.js`**

```js
// What covers the arena during an online match (4a spec §3): nothing, the
// "Down!" class picker, or the results / next-match panel — and the leave
// confirm over any of them. Pure bookkeeping, no DOM: game.js hands in `ui`,
// whose functions draw each panel through menu.js. Escape (or the touch
// START pill) opens the confirm; Stay or a second Escape puts back whatever
// is current underneath, so a death or a match end that happened meanwhile
// shows the moment the confirm closes.
export function makeNetPanels(ui) {
  const p = { confirming: false, picker: false, ended: false, standings: null }
  const show = () => {
    if (p.ended) { if (p.standings) ui.results(p.standings); else ui.wait() }
    else if (p.picker) ui.picker()
    else ui.hide()
  }
  const redraw = () => { if (!p.confirming) show() }
  const panels = {
    get confirming() { return p.confirming },
    escape() {
      if (p.confirming) { p.confirming = false; show() }
      else { p.confirming = true; ui.confirm() }
    },
    stay() { if (p.confirming) { p.confirming = false; show() } },
    died() { p.picker = true; redraw() },
    picked() { if (!p.picker) return; p.picker = false; redraw() },
    matchEnd(standings) { p.ended = true; p.standings = standings; redraw() },
    matchStart() { p.ended = false; p.standings = null; p.picker = false; redraw() },
    // Backstops from each snapshot: a capped or dropped matchEnd, matchStart
    // or respawn event (a backgrounded tab, a skipped slow reader) must not
    // leave a panel stuck over a live match, or no panel over the results.
    sync({ ended, dead }) {
      if (ended && !p.ended) { p.ended = true; p.standings = null; redraw() }
      else if (!ended && p.ended) panels.matchStart()
      if (!dead && p.picker) panels.picked()
    },
  }
  return panels
}
```

In the test "picking a class clears the picker; matchStart clears…", `picked()` after `died()` draws `'hide'`. `matchStart()` after `matchEnd` draws `'hide'`. `picked()` with no picker is a no-op, which keeps the sync test's call list exact.

- [ ] **Step 4: Implement the view helpers**

Append to `renderer/net/view.js`:

```js
// The title over a refusal line: being removed, or slowed down, is not a
// failed join; otherwise it names the way in ('quick' | 'host' | 'join').
const KIND_TITLE = { quick: 'Could not join', host: 'Could not host', join: 'Could not join' }
export function errorTitle(code, kind) {
  if (code === 'idle') return 'Removed'
  if (code === 'rate_limited') return 'Slow down'
  return KIND_TITLE[kind] ?? 'Could not connect'
}

// The class picker's subtitle before an online match. `coarse` is
// matchMedia('(pointer: coarse)').matches — the same check that turns the
// touch controls on (ui/touch-controls.js); the caller evaluates it.
export const controlHint = coarse => coarse
  ? 'Stick: move · Red: attack · Green: shield / blink'
  : 'WASD: move · Space: attack · Q: shield / blink'
```

- [ ] **Step 5: Implement the menu changes**

In `renderer/ui/menu.js`:

1. In `renderScreen`, replace the `if (input) { … }` block with:

```js
  if (input) {
    const inp = document.createElement('input')
    inp.className = 'menu-input'
    inp.maxLength = input.maxLength ?? 12
    inp.value = input.value ?? ''
    inp.autocomplete = 'off'
    inp.spellcheck = false
    inp.enterKeyHint = 'go'
    // A phone keyboard opens in capitals for the room code.
    if (input.autocapitalize) inp.setAttribute('autocapitalize', input.autocapitalize)
    panel.appendChild(inp)
    currentInput = inp
  }
```

   Then, right after `el.style.display = 'flex'`, add:

```js
  // While a text field is up the touch layer steps aside (index.html CSS),
  // so no stick or pill can sit over the field or swallow its taps.
  document.body?.classList.toggle('menu-typing', !!input)
```

2. In `hide()`, after `currentInput = null`, add `document.body?.classList.remove('menu-typing')`.

3. Replace `showTitle`'s signature and button list:

```js
export function showTitle(meta, { onAdventure, onTimewarp, onRush, onOnline, onOpenEditor, onQuit, onCheat, onPvp, onNet }) {
  // The web release has no tile editor and nothing to quit to, but it has
  // online play. The old procedural overworld left the menu with the mode
  // split; it remains reachable as the level6 cheat.
  const isWeb = typeof window !== 'undefined' && window.saveAPI?.isWeb
  renderScreen({
    title: 'DUNGEON CRAWLER',
    subtitle: formatMetaSummary(meta),
    buttons: [
      { label: 'Adventure', onSelect: onAdventure },
      { label: 'Timewarp', onSelect: onTimewarp },
      { label: 'Dungeon Rush', onSelect: onRush },
      ...(isWeb ? [{ label: 'Online', onSelect: onOnline }] : [
        { label: 'Open Editor', onSelect: onOpenEditor },
        { label: 'Quit', onSelect: onQuit },
      ]),
    ],
    onCheat,
    onPvp,
    onNet,
  })
}
```

4. Add after `showTitle`:

```js
// Online (web build): a public room with bot fill, or a private one by code.
export function showOnline({ onQuick, onFriends, onBack }) {
  renderScreen({
    title: 'Online',
    buttons: [
      { label: 'Quick match', onSelect: onQuick },
      { label: 'Play with friends', onSelect: onFriends },
      { label: 'Back', onSelect: onBack },
    ],
    onEscape: onBack,
  })
}

export function showFriends({ onHost, onJoin, onBack }) {
  renderScreen({
    title: 'Play with friends',
    buttons: [
      { label: 'Host a room', onSelect: onHost },
      { label: 'Join with code', onSelect: onJoin },
      { label: 'Back', onSelect: onBack },
    ],
    onEscape: onBack,
  })
}

// Escape / START in an online match. No onEscape here: game.js's own Escape
// listener toggles this panel (renderer/ui/net-panels.js), so the menu must
// not act on the same key a second time.
export function showLeaveConfirm({ onStay, onLeave }) {
  renderScreen({
    title: 'Leave the match?',
    buttons: [
      { label: 'Stay', onSelect: onStay },
      { label: 'Leave', onSelect: onLeave },
    ],
  })
}
```

5. Replace `showPvpResults`:

```js
// PvP: the end-of-match table, one line per hero (bots under their names).
// onNext is optional — an online match has no local restart, only a Leave.
export function showPvpResults(rows, { onNext, onQuit, quitLabel = 'Quit' }) {
  renderScreen({
    title: 'Match over',
    lines: rows.map(r => `${r.rank}. ${r.name} — ${r.cls} — ${r.kills} / ${r.deaths}`),
    buttons: [
      ...(onNext ? [{ label: 'Next match', onSelect: onNext }] : []),
      { label: quitLabel, onSelect: onQuit },
    ],
  })
}
```

6. Replace `showTextEntry`:

```js
// A one-field form (name, room code): Enter — the phone keyboard's too — or
// OK submits the text.
export function showTextEntry({ title, subtitle, value = '', maxLength = 12, autocapitalize, onSubmit, onBack }) {
  renderScreen({
    title, subtitle, input: { value, maxLength, autocapitalize },
    buttons: [
      { label: 'OK', onSelect: () => onSubmit(currentInput?.value ?? '') },
      ...(onBack ? [{ label: 'Back', onSelect: onBack }] : []),
    ],
    onEscape: onBack,
  })
}
```

- [ ] **Step 6: Run tests**

Run: `node --test test/net-panels.test.js test/menu.test.js test/net-ui.test.js && npm test`
Expected: all PASS. The existing menu tests' stubs have no `document.body`, which the optional chaining allows.

- [ ] **Step 7: Commit**

```bash
git add renderer/ui/net-panels.js renderer/ui/menu.js renderer/net/view.js test/net-panels.test.js test/menu.test.js test/net-ui.test.js
git commit -m "feat(ui): Online menus, leave confirm, in-match panel bookkeeping, phone-friendly text entry

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 7: Wiring it into the game — `game.js` flows and the touch CSS

**Files:**
- Modify: `renderer/game.js`, `renderer/index.html`

**Interfaces:**
- Consumes:
  - Task 6: `makeNetPanels`, `menu.showOnline`, `menu.showFriends`, `menu.showLeaveConfirm`, `showTextEntry({ autocapitalize })`, `showPvpResults({ quitLabel })`, `errorTitle`, `controlHint`;
  - `NEUTRAL_INPUT` (renderer/pvp/hero.js);
  - Task 1: hello `quick`.
- No change is needed for the stance button (Shift) or SELECT (`i`) online: their handlers already no-op while `state` is null or `net` is set. START already sends Escape (ui/touch-controls.js).
- Produces:
  - `net = { s, theme, muted, kind, panels }`, where `kind` is `'quick' | 'host' | 'join'`;
  - `goOnline()`, `goFriends()`, `goNet(kind)`, `startNet({ name, cls, kind, room })`.

- [ ] **Step 1: Imports**

In `renderer/game.js`:
- Change the view import to `import { netUrl, normalizeCode, validCode, errorText, errorTitle, controlHint, netViewOf } from './net/view.js'`.
- Add:

```js
import { NEUTRAL_INPUT } from './pvp/hero.js'
import { makeNetPanels } from './ui/net-panels.js'
```

- [ ] **Step 2: Escape in a match opens the leave confirm**

In the Escape `keydown` listener, replace the line `if (net) { stopNet(); return }` with:

```js
    if (net) {
      // In a joined match Escape (and the touch START pill, which sends it)
      // toggles "Leave the match?" — over the death picker and the results
      // too. Before the welcome, or over a refusal, it just leaves. A held
      // key's repeats would flap the confirm open and shut.
      if (e.repeat) return
      if (net.s.status === 'open') net.panels.escape()
      else stopNet()
      return
    }
```

- [ ] **Step 3: The title's Online entry**

In `goTitle`, add `onOnline: goOnline,` after `onRush: …`.

- [ ] **Step 4: Replace the online flow**

Replace everything from the comment line `// Checked before ever opening a socket, so a mistyped name/code shows the` (just above `function rejectEntry`) down to and including the end of `function netFrame() { … }`. Keep `loadName` and `saveName` as they are, above it. The replacement:

```js
const coarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

// Checked before ever opening a socket, so a mistyped name/code shows the
// same one-line refusal the server would give, without a round trip.
function rejectEntry(kind, code, onOk) {
  menu.showMessage({ title: errorTitle(code, kind), lines: [errorText(code)], onOk })
}

// The web title's Online button: a public room with bot fill, or friends.
function goOnline() {
  phase = PHASE.TITLE
  menu.showOnline({ onQuick: () => goNet('quick'), onFriends: goFriends, onBack: goTitle })
}

function goFriends() {
  phase = PHASE.TITLE
  menu.showFriends({ onHost: () => goNet('host'), onJoin: () => goNet('join'), onBack: goOnline })
}

const ENTRY_TITLE = { quick: 'Quick match', host: 'Host a room', join: 'Join with code' }

// kind: 'quick' | 'host' | 'join'. The hidden host/join title cheats land
// here too. Name (prefilled) → [code] → class → the match.
function goNet(kind) {
  phase = PHASE.TITLE
  if (!window.saveAPI?.isWeb) {
    menu.showMessage({ title: 'Online play', lines: ['Online play is in the web build.'], onOk: goTitle })
    return
  }
  const title = ENTRY_TITLE[kind]
  const back = kind === 'quick' ? goOnline : goFriends
  menu.showTextEntry({ title, subtitle: 'Your name', value: loadName(), maxLength: NET.nameMax, onBack: back,
    onSubmit: name => {
      if (!validateName(name)) { rejectEntry(kind, 'bad_name', () => goNet(kind)); return }
      saveName(name)
      const pick = room => menu.showClassPicker({ title, subtitle: controlHint(coarsePointer()), onBack: back,
        onPick: cls => startNet({ name, cls, kind, room }) })
      if (kind !== 'join') pick(null)
      else menu.showTextEntry({ title, subtitle: 'Room code', maxLength: NET.codeLength + 2, autocapitalize: 'characters', onBack: back,
        onSubmit: code => {
          const c = normalizeCode(code)
          if (!validCode(c)) { rejectEntry(kind, 'bad_hello', () => goNet(kind)); return }
          pick(c)
        } })
    } })
}

// menu.js draws what net.panels decides. Every panel drops a held Space, so
// the press that opened it can neither confirm its first button nor keep the
// hero swinging once it closes.
function netPanelUi(s) {
  const drop = () => { keys[' '] = false }
  return {
    hide: () => { drop(); menu.hide() },
    picker: () => { drop(); menu.showClassPicker({ title: 'Down!', subtitle: 'Class for your next life — back in 3 s',
      onPick: cls => { sendClass(s, cls); net?.panels.picked() } }) },
    results: rows => { drop(); menu.showPvpResults(rows, { onQuit: stopNet, quitLabel: 'Leave' }) },
    wait: () => { drop(); menu.showMessage({ title: 'Next match starting…', onOk: stopNet, okLabel: 'Leave' }) },
    confirm: () => { drop(); menu.showLeaveConfirm({ onStay: () => net?.panels.stay(), onLeave: stopNet }) },
  }
}

function startNet({ name, cls, kind, room }) {
  const theme = DEPTH_THEMES.find(t => t.depths.includes(0)) ?? DEPTH_THEMES[0]
  const hello = kind === 'quick' ? { name, cls, quick: true }
    : kind === 'host' ? { name, cls, create: true }
    : { name, cls, room }
  const s = connect({ url: netUrl(location), hello })
  decorateMap(s.map, rulesets[theme.ruleset])
  net = { s, theme, muted: loadMutedPref(), kind, panels: makeNetPanels(netPanelUi(s)) }
  state = null
  menu.showMessage({ title: kind === 'quick' ? 'Finding a match…' : 'Connecting…', onOk: stopNet })
  setPhase(PHASE.PLAYING)
  keys[' '] = false
}

function stopNet() {
  if (net) netLeave(net.s)
  net = null
  hidePvpHud()
  goTitle()
}

function netFrame() {
  const now = performance.now()
  const { s, panels } = net
  // Under the leave confirm you stand still (4a spec §3); inputs keep
  // flowing, so the server's stale-input rule never kicks in.
  netFrameStep(s, panels.confirming ? NEUTRAL_INPUT : inputFromKeys(keys, sprintDetector.sprinting()), now)
  for (const ev of drainEvents(s)) {
    if (ev.type === 'welcome') menu.hide()
    else if (ev.type === 'error') { menu.showMessage({ title: errorTitle(ev.code, net.kind), lines: [errorText(ev.code)], onOk: stopNet }); return }
    else if (ev.type === 'closed' && ev.status === 'lost') { menu.showMessage({ title: 'Connection lost', onOk: stopNet }); return }
    else if (ev.type === 'kill' && ev.victim === s.heroId) panels.died()
    else if (ev.type === 'respawn' && ev.hero === s.heroId) panels.picked()
    else if (ev.type === 'matchEnd') panels.matchEnd(ev.standings)
    else if (ev.type === 'matchStart') panels.matchStart()
  }
  // Refused, kicked or lost: the message above stays up and nothing redraws
  // over it.
  if (s.status !== 'open') return
  const v = sessionView(s, now)
  if (!v) return
  // The events above are how the panels normally change, but a capped or
  // dropped event (a backgrounded tab, a slow-reader-skipped snapshot) can
  // lose the matchStart, matchEnd or respawn that would have done it — and a
  // player joining mid-results never sees that matchEnd at all. The snapshot
  // state backs them up.
  panels.sync({ ended: v.ended, dead: v.me.dead })
  const view = netViewOf(v, net.theme, s.map)
  maybeComputeFOV(view.map, view.player, 12, { los: true })
  renderer.updateCamera(view.player, 0, null)
  renderer.render(view, null)
  updateHUD(view)
  updatePvpHud(netHudModel(v, s.heroId))
  playCues(audio, drainCues(s), view.player, net.muted)
}
```

- [ ] **Step 5: The touch CSS**

In `renderer/index.html`, directly after the line `@media (pointer: coarse) { #touch-controls { display: block; } }`, add:

```css
    /* A menu text field is up (menu.js): the touch layer steps aside so a
       tap reaches the field and brings up the phone keyboard. */
    body.menu-typing #touch-controls { display: none; }
```

- [ ] **Step 6: Check it parses and the suite passes**

Run: `node --check renderer/game.js && npm test`
Expected: no syntax error; all tests PASS.

- [ ] **Step 7: Load check (time-boxed, about 1 minute)**

Start `npm run web` in the background. Write this script in the scratchpad (`/tmp/claude-1000/-home-lappemikb-projects-dungeon-crawler/170eab54-57f1-4834-98b0-cda083c36a9c/scratchpad/load-check.mjs`), then copy it to `debug-4a-load.mjs` in the repo root (`debug*.mjs` is git-ignored) so `playwright-core` resolves. Run it with `node debug-4a-load.mjs`, then delete the copy and stop the server.

```js
import { chromium } from 'playwright-core'
const browser = await chromium.launch()
const p = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
p.on('pageerror', e => errors.push(e.message))
await p.goto('http://localhost:8080'); await p.waitForSelector('.menu-btn')
const title = await p.locator('.menu-btn').allTextContents()
await p.click('.menu-btn:has-text("Online")')
const online = await p.locator('.menu-btn').allTextContents()
await p.click('.menu-btn:has-text("Quick match")')
await p.fill('.menu-input', 'Aino'); await p.keyboard.press('Enter')
const hint = await p.locator('.menu-subtitle').first().textContent()
await p.click('.menu-btn:has-text("Warrior")'); await p.waitForTimeout(1500)
const hud = await p.locator('#pvp-hud').textContent()
console.log(JSON.stringify({ title, online, hint, hud, errors }))
await browser.close()
```

Expected:
- `title` ends with `"Online"`;
- `online` is `["Quick match","Play with friends","Back"]`;
- `hint` is the WASD line;
- `hud` starts with a 4-letter code and shows a running time (not `--:--`);
- `errors` is `[]`.

If anything fails, fix the cause and re-run once.

- [ ] **Step 8: Commit**

```bash
git add renderer/game.js renderer/index.html
git commit -m "feat(net): Online flows in the game — quick match, friends, leave confirm, neutral input under it

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 8: Local desktop and phone checks, the memory check, and docs

**Files:**
- Scratch (not committed): `/tmp/claude-1000/-home-lappemikb-projects-dungeon-crawler/170eab54-57f1-4834-98b0-cda083c36a9c/scratchpad/live-4a.mjs`, run from a git-ignored copy `debug-4a-live.mjs` in the repo root
- Modify (not committed): `/home/lappemikb/CLAUDE.md`
- Modify only if Step 3 says so: `tools/deploy-web.sh`

- [ ] **Step 1: The live-check script**

The script runs the web server **in-process**, on port 8091, so it can read the lobby directly (which rooms exist, public or not, humans, hero names). Write it in the scratchpad as `live-4a.mjs`:

```js
// Local 4a checks: desktop quick-join ×2 + the leave confirm, then a
// landscape phone profile. Run from the repo root: node debug-4a-live.mjs <outdir>
import http from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { attachPvp } from './server/pvp-server.js'
import { makeStaticHandler } from './server/static.js'

const out = process.argv[2]
const server = http.createServer(makeStaticHandler(path.resolve('renderer')))
const pvp = attachPvp(server)
await new Promise(r => server.listen(8091, '127.0.0.1', r))
const BASE = 'http://127.0.0.1:8091'
const errors = []
const rooms = () => [...pvp.lobby.rooms.values()].map(r => ({ code: r.code, public: r.public, humans: r.players.size, heroes: r.match.heroes.map(h => h.name) }))
const heroPx = name => [...pvp.lobby.rooms.values()].flatMap(r => r.match.heroes).find(h => h.name === name)?.px
const browser = await chromium.launch()

async function desktop(name) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  p.on('pageerror', e => errors.push(`${name}: ${e.message}`))
  await p.goto(BASE); await p.waitForSelector('.menu-btn')
  await p.click('.menu-btn:has-text("Online")')
  await p.click('.menu-btn:has-text("Quick match")')
  await p.fill('.menu-input', name); await p.keyboard.press('Enter')
  await p.click('.menu-btn:has-text("Warrior")')
  await p.waitForTimeout(1500)
  return p
}

// 1. Desktop
const a = await desktop('Aino')
const afterA = rooms()
const hudA = await a.locator('#pvp-hud').textContent()
const b = await desktop('Ilmari')
await b.waitForTimeout(500)
const afterB = rooms()
await a.keyboard.down('d'); await a.waitForTimeout(800); await a.keyboard.up('d')
await a.screenshot({ path: `${out}/desktop-a.png` }); await b.screenshot({ path: `${out}/desktop-b.png` })
await b.keyboard.press('Escape'); await b.waitForTimeout(150)
const confirmTitle = await b.locator('.menu-title').textContent()
await b.screenshot({ path: `${out}/desktop-confirm.png` })
await b.keyboard.press('Escape'); await b.waitForTimeout(150)
const closedByEscape = await b.locator('#menu-overlay').isHidden()
await b.keyboard.press('Escape'); await b.click('.menu-btn:has-text("Stay")'); await b.waitForTimeout(150)
const closedByStay = await b.locator('#menu-overlay').isHidden()
await b.keyboard.press('Escape'); await b.click('.menu-btn:has-text("Leave")'); await b.waitForTimeout(500)
const leftTitle = await b.locator('.menu-title').textContent()
const afterLeave = rooms()

// 2. Phone: landscape, touch
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
const ph = await ctx.newPage()
ph.on('pageerror', e => errors.push(`phone: ${e.message}`))
await ph.goto(BASE); await ph.waitForSelector('.menu-btn')
const coarse = await ph.evaluate(() => matchMedia('(pointer: coarse)').matches)
await ph.tap('.menu-btn:has-text("Online")')
await ph.tap('.menu-btn:has-text("Quick match")')
const touchHiddenWhileTyping = await ph.locator('#touch-controls').isHidden()
await ph.tap('.menu-input')
const focused = await ph.evaluate(() => document.activeElement?.className)
await ph.keyboard.type('Vaino'); await ph.keyboard.press('Enter')
const phoneHint = await ph.locator('.menu-subtitle').first().textContent()
await ph.screenshot({ path: `${out}/phone-class.png` })
await ph.tap('.menu-btn:has-text("Archer")')
await ph.waitForTimeout(1500)
const touchShownInMatch = await ph.locator('#joystick-zone').isVisible()
const cdp = await ctx.newCDPSession(ph)
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
const stick = await ph.locator('#joystick-base').boundingBox()
const cx = stick.x + stick.width / 2, cy = stick.y + stick.height / 2
const px0 = heroPx('Vaino')
const dir = px0 > 16 * 32 ? -1 : 1          // push toward the arena's middle, away from the nearer side wall
await touch('touchStart', cx, cy); await touch('touchMove', cx + 30 * dir, cy); await ph.waitForTimeout(1000); await touch('touchEnd')
const px1 = heroPx('Vaino')
const red = await ph.locator('#touch-attack').boundingBox()
await touch('touchStart', red.x + red.width / 2, red.y + red.height / 2); await ph.waitForTimeout(300); await touch('touchEnd')
await ph.screenshot({ path: `${out}/phone-play.png` })
const start = await ph.locator('#touch-start').boundingBox()
await ph.touchscreen.tap(start.x + start.width / 2, start.y + start.height / 2); await ph.waitForTimeout(200)
const phoneConfirm = await ph.locator('.menu-title').textContent()
await ph.screenshot({ path: `${out}/phone-confirm.png` })
await ph.tap('.menu-btn:has-text("Stay")'); await ph.waitForTimeout(150)
const phoneStayed = await ph.locator('#menu-overlay').isHidden()
const afterPhone = rooms()

console.log(JSON.stringify({ afterA, hudA, afterB, confirmTitle, closedByEscape, closedByStay, leftTitle, afterLeave,
  coarse, touchHiddenWhileTyping, focused, phoneHint, touchShownInMatch, moved: px1 - px0, phoneConfirm, phoneStayed, afterPhone, errors }, null, 1))
await browser.close()
pvp.close(); server.close()
```

- [ ] **Step 2: Run it (time-boxed, about 3 minutes)**

```bash
SP=/tmp/claude-1000/-home-lappemikb-projects-dungeon-crawler/170eab54-57f1-4834-98b0-cda083c36a9c/scratchpad
cd /home/lappemikb/projects/dungeon-crawler && cp "$SP/live-4a.mjs" debug-4a-live.mjs && node debug-4a-live.mjs "$SP"; rm -f debug-4a-live.mjs
```

Expected:
- **Desktop:**
  - `afterA` is one room with `public: true`, `humans: 1`, and 4 heroes of which 3 start with `"Bot "`;
  - `hudA` starts with that room's code and shows a running time;
  - `afterB` is the same room with `humans: 2` and 2 bots;
  - `confirmTitle` is `"Leave the match?"`;
  - `closedByEscape` and `closedByStay` are both `true`;
  - `leftTitle` is `"DUNGEON CRAWLER"`;
  - `afterLeave` is the same room, with `humans: 1` and 3 bots again.
- **Phone:**
  - `coarse` is `true`, and `touchHiddenWhileTyping` is `true`;
  - `focused` is `"menu-input"`;
  - `phoneHint` is the "Stick: move · Red: attack · Green: shield / blink" line;
  - `touchShownInMatch` is `true`;
  - `moved` is non-zero;
  - `phoneConfirm` is `"Leave the match?"`, and `phoneStayed` is `true`;
  - `afterPhone` shows Vaino in Aino's room.
- `errors` is `[]`.

Read the screenshots in the scratchpad:
- `desktop-a.png`: bots with name tags;
- `desktop-confirm.png`: the confirm panel;
- `phone-class.png`: the hint, and buttons not covered by the pills;
- `phone-play.png`: the touch controls over the arena;
- `phone-confirm.png`.

If anything fails, fix the cause (with a test where the cause lies in pure code) and re-run once. Do not extend the time box beyond that.

- [ ] **Step 3: Service memory (read-only check)**

Run:

```bash
gcloud run services describe dungeon-crawler --project delimaster --region europe-west4 \
  --format='value(spec.template.spec.containers[0].resources.limits.memory)'
```

- If it prints `512Mi`, `1Gi` or more, change nothing.
- If it prints less (e.g. `256Mi`), or prints nothing, add ` --memory=512Mi` to the end of the `gcloud run deploy` line in `tools/deploy-web.sh`. Commit it:

```bash
git add tools/deploy-web.sh
git commit -m "chore(deploy): give the PvP server 512 MiB

Co-Authored-By: <model> <noreply@anthropic.com>"
```

Do **not** deploy.

- [ ] **Step 4: Docs (outside the repo, not committed)**

In `/home/lappemikb/CLAUDE.md`, in the dungeon-crawler `renderer/pvp/` bullet:
- change `the shared protocol v1 (`protocol.js`)` to `the shared protocol v2 (`protocol.js`)`;
- replace the sentence `In the web build, \`host\`/\`join\` title cheats create or join a 4-letter room.` with:

```markdown
In the web build the title's **Online** button (spec `docs/superpowers/specs/2026-09-25-pvp-public-launch-design.md`) offers *Quick match* — `hello.quick` → `quickJoin` into the public room with the most humans, which `balanceBots` tops up to `NET.botFill` = 4 heroes with server-side `botInput` bots (`Bot Ukko`…, ids `b1…`) — and *Play with friends* (private host/join by 4-letter code, humans only; the `host`/`join` cheats are shortcuts). The server screens names (`server/names.js` + server-only `server/blocklist.js`: normalised stems, reserved `bot`/`admin`/`mod` prefixes → `bad_name`) and limits abuse (`server/limits.js`: 8 sockets and 10 hellos/min per IP via the last `X-Forwarded-For` entry, 90-message / 60 per s bucket per socket, 2 class/s, 600 sockets total, `idle` kick after 60 s without real input); IPs stay in memory only and are never logged. In a match Escape / touch START opens "Leave the match?" (`ui/net-panels.js`), with your input neutral while it is up.
```

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS. `git status` shows no stray `debug-4a-*.mjs` files.

**After merge (controller, with the user's go-ahead — not part of any task):**
1. Fast-forward `web-release` from `main` in the `.claude/worktrees/three-game-modes` worktree, push both branches, and run `tools/deploy-web.sh`. See the web-release memory for the public URL.
2. **IP probe (temporary; remove before any announcement).**
   - On a throwaway commit on `web-release`, add this line in `server/pvp-server.js`'s upgrade handler, right after the `if (pathname !== path) …` line:

     ```js
     if (new URL(req.url, 'http://x').searchParams.has('ipcheck')) console.log('[pvp] ipcheck', clientIp(req, NET.trustProxy)) // TEMPORARY 4a probe
     ```

     Then deploy.
   - From this machine, open one socket to it: `node --input-type=module -e "import WebSocket from 'ws'; const w = new WebSocket('wss://<public-host>/pvp?ipcheck'); w.on('open', () => w.close())"`.
   - Compare the logged address, from `gcloud logging read 'textPayload:"ipcheck"' --project delimaster --limit 1`, with `curl -s https://api.ipify.org`.
   - If they match, revert the probe commit and redeploy. If they differ, stop and report: `clientIp` must be fixed before launch.
3. **Public-URL check:** re-run Task 8's desktop part against the public URL. Point the script at it: drop the in-process server, and read the room state from both HUDs instead of from the lobby. Two browsers quick-join, both HUDs show the same code and a running clock, and the leave confirm works.
4. Update the deploy memory (new revision, memory setting, 4a live).
