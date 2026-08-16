# Tile editor UI simplification — one tag editor, group headings

**Date:** 2026-08-16
**Status:** Approved design, pending implementation plan

## Problem

The editor's three tabs are verbose in two specific ways, confirmed against live
screenshots of all three tabs:

1. **Controls that do nothing.** The Rules tab devotes three of its six control
   groups to the hard adjacency gate — `may neighbor`, `never neighbor`, and four
   `directional override` inputs. Every tag in every shipped ruleset carries
   `allow: ['*']`, `forbid: []`, `directional: {}`, so `pairAllowed` is a no-op in
   practice. Those groups are also why the panel needs the sentence *"Rules above
   gate adjacency; learned values below only bias the pick"* — it exists solely to
   disambiguate two competing models, one of which is never used.

2. **A heading per control.** Every control carries its own uppercase label line,
   so each sidebar reads label / control / label / control. The Draw sidebar runs
   ~520 px against a ~730 px viewport with six headings, pushing the tile-name and
   tags fields below the fold. The Build sidebar carries eight heading lines plus a
   button whose caption wraps to two lines.

A third problem falls out of fixing the first two: **tag assignment lives in three
places** — the Draw tab's `tags` field, the Build tab's role+tag+apply widget, and
the Rules tab's `+ new tag` with its per-tag role dropdown. Three UIs for one
concept.

## Decisions

| Question | Decision |
|---|---|
| Hard gate | **Out of the UI, stays in the engine.** Delete the controls and the explainer. `pairAllowed` and the ruleset schema are untouched, so hand-edited `allow`/`forbid`/`directional` still work and generated output does not change. |
| Chrome treatment | **Group headings with inline rows.** One heading per *set* of controls; inside a set, label and control share a line. |
| Tagging | **Unify into one tag editor.** The Rules tab becomes the single place tags and roles are defined. Draw's tags field is removed; Build's widget becomes a read-only status line. |

## Non-goals

Explicitly out of scope — these were considered and declined:

- **No progressive disclosure.** Nothing gets collapsed behind "advanced" toggles.
- **No re-layout.** Panel widths, tab structure and the middle canvas areas stay as
  they are. This is about what each sidebar contains and how it is labelled;
  rearranging controls *within* a sidebar (two preview canvases side by side, say)
  is in scope, moving or resizing the panels themselves is not.
- **No engine, schema, or generation changes.** `renderer/systems/decorate.js`,
  `derive-rules.js` and `rulesets.json` are untouched. The decorate/derive test
  suites keep passing unmodified.
- **The Draw toolbar is untouched.** Its seven buttons are neither dead nor
  label-per-control.

## 1. Rules tab — the single tag editor

Six control groups become three.

```
TAGS                 castle.floor
 castle.floor    4     role  [floor ▾]                    🗑 delete
 castle.wall    16   ──────────────────────────────────────────────
 overlay.castle  7   MEMBER TILES                          + add tile
 + new tag            [▦] tile_0048   [160]  ✕
                      [▦] tile_0050   [  6]  ✕
                      [▦] tile_0030   [  3]  ✕
                     ──────────────────────────────────────────────
                     LEARNED FROM PAINTING
                      N  castle.floor ███████ 147
                      E  castle.floor ███████ 153
                      S  castle.floor ███████ 147
                      W  castle.floor ███████ 153
                         overlay (none) █████ 155
```

**Removed:** the `may neighbor` chip list, the `never neighbor` chip list, the four
`directional` inputs, and the explainer line in `renderLearned`.

**Changed:** the tag name becomes the panel's first group heading; `role` and
`delete tag` share one inline row beneath it. `Learned neighbors (from painting)`
and `Learned overlays` merge under one `LEARNED FROM PAINTING` heading, with the
overlay row set off by spacing rather than its own heading.

**New — member-tile assignment.** The member list is currently read-only apart
from weights, so making Rules the single tag editor requires the ability to put a
tile *into* a tag:

- Each member row gains a **22 px thumbnail** (`tile_0048` versus `tile_0026`
  carries no meaning as text) and a **✕** that removes the tile from the tag.
- **`+ add tile`** puts the bottom library strip — already visible on this tab —
  into **pick mode**. The strip shows `pick a tile for castle.floor · esc to
  cancel`, the next click assigns that tile, and Esc or a second click on
  `+ add tile` cancels.
- Assigning writes `ruleset.tiles[name] = { tags: [tag], weight: existing ?? 1 }`,
  matching the single-tag convention the editor already uses everywhere. Role lives
  on the tag, never on the tile, so moving a tile between tags changes the role it
  decorates under with no separate step.
