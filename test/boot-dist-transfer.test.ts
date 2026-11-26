// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual CI artifact pack/restore commands.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Inspect the workflow transport boundary and create its isolated catalogue.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep the isolated catalogue below the repository's task scratch.
import { resolve } from 'node:path';
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
  const runner = readFileSync('src/scripts/parity/boot-smoke.mjs', 'utf8');
  expect(runner).not.toContain('quarantinedTitle');
  expect(runner).not.toContain('titleOnly');
  expect(runner).toMatch(/^ {4}await observeTitleCapture\(page, join\(out, `\$\{receipt\}-title`\), \(\) => captureBootFrame\(page, 'title', deadline, frames\)\);$/mu);
});

test('every boot-dist leg is a subset of the complete hover-webkit world closure',()=>{
  const root=mkdtempSync(resolve('tmp','boot-dist-plan-'));
  const manifest=(slug:string,status:'live'|'experimental',order:number)=>({slug,status,order,card:{}});
  try{
    for(const path of ['client/game','shared/game','server/game','cook/game','client/engine','shared/engine','server/engine']) mkdirSync(resolve(root,'src',path),{recursive:true});
    for(const [slug,status,order] of [['sunscar-dunes','live',1],['nine-dragon-stack','experimental',2]] as const){
      const directory=resolve(root,'src/shards',slug);mkdirSync(directory,{recursive:true});writeFileSync(resolve(directory,'manifest.json'),JSON.stringify(manifest(slug,status,order)));
    }
    const result=spawnSync(process.execPath,['src/scripts/boot-dist-plan.mjs',root],{encoding:'utf8',timeout:10000});
    expect(result.status,result.stderr).toBe(0);
    const plan=v.parse(v.record(v.string(),v.array(v.string())),JSON.parse(result.stdout));
    const worlds=plan['hover-webkit'];if(worlds===undefined)throw new Error('Missing complete world closure');
    for(const part of ['boot-developer','boot-grid','hover-chromium','explorer']){
      const selected=plan[part];if(selected===undefined)throw new Error('Missing original logical leg');
      expect(selected.every(slug=>worlds.includes(slug)),part).toBe(true);
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});
