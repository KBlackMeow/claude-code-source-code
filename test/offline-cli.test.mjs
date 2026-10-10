import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const mathSource = fileURLToPath(new URL('./e2e-fixture/math.js', import.meta.url))
const mathTest = fileURLToPath(new URL('./e2e-fixture/math.test.mjs', import.meta.url))

function runCli(args, cwd, env, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    const timeout = setTimeout(() => child.kill(), timeoutMs)
    child.once('error', reject)
    child.once('close', status => {
      clearTimeout(timeout)
      resolve({ status, stdout, stderr })
    })
  })
}

function writeEvent(response, event, data) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function reply(response, contentBlock, stopReason) {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  writeEvent(response, 'message_start', {
    type: 'message_start',
    message: {
      id: 'msg_sandbox_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 20, output_tokens: 0 },
    },
  })
  writeEvent(response, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: contentBlock.type === 'tool_use'
      ? { type: 'tool_use', id: contentBlock.id, name: contentBlock.name, input: {} }
      : { type: 'text', text: '' },
  })
  writeEvent(response, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: contentBlock.type === 'tool_use'
      ? { type: 'input_json_delta', partial_json: JSON.stringify(contentBlock.input) }
      : { type: 'text_delta', text: contentBlock.text },
  })
  writeEvent(response, 'content_block_stop', { type: 'content_block_stop', index: 0 })
  writeEvent(response, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 20 },
  })
  writeEvent(response, 'message_stop', { type: 'message_stop' })
  response.end()
}

test('CLI --sandbox does not exempt a configured excluded command', { skip: process.platform !== 'darwin' }, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'claude-sandbox-cli-'))
  const workspace = join(fixture, 'workspace')
  const outside = join(fixture, 'outside')
  const config = join(fixture, 'config')
  const settings = join(fixture, 'settings.json')
  const allowedFile = join(workspace, 'allowed.txt')
  const blockedFile = join(outside, 'blocked.txt')
  const command = `printf allowed > ${allowedFile}; printf blocked > ${blockedFile}`
  const server = createServer((request, response) => {
    if (request.url?.includes('/count_tokens')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ input_tokens: 20 }))
      return
    }
    if (!request.url?.includes('/messages')) {
      response.writeHead(404)
      response.end()
      return
    }
    let body = ''
    request.setEncoding('utf8').on('data', chunk => { body += chunk })
    request.on('end', () => {
      const messages = JSON.parse(body).messages
      const hasToolResult = messages.some(message =>
        Array.isArray(message.content) && message.content.some(block => block.type === 'tool_result'),
      )
      if (hasToolResult) {
        reply(response, { type: 'text', text: 'sandbox test complete' }, 'end_turn')
      } else {
        reply(response, {
          type: 'tool_use',
          id: 'toolu_sandbox_test',
          name: 'Bash',
          input: { command, description: 'Check sandbox boundary' },
        }, 'tool_use')
      }
    })
  })
  try {
    await Promise.all([
      mkdir(workspace),
      mkdir(outside),
      mkdir(config),
    ])
    await writeFile(settings, JSON.stringify({ sandbox: { excludedCommands: ['printf:*'] } }))
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })

    const env = {
      ...process.env,
      ANTHROPIC_API_KEY: 'sandbox-test-key',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      CLAUDE_CONFIG_DIR: config,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    }
    delete env.NODE_TEST_CONTEXT
    const result = await runCli([
      '--bare',
      '--sandbox',
      '--settings', settings,
      '--dangerously-skip-permissions',
      '--model', 'claude-sonnet-4-6',
      '-p', 'Run the requested sandbox check',
    ], workspace, env)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(await readFile(allowedFile, 'utf8'), 'allowed')
    await assert.rejects(readFile(blockedFile, 'utf8'), { code: 'ENOENT' })
  } finally {
    if (server.listening) {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
    await rm(fixture, { recursive: true, force: true })
  }
})

