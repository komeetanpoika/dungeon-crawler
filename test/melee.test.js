import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ATTACK_STYLES, getAttack, getSwingArc, meleeHit, SWING_ARCS, shouldAutoRelease, tierMods, resolveCharge } from '../renderer/systems/melee.js'
import { drawEnemySwing, drawMeleeSwing, swingPose } from '../renderer/render/canvas.js'
import { WEAPONS, weaponWedge } from '../renderer/systems/enemy-attack.js'

const S = 32
const FACINGS = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 }
const MELEE_STYLES = ['snap', 'arc', 'slash', 'spin']

// Offset one "unit" along a facing, and one unit perpendicular to it.
function ahead(facing, d) { return [Math.cos(FACINGS[facing]) * d, Math.sin(FACINGS[facing]) * d] }
function behind(facing, d) { return ahead(facing, -d) }
// Fold an angle into (−PI, PI] so a full-circle sweep compares against its wedge.
function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)) }

describe('weapon attack styles', () => {
  it('every player melee weapon maps to a swing arc', () => {
    for (const [weapon, atk] of Object.entries(ATTACK_STYLES))
      assert.ok(SWING_ARCS[atk.style], `${weapon} uses unknown style ${atk.style}`)
  })

  it('unknown weapons fall back to the sword swing', () => {
    assert.equal(getAttack('spork').style, 'arc')
  })
})

describe('melee hit region — facing direction', () => {
  for (const style of MELEE_STYLES) {
    it(`${style}: hits a target directly ahead, inside reach`, () => {
      const { reach } = getSwingArc(style)
      for (const facing of Object.keys(FACINGS))
        assert.ok(meleeHit(style, FACINGS[facing], ...ahead(facing, reach - 2)),
          `${style} missed a target ${reach - 2}px ahead while facing ${facing}`)
    })

    it(`${style}: misses a target beyond reach`, () => {
      const { reach } = getSwingArc(style)
      for (const facing of Object.keys(FACINGS))
        assert.ok(!meleeHit(style, FACINGS[facing], ...ahead(facing, reach + 2)),
          `${style} hit a target past its ${reach}px reach while facing ${facing}`)
    })

    it(`${style}: the same offset hits identically from every facing`, () => {
      const { reach } = getSwingArc(style)
      for (const d of [8, reach - 4, reach + 4]) {
        const results = Object.keys(FACINGS).map(f => meleeHit(style, FACINGS[f], ...ahead(f, d)))
        assert.deepEqual(new Set(results).size, 1, `${style} is facing-dependent at ${d}px`)
      }
    })
  }

  // "spin" is the axe's 360° whirl — the one style that is meant to hit behind.
  for (const style of ['snap', 'arc', 'slash']) {
    it(`${style}: never damages anything behind the player`, () => {
      const { reach } = getSwingArc(style)
      for (const facing of Object.keys(FACINGS))
        for (let d = 4; d <= reach + 8; d += 4)
          assert.ok(!meleeHit(style, FACINGS[facing], ...behind(facing, d)),
            `${style} hit ${d}px behind the player while facing ${facing}`)
    })

    it(`${style}: lands the bulk of its area in the facing half`, () => {
      const fa = FACINGS.east
      let forward = 0, backward = 0
      for (let dy = -80; dy <= 80; dy++)
        for (let dx = -80; dx <= 80; dx++) {
          if (!meleeHit(style, fa, dx, dy)) continue
          if (dx > 0) forward++; else backward++
        }
      assert.ok(forward > 0, `${style} covers nothing in front`)
      assert.ok(backward / (forward + backward) < 0.05,
        `${style} puts ${Math.round(100 * backward / (forward + backward))}% of its area behind the player`)
    })
  }

  it('spin hits all round — that is the axe\'s trade for its slow cooldown', () => {
    for (const facing of Object.keys(FACINGS))
      assert.ok(meleeHit('spin', FACINGS[facing], ...behind(facing, 20)))
  })
})

describe('melee reach — one tile is the floor, longsword is the longest', () => {
  it('every melee weapon can hit an enemy one tile ahead', () => {
    for (const [weapon, atk] of Object.entries(ATTACK_STYLES))
      for (const facing of Object.keys(FACINGS))
        assert.ok(meleeHit(atk.style, FACINGS[facing], ...ahead(facing, S)),
          `${weapon} cannot reach one tile ahead while facing ${facing}`)
  })

  it('reach grows dagger → sword → longsword', () => {
    const r = t => getSwingArc(getAttack(t).style).reach
    assert.ok(r('dagger') < r('sword'), 'dagger should out-reach nothing')
    assert.ok(r('sword') < r('longsword'), 'the longsword should out-reach the sword')
  })

  it('sword and longsword sweep wide enough to catch a diagonal neighbour', () => {
    const diag = Math.SQRT1_2 * S
    for (const style of ['arc', 'slash'])
      assert.ok(meleeHit(style, FACINGS.east, diag, diag),
        `${style} missed the enemy on the diagonal tile`)
  })

  it('the dagger stays a point-blank poke — no diagonal reach', () => {
    assert.ok(!meleeHit('snap', FACINGS.east, S, S))
  })
})

