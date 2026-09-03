// Web-release replacement for the Electron preload bridge.
//
// Under Electron, preload.cjs exposes window.saveAPI before any page script
// runs, so this file is a no-op there. In a plain browser it installs a
// same-shape API backed by localStorage (saves) and static fetches (data),
// plus the browser-only keyboard fixes the desktop build doesn't need.
const META_KEY = 'dungeon-crawler-meta'
const CAVES_KEY = 'dungeon-crawler-caves'
const TIMEWARP_KEY = 'dungeon-crawler-timewarp'

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
    saveCaves: async (data) => { try { localStorage.setItem(CAVES_KEY, JSON.stringify(data)) } catch {} },
    loadCaves: async () => {
      try { return JSON.parse(localStorage.getItem(CAVES_KEY)) } catch { return null }
    },
    saveTimewarp: async (data) => { try { localStorage.setItem(TIMEWARP_KEY, JSON.stringify(data)) } catch {} },
    loadTimewarp: async () => {
      try { return JSON.parse(localStorage.getItem(TIMEWARP_KEY)) } catch { return null }
    },
    loadRulesets: () => fetchJSON('./data/rulesets.json', {}),
    // Mirrors main.cjs's load-monsters: the index lists names, each name is
    // its own JSON def. A missing or bad file is skipped, never fatal — the
    // game's registerMonsters warns per def and the spawn rolls fall back.
    loadMonsters: async () => {
      const names = await fetchJSON('./data/monsters/index.json', [])
      if (!Array.isArray(names)) return []
      const defs = await Promise.all(names.map(n =>
        typeof n === 'string' && /^[a-z0-9_]+$/.test(n) ? fetchJSON(`./data/monsters/${n}.json`, null) : null))
      return defs.filter(Boolean)
    },
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
