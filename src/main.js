// main.js: hosts the MyDegreePlan web build (the Frontend's dist/) in a locked-down window.
// The page is first-party static files served from the custom app://mdp origin; no remote content is ever loaded,
// and every network request from the page is cancelled in the session.
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, ipcMain, protocol, session, shell } = require('electron')
const { APP_SCHEME, APP_HOST, APP_ORIGIN, CSP, isRequestAllowed, isAppUrl, isPdfViewerUrl, resolveAppPath } = require('./security')
const { createUpdater } = require('./updater')
const { buildTestPdf } = require('./testPdf')
const { pdfPreviewVerdict } = require('./pdfCheck')

const SMOKE = process.argv.includes('--mdp-smoke')

// Must run before the app is ready. standard + secure give the origin IndexedDB, fetch and dynamic imports.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8',
}

// Where the built web app lives: an override, the packaged copy, or the sibling Frontend checkout.
function webRoot() {
  const candidates = [
    process.env.MDP_WEB_ROOT,
    path.join(process.resourcesPath ?? '', 'web'),
    path.join(__dirname, '..', '..', 'MyDegreePlan_Frontend', 'dist'),
  ].filter(Boolean)
  const found = candidates.find(dir => fs.existsSync(path.join(dir, 'index.html')))
  if (!found) throw new Error(`No web build found. Run "npm run build" in MyDegreePlan_Frontend, or set MDP_WEB_ROOT. Looked in: ${candidates.join(', ')}`)
  return found
}

// Returns the list of requests the app could not answer (404 / 403). The smoke check fails if it is not empty.
function serveApp(root) {
  const misses = []
  const miss = (request, status, text) => { misses.push(`${status} ${request.url}`); return new Response(text, { status }) }
  protocol.handle(APP_SCHEME, async request => {
    const url = new URL(request.url)
    if (url.host !== APP_HOST) return miss(request, 404, 'Not found')
    const target = resolveAppPath(root, url.pathname)
    if (!target) return miss(request, 403, 'Forbidden')
    let body
    try { body = await fs.promises.readFile(target.file) } catch { return miss(request, 404, 'Not found') }
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': MIME[path.extname(target.file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Security-Policy': CSP,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': target.spa ? 'no-cache' : 'public, max-age=31536000, immutable',
      },
    })
  })
  return misses
}

// Returns the list of requests it cancelled, so the smoke check can see what the lockdown blocked.
function lockDownSession(ses) {
  const blocked = []
  // The enforcement half of the privacy promise: nothing but the app itself, data: and blob: is reachable.
  // The updater's requests (main process, no page behind them) may also reach GitHub Releases; a page never can.
  ses.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isRequestAllowed(details)
    if (!allowed) blocked.push(`${details.resourceType} ${details.url.slice(0, 120)}`)
    callback({ cancel: !allowed })
  })
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  return blocked
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: !SMOKE,
    backgroundColor: '#ffffff',
    title: 'MyDegreePlan',
    // A packaged app takes its icon from the exe; this is for `npm start`, where the exe is Electron's.
    icon: app.isPackaged ? undefined : path.join(__dirname, '..', 'build-resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  })
  win.removeMenu()

  // A link out never loads inside this window; only the app's own origin does.
  win.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) event.preventDefault() })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-attach-webview', event => event.preventDefault())

  win.loadURL(`${APP_ORIGIN}/`)
  return win
}

// The Frontend's plan preview shows its PDF as <iframe src="blob:...#view=FitH&navpanes=0">, which needs Chromium's built-in
// PDF viewer. This does the same with a small valid PDF and reports whether the viewer actually started and what, if anything,
// the lockdown blocked while it did. (Diagnostic: the frames and blocked requests are in the report.)
async function pdfPreviewCheck(wc, blocked) {
  const from = blocked.length
  const base64 = buildTestPdf().toString('base64')
  await wc.executeJavaScript(`(() => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), c => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    const frame = document.createElement('iframe')
    frame.id = 'mdp-pdf-smoke'
    frame.title = 'Degree plan PDF preview'
    frame.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;border:0;z-index:99999;background:#fff'
    frame.src = url + '#view=FitH&navpanes=0'
    document.body.appendChild(frame)
  })()`)
  let frames = []
  for (let i = 0; i < 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 250))
    frames = wc.mainFrame.framesInSubtree.map(frame => frame.url)
    if (frames.some(isPdfViewerUrl)) break
  }
  // The viewer's frame exists even when its page load was cancelled, so ask the frame itself what it holds.
  let viewer = null
  const viewerFrame = wc.mainFrame.framesInSubtree.find(frame => isPdfViewerUrl(frame.url))
  if (viewerFrame) {
    for (let i = 0; i < 40 && !(viewer?.hasViewer); i++) {
      await new Promise(resolve => setTimeout(resolve, 250))
      try {
        viewer = await viewerFrame.executeJavaScript(`({
          title: document.title,
          children: document.body ? document.body.children.length : 0,
          tags: document.body ? [...document.body.children].map(e => e.tagName.toLowerCase()).slice(0, 8) : [],
          hasViewer: !!document.querySelector('pdf-viewer, viewer-app, #viewer, embed'),
          defined: !!customElements.get('pdf-viewer'),
          shadowChildren: document.querySelector('pdf-viewer')?.shadowRoot?.childElementCount ?? 0,
          shadowIds: [...(document.querySelector('pdf-viewer')?.shadowRoot?.querySelectorAll('[id]') ?? [])].map(e => e.tagName.toLowerCase() + '#' + e.id).slice(0, 14),
          plugin: (() => { const e = document.querySelector('pdf-viewer')?.shadowRoot?.querySelector('embed'); return e ? e.type : null })(),
        })`)
      } catch (err) { viewer = { error: String(err.message ?? err) } }
    }
  }
  return { frames, viewer, blockedDuringPdf: blocked.slice(from) }
}

