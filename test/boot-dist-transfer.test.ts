// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual CI artifact pack/restore commands.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Inspect the workflow transport boundary as well as real archives.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import * as v from 'valibot';

test('unavailable passive Actions clocks preserve both receipts without replacing journey verdicts', () => {
  const result = spawnSync('python3', ['test/test_smoke_timings.py'], { encoding: 'utf8', timeout: 10000 });
  expect(result.status, result.stderr + result.stdout).toBe(0);
});

test('exact per-leg archives preserve bytes and refuse corrupt, missing, mixed or unsafe transfers without retry', () => {
  const result = spawnSync('python3', ['test/test_boot_dist.py'], { encoding: 'utf8', timeout: 10_000 });
  expect(result.status, result.stderr + result.stdout).toBe(0);
});

test('boot smoke keeps no title quarantine', () => {
  const runner = readFileSync('scripts/parity/boot-smoke.mjs', 'utf8');
  expect(runner).not.toContain('quarantinedTitle');
  expect(runner).not.toContain('titleOnly');
  expect(runner).toMatch(/^ {4}await observeTitleCapture\(page, join\(out, `\$\{receipt\}-title`\), \(\) => captureBootFrame\(page, 'title', deadline, frames\)\);$/mu);
});

test('every boot-dist leg is a subset of the complete hover-webkit world closure',()=>{
  const result=spawnSync(process.execPath,['scripts/boot-dist-plan.mjs','.'],{encoding:'utf8',timeout:10000});
  expect(result.status,result.stderr).toBe(0);
  const plan=v.parse(v.record(v.string(),v.array(v.string())),JSON.parse(result.stdout));
  const worlds=plan['hover-webkit'];if(worlds===undefined)throw new Error('Missing complete world closure');
  for(const part of ['boot-developer','boot-grid','hover-chromium','explorer']){
    const selected=plan[part];if(selected===undefined)throw new Error('Missing original logical leg');
    expect(selected.every(slug=>worlds.includes(slug)),part).toBe(true);
  }
});
