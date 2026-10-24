// tools/monster-bench/watcher.cjs
// Watch a directory tree with one plain fs.watch per directory. Electron
// 30's Node 20 implements `{ recursive: true }` on Linux by watching each
// file's inode, so once a file is replaced by write-temp-then-rename (the
// bench's own Save, the Edit tool) its changes are never reported again.
// A directory watch reports every replace by name. Directories created
// later join the watch; one that disappears is dropped quietly. CJS so
// main.cjs can require it.
const fs = require('fs')
const path = require('path')

function watchTree(root, onChange, { onError = () => {} } = {}) {
  const watchers = new Map()

  const drop = dir => { watchers.get(dir)?.close(); watchers.delete(dir) }

  function watchDir(dir) {
    if (watchers.has(dir)) return
    let w
    try {
      w = fs.watch(dir, (ev, name) => {
        if (!fs.existsSync(dir)) { drop(dir); return }
        if (!name) return
        const abs = path.join(dir, String(name))
        if (ev === 'rename') {
          let isDir = false
          try { isDir = fs.statSync(abs).isDirectory() } catch { /* removed: report it below */ }
          if (isDir) { scan(abs); return }
        }
        onChange(path.relative(root, abs).split(path.sep).join('/'))
      })
    } catch (err) { onError(err); return }
    w.on('error', err => { drop(dir); onError(err) })
    watchers.set(dir, w)
  }

  function scan(dir) {
    watchDir(dir)
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (err) { onError(err); return }
    for (const e of entries) if (e.isDirectory()) scan(path.join(dir, e.name))
  }

  scan(root)
  return { close() { for (const dir of [...watchers.keys()]) drop(dir) } }
}

module.exports = { watchTree }
