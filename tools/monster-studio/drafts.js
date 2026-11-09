// The Monster Studio's draft store. Every edit to a monster lives in
// drafts/monsters/<name>/ until Publish; nothing here writes under renderer/,
// assets/cuts/ or the monster index. Errors are plain Errors with a numeric
// .status (400 bad input, 404 missing, 409 conflict).
//
// Layout: def.json, cut.json (source -> drafts/monsters/<name>/source.png),
// source.png, <name>-parts.{png,js} (built after every cut save that passes
// checkCut), meta.json = { isNew, rev, base: { def, cut, png } } where base
// holds sha1 hex of the published files at draft creation (null = absent).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { decodePng } from '../png-read.mjs'
import { validateCut } from '../monster-cutter/cut-format.js'
import { checkCut, buildCut } from '../monster-cutter/build-cut.js'
import { newDef } from '../monster-cutter/install-cut.js'

const { NAME_RE, RESERVED_NAMES, mergeDefPatch } = createRequire(import.meta.url)('../monster-lab/monster-files.cjs')

export const DRAFTS_DIR = 'drafts/monsters'
// meta.rev of a draft nobody has edited yet; every save bumps it
const FIRST_REV = 1
const PNG_PREFIX = 'data:image/png;base64,'

const fail = (status, msg) => Object.assign(new Error(msg), { status })
const sha1 = buf => crypto.createHash('sha1').update(buf).digest('hex')
const readBytes = file => { try { return fs.readFileSync(file) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
const hashFile = file => { const b = readBytes(file); return b ? sha1(b) : null }
const readJson = file => { const b = readBytes(file); return b ? JSON.parse(b.toString('utf8')) : null }
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}
const writeJson = (file, obj) => writeAtomic(file, JSON.stringify(obj, null, 2))

export const draftDir = (root, name) => path.join(root, DRAFTS_DIR, name)
const pub = (root, name) => ({
  def: path.join(root, 'renderer/data/monsters', name + '.json'),
  cut: path.join(root, 'assets/cuts', name + '.json'),
  png: path.join(root, 'assets/cuts', name + '.png'),
})
const draftFiles = (root, name) => {
  const d = draftDir(root, name)
  return { dir: d, def: path.join(d, 'def.json'), cut: path.join(d, 'cut.json'), png: path.join(d, 'source.png'), meta: path.join(d, 'meta.json') }
}
const sourceRel = name => `${DRAFTS_DIR}/${name}/source.png`

function checkName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw fail(400, `invalid monster name "${name}"`)
  if (name === 'index') throw fail(400, 'monster name "index" is reserved for the index file')
}
function checkNewName(name) {
  checkName(name)
  if (RESERVED_NAMES.has(name)) throw fail(400, `monster name "${name}" is reserved for a built-in type`)
}

