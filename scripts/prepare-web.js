// prepare-web.js: stages the Frontend's production build into build/web, which the installer ships as resources/web.
// Source: MDP_WEB_ROOT, else the sibling MyDegreePlan_Frontend/dist. Run `npm run build` in the Frontend first.
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const source = path.resolve(process.env.MDP_WEB_ROOT ?? path.join(__dirname, '..', '..', 'MyDegreePlan_Frontend', 'dist'))
const target = path.join(__dirname, '..', 'build', 'web')

if (!fs.existsSync(path.join(source, 'index.html'))) {
  console.error(`No web build at ${source} (no index.html). Run "npm run build" in MyDegreePlan_Frontend, or set MDP_WEB_ROOT.`)
  process.exit(1)
}

fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(source, target, { recursive: true })
const count = fs.readdirSync(target, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).length
console.log(`web build staged: ${count} files from ${source}`)
