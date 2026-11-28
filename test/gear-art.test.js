// The art of the worn pieces: every piece has an icon, every overlay the
// hero can be dressed in is a tile on disk, and each overlay keeps to its
// own rows of the figure so that any three can be laid on each other.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from '../tools/png-read.mjs'
import { SPRITES } from '../renderer/render/sprites.js'
import { iconSpriteFor } from '../renderer/render/icons.js'
import { WORN_TYPES, makeWornContents, makeOutfitContents } from '../renderer/systems/entities.js'
import { itemFromContents } from '../renderer/systems/inventory.js'
import { HERO_PART_TILES, PIECE_HEAD, PIECE_BODY, PIECE_FEET, OUTFIT_BODY, OUTFIT_HEAD, TOE_COLOUR } from '../renderer/data/hero-parts.js'

const TILES = join(dirname(fileURLToPath(import.meta.url)), '../renderer/assets/tiles')
const file = name => join(TILES, `${name}.png`)
// which rows of a tile have any pixel in them: [first, last]
function span(name) {
  const { width, height, pixels } = readPng(file(name))
  assert.deepEqual([width, height], [16, 16], name)
  let first = null, last = null
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
    if (pixels[(y * 16 + x) * 4 + 3]) { first ??= y; last = y }
  return [first, last]
}

describe('the reader the art is cut with', () => {
  it('reads the pack\'s own 4-bit indexed tiles', () => {
    const { width, height, pixels } = readPng(file('tile_0088'))
    assert.deepEqual([width, height], [16, 16])
    const at = (x, y) => [...pixels.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)]
    assert.equal(at(0, 0)[3], 0, 'the corner is clear')
    assert.deepEqual(at(6, 0), [0x3f, 0x26, 0x31, 255], 'the outline')
    assert.deepEqual(at(7, 2), [0xbd, 0x6c, 0x4a, 255], 'the hair')
    assert.deepEqual(at(7, 6), [0xf7, 0xc2, 0x82, 255], 'the skin')
    assert.deepEqual(at(6, 7), [0x26, 0x2b, 0x44, 255], 'an eye')
  })
})

describe('icons', () => {
  it('every worn piece has an icon of its own, on disk', () => {
    for (const key of Object.keys(WORN_TYPES)) {
      assert.equal(SPRITES[`gear_${key}`], `gear_${key}`, key)
      assert.ok(existsSync(file(`gear_${key}`)), `gear_${key}.png`)
      assert.equal(iconSpriteFor(itemFromContents(makeWornContents(key))), `gear_${key}`)
    }
  })
  it('the tabard has one too, and the Leather Coat\'s is gone', () => {
    assert.equal(SPRITES.outfit_plate, 'outfit_tabard')
    assert.ok(existsSync(file('outfit_tabard')))
    assert.equal(iconSpriteFor(itemFromContents(makeOutfitContents('plate'))), 'outfit_plate')
    assert.equal(SPRITES.outfit_leather, undefined)
  })
})

describe('the overlays the hero is dressed in', () => {
  it('each is a sprite and a tile on disk', () => {
    for (const name of HERO_PART_TILES) {
      assert.equal(SPRITES[name], name, name)
      assert.ok(existsSync(file(name)), `${name}.png`)
    }
  })
  it('every headwear, armor and pair of boots shows as something', () => {
    for (const [key, def] of Object.entries(WORN_TYPES)) {
      if (def.slot === 'head') assert.ok(PIECE_HEAD[key], key)
      if (def.slot === 'armor') assert.ok(PIECE_BODY[key], key)
      if (def.slot === 'boots') { assert.ok(PIECE_FEET[key], key); assert.match(TOE_COLOUR[key], /^#[0-9a-f]{6}$/) }
      if (def.slot === 'ring') assert.match(def.tint, /^#[0-9a-f]{6}$/)
    }
    assert.deepEqual(Object.keys(OUTFIT_BODY).sort(), ['plate', 'ranger', 'robe'])
    assert.deepEqual(Object.keys(OUTFIT_HEAD).sort(), ['ranger', 'robe'])
  })
  it('a head keeps to rows 0-9, a body to 10-13 (the robe to 15), feet to 14-15', () => {
    for (const name of HERO_PART_TILES) {
      const [first, last] = span(name)
      if (name.startsWith('hero_head_')) assert.ok(first >= 0 && last <= 9, `${name}: rows ${first}-${last}`)
      else if (name === 'hero_body_robe') assert.deepEqual([first, last], [10, 15], name)
      else if (name.startsWith('hero_body_')) assert.deepEqual([first, last], [10, 13], name)
      else assert.deepEqual([first, last], [14, 15], name)
    }
  })
})
