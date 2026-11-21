import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { houseSpec, VERSIONS, STORY_ROOMS } from '../renderer/interior/versions.js'
import { generateInterior, specFor } from '../renderer/interior/index.js'
import { isWalkable } from '../renderer/systems/entities.js'

const door = (over = {}) => ({ x: 10, y: 10, label: 'house:wilds:10,10', tier: 'hut', story: null, toughness: 1, look: { w: 3, storeys: 1, wall: 'wood' }, ...over })
const doors = (n, over) => Array.from({ length: n }, (_, i) => door({ label: `house:wilds:${i * 7},${i * 13}`, ...over }))
const tally = list => list.reduce((m, v) => (m[v] = (m[v] ?? 0) + 1, m), {})
const kinds = s => s.map(e => e.kind)

function reach(map, from) {
  const seen = new Set([`${from.x},${from.y}`]), q = [from]
  while (q.length) {
    const { x, y } = q.pop()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`
      if (!seen.has(k) && map[ny]?.[nx] && isWalkable(map[ny][nx].tile, map[ny][nx])) { seen.add(k); q.push({ x: nx, y: ny }) }
    }
  }
  return seen
}

describe('which house is behind a door', () => {
  it('the puzzle house, a story house, the keep: always the same version', () => {
    assert.equal(houseSpec(door({ kind: 'sunroom', tier: 'safe' })).version, 'sunroom')
    assert.equal(houseSpec(door({ story: "Toivo's hut" }), { story: { room: 'toivo_kitchen', pickups: [] } }).version, 'empty')
    assert.equal(houseSpec(door({ tier: 'ruin' })).version, 'ruin')
  })
  it('a village house is nearly always a home, now and then abandoned', () => {
    const t = tally(doors(400, { tier: 'safe' }).map(d => houseSpec(d).version))
    assert.deepEqual(Object.keys(t).sort(), ['abandoned', 'home'])
    assert.ok(t.home > 320 && t.abandoned > 20, JSON.stringify(t))
  })
  it('a hut in the wild is a home, abandoned, a nest or a hideout, more often hostile further out', () => {
    const near = tally(doors(400).map(d => houseSpec(d).version))
    const far = tally(doors(400, { toughness: 3 }).map(d => houseSpec(d).version))
    for (const t of [near, far]) assert.deepEqual(Object.keys(t).sort(), ['abandoned', 'hideout', 'home', 'nest'])
    assert.ok(far.hideout + far.nest > near.hideout + near.nest, JSON.stringify({ near, far }))
  })
  it('sizes by the house seen outside, palettes by its wall', () => {
    assert.equal(houseSpec(door({ look: { w: 3, storeys: 1, wall: 'wood' } })).size, 'small')
    assert.equal(houseSpec(door({ look: { w: 4, storeys: 1, wall: 'stone' } })).size, 'medium')
    assert.equal(houseSpec(door({ look: { w: 5, storeys: 1, wall: 'stone' } })).size, 'large')
    assert.equal(houseSpec(door({ look: { w: 5, storeys: 2, wall: 'stone' } })).size, 'grand')
    assert.equal(houseSpec(door({ look: undefined, tier: 'safe' })).size, 'medium')
    assert.equal(houseSpec(door({ look: { w: 3, storeys: 1, wall: 'wood' }, tier: 'safe' })).palette, 'wood')
    assert.equal(houseSpec(door({ look: { w: 3, storeys: 1, wall: 'stone' }, tier: 'safe' })).palette, 'plaster')
    assert.equal(houseSpec(door({ tier: 'ruin' })).palette, 'grey')
  })
  it('the same door in the same world is the same house; another world, another house', () => {
    const a = generateInterior(houseSpec(door(), { worldSeed: 5 })), b = generateInterior(houseSpec(door(), { worldSeed: 5 }))
    assert.deepEqual(a, b)
    const c = generateInterior(houseSpec(door(), { worldSeed: 6 }))
    assert.notDeepEqual(a.map.map(r => r.map(x => x.overlay)), c.map.map(r => r.map(x => x.overlay)))
  })
})

describe('who lives there', () => {
  const sweep = (version, over = {}, n = 60) => Array.from({ length: n }, (_, i) =>
    generateInterior(specFor({ version, seed: i + 1, label: `t:${version}:${i}`, size: ['small', 'medium', 'large', 'grand'][i % 4], ...over })))
  it('a home has its people, friendly and talkative, and nothing that bites', () => {
    for (const g of sweep('home')) {
      const npcs = g.entitySpawns.filter(s => s.kind === 'npc')
      assert.ok(npcs.length >= 1)
      for (const n of npcs) { assert.equal(n.hostile, false); assert.ok(Array.isArray(n.lines) && n.lines.length >= 2); assert.ok(['villager', 'elder'].includes(n.species)) }
      assert.ok(!kinds(g.entitySpawns).some(k => k === 'monster' || k === 'guard' || k === 'pullopete'))
    }
  })
  it('bandits hold a hideout, spiders a nest, the haunted keep its strong one', () => {
    for (const g of sweep('hideout')) assert.ok(kinds(g.entitySpawns).some(k => k === 'guard' || k === 'pullopete'))
    for (const g of sweep('hideout', { toughness: 3 })) assert.ok(kinds(g.entitySpawns).filter(k => k === 'guard').length >= 2)
    for (const g of sweep('nest')) assert.ok(g.entitySpawns.filter(s => s.kind === 'monster').length >= 2)
    for (const g of sweep('ruin')) {
      assert.ok(g.entitySpawns.some(s => s.variant === 'strong') && g.entitySpawns.some(s => s.variant === 'medium'))
      assert.equal(g.entitySpawns.filter(s => s.kind === 'floating_pickup' && s.contents.type === 'weapon').length, 1)
    }
  })
  it('an abandoned village house is empty; an abandoned hut may keep vermin', () => {
    for (const g of sweep('abandoned', { tier: 'safe' })) assert.ok(!kinds(g.entitySpawns).some(k => k === 'monster' || k === 'npc'))
    assert.ok(sweep('abandoned', { tier: 'hut' }).some(g => kinds(g.entitySpawns).includes('monster')))
  })
  it('never stacks spawns, never on the spawn or the way out, never a chest, trap, fountain or fire', () => {
    const allowed = new Set(['npc', 'monster', 'guard', 'pullopete', 'floating_pickup'])
    for (const v of Object.keys(VERSIONS)) if (v !== 'sunroom') for (const g of sweep(v, {}, 40)) {
      const keys = g.entitySpawns.map(s => `${s.x},${s.y}`)
      assert.equal(new Set(keys).size, keys.length, `${v}: stacked`)
      assert.ok(!keys.includes(`${g.playerSpawn.x},${g.playerSpawn.y}`) && !keys.includes(`${g.exit.x},${g.exit.y}`), `${v}: on the door`)
      for (const s of g.entitySpawns) {
        assert.ok(allowed.has(s.kind), `${v}: ${s.kind}`)
        assert.ok(isWalkable(g.map[s.y][s.x].tile), `${v}: ${s.kind} in a wall`)
        if (s.kind !== 'floating_pickup') assert.ok(Math.abs(s.x - g.playerSpawn.x) + Math.abs(s.y - g.playerSpawn.y) > 3, `${v}: ${s.kind} at the door`)
      }
    }
  })
})

describe('story houses', () => {
  for (const [room, role] of Object.entries(STORY_ROOMS)) {
    it(`${room}: every item of the tale lands once, on reachable floor of the ${role}`, () => {
      const pickups = [{ type: 'meat', count: 2 }, { type: 'lumber', count: 3 }, { type: 'weapon', weaponType: 'hatchet' }]
      for (const size of ['small', 'medium', 'large']) for (let i = 0; i < 50; i++) {
        const g = generateInterior(specFor({ version: 'empty', size, seed: i, label: `story:${room}:${i}`, story: { role, pickups } }))
        const seen = reach(g.map, g.playerSpawn)
        for (const p of pickups) {
          const at = g.entitySpawns.filter(s => s.kind === 'floating_pickup' && s.contents === p)
          assert.equal(at.length, 1, `${room}/${size}#${i}: ${p.type}`)
          assert.ok(seen.has(`${at[0].x},${at[0].y}`), `${room}/${size}#${i}: ${p.type} out of reach`)
          const rid = g.map[at[0].y][at[0].x].roomId
          assert.ok(g.roles.get(rid) === role || g.roles.get(rid) === 'cottage', `${room}/${size}#${i}: in the ${g.roles.get(rid)}`)
        }
      }
    })
  }
})

