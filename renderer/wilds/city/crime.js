// Kalevanlinna's law in numbers: what the player's violence inside the walls
// costs them. Pure: a crime record in, a decision out. wilds/city/law.js acts
// on the decisions in the town; the record lives on state.cityRun.crime and is
// never saved, so a load or a wake starts calm.
//
//   crime = { level: 'calm' | 'warned' | 'wanted' | 'stocks', t, away }
//     warned  t: seconds the warning still stands
//     wanted  away: seconds spent outside the walls since the last time inside
//     stocks  t: seconds left in the stocks
export const CRIME = { warnSeconds: 60, maxHostile: 6, leashTiles: 10, clearAwaySeconds: 120, stocksSeconds: 60 }

export const CRIME_LINES = {
  warn: 'Put that away!',
  wanted: 'Seize them!',
  freed: 'Off you go. Mind your manners.',
}

// s: the screen fades to black and back when the watch takes the player; at
// its darkest they are put in the stocks (game.js runs it, canvas.js draws it)
export const ARREST_FADE = 1.6

export const makeCrime = () => ({ level: 'calm', t: 0, away: 0 })

function calm(crime) {
  crime.level = 'calm'; crime.t = 0; crime.away = 0
}

// A blow from the player on one of the city's people inside the walls. The
// first is a warning; a second while it stands, or any killing blow, makes
// the player wanted. More while wanted changes nothing but the count of time
// away (the player is plainly not away). Nothing in the stocks.
export function onViolence(crime, { killed = false } = {}) {
  if (crime.level === 'stocks') return null
  if (crime.level === 'wanted') { crime.away = 0; return null }
  if (crime.level === 'calm' && !killed) {
    crime.level = 'warned'; crime.t = CRIME.warnSeconds
    return 'warn'
  }
  crime.level = 'wanted'; crime.t = 0; crime.away = 0
  return 'wanted'
}

// Once a frame (and once for the time spent with the city out of the window).
// A warning runs out; the wanted clears after clearAwaySeconds outside the
// walls in one stretch (stepping back inside starts the count again); the
// stocks run out. Each returns 'cleared' as the record comes back to calm.
// The watch's leash is not the record's business: law.js turns the hunters
// back, while the count is the player's time outside the walls.
export function tickCrime(crime, delta, { inside = false } = {}) {
  if (crime.level === 'warned' || crime.level === 'stocks') {
    crime.t -= delta
    if (crime.t > 0) return null
    calm(crime)
    return 'cleared'
  }
  if (crime.level === 'wanted') {
    crime.away = inside ? 0 : crime.away + delta
    if (crime.away < CRIME.clearAwaySeconds) return null
    calm(crime)
    return 'cleared'
  }
  return null
}

// Does a blow from `from` spare the player's life? The watch takes a wanted
// player alive (damagePlayer leaves them 1 hp and calls the arrest).
export const spares = (crime, from) => crime?.level === 'wanted' && from?.species === 'watchman'

// How dark the arrest's fade is (0..1) at player.stocks.fade seconds.
export function arrestFade(stocks) {
  if (!stocks || !(stocks.fade < ARREST_FADE)) return 0
  const half = ARREST_FADE / 2
  return stocks.fade < half ? stocks.fade / half : 1 - (stocks.fade - half) / half
}
