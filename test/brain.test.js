import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { updateBrain, HUNT_PAUSE, generatePatrol, ensureAI } from '../renderer/systems/brain.js'
import { buildNavGrid, findPath } from '../renderer/systems/nav.js'
import { act } from '../renderer/systems/act.js'
import { getAIConfig } from '../renderer/data/enemy-ai.js'

const S = 32
// 14x9: floor interior with a wall spur at x=7, y=1..5 (LOS blocker to hide behind)
function spurMap() {
  const map = createMap(14, 9)
  for (let y = 1; y < 8; y++) for (let x = 1; x < 13; x++) map[y][x].tile = TILE.FLOOR
  for (let y = 1; y <= 5; y++) map[y][7].tile = TILE.WALL
  return map
}
function makeState(map, playerTile, enemies = []) {
  const player = { type: 'player', x: playerTile.x, y: playerTile.y,
    px: playerTile.x * S + S / 2, py: playerTile.y * S + S / 2, maxHp: 10, hp: 10 }
  return { map, player, entities: enemies }
}
function guardAt(x, y, hp = 4) {
  return { type: 'guard', maxHp: 4, hp, x, y, px: x * S + S / 2, py: y * S + S / 2 }
}

describe('updateBrain perception', () => {
  it('visible player within sight -> chase (approach intent)', () => {
    const map = spurMap()
    const e = guardAt(3, 3)
    const state = makeState(map, { x: 5, y: 3 }, [e])
    const intent = updateBrain(e, state, 1 / 60)
    assert.equal(intent.mode, 'approach')
    assert.equal(e.ai.mode, 'chase')
    assert.deepEqual(e.ai.lastSeen, { x: 5, y: 3 })
  })

  it('losing LOS -> hunt toward the last seen tile', () => {
    const map = spurMap()
    const e = guardAt(3, 3)
    const state = makeState(map, { x: 5, y: 3 }, [e])
    updateBrain(e, state, 1 / 60)                    // sees the player at (5,3)
    state.player.x = 10; state.player.y = 3          // teleport behind the wall spur
    state.player.px = 10 * S + S / 2; state.player.py = 3 * S + S / 2
    const intent = updateBrain(e, state, 1 / 60)
    assert.equal(e.ai.mode, 'hunt')
    assert.equal(intent.mode, 'approach')
    assert.deepEqual(intent.target, { x: 5, y: 3 })  // heads to where it last saw them
  })

  it('arriving at the last-seen tile with nothing there -> pause, then patrol', () => {
    const map = spurMap()
    const e = guardAt(3, 3)
    const state = makeState(map, { x: 5, y: 3 }, [e])
    updateBrain(e, state, 1 / 60)
    state.player.x = 10; state.player.px = 10 * S + S / 2   // beyond sight range AND behind the spur
    updateBrain(e, state, 1 / 60)                            // now hunting
    e.x = 5; e.y = 3; e.px = 5 * S + S / 2; e.py = 3 * S + S / 2  // teleport to last-seen
    const holding = updateBrain(e, state, 1 / 60)
    assert.equal(holding.mode, 'hold')                       // looking around
    for (let t = 0; t < HUNT_PAUSE + 0.1; t += 1 / 60) updateBrain(e, state, 1 / 60)
    assert.equal(e.ai.mode, 'patrol')
  })

  it('a badly hurt guard flees while the player is near', () => {
    const map = spurMap()
    const e = guardAt(3, 3, 1)   // 1/4 HP, guard fleeHp default 0.3
    const state = makeState(map, { x: 5, y: 3 }, [e])
    const intent = updateBrain(e, state, 1 / 60)
    assert.equal(intent.mode, 'flee')
  })

  it('kiting and strafing types get their configured combat intents', () => {
    const map = spurMap()
    const spider = { type: 'monster', variant: 'medium', maxHp: 2, hp: 2, x: 3, y: 3, px: 3 * S + S / 2, py: 3 * S + S / 2 }
    const crab = { type: 'crab', maxHp: 6, hp: 6, x: 3, y: 5, px: 3 * S + S / 2, py: 5 * S + S / 2 }
    const state = makeState(map, { x: 5, y: 3 }, [spider, crab])
    assert.equal(updateBrain(spider, state, 1 / 60).mode, 'kite')
    const crabIntent = updateBrain(crab, state, 1 / 60)
    assert.equal(crabIntent.mode, 'strafe')
    assert.equal(crabIntent.inward, 0.3)
  })
})

