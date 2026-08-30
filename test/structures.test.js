// test/structures.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { placeStructure } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

function blankMap(w, h) {
  return Array.from({ length: h }, () =>
    Array.from({ length: w }, () => ({ tile: TILE.WALL, roomId: null })))
}

const structure = {
  w: 2, h: 2,
  cells: [
    { x: 0, y: 0, skin: 'castle_wall', overlay: null, collision: 'wall', interaction: null },
    { x: 1, y: 0, skin: 'castle_gate', overlay: null, collision: 'wall', interaction: { type: 'door' } },
    { x: 0, y: 1, skin: 'castle_floor', overlay: 'rug', collision: 'walkable', interaction: null },
    { x: 1, y: 1, skin: 'castle_floor', overlay: null, collision: 'walkable', interaction: { type: 'chest' } },
  ],
}

describe('placeStructure', () => {
  it('stamps skins/overlays and marks cells locked at the offset', () => {
    const map = blankMap(5, 5)
    placeStructure(map, structure, 2, 1, 7)
    assert.equal(map[1][2].skin, 'castle_wall')
    assert.equal(map[1][2].locked, true)
    assert.equal(map[2][2].overlay, 'rug')
  })
  it('maps collision to logical tiles', () => {
    const map = blankMap(5, 5)
    placeStructure(map, structure, 2, 1, 7)
    assert.equal(map[1][2].tile, TILE.WALL)       // collision: wall
    assert.equal(map[2][2].tile, TILE.FLOOR)      // collision: walkable
    assert.equal(map[2][2].roomId, 7)
  })
  it('forces interaction cells walkable and emits door/chest spawns', () => {
    const map = blankMap(5, 5)
    const spawns = placeStructure(map, structure, 2, 1, 7)
    assert.equal(map[1][3].tile, TILE.FLOOR)      // gate door overrides wall->floor
    // The interaction object's own fields are spread onto the spawn (so a
    // pickup's `slot` survives) — door/chest interactions carry no fields
    // beyond `type`, so the spawn duplicates it alongside `kind`.
    assert.deepEqual(spawns.find(s => s.kind === 'door'), { kind: 'door', x: 3, y: 1, type: 'door' })
    assert.deepEqual(spawns.find(s => s.kind === 'chest'), { kind: 'chest', x: 3, y: 2, type: 'chest' })
  })
  it('spreads extra interaction fields (e.g. a pickup slot) onto the spawn', () => {
    const withSlot = {
      w: 1, h: 1,
      cells: [{ x: 0, y: 0, skin: 'floor', overlay: null, collision: 'walkable', interaction: { type: 'pickup', slot: 2 } }],
    }
    const map = blankMap(3, 3)
    const spawns = placeStructure(map, withSlot, 1, 1, 0)
    assert.deepEqual(spawns[0], { kind: 'pickup', x: 1, y: 1, type: 'pickup', slot: 2 })
  })
  it('ignores cells that fall outside the map', () => {
    const map = blankMap(2, 2)
    assert.doesNotThrow(() => placeStructure(map, structure, 1, 1, 0))
    assert.equal(map[1][1].skin, 'castle_wall')   // only the in-bounds cell stamped
  })
})

// The three story-house prefabs (Task 3) — authored by hand in the editor's
// Build tab, loaded here the same way game.js loads them at runtime.
const __dirname = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(__dirname, '../renderer/assets/tiles')
const tileExists = name => existsSync(join(ASSETS, `${name}.png`))
const STRUCTURES = JSON.parse(readFileSync(new URL('../renderer/data/structures.json', import.meta.url)))

describe('story house prefabs', () => {
  for (const name of ['toivo_kitchen', 'hermit_woodpile', 'aino_larder']) {
    describe(name, () => {
      const s = STRUCTURES[name]

      it('exists and is 9x7', () => {
        assert.ok(s, `${name} missing from structures.json`)
        assert.equal(s.w, 9)
        assert.equal(s.h, 7)
        assert.equal(s.cells.length, 63)
      })

      it('has exactly one non-wall border cell (the doorway)', () => {
        const border = s.cells.filter(c => c.x === 0 || c.x === s.w - 1 || c.y === 0 || c.y === s.h - 1)
        const nonWall = border.filter(c => c.collision !== 'wall')
        assert.equal(nonWall.length, 1)
        assert.equal(nonWall[0].collision, 'walkable')
      })

      it('has a single doorway in the middle of the south edge', () => {
        const border = s.cells.filter(c => c.x === 0 || c.x === s.w - 1 || c.y === 0 || c.y === s.h - 1)
        const door = border.find(c => c.collision !== 'wall')
        assert.equal(door.y, s.h - 1)
        assert.equal(door.x, Math.floor(s.w / 2))
      })

      it('has contiguous pickup slots 0..n-1 on walkable floor cells', () => {
        const pickups = s.cells.filter(c => c.interaction?.type === 'pickup')
        const slots = pickups.map(c => c.interaction.slot).sort((a, b) => a - b)
        assert.deepEqual(slots, slots.map((_, i) => i))
        for (const c of pickups) assert.equal(c.collision, 'walkable')
      })

      it('never puts an overlay on a pickup cell', () => {
        for (const c of s.cells) if (c.interaction?.type === 'pickup') assert.equal(c.overlay, null)
      })

      it('keeps pickup cells off the doorway\'s neighbours', () => {
        const border = s.cells.filter(c => c.x === 0 || c.x === s.w - 1 || c.y === 0 || c.y === s.h - 1)
        const door = border.find(c => c.collision !== 'wall')
        for (const c of s.cells) if (c.interaction?.type === 'pickup')
          assert.ok(Math.max(Math.abs(c.x - door.x), Math.abs(c.y - door.y)) > 1, `pickup at ${c.x},${c.y} touches the doorway`)
      })

      it('every skin/overlay name is a real tile file', () => {
        const names = new Set(s.cells.flatMap(c => [c.skin, c.overlay]).filter(Boolean))
        const missing = [...names].filter(n => !tileExists(n))
        assert.deepEqual(missing, [], `missing tile files: ${missing.join(', ')}`)
      })

      it('does not carry a targetDepth (storyStructures adds that at runtime)', () => {
        assert.equal(s.targetDepth, undefined)
      })
    })
  }

  it('toivo_kitchen dresses a fish rack, a table and chairs', () => {
    const s = STRUCTURES.toivo_kitchen
    const overlays = new Set(s.cells.map(c => c.overlay).filter(Boolean))
    assert.ok(overlays.has('tile_0077'), 'fish rack fence overlay')
    assert.ok(overlays.has('tile_0072'), 'table overlay')
    assert.ok(overlays.has('tile_0073'), 'chair overlay')
  })

  it('hermit_woodpile dresses crates and barrels', () => {
    const s = STRUCTURES.hermit_woodpile
    const overlays = new Set(s.cells.map(c => c.overlay).filter(Boolean))
    assert.ok(overlays.has('tile_0075'), 'crate overlay')
    assert.ok(overlays.has('tile_0082'), 'barrel overlay')
  })

  it('aino_larder dresses barrels and a table', () => {
    const s = STRUCTURES.aino_larder
    const overlays = new Set(s.cells.map(c => c.overlay).filter(Boolean))
    assert.ok(overlays.has('tile_0082'), 'barrel overlay')
    assert.ok(overlays.has('tile_0072'), 'table overlay')
  })
})
