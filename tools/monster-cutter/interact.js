// Pointer and keyboard handling for the cutter's editor canvas: the view
// (fit, wheel zoom, pan) and the tools (edit handles, keep/erase brush, split,
// claim, point). It changes the cut only through `ctl` (see cutter.js).
import { handlesOf, HANDLE_HIT } from './overlay.js'
import { moveCutEnd, movePivot, moveSeed, setPoint, addClaim } from './cut-model.js'

const TOOL_KEYS = { v: 'edit', k: 'keep', e: 'erase', s: 'split', c: 'claim', p: 'point' }

export const makeView = () => ({ scale: 1, ox: 0, oy: 0 })

export function fitView(view, w, h, cssW, cssH) {
  const pad = 28
  view.scale = Math.max(0.02, Math.min((cssW - 2 * pad) / w, (cssH - 2 * pad) / h))
  view.ox = Math.round((cssW - w * view.scale) / 2)
  view.oy = Math.round((cssH - h * view.scale) / 2)
}

// Points from `from` towards `to`, `step` apart (not including `from`).
function spaced(from, to, step) {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]), out = []
  for (let t = step; t <= d; t += step) out.push([from[0] + (to[0] - from[0]) * t / d, from[1] + (to[1] - from[1]) * t / d])
  return out
}

