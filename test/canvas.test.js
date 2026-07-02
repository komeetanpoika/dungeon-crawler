import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { drawTile, isFlickerVisible, shakeOffset, drawEnemySwing, drawEntity } from '../renderer/render/canvas.js'
import { TILE } from '../renderer/systems/entities.js'

// Minimal ctx that records drawImage calls by the sprite passed in.
function recordingCtx() {
  const calls = []
  return {
    calls,
    drawImage: (img) => calls.push(img),
    fillRect: () => {},
    set fillStyle(_v) {},
    get fillStyle() { return '' },
  }
}

const SPR = { floor: 'FLOOR', fl: 'SKIN_FL', br: 'OVERLAY_BR' }

describe('drawTile overlay', () => {
  it('draws the overlay on top of the skin', () => {
    const ctx = recordingCtx()
    drawTile(ctx, TILE.FLOOR, 0, 0, 32, SPR, { skin: 'fl', overlay: 'br' })
    assert.deepEqual(ctx.calls, ['SKIN_FL', 'OVERLAY_BR'])
  })

  it('draws the overlay on top of the default tile sprite (no skin)', () => {
    const ctx = recordingCtx()
    drawTile(ctx, TILE.FLOOR, 0, 0, 32, SPR, { overlay: 'br' })
    assert.deepEqual(ctx.calls, ['FLOOR', 'OVERLAY_BR'])
  })

  it('draws no overlay when none is set', () => {
    const ctx = recordingCtx()
    drawTile(ctx, TILE.FLOOR, 0, 0, 32, SPR, { skin: 'fl' })
    assert.deepEqual(ctx.calls, ['SKIN_FL'])
  })
})

describe('isFlickerVisible', () => {
  it('is always visible when not invulnerable', () => {
    assert.equal(isFlickerVisible(0), true)
    assert.equal(isFlickerVisible(undefined), true)
    assert.equal(isFlickerVisible(-1), true)
  })

  it('alternates on the interval boundary (default interval 0.06)', () => {
    assert.equal(isFlickerVisible(0.03), true)   // bucket 0
    assert.equal(isFlickerVisible(0.09), false)  // bucket 1
    assert.equal(isFlickerVisible(0.15), true)   // bucket 2
  })
})

describe('shakeOffset', () => {
  it('is zero at rest', () => {
    const { x, y } = shakeOffset(0)
    assert.equal(x, 0); assert.equal(y, 0)
  })
  it('grows with magnitude and stays within ±shake', () => {
    const { x, y } = shakeOffset(6)
    assert.ok(Math.abs(x) <= 6 && Math.abs(y) <= 6)
    assert.ok(Math.abs(x) + Math.abs(y) > 0)
  })
})

// Mock ctx with the full 2D-context surface the swing renderer touches.
function swingCtx() {
  const images = []
  let strokes = 0
  return {
    images,
    get strokes() { return strokes },
    drawImage: (img) => images.push(img),
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() {}, arc() {}, stroke() { strokes++ }, moveTo() {}, lineTo() {},
    fillRect() {},
    set fillStyle(_v) {}, get fillStyle() { return '' },
    set strokeStyle(_v) {}, get strokeStyle() { return '' },
    set lineWidth(_v) {}, get lineWidth() { return 0 },
    set lineCap(_v) {}, get lineCap() { return '' },
    set globalAlpha(_v) {}, get globalAlpha() { return 1 },
  }
}

