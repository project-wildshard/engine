// EG-11: real native play measured AFTER installation, never a module-count gate.
// Ring 2: six pinned worlds plus V8 instrumentation exceed a quick case's budget.
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadHeadlessProduct} from '../src/server/host/headlessProduct';
import {createTrustedHeadlessResident} from '../src/server/host/headlessRuntime';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {outputDescriptor,serverReadsFile} from '../src/shared/game/shardfile/outputDescriptor';

const output=process.argv[2];if(output===undefined)throw new Error('usage: host-activity <report.json>');
const session=new Session();session.connect();await session.post('Profiler.enable');
const prefix=pathToFileURL(`${resolve('src/server/game')}/`).href;
const products=[];
try {
  for(const slug of ['sunscar-dunes','far-reach','driftwood-isle','nalati-grasslands','pine-hollow','nine-dragon-stack']) {
    const started=performance.now(),directory=slug==='sunscar-dunes'?`out/${slug}`:`out/.slices/${slug}`;
    const product=await loadHeadlessProduct(directory),descriptor=outputDescriptor(product.shardfile);
    if(descriptor===undefined)throw new Error(`No admitted index for ${slug}`);
    const assets=new Map(descriptor.index.files.filter(file=>serverReadsFile(file,product.shardfile.terrain?.collider)&&(file.name===undefined||file.kind==='wasm'||file.kind==='tile'))
      .map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
    const live=await createTrustedHeadlessResident({product,shard:product.shardfile,assets,rapier:await loadRapier(readFileSync('public/assets/physics/rapier.wasm'))});
    try {
      await session.post('Profiler.startPreciseCoverage',{callCount:true,detailed:false});
      await session.post('Profiler.takePreciseCoverage'); // Clear any pre-play profiler activity.
      for(let tick=0;tick<240;tick++)live.step([{kind:'player',moveX:.3*Math.sin(tick/90),moveZ:-1,yaw:0,
        ...tick%47===0?{jump:true as const}:{},...tick%97===0?{dodge:true as const}:{}}]);
      const {result}=await session.post('Profiler.takePreciseCoverage');await session.post('Profiler.stopPreciseCoverage');
      const modules=result.filter(row=>row.url.startsWith(prefix)).map(row=>({file:`src/server/game/${row.url.slice(prefix.length)}`,
        calledFunctions:row.functions.filter(fn=>(fn.ranges[0]?.count??0)>0).length,reportedFunctions:row.functions.length}));
      if(modules.length===0)throw new Error(`V8 supplied no mapped game sources for ${slug}; cannot publish activity`);
      products.push({slug,ticks:live.host.state.tick,ms:Math.round(performance.now()-started),modules});
      console.log(`${slug}: ${modules.reduce((sum,row)=>sum+row.calledFunctions,0)} game functions called after installation`);
    } finally {live.dispose();}
  }
  mkdirSync(dirname(resolve(output)),{recursive:true});
  writeFileSync(output,`${JSON.stringify({version:1,sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),platform:`${process.platform}-${process.arch}`,
    limitation:'Native six-product walk only; not all 46 hosts or sibling verbs. Declared Template/Blender worker isolates are not profiled here.',products},null,2)}\n`);
} finally {session.disconnect();}
