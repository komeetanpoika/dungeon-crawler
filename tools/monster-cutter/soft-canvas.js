// A tiny software 2D context for tests and tools: enough of the canvas API
// for the cut-out rig (save/restore, the affine calls, fillRect, the 9-arg
// drawImage with nearest-neighbour sampling by inverse mapping, globalAlpha,
// hex fillStyle) drawing into an { w, h, rgba } image. Pure: no DOM, no node:.

function hexColour(s) {
  const m = /^#([0-9a-f]{6})$/i.exec(s)
  if (!m) throw new Error(`soft canvas fillStyle must be #rrggbb, got ${s}`)
  const n = parseInt(m[1], 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}

export function makeSoftCanvas(w, h) {
  const img = { w, h, rgba: new Uint8Array(w * h * 4), width: w, height: h, naturalWidth: w, complete: true }
  let m = [1, 0, 0, 1, 0, 0]
  const stack = []
  const mul = (n) => { m = [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]] }

  // source-over one pixel; (r,g,b) straight, a in 0..1
  const put = (x, y, r, g, b, a) => {
    if (a <= 0) return
    const o = (y * w + x) * 4, d = img.rgba
    const da = d[o + 3] / 255, oa = a + da * (1 - a)
    for (const [k, c] of [[0, r], [1, g], [2, b]]) d[o + k] = Math.round((c * a + d[o + k] * da * (1 - a)) / oa)
    d[o + 3] = Math.round(oa * 255)
  }
  // every device pixel whose centre maps into the user-space rect, with the
  // rect's (u, v) in 0..1
  const forRect = (dx, dy, dw, dh, fn) => {
    const [a, b, c, d, e, f] = m
    const det = a * d - b * c
    if (!det || !dw || !dh) return
    const xs = [], ys = []
    for (const [px, py] of [[dx, dy], [dx + dw, dy], [dx, dy + dh], [dx + dw, dy + dh]]) { xs.push(a * px + c * py + e); ys.push(b * px + d * py + f) }
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)))
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)))
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const X = x + 0.5 - e, Y = y + 0.5 - f
      const ux = (d * X - c * Y) / det, uy = (-b * X + a * Y) / det
      const u = (ux - dx) / dw, v = (uy - dy) / dh
      if (u >= 0 && u < 1 && v >= 0 && v < 1) fn(x, y, u, v)
    }
  }

  const ctx = {
    globalAlpha: 1, fillStyle: '#000000', imageSmoothingEnabled: true,
    save() { stack.push({ m: m.slice(), globalAlpha: ctx.globalAlpha, fillStyle: ctx.fillStyle, imageSmoothingEnabled: ctx.imageSmoothingEnabled }) },
    restore() { const s = stack.pop(); if (s) { m = s.m; ctx.globalAlpha = s.globalAlpha; ctx.fillStyle = s.fillStyle; ctx.imageSmoothingEnabled = s.imageSmoothingEnabled } },
    translate(x, y) { mul([1, 0, 0, 1, x, y]) },
    scale(x, y) { mul([x, 0, 0, y, 0, 0]) },
    rotate(r) { const c = Math.cos(r), s = Math.sin(r); mul([c, s, -s, c, 0, 0]) },
    transform(a, b, c, d, e, f) { mul([a, b, c, d, e, f]) },
    setTransform(a, b, c, d, e, f) { m = [a, b, c, d, e, f] },
    fillRect(x, y, rw, rh) {
      const [r, g, b] = hexColour(ctx.fillStyle)
      forRect(x, y, rw, rh, (px, py) => put(px, py, r, g, b, ctx.globalAlpha))
    },
    drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh) {
      if (arguments.length !== 9) throw new Error('soft canvas drawImage takes the 9-argument form')
      forRect(dx, dy, dw, dh, (px, py, u, v) => {
        const X = Math.min(src.w - 1, Math.floor(sx + u * sw)), Y = Math.min(src.h - 1, Math.floor(sy + v * sh))
        const o = (Y * src.w + X) * 4
        put(px, py, src.rgba[o], src.rgba[o + 1], src.rgba[o + 2], src.rgba[o + 3] / 255 * ctx.globalAlpha)
      })
    },
  }
  return { ctx, img }
}
