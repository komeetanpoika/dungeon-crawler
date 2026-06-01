import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SPRITES } from '../renderer/render/sprites.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(__dirname, '../renderer/assets/tiles')

function tileFile(name) { return join(ASSETS, `${name}.png`) }

// ── Asset existence ──────────────────────────────────────────────────────────
describe('sprite assets exist on disk', () => {
  it('every sprite key points to a real file', () => {
    const missing = Object.entries(SPRITES)
      .filter(([, name]) => !existsSync(tileFile(name)))
      .map(([key, name]) => `${key} → ${name}.png`)
    assert.deepEqual(missing, [], `Missing tile files:\n  ${missing.join('\n  ')}`)
  })
})

// ── Ground-truth tile mappings (verified by manual inspection) ───────────────
describe('environment tiles', () => {
  it('floor   = tile_0000', () => assert.equal(SPRITES.floor,        'tile_0000'))
  it('wall    = tile_0040', () => assert.equal(SPRITES.wall,         'tile_0040'))
  it('sand    = tile_0048', () => assert.equal(SPRITES.sand,         'tile_0048'))
  it('stairs_dn = tile_0056', () => assert.equal(SPRITES.stairs_dn,  'tile_0056'))
  it('stairs_up = tile_0057', () => assert.equal(SPRITES.stairs_up,  'tile_0057'))
  it('treasure  = tile_0063', () => assert.equal(SPRITES.treasure,   'tile_0063'))
  it('shrine    = tile_0064', () => assert.equal(SPRITES.shrine,     'tile_0064'))
  it('column  = tile_0075 (crate — no pillar in tileset)', () => assert.equal(SPRITES.column, 'tile_0075'))
  it('column is NOT tile_0077 (that is a fence)', () => assert.notEqual(SPRITES.column, 'tile_0077'))
})

describe('door animation frames', () => {
  it('door_0 = tile_0009', () => assert.equal(SPRITES.door_0, 'tile_0009'))
  it('door_1 = tile_0021', () => assert.equal(SPRITES.door_1, 'tile_0021'))
  it('door_2 = tile_0033', () => assert.equal(SPRITES.door_2, 'tile_0033'))
  it('door_3 = tile_0045', () => assert.equal(SPRITES.door_3, 'tile_0045'))
})

describe('chest animation frames', () => {
  it('chest_0 = tile_0089 (closed chest)',      () => assert.equal(SPRITES.chest_0, 'tile_0089'))
  it('chest_1 = tile_0090 (half-open chest)',   () => assert.equal(SPRITES.chest_1, 'tile_0090'))
  it('chest_2 = tile_0091 (fully open chest)',  () => assert.equal(SPRITES.chest_2, 'tile_0091'))
  it('no chest_3 — tile_0092 is a mimic, not a chest frame', () => {
    assert.equal(SPRITES.chest_3, undefined)
  })
  it('no chest_4 — tile_0093 is a track piece, not a chest frame', () => {
    assert.equal(SPRITES.chest_4, undefined)
  })
})

describe('characters', () => {
  it('player        = tile_0084', () => assert.equal(SPRITES.player,        'tile_0084'))
  it('guard         = tile_0085', () => assert.equal(SPRITES.guard,         'tile_0085'))
  it('monster_weak  = tile_0120 (bat)',       () => assert.equal(SPRITES.monster_weak,   'tile_0120'))
  it('monster_medium= tile_0121 (ghost)',     () => assert.equal(SPRITES.monster_medium, 'tile_0121'))
  it('monster_strong= tile_0122 (spider)',    () => assert.equal(SPRITES.monster_strong, 'tile_0122'))
  it('monster_boss  = tile_0123 (brown rat)', () => assert.equal(SPRITES.monster_boss,   'tile_0123'))
  it('cyclops       = tile_0109', () => assert.equal(SPRITES.cyclops, 'tile_0109'))
  it('crab          = tile_0110', () => assert.equal(SPRITES.crab,    'tile_0110'))
  it('wizard        = tile_0111', () => assert.equal(SPRITES.wizard,  'tile_0111'))
})

describe('weapons and items', () => {
  it('weapon_dagger    = tile_0103', () => assert.equal(SPRITES.weapon_dagger,    'tile_0103'))
  it('weapon_sword     = tile_0104', () => assert.equal(SPRITES.weapon_sword,     'tile_0104'))
  it('weapon_longsword = tile_0106', () => assert.equal(SPRITES.weapon_longsword, 'tile_0106'))
  it('weapon_axe       = tile_0118 (double-bladed axe)', () => assert.equal(SPRITES.weapon_axe, 'tile_0118'))
  it('potion           = tile_0116', () => assert.equal(SPRITES.potion, 'tile_0116'))
})

describe('fountain and pipe props', () => {
  it('prop_pipe_dry       = tile_0007', () => assert.equal(SPRITES.prop_pipe_dry,       'tile_0007'))
  it('prop_pipe_flow      = tile_0008', () => assert.equal(SPRITES.prop_pipe_flow,      'tile_0008'))
  it('prop_gargoyle_dry   = tile_0019', () => assert.equal(SPRITES.prop_gargoyle_dry,   'tile_0019'))
  it('prop_gargoyle_flow  = tile_0020', () => assert.equal(SPRITES.prop_gargoyle_flow,  'tile_0020'))
  it('prop_fountain_empty = tile_0031', () => assert.equal(SPRITES.prop_fountain_empty, 'tile_0031'))
  it('prop_fountain_full  = tile_0032', () => assert.equal(SPRITES.prop_fountain_full,  'tile_0032'))
  it('prop_drain_empty    = tile_0043', () => assert.equal(SPRITES.prop_drain_empty,    'tile_0043'))
  it('prop_drain_liquid   = tile_0044', () => assert.equal(SPRITES.prop_drain_liquid,   'tile_0044'))
})

describe('staircase passage sprites', () => {
  it('stair       = tile_0039 (single-tile stair)', () => assert.equal(SPRITES.stair,       'tile_0039'))
  it('stair_left  = tile_0036 (wide stair left)',   () => assert.equal(SPRITES.stair_left,  'tile_0036'))
  it('stair_mid   = tile_0037 (wide stair middle)', () => assert.equal(SPRITES.stair_mid,   'tile_0037'))
  it('stair_right = tile_0038 (wide stair right)',  () => assert.equal(SPRITES.stair_right, 'tile_0038'))
})

describe('room decoration props', () => {
  it('prop_table      = tile_0072', () => assert.equal(SPRITES.prop_table,      'tile_0072'))
  it('prop_chair      = tile_0073', () => assert.equal(SPRITES.prop_chair,      'tile_0073'))
  it('prop_anvil      = tile_0074', () => assert.equal(SPRITES.prop_anvil,      'tile_0074'))
  it('prop_barrel     = tile_0082', () => assert.equal(SPRITES.prop_barrel,     'tile_0082'))
  it('prop_gravestone = tile_0065', () => assert.equal(SPRITES.prop_gravestone, 'tile_0065'))
  it('prop_grave      = tile_0066', () => assert.equal(SPRITES.prop_grave,      'tile_0066'))
})
