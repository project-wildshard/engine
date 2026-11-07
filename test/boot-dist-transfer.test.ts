// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual CI artifact pack/restore commands.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Inspect the workflow transport boundary as well as real archives.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Evaluate the real Actions case conditions after a sibling failure.
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import * as v from 'valibot';

test('unavailable passive Actions clocks preserve both receipts without replacing journey verdicts', () => {
  const result = spawnSync('python3', ['test/test_smoke_timings.py'], { encoding: 'utf8', timeout: 10000 });
  expect(result.status, result.stderr + result.stdout).toBe(0);
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
  expect(workflow).not.toContain('\n  phone-route:\n');
  expect(workflow).toContain(`python3 scripts/smoke-timings.py "journeys (\${{ matrix.part }})"`);
});

test('exact per-leg archives preserve bytes and refuse corrupt, missing, mixed or unsafe transfers without retry', () => {
  const result = spawnSync('python3', ['test/test_boot_dist.py'], { encoding: 'utf8', timeout: 10_000 });
  expect(result.status, result.stderr + result.stdout).toBe(0);
});

test('smoke downloads each exact source-run leg directly without a full-dist relay or retry', () => {
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
  const central = workflow.split('\n  journeys:\n')[1]?.split('\n  boot-verdict:\n')[0];
  if(central===undefined)throw new Error('Missing prepared browser wave');
  expect(central).toContain('name: boot-dist-manifest');
  expect(central).not.toContain('boot-dist.tar');
  expect(central).not.toContain('run watch');
  expect(workflow).toMatch(/run-id: \$\{\{ github\.run_id \}\}/u);
  expect(workflow).toContain('python3 scripts/boot-dist.py restore');
  expect(central).toContain('timeout-minutes: 20');
  const parts=/part: \[([^\]]+)\]/u.exec(central)?.[1]?.split(',').map(part=>part.trim());
  const core=['explorer','boot-public','developer-webkit','grid-chromium'];
  expect(parts).toHaveLength(core.length);expect(new Set(parts)).toEqual(new Set(core));
  expect(central).toContain(`SMOKE_PART: \${{ matrix.part == 'boot-public' && 'boot-public' || matrix.part == 'developer-webkit' && 'hover-webkit' || matrix.part == 'grid-chromium' && 'boot-grid' || 'explorer' }}`);
  expect(workflow).not.toContain('title-quarantine');
  const runner = readFileSync('scripts/parity/boot-smoke.mjs', 'utf8');
  expect(runner).not.toContain('quarantinedTitle');
  expect(runner).not.toContain('titleOnly');
  expect(runner).toMatch(/^ {4}await observeTitleCapture\(page, join\(out, `\$\{receipt\}-title`\), \(\) => captureBootFrame\(page, 'title', deadline, frames\)\);$/mu);
});

test('packed browser cases all run once after a sibling red and share a complete verified source closure',()=>{
  const workflow=readFileSync('.github/workflows/deploy.yml','utf8'),journeys=workflow.split('\n  journeys:\n')[1];
  if(journeys===undefined)throw new Error('Missing journey source');
  const cases=journeys.split(/\n {6}- name: /u).filter(step=>/\n {8}run: (?:node scripts\/parity\/|scripts\/browser-lane\.sh)/u.test(step));
  expect(cases).toHaveLength(7);
  const commands=cases.map(step=>/^ {8}run: (.+)$/mu.exec(step)?.[1]);
  expect(new Set(commands).size).toBe(7);
  const ran:string[]=[];
  for(const part of ['explorer','boot-public','developer-webkit','grid-chromium'])for(const step of cases){
    const condition=/^ {8}if: \$\{\{(.+)\}\}$/mu.exec(step)?.[1];
    if(condition===undefined)throw new Error('Missing independent case condition');
    const evaluate=(outcome:string,cancelled=false):unknown=>runInNewContext(condition,{
      matrix:{part},steps:{inputs:{outcome}},cancelled:()=>cancelled,success:()=>false,
    });
    if(evaluate('success')===true)ran.push(step.split('\n')[0]??'');
    expect(evaluate('failure')).toBe(false);expect(evaluate('success',true)).toBe(false);
  }
  expect(ran).toHaveLength(7);expect(new Set(ran).size).toBe(7);
  const result=spawnSync(process.execPath,['scripts/boot-dist-plan.mjs','.'],{encoding:'utf8',timeout:10000});
  expect(result.status,result.stderr).toBe(0);
  const plan=v.parse(v.record(v.string(),v.array(v.string())),JSON.parse(result.stdout));
  const worlds=plan['hover-webkit'];if(worlds===undefined)throw new Error('Missing complete world closure');
  for(const part of ['boot-developer','boot-grid','hover-chromium','explorer']){
    const selected=plan[part];if(selected===undefined)throw new Error('Missing original logical leg');
    expect(selected.every(slug=>worlds.includes(slug)),part).toBe(true);
  }
});
