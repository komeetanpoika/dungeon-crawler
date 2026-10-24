// tools/monster-lab/save-body.js
// The def body the lab's Save writes. The lab edits rig, params, stats,
// behavior, spawn and hooks; every other field it loaded (the bench's
// tuning, anything added later) rides along in work.extra untouched.
export function saveBody(work) {
  const { name, spawn: _spawn, hooks: _hooks, ...extra } = work.extra ?? {}
  const { rigId, params, stats, behavior, spawn, hooks } = work
  return { ...extra, rig: rigId, params, stats, behavior,
           ...(spawn?.depths ? { spawn } : {}), ...(hooks ? { hooks: true } : {}) }
}
