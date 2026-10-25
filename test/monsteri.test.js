import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as hooks from '../renderer/systems/monsters/monsteri.js'
import { registerMonsters, clearMonsters, tuningOf, updateMonsterPose } from '../renderer/systems/monsters.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE, makePlayer, makeShieldContents } from '../renderer/systems/entities.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { tickStatus } from '../renderer/systems/status.js'
import { tickBinds, struggle, grabPlayer } from '../renderer/systems/player-bind.js'

const def = JSON.parse(readFileSync(new URL('../renderer/data/monsters/monsteri.json', import.meta.url), 'utf8'))
const S = 32, DT = 1 / 60
const T = () => tuningOf('monsteri')
const at = (px, py) => ({ x: Math.floor(px / S), y: Math.floor(py / S), px, py })
const MX = 8 * S + 16, MY = 6 * S + 16          // where the monster stands
const south = tiles => [MX, MY + tiles * S]       // a hero that many tiles south of it

function setup({ hero = south(2) } = {}) {
  const map = createMap(16, 16)
  for (const row of map) for (const c of row) c.tile = TILE.FLOOR
  const e = { type: 'monsteri', hp: 12, maxHp: 12, ...at(MX, MY) }
  const player = { ...makePlayer(0, 0), ...at(...hero), facing: 'north', stamina: 100 }
  return { e, player, state: { map, player, entities: [e], feedback: makeFeedback(), sfx: makeSfx() } }
}

// One frame as game.js runs it for this monster (no brain: it stands where
// it is put unless its own hook moves it).
function frame({ e, player, state }) {
  tickBinds(player, DT, state.entities)
  tickStatus(e, DT)
  if (e.stunTimer > 0) { e.stunTimer -= DT; return }
  updateMonsterPose(e, DT)
  hooks.update(e, state, DT)
}
const run = (w, secs) => { for (let i = 0; i < Math.round(secs / DT); i++) frame(w) }
function runUntil(w, st, max = 6) {
  for (let i = 0; i < max / DT; i++) { frame(w); if (w.e.mech?.state === st) return }
  assert.fail(`never reached ${st} (stuck in ${w.e.mech?.state})`)
}

function recordingCtx() {
  const target = { ops: [] }
  return new Proxy(target, {
    get(t, k) { if (k in t) return t[k]; return (...a) => { t.ops.push([k, ...a]) } },
    set(t, k, v) { t[k] = v; return true },
  })
}

