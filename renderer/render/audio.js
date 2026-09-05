// Web Audio engine — drains state.sfx cues and synthesizes them.
// The ONLY file that touches Web Audio. Never imported from systems/.
// Pure exports up top (recipes + spatial math) are node-tested; the
// engine below runs only in the real browser/Electron.

export const TILE_SIZE = 32
export const NEAR_PX = TILE_SIZE * 4    // full volume inside this
export const FAR_PX = TILE_SIZE * 14    // silent beyond this
export const PAN_MAX = 0.7
export const THROTTLE_S = 0.05          // per-name minimum gap
export const MAX_VOICES = 12
export const MASTER_VOL = 0.5

// One declarative recipe per cue. kind picks the synth building block:
//   blip   — oscillator, pitch sweeps f0→f1 (wave: square|triangle)
//   burst  — white noise through a bandpass at freq (q = resonance)
//   swoosh — white noise through a bandpass sweeping f0→f1
//   rumble — low sine at freq + filtered noise, longer decay
export const RECIPES = {
  'melee-swing':    { kind: 'swoosh', f0: 900,  f1: 300,  dur: 0.12, vol: 0.5 },
  'melee-hit':      { kind: 'burst',  freq: 700,  q: 1.2,  dur: 0.09, vol: 0.9 },
  'ranged-shot':    { kind: 'swoosh', f0: 1400, f1: 2200, dur: 0.10, vol: 0.5 },
  'projectile-hit': { kind: 'burst',  freq: 900,  q: 1.5,  dur: 0.08, vol: 0.8 },
  'magic-cast':     { kind: 'swoosh', f0: 400,  f1: 1600, dur: 0.25, vol: 0.6 },
  'fire-burst':     { kind: 'rumble', freq: 90,  dur: 0.50, vol: 1.0 },
  'shockwave':      { kind: 'rumble', freq: 70,  dur: 0.35, vol: 0.9 },
  'wall-slam':      { kind: 'burst',  freq: 180,  q: 0.9,  dur: 0.16, vol: 1.0 },
  'player-hurt':    { kind: 'burst',  freq: 250,  q: 0.8,  dur: 0.15, vol: 1.0 },
  'player-death':   { kind: 'blip',   wave: 'square',   f0: 440,  f1: 55,   dur: 0.80, vol: 1.0 },
  'enemy-death':    { kind: 'blip',   wave: 'square',   f0: 330,  f1: 90,   dur: 0.25, vol: 0.7 },
  'boss-death':     { kind: 'rumble', freq: 55,  dur: 1.20, vol: 1.0 },
  'pickup':         { kind: 'blip',   wave: 'square',   f0: 660,  f1: 990,  dur: 0.09, vol: 0.6 },
  'key-pickup':     { kind: 'blip',   wave: 'triangle', f0: 660,  f1: 1320, dur: 0.18, vol: 0.7 },
  'heal':           { kind: 'blip',   wave: 'triangle', f0: 440,  f1: 880,  dur: 0.20, vol: 0.6 },
  'equip':          { kind: 'blip',   wave: 'square',   f0: 550,  f1: 660,  dur: 0.07, vol: 0.5 },
  'drop':           { kind: 'blip',   wave: 'square',   f0: 440,  f1: 330,  dur: 0.08, vol: 0.5 },
  'gate-open':      { kind: 'rumble', freq: 80,  dur: 0.80, vol: 0.9 },
  'door-locked':    { kind: 'blip',   wave: 'square',   f0: 220,  f1: 180,  dur: 0.15, vol: 0.6 },
  'descend':        { kind: 'rumble', freq: 65,  dur: 0.90, vol: 0.8 },
  'emerge':         { kind: 'blip',   wave: 'triangle', f0: 330,  f1: 660,  dur: 0.40, vol: 0.6 },
  'door-open':      { kind: 'burst',  freq: 200,  q: 1.5,  dur: 0.12, vol: 0.6 },
  'stance-switch':  { kind: 'blip',   wave: 'triangle', f0: 500,  f1: 750,  dur: 0.10, vol: 0.5 },
  'talent-learned': { kind: 'blip',   wave: 'triangle', f0: 523,  f1: 1046, dur: 0.50, vol: 0.7 },
  'rite':           { kind: 'rumble', freq: 100, dur: 1.00, vol: 0.7 },
  'ui-open':        { kind: 'blip',   wave: 'square',   f0: 500,  f1: 620,  dur: 0.06, vol: 0.4 },
  'ui-close':       { kind: 'blip',   wave: 'square',   f0: 620,  f1: 500,  dur: 0.06, vol: 0.4 },
  'ui-move':        { kind: 'blip',   wave: 'square',   f0: 700,  f1: 700,  dur: 0.03, vol: 0.3 },
  'npc-chicken':    { kind: 'blip',   wave: 'square',   f0: 880,  f1: 1320, dur: 0.10, vol: 0.5 },
  'npc-deer':       { kind: 'swoosh', f0: 600,  f1: 200,  dur: 0.18, vol: 0.4 },
  'npc-mouse':      { kind: 'blip',   wave: 'triangle', f0: 1500, f1: 2200, dur: 0.06, vol: 0.4 },
  'npc-hurt':       { kind: 'burst',  freq: 500,  q: 1.0,  dur: 0.08, vol: 0.6 },
  'npc-death':      { kind: 'blip',   wave: 'triangle', f0: 600,  f1: 200,  dur: 0.20, vol: 0.5 },
  'npc-wrath':      { kind: 'rumble', freq: 110, dur: 0.60, vol: 0.8 },
  'chop':           { kind: 'burst',  freq: 320,  q: 2.0,  dur: 0.10, vol: 0.8 },
  'tree-fall':      { kind: 'rumble', freq: 75,  dur: 0.60, vol: 0.9 },
  'campfire-light': { kind: 'swoosh', f0: 300,  f1: 1200, dur: 0.30, vol: 0.5 },
  'campfire-out':   { kind: 'blip',   wave: 'triangle', f0: 400,  f1: 150,  dur: 0.30, vol: 0.4 },
  'sizzle':         { kind: 'burst',  freq: 2400, q: 0.5,  dur: 0.35, vol: 0.5 },
  'grey-fire':      { kind: 'swoosh', f0: 200, f1: 900, dur: 0.45, vol: 0.5 },
  // Call Lightning: the strike is a long low roll, the mark a short fizz.
  'thunder':        { kind: 'rumble', freq: 50,  dur: 0.60, vol: 1.0 },
  'crackle':        { kind: 'burst',  freq: 3000, q: 0.6,  dur: 0.10, vol: 0.5 },
  'leap':           { kind: 'swoosh', f0: 200,  f1: 1800, dur: 0.60, vol: 0.7 },
  'echo':           { kind: 'blip',   wave: 'triangle', f0: 880, f1: 660, dur: 0.12, vol: 0.35 },
  'bell':           { kind: 'blip',   wave: 'triangle', f0: 1320, f1: 1300, dur: 0.90, vol: 0.7 },
  'drag':           { kind: 'rumble', freq: 60,  dur: 0.30, vol: 0.8 },
  'sink':           { kind: 'swoosh', f0: 500, f1: 120, dur: 0.45, vol: 0.5 },
  'erupt':          { kind: 'rumble', freq: 85,  dur: 0.40, vol: 0.9 },
  'wraith-touch':   { kind: 'swoosh', f0: 900,  f1: 200,  dur: 0.20, vol: 0.3 },
  'wraith-burn':    { kind: 'burst', freq: 1800, q: 0.7, dur: 0.30, vol: 0.35 },
}

