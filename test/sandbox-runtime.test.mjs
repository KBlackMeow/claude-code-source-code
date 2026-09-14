import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('the real sandbox runtime creates a platform sandbox wrapper', async t => {
  if (process.platform === 'win32') {
    t.skip('native Windows sandbox is not a release target yet')
    return
  }

  const { SandboxManager } = await import('@anthropic-ai/sandbox-runtime')
  if (!SandboxManager.isSupportedPlatform()) {
    t.skip('sandbox runtime does not support this platform')
    return
  }

  await SandboxManager.initialize({
    network: { allowedDomains: [], deniedDomains: [] },
    filesystem: {
      denyRead: [],
      allowWrite: [process.cwd()],
      denyWrite: [],
    },
  })
  try {
    const command = await SandboxManager.wrapWithSandbox(
      'printf sandbox-ready',
      process.platform === 'darwin' ? '/bin/sh' : 'sh',
    )
    assert.match(command, process.platform === 'darwin' ? /sandbox-exec/ : /bwrap|bubblewrap/)
  } finally {
    await SandboxManager.reset()
  }
})

test('macOS sandbox allows project writes and blocks writes outside its grant', async t => {
  if (process.platform !== 'darwin') {
    t.skip('this execution assertion requires macOS sandbox-exec')
    return
  }

  const { SandboxManager } = await import('@anthropic-ai/sandbox-runtime')
  const workspace = await mkdtemp(join(process.cwd(), '.sandbox-test-'))
  const outside = await mkdtemp(join(tmpdir(), 'claude-sandbox-outside-'))
  const allowedFile = join(workspace, 'allowed.txt')
  const blockedFile = join(outside, 'blocked.txt')
  try {
    await SandboxManager.initialize({
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: {
        denyRead: [],
        allowWrite: [workspace],
        denyWrite: [],
      },
    })
    const command = await SandboxManager.wrapWithSandbox(
      `printf allowed > ${allowedFile}; printf blocked > ${blockedFile} 2>/dev/null || true; test ! -e ${blockedFile}`,
      '/bin/sh',
    )
    const result = spawnSync(command, {
      cwd: workspace,
      encoding: 'utf8',
      shell: true,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(execFileSync('cat', [allowedFile], { encoding: 'utf8' }), 'allowed')
  } finally {
    await SandboxManager.reset()
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
