import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real Git worktree and Vitest import boundary, no physical browser.
import {execFileSync} from 'node:child_process';

test('browser admission resolves the running worktree provider',()=>{
 const report=execFileSync(process.execPath,['--test','--test-reporter=tap','src/scripts/browser-worktree-provider-proof.mjs'],{encoding:'utf8',timeout:45000});
 expect(report).toContain('# pass 1');
 expect(report).toContain('# fail 0');
},50000);
