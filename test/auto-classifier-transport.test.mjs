import assert from 'node:assert/strict'
import test from 'node:test'
import { selectAutoClassifierTransport } from '../src/utils/permissions/classifierTransport.js'

test('external Auto uses a text classifier by default, even without a rollout config', () => {
  assert.equal(selectAutoClassifierTransport(undefined, undefined), true)
  assert.equal(selectAutoClassifierTransport('external', undefined), true)
  assert.equal(selectAutoClassifierTransport('ant', undefined), false)
})

test('an explicit classifier transport setting remains authoritative', () => {
  assert.equal(selectAutoClassifierTransport(undefined, false), false)
  assert.equal(selectAutoClassifierTransport(undefined, 'fast'), 'fast')
  assert.equal(selectAutoClassifierTransport('ant', 'thinking'), 'thinking')
})
