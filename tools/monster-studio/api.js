// The studio page's HTTP client: one function per route in studio-routes.js.
// Each resolves to the JSON body; a non-OK answer rejects with
// Error(body.error) carrying .status and .body (a stale publish has body.stale).
const enc = encodeURIComponent
const draft = name => `/api/studio/drafts/${enc(name)}`

async function call(method, url, body) {
  const init = { method }
  if (body !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body) }
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status, body: data })
  return data
}

export const listMonsters = () => call('GET', '/api/studio/monsters')
export const suggestName = base => call('GET', `/api/studio/suggest-name?base=${enc(base)}`)
export const createDraft = ({ name, cut, sourcePng }) => call('POST', '/api/studio/drafts', { name, cut, sourcePng })
export const openDraft = name => call('POST', `${draft(name)}/open`)
export const readDraft = name => call('GET', draft(name))
export const saveCut = (name, cut) => call('PUT', `${draft(name)}/cut`, { cut })
export const patchDef = (name, patch) => call('PATCH', `${draft(name)}/def`, patch)
export const renameDraft = (name, to) => call('POST', `${draft(name)}/rename`, { to })
export const discardDraft = name => call('DELETE', draft(name))
export const publish = (name, { force = false } = {}) => call('POST', `${draft(name)}/publish`, { force })

// The draft's source image, for an <img>; rev busts the cache after a reopen.
export const sourcePngUrl = (name, rev) => `${draft(name)}/source.png?rev=${enc(rev)}`
