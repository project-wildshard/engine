// oxlint-disable-next-line import/no-nodejs-modules -- One fixed native child owns the complete chapter admission proof.
import {spawnSync} from 'node:child_process';
import {expect,test} from 'vitest';

test('native chapter polling owns its encounters and refuses a forged closed-room continuation',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import','./scripts/sim-node-loader.mjs','test/fixtures/headless/nalati-chapter-binding-run.ts'],{encoding:'utf8',timeout:30_000});
  expect(child.status,child.stdout+child.stderr+String(child.error??'')+(child.signal??'')).toBe(0);expect(child.stdout).toContain('"replayed":true');
},35_000);
