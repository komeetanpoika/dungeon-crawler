// The crones of the witch-marsh (Noitasuon akat), drawn upright the way a
// sheet creature is: seen from the side and a little from the front, never
// turned with the facing, only flipped to look left or right. Rect-only art
// on the art-px grid (TILE_ART_PX per tile), straight onto the canvas. The
// entity's centre is the origin; her feet stand FEET art px below it, where
// the hero's do, and a bigger one grows upward from there.
//
// One body plan, three women (`role`): tall and thin, bent under a hump, a
// long hooked nose.
//   0  the witch: headscarf and shawl, a ball of yarn at her belt with her
//      knitting needles stuck through it
//   1  the kuppari: white headscarf and apron, a cupping horn at her belt
//   2  Syöjätär (at `scale` 2): no scarf but snakes for hair, arms down to
//      her knees, ragged skirts
//
// Channels a hook writes (systems/monsters/noita.js, kuppari.js, syojatar.js):
//   pose.eyeGlow  0..1, the tell of her own move. The witch: her arm comes up
//                 and points, a green glow growing at the fingertip (the
//                 hex). The kuppari: as pose.cup. Syöjätär: she rears back,
//                 chin up and cheeks full; at 1 she snaps forward and spits.
//   pose.point    0..1: the pointing arm and its glow for anyone (Syöjätär's
//                 fan of hexes)
//   pose.knit     the witch at her needles: they click from frame to frame
//                 and a red strip grows under them
//   pose.cup      the kuppari holds her horn out, red at its mouth
//   pose.scream   Syöjätär calls her brood: arms flung up, mouth wide, her
//                 hair on end, snakes' heads under her skirts
//
// `anchor(p, pose, S, part)` tells a hook where her fingertip ('hand'), her
// mouth ('mouth'), the horn's mouth ('horn') and her skirts ('skirt') are
// drawn, in px from the centre at tile size S.
import { TILE_ART_PX, palette, frameOf } from './pixel.js'

export const RIG_ID = 'crone'

export const PARAM_SCHEMA = [
  { key: 'scale',      label: 'Size',             group: 'body', type: 'range', min: 0.8, max: 2.4, step: 0.05, default: 1 },
  { key: 'role',       label: 'Role (0 witch, 1 kuppari, 2 Syöjätär)', group: 'body', type: 'range', min: 0, max: 2, step: 1, default: 0 },
  { key: 'dressColor', label: 'Dress',            group: 'cloth', type: 'color', default: '#3d3350' },
  { key: 'shawlColor', label: 'Shawl',            group: 'cloth', type: 'color', default: '#7b4a8c' },
  { key: 'scarfColor', label: 'Headscarf, apron', group: 'cloth', type: 'color', default: '#b03a48' },
  { key: 'gearColor',  label: 'Yarn / horn',      group: 'cloth', type: 'color', default: '#d2324a' },
  { key: 'skinColor',  label: 'Skin',             group: 'skin', type: 'color', default: '#cdb898' },
  { key: 'hairColor',  label: 'Snakes',           group: 'skin', type: 'color', default: '#7ac043' },
  { key: 'eyeColor',   label: 'Eyes',             group: 'skin', type: 'color', default: '#1a1420' },
  { key: 'gaitFreq',   label: 'Gait frequency',   group: 'motion', type: 'range', min: 2, max: 14, step: 0.5, default: 6 },
]

const R = Math.round
const WHITE = '#f8f8f8'
const FLASH = { outline: WHITE, base: WHITE, light: WHITE }
const FEET = 7                       // art px from the centre down to the ground she stands on
const TALL = 22, HAIR_TALL = 28      // her height in her own units (one unit = `scale` art px): scarf top, snakes' reach
const WITCH = 0, CUPPER = 1, BOSS = 2
const GLOW = { halo: '#3fae4a', core: '#b6f36a', hot: '#f2ffd0' }   // the hex (the frog's green: render/canvas.js)
const NEEDLE = '#ece6d2', BLOOD = '#d8202c', VENOM = '#9be04a', INK = '#16101c'
// Where the parts a hook asks about sit, in her units: x forward of her
// middle, h above the ground.
const PARTS = { hand: { x: 12.5, h: 16.5 }, mouth: { x: 6.5, h: 16.5 }, horn: { x: 14, h: 16.5 }, skirt: { x: 0, h: 3 } }

