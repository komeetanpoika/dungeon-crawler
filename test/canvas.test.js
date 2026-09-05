import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { drawTile, isFlickerVisible, shakeOffset, drawEnemySwing, drawEntity, drawRiteCeremony, playerSpriteKey, Renderer } from '../renderer/render/canvas.js'
import { TILE } from '../renderer/systems/entities.js'
import { CAMPFIRE_DURATION, CAMPFIRE_FADE, campfireAlpha } from '../renderer/systems/campfire.js'
import { createMap } from '../renderer/systems/map.js'
import { SPRITES } from '../renderer/render/sprites.js'
import { readPng } from '../tools/png-read.mjs'

// Minimal ctx that records drawImage calls by the sprite passed in. `ops`
// records any other method call (name + args) via the Proxy fallback below,
// so callers that need e.g. ellipse/beginPath/fill need not extend this by
// hand — any method "just works" and is recorded generically.
function recordingCtx() {
  const calls = []
  const ops = []
  let alpha = 1
  let filter = 'none'
  const base = {
    calls,
    ops,
    drawImage: (img) => calls.push(img),
    fillRect: () => {},
    set fillStyle(_v) {},
    get fillStyle() { return '' },
    set globalAlpha(v) { alpha = v },
    get globalAlpha() { return alpha },
    set filter(v) { filter = v },
    get filter() { return filter },
  }
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return (...args) => { ops.push({ name: prop, args }) }
    },
  })
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
    drawEntity(ctx, mage({ wand: { weaponType: 'sparkwand' } }), 0, 0, 32, psprites)
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
  for (const [type, key] of [['meat', 'item_meat'], ['cooked_meat', 'item_meat_cooked'], ['lumber', 'item_lumber'], ['mushroom', 'ow_mushroom'],
                            ['clapper', 'item_clapper'], ['fleece', 'item_fleece']])
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
  it('draws two trail steps plus the body (three drawImage) and a glow ellipse, and restores state', () => {
    const ctx = recordingCtx()
    const entity = { type: 'echo', fadeA: 1, t: 0.3, px: 100, py: 100,
      trail: [{ px: 96, py: 100 }, { px: 92, py: 100 }, { px: 88, py: 100 }] }
    drawEntity(ctx, entity, 100, 100, 32, { player_magic: 'WIZ' })
    assert.deepEqual(ctx.calls, ['WIZ', 'WIZ', 'WIZ'])
    assert.equal(ctx.ops.filter(o => o.name === 'ellipse').length, 1)
    assert.equal(ctx.globalAlpha, 1)
    assert.equal(ctx.filter, 'none')
  })

  it('draws nothing when fadeA is 0', () => {
    const ctx = recordingCtx()
    drawEntity(ctx, { type: 'echo', fadeA: 0 }, 0, 0, 32, { player_magic: 'WIZ' })
    assert.deepEqual(ctx.calls, [])
    assert.deepEqual(ctx.ops, [])
  })
})

describe('drawEntity — grey campfire', () => {
  it('applies a filter for deadwood fires and restores it', () => {
    const ctx = recordingCtx(); ctx.filter = 'none'
    drawEntity(ctx, { type: 'campfire', t: 0, fuel: 'deadwood' }, 0, 0, 32, { prop_campfire: 'F' })
    assert.deepEqual(ctx.calls, ['F'])
    assert.equal(ctx.filter, 'none')
  })
})

