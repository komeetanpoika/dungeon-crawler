// Kalevanlinna's light and small life on screen: the only drawing code for
// it. Everything is read from the city run (wilds/city/scenes.js and fx.js
// keep it as data in world tiles) and drawn only where it is on screen; the
// baked tile layer is never drawn again here (the lamp and washing tiles are
// swapped in it by fx.js; what moves was taken off it and is drawn here).
// Three passes, by where they sit among the rest of the frame (canvas.js):
//   drawCityGround  with the floor, under the people: the banners, pennants
//                   and windmill sails (what was baked under them before),
//                   the birds on the ground, the horse and cart with its carter
//   drawCityAir     after the people, before the night wash: smoke and steam,
//                   birds in the air, turnips flying and bursting, the
//                   busker's notes, the crier's bell, the church bell ringing
//   drawCityGlow    after the night wash, as the flames are, so light stays
//                   bright in the dark: lit window panes, sparks off the anvil
// Animation runs on the town's own time (run.fx.t), which stops with it.
import { FX, PROPS } from '../wilds/city/kit.js'
import { fxThingsOf, flockSprites, PUFF_LIFE, PUFF_RISE, STEAM_LIFE, STEAM_RISE, SPARK_LIFE, SPLAT_LIFE } from '../wilds/city/fx.js'
import { TURNIP_FLIGHT } from '../wilds/city/scene-things.js'
import { CITY_OX as OX, CITY_OY as OY } from '../wilds/city/walkers.js'

const SAIL_STEP = 0.22          // s a sixteenth of a turn of the sails
const BANNER_STEP = 0.7, PENNANT_STEP = 0.45
const BIRDS = []                // the frame's bird sprites, kept between the passes
const SCREEN = { X0: 0, Y0: 0, X1: 0, Y1: 0 }

// world tiles on screen (whole numbers at a cell's middle), a cell of slack
function viewOf(run, camX, camY, S, W, H) {
  const v = SCREEN
  v.X0 = camX / S + run.ox - 1; v.X1 = (camX + W) / S + run.ox
  v.Y0 = camY / S + run.oy - 1; v.Y1 = (camY + H) / S + run.oy
  return v
}
const on = (v, X, Y, m = 0) => X >= v.X0 - m && X <= v.X1 + m && Y >= v.Y0 - m && Y <= v.Y1 + m
const cellAt = (state, run, X, Y) => state.map[Math.round(Y) - run.oy]?.[Math.round(X) - run.ox]
const seen = (state, run, X, Y) => !!cellAt(state, run, X, Y)?.visible
// the screen pixel of a world tile's top left corner
const sx = (run, X, camX, S) => Math.round((X - run.ox) * S - camX)
const sy = (run, Y, camY, S) => Math.round((Y - run.oy) * S - camY)

function blit(ctx, img, x, y, S, flip = false) {
  if (!img) return
  if (!flip) { ctx.drawImage(img, x, y, S, S); return }
  ctx.save(); ctx.translate(x + S, y); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, S, S); ctx.restore()
}

export function drawCityGround(ctx, state, sprites, camX, camY, S, W, H) {
  const run = state.cityRun
  if (!run?.fx || !state.map) return
  const v = viewOf(run, camX, camY, S, W, H), t = run.fx.t
  const fog = state.theme?.fogAlpha ?? 0.65
  // what turns and stirs on the castle, the gate towers and the mill
  for (const a of fxThingsOf(run.cc.city).anim) {
    if (!on(v, a.X, a.Y)) continue
    const cell = cellAt(state, run, a.X, a.Y)
    if (!cell?.explored) continue
    const f = a.kind === 'sails' ? Math.floor(t / SAIL_STEP) % 4
      : (Math.floor(t / (a.kind === 'banner' ? BANNER_STEP : PENNANT_STEP) + (a.X * 7 + a.Y * 3) % 5 * 0.37) + a.k) % 2
    const img = sprites[a.frames[f]]
    if (!img) continue
    if (cell.visible) ctx.drawImage(img, sx(run, a.X, camX, S), sy(run, a.Y, camY, S), S, S)
    else { ctx.globalAlpha = 1 - fog; ctx.drawImage(img, sx(run, a.X, camX, S), sy(run, a.Y, camY, S), S, S); ctx.globalAlpha = 1 }
  }
  // the birds: those on the ground now, the rest after the people
  flockSprites(run, v, BIRDS)
  for (const b of BIRDS) {
    if (b.alt > 0.05 || !seen(state, run, b.X, b.Y)) continue
    blit(ctx, sprites[b.name], sx(run, b.X, camX, S), sy(run, b.Y - b.alt, camY, S), S, b.flip)
  }
  for (const k of run.fx.carts) drawCart(ctx, state, run, k, sprites, v, camX, camY, S, t)
}

