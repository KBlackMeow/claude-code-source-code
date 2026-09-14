import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const fixture = new URL('./e2e-fixture/', import.meta.url).pathname

test('the code-development workflow fixture remains green after the verified CLI repair', () => {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync('npm', ['test'], {
    cwd: fixture,
    encoding: 'utf8',
    env,
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout + result.stderr, /pass [1-9]\d*/)
})
