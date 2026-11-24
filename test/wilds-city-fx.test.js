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
import { PROPS, CASTLE } from '../renderer/wilds/city/kit.js'
import { gateShut, isShutGate } from '../renderer/wilds/city/fx.js'
import { PLAN } from '../renderer/wilds/city/plan.js'
import { TILE, isWalkable } from '../renderer/systems/entities.js'
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

// a world whose market street has people living along it (whose houses are
// home to anyone at night is the town's roll, folk.js)
const SEED = 1
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
})

// A pennant on a tower's cap stands on a cell that is walked under
// (wilds/over.js): it is drawn with that cell's art, over the people.
test('what flies from a walked-under cell is drawn over the people, the rest under them', async () => {
  const { drawCityGround, drawCityOver } = await import('../renderer/render/city-fx.js')
  const { computePlayerFOV } = await import('../renderer/systems/entities.js')
  const ctx0 = setup({ at: { X: 80 + OX, Y: 26 + OY }, frac: 0.5 })   // just inside the north gate
  const { state } = ctx0
  run(ctx0, 1)
  computePlayerFOV(state.map, state.player, 40, { los: false })
  const W = 1024, H = 693
  const camX = state.player.px - W / 2, camY = state.player.py - H / 2
  const record = () => {
    const drawn = []
    const ctx = new Proxy({ globalAlpha: 1 }, {
      get(t, k) { if (k in t) return t[k]; return k === 'drawImage' ? (img, x, y) => drawn.push({ name: img.name, cell: state.map[Math.round((y + camY) / S)]?.[Math.round((x + camX) / S)] }) : () => {} },
      set(t, k, v) { t[k] = v; return true },
    })
    return { ctx, drawn }
  }
  const img = {}
  const sprites = new Proxy({}, { get: (_, k) => typeof k === 'string' ? (img[k] ??= { name: k }) : undefined })
  const ground = record(), over = record()
  drawCityGround(ground.ctx, state, sprites, camX, camY, S, W, H)
  drawCityOver(over.ctx, state, sprites, camX, camY, S, W, H)
  const flags = d => CASTLE.pennant.includes(d.name) || CASTLE.banner.includes(d.name)
  assert.ok(over.drawn.length >= 2, `the gate towers' pennants: ${over.drawn.length}`)
  assert.ok(over.drawn.every(d => flags(d) && d.cell?.over === true), 'only what stands on a walked-under cell')
  assert.ok(ground.drawn.filter(flags).every(d => !d.cell?.over), 'and none of those under the people')
})

