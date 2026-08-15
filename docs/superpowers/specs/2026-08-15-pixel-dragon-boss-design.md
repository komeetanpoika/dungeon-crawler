# Pixel-art dragon boss — design

**Date:** 2026-08-15
**Branch:** `feat/pixel-dragon-boss`

## Goal

Give the final dragon boss an old-school pixelated look by separating the parts
it is currently made of into individual pixel sprites, developed on a copy that
lives in the level-0 test arena so the shipped depth-5 boss keeps working
throughout.

## Target look

Chosen from four rendered comparisons of the real dragon (see
`.superpowers/brainstorm/*/content/pixel-target.html`):

- **Art scale:** 1 art pixel = 4 screen pixels, i.e. **8 art px per 32px tile**.
  The body's logical box (`bw = 3S`, `bh = 4S`) is 24×32 art px; the whole
  dragon spans roughly 120×130.
- **Colour:** locked **16-colour palette**, derived from the current dragon's
  own colours. The palette does as much work as the grid — chunky pixels with
  unrestricted gradients read as "low-res", not as pixel art.

### Palette

| # | RGB | Role |
|---|---|---|
| 0 | 20,8,6 | near-black outline |
| 1 | 42,13,10 | deepest shadow |
| 2 | 58,18,13 | body underlay |
| 3 | 90,23,18 | foot pad / dark scale |
| 4 | 124,36,27 | scale mid-dark |
| 5 | 156,46,36 | wing bone |
| 6 | 184,58,44 | scale mid |
| 7 | 212,85,58 | scale light |
| 8 | 239,138,90 | highlight |
| 9 | 86,21,16 | membrane dark |
| 10 | 146,48,40 | membrane |
| 11 | 239,224,192 | claw / tooth |
| 12 | 216,184,134 | horn |
| 13 | 122,96,60 | horn shadow |
| 14 | 255,210,58 | eye glow |
| 15 | 255,122,42 | flame |

## Isolation: a skin flag, not a new entity type

`game.js` contains seven separate `e.type === 'dragon_boss'` checks — spawn,
boss-HP-bar lookup, melee capsule damage, ranged immunity, AI update, footfall
screenshake. Introducing a second *type* would require threading it through all
seven, and every future boss feature would have to remember both.

Instead the entity keeps type `dragon_boss` and gains a `skin` field. Exactly
one line branches on it, in `canvas.js`:

```js
if (e.type === 'dragon_boss') (e.skin === 'pixel' ? drawDragonBossPixel : drawDragonBoss)(ctx, e, camX, camY, S)
```

Consequences:

- The depth-5 boss spawns with no skin and renders exactly as today.
- AI, hitboxes, damage, immunities and the HP bar are *shared*, not copied, so
  the pixel dragon cannot drift out of sync with the real one.
- Swapping the pixel version in later is deleting one word.

## Parts and the sprite sheet

One PNG, `renderer/assets/tiles/dragon_boss_parts.png`, loaded by the existing
`loadSprites` (which resolves a flat `./assets/tiles/<name>.png`), registered in
`sprites.js`. A frame table in `renderer/data/dragon-parts.js` gives
`{x, y, w, h, originX, originY}` per part, where the origin is the joint the
part rotates about.

Sizes are width × height in art pixels; the body sprite is wider than its 24×32
logical box because the scale field deliberately overflows the outline (the
scalloped silhouette), plus a pixel of margin.

| Part | Size (art px) | Count | Notes |
|---|---|---|---|
| Body | 34×42 | 1 | rigid |
| Head + horns | 30×34 | 1 | rotates with the neck tip |
| Wing | 60×46 | 1 | mirrored for the left wing |
| Foot + claws | 26×26 | 1 | mirrored/rotated for all four |
| Neck plates | widths 8,7,7,6,5 — all 10 tall | 5 | one per neck joint |
| Tail plates | widths 11,9,8,6,5 — all 11 tall | 5 | joints 0–4 |
| Tail tip | ~8×12 | 1 | replaces joints 5–6 |
| Flame cone | 48×34 | 1 | breath / sweep only |

### Why the tail tip is fused

The neck and tail are articulated chains, so each segment needs its own sprite —
baking a chain as one image would freeze its bend. But the taper was authored
for vector art: adjacent neck plates differ by 0.6 art px, and tail joints 5 and
6 come out 3.8 and 2.4 px wide, which is a smear rather than a drawable scale
plate.

