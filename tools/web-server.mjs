// Static server for the web release: serves renderer/ as the web root.
//   npm run web   ->  http://localhost:8080
// Any static host works equally well (the game is plain files + web-shim.js);
// this exists so "set up a server" is one command. The same server also
// carries the PvP WebSocket on /pvp (spec docs/superpowers/specs/2026-09-25-pvp-server-netcode-design.md).
import * as http from 'node:http'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { attachPvp } from '../server/pvp-server.js'
import { makeStaticHandler } from '../server/static.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer')
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080

const server = http.createServer(makeStaticHandler(ROOT))
attachPvp(server)
server.listen(PORT, () => console.log(`dungeon-crawler web: http://localhost:${PORT}  (pvp on ws://localhost:${PORT}/pvp)`))
