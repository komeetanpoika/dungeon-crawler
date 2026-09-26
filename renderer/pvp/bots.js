// Bots: one input intent per tick from the match state alone, so the local
// harness has opponents today and sub-project 4 can fill short lobbies
// later. Deliberately simple per class — the Warrior closes in behind a
// shield, the Archer and Mage line up on a row or column (every shot flies
// along a facing) and keep their distance. Pure: no DOM.
import { isWalkable, hasLineOfSight } from '../systems/entities.js'
import { foesOf } from './combat.js'
import { NEUTRAL_INPUT } from './hero.js'
import { isComboWeapon } from './combos.js'
import { canDrawDouble } from './attacks.js'
import { GUST_CHARGE } from '../systems/magic.js'
import { LIGHTNING } from '../systems/spells/lightning.js'
import { STAMINA_MAX } from '../systems/stamina.js'
import { TILE_SIZE } from '../systems/movement.js'
import { BOTS, WARRIOR_COMBOS, DOUBLE_SHOT } from '../data/pvp.js'

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]]

const tileDist = (a, b) => Math.hypot(a.px - b.px, a.py - b.py) / TILE_SIZE
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
  const cx = step.x * TILE_SIZE + TILE_SIZE / 2, cy = step.y * TILE_SIZE + TILE_SIZE / 2
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

const SECTOR_MOVE = { n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } }
const FACING_SECTOR = { north: 'n', east: 'e', south: 's', west: 'w' }
const CLOCKWISE = { n: 'e', e: 's', s: 'w', w: 'n' }
const aligned = (a, b) => Math.abs(a.px - b.px) < BOTS.alignSlack || Math.abs(a.py - b.py) < BOTS.alignSlack
const inLine = (match, a, b) => aligned(a, b) && hasLineOfSight(match.map, a.y, a.x, b.y, b.x)

// What a warrior bot wants to enter with the attack held (spec 2a §5): a
// whirlwind with two foes close and a full tank, a lunge at a foe lined up
// 2-3 tiles off, a tap (no moves) at a foe in reach; null when out of range.
// `tank` is the stamina it had at the press (moves already paid added back).
function warriorPlan(match, hero, foe, d, tank) {
  const close = foesOf(match, hero).filter(f => tileDist(hero, f) <= BOTS.whirlRange).length
  if (close >= BOTS.whirlFoes && tank >= STAMINA_MAX) {
    const plan = [FACING_SECTOR[hero.facing] ?? 'n']
    while (plan.length < 4) plan.push(CLOCKWISE[plan.at(-1)])
    return plan
  }
  if (d >= BOTS.lungeMin && d <= BOTS.lungeMax && inLine(match, hero, foe) && tank >= 2 * WARRIOR_COMBOS.moveCost) {
    const s = FACING_SECTOR[faceToward(hero, foe)]
    return [s, s]
  }
  return d <= BOTS.meleeRange ? [] : null
}

// One tick of entering `plan`: press standing still (so the hold does not
// slide), then each move in turn — neutral first when the next move repeats
// the sector last seen — and let go once the plan is in (or it no longer
// matches what was entered: that releases a plain swing).
//
// Every press below is gated on `!hero.needRelease` (not just `!hero.combo`,
// as an earlier draft had it): a hold the game cancelled (a shield, a stun,
// the rune's hammer auto-releasing) sets `needRelease`, and it only clears on
// a tick whose input says `attack: false`. A bot that pressed `true` through
// that gate would hold `needRelease` forever and never attack again — see
// the "cancelled hold" and "hammer-rune bot keeps swinging" tests.
function enterPlan(hero, plan, input) {
  input.move = { x: 0, y: 0 }
  if (!hero.combo) { input.attack = !hero.needRelease; return }
  const moves = hero.combo.moves
  if (moves.length >= plan.length || moves.some((m, i) => m !== plan[i])) { input.attack = false; return }
  const next = plan[moves.length]
  input.attack = !hero.needRelease
  if (hero.combo.last !== next) input.move = { ...SECTOR_MOVE[next] }
}

