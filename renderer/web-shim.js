// Web-release replacement for the Electron preload bridge.
//
// Under Electron, preload.cjs exposes window.saveAPI before any page script
// runs, so this file is a no-op there. In a plain browser it installs a
// same-shape API backed by localStorage (saves) and static fetches (data),
// plus the browser-only keyboard fixes the desktop build doesn't need.
const META_KEY = 'dungeon-crawler-meta'

async function fetchJSON(url, fallback) {
  try {
    const r = await fetch(url)
    return r.ok ? await r.json() : fallback
  } catch {
    return fallback
  }
}

if (!window.saveAPI) {
  window.saveAPI = {
    isWeb: true,
    saveMeta: async (data) => { localStorage.setItem(META_KEY, JSON.stringify(data)) },
    loadMeta: async () => {
      try { return JSON.parse(localStorage.getItem(META_KEY)) } catch { return null }
    },
    deleteRun: async () => {},
    loadRulesets: () => fetchJSON('./data/rulesets.json', {}),
    loadStructures: () => fetchJSON('./data/structures.json', {}),
    loadArenaConfig: async () => null,   // arena testing is a desktop/dev feature
    openEditor: async () => {},          // no editor in the web release
    quitApp: async () => {},
  }

  // Browser keyboard fixes:
  // - Arrows/Space must never scroll the page or re-activate whichever menu
  //   button was focused last (Space on a lingering focused button restarts
  //   the run mid-fight). Menu navigation is unaffected — menu.js drives
  //   selection from its own keydown handler, not from browser defaults.
  const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '])
  window.addEventListener('keydown', e => {
    if (GAME_KEYS.has(e.key)) e.preventDefault()
  }, { capture: true })

  // - Clicking a menu button leaves it focused; drop focus so later
  //   Space/Enter presses reach only the game.
  document.addEventListener('click', e => {
    if (e.target instanceof HTMLElement) e.target.closest('button')?.blur()
  })
}