- Removing the last tag from a tile deletes it from `ruleset.tiles` entirely.
- A derived `neighbors` table on a reassigned tile is left as-is; it is regenerated
  wholesale by the next ⚙ Derive rules, as it always has been.

**Consequence:** a ruleset's tile list becomes exactly its tagged tiles. An
untagged tile is simply a library sprite — there is no orphan state to explain.

## 2. Draw tab

Six headings become three, roughly halving the sidebar height so nothing falls
below the fold at 1440×900.

```
PREVIEW                        COLOUR                    TILE
 [1:1] [3×3 seamless]           ▪▪▪▪▪▪▪▪                  name  [moss_floor_1 ]
 (captions under, not             custom  [■]                   saves as: custom_moss_floor_1.png
  headings over)
```

- The two preview canvases sit side by side under one heading, each with a small
  caption beneath instead of an uppercase heading above.
- `Palette` and `Custom color` merge under `COLOUR`, with custom colour as an
  inline row.
- The `Tile name (saved as custom_<name>)` heading shrinks to `name`; the existing
  `tileNameHint` output already reads `saves as: custom_x.png`, so the rule the
  heading used to state is carried by the live hint.
- **The `tags` field is removed.** `editor.js`'s save-tile handler no longer reads
  it and no longer registers the tile in the active ruleset. It writes the PNG,
  refreshes the library and Build palette, and toasts
  `Saved custom_moss_floor_1 — add it to a tag in Rules`.

## 3. Build tab

Eight heading lines become four.

```
MAP                              LAYER                        RULES
 [castle ▾] + ✎ 🗑                 [base][overlay][props]        brush  tile_0048 · castle.floor →
 size    [16] × [12] [resize]     mode   [collision][interact]  [⚙ Derive rules]
 history [↶] [↷]                         [structure]
                                  value  [walkable][wall]      PREVIEW
                                  export [castle] [5] [⛫]       [canvas]
                                                                [⟳ re-roll]
```

- `Size (width × height)` and the unlabelled history row become inline rows under
  `MAP`.
- The property sub-panel's three headings (`Property`, `Collision`,
  `Interaction`) become inline `mode` / `value` rows under `LAYER`, and the
  structure export collapses from a full-width button plus a name input plus a
  `target depth` row into one `export` row.
- **The tagging widget is replaced by a status line.** Four controls (heading,
  role `<select>`, tag `<input>`, `apply tag` button) become one row:
  `brush  tile_0048 · castle.floor →`, or `brush  tile_0071 · untagged →` in amber
  when the brush has no tag. It is not editable.
- The derive button loses its second line: `⚙ Derive rules`. The target ruleset is
  already named in the header, so `→ active ruleset` was redundant.
- `Preview outcome` becomes `PREVIEW`, with `re-roll` inside the group.
- Both status readouts — `#export-report` and `#derive-report` — are **kept**, each
  directly beneath the button that writes it. They are output, not chrome, and they
  occupy no height until something is reported.

**Click-through.** Clicking the brush status dispatches
`assign-tile` with `{ tile, tag }`. `editor.js` switches to the Rules tab;
`rules-ui.js` enters **assign mode**: the tag list shows
`assigning tile_0071 — pick a tag`, the tile's current tag (if any) is highlighted,
and clicking any tag assigns the tile to it and leaves assign mode. Clicking the
tile's existing tag, or pressing Esc, leaves assign mode without changing
anything. Retagging mid-paint is one click out and one click back.

Assign mode and pick mode are **complements, not the same path**: pick mode picks
a *tile* for a known *tag* (entered from `+ add tile`), assign mode picks a *tag*
for a known *tile* (entered from Build). They share only the mutation helper,
`assignTileToTag`. Only one may be active at a time; entering either cancels the
other.

## Components

### `tools/tile-editor/tag-edit.js` (new, pure)

Mutation helpers, no DOM, unit-tested — following the `derive-rules.js` /
`adjacency-view.js` precedent of pure core plus thin renderer.

```
assignTileToTag(ruleset, tileName, tag)   // registers tile, sets tags:[tag], keeps weight
removeTileFromTag(ruleset, tileName, tag) // drops the tag; deletes the tile if it has none left
brushStatus(ruleset, tileName)            // -> { tile, tag: string|null, text, untagged: boolean }
memberTiles(ruleset, tag)                 // -> [[name, def], ...] (moved out of rules-ui.js)
```

