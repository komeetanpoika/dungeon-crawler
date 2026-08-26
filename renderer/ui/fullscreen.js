// Mobile fullscreen: on touch devices whose browser supports the Fullscreen
// API (Android; iPadOS), the first tap anywhere promotes the page to
// fullscreen and locks landscape. iPhone Safari has no element fullscreen —
// there the manifest + apple meta tags cover it via "Add to Home Screen",
// and an installed PWA is already fullscreen, so both cases gate to a no-op.
// Desktop (fine pointer) is untouched.

export function shouldRequestFullscreen({ coarse, supported, active, standalone }) {
  return coarse && supported && !active && !standalone
}

export function initFullscreen(win = window, doc = document) {
  const state = () => ({
    coarse: win.matchMedia('(pointer: coarse)').matches,
    supported: typeof doc.documentElement.requestFullscreen === 'function',
    active: doc.fullscreenElement != null,
    standalone: win.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches,
  })

  // pointerup, not pointerdown: for touch input the browser grants user
  // activation only when the finger lifts, and requestFullscreen is refused
  // without it.
  doc.addEventListener('pointerup', () => {
    if (!shouldRequestFullscreen(state())) return
    doc.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
  })

  // Orientation lock is only grantable while fullscreen; not all engines
  // ship screen.orientation.lock, and it rejects where unsupported.
  doc.addEventListener('fullscreenchange', () => {
    if (doc.fullscreenElement == null) return
    win.screen.orientation?.lock?.('landscape')?.catch?.(() => {})
  })
}

// Self-init in the browser; inert under node --test.
if (typeof window !== 'undefined' && typeof document !== 'undefined') initFullscreen()
