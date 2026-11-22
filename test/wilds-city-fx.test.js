// Kalevanlinna's light and small life (wilds/city/fx.js, drawn by
// render/city-fx.js): the street lamps lit along the lamplighter's round and
// out at dawn (light sources for the night wash, the lamp tile swapped in the
// baked layer), windows lit where someone is home, chimney smoke and the
// birds kept to what is on screen. The window is built by session.js as in
// the game; buildEntities and the hooks stand in for game.js's.
//
// Entities are compared by identity with assert.ok(a === b), never with
// assert.equal(a, b): a failing strict equal makes Node diff both sides, and a
// city npc's ai.goals reaches the whole city.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arriveCity, tickCity, occupantsOf, struckIndoors } from '../renderer/wilds/city/runtime.js'
import { thingsOf } from '../renderer/wilds/city/scene-things.js'
import { DAY } from '../renderer/wilds/city/schedule.js'
import { PROPS } from '../renderer/wilds/city/kit.js'
import { cityFor } from '../renderer/wilds/city/build.js'
import { cityCtx, CITY_OX as OX, CITY_OY as OY } from '../renderer/wilds/city/walkers.js'
import { makeWorld } from '../renderer/wilds/world.js'
import { enterWilds } from '../renderer/wilds/session.js'
import { toWindow } from '../renderer/wilds/window.js'
import { PIECE } from '../renderer/wilds/layout.js'
import { lightSources } from '../renderer/systems/weather.js'
import { takeDirtyTiles } from '../renderer/systems/tile-dirty.js'
import { makeNpc, updateNpc } from '../renderer/systems/npc.js'
import * as feedback from '../renderer/systems/feedback.js'
import { DAY_LENGTH } from '../renderer/data/weather.js'

const SEED = 7
const S = 32
const DT = 0.1
const buildEntities = spawns => spawns.flatMap(s => {
  if (s.kind === 'npc') { const n = makeNpc(s); if (n && s.lines) n.lines = s.lines; return n ? [n] : [] }
  return [{ type: s.kind, x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16 }]
})
const freshState = () => ({
  player: { x: 0, y: 0, px: 0, py: 0, hp: 5, maxHp: 5, facing: 'south' }, entities: [], projectiles: [], zones: [],
  fireZones: [], lightning: [], strikes: [], shockwaves: [], arcs: [], hitEffects: [], feedback: feedback.makeFeedback(),
  caveInstances: {}, sfx: { cues: [], muted: false },
})
// on market street north of the square, 38 tiles from the fountain: lamps,
// chimneys and windows in view, and too far off for the lamplighter's round
const STREET = { X: 80 + OX, Y: 36 + OY }
const FOUNTAIN = { X: 79 + OX, Y: 74 + OY }
const VIEW = { w: 16, h: 11 }

function setup({ at = STREET, frac = 0.5, day = 0, view = VIEW } = {}) {
  const world = makeWorld(null, { seed: SEED })
  const state = freshState()
  enterWilds(state, world, at, { buildEntities })
  const T = { clock: frac * DAY_LENGTH, day, view }
  const hooks = {
    spawn: spawns => buildEntities(spawns), clock: () => T.clock, day: () => T.day, viewHalf: () => T.view,
    sfx: () => {}, hurt: () => {},
  }
  arriveCity(state, world, hooks, { fresh: true })
  return { world, state, hooks, T }
}
function run(ctx, seconds, { each = null, npcs = false } = {}) {
  const { state, world, hooks, T } = ctx
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    T.clock = (T.clock + DT) % DAY_LENGTH
    tickCity(state, world, DT, hooks)
    if (npcs) for (const e of [...state.entities]) if (e.type === 'npc') updateNpc(e, state, DT)
    state.sfx.cues = []
    if (each && each(t) === false) return true
  }
  return false
}
const frac = ctx => ctx.T.clock / DAY_LENGTH
const winOf = (ctx, X, Y) => toWindow(ctx.world.origin, X, Y)
const playerW = ctx => ({ X: ctx.state.player.x + ctx.world.origin.wx * PIECE, Y: ctx.state.player.y + ctx.world.origin.wy * PIECE })
function placePlayer(ctx, X, Y) {
  const { x, y } = winOf(ctx, X, Y), p = ctx.state.player
  p.x = x; p.y = y; p.px = x * S + 16; p.py = y * S + 16
}
// on screen: within the visible half-width and half-height of the player (tiles)
const onScreen = (ctx, X, Y, m = 0) => {
  const P = playerW(ctx), v = ctx.T.view
  return Math.abs(X - P.X) <= v.w + m && Math.abs(Y - P.Y) <= v.h + m
}
// a city light source (lightSources) at a window pixel, of radius r
const lightAt = (state, px, py, r) => lightSources(state).find(l => Math.abs(l.px - px) < 17 && Math.abs(l.py - py) < 17 && l.r === r) ?? null
const lampPx = (ctx, l) => { const { x, y } = winOf(ctx, l.x + OX, l.y + OY); return { x, y, px: x * S + 20, py: y * S + 10 } }