test('CLI completes an offline read, edit, and test workflow', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'claude-workflow-cli-'))
  const workspace = join(fixture, 'workspace')
  const config = join(fixture, 'config')
  const sourceFile = join(workspace, 'math.js')
  let observedResults = []
  const server = createServer((request, response) => {
    if (request.url?.includes('/count_tokens')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ input_tokens: 20 }))
      return
    }
    if (!request.url?.includes('/messages')) {
      response.writeHead(404)
      response.end()
      return
    }
    let body = ''
    request.setEncoding('utf8').on('data', chunk => { body += chunk })
    request.on('end', () => {
      const messages = JSON.parse(body).messages
      const results = messages.flatMap(message =>
        Array.isArray(message.content) ? message.content.filter(block => block.type === 'tool_result') : [],
      )
      observedResults = results
      const actions = [
        { name: 'Read', input: { file_path: sourceFile } },
        {
          name: 'Edit',
          input: {
            file_path: sourceFile,
            old_string: 'export function add(left, right) {\n  return left - right\n}',
            new_string: 'export function add(left, right) {\n  return left + right\n}',
          },
        },
        { name: 'Bash', input: { command: 'node --test math.test.mjs', description: 'Run math tests' } },
      ]
      if (results.length < actions.length) {
        reply(response, {
          type: 'tool_use',
          id: `toolu_workflow_${results.length}`,
          ...actions[results.length],
        }, 'tool_use')
      } else {
        reply(response, { type: 'text', text: 'workflow test complete' }, 'end_turn')
      }
    })
  })
  try {
    await Promise.all([mkdir(workspace), mkdir(config)])
    await writeFile(sourceFile, (await readFile(mathSource, 'utf8')).replace(
      'export function add(left, right) {\n  return left + right\n}',
      'export function add(left, right) {\n  return left - right\n}',
    ))
    await writeFile(join(workspace, 'math.test.mjs'), await readFile(mathTest))
    await writeFile(join(workspace, 'package.json'), '{"type":"module"}')
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })

    const env = {
      ...process.env,
      ANTHROPIC_API_KEY: 'workflow-test-key',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      CLAUDE_CONFIG_DIR: config,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    }
    delete env.NODE_TEST_CONTEXT
    const result = await runCli([
      '--bare',
      '--no-session-persistence',
      '--dangerously-skip-permissions',
      '--model', 'claude-sonnet-4-6',
      '-p', 'Read math.js, fix add, and run the tests',
    ], workspace, env)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(result.stdout, /workflow test complete/)
    assert.match(await readFile(sourceFile, 'utf8'), /return left \+ right/)
    assert.equal(observedResults.length, 3)
    assert.ok(observedResults.every(toolResult => toolResult.is_error !== true))
    assert.match(JSON.stringify(observedResults.at(-1)), /pass 3/)
  } finally {
    if (server.listening) {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
    await rm(fixture, { recursive: true, force: true })
  }
})

