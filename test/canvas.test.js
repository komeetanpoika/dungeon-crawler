import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { drawTile, isFlickerVisible, shakeOffset, drawEnemySwing, drawEntity, drawRiteCeremony, playerSpriteKey, Renderer, drawCreature } from '../renderer/render/canvas.js'
import { TILE } from '../renderer/systems/entities.js'
import { CAMPFIRE_DURATION, CAMPFIRE_FADE, campfireAlpha } from '../renderer/systems/campfire.js'

// Minimal ctx that records drawImage calls by the sprite passed in.
function recordingCtx() {
  const calls = []
  let alpha = 1
  let filter = 'none'
  return {
    calls,
    drawImage: (img) => calls.push(img),
    fillRect: () => {},
    set fillStyle(_v) {},
    get fillStyle() { return '' },
    set globalAlpha(v) { alpha = v },
    get globalAlpha() { return alpha },
    set filter(v) { filter = v },
    get filter() { return filter },
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
    const psprites = { player_base: 'PLAYER', weapon_sword: 'SWORD' }
    const idle = { type: 'player', facing: 'east', walkPhase: 0, swayAmp: 0, weapon: { weaponType: 'sword' } }

    const ctx = swingCtx()
    drawEntity(ctx, idle, 0, 0, 32, psprites)
    assert.deepEqual(ctx.images, ['PLAYER', 'SWORD'])

    const ctx2 = swingCtx()
    drawEntity(ctx2, { ...idle, attackTimer: 0.1, attackDuration: 0.2 }, 0, 0, 32, psprites)
    assert.deepEqual(ctx2.images, ['PLAYER'], 'no carried sword while the swing animates')
  })

  it('player carries the ranged weapon in ranged stance', () => {
    const psprites = { player_ranged: 'PLAYER', weapon_sword: 'SWORD', weapon_shortbow: 'BOW' }
    const p = { type: 'player', facing: 'east', walkPhase: 0, swayAmp: 0,
                weapon: { weaponType: 'sword' }, ranged: { weaponType: 'shortbow' }, attackMode: 'ranged' }
    const ctx = swingCtx()
    drawEntity(ctx, p, 0, 0, 32, psprites)
    assert.deepEqual(ctx.images, ['PLAYER', 'BOW'])
  })

  it('ranged stance with no ranged weapon shows an empty hand', () => {
    const psprites = { player_ranged: 'PLAYER', weapon_sword: 'SWORD' }
    const p = { type: 'player', facing: 'east', walkPhase: 0, swayAmp: 0,
                weapon: { weaponType: 'sword' }, ranged: null, attackMode: 'ranged' }
    const ctx = swingCtx()
    drawEntity(ctx, p, 0, 0, 32, psprites)
    assert.deepEqual(ctx.images, ['PLAYER'])
  })

  it('a floating ranged weapon renders its sprite', () => {
    const ctx = swingCtx()
    drawEntity(ctx, { type: 'floating_item', progress: 1,
                      contents: { type: 'ranged', weaponType: 'shortbow' } },
               0, 0, 32, { weapon_shortbow: 'BOW' })
    assert.deepEqual(ctx.images, ['BOW'])
  })
})

describe('Renderer DPR-aware resize', () => {
  function fakeCanvas(w, h) {
    const ctx = {
      transforms: [],
      setTransform(...args) { this.transforms.push(args) },
      imageSmoothingEnabled: true,
    }
    return { offsetWidth: w, offsetHeight: h, width: 0, height: 0, getContext: () => ctx, ctx }
  }

  it('scales the backing store by devicePixelRatio, keeps logical view size', () => {
    const prev = globalThis.devicePixelRatio
    globalThis.devicePixelRatio = 2
    const c = fakeCanvas(400, 300)
    const r = new Renderer(c)
    r.resize()
    assert.equal(c.width, 800)
    assert.equal(c.height, 600)
    assert.equal(r.viewW, 400)
    assert.equal(r.viewH, 300)
    assert.deepEqual(c.ctx.transforms.at(-1), [2, 0, 0, 2, 0, 0])
    assert.equal(c.ctx.imageSmoothingEnabled, false)
    globalThis.devicePixelRatio = prev
  })

  it('defaults to dpr 1 when devicePixelRatio is undefined', () => {
    const prev = globalThis.devicePixelRatio
    delete globalThis.devicePixelRatio
    const c = fakeCanvas(400, 300)
    const r = new Renderer(c)
    r.resize()
    assert.equal(c.width, 400)
    assert.equal(r.viewW, 400)
    globalThis.devicePixelRatio = prev
  })

  it('centers the camera using logical size, not backing-store size', () => {
    const prev = globalThis.devicePixelRatio
    globalThis.devicePixelRatio = 2
    const c = fakeCanvas(400, 300)
    const r = new Renderer(c)
    r.resize()
    r.updateCamera({ px: 1000, py: 500 }, 0)
    assert.equal(r.camX, 1000 - 200)  // viewW/2, not canvas.width/2
    assert.equal(r.camY, 500 - 150)
    globalThis.devicePixelRatio = prev
  })
})

