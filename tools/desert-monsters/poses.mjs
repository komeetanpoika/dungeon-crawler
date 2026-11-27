// The poses preview.mjs draws for each of the desert's shape-drawn rigs:
// rows of { label, pose, params? }. A pose's fields are those of
// systems/monsters.js entityPose.
const E = 0, S = Math.PI / 2, W = Math.PI, N = -Math.PI / 2
const walk = (facing, t) => ({ label: 'walk', pose: { state: 'walk', facing, t, speed01: 1 } })

export const POSES = {
  scorpion: [
    [{ label: 'idle north', pose: { facing: N } }, { label: 'idle east', pose: { facing: E } },
     { label: 'idle south-east', pose: { facing: Math.PI / 4 } }, { label: 'idle south', pose: { facing: S } },
     { label: 'idle west', pose: { facing: W, t: 0.3 } }],
    [walk(N, 0), walk(N, 0.1), walk(N, 0.2), walk(N, 0.3),
     { label: 'emperor', pose: { facing: N }, params: { scale: 1.8, shellColor: '#2c2a33', clawColor: '#45404e', stingColor: '#c23a2a' } }],
    [{ label: 'buried', pose: { facing: N, sink: 1 } }, { label: 'bursting', pose: { facing: N, sink: 0.5, t: 0.02 } },
     { label: 'rearing', pose: { facing: N, eyeGlow: 0.6 } }, { label: 'struck', pose: { facing: N, eyeGlow: 1 } },
     { label: 'struck east', pose: { facing: E, eyeGlow: 1 } }],
    [{ label: 'pincers wide', pose: { facing: N, state: 'attack', stateT: 0 } }, { label: 'pincers shut', pose: { facing: N, state: 'attack', stateT: 0.13 } },
     { label: 'hit', pose: { facing: N, state: 'hit' } }, { label: 'dying', pose: { facing: N, state: 'death', stateT: 0.1 } },
     { label: 'dead', pose: { facing: N, state: 'death', stateT: 0.4 } }],
  ],
}
