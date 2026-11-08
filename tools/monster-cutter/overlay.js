// Drawing for the cutter page: the tinted image layer (built once per edit at
// image resolution) and the editor view drawn over it in screen px each frame
// (checkerboard, layer, cut lines, handles, labels, points, brush cursor).
// Image pixel (x, y) is centred on screen at o + (x + 0.5) * scale.

export const PALETTE = ['#5b8def', '#e8b04b', '#4caf7d', '#c77dff', '#3fc1c9', '#f28c38', '#e86fa8', '#a3c94b', '#9aa7bd', '#d4a373']
export const LEAK = '#ff4d4d'
const TINT = 0.42          // how strongly a piece's colour covers the drawing
const GHOST = 0.3          // alpha of removed (background) pixels when shown
export const HANDLE_HIT = 9 // css px within which a handle is grabbed

export const hexRgb = hex => [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16))

// -> Uint8ClampedArray (w*h*4) for putImageData. colours: [r, g, b] per piece index.
export function buildLayer({ w, h, rgba }, mask, owner, colours, { tint = true, showRemoved = true } = {}) {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let i = 0, k = 0; i < w * h; i++, k += 4) {
    const r = rgba[k], g = rgba[k + 1], b = rgba[k + 2]
    if (mask[i]) {
      const c = tint && owner[i] >= 0 ? colours[owner[i]] : null
      out[k] = c ? r + (c[0] - r) * TINT : r
      out[k + 1] = c ? g + (c[1] - g) * TINT : g
      out[k + 2] = c ? b + (c[2] - b) * TINT : b
      out[k + 3] = 255
    } else if (showRemoved) {
      const l = (r * 0.3 + g * 0.59 + b * 0.11) * 0.55 // a dim grey ghost, slightly warm
      out[k] = l + 12; out[k + 1] = l; out[k + 2] = l - 4
      out[k + 3] = rgba[k + 3] * GHOST
    }
  }
  return out
}

// Every draggable handle, the selected piece's first, then points, then the rest.
export function handlesOf(cut, selected) {
  const of = p => {
    const hs = []
    if (p.cut) p.cut.forEach(([x, y], end) => hs.push({ kind: 'end', id: p.id, end, x, y }))
    hs.push({ kind: 'pivot', id: p.id, x: p.pivot[0], y: p.pivot[1] })
    hs.push({ kind: 'seed', id: p.id, x: p.seed[0], y: p.seed[1] })
    return hs
  }
  const sel = cut.pieces.find(p => p.id === selected)
  const points = Object.entries(cut.points ?? {}).map(([name, pt]) => ({ kind: 'point', name, id: pt.piece, x: pt.x, y: pt.y }))
  return [...(sel ? of(sel) : []), ...points, ...cut.pieces.filter(p => p !== sel).flatMap(of)]
}

let checker = null
function checkerPattern(ctx) {
  if (checker) return checker
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const g = c.getContext('2d')
  g.fillStyle = '#2c2f37'; g.fillRect(0, 0, 16, 16)
  g.fillStyle = '#363a44'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8)
  return (checker = ctx.createPattern(c, 'repeat'))
}

function pill(ctx, text, x, y, colour, { bold = false } = {}) {
  ctx.font = `${bold ? '600 ' : ''}11px system-ui, sans-serif`
  const tw = ctx.measureText(text).width
  ctx.fillStyle = 'rgba(16,17,21,0.82)'
  ctx.beginPath(); ctx.roundRect(x - 4, y - 8, tw + 8, 16, 4); ctx.fill()
  ctx.strokeStyle = colour; ctx.lineWidth = 1; ctx.stroke()
  ctx.fillStyle = '#eef0f3'; ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
}

function circle(ctx, x, y, r, fill, stroke, lw = 1.5) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
  if (fill) { ctx.fillStyle = fill; ctx.fill() }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke() }
}