// Indoors the game's state is the cave state, which carries the surface's
// city run along (systems/cave.js copies the surface) on the house's own map:
// nothing of the street may be drawn over it, lit in it, or swapped in it.
test('in a house or a cave, the street is neither drawn, lit nor laid on its map', async () => {
  const { drawCityGround, drawCityAir, drawCityGlow } = await import('../renderer/render/city-fx.js')
  const { tickCityFx } = await import('../renderer/wilds/city/fx.js')
  const { buildCaveState } = await import('../renderer/systems/cave.js')
  const { TILE } = await import('../renderer/systems/entities.js')
  // the window centred on piece (1,3): its origin is the city's, so window
  // tiles are city tiles and a 160-cell map has every lamp, line and banner on it
  const ctx0 = setup({ at: { X: 96 + OX, Y: 110 + OY }, frac: 0.9 })
  const { state, world } = ctx0
  assert.ok(world.origin.wx * PIECE === OX && world.origin.wy * PIECE === OY, 'window tiles are city tiles')
  run(ctx0, 2)
  const r = state.cityRun, city = cityFor(SEED)
  assert.ok(r.lights.lit.some(v => v) && r.fx.washing.some(l => l.state === 'in'), 'lamps lit, washing in')
  r.fx.sparks.push({ X: 96 + OX, Y: 110 + OY, vx: 0, vy: 0, t: 0.1 })
  r.fx.smoke.push({ c: 0, X: 96 + OX, Y: 110 + OY, t: 0.5, dx: 0 })
  // a house's map as big as the city, seen all over, carrying on each cell where
  // the street keeps a lamp, a line or a banner the very tile the street would swap
  const map = Array.from({ length: 160 }, () => Array.from({ length: 160 }, () => ({ tile: TILE.FLOOR, explored: true, visible: true })))
  city.lamps.forEach(l => { map[l.y][l.x].overlay = PROPS.lamp })
  for (const l of r.fx.washing) { map[l.Y - OY][l.X - OX].overlay = PROPS.washing[0]; map[l.Y - OY][l.X - OX + 1].overlay = PROPS.washing[1] }
  const { fxThingsOf } = await import('../renderer/wilds/city/fx.js')
  for (const a of fxThingsOf(city).anim) map[a.Y - OY][a.X - OX].overlay = a.frames[0]
  const before = map.map(row => row.map(c => c.overlay ?? null))
  const cave = buildCaveState(state, { x: 96, y: 110, caveDepth: 19, label: 'house:city:test' },
    { map, entities: [], playerSpawn: { x: 96, y: 112 }, theme: { bgColor: '#000', fogAlpha: 0.65 } })
  assert.ok(cave.cityRun === r && cave.cave && cave.map === map, 'the run went along indoors, on the house\'s map')
  takeDirtyTiles(map)
  // the runtime's share leaves the house alone
  tickCityFx(cave, r, 0.1, OX, OY)
  assert.equal(takeDirtyTiles(map), null, 'no cell of the house marked to be baked again')
  assert.ok(map.every((row, y) => row.every((c, x) => (c.overlay ?? null) === before[y][x])), 'no tile of the house swapped')
  assert.ok(!lightSources(cave).some(l => l.r === 3 || l.r === 1.5 || l.r === 2.5), 'no street light indoors')
  // and nothing is drawn
  const drawn = []
  const ctx = new Proxy({ globalAlpha: 1 }, {
    get(t, k) { if (k in t) return t[k]; return k === 'drawImage' || k === 'fillRect' ? (...a) => drawn.push(a) : () => {} },
    set(t, k, v) { t[k] = v; return true },
  })
  const sprites = new Proxy({}, { get: (_, k) => ({ name: k }) })
  const camX = cave.player.px - 512, camY = cave.player.py - 346
  drawCityGround(ctx, cave, sprites, camX, camY, S, 1024, 693)
  drawCityAir(ctx, cave, sprites, camX, camY, S, 1024, 693)
  drawCityGlow(ctx, cave, sprites, { dark: 0.8 }, camX, camY, S)
  assert.equal(drawn.length, 0, 'nothing of the street drawn in the house')
  // back on the street, the same run draws again (the gate is the house, not the run)
  const { computePlayerFOV } = await import('../renderer/systems/entities.js')
  computePlayerFOV(state.map, state.player, 40, { los: false })
  drawCityGround(ctx, state, sprites, state.player.px - 512, state.player.py - 346, S, 1024, 693)
  drawCityAir(ctx, state, sprites, state.player.px - 512, state.player.py - 346, S, 1024, 693)
  drawCityGlow(ctx, state, sprites, { dark: 0.8 }, state.player.px - 512, state.player.py - 346, S)
  assert.ok(drawn.length > 0, 'the street draws on the street')
})

// The church bell's sound is drawn round the bell itself, up in the belfry,
// not round the spot at the tower's foot (seen live: the lines were on the
// grass four rows below the bell).
test('the church bell rings out from the belfry', async () => {
  const { drawCityAir } = await import('../renderer/render/city-fx.js')
  const { computePlayerFOV } = await import('../renderer/systems/entities.js')
  const steps = cityFor(SEED).spots['church-steps']
  const ctx0 = setup({ at: { X: steps.x + OX + 2, Y: steps.y + OY + 3 }, frac: DAY.bell })
  const { state } = ctx0
  run(ctx0, 0.5)
  computePlayerFOV(state.map, state.player, 40, { los: false })
  state.cityRun.fx.bell = true
  const W = 1024, H = 693
  const camX = state.player.px - W / 2, camY = state.player.py - H / 2
  const arcs = []
  const ctx = new Proxy({ globalAlpha: 1, strokeStyle: '', lineWidth: 1 }, {
    get(t, k) {
      if (k in t) return t[k]
      if (k === 'arc') return (x, y, r) => arcs.push({ x, y, r })
      return () => {}
    },
    set(t, k, v) { t[k] = v; return true },
  })
  drawCityAir(ctx, state, new Proxy({}, { get: (_, k) => ({ name: k }) }), camX, camY, S, W, H)
  assert.ok(arcs.length >= 4, `the bell's lines are drawn (${arcs.length})`)
  for (const a of arcs) {
    const cell = state.map[Math.floor((a.y + camY) / S)][Math.floor((a.x + camX) / S)]
    assert.match(cell.overlay ?? '', /church_belfry/, `round the belfry, not ${cell.overlay ?? cell.skin}`)
  }
})

