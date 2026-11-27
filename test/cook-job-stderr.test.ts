// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real permission-limited cook child.
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Each proof owns and removes its child files.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- The job's work folder and its log sit side by side.
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {keepJobStderr,runJob} from '../src/cook/game/cookWorker';

// SF6e: Nalati's cook failed three tries with "Invalid spawn parts", and the 600-character summary cut the stack before
// the caller that built the manifest. A failed job keeps its whole stderr in a log file the reason names.
it('a failed job names a log holding its whole stderr, stack included, beyond the short summary',async()=>{
  const root=process.cwd(),scratch=mkdtempSync(join(tmpdir(),'cook-stderr-')),work=join(scratch,'job-a'),script=join(scratch,'fail.mjs');
  mkdirSync(work);
  // A deep stack: the frame that matters is far past the first lines, as a code frame and its readers push it out.
  writeFileSync(script,`${Array.from({length:8},(_,at)=>`function caller${at}(){ ${at===7?"throw new Error('Invalid spawn parts')":`caller${at+1}()`}; }`).join('\n')}
console.error('report-only line '+'x'.repeat(400));
caller0();`);
  try {
    const outcome=await runJob({root,execPath:process.execPath,loader:join(root,'src/scripts/bake-loader.mjs'),script,wrap:[],
      limits:{seconds:20,memoryMB:1024,heapMB:512}},join(work,'input.tar'),join(work,'out'));
    expect(outcome.kind).toBe('killed');
    if(outcome.kind!=='killed')throw new Error('The job did not fail');
    expect(outcome.reason).toMatch(/^exit 1: Error: Invalid spawn parts/u);
    expect(outcome.reason).not.toContain('caller0');
    const log=/\(full stderr: (?<file>[^)]+)\)$/u.exec(outcome.reason)?.groups?.['file'];
    expect(log).toBe(join(scratch,'logs','job-a.stderr.log'));
    const text=readFileSync(log??'','utf8');
    for(const frame of ['caller7','caller3','caller0'])expect(text).toContain(frame);
  } finally { rmSync(scratch,{recursive:true,force:true}); }
},30_000);

it('a job that printed nothing leaves no log',()=>{
  const scratch=mkdtempSync(join(tmpdir(),'cook-stderr-'));
  try {
    expect(keepJobStderr(join(scratch,'job-b'),'  \n')).toBeUndefined();
    expect(existsSync(join(scratch,'logs'))).toBe(false);
  } finally { rmSync(scratch,{recursive:true,force:true}); }
});
