'use strict'

// The three states below were observed from the real app, in order, while the PDF preview was being fixed.
const test = require('node:test')
const assert = require('node:assert/strict')
const { pdfPreviewVerdict } = require('../src/pdfCheck')

const working = {
  viewer: {
    children: 3, defined: true, hasViewer: true, plugin: 'application/x-google-chrome-pdf', shadowChildren: 2,
    shadowIds: ['viewer-toolbar#toolbar', 'div#container', 'div#sidenav-container', 'viewer-pdf-sidenav#sidenav', 'div#main', 'div#scroller', 'div#sizer', 'div#content', 'embed#plugin'],
    title: '01ad09eb-9810-4587-898f-152988bac196',
  },
  blockedDuringPdf: [],
}

// 1. The original bug: the lockdown cancelled the viewer's page, so its frame was empty (a blank pane for the student).
const viewerPageBlocked = {
  viewer: { children: 0, tags: [], title: '' },
  blockedDuringPdf: [
    'stylesheet chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/pdf_embedder.css',
    'subFrame chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html',
  ],
}

// 2. Half fixed: the viewer's page loads (a <pdf-viewer> tag exists) but its scripts from chrome://resources are blocked,
//    so it never starts. A check that only looked for the frame or the tag would have passed this.
const supportFilesBlocked = {
  viewer: { children: 3, hasViewer: true, tags: ['pdf-viewer', 'script', 'script'], title: '' },
  blockedDuringPdf: [
    'stylesheet chrome://resources/css/text_defaults_md.css',
    'script chrome://resources/lit/v3_0/lit.rollup.js',
    'script chrome://resources/js/load_time_data.js',
  ],
}

test('a working viewer passes', () => {
  assert.deepEqual(pdfPreviewVerdict(working), { ok: true, problems: [] })
})

test('the original bug (viewer page blocked, empty frame) fails', () => {
  const verdict = pdfPreviewVerdict(viewerPageBlocked)
  assert.equal(verdict.ok, false)
  assert.match(verdict.problems.join('\n'), /never registered/)
  assert.match(verdict.problems.join('\n'), /blocked 2 request/)
})

test('a half-fixed viewer (page loads, its scripts blocked) fails even though the frame and the tag exist', () => {
  const verdict = pdfPreviewVerdict(supportFilesBlocked)
  assert.equal(verdict.ok, false)
  assert.match(verdict.problems.join('\n'), /chrome:\/\/resources\/lit/)
})

test('no viewer frame at all, or an unreadable one, fails', () => {
  assert.equal(pdfPreviewVerdict({ viewer: null, blockedDuringPdf: [] }).ok, false)
  assert.equal(pdfPreviewVerdict(undefined).ok, false)
  assert.equal(pdfPreviewVerdict({ viewer: { error: 'frame was destroyed' }, blockedDuringPdf: [] }).ok, false)
})

test('a viewer that starts but has no plugin to draw pages fails', () => {
  const noPlugin = { ...working, viewer: { ...working.viewer, plugin: null } }
  assert.equal(pdfPreviewVerdict(noPlugin).ok, false)
})

test('anything blocked while the viewer started fails, even if the viewer looks complete', () => {
  assert.equal(pdfPreviewVerdict({ ...working, blockedDuringPdf: ['image chrome://resources/images/x.svg'] }).ok, false)
})
