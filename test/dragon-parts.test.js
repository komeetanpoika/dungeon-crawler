import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DRAGON_PALETTE, PALETTE_KEYS, rgbKey } from '../renderer/data/dragon-palette.js'
import { readPng } from '../tools/png-read.mjs'
import { SHEET_SPRITE, PARTS, PART_NAMES, ART_PX } from '../renderer/data/dragon-parts.js'
import { dragonPartPlacements, BUF } from '../renderer/render/dragonboss-pixel.js'
import { SPRITES } from '../renderer/render/sprites.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SHEET_FILE = join(__dirname, '../renderer/assets/tiles/dragon_boss_parts.png')

describe('DRAGON_PALETTE', () => {
  it('has exactly 16 colours', () => {
    assert.equal(DRAGON_PALETTE.length, 16)
  })

  it('has no duplicates', () => {
    assert.equal(PALETTE_KEYS.size, 16)
  })

  it('is all valid 8-bit RGB triples', () => {
    for (const c of DRAGON_PALETTE) {
      assert.equal(c.length, 3)
      for (const v of c) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `bad channel ${v}`)
    }
  })

  it('rgbKey round-trips a palette entry into the lookup set', () => {
    assert.ok(PALETTE_KEYS.has(rgbKey(255, 210, 58)), 'eye-glow yellow should be in the palette')
    assert.ok(!PALETTE_KEYS.has(rgbKey(1, 2, 3)), 'an unrelated colour should not be')
  })

  it('is frozen: writing to a channel does not change its value', () => {
    const original = DRAGON_PALETTE[0][0]
    try { DRAGON_PALETTE[0][0] = 999 } catch { /* strict mode throws on a frozen write; either way, check the value */ }
    assert.equal(DRAGON_PALETTE[0][0], original)
  })
})

describe('dragon part sheet', () => {
  it('is registered in SPRITES and exists on disk', () => {
    assert.equal(SPRITES[SHEET_SPRITE], 'dragon_boss_parts')
    assert.ok(existsSync(SHEET_FILE), 'run: node tools/bake-dragon-parts.mjs --force')
  })

  // Both lists come out of one bake, so agreeing proves nothing about the bake.
  // What it does catch is a HAND edit — the file says it is safe to hand-tune
  // frames — adding or removing a frame without touching the name list.
  it('PART_NAMES and PARTS name exactly the same set of parts', () => {
    assert.deepEqual([...PART_NAMES].sort(), Object.keys(PARTS).sort())
  })

  it('every frame fits inside the sheet, with a sane origin', () => {
    const img = readPng(SHEET_FILE)
    for (const [name, f] of Object.entries(PARTS)) {
      assert.ok(f.w > 0 && f.h > 0, `${name} has a zero-size frame`)
      assert.ok(f.x >= 0 && f.y >= 0, `${name} frame starts off-sheet`)
      assert.ok(f.x + f.w <= img.width, `${name} overruns the sheet width`)
      assert.ok(f.y + f.h <= img.height, `${name} overruns the sheet height`)
      assert.ok(f.ox >= 0 && f.ox <= f.w, `${name} origin x outside the frame`)
      assert.ok(f.oy >= 0 && f.oy <= f.h, `${name} origin y outside the frame`)
    }
  })

  it('has no sprite thinner than 3 art px', () => {
    // The fused tail tip exists precisely so nothing is an undrawable smear.
    for (const [name, f] of Object.entries(PARTS)) {
      assert.ok(Math.min(f.w, f.h) >= 3, `${name} is ${f.w}x${f.h} — too small to draw`)
    }
  })

  it('every opaque pixel is on the palette', () => {
    const img = readPng(SHEET_FILE)
    const offenders = new Set()
    for (let i = 0; i < img.pixels.length; i += 4) {
      if (img.pixels[i + 3] === 0) continue
      const k = rgbKey(img.pixels[i], img.pixels[i + 1], img.pixels[i + 2])
      if (!PALETTE_KEYS.has(k)) offenders.add(`#${k.toString(16).padStart(6, '0')}`)
    }
    assert.deepEqual([...offenders], [], 'off-palette colours found in the sheet')
  })

  it('has no partially transparent pixels', () => {
    // Pixel art is fully on or fully off; soft edges are how a downsample looks.
    const img = readPng(SHEET_FILE)
    let soft = 0
    for (let i = 3; i < img.pixels.length; i += 4) {
      if (img.pixels[i] !== 0 && img.pixels[i] !== 255) soft++
    }
    assert.equal(soft, 0, `${soft} pixels have partial alpha`)
  })

  it('no two frames overlap on the sheet', () => {
    const frames = Object.entries(PARTS)
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        const [an, a] = frames[i], [bn, b] = frames[j]
        const disjoint = a.x + a.w <= b.x || b.x + b.w <= a.x ||
                         a.y + a.h <= b.y || b.y + b.h <= a.y
        assert.ok(disjoint, `${an} and ${bn} overlap on the sheet`)
      }
    }
  })
})

