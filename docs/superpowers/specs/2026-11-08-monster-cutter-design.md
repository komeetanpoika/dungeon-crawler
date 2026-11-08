# Monster cutter: art cut into animated pieces

Date: 2026-11-08. Status: design, awaiting approval.

## Why

There are two kinds of monster today:

- **Procedural rigs** (`quadruped`, `lurker`) draw rectangles from a list of numbers
  (`PARAM_SCHEMA`) that the monster lab and the bench can tune.
- **Art rigs** (`monsteri`, `serpent`, `wraith`, the wolf NPC sheet) blit pictures. Monsteri is
  one flat frame from the user's crayon drawing that the rig slides, tilts, swells and flips. Its
  grabbing arms are red blocks drawn in code (`drawArms` in `systems/monsters/monsteri.js`), and
  its `head`/`chest` anchors are pixel spots measured by hand on the drawing. Each art rig has a
  one-off extraction script tuned to its one image.

The user wants the arms and legs of a drawn monster to move separately: **arms swing and legs
step while it walks**, and dragging a slider in the bench changes that motion. The pieces should
be found automatically from the uploaded art, after which the user corrects the cuts.

## What success looks like

Monsteri, re-cut from its own drawing, walks in `npm run bench -- monsteri` with its arms swinging
and its legs stepping. It reads as the drawing come alive rather than as a cut-out puppet, and
everything it does today still works: frost breath from the head, glowing orbs, arms from the
chest, the HP bar above its head, the hit flash and the death shrink.

A second drawing taken from the practice set (below) can be cut, walked in the bench and saved as
a monster without writing any code.

## Goals

1. A browser tool, the **cutter**, that takes an image, removes its background, proposes the
   pieces (torso, head, arms, legs, tail), and lets the user correct the cuts, the joint pins,
   the labels and the draw order. It previews the walk, idle and attack live and saves.
2. A shared **cut-out rig engine** that draws a monster from its saved pieces and animates them
   from numbers in the normal rig `PARAM_SCHEMA`, so the lab and the bench tune them like any
   other rig.
3. **Live rig sliders in the bench.** Its panel today only edits hook `tuning`, `stats` and
   `behavior`. It gains a section for the rig's params that applies on the next frame, and
   Save writes them.
4. **Monsteri moved onto the engine**, keeping its rig id, its exports and its hook contract.

## Non-goals (for now)

- Drawing new frames or in-between art. Motion comes only from moving the cut pieces.
- Separate views per facing direction. Monsters flip left/right as today.
- Mixing pieces between monsters (one monster's arms on another's body).
- Elbows and knees as separately animated joints. One joint per limb is enough for "arms swing,
  legs step". The piece tree allows deeper children (see below), but they ride along rigidly.
- Replacing monsteri's code-drawn grab arms with the cut arms. That is a follow-up.
- Breaking the death into falling pieces. Death stays the whole-figure shrink.
- Any AI or cloud service. The finding is plain image analysis on this machine.
- Shipping the cutter in the game or the web build.

## Anti-goals (failure even if it technically works)

- Visible gaps, seams or outline lines at the joints when a limb turns. That is the "cut-out
  puppet" look the user does not want.
- Re-cutting a monster overwrites hand-written rig code. Re-cutting rewrites data only.
- Monsteri loses any of its current behaviour, or its hook needs a rewrite.
- The tool needs a new npm dependency or a bundler.
- Frame time grows noticeably. Electron here renders on a software canvas, where draw calls are
  the budget (`tools/perf/trace.mjs`).

## Constraints

- Vanilla JS ES modules and no bundler, as in the rest of the repo. Image work runs on plain
  `{ w, h, rgba }` buffers in pure modules with no DOM, so `node:test` can run them, and
  `tools/png-read.mjs` / `tools/png-write.mjs` handle PNG files.
- The cutter is served by the existing loopback-only monster-lab server
  (`tools/monster-lab/server.mjs`, port 5180). It must never be reachable off-host, like the lab,
  and never served by `tools/web-server.mjs`.
- Rigs keep the contract the game loader expects: `RIG_ID`, `PARAM_SCHEMA` (types `range`,
  `color`, `toggle`) and `drawMonster(ctx, params, pose, S)`, plus the optional `hitHalf`,
  `hitShape`, `drawnTop` and `anchor`. The loader imports
  `renderer/render/monster-rigs/<rig>.js` by the def's `rig` field. Neither that nor
  `schema.js` changes.
