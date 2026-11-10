// Manual Ring 2: this preserves three real workers, an independent
// source mirror and fresh compilation. Hosted native preparation can exceed10s.
// Never register in a commit/push hook. Run after pinned Frostline is prepared:
// node --experimental-transform-types --import ./scripts/sim-node-loader.mjs --test test/manual/compiled-product-worker.proof.mjs
// oxlint-disable-next-line import/no-unassigned-import -- Install deterministic simulation math before loading any runtime.
import '../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare actual source and compiled native outcomes.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove only the private control mirror and compiler outputs.
import {constants,cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only fixed local source and product paths.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Manual outer-edge proof outside every commit and push hook.
import test from 'node:test';
import {holdCpu} from '../../scripts/cpu-admission.mjs';
import {linkNodeModules} from '../../scripts/link-node-modules.mjs';
import {HeadlessSimulation} from '../../src/server/host/headless';
import {loadHeadlessProduct} from '../../src/server/host/headlessProduct';
import {productHeadlessSections} from '../../src/shared/host/headlessSections';
import {outputDescriptor} from '../../src/shared/game/shardfile/outputDescriptor';
import {builtProduct} from '../fixtures/builtProduct';
import {compileProductWorker} from '../fixtures/headless/compileProductWorker';
import {physicsRoutes} from '../fixtures/headless/physicsRoutes';

// Admission wait is preparation, not a route or compilation clock.
const lease=await holdCpu(4);
void lease.lost.then(()=>{console.error('Actual compiled-worker proof grant lost');return process.kill(process.pid,'SIGTERM');});
try{await test('fixed compiled product code retains the real route and refuses changed source or output',{timeout:60_000},async()=>{
  const root=resolve('.');mkdirSync(resolve(root,'tmp'),{recursive:true});
  const mirror=mkdtempSync(resolve(root,'tmp','compiled-worker-control-'));
  /** @type {Awaited<ReturnType<typeof compileProductWorker>>|undefined} */
  let prepared,fresh;
  /** @type {HeadlessSimulation|undefined} */
  let source;
  /** @type {Awaited<ReturnType<import('../fixtures/headless/productSession.ts').ProductWorkerFactory>>|undefined} */
  let compiled;
  try{
    cpSync(resolve(root,'src'),resolve(mirror,'src'),{recursive:true,mode:constants.COPYFILE_FICLONE,
      filter:path=>!path.split('/').includes('node_modules')});
    for(const name of ['package.json','pnpm-lock.yaml'])cpSync(resolve(root,name),resolve(mirror,name));
    linkNodeModules(root,mirror);
    const directory=builtProduct('open-plot-frostline-peaks'),product=await loadHeadlessProduct(directory),shard=product.shardfile;
    const descriptor=outputDescriptor(shard);assert.ok(descriptor);
    const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,Uint8Array.from(readFileSync(resolve(directory,file.path)))]));
    const options={deadline:'advisory',sections:productHeadlessSections(product)};
    /** @param {()=>Promise<{dispose:()=>Promise<void>}>} create @param {RegExp} reason */
    const refuses=async(create,reason)=>{
      // A broken refusal still owns any unexpectedly accepted worker; retire it
      // before the assertion fails, including in mutation controls.
      await assert.rejects(async()=>{const unexpected=await create();await unexpected.dispose();},reason);
    };
    prepared=await compileProductWorker(mirror);const originalGeneration=prepared;
    source=await HeadlessSimulation.create(shard,assets,undefined,options);
    compiled=await prepared.create(shard,assets,undefined,options);
    const initial=source.checkpoint;assert.ok(initial);assert.deepEqual(compiled.checkpoint,initial);
    const route=physicsRoutes.find(row=>row.slug==='open-plot-frostline-peaks');assert.ok(route);
    const {leg}=route,plan={ticks:Math.ceil(leg.timeout*60),start:leg.start,once:true,holdActors:true,
      points:[{x:leg.start.x,z:leg.start.z},...leg.waypoints],...(leg.inside===undefined?{}:{inside:leg.inside})};
    const expected=await source.walkLeg(plan),actual=await compiled.walkLeg(plan);
    /** @param {import('../../src/shared/host/headlessJourney.ts').HeadlessJourneyReport} report */
    const withoutTiming=report=>{
      const result={...report};Reflect.deleteProperty(result,'maxTickMicros');return result;
    };
    assert.equal(actual.complete,true);assert.equal(actual.out,0);assert.deepEqual(actual.stuck,[]);
    assert.deepEqual(withoutTiming(actual),withoutTiming(expected));
    assert.equal(compiled.checkpoint?.snapshot,source.checkpoint?.snapshot);
    await compiled.dispose();await assert.rejects(compiled.step());compiled=undefined;
    const workerSource=resolve(mirror,'src/server/host/bake/headlessWorker.ts');
    writeFileSync(workerSource,`${readFileSync(workerSource,'utf8')}\n// Owned control: a different source generation.\n`);
    await refuses(()=>originalGeneration.create(shard,assets,undefined,options),/source changed/u);
    fresh=await compileProductWorker(mirror);const nextGeneration=fresh;
    compiled=await fresh.create(shard,assets,undefined,options);assert.deepEqual(compiled.checkpoint,initial);
    await compiled.dispose();compiled=undefined;
    const output=resolve(fresh.directory,'headlessWorker.js');writeFileSync(output,`${readFileSync(output,'utf8')}\n`);
    await refuses(()=>nextGeneration.create(shard,assets,undefined,options),/output changed/u);
    fresh.dispose();await refuses(()=>nextGeneration.create(shard,assets,undefined,options),/closed/u);
    console.info(JSON.stringify({proof:'compiled-product-worker',grant:lease.proof,routeTicks:actual.ticks,
      sameInitialCheckpoint:true,sameRouteCheckpoint:true,changedSourceRefused:true,newGenerationAccepted:true,changedOutputRefused:true,closedRefused:true}));
  }finally{await compiled?.dispose();await source?.dispose();fresh?.dispose();prepared?.dispose();rmSync(mirror,{recursive:true,force:true});}
});}finally{await lease.release();}
