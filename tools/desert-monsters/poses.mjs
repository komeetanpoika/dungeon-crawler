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
  sandworm: [
    [{ label: 'mound', pose: { sink: 1 } }, { label: 'mound + furrow', pose: { sink: 1, t: 0.4, trail: [{ x: 24, y: 2, a: 0.9 }, { x: 46, y: 6, a: 0.6 }, { x: 66, y: 12, a: 0.3 }] } },
     { label: 'tell early', pose: { sink: 1, flicker: 0.3, t: 0.1 } }, { label: 'tell late', pose: { sink: 1, flicker: 1, t: 0.2 } }],
    [{ label: 'rising 1', pose: { sink: 0.75 } }, { label: 'rising 2', pose: { sink: 0.5 } }, { label: 'rising 3', pose: { sink: 0.25, t: 0.5 } }, { label: 'up', pose: { sink: 0, t: 1 } }],
    [{ label: 'up sway', pose: { sink: 0, t: 2.2 } }, { label: 'bite east', pose: { sink: 0, eyeGlow: 1, facing: 0, t: 1 } }, { label: 'bite west', pose: { sink: 0, eyeGlow: 1, facing: Math.PI, t: 1 } },
     { label: 'hit', pose: { sink: 0, state: 'hit', t: 1 } }],
    [{ label: 'dying', pose: { sink: 0, state: 'death', stateT: 0.2, t: 1 } }, { label: 'dead', pose: { sink: 0, state: 'death', stateT: 0.45, t: 1 } },
     { label: 'tall', pose: { sink: 0, t: 1 }, params: { height: 2.6, girth: 1 } }],
  ],
  antlion: [
    [{ label: 'buried', pose: { sink: 1, t: 0 } }, { label: 'buried, sand sliding', pose: { sink: 1, t: 0.7 } }, { label: 'head up', pose: { sink: 0, t: 0.2 } }],
    [{ label: 'winding up', pose: { sink: 0, eyeGlow: 0.9, t: 0.1 } }, { label: 'snap', pose: { sink: 0, flicker: 1, t: 0.3 } }, { label: 'hit', pose: { sink: 0, state: 'hit' } }],
    [{ label: 'filling in', pose: { sink: 1, burn: 0.5 } }, { label: 'dying', pose: { sink: 0, state: 'death', stateT: 0.25 } }, { label: 'gone', pose: { sink: 1, state: 'death', stateT: 0.65 } }],
  ],
}
