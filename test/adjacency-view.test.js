import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { adjacencyViewModel, overlaysViewModel } from '../tools/tile-editor/adjacency-view.js'

describe('adjacencyViewModel', () => {
  it('sorts each direction by count desc (name tie-break), frac vs per-dir max', () => {
    const def = { adjacency: {
      n: { 'floor.moss': 8, 'floor.dirt': 2 },
      e: { 'b.tag': 3, 'a.tag': 3 },   // tie → name asc
      s: {},
      w: { x: 0 },                     // zero dropped
    } }
    const vm = adjacencyViewModel(def)
    assert.deepEqual(vm.n, [
      { tag: 'floor.moss', count: 8, frac: 1 },
      { tag: 'floor.dirt', count: 2, frac: 0.25 },
    ])
    assert.deepEqual(vm.e.map(r => r.tag), ['a.tag', 'b.tag'])
    assert.equal(vm.e[0].frac, 1)
    assert.deepEqual(vm.s, [])
    assert.deepEqual(vm.w, [])
  })

  it('returns four empty lists when adjacency is absent', () => {
    assert.deepEqual(adjacencyViewModel({ role: 'floor' }), { n: [], e: [], s: [], w: [] })
  })
})

describe('overlaysViewModel', () => {
  it('is null when the tag has no overlays', () => {
    assert.equal(overlaysViewModel({ role: 'floor' }), null)
  })

  it('renders the empty key as (none), sorted desc, frac vs max', () => {
    const vm = overlaysViewModel({ overlays: { '': 6, 'overlay.barrel': 2, x: 0 } })
    assert.deepEqual(vm, [
      { tag: '(none)', count: 6, frac: 1 },
      { tag: 'overlay.barrel', count: 2, frac: 1 / 3 },
    ])
  })

  it('is an empty array for an empty overlays object', () => {
    assert.deepEqual(overlaysViewModel({ overlays: {} }), [])
  })
})
