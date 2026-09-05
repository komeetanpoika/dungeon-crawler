import { quickUseSummary, findQuickUseIndex } from '../systems/inventory.js'
import { iconSrcFor } from './icons.js'
import { spellFor } from '../systems/spells.js'

function el(id) { return document.getElementById(id) }

// updateHUD runs every frame; setting innerHTML re-parses the markup and
// re-lays out the overlay even when nothing changed, so each slot remembers
// the markup it last wrote and only touches the DOM on a difference.
function setHTML(node, html) {
  if (node._hudHtml === html) return
  node._hudHtml = html
  node.innerHTML = html
}

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
  setHTML(el('hud-hearts'), Array.from({ length: hearts }, (_, i) => {
    const hpForHeart = Math.max(0, Math.min(2, player.hp - i * 2))
    return heart(hpForHeart === 2 ? 'full' : hpForHeart === 1 ? 'half' : 'empty')
  }).join(''))
  const quick = quickUseSummary(player.inventory)
  const consumableEl = el('hud-consumable')
  if (quick) {
    const item = player.inventory[findQuickUseIndex(player.inventory)]
    const src = iconSrcFor(item)
    setHTML(consumableEl, (src ? `<img class="hud-icon" src="${src}" alt="">` : item.emoji)
      + `<span class="hud-count">×${quick.count}</span>`)
  } else {
    // No consumables in the sack: keep the icon visible but dimmed rather
    // than vanishing the slot (spec §3), still with no count badge.
    const emptySrc = iconSrcFor({ kind: 'potion' })
    setHTML(consumableEl, emptySrc ? `<img class="hud-icon hud-icon-empty" src="${emptySrc}" alt="">` : '')
  }
  consumableEl.dataset.quickEmoji = quick?.emoji ?? ''
  // Tool slot: which hand it shows follows the stance, not what's merely
  // carried — magic stance shows the wand hand, ranged/melee show the bow
  // hand. Hidden when that hand is empty; dimmed by its own rule per hand
  // (wand: stamina below the spell's tap cost; bow: ammo pool at 0).
  const ammoEl = el('hud-ammo')
  if (player.attackMode === 'magic') {
    const wand = player.wand
    ammoEl.hidden = !wand
    if (wand) {
      const src = iconSrcFor({ kind: 'wand', payload: { weaponType: wand.weaponType } })
      const spell = spellFor(player)
      const dim = (player.stamina ?? 0) < spell.cost.tap
      const cls = dim ? 'hud-icon hud-icon-empty' : 'hud-icon'
      // No count badge for the wand — it draws on stamina, not a pool.
      setHTML(ammoEl, src ? `<img class="${cls}" src="${src}" alt="${wand.name ?? ''}">` : '🪄')
    } else {
      setHTML(ammoEl, '')
    }
    ammoEl.dataset.active = '1'
  } else {
    const ranged = player.ranged
    ammoEl.hidden = !ranged
    if (ranged) {
      const src = iconSrcFor({ kind: 'ranged', payload: { weaponType: ranged.weaponType } })
      const count = player.ammo?.[ranged.ammoKind] ?? 0
      const cls = count > 0 ? 'hud-icon' : 'hud-icon hud-icon-empty'
      setHTML(ammoEl, (src ? `<img class="${cls}" src="${src}" alt="${ranged.name ?? ''}">` : '🏹')
        + `<span class="hud-count">×${count}</span>`)
    } else {
      setHTML(ammoEl, '')
    }
    ammoEl.dataset.active = player.attackMode === 'ranged' ? '1' : ''
  }
  const staminaEl = el('hud-stamina')
  el('hud-stamina-fill').style.width =
    `${Math.round(100 * (player.stamina ?? 0) / (player.maxStamina ?? 100))}%`
  staminaEl.dataset.refused = (player.staminaRefusedT ?? 0) > 0 ? '1' : ''
}