const clamp01 = v => Math.max(0, Math.min(1, v || 0))
const roleOf = p => Math.max(0, Math.min(2, R(p.role)))
const looksLeft = pose => Math.cos(pose.facing ?? 0) < -0.01

// Which of the channels this woman answers to.
function channels(role, pose) {
  const glow = clamp01(pose.eyeGlow)
  return {
    point: Math.max(clamp01(pose.point), role === WITCH ? glow : 0),
    spit: role === BOSS ? glow : 0,
    knit: role === WITCH && pose.knit > 0,
    cup: role === CUPPER && (pose.cup > 0 || glow > 0),
    scream: role === BOSS && pose.scream > 0,
  }
}

// What a blow can land on: a disc over her skirts and bent back, in screen
// px at 32-px tiles (her feet and the top of her head lie just outside it).
export function hitShape(p) {
  const k = 32 / TILE_ART_PX
  return { r: Math.max(8, Math.min(28, R(7 * p.scale * k))), oy: R((FEET - 10 * p.scale) * k) }
}
// Collision and nav: never wider than one tile's clearance, so Syöjätär
// walks where her coven does.
export function hitHalf(p) { return Math.max(6, Math.min(16, R(7 * p.scale))) }
// Where the drawing tops out, in px from the centre (up is negative): the
// health bar goes above it.
export function drawnTop(p, S) { return -R(((roleOf(p) === BOSS ? HAIR_TALL : TALL) * p.scale - FEET + 1) * S / TILE_ART_PX) }
export function anchor(p, pose, S, part = 'hand') {
  const k = S / TILE_ART_PX, a = PARTS[part] ?? PARTS.hand
  return { x: (looksLeft(pose) ? -1 : 1) * R(a.x * p.scale) * k, y: (FEET - R(a.h * p.scale)) * k }
}

// a repeatable scatter, for ragged hems and tatters
const speck = (n, salt) => { const v = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453; return v - Math.floor(v) }

// Syöjätär's hair: where each snake leaves her head, which way it grows
// (0 is forward, up is negative) and how many links long it is.
const SNAKES = [
  { x: 4.5, h: 22, a: -0.85, n: 4 }, { x: 3, h: 22.5, a: -1.3, n: 5 }, { x: 1.5, h: 22.5, a: -1.75, n: 5 }, { x: 0.5, h: 22, a: -2.25, n: 5 },
  { x: 0, h: 20.5, a: -2.75, n: 5 }, { x: 0, h: 19, a: 3.05, n: 4 }, { x: 0, h: 17.5, a: 2.55, n: 4 },
]

