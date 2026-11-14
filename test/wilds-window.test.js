import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WIN, WIN_TILES, assemble, toWindow, toWorld, recentreStep } from '../renderer/wilds/window.js'
import { shiftDeep, shiftState } from '../renderer/wilds/shift.js'
import { PIECE } from '../renderer/wilds/layout.js'

const fakePiece = tag => ({ cells: Array.from({ length: PIECE }, (_, y) => Array.from({ length: PIECE }, (_, x) => ({ tag, x, y }))) })
const grid3 = () => Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => fakePiece(`${c},${r}`)))

test('assemble shares cells with the pieces', () => {
  assert.equal(WIN, 3)
  assert.equal(WIN_TILES, 240)
  const pieces = grid3()
  const map = assemble(pieces)
  assert.equal(map.length, 240)
  assert.ok(map.every(row => row.length === 240))
  assert.equal(map[80][160], pieces[1][2].cells[0][0])
  assert.equal(map[0][0], pieces[0][0].cells[0][0])
  assert.equal(map[239][239], pieces[2][2].cells[79][79])
  assert.equal(map[100][90], pieces[1][1].cells[20][10])
})

test('window and world coordinates convert both ways', () => {
  const origin = { wx: -3, wy: 2 }
  assert.deepEqual(toWorld(origin, 0, 0), { X: -240, Y: 160 })
  assert.deepEqual(toWindow(origin, -240 + 85, 160 + 7), { x: 85, y: 7 })
  assert.deepEqual(toWindow(origin, ...Object.values(toWorld(origin, 123, 45))), { x: 123, y: 45 })
})

test('recentreStep has hysteresis', () => {
  assert.deepEqual(recentreStep(120, 120), { dx: 0, dy: 0 })
  assert.deepEqual(recentreStep(71, 120), { dx: -1, dy: 0 })
  assert.deepEqual(recentreStep(72, 120), { dx: 0, dy: 0 })
  assert.deepEqual(recentreStep(168, 120), { dx: 1, dy: 0 })
  assert.deepEqual(recentreStep(167, 120), { dx: 0, dy: 0 })
  assert.deepEqual(recentreStep(120, 71), { dx: 0, dy: -1 })
  assert.deepEqual(recentreStep(170, 60), { dx: 1, dy: -1 })
  // after a shift west (+80 tiles) the player is well inside the middle piece
  assert.deepEqual(recentreStep(71 + 80, 120), { dx: 0, dy: 0 })
  assert.deepEqual(recentreStep(168 - 80, 120), { dx: 0, dy: 0 })
})

test('shiftDeep moves tiles by tiles and pixels by pixels', () => {
  const e = {
    x: 100, y: 90, px: 3216, py: 2896, hp: 3, speed: 70, facing: 'east',
    home: { x: 99, y: 90 },
    ai: { lastSeen: { x: 110, y: 91 }, path: [{ x: 101, y: 90 }, { x: 102, y: 91 }], patrolPoints: [{ x: 95, y: 88 }], pathTarget: null, repath: 0.3 },
    startPx: 3200, startPy: 2880, targetPx: 3232, targetPy: 2912,
    knockback: { vx: 40, vy: -3 },
  }
  shiftDeep(e, -80, 0)
  assert.deepEqual([e.x, e.y, e.px, e.py], [20, 90, 3216 - 2560, 2896])
  assert.deepEqual(e.home, { x: 19, y: 90 })
  assert.deepEqual(e.ai.lastSeen, { x: 30, y: 91 })
  assert.deepEqual(e.ai.path, [{ x: 21, y: 90 }, { x: 22, y: 91 }])
  assert.deepEqual(e.ai.patrolPoints, [{ x: 15, y: 88 }])
  assert.deepEqual([e.startPx, e.startPy, e.targetPx, e.targetPy], [640, 2880, 672, 2912])
  assert.deepEqual(e.knockback, { vx: 40, vy: -3 })
  assert.deepEqual([e.hp, e.speed, e.facing, e.ai.repath], [3, 70, 'east', 0.3])
  // vertical, and both at once
  const p = { x: 5, y: 5, px: 176, py: 176 }
  shiftDeep(p, 80, -80)
  assert.deepEqual(p, { x: 85, y: -75, px: 176 + 2560, py: 176 - 2560 })
})