describe('swing animation matches the hit region', () => {
  for (const style of MELEE_STYLES) {
    const arc = getSwingArc(style)

    it(`${style}: the blade sweeps no further than the hit wedge`, () => {
      for (let t = 0; t <= 1; t += 0.05) {
        const { angle, from } = swingPose(style, t)
        for (const a of [wrap(angle), wrap(from)])
          assert.ok(Math.abs(a) <= arc.halfAngle + 1e-6,
            `${style} draws the blade at ${Math.round(a * 180 / Math.PI)}° at t=${t.toFixed(2)}, ` +
            `outside its ±${Math.round(arc.halfAngle * 180 / Math.PI)}° hit wedge`)
      }
    })

    it(`${style}: the trail and blade stay inside the hit reach`, () => {
      const { radius, trailWidth, wscale } = swingPose(style, 1)
      assert.ok(radius * S / 32 + trailWidth / 2 <= arc.reach,
        `${style} trail reaches past its ${arc.reach}px hit reach`)
      assert.ok(wscale * 0.9 * S <= arc.reach,
        `${style} blade tip reaches past its ${arc.reach}px hit reach`)
    })

    it(`${style}: the swing ends pointing where the player faces`, () => {
      const end = swingPose(style, 1).angle
      const settled = style === 'spin' ? 0 : wrap(end)   // the spin lands back where it started
      assert.ok(Math.abs(settled) <= arc.halfAngle,
        `${style} finishes at ${Math.round(end * 180 / Math.PI)}°, outside the hit wedge`)
    })
  }

  it('the blade covers ground on both sides of the facing direction', () => {
    for (const style of ['arc', 'slash']) {
      const start = swingPose(style, 0).angle
      const end = swingPose(style, 1).angle
      assert.ok(start < 0 && end > 0, `${style} sweeps only one side of the facing direction`)
    }
  })
})

// The blade the player sees is a rotated sprite; the damage is a wedge of
// angles. These two only agree if the sprite actually points along the swing
// angle, so measure where the drawn tip ends up rather than trusting the
// transform. The ctx below records the matrix in force at each drawImage.
function probeCtx() {
  let m = [1, 0, 0, 1, 0, 0]
  const stack = [], hits = []
  const mul = n => {
    const [a, b, c, d, e, f] = m, [A, B, C, D, E, F] = n
    m = [a*A + c*B, b*A + d*B, a*C + c*D, b*C + d*D, a*E + c*F + e, b*E + d*F + f]
  }
  const at = (x, y) => ({ x: m[0]*x + m[2]*y + m[4], y: m[1]*x + m[3]*y + m[5] })
  return {
    hits,
    save: () => stack.push([...m]),
    restore: () => { m = stack.pop() },
    translate: (x, y) => mul([1, 0, 0, 1, x, y]),
    rotate: a => mul([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]),
    scale: (x, y) => mul([x, 0, 0, y, 0, 0]),
    drawImage: (_img, x, y, w, h) => hits.push({ tip: at(x + w/2, y), grip: at(x + w/2, y + h) }),
    beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, fillRect() {},
    set strokeStyle(_v) {}, set fillStyle(_v) {}, set lineWidth(_v) {},
    set lineCap(_v) {}, set globalAlpha(_v) {},
  }
}

function drawnBlade(weaponType, style, facing, t) {
  const ctx = probeCtx()
  const player = {
    px: 0, py: 0, attackTimer: (1 - t) * 0.2 + 1e-9, attackDuration: 0.2,
    attackStyle: style, attackFacing: facing, weapon: { weaponType },
  }
  drawMeleeSwing(ctx, player, { [`weapon_${weaponType}`]: 'IMG' }, 0, 0, S)
  const { tip, grip } = ctx.hits.at(-1)
  return { dir: Math.atan2(tip.y - grip.y, tip.x - grip.x), tipReach: Math.hypot(tip.x, tip.y) }
}

describe('the drawn blade points where the damage lands', () => {
  for (const [weaponType, atk] of Object.entries(ATTACK_STYLES)) {
    it(`${weaponType}: the sprite tracks the swing angle from every facing`, () => {
      for (const facing of Object.keys(FACINGS))
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const { dir } = drawnBlade(weaponType, atk.style, facing, t)
          const want = FACINGS[facing] + swingPose(atk.style, t).angle
          const err = wrap(dir - want)
          assert.ok(Math.abs(err) < 0.02,
            `${weaponType} facing ${facing} at t=${t} draws the blade ` +
            `${Math.round(err * 180 / Math.PI)}° away from the direction it swings`)
        }
    })

    it(`${weaponType}: the sprite tip stays inside the weapon's reach`, () => {
      const { reach } = getSwingArc(atk.style)
      for (const t of [0, 0.5, 1]) {
        const { tipReach } = drawnBlade(weaponType, atk.style, 'east', t)
        assert.ok(tipReach <= reach,
          `${weaponType} draws its tip ${tipReach.toFixed(1)}px out but only damages to ${reach}px`)
      }
    })
  }

  it('a swing points the blade forward at the moment it connects', () => {
    // Damage lands the instant the swing starts, so the blade must already be
    // sweeping the front half by then — not still wound up behind the player.
    for (const [weaponType, atk] of Object.entries(ATTACK_STYLES)) {
      if (atk.style === 'spin') continue
      const { dir } = drawnBlade(weaponType, atk.style, 'east', 0)
      assert.ok(Math.cos(dir) > 0,
        `${weaponType} starts its swing pointing behind the player`)
    }
  })
})