- The pixel look stays: nearest-neighbour blits and frame-stepped animation (the other rigs use a
  4-step gait via `frameOf`), not smooth tweening.

## How it fits together

```
source image ──► cutter (browser, on the lab server)
                  │ background mask, auto pieces, user edits
                  ▼
assets/cuts/<name>.json          ← the cut: every decision, enough to redo the output
assets/cuts/<name>.<ext>         ← the source image (copied in on upload)
renderer/assets/monsters/<name>-parts.png   ← atlas of the finished pieces
renderer/assets/monsters/<name>-parts.js    ← PARTS: tree, pivots, roles, z, points (generated)
renderer/render/monster-rigs/<name>.js      ← rig module, written ONCE from a template
renderer/data/monsters/<name>.json          ← def, created only if missing
                  │
                  ▼
render/monster-rigs/cutout.js  (shared engine) ◄── game, lab, bench
```

### The piece model

A cut monster is a **tree of pieces**. Each piece has:

- `id` and a `role`: `torso`, `head`, `arm`, `leg`, `tail`, `weapon` or `extra`.
- `side` (`left`/`right`) for arms and legs, which sets the phase of the walk.
- `parent` (the torso is the root) and a **pivot**, the joint pin in the parent's frame.
- `z` (draw order). Pieces behind the torso draw first.
- its rectangle in the atlas, plus the offset that places it relative to its pivot.

