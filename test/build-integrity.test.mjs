import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('..', import.meta.url))

async function sourceFingerprint(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const digest = createHash('sha256')
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      digest.update(await sourceFingerprint(path))
    } else {
      digest.update(entry.name)
      digest.update(await readFile(path))
    }
  }
  return digest.digest('hex')
}

test('prepare-src never modifies the tracked source tree', async () => {
  const before = await sourceFingerprint(join(root, 'src'))
  const result = spawnSync(process.execPath, ['scripts/prepare-src.mjs'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(await sourceFingerprint(join(root, 'src')), before)
})

test('build script is shell-independent', async () => {
  const build = await readFile(join(root, 'scripts/build.mjs'), 'utf8')
  assert.doesNotMatch(build, /shell:\s*true/)
  assert.doesNotMatch(build, /\$'#!\/usr\/bin\/env node/)
})

test('type checking includes stubs without violating rootDir', async () => {
  const config = JSON.parse(await readFile(join(root, 'tsconfig.json'), 'utf8'))
  assert.equal(config.compilerOptions.rootDir, '.')
  assert.equal(config.compilerOptions.ignoreDeprecations, '6.0')
})

test('the built CLI loads with the real sandbox runtime', () => {
  const cli = spawnSync(process.execPath, ['dist/cli.js', '--help'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(cli.status, 0, cli.stderr || cli.stdout)
  assert.match(cli.stdout, /Usage:/)
})

test('auto mode exposes non-empty default safety rules', () => {
  const cli = spawnSync(process.execPath, ['dist/cli.js', 'auto-mode', 'defaults'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(cli.status, 0, cli.stderr || cli.stdout)
  const rules = JSON.parse(cli.stdout)
  assert.ok(rules.allow.length > 0)
  assert.ok(rules.soft_deny.length > 0)
  assert.ok(rules.environment.length > 0)
})

test('Auto is manual and Shift+Tab remains its interactive entry point', async () => {
  const bindings = await readFile(join(root, 'src', 'keybindings', 'defaultBindings.ts'), 'utf8')
  const promptInput = await readFile(join(root, 'src', 'components', 'PromptInput', 'PromptInput.tsx'), 'utf8')
  const permissionSetup = await readFile(join(root, 'src', 'utils', 'permissions', 'permissionSetup.ts'), 'utf8')
  const betas = await readFile(join(root, 'src', 'utils', 'betas.ts'), 'utf8')
  assert.match(bindings, /MODE_CYCLE_KEY\s*=.*'shift\+tab'/s)
  assert.match(bindings, /\[MODE_CYCLE_KEY\]:\s*'chat:cycleMode'/)
  assert.match(promptInput, /'chat:cycleMode':\s*handleCycleMode/)
  assert.match(promptInput, /getNextPermissionMode\(toolPermissionContext, teamContext\)/)
  assert.match(permissionSetup, /const AUTO_MODE_ENABLED_DEFAULT: AutoModeEnabledState = 'enabled'/)
  assert.match(permissionSetup, /result = \{ mode: 'default', notification \}/)
  assert.doesNotMatch(permissionSetup, /defaultToAuto/)
  assert.match(betas, /if \(process\.env\.USER_TYPE !== 'ant'\) return true/)
})

test('startup preserves CLAUDE_CODE_MODEL_OVERRIDE for interactive requests', async () => {
  const main = await readFile(join(root, 'src', 'main.tsx'), 'utf8')
  assert.match(main, /import \{[^}]*getMainLoopModel[^}]*\} from '\.\/utils\/model\/model\.js'/)
  assert.match(main, /setInitialMainLoopModel\(getMainLoopModel\(\)\)/)
  const model = await readFile(join(root, 'src', 'utils', 'model', 'model.ts'), 'utf8')
  assert.match(model, /ANTHROPIC_MODEL \|\|\s*process\.env\.OPENAI_MODEL/)
  const logging = await readFile(join(root, 'src', 'services', 'api', 'logging.ts'), 'utf8')
  assert.match(logging, /const configuredModel = process\.env\.ANTHROPIC_MODEL \|\| process\.env\.OPENAI_MODEL/)
})

test('OpenAI-style endpoint variables are compatible fallbacks', async () => {
  const [clientSource, authSource, managedSource, subprocessSource, swarmSource, filesSource, preconnectSource, proxySource, envSource, uploadSource, loggingSource, providersSource] = await Promise.all([
    readFile(join(root, 'src', 'services', 'api', 'client.ts'), 'utf8'),
    readFile(join(root, 'src', 'utils', 'auth.ts'), 'utf8'),
    readFile(join(root, 'src', 'utils', 'managedEnvConstants.ts'), 'utf8'),
    readFile(join(root, 'src', 'utils', 'subprocessEnv.ts'), 'utf8'),
    readFile(join(root, 'src', 'utils', 'swarm', 'spawnUtils.ts'), 'utf8'),
    readFile(join(root, 'src', 'services', 'api', 'filesApi.ts'), 'utf8'),
    readFile(join(root, 'src', 'utils', 'apiPreconnect.ts'), 'utf8'),
    readFile(join(root, 'src', 'upstreamproxy', 'upstreamproxy.ts'), 'utf8'),
    readFile(join(root, 'src', 'utils', 'managedEnv.ts'), 'utf8'),
    readFile(join(root, 'src', 'tools', 'BriefTool', 'upload.ts'), 'utf8'),
    readFile(join(root, 'src', 'services', 'api', 'logging.ts'), 'utf8'),
    readFile(join(root, 'src', 'utils', 'model', 'providers.ts'), 'utf8'),
  ])
  assert.match(clientSource, /ANTHROPIC_BASE_URL \|\| process\.env\.OPENAI_BASE_URL/)
  assert.match(authSource, /ANTHROPIC_API_KEY \|\| process\.env\.OPENAI_API_KEY/)
  assert.ok(clientSource.indexOf('process.env.ANTHROPIC_BASE_URL') < clientSource.indexOf('process.env.OPENAI_BASE_URL'))
  assert.ok(authSource.indexOf('process.env.ANTHROPIC_API_KEY') < authSource.indexOf('process.env.OPENAI_API_KEY'))
  assert.match(managedSource, /'OPENAI_BASE_URL'/)
  assert.match(subprocessSource, /'OPENAI_API_KEY'/)
  assert.match(swarmSource, /'OPENAI_BASE_URL'/)
  assert.match(filesSource, /process\.env\.OPENAI_BASE_URL/)
  assert.match(preconnectSource, /process\.env\.OPENAI_BASE_URL/)
  assert.match(proxySource, /process\.env\.OPENAI_BASE_URL/)
  assert.match(envSource, /OPENAI_BASE_URL: _2b/)
  assert.match(envSource, /OPENAI_API_KEY: _3b/)
  assert.match(uploadSource, /process\.env\.OPENAI_BASE_URL/)
  assert.match(loggingSource, /process\.env\.ANTHROPIC_BASE_URL \|\| process\.env\.OPENAI_BASE_URL/)
  assert.match(providersSource, /process\.env\.ANTHROPIC_BASE_URL \|\| process\.env\.OPENAI_BASE_URL/)
  const statusSource = await readFile(join(root, 'src', 'utils', 'status.tsx'), 'utf8')
  assert.match(statusSource, /process\.env\.ANTHROPIC_BASE_URL \|\| process\.env\.OPENAI_BASE_URL/)
  const bashPermissions = await readFile(join(root, 'src', 'tools', 'BashTool', 'bashPermissions.ts'), 'utf8')
  assert.match(bashPermissions, /'OPENAI_API_KEY'/)
  const readme = await readFile(join(root, 'README.md'), 'utf8')
  assert.match(readme, /OPENAI_API_KEY.*compatibility fallback/)
  assert.match(readme, /OPENAI_BASE_URL.*usually ending in `\/v1`/)
})

test('safe and restricted modes are documented by the built CLI', () => {
  const cli = spawnSync(process.execPath, ['dist/cli.js', '--help'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(cli.status, 0, cli.stderr || cli.stdout)
  assert.match(cli.stdout, /--safe-mode\s+Start with project\/user\/plugin\/workflow customizations disabled/)
  assert.match(cli.stdout, /--restricted\s+Restrict tools and configuration.*--tools/s)
  return readFile(join(root, 'src', 'commands.ts'), 'utf8').then(source => {
    assert.match(source, /isCustomizationDisabled\(\) \? Promise\.resolve\(\[\]\)/)
  })
})

test('safe mode also ignores user theme customization', async () => {
  const source = await readFile(join(root, 'src', 'QueryEngine.ts'), 'utf8')
  assert.match(source, /isCustomizationDisabled\(\) \? undefined : getGlobalConfig\(\)\.theme/)
})

test('sandbox flags are exposed and have explicit override semantics', async () => {
  const cli = spawnSync(process.execPath, ['dist/cli.js', '--help'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(cli.status, 0, cli.stderr || cli.stdout)
  assert.match(cli.stdout, /--sandbox\s+Require OS-level sandboxing/)
  assert.match(cli.stdout, /--no-sandbox\s+Disable OS-level sandboxing/)

  const source = await readFile(join(root, 'src', 'utils', 'sandbox', 'sandbox-adapter.ts'), 'utf8')
  assert.match(source, /CLAUDE_CODE_SANDBOX_OVERRIDE === '1'/)
  assert.match(source, /CLAUDE_CODE_SANDBOX_OVERRIDE === '0'/)
  assert.match(source, /explicit --sandbox request.*hard boundary/s)
  const printSource = await readFile(join(root, 'src', 'cli', 'print.ts'), 'utf8')
  assert.match(printSource, /Sandbox explicitly disabled.*current user permissions/s)
  const mainSource = await readFile(join(root, 'src', 'main.tsx'), 'utf8')
  assert.match(mainSource, /Sandbox explicitly disabled.*filesystem and network isolation/s)
  const bgSource = await readFile(join(root, 'src', 'cli', 'bg.ts'), 'utf8')
  assert.match(bgSource, /await rename\(temporary, target\)/)
  assert.match(bgSource, /taskkill.*\/T.*\/F/s)
  const sessionSource = await readFile(join(root, 'src', 'utils', 'sessionStorage.ts'), 'utf8')
  assert.match(sessionSource, /writeJsonAtomically/)
})

test('system prompt snapshot flag is exposed with on/off values', async () => {
  const cli = spawnSync(process.execPath, ['dist/cli.js', '--help'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(cli.status, 0, cli.stderr || cli.stdout)
  assert.match(cli.stdout, /--system-prompt-snapshot <on\|off>/)
  const [apiSource, engineSource, querySource] = await Promise.all([
    readFile(join(root, 'src', 'services', 'api', 'claude.ts'), 'utf8'),
    readFile(join(root, 'src', 'QueryEngine.ts'), 'utf8'),
    readFile(join(root, 'src', 'query.ts'), 'utf8'),
  ])
  assert.match(apiSource, /CLAUDE_CODE_SYSTEM_PROMPT_SNAPSHOT_OFF/)
  assert.match(engineSource, /getSystemPrompt:/)
  assert.match(querySource, /getSystemPrompt\(\)/)
})

test('restricted mode rejects permission bypass before starting a session', () => {
  const cli = spawnSync(process.execPath, [
    'dist/cli.js',
    '--restricted',
    '--dangerously-skip-permissions',
    '--print',
    'hello',
  ], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.notEqual(cli.status, 0)
  assert.match(cli.stderr + cli.stdout, /--restricted cannot be combined with --dangerously-skip-permissions/)
})

test('build emits a replacement manifest that identifies the real sandbox runtime', async () => {
  const manifest = JSON.parse(
    await readFile(join(root, 'dist', 'build-manifest.json'), 'utf8'),
  )
  assert.equal(manifest.runtimeDependencies.sandbox, '@anthropic-ai/sandbox-runtime')
  assert.equal(manifest.runtimeDependencies.sandboxStubbed, false)
  assert.equal(manifest.runtimeDependencies.ripgrep, '@vscode/ripgrep')
  assert.ok(Array.isArray(manifest.generatedStubs))
  assert.ok(Array.isArray(manifest.enabledFeatures))
  assert.ok(manifest.enabledFeatures.includes('TRANSCRIPT_CLASSIFIER'))
  assert.ok(manifest.enabledFeatures.includes('BG_SESSIONS'))
  assert.ok(!manifest.generatedStubs.some(path => path.endsWith('utils/taskSummary.js')))
  const criticalModules = [
    'src/tools/BashTool/',
    'src/tools/FileReadTool/',
    'src/tools/FileEditTool/',
    'src/utils/sandbox/',
    'src/utils/permissions/',
    'src/utils/Shell.',
  ]
  for (const stub of manifest.generatedStubs) {
    assert.ok(
      !criticalModules.some(modulePath => stub.includes(modulePath)),
      `Critical module was replaced with a stub: ${stub}`,
    )
  }
})

test('platform CI keeps the three-OS and Node matrix', async () => {
  const workflow = await readFile(join(root, '.github', 'workflows', 'platform-smoke.yml'), 'utf8')
  assert.match(workflow, /macos-latest/)
  assert.match(workflow, /ubuntu-latest/)
  assert.match(workflow, /windows-latest/)
  assert.match(workflow, /node: \[20, 22, 24\]/)
  assert.match(workflow, /npm run smoke:platform/)
})

test('the built CLI ships a working ripgrep even when PATH has no rg', async () => {
  const binary = join(
    root,
    'dist',
    'vendor',
    'ripgrep',
    `${process.arch}-${process.platform}`,
    process.platform === 'win32' ? 'rg.exe' : 'rg',
  )
  assert.ok((await stat(binary)).size > 0)
  const result = spawnSync(binary, ['--no-config', '--count-matches', 'export function', 'math.js'], {
    cwd: join(root, 'test', 'e2e-fixture'),
    env: { ...process.env, PATH: '' },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  assert.equal(result.stdout.trim(), '3')
})

test('autocompact accepts the documented token range and rejects invalid values', () => {
  const accepted = spawnSync(process.execPath, [
    'dist/cli.js',
    '--autocompact',
    '100000',
    '--help',
  ], { cwd: root, encoding: 'utf8' })
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout)

  const rejected = spawnSync(process.execPath, [
    'dist/cli.js',
    '--autocompact',
    '99999',
    '--print',
    'hello',
  ], { cwd: root, encoding: 'utf8' })
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr + rejected.stdout, /100k.*1M/i)
})
