'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildTestPdf } = require('../src/testPdf')

test('the test PDF has a PDF header and trailer', () => {
  const text = buildTestPdf().toString('latin1')
  assert.ok(text.startsWith('%PDF-1.4'))
  assert.ok(text.trimEnd().endsWith('%%EOF'))
})

test('every cross-reference offset points at its object (a strict viewer rejects a wrong table)', () => {
  const text = buildTestPdf().toString('latin1')
  const xrefAt = Number(text.match(/startxref\n(\d+)\n%%EOF/)[1])
  assert.ok(text.slice(xrefAt).startsWith('xref\n'))
  const entries = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]))
  assert.equal(entries.length, 5)
  entries.forEach((offset, i) => assert.ok(text.slice(offset).startsWith(`${i + 1} 0 obj`), `object ${i + 1} is at ${offset}`))
})

test('the content stream length is declared correctly', () => {
  const text = buildTestPdf('hello').toString('latin1')
  const declared = Number(text.match(/\/Length (\d+)/)[1])
  const body = text.match(/stream\n([\s\S]*?)\nendstream/)[1]
  assert.equal(body.length, declared)
})

test('characters that would break the string are removed from the text', () => {
  assert.ok(!buildTestPdf('a(b)c\\d').toString('latin1').includes('(a(b'))
})
