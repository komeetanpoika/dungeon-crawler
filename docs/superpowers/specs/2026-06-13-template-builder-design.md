# Template Builder — Design

**Date:** 2026-06-13
**Status:** Approved design, pending implementation plan

## Goal

A grid-painting UI inside the existing tile editor for authoring **room/landmark
templates** — the hand-built map pieces the game stamps into procedurally
generated dungeons (`DRAGON_LAIR`, `SHRINE`, `VAULT`, …). Build a room visually,
save it, then wire it to a depth by hand to see it in-game.

This is a third tab in the tile editor, alongside Draw and Rules. It is the
"room/template" scope of the broader "build a level in the UI" idea; a full
hand-painted floor (replacing BSP for a depth) is a deliberate non-goal here and
can be a follow-on.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Scope of one built artifact | **Reusable room/template**, embedded into generated floors as a `landmark`. Not a full floor. |
| Grid size | **Resizable, set on creation** (W×H chosen for a new template; resizable later). |
| Palette | **All 11 existing symbols**, driven by a shared, **extensible** legend. |
| Full loop | **Save only; wire to a depth by hand.** Editor never edits `LEVEL_CONFIG`. |
| Legend source of truth | **Refactor `placeTemplate` to be data-driven**, sharing one legend with the builder. |
| Cell rendering | **Flat colors + entity icons** (theme-neutral), not actual tile sprites. |

## Architecture

One new editor tab + one shared legend + one new data file. Data flow mirrors the
existing ruleset path:

**Build tab → `renderer/data/templates.json` → `levels.js` merges into `TEMPLATES` → game stamps as landmark.**

The editor writes only the JSON (through the preload bridge); it never edits game
code. Assigning a template to a depth is a manual one-line edit in `LEVEL_CONFIG`.

### 1. Shared legend — `renderer/data/levels.js`

Today the symbol→meaning mapping is hard-coded inside `placeTemplate`'s if/else
chain (`renderer/systems/map.js`). Extract it into one exported table:

```js
// renderer/data/levels.js
export const TEMPLATE_LEGEND = {
  '#': { label: 'Wall',       kind: 'tile',  tile: TILE.WALL,     color: '#444444' },
  '.': { label: 'Floor',      kind: 'tile',  tile: TILE.FLOOR,    color: '#2a2a3a' },
  'C': { label: 'Column',     kind: 'tile',  tile: TILE.COLUMN,   color: '#6a6a7a' },
  'T': { label: 'Treasure',   kind: 'tile',  tile: TILE.TREASURE, color: '#caa033', icon: '◆' },
  'S': { label: 'Shrine',     kind: 'tile',  tile: TILE.SHRINE,   color: '#3a6a8a', icon: '⛨' },
  'X': { label: 'Snare',      kind: 'tile',  tile: TILE.SNARE,    color: '#7a3a3a', icon: '※' },
  'L': { label: 'Door',       kind: 'spawn', spawn: 'door',       color: '#8a6a3a', icon: '⌷' },
  'W': { label: 'Weapon',     kind: 'spawn', spawn: 'weapon',     color: '#3a8a6a', icon: '⚔' },
  'P': { label: 'Potion',     kind: 'spawn', spawn: 'potion',     color: '#8a3a8a', icon: '⚗' },
  'D': { label: 'Dragon',     kind: 'spawn', spawn: 'dragon',     color: '#a33333', icon: '🐉' },
  'B': { label: 'Dragon Boss',kind: 'spawn', spawn: 'dragon_boss',color: '#cc2222', icon: '🐲' },
}
```

(Exact colors/icons are illustrative; the implementer may tune them. The legend
is the single source of truth for both the game and the builder palette.)

**`placeTemplate` refactor (`renderer/systems/map.js`):** the long if/else
collapses into a loop over the legend:

