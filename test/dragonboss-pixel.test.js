import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeDragonBoss } from '../renderer/systems/dragonboss.js'
import { dragonCapsules } from '../renderer/systems/capsules.js'
import { buildArena } from '../renderer/systems/map.js'
import { TEMPLATE_LEGEND } from '../renderer/data/levels.js'
import { dragonPartPlacements, drawDragonBossPixel } from '../renderer/render/dragonboss-pixel.js'
import { PARTS, SHEET_SPRITE } from '../renderer/data/dragon-parts.js'
import { drawBossBySkin } from '../renderer/render/canvas.js'

const T = 32
const quiet = () => {}

describe('makeDragonBoss skin option', () => {
  it('defaults to no skin', () => {
    const e = makeDragonBoss(4, 5)
    assert.equal(e.type, 'dragon_boss')
    assert.equal(e.skin, undefined)
  })

  it('carries an explicit skin without changing the type', () => {
    const e = makeDragonBoss(4, 5, { skin: 'pixel' })
    assert.equal(e.type, 'dragon_boss')
    assert.equal(e.skin, 'pixel')
  })
})

describe('hitbox parity', () => {
  const poses = [
    { neckRear: 0,   headAim: 0,    tailSwing: 0,    facing: 0 },
    { neckRear: 1,   headAim: 0.7,  tailSwing: -0.6, facing: Math.PI / 3 },
    { neckRear: 0.4, headAim: -0.7, tailSwing: 1.0,  facing: -2.1 },
  ]

  it('capsules are identical with and without the pixel skin', () => {
    for (const pose of poses) {
      const plain = { ...makeDragonBoss(10, 10), px: 10 * T, py: 10 * T, ...pose }
      const pixel = { ...makeDragonBoss(10, 10, { skin: 'pixel' }), px: 10 * T, py: 10 * T, ...pose }
      assert.deepEqual(dragonCapsules(pixel), dragonCapsules(plain))
    }
  })
})

describe('arena spawns the pixel boss', () => {
  it('accepts dragon_boss_pixel as an enemy kind', () => {
    const { entitySpawns } = buildArena({ enemies: [{ kind: 'dragon_boss_pixel', x: 5, y: 5 }] }, quiet)
    const spawns = entitySpawns.filter(s => s.kind === 'dragon_boss_pixel')
    assert.equal(spawns.length, 1)
    assert.equal(spawns[0].x, 5)
    assert.equal(spawns[0].y, 5)
  })

  it('still warns on a genuinely unknown kind', () => {
    const warnings = []
    buildArena({ enemies: [{ kind: 'not_a_thing' }] }, m => warnings.push(m))
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /not_a_thing/)
  })
})

describe('template legend', () => {
  it("'Q' spawns the pixel boss and 'B' still spawns the original", () => {
    assert.equal(TEMPLATE_LEGEND.Q.spawn, 'dragon_boss_pixel')
    assert.equal(TEMPLATE_LEGEND.Q.single, true)
    assert.equal(TEMPLATE_LEGEND.B.spawn, 'dragon_boss')
  })
})

const pose = (over = {}) => ({
  ...makeDragonBoss(10, 10, { skin: 'pixel' }),
  px: 10 * T, py: 10 * T, breathTime: 0, state: 'idle', ...over,
})

