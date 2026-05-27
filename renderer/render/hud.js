function bar(value, max, length = 6) {
  if (!max) return '░'.repeat(length)
  const filled = Math.round(Math.max(0, Math.min(1, value / max)) * length)
  return '█'.repeat(filled) + '░'.repeat(length - filled)
}

function el(id) { return document.getElementById(id) }

export function updateHUD(state) {
  const { player, level, log, noiseMap } = state
  if (!player) return
  el('hud-level').textContent = `LVL ${level}`
  el('hud-hp-bar').textContent = bar(player.hp, player.maxHp)
  const noise = noiseMap?.[`${player.x},${player.y}`] ?? 0
  el('hud-noise-bar').textContent = bar(noise, 10)
  el('hud-weapon').textContent = player.weapon
    ? `${player.weapon.name} (${player.weapon.damage} dmg)`
    : 'Unarmed'
  el('hud-items').textContent =
    player.inventory.length > 0 ? player.inventory.map(i => i.emoji).join(' ') : '—'
  el('hud-log').textContent = log?.at(-1) ?? ''
}

export function showDragonMeter(dragon) {
  let hudEl = el('hud-dragon')
  if (!hudEl) {
    const top = el('hud-top')
    if (!top) return
    hudEl = document.createElement('span')
    hudEl.id = 'hud-dragon'
    top.appendChild(hudEl)
  }
  hudEl.textContent = `🐉 ${bar(dragon.sleepMeter, 100)}`
  hudEl.style.color = dragon.sleepMeter > 60 ? '#f87171' : '#888'
}

export function hideDragonMeter() {
  el('hud-dragon')?.remove()
}
