// Pure undo/redo core for the Build tab. Snapshots are opaque to this module;
// callers pass deep copies (snapshotLayers) so restored state can be assigned
// directly without aliasing live grids.

export function createHistory(cap = 50) {
  const undoStack = []
  const redoStack = []
  return {
    push(snapshot) {
      undoStack.push(snapshot)
      if (undoStack.length > cap) undoStack.shift()
      redoStack.length = 0
    },
    undo(current) {
      if (!undoStack.length) return null
      redoStack.push(current)
      return undoStack.pop()
    },
    redo(current) {
      if (!redoStack.length) return null
      undoStack.push(current)
      return redoStack.pop()
    },
    clear() {
      undoStack.length = 0
      redoStack.length = 0
    },
    get canUndo() { return undoStack.length > 0 },
    get canRedo() { return redoStack.length > 0 },
  }
}

// Deep-copy the three paint layers. props cells are single-level objects whose
// values are either strings or small plain objects (interaction), so a
// structuredClone covers them without hand-rolled per-key copying.
export function snapshotLayers(grid) {
  return {
    base: grid.base.map(r => r.slice()),
    overlay: grid.overlay.map(r => r.slice()),
    props: grid.props.map(r => r.map(c => (c ? structuredClone(c) : null))),
  }
}
