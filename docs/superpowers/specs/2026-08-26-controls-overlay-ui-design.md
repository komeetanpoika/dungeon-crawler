# Controls-Driven Menus & Overlay UI — Design

**Date:** 2026-08-26
**Status:** Approved (chat), pending spec review

## Summary

The touch controls stay on top of every screen and drive the menus
(red = confirm, Start = back). The top and bottom HUD bars disappear:
hearts, a restyled blue stamina bar, and the consumable item float over
the game canvas as 8-bit icons. Emoji item art is replaced everywhere
(HUD + backpack) by pixel icons rendered from the game's own sprite
atlas. The log bar's messages are re-routed into three feedback tiers
(pausing toast / above-player text / sound-only).

## 1. Controls on top

- `#touch-controls` z-index raised to **15** — above `#menu-overlay` (10),
  `#inv-overlay` (9), `#sign-overlay` (9); still below `#rotate-overlay`
  (20). Controls remain visible and tappable during every menu.
- No pointer-events changes needed: higher stacking order means taps on
  controls hit controls; taps elsewhere still reach the overlay beneath.

## 2. Menu navigation (red = confirm, Start = back)

The menus accept the controls' existing synthetic keys; the touch layer is
unchanged.

- `ui/menu.js` key handler: `w` = ArrowUp, `s` = ArrowDown, Space (` `) =
  Enter (activate selected). Cheat buffer behavior unchanged (no current
  cheat string is affected by `w`/`s` doing double duty).
- `ui/inventory-panel.js`: `w`/`a`/`s`/`d` mirror the four arrows for slot
  movement; Space triggers the primary action (Use/Equip); Escape (Start)
  closes as today. `x` (drop) unchanged.
- `ui/sign-panel.js` and the new toast dismiss on Space in addition to
  their current keys (F/Escape/Enter).
- Desktop is purely additive: arrows/Enter/Escape all keep working.
- Guard: the game's own Space handling must not fire while an overlay is
  open — already true (phase PAUSED gates attacking), but the menu key
  handlers must `preventDefault`/consume Space so the browser or a focused
  button cannot double-activate (web-shim already blurs clicked buttons).

## 3. Overlay HUD

`#hud-top` and `#hud-log` are deleted; `#canvas-wrap` fills the window.
A new `#hud-overlay` (fixed, pointer-events: none, z-index 4 — under the
touch controls) holds:

- **Top-left — hearts:** the existing pixel-SVG hearts, free-floating,
  with a dark drop shadow (CSS filter) for readability over bright tiles.
- **Under the hearts — stamina bar, blue:** pixel-framed bar (2px stepped
  8-bit border, notched tick marks every 25%), fill `#7dd3fc`, background
  near-black translucent; flashes red `#f87171` (fill + frame) while
  `player.staminaRefusedT > 0`. Width ≈ the heart row (~140px), height
  ~10px.
- **Top-right — consumable slot:** next-up quick-use item as a pixel icon
  (see §5) with an `×N` count badge; dimmed/grey when the sack has no
  consumables. Keeps publishing `data-quick-emoji` on the same element id
  (`hud-consumable`) so the touch button's empty-state observer is
  untouched.
- `LVL`, weapon text, and the message log have **no** permanent display.
- `updateHUD(state)` keeps its signature; hud.test.js is updated to the
  overlay structure (fakeDom unchanged in spirit).

## 4. Message routing (three tiers)

`speak()`/`think()` remain the API; their sinks change. The log array
(`state.log`) stays for internals/tests but is no longer rendered.

- **Tier A — pausing toast** (`ui/toast.js`): centered 8-bit panel in the
  sign-panel style; pauses via the same phase mechanism as signs; dismiss
  with Space (red), Enter, Escape (Start), or tap. Reserved for: first
  kill of each boss type, first opening of each overworld gate ("new
  area"), waking after death, and talent learned. Toast requests go
  through a new `toast(state, {title, lines})` call; game.js triggers.
  First-time-ness for bosses/gates persists in meta (fields
  `bossToastsSeen: string[]`, `gateToastsSeen: string[]`).
- **Tier B — above-player bubble:** the feedback float system gains a
  `bubble` kind rendered above the player's head in small pixel-styled
  text, ~2s fade. Default sink for `think()` (refusals, "too heavy",
  locked door, out of stamina, already full).
- **Tier C — nothing visual:** routine `speak()` lines whose events
  already carry sfx/animation (pickups, heals, equips, repeat gate
  openings, stance switches) are dropped or downgraded to Tier C
  explicitly in a routing table in game.js — every current call site gets
  an explicit tier in the implementation plan's audit table.

## 5. 8-bit icon system (`render/icons.js`)

- Renders sprites from the existing atlas (`render/sprites.js` names:
  `weapon_dagger`, `weapon_sword`, `weapon_longsword`, `weapon_axe`,
  `weapon_club`, `weapon_maunonmiekka`, `weapon_shortbow`,
  `weapon_longbow`, `weapon_sparkwand`, `weapon_stormwand`, `potion`,
  and `ow_mushroom` — the sprite the world already uses for mushrooms)
  to transparent data-URI PNGs at ×3
  nearest-neighbor upscale; cached per name.
- `iconFor(item)` maps an inventory item → sprite name:
  `potion`/`mushroom` by kind; `weapon`/`ranged` by
  `item.payload.weaponType` (fallback: generic sword / shortbow).
  Emoji stays on items as a text fallback (old saves render fine).
- Used by: HUD consumable slot (§3), backpack panel (every sack slot and
  both hand slots render `<img>` icons; `×N` count badge and text detail
  line unchanged), and nothing else (floating text stays text).
- Icon rendering needs the atlas loaded; the panel/HUD fall back to emoji
  text until sprites are ready (same await path the canvas renderer uses).

## 6. Touchpoints

- `renderer/index.html` — bars out, `#hud-overlay` in, z-index changes,
  overlay CSS (hearts shadow, blue pixel bar, consumable slot, toast, bubble).
- `renderer/ui/menu.js`, `ui/inventory-panel.js`, `ui/sign-panel.js` —
  key additions; `ui/toast.js` (new).
- `renderer/render/hud.js` — overlay rendering; `render/icons.js` (new).
- `renderer/systems/feedback.js` — bubble kind (or equivalent float path).
- `renderer/game.js` — message routing table, toast wiring, meta fields.
- `renderer/systems/meta.js` — persist `bossToastsSeen`/`gateToastsSeen`.
- Tests: `menu.test.js`, `inventory.test.js` (icon key derivation),
  `hud.test.js`, new `toast.test.js`, `icons` mapping tests,
  `feedback.test.js`; live emulated-phone check: navigate the title menu
  with stick + red button, dismiss a toast, HUD overlay screenshot.

## Out of scope

- No animation work beyond the bubble/toast (animations replacing Tier B
  placeholders come later per event).
- Touch button visuals unchanged (blank colour discs stay).
- No desktop keybinding removals.