Resolution: **the rig keeps all 5 neck and 7 tail joints** (so motion and
`capsules.js` are untouched), but the last two tail plates are replaced by a
single drawn tail-tip sprite riding the final joint. Nothing in the sheet ends
up under 3 px, and no joint is lost.

### How the sheet is produced

A committed bake script, `tools/bake-dragon-parts.mjs`, renders each part out of
the existing vector code in isolation at art scale, palette-quantises it, and
packs the sheet. This gives a complete, recognisable sheet on day one; parts are
then hand-refined in a pixel editor and replace the baked versions one at a
time.

**Overwrite guard:** the bake writes `dragon_boss_parts.generated.png`. The
shipped `dragon_boss_parts.png` is only overwritten when the script is run with
`--force`. Hand-drawn work cannot be clobbered by re-running the bake.

## Renderer

New module `renderer/render/dragonboss-pixel.js`, exporting
`drawDragonBossPixel(ctx, e, camX, camY, S)` — the same signature as the current
renderer.

- All parts composite into **one reused offscreen canvas at art resolution**
  (~140×140), which is then blitted ×4 with `imageSmoothingEnabled = false`.
  Rotation therefore happens *inside* the low-res buffer, so every part shares a
  single pixel grid instead of aliasing independently. This is what makes
  rotated pixel sprites read as deliberate rather than broken.
- The buffer is allocated once and reused across frames, not per draw.
- Draw order is unchanged: feet → tail → neck → body → flame → head → wings.
- Part positions snap to whole art pixels.
- The body's ±2% breathing scale becomes a **1px bob**; scaling a pixel sprite
  by 1.02 destroys the grid.

### Frames-later hook

A `PART_FRAMES` table keyed by `e.state` maps a state to optional authored frame
sprites per part. When a state has a frame for a part, it replaces that part's
rigged draw; otherwise the rig draws it. The table ships **empty** — the
structure exists so hand-authored frames (most likely the breath attack's
open-jaw head) can be added later without reworking the renderer, but no art is
owed now.

## Hitboxes are provably untouched

`capsules.js` derives every capsule from `bw = 3S`, `bh = 4S` and the animation
state fields (`neckRear`, `headAim`, `tailSwing`). It never reads the drawing
internals. As long as the pixel dragon keeps the same proportions and rig,
`dragonCapsules` output is identical — asserted by a test rather than assumed.

## Arena wiring

- `dragon_boss_pixel` added to `ENEMY_KINDS` in `map.js`.
- `buildEntities` in `game.js` gains a `dragon_boss_pixel` case producing
  `makeDragonBoss(...)` with `skin: 'pixel'`.
- `'Q'` legend char in `levels.js` (`label: 'Boss (pixel)'`) so it can be painted
  in the tile editor.
- The arena-test skill's enemy-kind list gains `dragon_boss_pixel`.

Spawning is then `{"kind": "dragon_boss_pixel"}` in `arena-config.json`.

## Testing

`node --test test/`, following the existing per-system file convention:

1. **Skin plumbing** — the arena kind produces an entity of type `dragon_boss`
   carrying `skin: 'pixel'`.
2. **Frame table integrity** — every declared part rect fits within the sheet's
   bounds, and every part the renderer asks for exists in the table.
3. **Hitbox parity** — `dragonCapsules` output is identical with and without the
   skin flag, across several poses.
4. **Render smoke test** (playwright-core, matching the existing canvas tests) —
   drawing the pixel boss produces non-blank output.
5. **Palette conformance** — every opaque pixel in a rendered frame is one of
   the 16 palette colours. This keeps hand-drawn replacements honest
   automatically.

## Risks

- **Seams between parts.** Rotating parts inside a shared low-res buffer can
  leave 1px gaps where the body meets the neck base or the wing root. Verified
  visually in the arena; mitigated by overlapping part origins slightly.
- **Binary asset churn.** The sheet is a PNG, so edits are opaque in diffs. The
  `--force` guard above is the main protection; the bake script keeps it
  reproducible from source.
- **Per-frame cost.** One offscreen composite plus one scaled blit per frame.
  Expected to be cheaper than today's several-hundred `shieldScale` calls, but
  worth measuring in the arena rather than assuming.

## Out of scope

- Replacing the depth-5 boss. That is a one-word change made deliberately, later,
  once the art is good.
- Pixelating any other entity, tile or the HUD.
- Hand-authored frame animation for any state (the hook ships empty).
