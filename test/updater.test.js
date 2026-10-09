'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createUpdater, normalizeNotes } = require('../src/updater')

function harness({ isPackaged = true, env = {} } = {}) {
  const handlers = {}
  const sent = []
  const win = { isDestroyed: () => false, webContents: { send: (channel, payload) => sent.push({ channel, payload }) } }
  const autoUpdater = Object.assign(new EventEmitter(), {
    checks: 0, downloads: 0, installs: 0,
    async checkForUpdates() { this.checks++ },
    async downloadUpdate() { this.downloads++ },
    quitAndInstall() { this.installs++ },
  })
  const updater = createUpdater({
    app: { isPackaged, getVersion: () => '0.1.0' },
    ipcMain: { handle: (name, fn) => { handlers[name] = fn } },
    getWindows: () => [win],
    autoUpdater, env, log: { error() {} },
  })
  return { updater, autoUpdater, handlers, sent }
}

test('release notes are flattened to plain text', () => {
  assert.equal(normalizeNotes(undefined), '')
  assert.equal(normalizeNotes('<p>Fixed <b>AP</b> credit</p>'), 'Fixed AP credit')
  assert.equal(normalizeNotes([{ version: '1', note: 'one' }, { version: '2', note: '<p>two</p>' }]), 'one\ntwo')
})

test('a development run never checks for updates', async () => {
  const { updater, autoUpdater } = harness({ isPackaged: false })
  assert.equal(updater.getState().status, 'disabled')
  await updater.check()
  assert.equal(autoUpdater.checks, 0)
})

test('MDP_UPDATES=off disables the check in a packaged app', async () => {
  const { updater, autoUpdater } = harness({ env: { MDP_UPDATES: 'off' } })
  await updater.check()
  assert.equal(updater.getState().status, 'disabled')
  assert.equal(autoUpdater.checks, 0)
})

test('an update is offered, downloaded on request, and installed only once downloaded', async () => {
  const { updater, autoUpdater, sent } = harness()
  assert.equal(autoUpdater.autoDownload, false)

  updater.install()
  assert.equal(autoUpdater.installs, 0, 'nothing to install yet')
  await updater.download()
  assert.equal(autoUpdater.downloads, 0, 'nothing offered yet')

  await updater.check()
  assert.equal(autoUpdater.checks, 1)
  autoUpdater.emit('update-available', { version: '0.2.0', releaseNotes: 'New things' })
  assert.deepEqual(updater.getState(), { current: '0.1.0', status: 'available', version: '0.2.0', notes: 'New things' })

  await updater.download()
  assert.equal(autoUpdater.downloads, 1)
  autoUpdater.emit('download-progress', { percent: 41.6 })
  assert.equal(updater.getState().percent, 42)
  autoUpdater.emit('update-downloaded', { version: '0.2.0' })
  assert.equal(updater.getState().status, 'ready')

  updater.install()
  assert.equal(autoUpdater.installs, 1)
  assert.ok(sent.every(m => m.channel === 'mdp:updates:state'))
})

test('a failed update says so in plain words and the next check can run again', async () => {
  const { updater, autoUpdater } = harness()
  await updater.check()
  autoUpdater.emit('error', new Error('ECONNRESET at 10.0.0.1'))
  const state = updater.getState()
  assert.equal(state.status, 'error')
  assert.ok(!/ECONNRESET|10\.0/.test(state.message))
  await updater.check()
  assert.equal(autoUpdater.checks, 2)
})

test('a check is not started while one is running or an update is ready', async () => {
  const { updater, autoUpdater } = harness()
  autoUpdater.emit('checking-for-update')
  await updater.check()
  assert.equal(autoUpdater.checks, 0)
  autoUpdater.emit('update-downloaded', { version: '0.2.0' })
  await updater.check()
  assert.equal(autoUpdater.checks, 0)
})