// The night wash (render/weather.js) keeps a mask of the view and NIGHT_PAD
// px round it, built anew when a light it holds comes, goes or changes. The
// city's lights stand still at night, so walking must rebuild it only when
// the view leaves it: every lamp and window whose light reaches the mask has
// to be listed wherever in the mask the view is, or each one listed on the
// way changes the mask's key and the frame falls back to the costly wash
// (seen in the final review: lamps were listed one tile past the screen).
test('walking at night, the kept night mask is built anew only when the view leaves it', async t => {
  const { makeWeatherLayer, drawNight, NIGHT_PAD } = await import('../renderer/render/weather.js')
  const fx = await import('../renderer/wilds/city/fx.js')
  const W = 1024, H = 704
  const ctx = setup({ frac: 0.92, view: { w: W / (2 * S), h: H / (2 * S) } })
  const { state, world } = ctx
  const run_ = state.cityRun
  assert.ok(run_.lights.lit.every(v => v === 1), 'every lamp lit at night')
  // a canvas that only remembers what was drawn on it
  let drawn = []
  const fakeCanvas = () => {
    const c = { width: 0, height: 0 }
    const g = new Proxy({}, {
      get: (t, k) => k in t ? t[k] : k === 'drawImage' ? img => drawn.push(img) : k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {},
      set: (t, k, v) => { t[k] = v; return true },
    })
    c.getContext = () => g
    return c
  }
  const layer = makeWeatherLayer(fakeCanvas)
  layer.resize(W, H)
  const frame = fakeCanvas().getContext()
  const ox = world.origin.wx * PIECE, oy = world.origin.wy * PIECE
  // round a block of the town: south down market street to the square, east, north, west
  const p = state.player
  const legs = [[0, 1, 40], [1, 0, 30], [0, -1, 40], [-1, 0, 30]]
  let frames = 0, lit = 0, keyBuilds = 0, straight = 0, most = 0
  for (const [dx, dy, tiles] of legs) {
    for (let k = 0; k < tiles * S / 3; k++) {
      p.px += 3 * dx; p.py += 3 * dy
      p.x = Math.floor(p.px / S); p.y = Math.floor(p.py / S)
      fx.tickCityFx(state, run_, 0, ox, oy)
      const lights = lightSources(state)
      most = Math.max(most, lights.length)
      const camX = p.px - W / 2, camY = p.py - H / 2
      const N = layer.night
      const inside = !!N?.key && camX >= N.x0 && camY >= N.y0 && camX + W <= N.x0 + N.w && camY + H <= N.y0 + N.h
      const before = N?.builds ?? 0
      drawn = []
      drawNight(frame, layer, { dark: 0.85, ambient: [40, 60, 120], fog: 1, t: frames / 60, lights }, { camX, camY }, { W, H }, S)
      frames++
      if (!layer.night) continue
      lit++
      if (inside && layer.night.builds > before) keyBuilds++
      if (drawn.includes(layer.canvas)) straight++
    }
  }
  assert.ok(lit > frames * 0.9 && most >= 10, `lights about all the way (${lit} of ${frames} frames lit, up to ${most} lights)`)
  assert.equal(keyBuilds, 0, `no build while the view was still inside the kept mask (${layer.night.builds} builds in ${frames} frames)`)
  assert.equal(straight, 0, 'no frame drawn straight on')
  const walked = 140 * S
  t.diagnostic(`${layer.night.builds} builds in ${frames} frames, ${walked} px walked, up to ${most} lights listed`)
  assert.ok(layer.night.builds <= Math.ceil(walked / NIGHT_PAD) + legs.length + 1, `${layer.night.builds} builds for ${walked} px walked`)
  // the view may wander the pad either way inside a kept mask, so a light it holds lies up to twice the pad off screen
  assert.ok(fx.LIGHT_SLACK * S >= 2 * NIGHT_PAD + S / 2, `lights listed ${fx.LIGHT_SLACK} tiles past the view cover twice the mask's pad (${NIGHT_PAD} px) and a shake`)
})

// ---- the castle gate: the portcullis up by day, down at night -----------------------------