test('CLI resumes a completed tool turn without repeating its side effect', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'claude-resume-cli-'))
  const workspace = join(fixture, 'workspace')
  const config = join(fixture, 'config')
  const markerFile = join(workspace, 'marker.txt')
  const sessionId = randomUUID()
  let phase = 'first'
  let firstPhaseCalls = 0
  let resumedMessages = []
  const server = createServer((request, response) => {
    if (request.url?.includes('/count_tokens')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ input_tokens: 20 }))
      return
    }
    if (!request.url?.includes('/messages')) {
      response.writeHead(404)
      response.end()
      return
    }
    let body = ''
    request.setEncoding('utf8').on('data', chunk => { body += chunk })
    request.on('end', () => {
      const messages = JSON.parse(body).messages
      if (phase === 'resumed') {
        resumedMessages = messages
        reply(response, { type: 'text', text: 'resume complete' }, 'end_turn')
      } else if (firstPhaseCalls++ === 0) {
        reply(response, {
          type: 'tool_use',
          id: 'toolu_resume_test',
          name: 'Bash',
          input: { command: `printf once >> ${markerFile}`, description: 'Record one execution' },
        }, 'tool_use')
      } else {
        reply(response, { type: 'text', text: 'first turn complete' }, 'end_turn')
      }
    })
  })
  try {
    await Promise.all([mkdir(workspace), mkdir(config)])
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const env = {
      ...process.env,
      ANTHROPIC_API_KEY: 'resume-test-key',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      CLAUDE_CONFIG_DIR: config,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    }
    delete env.NODE_TEST_CONTEXT
    const run = args => runCli([
      '--bare',
      '--dangerously-skip-permissions',
      '--model', 'claude-sonnet-4-6',
      ...args,
    ], workspace, env)

    const first = await run(['--session-id', sessionId, '-p', 'Remember BLUE-FINCH and run the tool'])
    assert.equal(first.status, 0, first.stderr || first.stdout)
    assert.equal(await readFile(markerFile, 'utf8'), 'once')

    phase = 'resumed'
    const second = await run(['--resume', sessionId, '-p', 'What happened in the previous turn?'])
    assert.equal(second.status, 0, second.stderr || second.stdout)
    assert.match(second.stdout, /resume complete/)
    assert.match(JSON.stringify(resumedMessages), /BLUE-FINCH/)
    assert.match(JSON.stringify(resumedMessages), /tool_result/)
    assert.equal(await readFile(markerFile, 'utf8'), 'once')
  } finally {
    if (server.listening) {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
    await rm(fixture, { recursive: true, force: true })
  }
})

test('CLI retries a temporary 529 response from a compatible API', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'claude-retry-cli-'))
  const workspace = join(fixture, 'workspace')
  const config = join(fixture, 'config')
  let messageRequests = 0
  const server = createServer((request, response) => {
    if (request.url?.includes('/count_tokens')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ input_tokens: 20 }))
      return
    }
    if (!request.url?.includes('/messages')) {
      response.writeHead(404)
      response.end()
      return
    }
    request.resume().on('end', () => {
      messageRequests += 1
      if (messageRequests === 1) {
        response.writeHead(529, { 'content-type': 'application/json', 'retry-after': '0' })
        response.end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Temporary overload' } }))
      } else {
        reply(response, { type: 'text', text: 'retry succeeded' }, 'end_turn')
      }
    })
  })
  try {
    await Promise.all([mkdir(workspace), mkdir(config)])
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const env = {
      ...process.env,
      ANTHROPIC_API_KEY: 'retry-test-key',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      CLAUDE_CONFIG_DIR: config,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    }
    delete env.NODE_TEST_CONTEXT
    const result = await runCli([
      '--bare',
      '--no-session-persistence',
      '--model', 'claude-sonnet-4-6',
      '-p', 'Return the test response',
    ], workspace, env, 20000)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(result.stdout, /retry succeeded/)
    assert.ok(messageRequests >= 2)
  } finally {
    if (server.listening) {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
    await rm(fixture, { recursive: true, force: true })
  }
})

