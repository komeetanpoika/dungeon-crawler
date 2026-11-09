// npm run studio: start the monster lab server (or reuse a running one) and open the Studio.
import { createLabServer } from '../monster-lab/server.mjs'
import { openBrowser } from './open-browser.mjs'

const port = Number(process.env.PORT) || 5180
const url = `http://localhost:${port}/studio`
const server = createLabServer()
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log(`monster lab already running on :${port}`)
    console.log(`monster studio: ${url}`)
    openBrowser(url)
  } else { console.error(err.message); process.exit(1) }
})
server.listen(port, '127.0.0.1', () => {
  console.log(`monster studio: ${url}`)
  openBrowser(url)
})