describe('dragonPartPlacements', () => {
  it('names only parts that exist in the sheet', () => {
    for (const p of dragonPartPlacements(pose(), T)) {
      assert.ok(PARTS[p.part], `placement references unknown part "${p.part}"`)
    }
  })

  it('places four feet, five neck plates, five tail plates and one tail tip', () => {
    const counts = {}
    for (const p of dragonPartPlacements(pose(), T)) counts[p.part] = (counts[p.part] ?? 0) + 1
    assert.equal(counts.foot, 4)
    assert.equal(counts.tail_tip, 1)
    assert.equal(counts.body, 1)
    assert.equal(counts.head, 1)
    assert.equal(counts.wing, 2)
    for (let i = 0; i < 5; i++) {
      assert.equal(counts[`neck${i}`], 1, `neck${i}`)
      assert.equal(counts[`tail${i}`], 1, `tail${i}`)
    }
  })

  it('snaps every position to a whole art pixel', () => {
    for (const p of dragonPartPlacements(pose({ breathTime: 1.37, tailSwing: 0.4 }), T)) {
      assert.ok(Number.isInteger(p.x), `${p.part} x=${p.x} is not an integer`)
      assert.ok(Number.isInteger(p.y), `${p.part} y=${p.y} is not an integer`)
    }
  })

  it('draws the flame cone only while breathing', () => {
    const has = st => dragonPartPlacements(pose({ state: st }), T).some(p => p.part === 'flame')
    assert.equal(has('idle'), false)
    assert.equal(has('cone'), true)
    assert.equal(has('sweep'), true)
  })

  it('draws parts back-to-front: feet, tail, neck, body, head, wings', () => {
    const order = dragonPartPlacements(pose(), T).map(p => p.part)
    const firstOf = pred => order.findIndex(pred)
    assert.ok(firstOf(p => p === 'foot') < firstOf(p => p === 'tail0'), 'feet before tail')
    assert.ok(firstOf(p => p === 'tail0') < firstOf(p => p === 'neck0'), 'tail before neck')
    assert.ok(firstOf(p => p === 'neck0') < firstOf(p => p === 'body'), 'neck before body')
    assert.ok(firstOf(p => p === 'body') < firstOf(p => p === 'head'), 'body before head')
    assert.ok(firstOf(p => p === 'head') < firstOf(p => p === 'wing'), 'head before wings')
  })

  // scaledChain() draws its plates with an ASCENDING loop (dragonboss.js:77), so
  // plate 0 is the bottom layer and the tip sits on top. Getting this backwards
  // flips which way the overlapping shingles read, and nothing else here notices.
  it('layers each chain tip-over-base, matching scaledChain', () => {
    const order = dragonPartPlacements(pose(), T).map(p => p.part)
    assert.ok(order.indexOf('neck0') < order.indexOf('neck4'), 'neck0 under neck4')
    assert.ok(order.indexOf('tail0') < order.indexOf('tail_tip'), 'tail0 under the tail tip')
    for (let i = 0; i < 4; i++) {
      assert.ok(order.indexOf(`neck${i}`) < order.indexOf(`neck${i + 1}`), `neck${i} under neck${i + 1}`)
      assert.ok(order.indexOf(`tail${i}`) < order.indexOf(`tail${i + 1}`), `tail${i} under tail${i + 1}`)
    }
    assert.ok(order.indexOf('tail4') < order.indexOf('tail_tip'), 'tail4 under the tail tip')
  })

  it('mirrors one wing and not the other', () => {
    const wings = dragonPartPlacements(pose(), T).filter(p => p.part === 'wing')
    assert.equal(wings.length, 2)
    assert.notEqual(wings[0].flipX, wings[1].flipX)
  })

  it('swings the tail when tailSwing changes', () => {
    const still = dragonPartPlacements(pose({ tailSwing: 0 }), T).find(p => p.part === 'tail_tip')
    const swung = dragonPartPlacements(pose({ tailSwing: 1 }), T).find(p => p.part === 'tail_tip')
    assert.notEqual(still.x, swung.x)
  })

  it('is independent of facing — the buffer is rotated as a whole', () => {
    const a = dragonPartPlacements(pose({ facing: 0 }), T)
    const b = dragonPartPlacements(pose({ facing: 2 }), T)
    assert.deepEqual(a, b)
  })
})

// Enough of a 2D context to run the compositor: it models save/restore of
// imageSmoothingEnabled, which is the drawing state the boss must not leak,
// and it keeps an ordered log of every call (name + args) so tests can assert
// on sequencing (e.g. clearRect before any drawImage) and on arguments (e.g.
// the sheet image, or a rotate angle) without pretending to be a real canvas.
const fakeCtx = () => {
  const stack = []
  const c = {
    imageSmoothingEnabled: false, draws: 0, calls: [],
    save() { stack.push(c.imageSmoothingEnabled); c.calls.push({ name: 'save', args: [] }) },
    restore() { c.imageSmoothingEnabled = stack.pop(); c.calls.push({ name: 'restore', args: [] }) },
    translate(...args) { c.calls.push({ name: 'translate', args }) },
    rotate(...args) { c.calls.push({ name: 'rotate', args }) },
    scale(...args) { c.calls.push({ name: 'scale', args }) },
    clearRect(...args) { c.calls.push({ name: 'clearRect', args }) },
    drawImage(...args) { c.draws++; c.calls.push({ name: 'drawImage', args }) },
  }
  return c
}

