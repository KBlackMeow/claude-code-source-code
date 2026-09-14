import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const cli = join(root, 'dist', 'cli.js')
const run = args => spawnSync(process.execPath, [cli, ...args], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR },
})

assert.ok(Number(process.versions.node.split('.')[0]) >= 20, 'Node.js 20+ is required')
const version = run(['--version'])
assert.equal(version.status, 0, version.stderr)
assert.match(version.stdout, /Claude Code/)
const help = run(['--help'])
assert.equal(help.status, 0, help.stderr)
assert.match(help.stdout, /--permission-mode/)

if (process.platform === 'win32') {
  assert.ok(process.env.ComSpec || process.env.COMSPEC, 'Windows must expose COMSPEC')
  const git = spawnSync('where.exe', ['git'], { encoding: 'utf8' })
  assert.equal(git.status, 0, 'Git must be discoverable on Windows')
  const bash = spawnSync('where.exe', ['bash'], { encoding: 'utf8' })
  if (bash.status !== 0 && process.env.CLAUDE_CODE_GIT_BASH_PATH) {
    await access(process.env.CLAUDE_CODE_GIT_BASH_PATH)
  } else {
    assert.equal(bash.status, 0, 'Git Bash or WSL bash must be discoverable on Windows')
  }
}

const fixture = await mkdtemp(join(tmpdir(), 'claude-platform-空 格-'))
try {
  await writeFile(join(fixture, '文件.txt'), 'ok\n', 'utf8')
  const config = await mkdtemp(join(fixture, 'config-'))
  const agents = spawnSync(process.execPath, [cli, 'agents', '--json'], {
    cwd: fixture,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: config },
  })
  assert.equal(agents.status, 0, agents.stderr)
  assert.doesNotThrow(() => JSON.parse(agents.stdout))
} finally {
  await rm(fixture, { recursive: true, force: true })
}

console.log(`platform smoke passed (${process.platform}/${process.arch})`)
