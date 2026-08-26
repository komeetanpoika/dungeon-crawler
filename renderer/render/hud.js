import { quickUseSummary } from '../systems/inventory.js'

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
  const rangedEl = el('hud-ranged')
  const magicEl = el('hud-magic')
  rangedEl.textContent = (mode === 'ranged' ? '▶ ' : '') + (player.ranged
    ? `${player.ranged.name} (${player.ranged.damage} dmg) ${player.ranged.ammo}/${player.ranged.maxAmmo}`
    : 'No ranged weapon')
  magicEl.textContent = (mode === 'magic' ? '▶ ' : '') +
    `Gust ${'✦'.repeat(player.mana ?? 0)}${'✧'.repeat(Math.max(0, 4 - (player.mana ?? 0)))}`
  const talents = player.talents ?? []
  rangedEl.style.display = talents.includes('ranged_stance') ? '' : 'none'
  magicEl.style.display = talents.includes('magic_stance') ? '' : 'none'
  const itemsEl = el('hud-items')
  itemsEl.textContent =
    player.inventory.length > 0 ? player.inventory.map(i => i.emoji).join(' ') : '—'
  // Quick-use badge for the mobile touch layer: it mirrors HUD state from
  // the DOM rather than reaching into game state.
  const quick = quickUseSummary(player.inventory)
  itemsEl.dataset.quickEmoji = quick?.emoji ?? ''
  itemsEl.dataset.quickCount = quick ? String(quick.count) : ''
  el('hud-log').textContent = log?.at(-1) ?? ''
}
