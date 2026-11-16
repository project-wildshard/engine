// TC39/AP-16: compare the deployed validator with this engine's resolved package.
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {lockedFormatVersion} from './format-lock.mjs';

export interface ApiHealthReport {
  version: 1;
  complete: boolean;
  ok: boolean;
  url: string;
  expected: string | null;
  observed: string | null;
  apiBuild: string | null;
  error: string | null;
}

/** One deadline covers headers and body. Invalid or unreachable health never matches. */
export async function observeApiHealth(lock: string, url: string, timeoutMs = 3000): Promise<ApiHealthReport> {
  const report: ApiHealthReport = {version: 1, complete: false, ok: false, url,
    expected: null, observed: null, apiBuild: null, error: null};
  try {
    report.expected = lockedFormatVersion(lock);
    const response = await fetch(url, {signal: AbortSignal.timeout(timeoutMs), redirect: 'error', cache: 'no-store'});
    if (!response.ok) throw new Error(`health HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (body === null || typeof body !== 'object' || !('ok' in body) || body.ok !== true ||
      !('version' in body) || typeof body.version !== 'string' || body.version === '' ||
      !('shardFormat' in body) || typeof body.shardFormat !== 'string' || !/^\d+\.\d+\.\d+$/u.test(body.shardFormat))
      throw new Error('health must name ok:true, its build and an exact shardFormat package version');
    report.observed = body.shardFormat;
    report.apiBuild = body.version;
    report.complete = true;
    report.ok = report.expected === report.observed;
    if (!report.ok) report.error = `format mismatch: engine ${report.expected}, API ${report.observed}`;
  } catch (error) {
    report.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  return report;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const [requestedUrl, output = 'tmp/api-health/report.json'] = process.argv.slice(2);
  const pinsFile = process.env.WILDSHARD_PIN_CHANNEL === 'staging' ? 'test/pins/staging.json' : 'test/pins/shardfiles.json';
  const url = requestedUrl ?? new URL('/api/health', (JSON.parse(readFileSync(pinsFile, 'utf8')) as {api: string}).api).href;
  const lock = readFileSync('pnpm-lock.yaml', 'utf8');
  const report = {...await observeApiHealth(lock, url), sha: process.env.GITHUB_SHA ?? null,
    run: process.env.GITHUB_RUN_ID ?? null, lockHash: createHash('sha256').update(lock).digest('hex')};
  mkdirSync(dirname(output), {recursive: true});
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  if (!report.ok) process.exitCode = 1;
}
