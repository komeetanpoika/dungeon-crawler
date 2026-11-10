// HTTP handlers for the cutter, mounted by the monster lab server.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { decodePng } from '../png-read.mjs'
import { buildCut, checkCut } from './build-cut.js'
import { cutStatus, installCut, checkInstall } from './install-cut.js'

const { NAME_RE, RESERVED_NAMES } = createRequire(import.meta.url)('../monster-lab/monster-files.cjs')
const PNG_PREFIX = 'data:image/png;base64,'

// Returns true when it handled the request.
export function handleCutRoute({ req, res, u, send, cutsRoot }) {
  const json = (code, obj) => send(code, JSON.stringify(obj))
  if (u.pathname === '/cutter' && req.method === 'GET') {
    res.writeHead(302, { Location: '/studio' }); res.end()
    return true
  }
  if (u.pathname === '/api/cuts' && req.method === 'GET') {
    let names = []
    try { names = fs.readdirSync(path.join(cutsRoot, 'assets/cuts')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort() } catch { /* none yet */ }
    json(200, names)
    return true
  }
  const m = /^\/api\/cuts\/([^/]+?)(\/status)?$/.exec(u.pathname)
  if (!m) return false
  let name
  try { name = decodeURIComponent(m[1]) } catch { name = '' }
  const isStatus = !!m[2]
  if (isStatus && req.method === 'GET') {
    if (!NAME_RE.test(name)) json(400, { error: 'invalid name' })
    else {
      try { json(200, cutStatus({ root: cutsRoot, name })) }
      catch (err) { json(err.status ?? 500, { error: err.message }) }
    }
    return true
  }
  if (!isStatus && req.method === 'PUT') {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      try { json(200, saveCut({ cutsRoot, name, body })) }
      catch (err) {
        json(err.status ?? 500, err.needsSwitch ? { error: err.message, needsSwitch: true } : { error: err.message })
      }
    })
    return true
  }
  return false
}

const bad = msg => Object.assign(new Error(msg), { status: 400 })

function saveCut({ cutsRoot, name, body }) {
  if (!NAME_RE.test(name)) throw bad('invalid name')
  if (name === 'index') throw bad('monster name "index" is reserved for the index file')
  if (RESERVED_NAMES.has(name)) throw bad(`monster name "${name}" is reserved for a built-in type`)
  let parsed
  try { parsed = JSON.parse(body) } catch { throw bad('body is not valid JSON') }
  const { cut, sourcePng, switchRig } = parsed ?? {}
  if (!cut || typeof cut !== 'object') throw bad('body needs a cut')
  const dir = path.join(cutsRoot, 'assets/cuts')
  const pngRel = `assets/cuts/${name}.png`
  if (sourcePng !== undefined && (typeof sourcePng !== 'string' || !sourcePng.startsWith(PNG_PREFIX)))
    throw bad('sourcePng must be a data:image/png;base64 URL')
  if (sourcePng === undefined && !fs.existsSync(path.join(cutsRoot, cut.source ?? '')))
    throw bad('no sourcePng given and the cut source does not exist')
  const full = { ...cut, name, ...(sourcePng !== undefined ? { source: pngRel } : {}) }
  checkCut(full, name) // a refused save must not touch the last good cut
  // a given source must stay inside the cuts dir
  if (path.resolve(cutsRoot, full.source).startsWith(path.resolve(cutsRoot) + path.sep) === false) throw bad('source path escapes the project')
  // decide everything before the first write: the rig/def refusals and the source's validity
  checkInstall({ root: cutsRoot, name, switchRig: !!switchRig })
  let pngBuf
  if (sourcePng !== undefined) {
    pngBuf = Buffer.from(sourcePng.slice(PNG_PREFIX.length), 'base64')
    let png
    try { png = decodePng(pngBuf, 'sourcePng') } catch (e) { throw bad(`sourcePng is not a valid PNG: ${e.message}`) }
    if (png.width !== full.w || png.height !== full.h) throw bad(`source is ${png.width}x${png.height} but the cut is ${full.w}x${full.h}`)
  }
  fs.mkdirSync(dir, { recursive: true })
  if (pngBuf) fs.writeFileSync(path.join(cutsRoot, pngRel), pngBuf)
  fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(full))
  buildCut({ root: cutsRoot, name }) // before install: the rig module imports -parts.js
  return { ok: true, ...installCut({ root: cutsRoot, name, switchRig: !!switchRig }) }
}
