// Engine support for the Wilds: the chase field stops at a limit on big
// maps, A* reuses its scratch arrays, the tile cache follows a re-centre,
// and depth 20 exists as a mode, a level, a theme and a weather entry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { buildNavGrid, findPath, buildFlowField } from '../renderer/systems/nav.js'
import { getPlayerField } from '../renderer/systems/act.js'
import { makeTileLayer, makeDirectTileLayer, CHUNK, MAX_CHUNKS } from '../renderer/render/tile-layer.js'
import { modeForDepth } from '../renderer/systems/mode.js'
import { LEVEL_CONFIG, DEPTH_THEMES, WILDS_DEPTH } from '../renderer/data/levels.js'
import { weatherFor } from '../renderer/data/weather.js'
import { MAP_CLEAR_OUTFITS } from '../renderer/systems/outfits.js'

function openMap(w, h) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) map[y][x].tile = TILE.FLOOR
  return map
}

test('a flow field stops at its limit', () => {
  const nav = buildNavGrid(openMap(100, 100))
  const at = (f, x, y) => f.dist[y * nav.w + x]
  const limited = buildFlowField(nav, 50, 50, 1, 10)
  assert.equal(at(limited, 50, 50), 0)
  assert.ok(Number.isFinite(at(limited, 59, 50)))
  assert.equal(at(limited, 62, 50), Infinity)
  assert.equal(at(limited, 50, 30), Infinity)
  const full = buildFlowField(nav, 50, 50)
  assert.ok(Number.isFinite(at(full, 62, 50)))
  assert.ok(Number.isFinite(at(full, 2, 2)))
  assert.equal(at(full, 59, 50), at(limited, 59, 50))
})

test('the player field is limited in the Wilds and whole everywhere else', () => {
  const wilds = { map: openMap(240, 240), player: { x: 120, y: 120 }, wilds: true }
  const f = getPlayerField(wilds)
  assert.ok(Number.isFinite(f.dist[120 * 240 + 160]), '40 tiles away is covered')
  assert.equal(f.dist[120 * 240 + 180], Infinity, '60 tiles away is not')
  const small = { map: openMap(120, 80), player: { x: 10, y: 10 } }
  assert.ok(Number.isFinite(getPlayerField(small).dist[70 * 120 + 110]))
  // the depth-6 sandbox is bigger than a Wilds piece but is not the Wilds
  const sandbox = { map: openMap(180, 116), player: { x: 10, y: 10 } }
  assert.ok(Number.isFinite(getPlayerField(sandbox).dist[100 * 180 + 170]), 'another mode keeps its whole field')
})

test('findPath gives the same path again, and after a map of another size', () => {
  const a = buildNavGrid(openMap(60, 40))
  a.walk  // touch
  const wall = openMap(60, 40)
  for (let y = 5; y < 35; y++) wall[y][30].tile = TILE.WALL
  const navWall = buildNavGrid(wall)
  const p1 = findPath(navWall, 10, 20, 50, 20)
  const other = findPath(buildNavGrid(openMap(30, 30)), 2, 2, 27, 27)
  const p2 = findPath(navWall, 10, 20, 50, 20)
  assert.ok(p1.length >= 40)
  assert.ok(p1.every(w => w.x !== 30 || w.y < 5 || w.y >= 35), 'the path goes round the wall')
  assert.deepEqual(p2, p1)
  assert.equal(other.length, 25)
  assert.deepEqual(findPath(a, 10, 20, 50, 20), findPath(a, 10, 20, 50, 20))
  // unreachable is still null, not a stale path from the call before
  const sealed = openMap(60, 40)
  for (const [x, y] of [[49, 19], [50, 19], [51, 19], [49, 20], [51, 20], [49, 21], [50, 21], [51, 21]]) sealed[y][x].tile = TILE.WALL
  const navSealed = buildNavGrid(sealed)
  findPath(navWall, 10, 20, 50, 20)
  assert.equal(findPath(navSealed, 10, 20, 50, 20), null)
})

// A canvas stub that counts what is drawn on it.
function fakeCanvas() {
  const calls = []
  const ctx = new Proxy({ calls, imageSmoothingEnabled: false }, {
    get(t, p, r) { return p in t ? Reflect.get(t, p, r) : (...a) => { calls.push([p, ...a]) } },
    set(t, p, v) { t[p] = v; return true },
  })
  return { width: 0, height: 0, ctx, getContext: () => ctx }
}