- For each character, look it up in `TEMPLATE_LEGEND`.
- `kind: 'tile'` → set `map[ty][tx].tile = entry.tile`; set `roomId` for any
  non-wall tile (preserving today's behavior, where walls do not get a `roomId`).
- `kind: 'spawn'` → set the underlying floor tile + `roomId`, then push the spawn
  (`{ kind: entry.spawn, x, y, roomId }`). `dragon_boss` keeps its
  "only place the first one" guard.
- Unknown / unmapped characters are ignored (unchanged behavior).

This must be behavior-preserving on the existing templates — see Testing.

**Future extension:** adding a new symbol (e.g. a new monster) is a single new
legend entry; both `placeTemplate` and the builder palette pick it up with no
further changes.

### 2. Build tab UI — `tools/tile-editor/`

A third tab in the editor shell (`index.html`): **▣ Draw · ▦ Rules · ▤ Build**,
toggled by the existing `showTab()` pattern in `editor.js`. New `#build-view`
main, hidden/shown alongside `#draw-view` / `#rules-view`. Logic lives in a new
`tools/tile-editor/template-builder.js` module (keeping `editor.js` thin, like
the other tab modules).

Three-column layout mirroring the Draw tab:

- **Toolbar (left):** pencil, eraser (paints `.` floor — the neutral cell), fill,
  picker.
- **Canvas (center):** a W×H grid. Each cell filled with the active symbol's
  legend `color`; spawn/marker symbols additionally draw their `icon` glyph
  centered in the cell. A light grid line separates cells. Click-drag paints the
  active symbol; eraser paints floor.
- **Sidebar (right):**
  - **Palette:** one button per legend entry, showing its icon + label and color
    swatch. Clicking selects the active paint symbol.
  - **Template name** field (e.g. `MOSS_CRYPT`); sanitized to `[A-Z0-9_]`.
  - **Width / Height** number inputs + a **Resize** action.
  - **Save template** button (reuses the header `.save` button slot, swapped per
    active tab like the existing Save tile / Save rules buttons).

**New-template flow:** choose width × height → blank grid pre-filled with wall
`#` (templates are conventionally wall-bordered). Painting floor carves the
interior. **Resize** preserves painted content within the new bounds (crop on
shrink, pad with wall on grow).

- **Library strip (bottom):** reuse the existing `#library-bar` region while the
  Build tab is active to list available templates (built-in `TEMPLATES` + custom
  from `templates.json`). Clicking one loads it as an editable base ("save as new"
  semantics, like the tile library). Built-in vs custom is visually marked.

### 3. Storage & loading

- New file **`renderer/data/templates.json`**, written through the preload
  bridge — mirroring `rulesets.json`. Two new IPC methods, `loadTemplates` /
  `saveTemplates`, added to `editor-preload.cjs` and handled in `main.cjs`.
- Entry shape is identical to the inline templates:

```json
{
  "MOSS_CRYPT": {
    "tiles": ["########", "#......#", "#..S...#", "#......#", "########"],
    "width": 8,
    "height": 5
  }
}
```

- **`levels.js`** imports `templates.json` and **merges** it into the exported
  `TEMPLATES` map (built-ins first, custom second). Built-in and custom templates
  are then indistinguishable to the game and to `LEVEL_CONFIG.landmark`.
  - Import is best-effort: if `templates.json` is missing or malformed, it is
    treated as empty and the built-in `TEMPLATES` behave exactly as today.
  - Name collisions: a custom template may **not** override a built-in name (see
    Error handling); the merge keeps built-ins authoritative.

### 4. Getting it in-game (manual wiring)

After saving, assign the template to a depth by editing one line in
`LEVEL_CONFIG` (`renderer/data/levels.js`), e.g. `landmark: 'MOSS_CRYPT'`. Because
`levels.js` merges the JSON, the name resolves with no further code. The editor
does not touch `LEVEL_CONFIG`.

## Error handling

- **Save requires a non-empty name**, sanitized to `[A-Z0-9_]`.
- **Overwrite a custom template** → confirmation prompt (using the existing
  in-page `text-prompt` / confirm mechanism; `window.confirm`/`prompt` are
  unsupported in this Electron setup).
- **Built-in names are protected:** a name that collides with a built-in
  `TEMPLATES` key can be *loaded as a base* but **cannot be saved** under that
  name (built-ins live in code, not JSON); saving is blocked with a clear message.
- **Missing/invalid `templates.json`** (editor side) → treated as no custom
  templates; the tab opens empty.
- **Missing/invalid `templates.json`** (game side) → ignored; game runs exactly
  as today.

## Testing

- **`placeTemplate` regression (unit, `node --test test/`):** drive the
  refactored, legend-based `placeTemplate` over every built-in template and
  assert the produced tiles + spawn list match the pre-refactor behavior.
  Explicitly cover: each legend symbol maps to the correct tile/spawn; non-wall
  tiles get a `roomId` and walls do not; the `dragon_boss` single-placement guard;
  unknown characters are ignored.
- **`templates.json` merge (unit):** custom templates appear in `TEMPLATES`;
  malformed/missing JSON yields the built-ins unchanged; a custom entry cannot
  shadow a built-in name.
- **Builder UI:** exercised manually (dev tool, not shipped game code) — paint,
  resize (crop/pad), save, reload-as-base, overwrite confirmation, built-in-name
  block.

## Out of scope (v1)

- Full hand-painted floors that replace BSP generation for a depth.
- Editing `LEVEL_CONFIG` / depth binding from the editor.
- Rendering cells with real, theme-specific tile sprites.
- Multi-room composition, copy/paste between templates, undo across resize.