describe('drawBossBySkin', () => {
  it('routes a skinless boss to the vector renderer', () => {
    const seen = []
    drawBossBySkin({}, { type: 'dragon_boss', px: 0, py: 0 }, 0, 0, T, {},
      { vector: () => seen.push('vector'), pixel: () => seen.push('pixel') })
    assert.deepEqual(seen, ['vector'])
  })

  it('routes a pixel-skinned boss to the pixel renderer', () => {
    const seen = []
    drawBossBySkin({}, { type: 'dragon_boss', skin: 'pixel', px: 0, py: 0 }, 0, 0, T, {},
      { vector: () => seen.push('vector'), pixel: () => seen.push('pixel') })
    assert.deepEqual(seen, ['pixel'])
  })

  it('falls back to the vector renderer for an unknown skin', () => {
    const seen = []
    drawBossBySkin({}, { type: 'dragon_boss', skin: 'nonsense', px: 0, py: 0 }, 0, 0, T, {},
      { vector: () => seen.push('vector'), pixel: () => seen.push('pixel') })
    assert.deepEqual(seen, ['vector'])
  })
})

describe('drawDragonBossPixel', () => {
  it('leaves the caller canvas image smoothing as it found it', () => {
    const ctx = fakeCtx(), bufCtx = fakeCtx()
    // canvas.js turns smoothing off for the whole game (nearest-neighbour
    // tileset); if the boss turns it back on, every sprite drawn after it in
    // that frame blurs, and stays blurred until the next resize().
    ctx.imageSmoothingEnabled = false
    drawDragonBossPixel(ctx, pose(), 0, 0, T, { [SHEET_SPRITE]: {} },
                        { width: 0, height: 0, getContext: () => bufCtx })
    // 19 PLACEMENTS, not 19 parts: the sheet holds 16 frames, and the idle pose
    // draws the one foot four times, the one wing twice, and no flame at all.
    // Pinned as a literal on purpose — the test below derives the same number
    // from dragonPartPlacements(), so between them a change to the rig has to be
    // deliberate rather than absorbed on both sides at once.
    assert.equal(bufCtx.draws, 19, 'expected all 19 idle-pose placements composited into the buffer')
    assert.equal(ctx.draws, 1, 'expected one blit of the finished buffer')
    assert.equal(ctx.imageSmoothingEnabled, false)
  })

  it('draws nothing when the parts sheet is missing', () => {
    const ctx = fakeCtx()
    drawDragonBossPixel(ctx, pose(), 0, 0, T, {}, { getContext: () => fakeCtx() })
    assert.equal(ctx.draws, 0)
  })

  it('clears the buffer before compositing anything into it', () => {
    // Without this, the previous frame's dragon ghosts through — and because
    // parts are drawn with rotation, the ghost is not even aligned.
    const ctx = fakeCtx(), bufCtx = fakeCtx()
    drawDragonBossPixel(ctx, pose(), 0, 0, T, { [SHEET_SPRITE]: 'SHEET' },
                        { width: 0, height: 0, getContext: () => bufCtx })
    assert.ok(bufCtx.calls.length > 0, 'expected the buffer context to record calls')
    assert.equal(bufCtx.calls[0].name, 'clearRect',
      'expected clearRect to be the first thing done to the buffer')
  })

  it('composites one part per placement, each sourced from the sheet', () => {
    // A wrong lookup key would silently draw the wrong sub-rectangle, or
    // nothing — this pins that every placement becomes exactly one drawImage
    // pulling from the sheet image.
    const ctx = fakeCtx(), bufCtx = fakeCtx()
    const sheet = 'SHEET'
    const e = pose()
    drawDragonBossPixel(ctx, e, 0, 0, T, { [SHEET_SPRITE]: sheet },
                        { width: 0, height: 0, getContext: () => bufCtx })
    const draws = bufCtx.calls.filter(c => c.name === 'drawImage')
    assert.equal(draws.length, dragonPartPlacements(e, T).length)
    for (const call of draws) {
      assert.equal(call.args[0], sheet, 'expected the sheet image as the drawImage source')
    }
  })

  it('blits the finished buffer to the caller exactly once, rotated by facing', () => {
    // The whole design rests on rotating the finished buffer as a unit rather
    // than rotating each part into the world.
    const ctx = fakeCtx(), bufCtx = fakeCtx()
    const buffer = { width: 0, height: 0, getContext: () => bufCtx }
    const facing = 1.2
    drawDragonBossPixel(ctx, pose({ facing }), 0, 0, T, { [SHEET_SPRITE]: 'SHEET' }, buffer)
    const draws = ctx.calls.filter(c => c.name === 'drawImage')
    assert.equal(draws.length, 1, 'expected exactly one blit to the caller context')
    assert.equal(draws[0].args[0], buffer, 'expected the injected buffer as the blit source')
    const rotated = ctx.calls.some(c => c.name === 'rotate' &&
      Math.abs(c.args[0] - (facing + Math.PI / 2)) < 1e-9)
    assert.ok(rotated, 'expected a rotate by facing + PI/2')
  })
})
