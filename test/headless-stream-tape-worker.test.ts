// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual bounded Node worker.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Only the fixed fixture and checked loader are executable.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Native loader requires an absolute file URL.
import {pathToFileURL} from 'node:url';
// oxlint-disable-next-line import/no-nodejs-modules -- Reuse the running Node binary.
import process from 'node:process';
import {expect,test} from 'vitest';

test('streamed native tape preserves all ticks, terminal ownership, aggregate caps and one global request clock',()=>{
 const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
  resolve('test/fixtures/headless/stream-tape-run.mjs')],{encoding:'utf8',timeout:60_000});
 expect(child.status,child.stdout+child.stderr).toBe(0);
 expect(child.stdout).toContain('streamed native parity, aggregate budgets, producer failure, disposal and global deadline pass');
},65_000); // the bound stops a hang and claims no speed: 6 s on a laptop passed 20 s on a CI runner
