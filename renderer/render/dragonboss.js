// Procedural articulated dragon-boss renderer. Drawn around the boss's screen
// position, rotated by e.facing so the head points at the player. All sub-parts
// are local to the body centre (0,0); -y is "forward" (head), +y is "back" (tail).
// Ported from the brainstorming overhaul mockup (overhaul-v13).

// Locked scale-layout (from the brainstorming tuner)
const L = { size:0.9, aspect:1.45, rowSpace:0.34, colSpace:0.48, bow:0.6, bowExp:1.4,
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

// Body: dense curved scale rows (locked tuner values). Only the dark underlay is
// clipped to the outline; the scales draw UNCLIPPED so none are cut off (scalloped edge).
function scaleBody(ctx, bw, bh, S) {
  const sw0 = S*L.size, sh0 = S*L.size*L.aspect
  const stepY = sh0*L.rowSpace, stepX = sw0*L.colSpace, bowPx = S*L.bow
  ctx.save(); bodyPath(ctx, bw, bh); ctx.clip()
  ctx.fillStyle = '#3a120d'; ctx.fillRect(-bw, -bh, bw*2, bh*2); ctx.restore()
  const rows = []; for (let y = -bh*0.5; y <= bh*0.5; y += stepY) rows.push(y)
  for (let ri = rows.length-1; ri >= 0; ri--) {
    const y = rows[ri], yf = y/bh, hw = widthAt(yf, bw), front = 1 - (yf + 0.5)
    const top = `rgb(${78+front*30|0},${24+front*14|0},${18+front*8|0})`
    const bot = `rgb(${170+front*55|0},${62+front*28|0},${48+front*16|0})`
    const off = (ri % 2) * stepX * 0.5
    let col = 0
    for (let x = -hw + off; x <= hw; x += stepX, col++) {
      const nx = hw > 0 ? x/hw : 0
      const yc = y - bowPx * Math.pow(Math.abs(nx), L.bowExp)
      const slope = (-L.bowExp * bowPx * Math.pow(Math.abs(nx), L.bowExp-1) * Math.sign(nx)) / (hw || 1)
      const rot = Math.atan(slope) * L.rotFollow
      const sizeF = (1 - L.spineBias*Math.abs(nx)) * (1 - L.jitter*0.5 + L.jitter*hash(ri, col))
      ctx.save(); ctx.translate(x, yc); ctx.rotate(rot)
      shieldScale(ctx, sw0*sizeF, sh0*sizeF, top, bot)
      ctx.restore()
    }
  }
}

// Neck / tail rendered as overlapping scale plates; returns the tip {x,y,ang}.
function scaledChain(ctx, x, y, startAng, segs, segLen, wFn, bendFn, dk) {
  let px = x, py = y, ang = startAng
  const pts = [{ x:px, y:py, ang }]
  for (let i = 0; i < segs; i++) { ang += bendFn(i); px += Math.cos(ang)*segLen; py += Math.sin(ang)*segLen; pts.push({ x:px, y:py, ang }) }
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[i+1], mx = (a.x+b.x)/2, my = (a.y+b.y)/2, w = wFn(i), front = 1 - i/segs
    const top = `rgb(${(70+front*26)*dk|0},${(22+front*12)*dk|0},${(16+front*7)*dk|0})`
    const bot = `rgb(${(150+front*50)*dk|0},${(56+front*24)*dk|0},${(44+front*14)*dk|0})`
    ctx.save(); ctx.translate(mx, my); ctx.rotate(b.ang - Math.PI/2); shieldScale(ctx, w, segLen*1.7, top, bot); ctx.restore()
  }
  return pts[pts.length-1]
}

