// Static server for the web release: serves renderer/ as the web root.
//   npm run web   ->  http://localhost:8080
// Any static host works equally well (the game is plain files + web-shim.js);
// this exists so "set up a server" is one command. The same server also
// carries the PvP WebSocket on /pvp.
//
// TRUST_PROXY=1 takes a client's address from the last X-Forwarded-For entry,
// for running behind a proxy that appends it (Cloud Run, nginx, Caddy; the
// Dockerfile sets it). Leave it unset when clients connect directly: the header
// is theirs to fake then, and the per-IP limits would be theirs to dodge.
import * as http from 'node:http'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { attachPvp } from '../server/pvp-server.js'
import { makeStaticHandler } from '../server/static.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer')
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080
const TRUST_PROXY = process.env.TRUST_PROXY === '1'

const server = http.createServer(makeStaticHandler(ROOT))
attachPvp(server, { trustProxy: TRUST_PROXY })
server.listen(PORT, () => console.log(`dungeon-crawler web: http://localhost:${PORT}  (pvp on ws://localhost:${PORT}/pvp)`
  + (TRUST_PROXY ? '  client IPs from X-Forwarded-For' : '')))