describe('drawRiteCeremony', () => {
  // Records every kind of draw the ceremony makes.
  function riteCtx() {
    const ops = { images: [], texts: [], strokes: 0, alphas: [] }
    let alpha = 1
    return {
      ops,
      save: () => {}, restore: () => {},
      set globalAlpha(v) { alpha = v }, get globalAlpha() { return alpha },
      drawImage: (img) => ops.images.push({ img, alpha }),
      fillText: (ch) => ops.texts.push({ ch, alpha }),
      beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
      stroke: () => { ops.strokes++ },
      ellipse: () => {}, arc: () => {}, fill: () => {}, fillRect: () => {},
      set strokeStyle(_v) {}, set fillStyle(_v) {}, set lineWidth(_v) {},
      set lineCap(_v) {}, set font(_v) {}, set textAlign(_v) {},
    }
  }

  const wiz = (beam, alpha = 1) => ({ px: 100, py: 100, alpha, beam })

  it('draws one sprite per wizard at its fade-in alpha', () => {
    const ctx = riteCtx()
    const fx = { wizards: [wiz(0, 0.5), wiz(0, 0.5), wiz(0, 0.5)], glyphs: [], lift: 0 }
    drawRiteCeremony(ctx, fx, 0, 0, 32, 'WIZ', { px: 160, py: 160 })
    assert.equal(ctx.ops.images.length, 3)
    for (const d of ctx.ops.images) { assert.equal(d.img, 'WIZ'); assert.equal(d.alpha, 0.5) }
  })

  it('strokes a beam only for wizards whose beam is on', () => {
    const ctx = riteCtx()
    const fx = { wizards: [wiz(1), wiz(0.5), wiz(0)], glyphs: [], lift: 0 }
    drawRiteCeremony(ctx, fx, 0, 0, 32, 'WIZ', { px: 160, py: 160 })
    assert.ok(ctx.ops.strokes >= 2, 'two lit beams stroke')
    const off = riteCtx()
    drawRiteCeremony(off, { wizards: [wiz(0), wiz(0)], glyphs: [], lift: 0 }, 0, 0, 32, 'WIZ', { px: 160, py: 160 })
    assert.equal(off.ops.strokes, 0)
  })

  it('renders each glyph as text', () => {
    const ctx = riteCtx()
    const fx = { wizards: [wiz(0)], glyphs: [{ px: 90, py: 80, alpha: 0.7, char: 'ᚠ' }], lift: 0 }
    drawRiteCeremony(ctx, fx, 0, 0, 32, 'WIZ', { px: 160, py: 160 })
    assert.deepEqual(ctx.ops.texts, [{ ch: 'ᚠ', alpha: 0.7 }])
  })

  it('draws nothing without wizards', () => {
    const ctx = riteCtx()
    drawRiteCeremony(ctx, { wizards: [], glyphs: [], lift: 0 }, 0, 0, 32, 'WIZ', { px: 160, py: 160 })
    assert.equal(ctx.ops.images.length + ctx.ops.texts.length + ctx.ops.strokes, 0)
  })
})