test('the castle gate is shut at night, unless the player is in the castle or its gateway', () => {
  assert.equal(gateShut(0.5, null), false)
  assert.equal(gateShut(0.9, null), true)
  assert.equal(gateShut(0.9, { x: 120, y: 45 }), false)   // in the courtyard
  assert.equal(gateShut(0.9, { x: 110, y: 56 }), false)   // in the gateway
  assert.equal(gateShut(0.1, { x: 80, y: 74 }), true)
  // open from dawn until nightfall
  assert.equal(gateShut(DAY.dawn, null), false)
  assert.equal(gateShut(DAY.night - 1e-6, { x: 80, y: 74 }), false)
  assert.equal(gateShut(DAY.night, { x: 80, y: 74 }), true)
  assert.equal(gateShut(DAY.dawn - 1e-6, null), true)
  assert.equal(gateShut(0.9, { x: 110, y: 57 }), true, 'on the street before it is outside')
})

// city tiles of the gate (the castle wall's row and the row below it, three
// wide) and its art there, as kit.js CASTLE.gate2 / gate2Open lay it
const GATE = [-1, 0, 1].flatMap(d => [{ x: 110 + d, y: 55, i: d + 1, j: 0 }, { x: 110 + d, y: 56, i: d + 1, j: 1 }])
const GATE_FRONT = { X: 110 + OX, Y: 59 + OY }   // on the castle street before it
function gateOf(ctx) {
  const at = g => { const { x, y } = winOf(ctx, g.x + OX, g.y + OY); return { x, y, c: ctx.state.map[y][x] } }
  return {
    cells: () => GATE.map(at),
    open: () => GATE.every(g => { const { c } = at(g); return c.tile === TILE.FLOOR && c.overlay === CASTLE.gate2Open[g.j][g.i] && !isShutGate(c) }),
    shut: () => GATE.every(g => { const { c } = at(g); return c.tile === TILE.WALL && c.overlay === CASTLE.gate2[g.j][g.i] && isShutGate(c) }),
  }
}
const marked = (map, cells) => {
  const list = takeDirtyTiles(map) ?? [], set = new Set()
  for (let i = 0; i < list.length; i += 2) set.add(`${list[i]},${list[i + 1]}`)
  return cells.filter(c => set.has(`${c.x},${c.y}`)).length
}

// Review Focus 5: never down on the player inside, nor on anyone in the gateway
test('at night the portcullis comes down, never while the player is in the castle or anyone stands in the gateway', () => {
  const ctx = setup({ at: GATE_FRONT, frac: 0.5 })
  const { state } = ctx, gate = gateOf(ctx)
  assert.ok(gate.open(), 'open by day')
  assert.ok(gate.cells().every(g => g.c.over === true), 'its arch is drawn over whoever walks through')
  takeDirtyTiles(state.map)
  ctx.T.clock = 0.83 * DAY_LENGTH
  run(ctx, DT)
  assert.ok(gate.shut(), 'down at night with the player outside')
  assert.ok(gate.cells().every(g => g.c.over === true), 'still drawn over the people (wilds/over.js)')
  assert.equal(marked(state.map, gate.cells()), 6, 'its six cells laid again on the baked layer')
  run(ctx, 2)
  assert.equal(marked(state.map, gate.cells()), 0, 'and nothing laid again while it stays down')
  // the player in the courtyard or in the gateway at night: it stays up for them
  placePlayer(ctx, 120 + OX, 45 + OY); run(ctx, DT)
  assert.ok(gate.open(), 'up while the player is in the courtyard')
  placePlayer(ctx, 110 + OX, 56 + OY); run(ctx, 1)
  assert.ok(gate.open(), 'up while the player is in the gateway')
  // the player out on the street but still under the arch's edge: it waits
  const p = state.player
  placePlayer(ctx, 110 + OX, 57 + OY); p.py = p.y * S + 2; run(ctx, 1)
  assert.ok(gate.open(), 'not down on the player\'s shoulders')
  placePlayer(ctx, GATE_FRONT.X, GATE_FRONT.Y); run(ctx, DT)
  assert.ok(gate.shut(), 'down once the player is clear')
  // someone standing in the gateway: it waits for them
  placePlayer(ctx, 120 + OX, 45 + OY); run(ctx, DT)
  assert.ok(gate.open())
  const { x, y } = winOf(ctx, 111 + OX, 56 + OY)
  const cat = { type: 'npc', species: 'cat', x, y, px: x * S + 16, py: y * S + 16, hp: 1, aiHalf: 4 }
  state.entities.push(cat)
  placePlayer(ctx, GATE_FRONT.X, GATE_FRONT.Y); run(ctx, 2)
  assert.ok(gate.open(), 'not down on the cat in the gateway')
  cat.py = (y + 1) * S + 2; cat.y = Math.floor(cat.py / S)   // stepped out onto the street, its edge still under the portcullis
  run(ctx, 1)
  assert.ok(gate.open(), 'nor on its tail')
  state.entities = state.entities.filter(e => e !== cat)
  run(ctx, DT)
  assert.ok(gate.shut(), 'down once the way is clear')
  // up again at dawn
  ctx.T.clock = (DAY.dawn + 0.005) * DAY_LENGTH
  run(ctx, DT)
  assert.ok(gate.open(), 'up at dawn')
})

