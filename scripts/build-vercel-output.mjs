#!/usr/bin/env node
// Package the already-tested dist and API functions. Vercel never runs pnpm build again.
// PAGE-SIZE PZ1: the release output carries no source maps. A release build (WILDSHARD_RELEASE_URL names production or
// staging, or WS_SENTRY_ENVIRONMENT names a channel) first gives Sentry the maps (sentry-maps.mjs), then every build drops
// them from `.vercel/output/static`, as preview.yml does. `dist` keeps them: the private copy for the artifact and
// local stack decoding. WS_SENTRY_ENVIRONMENT=none skips the upload.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripDeploySourceMaps } from './deploy-source-maps.mjs';
import { ENVIRONMENTS } from './sentry-maps.mjs';

const STATIC = '.vercel/output/static';

/** Which Sentry environment a release build's maps go to, or undefined for none.
 * @param {Record<string, string | undefined>} env @returns {string | undefined} */
export function sentryEnvironment(env) {
  const named = env.WS_SENTRY_ENVIRONMENT;
  if (named !== undefined && named !== '') {
    if (named === 'none') return undefined;
    if (!ENVIRONMENTS.includes(named)) throw new Error(`WS_SENTRY_ENVIRONMENT must be none or one of ${ENVIRONMENTS.join(', ')}`);
    return named;
  }
  return /\/releases\/(production|staging)\.json(?:[?#]|$)/u.exec(env.WILDSHARD_RELEASE_URL ?? '')?.[1];
}

function main() {
  const original = readFileSync('vercel.json');
  const config = JSON.parse(original.toString());
  try {
    writeFileSync('vercel.json', JSON.stringify({...config, buildCommand:'node scripts/check-devserver.mjs dist',
      installCommand:'true', outputDirectory:'dist'}));
    const result = spawnSync('vercel', ['build','--standalone','--prod','--scope','raynos-projects','--token',process.env.VERCEL_BUILD_TOKEN ?? ''], {stdio:'inherit'});
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally { writeFileSync('vercel.json', original); }
  if (process.exitCode !== 0) return;

  const environment = sentryEnvironment(process.env);
  if (environment !== undefined) {
    // A Sentry outage never stops a release: the maps stay in dist, and in the release's private artifact.
    const upload = spawnSync(process.execPath, [join(import.meta.dirname, 'sentry-maps.mjs'), 'dist', '--environment', environment], {stdio:'inherit'});
    if (upload.status !== 0) console.warn(`build-vercel-output: the Sentry map upload for ${environment} failed; the maps stay in dist only`);
  }
  if (!existsSync(STATIC)) throw new Error(`build-vercel-output: vercel build wrote no ${STATIC}`);
  const stripped = stripDeploySourceMaps(STATIC);
  console.log(`build-vercel-output: ${stripped.files} source maps (${(stripped.bytes / 1e6).toFixed(1)} MB) kept out of ${STATIC}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) main();
