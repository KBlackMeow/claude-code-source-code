import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
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
  const linkedFile = join(workspace, 'outside-link', 'linked.txt')
  try {
    await symlink(outside, join(workspace, 'outside-link'))
    await SandboxManager.initialize({
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: {
        denyRead: [],
        allowWrite: [workspace],
        denyWrite: [],
      },
    })
    const command = await SandboxManager.wrapWithSandbox(
      `printf allowed > ${allowedFile}; printf blocked > ${blockedFile} 2>/dev/null || true; printf linked > ${linkedFile} 2>/dev/null || true; test ! -e ${blockedFile}; test ! -e ${linkedFile}`,
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

test('macOS sandbox denies configured reads and direct local network access', async t => {
  if (process.platform !== 'darwin') {
    t.skip('this execution assertion requires macOS sandbox-exec')
    return
  }

  const { SandboxManager } = await import('@anthropic-ai/sandbox-runtime')
  const workspace = await mkdtemp(join(process.cwd(), '.sandbox-test-'))
  const outside = await mkdtemp(join(tmpdir(), 'claude-sandbox-outside-'))
  const blockedFile = join(outside, 'secret.txt')
  const server = createServer((_request, response) => response.end('ok'))
  try {
    await writeFile(blockedFile, 'secret', 'utf8')
    assert.equal(await readFile(blockedFile, 'utf8'), 'secret')
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    const url = `http://127.0.0.1:${address.port}`
    assert.equal(await (await fetch(url)).text(), 'ok')

    await SandboxManager.initialize({
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: {
        denyRead: [blockedFile],
        allowWrite: [workspace],
        denyWrite: [],
      },
    })

    const readCommand = await SandboxManager.wrapWithSandbox(`cat ${blockedFile}`, '/bin/sh')
    const readResult = spawnSync(readCommand, { cwd: workspace, encoding: 'utf8', shell: true })
    assert.notEqual(readResult.status, 0)

    const networkCommand = await SandboxManager.wrapWithSandbox(
      `curl --noproxy '*' --max-time 2 --silent --show-error ${url}`,
      '/bin/sh',
    )
    const networkResult = await new Promise((resolve, reject) => {
      const child = spawn('/bin/sh', ['-c', networkCommand], { cwd: workspace })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
      child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
      child.once('error', reject)
      child.once('close', status => resolve({ status, stdout, stderr }))
    })
    assert.notEqual(networkResult.status, 0, networkResult.stdout)
  } finally {
    await SandboxManager.reset()
    if (server.listening) {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
