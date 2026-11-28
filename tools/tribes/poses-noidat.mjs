// The poses tools/desert-monsters/preview.mjs draws for the coven's rigs
// (`--poses tools/tribes/poses-noidat.mjs`): rows of { label, pose, params? }.
// A pose's fields are those of systems/monsters.js entityPose plus the rig's
// own channels (render/monster-rigs/crone.js, para.js, viper.js).
const E = 0, S = Math.PI / 2, W = Math.PI, N = -Math.PI / 2
const walk = (t, facing = E, more = {}) => ({ label: `walk ${t}`, pose: { state: 'walk', facing, t, speed01: 1, ...more } })

// the three women as their defs dress them (data/monsters/noita.json, kuppari.json, syojatar.json)
const KUPPARI = { role: 1, dressColor: '#5b3a2e', shawlColor: '#c9703a', scarfColor: '#e8e2d0', gearColor: '#d9c08a', skinColor: '#c9a07e' }
const SYO = { role: 2, scale: 2, dressColor: '#2a2233', shawlColor: '#5a2a4a', skinColor: '#aab59a' }
const as = (params, row) => row.map(c => ({ ...c, params: { ...params, ...(c.params ?? {}) } }))

export const POSES = {
  crone: [
    // the witch
    [{ label: 'witch', pose: { t: 0 } }, { label: 'witch west', pose: { facing: W, t: 0.4 } }, walk(0), walk(0.17), walk(0.34), walk(0.5)],
    [{ label: 'pointing', pose: { eyeGlow: 0.4 } }, { label: 'pointing', pose: { eyeGlow: 0.95, t: 0.1 } }, { label: 'pointing west', pose: { eyeGlow: 0.95, facing: W } },
     { label: 'knit a', pose: { knit: 1, t: 0 } }, { label: 'knit b', pose: { knit: 1, t: 0.13 } }, { label: 'knit c', pose: { knit: 1, t: 0.7 } }],
    // the kuppari
    as(KUPPARI, [{ label: 'kuppari', pose: { t: 0 } }, walk(0.17), { label: 'cupping', pose: { cup: 1, t: 0 } }, { label: 'cupping', pose: { cup: 1, t: 0.07, facing: W } },
      { label: 'hit', pose: { state: 'hit' } }, { label: 'dying', pose: { state: 'death', stateT: 0.1 } }]),
    [{ label: 'witch hit', pose: { state: 'hit' } }, { label: 'witch dying', pose: { state: 'death', stateT: 0.1 } }, { label: 'witch dead', pose: { state: 'death', stateT: 0.4 } },
     ...as(KUPPARI, [{ label: 'kuppari dead', pose: { state: 'death', stateT: 0.4, facing: W } }])],
    // Syöjätär
    as(SYO, [{ label: 'Syojatar', pose: { t: 0 } }, walk(0.17), { label: 'head back', pose: { eyeGlow: 0.7, t: 0.2 } }, { label: 'spits', pose: { eyeGlow: 1, t: 0.3 } }]),
    as(SYO, [{ label: 'screams', pose: { scream: 1, t: 0 } }, { label: 'points (the fan)', pose: { point: 0.95, t: 0.1 } }, { label: 'hit', pose: { state: 'hit' } },
      { label: 'dead', pose: { state: 'death', stateT: 0.4 } }]),
  ],
  para: [
    [{ label: 'para', pose: { t: 0 } }, { label: 'west', pose: { facing: W, t: 0.5 } }, walk(0), walk(0.04), walk(0.08), walk(0.12)],
    [{ label: 'carrying', pose: { carry: 1 } }, walk(0, E, { carry: 1 }), walk(0.04, W, { carry: 1 }), { label: 'cowering', pose: { cower: 1, carry: 1, t: 0 } },
     { label: 'cowering', pose: { cower: 1, t: 0.06 } }, { label: 'raspberry', pose: { raspberry: 1 } }],
    [{ label: 'hit', pose: { state: 'hit' } }, { label: 'dying', pose: { state: 'death', stateT: 0.1 } }, { label: 'dead', pose: { state: 'death', stateT: 0.4 } }],
  ],
  viper: [
    [{ label: 'north', pose: { facing: N } }, { label: 'east', pose: { facing: E, t: 0.4 } }, { label: 'south-east', pose: { facing: Math.PI / 4, t: 0.8 } },
     { label: 'south', pose: { facing: S, t: 1.1 } }, { label: 'west', pose: { facing: W, t: 1.5 } }],
    [walk(0, N), walk(0.06, N), walk(0.12, N), walk(0.18, N), walk(0.24, N)],
    [{ label: 'coiling', pose: { facing: N, eyeGlow: 0.4 } }, { label: 'coiled', pose: { facing: N, eyeGlow: 0.9 } }, { label: 'strike', pose: { facing: N, eyeGlow: 1 } },
     { label: 'strike east', pose: { facing: E, eyeGlow: 1 } }, { label: 'hit', pose: { facing: N, state: 'hit' } }],
    [{ label: 'dying', pose: { facing: N, state: 'death', stateT: 0.1 } }, { label: 'dead', pose: { facing: N, state: 'death', stateT: 0.4 } }],
  ],
}
