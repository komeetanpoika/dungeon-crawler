// Pure joystick math for the mobile touch layer. Screen coordinates:
// +x is east, +y is south (down). No DOM, no game imports.

// Drag vector -> movement keys, quantized to 8 sectors of 45°.
export function joystickDirs(dx, dy, deadZone = 12) {
  if (Math.hypot(dx, dy) < deadZone) return []
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4))
  switch (sector) {
    case 0: return ['d']
    case 1: return ['d', 's']
    case 2: return ['s']
    case 3: return ['s', 'a']
    case -1: return ['d', 'w']
    case -2: return ['w']
    case -3: return ['a', 'w']
    default: return ['a'] // sector ±4 (west wraps around atan2's ±π seam)
  }
}

// Which dirs changed between two joystickDirs results.
export function diffDirs(prev, next) {
  return {
    press: next.filter(k => !prev.includes(k)),
    release: prev.filter(k => !next.includes(k)),
  }
}
