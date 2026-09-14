#!/usr/bin/env node
/**
 * Source preparation deliberately has no write side effects.
 *
 * build.mjs copies src/ to build-src/ before applying the compatibility
 * transforms required by the decompiled Bun sources. Keeping that work out of
 * this script makes `npm run check` and repeated builds reproducible.
 */
import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const requiredBuildInputs = [
  join(root, 'stubs', 'bun-ffi.ts'),
  join(root, 'stubs', 'global.d.ts'),
]

for (const file of requiredBuildInputs) await access(file)
console.log('✅ Source tree left unchanged; transforms run only in build-src/.')
