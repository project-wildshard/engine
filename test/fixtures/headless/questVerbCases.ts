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

export function questVerbCases(slugs: readonly string[]): void {
for(const slug of slugs)test(`${slug}: native quest verbs require the real walk and earned prerequisites`,()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/quest-verbs-run.mjs'),slug],{encoding:'utf8',timeout:30_000});
  expect(child.status,child.stdout+child.stderr).toBe(0);
  expect(child.stdout).toContain(`"slug":"${slug}"`);
},35_000);
}