describe('player stance sprites', () => {
  const SPR2 = { player_base: 'BASE', player_melee_heavy: 'HEAVY', player_ranged: 'RANGED', player_magic: 'MAGIC' }

  it('picks the sprite for the stance, gated by the Might talent for melee', () => {
    assert.equal(playerSpriteKey({ attackMode: 'melee', talents: [] }, 'melee'), 'player_base')
    assert.equal(playerSpriteKey({ attackMode: 'melee', talents: ['heavy_weapons'] }, 'melee'), 'player_melee_heavy')
    assert.equal(playerSpriteKey({ attackMode: 'ranged', talents: ['ranged_stance'] }, 'ranged'), 'player_ranged')
    assert.equal(playerSpriteKey({ attackMode: 'magic', talents: ['magic_stance'] }, 'magic'), 'player_magic')
  })

  function playerCtx() {
    const images = []
    let alpha = 1
    return {
      images,
      save: () => {}, restore: () => {}, translate: () => {}, rotate: () => {}, scale: () => {},
      set globalAlpha(v) { alpha = v }, get globalAlpha() { return alpha },
      drawImage: (img) => images.push({ img, alpha }),
      fillRect: () => {}, beginPath: () => {}, arc: () => {}, stroke: () => {}, fill: () => {},
      set fillStyle(_v) {}, set strokeStyle(_v) {}, set lineWidth(_v) {},
    }
  }
  const player = over => ({ type: 'player', facing: 'east', attackMode: 'melee', talents: [], attackTimer: 0, ...over })

  it('draws the stance sprite for a settled player', () => {
    const ctx = playerCtx()
    drawEntity(ctx, player({ attackMode: 'magic' }), 0, 0, 32, SPR2)
    assert.deepEqual(ctx.images, [{ img: 'MAGIC', alpha: 1 }])
  })

  it('crossfades both sprites at complementary alphas mid-switch', () => {
    const ctx = playerCtx()
    drawEntity(ctx, player({ stanceSwitch: { from: 'melee', to: 'ranged', t: 0.35, dur: 0.7 } }), 0, 0, 32, SPR2)
    assert.equal(ctx.images.length, 2)
    const from = ctx.images.find(i => i.img === 'BASE')
    const to = ctx.images.find(i => i.img === 'RANGED')
    assert.ok(Math.abs(from.alpha - 0.5) < 1e-9)
    assert.ok(Math.abs(to.alpha - 0.5) < 1e-9)
  })

  it('the target sprite honors talent gating during the fade', () => {
    const ctx = playerCtx()
    drawEntity(ctx, player({ talents: ['heavy_weapons'], attackMode: 'ranged',
      stanceSwitch: { from: 'ranged', to: 'melee', t: 0.7 * 0.75, dur: 0.7 } }), 0, 0, 32, SPR2)
    const to = ctx.images.find(i => i.img === 'HEAVY')
    assert.ok(to, 'melee target renders the knight for a Might-trained player')
    assert.ok(Math.abs(to.alpha - 0.75) < 1e-9)
  })
})

describe('drawEntity — magic stance held weapon', () => {
  const psprites = { player_magic: 'MAGIC', weapon_sword: 'SWORD', weapon_sparkwand: 'WAND', weapon_shortbow: 'BOW' }
  const mage = over => ({ type: 'player', facing: 'east', walkPhase: 0, swayAmp: 0, attackMode: 'magic',
    weapon: { weaponType: 'sword' }, ranged: null, ...over })

  it('never carries the melee weapon in magic stance', () => {
    const ctx = swingCtx()
    drawEntity(ctx, mage(), 0, 0, 32, psprites)
    assert.deepEqual(ctx.images, ['MAGIC'])
  })

  it('carries a wand in magic stance', () => {
    const ctx = swingCtx()
    drawEntity(ctx, mage({ ranged: { weaponType: 'sparkwand', kind: 'wand' } }), 0, 0, 32, psprites)
    assert.deepEqual(ctx.images, ['MAGIC', 'WAND'])
  })

  it('a bow stays on the back in magic stance', () => {
    const ctx = swingCtx()
    drawEntity(ctx, mage({ ranged: { weaponType: 'shortbow', kind: 'bow' } }), 0, 0, 32, psprites)
    assert.deepEqual(ctx.images, ['MAGIC'])
  })
})

describe('trees never show damage', () => {
  it('a chopped-but-standing tree cell draws exactly like an untouched one', () => {
    const spr = { ow_grass_0: 'G', ow_tree_small: 'T' }
    const a = recordingCtx(), b = recordingCtx()
    drawTile(a, TILE.WALL, 0, 0, 32, spr, { skin: 'ow_grass_0', overlay: 'ow_tree_small' })
    drawTile(b, TILE.WALL, 0, 0, 32, spr, { skin: 'ow_grass_0', overlay: 'ow_tree_small', chopHp: 1 })
    assert.deepEqual(a.calls, b.calls)
  })
})

