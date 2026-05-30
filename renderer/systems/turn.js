import { TILE, ALERT, DRAGON_STATE, isWalkable } from './entities.js'

export const ACTION_NOISE = {
  move: 3,
  wait: 0,
  attack: 10,
  unlock: 5,
  trigger_trap: 8,
}

export function resolvePlayerAction(state, action) {
  const { player, map, entities } = state
  let newPlayer = { ...player }
  let newEntities = [...entities]
  const logs = []
  let noiseAmount = ACTION_NOISE[action.type] ?? 0

  if (action.type === 'move') {
    if (action.dx === 0 && action.dy === 0) return state
    noiseAmount = Math.max(0, ACTION_NOISE.move - player.noiseFootprint)
    const nx = player.x + action.dx, ny = player.y + action.dy
    const tile = map[ny]?.[nx]
    if (!tile || !isWalkable(tile.tile)) {
      return { ...state, log: [...state.log, 'Blocked.'].slice(-5) }
    }

    const blockerIdx = newEntities.findIndex(e => e.x === nx && e.y === ny && (e.type === 'guard' || e.type === 'monster' || e.type === 'chest' || e.type === 'door'))
    if (blockerIdx !== -1) {
      if (newEntities[blockerIdx].type === 'door') {
        newEntities = newEntities.map((e, i) => i === blockerIdx ? { ...e, opening: true, frame: 0 } : e)
        return {
          ...state,
          player: newPlayer,
          entities: newEntities,
          openingDoor: true,
          hitEffects: null,
          pendingNoise: { source: { x: newPlayer.x, y: newPlayer.y }, amount: 3 },
          log: [...state.log, 'You push the door open.'].slice(-5),
        }
      }
      if (newEntities[blockerIdx].type === 'chest') {
        const chest = newEntities[blockerIdx]
        if (chest.contents.type === 'weapon') {
          const { weaponType, name, damage } = chest.contents
          logs.push(newPlayer.weapon ? `You swap your ${newPlayer.weapon.name} for the ${name}.` : `You found a ${name}!`)
          newPlayer = { ...newPlayer, weapon: { weaponType, name, damage } }
        } else if (chest.contents.type === 'potion') {
          const healed = Math.min(newPlayer.maxHp - newPlayer.hp, chest.contents.amount)
          newPlayer = { ...newPlayer, hp: newPlayer.hp + healed }
          logs.push(healed > 0 ? `You drink the potion and recover ${healed} HP.` : 'You drink the potion. (already full)')
        }
        newEntities = newEntities.map((e, i) => i === blockerIdx ? { ...e, opening: true, frame: 0 } : e)
        return {
          ...state,
          player: newPlayer,
          entities: newEntities,
          openingChest: true,
          hitEffects: null,
          pendingNoise: { source: { x: newPlayer.x, y: newPlayer.y }, amount: 1 },
          log: [...state.log, ...logs].slice(-5),
        }
      }
      if (!player.weapon) {
        return { ...state, hitEffects: null, log: [...state.log, 'You need a weapon to fight!'].slice(-5) }
      }
      const blocker = newEntities[blockerIdx]
      const dmg = player.weapon.damage
      const updatedBlocker = { ...blocker, hp: blocker.hp - dmg }
      if (updatedBlocker.hp <= 0) {
        newEntities = newEntities.filter((_, i) => i !== blockerIdx)
        logs.push(`You slay the ${blocker.type} with your ${player.weapon.name}!`)
      } else {
        newEntities = newEntities.map((e, i) => i === blockerIdx ? { ...updatedBlocker, inCombat: true } : e)
        logs.push(`You strike the ${blocker.type} for ${dmg} damage!`)
      }
      noiseAmount = ACTION_NOISE.attack
      return {
        ...state,
        player: newPlayer,
        entities: newEntities,
        hitEffects: [{ x: nx, y: ny }],
        pendingNoise: { source: { x: newPlayer.x, y: newPlayer.y }, amount: noiseAmount },
        log: [...state.log, ...logs].slice(-5),
      }
    } else {
      newPlayer = { ...newPlayer, x: nx, y: ny }

      // Trap
      const trapIdx = newEntities.findIndex(e => e.x === nx && e.y === ny && e.type === 'trap' && !e.triggered)
      if (trapIdx !== -1) {
        newEntities = newEntities.map((e, i) => i === trapIdx ? { ...e, triggered: true } : e)
        noiseAmount = ACTION_NOISE.trigger_trap
        logs.push('You triggered a trap!')
      }

      // Weapon pickup
      const weaponIdx = newEntities.findIndex(e => e.x === nx && e.y === ny && e.type === 'weapon')
      if (weaponIdx !== -1) {
        const w = newEntities[weaponIdx]
        newPlayer = { ...newPlayer, weapon: { weaponType: w.weaponType, name: w.name, damage: w.damage } }
        newEntities = newEntities.filter((_, i) => i !== weaponIdx)
        if (player.weapon) {
          logs.push(`You swap your ${player.weapon.name} for the ${w.name}.`)
        } else {
          logs.push(`You pick up the ${w.name}!`)
        }
      }

      // Potion pickup
      const potionIdx = newEntities.findIndex(e => e.x === nx && e.y === ny && e.type === 'potion')
      if (potionIdx !== -1) {
        const p = newEntities[potionIdx]
        const healed = Math.min(newPlayer.maxHp - newPlayer.hp, p.amount)
        newPlayer = { ...newPlayer, hp: newPlayer.hp + healed }
        newEntities = newEntities.filter((_, i) => i !== potionIdx)
        logs.push(healed > 0 ? `You drink a potion and recover ${healed} HP.` : 'You drink a potion. (already full)')
      }

      if (tile.tile === TILE.STAIRS_DOWN) logs.push('Press Enter to descend.')
      if (tile.tile === TILE.TREASURE) logs.push('The treasure gleams… Press X to steal it.')
    }
  }

  if (action.type === 'descend' && map[player.y]?.[player.x]?.tile === TILE.STAIRS_DOWN) {
    return { ...state, player: newPlayer, entities: newEntities, descend: true, log: [...state.log, 'You descend…'].slice(-5) }
  }

  if (action.type === 'steal' && map[player.y]?.[player.x]?.tile === TILE.TREASURE) {
    return { ...state, player: newPlayer, entities: newEntities, won: true, log: [...state.log, 'You seize the treasure!'].slice(-5) }
  }

  if (action.type === 'interact') {
    const adjacent = [[0,1],[0,-1],[1,0],[-1,0]].map(([dx, dy]) => ({ x: player.x + dx, y: player.y + dy }))
    // Shrine healing (also checks player's own tile)
    const shrinePositions = [{ x: player.x, y: player.y }, ...adjacent]
    const shrineCell = shrinePositions.find(p => map[p.y]?.[p.x]?.tile === TILE.SHRINE)
    if (shrineCell) {
      const healed = Math.min(newPlayer.maxHp - newPlayer.hp, 5)
      newPlayer = { ...newPlayer, hp: newPlayer.hp + healed }
      map[shrineCell.y][shrineCell.x].tile = TILE.FLOOR
      logs.push(healed > 0 ? `The shrine restores ${healed} HP. It crumbles away.` : 'The shrine pulses but you are already whole.')
      noiseAmount = 0
    } else {
      // Chest
      const chestIdx = newEntities.findIndex(e =>
        e.type === 'chest' && !e.opening && adjacent.some(a => a.x === e.x && a.y === e.y)
      )
      if (chestIdx !== -1) {
        const chest = newEntities[chestIdx]
        if (chest.contents.type === 'weapon') {
          const { weaponType, name, damage } = chest.contents
          logs.push(newPlayer.weapon
            ? `You swap your ${newPlayer.weapon.name} for the ${name}.`
            : `You found a ${name}!`)
          newPlayer = { ...newPlayer, weapon: { weaponType, name, damage } }
        } else if (chest.contents.type === 'potion') {
          const healed = Math.min(newPlayer.maxHp - newPlayer.hp, chest.contents.amount)
          newPlayer = { ...newPlayer, hp: newPlayer.hp + healed }
          logs.push(healed > 0 ? `You drink the potion and recover ${healed} HP.` : 'You drink the potion. (already full)')
        }
        newEntities = newEntities.map((e, i) => i === chestIdx ? { ...e, opening: true, frame: 0 } : e)
        noiseAmount = 1
        return {
          ...state,
          player: newPlayer,
          entities: newEntities,
          openingChest: true,
          hitEffects: null,
          pendingNoise: { source: { x: newPlayer.x, y: newPlayer.y }, amount: noiseAmount },
          log: [...state.log, ...logs].slice(-5),
        }
      } else {
        // Puzzle
        const puzzleIdx = newEntities.findIndex(e =>
          e.type === 'puzzle' && !e.solved && adjacent.some(a => a.x === e.x && a.y === e.y)
        )
        if (puzzleIdx !== -1) {
          newEntities = newEntities.map((e, i) => i === puzzleIdx ? { ...e, solved: true } : e)
          logs.push('You solved the puzzle! A passage opens.')
          noiseAmount = 1
        } else {
          logs.push('Nothing to interact with.')
          noiseAmount = 0
        }
      }
    }
  }

  if (action.type === 'wait') logs.push('You wait.')

  return {
    ...state,
    player: newPlayer,
    entities: newEntities,
    hitEffects: null,
    pendingNoise: { source: { x: newPlayer.x, y: newPlayer.y }, amount: noiseAmount },
    log: [...state.log, ...logs].slice(-5),
  }
}

