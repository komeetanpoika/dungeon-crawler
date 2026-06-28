# Starting-Level Cheat Code — Design

**Date:** 2026-06-28
**Status:** Approved (pending spec review)

## Summary

Add a hidden cheat code to the title screen: the player types `level<N>` (where
`N` is `1`–`5`) and the game immediately starts a new run at that depth. Input is
**invisible** (no on-screen echo). Any code that is not a valid `level1`–`level5`
is **silently ignored**.

This is purely a developer/player convenience for jumping to a level; it does not
change normal play. The "Play" button continues to start a fresh run at depth 1.

## Background

Relevant existing code:

- `renderer/data/levels.js` — `LEVEL_CONFIG` defines depths `1`–`5`; `FINAL_DEPTH = 5`.
- `renderer/ui/menu.js` — DOM-overlay menu. `showTitle()` builds the title screen;
  a generic `keyHandler` handles ArrowUp/ArrowDown/Enter for button navigation.
  There is no text input today.
- `renderer/game.js`:
  - `startNewRun()` — currently hardcodes depth 1.
  - `beginRun()` — calls `startNewRun()` after switching to the PLAYING phase.
  - `goTitle()` — shows the title screen and wires `onPlay: beginRun`.
  - `descendLevel()` — existing template for generating a level at an arbitrary
    depth (looks up theme + `LEVEL_CONFIG` for the target depth).

## Design

Three small, independently-testable units.

### 1. Pure matcher: `parseLevelCheat(buffer)`

A standalone pure function (no DOM, no game state).

- **Input:** the rolling keystroke buffer (a string).
- **Output:** a valid depth (`1`..`FINAL_DEPTH`) if the buffer **ends with**
  `level<N>` and `N` is in range; otherwise `null`.
- Matching on the **suffix** means stray earlier keystrokes don't prevent a later
  valid code from matching (e.g. `"xxlevel3"` → `3`).
- Out-of-range numbers (`level0`, `level6`, `level9`) and partial input
  (`level`, `lev`) return `null`.

Location: a small module under `renderer/systems/` (or beside `levels.js`),
importing `FINAL_DEPTH` so the valid range stays in sync with the level config.

### 2. Title-screen keystroke capture (`menu.js`)

- `showTitle(meta, opts)` gains a new optional `opts.onCheat(depth)` callback.
- While the title screen is shown, printable character keypresses are appended to a
  rolling buffer, capped to a small length (~10 chars, enough to hold `level<N>`).
- On each keypress, run `parseLevelCheat(buffer)`. On a non-null result, call
  `onCheat(depth)`.
- Letter/number keys are buffered only — they do **not** interfere with the existing
  ArrowUp/ArrowDown/Enter button navigation.
- The buffer is reset when the title screen is torn down (so it doesn't leak across
  menu transitions).

### 3. Depth-parameterized run start (`game.js`)

- `startNewRun(depth = 1)` — generalize the current depth-1 hardcode. Look up the
  theme via `DEPTH_THEMES.find(t => t.depths.includes(depth))` and the config via
  `LEVEL_CONFIG.find(c => c.depth === depth)`, mirroring `descendLevel()`.
- `beginRun(depth = 1)` — pass the depth through to `startNewRun`.
- In `goTitle()`, wire `onCheat: (depth) => beginRun(depth)` alongside the existing
  `onPlay: beginRun`.

Because both functions keep their depth-1 defaults, the normal "Play" path is
unchanged.

## Data Flow

```
title screen keypress
  → append char to rolling buffer (menu.js)
  → parseLevelCheat(buffer)  →  null  → ignore
                             →  depth → onCheat(depth)
                                       → beginRun(depth)        (game.js)
                                       → startNewRun(depth)
                                       → generateLevel(depth, …) → run starts at depth
```

## Error / Edge Handling

- **Invalid / out-of-range code:** `parseLevelCheat` returns `null`; nothing happens.
- **Partial code:** stays in the buffer until it either completes into a valid code
  or is pushed out by newer keystrokes (rolling cap).
- **No interference with menu nav:** arrow/enter keys keep their existing behavior;
  only the cheat buffer also observes character keys.

## Testing

- **Unit (`node:test`) for `parseLevelCheat`:**
  - matches `level1`–`level5` → correct depth
  - rejects `level0`, `level6`, `level9` → `null`
  - rejects partial input (`lev`, `level`) → `null`
  - rolling-buffer: trailing valid code after junk prefix still matches
- **Regression:** existing tests pass unchanged, since `startNewRun`/`beginRun`
  retain depth-1 defaults and the "Play" button path is untouched.

## Out of Scope (YAGNI)

- Visible echo of typed characters.
- Clamping out-of-range input.
- Other cheats (god mode, item grants, etc.).
- Persisting or remembering the last cheat used.
