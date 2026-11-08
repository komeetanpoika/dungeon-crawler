import test from 'node:test'
import assert from 'node:assert/strict'
import { composeCut } from '../tools/monster-cutter/compose.js'
import { encodeMask } from '../tools/monster-cutter/mask.js'
import { segment } from '../tools/monster-cutter/segment.js'
import { downsample, supercoverLine } from '../tools/monster-cutter/raster.js'

const W = 100, H = 100
const RED = [255, 0, 0], BLUE = [0, 0, 255], WHITE = [255, 255, 255], YELLOW = [255, 255, 0]
const INK = [16, 32, 48] // '#102030'

// The torso-and-arm figure of the segment tests, coloured: torso red
// x30..69 y20..79, arm blue x20..29 y25..64 (cut on the torso's first
// column), white backdrop, mask = both. `odd` lays the cut through the middle
// of output cells: torso x31..70 y21..79, arm x20..30 y21..60, and a 2 px bump
// at (20,20) that pins the figure box origin, so cell (5,0) holds one torso
// and one arm pixel, half covered in all (a per-piece cut drops it). `diag`
// cuts the plain figure on a slant, from (32,19) to (27,67), so the arm also
// takes a few red torso pixels. `shoulder` adds a torso bump x25..29 y20..21,
// left of the cut line and above the arm: torso pixels on the arm's side.
function makeCut({ odd = false, diag = false, shoulder = false, orb = false, claim = null, armZ = 1, outline = '#102030', outHeight = 30,
  armPivot = null, points = { chest: { piece: 'torso', x: 50, y: 40 } } } = {}) {
  const mask = new Uint8Array(W * H), rgba = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) rgba.set([...WHITE, 255], i * 4)
  const rect = (x, y, w, h, col) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { mask[j * W + i] = 1; rgba.set([...col, 255], (j * W + i) * 4) }
  }
  if (odd) { rect(31, 21, 40, 59, RED); rect(20, 21, 11, 40, BLUE); rect(20, 20, 2, 1, BLUE) }
  else { rect(30, 20, 40, 60, RED); rect(20, 25, 10, 40, BLUE) }
  if (shoulder) rect(25, 20, 5, 2, RED)
  if (orb) rect(40, 10, 5, 5, YELLOW)
  if (claim) { // the drawing shows the arm across the torso there
    for (let i = 0; i < W * H; i++) {
      const x = i % W, y = (i - x) / W
      if (mask[i] && (x - claim.x) ** 2 + (y - claim.y) ** 2 <= claim.r ** 2) rgba.set([...BLUE, 255], i * 4)
    }
  }
  const pieces = [
    { id: 'torso', role: 'torso', side: null, parent: null, seed: [50, 50], cut: null, pivot: [50, 50], z: 0, claims: [] },
    { id: 'arm', role: 'arm', side: 'left', parent: 'torso', seed: [22, 40],
      cut: odd ? [[31, 20], [31, 61]] : diag ? [[32, 19], [27, 67]] : [[30, 22], [30, 68]],
      pivot: armPivot ?? (odd ? [30, 40] : diag ? [29, 43] : [29, 40]), z: armZ, claims: claim ? [claim] : [] },
  ]
  if (orb) pieces.push({ id: 'orb', role: 'extra', side: null, parent: 'torso', seed: [42, 12], cut: null, pivot: [42, 14], z: -1, claims: [] })
  assert.deepEqual(segment(mask, W, H, pieces).leaks, [], 'fixture cut leaks')
  const cut = {
    version: 1, name: 't', source: 't.png', credit: null, w: W, h: H, mask: encodeMask(mask),
    view: 'front', faces: 'left', outHeight, outline, pieces, points,
  }
  return { src: { w: W, h: H, rgba }, cut, mask }
}

// The downsampled figure mask on the output grid, worked out independently:
// crop from the mask's box, pad to whole cells, box-filter, alpha >= 110.
function figureMask(mask, outHeight) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let i = 0; i < W * H; i++) if (mask[i]) {
    const x = i % W, y = (i - x) / W
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  const scale = Math.max(1, Math.ceil((y1 - y0 + 1) / outHeight))
  const fw = Math.ceil((x1 - x0 + 1) / scale), fh = Math.ceil((y1 - y0 + 1) / scale)
  const crop = { w: fw * scale, h: fh * scale, rgba: new Uint8Array(fw * scale * fh * scale * 4) }
  for (let y = 0; y < crop.h; y++) for (let x = 0; x < crop.w; x++) {
    const sx = x0 + x, sy = y0 + y
    if (sx < W && sy < H && mask[sy * W + sx]) crop.rgba.set([0, 0, 0, 255], (y * crop.w + x) * 4)
  }
  const small = downsample(crop, scale)
  const on = (X, Y) => X >= 0 && Y >= 0 && X < fw && Y < fh && small.rgba[(Y * fw + X) * 4 + 3] >= 110
  const ring = (X, Y) => !on(X, Y) && (on(X, Y - 1) || on(X + 1, Y) || on(X, Y + 1) || on(X - 1, Y))
  return { x0, y0, scale, w: fw, h: fh, on, ring }
}