describe('enemy swings are drawn at the reach they bite with', () => {
  for (const [id, w] of Object.entries(WEAPONS)) {
    const { halfAngle } = weaponWedge(w)

    it(`${id}: trail and blade stay inside its ${w.reach}px reach`, () => {
      for (const t of [0, 0.5, 1]) {
        const { radius, trailWidth, wscale } = swingPose(w.style, t, w.reach)
        assert.ok(radius + trailWidth / 2 <= w.reach, `${id} trail overshoots its reach`)
        assert.ok(wscale * 0.9 * S <= w.reach, `${id} blade tip overshoots its reach`)
      }
    })

    it(`${id}: never sweeps outside the wedge it damages`, () => {
      for (let t = 0; t <= 1; t += 0.1) {
        const { angle, from } = swingPose(w.style, t, w.reach)
        for (const a of [wrap(angle), wrap(from)])
          assert.ok(Math.abs(a) <= halfAngle + 1e-6, `${id} draws the blade outside its hit wedge`)
      }
    })
  }

  // Enemies attack along a committed angle rather than a facing, so drive the
  // real drawEnemySwing and measure the sprite it puts on screen.
  function drawnEnemyBlade(weaponId, angle, t, phase = 'swing') {
    const ctx = probeCtx()
    const w = WEAPONS[weaponId]
    const e = {
      type: 'guard', weaponId, px: 0, py: 0,
      attack: { weaponId, phase, angle, timer: (1 - t) * w.duration, duration: w.duration },
    }
    drawEnemySwing(ctx, e, { weapon_sword: 'IMG', weapon_club: 'IMG' }, 0, 0, S)
    const { tip, grip } = ctx.hits.at(-1)
    return { dir: Math.atan2(tip.y - grip.y, tip.x - grip.x), tipReach: Math.hypot(tip.x, tip.y) }
  }

  for (const weaponId of ['sword', 'club']) {
    const w = WEAPONS[weaponId]

    it(`${weaponId}: the drawn blade tracks the angle the swing committed to`, () => {
      for (const angle of [0, Math.PI / 2, -2.4]) {
        for (const t of [0, 0.5, 1]) {
          const { dir } = drawnEnemyBlade(weaponId, angle, t)
          const err = wrap(dir - (angle + swingPose(w.style, t, w.reach).angle))
          assert.ok(Math.abs(err) < 0.02,
            `${weaponId} at angle ${angle} draws ${Math.round(err * 180 / Math.PI)}° off its swing`)
        }
      }
    })

    it(`${weaponId}: is drawn from its own reach, not the player weapon's`, () => {
      // Sizing off the shared style would silently hand enemies the player's
      // reach — a guard's sword drawn 33px out while it only bites to 34px.
      const { tipReach } = drawnEnemyBlade(weaponId, 0, 1)
      const want = swingPose(w.style, 1, w.reach).wscale * 0.9 * S
      assert.ok(Math.abs(tipReach - want) < 0.5,
        `${weaponId} draws its tip ${tipReach.toFixed(1)}px out, expected ${want.toFixed(1)}px for a ${w.reach}px reach`)
    })

    it(`${weaponId}: the windup telegraph is posed at strike size, on the side the blow comes from`, () => {
      const { dir, tipReach } = drawnEnemyBlade(weaponId, 0, 1, 'windup')
      const start = swingPose(w.style, 0, w.reach).angle
      assert.ok(Math.abs(wrap(dir - start)) < 0.2, `${weaponId} winds up on the wrong side`)
      assert.ok(tipReach <= w.reach, `${weaponId} telegraph is drawn past the reach it will strike with`)
    })
  }
})

describe('charge auto-release', () => {
  it('fires 0.5s past the over threshold, per weapon', () => {
    assert.equal(shouldAutoRelease('axe', 1.6), false)      // over=1.2, grace to 1.7
    assert.equal(shouldAutoRelease('axe', 1.8), true)
    assert.equal(shouldAutoRelease('longsword', 1.7), true) // over=1.1
  })
  it('never fires for non-charge weapons', () => {
    assert.equal(shouldAutoRelease('dagger', 99), false)
  })
})

describe('tierMods', () => {
  it('returns the same mods resolveCharge would for that tier', () => {
    assert.deepEqual(tierMods('tap'), resolveCharge('axe', 0))       // axe at 0s held = tap
    assert.deepEqual(tierMods('full'), resolveCharge('dagger', 0))   // non-charge = full
  })
})
