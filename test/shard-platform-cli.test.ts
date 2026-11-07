// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual CLI process and exit status.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Owned observational preload fixture.
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Owned fixture paths.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Launch the current Node runtime.
import process from 'node:process';
import {afterEach,expect,it} from 'vitest';

const owned:string[]=[];
afterEach(()=>{for(const root of owned.splice(0))rmSync(root,{recursive:true,force:true});});
it.each([false,true])('runs cycle-free in the original CLI process and propagates failure=%s',failure=>{
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/platform-cli-'));owned.push(root);
  const hook=resolve(root,'observe.mjs');
  // Keep the real entry and its import graph. Substitute only command work, so
  // this regression cannot start product builds or depend on local outputs.
  writeFileSync(hook,`import {registerHooks} from 'node:module';registerHooks({load(url,context,next){if(url.endsWith('/scripts/shard-platform-cli.mjs'))return {format:'module',shortCircuit:true,source:${JSON.stringify(`import {checkShares} from './shard-platform.mjs';export async function runShardPlatformCli(){if(typeof checkShares!=='function')throw new Error('Unsettled census dependency');${failure?"throw new Error('Fixture CLI refusal');":"console.log(process.pid);"}}`)}};return next(url,context);}});`);
  const result=spawnSync(process.execPath,['scripts/shard-platform.mjs'],{encoding:'utf8',timeout:15_000,env:{...process.env,NODE_OPTIONS:`${process.env['NODE_OPTIONS']??''} --import ${hook}`}});
  if(failure){expect(result.status).toBe(1);expect(result.stderr).toContain('Fixture CLI refusal');}
  else {expect(result.status,result.stderr).toBe(0);expect(Number(result.stdout.trim())).toBe(result.pid);}
});
