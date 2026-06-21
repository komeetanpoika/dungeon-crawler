# Game Menu System — Design

**Date:** 2026-06-21
**Status:** Approved

## Goal

Add a menu system to the game. Today the app boots straight into a run
(`init()` → `startNewRun()`) and restarts on the `R` key. Introduce a **title
menu** on launch, a **pause menu** during play, and a **game-over screen**, plus
a way to **open the editor** from the title. "Base game" plays exactly as today;
a future "Custom" mode (play with editor-created assets) is out of scope but the
menu is structured to accommodate it.

## Phases

A phase state machine drives both the game loop and which overlay screen shows:

```
title ──Play──▶ playing ──Esc──▶ paused ──Resume──▶ playing
  ▲                │  │             │
  │                │  │ death/win   ├─Restart──▶ playing (fresh run)
  │                │  ▼             └─Quit to Title──▶ title
  └─Quit to Title──┴ gameover ──Play Again──▶ playing (fresh run)
                            └────Quit to Title──▶ title
```

- `init()` shows **title** instead of calling `startNewRun()`.
- The `requestAnimationFrame` loop keeps running in every phase, but only calls
  `update(delta)` while phase is `playing`. Other phases freeze the world while
  the loop still renders the last frame beneath the overlay.
- `Esc` toggles `playing ⇄ paused`.

## Screens (DOM overlay)

A single `#menu-overlay` element layered over the canvas (consistent with the
existing DOM HUD — simpler and more styleable than canvas-drawn menus). Exactly
one screen is shown at a time; the overlay is hidden while `playing`.

- **Title:** game title; buttons **Play** (starts a base-game run), **Open
  Editor**, **Quit**; and a stat line from saved meta:
  `Deepest: Level N · Runs: N · Treasure: ✓` (✓/✗ for `treasureStolen`). The Play
  button is laid out so a second "Custom" play button can be added beside it
  later without restructuring.
- **Pause** (shown on `Esc` during play): **Resume**, **Restart** (fresh run),
  **Quit to Title**.
- **Game over:** a win/loss heading and this run's deepest level; buttons **Play
  Again** (fresh run) and **Quit to Title**. Replaces the current "Press R to play
  again" log line and its `keydown` listener.

Navigation: clickable buttons AND keyboard — `↑`/`↓` move the highlighted
selection, `Enter` activates it, `Esc` pauses/resumes.

## Components

### `renderer/index.html`
Add a `#menu-overlay` container (absolutely positioned over `#canvas-wrap`,
hidden by default) with the title/pause/game-over markup and CSS. Keep the
existing HUD untouched.

### `renderer/systems/phase.js` (new, tiny, pure)
- `PHASE = { TITLE: 'title', PLAYING: 'playing', PAUSED: 'paused', GAMEOVER: 'gameover' }`.
- `canTransition(from, to)` — returns whether a transition is allowed, encoding
  the diagram above. Pure and unit-tested.

### `renderer/ui/menu.js` (new)
Owns the overlay DOM. No game logic; receives callbacks.
- `showTitle(meta, handlers)` where `handlers = { onPlay, onOpenEditor, onQuit }`.
- `showPause(handlers)` where `handlers = { onResume, onRestart, onQuitToTitle }`.
- `showGameOver(result, handlers)` where `result = { won, deepestLevel }` and
  `handlers = { onPlayAgain, onQuitToTitle }`.
- `hide()` — hide the overlay (entering `playing`).
- `formatMetaSummary(meta)` — pure helper returning the title stat string
  (`Deepest: Level N · Runs: N · Treasure: ✓`). Unit-tested.
- Internally wires click handlers and keyboard navigation (↑/↓/Enter) over the
  buttons of the currently shown screen.

### `renderer/game.js`
- Hold `phase` (default `title`). `init()` calls `showTitle(...)` instead of
  `startNewRun()`.
- The loop only calls `update(delta)` when `phase === PLAYING`; rendering of the
  game canvas continues so the frozen world shows under pause/game-over overlays.
- Add `Esc` handling: `playing → paused` (show pause screen, stop updates) and
  `paused → playing` (hide overlay, resume).
- Wire menu callbacks to transitions:
  - Title `onPlay` → `startNewRun()` + phase `playing` + `hide()`.
  - Pause `onResume` → phase `playing` + `hide()`; `onRestart` → `startNewRun()`;
    `onQuitToTitle` → `showTitle(meta, ...)` + phase `title`.
  - Game-over `onPlayAgain` → `startNewRun()`; `onQuitToTitle` → title.
  - `onOpenEditor` → `window.saveAPI.openEditor()`; `onQuit` →
    `window.saveAPI.quitApp()`.
- `endRun(won)` sets phase `gameover` and calls `showGameOver({ won, deepestLevel:
  state.run.deepestLevel }, ...)` instead of logging "Press R" and adding the
  `keydown` restart listener. Meta is still saved/run still deleted as today.
- `startNewRun()` is unchanged except it no longer runs at startup; callers set
  phase `playing` and hide the overlay.

### `main.cjs` + `preload.cjs`
- `main.cjs`: add `ipcMain.handle('open-editor', () => createEditorWindow())` and
  `ipcMain.handle('quit-app', () => app.quit())`. `createEditorWindow()` already
  exists.
- `preload.cjs`: expose `openEditor: () => ipcRenderer.invoke('open-editor')` and
  `quitApp: () => ipcRenderer.invoke('quit-app')` on `saveAPI`.

## Data Flow

`init()` loads meta → `showTitle(meta, handlers)`. Player clicks Play → game.js
sets phase `playing`, hides overlay, `startNewRun()`. During play, `Esc` →
`paused` (overlay shows, updates stop). Death/win → `endRun` → `gameover` overlay
with the run result. Quit-to-title re-reads `meta` (already in memory, updated by
`endRun`) and shows the title with refreshed stats.

## Testing

Unit-tested (pure, current `node --test` harness):
- `phase.canTransition` — allowed transitions return true, disallowed return
  false (e.g. `title→paused` false, `playing→paused` true, `gameover→playing`
  true via Play Again).
- `menu.formatMetaSummary(meta)` — formats deepest/runs/treasure, including the
  ✓/✗ for `treasureStolen` and a fresh-meta (zeros) case.

Not unit-tested (DOM/Electron shell — the suite does not import `game.js`,
`menu.js`, or render/DOM code; this matches the project's established testing
boundary):
- `menu.js` DOM rendering and `game.js` phase wiring — verified via
  `node --check` on changed files + a runtime Electron boot:
  - launch shows the title screen (no run auto-starts);
  - Play starts a run and hides the overlay;
  - Esc shows the pause screen and freezes the world; Resume returns to play;
  - dying shows the game-over screen with the run's deepest level;
  - Open Editor opens the editor window; Quit closes the app.

## Out of Scope

- Base-vs-custom asset separation and the "play with your created assets" mode
  (future follow-up). The title menu is laid out to accept a second play button.
- Settings/options screen, audio, controls-remap, in-menu animations.
