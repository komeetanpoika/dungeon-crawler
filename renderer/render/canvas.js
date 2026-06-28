import { TILE } from '../systems/entities.js'
import { loadSprites } from './sprites.js'
import { walkTilt } from '../systems/walk.js'
import { drawDragonBoss } from './dragonboss.js'

const TILE_SIZE = 32

function drawOverlay(ctx, tileObj, px, py, S, sprites) {
  if (tileObj?.overlay && sprites[tileObj.overlay]) {
    ctx.drawImage(sprites[tileObj.overlay], px, py, S, S)
  }
}

export function drawTile(ctx, tileId, px, py, S, sprites, tileObj = null) {
  if (tileId === TILE.STAIR) {
    const w   = tileObj?.stairWidth ?? 1
    const col = tileObj?.stairCol   ?? 0
    let s
    if (w === 3) {
      s = col === 0 ? sprites.stair_left : col === 1 ? sprites.stair_mid : sprites.stair_right
    }
    s = s ?? sprites.stair
    if (s) ctx.drawImage(s, px, py, S, S)
    else { ctx.fillStyle = '#111'; ctx.fillRect(px, py, S, S) }
    const depth = tileObj?.stairDepth
    if (depth > 0) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(depth / 7, 1) * 0.85})`
      ctx.fillRect(px, py, S, S)
    }
    return
  }
  if (tileId === TILE.SNARE) {
    if (sprites.floor) ctx.drawImage(sprites.floor, px, py, S, S)
    ctx.fillStyle = 'rgba(0, 200, 200, 0.35)'
    ctx.fillRect(px, py, S, S)
    return
  }
  // Decoration-pass skin (only ever set on floor/wall cells)
  if (tileObj?.skin && sprites[tileObj.skin]) {
    ctx.drawImage(sprites[tileObj.skin], px, py, S, S)
    drawOverlay(ctx, tileObj, px, py, S, sprites)
    return
  }
  const s = (() => {
    switch (tileId) {
      case TILE.WALL:        return sprites.wall
      case TILE.FLOOR:       return sprites.floor
      case TILE.FLOOR_WOOD:  return sprites.floor_wood
      case TILE.COLUMN:      return sprites.column
      case TILE.DOOR:        return sprites.door
      case TILE.STAIRS_DOWN: return sprites.stairs_dn
      case TILE.STAIRS_UP:   return sprites.stairs_up
      case TILE.TREASURE:    return sprites.treasure
      case TILE.SHRINE:      return sprites.shrine
      case TILE.SAND:        return sprites.sand
      default: return null
    }
  })()
  if (s) ctx.drawImage(s, px, py, S, S)
  else { ctx.fillStyle = '#111'; ctx.fillRect(px, py, S, S) }
  if (tileId === TILE.STAIRS_DOWN && tileObj?.stairDepth > 0) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(tileObj.stairDepth / 7, 1) * 0.85})`
    ctx.fillRect(px, py, S, S)
  }
  drawOverlay(ctx, tileObj, px, py, S, sprites)
}

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

function drawWalker(ctx, sprite, px, py, S, flip, tiltDeg) {
  ctx.save()
  ctx.translate(px + S / 2, py + S)        // pivot at the feet (center-bottom)
  ctx.rotate(tiltDeg * Math.PI / 180)
  ctx.scale(flip ? -1 : 1, 1)
  ctx.drawImage(sprite, -S / 2, -S, S, S)
  ctx.restore()
}

// Whether to draw the player this frame. Flickers while invulnerable (i-frames).
export function isFlickerVisible(invulnTimer, interval = 0.06) {
  if (!(invulnTimer > 0)) return true
  return Math.floor(invulnTimer / interval) % 2 === 0
}