test('shiftDeep survives cycles, typed arrays and shared objects', () => {
  const shared = { x: 1, y: 1 }
  const a = { x: 0, y: 0, self: null, list: [shared, shared], grid: new Float32Array([1, 2, 3]), seen: new Set([1]) }
  a.self = a
  shiftDeep(a, 10, 0)
  assert.equal(a.x, 10)
  assert.deepEqual(shared, { x: 11, y: 1 }, 'a shared object moves once')
  assert.deepEqual([...a.grid], [1, 2, 3])
})

test('shiftState covers every list of the running game', () => {
  const state = {
    player: { x: 100, y: 100, px: 3216, py: 3216, _fovMap: {}, _fovLitMap: {} },
    entities: [{ x: 90, y: 100, px: 2896, py: 3216 }],
    projectiles: [{ px: 3000, py: 3000, dx: 5, dy: 0 }],
    zones: [{ tiles: [{ x: 91, y: 92 }], age: 0 }],
    fireZones: [{ tiles: [{ x: 93, y: 94 }], age: 0 }],
    lightning: [{ x: 95, y: 96, t: 0 }],
    strikes: [{ x: 97, y: 98, t: 0 }],
    shockwaves: [{ px: 3100, py: 3100, t: 0 }],
    arcs: [{ x0: 3200, y0: 3200, x1: 3264, y1: 3200, t: 0 }],
    hitEffects: [{ x: 101, y: 100 }],
    blinkTrail: { from: { px: 3216, py: 3216 }, to: { px: 3300, py: 3216 }, t: 0 },
    feedback: { floats: [{ px: 3216, py: 3200, text: '-1' }], bubble: null, banner: null, toasts: [] },
    lastBossTile: { x: 99, y: 99 },
    tripPull: { t: 0, dur: 2, x: 120, y: 120 },
    rite: { t: 0, dur: 5, cx: 3856, cy: 3856 },
    caveEntrances: [{ x: 130, y: 60, caveDepth: 1, label: 'cave:0,-1' }],
    houseDoors: [{ x: 140, y: 61, label: 'house:wilds:1,2', tier: 'safe' }],
    signs: [{ x: 118, y: 121, title: 'Koivula', lines: [] }],
    _flowFields: { 1: {} },
  }
  shiftState(state, -80, 80)
  const T = 80, P = 2560
  assert.deepEqual([state.player.x, state.player.y, state.player.px, state.player.py], [100 - T, 100 + T, 3216 - P, 3216 + P])
  assert.deepEqual([state.entities[0].x, state.entities[0].py], [90 - T, 3216 + P])
  assert.deepEqual([state.projectiles[0].px, state.projectiles[0].py, state.projectiles[0].dx], [3000 - P, 3000 + P, 5])
  assert.deepEqual(state.zones[0].tiles[0], { x: 91 - T, y: 92 + T })
  assert.deepEqual(state.fireZones[0].tiles[0], { x: 93 - T, y: 94 + T })
  assert.deepEqual([state.lightning[0].x, state.strikes[0].y], [95 - T, 98 + T])
  assert.deepEqual([state.shockwaves[0].px, state.shockwaves[0].py], [3100 - P, 3100 + P])
  assert.deepEqual([state.arcs[0].x0, state.arcs[0].y0, state.arcs[0].x1, state.arcs[0].y1], [3200 - P, 3200 + P, 3264 - P, 3200 + P])
  assert.deepEqual(state.hitEffects[0], { x: 101 - T, y: 100 + T })
  assert.deepEqual(state.blinkTrail.to, { px: 3300 - P, py: 3216 + P })
  assert.deepEqual([state.feedback.floats[0].px, state.feedback.floats[0].py], [3216 - P, 3200 + P])
  assert.deepEqual(state.lastBossTile, { x: 99 - T, y: 99 + T })
  assert.deepEqual([state.tripPull.x, state.tripPull.y], [120 - T, 120 + T])
  assert.deepEqual([state.rite.cx, state.rite.cy], [3856 - P, 3856 + P])
  assert.deepEqual([state.caveEntrances[0].x, state.caveEntrances[0].y], [130 - T, 60 + T])
  assert.deepEqual([state.houseDoors[0].x, state.signs[0].y], [140 - T, 121 + T])
  assert.equal(state._flowFields, undefined)
  assert.equal(state.player._fovMap, null)
})