// ctl: { S, view, redraw, begin, preview(cut), end, select(id), hint(msg, kind),
//        paintMask(discs), ownerAt([x, y]), finishSplit(seed), placePoint([x, y]),
//        setTool(t), setBrush(r), fit(), undo(), redo(), merge(id), coords([x, y] | null),
//        isActive?() -> boolean: false while the editor's tab is hidden, so its keys stay off }
export function attachEditor(canvas, ctl) {
  const { S, view } = ctl
  let drag = null, spaceDown = false
  const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
  const toImg = ([sx, sy]) => [(sx - view.ox) / view.scale - 0.5, (sy - view.oy) / view.scale - 0.5]
  const pix = ([x, y]) => [Math.round(x), Math.round(y)]

  function hitHandle([sx, sy]) {
    let best = null, bestD = HANDLE_HIT ** 2
    for (const hnd of handlesOf(S.cut, S.selected)) {
      const d = (view.ox + (hnd.x + 0.5) * view.scale - sx) ** 2 + (view.oy + (hnd.y + 0.5) * view.scale - sy) ** 2
      if (d < bestD) { bestD = d; best = hnd }
    }
    return best
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault())
  canvas.addEventListener('pointerdown', e => {
    if (!S.cut) return
    canvas.setPointerCapture(e.pointerId)
    const sp = local(e), ip = toImg(sp)
    if (e.button === 1 || e.button === 2 || spaceDown) { drag = { kind: 'pan', last: sp }; canvas.style.cursor = 'grabbing'; return }
    if (e.button !== 0) return
    switch (S.tool) {
      case 'edit': {
        const hnd = hitHandle(sp)
        if (hnd) {
          ctl.begin()
          drag = { kind: 'handle', hnd }
          if (hnd.kind !== 'point') ctl.select(hnd.id)
          canvas.style.cursor = 'grabbing'
        } else {
          const o = ctl.ownerAt(pix(ip))
          ctl.select(o >= 0 ? S.cut.pieces[o].id : null)
        }
        return
      }
      case 'keep': case 'erase': {
        const keep = S.tool === 'keep'
        ctl.begin()
        ctl.paintMask([{ x: ip[0], y: ip[1], r: S.brush, keep }])
        drag = { kind: 'brush', last: ip, keep }
        return
      }
      case 'claim': {
        if (!S.selected) { ctl.hint('Select the piece that should take the pixels first: click it in the list, or with the Edit tool (V).', 'warn'); return }
        ctl.begin()
        ctl.preview(addClaim(S.cut, S.selected, { x: ip[0], y: ip[1], r: S.brush }))
        drag = { kind: 'claim', last: ip }
        return
      }
      case 'split':
        if (S.split?.stage === 'seed') { ctl.finishSplit(pix(ip)); return }
        S.split = { a: pix(ip), b: pix(ip), stage: 'line' }
        drag = { kind: 'split' }
        ctl.redraw()
        return
      case 'point':
        ctl.placePoint(pix(ip))
    }
  })

  canvas.addEventListener('pointermove', e => {
    if (!S.cut) return
    const sp = local(e), ip = toImg(sp)
    S.cursor = ip
    ctl.coords(pix(ip))
    if (!drag) {
      S.hot = S.tool === 'edit' ? hitHandle(sp) : null
      canvas.style.cursor = spaceDown ? 'grab' : S.hot ? 'grab' : S.tool === 'edit' ? 'default' : 'crosshair'
      ctl.redraw()
      return
    }
    switch (drag.kind) {
      case 'pan':
        view.ox += sp[0] - drag.last[0]; view.oy += sp[1] - drag.last[1]; drag.last = sp
        break
      case 'handle': {
        const h = drag.hnd, p = pix(ip)
        if (h.kind === 'end') ctl.preview(moveCutEnd(S.cut, h.id, h.end, p))
        else if (h.kind === 'pivot') ctl.preview(movePivot(S.cut, h.id, p))
        else if (h.kind === 'seed') ctl.preview(moveSeed(S.cut, h.id, p))
        else ctl.preview(setPoint(S.cut, h.name, S.cut.points[h.name].piece, p))
        break
      }
      case 'brush': {
        const pts = spaced(drag.last, ip, Math.max(1, S.brush / 3))
        if (pts.length) {
          ctl.paintMask(pts.map(([x, y]) => ({ x, y, r: S.brush, keep: drag.keep })))
          drag.last = pts.at(-1)
        }
        break
      }
      case 'claim': {
        const pts = spaced(drag.last, ip, Math.max(1, S.brush * 0.6))
        if (pts.length) {
          let cut = S.cut
          for (const [x, y] of pts) cut = addClaim(cut, S.selected, { x, y, r: S.brush })
          ctl.preview(cut)
          drag.last = pts.at(-1)
        }
        break
      }
      case 'split':
        S.split.b = pix(ip)
    }
    ctl.redraw()
  })

  const up = () => {
    if (!drag) return
    const d = drag
    drag = null
    canvas.style.cursor = S.tool === 'edit' ? 'default' : 'crosshair'
    if (d.kind === 'pan') return
    if (d.kind === 'split') {
      const { a, b } = S.split
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 2) { S.split = null; ctl.hint('Drag a line across the part you want to cut off.', 'warn') }
      else { S.split.stage = 'seed'; ctl.hint('Now click the side of the line that becomes the new piece. Esc cancels.') }
      ctl.redraw()
      return
    }
    if (d.kind === 'handle' && d.hnd.kind === 'point') {
      // a dropped point rides the piece under it
      const pt = S.cut.points[d.hnd.name], o = ctl.ownerAt([pt.x, pt.y])
      if (o >= 0 && S.cut.pieces[o].id !== pt.piece) ctl.preview(setPoint(S.cut, d.hnd.name, S.cut.pieces[o].id, [pt.x, pt.y]))
    }
    ctl.end()
  }
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)
  canvas.addEventListener('pointerleave', () => { if (!drag) { S.cursor = null; S.hot = null; ctl.coords(null); ctl.redraw() } })

  canvas.addEventListener('wheel', e => {
    if (!S.cut) return
    e.preventDefault()
    const [sx, sy] = local(e)
    const next = Math.min(48, Math.max(0.02, view.scale * Math.exp(-e.deltaY * 0.0015)))
    const k = next / view.scale
    view.ox = sx - (sx - view.ox) * k; view.oy = sy - (sy - view.oy) * k; view.scale = next
    ctl.redraw()
  }, { passive: false })

  window.addEventListener('keydown', e => {
    if (ctl.isActive?.() === false) return
    if (e.target.closest?.('input, select, textarea, dialog')) return
    if (!S.cut) return
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase()
    if (e.key === ' ') {
      spaceDown = true; canvas.style.cursor = 'grab'
      if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur()
    } else if (mod && k === 'z') e.shiftKey ? ctl.redo() : ctl.undo()
    else if (mod && k === 'y') ctl.redo()
    else if (mod) return
    else if (TOOL_KEYS[k]) ctl.setTool(TOOL_KEYS[k])
    else if (k === 'f') ctl.fit()
    else if (e.key === '[') ctl.setBrush(S.brush / 1.25)
    else if (e.key === ']') ctl.setBrush(S.brush * 1.25)
    else if (e.key === 'Escape') {
      if (S.split) { S.split = null; ctl.hint('Split cancelled.'); ctl.redraw() } else ctl.select(null)
    } else if (e.key === 'Delete') { if (S.selected) ctl.merge(S.selected) }
    else return
    e.preventDefault()
  })
  // space is always let go, so a tab switch mid-pan never leaves it stuck down
  window.addEventListener('keyup', e => {
    if (e.key !== ' ') return
    spaceDown = false
    if (ctl.isActive?.() !== false) canvas.style.cursor = S.tool === 'edit' ? 'default' : 'crosshair'
  })
}
