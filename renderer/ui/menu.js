import { CHEAT_HOLD_MS, cheatStep } from '../systems/cheats.js'
import { CLASS_HINTS } from '../data/pvp.js'

// Overlay menu screens (title / pause / game over). DOM-only; receives callbacks.
// Keep all document access inside functions so the pure helper stays importable
// under node --test.

let keyHandler = null
let currentButtons = []
let currentInput = null
let selectedIndex = 0
let cheatBuffer = ''
let cheatTimer = null

// The current screen's title and subtitle nodes, for setSubtitle.
let currentTitle = null
let currentSubtitle = null

function overlayEl() { return document.getElementById('menu-overlay') }

// Menu navigation accepts the touch controls' synthetic keys alongside the
// desktop ones: stick w/s move, Space (the red button) confirms.
const NAV_ACTIONS = {
  ArrowDown: 'down', s: 'down', ArrowUp: 'up', w: 'up', Enter: 'confirm', ' ': 'confirm',
  ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right',   // a row with a value to turn up or down
}
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

function renderScreen({ title, subtitle, lines = [], buttons, onCheat, onPvp, onNet, input, onEscape, selected = 0, compact = false }) {
  const el = overlayEl()
  el.innerHTML = ''
  currentInput = null

  const panel = document.createElement('div')
  panel.className = compact ? 'menu-panel compact' : 'menu-panel'

  const h = document.createElement('h1')
  h.className = 'menu-title'
  h.textContent = title
  panel.appendChild(h)
  currentTitle = h
  currentSubtitle = null

  if (subtitle) {
    const s = document.createElement('div')
    s.className = 'menu-subtitle'
    s.textContent = subtitle
    panel.appendChild(s)
    currentSubtitle = s
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
    inp.spellcheck = false
    inp.enterKeyHint = 'go'
    // A phone keyboard opens in capitals for the room code.
    if (input.autocapitalize) inp.setAttribute('autocapitalize', input.autocapitalize)
    panel.appendChild(inp)
    currentInput = inp
  }

  currentButtons = buttons.map(({ label, onSelect, className, hint }) => {
    const btn = document.createElement('button')
    btn.className = className ? `menu-btn ${className}` : 'menu-btn'
    btn.textContent = label
    // A second, smaller line inside the button (the class picker's hints).
    if (hint) {
      const small = document.createElement('span')
      small.className = 'menu-hint'
      small.textContent = hint
      btn.appendChild(small)
    }
    btn.addEventListener('click', () => onSelect())
    panel.appendChild(btn)
    return btn
  })

  el.appendChild(panel)
  el.style.display = 'flex'
  // While a text field is up the touch layer steps aside (index.html CSS),
  // so no stick or pill can sit over the field or swallow its taps.
  document.body?.classList.toggle('menu-typing', !!input)
  // While any menu overlay is visible the touch icons (bag, map, menu) are
  // hidden by index.html CSS: a tap meant for a menu button must not land on
  // an icon instead.
  document.body?.classList.toggle('menu-open', true)
  selectedIndex = Math.min(Math.max(0, selected), buttons.length - 1)
  cheatBuffer = ''
  clearCheatTimer()
  highlight()
  currentInput?.focus()

  clearKeyHandler()
  keyHandler = (e) => {
    if (currentInput && e.target === currentInput && e.key !== 'Enter' && e.key !== 'Escape') return
    if (e.key === 'Escape') { if (onEscape) onEscape(); e.preventDefault(); return }
    const action = navActionFor(e.key)
    // A key already held when this screen appeared (typically Space, from an
    // attack/charge in progress underneath) arrives here only as OS repeats —
    // the real press happened before this handler existed. Treating repeats
    // as fresh presses would auto-confirm whatever button is selected.
    if (action && e.repeat) { e.preventDefault(); return }
    if (action === 'down') {
      selectedIndex = (selectedIndex + 1) % buttons.length; highlight(); e.preventDefault()
    } else if (action === 'up') {
      selectedIndex = (selectedIndex - 1 + buttons.length) % buttons.length; highlight(); e.preventDefault()
    } else if (action === 'confirm') {
      buttons[selectedIndex].onSelect(); e.preventDefault()
    } else if (action === 'left' || action === 'right') {
      const turn = buttons[selectedIndex][action === 'left' ? 'onLeft' : 'onRight']
      if (turn) { turn(); e.preventDefault() }
    }
    // A cheat letter is folded into the buffer independently of any nav
    // action above — "host"'s "s" is also the down-nav key, and typing it
    // must still move toward the cheat as well as move the selection.
    if (!onCheat || e.key.length !== 1) return
    const step = cheatStep(cheatBuffer, e.key)
    cheatBuffer = step.buffer
    if (onPvp && step.pvp) { e.preventDefault(); clearCheatTimer(); cheatBuffer = ''; onPvp(); return }
    if (onNet && step.net) { e.preventDefault(); clearCheatTimer(); cheatBuffer = ''; onNet(step.net); return }
    // The cheat is suffix-matched, so "level1" matches while the player may
    // still be typing "level18". A depth a further digit could extend is
    // held for CHEAT_HOLD_MS; only a further match cancels that pending fire
    // and re-decides on the longer buffer, so a stray keystroke can't eat the
    // cheat. depth 0 is valid but falsy — never test the depth for truthiness.
    const decision = step.level
    if (!decision) return
    clearCheatTimer()
    const fire = () => { cheatTimer = null; cheatBuffer = ''; onCheat(decision.depth) }
    if (decision.wait) cheatTimer = setTimeout(fire, CHEAT_HOLD_MS)
    else fire()
  }
  window.addEventListener('keydown', keyHandler)
}

