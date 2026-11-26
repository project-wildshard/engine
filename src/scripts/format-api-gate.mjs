// SHARD-COMPAT CP3 (J486 Q46): API first. A push that moves engine's shard-format pin above what api.wildshard.io
// serves is refused, naming both versions; the API is released and deployed on a format before engine pins it.
// The API is read once per pin move (GET /api/format, then /api/health until that route deploys). An unreachable API
// warns and passes: an offline lane is never blocked. Escape hatch (J381): ALLOW_FORMAT_AHEAD=1.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { lockedFormatVersion } from './format-lock.mjs';
import { markedFetch } from './agent-requests.mjs';

export const FORMAT_API = 'https://api.wildshard.io';
const FETCH_MS = 10_000;
const EXACT = /^\d+\.\d+\.\d+$/u;

/** @param {string} left @param {string} right */
export function compareRelease(left, right) {
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/** The shard-format npm version the deployed API pins. @param {string} api @param {number} timeoutMs */
export async function observeApiPackage(api = FORMAT_API, timeoutMs = FETCH_MS) {
  for (const [path, key] of [['/api/format', 'package'], ['/api/health', 'shardFormat']]) {
    // METRICS MT2: an agent's read of our hosted API carries the Node actor marker.
    const response = await markedFetch(globalThis.fetch)(new URL(path, api), { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', cache: 'no-store' });
    if (response.status === 404 && path === '/api/format') continue;
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
    /** @type {unknown} */
    const body = await response.json();
    const value = body !== null && typeof body === 'object' && key in body ? /** @type {Record<string, unknown>} */ (body)[key] : undefined;
    if (typeof value !== 'string' || !EXACT.test(value)) throw new Error(`${path} names no exact ${key}`);
    return value;
  }
  throw new Error('the API serves no format route');
}

/** @param {string | undefined} text */
function locked(text) {
  if (text === undefined) return undefined;
  try { return lockedFormatVersion(text); } catch { return undefined; }
}

/** Refuse a pin move above the API. A lock whose format didn't move is never refused for the state it inherited.
 * @param {string | undefined} before the lock at the push's base @param {string | undefined} after the lock at its tip
 * @param {{observe?: () => Promise<string>, warn?: (line: string) => void, env?: Record<string, string | undefined>}} options */
export async function formatApiFailures(before, after, { observe = () => observeApiPackage(), warn = line => console.error(line), env = process.env } = {}) {
  const next = locked(after);
  // formatLockFailures names a lock with no exact format row; nothing to compare here.
  if (next === undefined || locked(before) === next) return [];
  if (env.ALLOW_FORMAT_AHEAD === '1') {
    warn(`  - ALLOW_FORMAT_AHEAD=1: shard-format ${next} not compared with the API (name it in the commit body)`);
    return [];
  }
  let api;
  try { api = await observe(); } catch (error) {
    warn(`  - shard-format ${next}: the API's format could not be read (${error instanceof Error ? error.message : String(error)}); not refused (CP3 passes offline)`);
    return [];
  }
  return compareRelease(next, api) > 0
    ? [`pnpm-lock.yaml: shard-format ${next} is newer than the API's ${api} (${FORMAT_API}/api/format). API first (meta SHARD-COMPAT CP3, J486): release and deploy api-server on ${next}, then move engine's pin. Escape hatch: ALLOW_FORMAT_AHEAD=1`]
    : [];
}

const ZERO = /^0+$/u;

/** A commit's pnpm-lock.yaml, or undefined when the commit or the file is missing here. @param {string} root @param {string} sha */
function lockAt(root, sha) {
  if (ZERO.test(sha)) return undefined;
  try {
    return execFileSync('git', ['show', `${sha}:pnpm-lock.yaml`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return undefined; }
}

/** CP3 on a push: each main ref line of git's pre-push input, its remote tip against the pushed tip. A remote tip this
 * clone lacks is compared from the pushed commit's first parent, never treated as no lock (that would refuse an
 * inherited state). @param {string} refs @param {string} root @param {Parameters<typeof formatApiFailures>[2]} options */
export async function refsFailures(refs, root, options = {}) {
  const failures = [];
  for (const line of refs.split('\n')) {
    const [, local, remoteRef, remote] = line.trim().split(/\s+/u);
    if (remoteRef !== 'refs/heads/main' || local === undefined || remote === undefined || ZERO.test(local)) continue;
    const after = lockAt(root, local);
    const before = lockAt(root, remote) ?? lockAt(root, `${local}^`);
    if (before === undefined) continue;
    failures.push(...await formatApiFailures(before, after, options));
  }
  return failures;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename && process.argv[2] === 'refs') {
  // .githooks/pre-push: `node src/scripts/format-api-gate.mjs refs < <ref lines>`.
  const { readFileSync } = await import('node:fs');
  const failures = await refsFailures(readFileSync(0, 'utf8'), process.cwd());
  for (const failure of failures) console.error(`format-api-gate: ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
} else if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  // `node src/scripts/format-api-gate.mjs`: this checkout's lock against the API, whether or not the pin moved.
  const { readFileSync } = await import('node:fs');
  const next = lockedFormatVersion(readFileSync('pnpm-lock.yaml', 'utf8')), api = await observeApiPackage();
  const ahead = compareRelease(next, api) > 0;
  console.log(`engine shard-format ${next}, API ${api}: ${ahead ? 'engine is AHEAD of the API (CP3 forbids)' : 'API first, ok'}`);
  if (ahead) process.exitCode = 1;
}