`assignTileToTag` creates the tag with a permissive default
(`role`, `allow: ['*']`, `forbid: []`, `directional: {}`, empty `adjacency`) only
if it does not already exist, so hand-authored gates on an existing tag survive.

### `tools/tile-editor/library.js` (modify)

`buildLibrary` returns an object that gains:

```
setPickMode(handler | null, promptText)
```

With a handler set, a thumbnail click calls `handler(name)` instead of the default
load-as-base, the strip shows `promptText`, and hovered thumbnails highlight in
`#7fd`. Esc clears pick mode. A new `#library-mode` span inside `#library-bar`
carries the prompt.

### `tools/tile-editor/rules-ui.js` (modify)

Delete the `chipList` calls and the directional-input block. Render three groups.
Add the member add/remove UI and assign mode. Delegate all mutation to
`tag-edit.js`.

### `tools/tile-editor/adjacency-view.js` (modify)

Drop the explainer line from `renderLearned` and merge the two learned blocks
under one heading. `adjacencyViewModel` and `overlaysViewModel` are unchanged —
their unit tests keep passing as-is.

### `tools/tile-editor/map-painter.js` (modify)

`renderTagging()` → `renderBrushStatus()`, using `brushStatus()` from `tag-edit.js`
and dispatching `assign-tile` on click. Restructure the sidebar markup into four
groups. `ensureRuleset()` and the tag-creation branch move out with the widget.

### `tools/tile-editor/editor.js` (modify)

Drop the `#tile-tags` read and the ruleset registration from save-tile; update the
toast. Listen for `assign-tile` and switch to the Rules tab. Route the library
`onPick` through the new pick-mode handler.

### `tools/tile-editor/index.html` (modify)

Remove the tags input and its label. Restructure the three sidebars into group
headings and inline rows. Add CSS for `.grp` (heading with bottom rule), `.row` /
`.rlab` (inline label + control), `.cap` (canvas caption), `.thumb` (22 px member
thumbnail) and `#library-mode`.

## Data flow

```
Build: click brush status ──assign-tile {tile,tag}──▶ editor.js: showTab('rules')
                                                  └─▶ rules-ui.js: assign mode
                                                        │
Rules: click "+ add tile" ──▶ library.setPickMode(fn) ──┤
                                                        ▼
                                 click a tag / a thumbnail
                                                        │
                                                        ▼
                              tag-edit.assignTileToTag(ruleset, tile, tag)
                                                        │
                                       'rules-edited' ──┴──▶ live sample re-renders
                                                             (save via 💾 Save rules, as today)
```

Saving is unchanged: mutations go to the in-memory `state.rulesets` and reach disk
via the existing `💾 Save rules` button.

## Error handling

- `+ add tile` with no tag selected is not reachable — the button lives inside the
  selected tag's panel.
- Assigning a tile that already carries another tag **moves** it, matching the
  editor's existing single-tag convention. The Rules panel toasts
  `tile_0048 moved from castle.wall to castle.floor` so the change is not silent.
- Clicking the brush status with no active ruleset toasts
  `Create a ruleset first` and does not switch tabs.
- Pick mode is cancelled by Esc, by a tab switch, or by a ruleset change, so it
  can never strand the library strip in a modal state.

## Testing

**Unit (`test/tag-edit.test.js`, `node --test`):**
- `assignTileToTag` registers a new tile at weight 1; preserves an existing
  weight; creates a missing tag with permissive defaults; leaves an existing tag's
  `allow`/`forbid`/`directional` untouched; moves a tile that already had a tag.
- `removeTileFromTag` drops the tag; deletes the tile from `ruleset.tiles` when it
  has no tags left; is a no-op for a tile that is not a member.
- `brushStatus` returns `untagged: true` with the right text for an unregistered
  tile, and tag + text for a registered one; tolerates a null ruleset.
- `memberTiles` returns members in insertion order and `[]` for an unknown tag.

**Existing suites must pass unmodified** — `decorate`, `derive-rules`,
`adjacency-view`, `editor-lib`, `painter-maps`. If any of them needs an edit, the
change has exceeded this spec's scope.

**DOM flow (Playwright, throwaway script):**
- Rules tab shows three group headings and no `may neighbor` / `never neighbor` /
  directional inputs.
- `+ add tile` → library strip shows the prompt → clicking a thumbnail adds a
  member row with a thumbnail; ✕ removes it.
- Build brush status renders `tile · tag →`; clicking it lands on the Rules tab in
  assign mode; clicking a tag assigns and exits assign mode.
- Draw sidebar has no tags input, and its content fits without scrolling at
  1440×900.