describe('floating consumables use atlas sprites', () => {
  for (const [type, key] of [['meat', 'item_meat'], ['cooked_meat', 'item_meat_cooked'], ['lumber', 'item_lumber'], ['mushroom', 'ow_mushroom']])
    it(`${type} draws ${key}`, () => {
      const ctx = recordingCtx()
      ctx.fillText = () => {}
      drawEntity(ctx, { type: 'floating_item', contents: { type } }, 0, 0, 32, { [key]: key.toUpperCase() })
      assert.deepEqual(ctx.calls, [key.toUpperCase()])
    })
})

describe('drawEntity — campfire', () => {
  it('draws prop_campfire scaled by campfireAlpha and restores globalAlpha after', () => {
    const ctx = recordingCtx()
    const fire = { type: 'campfire', t: CAMPFIRE_DURATION - CAMPFIRE_FADE / 2 }
    let seenAlpha
    const sprites = {
      get prop_campfire() { return 'FIRE' },
    }
    const origDrawImage = ctx.drawImage
    ctx.drawImage = (img) => { seenAlpha = ctx.globalAlpha; origDrawImage(img) }
    drawEntity(ctx, fire, 0, 0, 32, sprites)
    assert.deepEqual(ctx.calls, ['FIRE'])
    assert.equal(seenAlpha, campfireAlpha(fire))
    assert.equal(ctx.globalAlpha, 1)
  })

  it('draws nothing when the sprite is missing', () => {
    const ctx = recordingCtx()
    drawEntity(ctx, { type: 'campfire', t: 0 }, 0, 0, 32, {})
    assert.deepEqual(ctx.calls, [])
  })
})

describe('drawEntity — echo', () => {
  it('draws player_magic hue-shifted at half alpha, and restores both after', () => {
    const ctx = recordingCtx()
    let seenAlpha, seenFilter
    const origDrawImage = ctx.drawImage
    ctx.drawImage = (img) => { seenAlpha = ctx.globalAlpha; seenFilter = ctx.filter; origDrawImage(img) }
    drawEntity(ctx, { type: 'echo' }, 0, 0, 32, { player_magic: 'WIZ' })
    assert.deepEqual(ctx.calls, ['WIZ'])
    assert.equal(seenAlpha, 0.5)
    assert.equal(seenFilter, 'hue-rotate(160deg) saturate(0.6)')
    assert.equal(ctx.globalAlpha, 1)
    assert.equal(ctx.filter, 'none')
  })

  it('draws nothing when player_magic sprite is missing', () => {
    const ctx = recordingCtx()
    drawEntity(ctx, { type: 'echo' }, 0, 0, 32, {})
    assert.deepEqual(ctx.calls, [])
  })
})

describe('drawCreature', () => {
  it('draws the four quadrants row-major into a 2x2 box anchored like the cyclops', () => {
    const calls = []
    const ctx = { drawImage: (img, x, y, w, h) => calls.push([img, x, y, w, h]), globalAlpha: 1 }
    const spr = Object.fromEntries(['00', '01', '10', '11'].map(q => [`custom_nakki_${q}`, q]))
    drawCreature(ctx, spr, 'nakki', 100, 100, 32)
    assert.deepEqual(calls, [['00', 84, 84, 32, 32], ['01', 116, 84, 32, 32], ['10', 84, 116, 32, 32], ['11', 116, 116, 32, 32]])
  })

  it('multiplies alpha into globalAlpha for the draw and restores it after', () => {
    const seen = []
    const ctx = { drawImage: () => seen.push(ctx.globalAlpha), globalAlpha: 0.8 }
    const spr = Object.fromEntries(['00', '01', '10', '11'].map(q => [`custom_maahinen_${q}`, q]))
    drawCreature(ctx, spr, 'maahinen', 0, 0, 16, { alpha: 0.5 })
    assert.deepEqual(seen, [0.4, 0.4, 0.4, 0.4])
    assert.equal(ctx.globalAlpha, 0.8)
  })

  it('skips quadrants with no matching sprite', () => {
    const calls = []
    const ctx = { drawImage: (img) => calls.push(img), globalAlpha: 1 }
    const spr = { custom_sammunut_00: '00', custom_sammunut_11: '11' }
    drawCreature(ctx, spr, 'sammunut', 0, 0, 16)
    assert.deepEqual(calls, ['00', '11'])
  })
})
