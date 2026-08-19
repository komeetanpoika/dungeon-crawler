function bar(value, max, length = 6) {
  if (!max) return '░'.repeat(length)
  const filled = Math.round(Math.max(0, Math.min(1, value / max)) * length)
  return '█'.repeat(filled) + '░'.repeat(length - filled)
}

function el(id) { return document.getElementById(id) }

export function updateHUD(state) {
  const { player, level, log } = state
  if (!player) return
  el('hud-level').textContent = `LVL ${level}`
  el('hud-hp-bar').textContent = bar(player.hp, player.maxHp)
  const mode = player.attackMode
  el('hud-weapon').textContent = (mode === 'melee' ? '▶ ' : '') + (player.weapon
    ? `${player.weapon.name} (${player.weapon.damage} dmg)`
    : 'Unarmed')
  el('hud-ranged').textContent = (mode === 'ranged' ? '▶ ' : '') + (player.ranged
    ? `${player.ranged.name} (${player.ranged.damage} dmg) ${player.ranged.ammo}/${player.ranged.maxAmmo}`
    : 'No ranged weapon')
  el('hud-magic').textContent = (mode === 'magic' ? '▶ ' : '') +
    `Gust ${'✦'.repeat(player.mana ?? 0)}${'✧'.repeat(Math.max(0, 4 - (player.mana ?? 0)))}`
  el('hud-items').textContent =
    player.inventory.length > 0 ? player.inventory.map(i => i.emoji).join(' ') : '—'
  el('hud-log').textContent = log?.at(-1) ?? ''
}