test('lamps light in the lamplighter\'s order after dusk and go out at dawn', () => {
  const ctx = setup({ frac: DAY.dusk - 0.04 })
  const { state } = ctx
  const city = cityFor(SEED), things = thingsOf(cityCtx(city, SEED))
  const lit = state.cityRun.lights.lit
  const inView = city.lamps.map((l, i) => i).filter(i => onScreen(ctx, city.lamps[i].x + OX, city.lamps[i].y + OY))
  assert.ok(inView.length >= 3, `lamps on screen (${inView.length})`)
  takeDirtyTiles(state.map)
  // what the screen shows of every lamp follows run.lights: the baked tile,
  // and a light for the night wash (r 3) for the ones on screen
  const shows = (stage) => {
    const dirty = new Set()
    const d = takeDirtyTiles(state.map)
    for (let k = 0; d && k < d.length; k += 2) dirty.add(`${d[k]},${d[k + 1]}`)
    city.lamps.forEach((l, i) => {
      const { x, y, px, py } = lampPx(ctx, l)
      const cell = state.map[y]?.[x]
      if (!cell) return
      assert.equal(cell.overlay, lit[i] ? PROPS.lampLit : PROPS.lamp, `${stage}: lamp ${i}'s tile`)
      if (!inView.includes(i)) return
      const light = lightAt(state, px, py, 3)
      assert.equal(!!light, lit[i] === 1, `${stage}: lamp ${i} ${lit[i] ? 'gives' : 'gives no'} light`)
      if (light) assert.ok(light.grey === false && light.strength > 0.5, 'a warm lamp light')
    })
    return dirty
  }
  assert.ok(lit.every(v => v === 0), 'all out before dusk')
  shows('before dusk')
  // through the dusk round: each lamp is lit once, in the round's order (out
  // from the fountain), and its tile is swapped (and marked to be baked again)
  const order = []
  const was = Uint8Array.from(lit)
  run(ctx, (DAY.night - DAY.dusk + 0.06) * DAY_LENGTH, { each: () => {
    const dirty = shows(`frac ${frac(ctx).toFixed(3)}`)
    const now = []
    lit.forEach((v, i) => {
      if (v === was[i]) return
      assert.equal(v, 1, `lamp ${i} only lit at dusk`)
      was[i] = v
      now.push(things.rank[i])
      const { x, y } = lampPx(ctx, city.lamps[i])
      if (state.map[y]?.[x]) assert.ok(dirty.has(`${x},${y}`), `lamp ${i}'s cell baked again`)
    })
    order.push(...now.sort((a, b) => a - b))   // several at one look of the clock: in the round's order
  } })
  assert.equal(order.length, city.lamps.length, 'every lamp lit')
  for (let k = 1; k < order.length; k++) assert.ok(order[k] >= order[k - 1], `lit in the round's order (${order.join(' ')})`)
  // at night: lit lamps on screen light the dark
  assert.ok(inView.every(i => lightAt(state, lampPx(ctx, city.lamps[i]).px, lampPx(ctx, city.lamps[i]).py, 3)), 'every lamp on screen glows')
  // through the dawn round they go out in the same order
  ctx.T.clock = (DAY.dawn - 0.02) * DAY_LENGTH
  const out = []
  run(ctx, 0.1 * DAY_LENGTH, { each: () => {
    shows(`frac ${frac(ctx).toFixed(3)}`)
    const now = []
    lit.forEach((v, i) => { if (v !== was[i]) { assert.equal(v, 0, `lamp ${i} only put out at dawn`); was[i] = v; now.push(things.rank[i]) } })
    out.push(...now.sort((a, b) => a - b))
  } })
  assert.equal(out.length, city.lamps.length, 'every lamp out by morning')
  for (let k = 1; k < out.length; k++) assert.ok(out[k] >= out[k - 1], 'out in the round\'s order')
  assert.equal(lightSources(state).filter(l => l.r === 3).length, 0, 'no lamp light by day')
})

