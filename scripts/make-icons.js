// make-icons.js: renders build-resources/icon.svg to PNG with Electron's own renderer (no extra dependency).
//
//   npm run icons                       writes build-resources/icon.png (1024 px), the file electron-builder turns into the
//                                       Windows .ico (it embeds 16 to 256 px frames) for the exe, installer and uninstaller
//   npm run icons -- --preview DIR      also writes 16/24/32/48/64/128/256 px PNGs to DIR, to check the small sizes by eye
//
// The SVG is the source of truth; edit it and re-run this, then commit both files.
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const SRC = path.join(__dirname, '..', 'build-resources', 'icon.svg')
const OUT = path.join(__dirname, '..', 'build-resources', 'icon.png')
const previewDir = process.argv.includes('--preview') ? process.argv[process.argv.indexOf('--preview') + 1] : null
const SIZES = [1024, ...(previewDir ? [256, 128, 64, 48, 32, 24, 16] : [])]

app.whenReady().then(async () => {
  const svg = fs.readFileSync(SRC, 'utf8')
  const win = new BrowserWindow({ show: false, width: 64, height: 64 })
  await win.loadURL('about:blank')
  // Drawn straight to a canvas of each target size, so every size is rendered from the vector, not scaled from a bitmap.
  const frames = await win.webContents.executeJavaScript(`(async () => {
    const svg = ${JSON.stringify(svg)}
    const img = new Image()
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    await img.decode()
    const out = {}
    for (const size of ${JSON.stringify(SIZES)}) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, size, size)
      out[size] = canvas.toDataURL('image/png').split(',')[1]
    }
    return out
  })()`)
  fs.writeFileSync(OUT, Buffer.from(frames[1024], 'base64'))
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`)
  if (previewDir) {
    fs.mkdirSync(previewDir, { recursive: true })
    for (const size of SIZES) fs.writeFileSync(path.join(previewDir, `icon-${size}.png`), Buffer.from(frames[size], 'base64'))
    console.log(`wrote ${SIZES.length} previews to ${previewDir}`)
  }
  app.exit(0)
}).catch((err) => { console.error(err?.message ?? String(err)); app.exit(1) })
