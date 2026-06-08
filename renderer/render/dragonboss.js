// Procedural articulated dragon-boss renderer. Drawn around the boss's screen
// position, rotated by e.facing so the head points at the player. All sub-parts
// are local to the body centre (0,0); +y is "back" (toward the tail).

// Locked scale-layout (from the brainstorming tuner)
const L = { size:0.9, aspect:1.45, rowSpace:0.36, colSpace:0.5, bow:0.6, bowExp:1.4,
            rotFollow:0.6, spineBias:0.16, jitter:0.42, peak:0.04, round:0.16 }

// body half-width profile: [yFrac (-0.5 front .. 0.5 back), halfWidthFrac of bw]
const STATIONS = [[-0.50,0.30],[-0.40,0.42],[-0.30,0.52],[-0.12,0.50],[0.06,0.47],
                  [0.22,0.52],[0.34,0.44],[0.46,0.26],[0.50,0.16]]

function widthAt(yf, bw) {
  for (let i = 1; i < STATIONS.length; i++) {
    if (yf <= STATIONS[i][0]) {
      const [y0,w0] = STATIONS[i-1], [y1,w1] = STATIONS[i]
      const k = (yf - y0) / (y1 - y0)
      return (w0 + (w1 - w0) * k) * bw
    }
  }
  return STATIONS[STATIONS.length - 1][1] * bw
}
function bodyPath(ctx, bw, bh) {
  const pts = STATIONS.map(([yf,wf]) => [yf*bh, wf*bw])
  ctx.beginPath(); ctx.moveTo(pts[0][1], pts[0][0])
  for (let i = 1; i < pts.length; i++) { const [y,w] = pts[i], [py,pw] = pts[i-1]; ctx.quadraticCurveTo(pw, (py+y)/2, w, y) }
  for (let i = pts.length-2; i >= 0; i--) { const [y,w] = pts[i], [py,pw] = pts[i+1]; ctx.quadraticCurveTo(-pw, (py+y)/2, -w, y) }
  ctx.closePath()
}
function hash(i, j) { const s = Math.sin(i*12.9898 + j*78.233) * 43758.5453; return s - Math.floor(s) }

