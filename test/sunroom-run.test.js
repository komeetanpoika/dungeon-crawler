import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tickSunroom } from '../renderer/systems/sunroom-run.js'
import { traceBeam, findSun } from '../renderer/interior/sunroom.js'
import { generateInterior, specFor } from '../renderer/interior/index.js'
import { MISC } from '../renderer/interior/kit.js'
import { isWalkable } from '../renderer/systems/entities.js'

const S = 32
const house = (seed = 1) => {
  const g = generateInterior(specFor({ version: 'sunroom', size: 'large', seed, label: `run:${seed}` }))
  return { g, state: { map: g.map, entities: g.entitySpawns.map(s => ({ ...s, type: s.kind })), cave: { label: 'house:wilds:1,1' }, player: { x: 0, y: 0, px: 0, py: 0, facing: 'south' } } }
}
const mirrors = map => map.flatMap((row, y) => row.flatMap((c, x) => c.mirror ? [{ x, y }] : []))
// Stand the player against a mirror from a walkable side, as close as walking allows.
function against(state, m) {
  for (const [dx, dy, vx, vy, facing] of [[-1, 0, 1, 0, 'east'], [1, 0, -1, 0, 'west'], [0, -1, 0, 1, 'south'], [0, 1, 0, -1, 'north']]) {
    const x = m.x + dx, y = m.y + dy, c = state.map[y]?.[x]
    if (!c || !isWalkable(c.tile, c)) continue
    Object.assign(state.player, { x, y, facing, px: x * S + 16 + vx * 8, py: y * S + 16 + vy * 8 })
    return { vx, vy }
  }
  return null
}

describe('playing the mirrors', () => {
  it('a push into a mirror turns it once; holding the push does not turn it again', () => {
    const { state } = house()
    const m = mirrors(state.map)[0]
    const push = against(state, m)
    const before = state.map[m.y][m.x].mirror
    assert.equal(tickSunroom(state, push), 'turned')
    const after = state.map[m.y][m.x].mirror
    assert.notEqual(after, before)
    assert.equal(state.map[m.y][m.x].overlay, MISC.mirror[after])
    for (let i = 0; i < 10; i++) assert.equal(tickSunroom(state, push), null)
    assert.equal(state.map[m.y][m.x].mirror, after)
    assert.equal(tickSunroom(state, { vx: 0, vy: 0 }), null)    // let go
    assert.equal(tickSunroom(state, push), 'turned')             // push again
    assert.equal(state.map[m.y][m.x].mirror, before)
  })
  it('walking along beside a mirror, or standing off from it, turns nothing', () => {
    const { state } = house()
    const m = mirrors(state.map)[0]
    const push = against(state, m)
    state.player.px -= push.vx * 12; state.player.py -= push.vy * 12   // a step back from it
    assert.equal(tickSunroom(state, push), null)
  })
  it('the interact key turns the mirror the player faces', () => {
    const { state } = house()
    const m = mirrors(state.map)[0]
    against(state, m)
    const before = state.map[m.y][m.x].mirror
    assert.equal(tickSunroom(state, { vx: 0, vy: 0, interact: true }), 'turned')
    assert.notEqual(state.map[m.y][m.x].mirror, before)
  })
  it('the last right turn solves it: the seed blooms, the panel opens, the glassmaker is glad', () => {
    const { state } = house(3)
    const sun = findSun(state.map)
    const ms = mirrors(state.map)
    // turn every mirror but one to its answer by hand, then push the last one
    const wrong = ms.filter(m => state.map[m.y][m.x].mirror !== state.map[m.y][m.x].solution)
    for (const m of wrong.slice(1)) state.map[m.y][m.x].mirror = state.map[m.y][m.x].solution
    tickSunroom(state, {})                                         // first look: caches the hall
    const last = wrong[0]
    const push = against(state, last)
    assert.ok(push, 'the last mirror can be reached')
    assert.equal(tickSunroom(state, push), 'solved')
    assert.deepEqual(traceBeam(state.map, sun.start).hit, sun.target)
    assert.equal(state.map[sun.target.y][sun.target.x].overlay, MISC.bloom)
    assert.ok(isWalkable(state.map[sun.alcove.y][sun.alcove.x].tile))
    assert.ok(state.entities.find(e => e.role === 'glassmaker').lines.some(l => /gold/i.test(l)))
    assert.equal(state.cave.sun.solved, true)
    // a solved hall keeps its mirrors
    tickSunroom(state, { vx: 0, vy: 0 })
    const m = ms[0]; const p2 = against(state, m); const o = state.map[m.y][m.x].mirror
    assert.equal(tickSunroom(state, p2), null)
    assert.equal(state.map[m.y][m.x].mirror, o)
  })
  it('keeps the beam for drawing, and does nothing in a house without a puzzle', () => {
    const { state } = house()
    tickSunroom(state, {})
    assert.ok(state.cave.sun.beam.cells.length >= 2)
    const plain = generateInterior(specFor({ version: 'home', seed: 2, label: 'p' }))
    const s2 = { map: plain.map, entities: [], cave: { label: 'house:x' }, player: { x: 1, y: 1, px: 48, py: 48 } }
    assert.equal(tickSunroom(s2, { vx: 1, vy: 0 }), null)
    assert.equal(s2.cave.sun, null)
  })
})