export function falloffGain(distPx) {
  if (distPx <= NEAR_PX) return 1
  if (distPx >= FAR_PX) return 0
  return (FAR_PX - distPx) / (FAR_PX - NEAR_PX)
}

export function panFor(dxPx) {
  return Math.max(-1, Math.min(1, dxPx / FAR_PX)) * PAN_MAX
}

// ---------------------------------------------------------------------------
// Runtime engine — everything below needs a real AudioContext.

export function makeAudio() {
  const audio = {
    ctx: null, master: null, noiseBuf: null,
    files: {},          // name -> AudioBuffer (registered overrides)
    lastPlayed: {},     // name -> ctx.currentTime of last play
    voices: [],         // active { stop } handles, oldest first
    warned: {},         // name -> true (one warning per unknown cue)
    muted: false,
    disabled: false,
  }
  const unlock = () => {
    ensureCtx(audio)
    audio.ctx?.resume?.()
    window.removeEventListener('keydown', unlock)
    window.removeEventListener('pointerdown', unlock)
  }
  window.addEventListener('keydown', unlock)
  window.addEventListener('pointerdown', unlock)
  return audio
}

function ensureCtx(audio) {
  if (audio.ctx || audio.disabled) return
  try {
    audio.ctx = new AudioContext()
    audio.master = audio.ctx.createGain()
    audio.master.gain.value = audio.muted ? 0 : MASTER_VOL
    audio.master.connect(audio.ctx.destination)
    const len = audio.ctx.sampleRate           // 1 s of white noise, shared
    audio.noiseBuf = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate)
    const data = audio.noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  } catch (err) {
    console.warn('audio disabled:', err)
    audio.disabled = true
  }
}

