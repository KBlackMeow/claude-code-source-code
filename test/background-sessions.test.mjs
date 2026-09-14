import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const root = new URL('..', import.meta.url).pathname

function run(args, env) {
  return spawnSync(process.execPath, ['dist/cli.js', ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
  })
}

test('background sessions can be started, listed, and read without an API call', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'claude-bg-test-'))
  const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir }
  try {
    const started = run(['--bg', '--version'], env)
    assert.equal(started.status, 0, started.stderr || started.stdout)
    const { id } = JSON.parse(started.stdout)
    assert.match(id, /^[a-f0-9-]{36}$/)

    const listed = run(['ps', '--json'], env)
    assert.equal(listed.status, 0, listed.stderr || listed.stdout)
    assert.ok(JSON.parse(listed.stdout).some(session => session.id === id))

    // The detached child records its terminal status, rather than leaving the
    // registry permanently in `running` after a fast-path command exits.
    let terminal
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const refreshed = JSON.parse(run(['ps', '--json'], env).stdout)
      terminal = refreshed.find(session => session.id === id)
      if (terminal?.status !== 'running') break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.equal(terminal?.status, 'completed')

    const agents = run(['agents', '--json'], env)
    assert.equal(agents.status, 0, agents.stderr || agents.stdout)
    assert.ok(JSON.parse(agents.stdout).some(session => session.id === id))

    const logs = run(['logs', id], env)
    assert.equal(logs.status, 0, logs.stderr || logs.stdout)
    assert.match(logs.stdout, /2\.1\.88 \(Claude Code\)/)

    const attached = run(['attach', id, '--follow'], env)
    assert.equal(attached.status, 0, attached.stderr || attached.stdout)
    assert.match(attached.stdout, /2\.1\.88 \(Claude Code\)/)

    const respawned = run(['respawn', id], env)
    assert.equal(respawned.status, 0, respawned.stderr || respawned.stdout)
    const { id: respawnedId, respawnedFrom } = JSON.parse(respawned.stdout)
    assert.equal(respawnedFrom, id)
    assert.match(respawnedId, /^[a-f0-9-]{36}$/)

    const removed = run(['rm', id], env)
    assert.equal(removed.status, 0, removed.stderr || removed.stdout)
    const removedRespawn = run(['rm', respawnedId], env)
    assert.equal(removedRespawn.status, 0, removedRespawn.stderr || removedRespawn.stdout)
  } finally {
    await rm(configDir, { recursive: true, force: true })
  }
})
