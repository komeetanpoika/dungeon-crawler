import { quickUseSummary } from '../systems/inventory.js'

function el(id) { return document.getElementById(id) }

// One pixel heart as inline SVG; state maps to which halves are filled.
const HEART_PATH = 'M1 1h2v1h1V1h2v3h-1v1h-1v1h-1V5H2V4H1z'   // 7x7 blocky heart
function heart(state) {
  const fills = { full: ['#ef4444', '#ef4444'], half: ['#ef4444', '#3a3a44'], empty: ['#3a3a44', '#3a3a44'] }
  const [left, right] = fills[state]
  return `<svg class="heart" data-state="${state}" viewBox="0 0 7 7" width="14" height="14">`
    + `<clipPath id="hl"><rect x="0" y="0" width="3.5" height="7"/></clipPath>`
    + `<path d="${HEART_PATH}" fill="${right}"/>`
    + `<path d="${HEART_PATH}" fill="${left}" clip-path="url(#hl)"/></svg>`
}

export function updateHUD(state) {
  const { player, level, log } = state
  if (!player) return
  el('hud-level').textContent = `LVL ${level}`
  const hearts = Math.ceil((player.maxHp ?? 10) / 2)
  el('hud-hearts').innerHTML = Array.from({ length: hearts }, (_, i) => {
    const hpForHeart = Math.max(0, Math.min(2, player.hp - i * 2))
    return heart(hpForHeart === 2 ? 'full' : hpForHeart === 1 ? 'half' : 'empty')
  }).join('')
  const mode = player.attackMode
  el('hud-weapon-slot').textContent =
    mode === 'magic' ? 'Gust'
    : mode === 'ranged' ? (player.ranged ? `${player.ranged.name} ${player.ranged.ammo}/${player.ranged.maxAmmo}` : 'No ranged weapon')
    : (player.weapon ? `${player.weapon.name} (${player.weapon.damage} dmg)` : 'Unarmed')
  const quick = quickUseSummary(player.inventory)
  const consumableEl = el('hud-consumable')
  consumableEl.textContent = quick ? `${quick.emoji}×${quick.count}` : '—'
  consumableEl.dataset.quickEmoji = quick?.emoji ?? ''
  const staminaEl = el('hud-stamina')
  el('hud-stamina-fill').style.width =
    `${Math.round(100 * (player.stamina ?? 0) / (player.maxStamina ?? 100))}%`
  staminaEl.dataset.refused = (player.staminaRefusedT ?? 0) > 0 ? '1' : ''
  el('hud-log').textContent = log?.at(-1) ?? ''
}