export async function registerFile(audio, name, arrayBuffer) {
  ensureCtx(audio)
  if (audio.disabled) return
  try {
    audio.files[name] = await audio.ctx.decodeAudioData(arrayBuffer)
  } catch (err) {
    console.warn('sfx: failed to decode file for "' + name + '":', err)
  }
}

export function playCues(audio, cues, player, muted = false) {
  if (audio.disabled) return
  if (muted !== audio.muted) {
    audio.muted = muted
    if (audio.master) {                        // ~20 ms ramp, no clicks
      const t = audio.ctx.currentTime
      audio.master.gain.cancelScheduledValues(t)
      audio.master.gain.setValueAtTime(audio.master.gain.value, t)
      audio.master.gain.linearRampToValueAtTime(muted ? 0 : MASTER_VOL, t + 0.02)
    }
  }
  if (!cues.length || muted) return
  ensureCtx(audio)
  if (!audio.ctx || audio.ctx.state !== 'running') return   // pre-unlock: drop
  for (const cue of cues) {
    try { playCue(audio, cue, player) }
    catch (err) { console.warn(`sfx "${cue.name}" failed:`, err) }
  }
}

function playCue(audio, cue, player) {
  const recipe = RECIPES[cue.name]
  if (!audio.files[cue.name] && !recipe) {
    if (!audio.warned[cue.name]) {
      console.warn(`sfx: no recipe for cue "${cue.name}"`)
      audio.warned[cue.name] = true
    }
    return
  }
  const now = audio.ctx.currentTime
  if (now - (audio.lastPlayed[cue.name] ?? -Infinity) < THROTTLE_S) return

  let gain = 1, pan = 0
  if (cue.px !== undefined && player) {
    const dx = cue.px - player.px, dy = cue.py - player.py
    gain = falloffGain(Math.hypot(dx, dy))
    if (gain <= 0) return
    pan = panFor(dx)
  }
  audio.lastPlayed[cue.name] = now
  while (audio.voices.length >= MAX_VOICES) audio.voices.shift().stop()

  const out = audio.ctx.createGain()
  const panner = audio.ctx.createStereoPanner()
  panner.pan.value = pan
  out.connect(panner)
  panner.connect(audio.master)

  const file = audio.files[cue.name]
  const stop = file
    ? playFile(audio, file, out, gain)
    : playRecipe(audio, recipe, out, gain)
  const handle = { stop }
  audio.voices.push(handle)
  const dur = file ? file.duration : recipe.dur
  setTimeout(() => {
    const i = audio.voices.indexOf(handle)
    if (i !== -1) audio.voices.splice(i, 1)
  }, dur * 1000 + 100)
}

function playFile(audio, buffer, out, gain) {
  const src = audio.ctx.createBufferSource()
  src.buffer = buffer
  out.gain.value = gain
  src.connect(out)
  src.start()
  return () => { try { src.stop() } catch {} }
}

const jitter = () => 0.95 + Math.random() * 0.1   // ±5 % pitch variance

function playRecipe(audio, r, out, gain) {
  const ctx = audio.ctx
  const t0 = ctx.currentTime
  const t1 = t0 + r.dur
  const j = jitter()
  out.gain.setValueAtTime(gain * r.vol, t0)
  out.gain.exponentialRampToValueAtTime(0.001, t1)
  const started = []

  if (r.kind === 'blip') {
    const osc = ctx.createOscillator()
    osc.type = r.wave
    osc.frequency.setValueAtTime(r.f0 * j, t0)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, r.f1 * j), t1)
    osc.connect(out)
    osc.start(t0); osc.stop(t1)
    started.push(osc)
  } else if (r.kind === 'burst' || r.kind === 'swoosh') {
    const src = ctx.createBufferSource()
    src.buffer = audio.noiseBuf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = r.q ?? 1
    if (r.kind === 'burst') bp.frequency.setValueAtTime(r.freq * j, t0)
    else {
      bp.frequency.setValueAtTime(r.f0 * j, t0)
      bp.frequency.exponentialRampToValueAtTime(Math.max(1, r.f1 * j), t1)
    }
    src.connect(bp); bp.connect(out)
    src.start(t0); src.stop(t1)
    started.push(src)
  } else if (r.kind === 'rumble') {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(r.freq * j, t0)
    const noise = ctx.createBufferSource()
    noise.buffer = audio.noiseBuf
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = r.freq * 4
    osc.connect(out)
    noise.connect(lp); lp.connect(out)
    osc.start(t0); osc.stop(t1)
    noise.start(t0); noise.stop(t1)
    started.push(osc, noise)
  }
  return () => started.forEach(n => { try { n.stop() } catch {} })
}
