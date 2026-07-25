# Mobile Touch Controls for the Web Release — Design

**Date:** 2026-07-25
**Branch:** web-release
**Status:** Approved design, pending implementation plan

## Goal

Make the Cloud Run web release playable on phones: a virtual joystick plus HUD
action buttons layered over the existing game, with the display fixes needed
for the page to render correctly on mobile (viewport meta, DPR-sharp canvas,
safe-area insets). Desktop web and Electron behavior must be unchanged.

## Context (current architecture)

- Input is real-time free movement: a `keys{}` held-key map (`renderer/game.js:69`)
  fed by `window` keydown/keyup listeners (`game.js:70-100`) and polled every
  frame in `update()` (movement `game.js:328-334`, melee `448-455`, ranged
  `498-516`).
- Actions: move (WASD/arrows), attack (Space, held), stance toggle melee↔ranged
  (Shift, edge-triggered), fountain toggle (F), pause (Escape). All pickups and
  interactions are walk-onto; there is no inventory/use-item key.
- HUD is DOM, not canvas (`renderer/index.html:43-53`, `renderer/render/hud.js`).
- Canvas backing store equals CSS pixel size with no devicePixelRatio handling
  (`renderer/render/canvas.js:638-642`); camera centers on the player, world
  renders 1:1 at 32 px tiles.
- Web build = same renderer + `renderer/web-shim.js` (localStorage saveAPI,
  keyboard preventDefault), served by `tools/web-server.mjs` in a container.
- `index.html` has no viewport meta tag; no touch/pointer handling exists.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Movement scheme | Floating virtual joystick (8-way), not d-pad or tap-to-move (game is real-time; tap-to-move would need pathfinding and change game feel) |
| Orientation | Landscape only; portrait shows a rotate overlay (iOS browsers cannot lock orientation) |
| Scope | Controls + display fixes (viewport meta, DPR canvas, safe areas); no PWA/installability work |
| Integration | Touch layer dispatches synthetic `KeyboardEvent`s; zero changes to game input logic |

## Design

### 1. Activation & integration

New self-contained module `renderer/ui/touch-controls.js`, loaded from
`index.html` after `web-shim.js`.

- Activates only when `matchMedia('(pointer: coarse)')` matches. Desktop web
  and Electron see no controls and no behavior change.
- Emits input by dispatching synthetic `KeyboardEvent('keydown'/'keyup')` on
  `window` for keys the game already understands (`w/a/s/d`, `' '`, `Shift`,
  `f`, `Escape`). The existing listeners translate them into `keys{}` exactly
  as physical keys would, including edge-triggered Shift/Escape handling.
- Safety: on `pointercancel`, `window` `blur`, or `visibilitychange` →
  hidden, the module dispatches keyup for every key it is currently holding
  (no stuck movement/attack).
- Multi-touch via Pointer Events: each control tracks its own `pointerId`, so
  joystick + attack work simultaneously.

### 2. Layout (landscape, two-thumb)

- **Joystick — left half of the screen.** `pointerdown` anywhere in the left
  zone anchors a floating stick under the thumb. Drag beyond a dead zone
  (~12 px) quantizes the vector to 8 directions and emits the matching
  W/A/S/D keydowns (diffing against the previous set; keyups for directions
  that left the set). `pointerup` releases all movement keys and hides the
  stick. Visuals: semi-transparent base ring + nub that follows the thumb,
  clamped to the ring radius.
- **Attack — bottom-right.** Large button (~64-72 px visual, larger hit
  target). Press = Space keydown (held), release = keyup. Matches existing
  hold-to-swing / hold-to-fire behavior.
- **Stance toggle — above attack.** Tap = one synthetic Shift keydown+keyup.
  Shows the current stance icon (🗡/🏹) so it doubles as a status indicator;
  updated by reading the same state the HUD uses.
- **Pause — top-right corner.** Tap = Escape.
- **Fountain (F) — small button near the action cluster.** Always visible
  but visually subdued. (Making it contextual — shown only near a fountain —
  is a possible follow-up, not part of this design.)
- All controls are DOM elements positioned with
  `max(fixed-margin, env(safe-area-inset-*))` so nothing sits under the notch
  or home indicator.
- **Portrait:** full-screen "rotate your device" overlay via CSS
  `@media (orientation: portrait) and (pointer: coarse)`. No JS involved.

### 3. Display fixes

- Add to `index.html`:
  `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">`
- CSS: `touch-action: none` on the canvas and control layer;
  `overscroll-behavior: none` on the page (kills scroll, pinch-zoom,
  pull-to-refresh during play).
- **DPR-sharp canvas** (`renderer/render/canvas.js`): `resize()` sets the
  backing store to CSS size × `devicePixelRatio` and applies
  `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`; camera and view math use logical
  (CSS-pixel) width/height so nothing else changes. Also sharpens desktop
  hi-DPI rendering. This is the only change inside existing rendering code.
- Menus already use DOM buttons with click handlers — tap-ready as-is.

### 4. Error handling

- Stuck-key prevention as in §1 (pointercancel/blur/visibilitychange).
- Joystick ignores additional pointers in its zone while one is active;
  buttons ignore pointers other than the one that pressed them.
- If `pointer: coarse` is false the module installs nothing — no listeners,
  no DOM.

### 5. Testing

- **Unit (`node:test`):** joystick math extracted as a pure function —
  vector → dead zone → 8-way quantization → key-set diff (which keydowns/
  keyups to emit). Covers dead zone edges, diagonal boundaries, release.
- **Integration (Playwright, chromium touch emulation, time-boxed):** on a
  coarse-pointer mobile viewport — controls appear; a synthetic drag in the
  joystick zone moves the player; attack button triggers a swing; desktop
  viewport shows no controls.

## Out of scope

- PWA manifest / add-to-home-screen / fullscreen API prompts.
- Tap-to-move pathfinding, analog (non-8-way) movement, camera zoom for
  small screens, portrait layout.
- Any change to Electron behavior or game logic.
