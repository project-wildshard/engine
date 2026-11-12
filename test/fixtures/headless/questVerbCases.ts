// TEST-SPEED TS5 (J255): headless-quest-verbs was 23-31 s hosted. The case, moved verbatim, runs per slug list:
// headless-quest-verbs.test.ts has Driftwood and Far Reach, headless-quest-verbs-nalati.test.ts Nalati.
// oxlint-disable-next-line import/no-nodejs-modules -- Actual isolated native worker and the unchanged source loader.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Owned fixture paths under the repository.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Absolute native loader URL.
import {pathToFileURL} from 'node:url';
// oxlint-disable-next-line import/no-nodejs-modules -- Same Node executable, not a shell adapter.
import process from 'node:process';
import {expect,test} from 'vitest';

// TEST-SPEED FL29: the child is ~3.4 s and ~6 CPU-s alone (boot ~75 %: two module graphs, the 194 MB Nalati product
// loaded and admitted in parent and worker, the worker's initial full-world checkpoint; then the 4,103-tick tape). At
// nice 10 under ~50 load it gets <0.2 core and passed 30 s (status null). The kill is only a hang guard; the time
// budget is J193's 60 s file cap (the ordinary Nalati native children guard at 175 s). 55 s child, 60 s case.
const CHILD_MS=55_000;
export function questVerbCases(slugs: readonly string[]): void {
for(const slug of slugs)test(`${slug}: native quest verbs require the real walk and earned prerequisites`,()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/quest-verbs-run.mjs'),slug],{encoding:'utf8',timeout:CHILD_MS});
  expect(child.status,`${child.signal===null?'':`killed ${child.signal}${child.error===undefined?'':` (${child.error.message})`}\n`}${child.stdout}${child.stderr}`).toBe(0);
  expect(child.stdout).toContain(`"slug":"${slug}"`);
},60_000);
}
