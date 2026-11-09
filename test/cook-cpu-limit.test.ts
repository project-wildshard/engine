// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real permission-limited cook child.
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Each proof owns and removes its child files.
import {availableParallelism,tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- The child imports the actual production encoder.
import {join} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Paths in generated source must remain valid file URLs.
import {pathToFileURL} from 'node:url';
import {expect,it} from 'vitest';
import {runJob} from '../src/cook/game/cookWorker';

it.each([
  {grant:'4',limit:undefined,slots:'4',workers:Math.max(1,Math.min(4,availableParallelism())-1)},
  {grant:'4',limit:2,slots:'2',workers:1},
  {grant:undefined,limit:undefined,slots:null,workers:Math.min(8,Math.max(1,availableParallelism()-2))},
])('keeps the real q11 pool inside host grant $grant and limit $limit',async({grant,limit,slots,workers})=>{
  const root=process.cwd(),work=mkdtempSync(join(tmpdir(),'cook-cpu-')),script=join(work,'probe.mjs');
  mkdirSync(join(work,'job'));
  writeFileSync(script,`import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';
import {createPartEncoder} from ${JSON.stringify(pathToFileURL(join(root,'src/cook/game/spawnParts.ts')).href)};
const baseline=process.report.getReport().workers.length;
const encoder=createPartEncoder(),body=Uint8Array.from({length:65536},(_,i)=>(i*31+i%17)%251);
const hash=createHash('sha256').update(body).digest('hex');
try {
 const pending=Array.from({length:8},()=>encoder.encode(body,hash));
 const wires=await Promise.all(pending);
 const workers=process.report.getReport().workers.length-baseline;
 const reference=brotliCompressSync(body,{params:{[constants.BROTLI_PARAM_QUALITY]:11,[constants.BROTLI_PARAM_LGWIN]:24,[constants.BROTLI_PARAM_SIZE_HINT]:body.length}});
 const q11=wires.every(wire=>Buffer.from(wire).equals(reference));
 const exact=wires.every(wire=>createHash('sha256').update(brotliDecompressSync(wire)).digest('hex')===hash);
 console.log(JSON.stringify({refused:JSON.stringify({slots:process.env.COOK_CPU_SLOTS??null,workers,exact,q11,parts:encoder.stats().parts})}));
} finally {await encoder.close();}
process.exitCode=3;`);
  const previous=process.env['WS_CPU_SLOTS'];
  if(grant===undefined)delete process.env['WS_CPU_SLOTS'];else process.env['WS_CPU_SLOTS']=grant;
  try {
    const outcome=await runJob({root,execPath:process.execPath,loader:join(root,'scripts/bake-loader.mjs'),script,wrap:[],
      limits:{seconds:5,memoryMB:1024,heapMB:512,...(limit===undefined?{}:{cpuSlots:limit})}},join(work,'job/input.tar'),join(work,'job/out'));
    expect(outcome.kind,outcome.kind==='killed'?outcome.reason:'').toBe('refused');
    if(outcome.kind!=='refused')throw new Error('No real encoder result');
    expect(JSON.parse(outcome.reason)).toEqual({slots,workers,exact:true,q11:true,parts:8});
  } finally {
    if(previous===undefined)delete process.env['WS_CPU_SLOTS'];else process.env['WS_CPU_SLOTS']=previous;
    rmSync(work,{recursive:true,force:true});
  }
});
