// Every netcode number (specs …-pvp-server-netcode-design.md, …-pvp-public-launch-design.md and
// …-pvp-4b-arenas-reconnect-design.md).
// Shared by the server (server/) and the browser client (renderer/net/).
export const NET = {
  protocolVersion: 3,
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

  // Public launch (4a): public rooms, bots, abuse limits.
  botFill: 4,              // a public room is topped up with bots to this many heroes
  botNames: ['Ukko', 'Ilmatar', 'Tapio', 'Mielikki', 'Ahti', 'Tuoni', 'Louhi', 'Otso', 'Pellervo', 'Kalma', 'Vellamo', 'Hiisi'],
  trustProxy: true,        // clientIp: the last X-Forwarded-For entry (Cloud Run's front end appends the caller)
  maxSockets: 600,         // every open socket on the server
  perIpSockets: 8,         // open sockets per IP
  helloBurst: 10,          // hellos per IP: a bucket of 10…
  helloPerMin: 10,         // …refilling 10 a minute
  msgBurst: 320,           // messages per connection: a bucket of 320 (~10 s of backlog at ~31 msg/s)…
  msgPerSec: 60,           // …refilling 60 a second (a client sends ~31)
  classPerSec: 2,          // class messages per connection per second; extras are ignored
  idleKickMs: 60000,       // no real input for this long: error idle, and the seat is freed
  lonelyHostKickMs: 600000, // a private room waiting alone for a friend this long: error idle, closed
  roomsPerIp: 2,           // rooms created (not joined) per IP key, at once; a create beyond this is rate_limited
  refusalLogMs: 60000,     // refusal counts are logged this often, when non-zero
}
