// The hooks the quest modules offer a caller that is not an Adventure map
// (the Wilds' tales, wilds/tale-run.js): who the giver is, whether the
// special reward is still to be had, what the player can see, and cells
// that remember. Every hook is optional; without it a module does what it
// always did, which the per-quest test files hold.
import { describe, it, before } from 'node:test'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import * as clearings from '../renderer/systems/quests/clearings.js'
import * as river from '../renderer/systems/quests/river.js'
import * as pass from '../renderer/systems/quests/pass.js'
import { makeQuestCtx, questFlags, checkDeliveries } from '../renderer/systems/quests.js'
import { registerMonsters, clearMonsters, makeMonsterFromDef } from '../renderer/systems/monsters.js'
import { normalizeAdventureSave } from '../renderer/systems/adventure.js'
import { makeHirvi } from '../renderer/systems/monsters/hirvi.js'
import { makeNpc } from '../renderer/systems/npc.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeItem } from '../renderer/systems/inventory.js'
import { hasTalent } from '../renderer/systems/talents.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const S = 32, N = 50
const KIVIHIISI_DEF = JSON.parse(fs.readFileSync('renderer/data/monsters/kivihiisi.json', 'utf8'))
const FAKE_RIG = { PARAM_SCHEMA: [], drawMonster: () => {}, hitHalf: () => 12 }
before(async () => { clearMonsters(); await registerMonsters([KIVIHIISI_DEF], { loadRig: async () => FAKE_RIG, loadHooks: async () => {}, warn: () => {} }) })

function makeMap() {
  const map = createMap(N, N)
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) { map[y][x].tile = TILE.FLOOR; map[y][x].skin = 'ow_grass_0' }
  return map
}
const spawnInto = state => spawns => {
  for (const s of spawns) {
    const at = { px: s.x * S + 16, py: s.y * S + 16 }
    if (s.kind === 'hirvi') state.entities.push(makeHirvi(s.x, s.y))
    else if (s.kind === 'kivihiisi') state.entities.push(Object.assign(makeMonsterFromDef('kivihiisi', s.x, s.y), at))
    else if (s.kind === 'npc') { const n = makeNpc(s); if (n) state.entities.push(n) }
    else if (s.kind === 'floating_pickup') state.entities.push({ type: 'floating_item', contents: s.contents, x: s.x, y: s.y, ...at, progress: 1 })
  }
}
// A quest ctx on a bare 50x50 map; `hooks` are laid over it as the Wilds does.
function build(name, pois, { flags = {}, at = { x: 25, y: 25 }, inventory = [], entities = [], hooks = {} } = {}) {
  const save = normalizeAdventureSave(null)
  const mapData = { name, w: N, h: N, pois: pois.map(([label, x, y, kind = 'landmark']) => ({ kind, label, x, y })), npcs: { village: [], wild: [] } }
  Object.assign(questFlags(save, name), flags)
  const state = {
    map: makeMap(), entities: [...entities], projectiles: [], feedback: makeFeedback(), sfx: makeSfx(),
    player: { x: at.x, y: at.y, px: at.x * S + 16, py: at.y * S + 16, hp: 10, talents: [], inventory, maxInventory: 10, weapon: null },
  }
  const ctx = Object.assign(makeQuestCtx({
    getState: () => state, save, mapData, persist: () => {}, refreshInventory: () => {}, spawn: spawnInto(state), onFlag: () => {},
  }), hooks)
  return { ctx, state, flags: ctx.flags }
}
const elder = (id, x, y) => makeNpc({ kind: 'npc', species: 'elder', id, x, y })
const floating = (state, weaponType) => state.entities.find(e => e.type === 'floating_item' && e.contents?.weaponType === weaponType) ?? null
const cellAt = (state, c) => state.map[c.y][c.x]