function publishedNames(root) {
  const idx = readJson(path.join(root, 'renderer/data/monsters/index.json'))
  return Array.isArray(idx) ? idx.filter(n => typeof n === 'string') : []
}
const isPublished = (root, name) => publishedNames(root).includes(name) || fs.existsSync(pub(root, name).def)
const hasDraft = (root, name) => fs.existsSync(draftFiles(root, name).meta)
function draftNames(root) {
  try { return fs.readdirSync(path.join(root, DRAFTS_DIR), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort() } catch { return [] }
}

export function monsterKind(root, name, def) {
  if (def?.placedBy === 'story') return 'story'
  return fs.existsSync(pub(root, name).cut) ? 'drawn' : 'code'
}

export function listStudio(root) {
  const monsters = [...new Set(publishedNames(root))].sort().map(name => {
    let def = null
    try { def = readJson(pub(root, name).def) } catch { /* unreadable def: kind falls back */ }
    return { name, kind: monsterKind(root, name, def), hasDraft: hasDraft(root, name) }
  })
  const newDrafts = draftNames(root).filter(n => { try { return readJson(draftFiles(root, n).meta)?.isNew === true } catch { return false } })
  return { monsters, newDrafts }
}

export function suggestName(root, base) {
  let b = String(base ?? '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  if (!b) b = 'monster'
  const taken = new Set([...publishedNames(root), ...draftNames(root), ...RESERVED_NAMES, 'index'])
  if (!taken.has(b)) return b
  for (let i = 2; ; i++) if (!taken.has(`${b}_${i}`)) return `${b}_${i}`
}

function requireDraft(root, name) {
  checkName(name)
  if (!hasDraft(root, name)) throw fail(404, `no draft for "${name}"`)
  return draftFiles(root, name)
}
function bump(f) {
  const meta = readJson(f.meta)
  meta.rev += 1
  writeJson(f.meta, meta)
  return meta.rev
}

// Build the draft's parts; returns the error message, or null.
function tryBuild(root, name) {
  const f = draftFiles(root, name)
  try { buildCut({ root, name, cutPath: f.cut, outDir: f.dir }); return null } catch (e) { return e.message }
}

export function readDraft(root, name) {
  const f = requireDraft(root, name)
  const meta = readJson(f.meta), def = readJson(f.def), cut = readJson(f.cut)
  const p = pub(root, name)
  const publishedDef = readJson(p.def)
  let buildError = null
  if (cut) { try { checkCut(cut, name) } catch (e) { buildError = e.message } }
  const now = { def: hashFile(p.def), cut: hashFile(p.cut), png: hashFile(p.png) }
  const stale = ['def', 'cut', 'png'].some(k => now[k] !== (meta.base?.[k] ?? null))
  let cutChanged = true
  if (!meta.isNew) {
    const pubCut = readJson(p.cut)
    if (!cut) cutChanged = !!pubCut
    else cutChanged = !pubCut || sha1(JSON.stringify({ ...cut, source: `assets/cuts/${name}.png` })) !== sha1(JSON.stringify(pubCut))
  }
  return {
    name, isNew: meta.isNew, kind: def.placedBy === 'story' ? 'story' : cut ? 'drawn' : 'code',
    def, published: publishedDef, cut, rev: meta.rev, stale, cutChanged, buildError,
  }
}

function parseSource(sourcePng, w, h) {
  if (typeof sourcePng !== 'string' || !sourcePng.startsWith(PNG_PREFIX)) throw fail(400, 'sourcePng must be a data:image/png;base64 URL')
  const buf = Buffer.from(sourcePng.slice(PNG_PREFIX.length), 'base64')
  let png
  try { png = decodePng(buf, 'sourcePng') } catch (e) { throw fail(400, `sourcePng is not a valid PNG: ${e.message}`) }
  if (png.width !== w || png.height !== h) throw fail(400, `source is ${png.width}x${png.height} but the cut is ${w}x${h}`)
  return buf
}
function checkShape(cut) {
  if (!cut || typeof cut !== 'object') throw fail(400, 'body needs a cut')
  const errs = validateCut(cut)
  if (errs.length) throw fail(400, `cut is invalid:\n- ${errs.join('\n- ')}`)
}

export function createDraft(root, { name, cut, sourcePng } = {}) {
  checkNewName(name)
  if (isPublished(root, name)) throw fail(409, `"${name}" is already a monster`)
  if (hasDraft(root, name)) throw fail(409, `"${name}" already has a draft`)
  checkShape(cut)
  const png = parseSource(sourcePng, cut.w, cut.h)
  const f = draftFiles(root, name)
  writeAtomic(f.png, png)
  writeJson(f.cut, { ...cut, name, source: sourceRel(name) })
  writeJson(f.def, newDef(name))
  writeJson(f.meta, { isNew: true, rev: FIRST_REV, base: { def: null, cut: null, png: null } })
  tryBuild(root, name)
  return readDraft(root, name)
}

// Copy the game's files into a fresh draft, replacing any draft there. Every
// check runs before the first write, so a refusal leaves the old draft alone.
function copyFromGame(root, name) {
  const p = pub(root, name), f = draftFiles(root, name)
  const defBuf = readBytes(p.def)
  if (!defBuf) throw fail(404, `no monster "${name}"`)
  const cutBuf = readBytes(p.cut), png = readBytes(p.png)
  const def = JSON.parse(defBuf.toString('utf8')), cut = cutBuf ? JSON.parse(cutBuf.toString('utf8')) : null
  if (cut && !png) throw fail(409, `cut source assets/cuts/${name}.png is missing`)
  const base = { def: sha1(defBuf), cut: cutBuf ? sha1(cutBuf) : null, png: png ? sha1(png) : null }
  fs.rmSync(f.dir, { recursive: true, force: true })
  writeJson(f.def, def)
  if (cut) {
    writeAtomic(f.png, png)
    writeJson(f.cut, { ...cut, source: sourceRel(name) })
  }
  writeJson(f.meta, { isNew: false, rev: FIRST_REV, base })
  if (cut) tryBuild(root, name)
}

// An untouched draft (still at FIRST_REV) follows the game: when the game's
// copy changed since it was made, it is copied again. A draft with edits is
// kept as it is and comes back stale.
export function openDraft(root, name) {
  checkName(name)
  if (hasDraft(root, name)) {
    const v = readDraft(root, name)
    if (!v.stale || v.isNew || v.rev !== FIRST_REV) return v
    try { copyFromGame(root, name) } catch { return v } // the game's copy is gone or broken: keep this one
    return readDraft(root, name)
  }
  copyFromGame(root, name)
  return readDraft(root, name)
}

export function saveDraftCut(root, name, { cut } = {}) {
  const f = requireDraft(root, name)
  const def = readJson(f.def)
  if (def.placedBy === 'story' || !fs.existsSync(f.cut)) throw fail(400, `"${name}" has no cut to edit`)
  checkShape(cut)
  writeJson(f.cut, { ...cut, name, source: sourceRel(name) })
  const rev = bump(f)
  return { rev, buildError: tryBuild(root, name) }
}

export function patchDraftDef(root, name, patch = {}) {
  const f = requireDraft(root, name)
  const def = readJson(f.def)
  const use = def.placedBy === 'story' ? ('params' in patch ? { params: patch.params } : {}) : patch
  writeJson(f.def, mergeDefPatch(def, use))
  return { rev: bump(f) }
}

export function renameDraft(root, name, to) {
  const f = requireDraft(root, name)
  checkNewName(to)
  const meta = readJson(f.meta)
  if (!meta.isNew) throw fail(400, 'only a new drawing can be renamed')
  if (to === name) return readDraft(root, name)
  if (isPublished(root, to) || hasDraft(root, to)) throw fail(409, `"${to}" is already taken`)
  const g = draftFiles(root, to)
  fs.renameSync(f.dir, g.dir)
  for (const ext of ['png', 'js']) fs.rmSync(path.join(g.dir, `${name}-parts.${ext}`), { force: true })
  const def = readJson(g.def), cut = readJson(g.cut)
  def.rig = to
  if ('name' in def) def.name = to
  writeJson(g.def, def)
  if (cut) writeJson(g.cut, { ...cut, name: to, source: sourceRel(to) })
  bump(g)
  if (cut) tryBuild(root, to)
  return readDraft(root, to)
}

export function discardDraft(root, name) {
  const f = requireDraft(root, name)
  fs.rmSync(f.dir, { recursive: true, force: true })
  return { ok: true }
}
