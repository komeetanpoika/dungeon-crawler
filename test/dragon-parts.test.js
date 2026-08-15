import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DRAGON_PALETTE, PALETTE_KEYS, rgbKey } from '../renderer/data/dragon-palette.js'
import { readPng } from '../tools/png-read.mjs'
import { SHEET_SPRITE, PARTS, PART_NAMES } from '../renderer/data/dragon-parts.js'
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

  it('declares every part the renderer asks for', () => {
    for (const name of PART_NAMES) {
      assert.ok(PARTS[name], `PART_NAMES lists ${name} but PARTS has no frame for it`)
    }
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
