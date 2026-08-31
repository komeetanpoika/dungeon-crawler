# Three Game Modes — Design

**Date:** 2026-08-31
**Status:** Approved

## Goal

Split the game into three distinct, separately-selectable gameplay modes:

1. **Adventure** — free exploration across the open-map chain, with waystone
   travel between visited maps.
2. **Dungeon Rush** — the existing depth 1–5 procedural descent, unchanged.
3. **Timewarp** — the three leap episodes (Ferry, Fold, Hermit) pulled out of
   the adventure chain and made their own episode-select mode.

Today there is no `mode` flag anywhere: everything is inferred from depth
ranges (1–5 rush, 7–18 adventure, 0 arena, 19 interiors), and the leap
episodes are welded into the middle of the adventure chain at depths 8–10.

## Decisions (from brainstorming)

- Timewarp = the three existing leap episodes; room to grow with more later.
- The leap maps are **removed from the adventure chain** — adventure flows
  Clearings → River → Autumn → desert maps → sea maps (7, 11–18).
- Adventure waystones use **unlock-by-visiting**: hop freely to any visited
  map; the next unvisited map unlocks linearly, **still gated on clearing the
  frontier map's dungeons**.
- Timewarp opens an **episode-select screen**; each episode shows
  resolved/unresolved.
- Each episode gives a **fixed per-episode kit** (weapon/items/talents) —
  the adventure character is never read.
- Modes are **fully independent**: resolving an episode no longer returns
  the villager to the adventure village; completion is its own reward.
- Mid-episode timewarp progress **persists** across quits; a resolved
  episode re-enters fresh for replay.
- Chosen approach: **explicit `mode` flag, depths stay put** (approach A).
  No map rebake, no depth renumbering.

## 1. The mode seam

`beginRun(depth, mode)` gains a mode argument; `startNewRun` stores it as
`state.mode` with values `'adventure' | 'rush' | 'timewarp' | 'arena'`.

- Title buttons pass the mode explicitly (`renderer/game.js` `goTitle()`).
- The `levelN` cheat infers mode from depth via a new helper
  `modeForDepth(depth)`: 0 → arena, 1–5 → rush, leap map (`OPEN_MAPS[d].leap`)
  → timewarp, other open maps → adventure. `level8`/`level9`/`level10` cheats
  therefore drop into timewarp mode.
- Only **mode decisions** switch to reading `state.mode`. Depth-keyed things
  (themes, generation, `LEVEL_CONFIG`, `DEPTH_THEMES`) stay depth-keyed.

Mode-decision call sites that change:

- `persistAdventure()` (`game.js`) — early-returns unless
  `state.mode === 'adventure'`. Timewarp must never write the adventure save.
- Rush talent ladder grants (`game.js`, `RUSH_TALENT_LADDER`) — keyed on
  `mode === 'rush'`.
- `meta.applyRunResult` — called only for rush runs (behavior today via the
  depth guard; now explicit).
- Waystone/runestone handling branches on mode (sections 3–4).

## 2. Title screen + episode select

`renderer/ui/menu.js`:

- `showTitle` gains a third button: **Adventure / Timewarp / Dungeon Rush**,
  built with the existing `renderScreen` (keyboard nav is free).
- New `showEpisodeSelect(episodes, {onPick, onBack})` screen, also via
  `renderScreen`: one button per episode from `renderer/data/leaps.js`
  (grows automatically with new entries), plus Back. Resolved episodes are
  tinted a "done" colour — colour-only buttons, no text badges, per the UI
  feedback philosophy.
- Picking an episode calls `beginRun(episodeDepth, 'timewarp')`.

## 3. Adventure without the leap maps

- `nextMapDepth` (`renderer/systems/adventure.js`) skips any `OPEN_MAPS`
  entry with `leap: true`. Chain: 7 → 11 → 12 → 13 → … → 18.
- New save field `progress.visited` (array of map names), appended on
  arrival (`arriveOnMap`).
