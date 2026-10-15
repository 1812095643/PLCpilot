import test from 'node:test'
import assert from 'node:assert/strict'
import { notesForVersion } from './release-notes.mjs'

test('release notes contain only the requested version', () => {
  const input = '0.1.23 Current\n\n- New\n\n---\n\n0.1.22 Previous\n\n- Old\n'
  assert.equal(notesForVersion(input, 'v0.1.23'), '0.1.23 Current\n\n- New')
  assert.equal(notesForVersion(input.replaceAll('\n', '\r\n'), '0.1.22'), '0.1.22 Previous\r\n\r\n- Old')
  assert.equal(notesForVersion('## 1.0.0\nNew\n\n## 0.9.0\nOld', '1.0.0'), '## 1.0.0\nNew')
  assert.throws(() => notesForVersion(input, '9.0.0'), /do not contain/)
})
