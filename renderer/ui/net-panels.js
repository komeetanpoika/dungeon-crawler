// What covers the arena during an online match (4a spec §3): nothing, the
// "Down!" class picker, or the results / next-match panel — and the leave
// confirm over any of them. Pure bookkeeping, no DOM: game.js hands in `ui`,
// whose functions draw each panel through menu.js. Escape (or the touch
// START pill) opens the confirm; Stay or a second Escape puts back whatever
// is current underneath, so a death or a match end that happened meanwhile
// shows the moment the confirm closes.
export function makeNetPanels(ui) {
  const p = { confirming: false, picker: false, ended: false, standings: null }
  const show = () => {
    if (p.ended) { if (p.standings) ui.results(p.standings); else ui.wait() }
    else if (p.picker) ui.picker()
    else ui.hide()
  }
  const redraw = () => { if (!p.confirming) show() }
  const panels = {
    get confirming() { return p.confirming },
    // What is up right now: 'confirm', 'results', 'wait', 'picker' or null
    // (game.js updates the picker's live countdown only while it is shown).
    get showing() { return p.confirming ? 'confirm' : p.ended ? (p.standings ? 'results' : 'wait') : p.picker ? 'picker' : null },
    // Draw the current panel again after something else covered it — the
    // Reconnecting… overlay, once the seat is back (4b spec §2).
    refresh() { if (p.confirming) ui.confirm(); else show() },
    escape() {
      if (p.confirming) { p.confirming = false; show() }
      else { p.confirming = true; ui.confirm() }
    },
    stay() { if (p.confirming) { p.confirming = false; show() } },
    died() { p.picker = true; redraw() },
    picked() { if (!p.picker) return; p.picker = false; redraw() },
    matchEnd(standings) { p.ended = true; p.standings = standings; redraw() },
    matchStart() { p.ended = false; p.standings = null; p.picker = false; redraw() },
    // Backstops from each snapshot: a capped or dropped matchEnd, matchStart
    // or respawn event (a backgrounded tab, a skipped slow reader) must not
    // leave a panel stuck over a live match, or no panel over the results.
    sync({ ended, dead }) {
      if (ended && !p.ended) { p.ended = true; p.standings = null; redraw() }
      else if (!ended && p.ended) panels.matchStart()
      if (!dead && p.picker) panels.picked()
    },
  }
  return panels
}
