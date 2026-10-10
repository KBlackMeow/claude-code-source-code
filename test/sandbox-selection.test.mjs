import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const modules = new Map([
  ['src/services/analytics/growthbook.js', 'export function getFeatureValue_CACHED_MAY_BE_STALE() { return { commands: [], substrings: [] } }'],
  ['../../utils/bash/commands.js', 'export function splitCommand_DEPRECATED(command) { return [command] }'],
  ['../../utils/sandbox/sandbox-adapter.js', `export const SandboxManager = {
    isSandboxingEnabled() { return process.env.CLAUDE_CODE_SANDBOX_OVERRIDE !== '0' },
    areUnsandboxedCommandsAllowed() { return process.env.CLAUDE_CODE_SANDBOX_OVERRIDE !== '1' },
  }`],
  ['../../utils/settings/settings.js', 'export function getSettings_DEPRECATED() { return { sandbox: { excludedCommands: ["printf"] } } }'],
  ['./bashPermissions.js', `export const BINARY_HIJACK_VARS = []
    export function bashPermissionRule(command) { return { type: 'exact', command } }
    export function matchWildcardPattern() { return false }
    export function stripAllLeadingEnvVars(command) { return command }
    export function stripSafeWrappers(command) { return command }`],
])

const bundle = await build({
  entryPoints: [join(root, 'src/tools/BashTool/shouldUseSandbox.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [{
    name: 'sandbox-selection-dependencies',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.kind === 'entry-point') return
        assert.ok(modules.has(args.path), `Unexpected import: ${args.path}`)
        return { path: args.path, namespace: 'test-dependency' }
      })
      builder.onLoad({ filter: /.*/, namespace: 'test-dependency' }, args => ({
        contents: modules.get(args.path),
        loader: 'js',
      }))
    },
  }],
})
const { shouldUseSandbox } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

test('excluded commands run unsandboxed only when bypass is allowed', () => {
  const originalOverride = process.env.CLAUDE_CODE_SANDBOX_OVERRIDE
  try {
    delete process.env.CLAUDE_CODE_SANDBOX_OVERRIDE
    assert.equal(shouldUseSandbox({ command: 'printf' }), false)
    assert.equal(shouldUseSandbox({ command: 'echo' }), true)

    process.env.CLAUDE_CODE_SANDBOX_OVERRIDE = '1'
    assert.equal(shouldUseSandbox({ command: 'printf' }), true)
    assert.equal(shouldUseSandbox({ command: 'printf', dangerouslyDisableSandbox: true }), true)

    process.env.CLAUDE_CODE_SANDBOX_OVERRIDE = '0'
    assert.equal(shouldUseSandbox({ command: 'echo' }), false)
  } finally {
    if (originalOverride === undefined) delete process.env.CLAUDE_CODE_SANDBOX_OVERRIDE
    else process.env.CLAUDE_CODE_SANDBOX_OVERRIDE = originalOverride
  }
})
