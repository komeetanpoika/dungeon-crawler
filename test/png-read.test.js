import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { readPng } from '../tools/png-read.mjs'
import { encodePng } from '../tools/png-write.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TILES = join(__dirname, '../renderer/assets/tiles')

// --- synthetic PNG builders, for exercising decode paths without fixture files ---
// readPng deliberately doesn't validate chunk CRCs, so a zeroed CRC decodes fine.

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.from([0, 0, 0, 0])])
}

function makePng({ width, height, colorType, idatRaw, plte, trns }) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8            // bit depth
  ihdr[9] = colorType
  ihdr[10] = 0            // compression
  ihdr[11] = 0            // filter method
  ihdr[12] = 0            // interlace
  const parts = [sig, chunk('IHDR', ihdr)]
  if (plte) parts.push(chunk('PLTE', plte))
  if (trns) parts.push(chunk('tRNS', trns))
  parts.push(chunk('IDAT', deflateSync(idatRaw)))
  parts.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}

// readPng takes a path, so synthetic PNGs need to land on disk first.
function writeTempPng(buf) {
  const dir = mkdtempSync(join(tmpdir(), 'png-read-'))
  const path = join(dir, 'synthetic.png')
  writeFileSync(path, buf)
  return path
}

describe('readPng', () => {
  it('decodes an 8-bit RGBA tile to the right dimensions', () => {
    const img = readPng(join(TILES, 'tile_0000.png'))
    assert.equal(img.width, 16)
    assert.equal(img.height, 16)
    assert.equal(img.pixels.length, 16 * 16 * 4)
  })

  it('produces at least one fully opaque pixel', () => {
    const img = readPng(join(TILES, 'tile_0000.png'))
    let opaque = 0
    for (let i = 3; i < img.pixels.length; i += 4) if (img.pixels[i] === 255) opaque++
    assert.ok(opaque > 0, 'expected some opaque pixels in the floor tile')
  })

  it('rejects a bit depth it cannot decode, naming the file', () => {
    // creature_dragon.png is 4-bit indexed — deliberately unsupported.
    assert.throws(() => readPng(join(TILES, 'creature_dragon.png')), /only 8-bit/)
  })

  it('decodes partial alpha faithfully on an RGBA image', () => {
    // 2x1 RGBA, one row, filter type 0 (None): pixel0 alpha 128, pixel1 alpha 255.
    const idatRaw = Buffer.from([0, 10, 20, 30, 128, 40, 50, 60, 255])
    const path = writeTempPng(makePng({ width: 2, height: 1, colorType: 6, idatRaw }))
    const img = readPng(path)
    assert.deepEqual(Array.from(img.pixels), [10, 20, 30, 128, 40, 50, 60, 255])
  })

  it('resolves indexed colour + tRNS alpha, defaulting missing entries to opaque', () => {
    // 2-entry palette: 0 -> red, 1 -> green. tRNS has 1 byte, so only entry 0 has an
    // explicit alpha (100); entry 1 falls back to the short-tRNS default of 255.
    const plte = Buffer.from([255, 0, 0, 0, 255, 0])
    const trns = Buffer.from([100])
    const idatRaw = Buffer.from([0, 0, 1]) // filter 0, then indices 0 and 1
    const path = writeTempPng(makePng({ width: 2, height: 1, colorType: 3, idatRaw, plte, trns }))
    const img = readPng(path)
    assert.deepEqual(Array.from(img.pixels), [255, 0, 0, 100, 0, 255, 0, 255])
  })

  it('throws a named error for an indexed image with no PLTE chunk', () => {
    const idatRaw = Buffer.from([0, 0]) // filter 0, single index byte
    const path = writeTempPng(makePng({ width: 1, height: 1, colorType: 3, idatRaw }))
    assert.throws(() => readPng(path), /missing PLTE/)
  })

  it('applies the Sub filter (type 1) as well as None', () => {
    // Greyscale, 3px wide, 2 rows. Row 0 unfiltered: 10, 20, 30.
    // Row 1 uses Sub filtering to reconstruct 5, 15, 25.
    const idatRaw = Buffer.from([
      0, 10, 20, 30,   // row 0, filter None
      1, 5, 10, 10,     // row 1, filter Sub: 5, 5+10=15, 15+10=25
    ])
    const path = writeTempPng(makePng({ width: 3, height: 2, colorType: 0, idatRaw }))
    const img = readPng(path)
    assert.deepEqual(Array.from(img.pixels), [
      10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255,
      5, 5, 5, 255, 15, 15, 15, 255, 25, 25, 25, 255,
    ])
  })
})

describe('png-write round trip', () => {
  it('readPng decodes what encodePng wrote', () => {
    const w = 3, h = 2
    const rgba = new Uint8Array([255,0,0,255, 0,255,0,255, 0,0,255,255, 0,0,0,0, 255,255,255,255, 10,20,30,40])
    const p = join(mkdtempSync(join(tmpdir(), 'png-')), 'rt.png')
    writeFileSync(p, encodePng(w, h, rgba))
    const img = readPng(p)
    assert.equal(img.width, w); assert.equal(img.height, h)
    assert.deepEqual([...img.pixels], [...rgba])
  })
})
