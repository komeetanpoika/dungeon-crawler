// The PvP HUD strip: time left, your kills, the leader's kills (gold when
// the leader is you). The model is pure; the DOM is touched only inside
// updatePvpHud/hidePvpHud, and only when the markup changes.
import { PVP, BUFFS, BUFF_COLORS } from '../data/pvp.js'
import { SPRITES } from '../render/sprites.js'
import { BUFF_ICON } from '../render/pvp-fx.js'

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
  document.getElementById('pvp-buffs')?.remove()
}

// The local hero's buff row (2b spec §3): one icon per buff held, in slot
// order, each with a countdown ring (`frac`: the time left of its tier's
// full time) — no text. A major is rimmed in gold.
export function buffRowModel(hero) {
  const b = hero?.buffs
  if (!b || hero.dead) return []
  return ['haste', 'might', 'ward', 'edge'].filter(s => b[s]).map(s => {
    const kind = s === 'edge' ? b.edge.kind : s
    const { tier, t } = b[s]
    return { kind, tier, frac: Math.max(0, Math.min(1, t / BUFFS[kind][tier].dur)), color: BUFF_COLORS[kind],
      src: `./assets/tiles/${SPRITES[BUFF_ICON[kind]]}.png` }
  })
}

// The row sits under the time strip. The ring's angle is rounded to 10°,
// so the markup (and the DOM) changes a few times a second, not every frame.
export function updateBuffRow(row) {
  let node = document.getElementById('pvp-buffs')
  if (!node) {
    node = document.createElement('div')
    node.id = 'pvp-buffs'
    node.style.cssText = 'position:absolute;top:34px;left:50%;transform:translateX(-50%);display:flex;gap:6px;pointer-events:none'
    document.getElementById('hud-overlay').appendChild(node)
  }
  const html = row.map(b => {
    const deg = Math.round(b.frac * 36) * 10
    const rim = b.tier === 'major' ? '#facc15' : 'rgba(0,0,0,0.6)'
    return `<div style="width:30px;height:30px;border-radius:50%;padding:3px;box-sizing:border-box;border:2px solid ${rim};` +
      `background:conic-gradient(${b.color} ${deg}deg, rgba(15,23,42,0.75) 0)">` +
      `<img src="${b.src}" style="width:100%;height:100%;image-rendering:pixelated;display:block"></div>`
  }).join('')
  if (node._html === html) return
  node._html = html
  node.innerHTML = html
}
