// security.js: the pure rules the main process enforces, kept free of Electron so they can be unit tested.
'use strict'

const path = require('node:path')

// The origin is the key of the student's IndexedDB. Changing the scheme or host orphans every saved plan,
// so it is a constant with a test, never a setting.
const APP_SCHEME = 'app'
const APP_HOST = 'mdp'
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

// The page may only talk to itself. This is the same policy the Docker web container sent.
// 'blob:' and wasm are for the PDF export.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "object-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

// Protocols a renderer request may use. Anything else (http, https, ws, ftp ...) is cancelled in the session.
const ALLOWED_PROTOCOLS = new Set([`${APP_SCHEME}:`, 'data:', 'blob:', 'devtools:'])

function isAllowedRequestUrl(url) {
  try { return ALLOWED_PROTOCOLS.has(new URL(url).protocol) } catch { return false }
}

// The one outbound exception, and only for the main process (never the page): the update check and download on
// GitHub Releases. Release assets are served from a githubusercontent.com host after a redirect.
const UPDATE_HOSTS = new Set(['github.com', 'api.github.com'])
const UPDATE_HOST_SUFFIX = '.githubusercontent.com'

function isUpdateUrl(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (UPDATE_HOSTS.has(u.hostname) || u.hostname.endsWith(UPDATE_HOST_SUFFIX))
  } catch { return false }
}

// `webContentsId` is set when a page initiated the request; the updater's own requests carry none.
function isRequestAllowed({ url, webContentsId }) {
  if (isAllowedRequestUrl(url)) return true
  return !webContentsId && isUpdateUrl(url)
}

function isAppUrl(url) {
  try { const u = new URL(url); return u.protocol === `${APP_SCHEME}:` && u.host === APP_HOST } catch { return false }
}

// Maps a request path to a file under `root`. Returns { file, spa }: `spa` means the path names no file
// (no extension), so the router's index.html answers it. Returns null for anything that escapes `root`.
function resolveAppPath(root, pathname) {
  let decoded
  try { decoded = decodeURIComponent(pathname) } catch { return null }
  if (decoded.includes('\0')) return null
  const rel = decoded.replace(/^\/+/, '')
  const file = path.resolve(root, rel === '' ? 'index.html' : rel)
  const base = path.resolve(root)
  if (file !== base && !file.startsWith(base + path.sep)) return null
  if (rel === '' || !path.extname(rel)) return { file: path.join(base, 'index.html'), spa: true }
  return { file, spa: false }
}

module.exports = { APP_SCHEME, APP_HOST, APP_ORIGIN, CSP, isAllowedRequestUrl, isUpdateUrl, isRequestAllowed, isAppUrl, resolveAppPath }
