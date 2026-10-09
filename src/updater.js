// updater.js: checks GitHub Releases for a newer version and installs it on request.
//
// It runs only in the main process; the page sees a small state object and four actions through the preload.
// Updates are optional: there is no "required" version. It does nothing in a development run (not packaged)
// or when MDP_UPDATES=off is set in the environment.
//
// States: disabled | idle | checking | available | downloading | ready | error
'use strict'

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const FIRST_CHECK_MS = 15 * 1000

// electron-updater hands release notes over as a string, a list of { version, note }, or nothing.
function normalizeNotes(notes) {
  if (!notes) return ''
  if (typeof notes === 'string') return notes.replace(/<[^>]*>/g, '').trim()
  if (Array.isArray(notes)) return notes.map(n => normalizeNotes(n?.note)).filter(Boolean).join('\n')
  return ''
}

function createUpdater({ app, ipcMain, getWindows, autoUpdater, log = console, env = process.env }) {
  const enabled = app.isPackaged && env.MDP_UPDATES !== 'off'
  let state = { status: enabled ? 'idle' : 'disabled', current: app.getVersion() }

  const set = patch => {
    state = { current: app.getVersion(), ...patch }
    for (const win of getWindows()) if (!win.isDestroyed()) win.webContents.send('mdp:updates:state', state)
  }

  // The student chooses when to download and when to restart. A downloaded update also installs when the app is closed.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = log

  autoUpdater.on('checking-for-update', () => set({ status: 'checking' }))
  autoUpdater.on('update-not-available', () => set({ status: 'idle' }))
  autoUpdater.on('update-available', info => set({ status: 'available', version: info.version, notes: normalizeNotes(info.releaseNotes) }))
  autoUpdater.on('download-progress', p => set({ status: 'downloading', version: state.version, notes: state.notes, percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', info => set({ status: 'ready', version: info.version, notes: state.notes }))
  autoUpdater.on('error', err => {
    log.error?.('MyDegreePlan update failed:', err)
    // Plain words for the student; the technical reason is in the log.
    set({ status: 'error', message: 'The update could not be completed. Your plan is unchanged. Try again later.' })
  })

  const check = async () => {
    if (!enabled || ['checking', 'downloading', 'ready'].includes(state.status)) return state
    try { await autoUpdater.checkForUpdates() } catch { /* the 'error' event already reported it */ }
    return state
  }
  const download = async () => {
    if (state.status !== 'available') return state
    try { await autoUpdater.downloadUpdate() } catch { /* reported by the 'error' event */ }
    return state
  }
  const install = () => {
    if (state.status === 'ready') autoUpdater.quitAndInstall(true, true)
    return state
  }

  ipcMain.handle('mdp:updates:get', () => state)
  ipcMain.handle('mdp:updates:check', check)
  ipcMain.handle('mdp:updates:download', download)
  ipcMain.handle('mdp:updates:install', install)

  if (enabled) {
    setTimeout(check, FIRST_CHECK_MS).unref?.()
    setInterval(check, CHECK_EVERY_MS).unref?.()
  }
  return { check, download, install, getState: () => state }
}

module.exports = { createUpdater, normalizeNotes, CHECK_EVERY_MS, FIRST_CHECK_MS }
