// HTTP routes of the Monster Studio, mounted by the monster lab server.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listStudio, suggestName, createDraft, openDraft, readDraft, saveDraftCut, patchDraftDef,
         renameDraft, discardDraft, draftDir } from './drafts.js'
import { publishDraft } from './publish.js'
import { resolveGameFile } from './game-overlay.js'

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html')

function readBody(req) {
  return new Promise(resolve => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => resolve(body))
  })
}
async function jsonBody(req) {
  const text = await readBody(req)
  if (text.trim() === '') return {}
  try { return JSON.parse(text) } catch { throw Object.assign(new Error('body is not valid JSON'), { status: 400 }) }
}

// A studio write must come from a page on this machine's lab server. A web
// page elsewhere can send a "simple" cross-site POST (text/plain, no
// preflight), so every non-GET checks the Host header (no DNS-rebound names)
// and the Origin header when the browser sends one. Any port is fine.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const hostnameOf = url => { try { return new URL(url).hostname } catch { return null } }
export function isLocalRequest(headers = {}) {
  if (typeof headers.host !== 'string' || !LOCAL_HOSTS.has(hostnameOf(`http://${headers.host}`))) return false
  return headers.origin === undefined || LOCAL_HOSTS.has(hostnameOf(headers.origin))
}

// Returns true when it handled the request.
export function handleStudioRoute({ req, res, u, send, root, projectRoot }) {
  const json = (code, obj) => send(code, JSON.stringify(obj))
  const m = req.method, p = u.pathname
  const run = fn => {
    Promise.resolve().then(fn).then(
      out => { if (out !== undefined) json(out.__status ?? 200, out.__status ? out.body : out) },
      err => json(err.status ?? 500, err.stale ? { error: err.message, stale: true } : { error: err.message }))
    return true
  }

  if (p === '/studio' && m === 'GET') {
    fs.readFile(PAGE, (err, data) => err ? send(404, 'not found', 'text/plain') : send(200, data, 'text/html'))
    return true
  }

  const sg = /^\/sg\/([^/@]+)(?:@[^/]*)?\/(.*)$/.exec(p)
  if (sg && (m === 'GET' || m === 'HEAD')) {
    let name
    try { name = decodeURIComponent(sg[1]) } catch { name = '' }
    const hit = resolveGameFile({ root, projectRoot, name, rel: sg[2] })
    if (!hit) { send(404, 'not found', 'text/plain'); return true }
    res.writeHead(200, { 'Content-Type': hit.type, 'Cache-Control': 'no-store' })
    res.end(hit.body)
    return true
  }

  if (!p.startsWith('/api/studio/')) return false
  if (m !== 'GET' && m !== 'HEAD' && !isLocalRequest(req.headers)) { json(403, { error: 'cross-site request refused' }); return true }
  if (p === '/api/studio/monsters' && m === 'GET') return run(() => listStudio(projectRoot))
  if (p === '/api/studio/suggest-name' && m === 'GET') return run(() => ({ name: suggestName(projectRoot, u.searchParams.get('base') ?? '') }))
  if (p === '/api/studio/drafts' && m === 'POST')
    return run(async () => ({ __status: 201, body: createDraft(projectRoot, await jsonBody(req)) }))

  const d = /^\/api\/studio\/drafts\/([^/]+)(?:\/(open|source\.png|cut|def|rename|publish))?$/.exec(p)
  if (!d) return false
  let name
  try { name = decodeURIComponent(d[1]) } catch { name = '' }
  const act = d[2]
  if (!act && m === 'GET') return run(() => readDraft(projectRoot, name))
  if (!act && m === 'DELETE') return run(() => discardDraft(projectRoot, name))
  if (act === 'open' && m === 'POST') return run(() => openDraft(projectRoot, name))
  if (act === 'source.png' && m === 'GET') {
    let buf = null
    try { readDraft(projectRoot, name); buf = fs.readFileSync(path.join(draftDir(projectRoot, name), 'source.png')) } catch { /* 404 */ }
    if (!buf) send(404, 'not found', 'text/plain')
    else send(200, buf, 'image/png')
    return true
  }
  if (act === 'cut' && m === 'PUT') return run(async () => saveDraftCut(projectRoot, name, await jsonBody(req)))
  if (act === 'def' && m === 'PATCH') return run(async () => patchDraftDef(projectRoot, name, await jsonBody(req)))
  if (act === 'rename' && m === 'POST') return run(async () => renameDraft(projectRoot, name, (await jsonBody(req)).to))
  if (act === 'publish' && m === 'POST') return run(async () => publishDraft(projectRoot, name, { force: !!(await jsonBody(req)).force }))
  return false
}