describe('drawEnemySwing', () => {
  const sprites = { weapon_sword: 'SWORD', weapon_club: 'CLUB' }

  it('draws the weapon sprite during a sword swing', () => {
    const ctx = swingCtx()
    const e = { px: 100, py: 100, attack: { weaponId: 'sword', phase: 'swing', timer: 0.1, duration: 0.25, angle: 0 } }
    drawEnemySwing(ctx, e, sprites, 0, 0, 32)
    assert.ok(ctx.images.includes('SWORD'))
  })

  it('draws the weapon sprite raised during a windup (telegraph)', () => {
    const ctx = swingCtx()
    const e = { px: 100, py: 100, attack: { weaponId: 'club', phase: 'windup', timer: 0.2, duration: 0.4, angle: 0 } }
    drawEnemySwing(ctx, e, sprites, 0, 0, 32)
    assert.ok(ctx.images.includes('CLUB'))
    assert.equal(ctx.strokes, 0, 'telegraph pose has no swing trail')
  })

  it('draws procedural marks (no sprite image) for claw and pincer swings', () => {
    for (const weaponId of ['claw', 'pincer', 'dragon_claw']) {
      const ctx = swingCtx()
      const e = { px: 100, py: 100, attack: { weaponId, phase: 'swing', timer: 0.1, duration: 0.2, angle: 0 } }
      drawEnemySwing(ctx, e, sprites, 0, 0, 32)
      assert.equal(ctx.images.length, 0, `${weaponId} uses no sprite`)
      assert.ok(ctx.strokes > 0, `${weaponId} draws procedural marks/trail strokes`)
    }
  })

  it('draws nothing without an active attack', () => {
    const ctx = swingCtx()
    drawEnemySwing(ctx, { px: 100, py: 100 }, sprites, 0, 0, 32)
    assert.equal(ctx.images.length, 0)
  })
})

describe('drawEntity — held idle weapons', () => {
  const sprites = { guard: 'GUARD', cyclops: 'CYC', weapon_sword: 'SWORD', weapon_club: 'CLUB' }

  it('guard carries a sword at idle', () => {
    const ctx = swingCtx()
    drawEntity(ctx, { type: 'guard', facing: 'east', walkPhase: 0, swayAmp: 0 }, 0, 0, 32, sprites)
    assert.deepEqual(ctx.images, ['GUARD', 'SWORD'])
  })

  it('guard hides the idle sword while swinging', () => {
    const ctx = swingCtx()
    const attack = { weaponId: 'sword', phase: 'swing', timer: 0.1, duration: 0.25, angle: 0 }
    drawEntity(ctx, { type: 'guard', facing: 'east', walkPhase: 0, swayAmp: 0, attack }, 0, 0, 32, sprites)
    assert.deepEqual(ctx.images, ['GUARD'])
  })

  it('cyclops carries a club at idle and hides it while swinging', () => {
    const ctx = swingCtx()
    drawEntity(ctx, { type: 'cyclops', state: 'chase' }, 0, 0, 32, sprites)
    assert.deepEqual(ctx.images, ['CYC', 'CLUB'])

    const ctx2 = swingCtx()
    const attack = { weaponId: 'club', phase: 'swing', timer: 0.1, duration: 0.3, angle: 0 }
    drawEntity(ctx2, { type: 'cyclops', state: 'chase', attack }, 0, 0, 32, sprites)
    assert.deepEqual(ctx2.images, ['CYC'])
  })

  it('cyclops raises the club during slam states', () => {
    for (const s of ['slam_windup', 'slamming']) {
      const ctx = swingCtx()
      drawEntity(ctx, { type: 'cyclops', state: s }, 0, 0, 32, sprites)
      assert.deepEqual(ctx.images, ['CYC', 'CLUB'], `club drawn during ${s}`)
    }
  })

  it('player carries their weapon at idle and hides it while swinging', () => {
    const psprites = { player: 'PLAYER', weapon_sword: 'SWORD' }
    const idle = { type: 'player', facing: 'east', walkPhase: 0, swayAmp: 0, weapon: { weaponType: 'sword' } }

    const ctx = swingCtx()
    drawEntity(ctx, idle, 0, 0, 32, psprites)
    assert.deepEqual(ctx.images, ['PLAYER', 'SWORD'])

    const ctx2 = swingCtx()
    drawEntity(ctx2, { ...idle, attackTimer: 0.1, attackDuration: 0.2 }, 0, 0, 32, psprites)
    assert.deepEqual(ctx2.images, ['PLAYER'], 'no carried sword while the swing animates')
  })
})