export function drawMonster(ctx, p, pose, S) {
  const k = S / TILE_ART_PX, sc = p.scale, role = roleOf(p)
  const { state, stateT } = pose, t = pose.t ?? 0
  const hit = state === 'hit', dead = state === 'death', walking = state === 'walk'
  const pal = col => hit ? FLASH : palette(col)
  const one = col => hit ? WHITE : col
  const dress = pal(p.dressColor), shawl = pal(p.shawlColor), scarf = pal(p.scarfColor), skin = pal(p.skinColor)
  const gear = pal(p.gearColor), hair = pal(p.hairColor)
  const ink = one(INK), bone = one('#f4ead0'), red = one('#e02a2a')
  const ch = dead ? { point: 0, spit: 0, knit: false, cup: false, scream: false } : channels(role, pose)
  const F = walking ? frameOf(t, p.gaitFreq, 4) : 0
  const breath = !walking && !dead && frameOf(t, 1.6, 2) ? 1 : 0
  const fallen = dead && stateT >= 0.22
  const u = v => R(v * sc)
  // a rect in her units: x from her middle (forward is +), h the height of
  // its top edge above the ground, w wide, d deep downward. Edges are
  // rounded, never sizes, so neighbours still meet at any scale.
  const rect = (x, h, w, d) => ctx.fillRect(u(x), FEET - u(h), Math.max(1, u(x + w) - u(x)), Math.max(1, u(h) - u(h - d)))
  const fill = (col, x, h, w, d) => { ctx.fillStyle = col; rect(x, h, w, d) }

  ctx.save()
  ctx.scale(looksLeft(pose) ? -k : k, k)

  // ---- her shadow --------------------------------------------------------------
  ctx.save()
  ctx.globalAlpha *= 0.25
  ctx.fillStyle = '#000000'
  ctx.fillRect(u(fallen ? -TALL + 2 : -5), FEET - 1, u(fallen ? TALL : 10), 2)
  ctx.restore()

  // dying: she staggers, then lies on her back
  if (fallen) { ctx.translate(0, FEET - u(5)); ctx.rotate(-Math.PI / 2); ctx.translate(0, -FEET) }

  // ---- feet: two shoes that step in turn (Syöjätär's are under her skirts) -----
  if (role !== BOSS) {
    const step = walking ? [1, 0, -1, 0][F] : 0
    fill(ink, -3 + step, 2, 2, walking && F === 0 ? 1 : 2)
    fill(ink, 0 - step, 2, 3, walking && F === 2 ? 1 : 2)
  }

  // the rest of her bobs with her step
  ctx.translate(0, (walking && F % 2 ? -1 : 0) + (dead && !fallen ? 1 : 0))

  // ---- skirts --------------------------------------------------------------------
  const sway = walking ? [0, 1, 0, -1][F] : 0
  fill(dress.outline, -3, 14, 6, 8)
  fill(dress.outline, -4, 7, 8, 4)
  fill(dress.base, -2, 14, 4, 8)
  fill(dress.base, -3, 7, 6, 4)
  fill(dress.light, 0, 12, 1, 8)                               // a fold that catches the light
  fill(dress.light, 2, 6, 1, 3)
  if (role === BOSS) {
    // ragged: every strip of the hem ends where it will
    for (let x = -4; x < 4; x += 0.5) {
      const rag = R(speck(x * 2, 3) * 5) / 2
      fill(R(x * 2) % 2 ? dress.outline : dress.base, x + sway * 0.5, 3, 0.5, 3 - rag + (ch.scream ? -1 : 0))
    }
    // a scatter of scales down them
    for (let i = 0; i < 10; i++) fill(i % 3 ? shawl.base : hair.outline, -3 + R(speck(i, 7) * 11) / 2, 4 + R(speck(i, 9) * 14) / 2, 0.5, 0.5)
  } else {
    fill(dress.outline, -4 + sway, 3, 8, 1)                    // the hem swings a little
  }
  if (role === CUPPER) {
    // her apron, not as clean as it was
    fill(scarf.outline, -1, 13, 4, 9)
    fill(scarf.light, 0, 13, 3, 8)
    fill(scarf.base, 0, 6, 3, 1)
    fill(one('#a0202c'), 1, 10, 1, 1); fill(one('#a0202c'), 2, 8, 1, 1); fill(one('#a0202c'), 1, 7, 1, 1)
  }

  // ---- the bent back, and the shawl over it -------------------------------------
  // (spitting she rears back; at the spit she snaps forward)
  const lean = ch.spit >= 1 ? 2 : ch.spit > 0 ? -R(ch.spit * 3) : 0
  ctx.translate(u(lean), 0)
  fill(shawl.outline, -4, 20, 4, 1)                            // the hump
  fill(shawl.outline, -5, 19, 7, 1)
  fill(shawl.outline, -5, 18, 9, 4)
  fill(shawl.outline, -5, 14, 2, 2)                            // its corner, hanging down her back
  fill(shawl.outline, -5, 12, 1, 1)
  fill(shawl.base, -4, 19, 5, 1)
  fill(shawl.base, -4, 18, 7, 3)
  fill(shawl.light, -3, 19, 3, 1)
  fill(shawl.light, -4, 18, 2, 1)
  if (role === BOSS) for (const x of [-4, -2.5, -1, 0.5, 2]) fill(shawl.outline, x, 14, 1, 1.5 + speck(x, 5))   // hers is in tatters
  else for (const x of [-3, -1, 1, 3]) fill(shawl.base, x, 14, 1, 1)                                             // a fringe

  // ---- the far arm, where it shows (a scream throws both up) --------------------
  if (ch.scream) arm(-4, 18, -0.9, 1, 7, true)
  else if (role === BOSS && !(ch.point > 0)) arm(-4 - (walking ? [1, 0, -1, 0][F] * 0.5 : 0), 17, -0.15, -1, 9, false)

  // ---- head ----------------------------------------------------------------------
  ctx.save()
  ctx.translate(0, breath)
  if (ch.spit > 0 && ch.spit < 1) ctx.translate(-u(ch.spit > 0.5 ? 1 : 0), -u(ch.spit > 0.5 ? 2 : 1))   // chin up, and back
  if (ch.scream) ctx.translate(-u(1), -u(1))
  if (role === BOSS) {
    for (const [i, s] of SNAKES.entries()) snake(s, i)
    fill(hair.outline, 1, 22, 4, 1)
    fill(hair.outline, 0, 21, 6, 4)
    fill(hair.outline, 1, 17, 3, 1)
  } else {
    // the headscarf: over her brow, a corner hanging behind, knotted under the chin
    fill(scarf.outline, 1, 22, 4, 1)
    fill(scarf.outline, 0, 21, 6, 4)
    fill(scarf.outline, -1, 20, 1, 3)
    fill(scarf.outline, 1, 17, 3, 1)
    fill(scarf.base, 1, 21, 4, 1)
    fill(scarf.base, 1, 20, 3, 1)
    fill(scarf.base, 1, 19, 2, 2)
    fill(scarf.base, 2, 17, 1, 1)
    fill(scarf.base, 2, 16, 2, 1)
    fill(scarf.outline, 2, 15, 1, 1)
  }
  // the face: brow, cheek, a jutting chin
  fill(skin.base, 4, 20, 2, 1)
  fill(skin.base, 3, 19, 3, 3)
  fill(skin.light, 3, 18, 2, 1)
  fill(skin.base, 4, 16, 1, 1)
  // the nose: long, with a hook at the end
  fill(skin.light, 6, 19, 1, 1)
  fill(skin.base, 6, 18, 2, 1)
  fill(skin.outline, 7, 17, 1, 1)
  // eye
  fill(one(role === BOSS ? '#ffe14a' : p.eyeColor), 5, 19, 1, 1)
  if (role === BOSS) fill(ink, 5.5, 19, 0.5, 1)
  // mouth: a line; cheeks full before the spit, open at it, wide to scream
  if (ch.scream) { fill(ink, 4, 17.5, 2, 2.5); fill(bone, 4, 17.5, 0.5, 0.5); fill(bone, 5, 17.5, 0.5, 0.5); fill(bone, 4.5, 15.5, 0.5, 0.5) }
  else if (ch.spit >= 1) { fill(ink, 4.5, 17.5, 1.5, 1.5); fill(one(VENOM), 6, 17, 2, 1.5); fill(one(VENOM), 8.5, 16.5, 1, 1); fill(one(GLOW.hot), 6.5, 17, 0.5, 0.5) }
  else if (ch.spit > 0) { fill(skin.light, 3.5, 18, 3, 2); fill(skin.outline, 5.5, 17, 0.5, 0.5); fill(one(VENOM), 6, 17, 0.5, 0.5 + R(ch.spit) * 0.5) }
  else fill(skin.outline, 5, 17, 1, 1)
  ctx.restore()

  // ---- what hangs at her belt ----------------------------------------------------
  if (role === WITCH && !fallen) {
    // a ball of yarn, her two needles crossed through it while her hands are free
    if (!ch.knit) {
      ctx.fillStyle = one(NEEDLE)
      for (const d of [-3, -2, 2, 3]) { rect(5 + d, 10 + d, 1, 1); rect(5 - d, 10 + d, 1, 1) }
    }
    fill(gear.outline, 4, 12, 3, 1)
    fill(gear.outline, 3, 11, 5, 3)
    fill(gear.outline, 4, 8, 3, 1)
    fill(gear.base, 4, 11, 3, 3)
    fill(gear.light, 4, 11, 2, 1)
    fill(gear.outline, 5, 10, 2, 1)                              // a strand across it
    fill(gear.light, 6, 9, 1, 1)
  }
  if (role === CUPPER && !fallen && !ch.cup) {
    // the horn, mouth up, its tip curling back
    fill(gear.outline, 4, 13, 4, 1)
    fill(ink, 5, 13, 2, 1)
    fill(gear.base, 4, 12, 4, 1)
    fill(gear.light, 5, 12, 1, 1)
    fill(gear.base, 5, 11, 3, 1)
    fill(gear.light, 6, 11, 1, 1)
    fill(gear.base, 6, 10, 3, 1)
    fill(gear.outline, 7, 9, 2, 1)
    fill(gear.outline, 9, 9, 1, 2)
  }

  // ---- the near arm, and what it holds -------------------------------------------
  if (ch.scream) arm(3, 18, 0.9, 1, 7, true)
  else if (ch.point > 0) {
    // straight out, a finger at the end of it and the hex gathering there
    const f = ch.point, len = 2 + 6 * f, sleeve = Math.min(len, 3)
    fill(dress.outline, 3, 18, 1 + sleeve, 3)
    fill(dress.light, 4, 17, sleeve, 1)
    if (len > sleeve) fill(skin.base, 4 + sleeve, 17, len - sleeve, 1)
    if (!hit) {
      const fx = u(4 + len) + 1, fy = FEET - u(17) + (u(1) >> 1)
      const r = 1 + R(f * 2 * Math.max(1, sc * 0.75))
      const flick = frameOf(t, 12, 2)
      ctx.save()
      ctx.globalAlpha *= 0.5
      ctx.fillStyle = GLOW.halo
      ctx.fillRect(fx - r, fy - r + 1, 2 * r + 1, 2 * r - 1)
      ctx.fillRect(fx - r + 1, fy - r, 2 * r - 1, 2 * r + 1)
      if (flick) { ctx.fillRect(fx - r - 1, fy, 2 * r + 3, 1); ctx.fillRect(fx, fy - r - 1, 1, 2 * r + 3) }
      ctx.restore()
      ctx.fillStyle = GLOW.core
      ctx.fillRect(fx - (r >> 1), fy - (r >> 1), 2 * (r >> 1) + 1, 2 * (r >> 1) + 1)
      ctx.fillStyle = GLOW.hot
      ctx.fillRect(fx, fy, 1, 1)
    }
  } else if (ch.knit) {
    // both hands up, the needles crossing and uncrossing, the work growing under them
    const click = frameOf(t, 9, 2)
    fill(dress.outline, 3, 17, 3, 4)
    fill(dress.light, 4, 16, 2, 1); fill(dress.light, 4, 14, 2, 1)
    fill(skin.base, 6, 16, 1, 1); fill(skin.base, 6, 14, 1, 1)
    const rows = 1 + frameOf(t, 2.5, 3)
    fill(gear.outline, 8, 14, 3, rows + 1)
    fill(gear.base, 8, 14, 2, rows)
    fill(gear.light, 8 + click, 13, 1, 1)
    ctx.fillStyle = gear.base
    rect(7, 12 - rows + 1, 1, 1); rect(6, 12 - rows, 1, 1)       // the thread, down to the ball
    ctx.fillStyle = one(NEEDLE)
    for (let i = 0; i < 5; i++) {
      rect(7 + i, click ? 14 + (i >> 1) : 13 + i, 1, 1)
      rect(7 + i, click ? 17 - (i >> 1) : 17 - i, 1, 1)
    }
    if (click && !hit) { fill(WHITE, 12, 17, 1, 1); fill(WHITE, 13, 16, 1, 1); fill(WHITE, 12, 15, 1, 1) }   // click
  } else if (ch.cup) {
    // the horn held out, its wide mouth forward and red
    const pulse = frameOf(t, 8, 2)
    fill(dress.outline, 3, 18, 4, 3)
    fill(dress.light, 4, 17, 3, 1)
    fill(skin.base, 7, 17, 1, 1)
    fill(gear.outline, 8, 17, 2, 1)                             // its tip in her fist
    fill(gear.base, 10, 18, 2, 3)
    fill(gear.light, 10, 18, 2, 1)
    fill(gear.outline, 10, 16, 2, 1)
    fill(gear.base, 12, 19, 1, 5)                               // the rim
    fill(gear.light, 12, 19, 1, 1)
    fill(one(BLOOD), 13, 18, 1, 3)
    if (!hit) { fill(BLOOD, 14 + pulse, 17, 1, 1); fill(BLOOD, 15 - pulse, 18, 1, 1); fill(BLOOD, 15 - pulse, 16, 1, 1) }
  } else if (role === BOSS) {
    // long arms, hanging to her knees, clawed
    arm(3 + (walking ? [1, 0, -1, 0][F] * 0.5 : 0) + (ch.spit > 0 ? -1 : 0), 17, 0.2, -1, 10, false)
  } else {
    // bent at the elbow, the hand before her
    const bob = walking && F % 2 ? 1 : 0
    fill(dress.outline, 3, 15, 3, 3)
    fill(dress.light, 4, 14 + bob, 2, 1)
    fill(skin.base, 6, 14 + bob, 1, 1)
  }

  // ---- the brood: heads from under her skirts -------------------------------------
  if (ch.scream) {
    ctx.translate(-u(lean), 0)
    const dart = frameOf(t, 10, 2)
    for (const [x, d, n] of [[-4, -1, 5], [3.5, 1, 5], [0, 1, 3]]) {
      for (let j = 0; j < n; j++) {
        const sx = x + d * (j + dart * 0.5), sh = 1.5 + (j % 2 ? 0.5 : 0) + (j === n - 1 ? 0.5 : 0)
        fill(hair.outline, sx - 0.5, sh + 0.5, 2, 2)
        fill(j === n - 1 ? hair.light : j % 2 ? hair.base : hair.light, sx, sh, 1, 1)
        if (j === n - 1) { fill(red, sx + (d > 0 ? 0.5 : 0), sh, 0.5, 0.5); fill(red, sx + (d > 0 ? 1.5 : -1), sh - 0.5, 0.5, 0.5) }
      }
    }
  }
  ctx.restore()

  // One long arm (Syöjätär's, or anybody's thrown up in a scream): a chain
  // of joints from the shoulder, dx forward and dh up each, claws at the end.
  function arm(x, h, dx, dh, n, spread) {
    for (let i = 0; i <= n; i++) fill(i < n * 0.5 ? dress.outline : skin.outline, x + dx * i - 0.5, h + dh * i + 0.5, 2, 2)
    for (let i = 0; i <= n; i++) fill(i < n * 0.5 ? dress.light : i % 3 === 2 ? skin.light : skin.base, x + dx * i, h + dh * i, 1, 1)
    const ex = x + dx * n, eh = h + dh * n
    ctx.fillStyle = bone
    if (spread) { rect(ex - 1, eh + 1.5, 0.5, 1.5); rect(ex + 0.25, eh + 2, 0.5, 1.5); rect(ex + 1.5, eh + 1.5, 0.5, 1.5) }
    else { rect(ex - 0.5, eh - 1, 0.5, 1.5); rect(ex + 0.25, eh - 1, 0.5, 2); rect(ex + 1, eh - 1, 0.5, 1.5) }
  }

  // One snake of her hair: links out from the scalp, writhing; on end when
  // she screams, swept back when she rears to spit.
  function snake(s, i) {
    const n = s.n + (ch.scream ? 2 : 0)
    const a = s.a - (ch.spit > 0 && ch.spit < 1 ? 0.45 : 0)
    const dx = Math.cos(a), dy = Math.sin(a)
    const at = j => {
      const wave = ch.scream ? 0 : Math.sin(t * 4 + j * 1.1 + i * 2.3) * 0.8 * (j / n)
      return [R((s.x + dx * j - dy * wave) * 2) / 2, R((s.h - dy * j - dx * wave) * 2) / 2]
    }
    for (let j = 0; j < n; j++) { const [x, h] = at(j); fill(hair.outline, x - 0.5, h + 0.5, 2, 2) }
    for (let j = 0; j < n; j++) {
      const [x, h] = at(j)
      fill(j === n - 1 ? hair.light : j % 2 ? hair.base : hair.light, x, h, 1, 1)
      if (j % 2 === 0 && j < n - 1) fill(hair.base, x, h - 0.5, 1, 0.5)
    }
    const [x, h] = at(n - 1)
    fill(red, x + (dx > 0 ? 0.5 : 0), h, 0.5, 0.5)
    if (ch.scream || frameOf(t + i * 0.37, 5, 3) === 0) fill(red, x + 0.25 + dx * 1.25, h - 0.25 - dy * 1.25, 0.5, 0.5)
  }
}