// Bigger detailed wing with a large aft "sail" anchored at the wing pivot.
function wing(ctx, sx, sy, s, t, S) {
  const flap = Math.sin(t*1.5)*0.12 + 0.22
  ctx.save(); ctx.translate(sx, sy); ctx.scale(s, 1); ctx.rotate(-flap)
  const sc = 1.4, elbow = [S*1.5*sc, -S*0.15*sc]
  const fingers = [{a:-0.78,l:S*2.5*sc},{a:-0.40,l:S*3.0*sc},{a:-0.02,l:S*3.2*sc},{a:0.40,l:S*2.9*sc},{a:0.82,l:S*2.2*sc}]
  const tips = fingers.map(f => [elbow[0]+Math.cos(f.a)*f.l, elbow[1]+Math.sin(f.a)*f.l])
  // large aft sail: wing pivot (root) -> trailing tip, billowing past the arm
  const aft = tips[tips.length-1]
  const cpx = (0+aft[0])/2 + S*0.6, cpy = (0+aft[1])/2 + S*1.2
  ctx.fillStyle = 'rgba(146,48,40,0.55)'
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(elbow[0],elbow[1]); ctx.lineTo(aft[0],aft[1]); ctx.quadraticCurveTo(cpx,cpy, 0,0); ctx.closePath(); ctx.fill()
  ctx.strokeStyle = 'rgba(120,40,32,0.7)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(0,0); ctx.quadraticCurveTo(cpx,cpy,aft[0],aft[1]); ctx.stroke()
  // main inter-finger membrane
  const g = ctx.createLinearGradient(0,0,elbow[0]+S*2.5*sc,S); g.addColorStop(0,'#8e2620'); g.addColorStop(1,'#561510')
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(elbow[0],elbow[1]); ctx.lineTo(tips[0][0],tips[0][1])
  for (let i = 0; i < tips.length-1; i++) { const a = tips[i], b = tips[i+1]; ctx.quadraticCurveTo((a[0]+b[0])/2,(a[1]+b[1])/2+S*0.8,b[0],b[1]) }
  ctx.lineTo(elbow[0],elbow[1]); ctx.lineTo(S*0.5,S*0.5); ctx.closePath(); ctx.fill()
  // veins
  ctx.strokeStyle = 'rgba(40,12,9,0.45)'; ctx.lineWidth = 1.5; for (const tp of tips) { ctx.beginPath(); ctx.moveTo(elbow[0],elbow[1]); ctx.lineTo(tp[0],tp[1]); ctx.stroke() }
  // bones
  ctx.strokeStyle = '#9c2e24'; ctx.lineCap = 'round'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(elbow[0],elbow[1]); ctx.stroke()
  ctx.lineWidth = 3.5; for (const tp of tips) { ctx.beginPath(); ctx.moveTo(elbow[0],elbow[1]); ctx.lineTo(tp[0],tp[1]); ctx.stroke() }
  // finger claws + leading wing-claw
  ctx.fillStyle = '#efe0c0'
  for (let i = 0; i < tips.length; i++) { const tp = tips[i], a = fingers[i].a, cl = S*0.42
    ctx.beginPath(); ctx.moveTo(tp[0],tp[1]); ctx.lineTo(tp[0]+Math.cos(a-0.35)*cl,tp[1]+Math.sin(a-0.35)*cl); ctx.lineTo(tp[0]+Math.cos(a+0.25)*cl*0.5,tp[1]+Math.sin(a+0.25)*cl*0.5); ctx.closePath(); ctx.fill() }
  ctx.beginPath(); ctx.moveTo(elbow[0],elbow[1]); ctx.lineTo(elbow[0]+S*0.6,elbow[1]-S*0.7); ctx.lineTo(elbow[0]+S*0.25,elbow[1]-S*0.1); ctx.closePath(); ctx.fill()
  ctx.restore()
}