describe('a story house of one room', () => {
  it("is a cottage that still has its story room's things: the hermit's logs, Toivo's stove", () => {
    let small = 0
    for (let i = 0; i < 60; i++) for (const [role, tile] of [['woodshed', 'in_logs'], ['kitchen', null], ['larder', null]]) {
      const g = generateInterior(specFor({ version: 'empty', size: 'small', seed: i, label: `one:${role}:${i}`, story: { role, pickups: [] } }))
      if (g.plan.rooms.length !== 1) continue
      small++
      const names = g.map.flat().map(c => c.overlay).filter(Boolean)
      if (tile) assert.ok(names.includes(tile), `#${i}: no ${tile} in a one-room ${role}`)
      if (role === 'kitchen') assert.ok(names.some(n => n === 'in_oven' || n === 'in_oven_cold' || n === 'in_stove'), `#${i}: no stove`)
      if (role === 'larder') assert.ok(names.some(n => n === 'in_jars' || n === 'in_cupboard'), `#${i}: no larder cupboard`)
    }
    assert.ok(small > 30, `${small} one-room houses`)
  })
})

describe('how a house is left', () => {
  it('a wall face is seen from the front: its lower row lights the rows above', () => {
    const g = generateInterior(specFor({ version: 'home', seed: 2, label: 'see' }))
    g.map.forEach((row, y) => row.forEach((c, x) => { if (g.plan.grid[y][x] === 'l') assert.equal(c.seeUp, 2) }))
  })
  it('a home sets food on its table, an abandoned house is dusty, cobwebbed and cold', () => {
    let food = 0
    for (let i = 0; i < 40; i++) {
      const home = generateInterior(specFor({ version: 'home', size: 'medium', seed: i, label: `h${i}` }))
      const names = home.map.flat().map(c => c.overlay).filter(Boolean)
      if (names.some(n => n.startsWith('in_table_food'))) food++
      assert.ok(!names.some(n => n.endsWith('_d')), 'a home is not dusty')
      const ab = generateInterior(specFor({ version: 'abandoned', size: 'medium', seed: i, label: `a${i}` }))
      const an = ab.map.flat().map(c => c.overlay).filter(Boolean)
      assert.ok(an.some(n => n.endsWith('_d')), 'dusty furniture')
      assert.ok(an.some(n => n.startsWith('in_web')), 'cobwebs')
      assert.ok(!an.includes('in_hearth_b'), 'a lit fire in an abandoned house')
    }
    assert.ok(food >= 30, `${food}/40 homes laid the table`)
  })
  it('each version has its own light', () => {
    const looks = new Set(Object.values(VERSIONS).map(v => `${v.theme.bgColor}|${v.theme.tint}|${v.theme.fogAlpha}`))
    assert.equal(looks.size, Object.keys(VERSIONS).length)
    assert.equal(generateInterior(specFor({ version: 'nest', seed: 1, label: 'n' })).theme, VERSIONS.nest.theme)
  })
})
