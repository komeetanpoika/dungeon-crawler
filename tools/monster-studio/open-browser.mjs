import fs from 'node:fs'
import { spawn } from 'node:child_process'

// Which command opens a browser here? null when headless.
export function browserCommand({ platform, env = {}, procVersion = '', url = '' }) {
  if (/microsoft/i.test(procVersion)) return { bin: 'cmd.exe', args: ['/c', 'start', '', url] }
  if (platform === 'darwin') return { bin: 'open', args: [url] }
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return { bin: 'xdg-open', args: [url] }
  return null
}

export function openBrowser(url) {
  let procVersion = ''
  try { procVersion = fs.readFileSync('/proc/version', 'utf8') } catch { /* not linux */ }
  const cmd = browserCommand({ platform: process.platform, env: process.env, procVersion, url })
  if (!cmd) return
  try {
    const child = spawn(cmd.bin, cmd.args, { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
  } catch { /* the URL is printed; the user can click it */ }
}
