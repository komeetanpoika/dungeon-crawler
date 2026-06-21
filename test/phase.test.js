import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PHASE, canTransition } from '../renderer/systems/phase.js'

describe('PHASE', () => {
  it('has the four phases', () => {
    assert.deepEqual(
      [PHASE.TITLE, PHASE.PLAYING, PHASE.PAUSED, PHASE.GAMEOVER],
      ['title', 'playing', 'paused', 'gameover'],
    )
  })
})

describe('canTransition', () => {
  it('allows the intended transitions', () => {
    assert.equal(canTransition('title', 'playing'), true)
    assert.equal(canTransition('playing', 'paused'), true)
    assert.equal(canTransition('playing', 'gameover'), true)
    assert.equal(canTransition('paused', 'playing'), true)
    assert.equal(canTransition('paused', 'title'), true)
    assert.equal(canTransition('gameover', 'playing'), true)
    assert.equal(canTransition('gameover', 'title'), true)
  })

  it('rejects disallowed transitions', () => {
    assert.equal(canTransition('title', 'paused'), false)
    assert.equal(canTransition('title', 'gameover'), false)
    assert.equal(canTransition('playing', 'title'), false)
    assert.equal(canTransition('paused', 'gameover'), false)
    assert.equal(canTransition('gameover', 'paused'), false)
    assert.equal(canTransition('nonsense', 'playing'), false)
  })
})
