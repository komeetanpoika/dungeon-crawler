import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from '../tools/png-read.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TILES = join(__dirname, '../renderer/assets/tiles')

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
})
