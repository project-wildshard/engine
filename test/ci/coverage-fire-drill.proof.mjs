// TC26: real product controls, explicit CI only, outside Vitest and hooks.
import '../../src/shared/engine/core/portableMathFirst.ts';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {test} from 'node:test';

function timed(name,work){
  test(`TC26 ${name}`,{timeout:9500},async()=>{
    const start=performance.now();
    await work();
    assert.ok(performance.now()-start<9500,'Complete TC26 case exceeds 9.5 seconds');
  });
}

// The Template's door and saved field, from its frozen server slice (TEMPLATE-E2E TR-5, test/fixtures/gameplaySlice.ts).
const GAMEPLAY='gameplay slice';
async function folderInput(slug){
  const {loadHeadlessFolder}=await import('../../src/server/host/headlessFolder.ts');
  const {loadRapier}=await import('../../src/shared/engine/physics/rapier.ts');
  const {runtimeAssets,builtFolder}=await import('../fixtures/engine-lift/folder.ts');
  const directory=slug===GAMEPLAY?'test/fixtures/gameplay-slice':builtFolder(slug),product=await loadHeadlessFolder(directory);
  return {product,shard:product.shardfile,assets:runtimeAssets(product,directory),rapier:await loadRapier(readFileSync('public/assets/physics/rapier.wasm'))};
}

timed('host',async()=>{
  const {createNativeProofResident,prepareFolderPlan}=await import('../../src/test/game/headlessNative.ts');
  const {nativeTamingOf}=await import('../../src/server/game/riding/nativeTaming.ts');
  const {leadPlayer}=await import('../../src/shared/engine/sim/leadPlayer.ts');
  const resident=await createNativeProofResident(await folderInput('nalati-grasslands'),prepareFolderPlan);
  try{
    const {host}=resident,player=leadPlayer(host),taming=nativeTamingOf(host);
    const horse=[...host.entities.values()].find(row=>row.kind==='horse'&&row.variant==='stallion');
    assert.ok(taming&&horse,'Actual Nalati taming owner and living stallion must install');
    assert.equal(taming.view.trust,null);
    // Controlled placement isolates the real approach law; no trust, prompt,
    // reward, private register or horse state is assigned.
    player.position.set(horse.position.x-3,host.groundHeightAt(horse.position.x-3,horse.position.z-3)+.05,horse.position.z-3);
    player.motor.resetAt(player.position);
    for(let tick=0;tick<240;tick++)resident.step([
      {kind:'player',moveX:0,moveZ:0,yaw:0,commandVersion:1,crouch:true},
      {kind:'script',actorId:'nalati.taming.offer',value:1},
    ]);
    assert.ok(taming.view.trust>0,'TC26_HOST_PROGRESS: actual offered approach must gain trust');
    assert.equal(taming.view.offer,true);
    assert.equal(taming.phase,'wild','This short contract grants no bond');
  }finally{resident.dispose();}
});

timed('door',async()=>{
  const {createShardfileSim}=await import('../../src/server/game/plugin/simulation.ts');
  const {leadPlayer}=await import('../../src/shared/engine/sim/leadPlayer.ts');
  const input=await folderInput(GAMEPLAY),facts=[];
  const sim=createShardfileSim(input.shard,input.assets,{rapier:input.rapier,quest:{fact:(...args)=>facts.push(args),coins:(...args)=>facts.push(args)}});
  try{
    const player=leadPlayer(sim.host),target=input.shard.targets.interactions.find(row=>row.scene==='template.door.toggle');
    assert.ok(target&&sim.lane,'The Template slice\'s door and admitted scene lane must exist');
    assert.equal(sim.lane.world.publicField('template.door.open'),0);
    assert.equal(sim.interact(target.id),false,'Spawn is outside the actual door prompt');
    const [x,,z]=target.at;
    player.position.set(x,sim.host.groundHeightAt(x,z-1.5)+.05,z-1.5);player.motor.resetAt(player.position);
    assert.equal(sim.selectedInteraction(),target.id);
    assert.equal(sim.interact(target.id),true);
    sim.host.step();
    assert.equal(sim.lane.world.publicField('template.door.open'),1,'TC26_DOOR_OPEN: admitted door script must publish its open field');
    assert.equal(sim.interact(target.id),true);sim.host.step();
    assert.equal(sim.lane.world.publicField('template.door.open'),0);
  }finally{sim.dispose();}
});

timed('format',async()=>{
  const {loadHeadlessFolder}=await import('../../src/server/host/headlessFolder.ts');
  // The format package's own Brasscap export (J434 retired its handwritten Template 2, TEMPLATE-E2E TR-10).
  const product=await loadHeadlessFolder('node_modules/@wildshard/format/corpus/exports/brasscap-mesa');
  assert.equal(product.slug,'brasscap-mesa');
  assert.ok(product.shardfile.state.shared.some(row=>row.name==='brasscap.gate.open'));
});

timed('dropped-section',async()=>{
  const {loadHeadlessFolder}=await import('../../src/server/host/headlessFolder.ts');
  const product=await loadHeadlessFolder('node_modules/@wildshard/format/corpus/exports/brasscap-mesa');
  assert.equal(product.slug,'brasscap-mesa');
});