// Paste each piece's atlas rect at `at`, in array order (with `caps`, each
// piece's children's caps just before it, as the engine draws), into a
// buffer with a 1 px margin: the outline sits just outside the figure box.
function rebuild({ atlas, parts }, { caps = false, only = null } = {}) {
  const bw = parts.figure.w + 2, bh = parts.figure.h + 2
  const rgba = new Uint8Array(bw * bh * 4)
  const blit = (ax, ay, w, h, fx, fy) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = ((ay + y) * atlas.w + ax + x) * 4
      if (!atlas.rgba[s + 3]) continue
      const X = fx + x + 1, Y = fy + y + 1
      assert.ok(X >= 0 && Y >= 0 && X < bw && Y < bh, `pixel off the figure at ${fx + x},${fy + y}`)
      rgba.set(atlas.rgba.subarray(s, s + 4), (Y * bw + X) * 4)
    }
  }
  for (const p of parts.pieces) {
    if (only && p.id !== only) continue
    if (caps) for (const c of parts.pieces) if (c.parent === p.id && c.cap) blit(...c.cap)
    blit(...p.rect, ...p.at)
  }
  // read in figure px
  return (X, Y) => {
    if (X < -1 || Y < -1 || X > parts.figure.w || Y > parts.figure.h) return [0, 0, 0, 0]
    const k = ((Y + 1) * bw + X + 1) * 4
    return [...rgba.subarray(k, k + 4)]
  }
}

const same = (c, col) => c[3] === 255 && c[0] === col[0] && c[1] === col[1] && c[2] === col[2]
const piece = (parts, id) => parts.pieces.find(p => p.id === id)

test('one atlas rect per piece and a cap only on children', () => {
  const { src, cut } = makeCut({ orb: true })
  const { atlas, parts } = composeCut(src, cut)
  assert.deepEqual(Object.keys(parts), ['version', 'view', 'faces', 'figure', 'pieces', 'points'])
  assert.equal(parts.version, 1)
  assert.equal(parts.view, 'front')
  assert.equal(parts.faces, 'left')
  // drawn in z order: the orb behind, then the torso, then the arm
  assert.deepEqual(parts.pieces.map(p => p.id), ['orb', 'torso', 'arm'])
  for (const p of parts.pieces) {
    assert.deepEqual(Object.keys(p), ['id', 'role', 'side', 'parent', 'z', 'pivot', 'rect', 'at', 'cap'])
  }
  assert.equal(piece(parts, 'torso').cap, null)
  assert.equal(piece(parts, 'orb').cap, null, 'a detached piece has no cut, so no cap')
  const cap = piece(parts, 'arm').cap
  assert.equal(cap.length, 6)
  // every rect and cap lies in the atlas, 1 px clear of every other
  const rects = parts.pieces.flatMap(p => [p.rect, ...(p.cap ? [p.cap.slice(0, 4)] : [])])
  assert.equal(rects.length, 4)
  for (const [x, y, w, h] of rects) {
    assert.ok(w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= atlas.w && y + h <= atlas.h, `rect ${[x, y, w, h]} in ${atlas.w}x${atlas.h}`)
  }
  for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
    const [ax, ay, aw, ah] = rects[a], [bx, by, bw, bh] = rects[b]
    assert.ok(ax + aw + 1 <= bx || bx + bw + 1 <= ax || ay + ah + 1 <= by || by + bh + 1 <= ay, `rects ${a} and ${b} touch`)
  }
  assert.equal(atlas.rgba.length, atlas.w * atlas.h * 4)
  assert.throws(() => composeCut(src, { ...cut, outHeight: 0 }), /outHeight/)
  assert.throws(() => composeCut({ ...src, w: 99 }, cut), /source is 99x100/)
})

