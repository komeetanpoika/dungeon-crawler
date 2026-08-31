// Podeboo's bespoke attack (the first generated-monster hook module): in
// range with line of sight it stops dead, its head tracks the player while
// the eyes charge to a glow, then it fires eye lasers — a 5-beam fan burst
// while healthy, twin sweeping beams at or below half HP. Runs as a
// CREATURE_UPDATE supplement AFTER brain+act (see systems/monsters.js), so
// "stopping" means undoing this frame's movement, which also idles the gait.
// Never registered in CREATURE_TYPES — podeboo stays a normal enemy.
import { CREATURE_UPDATE } from '../creatures.js'
import { hasLineOfSight } from '../entities.js'
import { damagePlayer } from '../player-damage.js'

export const LASER = {
  range: 260,          // px: how close the player must be to trigger
  beamLen: 320,        // px: beam reach for damage (rendering matches)
  cooldown: 3.5,       // s between attacks
  chargeTime: 0.8,     // s of glow telegraph
  burstBeams: 5, burstArc: Math.PI * 0.45, burstFlash: 0.25, burstDmg: 2,
  sweepTime: 1.1, sweepArc: Math.PI * 0.45, sweepDmg: 1,
  beamHitDist: 10,     // px: perpendicular distance that counts as a hit
}

const norm = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a }

function beamHitsPlayer(e, player, ang) {
  const dx = player.px - e.px, dy = player.py - e.py
  const dirx = Math.cos(ang), diry = Math.sin(ang)
  const along = dx * dirx + dy * diry
  if (along < 0 || along > LASER.beamLen) return false
  return Math.abs(dx * diry - dy * dirx) < LASER.beamHitDist
}

function end(e, l) {
  l.state = 'idle'; l.cd = LASER.cooldown; l.beams = null
  e.pose.eyeGlow = 0; e.pose.headAim = undefined
}

export function update(e, state, delta) {
  const { player, map } = state
  if (!e.pose) return
  const l = e.laser ?? (e.laser = { state: 'idle', t: 0, cd: 0 })

  if (l.state === 'idle') {
    l.cd = Math.max(0, l.cd - delta)
    if (l.cd > 0 || !player || player.hp <= 0) return
    if (Math.hypot(player.px - e.px, player.py - e.py) > LASER.range) return
    if (!hasLineOfSight(map, e.y, e.x, player.y, player.x)) return
    l.state = 'charge'; l.t = 0
    l.anchor = { px: e.px, py: e.py, x: e.x, y: e.y }
    return
  }

  // charge and fire both pin the body: undo whatever act() moved this frame
  e.px = l.anchor.px; e.py = l.anchor.py; e.x = l.anchor.x; e.y = l.anchor.y

  if (l.state === 'charge') {
    l.t += delta
    l.aim = Math.atan2(player.py - e.py, player.px - e.px)   // head keeps tracking
    e.pose.headAim = norm(l.aim - e.pose.facing)
    e.pose.eyeGlow = Math.min(1, l.t / LASER.chargeTime)
    if (l.t >= LASER.chargeTime) {
      l.state = 'fire'; l.t = 0; l.dealt = false
      l.mode = e.hp > e.maxHp / 2 ? 'burst' : 'sweep'
      l.beams = l.mode === 'burst'
        ? Array.from({ length: LASER.burstBeams }, (_, i) =>
            ({ ang: l.aim - LASER.burstArc / 2 + LASER.burstArc * i / (LASER.burstBeams - 1) }))
        : [{ ang: l.aim - LASER.sweepArc / 2 }]
    }
    return
  }

  // fire: aim is locked; glow stays hot
  l.t += delta
  e.pose.eyeGlow = 1
  e.pose.headAim = norm(l.aim - e.pose.facing)
  if (l.mode === 'burst') {
    if (!l.dealt) {
      l.dealt = true
      if (l.beams.some(b => beamHitsPlayer(e, player, b.ang)))
        damagePlayer(state, LASER.burstDmg, 'hit', 'Searing light rakes you!')
    }
    if (l.t >= LASER.burstFlash) end(e, l)
  } else {
    const prog = Math.min(1, l.t / LASER.sweepTime)
    l.beams = [{ ang: l.aim - LASER.sweepArc / 2 + LASER.sweepArc * prog }]
    if (beamHitsPlayer(e, player, l.beams[0].ang))
      damagePlayer(state, LASER.sweepDmg, 'hit', 'The beam sears across you!')
    if (l.t >= LASER.sweepTime) end(e, l)
  }
}

CREATURE_UPDATE.podeboo = update