function shieldScale(ctx, w, h, top, bot) {
  const tl=-w/2, tr=w/2, ty=-h/2, by=h/2, tp=h*L.peak
  ctx.beginPath()
  ctx.moveTo(tl, ty+tp); ctx.lineTo(0, ty); ctx.lineTo(tr, ty+tp)
  ctx.quadraticCurveTo(tr, h*L.round, 0, by)
  ctx.quadraticCurveTo(tl, h*L.round, tl, ty+tp)
  ctx.closePath()
  const g = ctx.createLinearGradient(0, ty, 0, by); g.addColorStop(0, top); g.addColorStop(1, bot)
  ctx.fillStyle = g; ctx.fill()
  ctx.strokeStyle = 'rgba(28,8,5,0.6)'; ctx.lineWidth = 1; ctx.stroke()
}
function scaleBody(ctx, bw, bh, S) {
  const sw0 = S*L.size, sh0 = S*L.size*L.aspect
  const stepY = sh0*L.rowSpace, stepX = sw0*L.colSpace, bowPx = S*L.bow
  ctx.save(); bodyPath(ctx, bw, bh); ctx.clip()
  ctx.fillStyle = '#3a120d'; ctx.fillRect(-bw, -bh, bw*2, bh*2)
  const rows = []; for (let y = -bh*0.5; y <= bh*0.5; y += stepY) rows.push(y)
  for (let ri = rows.length-1; ri >= 0; ri--) {
    const y = rows[ri], yf = y/bh, hw = widthAt(yf, bw), front = 1 - (yf + 0.5)
    const top = `rgb(${78+front*30|0},${24+front*14|0},${18+front*8|0})`
    const bot = `rgb(${170+front*55|0},${62+front*28|0},${48+front*16|0})`
    const off = (ri % 2) * stepX * 0.5
    let col = 0
    for (let x = -hw + off; x <= hw; x += stepX, col++) {
      const nx = hw > 0 ? x/hw : 0
      const yc = y - bowPx * Math.pow(Math.abs(nx), L.bowExp)          // upward-opening parabola
      const slope = (-L.bowExp * bowPx * Math.pow(Math.abs(nx), L.bowExp-1) * Math.sign(nx)) / (hw || 1)
      const rot = Math.atan(slope) * L.rotFollow
      const sizeF = (1 - L.spineBias*Math.abs(nx)) * (1 - L.jitter*0.5 + L.jitter*hash(ri, col))
      ctx.save(); ctx.translate(x, yc); ctx.rotate(rot)
      shieldScale(ctx, sw0*sizeF, sh0*sizeF, top, bot)
      ctx.restore()
    }
  }
  ctx.restore()
  bodyPath(ctx, bw, bh); ctx.strokeStyle = 'rgba(255,140,90,0.5)'; ctx.lineWidth = 2; ctx.stroke()
}
function chain(ctx, x, y, startAng, segs, segLen, wFn, color, bendFn) {
  let px = x, py = y, ang = startAng
  for (let i = 0; i < segs; i++) {
    ang += bendFn(i)
    const nx = px + Math.cos(ang)*segLen, ny = py + Math.sin(ang)*segLen
    ctx.strokeStyle = color; ctx.lineWidth = wFn(i); ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke()
    px = nx; py = ny
  }
  return { x: px, y: py, ang }
}
function wing(ctx, sx, sy, s, t, S) {
  const flap = Math.sin(t*1.5)*0.10 + 0.18
  ctx.save(); ctx.translate(sx, sy); ctx.scale(s, 1); ctx.rotate(-flap)
  const fingers = [{a:-0.55,l:S*2.9},{a:-0.15,l:S*3.2},{a:0.30,l:S*3.0},{a:0.75,l:S*2.4}]
  const tips = fingers.map(f => [Math.cos(f.a)*f.l, Math.sin(f.a)*f.l])
  ctx.fillStyle = 'rgba(110,30,24,0.8)'
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(tips[0][0], tips[0][1])
  for (let i = 0; i < tips.length-1; i++) { const a = tips[i], b = tips[i+1]; ctx.quadraticCurveTo((a[0]+b[0])/2, (a[1]+b[1])/2 + S*0.5, b[0], b[1]) }
  ctx.lineTo(S*0.6, S*0.4); ctx.closePath(); ctx.fill()
  ctx.strokeStyle = '#7c241b'; ctx.lineWidth = 3; ctx.lineCap = 'round'
  for (const tp of tips) { ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(tp[0], tp[1]); ctx.stroke() }
  ctx.strokeStyle = '#9c2e24'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(tips[0][0], tips[0][1]); ctx.stroke()
  ctx.restore()
}
function leg(ctx, bx, by, s, reach, t, S) {
  const sw = Math.sin(t*2.0)*0.06*s
  ctx.save(); ctx.translate(bx, by); ctx.rotate(sw)
  ctx.fillStyle = '#7a241b'; ctx.beginPath(); ctx.ellipse(s*reach, 0, S*0.9, S*0.55, s*0.5, 0, 7); ctx.fill()
  ctx.strokeStyle = '#e8c08a'; ctx.lineWidth = 2; ctx.lineCap = 'round'
  for (let c = -1; c <= 1; c++) { ctx.beginPath(); ctx.moveTo(s*reach*1.3, c*5); ctx.lineTo(s*reach*1.7, c*7); ctx.stroke() }
  ctx.restore()
}
function flameCone(ctx, x, y, ang, S) {
  const len = S*5.2, half = 0.34
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang)
  const g = ctx.createLinearGradient(0, 0, len, 0)
  g.addColorStop(0, '#ffe08a'); g.addColorStop(0.5, '#ff7a2a'); g.addColorStop(1, 'rgba(200,40,0,0.05)')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(len, -Math.tan(half)*len); ctx.lineTo(len, Math.tan(half)*len); ctx.closePath(); ctx.fill()
  ctx.restore()
}

