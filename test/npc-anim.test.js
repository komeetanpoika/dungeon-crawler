import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tickNpcAnim, npcFrame, STRIDE, RUN_GOALS } from '../renderer/systems/npc-anim.js'
import { SHEET } from '../renderer/assets/npcs/wolf-sheet.js'

const wolf = (over = {}) => ({ ai: { current: 'wander' }, ...over })
const walkFor = (e, px) => { tickNpcAnim(e, px, 0.016); return e }

describe('tickNpcAnim', () => {
  it('accumulates travelled distance and resets the still timer while moving', () => {
    const e = wolf()
    tickNpcAnim(e, 3, 0.016)
    tickNpcAnim(e, 2, 0.016)
    assert.equal(e.anim.dist, 5)
    assert.equal(e.anim.still, 0)
  })
  it('counts time standing still without touching the distance', () => {
    const e = walkFor(wolf(), 5)
    tickNpcAnim(e, 0, 0.05)
    tickNpcAnim(e, 0.001, 0.05)     // sub-pixel jitter is not movement
    assert.equal(e.anim.dist, 5)
    assert.ok(Math.abs(e.anim.still - 0.1) < 1e-9)
  })
})

describe('npcFrame', () => {
  it('holds the first walk frame before any movement and once settled', () => {
    assert.deepEqual(npcFrame(wolf(), SHEET), { row: 'walk', frame: 0 })
    const e = walkFor(wolf(), STRIDE.walk * 3)
    tickNpcAnim(e, 0, 0.2)
    assert.deepEqual(npcFrame(e, SHEET), { row: 'walk', frame: 0 })
  })
  it('steps one walk frame per stride of travel and wraps', () => {
    const e = wolf()
    const seen = []
    for (let i = 0; i < SHEET.rows.walk.frames + 1; i++) { walkFor(e, STRIDE.walk); seen.push(npcFrame(e, SHEET).frame) }
    assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 0, 1])
  })
  it('gallops on the chase goals and trots on the rest', () => {
    for (const goal of RUN_GOALS) assert.equal(npcFrame(walkFor(wolf({ ai: { current: goal } }), 1), SHEET).row, 'run')
    for (const goal of ['wander', 'go_to', undefined]) assert.equal(npcFrame(walkFor(wolf({ ai: { current: goal } }), 1), SHEET).row, 'walk')
  })
  it('the run row has its own, longer stride', () => {
    const e = walkFor(wolf({ ai: { current: 'hunt_prey' } }), STRIDE.run * 2)
    assert.deepEqual(npcFrame(e, SHEET), { row: 'run', frame: 2 })
  })
  it('shows the bite while a claw swing is in flight, whatever else is going on', () => {
    const e = walkFor(wolf({ ai: { current: 'hunt_prey' }, attack: { phase: 'swing' } }), 30)
    assert.deepEqual(npcFrame(e, SHEET), { row: 'bite', frame: 0 })
    e.attack.phase = 'windup'
    assert.equal(npcFrame(e, SHEET).row, 'run')
  })
  it('degrades to the walk row on a sheet without run or bite rows', () => {
    const sheet = { rows: { walk: { row: 0, frames: 2 } } }
    const e = walkFor(wolf({ ai: { current: 'hunt_prey' }, attack: { phase: 'swing' } }), STRIDE.walk)
    assert.deepEqual(npcFrame(e, sheet), { row: 'walk', frame: 1 })
  })
})
