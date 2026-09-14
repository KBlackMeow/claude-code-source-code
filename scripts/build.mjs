#!/usr/bin/env node
/**
 * build.mjs — Best-effort build of Claude Code v2.1.88 from source
 *
 * ⚠️  IMPORTANT: A complete rebuild requires the Bun runtime's compile-time
 *     intrinsics (feature(), MACRO, bun:bundle). This script provides a
 *     best-effort build using esbuild. See KNOWN_ISSUES.md for details.
 *
 * What this script does:
 *   1. Copy src/ → build-src/ (original untouched)
 *   2. Replace `feature('X')` → `false`  (compile-time → runtime)
 *   3. Replace `MACRO.VERSION` etc → string literals
 *   4. Replace `import from 'bun:bundle'` → stub
 *   5. Create stubs for missing feature-gated modules
 *   6. Bundle with esbuild → dist/cli.js
 *
 * Requirements: Node.js >= 18, npm
 * Usage:       node scripts/build.mjs
 */

import { readdir, readFile, writeFile, mkdir, cp, rm, stat, chmod } from 'node:fs/promises'
import { join, dirname, relative, resolve, isAbsolute } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const VERSION = '2.1.88'
const BUILD = join(ROOT, 'build-src')
const ENTRY = join(BUILD, 'entry.ts')
const require = createRequire(import.meta.url)
const esbuildBin = join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild')

// ── Helpers ────────────────────────────────────────────────────────────────

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory() && e.name !== 'node_modules') yield* walk(p)
    else yield p
  }
}

async function exists(p) { try { await stat(p); return true } catch { return false } }