function drawEntity(ctx, entity, px, py, S, sprites) {
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
  if (entity.type === 'floating_item') {
    const c = entity.contents
    if (c.type === 'weapon') {
      const s = sprites[`weapon_${c.weaponType}`]
      if (s) ctx.drawImage(s, px, py, S, S)  // no background fill — item is airborne
    } else if (c.type === 'potion') {
      drawPotion(ctx, px, py, S, sprites.potion)
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
    if (sprites.guard) drawWalker(ctx, sprites.guard, px, py, S, flip, walkTilt(entity))
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
    if (sprites.player) ctx.drawImage(sprites.player, -S / 2, -S, S, S)
    if (entity.weapon) {
      const ws = sprites[`weapon_${entity.weapon.weaponType}`]
      if (ws) {
        const hw = Math.round(S * 0.5)
        // In this flipped local space, "behind on the right" is +x for both facings.
        ctx.drawImage(ws, S / 2 - hw, -hw, hw, hw)
      }
    }
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

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3) }
function easeInOutCubic(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2 }

function drawMeleeSwing(ctx, player, sprites, camX, camY, S) {
  if (!(player.attackTimer > 0) || !(player.attackDuration > 0)) return
  const t = 1 - player.attackTimer / player.attackDuration
  const alpha = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2
  const base = { east: 0, south: Math.PI/2, west: Math.PI, north: -Math.PI/2 }[player.attackFacing] ?? 0
  const pcx = player.px - camX
  const pcy = player.py - camY
  const ws = sprites[`weapon_${player.weapon?.weaponType}`]

  function trail(a0, a1, radius, r, g, b, width) {
    const lo = Math.min(a0, a1), hi = Math.max(a0, a1)
    if (hi - lo < 0.01) return
    ctx.save()
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha * 0.4})`
    ctx.lineWidth = width; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.arc(pcx, pcy, radius, lo, hi); ctx.stroke()
    ctx.restore()
  }

  function weapon(angle, scale = 1) {
    ctx.save()
    ctx.translate(pcx, pcy)
    ctx.rotate(angle)
    ctx.rotate(-Math.PI / 2)   // orient so blade points outward along the arm
    ctx.scale(scale, scale)
    ctx.globalAlpha = alpha
    if (ws) {
      ctx.drawImage(ws, -S/2, -S * 0.9, S, S)
    } else {
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 4; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -S * 0.9); ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.restore()
  }

  const style = player.attackStyle

  if (style === 'snap') {
    // Dagger: fast 90° snap with slight overshoot
    const raw = t < 0.65
      ? easeOutCubic(t / 0.65)
      : 1 + Math.sin((t - 0.65) / 0.35 * Math.PI) * 0.22
    const angle = base + (raw - 0.5) * (Math.PI / 2)
    trail(base - Math.PI/4, angle, S * 0.8, 255, 230, 80, 7)
    weapon(angle, 0.85)

  } else if (style === 'arc') {
    // Sword: 140° side-to-side sweep
    const sweep = (easeOutCubic(t) * 2 - 1) * (Math.PI * 70/180)
    const angle = base + sweep
    trail(base - Math.PI*70/180, angle, S * 1.3, 180, 180, 255, 11)
    weapon(angle)

  } else if (style === 'slash') {
    // Longsword: overhead slam from –162° to +18°
    const startA = base - Math.PI * 0.9
    const endA   = base + Math.PI * 0.1
    const angle  = startA + easeOutCubic(t) * (endA - startA)
    trail(startA, angle, S * 1.55, 150, 220, 255, 14)
    weapon(angle, 1.25)

  } else if (style === 'spin') {
    // Axe: full 360° spin with fading trail
    const angle = base + easeInOutCubic(t) * Math.PI * 2
    for (let i = 2; i >= 0; i--) {
      const ta = Math.max(0, t - i * 0.07)
      trail(base, base + easeInOutCubic(ta) * Math.PI * 2, S + i * 5, 255, 140, 50, 13 - i * 3)
    }
    weapon(angle, 1.15)
  }
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

function drawHealthBars(ctx, entities, map, camX, camY, S) {
  for (const e of entities) {
    if (!e.inCombat || e.hp === undefined || e.maxHp === undefined) continue
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

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.ctx.imageSmoothingEnabled = false
    this.S = TILE_SIZE
    this.camX = 0
    this.camY = 0
    this.debug = false
    this.sprites = {}
  }

  async loadSprites(extraNames = []) {
    this.sprites = await loadSprites(extraNames)
  }

  resize() {
    this.canvas.width = this.canvas.offsetWidth
    this.canvas.height = this.canvas.offsetHeight
    this.ctx.imageSmoothingEnabled = false
  }

  updateCamera(player) {
    const px = player.px ?? (player.x * this.S + this.S / 2)
    const py = player.py ?? (player.y * this.S + this.S / 2)
    this.camX = px - this.canvas.width / 2
    this.camY = py - this.canvas.height / 2
  }

  render(state) {
    const { ctx, S, camX, camY, sprites } = this
    const { map, entities: rawEntities, player } = state
    const entities = rawEntities ?? []

    if (!map || !map.length || !map[0]) return
    if (!player) return
    const W = this.canvas.width, H = this.canvas.height
    if (W === 0 || H === 0) return

    const theme = state.theme ?? { bgColor: '#000', tint: null, fogAlpha: 0.65 }
    ctx.fillStyle = theme.bgColor
    ctx.fillRect(0, 0, W, H)

    const c0 = Math.max(0, Math.floor(camX / S))
    const c1 = Math.min(map[0].length, Math.ceil((camX + W) / S))
    const r0 = Math.max(0, Math.floor(camY / S))
    const r1 = Math.min(map.length, Math.ceil((camY + H) / S))

    for (let row = r0; row < r1; row++) {
      for (let col = c0; col < c1; col++) {
        const px = Math.round(col * S - camX)
        const py = Math.round(row * S - camY)
        const t = map[row][col]
        const isStair = t.tile === TILE.STAIR || t.tile === TILE.STAIRS_UP || t.tile === TILE.STAIRS_DOWN
        if (!t.explored && !isStair) continue
        drawTile(ctx, t.tile, px, py, S, sprites, t)
        if (!t.visible && !isStair) {
          ctx.fillStyle = `rgba(0,0,0,${theme.fogAlpha})`
          ctx.fillRect(px, py, S, S)
        }
      }
    }

    // Depth tint overlay (after tiles, before entities)
    if (theme.tint) {
      ctx.fillStyle = theme.tint
      ctx.fillRect(0, 0, W, H)
    }

    for (const e of entities) {
      const margin = e.type === 'dragon' ? 5 : e.type === 'dragon_boss' ? 6 : e.type === 'cyclops' ? 2 : 0
      if (e.x + margin < c0 || e.x - margin >= c1 || e.y + margin < r0 || e.y - margin >= r1) continue
      if (!map[e.y]?.[e.x]?.visible) continue
      const epx = e.px !== undefined ? Math.round(e.px - S/2 - camX) : Math.round(e.x * S - camX)
      const epy = e.py !== undefined ? Math.round(e.py - S/2 - camY) : Math.round(e.y * S - camY)
      if (e.type === 'dragon_boss') drawDragonBoss(ctx, e, camX, camY, S)
      else drawEntity(ctx, e, epx, epy, S, sprites)
    }
    const ppx = player.px !== undefined ? Math.round(player.px - S/2 - camX) : Math.round(player.x * S - camX)
    const ppy = player.py !== undefined ? Math.round(player.py - S/2 - camY) : Math.round(player.y * S - camY)
    if (isFlickerVisible(player.invulnTimer)) drawEntity(ctx, player, ppx, ppy, S, sprites)
    if (player.grabbed) {
      ctx.save()
      ctx.globalAlpha = 0.45
      ctx.fillStyle = '#ef4444'
      ctx.fillRect(ppx, ppy, S, S)
      ctx.restore()
    }
    drawMeleeSwing(ctx, player, sprites, camX, camY, S)
    const dragon = entities.find(e => e.type === 'dragon')
    if (dragon) drawDragonBreath(ctx, dragon, camX, camY)
    const cyclops = entities.find(e => e.type === 'cyclops')
    if (cyclops) drawCyclopsEffects(ctx, cyclops, camX, camY)
    drawHealthBars(ctx, entities, map, camX, camY, S)

    // Draw projectiles
    for (const p of state.projectiles ?? []) {
      const bpx = Math.round(p.px - camX)
      const bpy = Math.round(p.py - camY)
      ctx.fillStyle = p.color ?? '#facc15'
      ctx.fillRect(bpx - 2, bpy - 2, 4, 4)
    }

    if (state.hitEffects?.length > 0) {
      for (const { x, y } of state.hitEffects) {
        if (x < c0 || x >= c1 || y < r0 || y >= r1) continue
        drawHitEffect(ctx, x, y, camX, camY, S)
      }
    }

    if (this.debug) this._drawDebug(state, c0, c1, r0, r1)
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
