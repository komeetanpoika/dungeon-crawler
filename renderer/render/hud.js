import { quickUseSummary, findQuickUseIndex } from '../systems/inventory.js'
import { iconSrcFor } from './icons.js'

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
  const { player } = state
  if (!player) return
  const hearts = Math.ceil((player.maxHp ?? 10) / 2)
  el('hud-hearts').innerHTML = Array.from({ length: hearts }, (_, i) => {
    const hpForHeart = Math.max(0, Math.min(2, player.hp - i * 2))
    return heart(hpForHeart === 2 ? 'full' : hpForHeart === 1 ? 'half' : 'empty')
  }).join('')
  const quick = quickUseSummary(player.inventory)
  const consumableEl = el('hud-consumable')
  if (quick) {
    const item = player.inventory[findQuickUseIndex(player.inventory)]
    const src = iconSrcFor(item)
    consumableEl.innerHTML = (src ? `<img class="hud-icon" src="${src}" alt="">` : item.emoji)
      + `<span class="hud-count">×${quick.count}</span>`
  } else consumableEl.innerHTML = ''
  consumableEl.dataset.quickEmoji = quick?.emoji ?? ''
  const staminaEl = el('hud-stamina')
  el('hud-stamina-fill').style.width =
    `${Math.round(100 * (player.stamina ?? 0) / (player.maxStamina ?? 100))}%`
  staminaEl.dataset.refused = (player.staminaRefusedT ?? 0) > 0 ? '1' : ''
}