// The horse and cart, the horse a cell ahead of the cart, the carter on the
// box in his own look. Side on going east or west (PROPS.cart, the horse to
// the west: flipped going east), from behind or the front going north or south.
function drawCart(ctx, state, run, k, sprites, v, camX, camY, S, t) {
  if (!on(v, k.X, k.Y, 2) || !seen(state, run, k.X, k.Y)) return
  const bob = k.state === 'rolling' && Math.floor(t * 7) % 2 ? 1 : 0
  const x = sx(run, k.X, camX, S), y = sy(run, k.Y, camY, S) - bob
  const carter = k.look ? sprites[`tf_${k.look}`] : null
  const u = S / 16
  if (k.dir === 'west' || k.dir === 'east') {
    const east = k.dir === 'east'
    blit(ctx, carter, x + (east ? 4 : -4) * u, y - 8 * u, S, !east)
    blit(ctx, sprites[PROPS.cart[1]], x, y, S, east)
    blit(ctx, sprites[PROPS.cart[0]], x + (east ? S : -S), y + bob, S, east)
  } else if (k.dir === 'south') {
    blit(ctx, sprites[FX.cartS[1]], x, y + S + bob, S)
    blit(ctx, sprites[FX.cartS[0]], x, y, S)
    blit(ctx, carter, x, y - 5 * u, S)
  } else {
    blit(ctx, sprites[FX.cartN[0]], x, y - S + bob, S)
    blit(ctx, carter, x, y - 8 * u, S)
    blit(ctx, sprites[FX.cartN[1]], x, y, S)
  }
}

