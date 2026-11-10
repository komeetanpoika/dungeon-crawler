import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { startAnim, addPhase, deletePhase, setTime, setHit, setName, setPieces, resetPieces, resetCard, toSaved, timingSummary } from '../tools/monster-studio/anim-edit.js'

describe('anim-edit', () => {
  it('builds the strike from the spec: add, pose, time, hit', () => {
    let { anims, index } = addPhase({}, 'attack', 0)
    assert.equal(index, 1)
    assert.equal(anims.attack.phases[1].hit, true)               // first extra attack phase is the hit
    anims = setPieces(anims, 'attack', 1, ['arm_r', 'arm_l'], { turn: -25, stretch: 1 })
    ;({ anims } = addPhase(anims, 'attack', 1))
    assert.deepEqual(anims.attack.phases[2].pose, anims.attack.phases[1].pose)   // a copy of the selected card
    assert.notEqual(anims.attack.phases[2].pose, anims.attack.phases[1].pose)
    assert.equal(anims.attack.phases[2].hit, undefined)
    anims = setHit(anims, 2)
    assert.deepEqual(anims.attack.phases.map(p => !!p.hit), [false, false, true])
    anims = setTime(anims, 'attack', 2, 0.001)
    assert.equal(anims.attack.phases[2].time, 0.03)
    anims = setName(anims, 'attack', 2, '  Slam  ')
    assert.equal(anims.attack.phases[2].name, 'Slam')
    const s = timingSummary(anims.attack, 'attack')
    assert.deepEqual(s.moves.map(m => m.index), [1, 2, 0])
    assert.ok(Math.abs(s.windup - (0.2 + 0.03)) < 1e-9)
    assert.ok(Math.abs(s.followThrough - 0.3) < 1e-9)
  })
  it('deleting the hit moves it to the last card; the first card cannot be deleted', () => {
    let { anims } = addPhase({}, 'attack', 0)
    ;({ anims } = addPhase(anims, 'attack', 1))
    anims = deletePhase(anims, 'attack', 1)
    assert.deepEqual(anims.attack.phases.map(p => !!p.hit), [false, true])
    assert.deepEqual(deletePhase(anims, 'attack', 0), anims)
  })
  it('walk has no hit; reset piece and card', () => {
    let { anims } = addPhase({}, 'walk', 0)
    assert.equal(anims.walk.phases[1].hit, undefined)
    anims = setPieces(anims, 'walk', 1, ['leg_l', 'leg_r'], { turn: 20, stretch: 0.8 })
    assert.deepEqual(resetPieces(anims, 'walk', 1, ['leg_l']).walk.phases[1].pose, { leg_r: { turn: 20, stretch: 0.8 } })
    assert.deepEqual(resetCard(anims, 'walk', 1).walk.phases[1].pose, {})
    assert.equal(timingSummary(anims.walk, 'walk').windup, undefined)
  })
  it('toSaved is sparse, rounded, and prunes pieces a re-cut removed (Review Focus 2)', () => {
    const anims = { idle: startAnim(), walk: { phases: [] }, attack: { phases: [
      { time: 0.3, pose: { arm_l: { turn: 0, stretch: 1 } } },
      { time: 0.123456, hit: true, pose: { arm_l: { turn: 12.345, stretch: 1.23456 }, gone: { turn: 9, stretch: 1 } } },
    ] } }
    assert.deepEqual(toSaved(anims, ['arm_l', 'arm_r']), {
      idle: { phases: [{ time: 0.3, pose: {} }] },
      attack: { phases: [{ time: 0.3, pose: {} }, { time: 0.12, hit: true, pose: { arm_l: { turn: 12.3, stretch: 1.23 } } }] },
    })
  })
  it('an active attack with no hit is reported', () => {
    assert.equal(timingSummary({ phases: [{ time: 0.3, pose: {} }, { time: 0.2, pose: {} }] }, 'attack').missingHit, true)
  })
})