describe('updateBrain hunt with clearance-2 substituted targets', () => {
  it('a wide enemy hunting a wall-adjacent lastSeen arrives and gives up instead of freezing', () => {
    const map = spurMap()
    const e = { type: 'cyclops', maxHp: 30, hp: 30, x: 3, y: 3, px: 3 * S + S / 2, py: 3 * S + S / 2 }
    // Player at (11,7): raw distance from (3,3) is hypot(8,4)=8.9 tiles=286px,
    // inside the cyclops's 320px sightRange — but LOS from (3,3) to (11,7)
    // passes through (7,5), which sits on the wall spur (x=7, y=1..5), so
    // hasLineOfSight blocks it and `seen` is false. That keeps updateBrain
    // from stomping our forced 'hunt' mode back to 'chase' below.
    const state = makeState(map, { x: 11, y: 7 }, [e])   // player far away, no LOS needed
    updateBrain(e, state, 1 / 60)                        // init ai (patrol)
    // force the hunt state the deadlock needs: lastSeen on a wall-adjacent tile (clearance < 2)
    e.ai.mode = 'hunt'
    e.ai.lastSeen = { x: 1, y: 1 }                       // corner floor tile, clearance 1
    // simulate act's followPath outcome: path computed for this target and fully consumed
    e.ai.path = []
    e.ai.pathTarget = { x: 1, y: 1 }
    const intent = updateBrain(e, state, 1 / 60)
    assert.equal(intent.mode, 'hold')                    // looking around at the trail's end
    for (let t = 0; t < HUNT_PAUSE + 0.1; t += 1 / 60) updateBrain(e, state, 1 / 60)
    assert.equal(e.ai.mode, 'patrol')                    // gave up instead of freezing in hunt
  })
})

describe('generatePatrol', () => {
  it('picks 2-3 reachable, spread-out points near the spawn', () => {
    const map = spurMap()
    const nav = buildNavGrid(map)
    const pts = generatePatrol(nav, map, 3, 3, { half: 4 })
    assert.ok(pts.length >= 2 && pts.length <= 3, `got ${pts.length} points`)
    for (const p of pts) {
      const d = Math.hypot(p.x - 3, p.y - 3)
      assert.ok(d >= 2 && d <= 8, `point (${p.x},${p.y}) at distance ${d}`)
      assert.ok(findPath(nav, 3, 3, p.x, p.y, 1) !== null, 'reachable')
    }
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) >= 3, 'spread out')
  })

  it('prefers feature tiles like a shrine', () => {
    const map = spurMap()
    map[6][4].tile = TILE.SHRINE
    const nav = buildNavGrid(map)
    const pts = generatePatrol(nav, map, 3, 3, { half: 4 })
    assert.ok(pts.some(p => p.x === 4 && p.y === 6), 'shrine tile chosen as a patrol point')
  })

  it('ensureAI wires patrol points into e.ai', () => {
    const map = spurMap()
    const e = guardAt(3, 3)
    const state = makeState(map, { x: 11, y: 7 }, [e])
    ensureAI(e, state, getAIConfig(e))
    assert.ok(e.ai.patrolPoints.length >= 2)
  })
})

// 20x12 open room for boundary tests (no LOS blockers)
function openMap(w = 20, h = 12) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) map[y][x].tile = TILE.FLOOR
  return map
}

