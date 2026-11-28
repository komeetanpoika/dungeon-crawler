// The hero's picture. Each character is drawn from what it wears: a feet, a
// body and a head overlay laid on each other (data/hero-parts.js says which
// overlay each outfit and each worn piece shows; the overlays are 16x16
// tiles cut from the pack's own figures by tools/gear-art/build.mjs).
// Headwear takes the place of the outfit's hood or hat, armor of its coat or
// robe, boots of the feet; a ring is one pixel on the hand.
//
// The composed picture is made once per look and cached, so the hero stays
// one blit a frame (the canvas here is rastered in software: see
// render/tile-layer.js).
//
// An arena hero (one with a class, `cls`) is not dressed: it is the old whole
// figure of its class, as is any hero until the overlays have loaded.
import { OUTFIT_HEAD, OUTFIT_BODY, PIECE_HEAD, PIECE_BODY, PIECE_FEET, LONG_BODY, TOE_COLOUR, RING_AT } from '../data/hero-parts.js'
import { canWieldHeavy } from '../systems/inventory.js'

// The four whole figures the hero was before pieces showed: bare adventurer
// (or the knight, with the heavy gate open) in melee, the ranger in ranged,
// the wizard in magic.
export function playerSpriteKey(player, mode) {
  if (mode === 'ranged') return 'player_ranged'
  if (mode === 'magic') return 'player_magic'
  return canWieldHeavy(player) ? 'player_melee_heavy' : 'player_base'
}

const active = player => player.attackMode ?? 'melee'

// What `stance` shows: sprite keys for head and body, for the feet (null
// under a long body), and the two things too small for an overlay: `toes`
// ({ colour, at: [[x, y], ...] }, boots under a robe) and `ring`
// ({ colour, at: [x, y] }).
export function lookParts(player, stance = active(player)) {
  const g = player.gear?.[stance] ?? {}
  const outfit = g.outfit?.outfitType
  const head = PIECE_HEAD[g.head?.gearType] ?? OUTFIT_HEAD[outfit] ?? 'bare'
  const body = PIECE_BODY[g.armor?.gearType] ?? OUTFIT_BODY[outfit] ?? 'bare'
  const long = LONG_BODY[body] ?? null
  const boots = g.boots?.gearType
  return {
    head: `hero_head_${head}`,
    body: `hero_body_${body}`,
    feet: long ? null : `hero_feet_${PIECE_FEET[boots] ?? 'bare'}`,
    toes: long && TOE_COLOUR[boots] ? { colour: TOE_COLOUR[boots], at: long.toes } : null,
    ring: g.ring?.tint ? { colour: g.ring.tint, at: long?.ring ?? RING_AT } : null,
  }
}

const keyOf = l => [l.head, l.body, l.feet ?? '-', l.toes?.colour ?? '-', l.ring ? `${l.ring.colour}@${l.ring.at}` : '-'].join('|')
export const lookKey = (player, stance = active(player)) => keyOf(lookParts(player, stance))

const defaultCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h })
const made = new WeakMap()   // sprites -> Map(lookKey -> picture)

// The picture to draw for `stance`: something drawImage takes, 16x16, or null
// when not even the old figure has loaded.
export function heroPicture(player, stance, sprites, makeCanvas = defaultCanvas) {
  const whole = () => sprites[playerSpriteKey(player, stance)] ?? null
  if (player.cls) return whole()
  const look = lookParts(player, stance)
  let cache = made.get(sprites)
  if (!cache) made.set(sprites, cache = new Map())
  const key = keyOf(look)
  const had = cache.get(key)
  if (had) return had
  const layers = [look.feet, look.body, look.head].filter(Boolean).map(k => sprites[k])
  if (layers.some(l => !l)) return whole()
  const pic = makeCanvas(16, 16)
  const ctx = pic.getContext('2d')
  ctx.imageSmoothingEnabled = false
  for (const layer of layers) ctx.drawImage(layer, 0, 0)
  for (const dot of [...(look.toes?.at ?? []).map(at => ({ colour: look.toes.colour, at })), ...(look.ring ? [look.ring] : [])]) {
    ctx.fillStyle = dot.colour
    ctx.fillRect(dot.at[0], dot.at[1], 1, 1)
  }
  cache.set(key, pic)
  return pic
}

// The bag's portrait of the character being played: a data URL of its
// picture, or null (the caller keeps its own fallback).
export function heroPortrait(player, sprites, makeCanvas = defaultCanvas) {
  const pic = heroPicture(player, active(player), sprites, makeCanvas)
  return typeof pic?.toDataURL === 'function' ? pic.toDataURL() : pic?.src ?? null
}