test('pasting every piece at "at" rebuilds the figure exactly', () => {
  for (const [name, opts] of [['aligned', {}], ['cut mid-cell', { odd: true }], ['slanted cut', { diag: true }],
    ['claim', { claim: { x: 50, y: 50, r: 8 } }], ['orb behind', { orb: true }], ['shoulder', { shoulder: true }],
    ['cut mid-cell, scale 3', { odd: true, outHeight: 20 }], ['slanted cut, scale 3', { diag: true, outHeight: 20 }]]) {
    const { src, cut, mask } = makeCut(opts)
    const out = composeCut(src, cut)
    const fm = figureMask(mask, cut.outHeight)
    assert.deepEqual(out.parts.figure, { w: fm.w, h: fm.h }, name)
    const got = rebuild(out)
    for (let Y = -1; Y <= fm.h; Y++) for (let X = -1; X <= fm.w; X++) {
      const c = got(X, Y)
      if (fm.on(X, Y)) assert.ok(c[3] === 255 && !same(c, INK), `${name}: figure pixel ${X},${Y} missing or inked`)
      else if (fm.ring(X, Y)) assert.ok(same(c, INK), `${name}: outline pixel ${X},${Y} is ${c}`)
      else assert.equal(c[3], 0, `${name}: stray pixel ${X},${Y}`)
    }
  }
  // the half-covered cell where the cut meets the top edge survives
  const { src, cut } = makeCut({ odd: true })
  assert.equal(rebuild(composeCut(src, cut))(5, 0)[3], 255)
  // at rest every cell shows its owner's colour
  const plain = makeCut()
  const got = rebuild(composeCut(plain.src, plain.cut))
  for (let Y = 0; Y < 30; Y++) for (let X = 0; X < 25; X++) {
    const c = got(X, Y)
    if (X >= 5) assert.ok(same(c, RED), `torso cell ${X},${Y} is ${c}`)
    else if (Y >= 2 && Y <= 22) assert.ok(same(c, BLUE), `arm cell ${X},${Y} is ${c}`)
  }
})

test('the outline follows the silhouette and never the cut', () => {
  for (const opts of [{}, { odd: true }, { diag: true }, { diag: true, outHeight: 20 }]) {
    const { src, cut, mask } = makeCut(opts)
    const out = composeCut(src, cut)
    const fm = figureMask(mask, cut.outHeight)
    const got = rebuild(out)
    const onCut = supercoverLine(...cut.pieces[1].cut).filter(([x, y]) => mask[y * W + x])
    assert.ok(onCut.length > 30)
    for (const [x, y] of onCut) {
      const X = Math.floor((x - fm.x0) / fm.scale), Y = Math.floor((y - fm.y0) / fm.scale)
      assert.ok(got(X, Y)[3] === 255 && !same(got(X, Y), INK), `cut pixel ${x},${y} -> ${X},${Y}`)
    }
    for (let Y = -1; Y <= fm.h; Y++) for (let X = -1; X <= fm.w; X++) {
      if (fm.ring(X, Y)) assert.ok(same(got(X, Y), INK), `ring ${X},${Y}`)
    }
    // no piece carries ink inside the silhouette, whatever the draw order
    for (const p of out.parts.pieces) {
      const mine = rebuild(out, { only: p.id })
      for (let Y = -1; Y <= fm.h; Y++) for (let X = -1; X <= fm.w; X++) {
        if (same(mine(X, Y), INK)) assert.ok(!fm.on(X, Y), `${p.id} inks ${X},${Y} inside the figure`)
      }
    }
  }
})

test('a claimed area leaves no hole in the parent', () => {
  const claim = { x: 50, y: 50, r: 8 }
  const { src, cut } = makeCut({ claim })
  const out = composeCut(src, cut)
  const torso = rebuild(out, { only: 'torso' }), all = rebuild(out)
  // cells whose every source pixel lies in the disc: (50-20)/2 = 15 ± 4 art px
  let inside = 0
  for (let Y = 0; Y < 30; Y++) for (let X = 0; X < 25; X++) {
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => [20 + 2 * X + dx, 20 + 2 * Y + dy])
    if (!corners.every(([x, y]) => (x - claim.x) ** 2 + (y - claim.y) ** 2 <= claim.r ** 2)) continue
    inside++
    const c = torso(X, Y)
    assert.equal(c[3], 255, `hole in the torso at ${X},${Y}`)
    assert.ok(Math.abs(c[0] - 255) <= 40 && c[1] <= 40 && c[2] <= 40, `torso fill at ${X},${Y} is ${c}, not red`)
    assert.ok(same(all(X, Y), BLUE), `at rest the arm shows at ${X},${Y}`)
  }
  assert.ok(inside >= 16, `only ${inside} cells inside the claim`)
})

test('a claim by a piece drawn behind its base piece shows through at rest', () => {
  const claim = { x: 50, y: 50, r: 8 }
  const { src, cut } = makeCut({ claim, armZ: -1 })
  const out = composeCut(src, cut)
  assert.deepEqual(out.parts.pieces.map(p => p.id), ['arm', 'torso'])
  const all = rebuild(out, { caps: true })
  assert.ok(same(all(15, 15), BLUE), `claim centre at rest is ${all(15, 15)}`)
  assert.ok(same(all(10, 10), RED))
})

