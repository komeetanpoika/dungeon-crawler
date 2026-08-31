// tools/monster-lab/io.js
// The lab's ONLY gateway to persistence and module loading. The future
// Electron integration replaces this file with a preload-bridge version
// exposing the same five functions; nothing else in the lab may fetch.
export async function listMonsters() { return (await fetch('/api/monsters')).json() }  // -> {defs, warnings}
export async function saveMonster(name, data) {
  const res = await fetch(`/api/monsters/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) })
  if (!res.ok) throw new Error((await res.json()).error ?? `save failed (${res.status})`)
}
export async function listRigs() { return (await fetch('/api/rigs')).json() }
export function loadRig(rigId) {
  return import(`/renderer/render/monster-rigs/${rigId}.js?t=${Date.now()}`)  // cache-busted for live reload
}
export function onFilesChanged(cb) {
  const es = new EventSource('/api/events')
  es.onmessage = ev => cb(JSON.parse(ev.data))
  return () => es.close()
}