test('the lamplighter lights the lamps round the square himself, and the screen follows', () => {
  const ctx = setup({ at: FOUNTAIN, frac: DAY.dusk - 0.025 })
  const { state } = ctx
  const city = cityFor(SEED), lit = state.cityRun.lights.lit
  let byHand = 0
  run(ctx, 0.1 * DAY_LENGTH, { npcs: true, each: () => {
    const sc = state.cityRun.scenes.find(s => s.id === 'lamps' && !s.done)
    if (sc) byHand = Math.max(byHand, sc.lit)
    city.lamps.forEach((l, i) => {
      const { x, y, px, py } = lampPx(ctx, l)
      if (!state.map[y]?.[x]) return
      assert.equal(state.map[y][x].overlay, lit[i] ? PROPS.lampLit : PROPS.lamp, `lamp ${i}'s tile follows run.lights`)
      if (onScreen(ctx, l.x + OX, l.y + OY)) assert.equal(!!lightAt(state, px, py, 3), lit[i] === 1, `lamp ${i}'s light follows run.lights`)
    })
  } })
  assert.ok(byHand >= 1, `the lamplighter lit lamps by hand (${byHand})`)
})

test('a window glows only while someone is home at night', () => {
  const ctx = setup({ frac: 0.9 })
  const { state } = ctx
  run(ctx, 1)
  const city = cityFor(SEED)
  // the windows on screen, by the door they belong to
  const doors = new Map()
  for (const w of city.windows) {
    if (!onScreen(ctx, w.x + OX, w.y + OY, -1)) continue
    if (!doors.has(w.door)) doors.set(w.door, [])
    doors.get(w.door).push(w)
  }
  const glows = w => { const { x, y } = winOf(ctx, w.x + OX, w.y + OY); return !!lightSources(state).find(l => l.r === 1.5 && Math.abs(l.px - (x * S + 16)) <= 1.5 * S && Math.abs(l.py - (y * S + 16)) < 1) }
  const home = [...doors.keys()].filter(d => occupantsOf(state, d).length)
  const empty = [...doors.keys()].filter(d => !occupantsOf(state, d).length)
  assert.ok(home.length >= 2, `houses with someone home on screen (${home.length})`)
  for (const d of home) assert.ok(doors.get(d).every(glows), `${d}: someone is home, its windows glow`)
  for (const d of empty) assert.ok(!doors.get(d).some(glows), `${d}: nobody home, dark`)
  // they go out (struck down: out of the house until the next day): dark
  const d = home[0]
  for (const p of occupantsOf(state, d)) struckIndoors(state, p.id)
  run(ctx, 0.2)
  assert.ok(!doors.get(d).some(glows), 'nobody home now: dark')
  assert.ok(doors.get(home[1]).every(glows), 'the neighbours are still in')
  // by day nobody lights a window, home or not
  ctx.T.clock = 0.5 * DAY_LENGTH
  run(ctx, 0.2)
  assert.ok(home.slice(1).every(h => !doors.get(h).some(glows)), 'no window glows by day')
  assert.equal(lightSources(state).filter(l => l.r === 1.5).length, 0, 'no window light by day')
})