test('caps are filled from the child, and only where the parent covers', () => {
  for (const opts of [{}, { odd: true }, { armZ: -1 }, { diag: true }, { diag: true, armZ: -1, outHeight: 20 }, { odd: true, outHeight: 20 },
    { shoulder: true }, { claim: { x: 31, y: 40, r: 2.5 }, outHeight: 20, armZ: -1 }, { claim: { x: 31, y: 40, r: 2.5 }, outHeight: 20 }]) {
    const { src, cut } = makeCut(opts)
    const out = composeCut(src, cut)
    const [ax, ay, w, h, fx, fy] = piece(out.parts, 'arm').cap
    const rest = rebuild(out), torso = rebuild(out, { only: 'torso' })
    // An upright cut sits in the cell column of x = 30 (or 31) and leaves an
    // all-red torso and an all-blue arm. A slanted one gives the torso a few
    // blue cut-line pixels and the arm a few red ones, so there the check is
    // ownership itself and a mostly blue cap.
    const upright = !opts.diag, cutX = Math.floor(10 / (opts.outHeight === 20 ? 3 : 2))
    let n = 0, blue = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = ((ay + y) * out.atlas.w + ax + x) * 4
      const c = [...out.atlas.rgba.subarray(s, s + 4)]
      if (!c[3]) continue
      n++
      const X = fx + x, Y = fy + y, t = torso(X, Y)
      if (upright) assert.ok(X >= cutX, `cap pixel ${X},${Y} on the parent's side of the cut`)
      assert.ok(t[3] === 255 && !same(t, INK), `torso does not cover cap pixel ${X},${Y}`)
      assert.deepEqual(rest(X, Y), t, `cap pixel ${X},${Y} not over a torso-owned pixel at rest`)
      if (upright) assert.ok(same(t, RED), `torso at cap pixel ${X},${Y} is ${t}`)
      if (upright) assert.ok(c[2] > c[0] + 100 && c[2] > c[1] + 100, `cap pixel ${X},${Y} is ${c}, not bluish`)
      else blue += c[2] > c[0] ? 1 : 0
    }
    assert.ok(n >= 20, `cap has only ${n} pixels`)
    if (!upright) assert.ok(blue > n / 2, `slanted cap mostly blue (${blue}/${n})`)
    // drawn as the engine will (caps before their parent), the rest pose is unchanged
    const engine = rebuild(out, { caps: true })
    for (let Y = -1; Y <= out.parts.figure.h; Y++) for (let X = -1; X <= out.parts.figure.w; X++) {
      assert.deepEqual(engine(X, Y), rest(X, Y), `cap shows at rest at ${X},${Y}`)
    }
  }
})

test('pivots and points are converted to figure px', () => {
  const points = { chest: { piece: 'torso', x: 50, y: 40 }, hand: { piece: 'arm', x: 21, y: 63 } }
  const { src, cut } = makeCut({ armPivot: [29, 45], points })
  const { parts } = composeCut(src, cut)
  // scale 2 (60 px tall into 30), figure box origin (20,20)
  assert.deepEqual(parts.figure, { w: 25, h: 30 })
  assert.deepEqual(piece(parts, 'arm').pivot, [4.5, 12.5])
  assert.deepEqual(piece(parts, 'torso').pivot, [15, 15])
  assert.deepEqual(parts.points, { chest: { piece: 'torso', x: 15, y: 10 }, hand: { piece: 'arm', x: 0.5, y: 21.5 } })
  // `at` is in the same frame: the arm's art starts one outline px left of
  // the figure, one row above its first cell (y 24..25 -> row 2)
  assert.deepEqual(piece(parts, 'arm').at, [-1, 1])
  assert.deepEqual(piece(parts, 'torso').at, [4, -1])
  // at scale 3 a pivot snaps to the nearest half art px: (29-20)/3 = 3, (45-20)/3 = 8.33
  const three = makeCut({ armPivot: [29, 45], outHeight: 20 })
  assert.deepEqual(piece(composeCut(three.src, three.cut).parts, 'arm').pivot, [3, 8.5])
})

test('outline colour defaults to a dark version of the figure mean colour when cut.outline is null', () => {
  const { src, cut, mask } = makeCut({ outline: null })
  const out = composeCut(src, cut)
  // mean over the figure: 2400 red px and 400 blue px -> (218.6, 0, 36.4), times 0.45
  const dark = [98, 0, 16]
  const fm = figureMask(mask, cut.outHeight)
  const got = rebuild(out)
  let n = 0
  for (let Y = -1; Y <= fm.h; Y++) for (let X = -1; X <= fm.w; X++) {
    if (!fm.ring(X, Y)) continue
    n++
    assert.ok(same(got(X, Y), dark), `outline ${X},${Y} is ${got(X, Y)}`)
  }
  assert.ok(n > 100)
  assert.throws(() => composeCut(src, { ...cut, outline: 'dark red' }), /outline/)
  assert.ok(same(rebuild(composeCut(src, { ...cut, outline: '#123' }))(-1, 10), [0x11, 0x22, 0x33]))
})
