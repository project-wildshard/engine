// Actual configured discovery, not a mirrored list or a sequencer unit test.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {relative} from 'node:path';
import * as v from 'valibot';
/** @param {string | undefined} phase */
const discover=phase=>{
  const text=execFileSync(process.execPath,['scripts/vitest-tmp.ts','list','--filesOnly','--json',...(phase===undefined?[]:['--config','scripts/push-vitest.config.ts'])],{
    env:{...process.env,...(phase===undefined?{}:{WS_PUSH_TEST_PHASE:phase})},encoding:'utf8',maxBuffer:16*1024*1024});
  return v.parse(v.array(v.object({file:v.string()})),JSON.parse(text)).map(row=>relative(process.cwd(),row.file).replaceAll('\\','/')).sort();
};
const expected=discover(undefined),native=discover('native'),ordinary=discover('ordinary'),union=[...native,...ordinary];
assert.equal(new Set(union).size,union.length);assert.deepEqual(union.sort(),expected);
assert.ok(native.includes('test/net-bots.test.ts'));assert.ok(native.includes('test/engine-rule-successors.test.ts'));
console.log(JSON.stringify({files:expected.length,native:native.length,ordinary:ordinary.length,exactUnion:true}));
