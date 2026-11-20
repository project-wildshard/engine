import { expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assembleCapture, atomicJson, cellPath, openResume, readCell, signature } from '../../scripts/fps/matrix.mjs';

const build = 'pinned';
const witness = { build, gpu:'ANGLE Metal' };
const route = [{ name:'dock', seconds:1 }, { name:'beach', seconds:1 }];
const capture = (interval, ms = 15) => ({
  version:{build}, witness, verdict:ms > 20 ? 'miss' : 'pass',
  legs:[{ name:interval.name, samples:[{ seconds:1, frames:60, frameMs:Array.from({length:60}, () => ms) }] }],
});

test('the resume keeps completed cells and retries missing or incomplete evidence', () => {
  const scratch = resolve(process.env.VITEST_TMP_ROOT ?? 'tmp/vitest', 'fps-matrix');
  mkdirSync(scratch,{recursive:true});
  const out = mkdtempSync(join(scratch,'resume-'));
  try {
    const config = {build,route};
    const fingerprint = signature(config);
    openResume(out,fingerprint,config);
    const cell = {id:'1-3-1',interval:route[0],floor:60,warm:true};
    const file = cellPath(out,cell.id);
    const save = report => atomicJson(file,{fingerprint,id:cell.id,report});
    const load = () => readCell(file,fingerprint,build,cell);
    expect(load()).toBeNull();
    const cold = capture(cell.interval, 22);
    save({browser:'Chromium',cold,warm:null});
    expect(load()).toBeNull();
    save({browser:'Chromium',cold,warm:capture(cell.interval)});
    openResume(out,fingerprint,config);
    expect(load()?.cold.verdict).toBe('miss');
    expect(() => openResume(out,signature({...config,build:'after-deploy'}),config)).toThrow('different build');
    save({browser:'Chromium',cold:{...cold,witness:{...witness,build:'other'}},warm:capture(cell.interval)});
    expect(load()).toBeNull();
  } finally { rmSync(out,{recursive:true,force:true}); }
});

test('stitch the full route in order, preserving floor misses and refusing gaps and mixed GPUs', () => {
  const dock = capture(route[0]), beach = capture(route[1], 22);
  expect(assembleCapture([dock,beach],route,60)).toMatchObject({verdict:'miss',worstSegment:'beach'});
  expect(assembleCapture([dock,null],route,60)).toMatchObject({verdict:'incomplete',worstSegment:'beach'});
  expect(assembleCapture([dock,{...beach,witness:{build,gpu:'another GPU'}}],route,60))
    .toMatchObject({verdict:'incomplete',error:'build or GPU differs across cells'});
});
