'use strict'

// Every file the web build refers to must exist in the build, or the packaged app would answer a 404 for a student.
// Runs against MDP_WEB_ROOT or the sibling Frontend's dist; skipped when there is no build to look at.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(process.env.MDP_WEB_ROOT ?? path.join(__dirname, '..', '..', 'MyDegreePlan_Frontend', 'dist'))
const hasBuild = fs.existsSync(path.join(root, 'index.html'))

const EXT = '(?:js|mjs|css|json|woff2?|ttf|svg|png|jpe?g|webp|ico|wasm)'
const files = hasBuild
  ? fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile() && /\.(html|js|mjs|css)$/.test(e.name))
    .map(e => path.join(e.parentPath, e.name))
  : []

// What a file refers to, as paths relative to the web root.
function references(file) {
  const text = fs.readFileSync(file, 'utf8')
  const dir = path.dirname(file)
  const found = new Set()
  const add = abs => found.add(path.relative(root, abs).split(path.sep).join('/'))
  for (const m of text.matchAll(new RegExp(`assets/[\\w.\\-]+\\.${EXT}\\b`, 'g'))) add(path.join(root, m[0]))
  for (const m of text.matchAll(new RegExp(`["'\`(]\\.{1,2}/([\\w./\\-]+\\.${EXT})["'\`)]`, 'g'))) add(path.resolve(dir, m[0].slice(1, -1)))
  if (file.endsWith('.html')) {
    for (const m of text.matchAll(new RegExp(`(?:href|src)="/([\\w.\\-/]+\\.${EXT})"`, 'g'))) add(path.join(root, m[1]))
  }
  return [...found]
}

test('the web build has a page and files to check', { skip: !hasBuild }, () => {
  assert.ok(files.length > 0)
})

test('every file the web build refers to exists', { skip: !hasBuild }, () => {
  const missing = []
  for (const file of files) {
    for (const ref of references(file)) {
      if (!fs.existsSync(path.join(root, ref))) missing.push(`${path.relative(root, file)} -> ${ref}`)
    }
  }
  assert.deepEqual(missing, [])
})
