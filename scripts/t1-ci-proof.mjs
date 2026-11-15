#!/usr/bin/env node
// Preserve the actual result during Q4's report window. A hosted receipt,
// rather than this wrapper's reporting exit, is the qualification evidence.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scratchDir } from './scratch-dir.mjs';
import { T1_SHARDS } from './t1-shards.mjs';

export const T1_BUDGET_MS = 120_000;
/** @param {{status:number|null,signal:string|null}} result @param {number} wallMs */
export function t1Verdict(result, wallMs) {
  return result.status === 0 && result.signal === null && wallMs <= T1_BUDGET_MS ? 'pass' : 'fail';
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const suite = process.env.WS_T1_SHARD;
  if (suite === undefined || !Object.hasOwn(T1_SHARDS, suite)) throw new Error('WS_T1_SHARD must be A, B, C or D');
  const dist = process.env.WS_T1_BUILD_DIR;
  if (dist === undefined) throw new Error('A T1 CI shard requires the shared WS_T1_BUILD_DIR; it never builds a client');
  const build = JSON.parse(readFileSync(resolve(dist, 'version.json'), 'utf8')).build;
  if (typeof build !== 'string' || build === '') throw new Error('Shared client has no build id');
  const sha = process.env.GITHUB_SHA;
  const prefix = build.split('-')[0];
  if (sha !== undefined && (!/^[a-f0-9]{40}$/u.test(sha) || !/^[a-f0-9]{7,40}$/u.test(prefix) || !sha.startsWith(prefix))) {
    throw new Error('Shared T1 build does not belong to this source SHA');
  }
  const lane = process.env.WS_LANE_NAME ?? 'template-e2e-ci';
  const env = { ...process.env, WS_LANE_NAME: lane };
  const scratch = scratchDir(lane, 'Template suite shard receipts', { env });
  mkdirSync(resolve(scratch, 't1'), { recursive: true });
  const started = Date.now();
  const command = ['scripts/t1-e2e.mjs', `--project=${suite}`, '--global-timeout=120000'];
  const result = spawnSync(process.execPath, command, { stdio: 'inherit', env });
  const wallMs = Date.now() - started;
  const verdict = t1Verdict(result, wallMs);
  const receipt = { version: 1, suite, sha: process.env.GITHUB_SHA ?? null, run: process.env.GITHUB_RUN_ID ?? null,
    event: process.env.GITHUB_EVENT_NAME ?? null, ref: process.env.GITHUB_REF ?? null,
    started, build, platform: process.platform, wallMs, budgetMs: T1_BUDGET_MS,
    status: result.status, signal: result.signal, error: result.error?.message ?? null, verdict, reportOnly: true };
  writeFileSync(resolve(scratch, `t1/receipt-${suite}.json`), `${JSON.stringify(receipt)}\n`);
  const line = `T1 ${suite}: ${verdict.toUpperCase()}, ${(wallMs / 1000).toFixed(1)}s / 120s, exit ${String(result.status)}, shared build ${build} (report-only)`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
  if (verdict !== 'pass') console.log(`::warning title=Template suite ${suite}::${line}`);
}
