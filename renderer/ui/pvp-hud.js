// The PvP HUD strip: time left, your kills, the leader's kills (gold when
// the leader is you). The model is pure; the DOM is touched only inside
// updatePvpHud/hidePvpHud, and only when the markup changes.
import { PVP } from '../data/pvp.js'

export function pvpHudModel(match, localId) {
  const me = match.heroes.find(h => h.id === localId)
  const leader = [...match.heroes].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0]
  const left = Math.max(0, PVP.matchLength - match.clock)
  return {
    time: `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`,
    kills: me.kills, leaderKills: leader.kills, leading: leader === me,
    dead: me.dead, respawnIn: me.dead ? Math.ceil(me.respawnT) : 0,
  }
}

// The death picker's live subtitle, from the local hero's respawnT. A hero
// not (yet) counting down — the frame the kill event lands, before its
// first dead snapshot — reads as the full PVP.respawnDelay.
export const respawnLine = respawnT => `Back in ${Math.ceil(respawnT > 0 ? respawnT : PVP.respawnDelay)}`

// The online counterpart to pvpHudModel: reads a net/client sessionView
// instead of a local match, and adds the room code and round-trip ping.
export function netHudModel(v, heroId) {
  const all = [v.me, ...v.others]
  const leader = [...all].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0]
  const left = Math.max(0, (v.matchLength ?? PVP.matchLength) - v.clock)
  return {
    room: v.room,
    time: v.waiting ? '--:--' : `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`,
    kills: v.me.kills, leaderKills: leader.kills, leading: leader.id === heroId,
    dead: v.me.dead, respawnIn: v.me.dead ? Math.ceil(v.me.respawnT) : 0,
    ping: v.ping === null || v.ping === undefined ? null : Math.round(v.ping),
  }
}

export function updatePvpHud(m) {
  let node = document.getElementById('pvp-hud')
  if (!node) {
    node = document.createElement('div')
    node.id = 'pvp-hud'
    node.style.cssText = 'position:absolute;top:8px;left:50%;transform:translateX(-50%);display:flex;gap:18px;' +
      'font:bold 16px monospace;color:#e5e7eb;text-shadow:0 1px 2px #000'
    document.getElementById('hud-overlay').appendChild(node)
  }
  const html = (m.room ? `<span>${m.room}</span>` : '') +
    `<span>${m.time}</span>` +
    `<span style="color:${m.leading ? '#facc15' : '#e5e7eb'}">${m.kills}</span>` +
    `<span style="opacity:0.6">${m.leaderKills}</span>` +
    (m.dead ? `<span style="color:#f87171">${m.respawnIn}</span>` : '') +
    (m.ping !== null && m.ping !== undefined ? `<span style="opacity:0.5;font-size:12px">${m.ping}ms</span>` : '')
  if (node._html === html) return
  node._html = html
  node.innerHTML = html
}

export function hidePvpHud() {
  document.getElementById('pvp-hud')?.remove()
}
