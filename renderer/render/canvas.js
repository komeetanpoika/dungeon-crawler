import { TILE } from '../systems/entities.js'
import { loadSprites } from './sprites.js'
import { walkTilt } from '../systems/walk.js'
import { drawDragonBoss } from './dragonboss.js'
import { drawDragonBossPixel } from './dragonboss-pixel.js'
import { PIXEL_SKIN } from '../systems/dragonboss.js'
import { WEAPONS, getEnemyWeapon } from '../systems/enemy-attack.js'
import { getSwingArc, CHARGE } from '../systems/melee.js'
import { GUST_CHARGE } from '../systems/magic.js'
import { FLOAT_DUR, BUBBLE_DUR, BANNER_DUR } from '../systems/feedback.js'
import { spriteKeyFor, REACT_TIME } from '../systems/npc.js'
import { NPC_SPECIES } from '../data/npcs.js'
import { campfireAlpha } from '../systems/campfire.js'
import { creatureAlpha } from '../systems/creatures.js'
import { ERUPT_TIME } from '../systems/monsters/maahinen.js'
import { getMonsterDef, drawGeneratedMonster, isStoryCreature } from '../systems/monsters.js'
import { STRIKE_LIFE, LIGHTNING } from '../systems/spells/lightning.js'
import { makeWeatherLayer, drawNight, drawFog } from './weather.js'
import { drawTile } from './tiles.js'
import { makeTileLayer, makeDirectTileLayer } from './tile-layer.js'

const TILE_SIZE = 32

export { drawTile }

function drawWeapon(ctx, weaponType, px, py, S, sprites) {
  const key = `weapon_${weaponType}`
  const s = sprites[key]
  if (s) {
    ctx.fillStyle = '#1e1612'
    ctx.fillRect(px, py, S, S)
    ctx.drawImage(s, px, py, S, S)
  }
}

function drawPotion(ctx, px, py, S, sprite) {
  if (sprite) ctx.drawImage(sprite, px, py, S, S)
}

function drawImg(ctx, sprite, px, py, w, h, flip = false) {
  if (!flip) { ctx.drawImage(sprite, px, py, w, h); return }
  ctx.save()
  ctx.translate(px + w, py)
  ctx.scale(-1, 1)
  ctx.drawImage(sprite, 0, 0, w, h)
  ctx.restore()
}

// Weapon gripped in the hand. Walker local space: origin at the feet,
// un-flipped (facing east); the grip (bottom-center of the weapon tile) sits
// in the palm at mid-body, blade tilted slightly outward. Sized between the
// old carried icon (0.55S) and the swing animation's weapon (1S).
function drawHeldWeapon(ctx, ws, S) {
  const hw = Math.round(S * 0.8)
  ctx.save()
  ctx.translate(-S * 0.30, -S * 0.34)
  ctx.rotate(-0.35)
  ctx.drawImage(ws, -hw / 2, -hw * 0.85, hw, hw)
  ctx.restore()
}

function drawWalker(ctx, sprite, px, py, S, flip, tiltDeg, heldWeapon = null) {
  ctx.save()
  ctx.translate(px + S / 2, py + S)        // pivot at the feet (center-bottom)
  ctx.rotate(tiltDeg * Math.PI / 180)
  ctx.scale(flip ? -1 : 1, 1)
  ctx.drawImage(sprite, -S / 2, -S, S, S)
  if (heldWeapon) drawHeldWeapon(ctx, heldWeapon, S)
  ctx.restore()
}

// Whether to draw the player this frame. Flickers while invulnerable (i-frames).
export function isFlickerVisible(invulnTimer, interval = 0.06) {
  if (!(invulnTimer > 0)) return true
  return Math.floor(invulnTimer / interval) % 2 === 0
}

// The player's look follows the stance: bare adventurer (or the knight once
// Might is learned) in melee, the ranger in ranged, the wizard in magic.
export function playerSpriteKey(player, mode) {
  if (mode === 'ranged') return 'player_ranged'
  if (mode === 'magic') return 'player_magic'
  return (player.talents ?? []).includes('heavy_weapons') ? 'player_melee_heavy' : 'player_base'
}