export function stepGuard(guard, map, player = null) {
  if (guard.alertState === ALERT.ALERTED && player) {
    const dx = Math.sign(player.x - guard.x)
    const dy = Math.sign(player.y - guard.y)
    const moves = Math.abs(player.x - guard.x) >= Math.abs(player.y - guard.y)
      ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]]
    for (const [mx, my] of moves) {
      if (mx === 0 && my === 0) continue
      const nx = guard.x + mx, ny = guard.y + my
      if (nx === player.x && ny === player.y) continue
      if (!map[ny]?.[nx] || !isWalkable(map[ny][nx].tile)) continue
      const facing = mx === 1 ? 'east' : mx === -1 ? 'west' : my === 1 ? 'south' : 'north'
      return { ...guard, x: nx, y: ny, facing }
    }
    return guard
  }

  if (guard.alertState === ALERT.SEARCHING) {
    const dirs = [[0,1],[0,-1],[1,0],[-1,0]]
    const valid = dirs.filter(([dx, dy]) => map[guard.y + dy]?.[guard.x + dx] && isWalkable(map[guard.y + dy][guard.x + dx].tile))
    if (valid.length === 0) return guard
    const [dx, dy] = valid[Math.floor(Math.random() * valid.length)]
    const facing = dx === 1 ? 'east' : dx === -1 ? 'west' : dy === 1 ? 'south' : 'north'
    return { ...guard, x: guard.x + dx, y: guard.y + dy, facing }
  }

  if (guard.patrol.length === 0) return guard
  const target = guard.patrol[guard.patrolIndex % guard.patrol.length]
  const dx = Math.sign(target.x - guard.x), dy = Math.sign(target.y - guard.y)
  if (dx === 0 && dy === 0) return { ...guard, patrolIndex: guard.patrolIndex + 1 }
  const nx = guard.x + dx, ny = guard.y + dy
  if (!map[ny]?.[nx] || !isWalkable(map[ny][nx].tile)) return guard
  const facing = dx === 1 ? 'east' : dx === -1 ? 'west' : dy === 1 ? 'south' : 'north'
  const arrived = nx === target.x && ny === target.y
  return { ...guard, x: nx, y: ny, facing, patrolIndex: arrived ? guard.patrolIndex + 1 : guard.patrolIndex }
}

