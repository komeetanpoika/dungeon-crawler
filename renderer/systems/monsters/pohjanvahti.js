// Pohjan vahti, the watch Louhi set over the Sampo's grindstone at the copper
// mountain, where she locked the sun and moon away (wilds/city/sampo-places.js).
// It is made of that dark: a blow passes through it unless it stands in the
// light of a fire (a lit brazier, a campfire, burning ground). The brain
// moves it and its claw is an ordinary weapon; only the hit is its own.
// Pure: no browser imports.
import { CREATURE_HIT } from '../creatures.js'
import { lightSources } from '../weather.js'

const S = 32
export const DARK_THOUGHT = 'The blow goes through it like smoke. It is made of the dark. It wants light.'
export const inLight = (e, state) => lightSources(state).some(l => l.strength > 0.25 && Math.hypot(e.px - l.px, e.py - l.py) <= l.r * S)

CREATURE_HIT.pohjanvahti = (e, state, dmg) => {
  if (inLight(e, state)) return { entity: { ...e, hp: e.hp - dmg, inCombat: true }, absorbed: false, cue: 'melee-hit' }
  const first = !e.toldDark
  e.toldDark = true
  return { entity: e, absorbed: true, cue: 'wall-slam', ...(first && { think: DARK_THOUGHT }) }
}
