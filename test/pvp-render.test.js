import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { otherHeroes } from '../renderer/render/canvas.js'

describe('otherHeroes', () => {
  const map = [[{ visible: true }, { visible: false }]]
  const me = { id: 'me', x: 0, y: 0 }
  it('lists visible, living heroes other than the local one', () => {
    const seen = { id: 'a', x: 0, y: 0 }, hidden = { id: 'b', x: 1, y: 0 }, dead = { id: 'c', x: 0, y: 0, dead: true }
    assert.deepEqual(otherHeroes({ map, player: me, heroes: [me, seen, hidden, dead] }).map(h => h.id), ['a'])
  })
  it('is empty in single-player (no heroes)', () => {
    assert.deepEqual(otherHeroes({ map, player: me }), [])
  })
})