describe('monsteri', () => {
  beforeEach(async () => {
    clearMonsters()
    await registerMonsters([def], { loadRig: id => import(`../renderer/render/monster-rigs/${id}.js`),
      loadHooks: async () => hooks, warn: m => { throw new Error(m) } })
  })

  it('takes its tuning from the def, every TUNING_SCHEMA key present', () => {
    for (const p of hooks.TUNING_SCHEMA) assert.ok(p.key in tuningOf('monsteri'), p.key)
  })

  describe('the frost breath', () => {
    it('winds up with its orbs lighting, then freezes a hero in the cone', () => {
      const w = setup()
      run(w, T().windup / 2)
      assert.equal(w.e.mech.state, 'windup')
      assert.ok(w.e.pose.eyeGlow > 0.3 && w.e.pose.eyeGlow < 1, `glow ${w.e.pose.eyeGlow}`)
      assert.equal(w.player.ice ?? null, null)
      run(w, T().windup / 2 + 0.1)
      assert.equal(w.player.ice?.dur, T().freeze)
    })

    it('stands still while it winds up and breathes', () => {
      const w = setup()
      w.e.rootTimer = 0
      runUntil(w, 'breath')
      assert.ok(w.e.rootTimer > 0, 'rooted, so the brain cannot walk it')
    })

    it('leaves a hero beyond its reach alone', () => {
      const w = setup({ hero: south(T().reach + 1) })
      run(w, 3)
      assert.equal(w.e.mech.state, 'stalk')
      assert.equal(w.player.ice ?? null, null)
    })

    it('misses a hero who leaves the cone before it breathes, and rests', () => {
      const w = setup()
      runUntil(w, 'breath')
      Object.assign(w.player, at(MX, MY - 2 * S))     // behind it now
      run(w, T().breathTime + 0.05)
      assert.equal(w.player.ice ?? null, null)
      assert.equal(w.e.mech.state, 'stalk')
      assert.ok(w.e.mech.cd > 0, 'the breath is on cooldown')
    })

    it('is stopped by a shield raised toward it, for the shield’s stamina', () => {
      const w = setup()
      const { type, ...s } = makeShieldContents('buckler')
      w.player.gear.melee.off = { kind: 'shield', ...s }
      w.player.blocking = true
      run(w, T().windup + 0.1)
      assert.equal(w.player.ice ?? null, null)
      assert.ok(w.player.stamina < 100)
    })

    it('never winds up at a hero something else already holds', () => {
      const w = setup()
      const other = { type: 'monsteri', hp: 12, ...at(MX + 64, MY) }
      w.state.entities.push(other)
      grabPlayer(w.player, other)
      run(w, 2)
      assert.equal(w.e.mech.state, 'stalk')
    })
  })

  describe('the grab', () => {
    it('rushes a frozen hero and takes them in its arms', () => {
      const w = setup({ hero: south(2.5) })
      runUntil(w, 'rush')
      runUntil(w, 'hold', 2)
      assert.equal(w.player.held.by, w.e)
      assert.equal(w.player.ice, null)
      assert.ok(w.e.py > MY, 'it came for the hero')
      assert.ok(Math.hypot(w.player.px - w.e.px, w.player.py - w.e.py) <= T().holdDist * S + 1, 'pulled in close')
    })

    it('misses a hero who thaws first, backs off, then stalks again', () => {
      const w = setup({ hero: south(2.9) })
      T().freeze = T().breathTime + 0.1
      runUntil(w, 'retreat')
      assert.equal(w.player.held ?? null, null)
      const y = w.e.py
      run(w, Math.min(0.3, T().retreat / 2))
      assert.ok(w.e.py < y, 'backing away from the hero')
      runUntil(w, 'stalk', T().retreat + 0.2)
      assert.ok(w.e.mech.cd > 0)
    })

    it('squeezes the held hero every interval, through i-frames', () => {
      const w = setup()
      runUntil(w, 'hold')
      const hp = w.player.hp
      w.player.invulnTimer = 10
      run(w, T().squeezeEvery * 2 + DT)
      assert.equal(w.player.hp, hp - 2 * T().squeezeDmg)
    })

    it('keeps the hero pinned where it caught them', () => {
      const w = setup()
      runUntil(w, 'hold')
      const { px, py } = w.player
      w.player.px += 40
      frame(w)
      assert.deepEqual([w.player.px, w.player.py], [px, py])
    })

    it('mashing breaks the grip: the hero is thrown clear and the monster reels', () => {
      const w = setup()
      runUntil(w, 'hold')
      for (let i = 0; i < T().mashNeed; i++) struggle(w.player)
      frame(w)
      assert.equal(w.player.held, null)
      assert.ok(w.player.knockback?.vy > 0, 'shoved away, south')
      assert.ok(Math.abs(w.e.stunTimer - T().reel) < 1e-9, 'reeling')
      assert.equal(w.e.mech.state, 'stalk')
      assert.equal(w.e.mech.cd, T().cooldown)
    })

    it('slow presses fade before they add up', () => {
      const w = setup()
      runUntil(w, 'hold')
      struggle(w.player)
      run(w, 1.5 / T().mashDecay)
      assert.equal(w.player.held.presses, 0)
      assert.equal(w.player.held.by, w.e)
    })

    it('lets go of a hero who falls', () => {
      const w = setup()
      runUntil(w, 'hold')
      w.player.hp = 0
      frame(w)
      assert.equal(w.player.held, null)
    })
  })

  describe('drawing', () => {
    const draws = w => { const c = recordingCtx(); hooks.drawFx(c, w.e, 32); return c.ops }

    it('draws nothing while it stalks', () => {
      const w = setup({ hero: south(10) })
      run(w, 0.2)
      assert.equal(draws(w).length, 0)
    })

    it('breathes a spray of frost that is busiest during the breath', () => {
      const w = setup()
      run(w, T().windup / 2)
      const charging = draws(w).filter(o => o[0] === 'fillRect').length
      runUntil(w, 'breath')
      frame(w)
      const breath = draws(w).filter(o => o[0] === 'fillRect').length
      assert.ok(breath > charging, `${breath} > ${charging}`)
    })

    it('hugs the hero from both sides: arm segments reach out past either side of the hero', () => {
      const w = setup()
      runUntil(w, 'hold')
      const hx = (w.player.px - w.e.px)
      const xs = draws(w).filter(o => o[0] === 'fillRect').map(o => o[1] + o[3] / 2)
      assert.ok(xs.some(x => x < hx - 10) && xs.some(x => x > hx + 10), 'arms out past both sides of the hero')
    })

    it('wraps its arms round a held hero, loosening as the hero struggles', () => {
      const w = setup()
      runUntil(w, 'hold')
      const tight = JSON.stringify(draws(w))
      assert.ok(draws(w).filter(o => o[0] === 'fillRect').length >= 8)
      for (let i = 0; i < T().mashNeed - 1; i++) struggle(w.player)
      w.player.held.jolt = 0
      assert.notEqual(JSON.stringify(draws(w)), tight)
    })
  })

  it('reports its state, and the grip while it holds', () => {
    const w = setup()
    runUntil(w, 'hold')
    assert.match(hooks.debugState(w.e), /hold/)
    assert.match(hooks.debugState(w.e), new RegExp(`/${T().mashNeed}`))
  })
})