export function drawEntity(ctx, entity, px, py, S, sprites) {
  if (entity.type === 'door') {
    const s = sprites[`door_${entity.frame}`]
    if (s) ctx.drawImage(s, px, py, S, S)
    return
  }
  if (entity.type === 'key') {
    // Placeholder: the 🔑 emoji centered in the tile (no sprite asset).
    ctx.save()
    ctx.font = `${Math.round(S * 0.9)}px serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('🔑', px + S / 2, py + S / 2)
    ctx.restore()
    return
  }
  if (entity.type === 'treasure') {
    const s = sprites[`weapon_${entity.weaponType}`] ?? sprites.treasure
    if (s) {
      const prevFilter = ctx.filter
      ctx.filter = 'sepia(1) saturate(3) brightness(1.15)'  // gold tint — placeholder treasure
      ctx.drawImage(s, px, py, S, S)
      ctx.filter = prevFilter
    }
    return
  }
  if (entity.type === 'chest') {
    const s = sprites[`chest_${entity.frame}`]
    if (s) ctx.drawImage(s, px, py, S, S)
    return
  }
  if (entity.type === 'dragon') {
    if (sprites.dragon) {
      const ds = S * 3
      const flip = entity.facing === 'west'
      drawImg(ctx, sprites.dragon, px - S, py - S * 2, ds, ds, flip)
    }
    return
  }
  if (entity.type === 'weapon') {
    drawWeapon(ctx, entity.weaponType, px, py, S, sprites)
    return
  }
  if (entity.type === 'potion') {
    drawPotion(ctx, px, py, S, sprites.potion)
    return
  }
  if (entity.type === 'campfire') {
    const s = sprites.prop_campfire
    if (!s) return
    const prev = ctx.globalAlpha, prevF = ctx.filter
    ctx.globalAlpha = prev * campfireAlpha(entity)
    if (entity.fuel === 'deadwood') ctx.filter = 'hue-rotate(185deg) saturate(0.45) brightness(1.25)'
    ctx.drawImage(s, px, py, S, S)
    ctx.filter = prevF; ctx.globalAlpha = prev
    return
  }
  if (entity.type === 'echo') {
    const s = sprites.player_magic
    const fade = entity.fadeA ?? 0
    if (!s || fade <= 0) return
    const bob = Math.round(Math.sin((entity.t ?? 0) * 2.2 * Math.PI * 2) * 3)
    const prevA = ctx.globalAlpha, prevF = ctx.filter
    ctx.fillStyle = `rgba(120,200,255,${(0.18 * fade).toFixed(3)})`
    ctx.beginPath()
    ctx.ellipse(px + S / 2, py + S - 2, S * 0.45, S * 0.18, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.filter = 'hue-rotate(160deg) saturate(0.6)'
    const trail = entity.trail ?? []
    for (const [j, a] of [[2, 0.12], [1, 0.25]]) {
      const tr = trail[j]
      if (!tr) continue
      ctx.globalAlpha = prevA * 0.55 * fade * a
      ctx.drawImage(s, px + Math.round(tr.px - entity.px), py + Math.round(tr.py - entity.py) + bob, S, S)
    }
    ctx.globalAlpha = prevA * 0.55 * fade
    ctx.drawImage(s, px, py + bob, S, S)
    ctx.filter = prevF; ctx.globalAlpha = prevA
    return
  }
  if (entity.type === 'floating_item') {
    const c = entity.contents
    if (c.type === 'weapon' || c.type === 'ranged') {
      const s = sprites[`weapon_${c.weaponType}`]
      if (s) ctx.drawImage(s, px, py, S, S)  // no background fill — item is airborne
    } else if (c.type === 'potion') {
      drawPotion(ctx, px, py, S, sprites.potion)
    } else {
      const key = { mushroom: 'ow_mushroom', meat: 'item_meat', cooked_meat: 'item_meat_cooked', lumber: 'item_lumber',
                    clapper: 'item_clapper', fleece: 'item_fleece' }[c.type]
      const s = key && sprites[key]
      if (s) ctx.drawImage(s, px, py, S, S)
      else { ctx.font = `${Math.round(S*0.8)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', px + S/2, py + S/2) }
    }
    return
  }
  if (entity.type === 'prop') {
    const s = sprites[entity.propType]
    if (entity.isFountainBasin) {
      // Draw only top 11/16 rows — floor tile beneath shows through bottom 5 rows
      if (s) ctx.drawImage(s, 0, 0, 16, 11, px, py, S, Math.round(S * 11 / 16))
      if (entity.flowing) drawBasinRipple(ctx, px, py, S, entity.fountainTime ?? 0)
      return
    }
    if (entity.isFountainWall) {
      if (s) ctx.drawImage(s, px, py, S, S)
      if (entity.flowing) drawGargoyleStream(ctx, px, py, S, entity.fountainTime ?? 0)
      return
    }
    if (s) ctx.drawImage(s, px, py, S, S)
    return
  }
  if (entity.type === 'cyclops') {
    const S2 = S * 2
    const shakeX = entity.state === 'charge_windup' ? Math.sin(Date.now() * 0.03) * 3 : 0
    const savedAlpha = ctx.globalAlpha
    if (entity.state === 'stunned') ctx.globalAlpha = 0.6
    if (sprites.cyclops) ctx.drawImage(sprites.cyclops, px - Math.round(S / 2) + shakeX, py - Math.round(S / 2), S2, S2)
    if (sprites.weapon_club && !entity.attack) {
      const cw = Math.round(S * 1.1)
      ctx.save()
      ctx.translate(px + S / 2 + shakeX, py + S / 2)   // body center of the 2S sprite
      if (entity.state === 'slam_windup' || entity.state === 'slamming') {
        // club raised overhead, quivering through the windup
        const q = entity.state === 'slam_windup' ? Math.sin(Date.now() * 0.04) * 0.06 : 0
        ctx.rotate(q)
        ctx.drawImage(sprites.weapon_club, -cw / 2, -Math.round(S2 * 0.95), cw, cw)
      } else {
        // gripped in its fist, tilted outward
        ctx.translate(-S * 0.75, S * 0.45)
        ctx.rotate(-0.45)
        ctx.drawImage(sprites.weapon_club, -cw / 2, -Math.round(cw * 0.85), cw, cw)
      }
      ctx.restore()
    }
    ctx.globalAlpha = savedAlpha
    return
  }
  if (entity.type === 'wizard') {
    if (sprites.wizard) drawWalker(ctx, sprites.wizard, px, py, S, false, walkTilt(entity))
    if (entity.shieldTimer > 0) {
      ctx.save()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.8
      ctx.beginPath()
      ctx.arc(px + S / 2, py + S / 2, S * 0.8, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
    return
  }
  if (entity.type === 'guard') {
    const flip = entity.facing === 'west'
    const held = entity.attack ? null : sprites.weapon_sword   // the swing draws it instead
    if (sprites.guard) drawWalker(ctx, sprites.guard, px, py, S, flip, walkTilt(entity), held)
    return
  }
  if (entity.type === 'npc') {
    const def = NPC_SPECIES[entity.species]
    const key = spriteKeyFor(entity)
    const s = (entity.hostile && def?.walker ? sprites.guard_alert : null) ?? sprites[key]
    if (!s) return
    const flip = entity.facing === 'west'
    if (def?.walker) { drawWalker(ctx, s, px, py, S, flip, walkTilt(entity)); return }
    const rt = entity.ai?.reactTimer ?? 0
    const hop = rt > 0 ? Math.round(6 * Math.sin(Math.PI * (1 - rt / REACT_TIME))) : 0
    drawImg(ctx, s, px, py - hop, S, S, flip)
    return
  }
  if (entity.type === 'crab') {
    if (sprites.crab) ctx.drawImage(sprites.crab, px, py, S, S)
    return
  }
  if (entity.type === 'player') {
    const flip = entity.facing === 'west'
    const tilt = walkTilt(entity)
    ctx.save()
    ctx.translate(px + S / 2, py + S)        // pivot at the feet
    ctx.rotate(tilt * Math.PI / 180)
    ctx.scale(flip ? -1 : 1, 1)              // flip handled here, so draw un-flipped below
    const sw = entity.stanceSwitch
    if (sw) {
      // Mid-switch: the old form fades into the new one.
      const k = Math.min(1, sw.t / sw.dur)
      const fromS = sprites[playerSpriteKey(entity, sw.from)]
      const toS = sprites[playerSpriteKey(entity, sw.to)]
      const prevAlpha = ctx.globalAlpha
      if (fromS) { ctx.globalAlpha = 1 - k; ctx.drawImage(fromS, -S / 2, -S, S, S) }
      if (toS) { ctx.globalAlpha = k; ctx.drawImage(toS, -S / 2, -S, S, S) }
      ctx.globalAlpha = prevAlpha
    } else {
      const s = sprites[playerSpriteKey(entity, entity.attackMode)]
      if (s) ctx.drawImage(s, -S / 2, -S, S, S)
    }
    if (!(entity.attackTimer > 0)) {   // the swing animation draws the melee weapon instead
      // One hand per stance: the bow in ranged, the wand hand in magic (a bow
      // stays slung there), the blade in melee.
      const held = entity.attackMode === 'ranged' ? entity.ranged
        : entity.attackMode === 'magic' ? entity.wand
        : entity.weapon
      const ws = held && sprites[`weapon_${held.weaponType}`]
      if (ws) drawHeldWeapon(ctx, ws, S)
    }
    ctx.restore()
    return
  }
  if (entity.type === 'wild_mushroom') {
    const s = sprites.ow_mushroom
    const deg = Math.round(((entity.hueT ?? 0) * 60) % 360)
    ctx.save()
    ctx.filter = `hue-rotate(${deg}deg) saturate(1.6)`
    if (s) ctx.drawImage(s, px, py, S, S)
    else { ctx.font = `${Math.round(S * 0.8)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🍄', px + S / 2, py + S / 2) }
    ctx.restore()
    return
  }
  const flip = entity.facing === 'west'
  const s = (() => {
    switch (entity.type) {
      case 'monster': return sprites[`monster_${entity.variant ?? 'weak'}`]
      case 'trap':    return entity.triggered ? null : sprites.trap
      case 'puzzle':  return entity.solved ? null : sprites.puzzle
      default: return null
    }
  })()
  if (s) drawImg(ctx, s, px, py, S, S, flip)
}

function drawHitEffect(ctx, x, y, camX, camY, S) {
  const px = Math.round(x * S - camX)
  const py = Math.round(y * S - camY)
  ctx.fillStyle = 'rgba(255, 70, 0, 0.72)'
  ctx.fillRect(px, py, S, S)
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(px + 5, py + 5); ctx.lineTo(px + S - 5, py + S - 5)
  ctx.moveTo(px + S - 5, py + 5); ctx.lineTo(px + 5, py + S - 5)
  ctx.stroke()
}

// The icy tint a frozen enemy wears: desaturated and lifted, then a pale sheen
// over the cell so the freeze reads even on an already-pale sprite.
const FROZEN_FILTER = 'saturate(0.4) brightness(1.3)'

function drawFrozenSheen(ctx, px, py, S) {
  ctx.save()
  ctx.globalAlpha = 0.35
  ctx.fillStyle = '#bfdbfe'
  ctx.fillRect(px, py, S, S)
  ctx.restore()
}

const ZONE_FADE = 1   // seconds a patch spends fading out at the end of its life

// Ground zones (systems/spells.js's `zone` primitive). Only bramble exists so
// far; the switch is here so a second kind is a case, not a rewrite. Three
// thorn strokes per cell, seeded by the cell coords rather than the wall clock
// so the scribble sits still for the patch's whole life.
function drawZones(ctx, zones, camX, camY, S) {
  for (const z of zones ?? []) {
    if (z.kind !== 'bramble') continue
    const fade = Math.max(0, Math.min(1, (z.dur - (z.age ?? 0)) / ZONE_FADE))
    ctx.save()
    ctx.globalAlpha = 0.6 * fade
    ctx.strokeStyle = '#365314'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    for (const t of z.tiles ?? []) {
      const tx = Math.round(t.x * S - camX), ty = Math.round(t.y * S - camY)
      for (let i = 0; i < 3; i++) {
        const lean = (t.x * 7 + t.y * 13 + i * 5) % 5
        ctx.beginPath()
        ctx.moveTo(tx + 3 + lean * 2, ty + S - 3)
        ctx.lineTo(tx + S - 4 - i * 4, ty + 3 + lean)
        ctx.stroke()
      }
    }
    ctx.restore()
  }
}

// Call Lightning, before the strike: a dashed ring spinning over the marked
// cell, drawn as six arc segments so no setLineDash support is assumed. The
// alpha crackles off the mark's own age — again, no wall clock.
function drawLightningMarks(ctx, marks, camX, camY, S) {
  for (const m of marks ?? []) {
    if (m.struck) continue
    const t = m.t ?? 0
    const cx = Math.round(m.x * S - camX) + S / 2
    const cy = Math.round(m.y * S - camY) + S / 2
    ctx.save()
    ctx.strokeStyle = '#a78bfa'
    ctx.lineWidth = 2
    ctx.globalAlpha = 0.55 + 0.35 * Math.sin(t * 30)
    for (let i = 0; i < 6; i++) {
      const a0 = t * 6 + i * (Math.PI / 3)
      ctx.beginPath()
      ctx.arc(cx, cy, S * 0.38, a0, a0 + Math.PI / 5)
      ctx.stroke()
    }
    ctx.restore()
  }
}

// Call Lightning, the strike itself: the 3×3 lit pale violet and a jagged bolt
// down from the top of the screen. The zig is seeded by the tile so a strike
// does not shimmer between frames of its 0.15 s.
function drawLightningBolts(ctx, strikes, camX, camY, S) {
  for (const s of strikes ?? []) {
    const k = Math.max(0, 1 - (s.t ?? 0) / STRIKE_LIFE)
    if (k <= 0) continue
    const cx = Math.round(s.x * S - camX) + S / 2
    const cy = Math.round(s.y * S - camY) + S / 2
    ctx.save()
    ctx.globalAlpha = 0.5 * k
    ctx.fillStyle = '#e9d5ff'
    ctx.fillRect(Math.round((s.x - 1) * S - camX), Math.round((s.y - 1) * S - camY), S * 3, S * 3)
    ctx.globalAlpha = k
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 3
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(cx, 0)
    const steps = 6
    for (let i = 1; i <= steps; i++) {
      const zig = i === steps ? 0 : Math.sin(s.x * 3 + s.y * 5 + i * 2.7) * S * 0.45
      ctx.lineTo(cx + zig, (cy * i) / steps)
    }
    ctx.stroke()
    ctx.restore()
  }
}

// The white-out a strike leaves behind. Drawn over the night wash on purpose —
// the whole point of Call Lightning at night is that it lights the map.
function drawFlash(ctx, flash, W, H) {
  if (!(flash > 0)) return
  const a = Math.min(1, flash / LIGHTNING.flash) * 0.85
  ctx.save()
  ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`
  ctx.fillRect(0, 0, W, H)
  ctx.restore()
}

// Fallbacks for shots that carry no colour of their own: steel quarrels and
// grey stones, matching the crossbow's and sling's table colours. Arrows keep
// the old yellow default.
const PROJECTILE_COLORS = { quarrel: '#e5e7eb', stone: '#a8a29e' }

// How long a blink trail lives; systems/spells.js decays state.blinkTrail.t on it.
export const BLINK_DUR = 0.2

// Blink: three silhouettes strung between where the wizard was and where he is,
// fading out over the trail's fifth of a second.
function drawBlinkTrail(ctx, trail, player, sprites, camX, camY, S) {
  if (!trail?.from || !trail?.to) return
  const s = sprites[playerSpriteKey(player, player.attackMode)]
  if (!s) return
  const fade = Math.max(0, 1 - (trail.t ?? 0) / BLINK_DUR)
  if (fade <= 0) return
  ctx.save()
  for (let i = 1; i <= 3; i++) {
    const f = i / 4
    ctx.globalAlpha = fade * 0.4 * (1 - f * 0.5)
    const px = Math.round(trail.from.px + (trail.to.px - trail.from.px) * f - S / 2 - camX)
    const py = Math.round(trail.from.py + (trail.to.py - trail.from.py) * f - S / 2 - camY)
    ctx.drawImage(s, px, py, S, S)
  }
  ctx.restore()
}

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3) }
function easeInOutCubic(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2 }

// Per-style default trail tints — the player's original colors.
const SWING_TINTS = { snap: [255, 230, 80], arc: [180, 180, 255], slash: [150, 220, 255], spin: [255, 140, 50] }

// The drawn swing is derived from the same wedge the hit test uses, as
// fractions of that wedge's reach: the trail's centreline, its stroke width and
// the blade tip all stay inside the reach, so nothing ever looks like it should
// have connected when it didn't.
const TRAIL_RADIUS = 0.80
const TRAIL_WIDTH  = 0.24
const BLADE_TIP    = 0.72
const SPRITE_LEN   = 0.9    // the weapon tile is drawn 0.9 tiles long, grip to tip

// Where the blade is at swing progress t ∈ [0,1]. Angles are offsets from the
// facing direction; radius/trailWidth are pixels at a 32px tile. `reachOverride`
// sizes the swing to a wielder that is not the player — enemy weapons carry
// their own reach.
export function swingPose(style, t, reachOverride = null) {
  const { halfAngle } = getSwingArc(style)
  const reach = reachOverride ?? getSwingArc(style).reach
  const pose = {
    radius: reach * TRAIL_RADIUS,
    trailWidth: reach * TRAIL_WIDTH,
    wscale: (reach * BLADE_TIP) / (TILE_SIZE * SPRITE_LEN),
    from: -halfAngle,
    angle: 0,
  }
  if (style === 'spin') {
    // Axe: a full whirl, so the sweep is the circle rather than the wedge.
    pose.from = 0
    pose.angle = easeInOutCubic(t) * Math.PI * 2
  } else if (style === 'snap') {
    // Dagger: flicks out fast, then recoils a touch — a poke, not a sweep.
    const raw = t < 0.65 ? easeOutCubic(t / 0.65) : 1 - Math.sin((t - 0.65) / 0.35 * Math.PI) * 0.12
    pose.angle = (raw * 2 - 1) * halfAngle
  } else {
    // Sword/longsword: sweep the whole wedge, fast out of the windup.
    pose.angle = (easeOutCubic(t) * 2 - 1) * halfAngle
  }
  return pose
}

// Shared swing core: rotates a weapon sprite (or draws natural-attack marks)
// around (cx, cy) with a colored arc trail. t ∈ [0,1] is swing progress.
// opts: { baseAngle, tint: [r,g,b], reach, marks: 'claw'|'pincer'|null }
function drawSwing(ctx, cx, cy, ws, style, t, S, opts = {}) {
  const alpha = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2
  const base = opts.baseAngle ?? 0
  const [r, g, b] = opts.tint ?? SWING_TINTS[style] ?? [200, 200, 200]

  function trail(a0, a1, radius, width) {
    const lo = Math.min(a0, a1), hi = Math.max(a0, a1)
    if (hi - lo < 0.01) return
    ctx.save()
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha * 0.4})`
    ctx.lineWidth = width; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.arc(cx, cy, radius, lo, hi); ctx.stroke()
    ctx.restore()
  }

  function weapon(angle, wscale = 1) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(angle)
    // Weapon tiles are drawn tip-up, so a +90° turn points the blade along the
    // swing angle — outward along the arm, not back over the shoulder.
    ctx.rotate(Math.PI / 2)
    ctx.scale(wscale, wscale)
    ctx.globalAlpha = alpha
    if (ws) {
      ctx.drawImage(ws, -S/2, -S * 0.9, S, S)
    } else if (opts.marks === 'claw') {
      // three claw lines raking outward
      ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`
      ctx.lineWidth = 2; ctx.lineCap = 'round'
      for (const off of [-5, 0, 5]) {
        ctx.beginPath(); ctx.moveTo(off, -S * 0.25); ctx.lineTo(off * 1.4, -S * 0.75); ctx.stroke()
      }
    } else if (opts.marks === 'pincer') {
      // two arcs closing like a pincer
      ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`
      ctx.lineWidth = 3; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.arc(-4, -S * 0.5, S * 0.22, -Math.PI * 0.2, Math.PI * 0.8); ctx.stroke()
      ctx.beginPath(); ctx.arc( 4, -S * 0.5, S * 0.22, Math.PI * 0.2, -Math.PI * 0.8, true); ctx.stroke()
    } else {
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 4; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -S * 0.9); ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.restore()
  }

  const pose = swingPose(style, t, opts.reach)
  const R = pose.radius * S / TILE_SIZE
  const W = pose.trailWidth * S / TILE_SIZE

  if (style === 'spin') {
    // Axe: full 360° whirl with a fading trail smeared inside the reach
    for (let i = 2; i >= 0; i--) {
      const ta = Math.max(0, t - i * 0.07)
      trail(base, base + swingPose(style, ta, opts.reach).angle, R - i * 4, W - i * 3)
    }
  } else {
    trail(base + pose.from, base + pose.angle, R, W)
  }
  weapon(base + pose.angle, pose.wscale)
}

export function drawMeleeSwing(ctx, player, sprites, camX, camY, S) {
  if (!(player.attackTimer > 0) || !(player.attackDuration > 0)) return
  const t = 1 - player.attackTimer / player.attackDuration
  const base = { east: 0, south: Math.PI/2, west: Math.PI, north: -Math.PI/2 }[player.attackFacing] ?? 0
  const ws = sprites[`weapon_${player.weapon?.weaponType}`]
  const reach = getSwingArc(player.attackStyle).reach * (player.attackReachMul ?? 1)
  drawSwing(ctx, player.px - camX, player.py - camY, ws, player.attackStyle, t, S, { baseAngle: base, reach })
}

// Dizzy orbit over a stunned enemy: three pale dots circling, phase driven
// by the stun timer so no wall clock is needed.
function drawStunStars(ctx, cx, cy, t) {
  ctx.save()
  ctx.fillStyle = '#fde68a'
  for (let i = 0; i < 3; i++) {
    const a = t * 6 + i * (Math.PI * 2 / 3)
    ctx.beginPath()
    ctx.arc(cx + Math.cos(a) * 8, cy + Math.sin(a) * 3, 2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

// Wind-up ring: fills while a charge weapon is held, stepping colour at each
// release tier — white (tap), gold (full swing), red (overcharged).
export function drawChargeRing(ctx, player, camX, camY) {
  if (!player.charging) return
  // Gust charges use their own thresholds regardless of the equipped
  // weapon — a melee charge weapon may still be holstered in magic stance.
  const c = player.charging.kind === 'gust' ? GUST_CHARGE : CHARGE[player.weapon?.weaponType]
  if (!c) return
  const t = player.charging.t
  const frac = Math.min(1, t / c.over)
  const color = t >= c.over ? '#e5484d' : t >= c.full ? '#f5a524' : '#e6e8e3'
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.globalAlpha = 0.9
  ctx.beginPath()
  ctx.arc(player.px - camX, player.py - camY, 14, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
  ctx.stroke()
  if (frac >= 1) {   // fully wound: a faint pulse so "ready" reads at a glance
    ctx.globalAlpha = 0.35
    ctx.beginPath()
    ctx.arc(player.px - camX, player.py - camY, 17, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

// Per-weapon enemy swing presentation: which art to use, in what colour. How
// big it is drawn is not a choice here — that comes from the weapon's reach.
const ENEMY_SWING = {
  sword:       { spriteKey: 'weapon_sword', tint: [180, 180, 255] },
  club:        { spriteKey: 'weapon_club',  tint: [255, 170, 60] },
  claw:        { marks: 'claw',   tint: [220, 220, 200] },
  dragon_claw: { marks: 'claw',   tint: [255, 150, 60] },
  pincer:      { marks: 'pincer', tint: [255, 90, 90] },
}

function drawWindupPose(ctx, cx, cy, ws, baseAngle, style, k, S, cfg, reach) {
  const quiver = Math.sin(Date.now() * 0.04) * 0.08 * k
  // Hold the weapon where the swing will start, so the telegraph shows the
  // side the blow is coming from — at the size it will strike at.
  const pose = swingPose(style, 0, reach)
  const angle = baseAngle + pose.from + quiver
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  ctx.rotate(Math.PI / 2)
  ctx.scale(pose.wscale, pose.wscale)
  ctx.globalAlpha = 0.55 + 0.45 * k
  if (ws) {
    ctx.drawImage(ws, -S/2, -S * 0.9, S, S)
  } else {
    // natural-attack tell: a faint ring that tightens as the strike nears
    const [r, g, b] = cfg.tint ?? [220, 220, 220]
    ctx.strokeStyle = `rgba(${r},${g},${b},${0.3 + 0.5 * k})`
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(0, -S * 0.5, S * 0.2 + k * 4, 0, Math.PI * 2); ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

export function drawEnemySwing(ctx, e, sprites, camX, camY, S) {
  const a = e.attack
  if (!a) return
  const cfg = ENEMY_SWING[a.weaponId] ?? {}
  // The wielder's own weapon, so per-entity weaponOverrides show up on screen.
  const w = getEnemyWeapon(e) ?? WEAPONS[a.weaponId] ?? {}
  const style = w.style ?? 'arc'
  const cx = e.px - camX, cy = e.py - camY
  const ws = cfg.spriteKey ? sprites[cfg.spriteKey] : null
  const k = a.duration > 0 ? 1 - a.timer / a.duration : 1
  if (a.phase === 'windup') {
    drawWindupPose(ctx, cx, cy, ws, a.angle, style, k, S, cfg, w.reach)
    return
  }
  drawSwing(ctx, cx, cy, ws, style, k, S,
    { baseAngle: a.angle, tint: cfg.tint, marks: cfg.marks, reach: w.reach })
}

const FIRE_PAL = [
  null, '#3d0000', '#7a0800', '#c22000', '#e85000',
  '#f97316', '#fbbf24', '#fde68a', '#ffffff',
]
const BREATH_CELL = 4
const BREATH_CONE_MAX = 200
const BREATH_CONE_HALF = Math.PI * 0.21

// ── Fountain animation ─────────────────────────────────────────────────────
// Pixels that differ between empty/full basin sprite (16×16 sprite space)
const BASIN_WATER_PX = [
  [7,0],[8,0],[7,1],[8,1],
  [4,2],[5,2],[6,2],[7,2],[8,2],[9,2],[10,2],[11,2],
  [4,3],[5,3],[6,3],[7,3],[8,3],[9,3],[10,3],[11,3],
  [4,4],[5,4],[6,4],[7,4],[8,4],[9,4],[10,4],[11,4],
  [4,5],[5,5],[6,5],[7,5],[8,5],[9,5],[10,5],[11,5],
  [4,6],[5,6],[6,6],[7,6],[8,6],[9,6],[10,6],[11,6],
]
// Pixels that differ between dry/flow gargoyle sprite (16×16 sprite space)
const GARG_STREAM_PX = [
  [7,10],[8,10],[7,11],[8,11],[7,12],[8,12],
  [7,13],[8,13],[7,14],[8,14],[7,15],[8,15],
]
// Water palette extracted from basin sprites
const W_DARK  = [37, 149, 106]
const W_MID   = [67, 225, 179]
const W_LIGHT = [105, 255, 212]

function waterLerp(a, b, t) {
  return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]
}
function waterColor(s) {
  if (s < 0.33) return waterLerp(W_DARK,  W_MID,   s / 0.33)
  if (s < 0.66) return waterLerp(W_MID,   W_LIGHT, (s - 0.33) / 0.33)
  return               waterLerp(W_LIGHT, W_DARK,  (s - 0.66) / 0.34)
}

// Ripple expanding from top-center of basin (where stream enters water)
function drawBasinRipple(ctx, px, py, S, t) {
  const SC = S / 16
  for (const [spx, spy] of BASIN_WATER_PX) {
    const dx = spx + 0.5 - 7.5, dy = spy + 0.5 - 0.0
    const dist = Math.sqrt(dx * dx + dy * dy)
    const phase = t * 2.5 - dist * 1.8
    const s = (Math.sin(phase) + 1) / 2
    const amp = Math.max(0, 1 - dist / 9)
    const blend = s * amp + 0.5 * (1 - amp)
    const [r, g, b] = waterColor(blend)
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(Math.round(px + spx * SC), Math.round(py + spy * SC), Math.ceil(SC), Math.ceil(SC))
  }
}

// Stream cycling downward from gargoyle mouth
function drawGargoyleStream(ctx, px, py, S, t) {
  const SC = S / 16
  for (const [spx, spy] of GARG_STREAM_PX) {
    const phase = t * 4 - spy * 0.7
    const s = (Math.sin(phase) + 1) / 2
    const [r, g, b] = waterColor(s)
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(Math.round(px + spx * SC), Math.round(py + spy * SC), Math.ceil(SC), Math.ceil(SC))
  }
}

function drawDragonBreath(ctx, dragon, camX, camY) {
  if (!dragon || dragon.breathState === 'idle') return
  const cx = dragon.px - camX
  const cy = dragon.py - camY

  if (dragon.breathState === 'charge') {
    const t = dragon.breathProgress ?? 0
    const flicker = Math.sin(Date.now() * 0.012) * 0.5 + 0.5
    const rings = Math.round(t * 5) + 1
    ctx.save()
    ctx.lineWidth = BREATH_CELL
    for (let r = 1; r <= rings; r++) {
      const heat = Math.min(8, Math.max(1, Math.round((7 - r) * flicker + 1)))
      ctx.globalAlpha = flicker * (1 - r * 0.16)
      ctx.strokeStyle = FIRE_PAL[heat]
      const hw = r * BREATH_CELL * 2
      ctx.strokeRect(cx - hw, cy - hw, hw * 2, hw * 2)
    }
    ctx.globalAlpha = 1
    ctx.restore()
  }

  if (dragon.breathState === 'exhale') {
    const t = dragon.breathProgress ?? 0
    const coneLen = BREATH_CONE_MAX * Math.min(1, t * 2.5)
    const gridCols = Math.ceil(coneLen / BREATH_CELL)

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(dragon.breathAngle)

    for (let gx = 0; gx < gridCols; gx++) {
      const worldX = gx * BREATH_CELL
      const halfW = Math.tan(BREATH_CONE_HALF) * worldX
      const halfCells = Math.ceil(halfW / BREATH_CELL) + 1
      const progress = gx / Math.max(1, gridCols)

      for (let gy = -halfCells; gy <= halfCells; gy++) {
        const worldY = gy * BREATH_CELL
        const edgeDist = halfW > 0 ? Math.abs(worldY) / halfW : 0
        if (edgeDist > 1) continue
        if (progress > 0.3 && Math.random() < 0.15) continue

        const edgeFall = 1 - edgeDist * edgeDist
        const tipFall  = 1 - progress * 0.4
        const flicker  = 0.85 + Math.sin(gx * 0.8 + gy * 1.2) * 0.15
        const heat = Math.min(8, Math.max(1, Math.round(edgeFall * tipFall * flicker * 7 + 1)))

        ctx.globalAlpha = Math.min(1, edgeFall * 1.4)
        ctx.fillStyle = FIRE_PAL[heat]
        ctx.fillRect(gx * BREATH_CELL, gy * BREATH_CELL, BREATH_CELL, BREATH_CELL)
      }
    }
    ctx.globalAlpha = 1
    ctx.restore()

    // Particles
    if (dragon.breathParticles) {
      for (const p of dragon.breathParticles) {
        if (p.life <= 0) continue
        const px = Math.round((p.x - camX) / BREATH_CELL) * BREATH_CELL
        const py = Math.round((p.y - camY) / BREATH_CELL) * BREATH_CELL
        const heat = Math.min(8, Math.max(1, Math.round(p.heat)))
        ctx.globalAlpha = p.life * 0.9
        ctx.fillStyle = FIRE_PAL[heat]
        ctx.fillRect(px, py, BREATH_CELL, BREATH_CELL)
      }
      ctx.globalAlpha = 1
    }
  }
}

function drawHealthBars(ctx, entities, map, camX, camY, S, state) {
  for (const e of entities) {
    if (!e.inCombat || e.hp === undefined || e.maxHp === undefined) continue
    if (e.dying > 0) continue
    if (isStoryCreature(e) && creatureAlpha(e, state) === 0) continue
    if (!map[e.y]?.[e.x]?.visible) continue
    const px = e.px !== undefined ? Math.round(e.px - S/2 - camX) : Math.round(e.x * S - camX)
    const py = e.py !== undefined ? Math.round(e.py - S/2 - camY) : Math.round(e.y * S - camY)
    const ratio = Math.max(0, Math.min(1, e.hp / e.maxHp))
    const color = ratio > 0.6 ? '#22c55e' : ratio > 0.3 ? '#facc15' : '#ef4444'
    ctx.fillStyle = '#111'
    ctx.fillRect(px, py - 7, S, 4)
    ctx.fillStyle = color
    ctx.fillRect(px, py - 7, Math.round(ratio * S), 4)
  }
}

// Maahinen eruption telegraph: a brown dust ring expanding from 8 to 40 px
// over ERUPT_TIME, reusing the cyclops slam-ring drawing style. The
// entity's own countdown timer (running ERUPT_TIME -> 0) drives progress.
const ERUPT_RING_MIN = 8
const ERUPT_RING_MAX = 40

function drawEruptRing(ctx, e, camX, camY) {
  const cx = Math.round(e.px - camX)
  const cy = Math.round(e.py - camY)
  const progress = 1 - Math.max(0, Math.min(1, (e.timer ?? 0) / ERUPT_TIME))
  const radius = ERUPT_RING_MIN + (ERUPT_RING_MAX - ERUPT_RING_MIN) * progress
  ctx.save()
  ctx.strokeStyle = `rgba(120,80,45,${Math.max(0, 1 - progress)})`
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function drawCyclopsEffects(ctx, cyclops, camX, camY) {
  if (!cyclops) return
  const cx = Math.round(cyclops.px - camX)
  const cy = Math.round(cyclops.py - camY)

  if (cyclops.state === 'slam_windup') {
    ctx.save()
    ctx.strokeStyle = '#f97316'
    ctx.lineWidth = 3
    ctx.globalAlpha = 0.7
    ctx.beginPath()
    ctx.arc(cx, cy, 20, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  if (cyclops.slamRing) {
    const { radius, maxRadius } = cyclops.slamRing
    const alpha = maxRadius > 0 ? 1 - radius / maxRadius : 0
    ctx.save()
    ctx.strokeStyle = '#f97316'
    ctx.lineWidth = 4
    ctx.globalAlpha = Math.max(0, alpha)
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
}

// The seven-wizard rite: white-robed figures on a ring, chant glyphs, and
// beams converging on the (possibly levitating) player. All positions and
// alphas come pre-computed in fx (systems/rites.js riteVisuals); target is
// the player's ground-anchored center in world px.
export function drawRiteCeremony(ctx, fx, camX, camY, S, wizardSprite, target) {
  const wizards = fx?.wizards ?? []
  if (!wizards.length) return
  const lift = fx.lift ?? 0
  const tx = target.px - camX
  const ty = target.py - lift - camY

  // Ground shadow stays behind while the player rises
  if (lift > 0) {
    ctx.save()
    ctx.globalAlpha = 0.3 * (1 - lift / 60)
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(target.px - camX, target.py - camY + S * 0.4, S * 0.35, S * 0.12, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  ctx.save()
  for (const w of wizards) {
    if (w.beam > 0) {
      const wx = w.px - camX, wy = w.py - camY
      ctx.lineCap = 'round'
      ctx.globalAlpha = 0.25 * w.beam
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 6
      ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(tx, ty); ctx.stroke()
      ctx.globalAlpha = 0.9 * w.beam
      ctx.strokeStyle = '#fef3c7'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(tx, ty); ctx.stroke()
    }
  }
  for (const w of wizards) {
    ctx.globalAlpha = w.alpha
    ctx.drawImage(wizardSprite, Math.round(w.px - S / 2 - camX), Math.round(w.py - S / 2 - camY), S, S)
  }
  ctx.font = 'bold 15px serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#f8fafc'
  for (const g of fx.glyphs ?? []) {
    ctx.globalAlpha = g.alpha
    ctx.fillText(g.char, Math.round(g.px - camX), Math.round(g.py - camY))
  }
  ctx.restore()
}

export function shakeOffset(shake) {
  if (!shake || shake <= 0) return { x: 0, y: 0 }
  return { x: (Math.random() * 2 - 1) * shake, y: (Math.random() * 2 - 1) * shake }
}

// Boss skins pick a renderer, nothing else: type, AI, hitboxes and damage are
// shared, so an unknown skin must still draw the real boss rather than nothing.
export function drawBossBySkin(ctx, e, camX, camY, S, sprites,
                               impl = { vector: drawDragonBoss, pixel: drawDragonBossPixel }) {
  if (e.skin === PIXEL_SKIN) impl.pixel(ctx, e, camX, camY, S, sprites)
  else impl.vector(ctx, e, camX, camY, S)
}

export class Renderer {
  // `weatherLayer` is injectable for tests; in the app it is the pair of
  // quarter-resolution offscreen canvases the weather passes paint through.
  // `tileLayer` likewise: the chunk cache in the app, the direct per-cell
  // path where there is no document to make offscreen canvases from.
  constructor(canvas, { weatherLayer, tileLayer } = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.ctx.imageSmoothingEnabled = false
    this.S = TILE_SIZE
    this.viewW = canvas.width
    this.viewH = canvas.height
    this.camX = 0
    this.camY = 0
    this.debug = false
    this.sprites = {}
    this.weatherLayer = weatherLayer
      ?? (typeof document !== 'undefined' ? makeWeatherLayer(() => document.createElement('canvas')) : null)
    this.tileLayer = tileLayer
      ?? (typeof document !== 'undefined' ? makeTileLayer(() => document.createElement('canvas')) : makeDirectTileLayer())
  }

  async loadSprites(extraNames = []) {
    this.sprites = await loadSprites(extraNames)
  }

  // Rite wizards wear white: the enemy wizard sprite desaturated and
  // brightened once into an offscreen canvas. Falls back to the plain
  // sprite where offscreen canvases or filters are unavailable.
  whiteWizardSprite() {
    if (this._whiteWizard === undefined) {
      this._whiteWizard = null
      const src = this.sprites.wizard
      try {
        const c = document.createElement('canvas')
        c.width = src.width
        c.height = src.height
        const cx = c.getContext('2d')
        cx.imageSmoothingEnabled = false
        cx.filter = 'saturate(0) brightness(1.7)'
        cx.drawImage(src, 0, 0)
        this._whiteWizard = c
      } catch { /* keep the fallback */ }
    }
    return this._whiteWizard ?? this.sprites.wizard
  }

  resize() {
    // Backing store at devicePixelRatio for crisp rendering; all camera/view
    // math stays in logical CSS pixels via viewW/viewH.
    const dpr = globalThis.devicePixelRatio ?? 1
    this.viewW = this.canvas.offsetWidth
    this.viewH = this.canvas.offsetHeight
    this.canvas.width = Math.round(this.viewW * dpr)
    this.canvas.height = Math.round(this.viewH * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.ctx.imageSmoothingEnabled = false
    this.weatherLayer?.resize(this.viewW, this.viewH)
  }

  updateCamera(player, shake = 0, fx = null) {
    const px = player.px ?? (player.x * this.S + this.S / 2)
    const py = player.py ?? (player.y * this.S + this.S / 2)
    const o = shakeOffset(shake)
    this.camX = px - this.viewW / 2 + o.x
    this.camY = py - this.viewH / 2 + o.y
    if (fx) { this.camX += fx.wobbleX; this.camY += fx.wobbleY }
  }

  render(state, fx = null) {
    const { ctx, S, camX, camY, sprites } = this
    const { map, entities: rawEntities, player } = state
    const entities = rawEntities ?? []

    if (!map || !map.length || !map[0]) return
    if (!player) return
    const W = this.viewW, H = this.viewH
    if (W === 0 || H === 0) return

    const theme = state.theme ?? { bgColor: '#000', tint: null, fogAlpha: 0.65 }
    ctx.fillStyle = theme.bgColor
    ctx.fillRect(0, 0, W, H)

    const c0 = Math.max(0, Math.floor(camX / S))
    const c1 = Math.min(map[0].length, Math.ceil((camX + W) / S))
    const r0 = Math.max(0, Math.floor(camY / S))
    const r1 = Math.min(map.length, Math.ceil((camY + H) / S))

    this.tileLayer.draw(ctx, map, sprites, S, camX, camY, W, H, theme.fogAlpha)

    // Depth tint overlay (after tiles, before entities)
    if (theme.tint) {
      ctx.fillStyle = theme.tint
      ctx.fillRect(0, 0, W, H)
    }

    // Ground effects lie on the floor, so they go on with the tiles: bramble
    // patches and the sigils of lightning marks that have not struck yet.
    drawZones(ctx, state.zones, camX, camY, S)
    drawLightningMarks(ctx, state.lightning, camX, camY, S)

    for (const e of entities) {
      const margin = getMonsterDef(e.type) ? 3 : e.type === 'dragon' ? 5 : e.type === 'dragon_boss' ? 6 : e.type === 'cyclops' ? 2 : 0
      if (e.x + margin < c0 || e.x - margin >= c1 || e.y + margin < r0 || e.y - margin >= r1) continue
      if (!map[e.y]?.[e.x]?.visible) continue
      const epx = e.px !== undefined ? Math.round(e.px - S/2 - camX) : Math.round(e.x * S - camX)
      const epy = e.py !== undefined ? Math.round(e.py - S/2 - camY) : Math.round(e.y * S - camY)
      // Rime's freeze tints whatever the enemy is drawn by, so it wraps the
      // whole draw rather than living inside drawEntity.
      const prevFilter = e.frozen ? ctx.filter : null
      if (e.frozen) ctx.filter = FROZEN_FILTER
      if (getMonsterDef(e.type)) {
        drawGeneratedMonster(ctx, e, epx + S / 2, epy + S / 2, S, state)
        if (e.state === 'erupting') drawEruptRing(ctx, e, camX, camY)
      }
      else if (e.type === 'dragon_boss') drawBossBySkin(ctx, e, camX, camY, S, sprites)
      else drawEntity(ctx, e, epx, epy, S, sprites)
      if (e.frozen) { ctx.filter = prevFilter; drawFrozenSheen(ctx, epx, epy, S) }
      if (e.attack) drawEnemySwing(ctx, e, sprites, camX, camY, S)
      if (e.stunTimer > 0) drawStunStars(ctx, epx + S / 2, epy - 4, e.stunTimer)
    }
    const ppx = player.px !== undefined ? Math.round(player.px - S/2 - camX) : Math.round(player.x * S - camX)
    const lift = Math.round(fx?.lift ?? 0)
    const ppy = (player.py !== undefined ? Math.round(player.py - S/2 - camY) : Math.round(player.y * S - camY)) - lift
    if (fx?.wizards?.length) {
      drawRiteCeremony(ctx, fx, camX, camY, S, this.whiteWizardSprite(), {
        px: player.px ?? player.x * S + S / 2,
        py: player.py ?? player.y * S + S / 2,
      })
    }
    // The blink ghosts belong with the player: behind him, in front of the floor.
    drawBlinkTrail(ctx, state.blinkTrail, player, sprites, camX, camY, S)
    if (isFlickerVisible(player.invulnTimer)) drawEntity(ctx, player, ppx, ppy, S, sprites)
    if (player.grabbed) {
      ctx.save()
      ctx.globalAlpha = 0.45
      ctx.fillStyle = '#ef4444'
      ctx.fillRect(ppx, ppy, S, S)
      ctx.restore()
    }
    if (fx && fx.greenAlpha > 0) {
      ctx.save()
      ctx.globalAlpha = Math.min(0.6, fx.greenAlpha * 1.6)
      ctx.fillStyle = '#4ade80'
      ctx.fillRect(ppx, ppy, S, S)
      ctx.restore()
    }
    drawMeleeSwing(ctx, player, sprites, camX, camY, S)
    drawChargeRing(ctx, player, camX, camY)
    const dragon = entities.find(e => e.type === 'dragon')
    if (dragon) drawDragonBreath(ctx, dragon, camX, camY)
    const cyclops = entities.find(e => e.type === 'cyclops')
    if (cyclops) drawCyclopsEffects(ctx, cyclops, camX, camY)
    drawHealthBars(ctx, entities, map, camX, camY, S, state)

    // Draw projectiles. Arrows and crossbow quarrels are elongated along their
    // travel axis (the quarrel shorter and fatter); sparks trail; stones, wand
    // bolts, fireballs and enemy shots stay 4x4 squares.
    for (const p of state.projectiles ?? []) {
      const bpx = Math.round(p.px - camX)
      const bpy = Math.round(p.py - camY)
      const flat = Math.abs(p.dx) >= Math.abs(p.dy)   // travelling more across than down
      ctx.fillStyle = p.color ?? PROJECTILE_COLORS[p.shape] ?? '#facc15'
      if (p.shape === 'arrow') {
        if (flat) ctx.fillRect(bpx - 4, bpy - 1, 8, 2)
        else ctx.fillRect(bpx - 1, bpy - 4, 2, 8)
      } else if (p.shape === 'quarrel') {
        if (flat) ctx.fillRect(bpx - 4, bpy - 2, 8, 3)
        else ctx.fillRect(bpx - 2, bpy - 4, 3, 8)
      } else {
        if (p.shape === 'spark') {
          // A short tail behind the head, in the wand's colour — the spark is
          // the fastest thing on screen and reads as a smear without it.
          const len = Math.hypot(p.dx, p.dy) || 1
          ctx.save()
          ctx.globalAlpha = 0.5
          ctx.strokeStyle = p.color ?? '#facc15'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(bpx - (p.dx / len) * 7, bpy - (p.dy / len) * 7)
          ctx.lineTo(bpx, bpy)
          ctx.stroke()
          ctx.restore()
        }
        ctx.fillRect(bpx - 2, bpy - 2, 4, 4)
      }
    }

    // Rite ceremony: blur the finished frame onto itself, wash it green.
    if (fx && (fx.blur > 0 || fx.greenAlpha > 0)) {
      if (fx.blur > 0) {
        ctx.save()
        ctx.filter = `blur(${fx.blur.toFixed(1)}px)`
        ctx.drawImage(this.canvas, 0, 0, this.canvas.width, this.canvas.height, 0, 0, this.viewW, this.viewH)
        ctx.restore()
      }
      if (fx.greenAlpha > 0) {
        ctx.fillStyle = `rgba(74, 222, 128, ${fx.greenAlpha})`
        ctx.fillRect(0, 0, this.viewW, this.viewH)
      }
    }

    // Weather, pass one: the night wash with holes punched around fires —
    // before the flames so they stay bright. look is null underground.
    const look = state.weather?.look
    if (look && this.weatherLayer) {
      drawNight(ctx, this.weatherLayer, look, { camX, camY }, { W, H }, S)
    }

    // Fireball zones: flickering flames per burning tile. Deterministic
    // flicker seeded by zone age + tile coords (no wall-clock), fading over
    // the final 0.7 s of the zone's 3 s life.
    for (const z of state.fireZones ?? []) {
      const fade = Math.max(0, Math.min(1, (3.0 - z.age) / 0.7))
      for (const t of z.tiles) {
        const fx = Math.round(t.x * S - camX), fy = Math.round(t.y * S - camY)
        const phase = z.age * 10 + t.x * 7 + t.y * 13
        const flick = 0.75 + 0.25 * Math.sin(phase)
        ctx.save()
        ctx.globalAlpha = 0.35 * fade * flick
        ctx.fillStyle = '#ef4444'
        ctx.fillRect(fx + 2, fy + 2, S - 4, S - 4)
        ctx.globalAlpha = 0.7 * fade * flick
        ctx.fillStyle = '#f97316'
        const h = S * 0.5 * (0.7 + 0.3 * Math.sin(phase * 1.7))
        ctx.fillRect(fx + 6, fy + S - 6 - h, S - 12, h)
        ctx.globalAlpha = 0.8 * fade
        ctx.fillStyle = '#fbbf24'
        const h2 = S * 0.28 * (0.7 + 0.3 * Math.sin(phase * 2.3 + 1))
        ctx.fillRect(fx + 10, fy + S - 6 - h2, S - 20, h2)
        ctx.restore()
      }
    }

    // Maunonmiekka shockwaves: expanding crimson rings that fade out
    for (const w of state.shockwaves ?? []) {
      const k = Math.min(1, w.t / w.dur)
      ctx.save()
      ctx.strokeStyle = w.color ?? '#dc2626'
      ctx.lineWidth = 3
      ctx.globalAlpha = Math.max(0, 1 - k)
      ctx.beginPath()
      ctx.arc(w.px - camX, w.py - camY, w.maxRadius * k, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    if (state.hitEffects?.length > 0) {
      for (const { x, y } of state.hitEffects) {
        if (x < c0 || x >= c1 || y < r0 || y >= r1) continue
        drawHitEffect(ctx, x, y, camX, camY, S)
      }
    }

    // Call Lightning's strike lands after the night wash so the bolt, the lit
    // 3×3 and the white-out show at full strength in the dark — that flash
    // through the weather layer is the spell's whole signature. Still under the
    // mist and the feedback layer.
    drawLightningBolts(ctx, state.strikes, camX, camY, S)
    drawFlash(ctx, state.flash, W, H)

    // Weather, pass two: mist over the water, planks, creatures and player —
    // under floats, bubbles and banners.
    if (look && this.weatherLayer) {
      drawFog(ctx, this.weatherLayer, look, state.weather.fog, { camX, camY }, { W, H }, S, map)
    }

    this._drawFeedback(state)

    if (this.debug) this._drawDebug(state, c0, c1, r0, r1)
  }

  // Prominent message layer: rising damage/heal numbers, one speech/thought
  // bubble above the player, and a centered banner for milestone events.
  _drawFeedback(state) {
    const { ctx, camX, camY } = this
    const fb = state.feedback
    if (!fb) return
    if (fb.floats.length) {
      ctx.save()
      ctx.font = 'bold 13px monospace'
      ctx.textAlign = 'center'
      const COLORS = { taken: '#ef4444', dealt: '#f8fafc', heal: '#4ade80' }
      for (const f of fb.floats) {
        const k = f.t / FLOAT_DUR
        const x = Math.round(f.px - camX), y = Math.round(f.py - camY - 14 - k * 22)
        ctx.globalAlpha = Math.max(0, k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4)
        ctx.lineWidth = 3
        ctx.strokeStyle = 'rgba(0,0,0,0.8)'
        ctx.strokeText(f.text, x, y)
        ctx.fillStyle = COLORS[f.kind] ?? '#fff'
        ctx.fillText(f.text, x, y)
      }
      ctx.restore()
    }
    if (fb.bubble) {
      const anchor = (fb.bubble.anchorId && state.entities.find(e => e.id === fb.bubble.anchorId)) || state.player
      this._drawBubble(anchor, fb.bubble)
    }
    if (fb.banner) this._drawBanner(fb.banner)
  }

  _drawBubble(anchor, b) {
    const { ctx, camX, camY, viewW } = this
    const px = Math.round(anchor.px - camX), py = Math.round(anchor.py - camY)
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, b.t / 0.12, (BUBBLE_DUR - b.t) / 0.3))
    ctx.font = '12px monospace'
    const lines = ['']
    for (const w of b.text.split(' ')) {
      const cand = lines.at(-1) ? lines.at(-1) + ' ' + w : w
      if (ctx.measureText(cand).width > 190 && lines.at(-1)) lines.push(w)
      else lines[lines.length - 1] = cand
    }
    const padX = 8, lh = 15
    const bw = Math.ceil(Math.max(...lines.map(l => ctx.measureText(l).width))) + padX * 2
    const bh = lines.length * lh + 11
    const tailY = py - 34
    const bx = Math.max(4, Math.min(px - (bw >> 1), viewW - bw - 4))
    const by = tailY - bh
    ctx.fillStyle = 'rgba(250,250,245,0.95)'
    ctx.strokeStyle = '#1c1917'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 6); ctx.fill(); ctx.stroke()
    if (b.kind === 'speech') {
      ctx.beginPath()
      ctx.moveTo(px - 5, tailY - 1); ctx.lineTo(px + 6, tailY - 1); ctx.lineTo(px, tailY + 7)
      ctx.closePath(); ctx.fill(); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(px - 4, tailY - 1); ctx.lineTo(px + 5, tailY - 1); ctx.stroke()
    } else {
      for (const [r, dy] of [[3, 4], [2, 10]]) {
        ctx.beginPath(); ctx.arc(px, tailY + dy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      }
    }
    ctx.fillStyle = '#1c1917'
    ctx.textAlign = 'center'
    lines.forEach((l, i) => ctx.fillText(l, bx + (bw >> 1), by + (i + 1) * lh - 1))
    ctx.restore()
  }

  _drawBanner(b) {
    const { ctx, viewW } = this
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, b.t / 0.2, (BANNER_DUR - b.t) / 0.4))
    ctx.font = 'bold 16px monospace'
    const bw = Math.ceil(ctx.measureText(b.text).width) + 36
    const bh = 40
    const bx = Math.round((viewW - bw) / 2), by = 56
    ctx.fillStyle = 'rgba(12,12,18,0.88)'
    ctx.strokeStyle = '#b89030'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 4); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#f5f0e6'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(b.text, bx + bw / 2, by + bh / 2)
    ctx.restore()
  }

  _drawDebug(state, c0, c1, r0, r1) {
    const { ctx, S, camX, camY } = this
    if (state.noiseMap) {
      for (const [key, val] of Object.entries(state.noiseMap)) {
        const [x, y] = key.split(',').map(Number)
        if (x < c0 || x >= c1 || y < r0 || y >= r1) continue
        ctx.fillStyle = `rgba(255,200,0,${Math.min(0.6, val / 10)})`
        ctx.fillRect(Math.round(x * S - camX), Math.round(y * S - camY), S, S)
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.font = '9px monospace'
    ctx.textBaseline = 'top'
    for (let row = r0; row < r1; row++)
      for (let col = c0; col < c1; col++)
        ctx.fillText(`${col},${row}`, Math.round(col * S - camX), Math.round(row * S - camY) + 9)
  }
}
