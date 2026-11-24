import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeTileLayer, CHUNK, HUE_BUDGET } from '../renderer/render/tile-layer.js'
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

// ── The mushroom trip ──────────────────────────────────────────────────────
// A trip recolours the world itself. The baked chunks stay in their own
// colours — they outlive the trip — and a hue-rotated copy of each is blitted
// instead, rebuilt one chunk a frame so the software canvas never stalls. Each
// chunk carries its own offset, so the world shifts in patches rather than as
// one flat sheet.

const hueBuilds = layer => [...layer.chunks.values()].filter(c => c.hued).length

describe('tile layer under a trip', () => {
  const setup = () => {
    const layer = makeTileLayer(fakeCanvas)
    const map = floorMap()
    explore(map, 0, 0, 40, 20)
    return { layer, map }
  }

  it('blits the plain chunks when nobody is tripping', () => {
    const { layer, map } = setup()
    const ctx = recordingCtx()
    layer.draw(ctx, map, SPR, S, 0, 0, 640, 480, 0.65, 0)
    assert.equal(hueBuilds(layer), 0)
    for (const b of blits(ctx)) assert.ok([...layer.chunks.values()].some(c => c.canvas === b.img))
  })

  it('builds a recoloured copy and blits that instead', () => {
    const { layer, map } = setup()
    const ctx = recordingCtx()
    // A view wide enough to hold more chunks than one frame's budget.
    layer.draw(ctx, map, SPR, S, 0, 0, 1600, 1100, 0.65, 90)
    assert.equal(hueBuilds(layer), HUE_BUDGET, 'only a couple of chunks recoloured per frame')
    const hued = [...layer.chunks.values()].find(c => c.hued)
    assert.ok(blits(ctx).some(b => b.img === hued.hued), 'the recoloured copy is what reaches the screen')
    assert.ok(hued.hued.ctx.calls.some(c => c.name === 'drawImage' && c.img === hued.canvas),
      'recoloured from the bake, not from the tiles again')
  })

  it('recolours the rest over the following frames', () => {
    const { layer, map } = setup()
    for (let i = 0; i < 4; i++) layer.draw(recordingCtx(), map, SPR, S, 0, 0, 640, 480, 0.65, 90)
    assert.equal(hueBuilds(layer), 2, 'both visible chunks recoloured, one per frame')
  })

  it('holds a copy steady until the hue has moved a step', () => {
    const { layer, map } = setup()
    for (let i = 0; i < 6; i++) layer.draw(recordingCtx(), map, SPR, S, 0, 0, 640, 480, 0.65, 90)
    const before = [...layer.chunks.values()].map(c => c.hued?.ctx.calls.length)
    layer.draw(recordingCtx(), map, SPR, S, 0, 0, 640, 480, 0.65, 92)
    assert.deepEqual([...layer.chunks.values()].map(c => c.hued?.ctx.calls.length), before, 'no rebuild for 2°')
  })

  it('turns the whole world as one, so no seam shows between chunks', () => {
    const { layer, map } = setup()
    for (let i = 0; i < 4; i++) layer.draw(recordingCtx(), map, SPR, S, 0, 0, 640, 480, 0.65, 90)
    const steps = [...layer.chunks.values()].filter(c => c.hued).map(c => c.hueStep)
    assert.ok(steps.length > 1, 'more than one chunk in view')
    assert.equal(new Set(steps).size, 1, 'all at the same colour')
  })

  it('drops the recoloured copies when the trip ends', () => {
    const { layer, map } = setup()
    for (let i = 0; i < 4; i++) layer.draw(recordingCtx(), map, SPR, S, 0, 0, 640, 480, 0.65, 90)
    assert.ok(hueBuilds(layer) > 0)
    layer.draw(recordingCtx(), map, SPR, S, 0, 0, 640, 480, 0.65, 0)
    assert.equal(hueBuilds(layer), 0, 'the memory goes back with the colours')
  })

  it('re-bakes and re-colours a chunk whose tiles changed mid-trip', () => {
    const { layer, map } = setup()
    for (let i = 0; i < 4; i++) layer.draw(recordingCtx(), map, SPR, S, 0, 0, 640, 480, 0.65, 90)
    const chunk = layer.chunks.get('0,0')
    const before = chunk.hued.ctx.calls.length
    markTileDirty(map, 2, 2)
    layer.draw(recordingCtx(), map, SPR, S, 0, 0, 640, 480, 0.65, 90)
    assert.ok(chunk.hued.ctx.calls.length > before, 'the felled tree shows in its new colour too')
  })
})