test('rekey moves the baked chunks with the window', () => {
  const S = 32
  const layer = makeTileLayer(fakeCanvas)
  const mapA = openMap(240, 240)
  for (const row of mapA) for (const c of row) c.explored = true
  const screen = fakeCanvas()
  // look at chunks (6..7, 2): camera at tile 96..127, 32..47
  layer.draw(screen.ctx, mapA, {}, S, 96 * S, 32 * S, 32 * S, 16 * S, 0.5)
  assert.ok(layer.chunks.has('6,2') && layer.chunks.has('7,2'))
  const moved = layer.chunks.get('7,2')
  const bakedCalls = moved.ctx.calls.length
  assert.ok(bakedCalls > 0)
  // the window steps one piece east: everything is 5 chunks further west
  const mapB = mapA.map(row => [...row.slice(80), ...row.slice(0, 80)])
  layer.rekey(mapA, mapB, -80 / CHUNK, 0)
  assert.equal(layer.map, mapB)
  assert.equal(layer.chunks.get('2,2'), moved)
  assert.ok(!layer.chunks.has('7,2') || layer.chunks.get('7,2') !== moved)
  assert.ok(![...layer.chunks.keys()].some(k => k.startsWith('-')), 'chunks off the map are dropped')
  layer.draw(screen.ctx, mapB, {}, S, 32 * S, 32 * S, 16 * S, 16 * S, 0.5)
  assert.equal(moved.ctx.calls.length, bakedCalls, 'the moved chunk was not baked again')
  // a rekey for a map it never drew simply adopts it
  const other = makeTileLayer(fakeCanvas)
  other.rekey(mapA, mapB, 5, 5)
  assert.equal(other.map, mapB)
  assert.equal(other.chunks.size, 0)
  makeDirectTileLayer().rekey(mapA, mapB, 1, 0)   // the uncached layer has nothing to move
})

test('rekey only moves chunks baked from the map it is told was there before', () => {
  const S = 32
  const layer = makeTileLayer(fakeCanvas)
  const cave = openMap(48, 32), surface = openMap(240, 240), shifted = openMap(240, 240)
  for (const m of [cave, surface]) for (const row of m) for (const c of row) c.explored = true
  layer.draw(fakeCanvas().ctx, cave, {}, S, 0, 0, 32 * S, 16 * S, 0.5)
  assert.ok(layer.chunks.size > 0)
  // the surface was never drawn (a cave was): its chunks must not be passed off as the surface's
  layer.rekey(surface, shifted, -5, 0)
  assert.equal(layer.chunks.size, 0)
  assert.equal(layer.map, shifted)
})

test('the tile cache stays bounded while wandering a big map', () => {
  const S = 32
  const layer = makeTileLayer(fakeCanvas)
  const map = openMap(240, 240)
  for (const row of map) for (const c of row) c.explored = true
  const screen = fakeCanvas()
  for (let ty = 0; ty < 240 - 16; ty += 16) for (let tx = 0; tx < 240 - 32; tx += 32)
    layer.draw(screen.ctx, map, {}, S, tx * S, ty * S, 32 * S, 16 * S, 0.5)
  assert.ok(MAX_CHUNKS >= 40, 'room for every chunk of a 120x80 map')
  assert.ok(layer.chunks.size <= MAX_CHUNKS, `cache holds ${layer.chunks.size} chunks`)
  // what is on screen now is still cached
  layer.draw(screen.ctx, map, {}, S, 0, 0, 32 * S, 16 * S, 0.5)
  assert.ok(layer.chunks.has('0,0') && layer.chunks.has('1,0'))
})

test('depth 20 is the Wilds', () => {
  assert.equal(WILDS_DEPTH, 20)
  assert.equal(modeForDepth(20), 'wilds')
  assert.equal(modeForDepth(19), 'rush')
  const cfg = LEVEL_CONFIG.find(c => c.depth === 20)
  assert.ok(cfg, 'a LEVEL_CONFIG row enables the level20 cheat')
  assert.deepEqual([cfg.mapW, cfg.mapH, cfg.monsterDensity, cfg.guardCount], [240, 240, 0, 0])
  assert.equal(LEVEL_CONFIG.filter(c => c.depth === 20).length, 1)
  assert.ok(DEPTH_THEMES.some(t => t.depths.includes(20) && !t.ruleset), 'a theme without a ruleset')
  assert.equal(weatherFor({ name: 'wilds' }).dayCycle, true)
  assert.equal(MAP_CLEAR_OUTFITS.wilds, 'ranger')
})

// ---- the Wilds' tiles load when the Wilds is entered ----------------------------
test('loadMoreSprites fetches only the pictures it does not have yet', async () => {
  const { loadMoreSprites, missingSprites } = await import('../renderer/render/sprites.js')
  assert.deepEqual(missingSprites({ a: 1, b: 2 }, ['a', 'c', 'c', 'd']), ['c', 'd'])
  const asked = []
  const realImage = globalThis.Image
  globalThis.Image = class {
    set src(v) { asked.push(v); queueMicrotask(() => v.includes('broken') ? this.onerror() : this.onload()) }
  }
  const realWarn = console.warn
  const warned = []
  console.warn = m => warned.push(m)
  try {
    const had = { ow_grass_0: 'kept' }
    const out = await loadMoreSprites(had, ['ow_grass_0', 'ow_roof_blue_l', 'ow_roof_blue_l', 'ow_broken'])
    assert.equal(out, had, 'it fills the set it was given')
    assert.deepEqual(asked, ['./assets/tiles/ow_roof_blue_l.png', './assets/tiles/ow_broken.png'])
    assert.equal(had.ow_grass_0, 'kept')
    assert.ok(had.ow_roof_blue_l instanceof globalThis.Image)
    assert.ok(!('ow_broken' in had), 'a missing file is not a picture')
    assert.equal(warned.length, 1)
    // a second call has nothing new to ask for but the one that failed
    asked.length = 0
    await loadMoreSprites(had, ['ow_grass_0', 'ow_roof_blue_l'])
    assert.deepEqual(asked, [])
  } finally { globalThis.Image = realImage; console.warn = realWarn }
})
