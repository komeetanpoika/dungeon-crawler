// The Movement tab's posing view: one phase card's pose drawn large through
// the monster's own rig (pose.still), with a yellow dot at each posable
// piece's joint and a white dot at its far end. Dragging a white dot turns
// and stretches that piece and its joint-mates (onDrag gets every id of the
// group); the dot keeps its offset from the pointer, and a click without a
// drag only selects (pose-math.js startGrab/grabPoint). It redraws only when
// told something changed (setFigure, setPose, select) or while a drag runs:
// no animation loop, the canvas is software.
import { dragValues, startGrab, grabPoint } from './pose-math.js'

const FILL = 0.6                 // the rest figure's share of the view; posed limbs need room
const HIT_R = 16                 // canvas px around a white dot that grab it
const SELECTED = '#4aa3ff'
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]
const apply = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })

// The pose a still drawing is made with: the rig's breath, bob, lean and
// lunge all rest at t 0, and facing straight down never mirrors.
export const stillPose = still => ({ state: 'idle', t: 0, stateT: 0, facing: Math.PI / 2, speed01: 0, still })

// Where a figure sits in a W×H canvas with its rest drawing filling `fill`
// of it, centred: the tile size S for drawMonster, the entity centre
// (ox, oy) to translate to, and M, figure px → canvas px.
export function fitFigure({ engine, parts, params }, W, H, fill = FILL) {
  const { w, h } = parts.figure
  const k = fill * Math.min(W / w, H / h)
  const S = k * h / params.size
  const m = engine.stillMatrix(parts, params, S)
  const ox = (W - w * k) / 2 - m[4], oy = (H - h * k) / 2 - m[5]
  return { S, ox, oy, M: [m[0], m[1], m[2], m[3], m[4] + ox, m[5] + oy] }
}

// Draws `still` (a sparse pose) filling a canvas; the phase cards' thumbnails.
export function drawStill(ctx, figure, still, W, H, fill = 0.8) {
  ctx.clearRect(0, 0, W, H)
  if (!figure) return
  const { S, ox, oy } = fitFigure(figure, W, H, fill)
  ctx.save()
  ctx.translate(ox, oy)
  figure.rig.drawMonster(ctx, figure.params, stillPose(still ?? {}), S)
  ctx.restore()
}

export function mountPoseEditor(canvas, { onDrag = () => {}, onSelect = () => {} } = {}) {
  const ctx = canvas.getContext('2d')
  let fig = null, still = {}, selected = null, drag = null
  let handles = []                // { id, joint, tip, rest, outline } in canvas px, from the last redraw

  function redraw() {
    const W = canvas.width, H = canvas.height
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, W, H)
    handles = []
    if (!fig) return
    const { S, ox, oy, M } = fitFigure(fig, W, H)
    const pose = stillPose(still)
    ctx.save()
    ctx.translate(ox, oy)
    fig.rig.drawMonster(ctx, fig.params, pose, S)
    ctx.restore()

    const byId = new Map(fig.parts.pieces.map(p => [p.id, p]))
    const frames = fig.engine.pieceFrames(fig.parts, fig.params, pose)
    for (const id of fig.groups.keys()) {
      const piece = byId.get(id), f = frames.get(id)
      if (!piece || !f) continue
      const world = mul(M, f.world), carry = mul(M, f.carry)
      const [ex, ey] = fig.engine.pieceEnd(piece)
      const [x, y] = piece.at, w = piece.rect[2], h = piece.rect[3]
      handles.push({
        id,
        joint: apply(world, piece.pivot[0], piece.pivot[1]),
        tip: apply(world, ex, ey),
        rest: apply(carry, ex, ey),
        outline: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => apply(world, px, py)),
      })
    }
    // the selected piece and its joint-mates (they move together) outlined
    const group = new Set(selected ? fig.groups.get(selected) ?? [selected] : [])
    ctx.strokeStyle = SELECTED; ctx.lineWidth = 1.5
    for (const h of handles) if (group.has(h.id)) {
      ctx.beginPath()
      h.outline.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.closePath(); ctx.stroke()
    }
    // the selected piece last, so its dots sit on top
    const order = [...handles.filter(h => h.id !== selected), ...handles.filter(h => h.id === selected)]
    for (const h of order) drawHandle(h, h.id === selected)
  }

  function drawHandle(h, on) {
    ctx.strokeStyle = on ? SELECTED : 'rgba(255,255,255,.55)'; ctx.lineWidth = on ? 2 : 1.2
    ctx.setLineDash([4, 3])
    ctx.beginPath(); ctx.moveTo(h.joint.x, h.joint.y); ctx.lineTo(h.tip.x, h.tip.y); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#3a2a00'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(h.joint.x, h.joint.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.fillStyle = on ? SELECTED : '#fff'; ctx.strokeStyle = '#222'
    ctx.beginPath(); ctx.arc(h.tip.x, h.tip.y, on ? 9 : 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  }

  const toCanvas = e => {
    const r = canvas.getBoundingClientRect()
    return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height }
  }
  // the white dot under the pointer; the selected piece wins a near tie
  function handleAt(m) {
    let best = null, bd = HIT_R
    for (const h of handles) {
      const d = Math.hypot(h.tip.x - m.x, h.tip.y - m.y) - (h.id === selected ? 3 : 0)
      if (d < bd) { bd = d; best = h }
    }
    return best
  }

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return
    const m = toCanvas(e), h = handleAt(m)
    if (!h) return
    e.preventDefault()
    // the joint and the rest end stay put while this piece turns: its parent doesn't move
    drag = { id: h.id, joint: h.joint, rest: h.rest, grab: startGrab(h.tip, m) }
    canvas.setPointerCapture(e.pointerId)
    canvas.style.cursor = 'grabbing'
    if (selected !== h.id) { selected = h.id; onSelect(h.id); redraw() }
  })
  canvas.addEventListener('pointermove', e => {
    const m = toCanvas(e)
    if (!drag) { canvas.style.cursor = handleAt(m) ? 'grab' : ''; return }
    const at = grabPoint(drag.grab, m)
    if (!at) return                  // still a click: the piece is selected, not moved
    drag.grab.live = true
    const values = dragValues({ joint: drag.joint, restEnd: drag.rest, mouse: at, prevTurn: still[drag.id]?.turn ?? 0 })
    onDrag(fig.groups.get(drag.id) ?? [drag.id], values)
  })
  const end = () => { if (!drag) return; drag = null; canvas.style.cursor = '' }
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
  canvas.addEventListener('lostpointercapture', end)

  return {
    setFigure(f) { fig = f; drag = null; redraw() },
    setPose(p) { still = p ?? {}; redraw() },
    select(id) { selected = id ?? null; redraw() },
    redraw,
    // a white dot's position in page (client) px, for scripts that drag it; null when it has none
    handlePoint(id) {
      const h = handles.find(x => x.id === id)
      if (!h) return null
      const r = canvas.getBoundingClientRect()
      return { x: r.left + h.tip.x * r.width / canvas.width, y: r.top + h.tip.y * r.height / canvas.height }
    },
  }
}
