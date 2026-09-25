import { cheatDecision, CHEAT_HOLD_MS, parsePvpCheat, parseNetCheat } from '../systems/cheats.js'

// Overlay menu screens (title / pause / game over). DOM-only; receives callbacks.
// Keep all document access inside functions so the pure helper stays importable
// under node --test.

let keyHandler = null
let currentButtons = []
let currentInput = null
let selectedIndex = 0
let cheatBuffer = ''
let cheatTimer = null

function overlayEl() { return document.getElementById('menu-overlay') }

// Menu navigation accepts the touch controls' synthetic keys alongside the
// desktop ones: stick w/s move, Space (the red button) confirms.
const NAV_ACTIONS = { ArrowDown: 'down', s: 'down', ArrowUp: 'up', w: 'up', Enter: 'confirm', ' ': 'confirm' }
export const navActionFor = key => NAV_ACTIONS[key] ?? null

export function formatMetaSummary(meta) {
  const treasure = meta.treasureStolen ? '✓' : '✗'
  return `Deepest: Level ${meta.deepestReached} · Runs: ${meta.runsCompleted} · Treasure: ${treasure}`
}

function clearCheatTimer() {
  if (cheatTimer !== null) { clearTimeout(cheatTimer); cheatTimer = null }
}

function clearKeyHandler() {
  clearCheatTimer()
  if (keyHandler) { window.removeEventListener('keydown', keyHandler); keyHandler = null }
}

function highlight() {
  currentButtons.forEach((b, i) => b.classList.toggle('selected', i === selectedIndex))
}

function renderScreen({ title, subtitle, lines = [], buttons, onCheat, onPvp, onNet, input }) {
  const el = overlayEl()
  el.innerHTML = ''
  currentInput = null

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

  for (const line of lines) {
    const l = document.createElement('div')
    l.className = 'menu-subtitle'
    l.textContent = line
    panel.appendChild(l)
  }

  if (input) {
    const inp = document.createElement('input')
    inp.className = 'menu-input'
    inp.maxLength = input.maxLength ?? 12
    inp.value = input.value ?? ''
    inp.autocomplete = 'off'
    panel.appendChild(inp)
    currentInput = inp
  }

  currentButtons = buttons.map(({ label, onSelect, className }) => {
    const btn = document.createElement('button')
    btn.className = className ? `menu-btn ${className}` : 'menu-btn'
    btn.textContent = label
    btn.addEventListener('click', () => onSelect())
    panel.appendChild(btn)
    return btn
  })

  el.appendChild(panel)
  el.style.display = 'flex'
  selectedIndex = 0
  cheatBuffer = ''
  clearCheatTimer()
  highlight()
  currentInput?.focus()

  clearKeyHandler()
  keyHandler = (e) => {
    if (currentInput && e.target === currentInput && e.key !== 'Enter' && e.key !== 'Escape') return
    const action = navActionFor(e.key)
    if (action === 'down') {
      selectedIndex = (selectedIndex + 1) % buttons.length; highlight(); e.preventDefault()
    } else if (action === 'up') {
      selectedIndex = (selectedIndex - 1 + buttons.length) % buttons.length; highlight(); e.preventDefault()
    } else if (action === 'confirm') {
      buttons[selectedIndex].onSelect(); e.preventDefault()
    } else if (onCheat && e.key.length === 1) {
      cheatBuffer = (cheatBuffer + e.key).toLowerCase().slice(-12)
      if (onPvp && parsePvpCheat(cheatBuffer)) { clearCheatTimer(); cheatBuffer = ''; onPvp(); return }
      const net = onNet && parseNetCheat(cheatBuffer)
      if (net) { clearCheatTimer(); cheatBuffer = ''; onNet(net); return }
      // The cheat is suffix-matched, so "level1" matches while the player may
      // still be typing "level18". A depth a further digit could extend is
      // held for CHEAT_HOLD_MS; only a further match cancels that pending fire
      // and re-decides on the longer buffer, so a stray keystroke can't eat the
      // cheat. depth 0 is valid but falsy — never test the depth for truthiness.
      const decision = cheatDecision(cheatBuffer)
      if (!decision) return
      clearCheatTimer()
      const fire = () => { cheatTimer = null; cheatBuffer = ''; onCheat(decision.depth) }
      if (decision.wait) cheatTimer = setTimeout(fire, CHEAT_HOLD_MS)
      else fire()
    }
  }
  window.addEventListener('keydown', keyHandler)
}