The monster also has **named points**, each attached to a piece so they move with it: `head`,
`chest` and any others a rig wants (monsteri's three orb tips). It also has a **view**, `front`
or `side`, that the user picks in the cutter.

Roles drive the motion:

| role | idle | walk | attack |
|---|---|---|---|
| torso | breath (slight vertical grow) | bob, sideways lean | swell + lunge (as monsteri today) |
| head | rides the torso, small nod | small nod a step behind the bob | — |
| arm | slight sway | swings around its pivot, left and right in opposite phase. Front view: a sideways pendulum; side view: forward and back | raised toward the facing by `attackReach` |
| leg | still | front view: lifts in turn (`stepHeight`) with a slight outward tilt; side view: swings forward and back around the hip | braced |
| tail | slow sway | sway, a phase behind the gait | — |
| weapon / extra | rigid on its parent | rigid on its parent | rigid on its parent |

### The engine (`renderer/render/monster-rigs/cutout.js`)

`makeCutoutRig({ id, parts, imageUrl, extend })` returns the rig exports:

- `PARAM_SCHEMA`: one shared schema for all cut monsters. It has the body numbers monsteri
  already has (`size`, `body`, `lift`, `bob`, `wobble`, `gaitFreq`, `lunge`) plus the new motion
  numbers, at least `armSwing` (deg), `stepHeight` (tiles), `legSwing` (deg, side view),
  `headNod` (deg), `tailSway` (deg) and `attackReach` (deg). The builder picks ranges and
  defaults that make monsteri look right out of the box.
- `drawMonster`: walks the tree depth-first in `z` order, composing each piece's transform from
  its parent's, and blits each piece through `drawSheetCell` (pixel.js). The hit flash tints
  every piece white. It keeps today's facing flip, death shrink and silhouette fallback before
  the image loads or in Node.
- `anchor(p, pose, S, name)`: the named point's position **in the current pose**, so monsteri's
  breath leaves the moving head.
- `drawnTop`, `hitHalf`, `hitShape`: as monsteri today. `drawnTop` comes from the parts' extent
  at the tallest pose.
- `extend` lets a rig module add its own drawing after the pieces, given the posed named points.
  Monsteri uses it for the orb glow.

### Joints that don't open up (the anti-goal)

- **Outline only the silhouette.** The dark one-pixel outline that keeps a monster readable is
  drawn only along the drawing's original edge, never along a cut line.
- **Overlap at the joint.** Each child piece extends past its cut line in a round cap around the
  pivot, filled from its own colours near the cut, so turning it never shows a gap. A cap is
  also outlined only where it falls outside the original silhouette.
- **Fill the hole behind.** Where a cut piece covered its parent (an arm across the torso), the
  uncovered area of the parent is filled from the surrounding colours, much as
  `tools/extract-monsteri.mjs` fills crayon gaps today. Plain diffusion of neighbour colours is
  enough. Hatching need not be reproduced.

### Automatic finding (the first guess)

Pure functions on an RGBA buffer. The approach is the builder's to refine. This is the shape:

1. **Mask.** If the image has real transparency, use it. Otherwise flood-fill from the border by
   colour distance to the border's colours, with a tolerance slider. Keep the largest piece plus
   any pieces near its box (monsteri's orbs), as `extract-monsteri.mjs` does.
2. **Torso.** Take a distance transform of the mask. The torso core is the thick region around
   the deepest point.
3. **Limbs.** Whatever sticks out of the core is a candidate limb. Its cut goes across the
   narrowest width near where it leaves the core, and its pivot is the middle of that cut.
4. **Labels.** Sort by where a piece leaves the core and which way it points: the top-centre
   piece is the head (other top pieces become `extra` on the head), pieces from the upper sides
   are arms, the lowest pair are legs, and the longest remaining side piece is the tail. Pieces
   that are not touching become `extra` on the nearest piece. `weapon` is never guessed. The
   user assigns it.

The finder must run in well under a second on a 1–2 megapixel image, because the user will adjust
the tolerance and re-run it. Working on a downscaled copy and mapping back is fine.

### The cutter (`tools/monster-cutter/`, served at `/cutter` on the lab server)

- **Open:** pick or drop an image file, or reopen an existing cut from `assets/cuts/`.
- **Background:** see the mask over a checkerboard, set the tolerance, and use a keep/erase brush
  for what the flood got wrong.
- **Pieces:** coloured regions with labels. The user can drag a cut line's ends, drag a pivot,
  change a label or side, split a piece with a new cut, merge two pieces, and change the draw
  order. **Auto** re-runs the finder and replaces the pieces after a confirm.
- **Points:** place the named points on pieces.
- **View:** front or side.
- **Preview:** the engine plays idle, walk and attack at game scale on the lab's stage, using the
  shared `PARAM_SCHEMA` sliders. Reuse `tools/monster-lab/stage.js` and the lab's pin strip so
  variants can be compared side by side.
- **Save:** writes the files in the diagram above. If the rig module is missing, it is written
  from the template. If the def is missing, it is created with `rig: <name>`, default params and
  no hook, through `writeMonster`. A name in `RESERVED_NAMES` is refused as usual, and so is a
  name that would overwrite a rig module the cutter did not create (`serpent`, `quadruped`,
  `cutout`, …).
- **An existing def on another rig** (for example the placeholder `quadruped` look that
  `new-monster.mjs` scaffolds) is switched to `rig: <name>` after a confirm. Its stats,
  behaviour, tuning and hook stay. Its params are replaced with the cut schema's defaults, which
  also drops keys the old rig used. *(Designer's call.)*
- **The cutter's sliders are for preview only.** Motion is tuned and saved in the bench.
  *(Designer's call.)*

The lab server gains the endpoints this needs, for example `PUT /api/cuts/<name>` taking the cut
JSON, the source image bytes and the finished atlas, with PNG writing done server-side.

**Output resolution.** Pieces are stored at roughly the size they are drawn in game, so a
monster looks as sharp as monsteri's sheet does today (monsteri: a 72×86 frame drawn 3 tiles
tall). The cutter works at full resolution and downsamples each finished piece with
`downsample` from `tools/sprite-sheet-lib.mjs` before outlining.

### The cut file (`assets/cuts/<name>.json`)

The cut file holds the source path, the final background mask (stored, not recomputed from the
tolerance and the brush strokes), every piece (its polygon or its cut lines, label, side, parent,
pivot, z), the named points, the view, which way the drawing faces (so a side view flips the
right way) and the output scale. A JPEG or WebP upload is stored as a decoded PNG, so
`build.mjs` needs no new decoder. *(Designer's calls.)* It holds **final decisions, not edits on top of an auto result**, so a later change
to the finder never changes a saved monster. Saving regenerates the atlas and `PARTS` from this
file deterministically. A Node script, `node tools/monster-cutter/build.mjs <name>`, does the
same without the browser so a cut can be rebuilt after an engine change.

### Bench: live rig sliders

`tools/monster-bench/panel.js` gets a **Look — live** section built from the rig's
`PARAM_SCHEMA`, shown above the tuning section. The game draws with `def.params` every frame,
so the panel edits that object in place, and when a body number changes it recomputes
`stats.half` from `hitHalf`, as `retuneMonster` does. Save writes `params` too:
`updateMonster` in `monster-files.cjs` accepts `patch.params`, replacing the whole object like
`tuning`. Unsaved values survive the bench's reload-on-change like the other panel values.

### Monsteri's migration

- Keying stays in `tools/extract-monsteri.mjs`, which gains an output of the keyed drawing at full
  resolution, before the downsample, to `assets/cuts/monsteri.png`. That image is the cutter's
  source, so monsteri keeps its colours and gap fill exactly.
- `renderer/render/monster-rigs/monsteri.js` becomes a thin module over `makeCutoutRig`. Its
  `extend` draws the orb glow at the named orb points, and it keeps `RIG_ID = 'monsteri'`, the
  `anchor('head'|'chest')`, `drawnTop`, `hitHalf`, `hitShape` exports and the `_setSheetImage`
  test seam (or an equivalent the tests can use).
- Its def keeps its params. New motion params start at their defaults until tuned in the bench.
- The old one-frame sheet `monsteri.png` / `monsteri-sheet.js` goes once nothing reads it.
- The hook (`systems/monsters/monsteri.js`) does not change. Its code-drawn grab arms still come
  from the `chest` anchor.

## Practice set

The source images are committed under `tools/monster-cutter/fixtures/` with a `CREDITS.md`. All
are CC0 or public domain.

**Practice cuts ship** (user's decision, 2026-11-08). A practice drawing cut and saved in the
cutter becomes an ordinary monster: its atlas, `PARTS`, rig module and def go under `renderer/`
and into `index.json`, are committed, and reach the web build. Its def has `spawn: null`, so it
never appears in play until someone gives it a spawn. No drafts area is needed. Credits for
shipped third-party art go in `renderer/assets/monsters/CREDITS.md` (CC0 needs no credit, but
the source is recorded), and the cut file in `assets/cuts/` names its fixture as the source.

| image | source | what it tests |
|---|---|---|
| Kenney Monster Builder Pack | kenney-assets.itch.io/monster-builder-pack (CC0, "name your price", free) | **ground truth**: assemble a few monsters from the pack's separate body/arm/leg sprites with known placement, merge them into one image, and score the finder against the known pieces |
| Manticore | commons.wikimedia.org File:DnD_Manticore.png (CC0) | clean line art; four legs, wings, tail |
| Forest Monster | opengameart.org/content/forest-monster (CC0) | painted full body on a blurred background (background removal) |
| Creature with Many Heads | opengameart.org/comment/94848 (CC0) | several figures and a loose arm on white (picking one figure) |
| Big Tusked Brut | opengameart.org/node/127238 (CC0) | grey on grey, soft edges (the hard case) |
| monsteri, wolf | `assets/monsteri.png`, `assets/wolf.png` | the user's own art: crayon front view; a quadruped concept |

If the Kenney download cannot be scripted, the user downloads the zip by hand.

## Testing

- **Pure modules** (mask, distance transform, finder, cut application, joint caps, hole fill,
  outline, build from a cut file) get `node:test` files in `test/`.
- **Finder score:** on the Kenney assemblies, each limb the finder proposes overlaps its true
  piece with IoU ≥ 0.7, and the head/arm/leg labels are right on at least 4 of 5 assemblies.
  On the other practice images, the user judges by eye in the cutter.
- **Engine:** the rig contract tests the other rigs have (valid schema, draws at the schema's
  min/max in Node with a recording ctx, anchors move with the pose, one blit per piece), plus a
  joint test: at the extreme swing, no transparent pixel opens inside the silhouette at a joint.
  This is a canvas check through `playwright-core`.
- **Monsteri:** the existing `monsteri-rig.test.js` and `monsteri.test.js` still pass, adjusted
  only where they assert the old single-frame sheet.
- **Bench:** a test that the Look section edits `def.params` live and that Save writes `params`.
- **Perf:** run `node tools/perf/trace.mjs` with monsteri on screen before and after the change,
  and report the difference.
- **Live check:** one short bench run of monsteri walking, in the arena-test journal. Keep it
  time-boxed.

## Left to the builder

- The finder's exact algorithm and thresholds, within the shape above and the score target.
- The cutter's layout and interaction details.
- The atlas packing, the exact `PARTS` format and the template for new rig modules.
- Param ranges and defaults, tuned so monsteri looks right untouched.
- Whether the cutter is one page or several modules, as long as the image work stays in pure,
  tested modules.
