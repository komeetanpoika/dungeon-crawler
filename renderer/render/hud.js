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
  const rangedMode = player.attackMode === 'ranged'
  el('hud-weapon').textContent = (rangedMode ? '' : '▶ ') + (player.weapon
    ? `${player.weapon.name} (${player.weapon.damage} dmg)`
    : 'Unarmed')
  el('hud-ranged').textContent = (rangedMode ? '▶ ' : '') + (player.ranged
    ? `${player.ranged.name} ${player.ranged.ammo}/${player.ranged.maxAmmo}`
    : 'No ranged weapon')
  el('hud-items').textContent =
    player.inventory.length > 0 ? player.inventory.map(i => i.emoji).join(' ') : '—'
  el('hud-log').textContent = log?.at(-1) ?? ''
}