// ---- cells that are walked under (wilds/over.js) ---------------------------------
import { makeDirectTileLayer, MAX_CHUNKS } from '../renderer/render/tile-layer.js'
import { drawTile } from '../renderer/render/tiles.js'

const TOP = { ...SPR, grass: 'GRASS', roof: 'ROOF', masonry: 'MASONRY' }
// a floor map whose cell (x, y) is a roof's top row: grass under, roof over
function roofAt(map, x, y, extra = {}) {
  Object.assign(map[y][x], { tile: TILE.FLOOR, skin: 'grass', overlay: 'roof', over: true, ...extra })
  return map[y][x]
}
const imgs = ctx => blits(ctx).map(c => c.img)

describe('drawTile by part', () => {
  const cell = { tile: TILE.FLOOR, skin: 'grass', deco: 'masonry', overlay: 'roof', over: true }
  const draw = (c, part) => { const ctx = recordingCtx(); drawTile(ctx, c.tile, 0, 0, S, TOP, c, part); return imgs(ctx) }
  it('a cell walked under: its ground under, its art over, all of it by default', () => {
    assert.deepEqual(draw(cell, 'under'), ['GRASS'])
    assert.deepEqual(draw(cell, 'over'), ['MASONRY', 'ROOF'])
    assert.deepEqual(draw(cell), ['GRASS', 'MASONRY', 'ROOF'])
  })
  it('any other cell: whole under, nothing over', () => {
    const plain = { tile: TILE.WALL, skin: 'grass', overlay: 'roof' }
    assert.deepEqual(draw(plain, 'under'), ['GRASS', 'ROOF'])
    assert.deepEqual(draw(plain, 'over'), [])
    assert.deepEqual(draw({ tile: TILE.FLOOR }, 'over'), [])
  })
})

