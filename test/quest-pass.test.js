import { describe, it, before } from 'node:test'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { onArrive, tick, KIUAS, RING, RING_STONES, CAPSTONE, HAMMER, PICK as PICK_TYPE, stampBoulder } from '../renderer/systems/quests/pass.js'
import { makeQuestCtx, questFlags } from '../renderer/systems/quests.js'
import { registerMonsters, clearMonsters, makeMonsterFromDef } from '../renderer/systems/monsters.js'
import { normalizeAdventureSave } from '../renderer/systems/adventure.js'
import { CLAD_MAX } from '../renderer/systems/monsters/kivihiisi.js'
import { harvest } from '../renderer/systems/lumber.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE, weaponContents } from '../renderer/systems/entities.js'
import { itemFromContents } from '../renderer/systems/inventory.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const S = 32
const N = 40

// The Hiisi is registry-built here as the game builds it (buildEntities →
// makeMonsterFromDef), so what the module spawns carries the def's weapon.
const KIVIHIISI_DEF = JSON.parse(fs.readFileSync('renderer/data/monsters/kivihiisi.json', 'utf8'))
const FAKE_RIG = { PARAM_SCHEMA: [], drawMonster: () => {}, hitHalf: () => 12 }
before(async () => { clearMonsters(); await registerMonsters([KIVIHIISI_DEF], { loadRig: async () => FAKE_RIG, loadHooks: async () => {}, warn: () => {} }) })
const KC = { x: 20, y: 20 }
const HUT = { x: 5, y: 5 }
const PICK = { weaponType: 'pick', name: 'Pick', damage: 2, mine: 3 }

const mapData = {
  name: 'forest-3-autumn', w: N, h: N,
  pois: [{ kind: 'village', x: HUT.x, y: HUT.y, label: 'hermit hut' }, { kind: 'landmark', x: KC.x, y: KC.y, label: KIUAS }],
  npcs: { village: ['villager', 'elder'], wild: [] },
}

function makeMap() {
  const map = createMap(N, N)
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) { map[y][x].tile = TILE.FLOOR; map[y][x].skin = 'ow_mtn_ground_0' }
  return map
}

function spawnInto(state) {
  return spawns => {
    for (const s of spawns) {
      if (s.kind === 'kivihiisi') { const e = makeMonsterFromDef('kivihiisi', s.x, s.y); e.px = s.x * S + 16; e.py = s.y * S + 16; state.entities.push(e) }
      else if (s.kind === 'floating_pickup') state.entities.push({ type: 'floating_item', contents: s.contents, x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16, progress: 1 })
    }
  }
}

function build({ flags = {}, at = HUT, inventory = [], entities = [], weapon = null } = {}) {
  const save = normalizeAdventureSave(null)
  Object.assign(questFlags(save, mapData.name), flags)
  const state = {
    map: makeMap(), entities: [...entities], feedback: makeFeedback(), sfx: makeSfx(),
    player: { x: at.x, y: at.y, px: at.x * S + 16, py: at.y * S + 16, hp: 10, talents: [], inventory, maxInventory: 10, weapon },
  }
  const calls = { persist: 0, refreshInventory: 0, flags: [] }
  const ctx = makeQuestCtx({
    getState: () => state, save, mapData,
    persist: () => { calls.persist++ }, refreshInventory: () => { calls.refreshInventory++ },
    spawn: spawnInto(state), onFlag: f => calls.flags.push(f),
  })
  return { ctx, state, save, calls }
}

const ringCell = i => ({ x: KC.x + RING[i][0], y: KC.y + RING[i][1] })
const cellAt = (state, c) => state.map[c.y][c.x]
const isBoulder = cell => cell.tile === TILE.WALL && String(cell.overlay).startsWith('ow_mtn_rock_')
const boulders = state => RING.map((_, i) => isBoulder(cellAt(state, ringCell(i)))).filter(Boolean).length
const hiisiOf = state => state.entities.find(e => e.type === 'kivihiisi') ?? null
const hammerOf = state => state.entities.find(e => e.type === 'floating_item' && e.contents?.weaponType === HAMMER) ?? null
const pickOf = state => state.entities.find(e => e.type === 'floating_item' && e.contents?.weaponType === PICK_TYPE) ?? null
// Mines a cell to the ground the way game.js does: repeated harvest() swings with a pick.
const mineOut = (state, c) => { for (let i = 0; i < 5; i++) harvest(state.map, c.x, c.y, PICK) }

describe('stampBoulder', () => {
  it('makes a mineable WALL boulder that clearRock can take back down', () => {
    const { state } = build()
    stampBoulder(state.map, ringCell(0), 'ow_mtn_rock_2')
    assert.ok(isBoulder(cellAt(state, ringCell(0))))
    mineOut(state, ringCell(0))
    assert.equal(cellAt(state, ringCell(0)).tile, TILE.FLOOR)
    assert.equal(cellAt(state, ringCell(0)).cleared, 'rock')
  })
})

