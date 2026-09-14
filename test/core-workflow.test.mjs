import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const fixture = fileURLToPath(new URL('./e2e-fixture/', import.meta.url))

test('the code-development workflow fixture remains green after the verified CLI repair', () => {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, ['--test', 'math.test.mjs'], {
    cwd: fixture,
    encoding: 'utf8',
    env,
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout + result.stderr, /pass [1-9]\d*/)
})
