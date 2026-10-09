// pdfCheck.js: decides whether the PDF preview works, from what the smoke check observed. Pure, so it can be unit tested
// (test/pdfCheck.test.js uses states observed from the real app while this was being fixed).
//
// The plan preview is <iframe src="blob:...#view=FitH">, which needs Chromium's built-in PDF viewer. The viewer's FRAME exists
// even when the lockdown cancelled its page load, so "a viewer frame exists" proves nothing. A working viewer has:
//   - nothing blocked while it started (a blocked file leaves a blank or half-started viewer),
//   - its <pdf-viewer> element registered (its scripts ran), a toolbar, and the embedded PDF plugin that draws the pages.
'use strict'

const PDF_PLUGIN_TYPE = 'application/x-google-chrome-pdf'

function pdfPreviewVerdict(pdf) {
  const problems = []
  const viewer = pdf?.viewer
  if (!viewer) problems.push('the PDF viewer frame never appeared')
  else if (viewer.error) problems.push(`the PDF viewer frame could not be read: ${viewer.error}`)
  else {
    if (!viewer.defined) problems.push('the <pdf-viewer> element was never registered (its scripts did not run)')
    if (!viewer.shadowIds?.includes('viewer-toolbar#toolbar')) problems.push('the viewer toolbar is missing')
    if (viewer.plugin !== PDF_PLUGIN_TYPE) problems.push('the PDF plugin that draws the pages is missing')
  }
  const blocked = pdf?.blockedDuringPdf ?? []
  if (blocked.length > 0) problems.push(`the lockdown blocked ${blocked.length} request(s) the viewer needed: ${blocked.join('; ')}`)
  return { ok: problems.length === 0, problems }
}

module.exports = { pdfPreviewVerdict, PDF_PLUGIN_TYPE }
