import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readPng } from '../tools/png-read.mjs'
import { WALLS, FLOORS, RUGS, ITEMS, INTERIOR_SKINS, PALETTES } from '../renderer/interior/kit.js'

const file = name => new URL(`../renderer/assets/tiles/${name}.png`, import.meta.url)

describe('interior tile kit', () => {
  it('has a picture of 16x16 for every name it can lay', () => {
    assert.ok(INTERIOR_SKINS.length > 100, `only ${INTERIOR_SKINS.length} names`)
    for (const name of INTERIOR_SKINS) {
      assert.ok(name.startsWith('in_') || name.startsWith('tile_'), name)
      assert.ok(existsSync(file(name)), `missing ${name}.png`)
      if (!name.startsWith('in_')) continue   // the game's own tiles (an open chest) are checked elsewhere
      const png = readPng(file(name))
      assert.equal(png.width, 16, name); assert.equal(png.height, 16, name)
    }
  })
  it('names a wall top for each of the 16 neighbour masks, and both face rows, in every palette', () => {
    assert.deepEqual(PALETTES, ['plaster', 'grey', 'pale', 'wood'])
    for (const p of PALETTES) {
      assert.equal(WALLS[p].top.length, 16, p)
      assert.equal(new Set(WALLS[p].top).size, 16, `${p}: a mask shares a piece`)
      for (const k of ['l', 'm', 'r']) { assert.ok(WALLS[p].faceU[k], `${p} faceU.${k}`); assert.ok(WALLS[p].faceL[k], `${p} faceL.${k}`) }
      assert.ok(WALLS[p].faceL.lr, `${p} faceL.lr`)
    }
  })
  it('lists only names it knows', () => {
    const known = new Set(INTERIOR_SKINS)
    const names = [
      ...PALETTES.flatMap(p => [...WALLS[p].top, ...Object.values(WALLS[p].faceU), ...Object.values(WALLS[p].faceL)]),
      ...Object.values(FLOORS).flat(),
      ...Object.values(RUGS).flatMap(r => r.flat()),
      ...Object.values(ITEMS).flatMap(i => i.tiles.flat()),
    ]
    for (const n of names) assert.ok(known.has(n), `${n} is laid but not in INTERIOR_SKINS`)
  })
  it('keeps the dusty suffix for dusty twins: no picture of its own ends in _d', () => {
    const own = Object.values(ITEMS).flatMap(i => i.tiles.flat())
    for (const n of own) assert.ok(!n.endsWith('_d'), `${n} reads as a dusty twin`)
  })
  it('gives every item a footing and a 3x3 for every rug', () => {
    for (const [id, item] of Object.entries(ITEMS)) {
      assert.ok(['face', 'faceUpper', 'faceLower', 'floor'].includes(item.on), `${id}.on = ${item.on}`)
      assert.ok(item.tiles.length >= 1 && item.tiles.every(r => r.length === item.tiles[0].length), `${id} tiles ragged`)
      if (item.on === 'face') assert.equal(item.tiles.length, 2, `${id}: a face item is two rows`)
      if (item.on !== 'face' && item.on !== 'floor') assert.equal(item.tiles.length, 1, `${id}: a one-row face item`)
    }
    for (const [c, r] of Object.entries(RUGS)) { assert.equal(r.length, 3, c); assert.ok(r.every(row => row.length === 3), c) }
  })
})
