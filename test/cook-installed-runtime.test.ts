// oxlint-disable-next-line import/no-nodejs-modules -- The public boundary is a real permission-limited child.
import {mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Each case owns its isolated installation and work folder.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Build the installed dependency layout explicitly.
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {runJob} from '../src/cook/game/cookWorker';

it.each(['classic','external','adjacent'] as const)('a cook reads its installed runtime closure in the %s layout',async layout=>{
  const scratch=mkdtempSync(join(tmpdir(),'cook-runtime-')),root=join(scratch,'root'),work=join(scratch,'work','job');
  const store=join(scratch,'store'),entry='fixture-entry',transitive='fixture-transitive',peer='fixture-peer',dev='fixture-dev';
  const json=(path:string,value:unknown):void=>{writeFileSync(path,JSON.stringify(value));};
  const install=(name:string,body:string,dependencies:Record<string,string>={},peers:Record<string,string>={}):string=>{
    const modules=layout==='classic'?join(root,'node_modules'):layout==='adjacent'?join(store,'node_modules'):join(store,name,'node_modules');
    const directory=join(modules,name);mkdirSync(directory,{recursive:true});
    json(join(directory,'package.json'),{name,type:'module',exports:'./index.mjs',dependencies,
      peerDependencies:peers,optionalDependencies:{'fixture-absent':'1'}});
    writeFileSync(join(directory,'index.mjs'),body);
    if(layout!=='classic')symlinkSync(directory,join(root,'node_modules',name),'dir');
    return directory;
  };
  try{
    mkdirSync(join(root,'node_modules'),{recursive:true});mkdirSync(work,{recursive:true});
    json(join(root,'package.json'),{type:'module',dependencies:{[entry]:'1'},devDependencies:{[dev]:'1'}});
    const entryDir=install(entry,`import {value} from '${transitive}';import {suffix} from '${peer}';export const answer=value+suffix;`,{[transitive]:'1'},{[peer]:'1'});
    const transitiveDir=install(transitive,`export const value='runtime';`,{[entry]:'1'});
    const peerDir=install(peer,`export const suffix='-closure';`);
    const devDir=install(dev,`export const secret='not-runtime';`);
    if(layout==='external'){
      for(const [from,name,target] of [[entryDir,transitive,transitiveDir],[entryDir,peer,peerDir],[transitiveDir,entry,entryDir]] as const){
        symlinkSync(target,join(from,'..',name),'dir');
      }
    }
    const loader=join(root,'loader.mjs'),script=join(root,'job.mjs');writeFileSync(loader,'');
    writeFileSync(script,`import {readFileSync} from 'node:fs';
import {answer} from '${entry}';
let unrelated;
try{readFileSync(${JSON.stringify(join(devDir,'index.mjs'))});unrelated='read';}catch(error){unrelated=error.code;}
console.log(JSON.stringify({refused:JSON.stringify({answer,unrelated,reads:process.execArgv.filter(arg=>arg.startsWith('--allow-fs-read='))})}));
process.exitCode=3;`);
    const result=await runJob({root,execPath:process.execPath,loader,script,wrap:[],limits:{seconds:3,memoryMB:512,heapMB:256}},join(work,'input.tar'),join(work,'out'));
    expect(result.kind,result.kind==='killed'?result.reason:'').toBe('refused');
    if(result.kind!=='refused')throw new Error('The actual cook child did not report its runtime boundary');
    const report=JSON.parse(result.reason) as {answer:string;unrelated:string;reads:string[]};
    expect(report.answer).toBe('runtime-closure');
    if(layout==='classic')expect(report.reads).toEqual([`--allow-fs-read=${root}`,`--allow-fs-read=${join(scratch,'work')}`]);
    else expect(report.unrelated).toBe('ERR_ACCESS_DENIED');
  }finally{rmSync(scratch,{recursive:true,force:true});}
});

it('retains root-only permissions for a standalone launcher with no package manifest',async()=>{
  const scratch=mkdtempSync(join(tmpdir(),'cook-bare-runtime-')),root=join(scratch,'root'),work=join(scratch,'work','job');
  try{
    mkdirSync(root,{recursive:true});mkdirSync(work,{recursive:true});
    const loader=join(root,'loader.mjs'),script=join(root,'job.mjs');writeFileSync(loader,'');
    writeFileSync(script,`console.log(JSON.stringify({refused:JSON.stringify(process.execArgv.filter(arg=>arg.startsWith('--allow-fs-read=')))}));process.exitCode=3;`);
    const result=await runJob({root,execPath:process.execPath,loader,script,wrap:[],limits:{seconds:3,memoryMB:512,heapMB:256}},join(work,'input.tar'),join(work,'out'));
    expect(result.kind).toBe('refused');if(result.kind!=='refused')throw new Error('Standalone cook did not report');
    expect(JSON.parse(result.reason)).toEqual([`--allow-fs-read=${root}`,`--allow-fs-read=${join(scratch,'work')}`]);
  }finally{rmSync(scratch,{recursive:true,force:true});}
});