test('a dropped item lying in the gateway keeps the portcullis up until it is taken', () => {
  const ctx = setup({ at: GATE_FRONT, frac: 0.5 })
  const { state } = ctx, gate = gateOf(ctx)
  placePlayer(ctx, 120 + OX, 45 + OY); run(ctx, DT)
  const { x, y } = winOf(ctx, 111 + OX, 56 + OY)
  const item = { type: 'floating_item', contents: { type: 'lumber', count: 1 }, x, y, progress: 1 }
  state.entities.push(item)
  ctx.T.clock = 0.83 * DAY_LENGTH
  placePlayer(ctx, GATE_FRONT.X, GATE_FRONT.Y); run(ctx, 2)
  assert.ok(gate.open(), 'not down on the item in the gateway')
  state.entities = state.entities.filter(e => e !== item)
  run(ctx, DT)
  assert.ok(gate.shut(), 'down once it is taken')
})

// At night the gate is up only while the player is in the castle; one of the
// town who came in after him (a watchman hunting a wanted player, someone
// running from his blow) is not shut in when he leaves: the portcullis stays
// up until they are out again, and never comes down on anyone.
test('at night one of the town in the courtyard keeps the gate up until they are out', () => {
  const ctx = setup({ at: GATE_FRONT, frac: 0.83 })
  const { state, world } = ctx, gate = gateOf(ctx)
  run(ctx, DT)
  assert.ok(gate.shut(), 'down at night')
  placePlayer(ctx, 120 + OX, 45 + OY); run(ctx, DT)
  assert.ok(gate.open(), 'up while the player is in the courtyard')
  // someone on their way about the town, in the courtyard with him
  const w = [...state.cityRun.people.values()].find(w => w.mode === 'near' && w.entity && w.phase === 'go' && !w.scene && !w.hunt)
  assert.ok(w, 'someone near on their way')
  const e = w.entity, at = winOf(ctx, 116 + OX, 50 + OY)
  e.x = at.x; e.y = at.y; e.px = at.x * S + 16; e.py = at.y * S + 16; e.ai.path = undefined
  const city = t => ({ x: t.x + world.origin.wx * PIECE - OX, y: t.y + world.origin.wy * PIECE - OY })
  const c = PLAN.places.castle, inCastle = q => q.x >= c.x0 && q.x <= c.x1 && q.y >= c.y0 && q.y <= c.y1
  // the player leaves; the one who came in after him walks out
  placePlayer(ctx, GATE_FRONT.X, GATE_FRONT.Y)
  let shutIn = false, out = null, outAs = null
  run(ctx, 40, {
    npcs: true,
    each: t => {
      const inside = w.entity === e && inCastle(city(e))
      if (inside && gate.shut()) shutIn = true
      for (const o of state.entities) {
        const cell = o.hp > 0 ? state.map[o.y]?.[o.x] : null
        if (cell && isShutGate(cell)) shutIn = true
      }
      // out on foot through the gate: still the same entity, still near (not
      // turned far, which would also end `inside`)
      if (!inside && out === null) { out = t; outAs = { same: w.entity === e, mode: w.mode } }
      if (out !== null && t > out + 1) return false
    },
  })
  assert.ok(!shutIn, 'never shut in, nor the portcullis down on anyone')
  assert.ok(out !== null, `out of the castle again (last at ${JSON.stringify(city(e))}, ${w.mode})`)
  assert.ok(outAs.same, 'they walked out as the entity that came in')
  assert.equal(outAs.mode, 'near', 'walked out, not turned far')
  assert.ok(gate.shut(), 'and down once they are out')
})
