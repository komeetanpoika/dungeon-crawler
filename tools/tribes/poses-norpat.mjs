// The poses tools/desert-monsters/preview.mjs draws for the seal folk's rigs
// (`--poses tools/tribes/poses-norpat.mjs`): rows of { label, pose, params? }.
// A pose's fields are those of systems/monsters.js entityPose, with the
// hooks' channels (sing, doze, winded, air, charge, bellow, laugh) beside them.
const E = 0, W = Math.PI
const trader = { role: 0 }, singer = { role: 1 }, guard = { role: 2 }
const walrus = { role: 3, scale: 2, bodyColor: '#8f5f42', bellyColor: '#c9a17c', accentColor: '#f2c94c' }
const hump = (params, t, facing = E) => ({ label: 'hump', params, pose: { state: 'walk', speed01: 1, t, facing } })

export const POSES = {
  seal: [
    [{ label: 'trader', params: trader, pose: {} }, { label: 'trader west', params: trader, pose: { facing: W } },
     { label: 'singer', params: singer, pose: {} }, { label: 'guard', params: guard, pose: {} }, { label: 'guard west', params: guard, pose: { facing: W } },
     { label: 'blink', params: trader, pose: { t: 2.1 } }],
    [hump(trader, 0), hump(trader, 0.09), hump(trader, 0.17), hump(trader, 0.26), hump(guard, 0.17, W), hump(singer, 0.09)],
    [{ label: 'singing', params: singer, pose: { sing: 1, t: 0 } }, { label: 'singing 2', params: singer, pose: { sing: 1, t: 0.5 } },
     { label: 'dozing', params: singer, pose: { doze: 1, t: 0.4 } }, { label: 'dozing west', params: singer, pose: { doze: 1, t: 1.3, facing: W } },
     { label: 'arm back', params: guard, pose: { eyeGlow: 0.5 } }, { label: 'thrown', params: guard, pose: { eyeGlow: 1 } }],
    [{ label: 'trader hit', params: trader, pose: { state: 'hit' } }, { label: 'trader dead', params: trader, pose: { state: 'death', stateT: 0.3 } },
     { label: 'singer dead', params: singer, pose: { state: 'death', stateT: 0.3 } }, { label: 'guard dead', params: guard, pose: { state: 'death', stateT: 0.3 } },
     { label: 'arm back west', params: guard, pose: { eyeGlow: 0.9, facing: W } }, { label: 'guard hit', params: guard, pose: { state: 'hit' } }],
    [{ label: 'walrus', params: walrus, pose: {} }, { label: 'walrus west', params: walrus, pose: { facing: W, t: 0.7 } },
     hump(walrus, 0), hump(walrus, 0.2), hump(walrus, 0.3), { label: 'laughing', params: walrus, pose: { laugh: 1, t: 0.06 } }],
    [{ label: 'rearing', params: walrus, pose: { eyeGlow: 0.5 } }, { label: 'reared', params: walrus, pose: { eyeGlow: 1 } },
     { label: 'in the air', params: walrus, pose: { air: 1 } }, { label: 'coming down', params: walrus, pose: { air: 0.4 } },
     { label: 'bellow', params: walrus, pose: { bellow: 1 } }, { label: 'winded', params: walrus, pose: { winded: 1, t: 0.2 } }],
    [{ label: 'head down', params: walrus, pose: { charge: 1, eyeGlow: 0.6 } }, { label: 'charging west', params: walrus, pose: { charge: 1, eyeGlow: 1, facing: W, state: 'walk', speed01: 1 } },
     { label: 'winded 2', params: walrus, pose: { winded: 1, t: 0.55 } }, { label: 'walrus hit', params: walrus, pose: { state: 'hit' } },
     { label: 'walrus dead', params: walrus, pose: { state: 'death', stateT: 0.3 } }, { label: 'walrus asleep', params: walrus, pose: { doze: 1, t: 0.8 } }],
  ],
  gong: [
    [{ label: 'still', pose: {} }, { label: 'rung', pose: { flicker: 1, t: 0.03 } }, { label: 'swinging back', pose: { flicker: 0.7, t: 0.16 } },
     { label: 'dying away', pose: { flicker: 0.25, t: 0.4 } }, { label: 'hit', pose: { state: 'hit' } }],
  ],
}
