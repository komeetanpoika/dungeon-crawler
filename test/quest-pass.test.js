import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { onArrive, tick, KIUAS, RING, RING_STONES, CAPSTONE, HAMMER, stampBoulder } from '../renderer/systems/quests/pass.js'
import { makeQuestCtx, questFlags } from '../renderer/systems/quests.js'
import { normalizeAdventureSave } from '../renderer/systems/adventure.js'
import { ensureKivihiisi, CLAD_MAX } from '../renderer/systems/monsters/kivihiisi.js'
import { harvest } from '../renderer/systems/lumber.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE, weaponContents } from '../renderer/systems/entities.js'
import { itemFromContents } from '../renderer/systems/inventory.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const S = 32
const N = 40
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
      if (s.kind === 'kivihiisi') state.entities.push({ type: 'kivihiisi', x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16, hp: 40, maxHp: 40, damage: 3 })
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
