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

export function updatePvpHud(m) {
  let node = document.getElementById('pvp-hud')
  if (!node) {
    node = document.createElement('div')
    node.id = 'pvp-hud'
    node.style.cssText = 'position:absolute;top:8px;left:50%;transform:translateX(-50%);display:flex;gap:18px;' +
      'font:bold 16px monospace;color:#e5e7eb;text-shadow:0 1px 2px #000'
    document.getElementById('hud-overlay').appendChild(node)
  }
  const html = `<span>${m.time}</span>` +
    `<span style="color:${m.leading ? '#facc15' : '#e5e7eb'}">${m.kills}</span>` +
    `<span style="opacity:0.6">${m.leaderKills}</span>` +
    (m.dead ? `<span style="color:#f87171">${m.respawnIn}</span>` : '')
  if (node._html === html) return
  node._html = html
  node.innerHTML = html
}

export function hidePvpHud() {
  document.getElementById('pvp-hud')?.remove()
}
