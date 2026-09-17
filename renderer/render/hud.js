import { resolveOffhand, offhandItem } from '../systems/inventory.js'
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
  // Offhand slot: what Q acts on in the active loadout. A consumable pointer
  // shows the kind and the sack count (dimmed at zero); an empty offhand shows
  // the dimmed potion silhouette so the slot never vanishes.
  const off = resolveOffhand(player)
  const offEl = el('hud-offhand')
  if (off?.kind === 'consumable') {
    const src = iconSrcFor({ kind: off.item })
    const cls = off.count > 0 ? 'hud-icon' : 'hud-icon hud-icon-empty'
    setHTML(offEl, (src ? `<img class="${cls}" src="${src}" alt="">` : (off.slot?.emoji ?? ''))
      + (off.count > 0 ? `<span class="hud-count">×${off.count}</span>` : ''))
    offEl.dataset.offhand = off.count > 0 ? 'consumable' : ''
  } else if (off) {
    // An item in the offhand: shield, wand or blade. No count. Dimmed when it
    // cannot act — a shield below its block cost or still dropped, a wand
    // below its tap cost. A blade is always ready.
    const src = iconSrcFor(offhandItem(off))
    const dim = off.kind === 'shield' ? ((player.stamina ?? 0) < off.blockCost || (player.shieldDropT ?? 0) > 0)
      : off.kind === 'wand' ? (player.stamina ?? 0) < spellFor(player, 'off').cost.tap
      : false
    setHTML(offEl, src ? `<img class="${dim ? 'hud-icon hud-icon-empty' : 'hud-icon'}" src="${src}" alt="${off.name ?? ''}">` : '')
    offEl.dataset.offhand = dim ? '' : off.kind
  } else {
    const emptySrc = iconSrcFor({ kind: 'potion' })
    setHTML(offEl, emptySrc ? `<img class="hud-icon hud-icon-empty" src="${emptySrc}" alt="">` : '')
    offEl.dataset.offhand = ''
  }
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