describe('perception hysteresis at the sight boundary', () => {
  it('an engaged chaser keeps chasing out to the drop radius instead of flapping to hunt', () => {
    const map = openMap()
    const e = guardAt(3, 5)
    const state = makeState(map, { x: 5, y: 5 }, [e])
    updateBrain(e, state, 1 / 60)                       // acquires: chase
    assert.equal(e.ai.mode, 'chase')
    // player steps just past sightRange (180): dist 200, LOS clear
    state.player.px = e.px + 200
    state.player.x = Math.floor(state.player.px / S)
    const intent = updateBrain(e, state, 1 / 60)
    assert.equal(e.ai.mode, 'chase', 'chase maintained inside the drop radius')
    assert.equal(intent.target, undefined, 'still steering at the live player, not a frozen tile')
    // ...but genuinely losing them (beyond drop radius 240) hands off to hunt
    state.player.px = e.px + 250
    state.player.x = Math.floor(state.player.px / S)
    updateBrain(e, state, 1 / 60)
    assert.equal(e.ai.mode, 'hunt', 'beyond the drop radius the chase is lost')
  })

  it('an unengaged enemy still needs the base sight range to acquire', () => {
    const map = openMap()
    const e = guardAt(3, 8)
    const state = makeState(map, { x: 3, y: 8 }, [e])
    state.player.px = e.px + 200                        // outside 180, inside 240
    state.player.x = Math.floor(state.player.px / S)
    updateBrain(e, state, 1 / 60)
    assert.notEqual(e.ai.mode, 'chase', 'drop radius must not widen acquisition')
  })
})

describe('flee hysteresis at the fear-radius edge', () => {
  it('a routed enemy escapes past the fear ring and does not oscillate back to it', () => {
    // wide open corridor: player fixed at the west end, hurt guard flees east
    const map = openMap(40, 14)
    const e = guardAt(8, 6, 1)                           // 1/4 hp -> flees
    const state = makeState(map, { x: 2, y: 6 }, [e])
    const fear = 180 * 1.25                              // guard sightRange * FLEE_ENTER
    let maxDist = 0
    const lastSecondsDists = []
    for (let i = 0; i < 900; i++) {                      // 15 simulated seconds
      const intent = updateBrain(e, state, 1 / 60)
      act(e, state, 1 / 60, intent)
      const d = Math.hypot(e.px - state.player.px, e.py - state.player.py)
      maxDist = Math.max(maxDist, d)
      if (i >= 600) lastSecondsDists.push(d)
    }
    // without hysteresis the guard pins to ~fear ring (flee off -> hunt back -> flee ...)
    assert.ok(maxDist > 180 * 1.5, `escaped well past the fear ring (max ${Math.round(maxDist)}px)`)
    assert.ok(Math.min(...lastSecondsDists) > fear,
      `settled outside the fear radius (min late dist ${Math.round(Math.min(...lastSecondsDists))}px)`)
    assert.equal(e.ai.fleeing, false, 'flee disengaged once safely away')
  })
})

describe('generatePatrol avoid zone', () => {
  it('excludes candidate points near a threat position', () => {
    // enemy in the SE corner: the farthest candidates (which the sort prefers)
    // all point NW, straight at the threat — only the filter keeps them out
    const map = openMap(12, 12)
    const nav = buildNavGrid(map)
    const avoid = { px: 3 * S + S / 2, py: 3 * S + S / 2, r: 6 * S }
    const pts = generatePatrol(nav, map, 9, 9, { half: 4 }, avoid)
    assert.ok(pts.length >= 1, 'still finds points on the safe side')
    for (const p of pts) {
      const d = Math.hypot(p.x * S + S / 2 - avoid.px, p.y * S + S / 2 - avoid.py)
      assert.ok(d >= avoid.r, `point (${p.x},${p.y}) respects the avoid radius (${Math.round(d)}px)`)
    }
  })
})