test('smoke and flocks are culled to the view', async () => {
  const fx = await import('../renderer/wilds/city/fx.js')
  const ctx = setup({ frac: 0.93 })   // night: most are home
  const { state } = ctx
  const city = cityFor(SEED)
  const smoke = () => state.cityRun.fx.smoke
  run(ctx, 4)
  assert.ok(smoke().length > 0, 'smoke from the chimneys on screen')
  const perChimney = new Map()
  for (const p of smoke()) {
    const c = city.chimneys[p.c]
    assert.ok(c && onScreen(ctx, c.x + OX, c.y + OY, 1), `a puff from chimney ${p.c}, on screen (a cell at its edge counts)`)
    assert.ok(occupantsOf(state, c.door).length, 'and someone is home under it')
    perChimney.set(p.c, (perChimney.get(p.c) ?? 0) + 1)
  }
  for (const [c, n] of perChimney) assert.ok(n <= Math.ceil(fx.PUFF_LIFE / fx.PUFF_EVERY), `chimney ${c}: ${n} puffs, no more than one per ${fx.PUFF_EVERY} s`)
  // emitted no faster than one puff a chimney per PUFF_EVERY (a puff's age
  // says when it was let out: one already up when its chimney came on screen
  // was let out before, at the same pace)
  const born = new Map()
  run(ctx, 3, { each: () => { for (const p of smoke()) if (!born.has(p)) born.set(p, ctx.T.clock - p.t) } })
  const byChimney = new Map()
  for (const [p, t] of born) { if (!byChimney.has(p.c)) byChimney.set(p.c, []); byChimney.get(p.c).push(t) }
  for (const [c, ts] of byChimney) {
    ts.sort((a, b) => a - b)
    for (let k = 1; k < ts.length; k++) if (ts[k] - ts[k - 1] > 1e-6) assert.ok(ts[k] - ts[k - 1] >= fx.PUFF_EVERY - 1e-6, `chimney ${c} puffs ${(ts[k] - ts[k - 1]).toFixed(2)} s apart`)
  }
  // walk 40 tiles south: the smoke behind is gone, only what is now on screen smokes
  placePlayer(ctx, STREET.X + 40, STREET.Y + 38)
  run(ctx, 1)
  assert.ok(smoke().length > 0, 'smoke where the player is now')
  for (const p of smoke()) assert.ok(onScreen(ctx, city.chimneys[p.c].x + OX, city.chimneys[p.c].y + OY, 1), 'smoke only on screen')
  // the birds: a list of sprites for the flocks on screen, none for the rest
  const run_ = state.cityRun
  const pigeons = run_.fx.flocks[0], gulls = run_.fx.flocks.filter(f => f.kind === 'gull')
  assert.ok(pigeons.kind !== 'gull' && gulls.length >= 1, 'pigeons on the square, gulls at the harbour')
  const viewOn = f => ({ X0: f.X - VIEW.w, X1: f.X + VIEW.w, Y0: f.Y - VIEW.h, Y1: f.Y + VIEW.h })
  for (const f of [pigeons, ...gulls]) {
    const birds = fx.flockSprites(run_, viewOn(f))
    assert.ok(birds.length >= f.birds, `${f.kind} drawn when on screen (${birds.length})`)
    const v = viewOn(f)
    assert.ok(birds.every(b => b.X >= v.X0 - 2 && b.X <= v.X1 + 2 && b.Y >= v.Y0 - 3 && b.Y <= v.Y1 + 2), 'within the view')
    assert.ok(birds.every(b => typeof b.name === 'string'), 'each a sprite')
    const away = { X0: f.X + 60, X1: f.X + 60 + 2 * VIEW.w, Y0: f.Y - VIEW.h, Y1: f.Y + VIEW.h }
    assert.ok(!fx.flockSprites(run_, away).some(b => Math.abs(b.X - f.X) < 4 && Math.abs(b.Y - f.Y) < 4), `${f.kind} not drawn off screen`)
  }
  assert.ok(!state.entities.some(e => e.species === 'pigeon' || e.species === 'gull'), 'birds are never entities')
})

test('a hit flash stays up a moment, then goes', () => {
  assert.equal(typeof feedback.ageHitEffects, 'function', 'hit flashes are aged, not wiped before they are drawn')
  const state = { hitEffects: [{ x: 3, y: 4 }] }
  feedback.ageHitEffects(state, 1 / 60)
  assert.equal(state.hitEffects.length, 1, 'there for the frame it was struck in, and drawn')
  feedback.ageHitEffects(state, feedback.HIT_LIFE / 2)
  assert.equal(state.hitEffects.length, 1, 'still there halfway')
  state.hitEffects.push({ x: 5, y: 5 })
  feedback.ageHitEffects(state, feedback.HIT_LIFE / 2)
  assert.ok(state.hitEffects.length === 1 && state.hitEffects[0].x === 5, 'the first gone after HIT_LIFE, the newer one kept')
  assert.ok(feedback.HIT_LIFE >= 0.1 && feedback.HIT_LIFE <= 0.25, `about 0.15 s (${feedback.HIT_LIFE})`)
})

