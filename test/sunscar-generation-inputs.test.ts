// oxlint-disable-next-line import/no-nodejs-modules -- Inspect declared producer paths in the real source tree.
import { cwd } from 'node:process';
// oxlint-disable-next-line import/no-nodejs-modules -- The contract reads the defining source entry without evaluating it.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A fresh process proves the legacy scheduler is never resolved.
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { auditAuthoringInputs } from '../scripts/authoring-inputs.mjs';
import { generationPlan, hasProjectGenerator } from '../scripts/gen-programs.mjs';

const root = cwd();
const expected = { products: ['sunscar-dunes'], folders: ['sunscar-dunes'], scoped: true };

test('zero remaining jobs selects the defining source program without generated inputs', () => {
  expect(hasProjectGenerator(readFileSync('src/shards/sunscar-dunes/shard.config.ts', 'utf8'))).toBe(true);
  expect(generationPlan(root, 'sunscar-dunes')).toEqual(expected);
  const closure = auditAuthoringInputs(root, 'sunscar-dunes', 'src/shards/sunscar-dunes/shard.config.ts');
  expect(closure.files).toContain('src/shards/sunscar-dunes/generators/generate.ts');
  expect(closure.files.filter(file => file.startsWith('src/shards/sunscar-dunes/') && file.includes('.generated.'))).toEqual([]);
});

test('fresh source preparation refuses any attempt to load the legacy scheduler', () => {
  const source = `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === 'retired-scheduler-control' || specifier.endsWith('/generate.mjs')) throw new Error('legacy scheduler resolved');
      return next(specifier, context);
    } });
    let refused = false;
    try { await import('retired-scheduler-control'); }
    catch (error) { if (error instanceof Error && error.message === 'legacy scheduler resolved') refused = true; else throw error; }
    if (!refused) throw new Error('scheduler refusal control failed');
    const { generationPlan } = await import('./scripts/gen-programs.mjs');
    const plan = generationPlan(process.cwd(), 'sunscar-dunes');
    await import('./scripts/build-shardfiles.mjs');
    console.info(JSON.stringify(plan));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], { cwd: root, encoding: 'utf8' });
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout.trim())).toEqual(expected);
});
