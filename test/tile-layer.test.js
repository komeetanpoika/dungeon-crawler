import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeTileLayer, CHUNK } from '../renderer/render/tile-layer.js'
import { markTileDirty } from '../renderer/systems/tile-dirty.js'
import { TILE } from '../renderer/systems/entities.js'
import { createMap } from '../renderer/systems/map.js'

// A canvas stub whose ctx records drawImage / fillRect calls. Chunk canvases
// and the screen ctx share the shape so tests can tell bakes from blits.
function recordingCtx() {
  const calls = []
  let fillStyle = ''
  const base = {
    calls,
    drawImage: (img, ...a) => calls.push({ name: 'drawImage', img, a }),
    fillRect: (...a) => calls.push({ name: 'fillRect', a, fillStyle }),
    clearRect: (...a) => calls.push({ name: 'clearRect', a }),
    get fillStyle() { return fillStyle }, set fillStyle(v) { fillStyle = v },
    imageSmoothingEnabled: false,
  }
  return new Proxy(base, {
    get(t, p, r) { if (p in t) return Reflect.get(t, p, r); return () => {} },
  })
}
let nextId = 0
function fakeCanvas() {
  const ctx = recordingCtx()
  return { id: nextId++, width: 0, height: 0, ctx, getContext: () => ctx }
}

const S = 32
const SPR = { floor: 'FLOOR', wall: 'WALL', stair: 'STAIR' }

// 40x20 floor map: three chunks wide, two tall.
function floorMap() {
  const map = createMap(40, 20)
  for (const row of map) for (const t of row) { t.tile = TILE.FLOOR; t.explored = false; t.visible = false }
  return map
}
function explore(map, x0, y0, x1, y1, visible = true) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { map[y][x].explored = true; map[y][x].visible = visible }
}
const blits = ctx => ctx.calls.filter(c => c.name === 'drawImage')
const fogs = ctx => ctx.calls.filter(c => c.name === 'fillRect')

