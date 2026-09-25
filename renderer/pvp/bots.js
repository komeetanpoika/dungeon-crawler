// Bots: one input intent per tick from the match state alone, so the local
// harness has opponents today and sub-project 4 can fill short lobbies
// later. Deliberately simple per class — the Warrior closes in behind a
// shield, the Archer and Mage line up on a row or column (every shot flies
// along a facing) and keep their distance. Pure: no DOM.
import { isWalkable, hasLineOfSight } from '../systems/entities.js'
import { foesOf } from './combat.js'
import { NEUTRAL_INPUT } from './hero.js'
import { GUST_CHARGE } from '../systems/magic.js'
import { BOTS } from '../data/pvp.js'

const TILE = 32
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]]

const tileDist = (a, b) => Math.hypot(a.px - b.px, a.py - b.py) / TILE
const walk = (map, x, y) => { const c = map[y]?.[x]; return !!c && isWalkable(c.tile, c) }
const faceToward = (from, to) => {
  const dx = to.px - from.px, dy = to.py - from.py
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'east' : 'west') : (dy >= 0 ? 'south' : 'north')
}
const FLIP = { east: 'west', west: 'east', north: 'south', south: 'north' }

// The first tile on a shortest 4-neighbour path from `from` to `to`.
export function nextStep(map, from, to) {
  if (from.x === to.x && from.y === to.y) return { x: from.x, y: from.y }
  const key = (x, y) => y * 1000 + x
  const parent = new Map([[key(from.x, from.y), null]])
  const queue = [from]
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head]
    for (const [dx, dy] of STEPS) {
      const nx = c.x + dx, ny = c.y + dy, k = key(nx, ny)
      if (parent.has(k) || !walk(map, nx, ny)) continue
      parent.set(k, c)
      if (nx === to.x && ny === to.y) {
        let step = { x: nx, y: ny }, p = c
        while (p && !(p.x === from.x && p.y === from.y)) { step = p; p = parent.get(key(p.x, p.y)) }
        return { x: step.x, y: step.y }
      }
      queue.push({ x: nx, y: ny })
    }
  }
  return null
}

const nearest = (hero, list) => list.reduce((best, e) => !best || tileDist(hero, e) < tileDist(hero, best) ? e : best, null)

function steer(match, hero, goal, input) {
  const step = nextStep(match.map, hero, goal)
  if (!step) return
  const cx = step.x * TILE + TILE / 2, cy = step.y * TILE + TILE / 2
  const dx = cx - hero.px, dy = cy - hero.py
  input.move = { x: Math.abs(dx) > 2 ? Math.sign(dx) : 0, y: Math.abs(dy) > 2 ? Math.sign(dy) : 0 }
  if (input.move.x || input.move.y) input.facing = faceToward(hero, { px: cx, py: cy })
}

// The walkable tile on the foe's row or column nearest the bot, at least
// BOTS.keepAway from the foe — where a shot along a facing will land.
function firingSpot(match, hero, foe) {
  let best = null, bestD = Infinity
  for (const [dx, dy] of STEPS) {
    for (let r = BOTS.keepAway; r <= BOTS.shootRange - 2; r++) {
      const x = foe.x + dx * r, y = foe.y + dy * r
      if (!walk(match.map, x, y)) break
      if (!hasLineOfSight(match.map, y, x, foe.y, foe.x)) break
      const d = Math.hypot(x - hero.x, y - hero.y)
      if (d < bestD) { bestD = d; best = { x, y } }
    }
  }
  return best
}

function incoming(match, hero) {
  return match.projectiles.find(p => p.owner !== hero.id &&
    Math.hypot(p.px - hero.px, p.py - hero.py) < 3 * TILE &&
    (hero.px - p.px) * p.dx + (hero.py - p.py) * p.dy > 0)
}

export function botInput(match, hero) {
  if (hero.dead) return { ...NEUTRAL_INPUT, move: { x: 0, y: 0 } }
  const input = { move: { x: 0, y: 0 }, facing: null, attack: false, alt: false, sprint: false }
  const up = kind => match.pickups.filter(p => p.up && p.kind === kind)
  const foe = nearest(hero, foesOf(match, hero))

  if (hero.hp < hero.maxHp * BOTS.hurt) {
    const flask = nearest(hero, up('flask'))
    if (flask) { steer(match, hero, flask, input); return input }
  }
  const rune = hero.rune ? null : nearest(hero, up('rune'))
  if (rune && (!foe || tileDist(hero, rune) < tileDist(hero, foe))) { steer(match, hero, rune, input); return input }
  if (!foe) return input

  const d = tileDist(hero, foe)
  if (hero.cls === 'warrior') {
    const shot = incoming(match, hero)
    if (shot) { input.alt = true; input.facing = faceToward(hero, shot); return input }
    if (d <= BOTS.meleeRange) { input.facing = faceToward(hero, foe); input.attack = true; return input }
    steer(match, hero, foe, input)
    return input
  }

  if (hero.cls === 'mage' && d < 1.5) {
    input.facing = FLIP[faceToward(hero, foe)]
    input.alt = !hero.prevAlt               // one press per two ticks: an edge the blink reads
    return input
  }
  const aligned = Math.abs(hero.px - foe.px) < BOTS.alignSlack || Math.abs(hero.py - foe.py) < BOTS.alignSlack
  if (aligned && d <= BOTS.shootRange && hasLineOfSight(match.map, hero.y, hero.x, foe.y, foe.x)) {
    input.facing = faceToward(hero, foe)
    // A mage releases once the charge reaches the full tier; an archer streams.
    input.attack = hero.cls === 'mage' ? !(hero.charging?.t >= GUST_CHARGE.full) : true
    if (d < BOTS.keepAway - 1) input.move = { x: 0, y: 0 }
    return input
  }
  const spot = firingSpot(match, hero, foe)
  steer(match, hero, spot ?? foe, input)
  return input
}
