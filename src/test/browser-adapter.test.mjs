import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Pure fake handles and injected policy do not open a browser.
import {execFileSync} from 'node:child_process';

test.each(['browser-launch-admission','browser-machine-loader','browser-file-admission'])('portable %s controls refuse invalid admission',name=>{
 const report=execFileSync(process.execPath,['--test','--test-reporter=tap',`src/scripts/${name}-proof.mjs`],{encoding:'utf8',timeout:10000});
 expect(report).toContain(`# pass ${({'browser-file-admission':5,'browser-machine-loader':14})[name]??12}`);expect(report).toContain('# fail 0');
});