export function stepMonster(monster, map) {
  const dirs = [[0,1],[0,-1],[1,0],[-1,0]]
  const valid = dirs.filter(([dx, dy]) => map[monster.y + dy]?.[monster.x + dx] && isWalkable(map[monster.y + dy][monster.x + dx].tile))
  if (valid.length === 0) return monster
  const [dx, dy] = valid[Math.floor(Math.random() * valid.length)]
  return { ...monster, x: monster.x + dx, y: monster.y + dy }
}

export function stepDragon(dragon, map, player) {
  if (dragon.dragonState === DRAGON_STATE.SLEEPING) return dragon
  if (dragon.moveTimer > 0) return { ...dragon, moveTimer: dragon.moveTimer - 1 }

  const cooldown = dragon.dragonState === DRAGON_STATE.STIRRING ? 2 : 0
  const dist = Math.abs(player.x - dragon.x) + Math.abs(player.y - dragon.y)
  if (dist <= 1) return { ...dragon, moveTimer: cooldown }

  const dx = Math.sign(player.x - dragon.x)
  const dy = Math.sign(player.y - dragon.y)
  const moves = Math.abs(player.x - dragon.x) >= Math.abs(player.y - dragon.y)
    ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]]
  for (const [mx, my] of moves) {
    const nx = dragon.x + mx, ny = dragon.y + my
    if (nx === player.x && ny === player.y) continue
    if (!map[ny]?.[nx] || !isWalkable(map[ny][nx].tile)) continue
    return { ...dragon, x: nx, y: ny, moveTimer: cooldown }
  }
  return dragon
}