// A one-shot check used by `npm run smoke` and CI: loads the app, reports what the page sees, exits non-zero on failure.
async function smoke(win, { root, misses, blocked }) {
  const wc = win.webContents
  await new Promise(resolve => wc.once('did-finish-load', resolve))
  // Every file of the web build must be served (a 404 here would be a 404 for a student, so it fails the release).
  const files = fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
  const report = await wc.executeJavaScript(`(async () => {
    const files = ${JSON.stringify(files)}
    const notServed = []
    for (const f of files) {
      try { const r = await fetch('/' + encodeURI(f)); if (!r.ok) notServed.push(r.status + ' ' + f); await r.arrayBuffer() } catch (e) { notServed.push('error ' + f) }
    }
    const waitFor = async (f, n = 60) => { for (let i = 0; i < n && !f(); i++) await new Promise(r => setTimeout(r, 250)); return f() }
    const rendered = await waitFor(() => document.getElementById('root')?.childElementCount > 0)
    let externalBlocked = false
    try { await fetch('https://example.com/', { mode: 'no-cors' }) } catch { externalBlocked = true }
    let idbOpens = false
    try {
      idbOpens = await new Promise((res, rej) => { const r = indexedDB.open('mdp-smoke', 1); r.onsuccess = () => { r.result.close(); indexedDB.deleteDatabase('mdp-smoke'); res(true) }; r.onerror = () => rej(r.error) })
    } catch {}
    return {
      origin: location.origin, rendered, externalBlocked, idbOpens, filesChecked: files.length, notServed,
      desktopBridge: typeof window.mdpDesktop?.version === 'function' && typeof window.mdpDesktop?.updates?.onChange === 'function',
      nodeLeaked: typeof require !== 'undefined' || typeof process !== 'undefined',
      title: document.title,
    }
  })()`)
  const pdf = await pdfPreviewCheck(wc, blocked)
  const pdfVerdict = pdfPreviewVerdict(pdf)
  const ok = report.origin === APP_ORIGIN && report.rendered && report.externalBlocked && report.idbOpens && report.desktopBridge && !report.nodeLeaked
    && report.filesChecked > 0 && report.notServed.length === 0 && misses.length === 0 && pdfVerdict.ok
  const line = JSON.stringify({ smoke: ok ? 'pass' : 'FAIL', packaged: app.isPackaged, ...report, misses, pdfWorks: pdfVerdict.ok, pdfProblems: pdfVerdict.problems, pdf })
  console.log(line)
  // A packaged GUI exe does not print to a pipe, so the report can also go to a file.
  if (process.env.MDP_SMOKE_OUT) fs.writeFileSync(process.env.MDP_SMOKE_OUT, line + '\n')
  app.exit(ok ? 0 : 1)
}

// One window per profile: two instances would fight over the same IndexedDB files.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  })

  app.whenReady().then(() => {
    ipcMain.handle('mdp:version', () => app.getVersion())
    const root = webRoot()
    const misses = serveApp(root)
    const blocked = lockDownSession(session.defaultSession)
    const win = createWindow()
    // Checks only in a packaged app (a development run and a smoke run report "disabled").
    createUpdater({
      app, ipcMain,
      getWindows: () => BrowserWindow.getAllWindows(),
      autoUpdater: require('electron-updater').autoUpdater,
      env: SMOKE ? { ...process.env, MDP_UPDATES: 'off' } : process.env,
    })
    if (SMOKE) smoke(win, { root, misses, blocked }).catch(err => { console.error(err); app.exit(1) })
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
