import assert from 'node:assert/strict'
import test from 'node:test'
import { add, multiply, subtract } from './math.js'

test('add returns the sum of two numbers', () => {
  assert.equal(add(2, 3), 5)
})

test('multiply returns the product of two numbers', () => {
  assert.equal(multiply(2, 3), 6)
})

test('subtract returns the difference of two numbers', () => {
  assert.equal(subtract(8, 3), 5)
})