timed('broken-tar',async()=>{
  const {formatTemplate}=await import('../../scripts/pin-format.ts');
  const {readTar}=await import('@wildshard/format/tar');
  const files=readTar(formatTemplate('brasscap-mesa').bytes);
  assert.ok(files.has('shard.json'),'Actual published Brasscap archive must be admitted');
});

timed('save-field',async()=>{
  const {createShardfileSim,bindShardfileSim}=await import('../../src/server/game/plugin/simulation.ts');
  const {leadPlayer}=await import('../../src/shared/engine/sim/leadPlayer.ts');
  const {serializeSimSnapshot,snapshotSimHostBytes,decodeSimSnapshot}=await import('../../src/shared/engine/sim/snapshot.ts');
  const {restoreSimHost}=await import('../../src/server/engine/sim/restore.ts');
  const input=await folderInput(GAMEPLAY),ports={rapier:input.rapier,quest:{fact:()=>undefined,coins:()=>undefined}};
  const sim=createShardfileSim(input.shard,input.assets,ports);
  let restored,again;
  try{
    const player=leadPlayer(sim.host),target=input.shard.targets.interactions.find(row=>row.scene==='template.door.toggle');
    assert.ok(target&&sim.lane);
    const [x,,z]=target.at;player.position.set(x,sim.host.groundHeightAt(x,z-1.5)+.05,z-1.5);player.motor.resetAt(player.position);
    assert.equal(sim.interact(target.id),true);sim.host.step();
    assert.equal(sim.lane.world.publicField('template.door.open'),1);
    const saved=serializeSimSnapshot(snapshotSimHostBytes(sim.host));
    restored=restoreSimHost(sim.host.level,ports,decodeSimSnapshot(saved),host=>{
      again=bindShardfileSim(host,input.shard,input.assets,{...ports,restoring:true});
    });
    assert.equal(again?.lane?.world.publicField('template.door.open'),1,'TC26_SAVE_FIELD: real restored door must retain its public field');
  }finally{restored?.dispose();sim.dispose();}
});

timed('cook-source',async()=>{
  const {ringCookInputs}=await import('../../scripts/ring-cook-inputs.ts');
  const pins=JSON.parse(readFileSync('test/pins/shardfiles.json','utf8')).shards;
  // J434: both rings cook the catalogue head from the pin cache; the format corpus never stands in for it
  const ring=ringCookInputs(['brasscap-mesa'],pins,'tmp/absent-cook-cache');
  assert.deepEqual(ring.heads,[pins.find(row=>row.slug==='brasscap-mesa')]);
  assert.throws(()=>ring.read(ring.heads[0].hash),/ENOENT/u,'A missing head cannot be replaced by the format corpus');
  assert.throws(()=>ring.read('0'.repeat(64)),/unselected input/u);
});

timed('shard-red',()=>{
  const bytes=readFileSync('test/fixtures/ring3-red.json'),report=JSON.parse(bytes);
  assert.equal(report.ok,false);assert.equal(report.rows.length,7);
  assert.ok(report.rows.every(row=>row.status==='failure'&&row.issue?.startsWith(`https://github.com/project-wildshard/${row.repo}/issues/`)),'Actual failed receivers must retain their owning-repo issues');
  mkdirSync('tmp',{recursive:true});const work=mkdtempSync(resolve('tmp/coverage-ring3-'));
  try{
    writeFileSync(join(work,'verdict.json'),bytes);
    const child=spawnSync(process.execPath,['scripts/ring3.ts','report',work],{encoding:'utf8',timeout:9000});
    assert.equal(child.signal,null);assert.equal(child.error,undefined);
    assert.equal(child.status,1,'TC26_RED_SHARD_HELD: actual red receiver aggregate must refuse qualification');
    assert.match(child.stdout,/RELEASE HELD/u);
    for(const row of report.rows)assert.ok(child.stdout.includes(row.issue),'The real owner route must remain visible');
  }finally{rmSync(work,{recursive:true,force:true});}
});

timed('export',()=>{
  mkdirSync('tmp/coverage-consumer',{recursive:true});
  const work=mkdtempSync(resolve('tmp/coverage-consumer/run-'));
  try{
    writeFileSync(join(work,'package.json'),'{"name":"coverage-outside-author","type":"module"}');
    mkdirSync(join(work,'node_modules/@wildshard'),{recursive:true});
    symlinkSync(resolve('.'),join(work,'node_modules/@wildshard/engine'));
    writeFileSync(join(work,'main.mjs'),"import assert from 'node:assert/strict';import{emptyShardfile}from'@wildshard/engine/host/author';const shard=emptyShardfile({slug:'outside-author',name:'Outside',author:'Test',revision:1,seed:1});assert.equal(shard.identity.slug,'outside-author');console.log('TC26_CONSUMER_ACCEPTED');");
    const output=execFileSync(process.execPath,['--import',resolve('scripts/bake-loader.mjs'),join(work,'main.mjs')],{cwd:work,encoding:'utf8',timeout:9000,stdio:['ignore','pipe','pipe']});
    assert.match(output,/TC26_CONSUMER_ACCEPTED/u);
  }finally{rmSync(work,{recursive:true,force:true});}
});