// ---- found by the final review ----
import { storedSunroom } from '../renderer/systems/sunroom-run.js'
import { readFileSync } from 'node:fs'
import { TILE } from '../renderer/systems/entities.js'

describe('the mirrors, found by the final review', () => {
  it('a beam a mirror turns straight into a wall ends going the new way', () => {
    const m = Array.from({ length: 3 }, (_, y) => Array.from({ length: 3 }, (_, x) => ({ tile: x === 1 && y < 2 ? TILE.FLOOR_WOOD : TILE.WALL })))
    Object.assign(m[1][1], { tile: TILE.WALL, losClear: true, mirror: '/' })   // S -> W, into the wall at 0,1
    const b = traceBeam(m, { x: 1, y: 0, dir: 'S' })
    assert.deepEqual(b.end, { x: 1, y: 1, dir: 'W' })
  })
  it('a push the walk stopped short counts, however big the step that frame', () => {
    const { state } = house()
    const m = mirrors(state.map)[0]
    const push = against(state, m)
    state.player.px -= push.vx * 7; state.player.py -= push.vy * 7    // a sprint step short at 30 fps
    assert.equal(tickSunroom(state, push), null, 'a push from afar is no push')
    assert.equal(tickSunroom(state, { ...push, blockedX: push.vx !== 0, blockedY: push.vy !== 0 }), 'turned')
  })
  it('holding the interact key is one press, not thirty a second', () => {
    const src = readFileSync(new URL('../renderer/game.js', import.meta.url), 'utf8')
    const line = src.split('\n').find(l => l.startsWith("window.addEventListener('keydown', e => {") && l.includes('keys[e.key] = true'))
    assert.ok(line && /e\.repeat/.test(line) && /'f'/.test(line), `the key latch lets a held F repeat: ${line}`)
  })
  it('a stored hall owes its reward back when solved and not taken, and is built again when the world knows better', () => {
    const { g } = house(3)
    const lit = generateInterior(specFor({ version: 'sunroom', size: 'large', seed: 3, label: 'run:3' }), { solved: true })
    const sun = findSun(lit.map)
    assert.deepEqual(storedSunroom(lit.map, [], { solved: true, looted: false }), { rebuild: false, reward: sun.alcove })
    assert.deepEqual(storedSunroom(lit.map, [{ type: 'chest', sunReward: true }], { solved: true, looted: false }), { rebuild: false, reward: null })
    assert.deepEqual(storedSunroom(lit.map, [], { solved: true, looted: true }), { rebuild: false, reward: null })
    // a death rolled the house back to before it was solved: build it lit
    assert.deepEqual(storedSunroom(g.map, [], { solved: true, looted: true }), { rebuild: true, reward: null })
    assert.deepEqual(storedSunroom(g.map, [], { solved: false, looted: false }), { rebuild: false, reward: null })
    const plain = generateInterior(specFor({ version: 'home', seed: 2, label: 'p' }))
    assert.deepEqual(storedSunroom(plain.map, [], { solved: false, looted: false }), { rebuild: false, reward: null })
  })
  it('a solve never puts a second reward in the wall once the first was taken', () => {
    const src = readFileSync(new URL('../renderer/game.js', import.meta.url), 'utf8')
    const on = src.slice(src.indexOf('function onSunroom'), src.indexOf('function exitCave'))
    assert.match(on, /looted\.has\(/, 'onSunroom puts a chest in the alcove even when the reward was taken')
  })
})