describe('tile layer chunks', () => {
  it('bakes only explored tiles (plus stairs) and blits one image per visible chunk', () => {
    const layer = makeTileLayer(fakeCanvas)
    const map = floorMap()
    explore(map, 0, 0, 5, 3)
    map[10][20].tile = TILE.STAIR   // unexplored stair in chunk (1,0)
    const ctx = recordingCtx()
    layer.draw(ctx, map, SPR, S, 0, 0, 640, 480, 0.65)
    // view 640x480 covers chunks x 0..1, y 0..0 (chunk = 512px)
    const b = blits(ctx)
    assert.equal(b.length, 2)
    assert.deepEqual(b.map(c => c.a.slice(0, 2)), [[0, 0], [CHUNK * S, 0]])
    const chunk00 = b[0].img, chunk10 = b[1].img
    assert.equal(blits(chunk00.ctx).length, 15)                // 5x3 explored floors
    assert.deepEqual(blits(chunk10.ctx).map(c => c.img), ['STAIR'])
    assert.deepEqual(blits(chunk10.ctx)[0].a.slice(0, 2), [4 * S, 10 * S])   // stair at map (20,10) is chunk-local (4,10)
  })

  it('does not rebake an unchanged chunk on the next frame', () => {
    const layer = makeTileLayer(fakeCanvas)
    const map = floorMap()
    explore(map, 0, 0, 5, 3)
    const ctx = recordingCtx()
    layer.draw(ctx, map, SPR, S, 0, 0, 640, 480, 0.65)
    const chunk = blits(ctx)[0].img
    const before = chunk.ctx.calls.length
    layer.draw(ctx, map, SPR, S, 3, 7, 640, 480, 0.65)
    assert.equal(chunk.ctx.calls.length, before)
    assert.deepEqual(blits(ctx)[2].a.slice(0, 2), [-3, -7])   // same canvas, camera-shifted
    assert.equal(blits(ctx)[2].img, chunk)
  })

  it('rebakes a chunk when one of its tiles becomes explored', () => {
    const layer = makeTileLayer(fakeCanvas)
    const map = floorMap()
    explore(map, 0, 0, 5, 3)
    const ctx = recordingCtx()
    layer.draw(ctx, map, SPR, S, 0, 0, 640, 480, 0.65)
    const chunk = blits(ctx)[0].img
    map[5][5].explored = true
    layer.draw(ctx, map, SPR, S, 0, 0, 640, 480, 0.65)
    assert.equal(blits(chunk.ctx).length, 15 + 16)   // first bake + rebake with one more tile
  })

  it('rebakes a chunk whose tile was marked dirty by a system', () => {
    const layer = makeTileLayer(fakeCanvas)
    const map = floorMap()
    explore(map, 0, 0, 40, 20)
    const ctx = recordingCtx()
    layer.draw(ctx, map, SPR, S, 0, 0, 640, 480, 0.65)
    const [c00, c10] = blits(ctx).map(c => c.img)
    map[2][2].tile = TILE.WALL
    markTileDirty(map, 2, 2)
    layer.draw(ctx, map, SPR, S, 0, 0, 640, 480, 0.65)
    assert.equal(blits(c00.ctx).length, 2 * CHUNK * CHUNK)     // rebaked
    assert.equal(blits(c00.ctx).filter(c => c.img === 'WALL').length, 1)
    assert.equal(blits(c10.ctx).length, CHUNK * CHUNK)         // untouched
  })

  it('drops every chunk when the map changes identity', () => {
    const layer = makeTileLayer(fakeCanvas)
    const a = floorMap(), b = floorMap()
    explore(a, 0, 0, 40, 20); explore(b, 0, 0, 40, 20)
    const ctx = recordingCtx()
    layer.draw(ctx, a, SPR, S, 0, 0, 640, 480, 0.65)
    const chunkA = blits(ctx)[0].img
    layer.draw(ctx, b, SPR, S, 0, 0, 640, 480, 0.65)
    assert.notEqual(blits(ctx)[2].img, chunkA)
    layer.draw(ctx, a, SPR, S, 0, 0, 640, 480, 0.65)
    assert.notEqual(blits(ctx)[4].img, chunkA)   // not held onto across maps
  })
})

describe('tile layer fog', () => {
  it('fogs explored-but-unseen tiles as one rect per horizontal run', () => {
    const layer = makeTileLayer(fakeCanvas)
    const map = floorMap()
    explore(map, 0, 0, 10, 1, false)     // row 0: cols 0..9 explored, none visible
    map[0][4].visible = true             // breaks the run into 0..3 and 5..9
    map[0][7].tile = TILE.STAIR          // stairs are never fogged: 5..6 and 8..9
    const ctx = recordingCtx()
    layer.draw(ctx, map, SPR, S, 0, 0, 640, 480, 0.65)
    const f = fogs(ctx)
    assert.deepEqual(f.map(c => c.a), [[0, 0, 4 * S, S], [5 * S, 0, 2 * S, S], [8 * S, 0, 2 * S, S]])
    assert.ok(f.every(c => c.fillStyle === 'rgba(0,0,0,0.65)'))
  })

  it('draws no fog over unexplored or visible tiles', () => {
    const layer = makeTileLayer(fakeCanvas)
    const map = floorMap()
    explore(map, 0, 0, 10, 2, true)
    const ctx = recordingCtx()
    layer.draw(ctx, map, SPR, S, 0, 0, 640, 480, 0.65)
    assert.equal(fogs(ctx).length, 0)
  })

  it('offsets fog rects by the camera like the tiles', () => {
    const layer = makeTileLayer(fakeCanvas)
    const map = floorMap()
    explore(map, 3, 2, 6, 3, false)
    const ctx = recordingCtx()
    layer.draw(ctx, map, SPR, S, 10.4, 20.6, 640, 480, 0.65)
    assert.deepEqual(fogs(ctx)[0].a, [Math.round(3 * S - 10.4), Math.round(2 * S - 20.6), 3 * S, S])
  })
})
