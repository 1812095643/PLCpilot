import test from 'node:test'
import assert from 'node:assert/strict'
import { imageParameters, validImageSize } from './image-model-parameters.mjs'

test('model-specific image quality and size constraints', () => {
  const image2 = imageParameters('gpt-image-2')
  assert.deepEqual(image2.qualities, ['auto', 'low', 'medium', 'high'])
  assert.ok(imageParameters('gpt-image-2.5-sunburst-2026-09-08').qualities.includes('max'))
  assert.equal(validImageSize('3840x2160', image2), true)
  assert.equal(validImageSize('1536x864', image2), true)
  for (const size of ['1024x0', '1000x1000', '3840x3840', '512x512', '4000x1008', '3840x640']) assert.equal(validImageSize(size, image2), false, size)
  assert.equal(validImageSize('2048x2048', imageParameters('gpt-image-1.5')), false)
  assert.deepEqual(imageParameters('unknown').sizes, ['auto'])
  assert.deepEqual(imageParameters('unknown', { source: 'provider', sizes: ['768x1024'], qualities: ['standard'] }).qualities, ['standard'])
})
