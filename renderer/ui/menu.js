import { parseLevelCheat } from '../systems/cheats.js'

// Overlay menu screens (title / pause / game over). DOM-only; receives callbacks.
// Keep all document access inside functions so the pure helper stays importable
// under node --test.

let keyHandler = null
let currentButtons = []
let selectedIndex = 0
let cheatBuffer = ''

function overlayEl() { return document.getElementById('menu-overlay') }

// Menu navigation accepts the touch controls' synthetic keys alongside the
// desktop ones: stick w/s move, Space (the red button) confirms.
const NAV_ACTIONS = { ArrowDown: 'down', s: 'down', ArrowUp: 'up', w: 'up', Enter: 'confirm', ' ': 'confirm' }
export const navActionFor = key => NAV_ACTIONS[key] ?? null

export function formatMetaSummary(meta) {
  const treasure = meta.treasureStolen ? '✓' : '✗'
  return `Deepest: Level ${meta.deepestReached} · Runs: ${meta.runsCompleted} · Treasure: ${treasure}`
}

function clearKeyHandler() {
  if (keyHandler) { window.removeEventListener('keydown', keyHandler); keyHandler = null }
}

function highlight() {
  currentButtons.forEach((b, i) => b.classList.toggle('selected', i === selectedIndex))
}

function renderScreen({ title, subtitle, buttons, onCheat }) {
  const el = overlayEl()
  el.innerHTML = ''

  const panel = document.createElement('div')
  panel.className = 'menu-panel'

  const h = document.createElement('h1')
  h.className = 'menu-title'
  h.textContent = title
  panel.appendChild(h)

  if (subtitle) {
    const s = document.createElement('div')
    s.className = 'menu-subtitle'
    s.textContent = subtitle
    panel.appendChild(s)
  }

  currentButtons = buttons.map(({ label, onSelect }) => {
    const btn = document.createElement('button')
    btn.className = 'menu-btn'
    btn.textContent = label
    btn.addEventListener('click', () => onSelect())
    panel.appendChild(btn)
    return btn
  })

  el.appendChild(panel)
  el.style.display = 'flex'
  selectedIndex = 0
  cheatBuffer = ''
  highlight()

  clearKeyHandler()
  keyHandler = (e) => {
    const action = navActionFor(e.key)
    if (action === 'down') {
      selectedIndex = (selectedIndex + 1) % buttons.length; highlight(); e.preventDefault()
    } else if (action === 'up') {
      selectedIndex = (selectedIndex - 1 + buttons.length) % buttons.length; highlight(); e.preventDefault()
    } else if (action === 'confirm') {
      buttons[selectedIndex].onSelect(); e.preventDefault()
    } else if (onCheat && e.key.length === 1) {
      cheatBuffer = (cheatBuffer + e.key).toLowerCase().slice(-12)
      const depth = parseLevelCheat(cheatBuffer)
      if (depth !== null) { cheatBuffer = ''; onCheat(depth) } // depth 0 (boss arena) is valid but falsy
    }
  }
  window.addEventListener('keydown', keyHandler)
}

export function showTitle(meta, { onAdventure, onRush, onOpenEditor, onQuit, onCheat }) {
  // The web release has no tile editor and nothing to quit to. The old
  // procedural overworld left the menu with the mode split; it remains
  // reachable as the level6 cheat.
  const isWeb = typeof window !== 'undefined' && window.saveAPI?.isWeb
  renderScreen({
    title: 'DUNGEON CRAWLER',
    subtitle: formatMetaSummary(meta),
    buttons: [
      { label: 'Adventure', onSelect: onAdventure },
      { label: 'Dungeon Rush', onSelect: onRush },
      ...(isWeb ? [] : [
        { label: 'Open Editor', onSelect: onOpenEditor },
        { label: 'Quit', onSelect: onQuit },
      ]),
    ],
    onCheat,
  })
}

export function showPause({ onResume, onRestart, onQuitToTitle }) {
  renderScreen({
    title: 'Paused',
    buttons: [
      { label: 'Resume', onSelect: onResume },
      { label: 'Restart', onSelect: onRestart },
      { label: 'Quit to Title', onSelect: onQuitToTitle },
    ],
  })
}

export function showGameOver({ won, deepestLevel }, { onPlayAgain, onQuitToTitle }) {
  renderScreen({
    title: won ? '🏆 Victory!' : '💀 You Died',
    subtitle: `Reached Level ${deepestLevel}`,
    buttons: [
      { label: 'Play Again', onSelect: onPlayAgain },
      { label: 'Quit to Title', onSelect: onQuitToTitle },
    ],
  })
}

export function hide() {
  clearKeyHandler()
  const el = overlayEl()
  el.style.display = 'none'
  el.innerHTML = ''
}
