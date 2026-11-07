// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual renderer-refusing Node simulation loader.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Use this test process's actual Node binary.
import {execPath} from 'node:process';
import {expect,test} from 'vitest';

test('the production native driver loads its H4 actor runner under the renderer-free simulation loader',()=>{
  const loader=new URL('../scripts/sim-node-loader.mjs',import.meta.url),native=new URL('../src/server/game/population/nativeManager.ts',import.meta.url);
  const output=execFileSync(execPath,['--experimental-transform-types','--import',loader.href,'--input-type=module','-e',
    `const module=await import(${JSON.stringify(native.href)});if(typeof module.NativePopulationDriver!=='function')throw new Error('Missing native driver');console.log('native-owner-only');`],
  {encoding:'utf8',timeout:10000});
  expect(output.trim()).toBe('native-owner-only');
});
