# Monster Cutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut a monster drawing into pieces (torso, head, arms, legs, tail, weapon, extras) that a shared cut-out rig animates: arms swing and legs step while it walks, tuned live from bench sliders. Monsteri moves onto it first.

**Architecture:** Pure image modules in `tools/monster-cutter/` (mask → segment → finder → compose) run both in Node tests and in the browser cutter. A saved cut file (`assets/cuts/<name>.json`) is built deterministically into an atlas plus a generated `PARTS` module. A shared engine (`renderer/render/monster-rigs/cutout.js`) turns `PARTS` and the usual `PARAM_SCHEMA` params into a rig. Each cut monster has a thin rig module that is written once. The lab server hosts the cutter and its save endpoint, and the bench gains live rig-param sliders.

**Tech Stack:** Vanilla JS ES modules (no bundler, no new deps), `node:test`, `tools/png-read.mjs` / `tools/png-write.mjs`, canvas 2D in the browser, and a small software canvas for Node-side render tests.

**Spec:** `docs/superpowers/specs/2026-11-08-monster-cutter-design.md`

## Global Constraints

- No new npm dependency and no bundler. Image work runs on plain `{ w, h, rgba }` buffers in pure modules with no DOM and no `node:` imports, so the browser can import them too.
- The cutter is served only by the loopback-only lab server (`tools/monster-lab/server.mjs`, port 5180), never by `tools/web-server.mjs`, and is never imported from `renderer/`.
- The rig contract is unchanged: `RIG_ID`, `PARAM_SCHEMA` (types `range` / `color` / `toggle`), `drawMonster(ctx, params, pose, S)`, optional `hitHalf`, `hitShape`, `drawnTop`, `anchor`. Do not change the game loader or `schema.js`.
- The pixel look stays: nearest-neighbour blits (`imageSmoothingEnabled = false`) and frame-stepped motion on a 4-step gait (`Math.floor(t * gaitFreq) % 4`).
- Re-cutting rewrites data only (`<name>-parts.png`, `<name>-parts.js`). A rig module is written only when it is missing, and never over a rig the cutter did not create.
- The outline is drawn only along the original silhouette, never along a cut line. Child pieces carry a joint cap.
- Practice cuts ship (user's decision). Their defs have `spawn: null`, and third-party art is credited in `renderer/assets/monsters/CREDITS.md`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on branch `monster-cutter`, never on `main`.
- `npm test` stays green after every task. A lone SIGSEGV of the Node runner on WSL is a known flake: re-run it, don't chase it.

## Review Focus

1. **A cut line that does not cross the whole limb** (an end left inside the silhouette): the piece floods into its parent. Expected: the cutter flags that piece by name and Save is refused with the piece named. Tests are in Task 2 (`leaks`) and Task 7 (PUT → 400 naming the piece).
2. **A subject touching the image border** (a tightly cropped photo): a border flood must not eat the subject. Expected: only border pixels close to the dominant border colour seed the flood. Test in Task 1.
3. **Re-saving a cut whose def is already on its cut-out rig, with params tuned in the bench**: Save must not reset those params, stats or tuning. Test in Task 7.
4. **Merging or relabelling away a piece that points or children reference**: children and points must move to the parent, and the cut must stay valid. Test in Task 8.
5. **A cut with only a torso** (the finder found no limbs, or the user merged everything): the engine still draws, motion is a no-op, and `anchor('head'|'chest')` still answers. Test in Task 5.

---

## Shared formats (referenced by every task)

**Image:** `{ w: number, h: number, rgba: Uint8Array | Uint8ClampedArray }`. **Mask:** `Uint8Array(w*h)` of 0/1.

**Cut file** (`assets/cuts/<name>.json`, version 1). It holds final decisions only:

```json
{
  "version": 1, "name": "monsteri", "source": "assets/cuts/monsteri.png", "credit": null,
  "w": 573, "h": 690, "mask": [1203, 14, 559, 18],
  "view": "front", "faces": "left", "outHeight": 84, "outline": "#3a1416",
  "pieces": [
    { "id": "torso", "role": "torso", "side": null, "parent": null, "seed": [280, 400], "cut": null, "pivot": [280, 400], "z": 0, "claims": [] },
    { "id": "arm_l", "role": "arm", "side": "left", "parent": "torso", "seed": [60, 450], "cut": [[150, 300], [175, 360]], "pivot": [162, 330], "z": 1, "claims": [] }
  ],
  "points": { "head": { "piece": "head", "x": 230, "y": 100 }, "chest": { "piece": "torso", "x": 225, "y": 190 } }
}
```

- `mask` is run lengths over the `w*h` pixels in row order, starting with a run of 0s (which may be 0 long).
- `faces` is the direction the drawing faces, `left` or `right`. The rig mirrors the drawing when the monster moves the other way.
- `outHeight` is the figure's height in art px after downsampling.
- Each piece:
  - `id`: matches `/^[a-z0-9_]+$/`.
  - `role`: one of `torso|head|arm|leg|tail|weapon|extra`.
  - `side`: `left|right` for an arm or leg, otherwise `null`.
  - `cut`: the two ends of the cut line in source px, or `null` for the torso and for detached pieces.
  - `seed`: a source pixel on the piece's side of the cut.
  - `pivot`: the joint pin in source px.
  - `claims`: brush discs `{ x, y, r }` that hand pixels to this piece.

**PARTS** (`renderer/assets/monsters/<name>-parts.js`, generated). All coordinates are art px in figure space: (0,0) is the top-left of the figure's box at rest, and the feet are at `figure.h`.

```js
export const PARTS = {
  version: 1, view: 'front', faces: 'left',
  figure: { w: 72, h: 84 },
  pieces: [
    // drawn in this array's order; caps of a piece's children are drawn just before it
    { id: 'torso', role: 'torso', side: null, parent: null, z: 0, pivot: [36, 50],
      rect: [0, 0, 30, 60], at: [21, 20], cap: null },
    { id: 'arm_l', role: 'arm', side: 'left', parent: 'torso', z: 1, pivot: [20, 41],
      rect: [30, 0, 12, 40], at: [4, 38], cap: [42, 0, 7, 4, 17, 38] },   // cap: atlas x,y,w,h then figure x,y
  ],
  points: { head: { piece: 'head', x: 29, y: 11 }, chest: { piece: 'torso', x: 28, y: 23 } },
}
```

---

### Task 1: Raster primitives and the background mask

**Files:**
- Create: `tools/monster-cutter/raster.js`, `tools/monster-cutter/mask.js`
- Modify: `tools/sprite-sheet-lib.mjs` (import `downsample` from `raster.js` and re-export it instead of defining it, so `node:fs` stays out of the browser path)
- Test: `test/cutter-mask.test.js`
- Also: create branch `monster-cutter` and commit the spec with this task.

**Interfaces:**
- Produces (`raster.js`):
  - `components(mask, w, h) -> { label: Int32Array, sizes: number[] }`: 4-connected, label −1 off the mask.
  - `boxes(label, sizes, w, h) -> Array<[x0, y0, x1, y1]>`
  - `distanceTransform(mask, w, h) -> Float32Array`: Euclidean distance to the nearest off-mask pixel, with off-image counting as off-mask.
  - `supercoverLine([x0, y0], [x1, y1]) -> Array<[x, y]>`: a 4-connected line, so a 4-flood cannot slip through diagonally.
  - `downsample(img, scale) -> Image`: moved verbatim from `sprite-sheet-lib.mjs`.
- Produces (`mask.js`):
  - `autoMask(img, { tolerance = 40, alphaCut = 128 } = {}) -> Mask`
  - `applyStrokes(mask, w, h, strokes) -> Mask`: strokes are `[{ x, y, r, keep }]`, and the result is a new array.
  - `keepMain(mask, w, h, margin) -> Mask`: the largest component plus components whose box lies within `margin` px of its box.
  - `encodeMask(mask) -> number[]` and `decodeMask(runs, n) -> Mask`, the run-length format of the cut file.

- [ ] **Step 1: Branch and commit the spec**

```bash
git checkout -b monster-cutter
git add docs/superpowers/specs/2026-11-08-monster-cutter-design.md docs/superpowers/plans/2026-11-08-monster-cutter.md
git commit -m "docs(cutter): monster cutter design and plan"
```

- [ ] **Step 2: Write the failing tests** in `test/cutter-mask.test.js`. Build the images in code, with a helper `img(w, h, fn(x, y) -> [r, g, b, a])`.
  - `distanceTransform: the centre of a 21x21 square is ~11 from the edge`: assert `Math.abs(d[10*21+10] - 11) <= 1` and the corners equal 1.
  - `supercoverLine is 4-connected`: for the line from (0,0) to (7,3), each consecutive pair differs by exactly 1 in x or in y, never both.
  - `components labels two blobs and sizes them`.
  - `autoMask uses real transparency when the image has it`: a transparent field with an opaque 10×10 square yields a mask of exactly 100 px.
  - `autoMask floods a flat background away`: a white field with a red 20×30 rectangle yields mask = the rectangle.
  - `autoMask floods a gradient background away`: a vertical grey ramp from 200 to 240 with a dark 20×20 blob yields mask = the blob, ±2 % px.
  - `autoMask keeps a subject that touches the border` (Review Focus 2): a white field with a red rectangle running off the left edge still masks ≥ 95 % of the rectangle.
  - `applyStrokes keeps and erases discs`.
  - `keepMain drops far specks and keeps near ones`: a big blob, a speck 5 px from its box, a speck 80 px away, with margin 30, keeps the first two.
  - `mask run-lengths round-trip`: `decodeMask(encodeMask(m), m.length)` deep-equals `m`, including a mask that starts with a 1.
  - `sprite-sheet-lib still exports downsample`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/cutter-mask.test.js`
Expected: FAIL, cannot find module `tools/monster-cutter/raster.js`

- [ ] **Step 4: Implement `raster.js` and `mask.js`.**
  - `autoMask`: if at least 1 % of pixels have alpha < `alphaCut`, the mask is `alpha >= alphaCut`. Otherwise, take the dominant border colour (the median of the border pixels per channel). Seed the flood only from border pixels within `tolerance` of it (RGB Euclidean), and grow 4-connected through pixels within `tolerance` of the pixel they were reached from and within `3 * tolerance` of the dominant colour. The mask is everything not flooded.
  - Distance transform: an exact EDT (Felzenszwalb–Huttenlocher) or a two-pass 3-4 chamfer divided by 3. Either passes the test.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/cutter-mask.test.js test/npc-sheets.test.js test/rig-serpent.test.js test/rig-wraith.test.js`
Expected: PASS (the last three guard the `downsample` move)

- [ ] **Step 6: Commit**

```bash
git add tools/monster-cutter/raster.js tools/monster-cutter/mask.js tools/sprite-sheet-lib.mjs test/cutter-mask.test.js
git commit -m "feat(cutter): raster primitives and background mask"
```

---

### Task 2: Cut-file validation and segmentation

**Files:**
- Create: `tools/monster-cutter/cut-format.js`, `tools/monster-cutter/segment.js`
- Test: `test/cutter-segment.test.js`

**Interfaces:**
- Consumes: `components`, `supercoverLine` (Task 1).
- Produces:
  - `ROLES` (the seven role strings) and `validateCut(cut) -> string[]` in `cut-format.js`. It returns an empty array when valid, and checks:
    - version 1;
    - ids unique and matching the regex;
    - exactly one piece with `parent: null` and `role: 'torso'`;
    - every parent exists, with no cycles;
    - role in `ROLES`;
    - `side` set if and only if the role is arm or leg;
    - `cut` null if and only if the piece is the root or detached;
    - every point names an existing piece;
    - `decodeMask(mask).length === w*h`;
    - `view` in front/side and `faces` in left/right.
  - `segment(mask, w, h, pieces) -> { owner: Int16Array, base: Int16Array, leaks: string[] }` in `segment.js`. `owner` and `base` give a piece index per pixel, −1 off the mask; `base` is the owner before claims.

- [ ] **Step 1: Write the failing tests** in `test/cutter-segment.test.js`. Use a synthetic figure: a torso rectangle 40×60 at (30,20), and an arm rectangle 10×40 sticking out left from (20,25) so that it overlaps 0 px into the torso.
  - `an arm cut off at the shoulder owns exactly the protrusion`: the arm's cut runs from (29,22) to (29,68), with seed (22,40). `owner === armIndex` count equals 10×40, and `leaks` is `[]`.
  - `a nested forearm takes its part of the arm`: a forearm with parent `arm`, a cut across the arm at y=45, and a seed below. The forearm owns the lower part, and the arm keeps the rest and the cut-line pixels.
  - `a cut that stops inside the silhouette leaks and is reported` (Review Focus 1): the cut ends at (29,30), short of the arm's bottom. `leaks` deep-equals `['arm']`, and the torso still owns those pixels.
  - `a detached blob is a piece without a cut`: an orb 5 px above the torso, as role `extra` with parent `torso`, `cut: null` and a seed in the orb, owns exactly the orb.
  - `claims move pixels and keep base`: a claim disc on the torso for the arm piece. `owner` there is the arm, and `base` there is the torso.
  - `validateCut accepts a good cut and names each problem in a bad one`: assert specific messages for a duplicate id, a missing parent, two roots, an arm without a side, and a point on an unknown piece.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/cutter-segment.test.js`
Expected: FAIL, module not found

- [ ] **Step 3: Implement `segment` and `validateCut`.**
  - `segment` steps:
    1. The root owns every mask pixel.
    2. Visit pieces breadth-first from the root, so parents come before children. For each child, flood 4-connected from its seed through pixels its parent currently owns, minus that child's own cut-line pixels (`supercoverLine`).
    3. If the flood reaches the parent's seed, record a leak and assign nothing. Otherwise assign the region to the child. Cut-line pixels stay with the parent.
    4. Copy the result to `base`, then apply claims in piece order: mask pixels within a claim disc go to that piece.
  - A seed that falls off the parent's pixels is also a leak.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/cutter-segment.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/monster-cutter/cut-format.js tools/monster-cutter/segment.js test/cutter-segment.test.js
git commit -m "feat(cutter): cut-file validation and cut-line segmentation"
```

---

### Task 3: Automatic piece finder, scored on Kenney assemblies

**Files:**
- Create: `tools/monster-cutter/finder.js`, `tools/monster-cutter/fixtures/assemble-kenney.mjs`, `tools/monster-cutter/fixtures/kenney/` (the pack's PNGs that are used, plus `License.txt`), `tools/monster-cutter/fixtures/kenney/assembled/*.png`, `*.truth.json`, `tools/monster-cutter/fixtures/CREDITS.md`
- Test: `test/cutter-finder.test.js`

**Interfaces:**
- Consumes: `distanceTransform`, `components`, `boxes`, `keepMain` (Task 1); `segment`, `validateCut` (Task 2).
- Produces: `findPieces(mask, w, h, { work = 256 } = {}) -> Piece[]`. The result is valid under `validateCut` once wrapped in a cut, every cut segments without leaks, and `weapon` is never assigned.

- [ ] **Step 1: Write the failing synthetic tests** in `test/cutter-finder.test.js`. Build a stick figure in code at 400×500: a torso rectangle; a head disc on top; two arms from the upper sides, angled down; two legs from the bottom; a tail leaving the right side at mid-height; and a separate 8 px orb above the head.
  - `finds one head, two arms (left and right), two legs, one tail and the orb as an extra`
  - `every proposed cut separates its piece`: `segment(...).leaks` is `[]`.
  - `pivots sit near the true joints`: each within 6 % of the figure height of the joint used to build it.
  - `never guesses a weapon`
  - `a plain blob yields a torso only` (feeds Review Focus 5).
  - `runs a 1600x1600 mask in under a second`: build the figure scaled ×4 and time `findPieces`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/cutter-finder.test.js`
Expected: FAIL, module not found

- [ ] **Step 3: Implement `findPieces`** with the spec's shape.
  1. Downscale the mask so its longest side is `work`.
  2. Take the distance transform. The torso core is the component, containing the deepest pixel, of `dist >= 0.5 * maxDist`, grown by `0.5 * maxDist`.
  3. The candidate limbs are the components of mask minus core. A component smaller than 2 % of the mask area is merged back into the core, unless it is detached from the main body, in which case it becomes an `extra` whose parent is the nearest piece.
  4. For each limb, walk outward from where it touches the core. The cut is the narrowest cross-section within the first 40 % of its length, perpendicular to the walk direction, with each end pushed 2 px past the silhouette edge. The pivot is the cut's midpoint. The seed is the limb pixel farthest from the core.
  5. Labels:
     - the top-centre limb (attachment angle within ±35° of straight up) is the head, and other top limbs become `extra` on the head;
     - limbs attached to the upper half of the core's sides are arms;
     - the two attached lowest are legs;
     - the longest remaining side limb is the tail, and anything else is an `extra`;
     - `side` for an arm or leg comes from its pivot x against the torso seed x.
  6. Map the coordinates back to full size. `z`: the tail is −1, the torso 0 and everything else 1.

- [ ] **Step 4: Run the synthetic tests to verify they pass**

Run: `node --test test/cutter-finder.test.js`
Expected: PASS

- [ ] **Step 5: Get the Kenney Monster Builder Pack (CC0).** If `assets/kenney_monsterBuilderPack.zip` (or a similarly named zip) is not present, **stop and ask the user** to download it from https://kenney-assets.itch.io/monster-builder-pack ("name your price", 0 is fine) into `assets/`; it cannot be downloaded by script. Unzip it into a scratch directory. Copy only the PNGs the assemblies use, plus `License.txt`, into `tools/monster-cutter/fixtures/kenney/`.

- [ ] **Step 6: Write `assemble-kenney.mjs`.** Its `PLACEMENTS` table describes five monsters, each made of a body, two arms, two legs, eyes and a mouth (choose them after looking at the pack's sprites). Arms and legs overlap the body edge by about 10 % of their length, and the five should differ in body shape and limb angle. The script composites each monster into `assembled/<n>.png` on a white background, and writes `assembled/<n>.truth.json` as `{ pieces: [{ role, side, mask: <runs> }] }`. Each truth mask is the limb's alpha minus the body's alpha, which is the protruding part only, since a flat image cannot show the overlap. Run it and commit its output.

Run: `node tools/monster-cutter/fixtures/assemble-kenney.mjs`
Expected: `wrote 5 assemblies`

- [ ] **Step 7: Add the score test** `scores at least IoU 0.7 per limb and labels 4 of 5 Kenney assemblies right`. For each assembly, run `autoMask`, then `keepMain(…, 30)`, then `findPieces`, then `segment`. For each truth limb, take the best-overlapping found piece. Every truth limb must have IoU ≥ 0.7. On at least 4 of the 5 assemblies, every truth limb's best match must also have the right role and side.

Run: `node --test test/cutter-finder.test.js`
Expected: PASS. If the score falls short, tune the thresholds in step 3; do not lower the target.

- [ ] **Step 8: Write the start of `fixtures/CREDITS.md`** (the Kenney pack, CC0, with its URL), then commit.

```bash
git add tools/monster-cutter/finder.js tools/monster-cutter/fixtures test/cutter-finder.test.js
git commit -m "feat(cutter): automatic piece finder, scored on Kenney assemblies"
```

---

### Task 4: Compose pieces into an atlas and PARTS

**Files:**
- Create: `tools/monster-cutter/compose.js`
- Test: `test/cutter-compose.test.js`

**Interfaces:**
- Consumes: `segment` (Task 2), `downsample`, `components` (Task 1), `decodeMask`.
- Produces: `composeCut(src: Image, cut) -> { atlas: Image, parts: PARTS }`. The shape of `parts` is exactly the PARTS format above.

- [ ] **Step 1: Write the failing tests** in `test/cutter-compose.test.js`. Use the synthetic torso-and-arm figure from Task 2, coloured: torso red, arm blue, and a white source background with a full mask of both.
  - `one atlas rect per piece and a cap only on children`
  - `pasting every piece at "at" rebuilds the figure exactly`: paste the pieces in array order into a `figure.w × figure.h` buffer. Its opaque set equals the downsampled figure mask plus its 1 px outline, with no seam pixels missing at piece borders (the crop-grid alignment).
  - `the outline follows the silhouette and never the cut`: in the rebuilt figure, no pixel along the cut line has the outline colour, and every transparent pixel 4-adjacent to the figure has it.
  - `a claimed area leaves no hole in the parent`: claim a disc of the torso for the arm. The torso's own image has no transparent pixel inside the disc, and its fill colour is close to red (each channel within 40).
  - `caps are filled from the child, and only where the parent covers`: every opaque cap pixel lies over a torso-owned pixel at rest, and is bluish.
  - `pivots and points are converted to figure px`: with a scale of 2, a pivot at source (29,45) and the figure box origin at (20,20), the pivot comes out as `[4.5, 12.5]`, rounded the same way as `at`.
  - `outline colour defaults to a dark version of the figure's mean colour when cut.outline is null`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/cutter-compose.test.js`
Expected: FAIL, module not found

- [ ] **Step 3: Implement `composeCut`.**
  1. `scale = max(1, ceil(figureBoxH / cut.outHeight))`.
  2. Snap each piece's crop box to multiples of `scale` from the figure box's top-left, so the downsampled pieces tile.
  3. Build each piece's full-resolution image from its own `owner` pixels. Pixels where `base` is this piece but `owner` is another are filled by diffusion: repeatedly average the opaque 4-neighbours until filled.
  4. Each child gets a cap: a half-disc of radius |cut|/2 around the pivot, on the parent's side of the cut. It covers only pixels the parent owns. Each cap pixel takes the colour of the child pixel at its mirror image across the cut line, or the nearest child pixel if that is off the child.
  5. Downsample pieces and caps separately and drop alpha < 110.
  6. Outline: build the union of the downsampled pieces (caps excluded), padding each piece by 1 px. Each transparent pixel 4-adjacent to the union gets the outline colour inside the piece that owns the neighbour it touches, checking N, E, S, W in order.
  7. Shelf-pack every piece and cap into the atlas, with 1 px of space between them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/cutter-compose.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/monster-cutter/compose.js test/cutter-compose.test.js
git commit -m "feat(cutter): compose pieces with joint caps, hole fill and silhouette outline"
```

---

### Task 5: The cut-out rig engine

**Files:**
- Create: `renderer/render/monster-rigs/cutout.js`, `tools/monster-cutter/soft-canvas.js`
- Modify: `tools/monster-lab/server.mjs` (in `/api/rigs`, also leave out the helper modules `pixel.js` and `cutout.js`; today only `schema.js` is left out)
- Test: `test/cutout-rig.test.js`, `test/monster-lab-server.test.js` (add one assertion)

**Interfaces:**
- Consumes: `drawSheetCell` from `renderer/render/monster-rigs/pixel.js`; PARTS (above). In tests, `composeCut` (Task 4) builds the synthetic PARTS.
- Produces:
  - `CUTOUT_SCHEMA`: the shared `PARAM_SCHEMA`. Start values (Task 10 retunes the defaults for monsteri):
    - group `body`: `size` 1.5–6 step .25 default 3; `body` .25–.85 step .05 default .5; `lift` 0–3 step .05 default 1.1.
    - group `motion`: `bob` 0–1 step .05 default .4; `wobble` 0–15 step 1 default 3; `gaitFreq` 1–12 step .5 default 6; `lunge` 0–.6 step .05 default .2.
    - group `limbs`: `armSwing` 0–60 step 1 default 20; `stepHeight` 0–.5 step .01 default .12; `legSwing` 0–45 step 1 default 20; `headNod` 0–15 step 1 default 3; `tailSway` 0–30 step 1 default 8; `attackReach` 0–120 step 5 default 35.
  - `pieceTransforms(parts, params, pose) -> Map<string, number[6]>`: a canvas-style affine `[a, b, c, d, e, f]` per piece id, in figure px, composed parent before child. Whole-figure effects are not included here.
  - `makeCutoutRig({ id, parts, imageUrl, extend = null }) -> { RIG_ID, PARAM_SCHEMA, drawMonster, hitHalf, hitShape, drawnTop, anchor, _setSheetImage }`.
    - `extend(ctx, params, pose, S, { point })` runs after the pieces, with `ctx` in figure space (scale and flip applied). `point(name) -> { x, y }` gives the posed figure px.
    - The image may be an `HTMLImageElement` or a canvas: it is ready when `complete !== false && (naturalWidth || width) > 0`. With `imageUrl: null`, no `Image` is created, and the rig draws the silhouette until `_setSheetImage` is given one. The cutter preview relies on this.
  - `makeSoftCanvas(w, h) -> { ctx, img }` in `soft-canvas.js`. Its `ctx` implements `save`, `restore`, `translate`, `scale`, `rotate`, `transform`, `setTransform`, `fillRect`, `drawImage` (the 9-argument form, nearest-neighbour by inverse mapping), `globalAlpha`, `fillStyle` (hex) and `imageSmoothingEnabled`. Images passed to it are `{ w, h, rgba, width, height, naturalWidth, complete: true }`, and `img` is the target Image.

The motion uses gait step `i = floor(t * gaitFreq) % 4` and breath step `j = floor(t * 2) % 4`, with tables `SWING = [1, 0, -1, 0]`, `LIFT = [1, 0, 0, 0]`, `BOB = [0, -1, 0, -1]` and `LEAN = [-1, 0, 1, 0]`. Angles are in degrees converted to radians, and positive is clockwise on screen. "Outward" is +1 for `side: 'left'` and −1 for `side: 'right'`. "Forward" is +1 when `faces` is `left`.

| role | walk (`state === 'walk'` or `speed01 > 0.05`) | idle | attack |
|---|---|---|---|
| arm | front: `armSwing·SWING[i]·outward`; side: `armSwing·SWING[i]·(left ? 1 : −1)` | `armSwing/4·SWING[j]·outward` | front: `attackReach·outward`; side: `attackReach·forward` |
| leg | front: lift `stepHeight·S` along −y on `LIFT[i]` (left) or `LIFT[(i+2)%4]` (right), plus a tilt of `outward·4°` while lifted; side: `legSwing·SWING[i]·(left ? 1 : −1)` | 0 | 0 |
| head | `headNod·BOB[(i+3)%4]·forward` | 0 | 0 |
| tail | `tailSway·SWING[(i+1)%4]` | `tailSway/2·SWING[j]` | 0 |
| torso, weapon, extra | 0 (they ride on their parent) | 0 | 0 |

`drawMonster` keeps monsteri's whole-figure behaviour: `FOOT = 0.45`, `SWELL = 1.08`, `BREATH = 1.02` while not walking, the walk lean `LEAN[i]·wobble` and bob `BOB[i]·bob·S·0.1`, the attack lunge `cos(facing)·lunge·S`, death shrink `1 − 0.4·dying` over `DEATH = 0.7` s, and the mirror rule `cos(facing) > 0.01` when `faces` is `left` (`< −0.01` when `right`). The figure is scaled so its height is `size·S`, with the feet at the origin `+FOOT·S`. The hit state tints every piece white through `drawSheetCell`. Draw order follows the `pieces` array, and before each piece come the caps of its children, drawn with each child's transform.

- [ ] **Step 1: Write the failing tests** in `test/cutout-rig.test.js`, using a recording ctx (the proxy from `test/monsteri-rig.test.js`) and PARTS composed from a synthetic figure: a torso, a head, two arms, two legs and a tail, with points `head` and `chest`.
  - `has a valid schema and the given id`: `schemaErrors(CUTOUT_SCHEMA)` is empty.
  - `draws a silhouette without the image: one fillRect per piece, no blits, balanced save/restore` in every state, at the defaults, at all-min and at all-max.
  - `with the image: one blit per piece and one per cap`
  - `flips to face east and not west when faces is left; the reverse when right`, and `north/south as drawn`.
  - `arms swing in opposite phase while walking`: at gait steps 0 and 2, the left arm's angle (read from `pieceTransforms`) has the opposite sign, and the right arm mirrors it.
  - `front-view legs lift in turn; side-view legs swing`
  - `attack raises both arms outward`: the left arm turns positive and the right negative, by `attackReach`.
  - `idle barely moves; walking changes the drawing between gait steps`
  - `death shrinks the figure`
  - `anchor follows the posed head`: `anchor(P, walkPose, 32, 'head')` differs from the idle anchor whenever `headNod > 0`, and it is mirrored when facing east versus west.
  - `drawnTop is the top of the tallest living pose`: over idle (both breath steps), the 4 walk steps, attack and hit, `drawnTop` ≤ every pose's top and within 1 px of the smallest.
  - `hit radius stays within 8..28 and sits on the body`
  - `a torso-only cut draws, holds still and still answers head and chest anchors` (Review Focus 5): a missing `head` point falls back to the figure's top-centre, and a missing `chest` point to its centre.
  - `a turned limb opens no gap at its joint`: render with `makeSoftCanvas` at rest and at `armSwing` = its max with gait step 0. Every pixel within `|cut|/2 − 1` art px of the arm's pivot is opaque in both renders. The synthetic figure must make that disc fully opaque at rest.

- [ ] **Step 2: Add the lab-server assertion** `GET /api/rigs leaves out helper modules`: the list includes neither `pixel` nor `cutout`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/cutout-rig.test.js test/monster-lab-server.test.js`
Expected: FAIL, module not found / `pixel` listed

- [ ] **Step 4: Implement `cutout.js`, `soft-canvas.js` and the `/api/rigs` filter.** `drawnTop` computes the tightest top over those living poses from the transformed piece corners. Memoise it on the params values, since the HP bar calls it every frame.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/cutout-rig.test.js test/monster-lab-server.test.js test/monster-rigs.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add renderer/render/monster-rigs/cutout.js tools/monster-cutter/soft-canvas.js tools/monster-lab/server.mjs test/cutout-rig.test.js test/monster-lab-server.test.js
git commit -m "feat(cutout): shared cut-out rig engine with joint-safe limb motion"
```

---

### Task 6: Build pipeline and command-line tools

**Files:**
- Create: `tools/monster-cutter/templates.js`, `tools/monster-cutter/build-cut.js`, `tools/monster-cutter/install-cut.js`, `tools/monster-cutter/build.mjs`, `tools/monster-cutter/auto.mjs`, `tools/monster-cutter/preview.mjs`
- Modify: `.gitignore` (add `tools/monster-cutter/out/`)
- Test: `test/cutter-build.test.js`

**Interfaces:**
- Consumes: `composeCut` (Task 4); `validateCut` (Task 2); `autoMask`, `keepMain`, `encodeMask` (Task 1); `findPieces` (Task 3); `makeCutoutRig`, `makeSoftCanvas` (Task 5); `writeMonster`, `RESERVED_NAMES`, `NAME_RE` from `tools/monster-lab/monster-files.cjs` (via `createRequire`).
- Produces:
  - `CUTOUT_MARKER = '// cutout-rig: written by tools/monster-cutter'` and `rigModuleSource(name) -> string` in `templates.js`. The module's first line is the marker. It imports `makeCutoutRig` from `./cutout.js` and `PARTS` from `../../assets/monsters/<name>-parts.js`, passes `imageUrl: new URL('../../assets/monsters/<name>-parts.png', import.meta.url).href`, and re-exports `RIG_ID, PARAM_SCHEMA, drawMonster, hitHalf, hitShape, drawnTop, anchor, _setSheetImage`.
  - `buildCut({ root, name }) -> { parts, atlasPath, partsPath }` in `build-cut.js`. It reads `assets/cuts/<name>.json` and its `source` PNG, throws a message listing the `validateCut` errors or the leaking piece ids, and writes `renderer/assets/monsters/<name>-parts.png` and `<name>-parts.js` (header `// Generated by tools/monster-cutter from assets/cuts/<name>.json — do not edit.`).
  - `cutStatus({ root, name }) -> { reserved, def: { exists, rig }, rig: { exists, cutout } }` in `install-cut.js`.
  - `installCut({ root, name, switchRig = false }) -> { createdRig, createdDef, switched }` in `install-cut.js`. It:
    - refuses reserved or invalid names;
    - refuses a rig file that exists without the marker (`rig "<name>" is not a cut-out rig`);
    - writes the rig module if it is missing;
    - creates a missing def as `{ rig: name, params: {}, stats: { hp: 10, dmg: 1, speed: 60 }, behavior: {}, hooks: false, spawn: null, tuning: {} }`;
    - when the def is on another rig, throws `Object.assign(new Error('def uses rig <rig>'), { needsSwitch: true })` unless `switchRig`, in which case it sets `rig: name` and `params: {}` and keeps everything else;
    - leaves a def already on `rig: name` untouched.
  - CLIs:
    - `node tools/monster-cutter/build.mjs <name> [--install] [--switch]`
    - `node tools/monster-cutter/auto.mjs <name> <png> [--tolerance N] [--view front|side] [--faces left|right]`: copies the PNG to `assets/cuts/<name>.png` and writes a first-guess cut with points `head` (the head piece's topmost pixel moved 15 % down, or the figure's top-centre) and `chest` (the torso's top-centre moved 15 % down). It refuses to overwrite an existing cut without `--force`.
    - `node tools/monster-cutter/preview.mjs <name>`: writes `tools/monster-cutter/out/<name>-preview.png`, showing the source tinted per owner with cut lines, pivots and points, and beside it the soft-canvas renders of idle, walk steps 0–3 and attack at S = 64.

- [ ] **Step 1: Write the failing tests** in `test/cutter-build.test.js`. Use a temp `root` with the folders the paths need, a synthetic source PNG and a valid cut file.
  - `buildCut writes an atlas and a PARTS module that imports and matches`: `await import(partsPath)` gives `PARTS.pieces.length` equal to the cut's pieces.
  - `buildCut names leaking pieces`: with a short cut, the error message matches `/leaks: arm/`.
  - `installCut writes the rig module from the template and creates the def`: the module's first line is `CUTOUT_MARKER`, and the def's `rig` is the name.
  - `installCut refuses to overwrite a hand-written rig`: a rig file without the marker throws `/not a cut-out rig/`.
  - `installCut asks before switching a def on another rig, then switches keeping stats, behaviour, tuning and hooks`
  - `re-installing over a def already on its cut rig leaves params, stats and tuning untouched` (Review Focus 3).
  - `installCut refuses reserved names`: `dragon` throws.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/cutter-build.test.js`
Expected: FAIL, module not found

- [ ] **Step 3: Implement the four modules and the three CLIs.**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/cutter-build.test.js`
Expected: PASS

- [ ] **Step 5: Smoke-test the CLIs on a Kenney assembly** (writing to the real tree, then removed again):

```bash
node tools/monster-cutter/auto.mjs kenney_try tools/monster-cutter/fixtures/kenney/assembled/1.png
node tools/monster-cutter/preview.mjs kenney_try   # look at tools/monster-cutter/out/kenney_try-preview.png
node tools/monster-cutter/build.mjs kenney_try
rm assets/cuts/kenney_try.* renderer/assets/monsters/kenney_try-parts.*
```

Expected: the preview shows the pieces tinted and six posed frames with limbs moved; the build prints the written paths.

- [ ] **Step 6: Commit**

```bash
git add tools/monster-cutter/templates.js tools/monster-cutter/build-cut.js tools/monster-cutter/install-cut.js tools/monster-cutter/build.mjs tools/monster-cutter/auto.mjs tools/monster-cutter/preview.mjs .gitignore test/cutter-build.test.js
git commit -m "feat(cutter): build, install, auto and preview tools"
```

---

### Task 7: Lab server cut endpoints

**Files:**
- Modify: `tools/monster-lab/server.mjs`
- Test: `test/monster-lab-server.test.js`

**Interfaces:**
- Consumes: `buildCut`, `cutStatus`, `installCut` (Task 6); `validateCut` (Task 2).
- Produces:
  - `createLabServer(opts)` accepts `cutsRoot` (default: the repo root). The cut tools read and write under that root, and tests point it at a temp dir laid out like the repo.
  - `GET /cutter` serves `tools/monster-cutter/index.html`.
  - `GET /api/cuts` returns the cut names (`*.json` in `<cutsRoot>/assets/cuts`).
  - `GET /api/cuts/:name/status` returns `cutStatus`.
  - `PUT /api/cuts/:name` takes the body `{ cut, sourcePng?: 'data:image/png;base64,…', switchRig?: boolean }`. It writes the source (when given) to `assets/cuts/<name>.png` and sets `cut.source` to that path, writes the cut file, runs `buildCut`, then `installCut`, and returns `{ ok: true, ...installResult }`. Errors:
    - 400 `{ error }` for an invalid name, an invalid cut, or leaking pieces (the message names them);
    - 409 `{ error, needsSwitch: true }` when the def is on another rig and `switchRig` is not set;
    - 409 `{ error }` for a rig that is not a cut-out.
  - `GET /api/events` also fires for `assets/cuts` changes, with `dir: 'cuts'`.

- [ ] **Step 1: Write the failing tests** (in a new `describe('cut endpoints')` with its own temp `cutsRoot`)
  - `GET /cutter serves the cutter page`: 200 and `text/html`.
  - `PUT a valid cut with its source writes the cut, the parts and a new def; GET /api/cuts lists it`
  - `PUT a cut with a leaking piece is refused 400 and names the piece` (Review Focus 1).
  - `PUT over a def on another rig answers 409 needsSwitch, then succeeds with switchRig`
  - `re-PUT keeps the bench-tuned params of a def already on its cut rig` (Review Focus 3, end to end).
  - `PUT a reserved name is refused 400`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/monster-lab-server.test.js`
Expected: FAIL (404 for `/cutter` and `/api/cuts`)

- [ ] **Step 3: Implement the routes.** Read the request body as a whole, decode the data URL to bytes, and write them unchanged, since a browser PNG is 8-bit RGBA and non-interlaced, which `png-read` handles.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/monster-lab-server.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/monster-lab/server.mjs test/monster-lab-server.test.js
git commit -m "feat(cutter): lab server endpoints to list, check and save cuts"
```

---

### Task 8: The cutter page

**Files:**
- Create: `tools/monster-cutter/index.html`, `tools/monster-cutter/cutter.css`, `tools/monster-cutter/cutter.js`, `tools/monster-cutter/cut-model.js`, `tools/monster-cutter/overlay.js`
- Test: `test/cutter-model.test.js`

**Interfaces:**
- Consumes: everything pure from Tasks 1–5 (in the browser); `makeStage` (`tools/monster-lab/stage.js`), `makePinStrip` (`compare.js`), `buildParamsPanel` (`params-panel.js`); the endpoints from Task 7.
- Produces (`cut-model.js`, pure). Every operation returns a new cut that passes `validateCut`:
  - `newCut({ name, w, h, mask, pieces, view = 'front', faces = 'left', outHeight = 84, outline = null })`
  - `moveCutEnd(cut, id, end, [x, y])`, `movePivot(cut, id, [x, y])`, `moveSeed(cut, id, [x, y])`
  - `setRole(cut, id, role, side)`
  - `splitPiece(cut, parentId, line, seed) -> { cut, id }`: the new id is `<role>_<n>` with role `extra`, and the pivot is the line's midpoint.
  - `mergePiece(cut, id)`: the piece's children and points move to its parent.
  - `setZ(cut, id, z)`
  - `addClaim(cut, id, disc)`, `clearClaims(cut, id)`
  - `setPoint(cut, name, pieceId, [x, y])`, `removePoint(cut, name)`
  - `setView(cut, view)`, `setFaces(cut, faces)`
  - `fitSize(w, h, max = 2048) -> { w, h, scale }`

The page:
- **Open:** a file picker or drop accepts PNG, JPEG or WebP. The image is decoded on a canvas and shrunk with `fitSize`. An existing cut can be reopened from `/api/cuts`.
- **Background:** the mask over a checkerboard, a tolerance slider that re-runs `autoMask` + `keepMain`, and a keep/erase brush that calls `applyStrokes`.
- **Pieces:** owners are tinted per piece (`segment`). The user drags cut ends, pivots and seeds, and can relabel, set the side, split (draw a line), merge, nudge z up or down, and paint claims. Leaking pieces are listed in red by name.
- **Auto:** asks for a confirm, then replaces the pieces with `findPieces`.
- **Points:** place `head`, `chest` and any named point on the piece under the cursor.
- **View** and **faces** selects.
- **Preview:** `composeCut` builds an atlas canvas, the page makes a rig with `makeCutoutRig({ parts, imageUrl: null })`, passes the canvas to `_setSheetImage`, and shows it on `makeStage` with the pin strip and `buildParamsPanel(CUTOUT_SCHEMA)`. These are preview-only sliders. The preview rebuilds, debounced, after each edit.
- **Save:** asks for a name (an `<input>`, not `window.prompt`), sends `PUT /api/cuts/:name` with `sourcePng` from `canvas.toDataURL('image/png')`, and on `needsSwitch` asks "Switch <name> from rig <rig> to its cut? Stats, behaviour and tuning stay." before resending with `switchRig: true`.

- [ ] **Step 1: Write the failing tests** in `test/cutter-model.test.js`.
  - `every operation returns a valid cut and leaves the input untouched`: deep-freeze the input.
  - `mergePiece moves children and points to the parent` (Review Focus 4): merge an `arm` that has a `weapon` child and a point `grip`. The weapon's parent becomes `torso`, and so does `grip`'s piece.
  - `setRole to a role without a side clears side; to arm or leg requires one`
  - `splitPiece adds an extra with the line as its cut and its midpoint as the pivot`
  - `fitSize shrinks a 4000x3000 photo to 2048 on the long side and leaves small images alone`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/cutter-model.test.js`
Expected: FAIL, module not found

- [ ] **Step 3: Implement `cut-model.js`**, then run the tests.

Run: `node --test test/cutter-model.test.js`
Expected: PASS

- [ ] **Step 4: Build the page** (`index.html`, `cutter.css`, `cutter.js`, `overlay.js`), following the layout above. Keep `cutter.js` to wiring, and put drawing in `overlay.js`.

- [ ] **Step 5: Run a short smoke check in a browser.** Allow it at most 5 minutes; this is a smoke check, not a test suite. Write a throwaway `playwright-core` chromium script in the scratchpad that:
  1. starts `createLabServer({ cutsRoot: <temp copy of the needed dirs> })`;
  2. opens `/cutter`;
  3. calls `setInputFiles` with `tools/monster-cutter/fixtures/kenney/assembled/1.png`;
  4. clicks Auto;
  5. asserts that at least 5 piece rows appear and that the preview canvas has non-transparent pixels;
  6. saves under `smoke_try`, asserts a 200, and takes a screenshot.

Expected: all assertions hold. Look at the screenshot.

- [ ] **Step 6: Commit**

```bash
git add tools/monster-cutter/index.html tools/monster-cutter/cutter.css tools/monster-cutter/cutter.js tools/monster-cutter/cut-model.js tools/monster-cutter/overlay.js test/cutter-model.test.js
git commit -m "feat(cutter): the cutter page — mask, pieces, points, live preview, save"
```

---

### Task 9: Bench — live rig sliders

**Files:**
- Modify: `tools/monster-bench/bench-state.js`, `tools/monster-bench/panel.js`, `tools/monster-bench/bench.js`, `tools/monster-lab/monster-files.cjs`
- Test: `test/bench-state.test.js`, `test/monster-files.test.js`

**Interfaces:**
- Consumes: `def.rig.PARAM_SCHEMA`, `def.params` (the registry def from `getMonsterDef`), and `retuneMonster(name)`, which recomputes `stats.half` from `hitHalf`.
- Produces:
  - `makeBenchModel(def)` gains `values.params` (a copy of `def.params`) and `hasParams = Array.isArray(def.rig?.PARAM_SCHEMA)`.
  - `SECTIONS` includes `'params'`.
  - `savePatch` adds `params` when `hasParams`.
  - `restore(model, text, tuningSchema, paramSchema)`: params keys are checked and re-clamped against `paramSchema` through `clampParams`, with colour and toggle values included.
  - `updateMonster(dir, name, patch)` replaces `def.params` whole when `patch.params` is given.
  - The panel gets a section titled **Look — live** above the tuning section, with one row per `PARAM_SCHEMA` entry: a slider plus a number for a range, a checkbox for a toggle, a colour input for a colour. Its handler is `onParam(key, value)`.
  - In `bench.js`: `restore(model, takeSnapshot(store, key), def.tuningSchema, def.rig.PARAM_SCHEMA)`; before spawning, `Object.assign(def.params, model.values.params)`. `onParam` sets `def.params[k] = v` and then calls `retuneMonster(name)`.

- [ ] **Step 1: Write the failing tests**
  - `bench-state`: `the model carries the rig params and Save sends them`; `restore re-clamps params to the rig schema and drops unknown keys`; `a def without a rig schema sends no params`.
  - `monster-files`: `updateMonster replaces params whole and keeps the rest`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/bench-state.test.js test/monster-files.test.js`
Expected: FAIL

- [ ] **Step 3: Implement the four modules.**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/bench-state.test.js test/monster-files.test.js test/bench-boot.test.js test/bench-core.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/monster-bench/bench-state.js tools/monster-bench/panel.js tools/monster-bench/bench.js tools/monster-lab/monster-files.cjs test/bench-state.test.js test/monster-files.test.js
git commit -m "feat(bench): live rig-param sliders that Save writes"
```

---

### Task 10: Move monsteri onto the engine

**Files:**
- Modify: `tools/extract-monsteri.mjs`, `tools/perf/trace.mjs`, `renderer/render/monster-rigs/monsteri.js`, `renderer/data/monsters/monsteri.json`, `test/monsteri-rig.test.js`
- Create: `assets/cuts/monsteri.png`, `assets/cuts/monsteri.json`, `renderer/assets/monsters/monsteri-parts.png`, `renderer/assets/monsters/monsteri-parts.js`
- Delete: `renderer/assets/monsters/monsteri.png`, `renderer/assets/monsters/monsteri-sheet.js` (after step 7)

**Interfaces:**
- Consumes: `makeCutoutRig` (Task 5); `auto.mjs`, `preview.mjs`, `build.mjs` (Task 6).
- Produces: `monsteri.js` with exactly the exports it has today (`RIG_ID = 'monsteri'`, `PARAM_SCHEMA`, `drawMonster`, `hitHalf`, `hitShape`, `drawnTop`, `anchor`, `_setSheetImage`). It is hand-written, not from the template, because it adds `extend`, which draws the orb glow at points `orb1`, `orb2` and `orb3` when `pose.eyeGlow > 0` and the state is not `death`, using the same colours and flicker as today. `systems/monsters/monsteri.js` is unchanged.

- [ ] **Step 1: Let `trace.mjs` take a bench target.** A level argument of `bench:<name>` launches with `--bench <name>` and skips the level cheat. Record the baseline:

Run: `node tools/perf/trace.mjs bench:monsteri 5`
Expected: per-frame numbers printed. Note the JS and canvas-raster ms for the PR.

- [ ] **Step 2: Have `extract-monsteri.mjs` also write the keyed drawing at full resolution.** This is the cropped, colour-boosted `crop` buffer before `downsample`, written to `assets/cuts/monsteri.png` with `writePng`. Run it and check that the one-frame sheet is unchanged (`git diff --stat renderer/assets/monsters/monsteri.png` shows nothing).

Run: `node tools/extract-monsteri.mjs`

- [ ] **Step 3: Make the first cut and look at it**

```bash
node tools/monster-cutter/auto.mjs monsteri assets/cuts/monsteri.png --view front --faces left
node tools/monster-cutter/preview.mjs monsteri
```

Look at `tools/monster-cutter/out/monsteri-preview.png`.

- [ ] **Step 4: Correct the cut by editing `assets/cuts/monsteri.json`**, re-running `preview.mjs` after each change, until:
  - the arms (left and right) are cut at the shoulders, the legs at the hips, and the tail where it leaves the body;
  - the head carries the orb stalks as `extra` children;
  - the pieces have no leaks;
  - `outHeight` is 84 and `outline` is `#3a1416`;
  - the points are `head`, `chest`, `orb1`, `orb2` and `orb3`, converted from today's sheet pixels with source = (sheetPx − 1) × 8, giving head (29,12), chest (28,24) and orbs (20,6), (25.5,3), (30.5,3).

- [ ] **Step 5: Build, and check the rest pose against today's sheet**

Run: `node tools/monster-cutter/build.mjs monsteri`

Then a throwaway scratchpad script pastes every `PARTS` piece at its `at` into a figure buffer (the rest pose, as in Task 4's rebuild test), aligns it bottom-centre with `renderer/assets/monsters/monsteri.png` (72×86), and compares the two.
Expected: at least 95 % of the old sheet's opaque pixels are opaque in the new rest pose. Look at both images side by side.

- [ ] **Step 6: Rewrite `monsteri.js` over `makeCutoutRig`, and set monsteri's motion params in its def.** Use preview strips at S = 64 and pick values where the arms visibly swing and the feet visibly lift, but nothing tears at the joints. Put those values into `CUTOUT_SCHEMA`'s defaults as well, if they suit cut monsters in general.

- [ ] **Step 7: Update `test/monsteri-rig.test.js`.** Replace only what assumed the single frame:
  - `the generated sheet on disk matches its metadata` becomes `the parts atlas on disk matches PARTS`;
  - `blits the whole drawing` becomes `the figure is size tiles tall, feet within the lower half-tile`, with one blit per piece and one per cap;
  - the `drawnTop` test takes the Task 5 definition: within 1 px of the tallest living pose.

  Keep the orb, flip, death, hit-circle and anchor tests. Then delete `monsteri.png` and `monsteri-sheet.js`, and grep for leftovers.

Run: `grep -rn "monsteri-sheet\|monsters/monsteri.png" renderer tools test` and `npm test`
Expected: grep prints nothing; the suite passes (`monsteri.test.js` unchanged)

- [ ] **Step 8: Measure perf after the change**

Run: `node tools/perf/trace.mjs bench:monsteri 5`
Expected: per-frame JS + raster within about 1 ms of the step 1 baseline. Record both runs for the PR. If it is worse, look at the draw-call count first.

- [ ] **Step 9: Commit**

```bash
git add tools/extract-monsteri.mjs tools/perf/trace.mjs assets/cuts/monsteri.png assets/cuts/monsteri.json renderer/assets/monsters/monsteri-parts.png renderer/assets/monsters/monsteri-parts.js renderer/render/monster-rigs/monsteri.js renderer/data/monsters/monsteri.json test/monsteri-rig.test.js renderer/render/monster-rigs/cutout.js
git rm renderer/assets/monsters/monsteri.png renderer/assets/monsters/monsteri-sheet.js
git commit -m "feat(monsteri): cut into pieces — arms swing and legs step on the cut-out engine"
```

---

### Task 11: The practice set and a second shipped monster

**Files:**
- Create: `tools/monster-cutter/fixtures/{manticore.png, forest-monster.png, many-heads.png, big-tusk.png}`, `assets/cuts/manticore.{png,json}`, `renderer/assets/monsters/manticore-parts.{png,js}`, `renderer/render/monster-rigs/manticore.js` (from the template), `renderer/data/monsters/manticore.json`, `renderer/assets/monsters/CREDITS.md`
- Modify: `tools/monster-cutter/fixtures/CREDITS.md`, `renderer/data/monsters/index.json` (through `installCut`)

**Interfaces:**
- Consumes: `auto.mjs`, `preview.mjs`, `build.mjs --install` (Task 6).

- [ ] **Step 1: Download the four images into the fixtures, each into its own fresh directory first, and check that each is a PNG.**
  - Manticore: https://upload.wikimedia.org/wikipedia/commons/6/6c/DnD_Manticore.png (CC0, LadyofHats)
  - Forest Monster: https://opengameart.org/sites/default/files/prom2.png (CC0)
  - Creature with Many Heads: https://opengameart.org/sites/default/files/creature_with_many_heads_open_game_art_jfvnjfkvjnvjkgf_0.png (CC0)
  - Big Tusked Brut: https://opengameart.org/sites/default/files/big_tusk_monster_concept_art_0.png (CC0)

  Shrink each to at most 2048 px on its long side. Add each to `fixtures/CREDITS.md` with its author, page URL and licence.

- [ ] **Step 2: Cut the manticore as a side view.** Its four legs are paired for a trot: near-front and far-back are `left`, near-back and far-front `right`. Its wings are `arm`s so that they flap, and its tail is `tail`. Use `auto.mjs manticore … --view side --faces left`, then correct it in `assets/cuts/manticore.json` with `preview.mjs` until there are no leaks and the walk reads.

- [ ] **Step 3: Build and install it**

Run: `node tools/monster-cutter/build.mjs manticore --install`
Expected: the rig module is written from the template, the def is created with `spawn: null`, and `index.json` gains `manticore`.

- [ ] **Step 4: Write `renderer/assets/monsters/CREDITS.md`** (Manticore by LadyofHats, CC0, its Commons URL; monsteri, the user's own drawing).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. The generic registry/loader tests pick up the new def without warnings.

- [ ] **Step 6: Commit**

```bash
git add tools/monster-cutter/fixtures assets/cuts/manticore.png assets/cuts/manticore.json renderer/assets/monsters/manticore-parts.png renderer/assets/monsters/manticore-parts.js renderer/render/monster-rigs/manticore.js renderer/data/monsters/manticore.json renderer/data/monsters/index.json renderer/assets/monsters/CREDITS.md
git commit -m "feat(cutter): practice set and the manticore, cut from CC0 art"
```

---

### Task 12: Live check, docs, PR

**Files:**
- Modify: `CLAUDE.md` (the dungeon-crawler section, at `/home/lappemikb/CLAUDE.md`, outside the repo; not committed), `.claude/skills/arena-test/LESSONS.md` or the run journal the skill names

- [ ] **Step 1: Run the live bench check through the `arena-test` skill.** Keep it within 10 minutes. Question: "Does monsteri walk in the bench with arms swinging and legs stepping, with no gaps at the joints, while breath, orb glow, grab arms from the chest and the HP bar above its head all still work?" Pass criteria:
  - in screenshots of a walk, the arm angle and the foot height differ between frames;
  - no transparent wedge shows at a shoulder or hip;
  - the breath leaves the head;
  - the HP bar clears the top of the head.

  Also drag **Look — live › Arm swing** and confirm that the next frame changes. Journal the result as the skill requires.

- [ ] **Step 2: Update the dungeon-crawler section of `CLAUDE.md`.** In one paragraph, cover:
  - the cutter: `npm run monster-lab` then `/cutter`, and the CLIs `auto.mjs`, `preview.mjs` and `build.mjs --install`;
  - the cut-file → PARTS → engine flow, and that re-cutting rewrites data only;
  - the bench's Look section;
  - monsteri now cut;
  - the manticore shipped with `spawn: null`.

- [ ] **Step 3: Push and open the PR**, then run `npm test` once more before pushing.

```bash
git push -u origin monster-cutter
gh pr create --title "Monster cutter: art cut into animated pieces" --body "<summary of the spec, the perf before/after from Task 10, the live-check result, and the test plan>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