export function showTitle(meta, { onAdventure, onTimewarp, onRush, onOpenEditor, onQuit, onCheat, onPvp, onNet }) {
  // The web release has no tile editor and nothing to quit to. The old
  // procedural overworld left the menu with the mode split; it remains
  // reachable as the level6 cheat.
  const isWeb = typeof window !== 'undefined' && window.saveAPI?.isWeb
  renderScreen({
    title: 'DUNGEON CRAWLER',
    subtitle: formatMetaSummary(meta),
    buttons: [
      { label: 'Adventure', onSelect: onAdventure },
      { label: 'Timewarp', onSelect: onTimewarp },
      { label: 'Dungeon Rush', onSelect: onRush },
      ...(isWeb ? [] : [
        { label: 'Open Editor', onSelect: onOpenEditor },
        { label: 'Quit', onSelect: onQuit },
      ]),
    ],
    onCheat,
    onPvp,
    onNet,
  })
}

// Timewarp's episode picker. Resolved episodes are tinted (colour only, no
// badges) via the `done` class; entries come from timewarp.js's episodeEntries.
export function showEpisodeSelect(entries, { onPick, onBack }) {
  renderScreen({
    title: 'Timewarp',
    subtitle: 'Set right what once went wrong',
    buttons: [
      ...entries.map(e => ({ label: e.title, className: e.resolved ? 'done' : undefined, onSelect: () => onPick(e.depth) })),
      { label: 'Back', onSelect: onBack },
    ],
  })
}

// The adventure waystone's destination list; entries from waystoneDestinations.
export function showDestinations(entries, { onPick, onCancel }) {
  renderScreen({
    title: 'Waystone',
    buttons: [
      ...entries.map(e => ({ label: e.title, onSelect: () => onPick(e.depth) })),
      { label: 'Stay', onSelect: onCancel },
    ],
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
  currentInput = null
  const el = overlayEl()
  el.style.display = 'none'
  el.innerHTML = ''
}

// PvP: pick a class — before a local match, and while dead (applies at respawn).
export function showClassPicker({ title = 'Arena', subtitle = 'Pick a class', onPick, onBack }) {
  renderScreen({
    title, subtitle,
    buttons: [
      { label: 'Warrior', onSelect: () => onPick('warrior') },
      { label: 'Archer', onSelect: () => onPick('archer') },
      { label: 'Mage', onSelect: () => onPick('mage') },
      ...(onBack ? [{ label: 'Back', onSelect: onBack }] : []),
    ],
  })
}

// PvP: the end-of-match table, one line per hero. onNext is optional — an
// online match has no local restart, only a quit.
export function showPvpResults(rows, { onNext, onQuit }) {
  renderScreen({
    title: 'Match over',
    lines: rows.map(r => `${r.rank}. ${r.name} — ${r.cls} — ${r.kills} / ${r.deaths}`),
    buttons: [
      ...(onNext ? [{ label: 'Next match', onSelect: onNext }] : []),
      { label: 'Quit', onSelect: onQuit },
    ],
  })
}

// A one-field form (name, room code): Enter or OK submits the text.
export function showTextEntry({ title, subtitle, value = '', maxLength = 12, onSubmit, onBack }) {
  renderScreen({
    title, subtitle, input: { value, maxLength },
    buttons: [
      { label: 'OK', onSelect: () => onSubmit(currentInput?.value ?? '') },
      ...(onBack ? [{ label: 'Back', onSelect: onBack }] : []),
    ],
  })
}

// A message with one button (connection lost, refused, web-only).
export function showMessage({ title, lines = [], onOk }) {
  renderScreen({ title, lines, buttons: [{ label: 'OK', onSelect: onOk }] })
}