describe('tile layer tops', () => {
  const setup = () => {
    const layer = makeTileLayer(fakeCanvas)
    const map = floorMap()
    explore(map, 0, 0, 5, 3)
    return { layer, map }
  }
  const frame = (layer, map, hue = 0) => {
    const ctx = recordingCtx(), over = recordingCtx()
    layer.draw(ctx, map, TOP, S, 0, 0, 640, 480, 0.65, hue)
    layer.drawOver(over, map, TOP, S, 0, 0, 640, 480, 0.65, hue)
    return { ctx, over }
  }

  it('bakes the art of a walked-under cell into a second image, drawn by drawOver', () => {
    const { layer, map } = setup()
    roofAt(map, 2, 1)
    const { ctx, over } = frame(layer, map)
    const chunk = layer.chunks.get('0,0')
    assert.ok(!imgs(chunk.ctx).includes('ROOF'), 'the roof is not in the ground')
    assert.equal(imgs(chunk.ctx).filter(i => i === 'GRASS').length, 1)
    assert.deepEqual(imgs(chunk.top.ctx), ['ROOF'])
    assert.deepEqual(blits(chunk.top.ctx)[0].a.slice(0, 2), [2 * S, 1 * S])
    assert.equal(blits(ctx).length, 2, 'draw blits the ground only')
    assert.deepEqual(imgs(over), [chunk.top.canvas])
    assert.deepEqual(blits(over)[0].a, [2 * S, S, S, S, 2 * S, S, S, S], 'only the strip that holds the roof')
  })

  it('blits a top as one strip per run of cells along a row, at the camera\'s offset', () => {
    const { layer, map } = setup()
    for (const [x, y] of [[1, 1], [2, 1], [3, 1], [1, 2], [4, 2]]) roofAt(map, x, y)
    layer.draw(recordingCtx(), map, TOP, S, 5, 7, 640, 480, 0.65)
    const over = recordingCtx()
    layer.drawOver(over, map, TOP, S, 5, 7, 640, 480, 0.65)
    assert.deepEqual(blits(over).map(b => b.a), [
      [S, S, 3 * S, S, S - 5, S - 7, 3 * S, S],
      [S, 2 * S, S, S, S - 5, 2 * S - 7, S, S],
      [4 * S, 2 * S, S, S, 4 * S - 5, 2 * S - 7, S, S],
    ])
  })

  it('keeps no second image for a chunk without one, and drawOver draws nothing', () => {
    const { layer, map } = setup()
    const { over } = frame(layer, map)
    assert.equal(layer.chunks.get('0,0').top, null)
    assert.equal(over.calls.length, 0)
  })

  it('leaves an unexplored one out of both', () => {
    const { layer, map } = setup()
    roofAt(map, 8, 8)
    frame(layer, map)
    assert.equal(layer.chunks.get('0,0').top, null)
  })

  it('fogs a walked-under cell once, after its top', () => {
    const { layer, map } = setup()
    roofAt(map, 2, 1, { visible: false })
    roofAt(map, 3, 1, { visible: false })
    map[1][0].visible = false
    const { ctx, over } = frame(layer, map)
    assert.deepEqual(fogs(ctx).map(c => c.a), [[0, S, S, S]], 'the ground pass fogs only the plain cell')
    assert.deepEqual(fogs(over).map(c => c.a), [[2 * S, S, 2 * S, S]])
    assert.ok(over.calls.findIndex(c => c.name === 'fillRect') > over.calls.findIndex(c => c.name === 'drawImage'), 'fog after the top')
    map[1][2].visible = map[1][3].visible = true
    assert.equal(fogs(frame(layer, map).over).length, 0)
  })

  it('rebakes the top when its cell is marked dirty, and drops it when the last one goes', () => {
    const { layer, map } = setup()
    const cell = roofAt(map, 2, 1)
    frame(layer, map)
    const top = layer.chunks.get('0,0').top
    cell.overlay = 'masonry'
    markTileDirty(map, 2, 1)
    frame(layer, map)
    assert.ok(layer.chunks.get('0,0').top === top, 'the same canvas')
    assert.equal(imgs(top.ctx).at(-1), 'MASONRY')
    delete cell.over
    markTileDirty(map, 2, 1)
    frame(layer, map)
    assert.equal(layer.chunks.get('0,0').top, null)
  })

  it('moves with its chunk when the window re-centres', () => {
    const layer = makeTileLayer(fakeCanvas)
    const map = floorMap()
    explore(map, 0, 0, 40, 20)
    roofAt(map, 2, 1)
    frame(layer, map)
    const top = layer.chunks.get('0,0').top
    layer.rekey(map, map, 1, 0)
    assert.ok(layer.chunks.get('1,0').top === top)
  })

  it('counts a top as a canvas of the cache', () => {
    const layer = makeTileLayer(fakeCanvas)
    const map = createMap(CHUNK * 12, CHUNK * 12)
    for (const row of map) for (const t of row) { t.tile = TILE.FLOOR; t.explored = true; t.visible = true }
    for (let cy = 0; cy < 12; cy++) for (let cx = 0; cx < 12; cx++) roofAt(map, cx * CHUNK + 1, cy * CHUNK + 1)
    const CS = CHUNK * S
    for (let cy = 0; cy < 12; cy++) for (let cx = 0; cx < 11; cx++) {
      layer.draw(recordingCtx(), map, TOP, S, cx * CS, cy * CS, 640, 480, 0.65)
      assert.ok(layer.canvases() <= MAX_CHUNKS, `canvases held: ${layer.canvases()}`)
    }
    assert.ok(layer.chunks.size <= MAX_CHUNKS / 2)
  })

  it('turns colour in a trip in the same frame as its chunk\'s ground', () => {
    const layer = makeTileLayer(fakeCanvas)
    const map = floorMap()
    explore(map, 0, 0, 40, 20)
    roofAt(map, 2, 1)
    const chunk = layer.chunks.get.bind(layer.chunks)
    for (let i = 0; i < 5; i++) {
      frame(layer, map, 90)
      assert.equal(!!chunk('0,0').top.hued, !!chunk('0,0').hued, `frame ${i}: the roof is never two colours`)
      assert.ok([...layer.chunks.values()].filter(c => c.hued).length <= HUE_BUDGET * (i + 1), 'the ground keeps to its budget')
    }
    const c = chunk('0,0')
    assert.ok(c.top.hued && c.top.hueStep === c.hueStep)
    assert.deepEqual(imgs(frame(layer, map, 90).over), [c.top.hued])
    // the hue moves a step: the top keeps its old colour until the ground has the new one
    frame(layer, map, 120)
    assert.equal(c.top.hueStep, c.hueStep)
    frame(layer, map, 0)
    assert.equal(c.top.hued, null)
  })
})

describe('the direct tile layer', () => {
  it('draws a walked-under cell in the same two parts', () => {
    const layer = makeDirectTileLayer()
    const map = floorMap()
    explore(map, 0, 0, 5, 3)
    roofAt(map, 2, 1, { visible: false })
    const ctx = recordingCtx(), over = recordingCtx()
    layer.draw(ctx, map, TOP, S, 0, 0, 640, 480, 0.65)
    layer.drawOver(over, map, TOP, S, 0, 0, 640, 480, 0.65)
    assert.ok(!imgs(ctx).includes('ROOF') && imgs(ctx).includes('GRASS'))
    assert.equal(fogs(ctx).length, 0)
    assert.deepEqual(imgs(over), ['ROOF'])
    assert.deepEqual(fogs(over).map(c => c.a), [[2 * S, S, S, S]])
  })
})
