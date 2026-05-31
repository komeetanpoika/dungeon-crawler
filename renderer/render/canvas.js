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
      ctx.drawImage(sprites.dragon, px - S, py - S * 2, ds, ds)
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
  if (entity.type === 'player') {
    if (sprites.player) ctx.drawImage(sprites.player, px, py, S, S)
    if (entity.weapon) {
      const ws = sprites[`weapon_${entity.weapon.weaponType}`]
      if (ws) {
        const hw = Math.round(S * 0.5)
        ctx.drawImage(ws, px + S - hw, py + S - hw, hw, hw)
      }
    }
    return
  }
  const s = (() => {
    switch (entity.type) {
      case 'guard':   return sprites.guard
      case 'monster': return sprites[`monster_${entity.variant ?? 'weak'}`]
      case 'trap':    return entity.triggered ? null : sprites.trap
      case 'puzzle':  return entity.solved ? null : sprites.puzzle
      default: return null
    }
  })()
  if (s) ctx.drawImage(s, px, py, S, S)
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
      const margin = e.type === 'dragon' ? 5 : 0
      if (e.x + margin < c0 || e.x - margin >= c1 || e.y + margin < r0 || e.y - margin >= r1) continue
      if (!map[e.y]?.[e.x]?.visible) continue
      const epx = e.px !== undefined ? Math.round(e.px - S/2 - camX) : Math.round(e.x * S - camX)
      const epy = e.py !== undefined ? Math.round(e.py - S/2 - camY) : Math.round(e.y * S - camY)
      drawEntity(ctx, e, epx, epy, S, sprites)
    }
    const ppx = player.px !== undefined ? Math.round(player.px - S/2 - camX) : Math.round(player.x * S - camX)
    const ppy = player.py !== undefined ? Math.round(player.py - S/2 - camY) : Math.round(player.y * S - camY)
    drawEntity(ctx, player, ppx, ppy, S, sprites)
    drawHealthBars(ctx, entities, map, camX, camY, S)

    // Draw projectiles
    for (const p of state.projectiles ?? []) {
      const ppx = Math.round(p.px - camX)
      const ppy = Math.round(p.py - camY)
      ctx.fillStyle = '#facc15'
      ctx.fillRect(ppx - 2, ppy - 2, 4, 4)
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