describe('arrival stamps the arena from the flags', () => {
  it('a fresh map: the capstone on the kiuas and all six ring boulders, no Hiisi', () => {
    const { ctx, state } = build()
    onArrive(ctx)
    assert.equal(cellAt(state, KC).overlay, CAPSTONE)
    assert.equal(cellAt(state, KC).tile, TILE.WALL)
    assert.equal(boulders(state), RING_STONES)
    assert.equal(hiisiOf(state), null)
  })
  it('is idempotent', () => {
    const { ctx, state } = build()
    onArrive(ctx); onArrive(ctx)
    assert.equal(boulders(state), RING_STONES)
  })
  it('the ring never reuses the capstone skin, on any ring cell', () => {
    const { ctx, state } = build()
    onArrive(ctx)
    for (let i = 0; i < RING_STONES; i++) {
      const overlay = cellAt(state, ringCell(i)).overlay
      assert.notEqual(overlay, CAPSTONE)
      assert.match(overlay, /^ow_mtn_rock_[1-5]$/)
    }
  })
  it('honours stones: only that many ring boulders come back', () => {
    const { ctx, state } = build({ flags: { hiisi_woken: true, stones: 2 } })
    onArrive(ctx)
    assert.equal(boulders(state), 2)
    assert.notEqual(cellAt(state, KC).overlay, CAPSTONE, 'no capstone once woken')
  })
  it('a woken Hiisi is re-spawned at the kiuas with cladding capped by stones, armed', () => {
    const { ctx, state } = build({ flags: { hiisi_woken: true, stones: 1 } })
    onArrive(ctx)
    const h = hiisiOf(state)
    assert.deepEqual({ x: h.x, y: h.y }, KC)
    assert.equal(h.clad, 1)
    assert.equal(h.weaponId, 'maul')
    onArrive(ctx)
    assert.equal(state.entities.filter(e => e.type === 'kivihiisi').length, 1, 'never doubled')
  })
  it('after the kill: no arena changes, the hammer waits at the kiuas unless carried', () => {
    const { ctx, state } = build({ flags: { hiisi_dead: true } })
    onArrive(ctx)
    assert.equal(hiisiOf(state), null)
    assert.deepEqual({ x: hammerOf(state).x, y: hammerOf(state).y }, KC)
    assert.equal(itemFromContents(hammerOf(state).contents)?.payload?.weaponType, HAMMER)
    onArrive(ctx)
    assert.equal(state.entities.filter(e => e.type === 'floating_item').length, 1)
    const held = build({ flags: { hiisi_dead: true }, weapon: weaponContents(HAMMER) })
    onArrive(held.ctx)
    assert.equal(hammerOf(held.state), null)
  })
})

const moveTo = (state, c) => { state.player.x = c.x; state.player.y = c.y; state.player.px = c.x * S + 16; state.player.py = c.y * S + 16 }

// Adventure has no other pick — no loot pool rolls one — so the quest's
// first step is only reachable because the hermit left his by the door.
describe("the hermit's pick", () => {
  it('a fresh arrival leaves the pick by the hut — on a walkable cell, not under the player', () => {
    const { ctx, state } = build()                        // the player stands at the hut cell itself
    onArrive(ctx)
    const pick = pickOf(state)
    assert.ok(pick, 'a pick lies by the hut')
    assert.ok(Math.abs(pick.x - HUT.x) <= 2 && Math.abs(pick.y - HUT.y) <= 2, 'within two cells of the hut')
    assert.notDeepEqual({ x: pick.x, y: pick.y }, { x: state.player.x, y: state.player.y }, 'never under the player')
    assert.equal(state.map[pick.y][pick.x].tile, TILE.FLOOR)
    assert.equal(itemFromContents(pick.contents)?.payload?.weaponType, PICK_TYPE, 'rebuilds into a pick')
  })
  it("is never laid on the hut's own cell — that is its door, and a step onto it enters the house", () => {
    const { ctx, state } = build({ at: { x: 12, y: 12 } })   // the player elsewhere, so the door is the nearest walkable cell
    onArrive(ctx)
    const pick = pickOf(state)
    assert.ok(pick)
    assert.notDeepEqual({ x: pick.x, y: pick.y }, HUT, 'beside the door, not on it')
    assert.ok(Math.abs(pick.x - HUT.x) <= 1 && Math.abs(pick.y - HUT.y) <= 1, 'one cell off the door')
  })
  it('is never doubled on a repeat arrival', () => {
    const { ctx, state } = build()
    onArrive(ctx); onArrive(ctx)
    assert.equal(state.entities.filter(e => e.contents?.weaponType === PICK_TYPE).length, 1)
  })
  it('is not dropped when the player already has one, in hand or in the sack', () => {
    const inHand = build({ weapon: weaponContents(PICK_TYPE) })
    onArrive(inHand.ctx)
    assert.equal(pickOf(inHand.state), null)
    const inSack = build({ inventory: [itemFromContents({ type: 'weapon', ...weaponContents(PICK_TYPE) })] })
    onArrive(inSack.ctx)
    assert.equal(pickOf(inSack.state), null)
  })
  it('keeps coming back while the Hiisi lives, and stops once it is dead', () => {
    const woken = build({ flags: { hiisi_woken: true, stones: 3 } })
    onArrive(woken.ctx)
    assert.ok(pickOf(woken.state), 'the ring still needs mining after the wake')
    const dead = build({ flags: { hiisi_dead: true } })
    onArrive(dead.ctx)
    assert.equal(pickOf(dead.state), null)
  })
})