export function drawCityAir(ctx, state, sprites, camX, camY, S, W, H) {
  const run = state.cityRun
  if (!run?.fx || !state.map) return
  const fx = run.fx, t = fx.t, v = viewOf(run, camX, camY, S, W, H)
  const half = S / 2
  // smoke, rising and drifting off with the wind, growing and thinning
  for (const p of fx.smoke) {
    if (!cellAt(state, run, p.X, p.Y + 0.4)?.explored) continue   // its chimney not yet seen
    const k = p.t / PUFF_LIFE
    const X = p.X + p.dx * p.t + 0.08 * Math.sin(p.t * 2.2 + p.c), Y = p.Y - PUFF_RISE * p.t
    if (!on(v, X, Y)) continue
    ctx.globalAlpha = 0.8 * (1 - k * k)
    ctx.drawImage(sprites[FX.smoke[k < 0.3 ? 0 : k < 0.62 ? 1 : 2]] ?? sprites[FX.smoke[0]], sx(run, X, camX, S), sy(run, Y, camY, S), S, S)
  }
  for (const p of fx.steam) {
    const k = p.t / STEAM_LIFE
    const X = p.X + p.dx * p.t, Y = p.Y - STEAM_RISE * p.t
    if (!on(v, X, Y)) continue
    ctx.globalAlpha = 0.85 * (1 - k)
    ctx.drawImage(sprites[FX.steam[k < 0.4 ? 0 : 1]], sx(run, X, camX, S), sy(run, Y, camY, S), S, S)
  }
  ctx.globalAlpha = 1
  // birds in the air, a small shadow under each
  ctx.fillStyle = 'rgba(30, 30, 40, 0.22)'
  for (const b of BIRDS) {
    if (b.alt <= 0.05 || !seen(state, run, b.X, b.Y)) continue
    ctx.fillRect(sx(run, b.X, camX, S) + half - 4, sy(run, b.Y, camY, S) + S - 6, 8, 3)
  }
  for (const b of BIRDS) {
    if (b.alt <= 0.05 || !seen(state, run, b.X, b.Y)) continue
    blit(ctx, sprites[b.name], sx(run, b.X, camX, S), sy(run, b.Y - b.alt, camY, S), S, b.flip)
  }
  // turnips thrown at the stocks: a short arc, then a splat
  for (const k of fx.turnips) {
    const u = Math.min(1, k.t / TURNIP_FLIGHT)
    const X = k.fromX + (k.toX - k.fromX) * u, Y = k.fromY + (k.toY - k.fromY) * u - 1.2 * 4 * u * (1 - u)
    if (on(v, X, Y)) ctx.drawImage(sprites[PROPS.turnip], sx(run, X, camX, S), sy(run, Y - 0.25, camY, S), S, S)
  }
  for (const s of fx.splats) {
    if (!on(v, s.X, s.Y)) continue
    ctx.globalAlpha = Math.min(1, 2 * (1 - s.t / SPLAT_LIFE))
    ctx.drawImage(sprites[FX.splat], sx(run, s.X, camX, S), sy(run, s.Y, camY, S), S, S)
  }
  ctx.globalAlpha = 1
  // the busker's tune: notes rising off him while he plays
  const bk = fx.busker
  if (bk?.playing && on(v, bk.X, bk.Y, 1) && seen(state, run, bk.X, bk.Y)) {
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.6 + i / 3) % 1
      ctx.globalAlpha = Math.min(1, 3 * (1 - k))
      const X = bk.X + 0.3 + 0.25 * Math.sin((t + i) * 3) + 0.3 * k, Y = bk.Y - 0.8 - 1.1 * k
      ctx.drawImage(sprites[FX.note[i & 1]], sx(run, X, camX, S), sy(run, Y, camY, S), S, S)
    }
    ctx.globalAlpha = 1
  }
  // the crier's hand bell, swung at each ring
  const cr = fx.crier
  if (cr && t - fx.ringAt < 0.9) {
    const w = run.people.get(cr.by)?.entity
    const px = w ? w.px - camX : sx(run, cr.X, camX, S) + half, py = w ? w.py - camY : sy(run, cr.Y, camY, S) + half
    const img = sprites[FX.handbell]
    if (img && seen(state, run, cr.X, cr.Y)) {
      ctx.save()
      ctx.translate(Math.round(px + 0.35 * S), Math.round(py - 0.45 * S))
      ctx.rotate(0.7 * Math.sin((t - fx.ringAt) * 14))
      ctx.drawImage(img, -half, -0.25 * S, S, S)
      ctx.restore()
    }
  }
  // the church bell ringing: its sound in lines either side of the belfry
  const bell = run.cc.city.spots.bell
  if (fx.bell && bell) {
    const X = bell.x + OX, Y = bell.y + OY
    if (on(v, X, Y, 2) && cellAt(state, run, X, Y)?.explored) {
      const x = sx(run, X, camX, S) + half, y = sy(run, Y, camY, S) + half
      ctx.strokeStyle = 'rgba(63, 38, 49, 0.75)'
      ctx.lineWidth = 2
      for (let i = 0; i < 2; i++) {
        const r = 0.7 * S + ((t * 1.5 + i / 2) % 1) * 0.6 * S
        ctx.globalAlpha = 1 - ((t * 1.5 + i / 2) % 1)
        ctx.beginPath(); ctx.arc(x, y, r, -0.5, 0.5); ctx.stroke()
        ctx.beginPath(); ctx.arc(x, y, r, Math.PI - 0.5, Math.PI + 0.5); ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
  }
}

// After the night wash: lit window panes (where someone is home, fx.js keeps
// the runs on screen) and the sparks off the anvil.
export function drawCityGlow(ctx, state, sprites, look, camX, camY, S) {
  const run = state.cityRun
  if (!run?.fx || !state.map) return
  const dark = look?.dark ?? 0
  const wins = run.lights.windows
  if (dark > 0.05 && wins.length) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = `rgba(255, 176, 72, ${(0.6 * Math.min(1, dark / 0.5)).toFixed(3)})`
    const u = S / 16
    for (const r of wins) {
      const y = sy(run, r.Y, camY, S) + 4 * u
      for (const X of r.cells) if (cellAt(state, run, X, r.Y)?.explored) ctx.fillRect(sx(run, X, camX, S) + 5 * u, y, 7 * u, 9 * u)
    }
    ctx.restore()
  }
  const img = sprites[FX.spark]
  if (img && run.fx.sparks.length) {
    for (const s of run.fx.sparks) {
      ctx.globalAlpha = Math.max(0, 1 - s.t / SPARK_LIFE)
      ctx.drawImage(img, sx(run, s.X, camX, S), sy(run, s.Y, camY, S), S, S)
    }
    ctx.globalAlpha = 1
  }
}