const ELK = [['forest shrine', 5, 5], ['wallow 1', 20, 5], ['wallow 2', 20, 20], ['wallow 3', 5, 20]]
const RIVER = [['tar pit', 10, 10], ['lumber camp', 8, 12], ['bridge gap 1', 20, 10], ['bridge gap 2', 21, 10], ['bridge gap 3', 22, 10]]
const KC = { x: 25, y: 25 }
const PASS = [['Somewhere', 5, 5, 'village'], ['hermit hut', 40, 40], ['hiidenkiuas', KC.x, KC.y]]
const ringCell = i => ({ x: KC.x + pass.RING[i][0], y: KC.y + pass.RING[i][1] })
const isBoulder = cell => cell.tile === TILE.WALL && String(cell.overlay).startsWith('ow_mtn_rock_')

describe('the giver', () => {
  it('a delivery is refused by an elder who is not the giver', () => {
    const { ctx, state, flags } = build('t', ELK, {
      flags: { hirvi_dead: true }, at: { x: 10, y: 10 }, inventory: [makeItem('elk_hide')],
      entities: [elder('a', 11, 10), elder('b', 30, 30)], hooks: { isGiver: e => e.id === 'b' },
    })
    assert.equal(checkDeliveries(ctx, clearings.DELIVERIES), null)
    assert.ok(state.player.inventory.some(i => i.kind === 'elk_hide'))
    state.player.x = 29; state.player.y = 30
    assert.ok(checkDeliveries(ctx, clearings.DELIVERIES))
    assert.equal(flags.hide_given, true)
  })

  it('the elk\'s stand-in elder appears at giverCell, and only an elder who is the giver counts as being there', () => {
    const { ctx, state } = build('t', ELK, {
      flags: { hirvi_dead: true }, entities: [elder('other', 45, 45)],
      hooks: { isGiver: e => e.id !== 'other', giverCell: () => ({ x: 9, y: 9 }) },
    })
    clearings.onArrive(ctx)
    const stand = state.entities.filter(e => e.type === 'npc' && e.species === 'elder' && e.id !== 'other')
    assert.equal(stand.length, 1)
    assert.ok(Math.max(Math.abs(stand[0].x - 9), Math.abs(stand[0].y - 9)) <= 4)
    clearings.onArrive(ctx)
    assert.equal(state.entities.filter(e => e.type === 'npc' && e.species === 'elder').length, 2, 'not a second stand-in')
  })

  it('with no village on the map and no giverCell there is no stand-in', () => {
    const { ctx, state } = build('t', ELK, { flags: { hirvi_dead: true } })
    clearings.onArrive(ctx)
    assert.equal(state.entities.filter(e => e.type === 'npc').length, 0)
  })
})

describe('special() false skips the special reward', () => {
  it('the hide is taken but no Ski-legs are given', () => {
    const { ctx, state, flags } = build('t', ELK, {
      flags: { hirvi_dead: true }, at: { x: 10, y: 10 }, inventory: [makeItem('elk_hide')],
      entities: [elder('e', 11, 10)], hooks: { special: () => false },
    })
    clearings.tick(ctx, 0.016)
    assert.equal(flags.hide_given, true)
    assert.equal(hasTalent(state.player, 'ski_legs'), false)
  })

  it('the bridge is finished but no bow is laid, then or on a later arrival', () => {
    const { ctx, state, flags } = build('t', RIVER, {
      flags: { bridge_seen: true, pit_lit: true, plank_1: true, plank_2: true }, at: { x: 21, y: 10 },
      inventory: [makeItem('tar', 1)], hooks: { special: () => false },
    })
    river.onArrive(ctx)
    river.tick(ctx, 0.016)
    assert.equal(flags.bridge_done, true)
    assert.equal(floating(state, river.BOW), null)
    river.onArrive(ctx)
    assert.equal(floating(state, river.BOW), null)
  })

  it('the Hiisi is dead but no hammer lies at the oven', () => {
    const { ctx, state } = build('t', PASS, { flags: { hiisi_dead: true }, hooks: { special: () => false } })
    pass.onArrive(ctx)
    assert.equal(floating(state, pass.HAMMER), null)
  })
})