- Walking onto a waystone in adventure mode opens a small controls-driven
  **destination menu** (reusing the overlay-menu machinery): all visited
  maps, plus the next chain map **if the frontier map's dungeons are
  cleared** (`isMapComplete` on the furthest visited map). Travel is
  instant via the existing `travelToMap`. This menu is the placeholder
  seam where real level connections plug in later.
- `isMapUnlocked` no longer needs leap rules in adventure (leap maps are
  unreachable there); its adventure-side job is absorbed by the
  destination-menu gating above.

### Save migration (adventure v7)

In `normalizeAdventureSave`:

- If `progress.mapDepth` is 8–10, set it to 11.
- Initialize `progress.visited` to all non-leap map names at depths
  ≤ the (post-bump) `mapDepth`.
- The legacy `leaps` field is copied into the timewarp save on first load
  (see §4) and then ignored by the adventure save.
- Villagers already returned to the village (in `npcs`) stay returned —
  no retroactive removal.

## 4. Timewarp runtime + save

### Kit

Each episode in `renderer/data/leaps.js` gains a `kit` field:
`{ weapon, ranged, inventory, talents }`. Applied on episode entry; the
adventure body/talents are never read in timewarp mode. Initial content for
all three episodes: the plain new-game loadout (starting sword, no ranged,
empty inventory, no talents) — per-episode tuning comes later and is a data
edit, not a code change.

### Save

New save blob, own storage channel (Electron: `save-timewarp`/
`load-timewarp` → `TIMEWARP_FILE` in `main.cjs`, bridged in `preload.cjs`;
web: `localStorage['dungeon-crawler-timewarp']` in `web-shim.js`):

```js
{
  episodes: {
    [mapName]: { flags, resolved, felled, caves, npcs }
  }
}
```

- Episode state (flags, felled trees, cave instances, NPC state) persists
  across quits; re-entering resumes.
- Entering a **resolved** episode resets its record first — replay starts
  fresh (the `resolved` flag itself is kept).
- On first load, if the timewarp save is absent and the adventure save has
  a legacy `leaps` record, its per-map flags seed the episode records
  (resolved state derived via `isResolved`).

### Runtime

- Runestone unlock is unchanged (`isResolved` on the episode's flags).
  Walking it in timewarp mode ends the episode: mark `resolved`, persist,
  and return to the episode-select screen — no onward travel, no village
  ripple.
- Death mid-episode respawns on the map (existing `adventureRespawn`
  machinery), with NPC death/wrath wiped in the **timewarp** save's episode
  record, mirroring adventure's death semantics.
- Cave/interior dives inside an episode work as today, persisted in the
  episode's `caves` record.

## 5. Out of scope

- Real level connections between adventure maps (the destination menu is
  the placeholder).
- New episodes beyond the existing three (the episode-select screen and
  `leaps.js` data shape already accommodate them).
- Cross-mode rewards (explicitly decided against for now).
- Fixing the `level1N` cheat-buffer limitation (documented in CLAUDE.md;
  timewarp depths 8–10 are single-keystroke-safe).

## 6. Testing

`node:test` units (one file per touched system, matching repo convention):

- `nextMapDepth` skips leap maps (7 → 11; 12 → 13; 18 → none).
- Adventure v7 migration: depth bump, `visited` initialization, legacy
  `leaps` handoff.
- `visited` accumulation on arrival; destination-menu list contents with
  frontier cleared vs uncleared.
- Adventure-save isolation: `persistAdventure` is a no-op when
  `state.mode === 'timewarp'`.
- Kit application on episode entry; adventure body untouched.
- Episode resolution: `resolved` set, re-entry resets the record.
- `modeForDepth` mapping (incl. cheat depths).

Runtime verification: one short Playwright pass — title shows three
buttons; each mode boots to its first playable frame; episode select lists
three episodes. Keep it time-boxed per the project's verification rule.