export function drawDragonBoss(ctx, e, camX, camY, S) {
  const ox = Math.round(e.px - camX), oy = Math.round(e.py - camY)
  const t = e.breathTime ?? 0
  const breath = 0.5 + 0.5*Math.sin(t*1.4)
  const bw = 3*S*(1 + breath*0.02), bh = 4*S*(1 + breath*0.02)

  ctx.save()
  ctx.translate(ox, oy)
  ctx.rotate((e.facing ?? 0) + Math.PI/2)        // local "up" (head, -y) -> facing direction

  const shoulderY = -bh*0.22
  wing(ctx, -bw*0.12, shoulderY, -1, t, S); wing(ctx, bw*0.12, shoulderY, 1, t, S)
  leg(ctx, -bw*0.42, -bh*0.18, -1, S*0.7, t, S);   leg(ctx, bw*0.42, -bh*0.18, 1, S*0.7, t, S)
  leg(ctx, -bw*0.40,  bh*0.20, -1, S*0.8, t+1, S); leg(ctx, bw*0.40,  bh*0.20, 1, S*0.8, t+1, S)

  const sweep = (e.tailSwing ?? 0)
  chain(ctx, 0, bh*0.48, Math.PI/2, 6, S*0.85, i => (6-i)/6*S*1.1 + 3, '#9c2e24',
        i => Math.sin(t*2.2 - i*0.7)*0.18 + sweep*(i+1)/6*0.5)

  scaleBody(ctx, bw, bh, S)

  ctx.fillStyle = '#e8c08a'
  for (let y = -bh*0.36; y < bh*0.40; y += S*0.62) {
    const h = S*0.5*(1 - Math.abs(y/bh)*0.6)
    ctx.beginPath(); ctx.moveTo(-h*0.5, y); ctx.lineTo(0, y - h*1.4); ctx.lineTo(h*0.5, y); ctx.closePath(); ctx.fill()
  }

  const rear = e.neckRear ?? 0
  const aim = (e.state === 'sweep') ? (e.headAim ?? 0) : 0
  const tip = chain(ctx, 0, -bh*0.48, -Math.PI/2, 5, S*0.72, i => S*0.85 - i*S*0.06, '#a82f25',
    i => {
      const idle = Math.sin(t*0.9 - i*0.6)*0.22
      const rearBend = rear * (i < 2 ? 0.55 : -0.65)
      const aimBend = (i === 4 ? aim*0.9 : aim*0.15)
      return idle*(1 - rear*0.6) + rearBend + aimBend
    })

  if (e.state === 'cone' || e.state === 'sweep') flameCone(ctx, tip.x, tip.y, tip.ang, S)

  ctx.save(); ctx.translate(tip.x, tip.y); ctx.rotate(tip.ang + Math.PI/2)
  ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.ellipse(0, -S*0.2, S*0.8, S*0.7, 0, 0, 7); ctx.fill()
  ctx.strokeStyle = '#ff8a5a'; ctx.lineWidth = 2; ctx.stroke()
  ctx.strokeStyle = '#e8c08a'; ctx.lineWidth = 3
  for (const s of [-1,1]) { ctx.beginPath(); ctx.moveTo(s*S*0.5, -S*0.6); ctx.lineTo(s*S*0.9, -S*1.2); ctx.stroke() }
  ctx.fillStyle = '#ffd23a'; for (const s of [-1,1]) { ctx.beginPath(); ctx.arc(s*S*0.35, -S*0.2, 3, 0, 7); ctx.fill() }
  ctx.restore()

  ctx.restore()
}