// Clipping is the pixel boss's one SILENT failure mode: a part that reaches past
// the compositing buffer is simply cropped, on a canvas nobody ever looks at, in
// whatever pose happens to trigger it. Nothing throws and nothing else fails.
// The headroom is a few art px, so redrawing the flame cone out to full length
// (the obvious next art change) is expected to blow through it — this is the
// test that will say so, instead of the boss quietly losing its breath.
//
// The check is cheap because dragonPartPlacements() is pure geometry and the
// baked sheet is committed: the opaque bounding box of each frame is readable
// straight off the PNG.
describe('the rig fits inside the compositing buffer', () => {
  // Opaque bounding box of one frame, as a rect in the sprite's own art-px
  // space relative to its (ox, oy) origin — the same space drawImage() places
  // it in, so the pixel at local (lx, ly) covers [lx - ox, lx + 1 - ox).
  const opaqueBox = (img, f) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let ly = 0; ly < f.h; ly++) for (let lx = 0; lx < f.w; lx++) {
      if (img.pixels[((f.y + ly) * img.width + (f.x + lx)) * 4 + 3] === 0) continue
      if (lx < x0) x0 = lx; if (lx > x1) x1 = lx
      if (ly < y0) y0 = ly; if (ly > y1) y1 = ly
    }
    return x1 < x0 ? null : { l: x0 - f.ox, r: x1 + 1 - f.ox, t: y0 - f.oy, b: y1 + 1 - f.oy }
  }

  it('no pose reaches past BUF / 2 from the buffer centre', () => {
    const img = readPng(SHEET_FILE)
    const boxes = {}
    for (const [name, f] of Object.entries(PARTS)) boxes[name] = opaqueBox(img, f)

    // A full sweep: breathTime well past the slowest term's period (the neck's
    // sin(t * 0.9), ~7.0s), crossed with every state and the documented extremes
    // of the three externally driven pose inputs.
    const times = []
    for (let t = 0; t < 15; t += 0.1) times.push(t)
    const S = 32
    let worst = { d: -1 }
    for (const breathTime of times)
      for (const state of ['idle', 'cone', 'sweep'])
        for (const neckRear of [0, 0.5, 1])
          for (const headAim of [-0.7, 0, 0.7])
            for (const tailSwing of [-0.6, 0, 1]) {
              const e = { breathTime, state, neckRear, headAim, tailSwing }
              for (const p of dragonPartPlacements(e, S)) {
                const b = boxes[p.part]
                if (!b) continue
                const c = Math.cos(p.ang), s = Math.sin(p.ang), m = p.flipX ? -1 : 1
                for (const [lx, ly] of [[b.l, b.t], [b.r, b.t], [b.l, b.b], [b.r, b.b]]) {
                  const mx = lx * m
                  const X = p.x + mx * c - ly * s
                  const Y = p.y + mx * s + ly * c
                  // Chebyshev, not Euclidean: the buffer is a square, so each
                  // axis is clipped at BUF / 2 independently.
                  const d = Math.max(Math.abs(X), Math.abs(Y))
                  if (d > worst.d) worst = { d, X, Y, part: p.part, pose: e }
                }
              }
            }

    const budget = BUF / 2
    // Guards the guard: an empty sheet would make every box null and the sweep
    // would pass by measuring nothing at all.
    assert.ok(worst.d > 0, 'the sweep measured no opaque art — is the sheet blank?')
    assert.ok(worst.d < budget,
      `${worst.part} reaches ${worst.d.toFixed(1)} art px from the buffer centre ` +
      `(x ${worst.X.toFixed(1)}, y ${worst.Y.toFixed(1)}), over the BUF / 2 = ${budget} budget ` +
      `by ${(worst.d - budget).toFixed(1)} — pose ${JSON.stringify(worst.pose)}. ` +
      `Grow HALF_REACH_PX in renderer/render/dragonboss-pixel.js to at least ` +
      `${Math.ceil(worst.d * ART_PX) + 2 * ART_PX} screen px, or the part is silently cropped.`)
  })
})