// The drawing (render/city-fx.js) over a stub canvas: every pass runs with
// all the town's things about, and draws nothing off the screen.
test('the three passes draw the town\'s small life, only on screen', async () => {
  const { drawCityGround, drawCityAir, drawCityGlow } = await import('../renderer/render/city-fx.js')
  const { computePlayerFOV } = await import('../renderer/systems/entities.js')
  const ctx0 = setup({ at: FOUNTAIN, frac: 0.88 })
  const { state } = ctx0
  run(ctx0, 2)
  computePlayerFOV(state.map, state.player, 40, { los: false })
  const fx = state.cityRun.fx, P = playerW(ctx0)
  fx.carts.push(...['north', 'south', 'east', 'west'].map((dir, i) => ({ X: P.X - 3 + 2 * i, Y: P.Y + 2, dir, state: 'rolling', look: 'f1', by: null })))
  fx.turnips.push({ fromX: P.X, fromY: P.Y, toX: P.X + 2, toY: P.Y, t: 0.3 })
  fx.splats.push({ X: P.X + 1, Y: P.Y, t: 0.1 })
  fx.sparks.push({ X: P.X, Y: P.Y, vx: 0, vy: 0, t: 0.1 })
  fx.steam.push({ X: P.X, Y: P.Y, t: 0.2, dx: 0 })
  fx.smoke.push({ c: 0, X: P.X, Y: P.Y, t: 0.5, dx: 0.1 })
  fx.busker = { X: P.X - 1, Y: P.Y, playing: true, by: null }
  fx.crier = { X: P.X + 1, Y: P.Y, rings: 1, ringing: true, by: null }; fx.ringAt = fx.t
  fx.bell = true
  const W = 1024, H = 693
  const camX = state.player.px - W / 2, camY = state.player.py - H / 2
  const drawn = []
  const ctx = new Proxy({ globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '', lineWidth: 1 }, {
    get(t, k) {
      if (k in t) return t[k]
      if (k === 'drawImage') return (img, x, y) => drawn.push({ img, x, y })
      if (k === 'fillRect') return (x, y) => drawn.push({ img: 'rect', x, y })
      return () => {}
    },
    set(t, k, v) { t[k] = v; return true },
  })
  const img = {}
  const sprites = new Proxy({}, { get: (_, k) => typeof k === 'string' ? (img[k] ??= { name: k }) : undefined })
  drawCityGround(ctx, state, sprites, camX, camY, S, W, H)
  drawCityAir(ctx, state, sprites, camX, camY, S, W, H)
  drawCityGlow(ctx, state, sprites, { dark: 0.8 }, camX, camY, S)
  const names = new Set(drawn.map(d => d.img.name ?? d.img))
  for (const n of ['fx_city_cart_n_0', 'fx_city_cart_s_1', 'ow_prop_city_cart', 'tf_f1', 'ow_deco_city_turnip', 'fx_city_splat', 'fx_city_spark', 'fx_city_steam_0', 'fx_city_note_0', 'fx_city_handbell', 'tf_pigeon_a']) {
    assert.ok(names.has(n), `${n} drawn`)
  }
  assert.ok(drawn.every(d => d.x > -2 * S && d.x < W + S && d.y > -2 * S && d.y < H + S), 'nothing drawn off the screen')
  // and nothing when the town is not about (in a house, say)
  drawn.length = 0
  const inside = { ...state, cityRun: undefined }
  drawCityGround(ctx, inside, sprites, camX, camY, S, W, H); drawCityAir(ctx, inside, sprites, camX, camY, S, W, H); drawCityGlow(ctx, inside, sprites, { dark: 0.8 }, camX, camY, S)
  assert.equal(drawn.length, 0)
})
