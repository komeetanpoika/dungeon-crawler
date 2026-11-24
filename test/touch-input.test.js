import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { joystickDirs, diffDirs } from '../renderer/ui/touch-input.js'

describe('joystickDirs', () => {
  it('returns [] inside the dead zone', () => {
    assert.deepEqual(joystickDirs(0, 0), [])
    assert.deepEqual(joystickDirs(5, 5), [])
    assert.deepEqual(joystickDirs(-11, 0), [])
  })

  it('activates at the dead-zone radius', () => {
    assert.deepEqual(joystickDirs(12, 0), ['d'])
  })

  it('maps the four cardinals (screen coords: +y is down/south)', () => {
    assert.deepEqual(joystickDirs(40, 0), ['d'])   // east
    assert.deepEqual(joystickDirs(0, 40), ['s'])   // south
    assert.deepEqual(joystickDirs(-40, 0), ['a'])  // west
    assert.deepEqual(joystickDirs(0, -40), ['w'])  // north
  })

  it('maps the four diagonals', () => {
    assert.deepEqual(joystickDirs(40, 40), ['d', 's'])
    assert.deepEqual(joystickDirs(-40, 40), ['s', 'a'])
    assert.deepEqual(joystickDirs(-40, -40), ['a', 'w'])
    assert.deepEqual(joystickDirs(40, -40), ['d', 'w'])
  })

  it('quantizes to the nearest of 8 sectors (45° each)', () => {
    // 15° below east -> still east; 30° below east -> southeast diagonal
    assert.deepEqual(joystickDirs(100, Math.tan(Math.PI / 12) * 100), ['d'])
    assert.deepEqual(joystickDirs(100, Math.tan(Math.PI / 6) * 100), ['d', 's'])
  })

  it('honors a custom dead zone', () => {
    assert.deepEqual(joystickDirs(20, 0, 30), [])
    assert.deepEqual(joystickDirs(35, 0, 30), ['d'])
  })
})

describe('diffDirs', () => {
  it('reports newly pressed and released dirs', () => {
    assert.deepEqual(diffDirs(['d'], ['d', 's']), { press: ['s'], release: [] })
    assert.deepEqual(diffDirs(['d', 's'], ['s']), { press: [], release: ['d'] })
    assert.deepEqual(diffDirs(['a'], ['d']), { press: ['d'], release: ['a'] })
  })

  it('is empty for identical sets and for empty-to-empty', () => {
    assert.deepEqual(diffDirs(['w'], ['w']), { press: [], release: [] })
    assert.deepEqual(diffDirs([], []), { press: [], release: [] })
  })

  it('handles full press from rest and full release to rest', () => {
    assert.deepEqual(diffDirs([], ['d', 's']), { press: ['d', 's'], release: [] })
    assert.deepEqual(diffDirs(['d', 's'], []), { press: [], release: ['d', 's'] })
  })
})

import { makeTapSprint } from '../renderer/ui/touch-input.js'

describe('makeTapSprint', () => {
  it('a tap and a second touch soon after sprints while that touch lasts', () => {
    const s = makeTapSprint()
    assert.equal(s.down(1.00), false)
    s.up(1.10)
    assert.equal(s.down(1.30), true)
    assert.equal(s.sprinting(), true)
    s.up(4.00)
    assert.equal(s.sprinting(), false)
  })
  it('one long push never sprints, wherever the stick is', () => {
    const s = makeTapSprint()
    s.down(1)
    assert.equal(s.sprinting(), false)
  })
  it('a long walk let go and taken up again is only walking', () => {
    const s = makeTapSprint()
    s.down(1); s.up(3)
    assert.equal(s.down(3.1), false)
  })
  it('a second touch that comes too late is only walking', () => {
    const s = makeTapSprint()
    s.down(1); s.up(1.1)
    assert.equal(s.down(1.5), false)
  })
  it('after a sprint it takes a new tap to sprint again', () => {
    const s = makeTapSprint()
    s.down(1); s.up(1.1); s.down(1.2); s.up(1.25)
    assert.equal(s.down(1.3), false)
    s.up(1.4)
    assert.equal(s.down(1.5), true)
  })
  it('reset forgets a tap', () => {
    const s = makeTapSprint()
    s.down(1); s.up(1.1); s.reset()
    assert.equal(s.down(1.2), false)
  })
})
