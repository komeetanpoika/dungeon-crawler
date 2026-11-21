import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { CITY_SKINS, WALL, TOWER, GATE, HARBOUR, CASTLE, CHURCH, HOUSE_FRONT, PAVE, PROPS } from '../renderer/wilds/city/kit.js'

const TILES = new URL('../renderer/assets/tiles/', import.meta.url).pathname
const names = v => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(names) : v && typeof v === 'object' ? Object.values(v).flatMap(names) : []

test('every city skin exists as a tile', () => {
  for (const n of CITY_SKINS) assert.ok(fs.existsSync(`${TILES}${n}.png`), n)
})

test('no city tile name ends in _d', () => {
  assert.equal(CITY_SKINS.some(n => /_d$/.test(n)), false)
})

test('the kit has every group the builder needs', () => {
  for (const g of [WALL, TOWER, GATE, CASTLE, CHURCH, HOUSE_FRONT, PAVE, PROPS]) assert.ok(Object.keys(g).length)
})

test('CITY_SKINS is every name in the groups, once each', () => {
  const all = [WALL, TOWER, GATE, HARBOUR, CASTLE, CHURCH, HOUSE_FRONT, PAVE, PROPS].flatMap(names)
  assert.deepEqual([...CITY_SKINS].sort(), [...new Set(all)].sort())
  assert.equal(new Set(CITY_SKINS).size, CITY_SKINS.length)
})

test('new names keep to the prefixes: architecture, low props, flat deco, paving', () => {
  for (const n of CITY_SKINS) {
    if (!/^ow_(city|prop_city|deco_city)_/.test(n)) continue
    if (n.startsWith('ow_city_pave_')) continue
    assert.match(n, /^ow_(city|prop_city|deco_city)_[a-z0-9_]+$/, n)
  }
  for (const n of names(PAVE)) assert.ok(n.startsWith('ow_city_pave_'), n)
})

test('the wall top has a tile for each of the sixteen neighbour masks', () => {
  assert.equal(WALL.top.length, 16)
  assert.equal(new Set(WALL.top).size, 16)
})

test('multi-cell pieces are rectangles of the footprint they say', () => {
  const rect = (rows, w, h, label) => {
    assert.equal(rows.length, h, `${label}: ${h} rows`)
    for (const r of rows) assert.equal(r.length, w, `${label}: ${w} wide`)
  }
  for (const [kind, w] of [['round3', 3], ['square3', 3], ['round4', 4], ['square4', 4]]) {
    const t = TOWER[kind]
    rect(t.cap, w, 2, `${kind} cap`)
    assert.equal(t.body.length, w); assert.equal(t.base.length, w)
  }
  rect(GATE.arch2, 3, 2, 'gate arch2'); rect(GATE.arch3, 3, 3, 'gate arch3'); assert.equal(GATE.side.length, 3)
  rect(CASTLE.gate2, 3, 2, 'castle gate2'); rect(CASTLE.gate3, 3, 3, 'castle gate3')
  rect(PROPS.windmill.base, 3, 3, 'windmill')
  assert.equal(PROPS.windmill.sails.length, 4)
  for (const f of PROPS.windmill.sails) rect(f, 3, 3, 'windmill sails')
})

test('animated frames carry their suffixes', () => {
  assert.deepEqual(CASTLE.banner, ['ow_city_banner_a', 'ow_city_banner_b'])
  PROPS.windmill.sails.forEach((f, i) => { for (const n of f.flat()) assert.match(n, new RegExp(`_${i}$`)) })
  assert.equal(PROPS.lamp, 'ow_prop_city_lamp'); assert.equal(PROPS.lampLit, 'ow_prop_city_lamp_lit')
})
