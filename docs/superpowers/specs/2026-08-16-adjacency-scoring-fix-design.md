# Adjacency scoring fix — per-tile tables + a bounded noise floor

**Date:** 2026-08-16
**Amends:** `2026-06-13-paint-to-derive-rules-design.md` §1 "Engine — two-layer selection"
(the `score = weight × Π(adjacency + ALPHA)` formula defined there)

## Problem

Painted rulesets did not reproduce the painting. Measured on the shipped
rulesets, in contexts where the painting *did* offer evidence, the scorer put
**49% (outdoors) / 69% (castle)** of its probability mass on tile pairings the
painting never showed — worst context 98%. Three causes:

1. **The smoothing floor scaled with the ruleset.** `ADJACENCY_ALPHA` was a flat
   `0.5` added per candidate, so the unobserved group's total mass grew linearly
   with the number of tiles. An 18-sprite wall set drowned its own signal;
   adding sprites made adjacency *weaker*.
2. **Frequency was counted twice.** `weight` (the raw paint count from
   `deriveRules`) multiplied an adjacency `count` that is itself proportional to
   paint frequency, squaring the prior. A sprite painted 10× outbid the correct
   answer in contexts where it had never appeared.
3. **Adjacency was learned per tag but applied per tile.** All 17 `castle.wall`
   sprites shared one tag, so every candidate scored identically (verified: 16
   candidates, 1 distinct score) and the pick collapsed to weight-only noise.

## Change

### `derive-rules.js`

`tiles[name]` gains `neighbors: { n, e, s, w }`, keyed by the **exact neighbouring
tile name**. The per-tag `adjacency` tables are unchanged and still emitted; the
new table is strictly additive, so older rulesets keep working.

### `decorate.js`

- **`adjacencyCount(ruleset, tileName, nb)`** (new, exported) — the observed count
  for one candidate/neighbour pair. A tile the painting covered carries its own
  per-sprite table and that wins outright: an absent entry there is a real
  "never seen", not a reason to consult the coarser tag table. A tile the
  painting never covered falls back to its tag's table, scaled by the tile's
  share of the tag's total weight so within-tag weights still separate siblings.
- **`ADJACENCY_EPSILON = 0.02`** (new) — the share of a context's observed mass
  reserved for unseen pairings. `pickByAdjacency` computes each neighbour's
  context mass across the candidate set and sets that neighbour's floor to
  `EPSILON × mass / candidateCount`, so the unobserved group's total stays at
  ~2% **regardless of ruleset size**.
- **`adjacencyScore(…, alphas = null)`** — takes an optional per-neighbour floor.
  Callers without a candidate set (the overlay pass) keep the flat
  `ADJACENCY_ALPHA`.
- **`pickByAdjacency`** no longer multiplies by `weight`: the observed counts are
  the posterior already. A neighbour whose context mass is zero is dropped as
  uninformative, and when no neighbour is informative the pick falls back to
  `pickWeighted` — preserving the documented "no adjacency data ⇒ weight-only"
  behaviour.
- `tagMass` is memoized per ruleset in a `WeakMap`, dropped at the top of each
  `decorateMap` pass so live weight edits in the editor are picked up.

## Results

| | before | after |
|---|---|---|
| outdoors — mean P(pairing never shown) | 49.3% | 1.4% |
| outdoors — worst context | 95.4% | 1.9% |
| castle — mean P(pairing never shown) | 69.0% | 1.6% |
| castle — worst context | 98.3% | 1.8% |
| castle — wall sprites reproduced exactly | ~6% (chance) | 64.6% |
| decorate cost, 80×50 level (outdoors) | 210 ms | 176 ms |

Per-cell reproduction of the castle painting decays left-to-right —
**94–99%** on the left and top edges, **~10%** on the right edge — because
`decorateMap` still consults only the already-decided **N and W** neighbours. A
right-edge sprite is identifiable only by what lies to its *east*, which the scan
never looks at. See "Not addressed" below.

## Not addressed

- **No E/S lookahead, no propagation, no backtracking.** The `e`/`s` halves of
  the learned tables are derived but never read. This is what still puts a roof
  tile on bare ground and randomises right/bottom edges. Fixing it means either a
  cheap role-lookahead (score against the *role* of the undecided E/S cells) or a
  real WFC-style solve.
- **Painted scenes vs dungeon topology.** The `outdoors` painting is a house
  needing five contiguous wall rows; BSP dungeon walls are 1–2 cells thick, so
  the structure has nowhere to form. Buildings belong in the prefab path
  (`placeStructure`), not the decoration pass.

## Migration

Existing rulesets work unchanged via the tag fallback and get the noise-floor fix
immediately. To gain the per-tile tables, re-derive:

- `castle` — `node tools/derive-castle-ruleset.mjs` (done)
- `outdoors`, `catacombs` — open the tile editor, Build tab, **⚙ Derive rules**

## Testing

`test/derive-rules.test.js` — per-tile tables recorded per direction, two tiles
sharing a tag distinguished, repeats accumulated, overlay layer covered, layers
never crossed.

`test/decorate.test.js` — per-tile table beats the tag table; an absent entry is
a real zero; weight-shared tag fallback; the unobserved-pick rate stays inside the
epsilon budget at both 2 and 20 candidates and does not degrade as candidates are
added; a heavily weighted sprite cannot win a context it never appeared in;
weight-only fallback when nothing was observed; and an end-to-end two-row wall
that must rebuild exactly as painted.
