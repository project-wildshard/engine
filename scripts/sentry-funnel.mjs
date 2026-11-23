#!/usr/bin/env node
// SENTRY-ZERO SZ7 (meta docs/plans/SENTRY-ZERO-PLAN.md): every Sentry send goes through one of the two funnels that hold the
// send policy (the browser's telemetry/browserErrors.ts with telemetry/sendPolicy.ts; the rooms server's serverSentry.ts),
// and nothing asks Sentry for a warning or info event. test/sentry-funnel.test.ts runs this over the tree.
//
//   node scripts/sentry-funnel.mjs     prints each violation; exit 1 when there is one
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** The only files that may call the Sentry SDK's capture functions. */
export const FUNNELS = Object.freeze(['src/client/engine/telemetry/browserErrors.ts', 'src/server/host/dedicated/serverSentry.ts']);
const CAPTURE = /\b(?:captureException|captureMessage|captureEvent)\s*\(/u;
const QUIET_LEVEL = /\bsetLevel\s*\(\s*['"`](?:warning|info|log|debug)['"`]|\blevel\s*:\s*['"`](?:warning|info)['"`]\s*[,}]/u;
const SENTRY_IMPORT = /from\s+['"]@sentry\//u;

/**
 * The violations in a set of source files: a Sentry capture outside the funnels, or a warning/info level in a file that talks to
 * Sentry. Tests and type declarations are left out.
 * @param {readonly {path: string, text: string}[]} files
 * @returns {string[]}
 */
export function funnelViolations(files) {
  const out = [];
  for (const { path, text } of files) {
    if (/\.test\.[cm]?[jt]s$|\.d\.m?ts$/u.test(path)) continue;
    const sentry = SENTRY_IMPORT.test(text) || FUNNELS.includes(path);
    text.split('\n').forEach((line, index) => {
      const at = `${path}:${String(index + 1)}`;
      if (CAPTURE.test(line) && sentry && !FUNNELS.includes(path)) out.push(`${at}: a Sentry capture outside the funnels (${FUNNELS.join(', ')}); call captureBrowserError instead`);
      if (sentry && QUIET_LEVEL.test(line)) out.push(`${at}: a warning or info level sent to Sentry; warnings stay off Sentry (SENTRY-ZERO SZ2)`);
    });
  }
  return out;
}

/** The tree's TypeScript and JavaScript sources, as git lists them. */
export function sourceFiles(cwd = process.cwd()) {
  const listed = spawnSync('git', ['ls-files', '-z', '--', 'src', 'scripts'], { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (listed.status !== 0) throw new Error(`git ls-files: ${listed.stderr.trim()}`);
  return listed.stdout.split('\0').filter((path) => /\.(?:[cm]?[jt]s)$/u.test(path)).map((path) => ({ path, text: readFileSync(`${cwd}/${path}`, 'utf8') }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = funnelViolations(sourceFiles());
  for (const line of found) console.error(line);
  console.log(`sentry-funnel: ${String(found.length)} violation(s)`);
  process.exitCode = found.length === 0 ? 0 : 1;
}
