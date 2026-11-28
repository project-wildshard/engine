#!/usr/bin/env node
// SENTRY-TRIAGE S5 (meta docs/plans/SENTRY-TRIAGE-PLAN.md, J238): give a built page its Sentry release and upload the hidden
// source maps the build wrote (vite.config.ts `sourcemap: 'hidden'`) straight to Sentry, before the deploy strips them, so
// an event's frames read `src/...ts:line`. The maps never reach the CDN: page-release.mjs strips them after this.
//
//   node src/scripts/sentry-maps.mjs dist --environment preview|staging|production
//
// The release and dist are the ones the page reports with (src/client/engine/telemetry/browserErrors.ts): release
// `wildshard@<package.json version>`, dist the build id when it fits Sentry's 64 characters. No token, no upload: it says
// so and exits 0. The token is SENTRY_AUTH_TOKEN, else ~/.config/wildshard/sentry-auth-token (mode 600, never printed).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

/** Pinned: a CLI change never reaches a deploy unasked. */
export const SENTRY_CLI = '@sentry/cli@3.8.2';
export const SENTRY_ORG = 'wildshard';
export const SENTRY_PROJECT = 'wildshard-game';
export const ENVIRONMENTS = Object.freeze(['preview', 'staging', 'production']);
/** The identity's fileSlug (src/client/game/identity.ts), which browserErrorRelease puts before the version. */
const RELEASE_SLUG = 'wildshard';

/** @param {string} dir @returns {string[]} the top-level folders of a build that hold a source map */
export function mapRoots(dir) {
  /** @type {Set<string>} */ const roots = new Set();
  /** @param {string} at */
  function walk(at) {
    for (const name of readdirSync(at)) {
      const path = join(at, name), info = statSync(path);
      if (info.isDirectory()) walk(path);
      else if (name.endsWith('.js.map')) roots.add(relative(dir, path).split(sep)[0] ?? '');
    }
  }
  walk(dir);
  return [...roots].filter((root) => root !== '' && !root.endsWith('.map')).sort();
}

/**
 * The sentry-cli calls for one build, in order: the release, one upload per folder that holds maps (each under its own
 * URL prefix, so `~/builds/shared/entry-x.js` matches the page's `/builds/shared/entry-x.js`), then a deploy for the environment.
 * @param {{dir: string, version: string, build: string, environment: string, roots: readonly string[]}} input
 * @returns {{release: string, dist: string | undefined, commands: string[][]}}
 */
export function sentryMapPlan({ dir, version, build, environment, roots }) {
  if (!ENVIRONMENTS.includes(environment)) throw new Error(`sentry-maps: environment must be one of ${ENVIRONMENTS.join(', ')}`);
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error(`sentry-maps: '${version}' is not a package version`);
  if (build === '') throw new Error('sentry-maps: the build has no id (version.json)');
  if (roots.length === 0) throw new Error(`sentry-maps: no source maps under ${dir}; build with the hidden maps and upload before stripping them`);
  const release = `${RELEASE_SLUG}@${version}`;
  const dist = build.length <= 64 ? build : undefined; // browserErrorDist: Sentry keeps at most 64 characters
  const scope = ['--org', SENTRY_ORG, '--project', SENTRY_PROJECT];
  const commands = [['releases', 'new', release, ...scope]];
  for (const root of roots) {
    commands.push(['sourcemaps', 'upload', ...scope, '--release', release, ...(dist === undefined ? [] : ['--dist', dist]),
      '--url-prefix', `~/${root}`, '--ext', 'js', '--ext', 'map', '--wait-for', '120', join(dir, root)]);
  }
  commands.push(['deploys', 'new', ...scope, '--release', release, '--env', environment]);
  return { release, dist, commands };
}

/** @returns {string} the auth token, or '' when this machine holds none */
export function sentryToken(env = process.env, file = join(homedir(), '.config/wildshard/sentry-auth-token')) {
  const fromEnv = (env.SENTRY_AUTH_TOKEN ?? '').trim();
  if (fromEnv !== '') return fromEnv;
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}

/** Where `sentryToken` found the token, for a refusal that names it (never the token). */
export function sentryTokenSource(env = process.env, file = join(homedir(), '.config/wildshard/sentry-auth-token')) {
  return (env.SENTRY_AUTH_TOKEN ?? '').trim() !== '' ? 'SENTRY_AUTH_TOKEN' : file.replace(homedir(), '~');
}

/** A user token needs `project:releases`; an organization token (`sntrys_`) carries `org:ci`, which covers releases and maps. */
export const RELEASE_SCOPES = Object.freeze(['project:releases', 'org:ci']);

/** PV28: v0.1.101's staging build got a bare 403 from `releases new`: the machine's token was a read-only user token
 *  (alerts, event, member, org, project and team read). Null when `scopes` can make a release, else the refusal.
 * @param {readonly string[] | undefined} scopes the token's scopes from `GET /api/0/`, undefined when unreadable @param {string} source */
export function releaseScopeGap(scopes, source) {
  if (scopes === undefined || scopes.some(scope => RELEASE_SCOPES.includes(scope))) return null;
  return `sentry-maps: the Sentry token from ${source} has ${scopes.length === 0 ? 'no scopes' : scopes.join(', ')}; ` +
    'a release needs project:releases (a user token) or org:ci (an organization token). Replace it, then rebuild';
}

/** The token's scopes, or undefined when Sentry does not say. @param {string} token */
async function tokenScopes(token) {
  try {
    const answer = await fetch('https://sentry.io/api/0/', {headers: {authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(15_000)});
    if (!answer.ok) return undefined;
    const scopes = /** @type {{auth?: {scopes?: unknown}}} */ (await answer.json()).auth?.scopes;
    return Array.isArray(scopes) ? scopes.map(String) : undefined;
  } catch { return undefined; }
}

async function main() {
  const [dir, flag, environment = ''] = process.argv.slice(2);
  if (dir === undefined || flag !== '--environment') {
    throw new Error('usage: node src/scripts/sentry-maps.mjs <dist> --environment preview|staging|production');
  }
  const root = resolve(dir);
  const token = sentryToken();
  if (token === '') {
    console.log('sentry-maps: no SENTRY_AUTH_TOKEN and no ~/.config/wildshard/sentry-auth-token: nothing uploaded');
    return;
  }
  const gap = releaseScopeGap(await tokenScopes(token), sentryTokenSource());
  if (gap !== null) throw new Error(gap);
  const version = String(JSON.parse(readFileSync('package.json', 'utf8')).version ?? '');
  const build = String(JSON.parse(readFileSync(join(root, 'version.json'), 'utf8')).build ?? '');
  const plan = sentryMapPlan({ dir: root, version, build, environment, roots: mapRoots(root) });
  console.log(`sentry-maps: release ${plan.release}, dist ${plan.dist ?? '(build id over 64 characters)'}, ${environment}`);
  for (const command of plan.commands) {
    console.log(`sentry-maps: sentry-cli ${command.slice(0, 2).join(' ')}`);
    const run = spawnSync('npx', ['--yes', SENTRY_CLI, ...command], {
      stdio: 'inherit', env: { ...process.env, SENTRY_AUTH_TOKEN: token },
    });
    if (run.status !== 0) throw new Error(`sentry-maps: sentry-cli ${command.slice(0, 2).join(' ')} exited ${run.status ?? run.signal}`);
  }
  console.log(`sentry-maps: uploaded ${plan.release} maps for ${environment}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) await main();