// Records draws with the composite op in force so the two weather blits
// (multiply wash, fog) can be told apart from everything else. Shared with
// the wand/bow effect-layer tests further down, which need the same ordering.
function orderCtx() {
  const ops = []
  let gco = 'source-over', alpha = 1, fs = '', filter = 'none', smooth = false
  const stack = []
  const base = {
    ops,
    drawImage: (img) => ops.push({ name: 'drawImage', img, gco, filter, alpha }),
    fillRect: (...a) => ops.push({ name: 'fillRect', a, gco, fs, alpha }),
    clearRect: () => {},
    createRadialGradient: () => ({ addColorStop() {} }),
    setTransform() {},
    save: () => stack.push({ gco, alpha, filter, smooth }),
    restore: () => { const s = stack.pop(); if (s) ({ gco, alpha, filter, smooth } = s) },
    get fillStyle() { return fs }, set fillStyle(v) { fs = v },
    get globalAlpha() { return alpha }, set globalAlpha(v) { alpha = v },
    get globalCompositeOperation() { return gco }, set globalCompositeOperation(v) { gco = v },
    get filter() { return filter }, set filter(v) { filter = v },
    get imageSmoothingEnabled() { return smooth }, set imageSmoothingEnabled(v) { smooth = v },
  }
  return new Proxy(base, {
    get(t, p, r) { if (p in t) return Reflect.get(t, p, r); return (...args) => { ops.push({ name: p, args, alpha }) } },
  })
}

function stubLayer() {
  const canvas = { id: 'LAYER', width: 0, height: 0 }, mask = { id: 'MASK', width: 0, height: 0 }
  const layer = { canvas, ctx: orderCtx(), mask, maskCtx: orderCtx(), w: 32, h: 24, k: 0.25, resized: [],
    resize(w, h) { layer.resized.push([w, h]) } }
  return layer
}

function scene(weather, entities = [], extra = {}) {
  const map = createMap(4, 3)
  for (const row of map) for (const c of row) { c.tile = TILE.FLOOR; c.explored = true; c.visible = true }
  const player = { x: 1, y: 1, px: 48, py: 48, facing: 'south', invulnTimer: 0, hp: 5, maxHp: 5, inventory: [] }
  return { map, player, entities, projectiles: [], shockwaves: [], hitEffects: [],
    fireZones: [{ tiles: [{ x: 0, y: 0 }], age: 0 }],
    feedback: { floats: [{ px: 48, py: 40, text: '1', kind: 'damage', t: 0 }], bubble: null, banner: null, toasts: [] },
    weather, ...extra }
}

function renderScene(weather, { entities = [], sprites = {}, ...extra } = {}) {
  const ctx = orderCtx()
  const canvas = { width: 128, height: 96, offsetWidth: 128, offsetHeight: 96, getContext: () => ctx }
  const layer = stubLayer()
  const r = new Renderer(canvas, { weatherLayer: layer })
  r.viewW = 128; r.viewH = 96
  r.sprites = { ...r.sprites, ...sprites }
  const state = scene(weather, entities, extra)
  r.updateCamera(state.player, 0)
  r.render(state, null)
  return { ops: ctx.ops, layer, ctx }
}

