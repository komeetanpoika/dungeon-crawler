// The hero's picture: which head, body and feet a character shows for what
// it wears, and the one composed picture that is drawn each frame.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { lookParts, lookKey, heroPicture, heroPortrait, playerSpriteKey } from '../renderer/render/hero-look.js'
import { makePlayer, makeWornContents } from '../renderer/systems/entities.js'
import { makeHero } from '../renderer/pvp/hero.js'
import { HERO_PART_TILES } from '../renderer/data/hero-parts.js'
import { gearWearing } from './helpers/outfits.js'

const worn = key => { const { type, ...p } = makeWornContents(key); return p }
// a hero in `outfits`, with `sets`: { melee: ['helm', 'plate'], magic: ['elk'] }
function hero(outfits = [], sets = {}, over = {}) {
  const p = { ...makePlayer(1, 1), gear: gearWearing(...outfits), ...over }
  for (const [stance, keys] of Object.entries(sets)) for (const key of keys) p.gear[stance][makeWornContents(key).type] = worn(key)
  return p
}
const shows = (p, stance) => { const l = lookParts(p, stance); return [l.head, l.body, l.feet] }

describe('lookParts: what a character shows', () => {
  it('the Warrior with nothing on is the bare adventurer', () => {
    assert.deepEqual(lookParts(hero()), { head: 'hero_head_bare', body: 'hero_body_bare', feet: 'hero_feet_bare', toes: null, ring: null })
  })
  it('an outfit dresses its character: the tabard, the hood and coat, the hat and robe', () => {
    const p = hero(['plate', 'ranger', 'robe'])
    assert.deepEqual(shows(p, 'melee'), ['hero_head_bare', 'hero_body_tabard', 'hero_feet_bare'])
    assert.deepEqual(shows(p, 'ranged'), ['hero_head_hood', 'hero_body_coat', 'hero_feet_bare'])
    assert.deepEqual(shows(p, 'magic'), ['hero_head_hat', 'hero_body_robe', null])
  })
  it('headwear takes the place of the hood or hat, armor of the coat or robe, boots of the feet', () => {
    const p = hero(['plate', 'ranger', 'robe'], { melee: ['helm', 'plate', 'ironshod'], ranged: ['cap', 'chain', 'elk'], magic: ['horned', 'leather', 'wayfarer'] })
    assert.deepEqual(shows(p, 'melee'), ['hero_head_helm', 'hero_body_plate', 'hero_feet_ironshod'])
    assert.deepEqual(shows(p, 'ranged'), ['hero_head_cap', 'hero_body_chain', 'hero_feet_elk'])
    assert.deepEqual(shows(p, 'magic'), ['hero_head_horned', 'hero_body_leather', 'hero_feet_wayfarer'])
  })
  it('one piece changes one zone and leaves the outfit showing in the others', () => {
    assert.deepEqual(shows(hero(['ranger'], { ranged: ['chain'] }), 'ranged'), ['hero_head_hood', 'hero_body_chain', 'hero_feet_bare'])
    assert.deepEqual(shows(hero(['robe'], { magic: ['plate'] }), 'magic'), ['hero_head_hat', 'hero_body_plate', 'hero_feet_bare'])
    assert.deepEqual(shows(hero(['robe'], { magic: ['cloth'] }), 'magic'), ['hero_head_cloth', 'hero_body_robe', null])
  })
  it('is each character\'s own: what the Warrior wears is not on the Mage', () => {
    const p = hero(['robe'], { melee: ['helm', 'plate', 'elk'] })
    assert.deepEqual(shows(p, 'magic'), ['hero_head_hat', 'hero_body_robe', null])
    assert.deepEqual(shows(p), ['hero_head_helm', 'hero_body_plate', 'hero_feet_elk'])   // the one being played, by default
  })
  it('the robe reaches the ground: boots under it are two toes at the hem', () => {
    const l = lookParts(hero(['robe'], { magic: ['elk'] }), 'magic')
    assert.equal(l.feet, null)
    assert.deepEqual(l.toes, { colour: '#f4f1e6', at: [[4, 15], [10, 15]] })
    assert.equal(lookParts(hero(['robe']), 'magic').toes, null)
    assert.equal(lookParts(hero([], { melee: ['elk'] })).toes, null, 'on ordinary legs the boots are the feet')
  })
  it('a ring is one pixel on the hand, in its own colour; higher on the robe\'s sleeve', () => {
    assert.deepEqual(lookParts(hero([], { melee: ['miser'] })).ring, { colour: '#facc15', at: [13, 13] })
    assert.deepEqual(lookParts(hero(['robe'], { magic: ['breath'] }), 'magic').ring, { colour: '#7dd3fc', at: [13, 12] })
  })
  it('every part it can name is a tile the art tool makes', () => {
    const all = new Set(HERO_PART_TILES)
    const p = hero(['plate', 'ranger', 'robe'])
    for (const stance of ['melee', 'ranged', 'magic'])
      for (const head of [null, 'cap', 'helm', 'horned', 'cloth']) for (const armor of [null, 'leather', 'chain', 'plate']) for (const boots of [null, 'elk', 'ironshod', 'wayfarer']) {
        Object.assign(p.gear[stance], { head: head && worn(head), armor: armor && worn(armor), boots: boots && worn(boots) })
        for (const part of shows(p, stance)) if (part) assert.ok(all.has(part), part)
      }
  })
  it('a hero with no gear record is the bare adventurer', () => {
    assert.deepEqual(shows({ hp: 1 }), ['hero_head_bare', 'hero_body_bare', 'hero_feet_bare'])
  })
})

