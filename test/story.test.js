import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { storyFlags, setStoryFlag, poiCell, makeCtx, checkDeliveries } from '../renderer/systems/story.js'
import { makeItem } from '../renderer/systems/inventory.js'

const mapData = { name: 'test-map', pois: [{ kind: 'landmark', x: 4, y: 7, label: 'shrine' }] }

describe('story flags', () => {
  it('creates the per-map record on demand and writes through', () => {
    const record = {}
    assert.deepEqual(storyFlags(record, 'test-map'), {})
    setStoryFlag(record, 'test-map', 'seen')
    setStoryFlag(record, 'test-map', 'count', 3)
    assert.deepEqual(record, { 'test-map': { flags: { seen: true, count: 3 } } })
  })
  it('keeps two maps apart', () => {
    const record = {}
    setStoryFlag(record, 'a', 'x')
    setStoryFlag(record, 'b', 'y')
    assert.deepEqual(storyFlags(record, 'a'), { x: true })
    assert.deepEqual(storyFlags(record, 'b'), { y: true })
  })
})

describe('poiCell', () => {
  it('finds a POI by label and returns null for an unknown one', () => {
    assert.deepEqual(poiCell(mapData, 'shrine'), { x: 4, y: 7 })
    assert.equal(poiCell(mapData, 'nowhere'), null)
  })
})

describe('makeCtx', () => {
  const build = (over = {}) => {
    const record = {}
    let live = { tag: 'first' }
    const ctx = makeCtx({
      getState: () => live, save: { quests: record }, record, mapData,
      persist: () => {}, refreshInventory: () => {}, spawn: () => {}, ...over,
    })
    return { ctx, record, swap: next => { live = next } }
  }

  it('reads the live state through a getter, not a captured value', () => {
    const { ctx, swap } = build()
    assert.equal(ctx.state.tag, 'first')
    swap({ tag: 'second' })
    assert.equal(ctx.state.tag, 'second')
  })
  it('set writes into the record and fires onFlag', () => {
    const seen = []
    const { ctx, record } = build({ onFlag: (f, v) => seen.push([f, v]) })
    ctx.set('lit')
    ctx.set('count', 2)
    assert.deepEqual(record['test-map'].flags, { lit: true, count: 2 })
    assert.deepEqual(seen, [['lit', true], ['count', 2]])
    assert.equal(ctx.flags.lit, true)
  })
  it('spreads extra fields onto the ctx', () => {
    const { ctx } = build({ extra: { episode: { persona: 'Toivo' } } })
    assert.equal(ctx.episode.persona, 'Toivo')
  })
  it('works with no onFlag supplied', () => {
    const { ctx, record } = build()
    ctx.set('ok')
    assert.equal(record['test-map'].flags.ok, true)
  })
})

describe('checkDeliveries', () => {
  const deliveries = [{ item: 'hide', to: { poi: 'shrine' }, sets: 'given' }]
  const build = () => {
    const record = {}
    const state = {
      player: { x: 4, y: 7, inventory: [makeItem('mushroom'), { kind: 'hide', name: 'Hide', stackable: true, count: 1 }] },
      entities: [],
    }
    const ctx = makeCtx({ getState: () => state, save: {}, record, mapData,
      persist: () => {}, refreshInventory: () => {}, spawn: () => {} })
    return { ctx, state, record }
  }

  it('spends exactly one item and sets the flag when the player stands on the POI', () => {
    const { ctx, state, record } = build()
    const d = checkDeliveries(ctx, deliveries)
    assert.equal(d, deliveries[0])
    assert.equal(state.player.inventory.some(i => i.kind === 'hide'), false)
    assert.equal(record['test-map'].flags.given, true)
  })
  it('does nothing off the POI, and nothing twice', () => {
    const { ctx, state } = build()
    state.player.x = 0
    assert.equal(checkDeliveries(ctx, deliveries), null)
    state.player.x = 4
    assert.equal(checkDeliveries(ctx, deliveries), deliveries[0])
    assert.equal(checkDeliveries(ctx, deliveries), null)
  })
  it('delivers beside an npc of the named species', () => {
    const { ctx, state } = build()
    state.player.x = 0; state.player.y = 0
    state.entities.push({ type: 'npc', species: 'elder', x: 1, y: 0, hostile: false })
    assert.equal(checkDeliveries(ctx, [{ item: 'hide', to: { species: 'elder' }, sets: 'given' }])?.sets, 'given')
  })
})
