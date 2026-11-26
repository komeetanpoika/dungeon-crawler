// Päivölä in the Wilds: where the puzzle houses stand, and that a solved one
// stays solved (and its reward taken stays taken) across a save, a generator
// change included.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeWorld, exportWorld, GEN } from '../renderer/wilds/world.js'
import { generatePiece } from '../renderer/wilds/piece.js'
import { villageAt } from '../renderer/wilds/layout.js'
import { houseSpec } from '../renderer/interior/versions.js'

test('the home village always has the glassmaker\'s house: its big house', () => {
  for (const seed of [1, 7, 12345, 99]) {
    const doors = generatePiece(seed, 0, 0, 0).doors
    const sun = doors.filter(d => d.kind === 'sunroom')
    assert.equal(sun.length, 1, `seed ${seed}`)
    assert.equal(sun[0].look.w, 5)
    assert.equal(sun[0].tier, 'safe')
    assert.equal(houseSpec(sun[0]).version, 'sunroom')
    assert.ok(['large', 'grand'].includes(houseSpec(sun[0]).size))
  }
})

test('about one other village in four has one, and nothing else is ever one', () => {
  let villages = 0, with_ = 0
  for (let wx = -12; wx <= 12; wx++) for (let wy = -12; wy <= 12; wy++) {
    if ((wx === 0 && wy === 0) || !villageAt(5, wx, wy)) continue
    const doors = generatePiece(5, wx, wy, 0).doors
    villages++
    const n = doors.filter(d => d.kind === 'sunroom').length
    assert.ok(n <= 1)
    if (n) with_++
  }
  assert.ok(villages >= 12, `${villages} villages`)
  assert.ok(with_ / villages > 0.1 && with_ / villages < 0.45, `${with_}/${villages}`)
  for (const [wx, wy] of [[1, 0], [0, -1], [2, 3], [-3, 1]]) if (!villageAt(5, wx, wy))
    assert.ok(!generatePiece(5, wx, wy, 0).doors.some(d => d.kind === 'sunroom'), `${wx},${wy}`)
})

test('a solved house and its taken reward are saved, and outlive a generator change', () => {
  const w = makeWorld(null, { seed: 3 })
  assert.equal(w.solved.size, 0); assert.equal(w.looted.size, 0)
  w.solved.add('house:wilds:6,-4'); w.looted.add('house:wilds:6,-4')
  const saved = JSON.parse(JSON.stringify(exportWorld(w)))
  const back = makeWorld(saved)
  assert.ok(back.solved.has('house:wilds:6,-4') && back.looted.has('house:wilds:6,-4'))
  const older = makeWorld({ ...saved, gen: GEN - 1 })
  assert.ok(older.solved.has('house:wilds:6,-4') && older.looted.has('house:wilds:6,-4'))
  const junk = makeWorld({ ...saved, solved: [3, null, 'house:wilds:1,1'], looted: 'nope' })
  assert.deepEqual([...junk.solved], ['house:wilds:1,1']); assert.equal(junk.looted.size, 0)
})