describe('Renderer.render weather layers', () => {

  // The first flame rect is the fire-zone loop's red '#ef4444' fill.
  const flameIdx = ops => ops.findIndex(o => o.name === 'fillRect' && o.fs === '#ef4444')
  const feedbackIdx = ops => ops.findIndex(o => o.name === 'fillText' || o.name === 'strokeText' || o.name === 'font')

  it('draws no weather when the map has none', () => {
    const { ops } = renderScene(null)
    assert.equal(ops.some(o => o.name === 'drawImage' && o.img.id === 'LAYER'), false)
  })

  it('blits the multiply wash after the entities and before the flames', () => {
    const fog = { cx: 1, cy: 1, radius: 2, cells: [] }
    const look = { dark: 0.85, ambient: [40, 60, 120], fog: 0, t: 0, lights: [] }
    // A crab entity resolves to a plain sprites.crab drawImage — pins the
    // wash after actual entity draws, not just after the tile loop.
    const crab = { type: 'crab', x: 2, y: 1 }
    const { ops, ctx } = renderScene({ dayCycle: true, t: 0, fog, look }, { entities: [crab], sprites: { crab: 'CRAB' } })
    const entityDraw = ops.findIndex(o => o.name === 'drawImage' && o.img === 'CRAB')
    assert.ok(entityDraw >= 0, 'entity sprite drawn')
    const wash = ops.findIndex(o => o.name === 'fillRect' && o.gco === 'multiply')
    assert.ok(wash >= 0, 'wash drawn')
    assert.ok(wash < flameIdx(ops), 'wash before flames')
    assert.ok(wash > entityDraw, 'wash after the entity sprite')
    assert.equal(ctx.globalCompositeOperation, 'source-over', 'ctx gco settled')
    assert.equal(ctx.globalAlpha, 1, 'ctx alpha settled')
    assert.equal(ctx.filter, 'none', 'ctx filter settled')
  })

  it('blits the fog after the flames and before the feedback layer', () => {
    const fog = { cx: 1, cy: 1, radius: 2, cells: [{ x: 1, y: 1, w: 1 }] }
    const look = { dark: 0, ambient: [255, 255, 255], fog: 1, t: 0, lights: [] }
    const { ops, ctx } = renderScene({ dayCycle: true, t: 0, fog, look })
    const fogBlit = ops.findIndex(o => o.name === 'drawImage' && o.img.id === 'LAYER' && o.gco === 'source-over')
    assert.ok(fogBlit >= 0, 'fog drawn')
    assert.ok(fogBlit > flameIdx(ops), 'fog after flames')
    const fb = feedbackIdx(ops)
    assert.ok(fb >= 0, 'feedback drawn')
    assert.ok(fogBlit < fb, 'fog before feedback')
    assert.equal(ops.some(o => o.name === 'drawImage' && o.gco === 'multiply'), false, 'no wash by day')
    assert.equal(ctx.globalCompositeOperation, 'source-over', 'ctx gco settled')
    assert.equal(ctx.globalAlpha, 1, 'ctx alpha settled')
    assert.equal(ctx.filter, 'none', 'ctx filter settled')
  })

  it('skips weather when look is null (underground)', () => {
    const fog = { cx: 1, cy: 1, radius: 2, cells: [{ x: 1, y: 1, w: 1 }] }
    const { ops } = renderScene({ dayCycle: true, t: 0, fog, look: null })
    assert.equal(ops.some(o => o.name === 'drawImage' && o.img.id === 'LAYER'), false)
  })

  it('resizes the layer with the view', () => {
    const ctx = orderCtx()
    const canvas = { width: 0, height: 0, offsetWidth: 200, offsetHeight: 100, getContext: () => ctx }
    const layer = stubLayer()
    const r = new Renderer(canvas, { weatherLayer: layer })
    r.resize()
    assert.deepEqual(layer.resized.at(-1), [200, 100])
  })

  it('has no layer when there is no document and no injection', () => {
    const ctx = orderCtx()
    const canvas = { width: 0, height: 0, offsetWidth: 200, offsetHeight: 100, getContext: () => ctx }
    const r = new Renderer(canvas)
    assert.equal(r.weatherLayer, null)
    assert.doesNotThrow(() => r.resize())
  })
})

describe('drawEntity — the wand hand', () => {
  const psprites = { player_base: 'BASE', player_magic: 'MAGIC', player_ranged: 'RANGED',
                     weapon_sword: 'SWORD', weapon_frostwand: 'WAND', weapon_hunterbow: 'BOW' }
  const mage = over => ({ type: 'player', facing: 'east', walkPhase: 0, swayAmp: 0, attackMode: 'magic',
    weapon: { weaponType: 'sword' }, ranged: null, wand: null, ...over })

  it('carries the wand-hand wand in magic stance', () => {
    const ctx = swingCtx()
    drawEntity(ctx, mage({ wand: { weaponType: 'frostwand' } }), 0, 0, 32, psprites)
    assert.deepEqual(ctx.images, ['MAGIC', 'WAND'])
  })

  it('is barehanded in magic stance with an empty wand hand', () => {
    const ctx = swingCtx()
    drawEntity(ctx, mage({ ranged: { weaponType: 'hunterbow', kind: 'bow' } }), 0, 0, 32, psprites)
    assert.deepEqual(ctx.images, ['MAGIC'])
  })

  it('still carries the bow in ranged stance while a wand is in the other hand', () => {
    const ctx = swingCtx()
    drawEntity(ctx, mage({ attackMode: 'ranged', ranged: { weaponType: 'hunterbow', kind: 'bow' },
      wand: { weaponType: 'frostwand' } }), 0, 0, 32, psprites)
    assert.deepEqual(ctx.images, ['RANGED', 'BOW'])
  })
})