export function showTitle(meta, { onWilds, onRush, onPvpArena, onSettings, onOpenEditor, onQuit, onCheat, onPvp, onNet }) {
  // Adventure is the Wilds (2026-11-15): the old map-by-map Adventure and
  // Timewarp left the title, their maps still answer to the level<N> cheats.
  // The web release has no tile editor and nothing to quit to.
  const isWeb = typeof window !== 'undefined' && window.saveAPI?.isWeb
  renderScreen({
    title: 'DUNGEON CRAWLER',
    subtitle: formatMetaSummary(meta),
    buttons: [
      { label: 'Adventure', onSelect: onWilds },
      { label: 'Dungeon Rush', onSelect: onRush },
      { label: 'PvP arena', onSelect: onPvpArena },
      ...(onSettings ? [{ label: 'Settings', onSelect: onSettings }] : []),
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

// Online (web build): a public room with bot fill, or a private one by code.
export function showOnline({ onQuick, onFriends, onBack }) {
  renderScreen({
    title: 'Online',
    buttons: [
      { label: 'Quick match', onSelect: onQuick },
      { label: 'Play with friends', onSelect: onFriends },
      { label: 'Back', onSelect: onBack },
    ],
    onEscape: onBack,
  })
}

export function showFriends({ onHost, onJoin, onBack }) {
  renderScreen({
    title: 'Play with friends',
    buttons: [
      { label: 'Host a room', onSelect: onHost },
      { label: 'Join with code', onSelect: onJoin },
      { label: 'Back', onSelect: onBack },
    ],
    onEscape: onBack,
  })
}

// Escape / START in an online match. No onEscape here: game.js's own Escape
// listener toggles this panel (renderer/ui/net-panels.js), so the menu must
// not act on the same key a second time.
export function showLeaveConfirm({ onStay, onLeave }) {
  renderScreen({
    title: 'Leave the match?',
    buttons: [
      { label: 'Stay', onSelect: onStay },
      { label: 'Leave', onSelect: onLeave },
    ],
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

export function showPause({ onResume, onSound, onControls, onRestart, onQuitToTitle }) {
  renderScreen({
    title: 'Paused',
    buttons: [
      { label: 'Resume', onSelect: onResume },
      ...(onSound ? [{ label: 'Sound', onSelect: onSound }] : []),
      ...(onControls ? [{ label: 'Controls', onSelect: onControls }] : []),
      { label: 'Restart', onSelect: onRestart },
      { label: 'Quit to Title', onSelect: onQuitToTitle },
    ],
  })
}

// The title's Settings: the same two screens the pause menu opens.
export function showSettings({ onSound, onControls, onBack }) {
  renderScreen({
    title: 'Settings',
    buttons: [
      { label: 'Sound', onSelect: onSound },
      ...(onControls ? [{ label: 'Controls', onSelect: onControls }] : []),
      { label: 'Back', onSelect: onBack },
    ],
    onEscape: onBack,
  })
}

export const volumeLabel = (volume, steps = 10) => {
  const n = Math.round(volume * steps)
  return `Volume  ${'█'.repeat(n)}${'░'.repeat(steps - n)}  ${n}`
}

// Sound: a volume turned with left and right (a tap or Enter steps it up and
// round again), and sound on or off.
export function showSound({ volume, muted, selected = 0 }, { onVolume, onMute, onBack }) {
  renderScreen({
    title: 'Sound',
    selected,
    buttons: [
      { label: volumeLabel(volume), onSelect: () => onVolume(volume >= 1 ? -10 : 1), onLeft: () => onVolume(-1), onRight: () => onVolume(1) },
      { label: muted ? 'Sound: off' : 'Sound: on', onSelect: onMute, onLeft: onMute, onRight: onMute },
      { label: 'Back', onSelect: onBack },
    ],
    onEscape: onBack,
  })
}

// Controls: every action with its keys. Picking one waits for a key (the
// game takes the next press, Escape backs out).
export function showControls({ rows, waiting = null, selected = 0 }, { onPick, onReset, onBack }) {
  renderScreen({
    title: 'Controls',
    subtitle: waiting === null ? 'Pick an action, then press its new key.' : 'Press a key. Escape leaves it as it was.',
    selected,
    compact: true,
    buttons: [
      ...rows.map((r, i) => ({ label: `${r.label}:  ${waiting === i ? '…' : r.keys}`, onSelect: () => onPick(i) })),
      { label: 'Reset to defaults', onSelect: onReset },
      { label: 'Back', onSelect: onBack },
    ],
    onEscape: onBack,
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

// Change the current screen's subtitle in place (the death picker's live
// "Back in N"): no re-render, so the buttons, the selection and the key
// handler stay as they are. A screen without one gets it right under the
// title. No screen up: nothing to do.
export function setSubtitle(text) {
  if (!currentTitle) return
  if (!currentSubtitle) {
    currentSubtitle = document.createElement('div')
    currentSubtitle.className = 'menu-subtitle'
    currentTitle.after(currentSubtitle)
  }
  currentSubtitle.textContent = text
}

export function hide() {
  clearKeyHandler()
  currentInput = null
  currentTitle = null
  currentSubtitle = null
  document.body?.classList.remove('menu-typing')
  document.body?.classList.remove('menu-open')
  const el = overlayEl()
  el.style.display = 'none'
  el.innerHTML = ''
}

// PvP: pick a class — before a local match, and while dead (applies at
// respawn; the subtitle then counts down, the hint sits in `lines`).
export function showClassPicker({ title = 'Arena', subtitle = 'Pick a class', lines = [], onPick, onBack }) {
  renderScreen({
    title, subtitle, lines,
    buttons: [
      { label: 'Warrior', hint: CLASS_HINTS.warrior, onSelect: () => onPick('warrior') },
      { label: 'Archer', hint: CLASS_HINTS.archer, onSelect: () => onPick('archer') },
      { label: 'Mage', hint: CLASS_HINTS.mage, onSelect: () => onPick('mage') },
      ...(onBack ? [{ label: 'Back', onSelect: onBack }] : []),
    ],
    onEscape: onBack,
  })
}

// PvP: the end-of-match table, one line per hero (bots under their names).
// onNext is optional — an online match has no local restart, only a Leave.
export function showPvpResults(rows, { onNext, onQuit, quitLabel = 'Quit' }) {
  renderScreen({
    title: 'Match over',
    lines: rows.map(r => `${r.rank}. ${r.name} — ${r.cls} — ${r.kills} / ${r.deaths}`),
    buttons: [
      ...(onNext ? [{ label: 'Next match', onSelect: onNext }] : []),
      { label: quitLabel, onSelect: onQuit },
    ],
  })
}

// A one-field form (name, room code): Enter — the phone keyboard's too — or
// OK submits the text.
export function showTextEntry({ title, subtitle, value = '', maxLength = 12, autocapitalize, onSubmit, onBack }) {
  renderScreen({
    title, subtitle, input: { value, maxLength, autocapitalize },
    buttons: [
      { label: 'OK', onSelect: () => onSubmit(currentInput?.value ?? '') },
      ...(onBack ? [{ label: 'Back', onSelect: onBack }] : []),
    ],
    onEscape: onBack,
  })
}

// A message with one button (connection lost, refused, web-only).
// A choice put to the player in the middle of play (the Sampo's last home):
// a title, a line or two, and a button for each answer. Escape is the last.
export function showChoice({ title, lines = [], buttons }) {
  renderScreen({ title, lines, buttons, onEscape: buttons.at(-1)?.onSelect })
}

export function showMessage({ title, lines = [], onOk, okLabel = 'OK' }) {
  renderScreen({ title, lines, buttons: [{ label: okLabel, onSelect: onOk }] })
}