// Compact clawed foot (no leg, smooth): pad tucks under the body, claws fan OUTWARD past the edge.
function foot(ctx, bx, by, s, t, S) {
  const out = Math.atan2(by, bx)
  const wig = Math.sin(t*2.0 + bx) * 0.05
  ctx.save(); ctx.translate(bx, by); ctx.rotate(wig)
  ctx.fillStyle = '#5a1712'
  ctx.beginPath(); ctx.ellipse(Math.cos(out)*S*0.3, Math.sin(out)*S*0.3, S*0.55, S*0.4, out, 0, Math.PI*2); ctx.fill()
  ctx.fillStyle = '#efe0c0'; ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = 1
  for (const off of [-0.5, 0, 0.5]) {
    const dir = out + off, baseR = S*0.5, len = S*1.05, pw = S*0.1
    const b0 = [Math.cos(dir)*baseR, Math.sin(dir)*baseR]
    const tip = [Math.cos(dir)*(baseR+len), Math.sin(dir)*(baseR+len)]
    const cx = (b0[0]+tip[0])/2 - Math.sin(dir)*S*0.12, cy = (b0[1]+tip[1])/2 + Math.cos(dir)*S*0.12
    ctx.beginPath(); ctx.moveTo(b0[0]-Math.sin(dir)*pw, b0[1]+Math.cos(dir)*pw)
    ctx.quadraticCurveTo(cx, cy, tip[0], tip[1])
    ctx.quadraticCurveTo(cx, cy, b0[0]+Math.sin(dir)*pw, b0[1]-Math.cos(dir)*pw); ctx.closePath(); ctx.fill(); ctx.stroke()
  }
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

// Refined head at the neck tip. Local frame: -y forward (snout), +y toward the neck.
function head(ctx, tip, S) {
  ctx.save(); ctx.translate(tip.x, tip.y); ctx.rotate(tip.ang + Math.PI/2)
  // horns first (behind skull), two pairs swept back
  ctx.strokeStyle = '#d8b886'; ctx.lineCap = 'round'
  for (const s of [-1,1]) {
    ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(s*S*0.4,-S*0.05); ctx.quadraticCurveTo(s*S*1.0,S*0.5,s*S*0.85,S*1.3); ctx.stroke()
    ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(s*S*0.28,-S*0.3); ctx.quadraticCurveTo(s*S*0.7,-S*0.05,s*S*0.7,S*0.45); ctx.stroke()
  }
  // skull
  const hg = ctx.createLinearGradient(0,-S*1.5,0,S*0.6); hg.addColorStop(0,'#b83a2c'); hg.addColorStop(1,'#7c241b')
  ctx.fillStyle = hg; ctx.strokeStyle = '#ff8a5a'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(0,-S*1.55)
  ctx.quadraticCurveTo(S*0.5,-S*1.05,S*0.6,-S*0.2)
  ctx.quadraticCurveTo(S*0.72,S*0.45,0,S*0.6)
  ctx.quadraticCurveTo(-S*0.72,S*0.45,-S*0.6,-S*0.2)
  ctx.quadraticCurveTo(-S*0.5,-S*1.05,0,-S*1.55); ctx.closePath(); ctx.fill(); ctx.stroke()
  // brow ridges
  ctx.fillStyle = '#5a1812'
  for (const s of [-1,1]) { ctx.beginPath(); ctx.moveTo(s*S*0.12,-S*0.6); ctx.quadraticCurveTo(s*S*0.62,-S*0.72,s*S*0.56,-S*0.34); ctx.quadraticCurveTo(s*S*0.38,-S*0.52,s*S*0.12,-S*0.6); ctx.closePath(); ctx.fill() }
  // glowing slit eyes
  for (const s of [-1,1]) { ctx.save(); ctx.translate(s*S*0.34,-S*0.46); ctx.rotate(s*0.55)
    ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.ellipse(0,0,S*0.19,S*0.1,0,0,Math.PI*2); ctx.fill()
    ctx.fillStyle = '#3a0a00'; ctx.beginPath(); ctx.ellipse(0,0,S*0.06,S*0.1,0,0,Math.PI*2); ctx.fill(); ctx.restore() }
  // nostrils + mouth line
  ctx.fillStyle = '#2a0800'; for (const s of [-1,1]) { ctx.beginPath(); ctx.arc(s*S*0.13,-S*1.28,S*0.05,0,Math.PI*2); ctx.fill() }
  ctx.strokeStyle = 'rgba(40,10,5,0.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-S*0.42,-S*0.95); ctx.quadraticCurveTo(0,-S*0.72,S*0.42,-S*0.95); ctx.stroke()
  ctx.restore()
}

export function drawDragonBoss(ctx, e, camX, camY, S) {
  const ox = Math.round((e.px ?? (e.x * S + S / 2)) - camX), oy = Math.round((e.py ?? (e.y * S + S / 2)) - camY)
  const t = e.breathTime ?? 0
  const breath = 0.5 + 0.5*Math.sin(t*1.4)
  const bw = 3*S*(1 + breath*0.02), bh = 4*S*(1 + breath*0.02)

  ctx.save()
  ctx.translate(ox, oy)
  ctx.rotate((e.facing ?? 0) + Math.PI/2)        // local "up" (head, -y) -> facing direction

  const shoulderY = -bh*0.22
  // feet first — the very bottom layer (claws peek out from under the body)
  foot(ctx, -bw*0.40, -bh*0.16, -1, t, S); foot(ctx, bw*0.40, -bh*0.16, 1, t, S)
  foot(ctx, -bw*0.38,  bh*0.22, -1, t+1, S); foot(ctx, bw*0.38,  bh*0.22, 1, t+1, S)

  // tail (scaled)
  const sweep = e.tailSwing ?? 0
  scaledChain(ctx, 0, bh*0.46, Math.PI/2, 7, S*0.8, i => (7-i)/7*S*1.2 + 4,
              i => Math.sin(t*2.2 - i*0.7)*0.18 + sweep*(i+1)/7*0.45, 0.95)

  // neck (scaled) drawn BELOW the body so the body overlaps its base
  const rear = e.neckRear ?? 0
  const aim = (e.state === 'sweep') ? (e.headAim ?? 0) : 0
  const tip = scaledChain(ctx, 0, -bh*0.46, -Math.PI/2, 5, S*0.7, i => S*0.95 - i*S*0.07,
    i => {
      const idle = Math.sin(t*0.9 - i*0.6)*0.22
      const rearBend = rear * (i < 2 ? 0.55 : -0.65)
      const aimBend = (i === 4 ? aim*0.9 : aim*0.15)
      return idle*(1 - rear*0.6) + rearBend + aimBend
    }, 1.0)

  scaleBody(ctx, bw, bh, S)

  // head + breath on top of the body
  if (e.state === 'cone' || e.state === 'sweep') flameCone(ctx, tip.x, tip.y, tip.ang, S)
  head(ctx, tip, S)

  // wings last — the top layer, over the body
  wing(ctx, -bw*0.12, shoulderY, -1, t, S); wing(ctx, bw*0.12, shoulderY, 1, t, S)

  ctx.restore()
}
