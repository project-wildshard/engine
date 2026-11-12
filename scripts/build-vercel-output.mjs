#!/usr/bin/env node
// Package the already-tested dist and API functions. Vercel never runs pnpm build again.
// PAGE-SIZE PZ1: the release output carries no source maps. A release build first gives Sentry the maps
// (sentry-maps.mjs), then every build drops them from `.vercel/output/static`, as preview.yml does. `dist` keeps them:
// the private copy for the artifact and local stack decoding. The channel is the release file the page was built with
// (its `__WS_WORLD__`, or WILDSHARD_RELEASE_URL); WS_SENTRY_ENVIRONMENT names one outright, and `none` skips the upload.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripDeploySourceMaps } from './deploy-source-maps.mjs';
import { ENVIRONMENTS } from './sentry-maps.mjs';

const STATIC = '.vercel/output/static';

/** The release file a built page names in its `__WS_WORLD__` stamp (buildIdentity.mjs), or '' for a solo page.
 * @param {string} html @returns {string} */
export function pageRelease(html) {
  return /__WS_WORLD__=\{[^;]*?"release":"([^"]+)"/u.exec(html)?.[1] ?? '';
}

/** Which Sentry environment a release build's maps go to, or undefined for none.
 * @param {Record<string, string | undefined>} env @param {string} [html] the built page's index.html
 * @returns {string | undefined} */
export function sentryEnvironment(env, html = '') {
  const named = env.WS_SENTRY_ENVIRONMENT;
  if (named !== undefined && named !== '') {
    if (named === 'none') return undefined;
    if (!ENVIRONMENTS.includes(named)) throw new Error(`WS_SENTRY_ENVIRONMENT must be none or one of ${ENVIRONMENTS.join(', ')}`);
    return named;
  }
  const release = env.WILDSHARD_RELEASE_URL ?? pageRelease(html);
  return /\/releases\/(production|staging)\.json(?:[?#]|$)/u.exec(release)?.[1];
}

function main() {
  sentryEnvironment(process.env); // a bad WS_SENTRY_ENVIRONMENT stops before the long build, not after it
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

  const page = 'dist/index.html';
  const environment = sentryEnvironment(process.env, existsSync(page) ? readFileSync(page, 'utf8') : '');
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
