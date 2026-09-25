// Every netcode number (spec docs/superpowers/specs/2026-09-25-pvp-server-netcode-design.md).
// Shared by the server (server/) and the browser client (renderer/net/).
export const NET = {
  protocolVersion: 1,
  path: '/pvp',
  snapshotHz: 20,
  interpDelayTicks: 3,     // other heroes are drawn this many sim ticks behind the estimated server tick
  extrapolateTicks: 3,     // how long a hero keeps its last velocity when the snapshot buffer runs dry
  bufferTicks: 30,         // snapshots kept (1 s)
  rewindMaxTicks: 6,       // melee lag compensation cap (200 ms)
  historyTicks: 8,         // per-hero position ring on the server
  inputQueueMax: 4,
  staleInputTicks: 15,     // no input for this long: the hero stands still
  pendingMax: 90,          // unacknowledged inputs a client keeps (3 s)
  resultsDelay: 10,        // s from matchEnd to the next match
  pingMs: 2000,
  heartbeatMs: 5000,
  heartbeatMisses: 2,
  helloTimeoutMs: 10000, // a socket that never sends hello is closed after this long
  maxRooms: 50,
  maxHeroes: 6,
  maxPayload: 4096,
  nameMax: 12,
  codeLength: 4,
  codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  snapPx: 2,               // corrections smaller than this snap silently…
  bigSnapPx: 96,           // …and larger than this snap outright (respawn, blink)
  correctionMs: 100,       // everything between blends away over this long
  maxBuffered: 65536,      // a socket whose ws.bufferedAmount exceeds this is skipped for a snapshot
  maxCues: 16,             // client: sfx cues kept pending between drains, a backgrounded tab piles these up
  maxFloats: 24,           // client: damage/heal floats kept pending between drains, same reason
  maxEvents: 64,           // client: events kept pending between drains (closed/error/welcome are never dropped)
}