// The Call Lightning tier whose strike distance best matches `d` tiles:
// the tap's 3, the full charge's 6, the overcharge's line of 4, 6 and 8;
// ties go to the cheaper tier.
export function lightningTier(d) {
  let best = 'tap', bestErr = Infinity
  for (const tier of ['tap', 'full', 'over']) {
    const err = Math.min(...LIGHTNING.dists[tier].map(x => Math.abs(d - x)))
    if (err < bestErr) { best = tier; bestErr = err }
  }
  return best
}
const TIER_HOLD = { tap: 0, full: GUST_CHARGE.full, over: GUST_CHARGE.over }

function incoming(match, hero) {
  return match.projectiles.find(p => p.owner !== hero.id &&
    Math.hypot(p.px - hero.px, p.py - hero.py) < 3 * TILE_SIZE &&
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
    // Raising the shield (alt) would cancel a hold in progress (moveHero's
    // cancelHold), so a warrior mid-hold rides the incoming shot out instead
    // of blocking it — deliberate, not an oversight.
    if (shot && !hero.combo) { input.alt = true; input.facing = faceToward(hero, shot); return input }
    if (!isComboWeapon(hero.weapon?.weaponType)) {        // the rune's hammer: hold, and it swings itself
      // Gated on needRelease (not just "true"): the auto-release swing sets
      // needRelease, and only a tick that sends attack:false clears it — see
      // the note on enterPlan above.
      if (d <= BOTS.meleeRange) { input.facing = faceToward(hero, foe); input.attack = !hero.needRelease; return input }
      steer(match, hero, foe, input)
      return input
    }
    const tank = (hero.stamina ?? 0) + WARRIOR_COMBOS.moveCost * (hero.combo?.moves.length ?? 0)
    const plan = warriorPlan(match, hero, foe, d, tank)
    if (hero.combo || plan) {
      input.facing = faceToward(hero, foe)
      enterPlan(hero, plan ?? [], input)
      return input
    }
    steer(match, hero, foe, input)
    return input
  }

  if (hero.cls === 'mage' && d < 1.5) {
    input.facing = FLIP[faceToward(hero, foe)]
    input.alt = !hero.prevAlt               // one press per two ticks: an edge the blink reads
    return input
  }
  // An archer mid-draw holds Q to the full draw, then lets go — the draw has
  // no auto-release (tickRanged), so this is what stops it going on forever.
  if (hero.charging?.kind === 'double') {
    input.facing = faceToward(hero, foe)
    input.alt = hero.charging.t < DOUBLE_SHOT.full
    return input
  }
  if (inLine(match, hero, foe) && d <= BOTS.shootRange) {
    input.facing = faceToward(hero, foe)
    if (d < BOTS.keepAway - 1) input.move = { x: 0, y: 0 }
    if (hero.cls === 'mage') {
      // The Storm Wand: charge to the tier that strikes nearest the foe.
      // Any other wand (the rune's fireball) releases at the full tier.
      const hold = hero.wand?.weaponType === 'stormwand' ? TIER_HOLD[lightningTier(d)] : GUST_CHARGE.full
      // Gated on needRelease too (fix round 1): every completed cast sets it,
      // and it only clears on a tick that sends attack:false. Without this a
      // mage bot casts once and then never again — see the note on enterPlan.
      input.attack = !hero.needRelease && !(hero.charging && hero.charging.t >= hold)
      return input
    }
    // A foe far off and not closing (a hero walks the way it faces) gets the
    // double shot; otherwise the archer streams.
    const closing = foe.facing === faceToward(foe, hero)
    if (d >= BOTS.doubleMin && !closing && canDrawDouble(hero)) { input.alt = true; return input }
    input.attack = true
    return input
  }
  const spot = firingSpot(match, hero, foe)
  steer(match, hero, spot ?? foe, input)
  return input
}