test('headless Auto denies a Bash command when its classifier fails', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'claude-auto-cli-'))
  const workspace = join(fixture, 'workspace')
  const config = join(fixture, 'config')
  const markerFile = join(workspace, 'marker.txt')
  let classifierRequests = 0
  let mainRequests = 0
  const server = createServer((request, response) => {
    if (request.url?.includes('/count_tokens')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ input_tokens: 20 }))
      return
    }
    if (!request.url?.includes('/messages')) {
      response.writeHead(404)
      response.end()
      return
    }
    let body = ''
    request.setEncoding('utf8').on('data', chunk => { body += chunk })
    request.on('end', () => {
      const params = JSON.parse(body)
      const isClassifier = params.tools?.some(tool => tool.name === 'classify_result') ||
        JSON.stringify(params.messages).includes('<transcript>')
      if (isClassifier) {
        classifierRequests += 1
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Classifier unavailable' } }))
        return
      }
      mainRequests += 1
      const hasToolResult = params.messages.some(message =>
        Array.isArray(message.content) && message.content.some(block => block.type === 'tool_result'),
      )
      if (hasToolResult) {
        reply(response, { type: 'text', text: 'command was denied' }, 'end_turn')
      } else {
        reply(response, {
          type: 'tool_use',
          id: 'toolu_auto_test',
          name: 'Bash',
          input: { command: `printf unsafe > ${markerFile}`, description: 'Check classifier failure' },
        }, 'tool_use')
      }
    })
  })
  try {
    await Promise.all([mkdir(workspace), mkdir(config)])
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const env = {
      ...process.env,
      ANTHROPIC_API_KEY: 'auto-test-key',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      CLAUDE_CONFIG_DIR: config,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    }
    delete env.NODE_TEST_CONTEXT
    const result = await runCli([
      '--bare',
      '--no-sandbox',
      '--no-session-persistence',
      '--permission-mode', 'auto',
      '--model', 'claude-sonnet-4-6',
      '-p', 'Run the requested command',
    ], workspace, env)
    assert.ok(mainRequests > 0, result.stderr || result.stdout)
    assert.ok(classifierRequests > 0, result.stderr || result.stdout)
    assert.notEqual(result.status, null, 'CLI timed out while handling classifier failure')
    assert.match(result.stdout + result.stderr, /denied|classifier|unavailable/i)
    await assert.rejects(readFile(markerFile, 'utf8'), { code: 'ENOENT' })
  } finally {
    if (server.listening) {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
    await rm(fixture, { recursive: true, force: true })
  }
})

test('CLI Edit rejects invalid UTF-8 without changing file bytes', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'claude-encoding-cli-'))
  const workspace = join(fixture, 'workspace')
  const config = join(fixture, 'config')
  const sourceFile = join(workspace, 'legacy.txt')
  const originalBytes = Buffer.from([0x6e, 0x61, 0x6d, 0x65, 0x3d, 0xe9, 0x0a])
  let editResult
  const server = createServer((request, response) => {
    if (request.url?.includes('/count_tokens')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ input_tokens: 20 }))
      return
    }
    if (!request.url?.includes('/messages')) {
      response.writeHead(404)
      response.end()
      return
    }
    let body = ''
    request.setEncoding('utf8').on('data', chunk => { body += chunk })
    request.on('end', () => {
      const messages = JSON.parse(body).messages
      editResult = messages.flatMap(message =>
        Array.isArray(message.content) ? message.content.filter(block => block.type === 'tool_result') : [],
      ).at(-1)
      if (editResult) {
        reply(response, { type: 'text', text: 'encoding check complete' }, 'end_turn')
      } else {
        reply(response, {
          type: 'tool_use',
          id: 'toolu_encoding_test',
          name: 'Edit',
          input: { file_path: sourceFile, old_string: 'name=', new_string: 'label=' },
        }, 'tool_use')
      }
    })
  })
  try {
    await Promise.all([mkdir(workspace), mkdir(config)])
    await writeFile(sourceFile, originalBytes)
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const env = {
      ...process.env,
      ANTHROPIC_API_KEY: 'encoding-test-key',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      CLAUDE_CONFIG_DIR: config,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    }
    delete env.NODE_TEST_CONTEXT
    const result = await runCli([
      '--bare',
      '--no-session-persistence',
      '--dangerously-skip-permissions',
      '--model', 'claude-sonnet-4-6',
      '-p', 'Edit the legacy file',
    ], workspace, env)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(editResult?.is_error, true)
    assert.match(JSON.stringify(editResult), /invalid utf8/i)
    assert.deepEqual(await readFile(sourceFile), originalBytes)
  } finally {
    if (server.listening) {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
    await rm(fixture, { recursive: true, force: true })
  }
})
