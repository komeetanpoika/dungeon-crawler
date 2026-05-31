import { TILE } from '../systems/entities.js'
import { loadSprites } from './sprites.js'

const TILE_SIZE = 32

function drawTile(ctx, tileId, px, py, S, sprites) {
  if (tileId === TILE.SNARE) {
    if (sprites.floor) ctx.drawImage(sprites.floor, px, py, S, S)
    ctx.fillStyle = 'rgba(0, 200, 200, 0.35)'
    ctx.fillRect(px, py, S, S)
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
      default: return null
    }
  })()
  if (s) ctx.drawImage(s, px, py, S, S)
  else { ctx.fillStyle = '#111'; ctx.fillRect(px, py, S, S) }
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

function drawEntity(ctx, entity, px, py, S, sprites) {
  if (entity.type === 'door') {
    const s = sprites[`door_${entity.frame}`]
    if (s) ctx.drawImage(s, px, py, S, S)
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
    if (sprites.wizard) ctx.drawImage(sprites.wizard, px, py, S, S)
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
  if (entity.type === 'crab') {
    if (sprites.crab) ctx.drawImage(sprites.crab, px, py, S, S)
    return
  }
  if (entity.type === 'player') {
    const flip = entity.facing === 'west'
    if (sprites.player) drawImg(ctx, sprites.player, px, py, S, S, flip)
    if (entity.weapon) {
      const ws = sprites[`weapon_${entity.weapon.weaponType}`]
      if (ws) {
        const hw = Math.round(S * 0.5)
        const wx = flip ? px : px + S - hw
        ctx.drawImage(ws, wx, py + S - hw, hw, hw)
      }
    }
    return
  }
  const flip = entity.facing === 'west'
  const s = (() => {
    switch (entity.type) {
      case 'guard':   return sprites.guard
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

  async loadSprites() {
    this.sprites = await loadSprites()
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

    ctx.fillStyle = '#000'
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
        if (!t.explored) continue
        drawTile(ctx, t.tile, px, py, S, sprites)
        if (!t.visible) {
          ctx.fillStyle = 'rgba(0,0,0,0.65)'
          ctx.fillRect(px, py, S, S)
        }
      }
    }

    for (const e of entities) {
      const margin = e.type === 'dragon' ? 5 : e.type === 'cyclops' ? 2 : 0
      if (e.x + margin < c0 || e.x - margin >= c1 || e.y + margin < r0 || e.y - margin >= r1) continue
      if (!map[e.y]?.[e.x]?.visible) continue
      const epx = e.px !== undefined ? Math.round(e.px - S/2 - camX) : Math.round(e.x * S - camX)
      const epy = e.py !== undefined ? Math.round(e.py - S/2 - camY) : Math.round(e.y * S - camY)
      drawEntity(ctx, e, epx, epy, S, sprites)
    }
    const ppx = player.px !== undefined ? Math.round(player.px - S/2 - camX) : Math.round(player.x * S - camX)
    const ppy = player.py !== undefined ? Math.round(player.py - S/2 - camY) : Math.round(player.y * S - camY)
    drawEntity(ctx, player, ppx, ppy, S, sprites)
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
