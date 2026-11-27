import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeNpc, buildCtx, selectGoal, updateNpc, GOALS } from '../renderer/systems/npc.js'
import { NPC_SPECIES } from '../renderer/data/npcs.js'
import { NPC_SHEETS } from '../renderer/render/npc-sheets.js'
import { RUN_GOALS } from '../renderer/systems/npc-anim.js'
import { makeFeedback } from '../renderer/systems/feedback.js'

const S = 32
function field(w = 40, h = 30) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) map[y][x].tile = TILE.FLOOR
  return map
}
const state = (hero, entities) => ({
  map: field(), entities, feedback: makeFeedback(), sfx: { cues: [], muted: false },
  player: { type: 'player', x: hero.x, y: hero.y, px: hero.x * S + S / 2, py: hero.y * S + S / 2, maxHp: 10, hp: 10 },
})
const jackal = (x, y) => makeNpc({ species: 'jackal', id: `npc:test:${x},${y}`, x, y })
const goalOf = (e, s) => selectGoal(e, buildCtx(e, s, 1 / 60))
const away = (e, s) => Math.hypot(e.px - s.player.px, e.py - s.player.py)

describe('the jackal', () => {
  it('is a hostile wild animal on the wolf\'s frames, lighter and quicker than a wolf', () => {
    const j = NPC_SPECIES.jackal, w = NPC_SPECIES.wolf
    assert.equal(j.hostile, true)
    assert.equal(j.sheet, 'jackal')
    assert.ok(NPC_SHEETS.jackal.tiles < NPC_SHEETS.wolf.tiles)
    assert.ok(j.hp < w.hp && j.speed > w.speed)
    assert.deepEqual(j.priorities, ['flee_alone', 'harry', 'go_to', 'wander'])
    assert.ok(RUN_GOALS.has('harry') && RUN_GOALS.has('flee_alone'))
  })

  it('alone and near the hero, it runs', () => {
    const e = jackal(10, 10), s = state({ x: 13, y: 10 }, [e])
    assert.equal(goalOf(e, s), 'flee_alone')
    const d0 = away(e, s)
    for (let i = 0; i < 60; i++) updateNpc(e, s, 1 / 60)
    assert.ok(away(e, s) > d0 + S, 'it put ground between them')
    assert.equal(e.attack ?? null, null)
  })

  it('alone and far off, it keeps its distance rather than bolting', () => {
    const e = jackal(10, 10), s = state({ x: 30, y: 10 }, [e])
    assert.equal(goalOf(e, s), 'harry')
  })

  it('with a mate in reach of its pack, it harries', () => {
    const a = jackal(10, 10), b = jackal(12, 11), s = state({ x: 14, y: 10 }, [a, b])
    assert.equal(goalOf(a, s), 'harry')
    assert.equal(goalOf(b, s), 'harry')
  })

  it('a dead or dying mate, another animal or one too far away is no company', () => {
    const a = jackal(10, 10)
    const dead = jackal(11, 10); dead.hp = 0
    const dying = jackal(11, 11); dying.dying = 0.5
    const wolf = makeNpc({ species: 'wolf', id: 'npc:test:w', x: 12, y: 10 })
    const far = jackal(10 + NPC_SPECIES.jackal.pack + 2, 10)
    assert.equal(goalOf(a, state({ x: 13, y: 10 }, [a, dead, dying, wolf, far])), 'flee_alone')
  })

  it('backs off after each bite, then comes in again', () => {
    const a = jackal(10, 10), b = jackal(10, 12), s = state({ x: 12, y: 10 }, [a, b])
    const ctx = () => buildCtx(a, s, 1 / 60)
    selectGoal(a, ctx())
    // a bite of its own in flight, then over
    a.attack = { weaponId: 'claw', phase: 'swing', timer: 0.1, duration: 0.1, angle: 0 }
    GOALS.harry.run(a, ctx(), 1 / 60)
    a.attack = null
    const intent = GOALS.harry.run(a, ctx(), 1 / 60)
    assert.equal(intent.mode, 'flee')
    const [lo, hi] = NPC_SPECIES.jackal.backOff
    assert.ok(a.ai.backOff > lo - 0.1 && a.ai.backOff <= hi, `backs off ${a.ai.backOff}`)
    for (let i = 0; i < hi * 60 + 2; i++) GOALS.harry.run(a, ctx(), 1 / 60)
    assert.ok(!(a.ai.backOff > 0))
    assert.notEqual(GOALS.harry.run(a, ctx(), 1 / 60).mode, 'flee')
  })

  it('yips once when the pack first comes for the hero', () => {
    const a = jackal(10, 10), b = jackal(10, 12), s = state({ x: 14, y: 10 }, [a, b])
    for (let i = 0; i < 30; i++) { updateNpc(a, s, 1 / 60); updateNpc(b, s, 1 / 60) }
    assert.equal(s.sfx.cues.filter(c => c.name === 'yip').length, 2)   // one each, never again
  })

  it('kill two of three and the third bolts', () => {
    const [a, b, c] = [jackal(10, 10), jackal(11, 11), jackal(10, 12)], s = state({ x: 13, y: 10 }, [a, b, c])
    assert.equal(goalOf(c, s), 'harry')
    a.hp = 0; b.hp = 0
    assert.equal(goalOf(c, s), 'flee_alone')
  })
})
