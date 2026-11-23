import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readPng } from '../tools/png-read.mjs'
import { WALLS, FLOORS, RUGS, ITEMS, MISC, SHADE_KIND, INTERIOR_SKINS, PALETTES } from '../renderer/interior/kit.js'

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
  it('has the church and castle pieces in the footprint and footing the buildings lay them by', () => {
    // key: [on, width, height, blocks]
    const want = {
      pew: ['floor', 1, 1, false], altar: ['floor', 2, 1, true], pulpit: ['floor', 1, 1, true], font: ['floor', 1, 1, true],
      organ: ['face', 2, 2], organ_bench: ['floor', 1, 1, false], bell: ['floor', 1, 1, true], tomb: ['floor', 1, 2, true],
      sampo_lid: ['floor', 1, 1, true], throne: ['floor', 1, 1, false], banner_red: ['face', 1, 2], banner_blue: ['face', 1, 2],
      window_glass_a: ['face', 1, 2], window_glass_b: ['face', 1, 2], window_glass_c: ['face', 1, 2],
      candle: ['floor', 1, 1, false], torch: ['faceUpper', 1, 1], celldoor: ['floor', 1, 1, true],
      fireplace: ['face', 2, 2], longtable: ['floor', 3, 1, true], drape: ['face', 1, 2],
    }
    for (const [key, [on, w, h, blocks]] of Object.entries(want)) {
      const item = ITEMS[key]
      assert.ok(item, key)
      assert.equal(item.on, on, key)
      assert.equal(item.tiles[0].length, w, `${key} width`); assert.equal(item.tiles.length, h, `${key} height`)
      if (on === 'floor') assert.equal(item.block !== false, blocks, `${key} blocks`)
      for (const n of item.tiles.flat()) assert.ok(n.startsWith(`in_${key}`), `${n} is named for ${key}`)
    }
    for (const n of [MISC.stairUp, MISC.stairDown, MISC.crack]) assert.ok(INTERIOR_SKINS.includes(n), `${n} is loaded`)
  })
})

describe('furniture shading kinds', () => {
  it('every item tile has a shade kind, flat things and the room itself have none', () => {
    for (const [key, item] of Object.entries(ITEMS)) {
      const flat = ['bedroll', 'bedroll2', 'rubble', 'bones', 'skull'].includes(key) || /^web/.test(key)
      for (const name of item.tiles.flat()) {
        if (flat) assert.equal(SHADE_KIND.get(name), undefined, name)
        else assert.ok(['cast', 'rim'].includes(SHADE_KIND.get(name)), name)
        if (item.dusty && !flat) assert.equal(SHADE_KIND.get(name + '_d'), SHADE_KIND.get(name), name + '_d')
      }
    }
    assert.equal(SHADE_KIND.get(ITEMS.window.tiles[0][0]), 'rim')
    assert.equal(SHADE_KIND.get(ITEMS.table.tiles[0][0]), 'cast')
    assert.equal(SHADE_KIND.get(ITEMS.wardrobe.tiles[0][0]), 'rim', 'the upper tile of a face item')
    assert.equal(SHADE_KIND.get(ITEMS.wardrobe.tiles[1][0]), 'cast', 'its foot')
    for (const n of [MISC.doormat, MISC.void, FLOORS.planks[0], RUGS.red[0][0], WALLS.plaster.top[0]]) assert.equal(SHADE_KIND.get(n), undefined, n)
  })

  it('no tile name is given two different shade kinds by two items', () => {
    const seen = new Map()
    for (const [key, item] of Object.entries(ITEMS)) {
      item.tiles.forEach((row, r) => row.forEach(name => {
        const kind = item.on === 'faceUpper' || (item.on === 'face' && r === 0) ? 'rim' : 'cast'
        if (seen.has(name) && seen.get(name).kind !== kind) assert.fail(`${name}: ${seen.get(name).kind} by ${seen.get(name).key}, ${kind} by ${key}`)
        seen.set(name, { kind, key })
      }))
    }
  })
})
