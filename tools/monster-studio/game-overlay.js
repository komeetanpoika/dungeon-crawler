// The game mirror: resolves a file under /sg/<name>/ to the draft's version
// when it has one, else to the project/repo file. null means 404.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { draftDir, readDraft } from './drafts.js'
import { rigModuleSource } from '../monster-cutter/templates.js'

const { NAME_RE } = createRequire(import.meta.url)('../monster-lab/monster-files.cjs')

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
               '.svg': 'image/svg+xml', '.wav': 'audio/wav' }
export const mimeOf = file => MIME[path.extname(file)] ?? 'application/octet-stream'

const BRIDGE_TAG = '<script type="module" src="/tools/monster-studio/game-bridge.js"></script>'
const PROJECT_DIRS = ['renderer/data/monsters/', 'renderer/assets/monsters/', 'renderer/render/monster-rigs/', 'assets/cuts/']

function readInside(base, rel) {
  const file = path.join(base, rel)
  if (!file.startsWith(base + path.sep)) return null
  try { if (!fs.statSync(file).isFile()) return null; return fs.readFileSync(file) } catch { return null }
}

// The draft as the mirror needs it, read once per revision. readDraft runs
// the cut's leak check and hashes files (about 200 ms on a big drawing) and
// one game boot asks for ~700 files, so reading it per file made the Fight
// tab take minutes. The key is meta.json's text: every saved edit bumps its
// rev, and a draft discarded and opened again gets fresh base hashes.
export function makeDraftCache(read = readDraft) {
  const seen = new Map()
  return {
    get(projectRoot, name) {
      const id = projectRoot + '\0' + name
      let key = null
      try { key = fs.readFileSync(path.join(draftDir(projectRoot, name), 'meta.json'), 'utf8') } catch { seen.delete(id) }
      const hit = seen.get(id)
      if (key !== null && hit?.key === key) return hit.draft
      const draft = read(projectRoot, name)
      if (key !== null) seen.set(id, { key, draft })
      return draft
    },
  }
}
const drafts = makeDraftCache()

export function resolveGameFile({ root, projectRoot, name, rel }) {
  if (typeof name !== 'string' || !NAME_RE.test(name) || name === 'index') return null
  let decoded
  try { decoded = decodeURIComponent(rel) } catch { return null }
  if (decoded.includes('\0')) return null
  const norm = path.posix.normalize(decoded.replace(/\\/g, '/')).replace(/^\/+/, '')
  if (norm === '..' || norm.startsWith('../') || norm === '.' || norm === '') return null
  let draft
  try { draft = drafts.get(projectRoot, name) } catch { return null }
  const dir = draftDir(projectRoot, name)
  const typeOf = file => ({ type: mimeOf(file) })

  if (norm === 'renderer/index.html') {
    const html = readInside(root, norm)
    if (!html) return null
    const lines = html.toString('utf8').split('\n')
    const i = lines.findIndex(l => l.includes('web-shim.js'))
    if (i >= 0) lines.splice(i + 1, 0, '  ' + BRIDGE_TAG)
    return { body: lines.join('\n'), type: 'text/html' }
  }
  if (norm === 'renderer/data/monsters/index.json') {
    const buf = readInside(projectRoot, norm)
    let idx = []
    try { idx = JSON.parse(buf.toString('utf8')) } catch { /* none */ }
    if (!Array.isArray(idx)) idx = []
    if (draft.isNew && !idx.includes(name)) idx = [...idx, name]
    return { body: JSON.stringify(idx), type: 'application/json' }
  }
  if (norm === `renderer/data/monsters/${name}.json`) {
    const b = readInside(dir, 'def.json')
    return b && { body: b, type: 'application/json' }
  }
  const parts = /^renderer\/assets\/monsters\/([^/]+)-parts\.(js|png)$/.exec(norm)
  if (parts && parts[1] === name) {
    if (draft.cut) {
      if (draft.buildError) return null
      const file = `${name}-parts.${parts[2]}`
      const b = readInside(dir, file)
      if (b) return { body: b, ...typeOf(file) }
    }
  }
  if (norm === `renderer/render/monster-rigs/${name}.js` && draft.isNew && draft.cut && !draft.buildError
      && !fs.existsSync(path.join(projectRoot, norm)))
    return { body: rigModuleSource(name), type: 'text/javascript' }
  if (PROJECT_DIRS.some(d => norm.startsWith(d))) {
    const b = readInside(projectRoot, norm) ?? readInside(root, norm)
    return b && { body: b, ...typeOf(norm) }
  }
  const b = readInside(root, norm)
  return b && { body: b, ...typeOf(norm) }
}