describe('Renderer.render — ranged and wand effect layers', () => {
  const NIGHT = { dark: 0.85, ambient: [40, 60, 120], fog: 0, t: 0, lights: [] }
  const night = () => ({ dayCycle: true, t: 0, fog: { cx: 1, cy: 1, radius: 2, cells: [] }, look: NIGHT })
  const rectOf = (ops, fs) => ops.find(o => o.name === 'fillRect' && o.fs === fs)
  const idx = (ops, pred) => ops.findIndex(pred)
  const crab = { type: 'crab', x: 2, y: 1 }
  const CRAB = { crab: 'CRAB' }
  const crabIdx = ops => idx(ops, o => o.name === 'drawImage' && o.img === 'CRAB')
  const washIdx = ops => idx(ops, o => o.name === 'fillRect' && o.gco === 'multiply')

  it('draws a sling stone as a 4x4 square', () => {
    const { ops } = renderScene(null, {
      projectiles: [{ px: 48, py: 48, dx: 1, dy: 0, shape: 'stone', color: '#a8a29e' }] })
    const r = rectOf(ops, '#a8a29e')
    assert.ok(r, 'stone drawn in its own colour')
    assert.deepEqual(r.a.slice(2), [4, 4])
  })

  it('draws a crossbow quarrel as a 3x8 dart along its travel axis', () => {
    const across = renderScene(null, {
      projectiles: [{ px: 48, py: 48, dx: 1, dy: 0, shape: 'quarrel', color: '#e5e7eb' }] })
    assert.deepEqual(rectOf(across.ops, '#e5e7eb').a.slice(2), [8, 3])
    const down = renderScene(null, {
      projectiles: [{ px: 48, py: 48, dx: 0, dy: 1, shape: 'quarrel', color: '#e5e7eb' }] })
    assert.deepEqual(rectOf(down.ops, '#e5e7eb').a.slice(2), [3, 8])
  })

  it("keeps a wand bolt a 4x4 square — only the crossbow's quarrel is a dart", () => {
    // spells.js tags every fireball tier shape:'bolt' too, so the dart must not
    // key on it: an orange stick where a fireball should be is the regression.
    const { ops } = renderScene(null, {
      projectiles: [{ px: 48, py: 48, dx: 1, dy: 0, shape: 'bolt', color: '#f97316' }] })
    assert.deepEqual(rectOf(ops, '#f97316').a.slice(2), [4, 4])
  })

  it('gives a spark a trail behind its 4x4 head', () => {
    const { ops } = renderScene(null, {
      projectiles: [{ px: 48, py: 48, dx: 1, dy: 0, shape: 'spark', color: '#22d3ee' }] })
    assert.deepEqual(rectOf(ops, '#22d3ee').a.slice(2), [4, 4])
    assert.ok(ops.some(o => o.name === 'lineTo'), 'trail stroked behind the head')
  })

  it('tints a frozen enemy and settles the filter afterwards', () => {
    const { ops, ctx } = renderScene(null, { entities: [{ ...crab, frozen: true }], sprites: CRAB })
    const draw = ops.find(o => o.name === 'drawImage' && o.img === 'CRAB')
    assert.match(draw.filter, /saturate\(0\.4\)/)
    assert.ok(rectOf(ops, '#bfdbfe'), 'pale-blue sheen over the frozen enemy')
    assert.equal(ctx.filter, 'none')
  })

  it('leaves an unfrozen enemy untinted', () => {
    const { ops } = renderScene(null, { entities: [crab], sprites: CRAB })
    assert.equal(ops.find(o => o.name === 'drawImage' && o.img === 'CRAB').filter, 'none')
    assert.equal(rectOf(ops, '#bfdbfe'), undefined)
  })

  it('scribbles bramble thorns under the entities', () => {
    const { ops } = renderScene(null, { entities: [crab], sprites: CRAB,
      zones: [{ kind: 'bramble', tiles: [{ x: 0, y: 0 }], age: 0, dur: 6 }] })
    const strokes = ops.filter(o => o.name === 'stroke')
    assert.equal(strokes.length, 3, 'three thorn strokes per cell')
    assert.ok(idx(ops, o => o.name === 'stroke') < crabIdx(ops), 'thorns under the entities')
  })

  it('fades a bramble patch out over its final second', () => {
    const zone = age => renderScene(null, { zones: [{ kind: 'bramble', tiles: [{ x: 0, y: 0 }], age, dur: 6 }] })
    const alphaAt = age => zone(age).ops.find(o => o.name === 'stroke').alpha
    assert.equal(alphaAt(0), 0.6)
    assert.ok(alphaAt(5.5) < 0.6 && alphaAt(5.5) > 0)
    assert.equal(alphaAt(6), 0)
  })

  it('crackles a sigil ring on a pending lightning mark, with the zones', () => {
    const { ops } = renderScene(null, { entities: [crab], sprites: CRAB,
      lightning: [{ x: 1, y: 1, t: 0.2, delay: 0.6 }] })
    const arc = idx(ops, o => o.name === 'arc')
    assert.ok(arc >= 0, 'sigil ring drawn')
    assert.ok(arc < crabIdx(ops), 'sigil under the entities')
  })

  it('lights the 3x3 and forks a bolt down after the night wash', () => {
    const { ops } = renderScene(night(), { strikes: [{ x: 1, y: 1, t: 0 }] })
    const lit = idx(ops, o => o.name === 'fillRect' && o.fs === '#e9d5ff')
    assert.ok(lit >= 0, 'struck cells lit')
    assert.ok(lit > washIdx(ops), 'the strike shows through the night wash')
    assert.ok(ops.some(o => o.name === 'lineTo'), 'jagged bolt stroked')
  })

  it('whites the screen out while state.flash runs, over the night wash', () => {
    const { ops } = renderScene(night(), { flash: 0.12 })
    const flash = idx(ops, o => o.name === 'fillRect' && String(o.fs).startsWith('rgba(255,255,255,'))
    assert.ok(flash >= 0, 'flash drawn')
    assert.ok(flash > washIdx(ops), 'flash after the night wash')
    assert.deepEqual(ops[flash].a, [0, 0, 128, 96], 'full screen')
  })

  it('draws no flash when state.flash is spent', () => {
    const { ops } = renderScene(night(), { flash: 0 })
    assert.equal(ops.some(o => o.name === 'fillRect' && String(o.fs).startsWith('rgba(255,255,255,')), false)
  })

  it('trails three fading silhouettes behind a blink', () => {
    const { ops } = renderScene(null, { sprites: { player_base: 'BASE' },
      blinkTrail: { from: { px: 16, py: 48 }, to: { px: 144, py: 48 }, t: 0.05 } })
    // scene()'s player stub has no `type`, so the only silhouettes here are
    // the ghosts — all faded, and fainter the closer they sit to the arrival.
    const draws = ops.filter(o => o.name === 'drawImage' && o.img === 'BASE')
    assert.equal(draws.length, 3)
    assert.ok(draws.every(o => o.alpha > 0 && o.alpha < 1))
    assert.ok(draws[0].alpha > draws[2].alpha)
  })
})

describe('the ranged/wand tiles (tools/make-ranged-tiles.mjs)', () => {
  // Cheap guard that the art the new roster names actually shipped: a wand or
  // bow whose PNG is missing renders as nothing at all in the hand, which is
  // easy to miss and hard to trace back to a rename.
  const NAMES = ['weapon_hunterbow', 'weapon_splitbow', 'weapon_crossbow', 'weapon_sling',
    'weapon_frostwand', 'weapon_bramblewand', 'weapon_blinkwand',
    'item_arrows', 'item_bolts', 'item_stones']

  for (const name of NAMES) it(`${name} is a registered 16x16 tile`, () => {
    assert.equal(SPRITES[name], name, 'registered in render/sprites.js')
    const file = new URL(`../renderer/assets/tiles/${name}.png`, import.meta.url).pathname
    const { width, height, pixels } = readPng(file)
    assert.equal(width, 16); assert.equal(height, 16)
    assert.ok(pixels.some((_, i) => i % 4 === 3 && pixels[i] === 255), 'has opaque pixels')
  })
})
