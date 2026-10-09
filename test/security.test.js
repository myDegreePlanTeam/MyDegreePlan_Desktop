'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { APP_ORIGIN, CSP, isAllowedRequestUrl, isUpdateUrl, isRequestAllowed, isAppUrl, resolveAppPath, isPdfViewerSupportUrl } = require('../src/security')

test('the built-in PDF viewer may load (the plan preview needs it), and nothing else under chrome-extension://', () => {
  const id = 'mhjfbmdgcfjbbpaeojofohoefgiehjai'
  for (const ok of [`chrome-extension://${id}/index.html`, `chrome-extension://${id}/pdf_embedder.css`, `chrome-extension://${id}/`]) {
    assert.equal(isAllowedRequestUrl(ok), true, ok)
    assert.equal(isRequestAllowed({ url: ok, webContentsId: 3 }), true, `${ok} from a page`)
  }
  for (const bad of [
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop/index.html',     // any other extension
    `chrome-extension://${id}.evil.example/index.html`,                    // a look-alike host
    `chrome-extension://x${id}/index.html`,
    'chrome://settings/', 'chrome://history/', 'chrome://flags/', 'chrome-untrusted://pdf/index.html', 'chrome-search://local-ntp/',
    'chrome://resources.evil.example/x.js',
  ]) {
    assert.equal(isAllowedRequestUrl(bad), false, bad)
  }
})

test('the viewer\'s own support files (chrome://resources/) may load, and only that chrome:// host', () => {
  for (const ok of ['chrome://resources/css/text_defaults_md.css', 'chrome://resources/lit/v3_0/lit.rollup.js', 'chrome://resources/js/load_time_data.js']) {
    assert.equal(isAllowedRequestUrl(ok), true, ok)
  }
  assert.equal(isPdfViewerSupportUrl('chrome://resources/x.js'), true)
  assert.equal(isPdfViewerSupportUrl('chrome://settings/x.js'), false)
  assert.equal(isPdfViewerSupportUrl('https://resources/x.js'), false)
})

test('the update hosts are GitHub over https only', () => {
  for (const ok of ['https://github.com/o/r/releases.atom', 'https://api.github.com/repos/o/r', 'https://release-assets.githubusercontent.com/x', 'https://objects.githubusercontent.com/x']) {
    assert.equal(isUpdateUrl(ok), true, ok)
  }
  for (const bad of ['http://github.com/', 'https://evilgithub.com/', 'https://github.com.evil.com/', 'https://githubusercontent.com.evil.io/', 'https://example.com/']) {
    assert.equal(isUpdateUrl(bad), false, bad)
  }
})

test('a page may never reach the update hosts; the main process may', () => {
  const url = 'https://github.com/o/r/releases.atom'
  assert.equal(isRequestAllowed({ url, webContentsId: 3 }), false)
  assert.equal(isRequestAllowed({ url, webContentsId: undefined }), true)
  assert.equal(isRequestAllowed({ url: 'https://example.com/', webContentsId: undefined }), false)
  assert.equal(isRequestAllowed({ url: 'app://mdp/', webContentsId: 3 }), true)
})

const root = path.resolve('/srv/web')

test('the origin never changes (it keys every student\'s IndexedDB)', () => {
  assert.equal(APP_ORIGIN, 'app://mdp')
})

test('only the app, data, blob and devtools protocols may be requested', () => {
  for (const ok of ['app://mdp/assets/a.js', 'data:text/plain,hi', 'blob:app://mdp/1234', 'devtools://devtools/bundled/x.js']) {
    assert.equal(isAllowedRequestUrl(ok), true, ok)
  }
  for (const bad of ['https://example.com/', 'http://127.0.0.1:8080/', 'ws://localhost/', 'ftp://x/', 'file:///etc/passwd', 'not a url']) {
    assert.equal(isAllowedRequestUrl(bad), false, bad)
  }
})

test('navigation is allowed only to the app origin', () => {
  assert.equal(isAppUrl('app://mdp/dashboard'), true)
  assert.equal(isAppUrl('app://other/dashboard'), false)
  assert.equal(isAppUrl('https://mdp/'), false)
})

test('files resolve inside the web root and routes fall back to index.html', () => {
  assert.deepEqual(resolveAppPath(root, '/assets/app.js'), { file: path.join(root, 'assets', 'app.js'), spa: false })
  assert.deepEqual(resolveAppPath(root, '/'), { file: path.join(root, 'index.html'), spa: true })
  assert.deepEqual(resolveAppPath(root, '/dashboard'), { file: path.join(root, 'index.html'), spa: true })
  assert.deepEqual(resolveAppPath(root, '/plan/2026-2027'), { file: path.join(root, 'index.html'), spa: true })
})

test('paths that escape the web root are refused', () => {
  for (const bad of ['/../secret.txt', '/..%2f..%2fsecret.txt', '/assets/../../secret.txt', '/%00.js', '/%zz']) {
    assert.equal(resolveAppPath(root, bad), null, bad)
  }
})

test('the CSP allows no outside host', () => {
  assert.ok(!/https?:|\*/.test(CSP.replace(/'wasm-unsafe-eval'/, '')))
  assert.match(CSP, /connect-src 'self' blob: data:/)
})
