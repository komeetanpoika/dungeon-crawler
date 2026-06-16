# Adjacency rules UI rethink (tile editor Rules tab)

**Issue:** #3 — *Tile editor: adjacency rules need a UI rethink*
**Date:** 2026-06-16

## Problem

The editor now has two adjacency models that coexist with no unified UI:

1. **Hand-authored hard gate** — `allow` / `forbid` / `directional` per tag, edited in
   the Rules tab. Consumed by `pairAllowed` in `renderer/systems/decorate.js`: it
   decides which candidate tiles **may** sit next to a neighbor (forbid beats
   allow; a non-empty directional list overrides allow for that direction).
2. **Learned soft weights** — per-tag `adjacency: {n,e,s,w}` frequency tables and
   base-tag `overlays` distributions, written by the Build-tab painter's
   `deriveRules`. Consumed by `adjacencyScore` in the same file: among the tiles
   that survive the hard gate, it biases the weighted random pick toward neighbor
   pairings observed in the painting.

The learned data — now the primary placement mechanism — has **no UI at all**.
You can't see or understand what a painting taught the ruleset; you can only
re-paint and re-derive. There is also no single view that relates the hard gate
to the learned bias, so it's hard to tell why the engine places what it does.

## Goals

- Surface the learned `adjacency` and `overlays` data for the selected tag in the
  Rules tab.
- Present it in one coherent per-tag panel that visually distinguishes the
  editable hard gate from the read-only learned bias, with a one-line explainer of
  how they combine.
- Visualize learned frequencies as a per-direction list with proportion bars.

## Non-goals

- The learned values are **read-only**; editing is by re-painting + re-derive. No
  hand-editing of frequency counts.
- No change to the engine (`decorate.js`) or the derived data model.
- No matrix/heatmap alternative views (per-direction bar list only).
- No new visualization for any tag other than the selected one.

## Data model (existing, for reference)

```
ruleset.tags[tag] = {
  role: 'floor' | 'wall' | 'overlay',
  allow: ['*'], forbid: [], directional: { n:[], e:[], s:[], w:[] },   // hard gate
  adjacency: { n: {neighborTag: count}, e: {...}, s: {...}, w: {...} }, // learned
  overlays: { '': count, overlayTag: count }                            // base tags only
}
```

- Tags created via add-tag / save-tile have the hard-gate fields but **no**
  `adjacency` (and no `overlays`).
- Painter-derived tags have `adjacency`; base-role derived tags also have
  `overlays`.

## Components

### `tools/tile-editor/adjacency-view.js` (new, pure + thin renderer)

Pure view-model builders (no DOM — unit-tested):

```
adjacencyViewModel(tagDef) -> { n: Row[], e: Row[], s: Row[], w: Row[] }
overlaysViewModel(tagDef)  -> Row[] | null
```
where `Row = { tag: string, count: number, frac: number }`.

- `adjacencyViewModel`:
  - For each direction `d` in `n,e,s,w`: take `tagDef.adjacency?.[d]` (an object
    of `neighborTag -> count`), drop entries with `count <= 0`, sort by `count`
    descending (ties broken by tag name ascending for stable output), and compute
    `frac = count / maxCountInThatDirection` (the largest bar in a direction is
    full width). An absent/empty direction yields `[]`.
  - If `tagDef.adjacency` is absent entirely, every direction is `[]`.
- `overlaysViewModel`:
  - `null` when `tagDef.overlays` is absent.
  - Otherwise a single sorted list (count desc, tie by tag asc) over all keys;
    the `''` key is presented with `tag: '(none)'`. Entries with `count <= 0` are
    dropped. `frac = count / maxCount`.

Thin DOM renderer (verified via Playwright, not unit-tested):

```
renderLearned(container, tagDef)
```
- Clears `container`, then appends:
  - the explainer line;
  - a "Learned neighbors (from painting)" block: one row per direction
    (`N/E/S/W` label) listing each `Row` as `tag` + a bar (`width = frac*100%`) +
    the count. If all four directions are empty → a single muted line "No learned
    data — derive from a painting (Build tab)." instead of the block.
  - if `overlaysViewModel` is non-null and non-empty: a "Learned overlays" block
    rendered the same way (single list, no direction labels).

### `tools/tile-editor/rules-ui.js` (modify)

- Import `renderLearned`.
- In `render()`, append a learned-section container **after** the member-tile-
  weights section and **before** the delete-tag button (so delete stays last),
  and call `renderLearned(container, rule)` for the selected tag.
- Add `'overlay'` to the role `<select>` options (currently only `floor`/`wall`),
  so overlay-role tags surfaced here display their role correctly instead of
  silently showing `floor`.

### `tools/tile-editor/index.html` (modify)

- Add minimal CSS for the learned bars: a `.adj-row` line, a `.adj-bar` element
  (filled proportional to `frac`), and a muted label style. Reuse existing
  `.label` where possible.

## Visual layout (rule panel, tag `floor.moss`)

```
role [floor ▾]
may neighbor   *  + add
never neighbor wall.brick  + add
directional override  N[…] E[…] S[…] W[…]
member tile weights   custom_moss_1 [1.0]
────────────────────────────────────────
Rules above gate adjacency; learned values below only bias the pick.
Learned neighbors (from painting)
 N  floor.moss ████████ 8   floor.dirt ██ 2
 E  floor.moss ██████ 6      wall.brick ████ 4
 S  floor.moss ███████ 7
 W  floor.moss █████ 5       floor.dirt ███ 3
Learned overlays
    (none) ██████ 6   overlay.barrel ██ 2
```

## Testing

- **Unit (`test/adjacency-view.test.js`, `node --test`):**
  - `adjacencyViewModel`: sorts by count desc with name tie-break; `frac` is
    relative to the per-direction max (top row `frac === 1`); zero/negative counts
    dropped; missing direction → `[]`; missing `adjacency` → all four `[]`.
  - `overlaysViewModel`: `null` when no `overlays`; `''` rendered as `(none)`;
    sorted desc; `frac` relative to max; empty object → `[]`.
- **DOM flow (Playwright, throwaway):**
  - Select a painter-derived tag → the "Learned neighbors" block renders with the
    expected counts and at least one full-width bar; if the tag has `overlays`,
    the "Learned overlays" block renders.
  - Select a hand-authored tag with no `adjacency` → the "No learned data" hint
    shows instead of the block.
  - The role `<select>` for an overlay-role tag shows `overlay` selected.

## Data flow

```
select tag ─▶ rules-ui render() ─▶ renderLearned(container, rule)
                                      ├─ adjacencyViewModel(rule) ─▶ per-direction bars
                                      └─ overlaysViewModel(rule)  ─▶ overlay bars
(read-only; to change values, re-paint in Build tab and ⚙ Derive again)
```
