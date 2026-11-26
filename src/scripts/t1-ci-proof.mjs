#!/usr/bin/env node
// Preserve failures during Q4's report window, including setup failures.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scratchDir } from './.kit/scratch-dir.mjs';
import { activeT1Gate, t1ContentReady, t1Scope } from './t1-qualification.mjs';
import { T1_SHARDS } from './t1-shards.mjs';
import { runT1Child } from './t1-runner.mjs';

export const T1_BUDGET_MS = 120_000;
/** @param {{status:number|null,signal:string|null}} result @param {number} wallMs */
export function t1Verdict(result, wallMs) {
  return result.status === 0 && result.signal === null && wallMs <= T1_BUDGET_MS ? 'pass' : 'fail';
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const requested = process.env.WS_T1_SHARD;
  const suite = requested !== undefined && Object.hasOwn(T1_SHARDS, requested) ? requested : 'unknown';
  const lane = process.env.WS_LANE_NAME ?? 'template-e2e-ci';
  const env = { ...process.env, WS_LANE_NAME: lane };
  const scratch = scratchDir(lane, 'Template suite shard receipts', { env });
  mkdirSync(resolve(scratch, 't1'), { recursive: true });
  const started = Date.now();
  /** @type {string|null} */ let scope = null;
  /** @type {string|null} */ let build = null;
  /** @type {number|null} */ let status = null;
  /** @type {string|null} */ let signal = null;
  /** @type {string|null} */ let error = null;
  let reportOnly = true;
  let queueMs = 0;
  try {
    scope = t1Scope();
    try {
      const policy = JSON.parse(readFileSync(resolve(scratch, 'qualification.json'), 'utf8'));
      reportOnly = !(process.env.CI && activeT1Gate(policy, scope, Date.now()));
    } catch { /* Missing evidence keeps reporting. */ }
    if (suite === 'unknown') throw new Error(`WS_T1_SHARD must be one of ${Object.keys(T1_SHARDS).join(', ')}`);
    const dist = process.env.WS_T1_BUILD_DIR;
    if (dist === undefined) throw new Error('A T1 CI shard requires the shared WS_T1_BUILD_DIR');
    const candidate = JSON.parse(readFileSync(resolve(dist, 'version.json'), 'utf8')).build;
    if (typeof candidate !== 'string' || candidate === '') throw new Error('Shared client has no build id');
    build = candidate;
    const sha = process.env.GITHUB_SHA, prefix = build.split('-')[0];
    if (sha !== undefined && (!/^[a-f0-9]{40}$/u.test(sha) || !/^[a-f0-9]{7,40}$/u.test(prefix) || !sha.startsWith(prefix))) {
      throw new Error('Shared T1 build does not belong to this source SHA');
    }
    // The runner owns the overall active-time deadline. Playwright's global
    // clock includes worker admission, so individual case clocks stay the bar.
    const result = await runT1Child([process.execPath, 'src/scripts/t1-e2e.mjs', `--project=${suite}`], env);
    status = result.status; signal = result.signal; error = result.error;
    queueMs = result.queueMs;
  } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  const totalWallMs = Date.now() - started, wallMs = Math.max(0,totalWallMs-queueMs);
  const verdict = error === null ? t1Verdict({ status, signal }, wallMs) : 'fail';
  const receipt = { version: 1, suite, scope, complete: t1ContentReady(), sha: process.env.GITHUB_SHA ?? null, run: process.env.GITHUB_RUN_ID ?? null,
    event: process.env.GITHUB_EVENT_NAME ?? null, ref: process.env.GITHUB_REF ?? null,
    started, build, platform: process.platform, wallMs, totalWallMs, queueMs, budgetMs: T1_BUDGET_MS, status, signal, error, verdict, reportOnly };
  writeFileSync(resolve(scratch, `t1/receipt-${suite}.json`), `${JSON.stringify(receipt)}\n`);
  const line = `T1 ${suite}: ${verdict.toUpperCase()}, ${(wallMs / 1000).toFixed(1)}s / 120s, exit ${String(status)}, shared build ${build ?? 'unavailable'} (${reportOnly ? 'report-only' : 'blocking'})`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
  if (verdict !== 'pass') {
    console.log(`::${reportOnly ? 'warning' : 'error'} title=Template suite ${suite}::${line}`);
    if (!reportOnly) process.exitCode = 1;
  }
}