describe('cells that remember', () => {
  it('a mended crossing is planked again on arrival', () => {
    const { ctx, state } = build('t', RIVER, { flags: { bridge_done: true, bow_given: true } })
    for (const x of [20, 21, 22]) Object.assign(state.map[10][x], { tile: TILE.WALL, overlay: null, losClear: true })
    river.onArrive(ctx)
    for (const x of [20, 21, 22]) {
      assert.equal(state.map[10][x].tile, TILE.FLOOR)
      assert.equal(state.map[10][x].overlay, 'ow_pier_log')
      assert.ok(!state.map[10][x].losClear)
    }
  })

  it('deck is told of each gap cell once it has changed; the planks themselves stay plain logs', () => {
    // (the Wilds lays its bridges as deck cut to their neighbours and re-cuts round the cell it is told of)
    const calls = []
    const t = build('t', RIVER, { flags: { plank_1: true }, at: { x: 20, y: 10 }, inventory: [makeItem('tar', 2)] })
    t.ctx.deck = c => calls.push([c.x, c.y, t.state.map[c.y][c.x].tile, t.state.map[c.y][c.x].overlay])
    river.onArrive(t.ctx)
    assert.deepEqual(calls, [[20, 10, TILE.FLOOR, 'ow_pier_log'], [21, 10, TILE.WALL, null], [22, 10, TILE.WALL, null]])
    calls.length = 0
    river.tick(t.ctx, 0.016)   // standing on the first plank, tar in the sack: the second goes down
    assert.equal(t.flags.plank_2, true)
    assert.deepEqual(calls, [[21, 10, TILE.FLOOR, 'ow_pier_log']])
  })

  it('the ring is exactly the stones the flag says, wherever boulders stood before', () => {
    const { ctx, state } = build('t', PASS, { flags: { hiisi_woken: true, stones: 4 } })
    for (let i = 0; i < 6; i++) pass.stampBoulder(state.map, ringCell(i), 'ow_mtn_rock_1')
    pass.onArrive(ctx)
    for (let i = 0; i < 4; i++) assert.ok(isBoulder(cellAt(state, ringCell(i))), `stone ${i} is down`)
    for (let i = 4; i < 6; i++) {
      assert.equal(cellAt(state, ringCell(i)).tile, TILE.FLOOR, `stone ${i} still stands`)
      assert.ok(!cellAt(state, ringCell(i)).overlay)
    }
  })

  it('the capstone keeps the skin the map gave it', () => {
    const own = build('t', PASS)
    Object.assign(cellAt(own.state, KC), { tile: TILE.WALL, overlay: 'ow_mtn_rock_cap' })
    pass.onArrive(own.ctx)
    assert.equal(cellAt(own.state, KC).overlay, 'ow_mtn_rock_cap')
    const bare = build('t', PASS)
    pass.onArrive(bare.ctx)
    assert.equal(cellAt(bare.state, KC).overlay, pass.CAPSTONE)
  })
})

describe('where things are', () => {
  it('the pick lies by the hermit\'s hut, not by the first village on the map', () => {
    const { ctx, state } = build('t', PASS)
    pass.onArrive(ctx)
    const pick = floating(state, pass.PICK)
    assert.ok(pick, 'no pick')
    assert.ok(Math.max(Math.abs(pick.x - 40), Math.abs(pick.y - 40)) <= 3, `pick at ${pick.x},${pick.y}`)
  })

  it('the bridge thought waits until the gap is seen', () => {
    const blind = build('t', RIVER, { hooks: { sees: () => false } })
    river.onArrive(blind.ctx)
    river.tick(blind.ctx, 0.016)
    assert.ok(!blind.flags.bridge_seen)
    let asked = null
    const seeing = build('t', RIVER, { hooks: { sees: c => { asked = c; return true } } })
    river.onArrive(seeing.ctx)
    river.tick(seeing.ctx, 0.016)
    assert.equal(seeing.flags.bridge_seen, true)
    assert.deepEqual(asked, { x: 21, y: 10 }, 'asked about the middle gap')
  })
})
