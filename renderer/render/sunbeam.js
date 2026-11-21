// Päivölä's sunbeam: a soft golden shaft from the window down to wherever
// the mirrors send it, dust drifting along it, a glint where it turns, and
// the seed glowing once the light reaches it. Drawn over the floor, under
// people (canvas.js calls it right after the ground effects). Only the part
// of the beam on cells the player has seen is drawn.
const TAU = Math.PI * 2

export function drawSunbeam(ctx, sun, map, camX, camY, S, t) {
  const cells = sun?.beam?.cells
  if (!cells?.length) return
  const at = (x, y) => [x * S + S / 2 - camX, y * S + S / 2 - camY]
  // the shaft starts at the window, in the wall above its first cell
  const pts = [[sun.start.x * S + S / 2 - camX, (sun.start.y - 1.2) * S - camY]]
  for (const c of cells) { if (!map[c.y]?.[c.x]?.explored) break; pts.push(at(c.x, c.y)) }
  const hit = sun.beam.hit
  if (hit && pts.length === cells.length + 1) pts.push(at(hit.x, hit.y))
  else {
    // a beam that stops at a wall or a table reaches the edge of it
    const e = sun.beam.end, d = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[e.dir] ?? [0, 1]
    if (pts.length === cells.length + 1) pts.push([pts.at(-1)[0] + d[0] * S / 2, pts.at(-1)[1] + d[1] * S / 2])
  }
  if (pts.length < 2) return
  const pulse = 0.85 + 0.15 * Math.sin(t * 1.7)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  const path = () => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))) }
  for (const [w, a] of [[0.95, 0.07], [0.6, 0.11], [0.3, 0.2], [0.12, 0.42]]) {
    path(); ctx.lineWidth = S * w; ctx.strokeStyle = `rgba(255,${Math.round(196 + 50 * (1 - w))},${Math.round(110 + 80 * (1 - w))},${a * pulse})`; ctx.stroke()
  }
  // dust drifting down the light
  let total = 0
  const segs = []
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); total += l }
  const motes = Math.min(40, Math.round(total / (S * 0.6)))
  for (let m = 0; m < motes; m++) {
    let d = ((m / motes) + t * 0.05 * (1 + (m % 3) * 0.3)) % 1 * total
    let i = 0
    while (i < segs.length - 1 && d > segs[i]) { d -= segs[i]; i++ }
    const f = segs[i] ? d / segs[i] : 0
    const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f + Math.sin(t * 2 + m * 1.3) * S * 0.12
    const y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f + Math.cos(t * 1.6 + m) * S * 0.12
    ctx.fillStyle = `rgba(255,240,200,${0.35 + 0.35 * Math.sin(t * 3 + m * 2.1) ** 2})`
    ctx.fillRect(Math.round(x), Math.round(y), 2, 2)
  }
  // a glint where a mirror turns it
  for (const c of cells) {
    if (!map[c.y]?.[c.x]?.mirror || !map[c.y][c.x].explored) continue
    const [x, y] = at(c.x, c.y), r = S * (0.28 + 0.06 * Math.sin(t * 4 + c.x))
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(255,255,240,0.9)'); g.addColorStop(1, 'rgba(255,230,160,0)')
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill()
  }
  // the seed in full sun: a warm halo, and the hall glows with it
  if (hit) {
    const [x, y] = at(hit.x, hit.y), r = S * (1.6 + 0.2 * Math.sin(t * 2))
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(255,236,150,0.55)'); g.addColorStop(1, 'rgba(255,200,90,0)')
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill()
  }
  ctx.restore()
}