async function ensureEsbuild() {
  try { execFileSync(process.execPath, [esbuildBin, '--version'], { stdio: 'pipe' }) }
  catch {
    console.log('📦 Installing esbuild...')
    throw new Error('esbuild is unavailable. Run "npm install" from the project root, then retry.')
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 1: Copy source
// ══════════════════════════════════════════════════════════════════════════════

await rm(BUILD, { recursive: true, force: true })
await mkdir(BUILD, { recursive: true })
await cp(join(ROOT, 'src'), join(BUILD, 'src'), { recursive: true })
await cp(join(ROOT, 'stubs'), join(BUILD, 'src', 'stubs'), { recursive: true })
console.log('✅ Phase 1: Copied src/ → build-src/')

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 2: Transform source
// ══════════════════════════════════════════════════════════════════════════════

let transformCount = 0

// MACRO replacements
const MACROS = {
  'MACRO.VERSION': `'${VERSION}'`,
  'MACRO.BUILD_TIME': `''`,
  'MACRO.FEEDBACK_CHANNEL': `'https://github.com/anthropics/claude-code/issues'`,
  'MACRO.ISSUES_EXPLAINER': `'https://github.com/anthropics/claude-code/issues/new/choose'`,
  'MACRO.FEEDBACK_CHANNEL_URL': `'https://github.com/anthropics/claude-code/issues'`,
  'MACRO.ISSUES_EXPLAINER_URL': `'https://github.com/anthropics/claude-code/issues/new/choose'`,
  'MACRO.NATIVE_PACKAGE_URL': `'@anthropic-ai/claude-code'`,
  'MACRO.PACKAGE_URL': `'@anthropic-ai/claude-code'`,
  'MACRO.VERSION_CHANGELOG': `''`,
}
const ENABLED_FEATURES = new Set([
  // Re-enabled features have dedicated offline integration coverage.
  'TRANSCRIPT_CLASSIFIER',
  'BG_SESSIONS',
])

for await (const file of walk(join(BUILD, 'src'))) {
  if (!file.match(/\.[tj]sx?$/)) continue

  let src = await readFile(file, 'utf8')
  let changed = false

  // 2a. Resolve compile-time feature flags in the isolated build copy.
  if (/\bfeature\s*\(\s*['"][A-Z_]+['"]\s*\)/.test(src)) {
    src = src.replace(/\bfeature\s*\(\s*['"]([A-Z_]+)['"]\s*\)/g, (_match, flag) =>
      ENABLED_FEATURES.has(flag) ? 'true' : 'false',
    )
    changed = true
  }

  // 2b. MACRO.X → literals
  for (const [k, v] of Object.entries(MACROS)) {
    if (src.includes(k)) {
      src = src.replaceAll(k, v)
      changed = true
    }
  }

  // 2c. Remove bun:bundle import (feature() is already replaced)
  if (src.includes("from 'bun:bundle'") || src.includes('from "bun:bundle"')) {
    src = src.replace(/import\s*\{\s*feature\s*\}\s*from\s*['"]bun:bundle['"];?\n?/g, '// feature() replaced with false at build time\n')
    changed = true
  }

  // 2d. Remove type-only import of global.d.ts
  if (src.includes("import '../global.d.ts'") || src.includes("import './global.d.ts'")) {
    src = src.replace(/import\s*['"][.\/]*global\.d\.ts['"];?\n?/g, '')
    changed = true
  }

  // 2e. import.meta.url → CJS equivalent
  if (src.includes('import.meta.url')) {
    src = src.replace(/import\.meta\.url/g, "require('url').pathToFileURL(module.filename).href")
    changed = true
  }

  if (changed) {
    await writeFile(file, src, 'utf8')
    transformCount++
  }
}
console.log(`✅ Phase 2: Transformed ${transformCount} files`)

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 3: Create entry wrapper
// ══════════════════════════════════════════════════════════════════════════════

await writeFile(ENTRY, `// Claude Code v${VERSION} — built from source
// Copyright (c) Anthropic PBC. All rights reserved.
import './src/entrypoints/cli.tsx'
`, 'utf8')
console.log('✅ Phase 3: Created entry wrapper')

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 4: Iterative stub + bundle
// ══════════════════════════════════════════════════════════════════════════════

await ensureEsbuild()

const OUT_DIR = join(ROOT, 'dist')
await mkdir(OUT_DIR, { recursive: true })
await writeFile(join(OUT_DIR, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2), 'utf8')
const OUT_FILE = join(OUT_DIR, 'cli.js')

// Run up to 20 rounds of: esbuild → collect missing → create stubs → retry
const MAX_ROUNDS = 20
let succeeded = false
const generatedStubs = []

for (let round = 1; round <= MAX_ROUNDS; round++) {
  console.log(`\n🔨 Phase 4 round ${round}/${MAX_ROUNDS}: Bundling...`)

  let esbuildOutput = ''
  try {
    esbuildOutput = execFileSync(process.execPath, [esbuildBin,
      ENTRY,
      '--bundle',
      '--platform=node',
      '--target=node20',
      '--format=cjs',
      `--define:import.meta.url=${JSON.stringify(pathToFileURL(OUT_FILE).href)}`,
      `--outfile=${OUT_FILE}`,
      `--banner:js=#!/usr/bin/env node\n// Claude Code v${VERSION} (built from source)\n// Copyright (c) Anthropic PBC. All rights reserved.\n`,
      `--tsconfig=${join(ROOT, 'tsconfig.json')}`,
      `--alias:src=${join(BUILD, 'src')}`,
      `--alias:@anthropic-ai/bedrock-sdk=${join(ROOT, 'stubs', 'generic-stub.ts')}`,
      `--alias:@anthropic-ai/foundry-sdk=${join(ROOT, 'stubs', 'generic-stub.ts')}`,
      `--alias:@anthropic-ai/vertex-sdk=${join(ROOT, 'stubs', 'generic-stub.ts')}`,
      `--alias:@anthropic-ai/mcpb=${join(ROOT, 'stubs', 'generic-stub.ts')}`,
      `--alias:@ant/claude-for-chrome-mcp=${join(ROOT, 'stubs', 'generic-stub.ts')}`,
      '--external:bun:*',
      '--external:@aws-sdk/client-bedrock',
      '--external:@aws-sdk/client-sts',
      '--external:@azure/identity',
      '--external:modifiers-napi',
      '--external:sharp',
      '--loader:.md=text',
      '--loader:.txt=text',
      '--allow-overwrite',
      '--log-level=error',
      '--log-limit=0',
      '--sourcemap',
    ], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).stderr?.toString() || ''
    succeeded = true
    break
  } catch (e) {
    esbuildOutput = (e.stderr?.toString() || '') + (e.stdout?.toString() || '')
  }

  // Parse missing modules and the file that imported them so we can place
  // stubs at the exact relative path esbuild expects.
  const missing = []
  const lines = esbuildOutput.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const modMatch = lines[i].match(/Could not resolve "([^"]+)"/)
    if (!modMatch) continue

    const mod = modMatch[1]
    if (mod.startsWith('node:') || mod.startsWith('bun:') || isAbsolute(mod)) {
      continue
    }

    let importer
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const locMatch = lines[j].match(/^\s*(.+:\d+:\d+):\s*$/)
      if (locMatch) {
        importer = locMatch[1].replace(/:\d+:\d+$/, '')
        break
      }
    }

    missing.push({ mod, importer })
  }

  if (missing.length === 0) {
    const exportFixes = new Map()
    for (const line of lines) {
      const exportMatch = line.match(/No matching export in "([^"]+)" for import "([^"]+)"/)
      if (!exportMatch) continue
      const modulePath = exportMatch[1]
      const exportName = exportMatch[2]
      if (modulePath.startsWith('node:') || modulePath.startsWith('bun:') || isAbsolute(modulePath)) {
        continue
      }
      if (!exportFixes.has(modulePath)) exportFixes.set(modulePath, new Set())
      exportFixes.get(modulePath).add(exportName)
    }

    if (exportFixes.size > 0) {
      for (const [modulePath, exportNames] of exportFixes) {
        const target = resolve(ROOT, modulePath)
        await mkdir(dirname(target), { recursive: true }).catch(() => {})
        const baseName = modulePath.split('/').pop().replace(/\.[tj]sx?$/, '')
        const safeBase = baseName.replace(/[^a-zA-Z0-9_$]/g, '_') || 'stub'
        const exports = [...exportNames].sort().map(name => `export const ${name} = 0`).join('\n')
        const content = `// Auto-generated stub\nconst ${safeBase}Stub = 0\nexport default ${safeBase}Stub\n${exports}\n`
        await writeFile(target, content, 'utf8')
        generatedStubs.push(relative(ROOT, target))
      }
      console.log(`   Fixed ${exportFixes.size} modules with missing exports`)
      continue
    }

    // No more missing modules but still errors — check what
    const errLines = esbuildOutput.split('\n').filter(l => l.includes('ERROR')).slice(0, 5)
    console.log('❌ Unrecoverable errors:')
    errLines.forEach(l => console.log('   ' + l))
    break
  }

  console.log(`   Found ${missing.length} missing modules, creating stubs...`)

  // Create stubs
  let stubCount = 0
  for (const { mod, importer } of missing) {
    const baseTarget = importer ? resolve(dirname(importer), mod) : null
    const targets = baseTarget ? [baseTarget] : []
    const cleanMod = mod.replace(/^\.\//, '')
    const normalizedMod = cleanMod.replace(/^(\.\.\/)+/, '')
    targets.push(join(BUILD, 'src', normalizedMod))

    // Text assets → empty file
    if (/\.(txt|md|json)$/.test(normalizedMod)) {
      for (const p of targets) {
        await mkdir(dirname(p), { recursive: true }).catch(() => {})
        if (!await exists(p)) {
          await writeFile(p, normalizedMod.endsWith('.json') ? '{}' : '', 'utf8')
          stubCount++
        }
      }
      continue
    }

    // JS/TS modules → export empty
    if (/\.[tj]sx?$/.test(normalizedMod)) {
      for (const p of targets) {
        await mkdir(dirname(p), { recursive: true }).catch(() => {})
        if (!await exists(p)) {
          const name = normalizedMod.split('/').pop().replace(/\.[tj]sx?$/, '')
          const safeName = name.replace(/[^a-zA-Z0-9_$]/g, '_') || 'stub'
          await writeFile(
            p,
            `// Auto-generated stub\nconst ${safeName}Stub = () => {}\nexport default ${safeName}Stub\nexport { ${safeName}Stub as ${safeName} }\n`,
            'utf8',
          )
          generatedStubs.push(relative(ROOT, p))
          stubCount++
        }
      }
    }
  }
  console.log(`   Created ${stubCount} stubs`)
}

if (succeeded) {
  // The source build has no Bun-embedded ripgrep. Ship the npm package's
  // platform binary beside the CLI so startup and search do not depend on PATH.
  let sourceRgPath
  try {
    sourceRgPath = require('@vscode/ripgrep').rgPath
  } catch (error) {
    throw new Error('ripgrep package is unavailable; run npm install before building', { cause: error })
  }
  if (!sourceRgPath || !await exists(sourceRgPath)) {
    throw new Error(`ripgrep binary is unavailable for ${process.platform}/${process.arch}`)
  }
  const rgFileName = process.platform === 'win32' ? 'rg.exe' : 'rg'
  const rgRelativePath = join('vendor', 'ripgrep', `${process.arch}-${process.platform}`, rgFileName)
  const bundledRgPath = join(OUT_DIR, rgRelativePath)
  await mkdir(dirname(bundledRgPath), { recursive: true })
  await cp(sourceRgPath, bundledRgPath)
  if (process.platform !== 'win32') await chmod(bundledRgPath, 0o755)
  execFileSync(bundledRgPath, ['--version'], { stdio: 'pipe' })

  const size = (await stat(OUT_FILE)).size
  const manifest = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    enabledFeatures: [...ENABLED_FEATURES].sort(),
    runtimeDependencies: {
      sandbox: '@anthropic-ai/sandbox-runtime',
      sandboxStubbed: false,
      ripgrep: '@vscode/ripgrep',
      ripgrepBinary: rgRelativePath,
    },
    buildAliases: {
      '@anthropic-ai/bedrock-sdk': 'stubs/generic-stub.ts',
      '@anthropic-ai/foundry-sdk': 'stubs/generic-stub.ts',
      '@anthropic-ai/vertex-sdk': 'stubs/generic-stub.ts',
      '@anthropic-ai/mcpb': 'stubs/generic-stub.ts',
      '@ant/claude-for-chrome-mcp': 'stubs/generic-stub.ts',
    },
    generatedStubs: [...new Set(generatedStubs)].sort(),
  }
  await writeFile(
    join(OUT_DIR, 'build-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )
  console.log(`\n✅ Build succeeded: ${OUT_FILE}`)
  console.log(`   Size: ${(size / 1024 / 1024).toFixed(1)}MB`)
  console.log(`   Build manifest: ${join(OUT_DIR, 'build-manifest.json')}`)
  console.log(`\n   Usage:  node ${OUT_FILE} --version`)
  console.log(`           node ${OUT_FILE} -p "Hello"`)
} else {
  console.error('\n❌ Build failed after all rounds.')
  console.error('   The transformed source is in build-src/ for inspection.')
  console.error('\n   To fix manually:')
  console.error('   1. Check build-src/ for the transformed files')
  console.error('   2. Create missing stubs in build-src/src/')
  console.error('   3. Re-run: node scripts/build.mjs')
  process.exit(1)
}