describe('the wake', () => {
  it('coming near the oven marks it found, once', () => {
    const { ctx, state, save, calls } = build()
    onArrive(ctx)
    moveTo(state, { x: KC.x - 4, y: KC.y })
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).kiuas_found, true)
    const n = calls.persist
    tick(ctx, 0.1)
    assert.equal(calls.persist, n)
  })
  it('mining the capstone wakes the Hiisi at the kiuas, armed and fully clad, with a toast', () => {
    const { ctx, state, save } = build()
    onArrive(ctx)
    mineOut(state, KC)
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).hiisi_woken, true)
    const h = hiisiOf(state)
    assert.deepEqual({ x: h.x, y: h.y }, KC)
    assert.equal(h.clad, CLAD_MAX)
    assert.equal(h.weaponId, 'maul')
    assert.equal(state.feedback.toasts.length, 1)
    assert.ok(state.sfx.cues.some(c => c.name === 'erupt'))
  })
  it('a standing capstone wakes nothing', () => {
    const { ctx, state, save } = build()
    onArrive(ctx)
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).hiisi_woken, undefined)
    assert.equal(hiisiOf(state), null)
  })
})

describe('the standing stones', () => {
  it('a mined ring boulder comes off the count, once', () => {
    const { ctx, state, save, calls } = build({ flags: { hiisi_woken: true } })
    onArrive(ctx)
    mineOut(state, ringCell(2))
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).stones, 5)
    const n = calls.persist
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).stones, 5)
    assert.equal(calls.persist, n)
  })
  it('the Hiisi cannot wear more stone than stands; mine the ring out and it wears none', () => {
    const { ctx, state, save } = build({ flags: { hiisi_woken: true } })
    onArrive(ctx)
    const h = hiisiOf(state)
    assert.equal(h.clad, 3)
    for (let i = 0; i < RING_STONES; i++) mineOut(state, ringCell(i))
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).stones, 0)
    assert.equal(h.clad, 0)
    for (let t = 0; t < 30; t += 0.5) tick(ctx, 0.5)
    assert.equal(h.clad, 0, 'no re-clad with nothing standing')
  })
  it('boulders mined before the wake come off the count', () => {
    const { ctx, state, save, calls } = build()
    onArrive(ctx)
    mineOut(state, ringCell(0))
    mineOut(state, ringCell(1))
    const n = calls.persist
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).stones, 4)
    assert.equal(questFlags(save, mapData.name).hiisi_woken, undefined)
    assert.equal(calls.persist, n + 1, 'one persist for both stones mined this tick')
    mineOut(state, KC)
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).hiisi_woken, true)
    assert.equal(hiisiOf(state).clad, 3)
  })
  it('re-clads a layer every six seconds while stones stand', () => {
    const { ctx, state } = build({ flags: { hiisi_woken: true } })
    onArrive(ctx)
    const h = hiisiOf(state)
    h.clad = 0
    for (let t = 0; t < 6.5; t += 0.5) tick(ctx, 0.5)
    assert.equal(h.clad, 1)
  })
})

describe('the kill and the hammer', () => {
  it('a recorded kill sets the flag, drops the hammer where the Hiisi fell, and toasts — once', () => {
    const { ctx, state, save, calls } = build({ flags: { hiisi_woken: true, stones: 0 } })
    onArrive(ctx)
    const h = hiisiOf(state)
    h.x = KC.x + 5; h.y = KC.y + 1; h.px = h.x * S + 16; h.py = h.y * S + 16   // kited off the oven
    h.hp = 0; h.dying = 0.7
    state.creatureKills = { kivihiisi: true }
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).hiisi_dead, true)
    assert.deepEqual({ x: hammerOf(state).x, y: hammerOf(state).y }, { x: KC.x + 5, y: KC.y + 1 })
    assert.equal(state.feedback.toasts.length, 1)
    const n = calls.persist
    tick(ctx, 0.1)
    assert.equal(calls.persist, n)
  })
  it('a finished quest ticks quietly', () => {
    const { ctx, calls } = build({ flags: { hiisi_dead: true } })
    tick(ctx, 0.1)
    assert.equal(calls.persist, 0)
  })
})
