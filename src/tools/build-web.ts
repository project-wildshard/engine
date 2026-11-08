// Builds the web SPA with rolldown into src/dist/web.
//   node src/tools/build-web.ts          one production build
//   node src/tools/build-web.ts --dev    watch + serve on 4402 (one process)
import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { build, watch } from 'rolldown'

import { readVersion } from '../cli/version.ts'
import { serve } from '../server/serve.ts'

import type { BuildOptions } from 'rolldown'

const WEB = new URL('../client/', import.meta.url)
const OUT_DIR = fileURLToPath(new URL('../dist/web/', import.meta.url))
const DEV_PORT = 4402

const OPTIONS: BuildOptions = {
  input: fileURLToPath(new URL('main.tsx', WEB)),
  platform: 'browser',
  transform: { target: 'es2024', jsx: 'react-jsx' },
  output: {
    dir: OUT_DIR,
    entryFileNames: 'main.js',
    format: 'esm',
    sourcemap: true,
  },
}

async function copyHtml(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })
  await copyFile(
    fileURLToPath(new URL('index.html', WEB)),
    `${OUT_DIR}index.html`,
  )
}

async function buildOnce(): Promise<void> {
  await copyHtml()
  await build({ ...OPTIONS, output: { ...OPTIONS.output, minify: true } })
}

async function dev(): Promise<void> {
  await copyHtml()
  await build(OPTIONS)
  watch(OPTIONS)
  // The server reads dist/web per request, so a refresh shows the new build.
  const server = await serve({ port: DEV_PORT, version: await readVersion() })
  process.stdout.write(`engine dev on ${server.url}\n`)
}

const { values } = parseArgs({
  options: { dev: { type: 'boolean', default: false } },
})

const run = values.dev ? dev : buildOnce
await run()
