import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { LOOKS, NAMED_LOOKS, WATCH_LOOKS, ANIMAL_LOOKS, FLOCK_SKINS, TOWNSFOLK_SKINS } from '../renderer/data/townsfolk-looks.js'
import { spriteKeyFor } from '../renderer/systems/npc.js'
import { STRIDE, STILL_AFTER } from '../renderer/systems/npc-anim.js'
import { WILDS_SKINS } from '../renderer/wilds/terrain.js'
import { readPng } from '../tools/png-read.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const TILES = `${ROOT}renderer/assets/tiles/`
const PEOPLE = [...LOOKS, ...Object.values(NAMED_LOOKS), ...WATCH_LOOKS]
const ANIMALS = Object.values(ANIMAL_LOOKS).flat()
const frames = l => [`tf_${l.id}`, `tf_${l.id}_step`]
const pixels = name => readPng(`${TILES}${name}.png`)
const differ = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) n++; return n }

test('every look has both frames', () => {
  for (const l of [...PEOPLE, ...ANIMALS]) for (const f of frames(l)) assert.ok(fs.existsSync(`${TILES}${f}.png`), f)
})

test('there are enough different people', () => {
  assert.ok(LOOKS.filter(l => l.age === 'adult').length >= 36)
  assert.ok(LOOKS.filter(l => l.age === 'child').length >= 8)
  assert.ok(LOOKS.filter(l => l.age === 'elder').length >= 8)
  for (const l of LOOKS) assert.ok(['child', 'adult', 'elder'].includes(l.age), l.id)
})

test('the named characters, the watch and the animals are all there', () => {
  assert.deepEqual(Object.keys(NAMED_LOOKS).sort(), ['captain', 'count', 'crier', 'innkeeper', 'pohjanen', 'seppo', 'vaino', 'vicar'])
  assert.ok(WATCH_LOOKS.length >= 2)
  assert.ok(ANIMAL_LOOKS.dog.length >= 3)
  assert.ok(ANIMAL_LOOKS.cat.length >= 3)
  assert.equal(ANIMAL_LOOKS.horse.length, 1)
  for (const n of ['tf_pigeon_a', 'tf_pigeon_b', 'tf_gull_a', 'tf_gull_b']) {
    assert.ok(FLOCK_SKINS.includes(n), n)
    assert.ok(fs.existsSync(`${TILES}${n}.png`), n)
  }
})

test('look ids are unique and no tile name ends in _d', () => {
  const ids = [...PEOPLE, ...ANIMALS].map(l => l.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(TOWNSFOLK_SKINS.some(n => /_d$/.test(n)), false)
})

test('TOWNSFOLK_SKINS is every frame and flock sprite, once each, all tf_*', () => {
  const want = [...[...PEOPLE, ...ANIMALS].flatMap(frames), ...FLOCK_SKINS]
  assert.deepEqual([...TOWNSFOLK_SKINS].sort(), [...want].sort())
  assert.equal(new Set(TOWNSFOLK_SKINS).size, TOWNSFOLK_SKINS.length)
  for (const n of TOWNSFOLK_SKINS) assert.match(n, /^tf_[a-z0-9_]+$/)
})

test('the townsfolk are loaded when the Wilds are entered', () => {
  const loaded = new Set(WILDS_SKINS)
  for (const n of TOWNSFOLK_SKINS) assert.ok(loaded.has(n), `${n} is not in WILDS_SKINS`)
})

test('every frame is a 16x16 sprite on a see-through ground, and the step moves something', () => {
  for (const l of [...PEOPLE, ...ANIMALS]) {
    const [a, b] = frames(l).map(pixels)
    for (const [p, n] of [[a, frames(l)[0]], [b, frames(l)[1]]]) {
      assert.equal(p.width, 16, n); assert.equal(p.height, 16, n)
      assert.equal(p.pixels[3], 0, `${n}: top-left corner is not see-through`)
    }
    assert.ok(differ(a.pixels, b.pixels) >= 2, `${l.id}: the step frame is the standing frame`)
  }
})

test('no two people look alike', () => {
  const art = PEOPLE.map(l => [l.id, pixels(`tf_${l.id}`).pixels])
  for (let i = 0; i < art.length; i++) for (let j = i + 1; j < art.length; j++)
    assert.ok(differ(art[i][1], art[j][1]) >= 6, `${art[i][0]} and ${art[j][0]} are nearly the same`)
})

test('a townsperson draws with its look, stepping as it walks', () => {
  const tf = anim => spriteKeyFor({ type: 'npc', species: 'townsfolk', look: 'a07', anim })
  assert.equal(tf({ dist: 0, still: 0 }), 'tf_a07')
  assert.equal(tf({ dist: STRIDE.walk, still: 0 }), 'tf_a07_step')
  assert.equal(tf({ dist: 2 * STRIDE.walk, still: 0 }), 'tf_a07')
  assert.equal(tf({ dist: STRIDE.walk, still: STILL_AFTER }), 'tf_a07', 'standing still: both feet down')
  assert.equal(tf(undefined), 'tf_a07')
})

test('an animal draws with its look the same way; species without a look are unchanged', () => {
  assert.equal(spriteKeyFor({ type: 'npc', species: 'dog', look: 'dog_1', anim: { dist: 8, still: 0 } }), 'tf_dog_1_step')
  assert.equal(spriteKeyFor({ type: 'npc', species: 'deer', anim: { dist: 8, still: 0 } }), 'npc_deer')
  assert.equal(spriteKeyFor({ type: 'npc', species: 'villager', id: 'npc:m:1', anim: { dist: 8, still: 0 } }), 'npc_villager_2')
})

test('the generator draws the same files again', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'townsfolk-'))
  try {
    execFileSync(process.execPath, [`${ROOT}tools/city/make-townsfolk.mjs`, '--out', out], { stdio: 'pipe' })
    for (const n of TOWNSFOLK_SKINS) assert.ok(fs.readFileSync(`${out}/${n}.png`).equals(fs.readFileSync(`${TILES}${n}.png`)), `${n} differs from a fresh draw`)
    assert.equal(fs.readFileSync(`${out}/townsfolk-looks.js`, 'utf8'), fs.readFileSync(`${ROOT}renderer/data/townsfolk-looks.js`, 'utf8'))
  } finally { fs.rmSync(out, { recursive: true, force: true }) }
})
