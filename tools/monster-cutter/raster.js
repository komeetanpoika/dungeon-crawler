// Pure raster primitives for the monster cutter (no DOM, no node: imports, so
// the browser can import it too). An Image is { w, h, rgba }, a Mask is a
// Uint8Array(w*h) of 0/1.

// Box downsample an RGBA frame by an integer factor, averaging colour with
// alpha weights so transparent neighbours never darken an edge.
export function downsample({ w, h, rgba }, scale) {
  const W = Math.ceil(w / scale), H = Math.ceil(h / scale)
  const out = new Uint8Array(W * H * 4)
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const x = X * scale + dx, y = Y * scale + dy
      if (x >= w || y >= h) continue
      const i = (y * w + x) * 4, al = rgba[i + 3] / 255
      r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al; a += al; n++
    }
    const o = (Y * W + X) * 4
    if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a) }
    out[o + 3] = Math.round(255 * a / n)
  }
  return { w: W, h: H, rgba: out }
}

// 4-connected component labelling. label is -1 off the mask.
export function components(mask, w, h) {
  const label = new Int32Array(w * h).fill(-1)
  const sizes = []
  const stack = []
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s] !== -1) continue
    const id = sizes.length
    let n = 0
    label[s] = id; stack.push(s)
    while (stack.length) {
      const p = stack.pop(); n++
      const x = p % w, y = (p - x) / w
      if (x > 0 && mask[p - 1] && label[p - 1] === -1) { label[p - 1] = id; stack.push(p - 1) }
      if (x < w - 1 && mask[p + 1] && label[p + 1] === -1) { label[p + 1] = id; stack.push(p + 1) }
      if (y > 0 && mask[p - w] && label[p - w] === -1) { label[p - w] = id; stack.push(p - w) }
      if (y < h - 1 && mask[p + w] && label[p + w] === -1) { label[p + w] = id; stack.push(p + w) }
    }
    sizes.push(n)
  }
  return { label, sizes }
}

// Inclusive bounding box [x0, y0, x1, y1] per component.
export function boxes(label, sizes, w, h) {
  const out = sizes.map(() => [w, h, -1, -1])
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = label[y * w + x]
    if (l < 0) continue
    const b = out[l]
    if (x < b[0]) b[0] = x
    if (y < b[1]) b[1] = y
    if (x > b[2]) b[2] = x
    if (y > b[3]) b[3] = y
  }
  return out
}

// Exact Euclidean distance to the nearest off-mask pixel (Felzenszwalb-
// Huttenlocher); the area outside the image counts as off-mask.
export function distanceTransform(mask, w, h) {
  const W = w + 2, H = h + 2, INF = 1e20
  const f = new Float64Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inside = x > 0 && y > 0 && x <= w && y <= h && mask[(y - 1) * w + (x - 1)]
    f[y * W + x] = inside ? INF : 0
  }
  const n = Math.max(W, H)
  const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1)
  const pass = (len, get, set) => {
    for (let q = 0; q < len; q++) d[q] = get(q)
    let k = 0
    v[0] = 0; z[0] = -INF; z[1] = INF
    for (let q = 1; q < len; q++) {
      let s
      for (;;) {
        s = ((d[q] + q * q) - (d[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
        if (s <= z[k] && k > 0) k--; else break
      }
      if (s <= z[k]) { v[0] = q; z[0] = -INF; z[1] = INF } // k === 0
      else { k++; v[k] = q; z[k] = s; z[k + 1] = INF }
    }
    k = 0
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++
      set(q, (q - v[k]) * (q - v[k]) + d[v[k]])
    }
  }
  for (let x = 0; x < W; x++) pass(H, y => f[y * W + x], (y, val) => { f[y * W + x] = val })
  for (let y = 0; y < H; y++) pass(W, x => f[y * W + x], (x, val) => { f[y * W + x] = val })
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(f[(y + 1) * W + x + 1])
  return out
}

// A 4-connected line (Bresenham plus the missing corner on each diagonal
// step), so a 4-flood cannot slip through it.
export function supercoverLine([x0, y0], [x1, y1]) {
  const pts = [[x0, y0]]
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx - dy, x = x0, y = y0
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err
    const stepX = e2 > -dy, stepY = e2 < dx
    if (stepX) { err -= dy; x += sx }
    if (stepY && stepX) pts.push([x, y])
    if (stepY) { err += dx; y += sy }
    pts.push([x, y])
  }
  return pts
}
