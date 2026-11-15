// The hooks the Timewarp episode modules offer a caller that is not their own
// map (the Wilds' tales, wilds/tale-run.js). Every hook is optional; without
// it a module does what it always did, which test/episodes-*.test.js hold.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fold from '../renderer/systems/episodes/fold.js'
import { makeCtx } from '../renderer/systems/story.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeItem } from '../renderer/systems/inventory.js'
import { makeNpc } from '../renderer/systems/npc.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const S = 32, N = 60
function makeMap() {
  const map = createMap(N, N)
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) { map[y][x].tile = TILE.FLOOR; map[y][x].skin = 'ow_grass_0' }
  return map
}
// An episode ctx on a bare 60x60 map with trees round each burn point; `hooks` laid over it as the Wilds does.
function build(pois, { flags = {}, at = { x: 30, y: 30 }, inventory = [], entities = [], hooks = {}, save = { clock: 0 } } = {}) {
  const record = { t: { flags: { ...flags } } }
  const mapData = { name: 't', w: N, h: N, pois: pois.map(([label, x, y, kind = 'landmark']) => ({ kind, label, x, y })) }
  const state = {
    map: makeMap(), entities: [...entities], projectiles: [], feedback: makeFeedback(), sfx: makeSfx(), creatureKills: {},
    player: { x: at.x, y: at.y, px: at.x * S + 16, py: at.y * S + 16, hp: 10, talents: [], inventory, maxInventory: 10, weapon: null },
  }
  const spawned = []
  const ctx = makeCtx({
    getState: () => state, save, record, mapData, persist: () => {}, refreshInventory: () => {},
    resolve: () => { ctx.set('resolved') },
    spawn: spawns => { for (const s of spawns) { spawned.push(s); if (s.kind === 'npc') state.entities.push(makeNpc(s)); else state.entities.push({ type: s.kind, x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16 }) } },
    extra: { episode: { houses: {}, resolvedLines: null }, ...hooks },
  })
  return { ctx, state, flags: ctx.flags, spawned }
}
const elder = (id, x, y) => makeNpc({ kind: 'npc', species: 'elder', id, x, y })
const villager = (id, x, y) => makeNpc({ kind: 'npc', species: 'villager', id, x, y })

const FOLD = [['village', 10, 10, 'village'], ['den', 40, 30], ['burn 1', 20, 20], ['burn 2', 26, 22], ['burn 3', 32, 26], ['burn 4', 36, 28],
  ['burrow', 50, 20], ['lair', 50, 18], ['fleece cache', 50, 21]]
const plant = (state, x, y) => { Object.assign(state.map[y][x], { tile: TILE.WALL, overlay: 'ow_tree_small' }) }
const treesRound = (state, label) => { const p = FOLD.find(f => f[0] === label); for (const [dx, dy] of [[1, 0], [-2, 1], [0, 3], [3, -2]]) plant(state, p[1] + dx, p[2] + dy) }
const charred = (state, label) => { const p = FOLD.find(f => f[0] === label); return [[1, 0], [-2, 1], [0, 3], [3, -2]].filter(([dx, dy]) => String(state.map[p[2] + dy][p[1] + dx].overlay).startsWith('ow_deadtree')).length }

describe('the fold: hooks', () => {
  it('the burning waits until burning() says it has begun', () => {
    let begun = false
    const t = build(FOLD, { hooks: { burning: () => begun } })
    treesRound(t.state, 'burn 1')
    fold.tick(t.ctx, fold.BURN_INTERVAL + 1)
    assert.ok(!t.flags.burn, 'burnt before it began')
    begun = true
    fold.tick(t.ctx, fold.BURN_INTERVAL + 1)
    assert.equal(t.flags.burn, 1)
    assert.equal(charred(t.state, 'burn 1'), 4)
  })

  it('with turnVillage nobody turns hostile at the last band, and the hook is told', () => {
    const turns = []
    const t = build(FOLD, { flags: { burn: 3 }, entities: [villager('v', 11, 10), elder('e', 12, 10)], hooks: { turnVillage: h => turns.push(h) } })
    fold.tick(t.ctx, fold.BURN_INTERVAL + 1)
    assert.equal(t.flags.burn, 4)
    assert.deepEqual(turns, [true])
    assert.ok(t.state.entities.every(e => !e.hostile), 'a villager turned on the player')
    assert.ok(!t.state.npcWrath)
  })

  it('burnt cells are kept through cellKey and read back through cellOf', () => {
    const hooks = { cellKey: (x, y) => `L${x - 5},${y - 5}`, cellOf: k => { const [x, y] = k.slice(1).split(',').map(Number); return { x: x + 5, y: y + 5 } } }
    const t = build(FOLD, { hooks })
    treesRound(t.state, 'burn 1')
    fold.tick(t.ctx, fold.BURN_INTERVAL + 1)
    assert.ok(t.flags.burnt.length === 4 && t.flags.burnt.every(k => k.startsWith('L')), `burnt: ${t.flags.burnt}`)
    // a fresh map (the piece made anew): arrival chars the same four cells again
    const again = build(FOLD, { flags: { ...t.flags }, hooks })
    treesRound(again.state, 'burn 1')
    fold.onArrive(again.ctx)
    assert.equal(charred(again.state, 'burn 1'), 4)
  })

  it('a band that fell due while its ground was away is charred on the next arrival', () => {
    let here = false
    const pois = FOLD.filter(p => !p[0].startsWith('burn'))
    const t = build(pois, { hooks: { cellKey: (x, y) => `${x},${y}`, cellOf: k => { if (!here) return null; const [x, y] = k.split(',').map(Number); return { x, y } } } })
    fold.tick(t.ctx, fold.BURN_INTERVAL + 1)
    assert.equal(t.flags.burn, 1)
    assert.ok(!(t.flags.burnt ?? []).length, 'charred cells of a ridge that is not here')
    // the ridge comes back: its burn points exist again
    here = true
    t.ctx.mapData.pois.push(...FOLD.filter(p => p[0].startsWith('burn')).map(([label, x, y]) => ({ kind: 'landmark', label, x, y })))
    treesRound(t.state, 'burn 1')
    fold.onArrive(t.ctx)
    assert.equal(charred(t.state, 'burn 1'), 4)
    assert.equal(t.flags.burnt.length, 4)
    fold.onArrive(t.ctx)
    assert.equal(t.flags.burnt.length, 4, 'charred twice')
  })

  it('only the giver\'s elder is shown the fleece', () => {
    const t = build(FOLD, { at: { x: 30, y: 30 }, inventory: [makeItem('fleece')], entities: [elder('other', 31, 30), elder('giver', 45, 45)], hooks: { isGiver: e => e.id === 'giver' } })
    fold.tick(t.ctx, 0.016)
    assert.ok(!t.flags.fleece_shown, 'another village\'s elder took the fleece')
    t.state.player.x = 44; t.state.player.y = 45
    fold.tick(t.ctx, 0.016)
    assert.equal(t.flags.fleece_shown, true)
  })
})