// s: { cssW, cssH, view, layer, cut, leaks: Set, selected, hot (handle), colourOf(id),
//      tool, cursor ([x, y] image px | null), brush, split ({ a, b, stage } | null),
//      discs ([{ x, y, r, keep }] being painted) }
export function drawEditor(ctx, s) {
  const { view: { scale, ox, oy }, cut } = s
  const X = x => ox + (x + 0.5) * scale, Y = y => oy + (y + 0.5) * scale
  ctx.clearRect(0, 0, s.cssW, s.cssH)
  if (!cut) return
  const iw = cut.w * scale, ih = cut.h * scale

  ctx.fillStyle = checkerPattern(ctx); ctx.fillRect(ox, oy, iw, ih)
  ctx.imageSmoothingEnabled = scale < 1
  if (s.layer) ctx.drawImage(s.layer, ox, oy, iw, ih)
  ctx.strokeStyle = '#4a4f5c'; ctx.lineWidth = 1; ctx.strokeRect(ox - 0.5, oy - 0.5, iw + 1, ih + 1)

  for (const d of s.discs ?? []) circle(ctx, X(d.x), Y(d.y), d.r * scale, d.keep ? 'rgba(90,220,120,0.35)' : 'rgba(255,80,80,0.35)')

  // selected piece's claims, as dashed rings
  const sel = cut.pieces.find(p => p.id === s.selected)
  if (sel?.claims?.length) {
    ctx.setLineDash([3, 3])
    for (const c of sel.claims) circle(ctx, X(c.x), Y(c.y), Math.max(2, c.r * scale), null, s.colourOf(sel.id), 1)
    ctx.setLineDash([])
  }

  const isHot = (kind, id, extra) => s.hot && s.hot.kind === kind && s.hot.id === id && (extra === undefined || s.hot.end === extra || s.hot.name === extra)
  const order = [...cut.pieces.filter(p => p !== sel), ...(sel ? [sel] : [])]
  for (const p of order) {
    const on = p === sel, leak = s.leaks.has(p.id), col = leak ? LEAK : s.colourOf(p.id)
    if (p.cut) {
      const [[ax, ay], [bx, by]] = p.cut
      ctx.lineCap = 'round'
      ctx.strokeStyle = 'rgba(10,10,14,0.85)'; ctx.lineWidth = on || leak ? 6 : 4
      ctx.beginPath(); ctx.moveTo(X(ax), Y(ay)); ctx.lineTo(X(bx), Y(by)); ctx.stroke()
      if (leak) ctx.setLineDash([7, 5])
      ctx.strokeStyle = col; ctx.lineWidth = on || leak ? 3 : 2
      ctx.beginPath(); ctx.moveTo(X(ax), Y(ay)); ctx.lineTo(X(bx), Y(by)); ctx.stroke()
      ctx.setLineDash([])
      p.cut.forEach(([x, y], end) => {
        const r = (on ? 6 : 4.5) + (isHot('end', p.id, end) ? 2 : 0)
        circle(ctx, X(x), Y(y), r, col, on ? '#ffffff' : '#101115', on ? 2 : 1.5)
      })
    }
    // pivot: a ring with a cross
    const [px, py] = [X(p.pivot[0]), Y(p.pivot[1])], pr = (on ? 7 : 5.5) + (isHot('pivot', p.id) ? 2 : 0)
    circle(ctx, px, py, pr, 'rgba(16,17,21,0.6)', col, on ? 2.5 : 2)
    ctx.strokeStyle = col; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(px - pr + 2, py); ctx.lineTo(px + pr - 2, py); ctx.moveTo(px, py - pr + 2); ctx.lineTo(px, py + pr - 2); ctx.stroke()
    // seed: a small square dot
    const [sx, sy] = [X(p.seed[0]), Y(p.seed[1])], sr = (on ? 4 : 3) + (isHot('seed', p.id) ? 1.5 : 0)
    ctx.fillStyle = col; ctx.strokeStyle = '#101115'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.rect(sx - sr, sy - sr, sr * 2, sr * 2); ctx.fill(); ctx.stroke()
    pill(ctx, leak ? `${p.id} · leaks` : p.id, px + pr + 5, py - pr - 4, col, { bold: on || leak })
  }

  // named points: white diamonds
  for (const [name, pt] of Object.entries(cut.points ?? {})) {
    const x = X(pt.x), y = Y(pt.y), r = 6 + (isHot('point', pt.piece, name) ? 2 : 0)
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath()
    ctx.fillStyle = '#f4f4f6'; ctx.fill(); ctx.strokeStyle = '#101115'; ctx.lineWidth = 1.5; ctx.stroke()
    pill(ctx, name, x + r + 4, y, '#f4f4f6')
  }

  // split line being drawn
  if (s.split) {
    const { a, b } = s.split
    ctx.strokeStyle = 'rgba(10,10,14,0.85)'; ctx.lineWidth = 5
    ctx.beginPath(); ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1])); ctx.stroke()
    ctx.setLineDash([8, 5]); ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1])); ctx.stroke()
    ctx.setLineDash([])
    for (const [x, y] of [a, b]) circle(ctx, X(x), Y(y), 5, '#ffe066', '#101115')
  }

  // brush cursor
  if (s.cursor && (s.tool === 'keep' || s.tool === 'erase' || s.tool === 'claim')) {
    const col = s.tool === 'keep' ? '#5adc78' : s.tool === 'erase' ? '#ff5050' : (sel ? s.colourOf(sel.id) : '#9aa7bd')
    const [cx, cy] = [X(s.cursor[0]), Y(s.cursor[1])], r = Math.max(2, s.brush * scale)
    circle(ctx, cx, cy, r, null, '#101115', 3)
    circle(ctx, cx, cy, r, null, col, 1.5)
  }
}
