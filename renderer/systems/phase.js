// Game phase state machine. Pure: no DOM, no game state.
export const PHASE = {
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAMEOVER: 'gameover',
}

const ALLOWED = {
  title:    ['playing'],
  playing:  ['paused', 'gameover'],
  paused:   ['playing', 'title'],
  gameover: ['playing', 'title'],
}

export function canTransition(from, to) {
  return (ALLOWED[from] ?? []).includes(to)
}
