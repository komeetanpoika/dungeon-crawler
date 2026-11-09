// Injected into the mirrored game page (after web-shim.js). Gives the game's
// saveAPI the bench's save hook, routed to the studio draft instead of disk.
const name = /^\/sg\/([^/@]+)/.exec(location.pathname)?.[1]
if (name && window.saveAPI) {
  Object.assign(window.saveAPI, {
    isStudio: true,
    async benchSave(monster, patch) {
      const res = await fetch(`/api/studio/drafts/${encodeURIComponent(name)}/def`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `save failed (${res.status})`)
      return body
    },
  })
}
