// The studio's cut autosave (pure, no DOM): debounced, one save in flight,
// saves land in order. A failed save is kept, never dropped: the next edit
// supersedes it (a cut is a whole snapshot) or the next flush retries it, and
// flush rejects while it stays unsaved. Only reset() (the user chose to leave
// the monster) throws it away.
export function makeAutosave({ save, delay = 600, onChange = () => {}, onError = () => {} }) {
  let timer = null, job = null, failed = null, inflight = null, error = null, gen = 0

  function queue(name, cut) {
    job = { name, cut }
    failed = null
    clearTimeout(timer)
    timer = setTimeout(() => { timer = null; drain() }, delay)
    onChange()
  }
  function drain() {
    if (inflight || timer || !job) return
    inflight = (async () => {
      while (job && !timer) {
        const take = job, g = gen
        job = null
        try {
          await save(take)
          if (g === gen) error = null
        } catch (err) {
          if (g !== gen) break // reset while it was in flight: the user left it
          error = err?.message ?? String(err)
          if (!job) failed = take // a newer cut queued meanwhile supersedes it
          onError(err, take)
          break // no automatic retry loop: the next edit or flush retries
        }
      }
    })().finally(() => { inflight = null; onChange(); drain() })
    onChange()
  }
  // Send what is waiting now; rejects (err.job = the unsaved job) when it can't be saved.
  async function flush() {
    if (timer) { clearTimeout(timer); timer = null }
    if (!job && failed) { job = failed; failed = null }
    drain()
    while (inflight) await inflight
    if (failed) throw Object.assign(new Error(error), { job: failed })
  }
  function reset() {
    clearTimeout(timer)
    timer = job = failed = error = null
    gen++
    onChange()
  }
  return {
    queue, flush, reset,
    pending: () => !!(timer || inflight),
    unsaved: () => !!(timer || inflight || job || failed),
    get error() { return error },
  }
}