describe('lookKey', () => {
  it('is the same for the same look and differs when any piece differs', () => {
    const a = hero(['plate'], { melee: ['helm'] }), b = hero(['plate'], { melee: ['helm'] })
    assert.equal(lookKey(a), lookKey(b))
    const keys = new Set([lookKey(a)])
    for (const key of ['cap', 'plate', 'elk', 'miser', 'smith']) {
      const c = hero(['plate'], { melee: ['helm'] })
      c.gear.melee[makeWornContents(key).type] = worn(key)
      keys.add(lookKey(c))
    }
    assert.equal(keys.size, 6)
    assert.notEqual(lookKey(hero(['robe'], { magic: ['elk'] }), 'magic'), lookKey(hero(['robe'], { magic: ['wayfarer'] }), 'magic'))
  })
})

// a canvas that records what is drawn on it
function fakeCanvas() {
  const made = []
  const make = (w, h) => {
    const c = { width: w, height: h, ops: [], getContext: () => ({
      set fillStyle(v) { c.fill = v }, set imageSmoothingEnabled(v) {},
      drawImage: (img, x, y) => c.ops.push(['img', img, x, y]),
      fillRect: (x, y, w2, h2) => c.ops.push(['px', c.fill, x, y, w2, h2]),
    }) }
    made.push(c)
    return c
  }
  return { make, made }
}
const allSprites = () => Object.fromEntries([...HERO_PART_TILES, 'player_base', 'player_melee_heavy', 'player_ranged', 'player_magic'].map(k => [k, `<${k}>`]))

describe('heroPicture', () => {
  it('lays feet, body and head on one 16x16 picture, in that order', () => {
    const { make, made } = fakeCanvas()
    const pic = heroPicture(hero(['plate'], { melee: ['helm', 'chain', 'elk'] }), 'melee', allSprites(), make)
    assert.ok(pic === made[0])
    assert.deepEqual([pic.width, pic.height], [16, 16])
    assert.deepEqual(pic.ops, [['img', '<hero_feet_elk>', 0, 0], ['img', '<hero_body_chain>', 0, 0], ['img', '<hero_head_helm>', 0, 0]])
  })
  it('adds the toes under a robe and the ring\'s pixel', () => {
    const { make } = fakeCanvas()
    const pic = heroPicture(hero(['robe'], { magic: ['elk', 'miser'] }), 'magic', allSprites(), make)
    assert.deepEqual(pic.ops, [
      ['img', '<hero_body_robe>', 0, 0], ['img', '<hero_head_hat>', 0, 0],
      ['px', '#f4f1e6', 4, 15, 1, 1], ['px', '#f4f1e6', 10, 15, 1, 1], ['px', '#facc15', 13, 12, 1, 1],
    ])
  })
  it('is made once for a look and handed back after that', () => {
    const { make, made } = fakeCanvas()
    const sprites = allSprites()
    const a = heroPicture(hero(['ranger']), 'ranged', sprites, make)
    const b = heroPicture(hero(['ranger']), 'ranged', sprites, make)
    assert.ok(a === b)
    assert.equal(made.length, 1)
    heroPicture(hero(['ranger'], { ranged: ['cap'] }), 'ranged', sprites, make)
    assert.equal(made.length, 2)
  })
  it('an arena hero is the old whole figure of its class', () => {
    const { make, made } = fakeCanvas()
    const sprites = allSprites()
    assert.equal(heroPicture(makeHero({ id: 'w', name: 'W', cls: 'warrior' }), 'melee', sprites, make), '<player_melee_heavy>')
    assert.equal(heroPicture(makeHero({ id: 'a', name: 'A', cls: 'archer' }), 'ranged', sprites, make), '<player_ranged>')
    assert.equal(heroPicture(makeHero({ id: 'm', name: 'M', cls: 'mage' }), 'magic', sprites, make), '<player_magic>')
    assert.equal(made.length, 0)
  })
  it('before the overlays are loaded, falls back to the old figure and caches nothing', () => {
    const { make, made } = fakeCanvas()
    const sprites = { player_base: '<player_base>' }
    assert.equal(heroPicture(hero(), 'melee', sprites, make), '<player_base>')
    assert.equal(made.length, 0)
    Object.assign(sprites, allSprites())
    assert.ok(heroPicture(hero(), 'melee', sprites, make) === made[0])
  })
  it('the bag\'s portrait is the picture of the character being played, as a data URL', () => {
    const make = (w, h) => ({ width: w, height: h, layers: [], toDataURL() { return `data:${this.layers.join('+')}` },
      getContext() { const c = this; return { drawImage: img => c.layers.push(img), fillRect: () => {}, set fillStyle(_v) {}, set imageSmoothingEnabled(_v) {} } } })
    const p = hero(['plate', 'ranger'], { ranged: ['cap'] }, { attackMode: 'ranged' })
    assert.equal(heroPortrait(p, allSprites(), make), 'data:<hero_feet_bare>+<hero_body_coat>+<hero_head_cap>')
    // before the overlays load it is the old figure's own file, or nothing
    assert.equal(heroPortrait(hero(), { player_base: { src: './assets/tiles/tile_0088.png' } }, make), './assets/tiles/tile_0088.png')
    assert.equal(heroPortrait(hero(), {}, make), null)
  })
  it('playerSpriteKey still names the four old figures', () => {
    assert.equal(playerSpriteKey(hero(), 'melee'), 'player_base')
    assert.equal(playerSpriteKey(hero(['plate']), 'melee'), 'player_melee_heavy')
    assert.equal(playerSpriteKey(hero(), 'ranged'), 'player_ranged')
    assert.equal(playerSpriteKey(hero(), 'magic'), 'player_magic')
  })
})
