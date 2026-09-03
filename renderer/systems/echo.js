// The Echo — the spectral guide only the player sees. One per leap map, it
// trails a tile behind the player, invisible until the player nears an
// echo spot (a POI with something to say right now), fades in, speaks the
// spot's current line once, and fades out as the player leaves. Pure.
import { poiCell, echoLine } from './leap.js'
import { speakFrom } from './feedback.js'
import { sfx } from './sfx.js'
import { stepFade } from './fade.js'

const S = 32
export const ECHO_RANGE = 5 * S
export const ECHO_TRAIL_DT = 0.08
export const ECHO_TRAIL_LEN = 3
const BEHIND = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] }

export function echoTarget(player) {
  const [dx, dy] = BEHIND[player.facing] ?? [0, 1]
  return { px: player.px + dx * S, py: player.py + dy * S - 6 }
}

// Nearest echo spot within ECHO_RANGE of (px, py) whose line ladder yields
// a text right now; null when there is nothing to say nearby.
export function activeSpot(episode, mapData, flags, ctx, px, py) {
  let best = null
  ;(episode?.echoSpots ?? []).forEach((s, i) => {
    const c = poiCell(mapData, s.fromPoi)
    if (!c) return
    const d = Math.hypot(c.x * S + S / 2 - px, c.y * S + S / 2 - py)
    if (d > ECHO_RANGE || (best && d >= best.d)) return
    const text = echoLine(episode, i, flags, ctx)
    if (text) best = { i, text, d }
  })
  return best
}

export function updateEcho(echo, state, { episode, mapData, flags, ctx }, delta) {
  const { player } = state
  echo.t = (echo.t ?? 0) + delta
  const tgt = echoTarget(player)
  const k = Math.min(1, 6 * delta)
  echo.px += (tgt.px - echo.px) * k
  echo.py += (tgt.py - echo.py) * k
  echo.x = Math.floor(echo.px / S)
  echo.y = Math.floor(echo.py / S)
  echo.trailT = (echo.trailT ?? 0) + delta
  if (echo.trailT >= ECHO_TRAIL_DT) {
    echo.trailT = 0
    echo.trail = [{ px: echo.px, py: echo.py }, ...(echo.trail ?? [])].slice(0, ECHO_TRAIL_LEN)
  }
  const spot = activeSpot(episode, mapData, flags, ctx, player.px, player.py)
  stepFade(echo, spot ? 1 : 0, delta, { inTime: 0.5, outTime: 0.8 })
  if (!spot) { echo.said = null; return }
  const key = `${spot.i}:${spot.text}`
  if (echo.said === key) return
  echo.said = key
  speakFrom(state, echo, spot.text)
  sfx(state, 'echo', { px: echo.px, py: echo.py })
}
